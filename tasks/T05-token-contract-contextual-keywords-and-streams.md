# T05 - Token contract, contextual keywords, and streams

Priority: P0

Depends on: T02, T04

## Goal

Define and implement the token contract used by lexing, parsing, public APIs,
and external token-stream parsing, including contextual keywords.

## Scope

Support:

- standalone `lex(source)` with one global longest-match winner per token site;
- retained accept candidates for `parse(source)`;
- contextual keyword declarations;
- parser-contextual token selection;
- token-stream validation for `parseTokens(source, tokens)`;
- unchecked token-stream parsing for trusted callers;
- stable public token shapes;
- token IDs separate from display names;
- trivia token shapes;
- lexical diagnostic shapes;
- source offset and line/column mapping.

## Contextual keyword model

The lexer must not globally classify all keyword-like text as reserved.

Example:

```text
async fn foo()
let async = 1
```

Grammar:

```ebnf
contextual Async = "async" ;

fn_decl =
  Async? "fn" Ident "(" ")" block
;
```

The lexer may globally return `Ident("async")`, while the parser can match the
retained `Async` candidate in the `fn_decl` context.

## API decisions

Document these explicitly:

- `parse(source)` may use retained candidates.
- `parseTokens(source, lex(source).tokens)` may differ from `parse(source)` for
  contextual grammars if the global winners discarded needed candidates.
- `parseTokens()` must not reinterpret caller-provided tokens.
- `parseTokensUnchecked()` is allowed to trust the provided stream but must still
  produce bounded behavior.

## Deliverables

- token contract document;
- public token and trivia types;
- parser-facing candidate token representation;
- contextual keyword analysis and runtime matching;
- token-stream validation logic;
- tests covering global lexing versus contextual parsing;
- diagnostics for impossible or ambiguous contextual token declarations.

## Acceptance criteria

- Contextual keyword examples parse correctly.
- Standalone lexing remains deterministic.
- Token stream validation reports missing, extra, wrong-kind, and wrong-span
  tokens.
- Public diagnostics explain when `parse()` and `parseTokens()` can differ.
- Retained candidates do not materially slow grammars without contextual token
  overlap.

## Verification harness

Run:

```sh
deno test --allow-read tests/contextual_tokens_v2_test.ts tests/token_stream_v2_test.ts
deno run --allow-read --allow-write scripts/parser_pipeline_bench.ts --json tmp/contextual-v2.json
deno task check
```

## Out of scope

- LR table generation internals.
- Error recovery insertion/deletion.
- IDE incremental reuse.
