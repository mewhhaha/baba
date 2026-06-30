# Wasm Target

The Wasm target is Baba's public output target. It emits a small generic core
Wasm module, an external grammar plan, and a small TypeScript adapter.

Default output:

```text
wasm/
  abi.json
  manifest.json
  mod.ts
  parser.plan
  parser.wasm
  syntax.ts
```

`parser.wasm` contains the generic lexer/parser lookup runtime. The engine is
authored in Rust, built ahead of time for `wasm32-unknown-unknown`, and embedded
in the Baba package; grammar generation does not invoke Cargo or require Rust on
the user's machine. `parser.plan` contains the generated DFA/LR core data plus
the shared TypeScript runtime metadata used for token, diagnostic, and cursor
access. `mod.ts` is a thin wrapper around `@mewhhaha/baba/runtime/wasm`;
`syntax.ts` is the typed token/cursor surface and does not contain runtime
tables.

## Generation

```sh
baba grammar.ebnf --out generated
```

This writes `parser.wasm` and `parser.plan` separately. Callers pass module
bytes plus plan bytes, or a compiled `WebAssembly.Module` plus plan bytes:

```ts
import { createParser } from "./generated/wasm/mod.ts";

const bytes = await Deno.readFile("generated/wasm/parser.wasm");
const plan = await Deno.readFile("generated/wasm/parser.plan");
const parser = createParser({ bytes, plan });
const result = parser.parse(source);
const firstToken = parser.lex(source).tokenTape.token(0);
parser.dispose();
```

## API

Generated `mod.ts` exports:

- `createParser(options)`
- `createParserAsync(options)`
- parser-plan identity constants
- runtime identity constants
- Wasm ABI constants

The parser instance returned by `createParser({ bytes, plan })` or
`createParser({ module, plan })` exposes:

- `parse(source, options?)`: cursor-first parse. A successful result contains
  `cursor`, not a materialized object tree. `syntax.ts` exports `RootCursor` and
  rule-specific cursor interfaces with typed field accessors for downstream
  TypeScript consumers.
- `lex(source, options?)`: lazy token tape result. Use `tokenTape.token(index)`
  for indexed access to token records.
- `validate(source, options?)`: Wasm trace validation with structured
  diagnostics and no object-tree construction.
- `reset()` and `dispose()`.

Generated Wasm parser instances expose only the methods listed above.

## ABI Descriptor

`wasm/abi.json` records:

- ABI version
- parser-plan identity
- runtime implementation identity
- source encoding and span unit
- memory layout constants
- exported Wasm function names
- external plan path and storage layout
- token, lex-result, trace-result, and cursor-tape record layouts
- parser trace status codes
- parser diagnostic code schemas

Non-JavaScript hosts should use `abi.json`, `parser.wasm`, and `parser.plan`
rather than depending on the TypeScript adapter internals.

## Lifecycle

Each parser instance owns its `WebAssembly.Instance`, loaded plan, shared
runtime parser, and disposed state. Use `dispose()` when the parser is no longer
needed. Use separate parser instances for concurrent or isolated work.
