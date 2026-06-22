# Task 143: Runtime Diagnostic Payload Closure

## Goal

Finish the diagnostic-payload portion of FEEDBACK P0.1. Runtime language should
own stable diagnostic codes, detail-kind IDs, spans, numeric payloads, and merge
or selection statuses. Host code may render human-readable strings from those
records.

## Current Starting Point

`tasks/status.md` says expected/found display strings and human-readable
diagnostic message text remain host-owned, with runtime-language helpers
providing stable codes, detail-kind IDs, spans, and numeric payloads.

This task should close any remaining executable diagnostic payload decisions and
document any intentionally host-owned message formatting.

## Files To Inspect

- `src/targets/runtime/typescript_parser_runtime.ts`
- `src/targets/runtime/public_diagnostic_materializer.ts`
- `src/targets/runtime/public_lex_diagnostic_materializer.ts`
- `src/targets/runtime/diagnostic_codes.ts`
- `src/targets/runtime/language_sources.ts`
- `tests/runtime_language_test.ts`
- `tests/runtime_plan_test.ts`
- `tests/parser_test.ts`
- `tests/lexer_test.ts`
- `docs/runtime-language.md`
- `FEEDBACK.md`
- `tasks/status.md`

## Search Commands

```sh
rg -n "Diagnostic|diagnostic|expected|found|detail|message|merge|unexpected|trailing|lexical" src/targets/runtime tests docs FEEDBACK.md
```

## Work

1. Audit parser and lexer diagnostic construction for executable decisions still
   made in generated host code.
2. Move one remaining numeric/status/detail decision into a runtime-language
   helper, or document why the remaining work is purely host text rendering.
3. Add conformance coverage for the helper or add a regression proving the
   documented host boundary.
4. Tighten parser/lexer tests for public detail-kind IDs and stable codes.
5. Update `docs/runtime-language.md`, `FEEDBACK.md`, and `tasks/status.md`.

## Acceptance

- Diagnostic payload decisions are runtime-language-backed or explicitly
  documented as host rendering.
- Public diagnostics keep stable code/detail fields.
- Focused checks pass:

```sh
deno fmt --check
git diff --check
deno test -A tests/runtime_language_test.ts tests/runtime_plan_test.ts tests/parser_test.ts tests/lexer_test.ts
```

## Do Not Touch

- Do not change public diagnostic messages unless required by the new payload
  model.
- Do not remove source spans or related locations.
- Do not broaden this into a diagnostic renderer rewrite.

## Completion Notes

Completed on 2026-06-22.

- Added runtime-language `parserDiagnosticCodeStatus` so diagnostic
  materialization validates runtime-code consistency through a helper instead of
  open-coded host comparison.
- Kept human-readable diagnostic message rendering at the JavaScript host
  boundary.
- Covered by `tests/runtime_language_test.ts`, `tests/runtime_plan_test.ts`,
  parser tests, and lexer tests.
