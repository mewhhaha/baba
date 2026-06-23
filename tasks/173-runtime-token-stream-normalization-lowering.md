# Task 173: Runtime Token Stream Normalization Lowering

## Goal

Move external `parseTokens()` normalization and trace-input preparation into a
runtime-language-owned pipeline.

Generated parser adapters may still receive public JavaScript token objects, but
runtime-language code should own token identity normalization, canonical-stream
matching, omitted-trivia handling, trace-terminal selection, and final compacted
trace metadata.

## Depends On

- `170-runtime-source-of-truth-cutline.md`
- `171-runtime-dynamic-source-text-handles.md`

## Files To Inspect

- `src/targets/runtime/typescript_parser_runtime.ts`
- `src/targets/wasm/lexer_emit.ts`
- `src/targets/wasm/parser_emit.ts`
- `src/targets/runtime/language_sources.ts`
- `tests/parser_test.ts`
- `tests/parser_kit_test.ts`
- `tests/ts_wasm_parity_test.ts`
- `tests/runtime_language_test.ts`
- `tests/runtime_plan_test.ts`

## Search Commands

```sh
rg -n "parseTokens|parseTokenList|compactTokenStream|validateTokenStream|canonical|TraceTokenStream|parserTraceTerminal|parserTokenStream" src tests
```

## Work

1. Define a runtime-language token-stream normalization result shape.
2. Move the remaining adapter-owned token-stream iteration and compacted trace
   vector decisions into runtime-language helpers.
3. Keep public JavaScript token shape validation and source text reads only
   where the cutline allows them.
4. Preserve `parseTokensUnchecked()` as the documented bypass for strict public
   token-stream validation.
5. Add parity coverage for TypeScript/Wasm parseTokens success, failure, omitted
   trivia, invalid EOF, lexical error, and gap cases.
6. Tighten runtime-plan tests against reintroduced host-side canonical stream
   control flow.
7. Update docs and `tasks/status.md`.

## Acceptance

- Token stream normalization is runtime-language-backed end to end.
- `parseTokens()` still validates against a single canonical whole-source token
  stream.
- Focused checks pass:

```sh
deno fmt --check
git diff --check
deno test -A tests/runtime_language_test.ts tests/runtime_plan_test.ts tests/parser_test.ts tests/parser_kit_test.ts tests/ts_wasm_parity_test.ts
```

## Do Not Touch

- Do not require callers to include trivia tokens.
- Do not change public token names or parser API signatures.
- Do not remove public diagnostics for invalid external token streams.

## Completion Notes

Completed on 2026-06-23.

- Added packed runtime-language trace-token stream step helpers
  (`parserTraceTokenStreamStep`, `parserTraceTokenStreamStepStatus`, and
  `parserTraceTokenStreamStepTerminal`) so generated parser adapters consume one
  runtime-owned token-stream normalization decision for status and terminal
  selection.
- Removed the old generated `skipTraceTrivia` path and tightened
  `tests/runtime_plan_test.ts` against reintroducing host-side trivia skipping
  or direct token-stream status checks.
- Added TypeScript/Wasm runtime-language conformance for the packed step helper
  and kept `parseTokens()` strict validation/parity coverage across generated
  TypeScript, Wasm, and parser-kit tests.
