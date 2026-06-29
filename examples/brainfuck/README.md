# Brainfuck Example

This example builds a small Brainfuck-family language with Baba, then uses the
generated Wasm-backed parser to implement an interpreter.

The language supports standard Brainfuck plus:

- `3+`, `3>`, `3{ ... }`, etc. to repeat the next instruction.
- `{ ... }` to fork a child task with its own pointer over shared tape.
- `!` to join active child tasks before continuing.

## Recreate This Example

All commands in this section assume your current directory is
`examples/brainfuck`.

Step 1: create the project directory.

```sh
mkdir -p examples/brainfuck/programs
cd examples/brainfuck
```

Step 2: write the starting files:

- `grammar.ebnf`: the Baba grammar.
- `baba.json`: optional Tree-sitter query metadata.
- `programs/*.bf`: sample source files to test.

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
- `.helix/runtime/queries/brainfuck/*.scm`: local Helix query copies.

The Wasm and parser-kit targets are not part of `--target all`. This example
opts into legacy-specialized Wasm for the interpreter and keeps kit usage
artifact-free by compiling the grammar in memory and parsing a sample program
with the public kit helpers:

```sh
deno task kit
```

The `.helix/languages.toml` file declares the generated Tree-sitter grammar for
Helix. Run `deno task helix:sync` again whenever you regenerate the example and
want to refresh the local query copies.

Helix needs both the query files and a compiled Tree-sitter parser before it can
highlight `.bf` files. To prepare the local Helix runtime, run:

```sh
deno task helix:build
deno task helix:health
```

Plain `hx --health brainfuck` can still show missing highlights from this
directory. Helix reads project-local `.helix/languages.toml`, but it does not
add project-local `.helix/runtime` to the runtime search path automatically.

Open files with the example runtime on Helix's runtime path:

```sh
HELIX_RUNTIME=$PWD/.helix/runtime hx programs/hello.bf
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

Step 5: run the interpreter.

```sh
deno task hello
deno task parallel
deno task counts
deno task advanced
```

Expected output:

```text
Hello World!
HI
OK
ABCD
```

Validate the generated runtime and interpreter:

```sh
deno task check
deno task kit
```

Optionally validate the Tree-sitter grammar:

```sh
deno task tree-sitter:generate
deno task tree-sitter:build
deno task tree-sitter:parse
```

`parser.so`, `.cache/`, and `generated/` are local build outputs; they do not
need to be committed.
