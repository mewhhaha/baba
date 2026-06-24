# T09: Analysis and resource hardening

- **Priority:** P1
- **Estimated size:** Large
- **Merge wave:** 0
- **Depends on:** None
- **Suggested PR title:** `Harden regex and grammar analysis against pathological input`

[Back to task index](./README.md)

## Objective

Make compiler analysis predictable under adversarial or simply very large grammars. Parse regexes once, share their semantics across targets, cache automata, add work budgets, and diagnose nonproductive or pathological grammar structures early.

## Problem

Final DFA/LR limits are not enough. Expensive work can occur before final structures exist:

- regex parsing and bounded-repeat expansion;
- NFA construction;
- determinization;
- pairwise overlap intersection;
- recursive grammar traversals;
- nullable/FIRST closure;
- canonical LR closure/goto construction;
- excessive diagnostic production.

Regexes may also be validated through multiple engines or reparsed by multiple targets, creating semantic and performance drift.

## Required work

### 1. Parse each regex once

The EBNF parser should capture regex source only. Generic semantic analysis should call Baba's portable regex parser exactly once per token/skip declaration.

Store the result:

```ts
interface AnalyzedToken {
  readonly patternSource: string;
  readonly pattern: RegexAst;
  readonly nullable: boolean;
  readonly priority: number;
  // existing IDs/spans...
}
```

Remove JavaScript `new RegExp(...)` validation from grammar parsing. Baba's portable regex language—not JavaScript's parser—is authoritative.

### 2. Emit Tree-sitter regexes from `RegexAst`

Implement a canonical Tree-sitter regex renderer:

```ts
emitTreeSitterRegex(ast: RegexAst): TreeSitterRegexResult
```

Requirements:

- preserve Baba's defined character/code-point semantics;
- escape JavaScript regex delimiters correctly;
- render grouping/alternation/quantifiers canonically;
- return capability diagnostics when semantics cannot be represented exactly;
- never fall back silently to raw pattern source.

Add acceptance tests against `tree-sitter generate`.

### 3. Add compiler work limits

Define options with safe defaults:

```ts
interface CompilerWorkLimits {
  regexSourceLengthLimit?: number;
  regexAstNodeLimit?: number;
  regexNestingLimit?: number;
  boundedRepeatLimit?: number;
  nfaStateLimit?: number;
  dfaStateLimit?: number;
  overlapProductStateLimit?: number;
  overlapPairLimit?: number;
  grammarExpressionDepthLimit?: number;
  lrClosureWorkLimit?: number;
  diagnosticLimit?: number;
}
```

These limits should apply during construction, not only after completion.

Suggested diagnostics:

```text
REGEX_SOURCE_LIMIT
REGEX_AST_NODE_LIMIT
REGEX_NESTING_LIMIT
REGEX_REPEAT_EXPANSION_LIMIT
REGEX_NFA_STATE_LIMIT
REGEX_DFA_STATE_LIMIT
REGEX_OVERLAP_WORK_LIMIT
GRAMMAR_EXPRESSION_DEPTH_LIMIT
LR_CLOSURE_WORK_LIMIT
DIAGNOSTIC_LIMIT_REACHED
```

### 4. Cache token/literal automata

Build each token/literal DFA once per compile.

Overlap checks must intersect cached DFAs rather than rebuilding each operand for every pair.

Create an analysis product:

```ts
interface LexicalAnalysis {
  readonly astBySpecification: ...;
  readonly nfaBySpecification: ...; // optional
  readonly dfaBySpecification: ...;
  readonly combinedDfa: Dfa;
  readonly diagnostics: readonly Diagnostic[];
}
```

T01 may absorb this into portable plan construction.

### 5. Bound overlap analysis

Pairwise comparison is quadratic. Add:

- early classification by first-character/code-point ranges;
- cached nullable/FIRST-code-point summaries;
- configurable pair and product-state budgets;
- deterministic truncation diagnostics;
- optional skip of nonportable warnings under `portability: off`, while retaining correctness-critical skip/token checks.

Do not emit false “no overlap” conclusions when a work budget is exceeded. Return an explicit unknown/error outcome.

### 6. Add grammar productivity analysis

Detect:

- productive rules;
- nonproductive rules;
- mutually recursive rule groups that derive no terminal text;
- root that cannot derive any sentence;
- rules that only derive empty text;
- nullable recursive cycles;
- repetitions/lists around nullable expressions;
- unreachable tokens and skips;
- skip declarations unused by portable or Tree-sitter semantics.

Use strongly connected components rather than recursive ad hoc traversal where appropriate.

Suggested diagnostics:

```text
NONPRODUCTIVE_RULE
NONPRODUCTIVE_ROOT
EMPTY_ONLY_RULE
NULLABLE_RECURSIVE_CYCLE
UNUSED_SKIP_DECLARATION
SHADOWED_TOKEN_LANGUAGE
```

### 7. Analyze lexical shadowing

Beyond overlap, identify when one token language is completely shadowed by higher-priority/literal candidates under global lexing.

Where contextual lexing from T06 can recover the token, classify accordingly. Otherwise report that the token can never be emitted for at least one/all witnesses.

Full language inclusion may be expensive. Implement DFA difference/emptiness with work limits.

### 8. Remove unsafe recursive traversals

Audit:

- EBNF expression analysis;
- regex AST traversal;
- NFA construction;
- query reachability;
- field/cardinality analysis;
- BNF lowering.

Replace deep recursion with explicit stacks or enforce a depth limit before recursion can overflow JavaScript.

### 9. Limit diagnostics

A malicious grammar can create quadratic diagnostics.

Add a collector that:

- caps total diagnostics;
- optionally caps per-code diagnostics;
- adds one `DIAGNOSTIC_LIMIT_REACHED` summary;
- preserves deterministic ordering;
- never hides the first relevant root cause.

### 10. Add internal analysis statistics

Track:

- regex AST/NFA/DFA sizes;
- overlap pairs and product states explored;
- grammar SCC counts;
- nullable/productive iteration counts;
- LR closure work;
- diagnostics emitted/suppressed.

Expose through advanced/debug APIs or `--verbose`, not the stable default output.

## Likely files

- `src/parser.ts`
- `src/compiler/analyze.ts`
- `src/compiler/ir.ts`
- `src/compiler/diagnostics.ts`
- `src/compiler/regex/*`
- Tree-sitter regex emission code in `src/generate.ts` or replacement planner
- `src/targets/typescript/plan.ts`
- `src/ast.ts`
- `src/cli.ts`
- `tests/regex_test.ts`
- `tests/fuzz_test.ts`
- `tests/api_test.ts`
- `tests/tree_sitter_test.ts`

## Tests

1. huge bounded repetition;
2. deeply nested regex groups;
3. deeply nested EBNF expressions;
4. alternation/determinization explosion;
5. many overlapping tokens;
6. overlap product-state budget;
7. regex parsed once per declaration using a test seam;
8. cached automata reused;
9. canonical Tree-sitter regex emission;
10. nullable recursive cycles;
11. nonproductive mutual recursion;
12. empty-only root;
13. unused skip declarations;
14. completely shadowed token language;
15. diagnostic cap behavior;
16. deterministic early termination;
17. no generic internal errors for expected exhaustion.

## Acceptance criteria

- Portable regexes are parsed once in generic analysis.
- All targets use the same `RegexAst` semantics.
- Tree-sitter regexes are canonically emitted from the AST.
- Every potentially explosive analysis phase has an active work budget.
- Overlap analysis reuses cached automata.
- Nonproductive and nullable-cycle grammars receive targeted diagnostics.
- Deep input cannot overflow the JavaScript call stack before a diagnostic.
- Limit failures are deterministic and structured.

## Out of scope

- contextual token selection implementation itself;
- BRL/runtime-language compiler;
- parser runtime memory limits;
- optimizing every analysis beyond bounded correctness;
- accepting broader regex syntax without a portable semantic definition.

## Copy-ready agent prompt

> Implement T09 from `tasks/T09-analysis-and-resource-hardening.md`. Centralize parsed regexes in generic analysis, emit Tree-sitter regexes from the canonical AST, cache automata, add construction-time work limits, and add productive/nonproductive/nullable-cycle/shadowing analyses with adversarial tests. Never report a guessed result when a work budget is exhausted.

## PR checklist

- [ ] Regexes parsed once and stored in analyzed IR.
- [ ] Tree-sitter regex renderer uses `RegexAst`.
- [ ] Work limits added to every expensive phase.
- [ ] Automata cached for overlap analysis.
- [ ] Productivity/nullable-cycle analyses added.
- [ ] Deep-recursion hazards addressed.
- [ ] Diagnostic cap added.
- [ ] Full repository checks pass.
