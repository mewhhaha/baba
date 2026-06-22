# Task 140: Runtime Source Text Boundary Closure

## Goal

Finish the source-text portion of FEEDBACK P0.1. The generated TypeScript lexer
may allocate and own JavaScript strings, but source traversal, UTF-16/code-point
decisions, match-length accounting, and candidate selection should be
runtime-language-owned wherever possible.

## Current Starting Point

`tasks/status.md` says generated TypeScript lexing still owns:

- `SourceTextBoundary` host object creation;
- source slicing/matching at offsets;
- the loop that advances through source offsets while calling runtime-language
  DFA/UTF-16 helpers.

## Files To Inspect

- `src/targets/runtime/typescript_lexer_runtime.ts`
- `src/targets/runtime/public_source_text.ts`
- `src/targets/runtime/language_sources.ts`
- `src/targets/runtime/language.ts`
- `src/targets/wasm/lexer_emit.ts`
- `tests/runtime_language_test.ts`
- `tests/runtime_plan_test.ts`
- `tests/lexer_test.ts`
- `docs/runtime-language.md`
- `FEEDBACK.md`
- `tasks/status.md`

## Search Commands

```sh
rg -n "SourceTextBoundary|sourceTextCodePointAt|bestCandidate|lexerScan|utf16CodePoint|slice\\(|substring\\(|offset" src/targets/runtime tests docs FEEDBACK.md
rg -n "function bestCandidate|while \\(index < sourceText.length\\)|sourceText.length" src/targets/runtime/typescript_lexer_runtime.ts
```

## Work

1. Define the intended host/runtime boundary for source text handles:
   - host may own actual JavaScript strings and source-buffer capabilities;
   - runtime language should own numeric traversal, accepted length, status, and
     UTF-16/code-point arithmetic.
2. Move one or more remaining source-traversal decisions from generated
   TypeScript into runtime-language helpers.
3. Keep public token object allocation in host materializers.
4. Add runtime-language conformance for any new helper.
5. Tighten `tests/runtime_plan_test.ts` so direct host-side traversal logic does
   not regress.
6. Update `docs/runtime-language.md`, `FEEDBACK.md`, and `tasks/status.md`.

## Acceptance

- Host source access is documented as a capability boundary, not a parser
  algorithm.
- Generated TypeScript lexer delegates candidate status/length decisions to
  runtime-language helpers.
- Focused checks pass:

```sh
deno fmt --check
git diff --check
deno test -A tests/runtime_language_test.ts tests/runtime_plan_test.ts tests/lexer_test.ts
```

## Do Not Touch

- Do not replace JavaScript string ownership with Wasm memory ownership.
- Do not change public token shapes.
- Do not regenerate examples unless `deno task bootstrap:check` requires it.

## Completion Notes

Completed on 2026-06-22.

- Added runtime-language `lexerScanNextOffset` and `lexerScanCandidateEnd`
  helpers for numeric source-offset advancement and accepted candidate-end
  arithmetic.
- Generated TypeScript lexer source access remains a host string capability
  boundary, while candidate advancement uses the runtime-language helpers.
- Covered by `tests/runtime_language_test.ts` conformance and
  `tests/runtime_plan_test.ts` regression checks.
