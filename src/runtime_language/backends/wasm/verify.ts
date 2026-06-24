import type {
  WasmFunctionIr,
  WasmInstructionIr,
  WasmModuleIr,
  WasmValueType,
} from "./wasm_ir.ts";

export interface WasmIrDiagnostic {
  readonly code: WasmIrDiagnosticCode;
  readonly message: string;
}

export type WasmIrDiagnosticCode =
  | "WASM_IR_DUPLICATE_EXPORT"
  | "WASM_IR_INVALID_FUNCTION"
  | "WASM_IR_INVALID_BRANCH"
  | "WASM_IR_INVALID_LOCAL"
  | "WASM_IR_INVALID_MEMORY"
  | "WASM_IR_STACK_UNDERFLOW"
  | "WASM_IR_TYPE_MISMATCH";

interface VerifyContext {
  readonly functions: readonly WasmFunctionIr[];
  readonly hasMemory: boolean;
  readonly locals: readonly WasmValueType[];
  readonly results: readonly WasmValueType[];
  readonly labels: readonly (readonly WasmValueType[])[];
  readonly diagnostics: WasmIrDiagnostic[];
}

export function verifyWasmIr(
  module: WasmModuleIr,
): readonly WasmIrDiagnostic[] {
  const diagnostics: WasmIrDiagnostic[] = [];
  const exports = new Set<string>();
  verifyMemory(module, diagnostics);
  if (module.memory?.exportName) {
    exports.add(module.memory.exportName);
  }
  for (const fn of module.functions) {
    if (!fn.exportName) continue;
    if (exports.has(fn.exportName)) {
      diagnostics.push({
        code: "WASM_IR_DUPLICATE_EXPORT",
        message: `Duplicate Wasm export '${fn.exportName}'.`,
      });
    }
    exports.add(fn.exportName);
  }

  for (const fn of module.functions) {
    const stack: WasmValueType[] = [];
    const context: VerifyContext = {
      functions: module.functions,
      hasMemory: module.memory !== undefined,
      locals: [
        ...(fn.params ?? []).map((local) => local.type),
        ...(fn.locals ?? []).map((local) => local.type),
      ],
      results: fn.results ?? [],
      labels: [],
      diagnostics,
    };
    verifyInstructionList(fn.body, stack, context);
    if (!endsWithReturnOrTrap(fn.body)) {
      expectStack(context.results, stack, context, "function result");
    }
  }

  return diagnostics;
}

function verifyInstructionList(
  instructions: readonly WasmInstructionIr[],
  stack: WasmValueType[],
  context: VerifyContext,
): void {
  for (const instruction of instructions) {
    verifyInstruction(instruction, stack, context);
  }
}

function verifyInstruction(
  instruction: WasmInstructionIr,
  stack: WasmValueType[],
  context: VerifyContext,
): void {
  switch (instruction.kind) {
    case "unreachable":
      stack.length = 0;
      return;
    case "return":
      expectStack(context.results, stack, context, "return");
      stack.length = 0;
      return;
    case "drop":
      popAny(stack, context, "drop");
      return;
    case "i32.const":
      stack.push("i32");
      return;
    case "i32.eqz":
      popExpected("i32", stack, context, "i32.eqz");
      stack.push("i32");
      return;
    case "local.get": {
      const local = context.locals[instruction.index];
      if (!local) {
        context.diagnostics.push({
          code: "WASM_IR_INVALID_LOCAL",
          message: `Unknown local index ${instruction.index}.`,
        });
        return;
      }
      stack.push(local);
      return;
    }
    case "local.set": {
      const local = context.locals[instruction.index];
      if (!local) {
        context.diagnostics.push({
          code: "WASM_IR_INVALID_LOCAL",
          message: `Unknown local index ${instruction.index}.`,
        });
        return;
      }
      popExpected(local, stack, context, "local.set");
      return;
    }
    case "local.tee": {
      const local = context.locals[instruction.index];
      if (!local) {
        context.diagnostics.push({
          code: "WASM_IR_INVALID_LOCAL",
          message: `Unknown local index ${instruction.index}.`,
        });
        return;
      }
      popExpected(local, stack, context, "local.tee");
      stack.push(local);
      return;
    }
    case "call": {
      const fn = context.functions[instruction.functionIndex];
      if (!fn) {
        context.diagnostics.push({
          code: "WASM_IR_INVALID_FUNCTION",
          message: `Unknown function index ${instruction.functionIndex}.`,
        });
        return;
      }
      for (const param of [...(fn.params ?? [])].reverse()) {
        popExpected(param.type, stack, context, "call");
      }
      stack.push(...(fn.results ?? []));
      return;
    }
    case "br":
      verifyBranchDepth(instruction.depth, context);
      stack.length = 0;
      return;
    case "br_if":
      popExpected("i32", stack, context, "br_if");
      verifyBranchDepth(instruction.depth, context);
      return;
    case "i32.load":
    case "i32.load8_u":
    case "i32.load16_u":
      verifyMemoryAccess(
        instruction.kind,
        instruction.align,
        instruction.offset,
        context,
      );
      popExpected("i32", stack, context, instruction.kind);
      stack.push("i32");
      return;
    case "i32.store":
    case "i32.store8":
    case "i32.store16":
      verifyMemoryAccess(
        instruction.kind,
        instruction.align,
        instruction.offset,
        context,
      );
      popExpected("i32", stack, context, instruction.kind);
      popExpected("i32", stack, context, instruction.kind);
      return;
    case "block":
    case "loop":
      verifyNested(instruction.body, instruction.result, stack, context);
      return;
    case "if": {
      popExpected("i32", stack, context, "if");
      const expected = instruction.result ? [instruction.result] : [];
      const armContext = {
        ...context,
        labels: [expected, ...context.labels],
      };
      const consequent = [...stack];
      verifyInstructionList(instruction.consequent, consequent, armContext);
      const alternate = [...stack];
      verifyInstructionList(instruction.alternate ?? [], alternate, armContext);
      expectStack(expected, consequent, context, "if consequent");
      expectStack(expected, alternate, context, "if alternate");
      stack.push(...expected);
      return;
    }
    default:
      if (isI32Binary(instruction.kind)) {
        popExpected("i32", stack, context, instruction.kind);
        popExpected("i32", stack, context, instruction.kind);
        stack.push("i32");
        return;
      }
      if (isI32Comparison(instruction.kind)) {
        popExpected("i32", stack, context, instruction.kind);
        popExpected("i32", stack, context, instruction.kind);
        stack.push("i32");
      }
  }
}

function verifyMemory(
  module: WasmModuleIr,
  diagnostics: WasmIrDiagnostic[],
): void {
  const memory = module.memory;
  const dataSegments = module.dataSegments ?? [];
  if (!memory && dataSegments.length > 0) {
    diagnostics.push({
      code: "WASM_IR_INVALID_MEMORY",
      message: "Data segments require a module memory.",
    });
    return;
  }
  if (!memory) return;
  if (
    !Number.isInteger(memory.minPages) || memory.minPages < 0 ||
    memory.minPages > 65_536
  ) {
    diagnostics.push({
      code: "WASM_IR_INVALID_MEMORY",
      message: `Invalid memory minimum page count ${memory.minPages}.`,
    });
  }
  if (
    memory.maxPages !== undefined &&
    (!Number.isInteger(memory.maxPages) || memory.maxPages < memory.minPages ||
      memory.maxPages > 65_536)
  ) {
    diagnostics.push({
      code: "WASM_IR_INVALID_MEMORY",
      message: `Invalid memory maximum page count ${memory.maxPages}.`,
    });
  }
  const initialBytes = memory.minPages * 65_536;
  for (const segment of dataSegments) {
    if (!Number.isInteger(segment.offset) || segment.offset < 0) {
      diagnostics.push({
        code: "WASM_IR_INVALID_MEMORY",
        message: `Invalid data segment offset ${segment.offset}.`,
      });
    }
    if (
      segment.bytes.some((byte) =>
        !Number.isInteger(byte) || byte < 0 || byte > 0xff
      )
    ) {
      diagnostics.push({
        code: "WASM_IR_INVALID_MEMORY",
        message: "Data segment bytes must be unsigned 8-bit values.",
      });
    }
    if (segment.offset + segment.bytes.length > initialBytes) {
      diagnostics.push({
        code: "WASM_IR_INVALID_MEMORY",
        message: "Data segment exceeds initial memory size.",
      });
    }
  }
}

function verifyMemoryAccess(
  kind: string,
  align: number | undefined,
  offset: number | undefined,
  context: VerifyContext,
): void {
  if (!context.hasMemory) {
    context.diagnostics.push({
      code: "WASM_IR_INVALID_MEMORY",
      message: `${kind} requires a module memory.`,
    });
  }
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
    context.diagnostics.push({
      code: "WASM_IR_INVALID_MEMORY",
      message: `${kind} has invalid offset ${offset}.`,
    });
  }
  const naturalAlign = naturalMemoryAlignment(kind);
  if (
    align !== undefined &&
    (!Number.isInteger(align) || align < 0 || align > naturalAlign)
  ) {
    context.diagnostics.push({
      code: "WASM_IR_INVALID_MEMORY",
      message: `${kind} has invalid alignment ${align}.`,
    });
  }
}

function naturalMemoryAlignment(kind: string): number {
  switch (kind) {
    case "i32.load":
    case "i32.store":
      return 2;
    case "i32.load16_u":
    case "i32.store16":
      return 1;
    case "i32.load8_u":
    case "i32.store8":
      return 0;
    default:
      return 0;
  }
}

function verifyNested(
  body: readonly WasmInstructionIr[],
  result: WasmValueType | undefined,
  stack: WasmValueType[],
  context: VerifyContext,
): void {
  const nested = [...stack];
  const label = result ? [result] : [];
  verifyInstructionList(body, nested, {
    ...context,
    labels: [label, ...context.labels],
  });
  expectStack(result ? [result] : [], nested, context, "block");
  stack.push(...(result ? [result] : []));
}

function verifyBranchDepth(depth: number, context: VerifyContext): void {
  if (!Number.isInteger(depth) || depth < 0 || depth >= context.labels.length) {
    context.diagnostics.push({
      code: "WASM_IR_INVALID_BRANCH",
      message: `Invalid branch depth ${depth}.`,
    });
  }
}

function expectStack(
  expected: readonly WasmValueType[],
  stack: readonly WasmValueType[],
  context: VerifyContext,
  operation: string,
): void {
  if (stack.length < expected.length) {
    context.diagnostics.push({
      code: "WASM_IR_STACK_UNDERFLOW",
      message:
        `${operation} expected ${expected.length} value(s), got ${stack.length}.`,
    });
    return;
  }
  const offset = stack.length - expected.length;
  for (let index = 0; index < expected.length; index++) {
    const actual = stack[offset + index];
    if (actual !== expected[index]) {
      context.diagnostics.push({
        code: "WASM_IR_TYPE_MISMATCH",
        message: `${operation} expected ${expected[index]}, got ${actual}.`,
      });
    }
  }
}

function popExpected(
  expected: WasmValueType,
  stack: WasmValueType[],
  context: VerifyContext,
  operation: string,
): void {
  const actual = stack.pop();
  if (!actual) {
    context.diagnostics.push({
      code: "WASM_IR_STACK_UNDERFLOW",
      message: `${operation} expected ${expected}, got empty stack.`,
    });
  } else if (actual !== expected) {
    context.diagnostics.push({
      code: "WASM_IR_TYPE_MISMATCH",
      message: `${operation} expected ${expected}, got ${actual}.`,
    });
  }
}

function popAny(
  stack: WasmValueType[],
  context: VerifyContext,
  operation: string,
): void {
  const actual = stack.pop();
  if (!actual) {
    context.diagnostics.push({
      code: "WASM_IR_STACK_UNDERFLOW",
      message: `${operation} expected a value, got empty stack.`,
    });
  }
}

function endsWithReturnOrTrap(
  instructions: readonly WasmInstructionIr[],
): boolean {
  const last = instructions[instructions.length - 1];
  return last?.kind === "return" || last?.kind === "unreachable";
}

function isI32Binary(kind: string): boolean {
  return [
    "i32.add",
    "i32.sub",
    "i32.mul",
    "i32.div_s",
    "i32.div_u",
    "i32.rem_s",
    "i32.rem_u",
    "i32.and",
    "i32.or",
    "i32.xor",
    "i32.shl",
    "i32.shr_u",
    "i32.shr_s",
  ].includes(kind);
}

function isI32Comparison(kind: string): boolean {
  return [
    "i32.eq",
    "i32.ne",
    "i32.lt_u",
    "i32.lt_s",
    "i32.le_u",
    "i32.le_s",
    "i32.gt_u",
    "i32.gt_s",
    "i32.ge_u",
    "i32.ge_s",
  ].includes(kind);
}
