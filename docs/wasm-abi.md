# Baba Wasm ABI

Status: versioned lexer/island-runtime ABI for generated Wasm artifacts.

Baba emits a generic WebAssembly module, an external grammar plan, and a
TypeScript adapter. The Rust core owns DFA lexing, strict island analysis, and
compact cursor-tape materialization. The adapter owns public diagnostics, source
snapshots, and lazy cursor objects.

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
    "version": 5,
    "runtimeMetadataVersion": 6
  },
  "core": {
    "abiVersion": 14
  }
}
```

Core plan encoding version 9 stores the DFA lexer tables and an optional exact
strict-island section. Baba accepts only the current ABI, core plan, runtime
metadata, and parser-plan versions; regenerate older artifacts together.

## Core Exports

ABI version 14 exports:

| Export                               | Contract                                                |
| ------------------------------------ | ------------------------------------------------------- |
| `memory`                             | Instance-owned linear memory.                           |
| `lex_one`                            | Writes one lexical match result.                        |
| `lex_all`                            | Writes token records for a complete source.             |
| `lex_incremental`                    | Writes dependency-bearing token records for a range.    |
| `lex_memo_i32_per_position`          | Returns the optional lexer memo width.                  |
| `analyze_island_records`             | Validates raw records and reports exact tape counts.    |
| `materialize_island_records`         | Writes compact cursor tapes for valid raw records.      |
| `load_plan`                          | Loads and validates the external plan.                  |
| `abi_version`                        | Returns 14.                                             |
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
| `island_result_i32_count`            | Returns 10.                                             |
| `host_ownership_model`               | Returns the caller-managed ownership enum.              |
| `result_lifetime_model`              | Returns the caller-buffer lifetime enum.                |

The retired LR exports, including `parser_action`, `parser_goto`, `validate`,
and `parse_cursor`, remain absent. Island execution consumes the compact
strict-island plan instead of LR tables.

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

## Strict Island Runtime

The public generated TypeScript adapter retains `parse`, `validate`, and cursor
result shapes. Those operations require a compiler-proven GPU frontend plan with
`throughput: "strict"` and this narrower shape:

- exactly one repeated root island;
- a terminated repeated region;
- a terminal-only region transducer;
- dense start state zero;
- one to seven region states.

The adapter calls `lex_all`, leaves its raw records in core memory, and passes
them to `analyze_island_records`. Analysis filters trivia logically, partitions
terminated regions, executes the transition table, and reports structural,
region, and field counts without allocating output tapes. `validate()` ends
there. `parse()` allocates exact caller-owned tape ranges and calls
`materialize_island_records`, which replays valid transitions while emitting
rule, child, field, and value records. Only the completed tapes are copied out
so returned cursors survive later Wasm calls and memory growth.

A plan without strict GPU metadata remains usable through `lex`; `parse`,
`validate`, and parse/validate documents throw an explicit unsupported-plan
error. A strict plan that cannot meet the subset is rejected during generation
with a `WASM_ISLAND_*` diagnostic.

Both island exports return `1` on success. Analysis returns `0` for an
unexpected token, `-2` for a lexical error, `-3` for the parser-action limit,
and `-5` for trailing input. `-1` identifies an invalid plan or argument and
`-4` identifies insufficient materialization capacity. The ten-`i32` result
record contains token, rule, child, field, and value counts; the root reference;
the error record and state; and structural-token and region counts. Generated
`abi.json` records the exact field order and compact tape widths.

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
