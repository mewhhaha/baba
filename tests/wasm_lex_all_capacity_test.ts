/**
 * Pins the `lex_all` buffer contract.
 *
 * `lex_all` used to take no capacity argument at all while writing scratch into
 * token records it never returned, so an undersized buffer corrupted host
 * memory with no status code. It now takes `token_capacity` and a separate
 * `memo` buffer with its own capacity, rejects both when they are short, and
 * writes nothing outside them - the failure memo lives in the memo buffer, not
 * in the token records. Ordinary calls pass no memo; `-2` asks the host to
 * allocate the full memo and retry when discarded scanning crosses the
 * activation threshold.
 */

import { assert, assertEquals, compile } from "./helpers.ts";
import { wasmCoreRuntimeBytes } from "../src/targets/runtime/wasm_core_runtime_bytes.ts";

const TOKEN_RECORD_I32_COUNT = 4;
const WASM_PAGE_BYTES = 65_536;
const LEX_STATUS_TOKEN_CAPACITY = -1;
const LEX_STATUS_MEMO_REQUIRED = -2;

interface RawLexExports {
  readonly memory: WebAssembly.Memory;
  readonly plan_buffer_base: () => number;
  readonly input_base: () => number;
  readonly load_plan: (pointer: number, length: number) => number;
  readonly lex_memo_i32_per_position: () => number;
  readonly lex_all: (
    source: number,
    length: number,
    mode: number,
    tokens: number,
    tokenCapacity: number,
    memo: number,
    memoCapacity: number,
  ) => number;
}

function planFor(source: string): Uint8Array {
  const result = compile(source, { targets: ["wasm"] });
  assertEquals(
    result.diagnostics.length,
    0,
    `Expected a clean compile, got ${
      result.diagnostics.map((diagnostic) => diagnostic.code).join(", ")
    }.`,
  );
  assert(result.bundle !== undefined, "Expected a generated bundle.");
  const plan = result.bundle.files.find((file) =>
    file.path === "wasm/parser.plan"
  );
  assert(plan !== undefined, "Expected wasm/parser.plan.");
  assert(plan.encoding === "binary", "Expected a binary plan.");
  return plan.content;
}

function growTo(memory: WebAssembly.Memory, byteLength: number): void {
  const needed = Math.ceil(byteLength / WASM_PAGE_BYTES);
  const current = memory.buffer.byteLength / WASM_PAGE_BYTES;
  if (needed > current) {
    memory.grow(needed - current);
  }
}

function alignUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function loadEngine(plan: Uint8Array): RawLexExports {
  const bytes = wasmCoreRuntimeBytes();
  const module = new WebAssembly.Module(bytes.buffer as ArrayBuffer);
  const instance = new WebAssembly.Instance(module, {});
  const exports = instance.exports as unknown as RawLexExports;
  const planPointer = exports.plan_buffer_base();
  growTo(exports.memory, planPointer + plan.byteLength);
  new Uint8Array(exports.memory.buffer, planPointer, plan.byteLength).set(plan);
  assertEquals(exports.load_plan(planPointer, plan.byteLength), 1);
  return exports;
}

// The unterminated hex run: every scan runs to end of input and fails, so the
// memo is switched on and the lexer emits one error token per code unit. That
// is the input where a scratch write outside the declared buffers would show.
const HEX_GRAMMAR = `token X = /([0-9a-f][0-9a-f])+;/ ;
skip WS = /[ \\t\\r\\n]+/ ;
module = statement* ;
statement = X ;
`;

interface Layout {
  readonly exports: RawLexExports;
  readonly sourcePointer: number;
  readonly tokenPointer: number;
  readonly memoPointer: number;
  readonly memoCapacity: number;
  readonly length: number;
}

function place(plan: Uint8Array, text: string): Layout {
  const exports = loadEngine(plan);
  const sourcePointer = alignUp(exports.input_base(), 8);
  const tokenPointer = alignUp(sourcePointer + text.length * 2, 4);
  const memoPointer = alignUp(
    tokenPointer + text.length * TOKEN_RECORD_I32_COUNT * 4,
    4,
  );
  const memoCapacity = (text.length + 1) *
    exports.lex_memo_i32_per_position();
  // One extra page past everything, so the guard region below is real memory.
  growTo(
    exports.memory,
    memoPointer + memoCapacity * 4 + WASM_PAGE_BYTES,
  );
  const units = new Uint16Array(
    exports.memory.buffer,
    sourcePointer,
    text.length,
  );
  for (let index = 0; index < text.length; index += 1) {
    units[index] = text.charCodeAt(index);
  }
  return {
    exports,
    sourcePointer,
    tokenPointer,
    memoPointer,
    memoCapacity,
    length: text.length,
  };
}

Deno.test("lex_all rejects a token buffer smaller than the source", () => {
  const text = "a".repeat(64);
  const layout = place(planFor(HEX_GRAMMAR), text);
  assertEquals(
    layout.exports.lex_all(
      layout.sourcePointer,
      layout.length,
      0,
      layout.tokenPointer,
      layout.length - 1,
      layout.memoPointer,
      layout.memoCapacity,
    ),
    LEX_STATUS_TOKEN_CAPACITY,
  );
  // One record per code point is the real requirement, and this input reaches
  // it, so exactly `length` records must be accepted.
  assertEquals(
    layout.exports.lex_all(
      layout.sourcePointer,
      layout.length,
      0,
      layout.tokenPointer,
      layout.length,
      layout.memoPointer,
      layout.memoCapacity,
    ),
    layout.length,
  );
});

Deno.test("lex_all requests a complete memo when pathological scanning activates it", () => {
  const text = "a".repeat(64);
  const layout = place(planFor(HEX_GRAMMAR), text);
  assert(
    layout.memoCapacity > 0,
    "Expected this grammar to need a nonempty memo.",
  );
  for (const capacity of [0, layout.memoCapacity - 1]) {
    assertEquals(
      layout.exports.lex_all(
        layout.sourcePointer,
        layout.length,
        0,
        layout.tokenPointer,
        layout.length,
        layout.memoPointer,
        capacity,
      ),
      LEX_STATUS_MEMO_REQUIRED,
      `Expected a memo-capacity rejection at capacity ${capacity}.`,
    );
  }
  assertEquals(
    layout.exports.lex_all(
      layout.sourcePointer,
      layout.length,
      0,
      layout.tokenPointer,
      layout.length,
      layout.memoPointer,
      layout.memoCapacity,
    ),
    layout.length,
  );
});

Deno.test("lex_all writes nothing past the token records it returns", () => {
  // 4,096 units of the shape that switches the memo on. Before the memo had its
  // own buffer this region held scratch; it must now be untouched.
  const text = "a".repeat(4096);
  const layout = place(planFor(HEX_GRAMMAR), text);
  const extraRecords = 512;
  const guardPointer = layout.tokenPointer +
    layout.length * TOKEN_RECORD_I32_COUNT * 4;
  const guard = new Int32Array(
    layout.exports.memory.buffer,
    guardPointer,
    extraRecords * TOKEN_RECORD_I32_COUNT,
  );
  const sentinel = 0x5a5a5a5a;
  guard.fill(sentinel);
  // The memo sits right after the guard region here, so move it out of the way
  // for this call by re-placing it past the guard.
  const memoPointer = alignUp(
    guardPointer + extraRecords * TOKEN_RECORD_I32_COUNT * 4,
    4,
  );
  growTo(
    layout.exports.memory,
    memoPointer + layout.memoCapacity * 4 + WASM_PAGE_BYTES,
  );
  const count = layout.exports.lex_all(
    layout.sourcePointer,
    layout.length,
    0,
    layout.tokenPointer,
    layout.length,
    memoPointer,
    layout.memoCapacity,
  );
  assertEquals(count, layout.length);
  const after = new Int32Array(
    layout.exports.memory.buffer,
    guardPointer,
    extraRecords * TOKEN_RECORD_I32_COUNT,
  );
  for (let index = 0; index < after.length; index += 1) {
    assertEquals(
      after[index],
      sentinel,
      `lex_all wrote ${after[index]} at i32 ${index} past the token records.`,
    );
  }
});

Deno.test("lexer core does not expose the retired LR parser", () => {
  const exports = loadEngine(planFor(HEX_GRAMMAR));
  assertEquals("parse_cursor" in exports, false);
  assertEquals("parser_action" in exports, false);
  assertEquals("parser_goto" in exports, false);
  assertEquals("validate" in exports, false);
});
