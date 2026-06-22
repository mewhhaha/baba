# Task 141: Runtime Token Stream Boundary Closure

## Goal

Finish the token-stream portion of FEEDBACK P0.1. Generated parser adapters may
accept public JavaScript token objects at the API boundary, but token identity,
shape, span, EOF, trivia, gap, and trace-terminal classification should be
runtime-language-owned.

## Current Starting Point

`tasks/status.md` says generated parser adapters still own:

- mapping public token strings, channels, literals, spans, EOF records, and
  plan-local terminal hints into runtime numeric token records;
- compacting public token streams into trace input vectors;
- validating host-owned source text against public token spans;
- selecting public token-stream diagnostic text after runtime status helpers
  classify numeric cases.

## Files To Inspect

- `src/targets/runtime/typescript_parser_runtime.ts`
- `src/targets/runtime/language_sources.ts`
- `src/targets/runtime/public_token_materializer.ts`
- `src/targets/runtime/public_diagnostic_materializer.ts`
- `src/targets/wasm/lexer_emit.ts`
- `src/targets/wasm/parser_emit.ts`
- `tests/parser_test.ts`
- `tests/parser_kit_test.ts`
- `tests/ts_wasm_parity_test.ts`
- `tests/runtime_language_test.ts`
- `tests/runtime_plan_test.ts`
- `docs/runtime-language.md`
- `FEEDBACK.md`
- `tasks/status.md`

## Search Commands

```sh
rg -n "tokenToTerminal|tokenSpecIndex|compactTraceTokenStream|compactTokenStream|validateTokenStream|canonical|TRACE_TOKEN_STREAM|TOKEN_STREAM|publicTokenClass|plan-local" src/targets/runtime src/targets/wasm tests docs FEEDBACK.md
```

## Work

1. Audit which token-stream decisions are already runtime-language-backed.
2. Pick the next host-side classification or arithmetic decision and lower it
   into a runtime-language helper.
3. Keep string display and public JavaScript diagnostic text at the host
   boundary unless a separate diagnostic task moves it.
4. Add runtime-language conformance for the helper.
5. Add regression coverage proving `parseTokens()` still validates against one
   canonical whole-source token stream.
6. Update `docs/runtime-language.md`, `FEEDBACK.md`, and `tasks/status.md`.

## Acceptance

- New helper has TypeScript and Wasm runtime-language conformance coverage.
- Generated parser adapters no longer contain the old direct branch/arithmetic.
- TypeScript/Wasm `parseTokens()` parity remains exact.
- Focused checks pass:

```sh
deno fmt --check
git diff --check
deno test -A tests/runtime_language_test.ts tests/runtime_plan_test.ts tests/parser_test.ts tests/parser_kit_test.ts tests/ts_wasm_parity_test.ts
```

## Do Not Touch

- Do not remove public `parseTokens()` or `parseTokensUnchecked()`.
- Do not require callers to supply complete trivia unless a separate task
  changes the documented contract.
- Do not change token public API names.

## Completion Notes

Completed on 2026-06-22.

- Added runtime-language `lexerPublicTokenClass` and `lexerTokenEmitStatus`
  helpers for public token class and preserve-trivia emission decisions.
- Added `parserTraceTokenStreamPublicIndex` for the compacted trace token-stream
  EOF public-index sentinel.
- Covered by `tests/runtime_language_test.ts`, `tests/runtime_plan_test.ts`,
  TypeScript parser/lexer tests, and TypeScript-Wasm parity tests.
