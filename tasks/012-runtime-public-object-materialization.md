# Task 012: Runtime Public Object Materialization

## Goal

Lower remaining public object materialization decisions into shared runtime
helpers while keeping JavaScript object allocation in the host wrapper. This
continues FEEDBACK P0.1 without attempting a full rewrite.

## Files To Inspect

- `src/targets/runtime/public_token_materializer.ts`
- `src/targets/runtime/public_diagnostic_materializer.ts`
- `src/targets/runtime/public_field_materializer.ts`
- `src/targets/runtime/public_rule_node_materializer.ts`
- `src/targets/runtime/public_parse_result_materializer.ts`
- `src/targets/runtime/language_sources.ts`
- `tests/runtime_plan_test.ts`

## Search Commands

```sh
rg -n "if \\(|\\? .*:|===|!==|length ===|type ===|channel ===|tokenClass|status" src/targets/runtime/public_* src/targets/runtime/typescript_parser_runtime.ts
```

## Work

1. Choose one direct classification in a public materializer.
2. Add a runtime-language helper if it is a deterministic numeric/status
   decision.
3. Keep object shape creation in the host materializer.
4. Add regression assertions that the old inline branch does not return.
5. Document the boundary in `docs/runtime-language.md`.

## Acceptance

- The public API object shape is unchanged.
- TypeScript and Wasm adapter outputs stay in parity.
- Focused checks:

```sh
deno test -A tests/runtime_plan_test.ts tests/parser_test.ts tests/ts_wasm_parity_test.ts
```

## Do Not Touch

- Do not change exported token/node/diagnostic TypeScript types.
- Do not change parser-kit helper object shapes.
