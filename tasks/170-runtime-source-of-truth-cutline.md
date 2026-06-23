# Task 170: Runtime Source-Of-Truth Cutline

## Goal

Define the final FEEDBACK P0.1 boundary precisely enough that the remaining
runtime-lowering work can be implemented without arguing case by case.

The end state should distinguish:

- runtime-owned parser semantics;
- host-owned JavaScript source/string capabilities;
- host-owned public object allocation;
- host-owned human-readable text rendering;
- generated packaging glue that is allowed to remain in TypeScript/Wasm targets.

## Current Starting Point

`tasks/status.md` says only Requirement 1 remains partial. Closure tasks
`140`-`143` moved more helper decisions into the runtime language, but the full
mechanical lowering of all parser-runtime code remains open.

## Files To Inspect

- `tasks/status.md`
- `FEEDBACK.md`
- `docs/runtime-language.md`
- `src/targets/runtime/typescript_lexer_runtime.ts`
- `src/targets/runtime/typescript_parser_runtime.ts`
- `src/targets/wasm/lexer_emit.ts`
- `src/targets/wasm/runtime_emit.ts`
- `tests/runtime_plan_test.ts`

## Search Commands

```sh
rg -n "Still unresolved|source of truth|host boundary|Generated TypeScript|Generated Wasm|runtime-language" FEEDBACK.md docs tasks src/targets/runtime src/targets/wasm tests/runtime_plan_test.ts
rg -n "function .*|while \\(|switch \\(|if \\(|for \\(" src/targets/runtime/typescript_lexer_runtime.ts src/targets/runtime/typescript_parser_runtime.ts src/targets/wasm/lexer_emit.ts
```

## Work

1. Inventory every remaining generated host-side algorithm in lexer, parser,
   replay, diagnostics, and Wasm adapter code.
2. Classify each item as one of:
   - must be lowered into runtime language;
   - allowed host capability boundary;
   - allowed public object allocation;
   - allowed display/string rendering;
   - generated packaging only.
3. Add a concise cutline document to `docs/runtime-language.md` or a new
   dedicated docs file.
4. Add or tighten `tests/runtime_plan_test.ts` marker checks for the final
   allowed/forbidden boundaries.
5. Update `tasks/status.md` so later tasks can close individual rows rather than
   restating the whole audit.

## Acceptance

- There is one documented final P0.1 cutline.
- Every task after this one references that cutline.
- `tasks/status.md` lists the exact remaining lowering categories.
- Focused checks pass:

```sh
deno fmt --check
git diff --check
deno test -A tests/runtime_plan_test.ts
```

## Do Not Touch

- Do not move runtime code in this task except for marker tests needed to make
  the cutline executable.
- Do not redefine public API object shapes.
- Do not downgrade any completed FEEDBACK requirement.

## Completion Notes

Completed on 2026-06-23.

- Added `Runtime Source-Of-Truth Cutline` to `docs/runtime-language.md`,
  explicitly separating runtime-owned semantics, host-owned boundaries, and
  forbidden post-closure duplication.
- Added `tests/runtime_plan_test.ts` coverage so the cutline and `170`-`178`
  sequence stay visible in docs/status.
- Left `173`-`178` open because they require real runtime/ABI lowering work and
  must not be marked complete by documentation alone.
