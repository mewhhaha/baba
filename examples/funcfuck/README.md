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
- `baba.json`: optional Tree-sitter query metadata.
- `programs/*.ff`: sample source files.

The generated files under `generated/` are ignored local artifacts. Regenerate
them when you want to inspect or run the example.

Step 3: generate the parser artifacts.

```sh
deno task generate
deno task helix:sync
```

That command explicitly requests legacy-specialized Wasm packaging and creates:

- `generated/.baba-manifest.json`: generated-file ownership manifest.
- `generated/grammar.js`: Tree-sitter grammar.
- `generated/queries/*.scm`: generated Tree-sitter queries.
- `generated/ts/*.ts`: generated TypeScript lexer/parser/syntax types.
- `generated/wasm/*.ts`: generated Wasm-backed lexer/parser runtime.
- `.helix/runtime/queries/funcfuck/*.scm`: local Helix query copies.

The `.helix/languages.toml` file declares the generated Tree-sitter grammar for
Helix. Run `deno task helix:sync` again whenever you regenerate the example and
want to refresh the local query copies.

Helix needs both the query files and a compiled Tree-sitter parser before it can
highlight `.ff` files. To prepare the local Helix runtime, run:

```sh
deno task helix:build
deno task helix:health
```

Plain `hx --health funcfuck` can still show missing highlights from this
directory. Helix reads project-local `.helix/languages.toml`, but it does not
add project-local `.helix/runtime` to the runtime search path automatically.

Open files with the example runtime on Helix's runtime path:

```sh
HELIX_RUNTIME=$PWD/.helix/runtime hx programs/pipeline.ff
```

Or use the task wrapper:

```sh
deno task helix:open
```

If Helix was already open, restart it after building the parser.

Step 4: write `interpreter.ts`, importing the generated parser:

```ts
import { parse } from "./generated/wasm/mod.ts";
```

The interpreter compiles the generated CST into JavaScript functions, resolves
named definitions lazily, and evaluates each `emit` statement.

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

Optionally validate the Tree-sitter grammar:

```sh
deno task tree-sitter:generate
deno task tree-sitter:build
deno task tree-sitter:parse
```

`parser.so`, `.cache/`, and `generated/` are local build outputs; they do not
need to be committed.
