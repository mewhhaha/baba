# T06: Contextual lexing and token selection

- **Priority:** P0
- **Estimated size:** Large
- **Merge wave:** 2
- **Depends on:** [T01](./T01-versioned-portable-parser-plan.md)
- **Suggested PR title:** `Add parser-contextual token selection to the portable runtime`

[Back to task index](./README.md)

## Objective

Allow the portable parser to select among overlapping token candidates using the current LR parser context, while keeping standalone `lex(source)` deterministic and documented.

## Problem

A global maximal-munch lexer cannot represent every grammar whose token ambiguity can be resolved by parser context.

Example:

```ebnf
token A priority 10 = /x/ ;
token B priority 0 = /x/ ;

module =
    "a" A
  | "b" B
;
```

A global lexer always emits `A` for `x`, so `b x` fails even though the parser state expects `B`.

Explicit priority only defines a global winner. It does not make a globally shadowed token reachable where grammar context distinguishes it.

## Required work

### 1. Preserve all DFA accept candidates

Each accepting DFA state must retain all matching token/literal candidates in deterministic order, not only one selected candidate.

Suggested plan shape:

```ts
interface PortableLexerState {
  readonly transitions: readonly PortableTransition[];
  readonly accepts: readonly PortableAcceptCandidate[];
}

interface PortableAcceptCandidate {
  readonly specificationId: number;
  readonly terminalId: number | null;
  readonly channel: "main" | "trivia";
  readonly priority: number;
  readonly sourceOrder: number;
  readonly literal: boolean;
}
```

Candidate order must implement one explicit tie-breaking contract.

### 2. Add efficient expected-terminal sets

The parser plan must expose terminals expected in each LR state, preferably as bitsets or sorted compact arrays.

Do not use display strings for runtime membership checks.

### 3. Define two different APIs deliberately

#### Standalone tokenization

```ts
lex(source)
```

Uses global semantics:

1. longest match;
2. highest priority;
3. literal-over-regex tie policy;
4. declaration/source order.

This API remains deterministic but may choose a token that is not useful for a later parser state.

#### Integrated parsing

```ts
parse(source)
```

Uses contextual tokenization:

- inspect all candidates at the longest accepted source extent;
- retain trivia according to the trivia policy;
- choose the best main candidate accepted by the current parser context;
- apply the same priority ordering among context-valid candidates.

Document clearly that `parse(source)` is not necessarily equivalent to `parseTokens(source, lex(source).tokens)` for grammars with contextual overlaps.

### 4. Define reduction-before-lookahead behavior

LR parsing may need to perform one or more reductions before the correct expected-terminal set is known.

Specify and implement a terminating algorithm. Possible approach:

1. scan source once to obtain the longest-match candidate set at the current offset;
2. query actions for every candidate in the current state;
3. if none have actions but the state permits reductions independent of candidate choice, perform deterministic reductions and retry;
4. if declared parser conflicts produce multiple reductions/actions, integrate with T07 branch state;
5. prevent infinite zero-input reduction loops with explicit runtime invariants and limits.

Do not silently choose a token before the parser has reached the state that consumes it.

### 5. Specify trivia interaction

Trivia candidates should remain eligible regardless of parser expected terminals, subject to priority rules that prevent a skip token from stealing significant syntax incorrectly.

Required policy analysis:

- skip vs skip overlap;
- skip vs named token overlap;
- skip vs literal overlap;
- trivia with higher priority than main token;
- longest trivia match crossing potential syntax boundaries.

A skip candidate that makes a required main token unreachable must be a compile-time error unless an explicit, sound contextual policy resolves it.

### 6. Update overlap diagnostics

Classify overlap rather than treating every intersection identically.

Suggested outcomes:

```text
token/token, context-distinguishable  -> allowed; information/warning for lex()
token/token, never distinguishable    -> error unless explicit priority intended
skip/token, skip can win               -> error
skip/literal, skip can win             -> error
skip/skip                              -> warning or allowed with deterministic winner
literal/token                          -> analyze context and priority
```

Diagnostics must include:

- a real witness string;
- both declaration spans;
- selected global candidate;
- whether contextual parsing can distinguish them;
- copy-ready remediation.

### 7. Align Tree-sitter lowering

Ensure token priorities lower to Tree-sitter lexical precedence consistently.

Add portability diagnostics for cases where Tree-sitter's contextual lexing and Baba's portable runtime still cannot be shown to agree.

### 8. Update token-stream API documentation

Define the relation between:

```ts
lex(source)
parse(source)
parseTokens(source, tokens)
parseTokensUnchecked(source, tokens)
```

`parseTokens()` cannot recover contextual candidates already collapsed by external tokenization. State this explicitly.

### 9. Add runtime statistics

Track or expose:

- average accept candidates per DFA state;
- maximum accept candidates;
- contextual candidate checks;
- reductions before token selection;
- ambiguous lexical sites encountered.

Use these in benchmarks, not in normal parse results.

## Likely files

- `src/compiler/portable_plan/*`
- `src/compiler/regex/dfa.ts`
- `src/compiler/regex/lexer.ts`
- `src/compiler/regex/overlap.ts`
- `src/targets/typescript/plan.ts`
- BRL runtime files after T03/T04
- Tree-sitter token emission code
- `tests/lexer_test.ts`
- `tests/parser_test.ts`
- `tests/ts_wasm_parity_test.ts`
- `tests/tree_sitter_test.ts`

## Tests

1. the `A`/`B` example accepts both branches under `parse()`;
2. `lex()` remains globally deterministic;
3. keyword/identifier overlap;
4. type-identifier/identifier overlap;
5. same regex with context-specific token names;
6. skip/token overlap that would hide syntax;
7. skip/literal overlap;
8. reductions before token selection;
9. nullable rules around contextual choice;
10. declared parser conflicts combined with lexical candidates;
11. exact TypeScript/Wasm parity;
12. Tree-sitter acceptance parity over a dedicated fixture corpus;
13. bounded work on many candidate tokens;
14. diagnostic witness and related spans.

## Acceptance criteria

- Both context-specific tokens are reachable in the same grammar.
- DFA states preserve deterministic candidate lists.
- `parse()` uses LR context; `lex()` uses documented global behavior.
- Trivia cannot silently steal required syntax.
- TypeScript and Wasm use the exact same contextual selection semantics.
- Tree-sitter mismatches produce explicit portability diagnostics.
- Runtime work is bounded and benchmarked.

## Out of scope

- external scanner implementation;
- lexical modes/states beyond parser-context filtering;
- indentation or nested comments;
- incremental lexing;
- arbitrary GLR token lattices;
- changing the user grammar syntax beyond priority metadata required for current semantics.

## Copy-ready agent prompt

> Implement T06 from `tasks/T06-contextual-lexing-and-token-selection.md`. Preserve all DFA accept candidates and add parser-contextual token selection driven by LR expected-terminal sets. Keep standalone `lex()` deterministic, classify overlaps precisely, prevent trivia from stealing syntax, and prove TypeScript/Wasm plus Tree-sitter acceptance behavior with focused fixtures.

## PR checklist

- [ ] DFA retains all accept candidates.
- [ ] Expected-terminal sets available efficiently.
- [ ] Contextual parse token selection implemented.
- [ ] Standalone lex semantics documented.
- [ ] Trivia/overlap policy enforced.
- [ ] Tree-sitter priority parity analyzed.
- [ ] Differential tests and benchmarks added.
- [ ] Full repository checks pass.
