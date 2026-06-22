# Task 001: Current-State Audit

## Goal

Produce a short local audit of which FEEDBACK requirements are already proven,
which are partially implemented, and which remain missing. Do not change runtime
behavior in this task unless a check fails because of stale generated artifacts.

## Files To Read

- `FEEDBACK.md`
- `README.md`
- `docs/runtime-language.md`
- `src/targets/runtime/`
- `src/targets/typescript/`
- `src/targets/wasm/`
- `tests/runtime_plan_test.ts`

## Commands

```sh
git status --short --branch
rg -n "^## [0-9]+\.|^# P0|^# P1|^# P2|Testing priorities|Recommended implementation order" FEEDBACK.md
rg -n "parserPlan|PortableParserPlan|runtimeImplementation|parserField|parserTrace|parseTokens|wasmAbi|abi_version|bootstrap" src tests docs README.md
deno task bootstrap:check
deno test -A tests/runtime_plan_test.ts tests/runtime_language_test.ts
```

## Work

1. Create or update `tasks/status.md`.
2. Use a table with columns: `Requirement`, `Evidence`, `Status`, `Next task`.
3. Mark status as only one of: `done`, `partial`, `missing`, `unclear`.
4. Use exact file/test evidence. Do not rely on memory.
5. If a requirement is `unclear`, add the exact `rg` command or test needed to
   prove it.

## Acceptance

- `tasks/status.md` exists.
- Every FEEDBACK numbered issue 1 through 21 has an entry.
- Every FEEDBACK testing-priority item 1 through 9 has an entry.
- `deno task bootstrap:check` passes or the failure is copied into the audit.

## Do Not Touch

- Do not edit generated examples.
- Do not edit runtime source except to fix stale manifest output if explicitly
  required by `bootstrap:check`.
