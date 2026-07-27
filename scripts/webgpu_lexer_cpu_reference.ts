/**
 * Ground truth: the shipping Rust/Wasm lexer, driven through its raw ABI.
 *
 * `parser.lex()` does not expose `specIndex` or `acceptingState`, and the
 * module-private `lexExternalRecords` in `src/runtime/generated_wasm.ts` is not
 * exported, so the record-level harness is reproduced here. It is raw-vs-raw:
 * 4 x i32 records out of `lex_all` compared against 4 x i32 records out of the
 * GPU kernel.
 */

const TOKEN_RECORD_I32_COUNT = 4;
const WASM_PAGE_BYTES = 65536;

interface LexEngineExports {
  readonly memory: WebAssembly.Memory;
  readonly plan_buffer_base: () => number;
  readonly input_base: () => number;
  readonly load_plan: (pointer: number, length: number) => number;
  readonly lex_all: (
    source: number,
    length: number,
    mode: number,
    tokens: number,
    tokenCapacity: number,
    memo: number,
    memoCapacity: number,
  ) => number;
  readonly lex_memo_i32_per_position: () => number;
  readonly token_record_i32_count: () => number;
  readonly source_encoding: () => number;
  readonly span_unit: () => number;
  readonly abi_version: () => number;
}

function alignUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

export interface CpuLexTimings {
  readonly writeSourceMs: number;
  readonly lexAllMs: number;
  readonly totalMs: number;
}

export class CpuReferenceLexer {
  readonly #exports: LexEngineExports;
  readonly #sourcePointer: number;
  #tokenPointer: number;
  #capacityRecords: number;
  #memoPointer: number;
  #memoCapacity: number;
  readonly abiVersion: number;

  private constructor(
    exports: LexEngineExports,
    sourcePointer: number,
    tokenPointer: number,
    capacityRecords: number,
  ) {
    this.#exports = exports;
    this.#sourcePointer = sourcePointer;
    this.#tokenPointer = tokenPointer;
    this.#capacityRecords = capacityRecords;
    this.#memoPointer = 0;
    this.#memoCapacity = 0;
    this.abiVersion = exports.abi_version();
  }

  static create(
    wasmBytes: Uint8Array,
    planBytes: Uint8Array,
  ): CpuReferenceLexer {
    const module = new WebAssembly.Module(wasmBytes.buffer as ArrayBuffer);
    const instance = new WebAssembly.Instance(module, {});
    const exports = instance.exports as unknown as LexEngineExports;

    const planPointer = exports.plan_buffer_base();
    growTo(exports.memory, planPointer + planBytes.byteLength);
    new Uint8Array(exports.memory.buffer, planPointer, planBytes.byteLength)
      .set(
        planBytes,
      );
    const loaded = exports.load_plan(planPointer, planBytes.byteLength);
    if (loaded !== 1) {
      throw new Error(`load_plan rejected the plan (returned ${loaded}).`);
    }
    if (exports.token_record_i32_count() !== TOKEN_RECORD_I32_COUNT) {
      throw new Error(
        `Engine reports ${exports.token_record_i32_count()} i32 per token record; expected ${TOKEN_RECORD_I32_COUNT}.`,
      );
    }
    if (exports.source_encoding() !== 1) {
      throw new Error("Engine source encoding is not UTF-16.");
    }
    if (exports.span_unit() !== 1) {
      throw new Error("Engine span unit is not UTF-16 code units.");
    }

    const sourcePointer = alignUp(exports.input_base(), 8);
    return new CpuReferenceLexer(exports, sourcePointer, 0, 0);
  }

  #reserve(sourceLength: number): void {
    const tokenPointer = alignUp(this.#sourcePointer + sourceLength * 2, 4);
    const capacityRecords = Math.max(sourceLength, 1);
    // The lexer's (position, state) failure memo is a caller-owned buffer, one
    // bit per source position per DFA state. The engine reports the width.
    const memoPointer = alignUp(
      tokenPointer + capacityRecords * TOKEN_RECORD_I32_COUNT * 4,
      4,
    );
    const memoCapacity = (sourceLength + 1) *
      this.#exports.lex_memo_i32_per_position();
    growTo(this.#exports.memory, memoPointer + memoCapacity * 4);
    this.#tokenPointer = tokenPointer;
    this.#capacityRecords = capacityRecords;
    this.#memoPointer = memoPointer;
    this.#memoCapacity = memoCapacity;
  }

  /** Returns the raw 4 x i32 records exactly as `lex_all` wrote them. */
  lex(source: Uint16Array): { records: Int32Array; timings: CpuLexTimings } {
    this.#reserve(source.length);
    const startWrite = performance.now();
    new Uint16Array(
      this.#exports.memory.buffer,
      this.#sourcePointer,
      source.length,
    )
      .set(source);
    const afterWrite = performance.now();
    const count = this.#exports.lex_all(
      this.#sourcePointer,
      source.length,
      0,
      this.#tokenPointer,
      this.#capacityRecords,
      this.#memoPointer,
      this.#memoCapacity,
    );
    const afterLex = performance.now();
    if (count < 0 || count > this.#capacityRecords) {
      throw new Error(`lex_all returned an out-of-range count ${count}.`);
    }
    const records = new Int32Array(
      this.#exports.memory.buffer.slice(
        this.#tokenPointer,
        this.#tokenPointer + count * TOKEN_RECORD_I32_COUNT * 4,
      ),
    );
    return {
      records,
      timings: {
        writeSourceMs: afterWrite - startWrite,
        lexAllMs: afterLex - afterWrite,
        totalMs: afterLex - startWrite,
      },
    };
  }
}

function growTo(memory: WebAssembly.Memory, byteLength: number): void {
  const needed = Math.ceil(byteLength / WASM_PAGE_BYTES);
  const current = memory.buffer.byteLength / WASM_PAGE_BYTES;
  if (needed <= current) {
    return;
  }
  memory.grow(needed - current);
}

/** JS string -> UTF-16 code unit array. Measured separately from lexing. */
export function toUtf16(source: string): Uint16Array {
  const units = new Uint16Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    units[index] = source.charCodeAt(index);
  }
  return units;
}
