# ADR 0005: Contextual Lexing

Status: accepted.

## Context

Portable lexing needs deterministic standalone tokenization, but some grammars
have overlapping main-channel tokens that are only distinguishable in parser
context. Tree-sitter can handle some contextual token choices that a simple
global lexer cannot.

## Decision

The lexer DFA preserves accepting candidates. `lex(source)` reports the global
longest-match winner, while `parse(source)` may choose among retained candidates
using the current LR parser context. Token-stream APIs parse exactly the
caller's provided token sequence and cannot recover discarded candidates.

## Consequences

Generated parsers can support contextual token overlaps without changing the
public token stream contract. Contextual lexing statistics are available through
debug parse options without changing normal parse result shapes.

## Rejected Alternatives

- Making `lex(source)` return all candidates at every position by default.
- Letting `parseTokens()` reinterpret caller-provided tokens.
- Silently relying on target-specific lexer behavior.

## Compatibility Impact

For contextual grammars, `parse(source)` is not guaranteed to equal
`parseTokens(source, lex(source).tokens)`. This is documented behavior, not a
runtime mismatch.
