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
Standalone TypeScript lexers and generated Wasm JavaScript adapters allocate
runtime-language token records for matched literals, named tokens, preserved
trivia, lexical error tokens, and EOF tokens, then read class, payload,
terminal, and span data back through `parserToken*` accessors before wrapping
public API token objects through one shared runtime-target materializer helper.
The generated materializer stores the parser-terminal hint as a non-enumerable
`__babaTerminal` property on main and literal public tokens. That hint is
plan-local provenance for generated parser fast paths, not a public token API,
and consumers should not serialize, mutate, or reuse it across parser plans.
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
public JavaScript diagnostic object at the API boundary. Generated TypeScript
parsers and generated Wasm adapters allocate parse success/failure results
through one shared runtime-target parse-result materializer, keeping the public
discriminated union object shape centralized at the host boundary. Deterministic
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
- Runtime-language programs do not yet have first-class text values. Generated
  standalone parser runtimes treat source text as an immutable UTF-16 code-unit
  sequence at the host boundary, matching JavaScript `string` indexing.
- Generated JavaScript-hosted Wasm adapters treat `WasmSourceBuffer` values
  returned by `writeSource()` as adapter-owned source capabilities. The adapter
  tracks those buffers by object provenance and input epoch, rejects forged
  plain objects, and invalidates previous buffers when `reset()` runs or when
  `writeSource()` installs a different source into the shared Wasm input area.
- Generated JavaScript-hosted Wasm adapters treat `ParseTraceInput` values
  returned by `createParseTraceInput()` as adapter-owned parser-trace
  capabilities. The adapter rejects forged plain objects and invalidates
  previous trace inputs when `reset()` reinstantiates the parser trace runtime.
- Public token, CST, and diagnostic spans are half-open UTF-16 code-unit
  offsets. CRLF is two code units, NUL is one code unit, U+2028 and U+2029 are
  one code unit each, and astral code points occupy two code units when encoded
  as surrogate pairs.
- `utf16CodePointWidth(codePoint)` returns `1` for code point values below
  `0x10000` and `2` otherwise. Isolated surrogate code units are treated as BMP
  values and advance by one code unit, matching JavaScript `codePointAt()`
  behavior on ill-formed UTF-16 strings.
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
- `runtimeExpectObjectKind(handle, expectedKind)` is the shared in-runtime
  provenance gate for arena-backed handles. It validates that a handle is live
  in the current arena and belongs to the expected object kind before returning
  the original handle; array, record, vector, parser object, and parser
  field-capture accessors use this gate instead of open-coded kind checks.
- Parser fragment objects store a value handle/id, span start/end, token-range
  start/end, and child/field vector handles. Parser field-capture objects store
  a field id and value handle/id. Parser rule-node objects store a rule id,
  span, token range, and child/field vector handles copied from a fragment.
  Parser token objects store class, payload, terminal, and span data; parser
  diagnostic objects store code, span, and detail data.
- Parser fragment, field-capture, rule-node, token, and diagnostic helpers trap
  for wrong object kind and delegate vector bounds checks to the arena-backed
  vector helpers.
- Generated TypeScript lexers, Wasm JavaScript adapters, and parser fallback EOF
  paths allocate runtime token records for public tokens, including EOF, and
  read those records through runtime token accessors before materializing public
  JavaScript token objects through one shared runtime-target helper.
- Generated main/literal public tokens carry their plan-local terminal hint as a
  non-enumerable `__babaTerminal` property. Parser APIs may read it when the
  token came from the same generated runtime, but it is not enumerable,
  serialized, or part of the public token contract.
- Generated parser fallback EOF tokens allocate runtime token records and read
  span data through runtime token accessors before materializing public
  JavaScript token objects.
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
- Generated public field assembly tracks capture counts in a runtime arena array
  indexed by field-schema entry instead of a JavaScript count object.
- Generated public field assembly stores captured field value handles in tagged
  runtime records and vectors, then materializes public JavaScript scalar and
  array field values from those runtime handles in a final pass through one
  shared runtime-target field materializer helper.
- Generated public child assembly consumes runtime rule-node child vectors and
  resolves runtime token/rule-node handles through a per-replay syntax handle
  map; it no longer carries an independent JavaScript fragment child list.
- Generated public rule-node object materialization is emitted from one shared
  runtime-target rule-node materializer helper behind runtime rule-node handles.
  The materializer reads rule id, span, token range, child vector, and field
  vector data through runtime accessors before allocating the public JavaScript
  CST node object.
- Generated public parse diagnostics are emitted from one shared runtime-target
  diagnostic materializer helper. The helper allocates runtime diagnostic
  records and reads span data back from those records before materializing
  public JavaScript diagnostic objects.
- Boundary failures visible to Baba users are structured diagnostics: grammar
  validation and target planning return compiler diagnostics, lexing returns
  `LexDiagnostic`, parsing returns `ParseDiagnostic`, invalid external token
  streams return `TS_PARSER_INVALID_TOKEN_STREAM`, and generated parser
  runtime/replay traps caught at the public parse boundary become
  `PARSER_INTERNAL_ERROR` diagnostics. Direct execution of private
  runtime-language helpers still traps; those traps are conformance-test
  behavior, not public parser API results.
- `if` and `while` conditions treat zero as false and any nonzero `u32` as true.

## Not Yet In The Executable Subset

These rules must be specified before the parser runtime can be fully lowered:

- host-boundary ownership and handle capability lifetimes for future non-JS Wasm
  hosts beyond the current JavaScript-hosted `WasmSourceBuffer` and
  `ParseTraceInput` provenance gates;
- first-class runtime-language text values, if source decoding moves fully into
  the runtime language;
- a richer structured-error taxonomy for a future host-neutral Wasm ABI;
- complete generated-parser lowering for remaining host public object
  materialization that still sits outside the shared token, diagnostic,
  parse-result, field, and rule-node public wrapper helpers.

Until the parser runtime is lowered through this language, Baba does not claim
that the full TypeScript and Wasm parser runtimes are mechanically emitted from
one runtime-language implementation.
