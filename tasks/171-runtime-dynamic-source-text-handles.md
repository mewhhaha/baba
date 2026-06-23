# Task 171: Runtime Dynamic Source Text Handles

## Goal

Lower dynamic source-text capability handling far enough that generated lexers
and token-stream validators no longer own parser-semantic source traversal.

The host may still own JavaScript strings and Wasm linear-memory writes, but the
runtime language should expose source-text handle operations for length,
code-unit access, code-point decoding, slicing-compatible span checks, and
traversal status.

## Depends On

- `170-runtime-source-of-truth-cutline.md`

## Files To Inspect

- `src/targets/runtime/public_source_text.ts`
- `src/targets/runtime/language.ts`
- `src/targets/runtime/language_sources.ts`
- `src/targets/runtime/typescript_lexer_runtime.ts`
- `src/targets/runtime/typescript_parser_runtime.ts`
- `src/targets/wasm/runtime_emit.ts`
- `tests/runtime_language_test.ts`
- `tests/runtime_plan_test.ts`
- `tests/lexer_test.ts`
- `tests/parser_test.ts`
- `docs/runtime-language.md`
- `tasks/status.md`

## Search Commands

```sh
rg -n "SourceTextBoundary|sourceTextLength|sourceTextSlice|sourceTextCodeUnitAt|sourceTextCodePointAt|sourceTextMatches|utf16CodePointFromUnits|utf16HasCodeUnit" src tests docs tasks
```

## Work

1. Add runtime-language support for dynamic source handles or an explicit host
   callback boundary that generated runtime helpers can call uniformly.
2. Move source length/code-unit/code-point traversal status into
   runtime-language helpers.
3. Keep actual JavaScript string storage and Wasm input-buffer writes at the
   host boundary.
4. Add TypeScript/Wasm runtime-language conformance for dynamic source behavior
   including astral characters, isolated surrogates, CRLF, NUL, and U+2028.
5. Tighten generated runtime-plan tests so source traversal semantics cannot
   move back into ad hoc host code.
6. Update docs and `tasks/status.md`.

## Acceptance

- Runtime-language helpers own source traversal status and UTF-16/code-point
  decisions for dynamic input.
- Generated host code only performs allowed source capability reads/writes.
- Focused checks pass:

```sh
deno fmt --check
git diff --check
deno test -A tests/runtime_language_test.ts tests/runtime_plan_test.ts tests/lexer_test.ts tests/parser_test.ts
```

## Do Not Touch

- Do not change public span units; they remain half-open UTF-16 code-unit
  offsets.
- Do not require non-JS hosts to exist before the descriptor/ABI is ready.
- Do not change generated public token or diagnostic shapes.

## Completion Notes

Completed on 2026-06-23.

- Added runtime-language `sourceText*` helpers for source offset status, span
  status, trail-unit availability, UTF-16 code-point decoding, and next-offset
  calculation.
- Routed generated `SourceTextBoundary` helpers through those runtime-language
  decisions while keeping JavaScript string storage, slicing, and `charCodeAt`
  reads at the host capability boundary.
- Emitted the source-text runtime helper program from TypeScript parsers and
  generated Wasm lexer adapters, and added it to runtime artifact metadata.
- Added TypeScript/Wasm runtime-language conformance for astral pairs, isolated
  surrogates, CRLF, NUL, U+2028, span status, and trail-unit status.
- Tightened `tests/runtime_plan_test.ts` so direct source offset/trail checks do
  not move back into the public source helper.
