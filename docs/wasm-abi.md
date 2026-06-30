# Baba Wasm ABI

Status: versioned core ABI for generated Wasm parser artifacts.

This document defines the contract between Baba's generated Wasm core module,
the generated JavaScript adapter, and non-JavaScript hosts that choose to call
the core module directly. The current target kind is
`javascript-hosted-core-wasm`: Baba emits a generic core WebAssembly module, an
external parser plan, plus a JavaScript adapter. It does not yet emit a Wasm
Component Model package, WIT bindings, WASI library, or browser-only package.

Generated Wasm bundles also include `wasm/abi.json` and `wasm/parser.plan`.
Hosts should treat the JSON file as the machine-readable descriptor for the
generic core ABI. Grammar-specific runtime data lives in `parser.plan`.

## Versioning

The generated descriptor has:

```json
{
  "format": "baba-wasm-abi",
  "version": 1
}
```

The core module exports `load_plan(planPtr, planLength) -> i32`,
`abi_version() -> i32`, `plan_version() -> i32`, and
`semantics_version() -> i32`. For ABI version 3, the generated adapter writes
`parser.plan` into linear memory, calls `load_plan`, and then checks that the
descriptor and core exports agree before the adapter uses the module.

The descriptor also records:

- `parserPlan.format`, `parserPlan.version`, `parserPlan.semantics`, and the
  external storage layout;
- `runtimeImplementation.format`, `runtimeImplementation.version`,
  `runtimeImplementation.semantics`, and `runtimeImplementation.hash`;
- the numeric parser diagnostic code table and diagnostic detail schemas.

## Core Exports

ABI version 3 core modules export:

| Export                                                              | Kind     | Contract                                                                         |
| ------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `memory`                                                            | memory   | Linear memory owned by the instance.                                             |
| `lex_one(sourcePtr, sourceLength, offset, resultPtr) -> i32`        | function | Writes one lexical result and returns `1`, or returns `0` when no token matches. |
| `lex_all(sourcePtr, sourceLength, resultPtr, tokenPtr) -> i32`      | function | Writes token records and returns the token count.                                |
| `parser_action(state, terminal) -> i32`                             | function | Returns the first encoded LR action for deterministic callers.                   |
| `parser_actions(state, terminal, actionPtr, actionCapacity) -> i32` | function | Writes all encoded LR actions for a state/terminal pair and returns their count. |
| `parser_goto(state, nonterminal) -> i32`                            | function | Returns a parser state, or `-1` when absent.                                     |
| `load_plan(planPtr, planLength) -> i32`                             | function | Loads the external parser plan and returns `1` when accepted.                    |
| `abi_version() -> i32`                                              | function | Returns the core ABI version.                                                    |
| `plan_version() -> i32`                                             | function | Returns the loaded portable parser-plan version, or `0` before `load_plan`.      |
| `semantics_version() -> i32`                                        | function | Returns the runtime implementation semantics version.                            |
| `reset() -> void`                                                   | function | Clears reusable core runtime state.                                              |
| `input_base() -> i32`                                               | function | Returns the first byte offset available for host input.                          |
| `max_pages() -> i32`                                                | function | Returns the configured maximum linear-memory page count.                         |
| `source_encoding() -> i32`                                          | function | Returns the source encoding enum.                                                |
| `span_unit() -> i32`                                                | function | Returns the public span unit enum.                                               |
| `lex_result_i32_count() -> i32`                                     | function | Returns the width of a lexical result record.                                    |
| `token_record_i32_count() -> i32`                                   | function | Returns the width of a token record.                                             |
| `host_ownership_model() -> i32`                                     | function | Returns the input/result ownership enum.                                         |
| `result_lifetime_model() -> i32`                                    | function | Returns the raw result lifetime enum.                                            |

All numeric parameters and results use WebAssembly `i32`. Linear-memory byte
offsets and lengths are non-negative 32-bit values. Multi-byte fields use
little-endian WebAssembly memory order and 4-byte alignment for `i32` records.

## External Plan

ABI version 3 keeps grammar-specific DFA and LR table data outside
`parser.wasm`. The generated `parser.plan` starts with the core table section
expected by `load_plan`, followed by shared runtime metadata used by the
TypeScript adapter. The host writes `parser.plan` bytes into linear memory at
offset `0` and calls `load_plan(0, planLength)`. The adapter treats any result
other than `1` as an invalid plan. After a successful load, `input_base()`
returns the first byte offset after the core table section, aligned for
caller-managed input.

The descriptor exposes plan metadata under `core.plan`, including the plan
storage mode, the `load_plan` export name, the generated `parser.plan` path, and
the combined plan layout.

## Source And Spans

ABI version 3 uses source encoding enum value `1`, meaning UTF-16 code units.
The host writes the source into linear memory as contiguous unsigned 16-bit code
units. `sourceLength` is a count of UTF-16 code units, not bytes.

Span unit enum value `1` means public spans are UTF-16 code-unit offsets. This
matches JavaScript string indexing and the generated Wasm adapter. Non-BMP
characters therefore occupy two units in public spans.

## Record Layouts

`lex_one` writes a lexical result record at `resultPtr`:

| Field       | Type  | Offset |
| ----------- | ----- | -----: |
| `specIndex` | `i32` |    `0` |
| `end`       | `i32` |    `4` |

`lex_all` writes token records at `tokenPtr`:

| Field            | Type  | Offset |
| ---------------- | ----- | -----: |
| `specIndex`      | `i32` |    `0` |
| `start`          | `i32` |    `4` |
| `end`            | `i32` |    `8` |
| `acceptingState` | `i32` |   `12` |

The descriptor exposes these widths as `core.layouts.lexResult.i32Count` and
`core.layouts.tokenRecord.i32Count`.

## Memory Ownership And Lifetime

Host ownership model enum value `1` means caller-managed linear memory buffers.
The host chooses writable input, result, and token-record offsets at or after
`input_base()`. Since `parser.plan` is loaded at the start of memory,
`input_base()` is only stable after `load_plan` succeeds. The generated
TypeScript adapter uses the instance memory, copies JavaScript source text into
UTF-16 memory, and allocates result buffers after the source.

Result lifetime enum value `1` means low-level core results remain valid in the
caller-provided buffers until the host overwrites those buffers, calls
`reset()`, or grows memory. Memory growth invalidates existing JavaScript
typed-array and `DataView` objects; hosts must recreate views after any
operation that can call `memory.grow()`.

The generated adapter never intentionally retains a view across a possible
growth.

## Reset, Disposal, And Reentrancy

`reset()` clears reusable core runtime state and invalidates adapter-owned
handles. It does not promise to shrink linear memory; repeated parses may reuse
the previous high-water allocation.

ABI version 3 has instance-owned core memory. Generated adapters expose
`createParser()` and `createParserAsync()` as the public lifecycle API. Each
parser instance owns its `WebAssembly.Instance`, memory, loaded plan, shared
runtime parser, and disposed state. `reset()` on a parser instance clears
reusable core state. `dispose()` invalidates the parser instance; subsequent
`lex()`, `parse()`, or token-stream calls on that instance throw from the shared
adapter.

Generated adapters create isolated instances with
`createParser({ bytes, plan })`, `createParser({ module, plan })`, or
`createParserAsync({ url, planUrl })`.

Calls into one core instance are not specified as thread-safe or reentrant.
Hosts that need interleaved parsing should use separate parser instances. CI
coverage includes interleaved instances and concurrent JavaScript module workers
where the host permits workers.

## Limits And Overflow

ABI version 3 uses 65,536-byte WebAssembly pages and a configured maximum of
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
`WebAssembly.validate()` where available, then load and validate `parser.plan`
before use. Repository tests also validate with independent tools when
installed, including `wasm-tools validate` and a Wasmtime low-level smoke test.
