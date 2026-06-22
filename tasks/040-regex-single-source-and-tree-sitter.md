# Task 040: Regex Single Source Of Truth

## Goal

Complete FEEDBACK P0.5 and P0.6: Baba regexes should be parsed once by the
portable regex parser, stored as AST, and emitted canonically for Tree-sitter.

## Files To Inspect

- `src/parser.ts`
- `src/compiler/analyze.ts`
- `src/compiler/ir.ts`
- `src/compiler/regex/parser.ts`
- `src/compiler/regex/emit.ts`
- `src/targets/tree_sitter/plan.ts`
- `src/generate.ts`
- `tests/parser_test.ts`
- `tests/tree_sitter_test.ts`
- `tests/regex_test.ts`

## Search Commands

```sh
rg -n "new RegExp|RegExp\\(|patternSource|regexAst|parsePortableRegex|emitTreeSitterRegex|raw regex|regex literal" src tests
```

## Work

1. Ensure the EBNF parser only captures regex source text.
2. Ensure semantic analysis calls `parsePortableRegex` once and stores the AST.
3. Remove target-side reparsing of raw regex strings where avoidable.
4. Ensure Tree-sitter generation uses `emitTreeSitterRegex(regexAst)`.
5. Emit backend capability diagnostics for portable regex constructs that cannot
   be represented in Tree-sitter.

## Required Tests

- A regex accepted by Baba but not by JavaScript `RegExp` should be handled by
  Baba analysis, not rejected in the EBNF parser.
- Tree-sitter regex emission should be canonical for escapes, dot, negated
  classes, NUL, newlines, and non-BMP behavior where supported.
- Unsupported Tree-sitter regex constructs should produce structured
  diagnostics.

## Acceptance

```sh
deno test -A tests/regex_test.ts tests/parser_test.ts tests/tree_sitter_test.ts
```

And:

```sh
rg -n "new RegExp|RegExp\\(" src/parser.ts src/compiler src/targets
```

must show no EBNF-parser validation path.

## Do Not Touch

- Do not broaden Baba's regex language in this task.
- Do not change generated parser public APIs.
