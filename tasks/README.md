# Slim runtime architecture task plan

This task plan is focused on one concrete problem:

> Generated lexers and parsers are too large, and the Wasm path is too expensive to instantiate and too slow for small files.

A reported real grammar produced roughly **500 KB of Wasm bytes**, took about **6 seconds to instantiate**, and then still took about **30 ms to parse a small file**. That is not acceptable for a language-bootstrap tool intended to make small language tooling easy.

The current system has become too specialized too early. Baba should stop generating large per-grammar runtime programs as the default architecture. The lexer/parser runtime should be small, shared, cacheable, and driven by compact grammar data.

## Desired architecture

Move from this:

```text
grammar.ebnf
  -> huge generated TypeScript runtime files
  -> huge grammar-specialized Wasm bytes
  -> generated adapter that embeds or loads the Wasm
```

To this:

```text
grammar.ebnf
  -> compact parser plan data
  -> optional generated TypeScript types
  -> tiny adapter that imports a shared runtime

@mewhhaha/baba/runtime
  -> small generic TypeScript parser executor

@mewhhaha/baba/runtime/wasm
  -> optional generic Wasm executor, compiled once and cached
```

In other words:

```text
parser = shared runtime + compact data
```

not:

```text
parser = freshly generated runtime program per grammar
```

## Product boundary

Baba can still generate:

- Tree-sitter grammar and query fragments;
- a compact portable parser plan;
- optional TypeScript type declarations for CST nodes;
- tiny TypeScript adapters around the shared runtime;
- optional binary plan artifacts;
- optional Wasm-backed execution using a single generic runtime.

Baba should not generate by default:

- grammar-specialized Wasm modules;
- massive TypeScript lexer/parser source files;
- duplicate TypeScript and Wasm parser algorithms;
- debug LR item tables in runtime artifacts;
- branch-search machinery for deterministic grammars;
- full CST construction when the caller only wants validation;
- giant generated examples committed into the repo.

## Hard performance goals

These are intentionally aggressive and should become budgets:

| Scenario | Target |
|---|---:|
| Small grammar generated runtime source | under 50 KB excluding types |
| Small grammar parser plan JSON | under 50 KB before compression |
| Small grammar binary plan | under 20 KB |
| Wasm bytes emitted per grammar | 0 bytes by default |
| Shared Wasm runtime cold instantiate | paid once, cacheable, preferably under 100 ms after compile cache |
| Small-file parser construction | under 5 ms when using shared TypeScript runtime |
| Small-file parse without CST | under 2 ms |
| Small-file parse with CST | under 10 ms |
| CLI `--target all` default generated payload | no embedded Wasm byte arrays |

Do not treat these as exact final numbers. Treat them as forcing functions. If a task cannot meet the number, it should produce a benchmark report explaining where the cost remains.

## Task index

| ID | Priority | Task | Core idea |
|---|---:|---|---|
| [T00](./T00-measure-runtime-size-and-latency.md) | P0 | Measurement and budgets | Reproduce the 500 KB / 6s / 30 ms failure and make it a tracked gate. |
| [T01](./T01-data-first-runtime-architecture.md) | P0 | Data-first runtime | Replace per-grammar generated runtime programs with shared runtime + compact plan data. |
| [T02](./T02-compact-parser-plan-format.md) | P0 | Compact plan format | Remove debug tables from runtime artifacts and encode lexer/LR tables densely. |
| [T03](./T03-wasm-cold-start-and-packaging.md) | P0 | Wasm cold start | Stop emitting grammar-specialized Wasm by default; use one cached generic Wasm runtime if Wasm is requested. |
| [T04](./T04-typescript-output-slimming.md) | P0 | TypeScript output slimming | Generate tiny adapters and optional type files, not massive parser implementations. |
| [T05](./T05-lazy-cst-and-parse-modes.md) | P0 | Lazy CST and parse modes | Do not build a complete CST unless callers ask for it. |
| [T06](./T06-lexer-hot-path.md) | P1 | Lexer hot path | Cut per-character and per-token overhead in the generic runtime. |
| [T07](./T07-conflict-runtime-splitting.md) | P1 | Conflict runtime split | Keep branch search out of deterministic parsers and out of the hot path. |
| [T08](./T08-delete-heavy-generated-artifacts.md) | P1 | Deletion and migration | Remove obsolete heavy outputs, examples, and compatibility paths. |
| [T09](./T09-release-gates-and-docs.md) | P1 | Release gates and docs | Make size/latency budgets part of CI and explain the new architecture. |

## Dependency waves

```text
Wave 0: T00
  |
  v
Wave 1: T01, T02, T03
  |
  v
Wave 2: T04, T05, T06, T07
  |
  v
Wave 3: T08, T09
```

`T00` should land first. It gives every other task a baseline and a benchmark target.

`T01`, `T02`, and `T03` can proceed in parallel only if they agree on the new runtime boundary:

```text
shared runtime + compact plan data
```

not per-grammar runtime code.

## Rules for assigned agents

1. Optimize for removal. If a feature exists only to support grammar-specialized runtime generation, delete it or move it behind an explicit legacy option.
2. Do not make Wasm the default answer for small files. Measure before assuming Wasm helps.
3. Do not add another abstraction layer unless it reduces generated bytes or cold-start cost.
4. Prefer table/data compression over generated source cleverness.
5. Keep debug data out of production runtime artifacts.
6. Add benchmark output for every runtime change.
7. Every task PR should include before/after numbers for at least one fixture.
8. Existing public APIs can remain as adapters, but their implementation should move to shared runtime calls.
9. Do not silently preserve heavy legacy behavior. If old behavior remains, mark it as legacy and add a deprecation path.
10. Run the normal repo checks plus the new benchmark/budget checks added by T00.

## Suggested agent allocation

First:

```text
Agent A: T00
```

Then:

```text
Agent A: T01
Agent B: T02
Agent C: T03
```

Then:

```text
Agent A: T04
Agent B: T05
Agent C: T06
Agent D: T07
```

Finally:

```text
Agent A: T08
Agent B: T09
```

## Success criteria

The redesign is successful when a realistic grammar no longer produces a giant per-grammar Wasm module, a small file no longer spends tens of milliseconds in parser setup/CST construction, and users can choose between:

```text
fast shared TypeScript runtime
fast validation-only parse
full CST parse when needed
optional cached generic Wasm runtime
```

without checking in hundreds of kilobytes of generated parser code per grammar.
