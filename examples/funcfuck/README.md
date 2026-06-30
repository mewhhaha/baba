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

- `grammar.ebnf`: the Baba grammar.
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
- `generated/wasm/*`: generated Wasm-backed lexer/parser artifacts.

Step 4: write `interpreter.ts`, importing the generated parser:

The interpreter loads `generated/wasm/parser.wasm` and
`generated/wasm/parser.plan` through the generated Wasm wrapper.

The interpreter walks generated cursors to compile JavaScript functions,
resolves named definitions lazily, and evaluates each `emit` statement.

Step 5: run the sample programs.

```sh
deno task pipeline
deno task fanout
deno task window
```

Expected output:

```text
[1, 2, 3, 9, 16, 25, 6]
[21, 12, 12]
[8, 15, 16, 39, 78]
```

Validate the generated runtime and interpreter:

```sh
deno task check
```

`generated/` is a local build output; it does not need to be committed.
