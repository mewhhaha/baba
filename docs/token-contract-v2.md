# Token contract v2

Baba v2 keeps lexing deterministic while preserving enough information for the
parser to make contextual token choices.

## Standalone lexing

`lexGrammarV2(plan, source)` returns one public token stream. At each source
site the lexer chooses the longest match first. For equal-length matches it uses
the grammar's deterministic token order, but contextual tokens do not win over a
normal token for standalone lexing.

Trivia tokens are emitted when `preserveTrivia` is true. When it is false,
trivia is still consumed and spanned, but omitted from the returned public token
stream. EOF is always emitted.

## Retained candidates

The lexer result also includes `candidateSites`. Each site points at a public
token index and lists all main-channel candidates retained for that source
range. Parser-contextual selection must use these candidates rather than
relexing source text.

For example, with:

```text
contextual Async = "async" ;
token Ident = /[a-z]+/ ;
```

standalone lexing of `async` returns `Ident`, while the candidate site contains
both `Ident` and contextual `Async`.

## Token streams

`validateGrammarV2TokenStream(plan, source, tokens)` compares caller-provided
tokens against the deterministic lexer output for the same source. It reports
stable diagnostics for:

- missing tokens;
- extra tokens;
- wrong token kind/channel;
- wrong source span.

The validator does not reinterpret caller-provided tokens as contextual
candidates. A parser consuming external tokens must use the tokens exactly as
provided, while unchecked entrypoints may skip validation for trusted callers.

## Layout

When layout filtering is enabled, the lexer first consumes the deterministic DFA
token stream, then inserts virtual `NEWLINE`, `INDENT`, and `DEDENT` tokens.
Layout is suppressed inside configured delimiter tokens. Candidate sites are
currently omitted from layout-filtered results because virtual token insertion
changes public token indexes.
