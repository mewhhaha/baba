# Task 172: Runtime Lexer Driver Lowering

## Goal

Move the remaining generated TypeScript lexer driver semantics into
runtime-language code.

After this task, generated TypeScript lexer code should provide source
capability reads and public object wrapping, but not own the main
maximal-munch/candidate loop, accepted-spec selection, token-emission decision,
or lexical-error advancement.

## Depends On

- `170-runtime-source-of-truth-cutline.md`
- Preferably `171-runtime-dynamic-source-text-handles.md`

## Files To Inspect

- `src/targets/runtime/typescript_lexer_runtime.ts`
- `src/targets/wasm/lexer_emit.ts`
- `src/targets/runtime/language_sources.ts`
- `src/targets/runtime/public_token_materializer.ts`
- `src/targets/runtime/public_lex_diagnostic_materializer.ts`
- `tests/runtime_language_test.ts`
- `tests/runtime_plan_test.ts`
- `tests/lexer_test.ts`
- `tests/ts_wasm_parity_test.ts`

## Search Commands

```sh
rg -n "function lex\\(|function bestCandidate|lexerScan|candidate|offset|lexUnexpectedCharacterDiagnostic|LEXER_TOKEN_EMIT" src/targets/runtime src/targets/wasm tests
```

## Work

1. Design a runtime-language lexer-driver API that returns token records or
   compact token events for host wrapping.
2. Move maximal-munch candidate iteration and lexical-error fallback advancement
   into runtime-language source.
3. Reuse existing lexer spec, public-token-class, and token-emission helpers.
4. Keep public `Token[]`, `LexDiagnostic[]`, and `LexResult` allocation in
   shared host materializers.
5. Add TypeScript/Wasm runtime-language conformance for the lexer driver.
6. Tighten plan tests to reject reintroduced generated `bestCandidate` or
   lexer-driver loops.
7. Update generated examples and manifests when bootstrap requires it.

## Acceptance

- Generated TypeScript lexers no longer contain a standalone candidate loop.
- TypeScript and Wasm generated lexing behavior remains identical.
- Focused checks pass:

```sh
deno task bootstrap:check
deno fmt --check
git diff --check
deno test -A tests/runtime_language_test.ts tests/runtime_plan_test.ts tests/lexer_test.ts tests/ts_wasm_parity_test.ts
```

## Do Not Touch

- Do not change lexical priority semantics.
- Do not change public `lex()` return shapes.
- Do not remove the JavaScript-hosted Wasm adapter API.

## Completion Notes

Completed on 2026-06-23.

- Added runtime-language `lexerDriver*` helpers that own maximal-munch scan
  state, accepted-spec selection, preserve-trivia emission, public token
  class/payload/terminal event fields, and lexical-error fallback advancement.
- Rewrote generated TypeScript lexers so host code only feeds source code points
  requested by `lexerDriverReadOffset()` and materializes `TOKEN`/`ERROR` events
  through shared public token and diagnostic materializers.
- Reserved the driver scratch prefix before generated token-record allocation so
  public wrapping cannot corrupt runtime driver state.
- Added TypeScript/Wasm runtime-language conformance for token, skipped trivia,
  preserved trivia, and lexical-error driver events.
- Tightened `tests/runtime_plan_test.ts` to reject `bestCandidate`, the old
  host-side candidate helper, and direct host lexer-scan/token-emission markers.
