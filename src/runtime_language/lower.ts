import type { SourceSpan } from "../ast.ts";
import type {
  BrlBlockStatement,
  BrlExpression,
  BrlFunctionDeclaration,
  BrlModule,
  BrlStatement,
} from "./ast.ts";
import {
  BRL_BOOL,
  BRL_U32,
  type BrlIrBlock,
  type BrlIrExpression,
  type BrlIrFunction,
  type BrlIrInstruction,
  type BrlIrLocal,
  type BrlIrProgram,
  type BrlIrRecord,
  type BrlIrTerminator,
  type BrlIrType,
  isIntegerBrlIrType,
  sameBrlIrType,
} from "./ir.ts";
import { typecheckBrlModule } from "./typecheck.ts";

export function lowerBrlModule(module: BrlModule): BrlIrProgram {
  const checked = typecheckBrlModule(module);
  const declarations = new Map(
    module.items
      .filter((item): item is BrlFunctionDeclaration =>
        item.kind === "function"
      )
      .map((item) => [item.name.text, item]),
  );
  return {
    records: checked.records,
    diagnostics: checked.diagnostics,
    functions: checked.functions.map((fn) =>
      lowerFunction(
        requiredDeclaration(declarations, fn),
        fn,
        checked.functions,
        checked.records,
      )
    ),
  };
}

function lowerFunction(
  declaration: BrlFunctionDeclaration,
  checked: BrlIrFunction,
  functions: readonly BrlIrFunction[],
  records: readonly BrlIrRecord[],
): BrlIrFunction {
  const context = new LowerContext(checked, functions, records);
  for (const parameter of checked.params) {
    context.bind(parameter.name, parameter);
  }
  context.startBlock(declaration.body.span);
  lowerBlock(declaration.body, context, checked.result);
  context.ensureTerminator(
    defaultTerminator(declaration.body.span, checked.result),
  );
  return { ...checked, locals: context.locals, blocks: context.blocks };
}

function lowerBlock(
  block: BrlBlockStatement,
  context: LowerContext,
  result: BrlIrType | null,
): void {
  context.enterScope();
  for (const statement of block.statements) {
    if (context.isCurrentTerminated()) break;
    lowerStatement(statement, context, result);
  }
  context.exitScope();
}

function lowerStatement(
  statement: BrlStatement,
  context: LowerContext,
  result: BrlIrType | null,
): void {
  switch (statement.kind) {
    case "block":
      lowerBlock(statement, context, result);
      return;
    case "let": {
      const local = context.localForDeclaration(
        statement.name.text,
        statement.span,
      );
      if (local) {
        context.bind(local.name, local);
        context.addInstruction({
          kind: "assign",
          local: local.id,
          value: lowerExpression(statement.expression, context, local.type),
          span: statement.span,
        });
      }
      return;
    }
    case "assign": {
      const local = context.lookup(statement.target.text);
      if (local) {
        context.addInstruction({
          kind: "assign",
          local: local.id,
          value: lowerExpression(statement.expression, context, local.type),
          span: statement.span,
        });
      }
      return;
    }
    case "expression":
      if (isTrapStatement(statement.expression)) {
        context.addInstruction({
          kind: "trap",
          message: "BRL trap",
          span: statement.span,
        });
        const terminator = defaultTerminator(statement.span, result);
        if (terminator) context.setTerminator(terminator);
        return;
      }
      context.addInstruction({
        kind: "evaluate",
        value: lowerExpression(statement.expression, context, null),
        span: statement.span,
      });
      return;
    case "return":
      context.setTerminator({
        kind: "return",
        value: statement.expression
          ? lowerExpression(statement.expression, context, result)
          : null,
        span: statement.span,
      });
      return;
    case "if": {
      const consequent = context.newBlock(statement.consequent.span);
      const alternate = context.newBlock(
        statement.alternate?.span ?? statement.span,
      );
      const join = context.newBlock(statement.span);
      context.setTerminator({
        kind: "branch",
        condition: lowerExpression(statement.condition, context, BRL_BOOL),
        consequent: consequent.id,
        alternate: alternate.id,
        span: statement.condition.span,
      });
      context.activate(consequent.id);
      lowerBlock(statement.consequent, context, result);
      context.ensureTerminator({
        kind: "jump",
        target: join.id,
        span: statement.consequent.span,
      });
      context.activate(alternate.id);
      if (statement.alternate) {
        lowerBlock(statement.alternate, context, result);
      }
      context.ensureTerminator({
        kind: "jump",
        target: join.id,
        span: statement.alternate?.span ?? statement.span,
      });
      context.activate(join.id);
      return;
    }
    case "while": {
      const condition = context.newBlock(statement.condition.span);
      const body = context.newBlock(statement.body.span);
      const join = context.newBlock(statement.span);
      context.setTerminator({
        kind: "jump",
        target: condition.id,
        span: statement.condition.span,
      });
      context.activate(condition.id);
      context.setTerminator({
        kind: "branch",
        condition: lowerExpression(statement.condition, context, BRL_BOOL),
        consequent: body.id,
        alternate: join.id,
        span: statement.condition.span,
      });
      context.activate(body.id);
      context.pushLoop({ breakTarget: join.id, continueTarget: condition.id });
      lowerBlock(statement.body, context, result);
      context.popLoop();
      context.ensureTerminator({
        kind: "jump",
        target: condition.id,
        span: statement.body.span,
      });
      context.activate(join.id);
      return;
    }
    case "for": {
      const local = context.localForDeclaration(
        statement.name.text,
        statement.name.span,
      );
      if (local) {
        const endLocal = context.syntheticLocal(
          `${statement.name.text}_end`,
          BRL_U32,
          statement.end.span,
        );
        context.addInstruction({
          kind: "assign",
          local: local.id,
          value: lowerExpression(statement.start, context, BRL_U32),
          span: statement.name.span,
        });
        context.addInstruction({
          kind: "assign",
          local: endLocal.id,
          value: lowerExpression(statement.end, context, BRL_U32),
          span: statement.end.span,
        });
        const condition = context.newBlock(statement.span);
        const body = context.newBlock(statement.body.span);
        const increment = context.newBlock(statement.span);
        const join = context.newBlock(statement.span);
        context.setTerminator({
          kind: "jump",
          target: condition.id,
          span: statement.span,
        });
        context.activate(condition.id);
        context.setTerminator({
          kind: "branch",
          condition: {
            kind: "binary",
            operator: "<",
            left: localExpression(local, statement.name.span),
            right: localExpression(endLocal, statement.end.span),
            type: BRL_BOOL,
            span: statement.span,
          },
          consequent: body.id,
          alternate: join.id,
          span: statement.span,
        });
        context.activate(body.id);
        context.enterScope();
        context.bind(local.name, local);
        context.pushLoop({
          breakTarget: join.id,
          continueTarget: increment.id,
        });
        lowerBlock(statement.body, context, result);
        context.popLoop();
        context.exitScope();
        context.ensureTerminator({
          kind: "jump",
          target: increment.id,
          span: statement.body.span,
        });
        context.activate(increment.id);
        context.addInstruction({
          kind: "assign",
          local: local.id,
          value: {
            kind: "binary",
            operator: "+",
            left: localExpression(local, statement.name.span),
            right: {
              kind: "literal",
              type: BRL_U32,
              value: 1,
              span: statement.span,
            },
            type: BRL_U32,
            span: statement.span,
          },
          span: statement.span,
        });
        context.setTerminator({
          kind: "jump",
          target: condition.id,
          span: statement.span,
        });
        context.activate(join.id);
      }
      return;
    }
    case "break": {
      const loop = context.currentLoop();
      if (loop) {
        context.setTerminator({
          kind: "jump",
          target: loop.breakTarget,
          span: statement.span,
        });
      }
      return;
    }
    case "continue": {
      const loop = context.currentLoop();
      if (loop) {
        context.setTerminator({
          kind: "jump",
          target: loop.continueTarget,
          span: statement.span,
        });
      }
      return;
    }
    case "missing":
      return;
  }
}

function lowerExpression(
  expression: BrlExpression,
  context: LowerContext,
  expected: BrlIrType | null,
): BrlIrExpression {
  switch (expression.kind) {
    case "integer":
      return {
        kind: "literal",
        type: expected ?? BRL_U32,
        value: expression.value,
        span: expression.span,
      };
    case "bool":
      return {
        kind: "literal",
        type: BRL_BOOL,
        value: expression.value,
        span: expression.span,
      };
    case "name": {
      const local = context.lookup(expression.name.text);
      return local
        ? {
          kind: "local",
          local: local.id,
          type: local.type,
          span: expression.span,
        }
        : {
          kind: "literal",
          type: expected ?? BRL_U32,
          value: 0,
          span: expression.span,
        };
    }
    case "record": {
      const record = context.recordByName(expression.name.text);
      if (!record) {
        return {
          kind: "literal",
          type: expected ?? BRL_U32,
          value: 0,
          span: expression.span,
        };
      }
      return {
        kind: "record",
        type: { kind: "record", id: record.id, name: record.name },
        fields: record.fields.map((field) => {
          const value = expression.fields.find((entry) =>
            entry.name.text === field.name
          );
          return {
            fieldId: field.id,
            value: lowerExpression(
              value?.expression ?? {
                kind: "integer" as const,
                value: 0,
                raw: "0",
                span: expression.span,
              },
              context,
              field.type,
            ),
            span: value?.span ?? expression.span,
          };
        }),
        span: expression.span,
      };
    }
    case "unary":
      return {
        kind: "unary",
        operator: expression.operator,
        operand: lowerExpression(expression.operand, context, BRL_BOOL),
        type: BRL_BOOL,
        span: expression.span,
      };
    case "binary": {
      const left = lowerExpression(expression.left, context, null);
      const comparison = ["==", "!=", "<", "<=", ">", ">="].includes(
        expression.operator,
      );
      const logical = expression.operator === "&&" ||
        expression.operator === "||";
      const type = comparison || logical ? BRL_BOOL : left.type;
      return {
        kind: "binary",
        operator: expression.operator,
        left,
        right: lowerExpression(expression.right, context, left.type),
        type,
        span: expression.span,
      };
    }
    case "index": {
      const receiver = lowerExpression(expression.receiver, context, null);
      const type =
        receiver.type.kind === "array" || receiver.type.kind === "span" ||
          receiver.type.kind === "vec"
          ? receiver.type.element
          : expected ?? BRL_U32;
      return {
        kind: "index",
        receiver,
        index: lowerExpression(expression.index, context, BRL_U32),
        type,
        span: expression.span,
      };
    }
    case "field": {
      const receiver = lowerExpression(expression.receiver, context, null);
      if (expression.field.text !== "length") {
        const field = context.fieldByName(receiver.type, expression.field.text);
        return {
          kind: "field",
          receiver,
          fieldId: field?.id ?? 0,
          type: field?.type ?? expected ?? BRL_U32,
          span: expression.span,
        };
      }
      return {
        kind: "field",
        receiver,
        fieldId: -1,
        type: expected ?? BRL_U32,
        span: expression.span,
      };
    }
    case "cast":
      return {
        kind: "cast",
        expression: lowerExpression(expression.expression, context, null),
        type: expected ?? BRL_U32,
        span: expression.span,
      };
    case "call": {
      if (expression.callee.kind === "name") {
        const intrinsic = lowerIntrinsicCall(expression, context, expected);
        if (intrinsic) return intrinsic;
        const fn = context.functionByName(expression.callee.name.text);
        if (fn) {
          return {
            kind: "call",
            type: fn.result ?? expected ?? BRL_U32,
            functionId: fn.id,
            args: expression.args.map((arg, index) =>
              lowerExpression(arg, context, fn.params[index]?.type ?? null)
            ),
            span: expression.span,
          };
        }
      }
      return {
        kind: "literal",
        type: expected ?? BRL_U32,
        value: 0,
        span: expression.span,
      };
    }
    case "missing":
      return {
        kind: "literal",
        type: expected ?? BRL_U32,
        value: 0,
        span: expression.span,
      };
  }
}

function isTrapStatement(expression: BrlExpression): boolean {
  return expression.kind === "call" &&
    expression.callee.kind === "name" &&
    expression.callee.name.text === "trap";
}

function lowerIntrinsicCall(
  expression: Extract<BrlExpression, { readonly kind: "call" }>,
  context: LowerContext,
  expected: BrlIrType | null,
): BrlIrExpression | null {
  if (expression.callee.kind !== "name") return null;
  const name = expression.callee.name.text;
  if (name !== "span_len" && name !== "vec_len") return null;
  const receiver = expression.args[0]
    ? lowerExpression(expression.args[0], context, null)
    : {
      kind: "literal" as const,
      type: expected ?? BRL_U32,
      value: 0,
      span: expression.span,
    };
  return {
    kind: "field",
    receiver,
    fieldId: -1,
    type: BRL_U32,
    span: expression.span,
  };
}

function defaultTerminator(
  span: SourceSpan,
  result: BrlIrType | null,
): BrlIrTerminator | null {
  if (result) {
    return {
      kind: "return",
      value: {
        kind: "literal",
        type: result,
        value: isIntegerBrlIrType(result) ? 0 : false,
        span,
      },
      span,
    };
  }
  return { kind: "return", value: null, span };
}

interface MutableBrlIrBlock {
  readonly id: number;
  instructions: BrlIrInstruction[];
  terminator: BrlIrTerminator | null;
  readonly span: SourceSpan;
}

interface LoopTargets {
  readonly breakTarget: number;
  readonly continueTarget: number;
}

class LowerContext {
  private readonly mutableBlocks: MutableBrlIrBlock[] = [];
  private active = -1;
  private nextSyntheticLocalId: number;
  private scopes: Map<string, BrlIrLocal>[] = [new Map()];
  private readonly loopStack: LoopTargets[] = [];
  private readonly functionsByName: ReadonlyMap<string, BrlIrFunction>;

  constructor(
    private readonly fn: BrlIrFunction,
    functions: readonly BrlIrFunction[],
    private readonly records: readonly BrlIrRecord[],
  ) {
    this.nextSyntheticLocalId =
      Math.max(-1, ...fn.locals.map((local) => local.id)) + 1;
    this.functionsByName = new Map(
      functions.map((entry) => [entry.name, entry]),
    );
  }

  get locals(): readonly BrlIrLocal[] {
    const syntheticIds = new Set(this.syntheticLocals.map((local) => local.id));
    return [
      ...this.fn.locals.filter((local) => !syntheticIds.has(local.id)),
      ...this.syntheticLocals,
    ];
  }

  private readonly syntheticLocals: BrlIrLocal[] = [];

  get blocks(): readonly BrlIrBlock[] {
    return this.mutableBlocks;
  }

  startBlock(span: SourceSpan): BrlIrBlock {
    const block = this.newBlock(span);
    this.activate(block.id);
    return block;
  }

  newBlock(span: SourceSpan): BrlIrBlock {
    const block: MutableBrlIrBlock = {
      id: this.mutableBlocks.length,
      instructions: [],
      terminator: null,
      span,
    };
    this.mutableBlocks.push(block);
    return block;
  }

  activate(id: number): void {
    this.active = id;
  }

  enterScope(): void {
    this.scopes.push(new Map(this.scopes[this.scopes.length - 1]));
  }

  exitScope(): void {
    if (this.scopes.length > 1) this.scopes.pop();
  }

  bind(name: string, local: BrlIrLocal): void {
    this.scopes[this.scopes.length - 1].set(name, local);
  }

  lookup(name: string): BrlIrLocal | undefined {
    return this.scopes[this.scopes.length - 1].get(name);
  }

  functionByName(name: string): BrlIrFunction | undefined {
    return this.functionsByName.get(name);
  }

  recordByName(name: string): BrlIrRecord | undefined {
    return this.records.find((record) => record.name === name);
  }

  pushLoop(targets: LoopTargets): void {
    this.loopStack.push(targets);
  }

  popLoop(): void {
    this.loopStack.pop();
  }

  currentLoop(): LoopTargets | undefined {
    return this.loopStack[this.loopStack.length - 1];
  }

  fieldByName(type: BrlIrType, name: string) {
    if (type.kind !== "record") return undefined;
    return this.records.find((record) => record.id === type.id)
      ?.fields.find((field) => field.name === name);
  }

  localForDeclaration(name: string, span: SourceSpan): BrlIrLocal | undefined {
    return this.fn.locals.find((local) =>
      local.name === name && local.span.start === span.start &&
      local.span.end === span.end
    );
  }

  syntheticLocal(name: string, type: BrlIrType, span: SourceSpan): BrlIrLocal {
    const local: BrlIrLocal = {
      id: this.nextSyntheticLocalId++,
      name,
      type,
      initialized: true,
      span,
    };
    this.syntheticLocals.push(local);
    return local;
  }

  addInstruction(instruction: BrlIrInstruction): void {
    const block = this.currentBlock();
    block.instructions = [...block.instructions, instruction];
  }

  setTerminator(terminator: BrlIrTerminator): void {
    this.currentBlock().terminator = terminator;
  }

  ensureTerminator(terminator: BrlIrTerminator | null): void {
    const block = this.currentBlock();
    if (!block.terminator) block.terminator = terminator;
  }

  isCurrentTerminated(): boolean {
    return !!this.currentBlock().terminator;
  }

  private currentBlock(): MutableBrlIrBlock {
    const block = this.mutableBlocks[this.active];
    if (!block) throw new Error("No active BRL IR block.");
    return block;
  }
}

function localExpression(local: BrlIrLocal, span: SourceSpan): BrlIrExpression {
  return {
    kind: "local",
    local: local.id,
    type: local.type,
    span,
  };
}

function requiredDeclaration(
  declarations: ReadonlyMap<string, BrlFunctionDeclaration>,
  fn: BrlIrFunction,
): BrlFunctionDeclaration {
  const declaration = declarations.get(fn.name);
  if (!declaration) {
    throw new Error(`Missing BRL function declaration for '${fn.name}'.`);
  }
  return declaration;
}

export function canLowerWithoutTypeErrors(program: BrlIrProgram): boolean {
  return program.diagnostics.every((diagnostic) =>
    diagnostic.severity === "warning" ||
    diagnostic.code.startsWith("BRL_PARSE_") === false
  ) && program.functions.every((fn) =>
    fn.blocks.every((block) =>
      block.terminator?.kind !== "return" ||
      sameBrlIrType(fn.result, block.terminator.value?.type ?? null)
    )
  );
}
