# Baba Wasm ABI

Status: versioned core ABI for generated Wasm parser artifacts.

This document defines the contract between Baba's generated Wasm core module,
the generated TypeScript adapter, and non-JavaScript hosts that choose to call
the core module directly. The current target kind is
`javascript-hosted-core-wasm`: Baba emits a core WebAssembly module plus a
TypeScript adapter. It does not yet emit a Wasm Component Model package, WIT
bindings, WASI library, or browser-only package.

Generated Wasm bundles also include `wasm/abi.json`. Hosts should treat that
JSON file as the machine-readable descriptor for the exact generated parser.

## Versioning

The generated descriptor has:

```json
{
  "format": "baba-wasm-abi",
  "version": 1
}
```

The core module exports `abi_version() -> i32`, `plan_version() -> i32`, and
`semantics_version() -> i32`. For ABI version 1, both the descriptor and
generated adapter must agree with the core exports before the adapter uses the
module.

The descriptor also records:

- `parserPlan.format`, `parserPlan.version`, `parserPlan.semantics`, and
  `parserPlan.hash`;
- `runtimeImplementation.format`, `runtimeImplementation.version`,
  `runtimeImplementation.semantics`, and `runtimeImplementation.hash`;
- the numeric parser diagnostic code table and diagnostic detail schemas.

## Core Exports

ABI version 1 core modules export:

| Export                                                         | Kind     | Contract                                                                         |
| -------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `memory`                                                       | memory   | Linear memory owned by the instance.                                             |
| `lex_one(sourcePtr, sourceLength, offset, resultPtr) -> i32`   | function | Writes one lexical result and returns `1`, or returns `0` when no token matches. |
| `lex_all(sourcePtr, sourceLength, resultPtr, tokenPtr) -> i32` | function | Writes token records and returns the token count.                                |
| `parser_action(state, terminal) -> i32`                        | function | Returns an encoded LR action.                                                    |
| `parser_goto(state, nonterminal) -> i32`                       | function | Returns a parser state, or `-1` when absent.                                     |
| `abi_version() -> i32`                                         | function | Returns the core ABI version.                                                    |
| `plan_version() -> i32`                                        | function | Returns the portable parser-plan version.                                        |
| `semantics_version() -> i32`                                   | function | Returns the runtime implementation semantics version.                            |
| `reset() -> void`                                              | function | Clears reusable core runtime state.                                              |
| `input_base() -> i32`                                          | function | Returns the first byte offset available for host input.                          |
| `max_pages() -> i32`                                           | function | Returns the configured maximum linear-memory page count.                         |
| `source_encoding() -> i32`                                     | function | Returns the source encoding enum.                                                |
| `span_unit() -> i32`                                           | function | Returns the public span unit enum.                                               |
| `lex_result_i32_count() -> i32`                                | function | Returns the width of a lexical result record.                                    |
| `token_record_i32_count() -> i32`                              | function | Returns the width of a token record.                                             |
| `host_ownership_model() -> i32`                                | function | Returns the input/result ownership enum.                                         |
| `result_lifetime_model() -> i32`                               | function | Returns the raw result lifetime enum.                                            |

All numeric parameters and results use WebAssembly `i32`. Linear-memory byte
offsets and lengths are non-negative 32-bit values. Multi-byte fields use
little-endian WebAssembly memory order and 4-byte alignment for `i32` records.

## Source And Spans

ABI version 1 uses source encoding enum value `1`, meaning UTF-16 code units.
The host writes the source into linear memory as contiguous unsigned 16-bit code
units. `sourceLength` is a count of UTF-16 code units, not bytes.

Span unit enum value `1` means public spans are UTF-16 code-unit offsets. This
matches JavaScript string indexing and the generated TypeScript target. Non-BMP
characters therefore occupy two units in public spans.

## Record Layouts

`lex_one` writes a lexical result record at `resultPtr`:

| Field       | Type  | Offset |
| ----------- | ----- | -----: |
| `specIndex` | `i32` |    `0` |
| `end`       | `i32` |    `4` |

`lex_all` writes token records at `tokenPtr`:

| Field       | Type  | Offset |
| ----------- | ----- | -----: |
| `specIndex` | `i32` |    `0` |
| `start`     | `i32` |    `4` |
| `end`       | `i32` |    `8` |

The descriptor exposes these widths as `core.layouts.lexResult.i32Count` and
`core.layouts.tokenRecord.i32Count`.

## Memory Ownership And Lifetime

Host ownership model enum value `1` means caller-managed linear memory buffers.
The host chooses writable input, result, and token-record offsets at or after
`input_base()`. The generated TypeScript adapter uses the instance memory,
copies JavaScript source text into UTF-16 memory, and allocates result buffers
after the source.

Result lifetime enum value `1` means low-level core results remain valid in the
caller-provided buffers until the host overwrites those buffers, calls
`reset()`, or grows memory. Memory growth invalidates existing JavaScript
typed-array and `DataView` objects; hosts must recreate views after any
operation that can call `memory.grow()`.

The generated adapter never intentionally retains a view across a possible
growth. `WasmSourceBuffer` and `ParseTraceInput` values are adapter-owned
JavaScript capabilities, not raw ABI handles. The adapter epoch-checks them:

- `WasmSourceBuffer` becomes stale after `reset()` or after `writeSource()` is
  called with a different source;
- `ParseTraceInput` becomes stale after `reset()`.

## Reset, Disposal, And Reentrancy

`reset()` clears reusable core runtime state and invalidates adapter-owned
handles. It does not promise to shrink linear memory; repeated parses may reuse
the previous high-water allocation.

ABI version 1 has instance-owned core memory. Generated adapters expose
`createParser()` and `createParserAsync()` as the public lifecycle API. Each
parser instance owns its `WebAssembly.Instance`, memory, source buffers, trace
runtime, reset epoch, configured limits, and disposed state. `reset()` on a
parser instance clears reusable state and invalidates that instance's
adapter-owned handles. `dispose()` invalidates the parser instance; subsequent
`lex()`, `parse()`, or token-stream calls on that instance throw from the
generated adapter.

Module-level `lex()`, `parse()`, `parseTokens()`, and `parseTokensUnchecked()`
are convenience wrappers over an active/default parser instance. Embedded
adapters create that default instance lazily. External-binary adapters can
create isolated instances with `createParser({ bytes })`,
`createParser({ module })`, `createParser({ wasm })`, or
`createParserAsync({ url })`.

Calls into one core instance are not specified as thread-safe or reentrant.
Hosts that need interleaved parsing should use separate parser instances. CI
coverage includes interleaved instances and concurrent JavaScript module workers
where the host permits workers.

## Limits And Overflow

ABI version 1 uses 65,536-byte WebAssembly pages and a configured maximum of
65,535 pages. Adapter-side offset arithmetic checks multiplication, addition,
alignment, and page-count growth against the 32-bit Wasm address space before
calling `memory.grow()`.

Parser branch and trace limits are part of the generated public parse API and
trace runtime contract:

- `PARSER_BRANCH_LIMIT` reports explored or queued branch exhaustion;
- `PARSER_TRACE_LIMIT` reports action-trace exhaustion.

The descriptor's `traceStatuses` table maps low-level trace status numbers to
the generated adapter constants.

## Error And Trap Policy

Expected parse failures are reported as structured parser diagnostics, whose
numeric low-level codes and public schemas are listed in `wasm/abi.json`.
Malformed adapter inputs, stale capabilities, uninitialized external modules,
and impossible memory requests throw JavaScript `TypeError`, `RangeError`, or
`Error` from the generated adapter.

The core module assumes the host respects pointer, length, alignment, and
capacity contracts. Direct core callers are responsible for validating their own
arguments before crossing the ABI boundary.

## Host Validation

Generated bundles are expected to validate the core module with
`WebAssembly.validate()` where available. Repository tests also validate with
independent tools when installed, including `wasm-tools validate` and a Wasmtime
low-level smoke test.
