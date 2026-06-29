# T00 - Architecture contracts and benchmarks

Priority: P0

Depends on: none

## Goal

Define the v2 lexer/parser contracts and install measurement harnesses before
implementation work begins. This prevents the rebuild from drifting into another
large generated-runtime design and gives every later task a concrete pass/fail
target.

## Scope

- Write an accepted ADR for the lexer/parser v2 architecture.
- Define the public boundaries between grammar parsing, grammar analysis, lexer
  planning, parser planning, tree planning, runtime execution, and generated
  adapters.
- Define parse modes:
  - validation-only;
  - token stream;
  - lossless CST;
  - AST materialization;
  - IDE incremental.
- Define artifact profiles:
  - production compact plan;
  - debug plan with explanation tables;
  - generated type adapter;
  - optional Wasm executor adapter.
- Add initial benchmark fixtures that represent:
  - tiny DSL;
  - normal programming language subset;
  - expression-heavy file;
  - error-heavy edited file;
  - large generated file.
- Add benchmark commands that report lexer time, parser construction time,
  validation parse time, CST parse time, AST materialization time, emitted bytes,
  and peak node/token counts.

## Design decisions to record

- Grammar v2 is allowed to break the current grammar contract.
- The lexer compiles regex rules into a combined DFA. Source lexing must not use
  JavaScript regex matching as the hot path.
- The parser uses deterministic LR(1) or IELR for structure by default.
- Expressions are generated as Pratt or precedence-climbing islands.
- Ambiguity support is opt-in and bounded.
- The CST is lossless and survives invalid input.
- The AST is generated from explicit grammar annotations and may drop trivia.
- Incremental parsing is an IDE mode, not the only compiler parsing strategy.
- Production artifacts should not include full LR item sets unless explicitly
  requested.

## Example contract artifact

The ADR should include a compact ownership table like this:

| Stage | Input | Output | Must not own |
|---|---|---|---|
| grammar parser | `grammar.ebnf` text | grammar v2 AST plus syntax diagnostics | token reachability or parser tables |
| grammar analyzer | grammar v2 AST | `AnalyzedGrammarV2` plus author diagnostics | runtime-specific table encoding |
| lexer planner | analyzed tokens and modes | DFA plan plus token-overlap facts | parser recovery |
| parser planner | analyzed rules and expression islands | LR/IELR tables plus Pratt plans | CST storage policy |
| tree planner | analyzed fields and constructors | CST and AST schemas | lexer matching |
| runtime | portable plan plus source text | tokens, CST, AST, diagnostics | grammar analysis |

The benchmark JSON should be stable enough to diff:

```json
{
  "fixture": "expression-heavy",
  "grammarBytes": 4218,
  "sourceBytes": 32768,
  "planBytes": 18420,
  "parserCreateMs": 3.4,
  "lexMs": 1.2,
  "parseValidateMs": 1.8,
  "parseCstMs": 6.9,
  "astMs": 1.1,
  "tokens": 9280,
  "cstNodes": 4110
}
```

## Deliverables

- `docs/adr/00xx-lexer-parser-v2.md`
- `docs/performance.md` updates or a new parser benchmark document
- benchmark fixtures under `fixtures/perf/parser-v2/`
- a benchmark script, for example `scripts/parser_pipeline_bench.ts`
- size and latency budget entries in `size-budgets.json` or a dedicated parser
  budget file

## Example benchmark contract

The benchmark script should emit machine-readable data with stable metric names
that later tasks can reuse:

```json
{
  "fixture": "tiny-dsl",
  "grammar": "parser-v2-smoke",
  "metrics": {
    "lexerMs": 0.31,
    "parserConstructMs": 1.42,
    "validationParseMs": 0.88,
    "cstParseMs": 2.94,
    "astMaterializeMs": 0.47,
    "generatedBytes": 18432,
    "tokens": 96,
    "cstNodes": 141
  }
}
```

The ADR should include a boundary table like:

| Contract | Owner | Consumed by |
|---|---|---|
| `AnalyzedGrammar` | grammar analyzer | lexer, parser, CST, AST planners |
| `LexerPlan` | lexer generator | runtime lexer, incremental lexer |
| `ParserPlan` | parser generator | validation parser, CST builder |
| `TreeSchema` | tree generator | CST/AST runtimes, adapters |

## Acceptance criteria

- A contributor can tell which subsystem owns each data contract.
- The benchmark script can compare before/after JSON files.
- The benchmark output contains enough data to identify whether time is spent in
  lexing, parser construction, table execution, CST building, or AST building.
- CI can run a non-flaky subset of the benchmark gates.
- Later tasks can reference explicit budget names rather than invent their own.

## Verification harness

Run:

```sh
deno task check
deno task test
deno run --allow-read --allow-write scripts/parser_pipeline_bench.ts --json tmp/parser-v2-baseline.json
```

The benchmark command may be added by this task. Until performance budgets are
stable, fail only on missing output shape and invalid numbers.

## Out of scope

- Implementing the new lexer or parser.
- Removing old public APIs.
- Finalizing exact long-term performance numbers.
