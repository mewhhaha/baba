# Task 176: Runtime Diagnostic Render Boundary

## Goal

Finish the diagnostic side of the source-of-truth cutline by separating runtime
diagnostic payload semantics from host text rendering.

Runtime-language code should own diagnostic code, detail-kind, span, expected
range identity, and numeric payload selection. Host code may render
human-readable `message`, `expected`, and `found` strings from those records.

## Depends On

- `170-runtime-source-of-truth-cutline.md`
- `175-runtime-public-materialization-boundary.md`

## Files To Inspect

- `src/targets/runtime/public_diagnostic_materializer.ts`
- `src/targets/runtime/typescript_parser_runtime.ts`
- `src/targets/runtime/diagnostic_codes.ts`
- `src/targets/runtime/language_sources.ts`
- `src/targets/wasm/plan.ts`
- `tests/parser_test.ts`
- `tests/lexer_test.ts`
- `tests/runtime_language_test.ts`
- `tests/runtime_plan_test.ts`
- `docs/runtime-language.md`

## Search Commands

```sh
rg -n "Diagnostic|diagnostic|message|expected|found|runtimeDetail|runtimeCode|parserDiagnostic|unexpected|trailing|branch" src tests docs
```

## Work

1. Inventory diagnostic rendering versus diagnostic payload semantics.
2. Move any remaining payload selection into runtime-language helpers or replay
   VM outputs.
3. Keep host text rendering explicit and documented.
4. Add tests for stable runtime diagnostic codes/detail-kind IDs separate from
   text messages.
5. Add runtime-plan tests preventing payload decisions from moving back into
   host renderers.
6. Update `docs/runtime-language.md` and `tasks/status.md`.

## Acceptance

- Runtime diagnostic payload decisions are runtime-language-backed.
- Host-owned rendering is documented as presentation only.
- Public diagnostics remain backward compatible.
- Focused checks pass:

```sh
deno fmt --check
git diff --check
deno test -A tests/runtime_language_test.ts tests/runtime_plan_test.ts tests/parser_test.ts tests/lexer_test.ts
```

## Do Not Touch

- Do not rename public diagnostic string codes.
- Do not remove source spans or related locations.
- Do not collapse structured numeric payloads into display strings.

## Completion Notes

Completed on 2026-06-23.

- Runtime diagnostic code, detail-kind, span, expected-range, and numeric
  payload decisions are backed by runtime-language helpers and runtime
  diagnostic records; host code only renders public `message`, `expected`, and
  `found` strings from those records.
- `ParseDiagnostic` keeps backward-compatible public string codes while also
  exposing `runtimeCode`, `runtimeDetail`, `runtimeDetailKind`, and
  `runtimeDetailKindId`; generated Wasm `abi.json` descriptors expose matching
  diagnostic schemas.
- `tests/runtime_plan_test.ts`, `tests/runtime_language_test.ts`, and parser
  diagnostics tests cover the split between runtime-owned payload semantics and
  host-owned presentation.
