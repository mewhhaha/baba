import { encodeWasmModule } from "../runtime_language/backends/wasm/encode.ts";
import type {
  WasmFunctionIr,
  WasmInstructionIr,
} from "../runtime_language/backends/wasm/wasm_ir.ts";

export interface SharedGenericWasmExecutor {
  readonly module: WebAssembly.Module;
  readonly bytes: Uint8Array;
  createInstance(): SharedGenericWasmExecutorInstance;
}

export interface SharedGenericWasmExecutorInstance {
  readonly memory: WebAssembly.Memory;
  readonly exports: SharedGenericWasmExecutorExports;
  writeI32Table(values: readonly number[]): number;
}

export interface SharedGenericWasmExecutorExports {
  baba_generic_runtime_version(): number;
  find_pair(
    rowStartsPtr: number,
    stateCount: number,
    pairsPtr: number,
    state: number,
    key: number,
  ): number;
  find_range(
    rowStartsPtr: number,
    stateCount: number,
    rangesPtr: number,
    state: number,
    codePoint: number,
  ): number;
}

const PAGE_BYTES = 65_536;
let cachedBytes: Uint8Array | undefined;

export function createSharedGenericWasmExecutor(): SharedGenericWasmExecutor {
  const bytes = sharedGenericWasmExecutorBytes();
  const module = new WebAssembly.Module(arrayBufferFor(bytes));
  return {
    module,
    bytes,
    createInstance() {
      const instance = new WebAssembly.Instance(module, {});
      return createExecutorInstance(instance);
    },
  };
}

export function sharedGenericWasmExecutorBytes(): Uint8Array {
  cachedBytes ??= encodeWasmModule({
    memory: { minPages: 1, maxPages: 64, exportName: "memory" },
    functions: [
      runtimeVersionFunction(),
      findPairFunction(),
      findRangeFunction(),
    ],
  });
  return cachedBytes;
}

function createExecutorInstance(
  instance: WebAssembly.Instance,
): SharedGenericWasmExecutorInstance {
  const exports = instance.exports as unknown as
    & SharedGenericWasmExecutorExports
    & {
      memory: WebAssembly.Memory;
    };
  let nextOffset = 0;
  return {
    memory: exports.memory,
    exports,
    writeI32Table(values) {
      const offset = nextOffset;
      nextOffset += values.length * 4;
      while (nextOffset > exports.memory.buffer.byteLength) {
        exports.memory.grow(1);
      }
      const view = new DataView(exports.memory.buffer);
      values.forEach((value, index) =>
        view.setInt32(offset + index * 4, value, true)
      );
      nextOffset = align(nextOffset, 4);
      return offset;
    },
  };
}

function runtimeVersionFunction(): WasmFunctionIr {
  return {
    name: "baba_generic_runtime_version",
    results: ["i32"],
    exportName: "baba_generic_runtime_version",
    body: [{ kind: "i32.const", value: 1 }],
  };
}

function findPairFunction(): WasmFunctionIr {
  return {
    name: "find_pair",
    params: [
      { name: "rowStartsPtr", type: "i32" },
      { name: "stateCount", type: "i32" },
      { name: "pairsPtr", type: "i32" },
      { name: "state", type: "i32" },
      { name: "key", type: "i32" },
    ],
    results: ["i32"],
    locals: [
      { name: "index", type: "i32" },
      { name: "end", type: "i32" },
      { name: "entryPtr", type: "i32" },
    ],
    exportName: "find_pair",
    body: [
      ...guardState(3, 1),
      ...loadRowStartEnd({ rowStartsPtr: 0, state: 3, index: 5, end: 6 }),
      ...scanLoop({
        index: 5,
        end: 6,
        entryPtr: 7,
        basePtr: 2,
        key: 4,
        strideShift: 3,
        matchBody: [
          { kind: "local.get", index: 7 },
          { kind: "i32.load", offset: 4 },
          { kind: "return" },
        ],
      }),
      { kind: "i32.const", value: -1 },
    ],
  };
}

function findRangeFunction(): WasmFunctionIr {
  return {
    name: "find_range",
    params: [
      { name: "rowStartsPtr", type: "i32" },
      { name: "stateCount", type: "i32" },
      { name: "rangesPtr", type: "i32" },
      { name: "state", type: "i32" },
      { name: "codePoint", type: "i32" },
    ],
    results: ["i32"],
    locals: [
      { name: "index", type: "i32" },
      { name: "end", type: "i32" },
      { name: "entryPtr", type: "i32" },
    ],
    exportName: "find_range",
    body: [
      ...guardState(3, 1),
      ...loadRowStartEnd({ rowStartsPtr: 0, state: 3, index: 5, end: 6 }),
      ...scanLoop({
        index: 5,
        end: 6,
        entryPtr: 7,
        basePtr: 2,
        key: 4,
        strideShift: null,
        entryPtrExpr: [
          { kind: "local.get", index: 2 },
          { kind: "local.get", index: 5 },
          { kind: "i32.const", value: 12 },
          { kind: "i32.mul" },
          { kind: "i32.add" },
        ],
        condition: [
          { kind: "local.get", index: 4 },
          { kind: "local.get", index: 7 },
          { kind: "i32.load" },
          { kind: "i32.ge_u" },
          { kind: "local.get", index: 4 },
          { kind: "local.get", index: 7 },
          { kind: "i32.load", offset: 4 },
          { kind: "i32.le_u" },
          { kind: "i32.and" },
        ],
        matchBody: [
          { kind: "local.get", index: 7 },
          { kind: "i32.load", offset: 8 },
          { kind: "return" },
        ],
      }),
      { kind: "i32.const", value: -1 },
    ],
  };
}

function guardState(
  state: number,
  stateCount: number,
): WasmInstructionIr[] {
  return [
    { kind: "local.get", index: state },
    { kind: "local.get", index: stateCount },
    { kind: "i32.ge_u" },
    {
      kind: "if",
      consequent: [{ kind: "i32.const", value: -1 }, { kind: "return" }],
    },
  ];
}

function loadRowStartEnd(locals: {
  rowStartsPtr: number;
  state: number;
  index: number;
  end: number;
}): WasmInstructionIr[] {
  return [
    ...rowStartAddress(locals.rowStartsPtr, locals.state),
    { kind: "i32.load" },
    { kind: "local.set", index: locals.index },
    ...rowStartAddressPlusOne(locals.rowStartsPtr, locals.state),
    { kind: "i32.load" },
    { kind: "local.set", index: locals.end },
  ];
}

function scanLoop(options: {
  index: number;
  end: number;
  entryPtr: number;
  basePtr: number;
  key: number;
  strideShift: number | null;
  entryPtrExpr?: WasmInstructionIr[];
  condition?: WasmInstructionIr[];
  matchBody: WasmInstructionIr[];
}): WasmInstructionIr[] {
  const entryPtrExpr = options.entryPtrExpr ?? [
    { kind: "local.get", index: options.basePtr },
    { kind: "local.get", index: options.index },
    { kind: "i32.const", value: options.strideShift ?? 0 },
    { kind: "i32.shl" },
    { kind: "i32.add" },
  ];
  const condition = options.condition ?? [
    { kind: "local.get", index: options.entryPtr },
    { kind: "i32.load" },
    { kind: "local.get", index: options.key },
    { kind: "i32.eq" },
  ];
  return [{
    kind: "block",
    body: [{
      kind: "loop",
      body: [
        { kind: "local.get", index: options.index },
        { kind: "local.get", index: options.end },
        { kind: "i32.ge_u" },
        { kind: "br_if", depth: 1 },
        ...entryPtrExpr,
        { kind: "local.set", index: options.entryPtr },
        ...condition,
        { kind: "if", consequent: options.matchBody },
        { kind: "local.get", index: options.index },
        { kind: "i32.const", value: 1 },
        { kind: "i32.add" },
        { kind: "local.set", index: options.index },
        { kind: "br", depth: 0 },
      ],
    }],
  }];
}

function rowStartAddress(
  rowStartsPtr: number,
  state: number,
): WasmInstructionIr[] {
  return [
    { kind: "local.get", index: rowStartsPtr },
    { kind: "local.get", index: state },
    { kind: "i32.const", value: 2 },
    { kind: "i32.shl" },
    { kind: "i32.add" },
  ];
}

function rowStartAddressPlusOne(
  rowStartsPtr: number,
  state: number,
): WasmInstructionIr[] {
  return [
    { kind: "local.get", index: rowStartsPtr },
    { kind: "local.get", index: state },
    { kind: "i32.const", value: 1 },
    { kind: "i32.add" },
    { kind: "i32.const", value: 2 },
    { kind: "i32.shl" },
    { kind: "i32.add" },
  ];
}

function align(value: number, size: number): number {
  return Math.ceil(value / size) * size;
}

function arrayBufferFor(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
