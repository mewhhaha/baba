# Task 013: Runtime Error Payload Variants

## Goal

Replace remaining ad hoc host-side internal diagnostic detail decisions with
runtime-language-backed diagnostic records and detail-kind IDs. This addresses
the FEEDBACK note about richer executable host-neutral error payload variants.

## Files To Inspect

- `src/targets/runtime/diagnostic_codes.ts`
- `src/targets/runtime/public_diagnostic_materializer.ts`
- `src/targets/runtime/typescript_parser_runtime.ts`
- `src/targets/runtime/language_sources.ts`
- `tests/parser_test.ts`
- `tests/wasm_test.ts`
- `tests/ts_wasm_parity_test.ts`

## Search Commands

```sh
rg -n "runtimeDetail|runtimeCode|detailKind|internalParserDiagnostic|parserInternal|PARSER_INTERNAL|diagnostic" src tests
```

## Work

1. Find one diagnostic path where TypeScript or Wasm adapter builds detail
   meaning directly.
2. Add or reuse runtime-language diagnostic helpers for the numeric detail kind
   and payload.
3. Preserve existing public diagnostic fields.
4. Add parity coverage for TypeScript and Wasm if the path exists in both.

## Acceptance

- Diagnostics still expose stable `runtimeCode` and detail fields.
- Tests compare both TypeScript and Wasm for the changed diagnostic path.
- Focused checks:

```sh
deno test -A tests/parser_test.ts tests/wasm_test.ts tests/ts_wasm_parity_test.ts
```

## Do Not Touch

- Do not redesign all diagnostics in this task.
- Do not remove existing public diagnostic fields.
