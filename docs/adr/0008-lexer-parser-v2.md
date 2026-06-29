# ADR 0008: Lexer/parser v2 architecture

Status: accepted.

## Context

Baba's lexer/parser rebuild must keep generated output compact while making the
runtime behavior inspectable. Later tasks need stable ownership boundaries
before they change grammar syntax, token matching, parser planning, CST
construction, AST materialization, recovery, and IDE parsing.

The v2 architecture can break the current grammar contract. Compatibility work
belongs to migration and cutover tasks, not to the core architecture.

## Decision

The syntax pipeline is data-first:

```text
grammar source -> analyzed grammar -> compact lexer/parser/tree plan -> shared runtime
```

Each stage owns one durable data contract and must not depend on downstream
runtime storage details.

| Stage            | Input                                 | Output                                   | Must not own                        |
| ---------------- | ------------------------------------- | ---------------------------------------- | ----------------------------------- |
| grammar parser   | grammar source text                   | grammar v2 AST plus syntax diagnostics   | token reachability or parser tables |
| grammar analyzer | grammar v2 AST                        | analyzed grammar plus author diagnostics | runtime-specific table encoding     |
| lexer planner    | analyzed tokens, trivia, and modes    | DFA plan plus token-overlap facts        | parser recovery                     |
| parser planner   | analyzed rules and expression islands | LR/IELR tables plus Pratt plans          | CST storage policy                  |
| tree planner     | analyzed fields and constructors      | CST and AST schemas                      | lexer matching                      |
| runtime          | portable plan plus source text        | tokens, CST, AST, diagnostics            | grammar analysis                    |

The stable cross-stage contracts are:

| Contract             | Owner            | Consumed by                                 |
| -------------------- | ---------------- | ------------------------------------------- |
| `AnalyzedGrammarV2`  | grammar analyzer | lexer, parser, CST, and AST planners        |
| `LexerPlan`          | lexer planner    | runtime lexer and incremental lexer         |
| `ParserPlan`         | parser planner   | validation parser and CST builder           |
| `TreeSchema`         | tree planner     | CST/AST runtimes and generated adapters     |
| `PortableSyntaxPlan` | runtime planner  | TypeScript runtime, Wasm runtime, and tools |

Lexer source matching uses a combined DFA in the hot path. JavaScript regular
expression matching may be used to compile token patterns, but not as the
per-token source matching strategy.

Parser structure uses deterministic LR(1) or IELR tables by default. Expression
syntax is represented as Pratt or precedence-climbing islands so users do not
have to encode precedence through recursive grammar towers. Ambiguity is opt-in
and bounded; exceeding branch budgets is a diagnostic.

CST construction is lossless and must be able to represent invalid input. AST
materialization is generated from explicit grammar annotations and may drop
trivia. Incremental parsing is an IDE profile layered on reusable lexer/parser
checkpoints, not the only compiler parsing strategy.

Supported parse modes are:

| Mode                | Required output                                               |
| ------------------- | ------------------------------------------------------------- |
| validation-only     | success/failure diagnostics and expected-token data           |
| token stream        | public tokens, channels, candidates, and spans                |
| lossless CST        | CST nodes, token children, trivia, invalid spans, diagnostics |
| AST materialization | typed AST constructors plus source spans                      |
| IDE incremental     | reusable checkpoints and bounded affected-region results      |

Supported artifact profiles are:

| Profile                        | Contents                                      |
| ------------------------------ | --------------------------------------------- |
| production compact plan        | compact portable plan without debug item sets |
| debug plan                     | production plan plus explanation tables       |
| generated type adapter         | typed wrappers for CST/AST access             |
| optional Wasm executor adapter | Wasm runtime adapter and ABI metadata         |

Benchmark and CI gates use stable metric names: `lexerMs`, `parserConstructMs`,
`validationParseMs`, `cstParseMs`, `astMaterializeMs`, `generatedBytes`,
`tokens`, and `cstNodes`.

## Consequences

Later tasks can change one stage without moving ownership into generated
adapters. Production artifacts stay compact by default, while debug profiles can
carry explanation tables when requested.

The benchmark contract makes performance regressions attributable to lexing,
parser construction, validation parsing, CST building, AST materialization, or
payload growth.

## Rejected Alternatives

Generating a large parser program per grammar is rejected as the default path
because it hides runtime behavior in emitted source and grows package payloads.

Using JavaScript regular expressions directly for source tokenization is
rejected for the hot path because it prevents predictable DFA performance and
candidate reporting.

Making incremental parsing the only parser strategy is rejected because compiler
batch parsing should stay simple and deterministic.

## Compatibility Impact

Grammar v2 rejects or reinterprets some legacy EBNF grammar source by design.
The documented parser path is the v2 grammar-analysis and portable-plan runtime
surface. Legacy EBNF generated targets remain isolated as compatibility and
bootstrap infrastructure until a file-emitting v2 target replaces them.
