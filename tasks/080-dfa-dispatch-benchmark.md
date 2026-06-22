# Task 080: DFA Transition Dispatch Optimization

## Goal

Finish FEEDBACK P1.11. Avoid linear range scans for hot DFA transition states
where a compact ASCII fast table or binary search improves performance without
unreasonable generated-size growth.

## Files To Inspect

- `src/compiler/regex/dfa.ts`
- `src/targets/runtime/language_sources.ts`
- `src/targets/runtime/typescript_lexer_runtime.ts`
- `bench/`
- `tests/lexer_test.ts`

## Search Commands

```sh
rg -n "ascii|transition|dfaTransition|ranges|for \\(const \\[start, end, target\\]|binary" src bench tests
```

## Work

1. Measure current lexer performance and generated size for a grammar with many
   character ranges.
2. Implement one dispatch strategy:
   - ASCII table plus range fallback; or
   - binary search over sorted ranges.
3. Keep output deterministic.
4. Add tests proving ASCII and non-ASCII paths agree.
5. Record benchmark numbers in the PR/task report.

## Acceptance

```sh
deno test -A tests/lexer_test.ts tests/runtime_language_test.ts
deno run --allow-read --allow-write bench/ts_vs_wasm.ts
```

Generated source size must not grow unexpectedly for small grammars.

## Do Not Touch

- Do not change token precedence semantics.
- Do not change regex AST semantics.
