# Metadata

Status: current metadata guide for schema version 2.

Baba metadata is optional JSON loaded next to a grammar or passed through the
CLI. Metadata controls target-specific syntax shaping, query generation, root
selection, and external scanner declarations without changing the grammar
language itself.

## Versioning

Metadata files should declare:

```json
{
  "version": 2
}
```

Omitting `version` uses the current schema. Explicit schema version `1` is no
longer accepted. Schema version `2` is the current stable metadata schema.
Additive fields may be accepted in compatible releases; incompatible selector or
default changes need a new schema version or a documented breaking release.

## Tree-Sitter Metadata

Tree-sitter metadata can describe externals, hidden or inline shaping, aliases,
highlight captures, rainbow captures, and query fragments. Generated query files
are derived from metadata and validated by repository tests.

External scanner symbols are Tree-sitter-only capabilities. They must be
declared explicitly and implemented outside Baba.

## Portable Runtime Metadata

TypeScript, Wasm, and kit targets consume the portable parser plan. Metadata
that affects syntax must lower into that plan deterministically. Metadata that
requires Tree-sitter-only behavior should produce a target-specific or portable
diagnostic rather than silently changing runtime semantics.

### Parser Conflict Policy

The optional `parser` block controls standalone parser conflict handling:

```json
{
  "version": 2,
  "parser": {
    "resolutions": [
      { "conflict": "c_91a8...", "prefer": "shift" }
    ],
    "conflicts": [
      { "conflict": "c_ef90..." }
    ]
  }
}
```

`resolutions` make a conflict deterministic. `conflicts` declares a conflict
that may be explored with bounded branch search. Stable conflict IDs reported by
diagnostics are required selectors for both fields.

## Compatibility

Consumers should treat metadata as user-authored input. Invalid metadata should
produce structured diagnostics, and generated targets should not depend on
private metadata object shapes after analysis has built the portable plan.
