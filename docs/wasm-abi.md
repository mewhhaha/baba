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
generic core ABI. Grammar-specific runtime data lives in `parser.plan`. The
generic core module is built ahead of time from Baba's `no_std` Rust engine
source and embedded in the package; the ABI is the compatibility contract, not
the Rust source layout.

## Versioning

The generated descriptor has:

```json
{
  "format": "baba-wasm-abi",
  "version": 1,
  "parserPlan": {
    "version": 1,
    "runtimeMetadataVersion": 2
  },
  "core": {
    "abiVersion": 8
  }
}
```

The core module exports `load_plan(planPtr, planLength) -> i32`,
`plan_buffer_base() -> i32`, `input_base() -> i32`, `abi_version() -> i32`,
`plan_version() -> i32`, and `semantics_version() -> i32`. For ABI version 8,
the generated adapter writes `parser.plan` into linear memory at or after
`plan_buffer_base()`, calls `load_plan`, and then checks that the descriptor and
core exports agree before the adapter uses the module.

The descriptor also records:

- `parserPlan.format`, `parserPlan.version`,
  `parserPlan.runtimeMetadataVersion`, `parserPlan.semantics`, and the external
  storage layout;
- `runtimeImplementation.format`, `runtimeImplementation.version`,
  `runtimeImplementation.semantics`, and `runtimeImplementation.hash`;
- the numeric parser diagnostic code table and diagnostic detail schemas.

## Core Exports

ABI version 8 core modules export:

| Export                   | Kind     | Contract                                                                         |
| ------------------------ | -------- | -------------------------------------------------------------------------------- |
| `memory`                 | memory   | Linear memory owned by the instance.                                             |
| `lex_one`                | function | Writes one lexical result and returns `1`, or returns `0` when no token matches. |
| `lex_all`                | function | Writes token records and returns the token count.                                |
| `parser_action`          | function | Returns the first encoded LR action for deterministic callers.                   |
| `parser_actions`         | function | Writes all encoded LR actions for a state/terminal pair and returns their count. |
| `parser_select_action`   | function | Selects an unguarded contextual token/action pair for a parser state.            |
| `parse_trace`            | function | Parses to an action trace for validation and cursor replay.                      |
| `parse_cursor`           | function | Parses directly into cursor tapes.                                               |
| `parser_goto`            | function | Returns a parser state, or `-1` when absent.                                     |
| `load_plan`              | function | Loads the external parser plan and returns `1` when accepted.                    |
| `abi_version`            | function | Returns the core ABI version.                                                    |
| `plan_version`           | function | Returns the loaded portable parser-plan version, or `0` before `load_plan`.      |
| `semantics_version`      | function | Returns the runtime implementation semantics version.                            |
| `reset`                  | function | Clears reusable core runtime state.                                              |
| `plan_buffer_base`       | function | Returns the first implementation-safe offset where the host may copy the plan.   |
| `input_base`             | function | Returns the first byte offset available for host input.                          |
| `max_pages`              | function | Returns the configured maximum linear-memory page count.                         |
| `source_encoding`        | function | Returns the source encoding enum.                                                |
| `span_unit`              | function | Returns the public span unit enum.                                               |
| `lex_result_i32_count`   | function | Returns the width of a lexical result record.                                    |
| `token_record_i32_count` | function | Returns the width of a token record.                                             |
| `host_ownership_model`   | function | Returns the input/result ownership enum.                                         |
| `result_lifetime_model`  | function | Returns the raw result lifetime enum.                                            |

`parser_select_action` has no source pointer, so it does not select tokens with
trailing guards. `parse_trace` and `parse_cursor` evaluate those guards against
the source text.

All numeric parameters and results use WebAssembly `i32`. Linear-memory byte
offsets and lengths are non-negative 32-bit values. Multi-byte fields use
little-endian WebAssembly memory order and 4-byte alignment for `i32` records.
The generated `wasm/abi.json` descriptor records the exact parameter lists for
each exported function.

## External Plan

ABI version 8 keeps grammar-specific DFA and LR table data outside
`parser.wasm`. The generated `parser.plan` starts with the core table section
expected by `load_plan`, followed by shared runtime metadata used by the
TypeScript adapter. The host calls `plan_buffer_base()`, writes `parser.plan`
bytes at that nonzero offset, and calls `load_plan(planPtr, planLength)`. The
adapter treats any result other than `1` as an invalid plan. After a successful
load, `input_base()` returns the first byte offset after the loaded core table
section, aligned for caller-managed input.

The current core table section uses format version 3. It keeps section offsets
in the header and may store dense DFA/LR helper sections as compact `i16` or
`u16` cells when all generated values fit. This compact encoding is an internal
core-plan detail; hosts should validate the plan with `wasm/abi.json` and
`load_plan` rather than decoding those tables directly.

The runtime metadata subsection is independently versioned and currently uses
version `2`. It contains only runtime identity, trivia and conflict policy, rule
names, token/literal mappings, lexer specifications and accept candidates,
terminal displays, and cursor field schemas. DFA transitions, LR actions and
gotos, productions, reducers, and planning statistics are not duplicated in host
metadata. Baba 5 rejects metadata version `1` with an instruction to regenerate
the plan.

The descriptor exposes plan metadata under `core.plan`, including the plan
storage mode, the `load_plan` export name, the generated `parser.plan` path, and
the combined plan layout.

## Source And Spans

ABI version 8 uses source encoding enum value `1`, meaning UTF-16 code units.
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

`lex_all(sourcePtr, sourceLength, mode, tokenPtr)` writes token records at
`tokenPtr`. The current mode value is `0`.

| Field            | Type  | Offset |
| ---------------- | ----- | -----: |
| `specIndex`      | `i32` |    `0` |
| `start`          | `i32` |    `4` |
| `end`            | `i32` |    `8` |
| `acceptingState` | `i32` |   `12` |

`parse_trace` writes a trace result record at `resultPtr`:

| Field              | Type  | Offset |
| ------------------ | ----- | -----: |
| `tokenRecordCount` | `i32` |    `0` |
| `traceActionCount` | `i32` |    `4` |
| `errorOffset`      | `i32` |    `8` |
| `errorState`       | `i32` |   `12` |
| `tokenReadCount`   | `i32` |   `16` |
| `reserved`         | `i32` |   `20` |

`parse_cursor` writes a cursor result record at `resultPtr`:

| Field              | Type  | Offset |
| ------------------ | ----- | -----: |
| `tokenRecordCount` | `i32` |    `0` |
| `ruleRecordCount`  | `i32` |    `4` |
| `childRefCount`    | `i32` |    `8` |
| `fieldRecordCount` | `i32` |   `12` |
| `valueRecordCount` | `i32` |   `16` |
| `valueItemCount`   | `i32` |   `20` |
| `rootRef`          | `i32` |   `24` |
| `errorOffset`      | `i32` |   `28` |
| `errorState`       | `i32` |   `32` |
| `tokenReadCount`   | `i32` |   `36` |

Cursor rule records contain rule id, source span, token range, the head of the
rule's child-edge list plus its length, and its field slice. Cursor field
records contain field id and value id. Cursor value records encode null, element
references, and arrays.

Child edges and array items are singly linked node arenas, not contiguous
slices. `childRefCount` and `valueItemCount` in the cursor result record are
node watermarks for those arenas, not the length of any one list.

Cursor child records:

| Field       | Type  | Offset | Meaning                                  |
| ----------- | ----- | -----: | ---------------------------------------- |
| `reference` | `i32` |    `0` | Child rule or token reference.           |
| `nextNode`  | `i32` |    `4` | Next node index, or `-1` at a list tail. |

Cursor value-item records:

| Field      | Type  | Offset | Meaning                                  |
| ---------- | ----- | -----: | ---------------------------------------- |
| `valueId`  | `i32` |    `0` | Value record index of the array element. |
| `nextNode` | `i32` |    `4` | Next node index, or `-1` at a list tail. |

A rule reads its children by walking `childCount` nodes from `childHead`. An
array value reads its items by walking `itemCount` nodes from `itemHead`. Lists
may share a suffix of nodes with a list captured earlier; a reader that walks
exactly `count` nodes never observes the difference. This representation is what
makes appending to a repetition accumulator constant time instead of copying the
whole accumulated list on every element.

The descriptor exposes these widths under `core.layouts`, including `lexResult`,
`tokenRecord`, `parseTraceResult`, `parseCursorResult`, `cursorRuleRecord`,
`cursorFieldRecord`, `cursorValueRecord`, `cursorChildRecord`, and
`cursorValueItemRecord`.

## Memory Ownership And Lifetime

Host ownership model enum value `1` means caller-managed linear memory buffers.
The host chooses writable input, result, and token-record offsets at or after
`input_base()`. `input_base()` is only stable after `load_plan` succeeds. The
generated TypeScript adapter uses the instance memory, copies JavaScript source
text into UTF-16 memory, and allocates result buffers after the source.

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

ABI version 8 has instance-owned core memory. Generated adapters expose
`createParser()` and `createParserAsync()` as the public lifecycle API. Each
parser instance owns its `WebAssembly.Instance`, memory, loaded plan, and
disposed state. `reset()` on a parser instance clears reusable core state.
`dispose()` invalidates the parser instance; subsequent `lex()`, `parse()`, or
`validate()` calls on that instance throw from the shared adapter.

Generated adapters create isolated instances with
`createParser({ bytes, plan })`, `createParser({ module, plan })`, or
`createParserAsync({ url, planUrl })`.

Calls into one core instance are not specified as thread-safe or reentrant.
Hosts that need interleaved parsing should use separate parser instances. CI
coverage includes interleaved instances and concurrent JavaScript module workers
where the host permits workers.

## Limits And Overflow

ABI version 8 uses 65,536-byte WebAssembly pages and a configured maximum of
65,535 pages. Adapter-side offset arithmetic checks multiplication, addition,
alignment, and page-count growth against the 32-bit Wasm address space before
calling `memory.grow()`.

The generated public parse API exposes `maxTraceActions`. `PARSER_TRACE_LIMIT`
reports action-trace exhaustion. Branch-limit numeric IDs remain reserved
internally but are not part of the source-only generated API.

An input whose buffers cannot fit in the 65,535-page address space is reported
as the structured `PARSER_INPUT_TOO_LARGE` diagnostic, naming the requested byte
count, the limit, and the source size. It is not thrown. See `docs/limits.md`.

The descriptor's `traceStatuses` table maps low-level trace status numbers to
the generated adapter constants.

## Error And Trap Policy

Expected parse failures are reported as structured parser diagnostics, whose
numeric low-level codes and public schemas are listed in `wasm/abi.json`.
Malformed adapter inputs, stale capabilities, and uninitialized external modules
throw JavaScript `TypeError`, `RangeError`, or `Error` from the generated
adapter. An input too large for the address space is a structured diagnostic,
not a throw.

The core module assumes the host respects pointer, length, alignment, and
capacity contracts. Direct core callers are responsible for validating their own
arguments before crossing the ABI boundary.

## Host Validation

Generated bundles are expected to validate the core module with
`WebAssembly.validate()` where available, then load and validate `parser.plan`
before use. Repository tests also validate with independent tools when
installed, including `wasm-tools validate` and a Wasmtime low-level smoke test.
