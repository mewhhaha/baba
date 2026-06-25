# Portable Runtime

Status: current portable-runtime architecture.

The portable runtime is the shared execution contract for generated TypeScript,
Wasm, and parser-kit outputs. Analysis lowers an `AnalyzedGrammar` into a
versioned `PortableParserPlanV1`; target packages consume that plan instead of
reconstructing grammar, lexer, parser, reducer, or CST semantics independently.

## Parser Plan

The plan format is identified by:

```text
format: baba-parser-plan
version: 1
semantics: baba-portable-v1
```

It contains symbol tables, canonical lexer data, LR action/goto tables,
reducers, CST schema data, diagnostics, conflict metadata, and statistics.
Generated runtimes export the plan format, version, semantics tag, and hash so
callers can identify the exact runtime contract.

## Lexing

The lexer uses deterministic DFA tables and all accepting candidates needed by
contextual token selection. Public `lex(source)` returns one global
longest-match winner at each position. `parse(source)` may use parser context to
select among retained candidates when overlapping tokens are valid in different
LR states.

## Parsing

The parser uses LR tables and bounded conflict-branch exploration. Branch,
queue, and trace limits are configurable through generated parse options.
Successful traces are replayed into runtime-owned CST fragments before public
JavaScript objects are materialized by each target adapter.

## Token Streams

`parseTokens(source, tokens)` validates external token streams against canonical
lexing. Omitted trivia is permitted, but nontrivia gaps, duplicate EOF, tokens
after EOF, overlapping spans, invalid public token spelling, and canonical
mismatches produce structured diagnostics.

## Runtime Language

Core lexer/parser semantics are implemented in Baba's private runtime language
and compiled into target helpers. The BRL source is not a public compatibility
surface; generated parser APIs, parser-plan versions, runtime diagnostics, and
the Wasm ABI are the public contracts.
