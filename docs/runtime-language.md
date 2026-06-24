# Runtime Language Semantics

Baba's runtime language is private compiler infrastructure for standalone parser
runtimes. Its current executable subset is intentionally focused: it makes
runtime semantics testable and backs the generated TypeScript/Wasm parser
runtime boundary.

## Version

- Runtime language version: `1`
- Semantics tag: `baba-runtime-language-v1`
- Compiler manifest format: `baba-runtime-language-compiler` version `1`
- Artifact manifest format: `baba-runtime-language-artifacts` version `1`

The runtime implementation metadata exported by generated parsers identifies the
checked-in runtime source family. Runtime-language versioning is separate from
the Baba package version, parser-plan version, parser-kit schema version, and
Wasm adapter ABI version.

## Runtime Source-Of-Truth Cutline

The runtime source-of-truth proof is not "no JavaScript exists." The proof is
that parser semantics have one runtime-language-owned implementation and
generated hosts only provide capabilities, allocation, rendering, and packaging.

Runtime-owned semantics:

- shared BRL source modules under `src/runtime/*.brl` define the portable
  lexer/parser runtime source layout used by both backend migration tracks;
- source offset/span status, UTF-16 trail-unit availability, code-point
  decoding, next-offset arithmetic, lexer DFA transition lookup, accepted-spec
  tracking, token class/status classification, maximal-munch lexer-driver
  events, preserve-trivia emission, and lexical-error fallback advancement;
- external token-stream normalization, canonical stream matching, omitted-trivia
  handling, trace terminal selection, and compacted trace metadata;
- LR trace control flow, branch scheduling, action/goto lookup, production and
  reducer metadata lookup, replay value-stack semantics, reduction dispatch,
  fragment assembly, field capture semantics, accepted-root classification, and
  runtime diagnostic payload selection;
- stable numeric diagnostic codes, detail-kind IDs, spans, expected-range
  identity, and payload fields;
- Wasm core ABI metadata needed for independent hosts to discover runtime
  ownership, input, trace, result, and lifetime rules.

Host-owned boundaries:

- JavaScript string storage, source slicing for public token text, and
  `charCodeAt` source capability reads behind shared source-text helpers;
- public JavaScript `Token`, `LexResult`, `ParseResult`, CST, field, and
  diagnostic object allocation;
- human-readable diagnostic message, `expected`, and `found` rendering from
  runtime-owned payload records;
- JavaScript-hosted Wasm adapter capabilities such as source-buffer writes,
  handle provenance checks, result-buffer ownership, and ergonomic public API
  wrappers;
- target packaging: imports, generated type declarations, table data, manifest
  metadata, and runtime artifact reexports.

Forbidden source-of-truth duplication:

- target-specific DFA, token-stream, LR trace, replay, reducer, field,
  diagnostic-payload, or accepted-root algorithms that duplicate
  runtime-language decisions outside an explicitly documented host boundary;
- direct comparisons of encoded runtime status values in host code when a
  runtime-language helper owns the status taxonomy;
- generated TypeScript/Wasm adapter branches that decide parser semantics while
  bypassing the runtime-language source.

The generated TypeScript and JavaScript-hosted Wasm parser runtimes now satisfy
this cutline. The remaining JavaScript code in those targets is the documented
host boundary: source/string capabilities, public object allocation, diagnostic
rendering, adapter handle provenance, and packaging. Parser-kit helpers remain
tooling/convenience interpreters for `parser-kit.json`, not one of the two
generated runtime targets in this proof; they are covered by parity tests and
may be lowered or split into a separate helper runtime in a future compatibility
task.

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
emission still happens in each backend, and canonical runtime-language helper
artifacts are checked by the artifact manifest.

Runtime-language-backed parser helpers are used by generated TypeScript lexers
and parsers: `sourceTextOffsetStatus` and `sourceTextSpanStatus` classify
dynamic source offsets/spans, `sourceTextHasTrailUnit` and
`sourceTextCodePointFromUnits` classify UTF-16 source-unit availability and
decode code points, `sourceTextNextOffset` advances over UTF-16 code points,
`dfaTransition` performs DFA transition lookup from generated read-only tables,
and `lexerScan*` helpers track longest-match accepting candidates from generated
DFA accept tables. Generated TypeScript lexer source access still reads
host-owned strings, but `SourceTextBoundary` calls runtime-language source
helpers for bounds, trail, code-point, next-offset, and accepted-length
decisions. The runtime-language `lexerDriver*` helpers own the generated
TypeScript lexer driver state: the host wrapper only feeds the code point at
`lexerDriverReadOffset()` and then wraps `TOKEN` or `ERROR` events reported by
the driver. The driver performs maximal-munch scan iteration, accepted-spec
selection, preserve-trivia emission decisions, public token
class/payload/terminal selection, and lexical-error fallback advancement.
`lexerSpecTokenClass`, `lexerSpecPayload`, and `lexerSpecTerminal` map accepted
lexer spec indexes to token object classification data and parser terminal ids
for generated TypeScript `parse(source)`, while `lexerSpecFlags` remains the
lower-level table helper. Standalone TypeScript lexers and generated Wasm
JavaScript adapters allocate runtime-language token records for matched
literals, named tokens, preserved trivia, lexical error tokens, and EOF tokens,
then read class, payload, terminal, and span data back through `parserToken*`
accessors before wrapping public API token objects through one shared
runtime-target materializer helper. `lexerPublicTokenClass` and
`lexerTokenEmitStatus` own the literal/main/trivia public class and
preserve-trivia emission decisions used by both generated TypeScript lexers and
generated Wasm JavaScript adapters. Lexical unexpected-character diagnostics are
allocated through one shared runtime-target lex diagnostic materializer in both
generated TypeScript lexers and generated Wasm JavaScript adapters. Public lex
result objects are allocated through one shared runtime-target lex result
materializer in both lexer targets. The generated materializer stores the
parser-terminal hint as a non-enumerable `__babaTerminal` property on main and
literal public tokens. That hint is plan-local provenance for generated parser
fast paths, not a public token API, and consumers should not serialize, mutate,
or reuse it across parser plans. External token streams keep public
token-kind/literal spelling at the API boundary, but generated parsers map those
spellings to lexer spec indexes and use the same runtime-language helpers for
channel and terminal classification. `lexerSpecPublicTokenStatus` decides
whether a mapped public literal/main/trivia token is compatible with the spec
row; TypeScript still validates object shape/text and emits public diagnostics.
`parserTokenStreamSpanBoundsStatus`, `parserTokenStreamSpanPositionStatus`,
`parserTokenStreamWidthStatus`, and `parserTokenStreamEofStatus` classify
external token-stream span ordering and EOF-shape errors before TypeScript
allocates public diagnostics. `parserTokenStreamGapTokenStatus` classifies
canonical lexer tokens inside omitted source gaps as safely omitted trivia or
invalid nontrivia source. `parserTokenStreamTokenMatchStatus` compares canonical
and supplied token numeric identity, terminal, spec index, and span after host
text/channel checks. `parserTokenStreamCanonicalMatchStatus` classifies
canonical lexer replay advancement as a supplied-token match, an omitted-trivia
skip, or a mismatch. `parserTokenStreamFinalStatus` classifies end-of-stream EOF
placement and trailing source gaps before TypeScript allocates final
token-stream diagnostics. `parserTokenStreamPublicTokenStatus` classifies public
literal/named/error token shape after host type/channel/text spelling is mapped
to numeric classes. `lexerTokenDiagnosticStatus` classifies external tokens as
diagnostically accepted, lexical error tokens, or not in the parser terminal set
before TypeScript allocates the public diagnostic object.
`parserTraceTokenStreamStep` classifies public token records as parser-trace
input, skippable trivia, or EOF stop tokens and packs the selected trace
terminal for generated TypeScript parsers and Wasm adapters. The helper uses the
runtime-language `parserTraceTerminal` taxonomy internally to select EOF,
trusted runtime, spec, or missing parser terminals.
`parserTraceTokenStreamStepStatus` and `parserTraceTokenStreamStepTerminal`
unpack the trace decision, and `parserTraceTokenStreamPublicIndex` owns the
public-token-index sentinel used when the compacted trace reaches synthetic EOF.
`parserShiftedTokenStatus` classifies literal/main public tokens as valid
shifted CST token fragments and rejects trivia, lexical error, and EOF records
before generated replay allocates runtime token fragments. Deterministic parsers
use `parserAction`/`parserGoto` for parser table lookup, and conflict parsers
use generated `parserActionAt`/`parserActionCount`/`parserGoto` helpers for
multi-action fan-out and goto lookup. Generated parsers also use the
`parserExpectedStart` and `parserExpectedEnd` helpers to map parser states to
flattened expected-terminal display ranges for diagnostics, and
`parserUnexpectedDiagnosticCode` uses runtime EOF flags to choose
unexpected-token versus trailing-input runtime diagnostic codes without scanning
display strings. Accepted parser traces are replayed by the runtime-language
`parserReplayVm`, which owns action iteration, value-stack operations,
production metadata lookup, reduction dispatch, fragment construction, field
capture attachment, child-list construction, accepted-root selection, and
structured replay failure statuses. The generated TypeScript/Wasm adapters pass
runtime token handles and accepted trace vectors into that VM, then materialize
the accepted runtime root through shared public object wrappers. The replay VM
uses reducer descriptor metadata from `parserReducerKind`/
`parserReducerPayload`, reducer operation classes from `parserReducerOperation`,
payload validation from `parserReducerPayloadStatus`, child-role requirements
from `parserReducerChildRole`, and reducer result-shape classification from
`parserReducerResultKind`, all backed by numeric reducer tables. CST field
assembly reads field row/config metadata through
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
syntax handle map; empty/non-empty child-list classification comes from
`parserRuleNodeChildListStatus`. Field value-class/count validation now uses
`parserFieldValueClass`/`parserFieldStorageStatus`/
`parserFieldSchemaStatus`/`parserFieldBuildStatus`/
`parserFieldEntryStatus`/`parserFieldArrayValueStatus`/
`parserFieldScalarValueStatus`/`parserFieldCaptureStatus`/
`parserFieldFinalStatus`/`parserFieldFinalBuildStatus` helpers. Replay reduction
Array-field capture assembly also uses `parserFieldArrayValueStatus` before
appending to the runtime vector. Replay reduction validity, sentinel stack-depth
calculation, and RHS stack slicing use `parserReplayReductionStatus`,
`parserReplayStackDepth`, and `parserReplayRhsStart`; span/token-range merge
arithmetic uses `parserMergeStart`/`parserMergeEnd` helpers. Generated parser
action decoding uses `parserActionKind`/`parserActionPayload` helpers, and
`parserTrace` uses the same helpers to classify encoded actions.
`parserReplayActionStatus` classifies shift/reduce/accept/unknown action kinds
before generated TypeScript replay dispatches the accepted trace.
`parserTraceStatusKind` classifies parser trace status values for generated
TypeScript parsers and Wasm adapters before those hosts allocate public
diagnostics. Public parse diagnostics now allocate runtime-language diagnostic
records first, read span data back through
`parserDiagnosticSpanStart`/`parserDiagnosticSpanEnd`, and then materialize the
public JavaScript diagnostic object at the API boundary. Diagnostic-list merge
decisions use the runtime-language `parserDiagnosticMergeStatus` helper for
empty-left/empty-right/both classification while the host still owns JavaScript
array allocation and identity. Generated TypeScript parsers and generated Wasm
adapters allocate parse success/failure results through one shared
runtime-target parse-result materializer, using `parserAcceptedRootStatus` to
classify direct rule-node roots, fragment-value rule-node roots, and invalid
accepted roots while keeping the public discriminated union object shape
centralized at the host boundary. Deterministic TypeScript parsers use a
runtime-language `parserTrace` helper whose parser state stack and
accepted-action trace are stored in arena-backed growable vectors for LR
shift/reduce/accept control flow. Declared-conflict TypeScript parsers use a
runtime-language conflict `parserTrace` helper whose active stack, accepted
action trace, and saved branch snapshots are stored as arena-backed growable
vectors before TypeScript replays the accepted action trace to build the CST.
The core Wasm parser trace uses the same shared action kind/payload masks, and
generated Wasm adapters now instantiate a runtime-language Wasm parser trace
module for LR control flow, trace status classification, and trace action reads.
The core Wasm module still owns lexing and low-level parser table lookup
exports, but it no longer emits a separate `parse_trace` LR execution function.
The same runtime-language source shapes are also compiled to Wasm in conformance
tests. Because generated parser runtime code depends on runtime-language
compiler output, the checked runtime implementation manifest includes both
runtime language sources, the Stage-0 compiler, and the checked runtime-language
artifact manifest.

## Current Executable Subset

The Stage-0 runtime-language compiler accepts typed programs made of `u32`
functions with statement bodies. The current conformance subset supports:

- `u32` function parameters and locals;
- read-only `u32` tables;
- immutable named UTF-16 text constants represented by opaque numeric handles;
- zero-initialized `u32` scratch memory declared per program with an initial
  size and explicit checked growth;
- `u32` constants;
- local reads and assignments;
- calls between `u32` functions;
- checked read-only table loads by constant or local index;
- typed `text` parameters, locals, and helper-return values inside
  runtime-language programs, with exported entry points still restricted to
  `u32` for current host compatibility;
- checked text length and UTF-16 code-unit access;
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
- Exported entry function results are currently `u32`.
- Parameters, locals, and non-entry helper results may be `u32` or `text`.
- Locals are initialized to zero before the first statement executes.
- Scratch memory is a growable `u32` word array, initialized to the program's
  requested size when the emitted runtime artifact is instantiated, and persists
  between calls to runtime-language functions in that artifact.
- Function arguments evaluate left-to-right.
- Calls trap if the callee traps.
- Table loads trap on out-of-bounds indexes.
- Table load indexes are currently restricted to constants and locals; assign
  computed indexes to locals before loading.
- Runtime-language text values are immutable handles to named UTF-16 text
  constants. `textLength(text)` returns the number of UTF-16 code units.
  `textCodeUnitAt(text, index)` returns the code unit at a checked zero-based
  offset and traps when the text handle or index is out of bounds. Generated
  TypeScript lexer source decoding now calls `sourceTextOffsetStatus`,
  `sourceTextHasTrailUnit`, and `sourceTextCodePointFromUnits` after the host
  boundary reads UTF-16 code units. Standalone parser runtimes still treat host
  source text as an immutable UTF-16 code-unit sequence at the host boundary;
  turning host source buffers into runtime-language text handles remains a
  future lowering step.
- Generated token materialization, lexer wrapper code, and token-stream
  validation route host source access through one shared `SourceTextBoundary`
  helper. The boundary carries the immutable source string and UTF-16 length and
  owns generated slice, text-match, and code-unit reads. Runtime-language
  `sourceText*` helpers own span validity, checked offset status, UTF-16
  trail-unit availability, surrogate decoding, and next-offset arithmetic. It is
  still a JavaScript host wrapper, but it is the single generated handle
  contract to replace when dynamic host source buffers are lowered into
  runtime-language handles.
- Generated JavaScript-hosted Wasm adapters treat `WasmSourceBuffer` values
  returned by `writeSource()` as adapter-owned source capabilities. The adapter
  tracks those buffers by object provenance and input epoch, rejects forged
  plain objects, and invalidates previous buffers when `reset()` runs or when
  `writeSource()` installs a different source into the shared Wasm input area.
- Core Wasm modules export ABI metadata for non-JS hosts to discover the current
  input base, maximum page count, source encoding, span unit, lex-result record
  width, token-record width, host ownership model, and result lifetime model.
  Host ownership model value `1` means the host owns UTF-16 input and result
  buffers in linear memory. Result lifetime model value `1` means low-level core
  results are valid in caller-provided buffers until the host overwrites those
  buffers or grows memory. The generated JavaScript adapter validates those core
  exports against its generated constants before using the module.
- Generated Wasm targets also write `wasm/abi.json`, a deterministic
  host-neutral descriptor for that core ABI, parser-plan identity, runtime
  implementation identity, memory layout, UTF-16 source/span conventions, trace
  statuses, adapter handle model, and numeric parser diagnostic IDs. Non-JS host
  tooling should consume the descriptor instead of scraping generated
  TypeScript.
- CI installs `wasm-tools` and `wasmtime` so release checks validate the core
  module outside Deno's JavaScript `WebAssembly.instantiate` path. Local tests
  skip those independent-engine checks when the binaries are missing and still
  exercise the JavaScript-hosted adapter path.
- Generated JavaScript-hosted Wasm adapters export trace status constants and
  include both numeric `statusKind` and string `failureKind` fields on
  `parseTrace()` failures before public parser diagnostics are materialized.
- Generated JavaScript-hosted Wasm adapters treat `ParseTraceInput` values
  returned by `createParseTraceInput()` as adapter-owned parser-trace
  capabilities. The adapter rejects forged plain objects and invalidates
  previous trace inputs when `reset()` reinstantiates the parser trace runtime.
  The adapter handle capability model value `1` means these JavaScript-side
  capabilities are epoch-checked and are not serializable core Wasm handles.
- Public token, CST, and diagnostic spans are half-open UTF-16 code-unit
  offsets. CRLF is two code units, NUL is one code unit, U+2028 and U+2029 are
  one code unit each, and astral code points occupy two code units when encoded
  as surrogate pairs.
- `utf16CodePointWidth(codePoint)` returns `1` for code point values below
  `0x10000` and `2` otherwise. Isolated surrogate code units are treated as BMP
  values and advance by one code unit, matching JavaScript `codePointAt()`
  behavior on ill-formed UTF-16 strings.
- `utf16CodePointFromUnits(leadUnit, trailUnit, hasTrail)` combines a valid
  high-surrogate/low-surrogate pair into one scalar value and otherwise returns
  the lead code unit unchanged.
- `utf16HasCodeUnit(offset, length)` returns `1` when a UTF-16 code-unit offset
  is inside the source length and `0` at or beyond the end.
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
- Generated TypeScript lexers and Wasm JavaScript adapters allocate lexical
  unexpected-character diagnostics through one shared runtime-target helper.
- Generated TypeScript lexers and Wasm JavaScript adapters allocate public
  `LexResult` objects through one shared runtime-target helper.
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
  records, reads span data back from those records, asks the runtime-language
  `parserDiagnosticCodeStatus` helper to verify the runtime code matches the
  allocated record, asks `parserDiagnosticDetailKindId` for the numeric detail
  payload kind, and then materializes public JavaScript diagnostic objects.
- Boundary failures visible to Baba users are structured diagnostics: grammar
  validation and target planning return compiler diagnostics, lexing returns
  `LexDiagnostic`, parsing returns `ParseDiagnostic`, invalid external token
  streams return `TS_PARSER_INVALID_TOKEN_STREAM`, and generated parser
  runtime/replay traps caught at the public parse boundary become
  `PARSER_INTERNAL_ERROR` diagnostics. Direct execution of private
  runtime-language helpers still traps; those traps are conformance-test
  behavior, not public parser API results.
- Generated parser modules export numeric parser diagnostic code constants
  matching runtime diagnostic records: `parserDiagnosticCodeParseLexicalError`
  (`1`), `parserDiagnosticCodeParseUnexpectedToken` (`2`),
  `parserDiagnosticCodeParseTrailingInput` (`3`),
  `parserDiagnosticCodeParseInvalidTokenStream` (`4`),
  `parserDiagnosticCodeInternalError` (`5`), and
  `parserDiagnosticCodeBranchLimit` (`6`), plus detail-kind constants
  `parserDiagnosticDetailKindNone` (`0`) and
  `parserDiagnosticDetailKindParserState` (`1`). Public diagnostics still expose
  string `code` values for JavaScript consumers, and also expose `runtimeCode`,
  `runtimeDetail`, `runtimeDetailKind`, and `runtimeDetailKindId` fields copied
  from or derived from the runtime diagnostic record. Unexpected-token and
  trailing-input diagnostics use `runtimeDetail` for the parser state that
  produced the expected-terminal set and set `runtimeDetailKind` to
  `"parser-state"` with `runtimeDetailKindId` equal to
  `parserDiagnosticDetailKindParserState`; the numeric detail-kind decision
  comes from the runtime-language `parserDiagnosticDetailKindId` helper.
  Generated `wasm/abi.json` descriptors include `parserDiagnostics.schemas`,
  which maps each runtime code to its public string code, `runtimeDetail` kind,
  numeric detail-kind id, and public payload fields.
- `if` and `while` conditions treat zero as false and any nonzero `u32` as true.

## Future Runtime-Language Growth

These areas are deliberately outside the current generated TypeScript/Wasm
source-of-truth proof and remain future runtime-language or host-neutral ABI
work:

- executable host-boundary ownership helpers and opaque handle capability
  lifetimes for future non-JS Wasm hosts beyond the current ABI descriptor,
  linear-memory ownership metadata, and JavaScript-hosted
  `WasmSourceBuffer`/`ParseTraceInput` provenance gates;
- host source-text handles fully lowered into the runtime language for a future
  non-JavaScript dynamic source-buffer ABI;
- a richer structured-error taxonomy for a future host-neutral Wasm ABI;
- optional parser-kit helper lowering, if Baba later wants `parser-kit.json`
  convenience execution to share the same runtime-language artifact path as the
  generated TypeScript and Wasm targets.
