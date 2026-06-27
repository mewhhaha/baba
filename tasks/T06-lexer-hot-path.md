# T06: Lexer hot path

- **Priority:** P1
- **Size:** Medium/Large
- **Depends on:** [T01](./T01-data-first-runtime-architecture.md), [T02](./T02-compact-parser-plan-format.md)
- **Suggested PR title:** `Optimize the shared lexer hot path`

[Back to index](./README.md)

## Objective

Make the shared runtime lexer fast enough that small-file parsing is not dominated by tokenization overhead.

## Problem

A table-driven DFA is correct, but a naive runtime can still be slow because of:

- linear scan through transition ranges for every code point;
- repeated code-point decoding overhead;
- per-token object allocation;
- `source.slice()` for every token;
- trivia token construction when not needed;
- generic candidate-selection logic in deterministic states;
- no ASCII fast path;
- no row-shape specialization;
- no reusable scratch buffers.

The lexer is always on the parse path. It needs a simple fast path.

## Required work

### 1. Add lexer microbenchmarks

Extend the T00 benchmark with lexer-only cases:

```text
ASCII identifiers
ASCII operators/literals
long single token
many tiny tokens
mostly trivia
Unicode literals
mixed ASCII/Unicode
contextual overlaps
```

Report:

```text
MB/s
ns/code unit
ns/token
allocations/token if measurable
```

### 2. Add row kinds

Encode DFA rows by shape:

```text
empty row
single transition
small linear row
binary-search row
ASCII table row
```

The runtime can dispatch efficiently:

```ts
switch (row.kind) {
  case "single": ...
  case "small": ...
  case "ascii": ...
}
```

Do not force every state through the slowest generic loop.

### 3. Add an ASCII fast path

Most programming-language source is mostly ASCII. For states with meaningful ASCII coverage, generate or encode a 128-entry transition table.

Pseudo-logic:

```ts
const code = source.charCodeAt(offset);
if (code < 128 && row.ascii) {
  next = row.ascii[code];
} else {
  next = findUnicodeRange(row, codePoint);
}
```

Only decode full code points when needed.

### 4. Avoid token text allocation

Token text should be a lazy view unless explicitly requested.

Bad hot path:

```ts
tokens.push({ text: source.slice(start, end), ... });
```

Better hot path:

```ts
tokens.push({ source, start, end, tokenId });
```

or store compact arrays internally and expose object views lazily.

### 5. Avoid trivia allocation by default in parse modes

When parsing with `preserveTrivia: false`, the lexer should not create trivia token objects. It should only advance.

For validation-only parse, it should not create main token objects either if the parser can consume terminal IDs and spans.

### 6. Separate scanner result from public token result

Internal scanner result:

```ts
interface ScannedToken {
  specId: number;
  terminalId: number;
  channel: number;
  start: number;
  end: number;
}
```

Public token object should be produced only when `lex()` or full CST needs it.

### 7. Specialize deterministic accept states

Most DFA states likely have zero or one accept candidate. Avoid allocating candidate arrays or running generic candidate selection in those states.

Plan encoding:

```text
acceptKind: none | single | multiple
singleAccept: specId
multipleAcceptStart/count
```

### 8. Reuse scratch buffers

Parser instances should own reusable scratch buffers for:

- scanned token stream;
- terminal stream;
- spans;
- contextual candidate work;
- diagnostics.

Reset lengths between parses instead of reallocating arrays.

### 9. Add no-regression counters

Expose debug counters in benchmarks:

```text
code units scanned
unicode slow-path count
tokens emitted
trivia skipped
candidate checks
row-kind counts
public token objects created
```

### 10. Keep correctness first

Every optimization must preserve:

- longest match;
- priority;
- literal tie policy;
- contextual token selection;
- UTF-16 span units;
- non-BMP handling;
- error token behavior;
- TypeScript/Wasm parity.

## Examples

### Fast validation path

```text
source -> scan terminal IDs and spans -> parser -> ok/fail
```

No public token objects.

### Full lex path

```text
source -> scan compact records -> wrap public token views -> return LexResult
```

### Full CST path

```text
source -> scan compact records -> parser -> lazy CST -> token views only when accessed
```

## Likely files

- shared runtime lexer implementation
- compact plan row encoding from T02
- TypeScript shared runtime files
- Wasm generic runtime files
- `bench/ts_vs_wasm.ts`
- `scripts/runtime_bench.ts`
- `tests/lexer_test.ts`
- `tests/ts_wasm_parity_test.ts`

## Tests

1. ASCII fast path same result as generic path;
2. Unicode fallback same result;
3. non-BMP spans correct;
4. long single token benchmark;
5. many tiny tokens benchmark;
6. mostly trivia benchmark;
7. contextual overlap benchmark;
8. preserveTrivia false creates no trivia tokens;
9. validation mode creates no public tokens;
10. TypeScript/Wasm parity;
11. row-kind encoding round-trip;
12. candidate-selection correctness.

## Acceptance criteria

- Lexer-only benchmark improves on T00 baseline.
- Validation parse avoids public token allocation.
- ASCII-heavy inputs use fast path.
- Long-token and tiny-token cases are not pathological.
- All optimizations preserve exact parity and spans.

## Out of scope

- changing regex semantics;
- adding lexical modes;
- external scanners;
- incremental lexing;
- CST laziness beyond token allocation cooperation.

## Copy-ready agent prompt

> Implement T06 from `tasks/T06-lexer-hot-path.md`. Optimize the shared lexer runtime with row-kind encodings, ASCII fast paths, lazy token text, scratch-buffer reuse, and allocation-free validation scanning. Add benchmarks and counters proving faster small-file tokenization while preserving exact TypeScript/Wasm parity and Unicode spans.
