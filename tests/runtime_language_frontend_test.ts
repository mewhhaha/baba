import {
  BrlTypeScriptBackendError,
  emitBrlTypeScriptRuntime,
} from "../src/runtime_language/backends/typescript/emit.ts";
import { lowerBrlModule } from "../src/runtime_language/lower.ts";
import { parseBrlModule } from "../src/runtime_language/parser.ts";
import { typecheckBrlModule } from "../src/runtime_language/typecheck.ts";
import { verifyRuntimeIr } from "../src/runtime_language/verify.ts";
import { assert, assertEquals } from "./helpers.ts";

Deno.test("runtime language frontend parses a representative module", () => {
  const module = parseBrlModule(`
import runtime.lexer;

record Cursor {
  offset: u32;
  limit: u32;
}

enum Step {
  Done,
  Token(u32, u32),
  Error(u32),
}

fn scan(input: span<u16>, start: u32) -> u32 {
  let offset: u32 = start;
  while offset < input.length {
    offset = offset + 1;
  }
  if offset == start {
    return 0;
  } else {
    return offset as u32;
  }
}
`);

  assertEquals(module.diagnostics.length, 0);
  assertEquals(module.items.length, 4);
  assertEquals(module.items[0].kind, "import");
  assertEquals(module.items[1].kind, "record");
  assertEquals(module.items[2].kind, "enum");
  assertEquals(module.items[3].kind, "function");

  const record = module.items[1];
  assert(record.kind === "record");
  assertEquals(record.name.text, "Cursor");
  assertEquals(record.fields.length, 2);
  assertEquals(record.fields[0].type.kind, "scalar");

  const fn = module.items[3];
  assert(fn.kind === "function");
  assertEquals(fn.name.text, "scan");
  assert(fn.result?.kind, "scalar");
  assertEquals(fn.parameters[0].type.kind, "span");
  assertEquals(fn.body.statements.length, 3);
});

Deno.test("runtime language conformance fixtures parse, check, and verify", async () => {
  for await (
    const entry of Deno.readDir("src/runtime_language/fixtures/valid")
  ) {
    if (!entry.isFile || !entry.name.endsWith(".brl")) continue;
    const path = `src/runtime_language/fixtures/valid/${entry.name}`;
    const source = await Deno.readTextFile(path);
    const ir = lowerBrlModule(parseBrlModule(source));
    const verifierDiagnostics = verifyRuntimeIr(ir);

    assertEquals(
      ir.diagnostics.length,
      0,
      `${path} produced frontend diagnostics: ${
        ir.diagnostics.map((diagnostic) => diagnostic.code).join(", ")
      }`,
    );
    assertEquals(
      verifierDiagnostics.length,
      0,
      `${path} produced IR diagnostics: ${
        verifierDiagnostics.map((diagnostic) => diagnostic.code).join(", ")
      }`,
    );
  }

  for await (
    const entry of Deno.readDir("src/runtime_language/fixtures/invalid")
  ) {
    if (!entry.isFile || !entry.name.endsWith(".brl")) continue;
    const path = `src/runtime_language/fixtures/invalid/${entry.name}`;
    const source = await Deno.readTextFile(path);
    const expected = expectedDiagnosticCodes(source);
    const checked = typecheckBrlModule(parseBrlModule(source));
    const actual: Set<string> = new Set(
      checked.diagnostics.map((diagnostic) => diagnostic.code),
    );

    for (const code of expected) {
      assert(actual.has(code), `${path} did not report ${code}.`);
    }
  }
});

Deno.test("shared BRL runtime sources parse, verify, and emit TypeScript", async () => {
  const source = `${await readSharedRuntimeSource()}
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
`;
  const parsed = parseBrlModule(source);
  const checked = typecheckBrlModule(parsed);
  const ir = lowerBrlModule(parsed);
  const emitted = emitBrlTypeScriptRuntime(ir);

  assertEquals(parsed.diagnostics.length, 0);
  assertEquals(checked.diagnostics.length, 0);
  assertEquals(ir.diagnostics.length, 0);
  assertEquals(verifyRuntimeIr(ir).length, 0);
  assert(emitted.includes("function lexer_scan_identifier"));

  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${tempDir}/runtime.ts`, emitted);
    await Deno.writeTextFile(
      `${tempDir}/run.ts`,
      `
import { cst_statuses_for_test, diagnostic_statuses_for_test, parser_action_statuses_for_test, source_step_next_for_test, source_step_width_for_test, token_stream_match_statuses_for_test, token_stream_validation_statuses_for_test } from "./runtime.ts";

function assertEquals(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(label + ": expected " + String(expected) + ", got " + String(actual));
  }
}

assertEquals(source_step_width_for_test([65, 66], 0), 1, "ascii width");
assertEquals(source_step_next_for_test([65, 66], 0), 1, "ascii next");
assertEquals(source_step_width_for_test([0xd83d, 0xde00], 0), 2, "surrogate width");
assertEquals(source_step_next_for_test([0xd83d, 0xde00], 0), 2, "surrogate next");
assertEquals(token_stream_validation_statuses_for_test(), 112340506, "token stream validation statuses");
assertEquals(token_stream_match_statuses_for_test(), 770122, "token stream match statuses");
assertEquals(parser_action_statuses_for_test(), 204201, "parser action statuses");
assertEquals(diagnostic_statuses_for_test(), 1100101, "diagnostic statuses");
assertEquals(cst_statuses_for_test(), 110137, "cst statuses");
`,
    );
    const run = new Deno.Command(Deno.execPath(), {
      args: ["run", `${tempDir}/run.ts`],
      stdout: "piped",
      stderr: "piped",
    });
    const result = await run.output();
    assertEquals(
      result.code,
      0,
      `Generated TypeScript shared runtime did not execute:\n${
        new TextDecoder().decode(result.stderr)
      }`,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("BRL TypeScript backend emits checked source from verified IR", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    for await (
      const entry of Deno.readDir("src/runtime_language/fixtures/valid")
    ) {
      if (!entry.isFile || !entry.name.endsWith(".brl")) continue;
      const sourcePath = `src/runtime_language/fixtures/valid/${entry.name}`;
      const source = await Deno.readTextFile(sourcePath);
      const ir = lowerBrlModule(parseBrlModule(source));
      const emitted = emitBrlTypeScriptRuntime(ir, {
        moduleName: sourcePath,
      });

      assert(emitted.includes("Source: verified BRL IR"));
      assertEquals(emitted.includes(": any"), false);

      const outputPath = `${tempDir}/${entry.name}.ts`;
      await Deno.writeTextFile(outputPath, emitted);
      const check = new Deno.Command(Deno.execPath(), {
        args: ["check", outputPath],
        stdout: "piped",
        stderr: "piped",
      });
      const result = await check.output();
      assertEquals(
        result.code,
        0,
        `${sourcePath} emitted invalid TypeScript:\n${
          new TextDecoder().decode(result.stderr)
        }`,
      );
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

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

Deno.test("BRL TypeScript backend executes lowered control flow", async () => {
  const source = `
import runtime.intrinsics;

record Cursor {
  offset: u32;
  limit: u32;
}

fn choose(flag: bool, left: u32, right: u32) -> u32 {
  if flag {
    return left;
  } else {
    return right;
  }
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

fn sum_span(values: span<u16>, depth: u32) -> u32 {
  let total: u32 = 0;
  for index in 0..depth {
    total = total + values[index] as u32;
  }
  return total;
}

fn add_one(value: u32) -> u32 {
  return value + 1;
}

fn call_add_one(value: u32) -> u32 {
  return add_one(value);
}

fn cursor_offset(cursor: Cursor) -> u32 {
  return cursor.offset;
}

fn make_cursor(offset: u32, limit: u32) -> Cursor {
  return record Cursor { offset: offset, limit: limit };
}

fn constructed_cursor_offset(offset: u32, limit: u32) -> u32 {
  let cursor: Cursor = make_cursor(offset, limit);
  return cursor.offset;
}

fn cursor_alias_offset(cursor: Cursor) -> u32 {
  let copy: Cursor = cursor;
  return copy.offset;
}

fn identity_cursor(cursor: Cursor) -> Cursor {
  return cursor;
}

fn returned_cursor_offset(cursor: Cursor) -> u32 {
  let returned: Cursor = identity_cursor(cursor);
  return returned.offset;
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

fn first_at_or_after(start: u32, stop: u32) -> u32 {
  let index: u32 = start;
  while index < stop {
    if index == 3 {
      break;
    }
    index = index + 1;
    continue;
  }
  return index;
}

fn u8_increment(value: u8) -> u8 {
  return value + (1 as u8);
}

fn u16_narrow(value: u32) -> u16 {
  return value as u16;
}

fn i32_narrow(value: u32) -> i32 {
  return value as i32;
}

fn truthy(value: u32) -> bool {
  return value as bool;
}

fn signed_less(left: i32, right: i32) -> bool {
  return left < right;
}

fn unsigned_less(left: u32, right: u32) -> bool {
  return left < right;
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

fn divide(left: u32, right: u32) -> u32 {
  return left / right;
}

fn shift_left(left: u32, right: u32) -> u32 {
  return left << right;
}

fn read_at(values: span<u16>, index: u32) -> u32 {
  return values[index] as u32;
}

fn span_length(values: span<u16>) -> u32 {
  return span_len(values);
}

fn vec_length(values: vec<u16>) -> u32 {
  return vec_len(values);
}

fn fail() -> u32 {
  trap();
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
`;
  const ir = lowerBrlModule(parseBrlModule(source));
  const emitted = emitBrlTypeScriptRuntime(ir);
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${tempDir}/runtime.ts`, emitted);
    await Deno.writeTextFile(
      `${tempDir}/run.ts`,
      `
import { add_one, call_add_one, choose, divide, eager_and_trap, eager_or_trap, fail, first_at_or_after, i32_narrow, logical_and, logical_or, not_bool, read_at, shift_left, signed_less, skip_and_stop, span_length, sum_loop, sum_span, truthy, u16_narrow, u8_increment, unsigned_less, vec_length } from "./runtime.ts";
import { constructed_cursor_offset, cursor_alias_offset, cursor_offset, returned_cursor_offset } from "./runtime.ts";

function assertEquals(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(label + ": expected " + String(expected) + ", got " + String(actual));
  }
}

function assertThrows(fn: () => unknown, expected: string): void {
  try {
    fn();
  } catch (error) {
    if (String((error as Error).message).includes(expected)) return;
    throw error;
  }
  throw new Error("Expected throw containing " + expected);
}

assertEquals(choose(true, 10, 20), 10, "choose true");
assertEquals(choose(false, 10, 20), 20, "choose false");
assertEquals(sum_loop(5), 10, "sum_loop");
assertEquals(sum_span([3, 4, 5], 3), 12, "sum_span");
assertEquals(add_one(41), 42, "add_one");
assertEquals(call_add_one(9), 10, "call_add_one");
assertEquals(cursor_offset({ offset: 17, limit: 99 }), 17, "cursor_offset");
assertEquals(constructed_cursor_offset(17, 99), 17, "constructed_cursor_offset");
assertEquals(cursor_alias_offset({ offset: 17, limit: 99 }), 17, "cursor_alias_offset");
assertEquals(returned_cursor_offset({ offset: 17, limit: 99 }), 17, "returned_cursor_offset");
assertEquals(skip_and_stop(10), 8, "skip_and_stop");
assertEquals(first_at_or_after(0, 9), 3, "first_at_or_after break");
assertEquals(first_at_or_after(7, 9), 9, "first_at_or_after fallthrough");
assertEquals(u8_increment(255), 0, "u8 wraps");
assertEquals(u16_narrow(65537), 1, "u16 narrows");
assertEquals(i32_narrow(0xffffffff), -1, "i32 narrows");
assertEquals(truthy(0), false, "zero bool cast");
assertEquals(truthy(7), true, "nonzero bool cast");
assertEquals(signed_less(-1, 1), true, "signed less");
assertEquals(unsigned_less(0xffffffff, 1), false, "unsigned less");
assertEquals(logical_and(true, true), true, "logical and true");
assertEquals(logical_and(true, false), false, "logical and false");
assertEquals(logical_or(false, true), true, "logical or true");
assertEquals(logical_or(false, false), false, "logical or false");
assertEquals(not_bool(true), false, "not true");
assertEquals(not_bool(false), true, "not false");
assertEquals(divide(9, 3), 3, "divide");
assertThrows(() => divide(1, 0), "division by zero");
assertEquals(shift_left(1, 3), 8, "shift left");
assertThrows(() => shift_left(1, 32), "shift count");
assertEquals(read_at([9, 8], 1), 8, "read_at");
assertThrows(() => read_at([9, 8], 2), "index out of bounds");
assertEquals(span_length([1, 2, 3]), 3, "span_len intrinsic");
assertEquals(vec_length([1, 2, 3, 4]), 4, "vec_len intrinsic");
assertThrows(() => fail(), "BRL trap");
assertThrows(() => eager_and_trap(), "BRL trap");
assertThrows(() => eager_or_trap(), "BRL trap");
`,
    );
    const run = new Deno.Command(Deno.execPath(), {
      args: ["run", `${tempDir}/run.ts`],
      stdout: "piped",
      stderr: "piped",
    });
    const result = await run.output();
    assertEquals(
      result.code,
      0,
      `Generated TypeScript did not execute:\n${
        new TextDecoder().decode(result.stderr)
      }`,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("BRL TypeScript backend rejects unverified IR", () => {
  const ir = lowerBrlModule(parseBrlModule(`
fn main() -> u32 {
  return 1;
}
`));
  const broken = {
    ...ir,
    functions: [{
      ...ir.functions[0],
      blocks: [{
        ...ir.functions[0].blocks[0],
        terminator: null,
      }],
    }],
  };

  let thrown: unknown;
  try {
    emitBrlTypeScriptRuntime(broken);
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof BrlTypeScriptBackendError);
  assert(String((thrown as Error).message).includes("unverified BRL IR"));
});

Deno.test("runtime language frontend reports multiple syntax diagnostics", () => {
  const module = parseBrlModule(`
fn broken( {
  let = ;
}
record MissingName {
  value: ;
}
`);

  assert(module.diagnostics.length >= 3);
  assert(
    module.diagnostics.some((diagnostic) =>
      diagnostic.code === "BRL_PARSE_EXPECTED" &&
      diagnostic.message.includes("parameter name")
    ),
  );
  assert(
    module.diagnostics.some((diagnostic) =>
      diagnostic.code === "BRL_PARSE_EXPECTED" &&
      diagnostic.message.includes("Expected type")
    ),
  );
});

Deno.test("runtime language frontend preserves source spans", () => {
  const source =
    "fn scan(input: span<u16>) -> u32 { return input[0] as u32; }\n";
  const module = parseBrlModule(source);

  assertEquals(module.diagnostics.length, 0);
  const fn = module.items[0];
  assert(fn.kind === "function");
  assertEquals(fn.name.span.start, source.indexOf("scan"));
  assertEquals(fn.name.span.end, source.indexOf("scan") + "scan".length);
  assertEquals(fn.name.span.line, 1);
  assertEquals(fn.name.span.column, 4);
  assertEquals(fn.body.span.end, source.indexOf("}") + 1);
});

Deno.test("runtime language frontend reports semantic diagnostics", () => {
  const module = parseBrlModule(`
import runtime.missing;

record Cursor {
  next: Cursor;
  offset: u32;
  offset: u16;
}

fn scan(input: span<u16>, input: u32) -> bool {
  let offset: u32 = true;
  while offset {
    missing = 1;
  }
  return offset as bool;
}

fn bad_cast(values: span<u16>) -> bool {
  return values as bool;
}

fn bad_span_len(value: u32) -> u32 {
  return span_len(value);
}

fn bad_not(value: u32) -> bool {
  return !value;
}

fn bad_trap() -> u32 {
  return trap();
}

fn bad_vec_push(values: vec<u16>, value: u16) -> u32 {
  return vec_push(values, value);
}
`);

  const checked = typecheckBrlModule(module);
  const codes = new Set(
    checked.diagnostics.map((diagnostic) => diagnostic.code),
  );
  assert(codes.has("BRL_RESOLVE_INVALID_IMPORT"));
  assert(codes.has("BRL_RESOLVE_RECURSIVE_TYPE"));
  assert(codes.has("BRL_RESOLVE_DUPLICATE_FIELD"));
  assert(codes.has("BRL_RESOLVE_DUPLICATE_LOCAL"));
  assert(codes.has("BRL_TYPE_ASSIGNMENT"));
  assert(codes.has("BRL_TYPE_CONDITION"));
  assert(codes.has("BRL_RESOLVE_UNKNOWN_NAME"));
  assert(codes.has("BRL_TYPE_CAST"));
  assert(codes.has("BRL_TYPE_UNSUPPORTED"));
  assert(codes.has("BRL_TYPE_INTRINSIC"));
});

function expectedDiagnosticCodes(source: string): readonly string[] {
  return source.split(/\r?\n/)
    .map((line) => /^\/\/ expect: ([A-Z0-9_]+)$/.exec(line)?.[1])
    .filter((code): code is string => code !== undefined);
}

Deno.test("runtime language frontend lowers valid source to verified IR", () => {
  const module = parseBrlModule(`
fn add(left: u32, right: u32) -> u32 {
  let total: u32 = left + right;
  return total;
}
`);
  const ir = lowerBrlModule(module);

  assertEquals(ir.diagnostics.length, 0);
  assertEquals(ir.functions.length, 1);
  assertEquals(ir.functions[0].blocks.length, 1);
  assertEquals(verifyRuntimeIr(ir).length, 0);
});

Deno.test("runtime language IR verifier reports malformed programs", () => {
  const span = { start: 0, end: 1, line: 1, column: 1 };
  const u32 = { kind: "scalar" as const, name: "u32" as const };
  const bool = { kind: "scalar" as const, name: "bool" as const };
  const diagnostics = verifyRuntimeIr({
    records: [{
      id: 1,
      name: "Bad",
      fields: [{
        id: 1,
        name: "x",
        type: { kind: "record", id: 99, name: "Missing" },
        span,
      }],
      span,
    }, {
      id: 2,
      name: "Pair",
      fields: [
        { id: 2, name: "left", type: u32, span },
        { id: 3, name: "right", type: bool, span },
      ],
      span,
    }],
    diagnostics: [],
    functions: [{
      id: 1,
      name: "main",
      params: [],
      result: u32,
      locals: [{ id: 0, name: "value", type: u32, initialized: false, span }],
      span,
      blocks: [
        {
          id: 0,
          span,
          instructions: [{
            kind: "evaluate",
            value: { kind: "local", local: 0, type: u32, span },
            span,
          }],
          terminator: { kind: "jump", target: 99, span },
        },
        {
          id: 1,
          span,
          instructions: [],
          terminator: {
            kind: "return",
            value: {
              kind: "record",
              type: { kind: "record", id: 2, name: "Pair" },
              fields: [
                {
                  fieldId: 2,
                  value: { kind: "literal", type: bool, value: true, span },
                  span,
                },
              ],
              span,
            },
            span,
          },
        },
        { id: 2, span, instructions: [], terminator: null },
      ],
    }],
  });
  const codes = new Set(diagnostics.map((diagnostic) => diagnostic.code));

  assert(codes.has("BRL_IR_INVALID_FIELD"));
  assert(codes.has("BRL_IR_USE_BEFORE_DEFINITION"));
  assert(codes.has("BRL_IR_INVALID_BRANCH"));
  assert(codes.has("BRL_IR_RETURN_TYPE"));
  assert(codes.has("BRL_IR_MISSING_TERMINATOR"));
});
