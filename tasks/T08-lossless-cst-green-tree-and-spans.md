# T08 - Lossless CST, green tree, and spans

Priority: P0

Depends on: T04, T06

## Goal

Build the concrete syntax tree layer: lossless, source-spanned, capable of
preserving trivia and invalid nodes, and efficient enough for compiler and IDE
use.

## Scope

Implement:

- immutable green nodes;
- lightweight red/tree cursor API if needed for navigation;
- token nodes and trivia attachment;
- invalid and missing nodes;
- stable node kind IDs;
- field names and child indexes;
- byte/UTF-16 span tracking;
- line/column mapping integration;
- lazy CST materialization for parse modes that do not need full trees;
- serialization-friendly CST schema;
- memory accounting for nodes, tokens, and trivia.

## CST requirements

The CST preserves exact syntax:

```text
LetDecl("let", Ident("x"), "=", Binary(...), ";")
```

including comments, whitespace, delimiters, missing tokens, and invalid
subtrees. It is the source of truth for formatting, refactors, IDE features, and
macro-like tooling.

## Example tree shape

For this source:

```text
let x = 1; // keep me
```

the debug tree printer should be able to show a lossless shape like:

```text
Module@0..20
  LetDecl@0..10
    LetToken "let"@0..3
    Trivia " "@3..4
    name: Ident "x"@4..5
    Trivia " "@5..6
    EqToken "="@6..7
    Trivia " "@7..8
    value: Int "1"@8..9
    SemicolonToken ";"@9..10
  Trivia " "// keep me\n"@10..20
  EOF@20..20
```

For broken source:

```text
let x = ;
```

the tree should preserve the hole:

```text
LetDecl@0..9
  value: MissingExpr@8..8
  SemicolonToken ";"@8..9
```

## Design constraints

- Validation-only parsing should not allocate a full CST.
- CST construction should be deterministic and stable under repeated parses.
- Invalid input must still produce a root tree.
- Node APIs should expose spans without recomputing from source text each time.
- The tree representation should be compatible with incremental reuse in T11.

## Deliverables

- CST schema generated from analyzed grammar;
- runtime CST builder;
- public CST navigation API;
- optional debug tree printer;
- lazy materialization path;
- tests for trivia, invalid nodes, missing nodes, and spans;
- memory and speed benchmarks.

## Acceptance criteria

- CST round-trip tests can reconstruct the original source from tokens/trivia.
- Every node and token has a source range or a well-defined missing span.
- Broken source still returns a root CST with diagnostics.
- Validation-only mode allocates substantially less than CST mode.
- CST schema IDs are stable across unrelated grammar changes.

## Verification harness

Run:

```sh
deno test --allow-read tests/cst_v2_test.ts tests/cst_spans_v2_test.ts
deno run --allow-read --allow-write scripts/parser_pipeline_bench.ts --cst --json tmp/cst-v2.json
deno task check
```

## Out of scope

- AST semantic cleanup.
- Incremental edit reuse.
- Formatter policy.
