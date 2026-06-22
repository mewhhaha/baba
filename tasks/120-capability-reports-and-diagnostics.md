# Task 120: Capability Reports And Diagnostics

## Goal

Finish FEEDBACK P2.21 plus the P2 follow-ups for improved source maps,
diagnostic rendering, and parser-conflict witness sequences.

## Files To Inspect

- `src/cli.ts`
- `src/api.ts`
- `src/compiler/diagnostics.ts`
- `src/targets/runtime/plan.ts`
- `tests/api_test.ts`
- `tests/output_test.ts`
- `tests/parser_conflict_resolution_test.ts`
- `README.md`

## Search Commands

```sh
rg -n "check|explain-targets|capability|Diagnostic|source map|render|conflict|witness|expected" src tests README.md
```

## Work

1. Ensure `baba check grammar.ebnf --explain-targets` reports Tree-sitter,
   TypeScript, Wasm, and kit support independently.
2. Include portable guarantees and limitations:
   - identical regex semantics;
   - no external tokens;
   - contextual token overlap status;
   - unsupported regex/backend features.
3. Improve diagnostic rendering only where the capability report needs it.
4. Add parser-conflict witness sequences if missing.

## Acceptance

```sh
deno test -A tests/api_test.ts tests/output_test.ts tests/parser_conflict_resolution_test.ts
```

README documents the command and gives a realistic output example.

## Do Not Touch

- Do not implement an LSP or formatter.
- Do not make target support claims that are not backed by tests.
