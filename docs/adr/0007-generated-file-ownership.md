# ADR 0007: Generated File Ownership

Status: accepted.

## Context

Baba writes generated source, query, JSON, and binary artifacts. Regeneration
must be reproducible, but user edits and generated snapshots should not be
silently overwritten or published as source.

## Decision

Generated output is tracked by `.baba-manifest.json` ownership metadata.
`applyBundle()` refuses unsafe paths, nested path collisions, and overwrites of
modified or unowned files. Checked-in example generated outputs are treated as
snapshots verified by bootstrap tasks, and generated example snapshots are
excluded from the publish payload.

## Consequences

Regeneration is explicit and reviewable. Binary artifacts and text artifacts use
the same ownership rules. The package publishes example inputs and user-owned
runners rather than generated example outputs.

## Rejected Alternatives

- Overwriting generated output unconditionally.
- Treating checked-in generated example directories as user-authored source.
- Publishing all generated example artifacts by default.

## Compatibility Impact

Users who edit generated files must either regenerate from source or remove the
ownership manifest intentionally. Publish consumers should run example
`generate` tasks when they need example generated artifacts.
