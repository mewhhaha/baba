# Baba Wasm ABI

Status: versioned lexer-core ABI for generated Wasm artifacts.

Baba emits a generic lexer WebAssembly module, an external grammar plan, and a
TypeScript adapter. The core module deliberately has no parser state machine.
The adapter provides strict island parsing with the separately embedded shared
SIMD runtime.

Generated bundles include `wasm/abi.json`, `wasm/parser.wasm`, and
`wasm/parser.plan`. Direct non-JavaScript hosts should treat `abi.json` as the
machine-readable contract and must not infer layouts from Baba's Rust sources.

## Versions

The current contract is:

```json
{
  "format": "baba-wasm-abi",
  "version": 1,
  "parserPlan": {
    "version": 3,
    "runtimeMetadataVersion": 5
  },
  "core": {
    "abiVersion": 13
  }
}
```

Core plan encoding version 8 stores the DFA lexer tables. The retired LR header
slots must be zero. Baba accepts only the current ABI, core plan, runtime
metadata, and parser-plan versions; regenerate older artifacts together.

## Core Exports

ABI version 13 exports:

| Export                               | Contract                                                |
| ------------------------------------ | ------------------------------------------------------- |
| `memory`                             | Instance-owned linear memory.                           |
| `lex_one`                            | Writes one lexical match result.                        |
| `lex_all`                            | Writes token records for a complete source.             |
| `lex_incremental`                    | Writes dependency-bearing token records for a range.    |
| `lex_memo_i32_per_position`          | Returns the optional lexer memo width.                  |
| `load_plan`                          | Loads and validates the external plan.                  |
| `abi_version`                        | Returns 13.                                             |
| `plan_version`                       | Returns the loaded parser-plan version.                 |
| `semantics_version`                  | Returns the runtime semantics version.                  |
| `reset`                              | Clears reusable lexer state.                            |
| `plan_buffer_base`                   | Returns the first safe plan offset.                     |
| `input_base`                         | Returns the first safe input offset after plan loading. |
| `max_pages`                          | Returns the configured memory-page limit.               |
| `source_encoding`                    | Returns the UTF-16 encoding enum.                       |
| `span_unit`                          | Returns the UTF-16 span enum.                           |
| `lex_result_i32_count`               | Returns 2.                                              |
| `token_record_i32_count`             | Returns 4.                                              |
| `incremental_token_record_i32_count` | Returns 5.                                              |
| `host_ownership_model`               | Returns the caller-managed ownership enum.              |
| `result_lifetime_model`              | Returns the caller-buffer lifetime enum.                |

The LR exports from ABI 12, including `parser_action`, `parser_goto`,
`validate`, and `parse_cursor`, do not exist in ABI 13.

## Source And Records

Sources and public spans use UTF-16 code units. Non-BMP characters therefore
occupy two source units.

`lex_one` writes two `i32` values:

| Field       | Offset |
| ----------- | -----: |
| `specIndex` |      0 |
| `end`       |      4 |

`lex_all` writes four-`i32` token records:

| Field            | Offset |
| ---------------- | -----: |
| `specIndex`      |      0 |
| `start`          |      4 |
| `end`            |      8 |
| `acceptingState` |     12 |

`lex_incremental` appends `dependencyEnd` at byte offset 16. A host invalidates
a record when an edit touches `[start, dependencyEnd]`, because insertion at
either boundary may affect maximal munch or a trailing contextual guard.

`tokenCapacity` counts records and must be at least `sourceLength`, the
one-error-record-per-code-unit worst case. `lex_all` returns `-1` when the token
capacity is short and writes nothing beyond the records it returns.

The failure memo is demand-driven. Call with `memoPtr = 0` and
`memoCapacity = 0`. If scanning crosses the activation threshold, the lexer
returns `-2`; allocate `(sourceLength + 1) * lex_memo_i32_per_position()` `i32`
values and retry. Memo contents are private and do not survive a call.

## Strict Parser Adapter

The public generated TypeScript adapter retains `parse`, `validate`, and cursor
result shapes. Those operations require a compiler-proven GPU frontend plan with
`throughput: "strict"` and this narrower shape:

- exactly one repeated root island;
- a terminated repeated region;
- a terminal-only region transducer;
- dense start state zero;
- one to seven region states.

The adapter lexes with the core module, partitions records at the terminating
terminal, validates each region with the shared `simd128` island module, and
materializes the root and region cursor tapes. A plan without strict GPU
metadata remains usable through `lex`; `parse`, `validate`, and parse/validate
documents throw an explicit unsupported-plan error. A strict plan that cannot
meet the subset is rejected during generation with a `WASM_ISLAND_*` diagnostic.

`maxParserActions` now bounds island transitions. Incremental documents retain
their public result and work-counter shapes, but parsing reparses the complete
structural token stream and reports zero LR checkpoints because LR checkpoints
no longer exist.

## Ownership, Lifetime, And Errors

The host owns input and result buffers at or after `input_base()`. Low-level
results remain valid until overwritten, `reset()` is called, or memory grows.
Recreate JavaScript views after `memory.grow()`.

Each generated parser owns one `WebAssembly.Instance`, loaded plan, source
buffers, and disposal lifecycle. Instances are isolated, not reentrant. Use
separate instances for concurrent calls.

Malformed low-level arguments may trap or return failure as documented by the
export. The TypeScript adapter converts expected lexical and strict-island
failures into structured diagnostics, including `PARSE_LEXICAL_ERROR`,
`PARSE_UNEXPECTED_TOKEN`, `PARSER_TRACE_LIMIT`, and `PARSER_INPUT_TOO_LARGE`.
