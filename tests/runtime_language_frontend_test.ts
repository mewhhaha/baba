import {
  BrlTypeScriptBackendError,
  emitBrlTypeScriptRuntime,
} from "../src/runtime_language/backends/typescript/emit.ts";
import { lowerBrlModule } from "../src/runtime_language/lower.ts";
import { parseBrlModule } from "../src/runtime_language/parser.ts";
import { typecheckBrlModule } from "../src/runtime_language/typecheck.ts";
import { verifyRuntimeIr } from "../src/runtime_language/verify.ts";
import {
  assert,
  assertEquals,
  assertIncludes,
  assertNotIncludes,
} from "./helpers.ts";

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

Deno.test("runtime language Stage-0 spec documents current drift checks", async () => {
  const spec = await Deno.readTextFile("src/runtime_language/SPEC.md");
  assertIncludes(spec, "## Stage-0 Bootstrap");
  assertIncludes(spec, "`deno task bootstrap:check`");
  assertIncludes(spec, "runtime-language compiler");
  assertIncludes(spec, "TypeScript/Wasm helper artifact manifest");
  assertNotIncludes(spec, "until T10 adds drift detection");
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
    assert(
      expected.length > 0,
      `${path} must declare at least one // expect: DIAGNOSTIC_CODE line.`,
    );
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

fn source_statuses_for_test() -> u32 {
  let total: u32 = source_text_offset_status(2, 4) * 1000000;
  total = total + source_text_offset_status(4, 4) * 100000;
  total = total + source_text_span_status(1, 3, 4) * 10000;
  total = total + source_text_span_status(3, 1, 4) * 1000;
  total = total + source_text_span_status(1, 5, 4) * 100;
  total = total + source_text_has_trail_unit(2, 4) * 10;
  return total + source_text_has_trail_unit(3, 4);
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
  total = total + token_stream_gap_token_status(2, 4, 6, 4, 6);
  return (total * 10) + token_stream_eof_sequence_status(1);
}

fn token_stream_match_statuses_for_test() -> u32 {
  let total: u32 = token_stream_token_match_status(2, 2, 4, 4, 7, 7, 1, 3, 1, 3) * 1000000;
  total = total + token_stream_token_match_status(2, 3, 4, 4, 7, 7, 1, 3, 1, 3) * 100000;
  total = total + token_stream_token_match_status(2, 2, 4, 5, 7, 7, 1, 3, 1, 3) * 10000;
  total = total + token_stream_canonical_match_status(2, 0, 4, 4) * 1000;
  total = total + token_stream_canonical_match_status(3, 7, 4, 4) * 100;
  total = total + token_stream_canonical_match_status(3, 7, 4, 2) * 10;
  total = total + token_stream_final_status(0, 0, 2, 2, 4);
  return (total * 100) + ((token_stream_gap_is_empty(4, 4) as u32) * 10) +
    (token_stream_can_advance(4, 4) as u32);
}

fn token_stream_public_statuses_for_test() -> u32 {
  let total: u32 = token_stream_public_token_shape_status(1, 1, 1) * 10000000;
  total = total + token_stream_public_token_shape_status(1, 2, 1) * 1000000;
  total = total + token_stream_public_token_shape_status(2, 2, 0) * 100000;
  total = total + token_stream_public_token_shape_status(3, 1, 0) * 10000;
  total = total + token_stream_public_token_shape_status(9, 1, 0) * 1000;
  total = total + token_stream_trace_stream_status(3) * 100;
  total = total + token_stream_trace_stream_status(5) * 10;
  return total + token_stream_shifted_token_status(3);
}

fn token_stream_trace_step_statuses_for_test() -> u32 {
  let eof_step: u32 = token_stream_trace_step(5, 4294967295, 8, 99);
  let trivia_step: u32 = token_stream_trace_step(3, 4294967295, 7, 99);
  let total: u32 = token_stream_public_index(7, 4) * 10000000;
  total = total + token_stream_trace_terminal(5, 8, 9, 6) * 100000;
  total = total + token_stream_trace_terminal(2, 8, 9, 6) * 1000;
  total = total + token_stream_trace_step_status(eof_step) * 100;
  total = total + token_stream_trace_step_terminal(eof_step);
  total = total + token_stream_trace_step_status(trivia_step);
  return total + token_stream_trace_step_terminal(trivia_step);
}

fn lexer_statuses_for_test() -> u32 {
  let total: u32 = lexer_token_emit_status(2, 0) * 100000000;
  total = total + lexer_token_emit_status(2, 1) * 10000000;
  total = total + lexer_spec_token_class(1) * 1000000;
  total = total + lexer_spec_token_class(2) * 100000;
  total = total + lexer_spec_token_class(0) * 10000;
  total = total + lexer_spec_public_token_status(1, 2) * 1000;
  total = total + lexer_spec_public_token_status(2, 3) * 100;
  total = total + lexer_token_diagnostic_status(4, 4294967295) * 10;
  return total + lexer_token_diagnostic_status(2, 4294967295);
}

fn lexer_public_token_classes_for_test() -> u32 {
  let total: u32 = lexer_public_token_class(1) * 100;
  total = total + lexer_public_token_class(2) * 10;
  return total + lexer_public_token_class(3);
}

fn lexer_dfa_transition_statuses_for_test(rows: span<u32>, values: span<u32>) -> u32 {
  let total: u32 = lexer_dfa_transition_test_status(
    lexer_dfa_transition(rows, values, 0, 66),
  ) * 100000000;
  total = total + lexer_dfa_transition_test_status(
    lexer_dfa_transition(rows, values, 0, 96),
  ) * 1000000;
  total = total + lexer_dfa_transition_test_status(
    lexer_dfa_transition(rows, values, 0, 97),
  ) * 10000;
  total = total + lexer_dfa_transition_test_status(
    lexer_dfa_transition(rows, values, 1, 52),
  ) * 100;
  return total + lexer_dfa_transition_test_status(
    lexer_dfa_transition(rows, values, 1, 65),
  );
}

fn lexer_dfa_transition_test_status(value: u32) -> u32 {
  if value == 4294967295 {
    return 99;
  }
  return value;
}

fn lexer_driver_event_statuses_for_test() -> u32 {
  let total: u32 = lexer_driver_begin_event(0, 2) * 100000000;
  total = total + lexer_driver_begin_event(2, 2) * 10000000;
  total = total + lexer_driver_finalize_event(4294967295, 1, 1, 1, 3) * 1000000;
  total = total + lexer_driver_finalize_event(7, 2, 1, 1, 3) * 100000;
  total = total + lexer_driver_finalize_event(7, 2, 0, 1, 3) * 10000;
  total = total + lexer_driver_finalize_event(7, 2, 0, 3, 3) * 1000;
  total = total + lexer_driver_consume_event(0, 1, 3) * 100;
  total = total + lexer_driver_event_test_status(
    lexer_driver_consume_event(1, 1, 3),
  ) * 10;
  return total + lexer_driver_consume_event(2, 1, 3);
}

fn lexer_driver_event_test_status(value: u32) -> u32 {
  if value == 4294967295 {
    return 9;
  }
  return value;
}

fn parser_action_statuses_for_test() -> u32 {
  let reduce: u32 = 33554432 + 42;
  let accept: u32 = 50331648;
  let total: u32 = parser_action_kind(reduce) / 16777216;
  total = total * 1000 + parser_action_payload(reduce);
  total = total * 10 + (parser_is_accept(reduce) as u32);
  return total * 10 + (parser_is_accept(accept) as u32);
}

fn parser_action_count_statuses_for_test(actions: span<u32>) -> u32 {
  let total: u32 = parser_action_count(actions, 0) * 100;
  total = total + parser_action_count(actions, 3) * 10;
  return total + parser_action_count(actions, 5);
}

fn parser_table_lookup_statuses_for_test(rows: span<u32>, entries: span<u32>) -> u32 {
  let total: u32 = parser_table_lookup(rows, entries, 0, 1, 99) * 100000000;
  total = total + parser_table_lookup(rows, entries, 0, 2, 99) * 1000000;
  total = total + parser_table_lookup(rows, entries, 0, 3, 99) * 10000;
  total = total + parser_table_lookup(rows, entries, 1, 2, 99) * 100;
  return total + parser_table_lookup(rows, entries, 1, 4, 99);
}

fn parser_table_lookup_at_statuses_for_test(rows: span<u32>, entries: span<u32>) -> u32 {
  let total: u32 = parser_table_lookup_at(rows, entries, 0, 2, 0, 99) * 100000000;
  total = total + parser_table_lookup_at(rows, entries, 0, 2, 1, 99) * 1000000;
  total = total + parser_table_lookup_at(rows, entries, 0, 2, 2, 99) * 10000;
  total = total + parser_table_lookup_at(rows, entries, 0, 1, 0, 99) * 100;
  return total + parser_table_lookup_at(rows, entries, 1, 2, 0, 99);
}

fn parser_expected_statuses_for_test(rows: span<u32>, flags: span<u32>) -> u32 {
  let total: u32 = parser_expected_start(rows, 2, 1) * 10000000;
  total = total + parser_expected_end(rows, 2, 1) * 1000000;
  total = total + parser_expected_end(rows, 2, 2) * 100000;
  total = total + parser_expected_has_eof(flags, 2, 0) * 10000;
  total = total + parser_expected_has_eof(flags, 2, 1) * 1000;
  total = total + parser_expected_row_status(2, 5) * 100;
  total = total + parser_unexpected_diagnostic_code(1, 0) * 10;
  return total + parser_unexpected_diagnostic_code(1, 1);
}

fn parser_production_statuses_for_test(productions: span<u32>) -> u32 {
  let total: u32 = parser_production_load(productions, 2, 0, 0) * 100000;
  total = total + parser_production_load(productions, 2, 0, 1) * 10000;
  total = total + parser_production_load(productions, 2, 1, 0) * 1000;
  total = total + parser_production_load(productions, 2, 1, 1) * 100;
  return total + parser_production_load_test_status(
    parser_production_load(productions, 2, 2, 0),
  );
}

fn parser_production_load_test_status(value: u32) -> u32 {
  if value == 4294967295 {
    return 99;
  }
  return value;
}

fn parser_runtime_statuses_for_test() -> u32 {
  let total: u32 = parser_replay_action_status(16777216) * 10000000;
  total = total + parser_replay_action_status(33554432) * 1000000;
  total = total + parser_replay_action_status(50331648) * 100000;
  total = total + parser_replay_action_status(7) * 10000;
  total = total + parser_runtime_value_status(1, 7) * 1000;
  total = total + parser_runtime_value_status(0, 6) * 100;
  total = total + parser_accepted_root_status(0, 1, 1) * 10;
  total = total + parser_accepted_root_status(0, 1, 0);
  total = total * 100 + parser_trace_status_kind(5) * 10;
  return total + parser_trace_status_kind(77);
}

fn parser_span_statuses_for_test() -> u32 {
  let total: u32 = parser_span_merge_start(7, 11, 3, 5) * 100000;
  total = total + parser_span_merge_end(7, 11, 3, 5) * 1000;
  total = total + parser_span_merge_start(4294967295, 4294967295, 4, 9) * 100;
  total = total + parser_span_merge_end(4294967295, 4294967295, 4, 9) * 10;
  return total + parser_span_merge_start(4, 9, 4294967295, 4294967295);
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
  let total: u32 = (cst_field_accepts_count(1, 0) as u32) * 1000000;
  total = total + (cst_field_accepts_count(2, 0) as u32) * 100000;
  total = total + (cst_field_accepts_count(0, 0) as u32) * 10000;
  total = total + (cst_field_accepts_count(0, 1) as u32) * 1000;
  total = total + cst_child_span_start(7, 3) * 100;
  total = total + cst_child_span_end(7, 3) * 10;
  return total + cst_child_list_status(2);
}

fn cst_field_statuses_for_test() -> u32 {
  let total: u32 = cst_field_value_class(1) * 100000000;
  total = total + cst_field_value_class(2) * 10000000;
  total = total + cst_field_value_class(0) * 1000000;
  total = total + cst_field_entry_status(4294967295) * 100000;
  total = total + cst_field_storage_status(3) * 10000;
  total = total + cst_field_schema_status(4, 4, 1) * 1000;
  total = total + cst_field_build_status(4, 4, 1) * 100;
  total = total + cst_field_array_value_status(0) * 10;
  return total + cst_field_scalar_value_status(2);
}

fn cst_field_final_statuses_for_test() -> u32 {
  let total: u32 = cst_field_capture_status(0, 1, 0) * 10000000;
  total = total + cst_field_capture_status(1, 3, 0) * 1000000;
  total = total + cst_field_capture_status(1, 1, 2) * 100000;
  total = total + cst_field_final_status(1, 2, 2) * 10000;
  total = total + cst_field_final_status(1, 1, 0) * 1000;
  total = total + cst_field_final_build_status(1, 0) * 100;
  total = total + cst_field_final_build_status(0, 1) * 10;
  return total + cst_field_final_build_status(0, 2);
}

fn branch_statuses_for_test() -> u32 {
  let total: u32 = (branch_can_enqueue(2, 3) as u32) * 100000000;
  total = total + (branch_can_enqueue(3, 3) as u32) * 10000000;
  total = total + branch_next_depth(2, 4) * 1000000;
  total = total + branch_next_depth(4, 4) * 100000;
  total = total + (branch_is_exhausted(3, 3) as u32) * 10000;
  total = total + branch_trace_status_kind(5) * 1000;
  total = total + branch_trace_status_kind(77) * 100;
  return total + branch_trace_status_kind(0);
}

fn branch_failure_statuses_for_test() -> u32 {
  let total: u32 = (branch_should_record_failure(4294967295, 2) as u32) * 100;
  total = total + (branch_should_record_failure(1, 2) as u32) * 10;
  return total + (branch_should_record_failure(3, 2) as u32);
}

fn branch_accept_statuses_for_test() -> u32 {
  let total: u32 = branch_accept_outcome(0, 0, 5) * 1000;
  total = total + branch_accept_outcome(1, 1, 5) * 100;
  total = total + branch_accept_outcome(1, 0, 0) * 10;
  return total + branch_accept_outcome(1, 0, 3);
}

fn branch_trace_append_statuses_for_test() -> u32 {
  let total: u32 = branch_trace_append_status(0, 1, 1) * 100;
  total = total + branch_trace_append_status(1, 1, 5) * 10;
  return total + branch_trace_append_status(2, 5, 2);
}

fn branch_stack_append_statuses_for_test() -> u32 {
  let total: u32 = branch_stack_append_status(2, 3) * 10;
  return total + branch_stack_append_status(3, 3);
}

fn branch_exploration_statuses_for_test() -> u32 {
  let total: u32 = branch_exploration_status(3, 3) * 10;
  return total + branch_exploration_status(4, 3);
}

fn branch_restore_outcomes_for_test() -> u32 {
  let total: u32 = branch_restore_outcome(0, 2) * 100;
  total = total + branch_restore_outcome(1, 0) * 10;
  return total + branch_restore_outcome(0, 0);
}

fn branch_terminal_statuses_for_test() -> u32 {
  let total: u32 = (branch_has_terminal(2, 3) as u32) * 10;
  return total + (branch_has_terminal(3, 3) as u32);
}

fn branch_action_statuses_for_test() -> u32 {
  let total: u32 = (branch_has_action(0) as u32) * 10;
  return total + (branch_has_action(2) as u32);
}

fn branch_deferred_action_statuses_for_test() -> u32 {
  let total: u32 = (branch_has_deferred_action(0) as u32) * 10;
  return total + (branch_has_deferred_action(1) as u32);
}

fn reducer_operation_statuses_for_test() -> u32 {
  let total: u32 = reducer_operation(1) * 1000000;
  total = total + reducer_operation(8) * 100000;
  total = total + reducer_operation(14) * 1000;
  total = total + reducer_operation(15) * 10;
  return total + reducer_operation(0);
}

fn reducer_payload_statuses_for_test() -> u32 {
  let total: u32 = reducer_payload_status(2, 4294967295) * 100;
  total = total + reducer_payload_status(12, 4294967295) * 10;
  return total + reducer_payload_status(6, 4294967295);
}

fn reducer_load_statuses_for_test(reducers: span<u32>) -> u32 {
  let total: u32 = reducer_load(reducers, 2, 0, 0, 0) * 1000000;
  total = total + reducer_load(reducers, 2, 0, 1, 4294967295) * 10000;
  total = total + reducer_load(reducers, 2, 1, 0, 0) * 100;
  return total + reducer_load_test_status(
    reducer_load(reducers, 2, 2, 1, 4294967295),
  );
}

fn reducer_load_test_status(value: u32) -> u32 {
  if value == 4294967295 {
    return 99;
  }
  return value;
}

fn reducer_child_role_statuses_for_test() -> u32 {
  let total: u32 = reducer_child_role(1, 0) * 10000000;
  total = total + reducer_child_role(1, 1) * 1000000;
  total = total + reducer_child_role(2, 0) * 100000;
  total = total + reducer_child_role(3, 0) * 10000;
  total = total + reducer_child_role(4, 0) * 1000;
  total = total + reducer_child_role(6, 99) * 100;
  total = total + reducer_child_role(11, 2) * 10;
  return total + reducer_child_role(12, 0);
}

fn reducer_result_kind_statuses_for_test() -> u32 {
  let total: u32 = reducer_result_kind(1) * 100000000;
  total = total + reducer_result_kind(2) * 10000000;
  total = total + reducer_result_kind(6) * 1000000;
  total = total + reducer_result_kind(7) * 100000;
  total = total + reducer_result_kind(8) * 10000;
  total = total + reducer_result_kind(11) * 100;
  return total + reducer_result_kind(12);
}

fn reducer_replay_statuses_for_test() -> u32 {
  let total: u32 = reducer_replay_status(4294967295, 2, 0, 1) * 1000000;
  total = total + reducer_replay_status(1, 0, 0, 1) * 100000;
  total = total + reducer_replay_status(1, 2, 1, 1) * 10000;
  total = total + reducer_replay_status(1, 2, 2, 1) * 1000;
  total = total + reducer_replay_status(1, 12, 3, 1) * 100;
  total = total + reducer_replay_status(3, 6, 0, 2) * 10;
  total = total + reducer_replay_status(3, 6, 0, 3);
  total = total * 10 + reducer_replay_rhs_start(7, 3);
  return total * 10 + reducer_replay_stack_depth(0);
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
import { branch_accept_statuses_for_test, branch_action_statuses_for_test, branch_deferred_action_statuses_for_test, branch_exploration_statuses_for_test, branch_failure_statuses_for_test, branch_restore_outcomes_for_test, branch_stack_append_statuses_for_test, branch_statuses_for_test, branch_terminal_statuses_for_test, branch_trace_append_statuses_for_test, cst_field_final_statuses_for_test, cst_field_statuses_for_test, cst_statuses_for_test, diagnostic_statuses_for_test, lexer_driver_event_statuses_for_test, lexer_public_token_classes_for_test, lexer_statuses_for_test, parser_action_count_statuses_for_test, parser_action_statuses_for_test, parser_expected_statuses_for_test, parser_production_statuses_for_test, parser_runtime_statuses_for_test, parser_span_statuses_for_test, parser_table_lookup_at_statuses_for_test, parser_table_lookup_statuses_for_test, reducer_child_role_statuses_for_test, reducer_load_statuses_for_test, reducer_operation_statuses_for_test, reducer_payload_statuses_for_test, reducer_replay_statuses_for_test, reducer_result_kind_statuses_for_test, source_statuses_for_test, source_step_next_for_test, source_step_width_for_test, token_stream_match_statuses_for_test, token_stream_public_statuses_for_test, token_stream_trace_step_statuses_for_test, token_stream_validation_statuses_for_test } from "./runtime.ts";
import { lexer_dfa_transition_statuses_for_test } from "./runtime.ts";

function assertEquals(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(label + ": expected " + String(expected) + ", got " + String(actual));
  }
}

assertEquals(source_step_width_for_test([65, 66], 0), 1, "ascii width");
assertEquals(source_step_next_for_test([65, 66], 0), 1, "ascii next");
assertEquals(source_step_width_for_test([0xd83d, 0xde00], 0), 2, "surrogate width");
assertEquals(source_step_next_for_test([0xd83d, 0xde00], 0), 2, "surrogate next");
assertEquals(source_step_width_for_test([0xd83d, 65], 0), 1, "isolated lead width");
assertEquals(source_step_next_for_test([0xd83d, 65], 0), 1, "isolated lead next");
assertEquals(source_step_width_for_test([0xde00], 0), 1, "isolated trail width");
assertEquals(source_step_next_for_test([0xde00], 0), 1, "isolated trail next");
assertEquals(source_statuses_for_test(), 101210, "source statuses");
assertEquals(token_stream_validation_statuses_for_test(), 1123405065, "token stream validation statuses");
assertEquals(token_stream_match_statuses_for_test(), 77012211, "token stream match statuses");
assertEquals(token_stream_public_statuses_for_test(), 1034121, "token stream public statuses");
assertEquals(token_stream_trace_step_statuses_for_test(), 40608307, "token stream trace step statuses");
assertEquals(lexer_statuses_for_test(), 11233012, "lexer statuses");
assertEquals(lexer_public_token_classes_for_test(), 132, "lexer public token classes");
assertEquals(lexer_dfa_transition_statuses_for_test([0, 2, 3], [65, 67, 1, 97, 122, 2, 48, 57, 1]), 199020199, "lexer dfa transition statuses");
assertEquals(lexer_driver_event_statuses_for_test(), 103210091, "lexer driver event statuses");
assertEquals(parser_action_statuses_for_test(), 204201, "parser action statuses");
assertEquals(parser_action_count_statuses_for_test([1, 2, 0, 4, 0, 0]), 210, "parser action count statuses");
assertEquals(parser_table_lookup_statuses_for_test([0, 2, 3], [1, 7, 3, 9, 2, 5]), 799090599, "parser table lookup statuses");
assertEquals(parser_table_lookup_at_statuses_for_test([0, 3, 4], [1, 7, 2, 8, 2, 9, 2, 5]), 809990705, "parser table lookup-at statuses");
assertEquals(parser_expected_statuses_for_test([0, 2, 5], [1, 0]), 25010132, "parser expected statuses");
assertEquals(parser_production_statuses_for_test([7, 3, 8, 2]), 738299, "parser production statuses");
assertEquals(parser_runtime_statuses_for_test(), 1230022052, "parser runtime statuses");
assertEquals(parser_span_statuses_for_test(), 311494, "parser span statuses");
assertEquals(diagnostic_statuses_for_test(), 1100101, "diagnostic statuses");
assertEquals(cst_statuses_for_test(), 1101371, "cst statuses");
assertEquals(cst_field_statuses_for_test(), 321111211, "cst field statuses");
assertEquals(cst_field_final_statuses_for_test(), 2321023, "cst field final statuses");
assertEquals(branch_statuses_for_test(), 103415200, "branch statuses");
assertEquals(branch_failure_statuses_for_test(), 110, "branch failure statuses");
assertEquals(branch_accept_statuses_for_test(), 1210, "branch accept statuses");
assertEquals(branch_trace_append_statuses_for_test(), 42, "branch trace append statuses");
assertEquals(branch_stack_append_statuses_for_test(), 2, "branch stack append statuses");
assertEquals(branch_exploration_statuses_for_test(), 3, "branch exploration statuses");
assertEquals(branch_restore_outcomes_for_test(), 12, "branch restore outcomes");
assertEquals(branch_terminal_statuses_for_test(), 10, "branch terminal statuses");
assertEquals(branch_action_statuses_for_test(), 1, "branch action statuses");
assertEquals(branch_deferred_action_statuses_for_test(), 1, "branch deferred action statuses");
assertEquals(reducer_operation_statuses_for_test(), 1511120, "reducer operation statuses");
assertEquals(reducer_payload_statuses_for_test(), 230, "reducer payload statuses");
assertEquals(reducer_load_statuses_for_test([2, 99, 15, 4294967295]), 2991599, "reducer load statuses");
assertEquals(reducer_child_role_statuses_for_test(), 10234222, "reducer child role statuses");
assertEquals(reducer_result_kind_statuses_for_test(), 124560910, "reducer result kind statuses");
assertEquals(reducer_replay_statuses_for_test(), 111234040, "reducer replay statuses");
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
