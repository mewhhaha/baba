# Task 020: Portable Parser Plan Contract

## Goal

Prove or complete FEEDBACK P0.2: a versioned portable parser plan is the single
deterministic data boundary consumed by TypeScript, Wasm, and kit.

## Files To Inspect

- `src/targets/runtime/portable_plan.ts`
- `src/targets/runtime/plan.ts`
- `src/targets/typescript/plan.ts`
- `src/targets/wasm/plan.ts`
- `src/targets/kit/plan.ts`
- `tests/runtime_plan_test.ts`
- `tests/parser_kit_test.ts`
- `README.md`

## Search Commands

```sh
rg -n "PortableParserPlan|portablePlan|parserPlanHash|parserPlanVersion|semantics|baba-parser-plan|runtimeImplementation" src tests README.md docs
```

## Work

1. Verify TypeScript, Wasm, and kit all expose the same plan hash for the same
   grammar.
2. If any target bypasses the shared plan, route it through
   `src/targets/runtime/plan.ts`.
3. Add a test that fails if target hashes diverge.
4. Ensure docs state parser-plan versioning is separate from package, metadata,
   runtime-language, kit schema, and Wasm ABI versions.

## Acceptance

- One test compares TypeScript, Wasm, and kit plan metadata.
- No target recomputes a different parser plan shape.
- Focused checks:

```sh
deno test -A tests/runtime_plan_test.ts tests/parser_kit_test.ts tests/ts_wasm_parity_test.ts
```

## Do Not Touch

- Do not change `schemaVersion` for parser-kit unless the JSON shape breaks.
- Do not change public generated parser APIs.
