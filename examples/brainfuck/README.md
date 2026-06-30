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

- `grammar.baba`: the Baba grammar.
- `baba.json`: optional parser metadata.
- `programs/*.bf`: sample source files to test.

The generated files under `generated/` are ignored local artifacts. Regenerate
them when you want to inspect or run the example.

Step 3: generate the parser artifacts.

```sh
deno task generate
```

That command creates:

- `generated/.baba-manifest.json`: generated-file ownership manifest.
- `generated/wasm/*`: generated Wasm-backed lexer/parser artifacts.

Step 4: write `interpreter.ts`, loading the generated parser:

```ts
import { createParser } from "./generated/wasm/mod.ts";

const parser = createParser({
  bytes: Deno.readFileSync(
    new URL("generated/wasm/parser.wasm", import.meta.url),
  ),
  plan: Deno.readFileSync(
    new URL("generated/wasm/parser.plan", import.meta.url),
  ),
});
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
```

`generated/` is a local build output; it does not need to be committed.
