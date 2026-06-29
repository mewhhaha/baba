# T03 - Regex, Unicode, and DFA compiler

Priority: P0

Depends on: T00

## Goal

Implement the lexer generator core: compile all token, literal, trivia, and
mode-local regex rules into optimized combined DFAs.

## Scope

Support:

- string literals;
- regex character classes;
- Unicode properties used by identifiers, operators, and symbols;
- concatenation, alternation, option, star, plus, and bounded repetition;
- escaped code points;
- negated classes;
- rule priority;
- declaration-order tie breaks;
- literal and keyword priority policy;
- longest-match selection;
- retained accept candidates for contextual lexing;
- DFA minimization or another measured table reduction strategy;
- table compression suitable for TypeScript and Wasm runtimes;
- resource limits for regex parsing, NFA construction, DFA construction, and
  minimization.

Pipeline:

```text
regex rules
  -> regex AST
  -> NFA fragments
  -> combined NFA per lexer mode
  -> DFA
  -> minimized or optimized DFA
  -> compact table plan
```

## Example lexer cases

Use small fixtures that make the matching policy unambiguous:

```ebnf
token EqEq priority 0 = "==" ;
token Eq priority 0 = "=" ;
token Let priority 10 = "let" ;
token Ident priority 0 = /[_\p{L}][_\p{L}\p{N}]*/ ;
token Int priority 0 = /[0-9]+/ ;
skip Space channel trivia = /[ \t\r\n]+/ ;
```

Expected winners:

| Source | Winner | Reason |
|---|---|---|
| `==` | `EqEq` | longest match beats `Eq` |
| `=` | `Eq` | only one accepting rule |
| `let` | `Let` | equal-length priority beats `Ident` |
| `letter` | `Ident` | longest match beats shorter literal |
| `abc123` | `Ident` | Unicode identifier continuation |

Also include Unicode examples such as `alpha`, `_delta2`, and `lambda` spelled
with non-ASCII letters in the fixture files.

## Implementation notes

- Do not run JavaScript regexes against user source in the lexer hot path.
- Normalize matching semantics around Unicode scalar values or UTF-16 code
  units explicitly. Document the chosen representation.
- Keep table IDs stable for reproducible generated artifacts.
- Preserve enough metadata to explain token shadowing and overlap diagnostics.
- Avoid optimizing away retained accept candidates needed by T05.

## Example DFA behavior

Given rules:

```ebnf
token EqEq = "==" ;
token Eq = "=" ;
token Ident = /[_\p{L}][_\p{L}\p{N}]*/ ;
token Let = "let" ;
```

the combined DFA should produce these accept candidates:

| Input | Global winner | Retained candidates |
|---|---|---|
| `==` | `EqEq` | `EqEq`, `Eq` at offset 1 |
| `=` | `Eq` | `Eq` |
| `let` | `Let` | `Let`, `Ident` |
| `letter` | `Ident` | `Ident` |

Tests should assert longest-match first, then priority, then declaration-order
tie break. The DFA table snapshot should be stable enough to review, but tests
should focus on observable lexing behavior and table invariants instead of exact
state numbering unless the state IDs are part of the public plan contract.

## Deliverables

- regex AST and parser updates for v2 syntax;
- NFA and DFA builders;
- DFA optimizer/minimizer;
- compact DFA table representation;
- overlap and shadowing analysis hooks;
- tests for Unicode class behavior;
- tests for longest match and priority behavior;
- benchmarks for lexer throughput and table size.

## Acceptance criteria

- `==` beats `=` by longest match.
- `keyword` beats identifier when configured by priority.
- equal-length ties are deterministic.
- contextual candidates can be retained without changing `lex()` global winner
  semantics.
- unsupported or explosive regexes produce structured diagnostics, not internal
  exceptions.
- large token sets remain within the benchmark budget established by T00.

## Verification harness

Run:

```sh
deno test --allow-read tests/regex_v2_test.ts tests/lexer_dfa_v2_test.ts
deno run --allow-read --allow-write scripts/parser_pipeline_bench.ts --lexer-only --json tmp/lexer-v2.json
deno task check
```

The tests should include property-style checks comparing small regexes against a
trusted reference matcher where semantics overlap.

## Out of scope

- Lexer modes and layout token insertion.
- Parser-contextual token selection.
- Parser table generation.
