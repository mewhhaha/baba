# T07: Stable conflicts and bounded ambiguity

- **Priority:** P0
- **Estimated size:** Large
- **Merge wave:** 2
- **Depends on:** [T01](./T01-versioned-portable-parser-plan.md)
- **Suggested PR title:** `Replace textual conflict matching with stable production identities`

[Back to task index](./README.md)

## Objective

Replace fragile text-based parser conflict selection with stable structural identities and define a bounded, deterministic ambiguity policy shared by TypeScript and Wasm.

## Problem

Current parser conflict metadata can match rule names and substrings of human-readable production descriptions. That is convenient for diagnostics but unsafe as a compatibility mechanism.

A harmless grammar refactor can change the generated description and silently alter which action is resolved. Declared conflicts also enable branch search, but the resource model and multiple-success policy are not yet a strong public contract.

## Required work

### 1. Assign stable structural identities

Every conflict-relevant user alternative and production needs an identity derived from grammar structure rather than formatting or generated description text.

Possible forms:

```text
rule:primary/alternative:1
rule:postfix/field:suffixes/repeat
rule:module/sequence:0/ref:item
```

Or use deterministic opaque IDs:

```text
p_2d4f...
c_91a8...
```

Requirements:

- stable across whitespace and comments;
- stable across metadata changes unrelated to grammar structure;
- deterministic across runs;
- changes when the selected expression's semantics change;
- never based only on array index if earlier unrelated alternatives can be inserted;
- accompanied by a human-readable description in diagnostics.

### 2. Give every LR conflict a stable ID

A conflict ID should be derived from:

- LR semantic plan version;
- lookahead terminal identity;
- competing action identities;
- origin production identities.

Diagnostics should report:

```text
conflict ID: c_abcd1234
lookahead: "["
actions: shift ..., reduce ...
origins: ...
```

### 3. Redesign metadata selectors

Introduce stable conflict selectors. A future metadata version is acceptable:

```json
{
  "version": 2,
  "parser": {
    "resolutions": [
      {
        "conflict": "c_abcd1234",
        "prefer": "shift"
      }
    ],
    "conflicts": [
      {
        "conflict": "c_ef901234",
        "mode": "branch"
      }
    ]
  }
}
```

Alternative selector form:

```json
{
  "rules": ["generic", "identifier"],
  "on": "[",
  "prefer": "shift",
  "productions": ["p_...", "p_..."]
}
```

The stable conflict ID should be the preferred generated suggestion.

### 4. Preserve and migrate version 1 metadata

Continue reading existing `rules`/`on`/`reduce` selectors where practical.

For v1 selectors:

- resolve them against structural origins;
- reject selectors that match zero conflicts;
- reject or warn when a selector matches more than one conflict;
- emit an information/deprecation diagnostic containing the v2 replacement;
- provide a migration helper or copy-ready JSON in diagnostics.

Do not keep `description.includes(...)` matching as the permanent resolution mechanism.

### 5. Validate all conflict metadata

Detect:

- unknown conflict ID;
- unknown production ID;
- unknown rule;
- terminal selector that does not match;
- selector matching no action;
- selector matching multiple actions unexpectedly;
- duplicate resolutions;
- contradictory resolutions;
- `prefer: reduce` without enough information for reduce/reduce;
- declared branch conflict that never occurs;
- resolution and branch declaration targeting the same conflict incompatibly;
- references to unreachable rules.

Diagnostics should point to metadata paths.

### 6. Formalize branch-search semantics

Document and implement identical semantics in portable runtime plan/BRL:

- deterministic action ordering;
- depth-first or breadth-first queue policy;
- whether the original action is explored first;
- branch cloning model;
- best-failure selection;
- maximum explored branches;
- maximum queued branches;
- maximum parser stack cells;
- maximum trace actions;
- maximum copied branch cells;
- cancellation/limit diagnostic codes;
- behavior when multiple branches succeed;
- whether ambiguous success is reported.

Recommended default:

- deterministic depth-first order based on stable action sort;
- stop at first success only when policy is `first-success`;
- support a stricter `reject-ambiguous-success` mode;
- expose an information/debug result only through advanced APIs, not normal parse results.

### 7. Add configurable runtime limits

Shared options might include:

```ts
interface PortableRuntimeAmbiguityOptions {
  maxExploredBranches?: number;
  maxQueuedBranches?: number;
  maxBranchCells?: number;
  maxTraceActions?: number;
  ambiguityMode?: "first-success" | "reject-ambiguous-success";
}
```

TypeScript and Wasm must use the same defaults and failure codes.

### 8. Make diagnostics actionable

Unresolved conflict diagnostics must include:

- stable conflict ID;
- lookahead;
- all competing actions;
- user-level origin descriptions;
- source and related spans;
- copy-ready deterministic resolution metadata;
- copy-ready branch metadata where appropriate;
- explanation of semantic consequences.

### 9. Add plan-level conflict validation

`validatePortableParserPlan()` should verify:

- action sets contain only declared unresolved/branch conflicts;
- deterministic conflicts have one action;
- branch conflicts refer to a valid conflict policy entry;
- action ordering is canonical;
- conflict IDs are unique.

## Likely files

- `src/targets/typescript/bnf.ts`
- `src/targets/typescript/lr1.ts`
- `src/compiler/portable_plan/*`
- `src/metadata.ts`
- `src/ast.ts`
- BRL runtime parser/branch files after T03
- `tests/parser_conflict_resolution_test.ts`
- `tests/ts_wasm_parity_test.ts`

## Tests

1. conflict IDs stable across whitespace/comments;
2. unrelated rule addition does not change existing IDs where structurally possible;
3. changed alternative changes relevant production/conflict ID;
4. v1 selector migration diagnostic;
5. v1 selector matching multiple conflicts is rejected;
6. stale v2 ID is rejected;
7. duplicate/contradictory resolutions;
8. shift/reduce and reduce/reduce selection;
9. declared conflict with no actual LR conflict;
10. high fan-out branch search;
11. branch/queue/cell/trace limit failures;
12. multiple successful parses under both ambiguity modes;
13. best-failure ordering;
14. exact TypeScript/Wasm parity;
15. plan corruption around conflict tables.

## Acceptance criteria

- Runtime conflict resolution never depends on `description.includes(...)`.
- Every conflict has a stable ID and human-readable origins.
- Metadata selectors are validated and unambiguous.
- Legacy metadata receives actionable migration guidance.
- Branch search is explicitly bounded.
- Multiple-success behavior is documented and tested.
- TypeScript and Wasm have identical action order, limits, and diagnostics.

## Out of scope

- full GLR parse forest construction;
- editor-grade error recovery;
- automatic semantic precedence inference;
- changing Tree-sitter's own conflict semantics;
- incremental parsing;
- arbitrary user callbacks during conflict resolution.

## Copy-ready agent prompt

> Implement T07 from `tasks/T07-stable-conflicts-and-bounded-ambiguity.md`. Replace textual conflict matching with stable structural production/conflict IDs, validate and migrate metadata selectors, and formalize bounded branch-search semantics including multiple-success behavior. Keep TypeScript and Wasm exactly aligned.

## PR checklist

- [ ] Stable production IDs implemented.
- [ ] Stable conflict IDs implemented.
- [ ] Metadata v2 or stable selector shape added.
- [ ] v1 compatibility/migration handled.
- [ ] Conflict metadata fully validated.
- [ ] Branch limits and ambiguity policy documented.
- [ ] TypeScript/Wasm parity tests pass.
- [ ] Full repository checks pass.
