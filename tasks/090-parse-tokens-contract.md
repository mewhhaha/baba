# Task 090: parseTokens Contract Audit

## Goal

Finish or prove FEEDBACK P1.12. `parseTokens()` must validate against one
canonical whole-source lex, not per-gap relexing.

## Files To Inspect

- `src/targets/runtime/typescript_parser_runtime.ts`
- `src/targets/kit/schema.ts`
- `tests/parser_test.ts`
- `tests/parser_kit_test.ts`
- `tests/ts_wasm_parity_test.ts`
- `README.md`

## Search Commands

```sh
rg -n "parseTokens|parseTokensUnchecked|validateSourceGap|canonical|lex\\(" src tests README.md
```

## Work

1. Verify generated TypeScript, generated Wasm adapter, and kit helpers all use
   a whole-source canonical lex for strict token validation.
2. Add regression tests with multiple omitted trivia gaps.
3. Add tests proving `parseTokensUnchecked` bypasses strict validation only
   where documented.
4. Update README if the contract is unclear.

## Acceptance

```sh
deno test -A tests/parser_test.ts tests/parser_kit_test.ts tests/ts_wasm_parity_test.ts
```

and:

```sh
rg -n "validateSourceGap|lex\\(" src/targets/runtime/typescript_parser_runtime.ts src/targets/kit/schema.ts
```

must show one canonical source lex per validation path, not one lex per gap.

## Do Not Touch

- Do not require complete trivia coverage unless the coordinator chooses the
  strict contract over the convenience contract.
