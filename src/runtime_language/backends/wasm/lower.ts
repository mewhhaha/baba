import type {
  BrlIrBlock,
  BrlIrExpression,
  BrlIrFunction,
  BrlIrInstruction,
  BrlIrLocal,
  BrlIrProgram,
  BrlIrRecord,
  BrlIrTerminator,
  BrlIrType,
} from "../../ir.ts";
import { formatBrlIrType } from "../../ir.ts";
import { verifyRuntimeIr } from "../../verify.ts";
import type {
  WasmFunctionIr,
  WasmInstructionIr,
  WasmLocalIr,
  WasmModuleIr,
  WasmValueType,
} from "./wasm_ir.ts";

export interface BrlWasmLowerOptions {
  readonly exportFunctions?: boolean;
}

export class BrlWasmLowerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrlWasmLowerError";
  }
}

export function lowerBrlIrToWasm(
  program: BrlIrProgram,
  options: BrlWasmLowerOptions = {},
): WasmModuleIr {
  const diagnostics = [
    ...program.diagnostics.filter((diagnostic) =>
      diagnostic.severity !== "warning"
    ),
    ...verifyRuntimeIr(program),
  ];
  if (diagnostics.length > 0) {
    const first = diagnostics[0];
    throw new BrlWasmLowerError(
      `Cannot lower unverified BRL IR to Wasm: ${first.code}: ${first.message}`,
    );
  }

  const functionIndexes = new Map(
    program.functions.map((fn, index) => [fn.id, index]),
  );
  return {
    ...(programNeedsMemory(program)
      ? { memory: { minPages: 1, exportName: "memory" } }
      : {}),
    functions: program.functions.map((fn) =>
      lowerFunction(fn, program.records, functionIndexes, options)
    ),
  };
}

function lowerFunction(
  fn: BrlIrFunction,
  records: readonly BrlIrRecord[],
  functionIndexes: ReadonlyMap<number, number>,
  options: BrlWasmLowerOptions,
): WasmFunctionIr {
  const entry = fn.blocks[0];
  if (!entry) {
    throw new BrlWasmLowerError(`Function '${fn.name}' has no terminator.`);
  }

  const paramIds = new Set(fn.params.map((param) => param.id));
  const localLayouts = new Map<number, LocalLayout>();
  const wasmParams: WasmLocalIr[] = [];
  for (const param of fn.params) {
    localLayouts.set(param.id, appendValueLayout(wasmParams, param, records));
  }
  const wasmLocals: WasmLocalIr[] = [];
  for (const local of fn.locals) {
    if (paramIds.has(local.id)) continue;
    localLayouts.set(
      local.id,
      appendValueLayout(wasmLocals, local, records, wasmParams.length),
    );
  }

  const context: LowerContext = {
    blocks: new Map(fn.blocks.map((block) => [block.id, block])),
    functionIndexes,
    localLayouts,
    wasmLocals,
    loopStack: [],
    labelDepth: 0,
    nextTempId: 0,
  };
  const body = lowerBlock(entry.id, null, context);

  return {
    name: fn.name,
    params: wasmParams,
    results: fn.result ? typeToWasmValues(fn.result, records) : [],
    locals: context.wasmLocals,
    body,
    exportName: options.exportFunctions === false ? undefined : fn.name,
  };
}

interface LowerContext {
  readonly blocks: ReadonlyMap<number, BrlIrBlock>;
  readonly functionIndexes: ReadonlyMap<number, number>;
  readonly localLayouts: ReadonlyMap<number, LocalLayout>;
  readonly wasmLocals: WasmLocalIr[];
  readonly loopStack: LoopContext[];
  labelDepth: number;
  nextTempId: number;
}

type LocalLayout =
  | { readonly kind: "scalar"; readonly index: number }
  | {
    readonly kind: "span" | "vec";
    readonly pointer: number;
    readonly length: number;
  }
  | {
    readonly kind: "record";
    readonly fields: ReadonlyMap<number, LocalLayout>;
  };

interface LoopContext {
  readonly conditionTarget: number;
  readonly breakTarget: number;
}

function lowerBlock(
  blockId: number,
  stopTarget: number | null,
  context: LowerContext,
): readonly WasmInstructionIr[] {
  if (blockId === stopTarget) return [];
  const block = context.blocks.get(blockId);
  if (!block) {
    throw new BrlWasmLowerError(`Unknown BRL block id ${blockId}.`);
  }
  if (!block.terminator) {
    throw new BrlWasmLowerError(`BRL block ${blockId} has no terminator.`);
  }
  const body: WasmInstructionIr[] = [];
  for (const instruction of block.instructions) {
    body.push(...lowerInstruction(instruction, context));
  }
  body.push(
    ...lowerTerminator(block.id, block.terminator, stopTarget, context),
  );
  return body;
}

function lowerInstruction(
  instruction: BrlIrInstruction,
  context: LowerContext,
): readonly WasmInstructionIr[] {
  switch (instruction.kind) {
    case "assign":
      return lowerAssignInstruction(instruction, context);
    case "evaluate":
      return [...lowerExpression(instruction.value, context), { kind: "drop" }];
    case "trap":
      return [{ kind: "unreachable" }];
  }
}

function lowerAssignInstruction(
  instruction: Extract<BrlIrInstruction, { readonly kind: "assign" }>,
  context: LowerContext,
): readonly WasmInstructionIr[] {
  const target = requiredLocalLayout(instruction.local, context);
  if (target.kind === "scalar") {
    return [
      ...lowerExpression(instruction.value, context),
      { kind: "local.set", index: target.index },
    ];
  }
  const source = layoutForExpression(instruction.value, context);
  const values = source
    ? lowerLayoutValues(source)
    : lowerAggregateValueExpression(instruction.value, context);
  if (!values) {
    throw new BrlWasmLowerError(
      `Cannot assign non-layout expression to aggregate local ${instruction.local}.`,
    );
  }
  return [
    ...values,
    ...layoutScalarIndexes(target).toReversed().map((index) => ({
      kind: "local.set" as const,
      index,
    })),
  ];
}

function lowerTerminator(
  blockId: number,
  terminator: BrlIrTerminator,
  stopTarget: number | null,
  context: LowerContext,
): readonly WasmInstructionIr[] {
  switch (terminator.kind) {
    case "return":
      return terminator.value
        ? [...lowerReturnValue(terminator.value, context), { kind: "return" }]
        : [{ kind: "return" }];
    case "jump":
      if (context.loopStack.length > 0) {
        const loop = context.loopStack[context.loopStack.length - 1];
        if (terminator.target === loop.breakTarget) {
          return [{ kind: "br", depth: context.labelDepth + 1 }];
        }
        if (terminator.target === loop.conditionTarget) {
          return [{ kind: "br", depth: context.labelDepth }];
        }
        if (pathJumpsTo(terminator.target, loop.conditionTarget, context)) {
          return [
            ...lowerBlock(terminator.target, loop.conditionTarget, context),
            { kind: "br", depth: context.labelDepth },
          ];
        }
      }
      return terminator.target === stopTarget
        ? []
        : lowerBlock(terminator.target, stopTarget, context);
    case "branch": {
      if (
        context.loopStack.length === 0 &&
        hasPathTo(terminator.consequent, blockId, context)
      ) {
        context.loopStack.push({
          conditionTarget: blockId,
          breakTarget: terminator.alternate,
        });
        const previousLabelDepth = context.labelDepth;
        context.labelDepth = 0;
        const loopBody = lowerBlock(terminator.consequent, null, context);
        context.labelDepth = previousLabelDepth;
        context.loopStack.pop();
        return [
          {
            kind: "block",
            body: [{
              kind: "loop",
              body: [
                ...lowerExpression(terminator.condition, context),
                { kind: "i32.eqz" },
                { kind: "br_if", depth: 1 },
                ...loopBody,
              ],
            }],
          },
          ...lowerBlock(terminator.alternate, stopTarget, context),
        ];
      }
      if (
        blockReturns(terminator.consequent, context) &&
        blockReturns(terminator.alternate, context)
      ) {
        return [
          ...lowerExpression(terminator.condition, context),
          {
            kind: "if",
            consequent: lowerIfArm(terminator.consequent, null, context),
            alternate: lowerIfArm(terminator.alternate, null, context),
          },
          { kind: "unreachable" },
        ];
      }
      const join = commonImmediateJumpTarget(terminator, context);
      if (join === null) {
        if (context.loopStack.length > 0) {
          return [
            ...lowerExpression(terminator.condition, context),
            {
              kind: "if",
              consequent: lowerIfArm(terminator.consequent, null, context),
              alternate: lowerIfArm(terminator.alternate, null, context),
            },
            { kind: "unreachable" },
          ];
        } else {
          throw new BrlWasmLowerError(
            "BRL CFG branch does not match a structured if/join shape.",
          );
        }
      }
      return [
        ...lowerExpression(terminator.condition, context),
        {
          kind: "if",
          consequent: lowerIfArm(terminator.consequent, join, context),
          alternate: lowerIfArm(terminator.alternate, join, context),
        },
        ...lowerBlock(join, stopTarget, context),
      ];
    }
  }
}

function lowerIfArm(
  blockId: number,
  stopTarget: number | null,
  context: LowerContext,
): readonly WasmInstructionIr[] {
  context.labelDepth++;
  try {
    return lowerBlock(blockId, stopTarget, context);
  } finally {
    context.labelDepth--;
  }
}

function blockReturns(blockId: number, context: LowerContext): boolean {
  return context.blocks.get(blockId)?.terminator?.kind === "return";
}

function pathJumpsTo(
  blockId: number,
  target: number,
  context: LowerContext,
): boolean {
  let current = context.blocks.get(blockId);
  const visited = new Set<number>();
  while (current) {
    if (visited.has(current.id)) return false;
    visited.add(current.id);
    const terminator = current.terminator;
    if (terminator?.kind !== "jump") return false;
    if (terminator.target === target) return true;
    current = context.blocks.get(terminator.target);
  }
  return false;
}

function hasPathTo(
  blockId: number,
  target: number,
  context: LowerContext,
  visited: Set<number> = new Set(),
): boolean {
  if (blockId === target) return true;
  if (visited.has(blockId)) return false;
  visited.add(blockId);
  const terminator = context.blocks.get(blockId)?.terminator;
  switch (terminator?.kind) {
    case "jump":
      return hasPathTo(terminator.target, target, context, visited);
    case "branch":
      return hasPathTo(terminator.consequent, target, context, visited) ||
        hasPathTo(terminator.alternate, target, context, visited);
    case "return":
    case undefined:
      return false;
  }
}

function commonImmediateJumpTarget(
  terminator: Extract<BrlIrTerminator, { readonly kind: "branch" }>,
  context: LowerContext,
): number | null {
  const consequent = context.blocks.get(terminator.consequent);
  const alternate = context.blocks.get(terminator.alternate);
  const consequentTarget = consequent?.terminator?.kind === "jump"
    ? consequent.terminator.target
    : null;
  const alternateTarget = alternate?.terminator?.kind === "jump"
    ? alternate.terminator.target
    : null;
  if (consequentTarget !== null && consequentTarget === alternateTarget) {
    return consequentTarget;
  }
  if (consequent?.terminator?.kind === "return" && alternateTarget !== null) {
    return alternateTarget;
  }
  if (alternate?.terminator?.kind === "return" && consequentTarget !== null) {
    return consequentTarget;
  }
  return null;
}

function lowerExpression(
  expression: BrlIrExpression,
  context: LowerContext,
): readonly WasmInstructionIr[] {
  switch (expression.kind) {
    case "literal":
      return [{
        kind: "i32.const",
        value: expression.value === true
          ? 1
          : expression.value === false
          ? 0
          : expression.value,
      }];
    case "local":
      return lowerLocalExpression(expression, context);
    case "record":
      return lowerRecordExpression(expression, context);
    case "unary":
      return lowerUnaryExpression(expression, context);
    case "binary":
      return lowerBinaryExpression(expression, context);
    case "call": {
      const functionIndex = context.functionIndexes.get(expression.functionId);
      if (functionIndex === undefined) {
        throw new BrlWasmLowerError(
          `Unknown BRL function id ${expression.functionId}.`,
        );
      }
      return [
        ...expression.args.flatMap((arg) => lowerCallArgument(arg, context)),
        { kind: "call", functionIndex },
      ];
    }
    case "cast":
      return [
        ...lowerExpression(expression.expression, context),
        ...castCoercion(expression.type),
      ];
    case "field":
      return lowerFieldExpression(expression, context);
    case "index":
      return lowerIndexExpression(expression, context);
  }
}

function lowerLocalExpression(
  expression: Extract<BrlIrExpression, { readonly kind: "local" }>,
  context: LowerContext,
): readonly WasmInstructionIr[] {
  const layout = requiredLocalLayout(expression.local, context);
  if (layout.kind !== "scalar") {
    throw new BrlWasmLowerError(
      `Cannot lower aggregate local ${expression.local} as a scalar value.`,
    );
  }
  return [{ kind: "local.get", index: layout.index }];
}

function lowerFieldExpression(
  expression: Extract<BrlIrExpression, { readonly kind: "field" }>,
  context: LowerContext,
): readonly WasmInstructionIr[] {
  if (expression.fieldId === -1) {
    const layout = layoutForExpression(expression.receiver, context);
    if (
      !layout ||
      (layout.kind !== "span" && layout.kind !== "vec") ||
      layout.kind !== expression.receiver.type.kind
    ) {
      throw new BrlWasmLowerError(
        `${
          formatBrlIrType(expression.receiver.type)
        } length uses incompatible Wasm layout.`,
      );
    }
    return [{ kind: "local.get", index: layout.length }];
  }

  const layout = layoutForExpression(expression, context);
  if (layout?.kind === "scalar") {
    return [{ kind: "local.get", index: layout.index }];
  }
  if (layout) {
    throw new BrlWasmLowerError(
      `Record field ${expression.fieldId} is not a scalar Wasm value.`,
    );
  }
  throw new BrlWasmLowerError(
    `Expression 'field' needs record layout lowering before Wasm emission.`,
  );
}

function lowerIndexExpression(
  expression: Extract<BrlIrExpression, { readonly kind: "index" }>,
  context: LowerContext,
): readonly WasmInstructionIr[] {
  const layout = layoutForExpression(expression.receiver, context);
  if (
    !layout ||
    (layout.kind !== "span" && layout.kind !== "vec") ||
    (expression.receiver.type.kind !== "span" &&
      expression.receiver.type.kind !== "vec")
  ) {
    throw new BrlWasmLowerError(
      `Expression 'index' needs memory/layout lowering before Wasm emission.`,
    );
  }
  if (layout.kind !== expression.receiver.type.kind) {
    throw new BrlWasmLowerError(
      `${
        formatBrlIrType(expression.receiver.type)
      } index uses incompatible Wasm layout.`,
    );
  }
  const indexLocal = tempLocal(context);
  const element = expression.receiver.type.element;
  return [
    ...lowerExpression(expression.index, context),
    { kind: "local.tee", index: indexLocal },
    { kind: "local.get", index: layout.length },
    { kind: "i32.ge_u" },
    {
      kind: "if",
      consequent: [{ kind: "unreachable" }],
    },
    { kind: "local.get", index: layout.pointer },
    { kind: "local.get", index: indexLocal },
    ...scaleIndex(element),
    { kind: "i32.add" },
    memoryLoad(element),
    ...castCoercion(expression.type),
  ];
}

function lowerCallArgument(
  expression: BrlIrExpression,
  context: LowerContext,
): readonly WasmInstructionIr[] {
  const layout = layoutForExpression(expression, context);
  if (layout) return lowerLayoutValues(layout);
  const values = lowerAggregateValueExpression(expression, context);
  if (values) return values;
  return lowerExpression(expression, context);
}

function lowerReturnValue(
  expression: BrlIrExpression,
  context: LowerContext,
): readonly WasmInstructionIr[] {
  const layout = layoutForExpression(expression, context);
  if (layout) return lowerLayoutValues(layout);
  const values = lowerAggregateValueExpression(expression, context);
  if (values) return values;
  return lowerExpression(expression, context);
}

function lowerAggregateValueExpression(
  expression: BrlIrExpression,
  context: LowerContext,
): readonly WasmInstructionIr[] | null {
  if (expression.type.kind === "scalar") return null;
  if (expression.kind === "record") {
    return lowerRecordExpression(expression, context);
  }
  if (expression.kind === "call") return lowerExpression(expression, context);
  return null;
}

function lowerRecordExpression(
  expression: Extract<BrlIrExpression, { readonly kind: "record" }>,
  context: LowerContext,
): readonly WasmInstructionIr[] {
  return expression.fields.flatMap((field) =>
    lowerReturnValue(field.value, context)
  );
}

function layoutForExpression(
  expression: BrlIrExpression,
  context: LowerContext,
): LocalLayout | null {
  if (expression.kind === "local" && expression.type.kind !== "scalar") {
    return requiredLocalLayout(expression.local, context);
  }
  if (
    expression.kind === "field" && expression.receiver.type.kind === "record"
  ) {
    const receiver = layoutForExpression(expression.receiver, context);
    if (!receiver) return null;
    if (receiver.kind !== "record") {
      throw new BrlWasmLowerError(
        "Record field uses incompatible Wasm layout.",
      );
    }
    const field = receiver.fields.get(expression.fieldId);
    if (!field) {
      throw new BrlWasmLowerError(
        `Record layout has no field ${expression.fieldId}.`,
      );
    }
    return field;
  }
  return null;
}

function lowerLayoutValues(layout: LocalLayout): readonly WasmInstructionIr[] {
  switch (layout.kind) {
    case "scalar":
      return [{ kind: "local.get", index: layout.index }];
    case "span":
    case "vec":
      return [
        { kind: "local.get", index: layout.pointer },
        { kind: "local.get", index: layout.length },
      ];
    case "record":
      return [...layout.fields.values()].flatMap(lowerLayoutValues);
  }
}

function layoutScalarIndexes(layout: LocalLayout): readonly number[] {
  switch (layout.kind) {
    case "scalar":
      return [layout.index];
    case "span":
    case "vec":
      return [layout.pointer, layout.length];
    case "record":
      return [...layout.fields.values()].flatMap(layoutScalarIndexes);
  }
}

function lowerUnaryExpression(
  expression: Extract<BrlIrExpression, { readonly kind: "unary" }>,
  context: LowerContext,
): readonly WasmInstructionIr[] {
  switch (expression.operator) {
    case "!":
      return [
        ...lowerExpression(expression.operand, context),
        { kind: "i32.eqz" },
      ];
    default:
      throw new BrlWasmLowerError(
        `Unsupported BRL unary operator '${expression.operator}'.`,
      );
  }
}

function lowerBinaryExpression(
  expression: Extract<BrlIrExpression, { readonly kind: "binary" }>,
  context: LowerContext,
): readonly WasmInstructionIr[] {
  const left = lowerExpression(expression.left, context);
  const right = lowerExpression(expression.right, context);
  const checked = checkedBinaryExpression(expression, left, right, context);
  if (checked) return checked;
  const operator = binaryOpcode(expression);
  return isComparisonOperator(expression.operator)
    ? [...left, ...right, operator]
    : [...left, ...right, operator, ...castCoercion(expression.type)];
}

function checkedBinaryExpression(
  expression: Extract<BrlIrExpression, { readonly kind: "binary" }>,
  left: readonly WasmInstructionIr[],
  right: readonly WasmInstructionIr[],
  context: LowerContext,
): readonly WasmInstructionIr[] | null {
  const signed = expression.left.type.kind === "scalar" &&
    expression.left.type.name === "i32";
  switch (expression.operator) {
    case "/":
    case "%": {
      const rightLocal = tempLocal(context);
      return [
        ...left,
        ...right,
        { kind: "local.tee", index: rightLocal },
        { kind: "i32.eqz" },
        {
          kind: "if",
          consequent: [{ kind: "unreachable" }],
        },
        { kind: "local.get", index: rightLocal },
        {
          kind: expression.operator === "/"
            ? signed ? "i32.div_s" : "i32.div_u"
            : signed
            ? "i32.rem_s"
            : "i32.rem_u",
        },
        ...castCoercion(expression.type),
      ];
    }
    case "<<":
    case ">>": {
      const rightLocal = tempLocal(context);
      return [
        ...left,
        ...right,
        { kind: "local.tee", index: rightLocal },
        { kind: "i32.const", value: scalarBitWidth(expression.left.type) },
        { kind: "i32.ge_u" },
        {
          kind: "if",
          consequent: [{ kind: "unreachable" }],
        },
        { kind: "local.get", index: rightLocal },
        {
          kind: expression.operator === "<<"
            ? "i32.shl"
            : signed
            ? "i32.shr_s"
            : "i32.shr_u",
        },
        ...castCoercion(expression.type),
      ];
    }
    default:
      return null;
  }
}

function binaryOpcode(
  expression: Extract<BrlIrExpression, { readonly kind: "binary" }>,
): WasmInstructionIr {
  const signed = expression.left.type.kind === "scalar" &&
    expression.left.type.name === "i32";
  switch (expression.operator) {
    case "+":
      return { kind: "i32.add" };
    case "-":
      return { kind: "i32.sub" };
    case "*":
      return { kind: "i32.mul" };
    case "&&":
      return { kind: "i32.and" };
    case "||":
      return { kind: "i32.or" };
    case "==":
      return { kind: "i32.eq" };
    case "!=":
      return { kind: "i32.ne" };
    case "<":
      return { kind: signed ? "i32.lt_s" : "i32.lt_u" };
    case "<=":
      return { kind: signed ? "i32.le_s" : "i32.le_u" };
    case ">":
      return { kind: signed ? "i32.gt_s" : "i32.gt_u" };
    case ">=":
      return { kind: signed ? "i32.ge_s" : "i32.ge_u" };
    default:
      throw new BrlWasmLowerError(
        `Unsupported BRL binary operator '${expression.operator}'.`,
      );
  }
}

function isComparisonOperator(operator: string): boolean {
  return ["==", "!=", "<", "<=", ">", ">="].includes(operator);
}

function castCoercion(type: BrlIrType): readonly WasmInstructionIr[] {
  if (type.kind !== "scalar") {
    throw new BrlWasmLowerError(
      `Cannot lower aggregate cast to ${formatBrlIrType(type)}.`,
    );
  }
  switch (type.name) {
    case "bool":
      return [{ kind: "i32.const", value: 0 }, { kind: "i32.ne" }];
    case "u8":
      return [{ kind: "i32.const", value: 0xff }, { kind: "i32.and" }];
    case "u16":
      return [{ kind: "i32.const", value: 0xffff }, { kind: "i32.and" }];
    case "u32":
    case "i32":
      return [];
  }
}

function typeToWasm(type: BrlIrType): WasmValueType {
  if (type.kind !== "scalar") {
    throw new BrlWasmLowerError(
      `Cannot lower ${formatBrlIrType(type)} to scalar Wasm value.`,
    );
  }
  return "i32";
}

function typeToWasmValues(
  type: BrlIrType,
  records: readonly BrlIrRecord[],
): readonly WasmValueType[] {
  switch (type.kind) {
    case "scalar":
      return [typeToWasm(type)];
    case "span":
    case "vec":
      return ["i32", "i32"];
    case "record": {
      const record = records.find((entry) => entry.id === type.id);
      if (!record) {
        throw new BrlWasmLowerError(
          `Cannot lower unknown record ${formatBrlIrType(type)}.`,
        );
      }
      return record.fields.flatMap((field) =>
        typeToWasmValues(field.type, records)
      );
    }
    case "array":
      throw new BrlWasmLowerError(
        `Cannot lower ${formatBrlIrType(type)} to Wasm value results.`,
      );
  }
}

function appendValueLayout(
  locals: WasmLocalIr[],
  value: BrlIrLocal,
  records: readonly BrlIrRecord[],
  indexOffset = 0,
): LocalLayout {
  switch (value.type.kind) {
    case "scalar": {
      const index = indexOffset + locals.length;
      locals.push({ name: value.name, type: typeToWasm(value.type) });
      return { kind: "scalar", index };
    }
    case "span":
    case "vec": {
      const pointer = indexOffset + locals.length;
      locals.push({ name: `${value.name}_ptr`, type: "i32" });
      const length = indexOffset + locals.length;
      locals.push({ name: `${value.name}_len`, type: "i32" });
      return { kind: value.type.kind, pointer, length };
    }
    case "record": {
      const type = value.type;
      const record = records.find((entry) => entry.id === type.id);
      if (!record) {
        throw new BrlWasmLowerError(
          `Cannot lower unknown record ${formatBrlIrType(type)}.`,
        );
      }
      const fields = new Map<number, LocalLayout>();
      for (const field of record.fields) {
        fields.set(
          field.id,
          appendValueLayout(
            locals,
            {
              ...value,
              name: `${value.name}_${field.name}`,
              type: field.type,
              span: field.span,
            },
            records,
            indexOffset,
          ),
        );
      }
      return { kind: "record", fields };
    }
    default:
      throw new BrlWasmLowerError(
        `Cannot lower ${formatBrlIrType(value.type)} to Wasm local layout.`,
      );
  }
}

function programNeedsMemory(program: BrlIrProgram): boolean {
  return program.functions.some((fn) =>
    fn.params.some((param) => typeNeedsMemory(param.type, program.records)) ||
    fn.locals.some((local) => typeNeedsMemory(local.type, program.records))
  );
}

function typeNeedsMemory(
  type: BrlIrType,
  records: readonly BrlIrRecord[],
): boolean {
  switch (type.kind) {
    case "span":
    case "vec":
      return true;
    case "record":
      return records.find((record) => record.id === type.id)?.fields.some((
        field,
      ) => typeNeedsMemory(field.type, records)) ?? false;
    case "array":
      return typeNeedsMemory(type.element, records);
    case "scalar":
      return false;
  }
}

function scaleIndex(type: BrlIrType): readonly WasmInstructionIr[] {
  const width = memoryWidth(type);
  switch (width) {
    case 1:
      return [];
    case 2:
      return [{ kind: "i32.const", value: 1 }, { kind: "i32.shl" }];
    case 4:
      return [{ kind: "i32.const", value: 2 }, { kind: "i32.shl" }];
    default:
      throw new BrlWasmLowerError(
        `Cannot scale memory index for ${formatBrlIrType(type)}.`,
      );
  }
}

function memoryLoad(type: BrlIrType): WasmInstructionIr {
  if (type.kind !== "scalar") {
    throw new BrlWasmLowerError(
      `Cannot load non-scalar ${formatBrlIrType(type)} from Wasm memory.`,
    );
  }
  switch (type.name) {
    case "bool":
    case "u8":
      return { kind: "i32.load8_u" };
    case "u16":
      return { kind: "i32.load16_u" };
    case "u32":
    case "i32":
      return { kind: "i32.load" };
  }
}

function memoryWidth(type: BrlIrType): number {
  if (type.kind !== "scalar") {
    throw new BrlWasmLowerError(
      `Cannot place non-scalar ${formatBrlIrType(type)} in Wasm memory.`,
    );
  }
  switch (type.name) {
    case "bool":
    case "u8":
      return 1;
    case "u16":
      return 2;
    case "u32":
    case "i32":
      return 4;
  }
}

function scalarBitWidth(type: BrlIrType): number {
  if (type.kind !== "scalar") return 32;
  switch (type.name) {
    case "bool":
      return 1;
    case "u8":
      return 8;
    case "u16":
      return 16;
    case "u32":
    case "i32":
      return 32;
  }
}

function tempLocal(context: LowerContext): number {
  const index = localLayoutArity(context.localLayouts) + context.nextTempId++;
  context.wasmLocals.push({
    name: `__brl_tmp_${context.nextTempId}`,
    type: "i32",
  });
  return index;
}

function requiredLocalLayout(id: number, context: LowerContext): LocalLayout {
  const layout = context.localLayouts.get(id);
  if (!layout) {
    throw new BrlWasmLowerError(`Unknown BRL local id ${id}.`);
  }
  return layout;
}

function localLayoutArity(layouts: ReadonlyMap<number, LocalLayout>): number {
  let next = 0;
  for (const layout of layouts.values()) {
    next = Math.max(next, localLayoutEnd(layout));
  }
  return next;
}

function localLayoutEnd(layout: LocalLayout): number {
  switch (layout.kind) {
    case "scalar":
      return layout.index + 1;
    case "span":
    case "vec":
      return Math.max(layout.pointer + 1, layout.length + 1);
    case "record":
      return Math.max(0, ...[...layout.fields.values()].map(localLayoutEnd));
  }
}
