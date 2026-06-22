# Task 142: Runtime Replay And Materialization Closure

## Goal

Finish the parser replay and public-object portion of FEEDBACK P0.1. Generated
TypeScript replay may allocate JavaScript objects, but parser-trace action
replay, reduction shape, fragment assembly, field capture, child-vector, span,
and token-range decisions should be runtime-language-owned.

## Current Starting Point

`tasks/status.md` says generated TypeScript replay still:

- iterates accepted parser-trace actions;
- dispatches reduction object allocation;
- owns public CST, token, field, diagnostic, and parse-result JavaScript object
  allocation through shared materializers.

Some of this is an intentional host boundary. This task should separate
intentional host allocation from runtime-owned parser semantics.

## Files To Inspect

- `src/targets/runtime/typescript_parser_runtime.ts`
- `src/targets/runtime/public_rule_node_materializer.ts`
- `src/targets/runtime/public_field_materializer.ts`
- `src/targets/runtime/public_parse_result_materializer.ts`
- `src/targets/runtime/public_token_materializer.ts`
- `src/targets/runtime/language_sources.ts`
- `src/targets/runtime/language.ts`
- `tests/runtime_language_test.ts`
- `tests/runtime_plan_test.ts`
- `tests/parser_test.ts`
- `docs/runtime-language.md`
- `FEEDBACK.md`
- `tasks/status.md`

## Search Commands

```sh
rg -n "replayTrace|reduceProduction|shiftedToken|tokenFragment|ruleFragment|sequenceFragment|emptyFragment|appendFragment|buildFields|materializeRuleNode|acceptedParseResult|failedParseResult" src/targets/runtime tests docs FEEDBACK.md
```

## Work

1. Mark each replay/materialization operation as one of:
   - runtime semantic decision;
   - host object allocation;
   - display/string formatting.
2. Move at least one remaining runtime semantic decision into
   `language_sources.ts`.
3. Keep JavaScript object construction in shared public materializers.
4. Add conformance tests for any new runtime-language helper.
5. Add `runtime_plan_test.ts` assertions that the host template does not
   reintroduce the moved decision.
6. Update `docs/runtime-language.md`, `FEEDBACK.md`, and `tasks/status.md`.

## Acceptance

- `tasks/status.md` distinguishes intentional host allocation from remaining
  runtime semantic duplication.
- New helper has TypeScript/Wasm conformance coverage.
- Parser behavior and public CST shape remain unchanged.
- Focused checks pass:

```sh
deno fmt --check
git diff --check
deno test -A tests/runtime_language_test.ts tests/runtime_plan_test.ts tests/parser_test.ts
```

## Do Not Touch

- Do not rewrite the full replay engine in one patch.
- Do not change public CST/token/field object shapes.
- Do not move human-readable diagnostic strings in this task.

## Completion Notes

Completed on 2026-06-22.

- Added runtime-language `parserAcceptedRootStatus` to classify accepted parse
  roots before public `ParseResult` allocation.
- Kept public JavaScript object allocation in shared runtime-target
  materializers.
- Covered by `tests/runtime_language_test.ts`, `tests/runtime_plan_test.ts`, and
  parser behavior tests.
