# Slim Runtime Architecture

Baba is moving parser runtimes from generated-program packaging to a data-first
shape:

```text
grammar.ebnf
  -> analyzed grammar
  -> compact parser plan
  -> shared runtime executor
```

The default generated parser directory is:

```text
generated/
  wasm/
    abi.json
    manifest.json
    mod.ts
    parser.plan
    parser.wasm
    syntax.ts
```

`mod.ts` is a small adapter that imports the shared Wasm runtime and requires
callers to pass `parser.wasm` plus `parser.plan` into `createParser()`.
Grammar-specific structural types stay in `syntax.ts`, but lexer and parser
algorithms live once in package runtime source.

## Output Models

Wasm is the generated target:

```text
grammar.ebnf -> parser.wasm + parser.plan + syntax.ts -> @mewhhaha/baba/runtime/wasm
```

The Wasm target emits shared-generic data packaging only: a generic
`parser.wasm`, grammar-specific `parser.plan`, small `mod.ts` wrapper, and typed
`syntax.ts`.

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
