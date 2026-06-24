import {
  encodeWasmModule,
  WasmEncodeError,
} from "../src/runtime_language/backends/wasm/encode.ts";
import {
  lowerBrlIrToWasm,
} from "../src/runtime_language/backends/wasm/lower.ts";
import { verifyWasmIr } from "../src/runtime_language/backends/wasm/verify.ts";
import type { WasmModuleIr } from "../src/runtime_language/backends/wasm/wasm_ir.ts";
import { lowerBrlModule } from "../src/runtime_language/lower.ts";
import { parseBrlModule } from "../src/runtime_language/parser.ts";
import { assert, assertEquals } from "./helpers.ts";

Deno.test("BRL Wasm backend foundation encodes valid core Wasm", async () => {
  const module: WasmModuleIr = {
    memory: { minPages: 1, exportName: "memory" },
    dataSegments: [{
      offset: 0,
      bytes: [21, 0, 0, 0, 7],
    }],
    functions: [
      {
        name: "add",
        params: [
          { name: "left", type: "i32" },
          { name: "right", type: "i32" },
        ],
        results: ["i32"],
        body: [
          { kind: "local.get", index: 0 },
          { kind: "local.get", index: 1 },
          { kind: "i32.add" },
          { kind: "return" },
        ],
        exportName: "add",
      },
      {
        name: "choose",
        params: [
          { name: "flag", type: "i32" },
          { name: "left", type: "i32" },
          { name: "right", type: "i32" },
        ],
        results: ["i32"],
        body: [
          { kind: "local.get", index: 0 },
          {
            kind: "if",
            result: "i32",
            consequent: [{ kind: "local.get", index: 1 }],
            alternate: [{ kind: "local.get", index: 2 }],
          },
          { kind: "return" },
        ],
        exportName: "choose",
      },
      {
        name: "read_word",
        results: ["i32"],
        body: [
          { kind: "i32.const", value: 0 },
          { kind: "i32.load" },
          { kind: "return" },
        ],
        exportName: "read_word",
      },
      {
        name: "read_byte",
        results: ["i32"],
        body: [
          { kind: "i32.const", value: 4 },
          { kind: "i32.load8_u" },
          { kind: "return" },
        ],
        exportName: "read_byte",
      },
      {
        name: "write_word",
        params: [{ name: "value", type: "i32" }],
        body: [
          { kind: "i32.const", value: 8 },
          { kind: "local.get", index: 0 },
          { kind: "i32.store" },
          { kind: "return" },
        ],
        exportName: "write_word",
      },
      {
        name: "drop_value",
        body: [
          { kind: "i32.const", value: 123 },
          { kind: "drop" },
          { kind: "return" },
        ],
        exportName: "drop_value",
      },
    ],
  };

  const bytes = encodeWasmModule(module);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  assert(WebAssembly.validate(buffer));
  const instance = await WebAssembly.instantiate(buffer);
  const exports = instance.instance.exports as {
    add(left: number, right: number): number;
    choose(flag: number, left: number, right: number): number;
    read_word(): number;
    read_byte(): number;
    write_word(value: number): void;
    drop_value(): void;
    memory: WebAssembly.Memory;
  };

  assertEquals(exports.add(20, 22), 42);
  assertEquals(exports.choose(1, 10, 20), 10);
  assertEquals(exports.choose(0, 10, 20), 20);
  assertEquals(exports.read_word(), 21);
  assertEquals(exports.read_byte(), 7);
  exports.write_word(99);
  assertEquals(new DataView(exports.memory.buffer).getUint32(8, true), 99);
  exports.drop_value();
});

Deno.test("BRL Wasm IR verifier reports malformed modules", () => {
  const diagnostics = verifyWasmIr({
    functions: [
      {
        name: "broken",
        params: [{ name: "value", type: "i32" }],
        results: ["i32"],
        body: [
          { kind: "local.get", index: 99 },
          { kind: "i32.add" },
        ],
        exportName: "same",
      },
      {
        name: "duplicate",
        body: [
          { kind: "call", functionIndex: 99 },
          { kind: "br", depth: 0 },
        ],
        exportName: "same",
      },
    ],
  });
  const codes = new Set(diagnostics.map((diagnostic) => diagnostic.code));

  assert(codes.has("WASM_IR_DUPLICATE_EXPORT"));
  assert(codes.has("WASM_IR_INVALID_LOCAL"));
  assert(codes.has("WASM_IR_STACK_UNDERFLOW"));
  assert(codes.has("WASM_IR_INVALID_FUNCTION"));
  assert(codes.has("WASM_IR_INVALID_BRANCH"));
});

Deno.test("BRL Wasm IR verifier reports malformed memory modules", () => {
  const diagnostics = verifyWasmIr({
    memory: { minPages: 1 },
    dataSegments: [
      { offset: 65_536, bytes: [1] },
      { offset: 0, bytes: [256] },
    ],
    functions: [{
      name: "broken_memory",
      results: ["i32"],
      body: [
        { kind: "i32.const", value: 0 },
        { kind: "i32.load8_u", align: 1 },
        { kind: "return" },
      ],
    }],
  });
  const noMemoryDiagnostics = verifyWasmIr({
    functions: [{
      name: "no_memory",
      results: ["i32"],
      body: [
        { kind: "i32.const", value: 0 },
        { kind: "i32.load" },
        { kind: "return" },
      ],
    }],
  });
  const codes = new Set(
    [...diagnostics, ...noMemoryDiagnostics].map((diagnostic) =>
      diagnostic.code
    ),
  );

  assert(codes.has("WASM_IR_INVALID_MEMORY"));
});

Deno.test("BRL Wasm encoder refuses unverified IR", () => {
  let thrown: unknown;
  try {
    encodeWasmModule({
      functions: [{
        name: "broken",
        results: ["i32"],
        body: [],
        exportName: "broken",
      }],
    });
  } catch (error) {
    thrown = error;
  }

  assert(thrown instanceof WasmEncodeError);
  assert(String((thrown as Error).message).includes("Cannot encode invalid"));
});

Deno.test("BRL Wasm backend lowers verified scalar BRL IR", async () => {
  const brl = lowerBrlModule(parseBrlModule(`
fn add(left: u32, right: u32) -> u32 {
  let total: u32 = left + right;
  return total;
}

fn choose_large(left: u32, right: u32) -> u32 {
  return (left > right) as u32;
}

fn call_add(value: u32) -> u32 {
  return add(value, 5);
}

fn discard_call(value: u32) -> u32 {
  call_add(value);
  return value + 1;
}

fn low_byte(value: u32) -> u8 {
  return value as u8;
}

record Cursor {
  offset: u32;
  limit: u32;
}

record Window {
  values: span<u16>;
  cursor: Cursor;
}

fn cursor_width(cursor: Cursor) -> u32 {
  return cursor.limit - cursor.offset;
}

fn make_cursor(offset: u32, limit: u32) -> Cursor {
  return record Cursor { offset: offset, limit: limit };
}

fn constructed_cursor_width(offset: u32, limit: u32) -> u32 {
  let cursor: Cursor = make_cursor(offset, limit);
  return cursor_width(cursor);
}

fn forwarded_cursor_width(cursor: Cursor) -> u32 {
  return cursor_width(cursor);
}

fn identity_cursor(cursor: Cursor) -> Cursor {
  return cursor;
}

fn returned_cursor_width(cursor: Cursor) -> u32 {
  let returned: Cursor = identity_cursor(cursor);
  return cursor_width(returned);
}

fn window_value(window: Window, index: u32) -> u32 {
  return window.values[index] as u32;
}

fn window_span_length(window: Window) -> u32 {
  return span_len(window.values);
}

fn nested_cursor_width(window: Window) -> u32 {
  return cursor_width(window.cursor);
}

fn window_alias_value(window: Window, index: u32) -> u32 {
  let values: span<u16> = window.values;
  return values[index] as u32;
}

fn nested_cursor_alias_width(window: Window) -> u32 {
  let cursor: Cursor = window.cursor;
  return cursor_width(cursor);
}

fn window_reassign_value(window: Window, index: u32) -> u32 {
  let values: span<u16> = window.values;
  values = window.values;
  return values[index] as u32;
}

fn nested_cursor_reassign_width(window: Window) -> u32 {
  let cursor: Cursor = window.cursor;
  cursor = window.cursor;
  return cursor_width(cursor);
}

fn identity_values(values: span<u16>) -> span<u16> {
  return values;
}

fn returned_span_value(window: Window, index: u32) -> u32 {
  let values: span<u16> = identity_values(window.values);
  return values[index] as u32;
}

fn identity_window(window: Window) -> Window {
  return window;
}

fn returned_window_width(window: Window) -> u32 {
  let returned: Window = identity_window(window);
  return cursor_width(returned.cursor);
}

fn choose(flag: bool, left: u32, right: u32) -> u32 {
  if flag {
    return left;
  } else {
    return right;
  }
}

fn bump_if(value: u32, should_bump: bool) -> u32 {
  let result: u32 = value;
  if should_bump {
    result = result + 1;
  } else {
    result = result + 2;
  }
  return result;
}

fn sum_loop(limit: u32) -> u32 {
  let total: u32 = 0;
  let index: u32 = 0;
  while index < limit {
    total = total + index;
    index = index + 1;
  }
  return total;
}

fn sum_for(limit: u32) -> u32 {
  let total: u32 = 0;
  for index in 0..limit {
    total = total + index;
  }
  return total;
}

fn divide(left: u32, right: u32) -> u32 {
  return left / right;
}

fn remainder(left: u32, right: u32) -> u32 {
  return left % right;
}

fn shift_left(left: u32, right: u32) -> u32 {
  return left << right;
}

fn logical_and(left: bool, right: bool) -> bool {
  return left && right;
}

fn logical_or(left: bool, right: bool) -> bool {
  return left || right;
}

fn not_bool(value: bool) -> bool {
  return !value;
}

fn u8_increment(value: u8) -> u8 {
  return value + (1 as u8);
}

fn skip_and_stop(limit: u32) -> u32 {
  let total: u32 = 0;
  for index in 0..limit {
    if index == 2 {
      continue;
    }
    if index == 5 {
      break;
    }
    total = total + index;
  }
  return total;
}

fn while_control(limit: u32) -> u32 {
  let total: u32 = 0;
  let index: u32 = 0;
  while index < limit {
    index = index + 1;
    if index == 2 {
      continue;
    }
    if index == 5 {
      break;
    }
    total = total + index;
  }
  return total;
}

fn fail_bool() -> bool {
  trap();
}

fn eager_and_trap() -> bool {
  return false && fail_bool();
}

fn eager_or_trap() -> bool {
  return true || fail_bool();
}
`));
  const wasm = lowerBrlIrToWasm(brl);
  const bytes = encodeWasmModule(wasm);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  assert(WebAssembly.validate(buffer));
  const instance = await WebAssembly.instantiate(buffer);
  const exports = instance.instance.exports as {
    add(left: number, right: number): number;
    choose_large(left: number, right: number): number;
    call_add(value: number): number;
    discard_call(value: number): number;
    low_byte(value: number): number;
    cursor_width(offset: number, limit: number): number;
    constructed_cursor_width(offset: number, limit: number): number;
    forwarded_cursor_width(offset: number, limit: number): number;
    returned_cursor_width(offset: number, limit: number): number;
    window_value(
      valuesPointer: number,
      valuesLength: number,
      offset: number,
      limit: number,
      index: number,
    ): number;
    window_span_length(
      valuesPointer: number,
      valuesLength: number,
      offset: number,
      limit: number,
    ): number;
    nested_cursor_width(
      valuesPointer: number,
      valuesLength: number,
      offset: number,
      limit: number,
    ): number;
    window_alias_value(
      valuesPointer: number,
      valuesLength: number,
      offset: number,
      limit: number,
      index: number,
    ): number;
    nested_cursor_alias_width(
      valuesPointer: number,
      valuesLength: number,
      offset: number,
      limit: number,
    ): number;
    window_reassign_value(
      valuesPointer: number,
      valuesLength: number,
      offset: number,
      limit: number,
      index: number,
    ): number;
    nested_cursor_reassign_width(
      valuesPointer: number,
      valuesLength: number,
      offset: number,
      limit: number,
    ): number;
    returned_span_value(
      valuesPointer: number,
      valuesLength: number,
      offset: number,
      limit: number,
      index: number,
    ): number;
    returned_window_width(
      valuesPointer: number,
      valuesLength: number,
      offset: number,
      limit: number,
    ): number;
    choose(flag: number, left: number, right: number): number;
    bump_if(value: number, should_bump: number): number;
    sum_loop(limit: number): number;
    sum_for(limit: number): number;
    divide(left: number, right: number): number;
    remainder(left: number, right: number): number;
    shift_left(left: number, right: number): number;
    logical_and(left: number, right: number): number;
    logical_or(left: number, right: number): number;
    not_bool(value: number): number;
    u8_increment(value: number): number;
    skip_and_stop(limit: number): number;
    while_control(limit: number): number;
    eager_and_trap(): number;
    eager_or_trap(): number;
    memory: WebAssembly.Memory;
  };
  const windowValues = new Uint16Array(exports.memory.buffer, 16, 3);
  windowValues.set([144, 233, 377]);

  assertEquals(exports.add(20, 22), 42);
  assertEquals(exports.choose_large(9, 3), 1);
  assertEquals(exports.choose_large(3, 9), 0);
  assertEquals(exports.call_add(37), 42);
  assertEquals(exports.discard_call(41), 42);
  assertEquals(exports.low_byte(257), 1);
  assertEquals(exports.cursor_width(10, 42), 32);
  assertEquals(exports.constructed_cursor_width(10, 42), 32);
  assertEquals(exports.forwarded_cursor_width(10, 42), 32);
  assertEquals(exports.returned_cursor_width(10, 42), 32);
  assertEquals(exports.window_value(16, 3, 10, 42, 1), 233);
  assertEquals(exports.window_span_length(16, 3, 10, 42), 3);
  assertEquals(exports.nested_cursor_width(16, 3, 10, 42), 32);
  assertEquals(exports.window_alias_value(16, 3, 10, 42, 2), 377);
  assertEquals(exports.nested_cursor_alias_width(16, 3, 10, 42), 32);
  assertEquals(exports.window_reassign_value(16, 3, 10, 42, 0), 144);
  assertEquals(exports.nested_cursor_reassign_width(16, 3, 10, 42), 32);
  assertEquals(exports.returned_span_value(16, 3, 10, 42, 1), 233);
  assertEquals(exports.returned_window_width(16, 3, 10, 42), 32);
  assertEquals(exports.choose(1, 10, 20), 10);
  assertEquals(exports.choose(0, 10, 20), 20);
  assertEquals(exports.bump_if(40, 1), 41);
  assertEquals(exports.bump_if(40, 0), 42);
  assertEquals(exports.sum_loop(5), 10);
  assertEquals(exports.sum_for(5), 10);
  assertEquals(exports.divide(9, 3), 3);
  assertEquals(exports.remainder(10, 4), 2);
  assertEquals(exports.shift_left(1, 3), 8);
  assertEquals(exports.logical_and(1, 1), 1);
  assertEquals(exports.logical_and(1, 0), 0);
  assertEquals(exports.logical_or(0, 1), 1);
  assertEquals(exports.logical_or(0, 0), 0);
  assertEquals(exports.not_bool(1), 0);
  assertEquals(exports.not_bool(0), 1);
  assertEquals(exports.u8_increment(255), 0);
  assertThrows(() => exports.divide(1, 0), WebAssembly.RuntimeError);
  assertThrows(() => exports.remainder(1, 0), WebAssembly.RuntimeError);
  assertThrows(() => exports.shift_left(1, 32), WebAssembly.RuntimeError);
  assertThrows(() => exports.eager_and_trap(), WebAssembly.RuntimeError);
  assertThrows(() => exports.eager_or_trap(), WebAssembly.RuntimeError);
  assertEquals(exports.skip_and_stop(10), 8);
  assertEquals(exports.while_control(10), 8);
});

Deno.test("BRL Wasm backend lowers span reads through linear memory", async () => {
  const brl = lowerBrlModule(parseBrlModule(`
fn read_at(values: span<u16>, index: u32) -> u32 {
  return values[index] as u32;
}

fn span_length(values: span<u16>) -> u32 {
  return span_len(values);
}

fn sum_span(values: span<u16>, limit: u32) -> u32 {
  let total: u32 = 0;
  for index in 0..limit {
    total = total + values[index] as u32;
  }
  return total;
}

fn read_first(values: span<u16>) -> u32 {
  return read_at(values, 0);
}
`));
  const wasm = lowerBrlIrToWasm(brl);
  const bytes = encodeWasmModule(wasm);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  assert(WebAssembly.validate(buffer));
  const instance = await WebAssembly.instantiate(buffer);
  const exports = instance.instance.exports as {
    memory: WebAssembly.Memory;
    read_at(pointer: number, length: number, index: number): number;
    span_length(pointer: number, length: number): number;
    sum_span(pointer: number, length: number, limit: number): number;
    read_first(pointer: number, length: number): number;
  };
  const values = new Uint16Array(exports.memory.buffer, 16, 4);
  values.set([3, 5, 8, 13]);

  assertEquals(exports.read_at(16, 4, 2), 8);
  assertEquals(exports.span_length(16, 4), 4);
  assertEquals(exports.sum_span(16, 4, 4), 29);
  assertEquals(exports.read_first(16, 4), 3);
  assertThrows(() => exports.read_at(16, 4, 4), WebAssembly.RuntimeError);
});

Deno.test("BRL Wasm backend validates shared runtime BRL sources", async () => {
  const brl = lowerBrlModule(parseBrlModule(`${await readSharedRuntimeSource()}
fn source_step_width_for_test(input: span<u16>, offset: u32) -> u32 {
  let step: SourceStep = source_step(input, offset);
  return step.width;
}

fn source_step_next_for_test(input: span<u16>, offset: u32) -> u32 {
  let step: SourceStep = source_step(input, offset);
  return step.next;
}

fn token_stream_validation_statuses_for_test() -> u32 {
  let total: u32 = token_stream_span_bounds_status(4, 2, 8) * 100000000;
  total = total + token_stream_span_bounds_status(4, 9, 8) * 10000000;
  total = total + token_stream_span_position_status(4, 2) * 1000000;
  total = total + token_stream_span_position_status(2, 4) * 100000;
  total = total + token_stream_width_status(4, 4) * 10000;
  total = total + token_stream_eof_status(0, 1, 8, 8, 8) * 1000;
  total = total + token_stream_eof_status(1, 1, 8, 8, 8) * 100;
  total = total + token_stream_gap_token_status(3, 4, 6, 4, 6) * 10;
  return total + token_stream_gap_token_status(2, 4, 6, 4, 6);
}

fn token_stream_match_statuses_for_test() -> u32 {
  let total: u32 = token_stream_token_match_status(2, 2, 4, 4, 7, 7, 1, 3, 1, 3) * 1000000;
  total = total + token_stream_token_match_status(2, 3, 4, 4, 7, 7, 1, 3, 1, 3) * 100000;
  total = total + token_stream_token_match_status(2, 2, 4, 5, 7, 7, 1, 3, 1, 3) * 10000;
  total = total + token_stream_canonical_match_status(2, 0, 4, 4) * 1000;
  total = total + token_stream_canonical_match_status(3, 7, 4, 4) * 100;
  total = total + token_stream_canonical_match_status(3, 7, 4, 2) * 10;
  return total + token_stream_final_status(0, 0, 2, 2, 4);
}

fn parser_action_statuses_for_test() -> u32 {
  let reduce: u32 = 33554432 + 42;
  let accept: u32 = 50331648;
  let total: u32 = parser_action_kind(reduce) / 16777216;
  total = total * 1000 + parser_action_payload(reduce);
  total = total * 10 + (parser_is_accept(reduce) as u32);
  return total * 10 + (parser_is_accept(accept) as u32);
}

fn diagnostic_statuses_for_test() -> u32 {
  let total: u32 = diagnostic_detail_kind_id(1001) * 1000000;
  total = total + diagnostic_detail_kind_id(1002) * 100000;
  total = total + diagnostic_detail_kind_id(7) * 10000;
  total = total + diagnostic_code_status(7, 7) * 1000;
  total = total + diagnostic_code_status(7, 8) * 100;
  total = total + diagnostic_merge_status(0, 0) * 10;
  return total + diagnostic_merge_status(2, 0);
}

fn cst_statuses_for_test() -> u32 {
  let total: u32 = (cst_field_accepts_count(1, 0) as u32) * 100000;
  total = total + (cst_field_accepts_count(2, 0) as u32) * 10000;
  total = total + (cst_field_accepts_count(0, 0) as u32) * 1000;
  total = total + (cst_field_accepts_count(0, 1) as u32) * 100;
  total = total + cst_child_span_start(7, 3) * 10;
  return total + cst_child_span_end(7, 3);
}
`));
  const wasm = lowerBrlIrToWasm(brl);
  const bytes = encodeWasmModule(wasm);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

  assert(WebAssembly.validate(buffer));
  const instance = await WebAssembly.instantiate(buffer);
  const exports = instance.instance.exports as {
    source_step_width_for_test(
      pointer: number,
      length: number,
      offset: number,
    ): number;
    source_step_next_for_test(
      pointer: number,
      length: number,
      offset: number,
    ): number;
    token_stream_validation_statuses_for_test(): number;
    token_stream_match_statuses_for_test(): number;
    parser_action_statuses_for_test(): number;
    diagnostic_statuses_for_test(): number;
    cst_statuses_for_test(): number;
    memory: WebAssembly.Memory;
  };
  const ascii = new Uint16Array(exports.memory.buffer, 16, 2);
  ascii.set([65, 66]);
  const surrogate = new Uint16Array(exports.memory.buffer, 32, 2);
  surrogate.set([0xd83d, 0xde00]);

  assertEquals(exports.source_step_width_for_test(16, 2, 0), 1);
  assertEquals(exports.source_step_next_for_test(16, 2, 0), 1);
  assertEquals(exports.source_step_width_for_test(32, 2, 0), 2);
  assertEquals(exports.source_step_next_for_test(32, 2, 0), 2);
  assertEquals(exports.token_stream_validation_statuses_for_test(), 112340506);
  assertEquals(exports.token_stream_match_statuses_for_test(), 770122);
  assertEquals(exports.parser_action_statuses_for_test(), 204201);
  assertEquals(exports.diagnostic_statuses_for_test(), 1100101);
  assertEquals(exports.cst_statuses_for_test(), 110137);
});

Deno.test("BRL Wasm backend lowers vector reads through linear memory", async () => {
  const brl = lowerBrlModule(parseBrlModule(`
fn first(values: vec<u16>) -> u32 {
  return values[0] as u32;
}

fn vector_length(values: vec<u16>) -> u32 {
  return vec_len(values);
}

fn forwarded_length(values: vec<u16>) -> u32 {
  return vector_length(values);
}
`));
  const wasm = lowerBrlIrToWasm(brl);
  const bytes = encodeWasmModule(wasm);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  assert(WebAssembly.validate(buffer));
  const instance = await WebAssembly.instantiate(buffer);
  const exports = instance.instance.exports as {
    first(pointer: number, length: number): number;
    vector_length(pointer: number, length: number): number;
    forwarded_length(pointer: number, length: number): number;
    memory: WebAssembly.Memory;
  };
  const values = new Uint16Array(exports.memory.buffer, 16, 3);
  values.set([21, 34, 55]);

  assertEquals(exports.first(16, 3), 21);
  assertEquals(exports.vector_length(16, 3), 3);
  assertEquals(exports.forwarded_length(16, 3), 3);
});

function assertThrows(
  fn: () => unknown,
  expected: abstract new (...args: never[]) => Error,
): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof expected);
}

async function readSharedRuntimeSource(): Promise<string> {
  const files = [
    "source_map.brl",
    "lexer.brl",
    "parser.brl",
    "branch_search.brl",
    "reductions.brl",
    "cst.brl",
    "token_stream.brl",
    "diagnostics.brl",
  ];
  const sources = await Promise.all(
    files.map((file) => Deno.readTextFile(`src/runtime/${file}`)),
  );
  return sources.join("\n");
}
