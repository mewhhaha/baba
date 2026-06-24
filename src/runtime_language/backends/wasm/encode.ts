import type {
  WasmFunctionIr,
  WasmInstructionIr,
  WasmMemoryIr,
  WasmModuleIr,
  WasmValueType,
} from "./wasm_ir.ts";
import { verifyWasmIr } from "./verify.ts";

export class WasmEncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WasmEncodeError";
  }
}

export function encodeWasmModule(module: WasmModuleIr): Uint8Array {
  const diagnostics = verifyWasmIr(module);
  if (diagnostics.length > 0) {
    const first = diagnostics[0];
    throw new WasmEncodeError(
      `Cannot encode invalid Wasm IR: ${first.code}: ${first.message}`,
    );
  }

  const sections: number[] = [
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
  ];
  sections.push(...section(1, typeSection(module.functions)));
  sections.push(...section(3, functionSection(module.functions)));
  if (module.memory) sections.push(...section(5, memorySection(module.memory)));
  const exports = exportSection(module);
  if (exports.length > 0) sections.push(...section(7, exports));
  sections.push(...section(10, codeSection(module.functions)));
  if ((module.dataSegments ?? []).length > 0) {
    sections.push(...section(11, dataSection(module)));
  }
  return new Uint8Array(sections);
}

function typeSection(functions: readonly WasmFunctionIr[]): readonly number[] {
  const bytes: number[] = [...u32(functions.length)];
  for (const fn of functions) {
    bytes.push(
      0x60,
      ...valueTypeVector((fn.params ?? []).map((param) => param.type)),
      ...valueTypeVector(fn.results ?? []),
    );
  }
  return bytes;
}

function functionSection(
  functions: readonly WasmFunctionIr[],
): readonly number[] {
  return vector(functions.map((_fn, index) => u32(index)));
}

function exportSection(
  module: WasmModuleIr,
): readonly number[] {
  const exports = [
    ...(module.memory?.exportName
      ? [[...name(module.memory.exportName), 0x02, ...u32(0)]]
      : []),
    ...module.functions
      .map((fn, index) => ({ fn, index }))
      .filter((entry) => entry.fn.exportName)
      .map((entry) => [
        ...name(entry.fn.exportName ?? entry.fn.name),
        0x00,
        ...u32(entry.index),
      ]),
  ];
  return vector(exports);
}

function memorySection(memory: WasmMemoryIr): readonly number[] {
  return vector([limits(memory.minPages, memory.maxPages)]);
}

function dataSection(module: WasmModuleIr): readonly number[] {
  return vector((module.dataSegments ?? []).map((segment) => [
    0x00,
    0x41,
    ...i32(segment.offset),
    0x0b,
    ...byteVector(segment.bytes),
  ]));
}

function codeSection(functions: readonly WasmFunctionIr[]): readonly number[] {
  return vector(functions.map(encodeFunctionBody));
}

function encodeFunctionBody(fn: WasmFunctionIr): readonly number[] {
  const body = [
    ...localDeclarations(fn.locals ?? []),
    ...encodeInstructions(fn.body),
    0x0b,
  ];
  return [...u32(body.length), ...body];
}

function localDeclarations(
  locals: NonNullable<WasmFunctionIr["locals"]>,
): readonly number[] {
  const groups: { count: number; type: WasmValueType }[] = [];
  for (const local of locals) {
    const last = groups[groups.length - 1];
    if (last?.type === local.type) {
      last.count++;
    } else {
      groups.push({ count: 1, type: local.type });
    }
  }
  return [
    ...u32(groups.length),
    ...groups.flatMap((group) => [...u32(group.count), typeByte(group.type)]),
  ];
}

function encodeInstructions(
  instructions: readonly WasmInstructionIr[],
): readonly number[] {
  return instructions.flatMap(encodeInstruction);
}

function encodeInstruction(instruction: WasmInstructionIr): readonly number[] {
  switch (instruction.kind) {
    case "unreachable":
      return [0x00];
    case "return":
      return [0x0f];
    case "drop":
      return [0x1a];
    case "i32.const":
      return [0x41, ...i32(instruction.value)];
    case "i32.eqz":
      return [0x45];
    case "local.get":
      return [0x20, ...u32(instruction.index)];
    case "local.set":
      return [0x21, ...u32(instruction.index)];
    case "local.tee":
      return [0x22, ...u32(instruction.index)];
    case "call":
      return [0x10, ...u32(instruction.functionIndex)];
    case "br":
      return [0x0c, ...u32(instruction.depth)];
    case "br_if":
      return [0x0d, ...u32(instruction.depth)];
    case "i32.load":
    case "i32.load8_u":
    case "i32.load16_u":
    case "i32.store":
    case "i32.store8":
    case "i32.store16":
      return [
        opcode(instruction.kind),
        ...u32(instruction.align ?? naturalMemoryAlignment(instruction.kind)),
        ...u32(instruction.offset ?? 0),
      ];
    case "block":
      return [
        0x02,
        blockType(instruction.result),
        ...encodeInstructions(instruction.body),
        0x0b,
      ];
    case "loop":
      return [
        0x03,
        blockType(instruction.result),
        ...encodeInstructions(instruction.body),
        0x0b,
      ];
    case "if":
      return [
        0x04,
        blockType(instruction.result),
        ...encodeInstructions(instruction.consequent),
        ...(instruction.alternate
          ? [0x05, ...encodeInstructions(instruction.alternate)]
          : []),
        0x0b,
      ];
    default:
      return [opcode(instruction.kind)];
  }
}

function section(id: number, payload: readonly number[]): readonly number[] {
  return [id, ...u32(payload.length), ...payload];
}

function vector(items: readonly (readonly number[])[]): readonly number[] {
  return [...u32(items.length), ...items.flat()];
}

function byteVector(items: readonly number[]): readonly number[] {
  return [...u32(items.length), ...items];
}

function limits(min: number, max: number | undefined): readonly number[] {
  return max === undefined
    ? [0x00, ...u32(min)]
    : [0x01, ...u32(min), ...u32(max)];
}

function valueTypeVector(types: readonly WasmValueType[]): readonly number[] {
  return [...u32(types.length), ...types.map(typeByte)];
}

function name(value: string): readonly number[] {
  const encoded = new TextEncoder().encode(value);
  return [...u32(encoded.length), ...encoded];
}

function typeByte(type: WasmValueType): number {
  switch (type) {
    case "i32":
      return 0x7f;
    case "i64":
      return 0x7e;
    case "f32":
      return 0x7d;
    case "f64":
      return 0x7c;
  }
}

function blockType(type: WasmValueType | undefined): number {
  return type ? typeByte(type) : 0x40;
}

function opcode(kind: string): number {
  switch (kind) {
    case "i32.eq":
      return 0x46;
    case "i32.ne":
      return 0x47;
    case "i32.lt_s":
      return 0x48;
    case "i32.lt_u":
      return 0x49;
    case "i32.gt_s":
      return 0x4a;
    case "i32.gt_u":
      return 0x4b;
    case "i32.le_s":
      return 0x4c;
    case "i32.le_u":
      return 0x4d;
    case "i32.ge_s":
      return 0x4e;
    case "i32.ge_u":
      return 0x4f;
    case "i32.add":
      return 0x6a;
    case "i32.sub":
      return 0x6b;
    case "i32.mul":
      return 0x6c;
    case "i32.div_s":
      return 0x6d;
    case "i32.div_u":
      return 0x6e;
    case "i32.rem_s":
      return 0x6f;
    case "i32.rem_u":
      return 0x70;
    case "i32.and":
      return 0x71;
    case "i32.or":
      return 0x72;
    case "i32.xor":
      return 0x73;
    case "i32.shl":
      return 0x74;
    case "i32.shr_s":
      return 0x75;
    case "i32.shr_u":
      return 0x76;
    case "i32.load":
      return 0x28;
    case "i32.load8_u":
      return 0x2d;
    case "i32.load16_u":
      return 0x2f;
    case "i32.store":
      return 0x36;
    case "i32.store8":
      return 0x3a;
    case "i32.store16":
      return 0x3b;
    default:
      throw new WasmEncodeError(`Unsupported Wasm instruction '${kind}'.`);
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

function u32(value: number): readonly number[] {
  let remaining = value >>> 0;
  const bytes: number[] = [];
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== 0);
  return bytes;
}

function i32(value: number): readonly number[] {
  let remaining = value | 0;
  const bytes: number[] = [];
  let more = true;
  while (more) {
    let byte = remaining & 0x7f;
    remaining >>= 7;
    const signBit = byte & 0x40;
    more = !(
      (remaining === 0 && signBit === 0) ||
      (remaining === -1 && signBit !== 0)
    );
    if (more) byte |= 0x80;
    bytes.push(byte);
  }
  return bytes;
}
