# Slim Runtime Architecture

Baba is moving parser runtimes from generated-program packaging to a data-first
shape:

```text
grammar.ebnf
  -> analyzed grammar
  -> compact parser plan
  -> shared runtime executor
```

The desired generated parser directory is:

```text
generated/
  plan.bin or plan.ts
  types.ts
  mod.ts
```

`mod.ts` should be a small adapter that imports the shared runtime, loads the
plan data, and reexports `lex`, `parse`, `parseTokens`, and
`parseTokensUnchecked`. Grammar-specific structural types may stay generated,
but lexer and parser algorithms should live once in package runtime source.

## Output Models

Tree-sitter remains a generated target:

```text
grammar.ebnf -> grammar.js + queries/*.scm
```

TypeScript should use shared runtime packaging:

```text
grammar.ebnf -> parser plan + optional types -> @mewhhaha/baba/runtime
```

Wasm should be optional and generic:

```text
grammar.ebnf -> parser plan -> @mewhhaha/baba/runtime/wasm
```

Parser-kit remains a data target for tooling:

```text
grammar.ebnf -> parser-kit JSON + parser-plan.bin
```

`kit/parser-plan.bin` is a compact binary encoding of the parser-kit plan data
for size inspection and future binary loading. Inspect it with:

```sh
deno task inspect-plan generated/kit/parser-plan.bin
```

The TypeScript default now emits shared-runtime data and wrappers. The legacy
TypeScript generated-program path is available with
`--typescript-runtime-packaging legacy-generated` for compatibility tests. The
Wasm target defaults to shared-generic data packaging; grammar-specialized
embedded or external Wasm is legacy and requires
`--wasm-packaging
embedded-typescript` or `--wasm-packaging external-binary`.

## Parse Modes

The intended runtime boundary supports cheap validation and full CST parsing as
separate modes:

```text
source -> lexer/parser -> validate result
source -> lexer/parser -> event stream
source -> lexer/parser -> lazy CST
source -> lexer/parser -> eagerly materialized CST
```

Validation-only parsing should avoid token objects, field maps, child arrays,
source maps, and token text slices unless diagnostics require them.
