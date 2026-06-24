# T10: Differential, fuzz, performance, and release gates

- **Priority:** P1
- **Estimated size:** Extra large
- **Merge wave:** 5
- **Depends on:** All runtime tasks, especially [T04](./T04-runtime-language-typescript-backend.md), [T05](./T05-runtime-language-wasm-backend.md), [T06](./T06-contextual-lexing-and-token-selection.md), [T07](./T07-stable-conflicts-and-bounded-ambiguity.md), and [T08](./T08-wasm-abi-memory-lifecycle-and-reentrancy.md)
- **Suggested PR title:** `Make runtime parity and resource behavior release gates`

[Back to task index](./README.md)

## Objective

Make exact TypeScript/Wasm runtime parity, Tree-sitter portable-subset acceptance parity, compiler/runtime resource behavior, bootstrap determinism, and generated-artifact validity mandatory release gates.

This task should expose mismatches. It must not weaken assertions or alter parser semantics merely to make tests pass.

## Problem

Curated unit tests demonstrate individual features but do not prove the system-wide claims Baba now makes:

- one grammar describes all targets;
- TypeScript and Wasm execute equivalent runtime semantics;
- Tree-sitter agrees on accepted input for the portable subset;
- runtime-language backends agree;
- Wasm memory remains bounded and reusable;
- generated artifacts are deterministic;
- pathological grammars fail predictably;
- examples and bootstrap artifacts do not drift.

## Required work

### 1. Expand the fixture corpus

Create or expand:

```text
fixtures/
  expressions/
  declarations/
  json-like/
  markup-like/
  overlapping-tokens/
  contextual-lexing/
  nullable-rules/
  empty-productions/
  ambiguous-types/
  conflict-resolution/
  unicode/
  comments-and-trivia/
  large-generated/
  invalid-regex/
  resource-limits/
```

Each fixture should contain:

```text
grammar.ebnf
baba.json              # optional
valid/*
invalid/*
expectations.json       # optional diagnostic/shape assertions
```

### 2. Enforce exact TypeScript/Wasm parity

For every portable fixture, compare normalized:

- lex success/failure;
- token type/kind/literal;
- token text;
- channel;
- UTF-16 spans;
- lexical diagnostics;
- parse success/failure;
- root rule;
- CST child order;
- fields and cardinality;
- parse diagnostics;
- expected/found values;
- resource-limit codes;
- conflict branch ordering and ambiguity result.

Do not compare implementation-specific pointers, memory addresses, or internal state IDs.

### 3. Enforce Tree-sitter acceptance parity

For the portable fixture subset:

1. generate Tree-sitter;
2. run `tree-sitter generate`;
3. build the parser;
4. parse every valid and invalid corpus file;
5. define acceptance consistently—no `ERROR` or missing nodes for valid samples;
6. compare acceptance with portable runtime results.

Do not require identical CST shape. Tree-sitter aliases, hidden rules, extras, and recovery are intentionally different.

When invalid-source behavior differs because Tree-sitter recovers, define a strict corpus convention such as checking for any error/missing node rather than command exit status alone.

### 4. Add BRL conformance parity

Every BRL semantics fixture from T03 must compile to TypeScript and Wasm and compare:

- return values;
- structured errors;
- traps;
- memory-visible records/arrays;
- integer edge cases;
- bounds behavior;
- evaluation order.

### 5. Add property tests

Required properties:

#### Lexer

- always advances or emits EOF;
- non-EOF tokens have positive width;
- spans are monotonic and nonoverlapping;
- canonical lexing covers source according to trivia/error policy;
- global candidate ordering is deterministic;
- contextual candidate selection returns an expected terminal;
- TypeScript/Wasm candidates match.

#### Parser

- successful plan contains no undeclared unresolved action set;
- parser stacks never underflow;
- CST child spans are contained by parent spans;
- field values refer to elements contained in their rule;
- required fields exist exactly once;
- arrays preserve source order;
- repeated parsing is deterministic;
- checked token parsing agrees with canonical parse under its documented contract.

#### Plan

- serialization is deterministic;
- deserialize/serialize round trip is stable;
- corrupt plans are rejected;
- IDs and canonical ordering remain stable.

#### Output

- generation is byte-for-byte deterministic;
- applying a bundle twice is idempotent;
- modified generated files are protected;
- binary and text ownership behave identically.

### 6. Add deterministic fuzz seeds

Fuzz or property-generate:

- EBNF source;
- regex source;
- regex AST;
- NFA/DFA construction;
- DFA intersection and witness production;
- grammar graphs and reachability/productivity;
- LR table construction;
- conflict selectors;
- portable plan validation/deserialization;
- BRL source and IR verifier;
- arbitrary parser input;
- strict token streams;
- Wasm ABI sizes/offsets.

PR CI should run a short deterministic seed corpus. Longer fuzzing should run on schedule or manual dispatch.

Persist every discovered regression as a minimal fixture.

### 7. Turn benchmarks into machine-readable metrics

Track at least:

#### Compiler

- parse/analyze time;
- regex/NFA/DFA planning time;
- overlap-analysis time;
- BNF/LR planning time;
- BRL compilation time;
- total generation time;
- peak process memory where practical.

#### Artifacts

- plan JSON/binary bytes;
- TypeScript runtime bytes;
- Wasm bytes;
- adapter bytes;
- Tree-sitter artifact bytes;
- package publish bytes.

#### Runtime

- lex throughput;
- deterministic parse throughput;
- contextual lex parse throughput;
- conflict parse throughput;
- parse-token throughput;
- parser creation/instantiation time;
- peak Wasm pages;
- repeated-parse memory growth.

Output both readable text and JSON:

```sh
deno task bench --json bench-results.json
```

### 8. Add regression budgets

Establish initial budgets rather than perfect numbers:

- maximum generated source growth per representative fixture;
- maximum `.wasm` growth;
- maximum compile time for fixture suite;
- zero unbounded memory growth over repeated parses;
- configurable tolerated benchmark variance.

Performance budgets should avoid flaky wall-clock assertions in normal PR CI. Prefer operation counts, artifact sizes, memory pages, and broad smoke thresholds.

### 9. Add CI jobs

Required CI coverage:

- formatting;
- lint;
- type check;
- unit/integration tests;
- Deno generated TypeScript smoke;
- Node generated TypeScript smoke;
- Bun generated TypeScript smoke;
- Deno/Node/Bun Wasm adapter smoke;
- `wasm-tools validate`;
- Wasmtime low-level ABI smoke;
- Tree-sitter generation/build/query tests;
- TypeScript/Wasm exact parity;
- Tree-sitter acceptance parity;
- BRL conformance parity;
- bootstrap artifact drift;
- generated example drift or regeneration test;
- publish dry run;
- package/artifact-size report;
- short deterministic fuzz seeds.

Use scheduled workflows for long fuzz and performance history.

### 10. Add bootstrap determinism checks

If BRL source compiles into checked-in runtime artifacts:

```sh
deno task bootstrap
deno task bootstrap:check
```

`bootstrap:check` must regenerate into a temporary directory and compare byte-for-byte.

Record:

- BRL semantics version;
- compiler artifact version;
- source hash;
- generated artifact hashes.

### 11. Improve failure diagnostics

Parity failures should print:

- fixture and source path;
- target;
- first differing normalized JSON path;
- actual/expected value;
- grammar/metadata options;
- reproducible command.

Fuzz failures should print the seed and save/minimize the failing input.

## Likely files

- `fixtures/**/*`
- `tests/ts_wasm_parity_test.ts`
- `tests/tree_sitter_test.ts`
- `tests/fuzz_test.ts`
- new `tests/runtime_language_conformance_test.ts`
- new `tests/portable_fixture_test.ts`
- `bench/ts_vs_wasm.ts`
- additional benchmark files
- `.github/workflows/ci.yml`
- new scheduled workflow
- `deno.json`

## Acceptance criteria

- Exact TypeScript/Wasm normalized parity is a required CI gate.
- Tree-sitter acceptance parity is a required CI gate for portable fixtures.
- BRL TypeScript/Wasm semantics parity is required.
- Wasm memory reuse has a repeated-parse regression test.
- Parser-plan and generated artifacts are deterministic.
- Machine-readable benchmark output exists.
- Short deterministic fuzz seeds run in PR CI.
- Every discovered historical bug has a minimal permanent fixture.
- CI validates real generated outputs rather than only source substrings.

## Out of scope

- fixing semantic mismatches inside this PR without assigning them to the owning task;
- nondeterministic internet-dependent benchmark services;
- requiring long fuzz campaigns on every PR;
- comparing Tree-sitter CST shape with portable CST shape;
- performance micro-optimization unrelated to a measured regression.

## Copy-ready agent prompt

> Implement T10 from `tasks/T10-differential-fuzz-performance-release-gates.md`. Build comprehensive portable fixtures, exact TypeScript/Wasm and BRL backend parity, Tree-sitter acceptance parity, property tests, deterministic fuzz seeds, Wasm validation, bootstrap drift checks, and machine-readable benchmarks. Do not weaken semantics or normalize away real differences.

## PR checklist

- [ ] Portable fixture matrix expanded.
- [ ] Exact TypeScript/Wasm parity enforced.
- [ ] Tree-sitter acceptance parity enforced.
- [ ] BRL backend conformance enforced.
- [ ] Property and deterministic fuzz tests added.
- [ ] Machine-readable benchmarks added.
- [ ] Wasm memory and independent-engine gates added.
- [ ] Bootstrap/generated drift checks added.
- [ ] Full repository checks pass.
