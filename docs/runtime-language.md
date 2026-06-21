# Runtime Language Semantics

Baba's runtime language is private compiler infrastructure for standalone parser
runtimes. Its current executable subset is intentionally small: it exists to
make runtime semantics testable before the parser runtime is lowered through the
language.

## Version

- Runtime language version: `1`
- Semantics tag: `baba-runtime-language-v1`
- Compiler manifest format: `baba-runtime-language-compiler` version `1`

The runtime implementation metadata exported by generated parsers identifies the
checked-in runtime source family. Runtime-language versioning is separate from
the Baba package version, parser-plan version, parser-kit schema version, and
Wasm adapter ABI version.

`deno task bootstrap:check` verifies the Stage-0 runtime-language compiler
source hash before it checks regenerated example artifacts. This catches
compiler-source drift separately from the generated parser runtime identity.

The first runtime-language-backed parser helpers are used by generated
TypeScript lexers and parsers: `utf16CodePointWidth` advances over UTF-16 code
points, `dfaTransition` performs DFA transition lookup from generated read-only
tables, deterministic parsers use `parserAction`/`parserGoto` for parser table
lookup, and conflict parsers use generated `parserActionAt`/`parserGoto` helpers
for multi-action and goto lookup. The same runtime-language source shape is also
compiled to Wasm in conformance tests. Because generated parser runtime code
depends on runtime-language compiler output, the checked runtime implementation
manifest includes both runtime language sources and the Stage-0 compiler.

## Current Executable Subset

The Stage-0 runtime-language compiler accepts typed programs made of `u32`
functions with statement bodies. The current conformance subset supports:

- `u32` function parameters and locals;
- read-only `u32` tables;
- fixed-size zero-initialized `u32` scratch memory declared per program;
- `u32` constants;
- local reads and assignments;
- calls between `u32` functions;
- checked read-only table loads by constant or local index;
- checked scratch-memory loads and stores by computed `u32` index;
- `u32` addition, subtraction, and multiplication, wrapping modulo `2^32`;
- unsigned `u32` division, trapping on division by zero;
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
- Signed comparison interprets the same 32-bit value as two's-complement `i32`.
- Division by zero traps.
- Shift counts are masked with `count & 31`.
- Function bodies execute statements in source order.
- `return` exits the function immediately.
- Explicit `trap` aborts execution.
- Function results are currently `u32`.
- Parameters and locals are currently `u32`.
- Locals are initialized to zero before the first statement executes.
- Scratch memory is a fixed-size `u32` word array, initialized to zero when the
  emitted runtime artifact is instantiated, and persists between calls to
  runtime-language functions in that artifact.
- Function arguments evaluate left-to-right.
- Calls trap if the callee traps.
- Table loads trap on out-of-bounds indexes.
- Table load indexes are currently restricted to constants and locals; assign
  computed indexes to locals before loading.
- Scratch-memory loads and stores trap on out-of-bounds indexes.
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
that TypeScript and Wasm are mechanically emitted from one runtime-language
implementation.
