# FEEDBACK.md Task Backlog For gpt-5.3-codex spark

Goal: finish implementing `FEEDBACK.md`, especially the release-blocking proof:

```text
One parser plan, one runtime implementation, two execution targets,
identical behavior.
```

## Suggested Order

Each item is intended to be one Spark handoff unless the coordinator decides to
split it further. Assign only one task file per Spark run.

1. `001-current-state-audit.md`
2. `010-runtime-source-of-truth-audit.md`
3. `011-runtime-host-source-text-lowering.md`
4. `012-runtime-public-object-materialization.md`
5. `013-runtime-error-payloads.md`
6. `020-portable-parser-plan-audit.md`
7. `030-contextual-lexing-and-overlap.md`
8. `040-regex-single-source-and-tree-sitter.md`
9. `050-wasm-abi-lifecycle-and-hosts.md`
10. `060-tree-sitter-ir-plan.md`
11. `070-regex-automata-cache-and-limits.md`
12. `080-dfa-dispatch-benchmark.md`
13. `090-parse-tokens-contract.md`
14. `100-runtime-language-spec-conformance-bootstrap.md`
15. `110-public-api-ergonomics.md`
16. `120-capability-reports-and-diagnostics.md`
17. `130-equivalence-fuzz-release-gate.md`

## Completed Closure Tasks

These cards were added after the audit showed the release gate passing with two
partial/future-work areas still worth tracking. They now have focused runtime
helper coverage and status evidence; rerun
`130-equivalence-fuzz-release-gate.md` after touching this area again.

18. `140-runtime-source-text-boundary-closure.md`
19. `141-runtime-token-stream-boundary-closure.md`
20. `142-runtime-replay-and-materialization-closure.md`
21. `143-runtime-diagnostic-payload-closure.md`
22. `150-independent-wasm-engine-ci.md`

## Non-Blocking Hardening Backlog

This card intentionally tracks optional release hardening ideas rather than
unfinished release blockers.

23. `160-release-hardening-followups.md`

## Completed Runtime Source-Of-Truth Follow-Ups

These cards narrow the final FEEDBACK P0.1 source-of-truth boundary after the
cutline task.

24. `171-runtime-dynamic-source-text-handles.md`
25. `172-runtime-lexer-driver-lowering.md`

## Remaining Runtime Source-Of-Truth Work

These cards cover the last partial FEEDBACK item after the source-text boundary
task: full mechanical lowering of the parser runtime through the runtime
language. They are intentionally sequenced because each one narrows the
host/runtime boundary for the next.

26. `173-runtime-token-stream-normalization-lowering.md`
27. `174-runtime-replay-vm-lowering.md`
28. `175-runtime-public-materialization-boundary.md`
29. `176-runtime-diagnostic-render-boundary.md`
30. `177-runtime-wasm-host-neutral-abi.md`
31. `178-final-runtime-source-of-truth-gate.md`

## Coverage Map

- FEEDBACK P0.1: `010`, `011`, `012`, `013`
- FEEDBACK P0.2: `020`
- FEEDBACK P0.3 and P0.4: `030`
- FEEDBACK P0.5 and P0.6: `040`
- FEEDBACK P0.7, P0.8, P1.16, P1.17: `050`
- FEEDBACK P1.9: `060`
- FEEDBACK P1.10: `070`
- FEEDBACK P1.11: `080`
- FEEDBACK P1.12: `090`
- FEEDBACK P1.13, P1.14, P1.15: `100`
- FEEDBACK P2.18, P2.19, P2.20: `110`
- FEEDBACK P2.21 plus P2 diagnostics: `120`
- FEEDBACK testing priorities and final release proof: `130`
- Completed FEEDBACK P0.1 closure: `140`, `141`, `142`, `143`
- Completed FEEDBACK P0.1 cutline: `170`
- Completed FEEDBACK P0.1 source text handles: `171`
- Completed FEEDBACK P0.1 lexer driver lowering: `172`
- Remaining full FEEDBACK P0.1 runtime-source-of-truth work: `173` through `178`
- Completed FEEDBACK P1.17 environment/CI closure: `150`
- Non-blocking hardening follow-ups from `tasks/status.md`: `160`

Many items are partially implemented. Each task starts with an audit step. If
the current code already proves the requirement, add or tighten regression
coverage and update `FEEDBACK.md` with the evidence rather than rewriting it.

## Parallelization Notes

Safe first wave for parallel Spark agents:

- `001-current-state-audit.md`
- `020-portable-parser-plan-audit.md`
- `090-parse-tokens-contract.md`
- `110-public-api-ergonomics.md`

Likely conflict-heavy tasks. Assign these one at a time or after syncing:

- `010-runtime-source-of-truth-audit.md`
- `011-runtime-host-source-text-lowering.md`
- `012-runtime-public-object-materialization.md`
- `013-runtime-error-payloads.md`
- `100-runtime-language-spec-conformance-bootstrap.md`

Tasks that often touch shared diagnostics/compiler planning and should be
sequenced carefully:

- `030-contextual-lexing-and-overlap.md`
- `040-regex-single-source-and-tree-sitter.md`
- `060-tree-sitter-ir-plan.md`
- `070-regex-automata-cache-and-limits.md`
- `120-capability-reports-and-diagnostics.md`

Always run `130-equivalence-fuzz-release-gate.md` last.

After any `140`-`178` task lands, run `130-equivalence-fuzz-release-gate.md`
again. Run `178-final-runtime-source-of-truth-gate.md` last before declaring
Requirement 1 complete.
