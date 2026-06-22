# Task 070: Regex Automata Cache And Resource Limits

## Goal

Finish FEEDBACK P1.10. Cache token automata during overlap analysis and enforce
regex compiler limits with structured diagnostics.

## Files To Inspect

- `src/compiler/regex/limits.ts`
- `src/compiler/regex/nfa.ts`
- `src/compiler/regex/dfa.ts`
- `src/compiler/regex/intersect.ts`
- `src/compiler/regex/overlap.ts`
- `src/compiler/analyze.ts`
- `tests/lexer_test.ts`
- `tests/regex_test.ts`

## Search Commands

```sh
rg -n "RegexCompilerLimits|nfaStateLimit|dfaStateLimit|overlapProductStateLimit|boundedRepeat|repeat|buildDfa|intersect|overlap" src/compiler tests
```

## Work

1. Ensure each token regex DFA is built once per analysis pass.
2. Reuse cached automata in pairwise overlap checks.
3. Enforce limits for AST nodes, bounded repeat expansion, NFA states, DFA
   states, and overlap product states.
4. Emit diagnostics named:
   - `REGEX_AST_NODE_LIMIT`
   - `REGEX_REPEAT_EXPANSION_LIMIT`
   - `REGEX_NFA_STATE_LIMIT`
   - `REGEX_DFA_STATE_LIMIT`
   - `REGEX_OVERLAP_WORK_LIMIT`
5. Include token/pattern span and phase in diagnostics.

## Acceptance

```sh
deno test -A tests/regex_test.ts tests/lexer_test.ts
```

Tests must include huge bounded repeats, alternation explosions, negated
classes, and many overlapping tokens.

## Do Not Touch

- Do not optimize generated lexer dispatch here. Use task `080`.
