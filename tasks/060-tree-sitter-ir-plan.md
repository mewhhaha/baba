# Task 060: Tree-Sitter Lowering From AnalyzedGrammar

## Goal

Finish FEEDBACK P1.9. Tree-sitter generation must lower from `AnalyzedGrammar`
through a target plan, not reconstruct raw EBNF.

## Files To Inspect

- `src/targets/tree_sitter/plan.ts`
- `src/generate.ts`
- `src/compiler/ir.ts`
- `tests/tree_sitter_test.ts`

## Search Commands

```sh
rg -n "EbnfGrammar|AnalyzedGrammar|TreeSitterPlan|reconstruct|metadata|grammar.js|queries" src/targets/tree_sitter src/generate.ts tests/tree_sitter_test.ts
```

## Work

1. Define or complete `TreeSitterPlan`.
2. Lower from `AnalyzedGrammar` into `TreeSitterPlan`.
3. Render `grammar.js` and queries from the plan.
4. Delete or bypass any IR-to-source-AST reconstruction layer.
5. Add a regression test that fails if Tree-sitter generation depends on raw
   `EbnfGrammar` names instead of analyzed IDs.

## Acceptance

```sh
deno test -A tests/tree_sitter_test.ts
```

and:

```sh
rg -n "reconstruct|EbnfGrammar" src/targets/tree_sitter src/generate.ts
```

shows no Tree-sitter lowering dependency on reconstructed EBNF.

## Do Not Touch

- Do not change generated Tree-sitter public file names.
- Do not compare Tree-sitter CST shape with TypeScript CST shape.
