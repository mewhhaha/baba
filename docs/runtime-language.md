# Runtime Language Semantics

Baba's runtime language is private compiler infrastructure for standalone parser
runtimes. Its current executable subset is intentionally small: it exists to
make runtime semantics testable while the parser runtime is being lowered
through the language.

## Version

- Runtime language version: `1`
- Semantics tag: `baba-runtime-language-v1`
- Compiler manifest format: `baba-runtime-language-compiler` version `1`
- Artifact manifest format: `baba-runtime-language-artifacts` version `1`

The runtime implementation metadata exported by generated parsers identifies the
checked-in runtime source family. Runtime-language versioning is separate from
the Baba package version, parser-plan version, parser-kit schema version, and
Wasm adapter ABI version.

`deno task bootstrap:check` verifies the Stage-0 runtime-language compiler
source hash before it checks regenerated example artifacts. This catches
compiler-source drift separately from the generated parser runtime identity. It
also recompiles canonical runtime-language helper programs to TypeScript and
Wasm and verifies checked source, TypeScript artifact, and Wasm artifact hashes.

The Stage-0 compiler lowers each validated runtime-language program once to a
resolved `RuntimeLanguageIrProgram` before emitting TypeScript or Wasm. That IR
records the entry function, function/table lookup maps, scratch-memory shape,
original typed source program, and lowered control-flow/value nodes with
resolved local, function, and table indexes. Target-specific byte/source
emission still happens in each backend; checked generated runtime artifacts
remain a future step before Baba can claim the full parser runtime is emitted
from one runtime-language implementation.

The first runtime-language-backed parser helpers are used by generated
TypeScript lexers and parsers: `utf16CodePointWidth` advances over UTF-16 code
points, `dfaTransition` performs DFA transition lookup from generated read-only
tables, and `lexerScan*` helpers track longest-match accepting candidates from
generated DFA accept tables. Deterministic parsers use `parserAction`/
`parserGoto` for parser table lookup, and conflict parsers use generated
`parserActionAt`/`parserGoto` helpers for multi-action and goto lookup.
Generated parsers also use `parserExpectedStart`/`parserExpectedEnd` helpers to
map parser states to flattened expected-terminal display ranges for diagnostics.
Reduction replay uses `parserProductionLhs`/`parserProductionRhsLength` helpers
for production metadata lookups while generated TypeScript still owns reducer
descriptor execution and CST construction. Generated parser action decoding uses
`parserActionKind`/`parserActionPayload` helpers, and `parserTrace` uses the
same helpers to classify encoded actions. The core Wasm parser trace uses the
same shared action kind/payload masks. Deterministic TypeScript parsers also use
a runtime-language `parserTrace` helper backed by growable scratch memory for LR
shift/reduce/accept control flow; TypeScript code still replays that trace to
build the CST. The same runtime-language source shape is also compiled to Wasm
in conformance tests. Because generated parser runtime code depends on
runtime-language compiler output, the checked runtime implementation manifest
includes both runtime language sources, the Stage-0 compiler, and the checked
runtime-language artifact manifest.

## Current Executable Subset

The Stage-0 runtime-language compiler accepts typed programs made of `u32`
functions with statement bodies. The current conformance subset supports:

- `u32` function parameters and locals;
- read-only `u32` tables;
- zero-initialized `u32` scratch memory declared per program with an initial
  size and explicit checked growth;
- `u32` constants;
- local reads and assignments;
- calls between `u32` functions;
- checked read-only table loads by constant or local index;
- checked scratch-memory growth, loads, and stores by computed `u32` index;
- `u32` addition, subtraction, and multiplication, wrapping modulo `2^32`;
- unsigned `u32` division, trapping on division by zero;
- bitwise AND;
- `u32` equality, producing `0` or `1`;
- signed less-than over the same 32-bit bits interpreted as `i32`;
- left shift and unsigned right shift with counts masked to five bits;
- structured `if`/`else` and `while`;
- explicit traps;
- early `return`.

TypeScript and Wasm backends compile the same typed program. Conformance tests
execute both outputs and compare returned values or traps.

## Semantic Rules

- Integer storage in the current subset is 32 bits.
- `u32` arithmetic wraps modulo `2^32`.
- Bitwise AND operates on the 32 stored bits and returns a `u32`.
- Signed comparison interprets the same 32-bit value as two's-complement `i32`.
- Division by zero traps.
- Shift counts are masked with `count & 31`.
- Function bodies execute statements in source order.
- `return` exits the function immediately.
- Explicit `trap` aborts execution.
- Function results are currently `u32`.
- Parameters and locals are currently `u32`.
- Locals are initialized to zero before the first statement executes.
- Scratch memory is a growable `u32` word array, initialized to the program's
  requested size when the emitted runtime artifact is instantiated, and persists
  between calls to runtime-language functions in that artifact.
- Function arguments evaluate left-to-right.
- Calls trap if the callee traps.
- Table loads trap on out-of-bounds indexes.
- Table load indexes are currently restricted to constants and locals; assign
  computed indexes to locals before loading.
- Scratch-memory growth traps if the requested capacity exceeds the Wasm-backed
  implementation limit.
- Scratch-memory loads and stores trap on indexes outside the current capacity.
- `if` and `while` conditions treat zero as false and any nonzero `u32` as true.

## Not Yet In The Executable Subset

These rules must be specified before the parser runtime can be fully lowered:

- records and record layout;
- growable arrays/vectors and ownership;
- text representation and Unicode iteration;
- allocation arenas and reset lifetime;
- structured errors versus traps for each runtime boundary;
- host-visible memory layout.

Until the parser runtime is lowered through this language, Baba does not claim
that the full TypeScript and Wasm parser runtimes are mechanically emitted from
one runtime-language implementation.
