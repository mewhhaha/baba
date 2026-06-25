# Feature Tour Example

This example is a compact coverage tour for Baba's current public feature set.
It is not a full programming language; it is a small grammar designed to make
the generated artifacts and runtime contracts easy to inspect.

It demonstrates:

- explicit token and skip declarations, comments, literals, fields, optionals,
  repetitions, separated lists, and generated CST fields;
- parser-contextual token selection with `A` and `B`, where standalone `lex()`
  chooses `A` for `x`, but `parse()` can select `B` in the `> x;` context;
- declared parser conflicts for tuple/group type syntax;
- generated Tree-sitter grammar and highlight/fold/tag/textobject/rainbow
  queries from `baba.json`;
- generated TypeScript and Wasm parser APIs, including parser-plan identity,
  runtime implementation identity, `parseTokens`, `parseTokensUnchecked`, Wasm
  parser instances, reset/dispose, ABI metadata, and resource limits;
- parser-kit compilation and validation;
- external `parser.wasm` packaging through the API.

## Recreate This Example

All commands in this section assume your current directory is
`examples/feature-tour`.

Generate the checked artifacts:

```sh
deno task generate
```

Run the feature tour:

```sh
deno task run
```

Exercise external Wasm binary packaging too:

```sh
deno task external
```

Validate the example:

```sh
deno task test
```

Optionally validate the Tree-sitter grammar:

```sh
deno task tree-sitter:generate
deno task tree-sitter:build
deno task tree-sitter:parse
```

The generated files under `generated/` are committed so bootstrap drift can be
reviewed, but they are reproducible output. Regenerate them with the root
repository task:

```sh
deno task bootstrap
```
