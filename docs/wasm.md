# Wasm Target

Status: current generated Wasm target guide.

The Wasm target emits a JavaScript-hosted core WebAssembly parser plus a
TypeScript adapter under the configured output directory, usually `wasm/`.

```text
wasm/
  syntax.ts
  lexer.ts
  parser.ts
  wasm.ts
  mod.ts
  abi.json
```

Current generated bundles use the `javascript-hosted-core-wasm` target kind.
Baba does not yet emit a Wasm Component Model package, WIT bindings, WASI
library, or browser-only package.

## Public API

The adapter mirrors the generated TypeScript target API: `lex`, `parse`,
`parseTokens`, source-map helpers, generated syntax types, parser-plan identity,
and runtime implementation identity. It also exports Wasm-specific metadata such
as `wasmTargetKind`, `wasmBytes`, `wasmAbiVersion`, `wasmSemanticsVersion`,
`memory`, and `reset()`.

For embedded Wasm bundles, `createParser()` creates an independent parser
instance:

```ts
const parser = createParser();
const result = parser.parse(source);
parser.reset();
parser.dispose();
```

`createParserAsync()` has the same behavior for embedded bundles. External
binary bundles accept `{ bytes }`, `{ module }`, or `{ wasm }` in
`createParser()` and additionally accept `{ url }` in `createParserAsync()`.
`createParserFromBytes()`, `createParserFromModule()`, and
`createParserFromUrl()` remain available for the low-level adapter path and also
install a backwards-compatible module-level default instance.

Importing an embedded adapter exposes static metadata such as ABI constants and
parser-plan identity without synchronously compiling Wasm. The embedded core
module and trace runtime are compiled lazily when a parser instance is created
or a module-level parse/lex helper first needs the default instance.

Parser factories also accept `limits` for adapter-owned hard resource bounds:

```ts
const parser = createParser({
  limits: {
    maxInputUnits: 100_000,
    maxTokens: 50_000,
    maxTraceActions: 1_000_000,
    maxExploredBranches: 100_000,
    maxQueuedBranches: 100_000,
    maxMemoryPages: 64,
  },
});
```

The low-level factories accept the same options. Limit failures throw
`WasmResourceLimitError` with a stable string `code`, such as
`INPUT_LIMIT_EXCEEDED`, `TOKEN_LIMIT_EXCEEDED`, `PARSER_STACK_LIMIT_EXCEEDED`,
`PARSER_BRANCH_LIMIT_EXCEEDED`, `TRACE_LIMIT_EXCEEDED`,
`CST_NODE_LIMIT_EXCEEDED`, `DIAGNOSTIC_LIMIT_EXCEEDED`, or
`MEMORY_LIMIT_EXCEEDED`.

Each parser instance owns its `WebAssembly.Instance`, memory, source buffers,
trace runtime, caches, reset epoch, and disposed state. Module-level `lex`,
`parse`, `parseTokens`, and `parseTokensUnchecked` remain convenience wrappers
over an active/default Wasm instance; code that needs isolation or lifecycle
control should prefer `createParser()`.

## ABI Descriptor

`wasm/abi.json` is the machine-readable descriptor for non-JavaScript hosts. It
records the ABI version, parser-plan identity, runtime implementation identity,
core layout constants, source/span conventions, trace statuses, and diagnostic
schemas.

The normative ABI document is [wasm-abi.md](wasm-abi.md).

## Memory And Lifetime

The adapter copies JavaScript source strings into Wasm memory as UTF-16 code
units. Public spans remain UTF-16 offsets. Adapter-owned source and trace
capabilities are epoch-checked and become stale after reset or source changes.
Typed-array views must not be retained across memory growth.

## Validation

Repository checks validate generated Wasm through the JavaScript adapter and,
when installed, independent tools such as `wasm-tools validate` and Wasmtime.
