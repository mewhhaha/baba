# ADR 0006: Conflict Policy

Status: accepted.

## Context

Standalone LR parser conflicts need deterministic resolution when intentional,
stable metadata when grammar edits move state numbers, and bounded behavior for
declared ambiguous local grammars.

## Decision

Baba emits stable structural conflict IDs in diagnostics. Metadata can resolve a
conflict by stable ID, and `metadata.parser.conflicts` can declare a branchable
conflict with the same stable ID shape:

```json
{ "conflict": "c_91a8..." }
```

Legacy rule/token selectors and rule-group branch declarations remain compatible
with replacement guidance. Declared branch conflicts use bounded deterministic
branch search with configurable explored-branch, queued-branch, and trace-action
limits. `ambiguityMode` controls whether the first success is accepted or
multiple successful branches are rejected.

## Consequences

Stale conflict metadata is diagnosed instead of ignored. Branch search preserves
deterministic action ordering and returns structured limit or ambiguity
diagnostics when configured budgets are exceeded.

## Rejected Alternatives

- Requiring users to target generated LR state numbers.
- Leaving unresolved conflicts to backend-specific defaults.
- Implementing unbounded GLR parsing.

## Compatibility Impact

Stable conflict IDs are the preferred metadata selector for deterministic
resolutions and branch declarations. Legacy selectors remain supported for
compatibility but can produce informational replacement diagnostics.
