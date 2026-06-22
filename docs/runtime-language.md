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
generated DFA accept tables. `lexerSpecTokenClass`/`lexerSpecPayload`/
`lexerSpecTerminal` map accepted lexer spec indexes to token object
classification data and parser terminal ids for generated TypeScript
`parse(source)`, while `lexerSpecFlags` remains the lower-level table helper.
External token streams keep public token-kind/literal spelling at the API
boundary, but generated parsers map those spellings to lexer spec indexes and
use the same runtime-language helpers for channel and terminal classification.
`lexerSpecPublicTokenStatus` decides whether a mapped public literal/main/trivia
token is compatible with the spec row; TypeScript still validates object
shape/text/spans and emits public diagnostics. `lexerTokenDiagnosticStatus`
classifies external tokens as diagnostically accepted, lexical error tokens, or
not in the parser terminal set before TypeScript allocates the public diagnostic
object. Deterministic parsers use `parserAction`/`parserGoto` for parser table
lookup, and conflict parsers use generated
`parserActionAt`/`parserActionCount`/`parserGoto` helpers for multi-action
fan-out and goto lookup. Generated parsers also use `parserExpectedStart`/
`parserExpectedEnd` helpers to map parser states to flattened expected-terminal
display ranges for diagnostics, and `parserExpectedHasEof` flags choose
trailing-input diagnostic codes without scanning display strings. Reduction
replay uses `parserProductionLhs`/`parserProductionRhsLength` helpers for
production metadata lookups while generated TypeScript still owns reducer
descriptor execution and CST construction. Generated parser replay now gets
reducer descriptor kind/payload metadata from
`parserReducerKind`/`parserReducerPayload` helpers, reducer operation classes
from `parserReducerOperation`, and required payload status from
`parserReducerPayloadStatus`, plus child-role requirements from
`parserReducerChildRole`; reducer result-shape classification comes from
`parserReducerResultKind`, all backed by numeric reducer tables. CST field
assembly now reads field row/config metadata through
`parserFieldStart`/`parserFieldEnd`/`parserFieldId`/
`parserFieldFlags`/`parserFieldIndex` helpers. JavaScript still materializes the
public CST object shape, but replay now carries runtime-language parser object
handles and calls runtime-language fragment helpers while reducing raw child,
rule-node, token-fragment, sequence, empty, append, separated-append,
first-array, and field-capture results. Public field assembly iterates the
runtime-language rule-node field vector, reads runtime field-capture records,
and resolves captured host values through the runtime fragment handle map.
Public child assembly similarly iterates the runtime-language rule-node child
vector and resolves runtime token/rule-node handles through the per-replay
syntax handle map. Field value-class/count validation now uses
`parserFieldValueClass`/`parserFieldCaptureStatus`/`parserFieldFinalStatus`
helpers, replay reduction validity uses `parserReplayReductionStatus`, and
span/token-range merge arithmetic uses `parserMergeStart`/`parserMergeEnd`
helpers. Generated parser action decoding uses
`parserActionKind`/`parserActionPayload` helpers, and `parserTrace` uses the
same helpers to classify encoded actions. `parserReplayActionStatus` classifies
shift/reduce/accept/unknown action kinds before generated TypeScript replay
dispatches the accepted trace. `parserTraceStatusKind` classifies parser trace
status values for generated TypeScript parsers and Wasm adapters before those
hosts allocate public diagnostics. Public parse diagnostics now allocate
runtime-language diagnostic records first, read span data back through
`parserDiagnosticSpanStart`/`parserDiagnosticSpanEnd`, and then materialize the
public JavaScript diagnostic object at the API boundary. Deterministic
TypeScript parsers use a runtime-language `parserTrace` helper whose parser
state stack and accepted-action trace are stored in arena-backed growable
vectors for LR shift/reduce/accept control flow. Declared-conflict TypeScript
parsers use a runtime-language conflict `parserTrace` helper whose active stack,
accepted action trace, and saved branch snapshots are stored as arena-backed
growable vectors before TypeScript replays the accepted action trace to build
the CST. The core Wasm parser trace uses the same shared action kind/payload
masks, and generated Wasm adapters now instantiate a runtime-language Wasm
parser trace module for LR control flow, trace status classification, and trace
action reads. The core Wasm module still owns lexing and low-level parser table
lookup exports, but it no longer emits a separate `parse_trace` LR execution
function. The same runtime-language source shapes are also compiled to Wasm in
conformance tests. Because generated parser runtime code depends on
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
- tagged arena-backed `u32` arrays, fixed records, and growable vectors
  represented as scratch-memory handles with resettable allocation lifetime;
- arena-backed parser fragment, field-capture, rule-node, token, and diagnostic
  layout helpers for the first host-visible CST/token/diagnostic object
  substrate;
- arena-backed parser fragment assembly helpers for empty fragments, sequence
  fragments, first-array wrapping, list append, separated-list append, child and
  field vector copying, and span/token-range merging, now used by generated
  TypeScript parser replay and generated Wasm adapter replay as the runtime
  handle substrate for public CST materialization;
- `u32` addition, subtraction, and multiplication, wrapping modulo `2^32`;
- unsigned `u32` division, trapping on division by zero;
- bitwise AND;
- `u32` equality, producing `0` or `1`;
- unsigned less-than over `u32` values, producing `0` or `1`;
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
- Unsigned comparison interprets both operands as `u32`.
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
- `runtimeArenaReset()` resets the arena cursor to word `1`; word `0` stores the
  next free arena word.
- `runtimeArenaAlloc(words)` returns the previous cursor, advances by `words`,
  traps on `u32` overflow, and grows scratch memory before publishing the new
  cursor.
- Arena-backed heap objects start with a kind word. Array objects store a length
  word followed by `u32` element words. Record objects store a tag word, field
  count word, and fixed `u32` field words. Vector objects store length,
  capacity, and backing array handle words. New array elements and record fields
  are initialized to zero.
- Vector append grows capacity from `0` to `1`, then doubles capacity, copying
  existing elements into a new arena-backed array before storing the appended
  value and advancing length.
- Vector truncation can shorten length without clearing the discarded backing
  elements; attempting to truncate to a longer length traps.
- Arena-backed array, record, and vector helpers trap for handle `0`, stale or
  out-of-range handles, wrong object kind, out-of-bounds indexes, and offset
  overflow. Handles are currently raw arena offsets with checked object-kind
  tags, not opaque capabilities with full provenance.
- Parser fragment objects store a value handle/id, span start/end, token-range
  start/end, and child/field vector handles. Parser field-capture objects store
  a field id and value handle/id. Parser rule-node objects store a rule id,
  span, token range, and child/field vector handles copied from a fragment.
  Parser token objects store class, payload, terminal, and span data; parser
  diagnostic objects store code, span, and detail data.
- Parser fragment, field-capture, rule-node, token, and diagnostic helpers trap
  for wrong object kind and delegate vector bounds checks to the arena-backed
  vector helpers.
- Parser fragment assembly helpers represent reducer list values as arena
  vectors and preserve child/field vectors plus span/token-range extents across
  sequence, append, and separated-append operations.
- Generated parser replay may wrap host tokens, fragments, and rule nodes with
  runtime-language parser object handles during reduction, then read spans and
  token ranges back from those handles before constructing public JavaScript CST
  objects.
- Generated public field assembly consumes runtime field-capture vectors and
  resolves host values through a per-replay runtime fragment handle map; it no
  longer carries an independent JavaScript field-capture list.
- Generated public child assembly consumes runtime rule-node child vectors and
  resolves runtime token/rule-node handles through a per-replay syntax handle
  map; it no longer carries an independent JavaScript fragment child list.
- Generated public parse diagnostics allocate runtime diagnostic records and
  read span data back from those records before materializing public JavaScript
  diagnostic objects.
- `if` and `while` conditions treat zero as false and any nonzero `u32` as true.

## Not Yet In The Executable Subset

These rules must be specified before the parser runtime can be fully lowered:

- ownership and opaque typed handle provenance;
- text representation and Unicode iteration;
- structured errors versus traps for each runtime boundary;
- complete generated-parser lowering for public CST field objects/arrays plus
  host-visible token object emission.

Until the parser runtime is lowered through this language, Baba does not claim
that the full TypeScript and Wasm parser runtimes are mechanically emitted from
one runtime-language implementation.
