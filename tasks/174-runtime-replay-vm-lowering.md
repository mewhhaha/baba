# Task 174: Runtime Replay VM Lowering

## Goal

Move accepted parser-trace replay into a runtime-language replay VM.

Generated TypeScript may still allocate public JavaScript CST objects at the API
boundary, but reduction dispatch, value-stack operations, fragment construction,
field capture attachment, child list construction, and accepted-root selection
should be runtime-language-owned.

## Depends On

- `170-runtime-source-of-truth-cutline.md`
- `173-runtime-token-stream-normalization-lowering.md`

## Files To Inspect

- `src/targets/runtime/typescript_parser_runtime.ts`
- `src/targets/runtime/public_rule_node_materializer.ts`
- `src/targets/runtime/public_field_materializer.ts`
- `src/targets/runtime/public_parse_result_materializer.ts`
- `src/targets/runtime/language_sources.ts`
- `tests/runtime_language_test.ts`
- `tests/runtime_plan_test.ts`
- `tests/parser_test.ts`
- `tests/parser_kit_test.ts`
- `tests/ts_wasm_parity_test.ts`

## Search Commands

```sh
rg -n "replayTrace|reduceProduction|valueStack|shiftedToken|tokenFragment|ruleFragment|sequenceFragment|appendFragment|acceptedParseResult|parserAcceptedRootStatus" src/targets/runtime tests
```

## Work

1. Define a runtime-language replay VM input/output contract.
2. Move replay iteration and reduction dispatch out of generated TypeScript.
3. Have the runtime-language VM return runtime object handles for root,
   diagnostics, fields, children, and token/rule-node fragments.
4. Keep public JavaScript object allocation in shared materializers.
5. Add conformance for deterministic and declared-conflict replay cases.
6. Tighten plan tests to reject reintroduced `reduceProduction` or host replay
   dispatch.
7. Update generated examples and manifests when bootstrap requires it.

## Acceptance

- Generated TypeScript no longer owns reduction dispatch or value-stack replay
  semantics.
- Public CST/token/field shapes remain unchanged.
- TypeScript/Wasm parity still passes for deterministic and conflict grammars.
- Focused checks pass:

```sh
deno task bootstrap:check
deno fmt --check
git diff --check
deno test -A tests/runtime_language_test.ts tests/runtime_plan_test.ts tests/parser_test.ts tests/parser_kit_test.ts tests/ts_wasm_parity_test.ts
```

## Do Not Touch

- Do not change public CST object shapes.
- Do not rewrite parser planning in this task.
- Do not remove current internal-error diagnostic behavior at public boundaries.
