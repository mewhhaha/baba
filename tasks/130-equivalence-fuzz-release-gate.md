# Task 130: Equivalence, Fuzz, And Release Gate

## Goal

Own the final proof for FEEDBACK testing priorities and release readiness. Run
this after the implementation tasks land.

## Files To Inspect

- `tests/ts_wasm_parity_test.ts`
- `tests/tree_sitter_test.ts`
- `tests/fuzz_test.ts`
- `tests/wasm_test.ts`
- `tests/parser_kit_test.ts`
- `scripts/bootstrap_check.ts`
- `deno.json`
- `CHANGELOG.md`

## Search Commands

```sh
rg -n "parity|fuzz|deterministic|memory reuse|Unicode|emoji|combining|CRLF|NUL|U\\+2028|conflict|bootstrap" tests scripts README.md docs
```

## Required Coverage

Verify tests cover:

- TypeScript/Wasm exact equivalence for token kinds, spans, diagnostics, CST
  rules, children, and fields.
- Tree-sitter acceptance equivalence for valid and invalid corpus cases.
- Contextual lexical ambiguity or strict overlap rejection.
- Wasm repeated parse memory reuse.
- Regex resource exhaustion.
- Unicode: emoji, combining marks, CRLF, NUL, U+2028/U+2029.
- Runtime-language conformance for every documented operator/control-flow rule.
- Bootstrap determinism.
- Fuzzing for regex parser, NFA/DFA, overlap intersection, LR generation,
  runtime-language compiler, Wasm ABI, and generated parser input.

## Work

1. Add missing tests only. Do not change implementation unless a test exposes a
   real bug.
2. Regenerate examples if runtime/source changes require it:

   ```sh
   deno task bootstrap
   ```

3. Run the full release gate:

   ```sh
   deno task bootstrap:check
   deno fmt --check
   git diff --check
   deno task check
   deno task test
   deno publish --dry-run --allow-dirty
   ```

4. Update `CHANGELOG.md` only if behavior changed since the current version
   entry.

## Acceptance

- Every command above passes.
- `tasks/status.md` has no `missing` or `unclear` P0 entries.
- `FEEDBACK.md` unresolved section reflects only genuinely future work.

## Do Not Touch

- Do not mark the overall goal complete without a requirement-by-requirement
  audit.
- Do not bump version unless explicitly asked by the coordinator.
