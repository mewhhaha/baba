# T07 - Expression Pratt generator

Priority: P0

Depends on: T02, T06

## Goal

Let grammar authors declare expression syntax with precedence and associativity,
then generate a fast Pratt or precedence-climbing parser for expression islands.

## Scope

Support expression declarations like:

```ebnf
expr = atom {
  infix left 10 "+"
  infix right 5 "="
  prefix 30 "-"
  postfix 40 "?"
}

atom =
    Int
  | Ident
  | "(" expr ")"
;
```

Implement:

- prefix, postfix, and infix operators;
- left, right, and non-associative infix operators;
- binding-power validation;
- duplicate and unreachable operator diagnostics;
- operator token/literal resolution;
- expression AST constructor hooks;
- expression CST node construction hooks;
- contextual token matching inside expression parsing;
- recovery hooks for incomplete expressions;
- integration with LR parser stack and lookahead handling.

## Design constraints

- Users should not have to write recursive expression towers by hand.
- Pratt parsing should be generated from grammar data, not handwritten for one
  language.
- The expression parser must report expected operands and expected operators.
- Expression parsing must not consume synchronization tokens needed by T10.

## Deliverables

- expression island IR;
- Pratt or precedence-climbing runtime executor;
- grammar analyzer checks for precedence declarations;
- generated CST shape for expression nodes;
- AST reducer hooks for expression constructors;
- tests for precedence, associativity, prefix, postfix, grouping, and recovery;
- benchmarks comparing expression-heavy files against the LR-only fallback.

## Acceptance criteria

- `a + b * c` groups as `a + (b * c)`.
- `a = b = c` follows declared associativity.
- non-associative operators reject or diagnose chained use.
- prefix and postfix operators compose predictably.
- incomplete expressions produce invalid CST nodes instead of aborting the whole
  parse once T10 recovery is available.
- Expression-heavy parsing meets the T00 performance budget.

## Verification harness

Run:

```sh
deno test --allow-read tests/pratt_v2_test.ts tests/expression_ast_v2_test.ts
deno run --allow-read --allow-write scripts/parser_pipeline_bench.ts --fixture expression-heavy --json tmp/pratt-v2.json
deno task check
```

## Out of scope

- General GLR parsing.
- Formatter-specific expression layout.
- Semantic operator overloading.
