# Baba Docs

These docs describe the current Baba package and generated parser API. They are
written for users and for agents that need enough context to generate, run, or
maintain a Baba parser without reading historical design material first.

## Start Here

- [Grammar](grammar.md): the EBNF grammar syntax accepted by the public CLI.
- [Metadata](metadata.md): optional `baba.json` fields for root selection,
  parser conflicts, and target behavior.
- [Wasm Target](wasm.md): generated files and the TypeScript runtime API.
- [Wasm ABI](wasm-abi.md): low-level host contract for `parser.wasm`,
  `parser.plan`, and `abi.json`.
- [Diagnostics](diagnostics.md): stable diagnostic codes and result shapes.
- [Limits](limits.md): compiler, runtime, memory, and size limits.
- [Examples](examples.md): how example projects are generated and checked.
- [Performance](performance.md): runtime benchmarks and plan inspection.
- [Stability](stability.md): compatibility policy for public surfaces.
- [Contributing](contributing.md): local checks and generated-output policy.
- [Runtime Maintenance](runtime-maintenance.md): ownership boundaries for
  runtime changes.
- [Release Checklist](release-checklist.md): gates before publishing.

## Current Generated Runtime

Baba currently generates a Wasm-first parser bundle:

```text
grammar.ebnf + baba.json -> generated/wasm/
                         -> generated/queries/
```

The generated `wasm/` directory contains:

- `parser.wasm`: the prebuilt generic lexer/parser engine;
- `parser.plan`: grammar-specific DFA/LR tables and runtime metadata;
- `mod.ts`: the generated TypeScript entrypoint;
- `syntax.ts`: generated cursor, token tape, diagnostic, and result types;
- `abi.json`: the machine-readable low-level Wasm ABI descriptor;
- `manifest.json`: generated output metadata.

The generated `queries/` directory contains non-empty Tree-sitter query
fragments named `generated-*.scm`, such as generated highlights, locals, folds,
tags, textobjects, rainbows, and injections. They are emitted as editor assets
alongside the Wasm parser bundle.

The public parser instance surface is:

- `parse(source, options?)`: returns a cursor parse result;
- `lex(source, options?)`: returns a lazy token tape result;
- `validate(source, options?)`: runs trace validation and returns diagnostics;
- `reset()`;
- `dispose()`.

The methods above are the complete generated parser instance API.

## Common Commands

```sh
baba grammar.ebnf --out generated
baba check grammar.ebnf
deno task check
deno task test
deno task bench:runtime --json runtime-bench.json
deno task size:check
deno task publish:dry-run
```
