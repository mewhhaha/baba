# Wasm Target

Status: current Wasm target guide.

The Wasm target now defaults to shared-generic packaging. It emits parser-plan
data plus a TypeScript adapter under the configured output directory, usually
`wasm/`, and does not emit a grammar-specialized WebAssembly module.

```text
wasm/
  plan.ts
  syntax.ts
  lexer.ts
  parser.ts
  mod.ts
  abi.json
```

Use `--wasm-packaging embedded-typescript` or `--wasm-packaging external-binary`
for the legacy grammar-specialized Wasm runtime. Legacy embedded packaging adds
`wasm.ts`; legacy external-binary packaging adds `wasm.ts`, `parser.wasm`, and
`manifest.json`.

## Public API

The default adapter mirrors the generated TypeScript target API: `lex`, `parse`,
`parseTokens`, source-map helpers, generated syntax types, parser-plan identity,
and runtime implementation identity. It also exports `wasmTargetKind` with value
`"shared-generic-runtime-data"` so callers can identify that no per-grammar Wasm
bytes were emitted.

Legacy-specialized adapters additionally export Wasm-specific metadata such as
`wasmBytes` for embedded packaging, `wasmAbiVersion`, `wasmSemanticsVersion`,
`memory`, and `reset()`.

For default shared-generic bundles, `createParser()` creates a shared-runtime
parser facade. For legacy embedded Wasm bundles, `createParser()` creates an
independent Wasm parser instance:

```ts
const parser = createParser();
const result = parser.parse(source);
parser.reset();
parser.dispose();
```

`createParserAsync()` has the same behavior for embedded bundles. External
binary bundles accept `{ bytes }`, `{ module }`, or `{ wasm }` in
`createParser()` and additionally accept `{ url }` in `createParserAsync()`.

Importing an embedded adapter exposes static metadata such as ABI constants and
parser-plan identity without synchronously compiling Wasm. The embedded core
module and trace runtime are compiled lazily when a parser instance is created
or a module-level parse/lex helper first needs the default instance.

The package-level `@mewhhaha/baba/runtime/wasm` module exposes the async runtime
boundary for parser-plan consumers:

```ts
import {
  createAutoParser,
  createWasmParser,
} from "@mewhhaha/baba/runtime/wasm";

const wasmParser = await createWasmParser(parserPlan);
const autoParser = await createAutoParser(parserPlan, {
  smallInputThreshold: 16_384,
  timing(event) {
    console.log(event.phase, event.engine, event.backend);
  },
});
```

`createWasmParser()` prepares one process-local generic Wasm executor module and
returns an isolated parser facade. `createAutoParser()` selects the shared
TypeScript runtime for small inputs and the Wasm engine policy for larger
inputs. The generic Wasm executor currently provides reusable DFA/LR table
lookup primitives and reports backend `"generic-wasm"` for preparation; public
parse-result materialization still runs through the shared TypeScript runtime
and reports backend `"wasm+typescript"` for parser instance creation. Simple
deterministic source validation parses (`mode: "validate"`) use the shared Wasm
DFA range and LR table executor for lex/parse tracing; contextual lexing,
branching grammars, and diagnostic-rich failures fall back to the TypeScript
runtime. Checked `parseTokens` calls retain the TypeScript token-stream
validation path. This keeps startup cacheable without emitting per-grammar Wasm
bytes.

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

Limit failures throw `WasmResourceLimitError` with a stable string `code`, such
as `INPUT_LIMIT_EXCEEDED`, `TOKEN_LIMIT_EXCEEDED`,
`PARSER_STACK_LIMIT_EXCEEDED`, `PARSER_BRANCH_LIMIT_EXCEEDED`,
`TRACE_LIMIT_EXCEEDED`, `CST_NODE_LIMIT_EXCEEDED`, `DIAGNOSTIC_LIMIT_EXCEEDED`,
or `MEMORY_LIMIT_EXCEEDED`.

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
