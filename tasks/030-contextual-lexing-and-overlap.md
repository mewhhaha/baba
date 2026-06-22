# Task 030: Contextual Lexing And Overlap Consequences

## Goal

Resolve FEEDBACK P0.3 and P0.4. Either implement parser-contextual lexing for
portable parsers or enforce strict portable overlap rejection. Also classify
skip/token/literal overlaps by consequence with witness diagnostics.

## Files To Inspect

- `src/compiler/analyze.ts`
- `src/compiler/diagnostics.ts`
- `src/compiler/regex/overlap.ts`
- `src/compiler/regex/intersect.ts`
- `src/targets/runtime/plan.ts`
- `src/targets/runtime/typescript_lexer_runtime.ts`
- `src/targets/runtime/typescript_parser_runtime.ts`
- `tests/lexer_test.ts`
- `tests/parser_test.ts`

## Search Commands

```sh
rg -n "overlap|priority|reachableTokens|skip|literal|witness|contextual|expectedTerminals|lexerSpec" src tests
```

## Work Option A: Contextual Lexing

1. Store all accepting candidates per DFA state.
2. During `parse(source)`, filter candidates by expected terminals for the
   current parser state plus trivia.
3. Keep standalone `lex(source)` global and deterministic.
4. Document the distinction.

## Work Option B: Strict Portable Rejection

1. Reject every reachable named-token overlap for portable targets, even when
   priority differs.
2. Keep Tree-sitter-only behavior separate if Tree-sitter can support it.
3. Add diagnostics for skip-wins-over-token, token-wins-over-skip,
   token-wins-over-token, skip-wins-over-skip, literal-loses-to-token, and
   literal-wins-over-token.
4. Include both declaration spans and a real witness.

## Required Tests

Add tests for:

```ebnf
token A priority 10 = /x/ ;
token B priority 0 = /x/ ;
module = "a" A | "b" B ;
```

and:

```ebnf
skip IGNORED priority 10 = /x/ ;
token X priority 0 = /x/ ;
module = X ;
```

## Acceptance

- Portable parser behavior is correct for the examples above.
- Diagnostics include a concrete witness string.
- Tree-sitter behavior is not accidentally restricted unless selected with a
  portable target.
- Focused checks:

```sh
deno test -A tests/lexer_test.ts tests/parser_test.ts tests/tree_sitter_test.ts
```

## Do Not Touch

- Do not change parser-kit schema unless contextual accept candidates must be
  serialized. If that is required, document it and update validation tests.
