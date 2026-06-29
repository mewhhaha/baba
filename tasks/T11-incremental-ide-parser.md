# T11 - Incremental IDE parser

Priority: P1

Depends on: T04, T08, T10

## Goal

Add an IDE parsing mode that reuses lexer checkpoints and green tree nodes after
text edits while preserving error tolerance and CST fidelity.

## Scope

Implement:

- text edit input model;
- lexer checkpoint selection and bounded relexing;
- parser restart point selection;
- affected subtree detection;
- green node reuse;
- stable node IDs or stable anchors for IDE features;
- incremental diagnostics refresh;
- cancellation hooks;
- parse budget options;
- debug tracing for changed ranges and reused nodes.

## Example edit scenario

Start with:

```text
fn main() {
  let total = a + b;
}
```

Apply this edit:

```json
{
  "range": { "start": 28, "end": 29 },
  "text": "*"
}
```

The incremental parser should relex from the nearest safe lexer checkpoint,
reparse the affected expression or containing statement, reuse the surrounding
`fn` and block green nodes, and produce the same normalized CST as a full parse
of:

```text
fn main() {
  let total = a * b;
}
```

Also test an error-edit cycle:

```text
let x = 1 +
```

then insert `2;` and verify the stale `InvalidExpr` diagnostic disappears.

## Example API contract

The final API can differ in names, but the task should settle an equivalent
shape before implementation:

```ts
const parser = createIncrementalParser(plan);
let state = parser.parseInitial(source, { mode: "cst" });

const next = parser.applyEdits(state, [{
  start: 28,
  oldEnd: 29,
  newText: "*",
}], {
  mode: "cst",
  maxRelexBytes: 4096,
  maxReparseNodes: 2048,
});

next.changedRanges;
next.reusedNodeCount;
next.relexedRange;
next.reparsedRange;
next.diagnostics;
next.tree;
```

Expected normalized debug result:

```json
{
  "changedRanges": [{ "start": 28, "end": 29 }],
  "relexedRange": { "start": 14, "end": 34 },
  "reparsedRange": { "start": 14, "end": 34 },
  "reusedNodeCount": 3,
  "cancelled": false
}
```

## Design constraints

- Compiler parsing can remain full-file and simpler.
- IDE parsing must tolerate broken source at every edit step.
- Reuse must be validated against full reparse output in tests.
- Incremental mode should have explicit APIs. Do not hide different semantics
  behind the normal compiler parse call.

## Deliverables

- incremental parser API;
- edit application helper or interface contract;
- reusable lexer checkpoint format from T04;
- green tree reuse implementation;
- differential tests comparing incremental parse to full parse;
- benchmarks for single-character, line, and paste edits.

## Acceptance criteria

- Common edits relex and reparse a bounded region.
- Incremental parse produces the same CST shape as a full parse for tested
  cases, apart from documented stable ID reuse metadata.
- Diagnostics update when errors are fixed or introduced.
- Cancellation returns a structured incomplete result rather than corrupt state.
- Performance wins are measured against full-file parse on medium and large
  fixtures.

## Verification harness

Run:

```sh
deno test --allow-read tests/incremental_parser_v2_test.ts
deno run --allow-read --allow-write scripts/incremental_parser_bench.ts --json tmp/incremental-v2.json
deno task check
```

The benchmark script may be introduced by this task.

## Out of scope

- LSP server implementation.
- Editor extension packaging.
- Formatter or semantic cache invalidation.
