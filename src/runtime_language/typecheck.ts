import type {
  BrlBlockStatement,
  BrlExpression,
  BrlFunctionDeclaration,
  BrlModule,
  BrlStatement,
  BrlTypeNode,
} from "./ast.ts";
import type { BrlDiagnostic } from "./diagnostics.ts";
import { brlDiagnostic } from "./diagnostics.ts";
import {
  BRL_BOOL,
  BRL_U32,
  type BrlIrExpression,
  type BrlIrFunction,
  type BrlIrLocal,
  type BrlIrProgram,
  type BrlIrRecord,
  type BrlIrType,
  formatBrlIrType,
  isIntegerBrlIrType,
  sameBrlIrType,
} from "./ir.ts";
import { resolveBrlModule } from "./resolve.ts";

export interface BrlCheckedProgram extends BrlIrProgram {}

interface FunctionSymbol {
  readonly id: number;
  readonly declaration: BrlFunctionDeclaration;
  readonly params: readonly BrlIrLocal[];
  readonly result: BrlIrType | null;
}

interface ScopeBinding {
  readonly local: BrlIrLocal;
  initialized: boolean;
}

interface CheckContext {
  readonly diagnostics: BrlDiagnostic[];
  readonly records: readonly BrlIrRecord[];
  readonly functions: readonly FunctionSymbol[];
  locals: Map<string, ScopeBinding>;
  readonly allLocals: BrlIrLocal[];
  readonly result: BrlIrType | null;
  nextLocalId: number;
  loopDepth: number;
}

export function typecheckBrlModule(module: BrlModule): BrlCheckedProgram {
  const resolved = resolveBrlModule(module);
  const diagnostics: BrlDiagnostic[] = [...resolved.diagnostics];
  const recordStubs: BrlIrRecord[] = resolved.records.map((record) => ({
    id: record.id,
    name: record.declaration.name.text,
    span: record.declaration.span,
    fields: [],
  }));
  const records: BrlIrRecord[] = resolved.records.map((record) => ({
    id: record.id,
    name: record.declaration.name.text,
    span: record.declaration.span,
    fields: record.fields.map((field) => ({
      id: field.id,
      name: field.declaration.name.text,
      type: typeFromNode(field.declaration.type, recordStubs, diagnostics),
      span: field.declaration.span,
    })),
  }));
  const functions: FunctionSymbol[] = resolved.functions.map((fn) => ({
    id: fn.id,
    declaration: fn.declaration,
    params: fn.declaration.parameters.map((parameter, index) => ({
      id: index,
      name: parameter.name.text,
      type: typeFromNode(parameter.type, records, diagnostics),
      initialized: true,
      span: parameter.span,
    })),
    result: fn.declaration.result
      ? typeFromNode(fn.declaration.result, records, diagnostics)
      : null,
  }));

  return {
    records,
    functions: functions.map((fn) =>
      checkFunction(fn, functions, records, diagnostics)
    ),
    diagnostics,
  };
}

function checkFunction(
  fn: FunctionSymbol,
  functions: readonly FunctionSymbol[],
  records: readonly BrlIrRecord[],
  diagnostics: BrlDiagnostic[],
): BrlIrFunction {
  const locals = new Map<string, ScopeBinding>();
  const allLocals = [...fn.params];
  for (const parameter of fn.params) {
    locals.set(parameter.name, { local: parameter, initialized: true });
  }
  const context: CheckContext = {
    diagnostics,
    records,
    functions,
    locals,
    allLocals,
    result: fn.result,
    nextLocalId: fn.params.length,
    loopDepth: 0,
  };
  const returns = checkBlock(fn.declaration.body, context);
  if (fn.result && !returns) {
    diagnostics.push(
      brlDiagnostic(
        "BRL_TYPE_MISSING_RETURN",
        `Function '${fn.declaration.name.text}' must return ${
          formatBrlIrType(fn.result)
        } on all paths.`,
        fn.declaration.span,
      ),
    );
  }
  return {
    id: fn.id,
    name: fn.declaration.name.text,
    params: fn.params,
    result: fn.result,
    locals: allLocals,
    blocks: [],
    span: fn.declaration.span,
  };
}

function checkBlock(block: BrlBlockStatement, context: CheckContext): boolean {
  const previous = context.locals;
  context.locals = new Map(previous);
  let terminated = false;
  for (const statement of block.statements) {
    if (terminated) {
      context.diagnostics.push(
        brlDiagnostic(
          "BRL_UNREACHABLE_CODE",
          "Statement is unreachable.",
          statement.span,
        ),
      );
      continue;
    }
    terminated = checkStatement(statement, context);
  }
  context.locals = previous;
  return terminated;
}

function checkStatement(
  statement: BrlStatement,
  context: CheckContext,
): boolean {
  switch (statement.kind) {
    case "block":
      return checkBlock(statement, context);
    case "let": {
      const value = checkExpression(statement.expression, context);
      const declared = statement.type
        ? typeFromNode(statement.type, context.records, context.diagnostics)
        : value.type;
      if (!sameBrlIrType(declared, value.type)) {
        context.diagnostics.push(
          brlDiagnostic(
            "BRL_TYPE_ASSIGNMENT",
            `Cannot initialize '${statement.name.text}' with ${
              formatBrlIrType(value.type)
            } as ${formatBrlIrType(declared)}.`,
            statement.span,
          ),
        );
      }
      const local: BrlIrLocal = {
        id: context.nextLocalId++,
        name: statement.name.text,
        type: declared ?? BRL_U32,
        initialized: true,
        span: statement.span,
      };
      context.locals.set(local.name, { local, initialized: true });
      context.allLocals.push(local);
      return false;
    }
    case "assign": {
      const binding = context.locals.get(statement.target.text);
      if (!binding) {
        context.diagnostics.push(
          brlDiagnostic(
            "BRL_RESOLVE_UNKNOWN_NAME",
            `Unknown local '${statement.target.text}'.`,
            statement.target.span,
          ),
        );
      }
      const value = checkExpression(statement.expression, context);
      if (binding && !sameBrlIrType(binding.local.type, value.type)) {
        context.diagnostics.push(
          brlDiagnostic(
            "BRL_TYPE_ASSIGNMENT",
            `Cannot assign ${formatBrlIrType(value.type)} to ${
              formatBrlIrType(binding.local.type)
            }.`,
            statement.span,
          ),
        );
      }
      if (binding) binding.initialized = true;
      return false;
    }
    case "if": {
      requireBool(checkExpression(statement.condition, context), context);
      const consequentReturns = checkBlock(statement.consequent, context);
      const alternateReturns = statement.alternate
        ? checkBlock(statement.alternate, context)
        : false;
      return consequentReturns && alternateReturns;
    }
    case "while":
      requireBool(checkExpression(statement.condition, context), context);
      context.loopDepth++;
      checkBlock(statement.body, context);
      context.loopDepth--;
      return false;
    case "for": {
      const start = checkExpression(statement.start, context);
      const end = checkExpression(statement.end, context);
      if (!isIntegerBrlIrType(start.type) || !isIntegerBrlIrType(end.type)) {
        context.diagnostics.push(
          brlDiagnostic(
            "BRL_TYPE_CONDITION",
            "For range bounds must be integers.",
            statement.span,
          ),
        );
      }
      const previous = context.locals;
      const local: BrlIrLocal = {
        id: context.nextLocalId++,
        name: statement.name.text,
        type: BRL_U32,
        initialized: true,
        span: statement.name.span,
      };
      context.locals = new Map(previous);
      context.locals.set(local.name, { local, initialized: true });
      context.allLocals.push(local);
      context.loopDepth++;
      checkBlock(statement.body, context);
      context.loopDepth--;
      context.locals = previous;
      return false;
    }
    case "return": {
      const value = statement.expression
        ? checkExpression(statement.expression, context).type
        : null;
      if (!sameBrlIrType(context.result, value)) {
        context.diagnostics.push(
          brlDiagnostic(
            "BRL_TYPE_RETURN",
            `Expected return ${formatBrlIrType(context.result)}, got ${
              formatBrlIrType(value)
            }.`,
            statement.span,
          ),
        );
      }
      return true;
    }
    case "expression":
      if (isTrapStatement(statement.expression)) {
        checkTrapStatement(statement.expression, context);
        return true;
      }
      checkExpression(statement.expression, context);
      return false;
    case "break":
    case "continue":
      if (context.loopDepth === 0) {
        context.diagnostics.push(
          brlDiagnostic(
            "BRL_TYPE_LOOP_CONTROL",
            `${statement.kind} is only valid inside a loop.`,
            statement.span,
          ),
        );
      }
      return false;
    case "missing":
      return false;
  }
}

function checkExpression(
  expression: BrlExpression,
  context: CheckContext,
): BrlIrExpression {
  switch (expression.kind) {
    case "integer":
      return {
        kind: "literal",
        type: BRL_U32,
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
      const local = context.locals.get(expression.name.text);
      if (local) {
        if (!local.initialized) {
          context.diagnostics.push(
            brlDiagnostic(
              "BRL_IR_USE_BEFORE_DEFINITION",
              `Local '${expression.name.text}' is not initialized.`,
              expression.span,
            ),
          );
        }
        return {
          kind: "local",
          local: local.local.id,
          type: local.local.type,
          span: expression.span,
        };
      }
      context.diagnostics.push(
        brlDiagnostic(
          "BRL_RESOLVE_UNKNOWN_NAME",
          `Unknown name '${expression.name.text}'.`,
          expression.name.span,
        ),
      );
      return {
        kind: "literal",
        type: BRL_U32,
        value: 0,
        span: expression.span,
      };
    }
    case "record": {
      const record = context.records.find((entry) =>
        entry.name === expression.name.text
      );
      const checkedFields = expression.fields.map((field) => ({
        syntax: field,
        value: checkExpression(field.expression, context),
      }));
      if (!record) {
        context.diagnostics.push(
          brlDiagnostic(
            "BRL_RESOLVE_UNKNOWN_NAME",
            `Unknown record '${expression.name.text}'.`,
            expression.name.span,
          ),
        );
        return {
          kind: "literal",
          type: BRL_U32,
          value: 0,
          span: expression.span,
        };
      }

      const seen = new Set<number>();
      const fields = [];
      for (const field of checkedFields) {
        const declaration = record.fields.find((entry) =>
          entry.name === field.syntax.name.text
        );
        if (!declaration) {
          context.diagnostics.push(
            brlDiagnostic(
              "BRL_TYPE_FIELD",
              `Unknown field '${field.syntax.name.text}'.`,
              field.syntax.name.span,
            ),
          );
          continue;
        }
        if (seen.has(declaration.id)) {
          context.diagnostics.push(
            brlDiagnostic(
              "BRL_TYPE_FIELD",
              `Duplicate field '${field.syntax.name.text}'.`,
              field.syntax.name.span,
            ),
          );
          continue;
        }
        seen.add(declaration.id);
        if (!sameBrlIrType(declaration.type, field.value.type)) {
          context.diagnostics.push(
            brlDiagnostic(
              "BRL_TYPE_ASSIGNMENT",
              `Cannot initialize field '${declaration.name}' with ${
                formatBrlIrType(field.value.type)
              } as ${formatBrlIrType(declaration.type)}.`,
              field.syntax.span,
            ),
          );
        }
        fields.push({
          fieldId: declaration.id,
          value: field.value,
          span: field.syntax.span,
        });
      }
      for (const field of record.fields) {
        if (!seen.has(field.id)) {
          context.diagnostics.push(
            brlDiagnostic(
              "BRL_TYPE_FIELD",
              `Missing field '${field.name}'.`,
              expression.span,
            ),
          );
        }
      }
      return {
        kind: "record",
        type: { kind: "record", id: record.id, name: record.name },
        fields,
        span: expression.span,
      };
    }
    case "unary": {
      const operand = checkExpression(expression.operand, context);
      if (expression.operator !== "!") {
        context.diagnostics.push(
          brlDiagnostic(
            "BRL_TYPE_UNSUPPORTED",
            `Unsupported unary operator '${expression.operator}'.`,
            expression.span,
          ),
        );
      }
      if (!sameBrlIrType(operand.type, BRL_BOOL)) {
        context.diagnostics.push(
          brlDiagnostic(
            "BRL_TYPE_UNSUPPORTED",
            `Operator '${expression.operator}' requires a bool operand.`,
            expression.span,
          ),
        );
      }
      return {
        kind: "unary",
        operator: expression.operator,
        operand,
        type: BRL_BOOL,
        span: expression.span,
      };
    }
    case "binary": {
      const left = checkExpression(expression.left, context);
      const right = checkExpression(expression.right, context);
      const comparison = ["==", "!=", "<", "<=", ">", ">="].includes(
        expression.operator,
      );
      const logical = expression.operator === "&&" ||
        expression.operator === "||";
      if (!sameBrlIrType(left.type, right.type)) {
        context.diagnostics.push(
          brlDiagnostic(
            "BRL_TYPE_ASSIGNMENT",
            `Binary operands must have the same type, got ${
              formatBrlIrType(left.type)
            } and ${formatBrlIrType(right.type)}.`,
            expression.span,
          ),
        );
      }
      if (logical) {
        if (!sameBrlIrType(left.type, BRL_BOOL)) {
          context.diagnostics.push(
            brlDiagnostic(
              "BRL_TYPE_UNSUPPORTED",
              `Operator '${expression.operator}' requires bool operands.`,
              expression.span,
            ),
          );
        }
      } else if (!comparison && !isIntegerBrlIrType(left.type)) {
        context.diagnostics.push(
          brlDiagnostic(
            "BRL_TYPE_UNSUPPORTED",
            `Operator '${expression.operator}' requires integer operands.`,
            expression.span,
          ),
        );
      }
      return {
        kind: "binary",
        operator: expression.operator,
        left,
        right,
        type: comparison || logical ? BRL_BOOL : left.type,
        span: expression.span,
      };
    }
    case "call": {
      const args = expression.args.map((arg) => checkExpression(arg, context));
      if (expression.callee.kind !== "name") {
        context.diagnostics.push(
          brlDiagnostic(
            "BRL_TYPE_CALL_TARGET",
            "Call target must be a function name.",
            expression.span,
          ),
        );
        return {
          kind: "literal",
          type: BRL_U32,
          value: 0,
          span: expression.span,
        };
      }
      const callee = expression.callee;
      const intrinsic = checkIntrinsicCall(callee.name.text, args, expression);
      if (intrinsic) {
        if (intrinsic.diagnostic) {
          context.diagnostics.push(intrinsic.diagnostic);
        }
        return {
          kind: "literal",
          type: intrinsic.type,
          value: 0,
          span: expression.span,
        };
      }
      const fn = context.functions.find((candidate) =>
        candidate.declaration.name.text === callee.name.text
      );
      if (!fn) {
        context.diagnostics.push(
          brlDiagnostic(
            "BRL_RESOLVE_UNKNOWN_NAME",
            `Unknown function '${callee.name.text}'.`,
            callee.span,
          ),
        );
        return {
          kind: "literal",
          type: BRL_U32,
          value: 0,
          span: expression.span,
        };
      }
      for (
        let index = 0;
        index < Math.max(fn.params.length, args.length);
        index++
      ) {
        if (
          !fn.params[index] || !args[index] ||
          !sameBrlIrType(fn.params[index].type, args[index].type)
        ) {
          context.diagnostics.push(
            brlDiagnostic(
              "BRL_TYPE_INTRINSIC",
              `Argument ${index} for '${fn.declaration.name.text}' has the wrong type.`,
              expression.span,
            ),
          );
        }
      }
      return {
        kind: "call",
        functionId: fn.id,
        args,
        type: fn.result ?? BRL_U32,
        span: expression.span,
      };
    }
    case "field": {
      const receiver = checkExpression(expression.receiver, context);
      const receiverType = receiver.type;
      if (receiverType.kind === "span" && expression.field.text === "length") {
        return {
          kind: "field",
          receiver,
          fieldId: -1,
          type: BRL_U32,
          span: expression.span,
        };
      }
      if (receiverType.kind !== "record") {
        context.diagnostics.push(
          brlDiagnostic(
            "BRL_TYPE_FIELD",
            "Field access requires a record value.",
            expression.span,
          ),
        );
        return {
          kind: "literal",
          type: BRL_U32,
          value: 0,
          span: expression.span,
        };
      }
      const record = context.records.find((entry) =>
        entry.id === receiverType.id
      );
      const field = record?.fields.find((entry) =>
        entry.name === expression.field.text
      );
      if (!field) {
        context.diagnostics.push(
          brlDiagnostic(
            "BRL_TYPE_FIELD",
            `Unknown field '${expression.field.text}'.`,
            expression.field.span,
          ),
        );
        return {
          kind: "literal",
          type: BRL_U32,
          value: 0,
          span: expression.span,
        };
      }
      return {
        kind: "field",
        receiver,
        fieldId: field.id,
        type: field.type,
        span: expression.span,
      };
    }
    case "index": {
      const receiver = checkExpression(expression.receiver, context);
      const index = checkExpression(expression.index, context);
      if (!isIntegerBrlIrType(index.type)) {
        context.diagnostics.push(
          brlDiagnostic(
            "BRL_TYPE_INDEX",
            "Index expression must be an integer.",
            expression.index.span,
          ),
        );
      }
      if (
        receiver.type.kind !== "array" && receiver.type.kind !== "span" &&
        receiver.type.kind !== "vec"
      ) {
        context.diagnostics.push(
          brlDiagnostic(
            "BRL_TYPE_INDEX",
            "Indexing requires an array, span, or vector.",
            expression.span,
          ),
        );
        return {
          kind: "literal",
          type: BRL_U32,
          value: 0,
          span: expression.span,
        };
      }
      return {
        kind: "index",
        receiver,
        index,
        type: receiver.type.element,
        span: expression.span,
      };
    }
    case "cast": {
      const value = checkExpression(expression.expression, context);
      const type = typeFromNode(
        expression.type,
        context.records,
        context.diagnostics,
      );
      if (!isLegalCast(value.type, type)) {
        context.diagnostics.push(
          brlDiagnostic(
            "BRL_TYPE_CAST",
            `Cannot cast ${formatBrlIrType(value.type)} to ${
              formatBrlIrType(type)
            }.`,
            expression.span,
          ),
        );
      }
      return { kind: "cast", expression: value, type, span: expression.span };
    }
    case "missing":
      return {
        kind: "literal",
        type: BRL_U32,
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

function checkTrapStatement(
  expression: BrlExpression,
  context: CheckContext,
): void {
  if (expression.kind !== "call") return;
  for (const arg of expression.args) checkExpression(arg, context);
  if (expression.args.length !== 0) {
    context.diagnostics.push(
      brlDiagnostic(
        "BRL_TYPE_INTRINSIC",
        "Intrinsic 'trap' does not accept arguments.",
        expression.span,
      ),
    );
  }
}

function checkIntrinsicCall(
  name: string,
  args: readonly BrlIrExpression[],
  expression: BrlExpression,
): { readonly type: BrlIrType; readonly diagnostic?: BrlDiagnostic } | null {
  switch (name) {
    case "span_len":
      return checkLengthIntrinsic(name, "span", args, expression);
    case "vec_len":
      return checkLengthIntrinsic(name, "vec", args, expression);
    case "trap":
      return {
        type: BRL_U32,
        diagnostic: brlDiagnostic(
          "BRL_TYPE_INTRINSIC",
          "Intrinsic 'trap' may only be used as a statement.",
          expression.span,
        ),
      };
    case "vec_push":
      return {
        type: BRL_U32,
        diagnostic: brlDiagnostic(
          "BRL_TYPE_INTRINSIC",
          "Intrinsic 'vec_push' is not supported by the Stage-0 IR backend.",
          expression.span,
        ),
      };
    default:
      return null;
  }
}

function checkLengthIntrinsic(
  name: string,
  kind: "span" | "vec",
  args: readonly BrlIrExpression[],
  expression: BrlExpression,
): { readonly type: BrlIrType; readonly diagnostic?: BrlDiagnostic } {
  if (args.length !== 1 || args[0]?.type.kind !== kind) {
    return {
      type: BRL_U32,
      diagnostic: brlDiagnostic(
        "BRL_TYPE_INTRINSIC",
        `Intrinsic '${name}' expects one ${kind} argument.`,
        expression.span,
      ),
    };
  }
  return { type: BRL_U32 };
}

function requireBool(expression: BrlIrExpression, context: CheckContext): void {
  if (!sameBrlIrType(expression.type, BRL_BOOL)) {
    context.diagnostics.push(
      brlDiagnostic(
        "BRL_TYPE_CONDITION",
        `Condition must be bool, got ${formatBrlIrType(expression.type)}.`,
        expression.span,
      ),
    );
  }
}

function typeFromNode(
  node: BrlTypeNode,
  records: readonly BrlIrRecord[],
  diagnostics: BrlDiagnostic[],
): BrlIrType {
  switch (node.kind) {
    case "scalar":
      return { kind: "scalar", name: node.name };
    case "array":
      return {
        kind: "array",
        element: typeFromNode(node.element, records, diagnostics),
        length: node.length,
      };
    case "span":
    case "vec":
      return {
        kind: node.kind,
        element: typeFromNode(node.element, records, diagnostics),
      };
    case "named": {
      const record = records.find((entry) => entry.name === node.name.text);
      if (!record) {
        diagnostics.push(
          brlDiagnostic(
            "BRL_RESOLVE_UNKNOWN_NAME",
            `Unknown type '${node.name.text}'.`,
            node.name.span,
          ),
        );
        return BRL_U32;
      }
      return { kind: "record", id: record.id, name: record.name };
    }
    case "missing":
      return BRL_U32;
  }
}

function isLegalCast(from: BrlIrType, to: BrlIrType): boolean {
  if (sameBrlIrType(from, to)) return true;
  if (from.kind !== "scalar" || to.kind !== "scalar") return false;
  if (from.name === "bool") return isIntegerBrlIrType(to);
  if (to.name === "bool") return isIntegerBrlIrType(from);
  return isIntegerBrlIrType(from) && isIntegerBrlIrType(to);
}
