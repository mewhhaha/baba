# Task 010: Runtime Source-Of-Truth Audit

## Goal

Reduce or precisely document remaining TypeScript/Wasm runtime duplication. This
task is an audit-and-small-fix task for FEEDBACK P0.1.

## Files To Inspect

- `src/targets/runtime/typescript_parser_runtime.ts`
- `src/targets/runtime/typescript_lexer_runtime.ts`
- `src/targets/runtime/language_sources.ts`
- `src/targets/runtime/wasm_core_runtime.ts`
- `src/targets/typescript/`
- `src/targets/wasm/`
- `tests/runtime_plan_test.ts`
- `docs/runtime-language.md`
- `FEEDBACK.md`

## Search Commands

```sh
rg -n "for \\(|while \\(|switch \\(|bestCandidate|DFA_TRANSITIONS|reduceProduction|parserTrace|parserField|parserReducer|parserToken|diagnostic|CST|children|fields" src/targets/typescript src/targets/wasm src/targets/runtime
rg -n "assertNotIncludes|assertIncludes" tests/runtime_plan_test.ts
```

## Work

1. List each remaining host-side parser algorithm in `tasks/status.md` under
   `P0.1`.
2. Pick one small host-side classification/arithmetic decision and move it to a
   runtime-language helper in `src/targets/runtime/language_sources.ts`.
3. Use the generated TypeScript runtime only to call that helper and allocate
   host objects.
4. Add or tighten assertions in `tests/runtime_plan_test.ts`.
5. Add conformance coverage in `tests/runtime_language_test.ts` if a new helper
   is added.
6. Update `docs/runtime-language.md` and `FEEDBACK.md`.

## Good Candidate Changes

- Host-side status mapping for public object materializers.
- Host-side "empty versus present" decisions.
- Host-side small arithmetic around stack/vector indexes.
- Host-side numeric status interpretation that is not public object allocation.

## Acceptance

- New helper has TypeScript/Wasm runtime-language conformance coverage.
- Generated parser template no longer contains the old direct check.
- `tests/runtime_plan_test.ts` fails if the old direct check returns.
- Focused checks pass:

```sh
deno fmt --check
git diff --check
deno test -A tests/runtime_language_test.ts tests/runtime_plan_test.ts
```

## Do Not Touch

- Do not redesign the runtime language.
- Do not move large object allocation graphs in this task.
- Do not update all generated examples unless your change requires bootstrap.
