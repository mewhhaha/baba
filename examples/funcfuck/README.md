# Funcfuck Example

Funcfuck is a tiny functional stream language built with Baba. Programs define
named unary functions over number streams, compose them with `>>`, fan them out
with `[f, g, h]`, and run `emit` statements.

The semantics are intentionally small:

- Every function has type `number[] -> number[]`.
- `f >> g` applies `f` first, then `g`.
- `[f, g]` applies both functions to the same input and concatenates the
  results.
- `repeat(n, f)` applies `f` exactly `n` times.
- Builtins include `id`, `inc`, `dec`, `double`, `square`, `neg`, `sum`,
  `product`, `first`, `last`, `add(n)`, `mul(n)`, `take(n)`, and `drop(n)`.

Example:

```funcfuck
def boost = add(2) >> square;
def summarize = [id, boost, sum];

emit [1, 2, 3] => summarize;
```

Output:

```text
[1, 2, 3, 9, 16, 25, 6]
```

## Recreate This Example

All commands in this section assume your current directory is
`examples/funcfuck`.

Step 1: create the project directory.

```sh
mkdir -p examples/funcfuck/programs
cd examples/funcfuck
```

Step 2: write the starting files:

- `grammar.baba`: the Baba grammar.
- `baba.json`: optional parser metadata.
- `programs/*.ff`: sample source files.

The generated files under `generated/` are ignored local artifacts. Regenerate
them when you want to inspect or run the example.

Step 3: generate the parser artifacts.

```sh
deno task generate
```

That command creates:

- `generated/.baba-manifest.json`: generated-file ownership manifest.
- `generated/wasm/*`: generated Wasm lexer and island-frontend artifacts.

Step 4: run `interpreter.ts` against the shared CPU frontend:

The runner loads `generated/wasm/parser.plan`, executes the same island
transducers used by the GPU backend, and reports the compact token/node/edge IR.

Step 5: run the sample programs.

```sh
deno task pipeline
deno task fanout
deno task window
```

Validate the generated plan and runner:

```sh
deno task check
```

`generated/` is a local build output; it does not need to be committed.
