# T02: Compact parser-plan format

- **Priority:** P0
- **Size:** Large
- **Depends on:** [T00](./T00-measure-runtime-size-and-latency.md)
- **Suggested PR title:** `Compact runtime parser plans and strip debug data`

[Back to index](./README.md)

## Objective

Make parser plans small enough to load quickly and cheap enough to ship. The runtime plan should contain only the data required to lex, parse, and optionally build a CST.

## Problem

Large parser output is not only caused by generated algorithms. Plans and tables can also be bloated by:

- JSON object keys repeated thousands of times;
- LR item sets included in runtime data;
- source spans and origins needed only for compiler diagnostics;
- repeated strings;
- redundant deprecated fields;
- sparse table encodings;
- row arrays full of one-entry rows;
- no binary format;
- no compression-friendly ordering.

A small runtime cannot save the user if the plan is huge.

## Required work

### 1. Split runtime plan from debug plan

Define two artifacts:

```text
parser-plan.runtime.json/bin   # minimal data needed by runtime
parser-plan.debug.json         # optional diagnostics/debug/source mapping data
```

Runtime plan should include:

- token/literal IDs;
- compact lexer transition tables;
- accept candidate tables;
- LR ACTION/GOTO tables;
- reducer opcodes;
- field schema IDs;
- string table IDs;
- runtime diagnostic display data.

Runtime plan should not include by default:

- LR item sets;
- lookahead item sets;
- production source spans;
- full production origins;
- human-readable conflict explanations;
- deprecated `array`/`nullable` duplicates if `cardinality` exists;
- full grammar source;
- metadata source paths;
- debug statistics.

Keep those in the debug plan only.

### 2. Add a string table

Instead of repeating names:

```json
{ "kind": "named", "key": "IDENT", "display": "IDENT" }
```

Use:

```json
{
  "strings": ["IDENT", "INTEGER", "module", "name"],
  "tokens": [[0, 0, 1, 0]]
}
```

or a readable-but-compact form if binary is not ready.

Strings to intern:

- token names;
- literal values;
- rule names;
- field names;
- diagnostic displays;
- semantic version strings;
- conflict IDs.

### 3. Add a binary format

JSON is okay for debugging but inefficient for runtime loading. Add a binary plan artifact.

Suggested binary layout:

```text
magic: BABA_PLAN\0
version: u16
flags: u16
section_count: u32
section_directory[]
sections...
checksum/hash
```

Sections:

```text
strings
lexer_specs
lexer_transition_rows
lexer_transitions
lexer_accept_rows
lexer_accepts
parser_action_rows
parser_actions
parser_goto_rows
parser_gotos
productions
reducers
fields
diagnostics
```

Use varints or fixed `u32` arrays. Prefer simple and fast over overly clever compression.

### 4. Compress table rows

For LR and DFA tables, use row-index + flat entries:

```ts
const actionRowStart: Uint32Array;
const actionTerminal: Uint32Array;
const actionKind: Uint8Array;
const actionPayload: Uint32Array;
```

Instead of:

```json
[
  { "state": 0, "entries": [ ... ] },
  { "state": 1, "entries": [ ... ] }
]
```

For empty rows, store identical start/end offsets.

### 5. Consider row interning

Many parser rows are identical. Detect and intern them.

Example:

```text
row 4 == row 19 == row 23
```

Store one row and map states to row IDs:

```ts
stateToActionRow[state] = rowId
```

Do this only if it reduces size on benchmarks. Keep the simpler flat encoding if row interning does not help.

### 6. Use table classes for lexer transitions

DFA transition ranges may be large. Provide alternative encodings and pick per-state:

```text
small linear row       # 0-4 ranges
binary-search row      # sorted ranges
ascii fast table       # dense ASCII states
unicode range row      # non-ASCII ranges
```

The plan can encode a row kind:

```ts
enum DfaRowKind {
  Empty,
  Linear,
  BinarySearch,
  AsciiTable,
}
```

### 7. Encode reducers compactly

Map reducer operations to numeric opcodes:

```text
0 start
1 rule
2 terminal
3 rule-ref
4 sequence
...
```

Payloads should be numeric IDs, not strings.

### 8. Add a plan inspector

Add:

```sh
baba inspect-plan parser-plan.bin
```

or a script:

```sh
deno run scripts/inspect_plan.ts generated/parser-plan.bin
```

It should print:

```text
format/version/hash
strings: 73, 1.9 KB
lexer states: 220
lexer transitions: 980
parser states: 640
ACTION entries: 1800
GOTO entries: 620
reducers: 910
binary size: 37 KB
json size: 142 KB
```

### 9. Keep readable development mode

Support:

```sh
--plan-format json
--plan-format binary
--emit-debug-plan
```

Default should optimize for runtime size:

```text
binary runtime plan + optional generated types
```

If JSON remains the default for compatibility, the PR should still establish binary support and budget targets.

## Concrete example

### Bloated runtime JSON

```json
{
  "productions": [
    {
      "id": 14,
      "stableId": "p_abc",
      "lhs": 7,
      "rhs": [{ "kind": "terminal", "id": 3 }],
      "reducer": { "kind": "field", "name": "name" },
      "span": { "start": 120, "end": 130, "line": 9, "column": 4 },
      "origin": { "ruleName": "decl", "description": "decl = ..." }
    }
  ]
}
```

### Runtime plan equivalent

```text
production_lhs[14] = 7
production_rhs_start[14] = 32
production_rhs_len[14] = 1
production_reducer[14] = 12
reducer_op[12] = FIELD
reducer_payload[12] = field_id("name")
```

Debug data moves to:

```text
parser-plan.debug.json
```

## Likely files

- `src/targets/runtime/portable_plan.ts`
- new `src/targets/runtime/portable_plan_binary.ts`
- new `src/targets/runtime/portable_plan_compact.ts`
- `src/targets/typescript/plan.ts`
- `src/targets/wasm/plan.ts`
- `src/targets/kit/*`
- `src/cli.ts`
- `scripts/inspect_plan.ts`
- `tests/portable_plan_test.ts`
- `tests/runtime_smoke.ts`

## Tests

1. compact binary round-trip;
2. invalid magic/version rejected;
3. truncated sections rejected;
4. invalid indexes rejected;
5. string table round-trip;
6. row interning correctness if implemented;
7. runtime can parse from compact plan;
8. debug plan has spans/origins; runtime plan does not;
9. binary plan is smaller than JSON plan on fixtures;
10. generated output size budget improves;
11. deterministic bytes for same grammar;
12. corrupt binary does not crash.

## Acceptance criteria

- Runtime plan excludes debug-only data by default.
- Binary runtime plan exists and is deterministic.
- Runtime can execute the compact plan.
- Plan inspector exists.
- Large-runtime fixture plan size drops significantly from T00 baseline.
- No public runtime needs LR item sets, source spans, or production origin strings to parse.

## Out of scope

- changing parser semantics;
- shared runtime architecture itself; see T01;
- Wasm cold-start architecture; see T03;
- CST laziness; see T05.

## Copy-ready agent prompt

> Implement T02 from `tasks/T02-compact-parser-plan-format.md`. Split runtime and debug parser plans, add string interning, compact row encodings, numeric reducer opcodes, deterministic binary serialization, a plan inspector, and tests proving runtime correctness plus size reduction. Keep debug source spans and LR item data out of runtime artifacts by default.
