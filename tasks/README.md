# Lexer/parser infrastructure rebuild task plan

This plan is for a greenfield rebuild of Baba's lexer and parser
infrastructure. Existing compatibility is not a constraint. Keep useful code,
tests, and ideas from the current implementation, but the target architecture is
the source of truth.

## Goal

Build a fast syntax-runtime generator with a pleasant grammar language, a
table-driven DFA lexer, deterministic generated parsing by default, expression
syntax that does not require hand-written precedence ladders, lossless CSTs,
typed ASTs, good recovery, and an IDE-capable incremental mode.

Target architecture:

```text
grammar.ebnf
  -> grammar parser
  -> grammar analyzer
  -> lexer generator       parser generator        tree generator
  -> regex/NFA/DFA plan    LR/IELR + Pratt plan    CST/AST schema
  -> shared runtimes       generated adapters      typed outputs
```

The runtime principle stays data-first:

```text
parser = shared runtime + compact grammar plan + optional typed adapters
```

Do not generate large per-grammar parser programs as the default path.

## Performance goals

These are starting gates. Update them with measured numbers as T00 lands.

| Area | Target |
|---|---:|
| Lexer runtime | single pass, no regex backtracking on source text |
| Parser runtime | deterministic hot path with table dispatch |
| Small-file validation parse | under 2 ms after parser construction |
| Small-file CST parse | under 10 ms after parser construction |
| Parser construction from compact plan | under 5 ms for small grammars |
| Generated default payload | compact plan plus small adapter, no embedded Wasm by default |
| Error recovery | produces a CST and diagnostics instead of giving up |
| Incremental edit | relex/reparse bounded affected region for common edits |

## Task index

| ID | Priority | Task | Depends on |
|---|---:|---|---|
| [T00](./T00-architecture-contracts-and-benchmarks.md) | P0 | Architecture contracts and benchmarks | none |
| [T01](./T01-grammar-v2-syntax-and-bootstrap-parser.md) | P0 | Grammar v2 syntax and bootstrap parser | T00 |
| [T02](./T02-grammar-ir-analysis-and-diagnostics.md) | P0 | Grammar IR, analysis, and diagnostics | T01 |
| [T03](./T03-regex-unicode-and-dfa-compiler.md) | P0 | Regex, Unicode, and DFA compiler | T00 |
| [T04](./T04-lexer-runtime-modes-trivia-and-layout.md) | P0 | Lexer runtime modes, trivia, and layout | T03 |
| [T05](./T05-token-contract-contextual-keywords-and-streams.md) | P0 | Token contract, contextual keywords, and streams | T02, T04 |
| [T06](./T06-parser-core-lr-ielr-generator.md) | P0 | Parser core LR/IELR generator | T02, T05 |
| [T07](./T07-expression-pratt-generator.md) | P0 | Expression Pratt generator | T02, T06 |
| [T08](./T08-lossless-cst-green-tree-and-spans.md) | P0 | Lossless CST, green tree, and spans | T04, T06 |
| [T09](./T09-typed-ast-generation-and-reducers.md) | P0 | Typed AST generation and reducers | T01, T08 |
| [T10](./T10-error-recovery-and-diagnostics.md) | P0 | Error recovery and diagnostics | T06, T08 |
| [T11](./T11-incremental-ide-parser.md) | P1 | Incremental IDE parser | T04, T08, T10 |
| [T12](./T12-modular-grammar-and-extension-policy.md) | P1 | Modular grammar and extension policy | T02, T06, T07 |
| [T13](./T13-portable-plan-runtime-and-targets.md) | P0 | Portable plan, runtime, and targets | T04, T06, T08, T09 |
| [T14](./T14-conformance-fuzzing-and-performance-gates.md) | P0 | Conformance, fuzzing, and performance gates | all implementation tasks |
| [T15](./T15-docs-migration-and-cutover.md) | P1 | Docs, migration, and cutover | T13, T14 |

## Dependency waves

```text
Wave 0: T00
  |
  v
Wave 1: T01, T03
  |
  v
Wave 2: T02, T04
  |
  v
Wave 3: T05, T06, T07
  |
  v
Wave 4: T08, T09, T10, T13
  |
  v
Wave 5: T11, T12, T14, T15
```

## Rules for implementation PRs

1. Every task must define and run a harness before it is considered complete.
2. Prefer table/data representation over generated source cleverness.
3. Keep the deterministic hot path branch-free where practical.
4. Keep trivia and invalid syntax in the CST; keep the AST compiler-friendly.
5. Do not make the lexer decide contextual keywords globally.
6. Do not make users encode expression precedence with recursive grammar towers.
7. Keep production runtime artifacts free of debug-only item sets unless a debug
   profile is explicitly requested.
8. Use stable IDs for diagnostics, grammar entities, CST schemas, AST schemas,
   and conflict reports.
9. Make failed analysis actionable: include spans, examples, expected sets, and
   hints when possible.
10. Treat performance regressions as correctness failures for this rebuild.

## Minimum proof for the whole rebuild

The rebuild is done when a grammar can declare tokens, trivia, modes,
contextual keywords, Pratt expressions, CST/AST constructors, synchronization
sets, and optional layout rules; Baba can analyze it, explain conflicts, emit a
compact portable plan, parse valid and broken source into a lossless CST, derive
a typed AST, and run deterministic compiler parsing plus incremental IDE
parsing within the tracked performance budgets.
