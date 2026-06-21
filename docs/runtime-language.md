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

The first runtime-language-backed parser helper is `utf16CodePointWidth`, used
by generated TypeScript lexers to advance over UTF-16 code points. The same
runtime-language source is also compiled to Wasm in conformance tests.

## Current Executable Subset

The Stage-0 runtime-language compiler accepts typed programs made of `u32`
functions with statement bodies. The current conformance subset supports:

- `u32` function parameters and locals;
- `u32` constants;
- local reads and assignments;
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
- `if` and `while` conditions treat zero as false and any nonzero `u32` as true.

## Not Yet In The Executable Subset

These rules must be specified before the parser runtime can be fully lowered:

- records and record layout;
- arrays/vectors, growth, bounds checks, and ownership;
- text representation and Unicode iteration;
- allocation arenas and reset lifetime;
- structured errors versus traps for each runtime boundary;
- host-visible memory layout.

Until the parser runtime is lowered through this language, Baba does not claim
that TypeScript and Wasm are mechanically emitted from one runtime-language
implementation.
