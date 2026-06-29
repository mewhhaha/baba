# T10 - Error recovery and diagnostics

Priority: P0

Depends on: T06, T08

## Goal

Make generated parsers useful on broken source. The parser should recover,
preserve invalid syntax in the CST, and report actionable diagnostics with
expected-token sets and spans.

## Scope

Implement:

- expected-token set calculation;
- synchronization sets from grammar annotations;
- default synchronization at EOF and closing delimiters;
- single-token insertion recovery;
- single-token deletion recovery;
- invalid node construction;
- missing token construction;
- bounded recovery search;
- recovery ranking;
- diagnostic deduplication;
- fix-it hints where unambiguous;
- recovery support inside Pratt expression islands;
- recovery metrics for tests and benchmarks.

Example grammar annotation:

```ebnf
stmt sync = ";" | "}" | EOF ;
```

Broken input:

```text
let x = 1 +
let y = 2;
```

Expected outcome:

```text
Let(x, InvalidExpr)
Let(y, Int(2))
```

not a total parse failure.

## Diagnostic requirements

Runtime diagnostics should include:

- stable code;
- severity;
- source span;
- expected token set;
- actual token;
- recovery action if one was taken;
- related span where helpful;
- human message generated from structured data.

## Deliverables

- recovery plan data in parser tables;
- runtime recovery executor;
- invalid/missing CST node integration;
- diagnostic payload schema;
- tests for insertion, deletion, sync recovery, expression recovery, and EOF
  recovery;
- performance budget for error-heavy source.

## Acceptance criteria

- Common missing delimiter cases recover with a missing token node.
- Extra comma or semicolon cases recover with a deletion diagnostic.
- Statement-level sync prevents one bad statement from poisoning the file.
- Recovery cannot loop indefinitely.
- Recovery behavior is deterministic.
- Error-heavy parse stays within the T00 budget.

## Verification harness

Run:

```sh
deno test --allow-read tests/recovery_v2_test.ts tests/recovery_diagnostics_v2_test.ts
deno run --allow-read --allow-write scripts/parser_pipeline_bench.ts --fixture error-heavy --json tmp/recovery-v2.json
deno task check
```

## Out of scope

- IDE incremental reuse.
- Semantic diagnostics.
- Automatic grammar repair.
