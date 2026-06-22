# Task 160: Release Hardening Follow-Ups

## Goal

Collect the non-blocking hardening items left in `tasks/status.md` so they do
not get confused with unfinished release blockers.

Status: optional backlog, not a release blocker. Keep this card open only as a
source of future hardening work; do not treat its items as required to satisfy
the FEEDBACK release gate unless a selected item exposes a correctness
regression.

## Items Covered

- Wasm lifecycle edge-case tests:
  - ownership transfer;
  - invalid handle use;
  - reset invalidation;
  - overflow boundaries.
- Unicode/span matrix:
  - emoji;
  - combining marks;
  - CRLF;
  - NUL;
  - U+2028/U+2029.
- Runtime-language semantic extras:
  - object/model boundary conformance;
  - additional control-flow and trap assertions.
- Tree-sitter negative corpus:
  - invalid fixtures where Tree-sitter and TypeScript must both reject or report
    non-acceptance.
- Regex resource-exhaustion expansion:
  - nested alternation;
  - mixed class explosion.
- Fuzz replay:
  - seed corpus persistence;
  - replay artifacts for failing generated grammars or inputs.
- Wasm stress mode:
  - longer repeated-parse memory reuse loop suitable for CI stress jobs.

## Files To Inspect

- `tests/wasm_test.ts`
- `tests/runtime_language_test.ts`
- `tests/tree_sitter_test.ts`
- `tests/lexer_test.ts`
- `tests/regex_test.ts`
- `tests/fuzz_test.ts`
- `fixtures/`
- `README.md`
- `docs/runtime-language.md`
- `tasks/status.md`

## Work

1. Split this card if a hardening item grows beyond a focused patch.
2. Add tests first; only change implementation if a test exposes a real bug.
3. Keep each hardening item traceable to one status entry.
4. Update docs only when behavior or release-gate expectations change.
5. Update `tasks/status.md` after each item lands.

## Acceptance

- Each selected hardening item has a failing-before/passing-after test or a
  clearly documented reason it is not executable.
- Full gate remains green:

```sh
deno task bootstrap:check
deno fmt --check
git diff --check
deno task check
deno task test
deno publish --dry-run --allow-dirty
```

## Do Not Touch

- Do not mark these items as release blockers unless they uncover a correctness
  regression.
- Do not broaden fuzzing into unbounded or nondeterministic CI work.
