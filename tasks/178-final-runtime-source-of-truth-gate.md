# Task 178: Final Runtime Source-Of-Truth Gate

## Goal

Close FEEDBACK Requirement 1 and the remaining release proof:

```text
One parser plan, one runtime implementation, two execution targets,
identical behavior.
```

This is the final verification and cleanup task after `170`-`177`.

## Depends On

- `170-runtime-source-of-truth-cutline.md`
- `171-runtime-dynamic-source-text-handles.md`
- `172-runtime-lexer-driver-lowering.md`
- `173-runtime-token-stream-normalization-lowering.md`
- `174-runtime-replay-vm-lowering.md`
- `175-runtime-public-materialization-boundary.md`
- `176-runtime-diagnostic-render-boundary.md`
- `177-runtime-wasm-host-neutral-abi.md`

## Files To Inspect

- `tasks/status.md`
- `FEEDBACK.md`
- `README.md`
- `docs/runtime-language.md`
- `tests/runtime_plan_test.ts`
- `tests/runtime_language_test.ts`
- `tests/ts_wasm_parity_test.ts`
- `tests/wasm_test.ts`
- generated examples under `examples/*/generated`

## Search Commands

```sh
rg -n "partial|Still unresolved|source of truth|host boundary|TODO|FIXME|bestCandidate|reduceProduction|compactTokenStream|validateTokenStream" FEEDBACK.md README.md docs tasks src tests examples
```

## Work

1. Run the source-of-truth audit from task `170` again.
2. Remove or rewrite stale "partial" language in `FEEDBACK.md`, README, docs,
   and tasks only when the code and tests prove it.
3. Add final runtime-plan tests that reject the old host algorithm markers.
4. Regenerate examples and manifests.
5. Mark Requirement 1 done in `tasks/status.md` only if the proof is real.
6. Run the full release gate.

## Acceptance

- `tasks/status.md` marks all 21 FEEDBACK requirements done.
- Testing priorities remain all done.
- No old host runtime algorithm markers remain outside documented host
  boundaries.
- Full gate passes:

```sh
deno task bootstrap:check
deno fmt --check
git diff --check
deno lint
deno task check
deno task test
deno publish --dry-run --allow-dirty
```

## Do Not Touch

- Do not mark Requirement 1 done because the gate is merely green; mark it done
  only when the source-of-truth cutline is satisfied.
- Do not hide remaining runtime duplication in docs.
- Do not remove optional hardening backlog items from task `160`.
