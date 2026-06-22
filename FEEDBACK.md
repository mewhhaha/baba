# Verdict

## Local resolution notes

This local run addressed the feedback that could be completed without replacing
the generated TypeScript runtime with an artifact compiled from the internal
runtime language:

- Added an explicit `baba-parser-plan` v1 contract shared by TypeScript, Wasm,
  and kit planning.
- Added shared portable-plan identity metadata (`format`, `version`,
  `semantics`, and `hash`) to generated TypeScript runtimes, generated Wasm
  adapters, and parser-kit JSON so consumers can verify target artifacts came
  from the same parser plan.
- Moved regex validation to Baba's portable regex parser, emitted Tree-sitter
  regexes from the parsed regex AST, and added regex compiler resource limits
  covering AST size, bounded repeat expansion, NFA/DFA construction, and overlap
  analysis work.
- Tightened portable overlap diagnostics, rejecting priority-only named-token
  ambiguity and trivia/literal shadowing cases.
- Documented and exported Wasm ABI/plan versions, `reset()`, UTF-16 span units,
  repeated-parse memory reuse behavior, a core module maximum page count, and
  adapter-side page/overflow checks before memory growth.
- Added deterministic generated Wasm output coverage. Local independent-engine
  validation remains unavailable because `wasm-tools`, `wasm-validate`, and
  `wasmtime` are not installed in this environment.
- Clarified the Wasm product boundary as a JavaScript-hosted core Wasm adapter,
  exported `wasmTargetKind`, and documented that Baba does not yet emit WASI,
  Component/WIT, browser-only, or host-neutral Wasm packages.
- Removed per-gap `parseTokens()` relexing in favor of whole-source canonical
  token validation.
- Added runtime-profile kit output, parser-kit usage/stability docs, CST
  `tokenRange` data, shared field schema collection, Tree-sitter direct analyzed
  plans, DFA ASCII fast dispatch, and TypeScript/Wasm/kit parity tests.
- Added `check --explain-targets` target capability reporting for Tree-sitter,
  TypeScript, Wasm, and kit.
- Added LR parser conflict witness prefixes to shift/reduce and reduce/reduce
  diagnostics.
- Added `deno task bootstrap` and `deno task bootstrap:check` for deterministic
  checked-in example runtime artifact regeneration. This covers the current
  Stage-0 generated artifacts, runtime-language compiler source manifest, and
  runtime-language helper artifact manifest.
- Moved the TypeScript lexer/parser runtime source emitters into
  `src/targets/runtime/`, leaving `src/targets/typescript/` to package grammar
  tables, generated type declarations, and runtime reexports. A regression test
  now rejects DFA traversal, LR execution, reduction, CST construction, and
  token-stream validation markers under the TypeScript target directory.
- Moved the Wasm core bytecode runtime emitter into `src/targets/runtime/`,
  leaving the Wasm target module emitter as a packaging reexport with regression
  coverage for the boundary.
- Added versioned runtime implementation identity metadata
  (`baba-runtime-implementation` v1) to generated TypeScript, generated Wasm,
  and parser-kit outputs, backed by a checked source-hash manifest for the
  current shared runtime source files.
- Added an initial private runtime-language v1 semantic seed with a typed
  executable `u32` subset, TypeScript and Wasm emitters, conformance tests, and
  `docs/runtime-language.md`. This is a compiler foundation step; the parser
  runtime is not yet lowered through it.
- Added a checked Stage-0 runtime-language compiler source manifest to
  `bootstrap:check`, separate from generated parser runtime implementation
  identity.
- Expanded the private runtime-language conformance subset with `u32`
  parameters, locals, assignments, structured branches, and loops across both
  TypeScript and Wasm backends.
- Added runtime-language unsigned less-than and a resettable scratch-memory
  arena with tagged arena-backed `u32` array, fixed-record, and growable-vector
  helpers, including allocation overflow, reset/reuse, zero initialization,
  wrong-kind traps, stale-handle traps, vector growth/copy semantics, and
  bounds-trap conformance across both TypeScript and Wasm backends. This starts
  specifying allocation lifetime and record/vector layout semantics before
  parser CST/field allocation is lowered into the runtime language.
- Moved the generated TypeScript lexer UTF-16 code-point width helper onto a
  runtime-language source program, with the same source compiled through both
  TypeScript and Wasm conformance tests.
- Added runtime-language function calls and multi-function TypeScript/Wasm
  conformance coverage, and included the Stage-0 runtime-language compiler in
  generated runtime implementation identity now that generated parser runtime
  helpers depend on compiler output.
- Added read-only `u32` runtime-language tables with checked TypeScript/Wasm
  table-load conformance coverage, moving the language toward table-driven
  lexer/parser runtime code.
- Moved generated TypeScript lexer DFA transition lookup onto a runtime-language
  source program backed by read-only `u32` tables, replacing the previous
  hand-written generated `transition()` helper.
- Added direct TypeScript/Wasm runtime-language conformance coverage for the
  generated DFA transition helper, including ASCII fast-table hits/misses, range
  fallback, non-BMP code points, and range-only operation.
- Moved generated TypeScript lexer longest-match accept/candidate selection onto
  runtime-language `lexerScan*` helpers backed by generated DFA accept tables
  and scratch memory. Generated TypeScript still decodes JavaScript strings and
  emits token objects, but it no longer carries a standalone `DFA_ACCEPTS` table
  or accept-tracking loop.
- Moved generated deterministic TypeScript parser action/goto table lookup onto
  a runtime-language source program backed by read-only `u32` tables, replacing
  the previous generated `findAction()`/`findGoto()` table scans for unambiguous
  parsers.
- Moved generated TypeScript conflict-parser goto lookup onto the same
  runtime-language table helper, so declared-conflict parsers no longer emit a
  separate generated `GOTOS` table or scan it by hand.
- Moved generated TypeScript conflict-parser multi-action lookup onto a
  runtime-language `parserActionAt` helper, so declared-conflict parsers no
  longer emit a separate generated `ACTIONS` table or scan it by hand.
- Added growable checked `u32` scratch memory to the private runtime-language
  subset, with TypeScript/Wasm conformance coverage for stack-like load/store
  behavior and explicit growth. This is the first mutable-memory substrate
  needed before parser stacks and trace buffers can be lowered through the
  runtime language.
- Moved deterministic parser trace state-stack and accepted-action storage onto
  arena-backed growable vectors, including vector truncation for LR reductions.
- Moved declared-conflict parser trace active stack, accepted-action storage,
  and saved branch snapshots onto arena-backed growable vectors using cloned
  vector handles for branch restore.
- Moved deterministic generated TypeScript parser LR shift/reduce/accept control
  flow onto a runtime-language `parserTrace` source program backed by generated
  action/goto/production tables and growable scratch memory. Generated
  TypeScript now feeds terminal IDs into that helper and replays the resulting
  action trace to build the CST, with TypeScript/Wasm conformance coverage for
  the trace helper.
- Added a resolved runtime-language IR boundary (`RuntimeLanguageIrProgram`) so
  TypeScript and Wasm runtime compiler backends consume the same lowered
  control-flow/value nodes with resolved entry/function/table/local/scratch
  metadata before target-specific emission.
- Added a checked runtime-language artifact manifest for canonical helper
  programs. `bootstrap:check` now recompiles those helpers to TypeScript and
  Wasm and verifies source, TypeScript artifact, Wasm artifact, and aggregate
  manifest hashes.
- Moved generated parser expected-terminal state lookup onto runtime-language
  `parserExpectedStart`/`parserExpectedEnd` helpers, so TypeScript and
  Wasm-adapter parse diagnostics consume the same flattened expected-range
  runtime helper.
- Moved generated parser production metadata lookup onto runtime-language
  `parserProductionLhs`/`parserProductionRhsLength` helpers, so TypeScript
  branch reduction, deterministic trace replay, and Wasm-adapter trace replay
  consume the same production row helper.
- Added a runtime-language `andU32` operator and moved generated parser action
  kind/payload decoding plus `parserTrace` action classification onto
  `parserActionKind`/`parserActionPayload` helpers.
- Moved generated parser replay shift/reduce/accept action dispatch
  classification onto runtime-language `parserReplayActionStatus`, so accepted
  trace replay no longer directly interprets raw action kind numbers before
  executing host object allocation.
- Switched the core Wasm parser trace decoder to the same shared runtime action
  kind/payload masks used by the runtime-language helpers.
- Added a runtime-language `parserActionCount` helper so generated conflict
  parsers get action fan-out from shared table logic before scheduling branches.
- Moved generated TypeScript conflict-parser branch scheduling onto a
  runtime-language `parserTrace` helper that saves and restores branch frames
  through arena-backed vector snapshots before TypeScript replays the accepted
  action trace.
- Moved generated Wasm adapter parser trace control flow onto a runtime-language
  Wasm `parserTrace` module that exports trace input, status, error, count, and
  action accessors for adapter replay.
- Removed the legacy core Wasm `parse_trace` export and in-core LR trace
  bytecode emitter. Generated Wasm adapters now keep parse-trace terminal input
  in a JavaScript `Int32Array` and use the runtime-language Wasm trace module
  for parser control flow.
- Moved generated parser reducer descriptor lookup onto runtime-language
  `parserReducerKind`/`parserReducerPayload` helpers backed by numeric reducer
  tables, replacing generated `PRODUCTION_REDUCERS` object tables during trace
  replay.
- Moved generated parser reducer kind-to-operation classification onto
  runtime-language `parserReducerOperation`, so replay no longer switches
  directly on raw reducer descriptor kinds. Generated TypeScript still executes
  the fragment/CST allocation for each operation.
- Moved generated parser rule/field reducer payload-presence validation onto
  runtime-language `parserReducerPayloadStatus`. Generated TypeScript still
  emits the public internal-error diagnostic object.
- Moved generated parser reducer child-role requirements onto runtime-language
  `parserReducerChildRole`. Generated TypeScript still performs the object
  conversion/allocation for fragment, shifted-token, and rule-node roles.
- Moved generated parser reducer result-shape classification onto
  runtime-language `parserReducerResultKind`, so replay no longer switches on
  reducer operations to decide whether a reduction yields a raw child, rule
  node, fragment, empty value, array append, separated append, or field capture.
  Generated TypeScript still performs the corresponding object/array allocation.
- Moved generated CST field schema metadata lookup onto runtime-language
  `parserFieldStart`/`parserFieldEnd`/`parserFieldId`/`parserFieldFlags`/
  `parserFieldIndex` helpers backed by numeric field rows, replacing generated
  `RULE_FIELD_SCHEMAS` object tables during CST field assembly.
- Moved generated field assembly value-class and cardinality validation onto
  runtime-language `parserFieldValueClass`/`parserFieldCaptureStatus`/
  `parserFieldFinalStatus` helpers. Generated TypeScript still allocates field
  objects and arrays.
- Moved generated TypeScript lexer spec classification and terminal mapping onto
  runtime-language `lexerSpecTokenClass`/`lexerSpecPayload`/`lexerSpecTerminal`
  helpers backed by numeric lexer spec tables. Generated lexed tokens carry an
  internal trusted terminal id into parser tracing. External `parseTokens()`
  input now maps public token strings/literals to lexer spec indexes and uses
  the same runtime-language helpers for channel and terminal metadata.
- Moved generated external token-stream literal/main/trivia compatibility checks
  onto runtime-language `lexerSpecPublicTokenStatus`. Generated TypeScript still
  validates public object shape/text/spans and emits public diagnostics.
- Moved generated token-level lexical diagnostic classification onto
  runtime-language `lexerTokenDiagnosticStatus`, so external `parseTokens()`
  lexical diagnostics no longer decide directly in TypeScript whether error,
  trivia, terminal, or nonterminal tokens should produce a diagnostic. Generated
  TypeScript still emits the public diagnostic object.
- Moved generated parser replay span/token-range merge arithmetic onto
  runtime-language `parserMergeStart`/`parserMergeEnd` helpers. Generated
  TypeScript still allocates JavaScript fragment, field, and CST objects.
- Moved the trailing-input diagnostic decision onto runtime-language
  `parserExpectedHasEof` state flags, replacing a generated scan of expected
  display strings.
- Moved parser trace status classification onto runtime-language
  `parserTraceStatusKind`, so generated TypeScript parsers and Wasm adapters no
  longer interpret trace status numbers directly before choosing unexpected,
  branch-limit, or internal diagnostic paths.
- Moved parser trace replay reduction validity classification onto
  runtime-language `parserReplayReductionStatus`, so generated TypeScript no
  longer directly combines unknown-production, missing reducer payload, and
  replay-stack underflow checks before emitting public diagnostics.

Still unresolved:

- The P0 source-of-truth milestone remains open: TypeScript and Wasm runtime
  execution now has a clearer shared runtime packaging boundary and generated
  lexer/parser table helpers plus deterministic TypeScript lexer candidate
  selection, expected-terminal diagnostic ranges, and parser trace control flow
  from the runtime language. Production LHS/RHS-length metadata lookup is also
  runtime-language-backed now, and action kind/payload decoding uses
  runtime-language helpers in generated parser replay and `parserTrace`, while
  core Wasm trace decoding uses the same shared masks. Conflict branch fan-out
  counting and generated TypeScript conflict branch scheduling are now
  runtime-language-backed, and generated Wasm adapters now call a
  runtime-language Wasm parser trace module instead of a core `parse_trace`
  export. Reducer descriptor lookup and field schema lookup are now
  runtime-language-backed, generated replay now gets reducer operation
  classification, rule/field payload-presence validation, reducer child-role
  requirements, and reducer result-shape classification from runtime-language
  helpers, and generated field assembly now gets value-class and
  count-validation decisions from runtime-language helpers. Generated TypeScript
  lexing now reads token class, payload, and terminal metadata from
  runtime-language helpers before emitting public token objects. External
  `parseTokens()` mapping still accepts public strings/literals at the API
  boundary, but terminal/channel classification and public token class
  compatibility plus token-level lexical diagnostic classification now go
  through runtime-language lexer spec helpers. Parser replay span and
  token-range merge arithmetic is runtime-language-backed, trailing-input
  diagnostic code selection uses runtime-language expected-state flags, reducer
  result-shape classification is runtime-language-backed, and parser replay
  action dispatch, parser trace status, plus replay reduction validity
  classification now use runtime-language helpers, but the actual
  allocation/assembly of fragments, field objects/arrays, CST nodes, and
  generated token/diagnostic object emission is still not mechanically emitted
  from one runtime-language implementation. The runtime language now has a
  checked resettable arena plus tagged arena-backed `u32` arrays, fixed records,
  and growable vectors, but it still lacks opaque typed handle provenance,
  host-visible CST/token/diagnostic layouts, and parser-runtime lowering that
  would use those allocation helpers. The compiler now has a shared lowered
  control-flow/value IR and checked helper artifact hashes, but it still needs
  broader parser-runtime lowering before the release can fully satisfy "one
  runtime implementation, two execution targets."

Baba has made the right strategic move: the internal runtime language and Wasm
target are defensible extensions of “bootstrap the predictable parts of a
language.”

The concern is now **semantic duplication**. The repository still appears to
contain hand-emitted TypeScript lexer/parser algorithms alongside the newer
runtime-language/Wasm implementation. Unless those TypeScript emitters are
mechanically produced from the runtime-language source, Baba now has three
related systems rather than one portable runtime:

```text
TypeScript runtime templates
Wasm runtime implementation
internal runtime language/compiler
```

The next milestone should not add features. It should prove:

> **One parser plan, one runtime implementation, two execution targets,
> identical behavior.**

## What has improved

The newer direction addresses several previous weaknesses:

- Wasm is treated as a parser-runtime target rather than as language code
  generation.
- An internal runtime language avoids adding Rust or maintaining unrelated host
  implementations.
- The regex compiler, DFA lexer, LR parser, and CST model provide a credible
  portable foundation.
- TypeScript and Wasm can reasonably share exact CST and diagnostic semantics.
- The project remains focused on syntax infrastructure rather than formatters,
  LSPs, or semantic analysis.

That is a coherent product.

The implementation now needs stronger boundaries.

# P0: release-blocking design issues

## 1. Make the runtime language the actual source of truth

The current tree still contains generated TypeScript runtime logic such as
`bestCandidate`, `DFA_TRANSITIONS`, and `reduceProduction` under the TypeScript
emitters. The Wasm/runtime-language work therefore appears to coexist with the
previous hand-written TypeScript runtime templates.

That defeats the primary reason for introducing the internal language.

The intended architecture should be:

```text
runtime source
    ↓
runtime-language compiler
    ├── TypeScript runtime artifact
    └── Wasm runtime artifact

grammar
    ↓
portable parser plan
    ├── TypeScript plan data
    └── Wasm plan data
```

Target emitters should contain packaging logic, not lexer/parser algorithms.

A strong acceptance criterion is:

> `src/targets/typescript/` must contain no independent DFA traversal, LR
> execution, reduction, CST construction, or diagnostic algorithms.

Instead, it should:

1. Include or import the TypeScript artifact compiled from the internal runtime.
2. Emit grammar-specific tables.
3. Emit generated type declarations.
4. Reexport the runtime API.

The same rule applies to Wasm. Its target code should package the compiled
runtime and plan, not reimplement parsing.

---

## 2. Introduce an explicit versioned portable parser plan

I do not see a clearly separated, versioned parser-plan contract acting as the
boundary between grammar compilation and runtime execution.

Create one:

```ts
export interface PortableParserPlanV1 {
  readonly format: "baba-parser-plan";
  readonly version: 1;
  readonly semantics: "baba-portable-v1";

  readonly symbols: SymbolPlan;
  readonly lexer: LexerPlan;
  readonly parser: LrParserPlan;
  readonly cst: CstPlan;
}
```

It should contain only deterministic data:

```ts
interface LexerPlan {
  readonly startState: number;
  readonly states: readonly LexerState[];
  readonly specifications: readonly TokenSpecification[];
}

interface LrParserPlan {
  readonly startState: number;
  readonly eofTerminal: number;
  readonly actions: readonly ActionRow[];
  readonly gotos: readonly GotoRow[];
  readonly productions: readonly ProductionPlan[];
}

interface CstPlan {
  readonly rules: readonly RulePlan[];
  readonly fields: readonly FieldPlan[];
}
```

Compile this once:

```text
AnalyzedGrammar → PortableParserPlan
```

Then both targets consume exactly that object.

Version these independently:

- EBNF syntax version;
- metadata schema version;
- runtime-language version;
- parser-plan version;
- Wasm ABI version.

Do not derive compatibility from the Baba package version alone.

---

## 3. Fix contextual token ambiguity

Baba’s generated portable lexer is global: it selects a token without
considering which terminals are valid in the current LR parser state.

Tree-sitter lexing is contextual.

Consider:

```ebnf
token A priority 10 = /x/ ;
token B priority 0 = /x/ ;

module =
    "a" A
  | "b" B
;
```

A global lexer always emits `A` for `x`. Consequently, `b x` fails in the
portable parser even though the grammar specifically expects `B` there.

A contextual lexer can select `B` because `A` is not valid in that parser state.

Explicit priority does not solve this. It merely makes the global winner
deterministic.

There are two valid directions.

### Recommended: parser-contextual lexing

Store all accepting token candidates in each DFA state:

```ts
interface LexerState {
  readonly transitions: readonly Transition[];
  readonly accepts: readonly TokenCandidate[];
}
```

During parsing:

```ts
nextToken(source, offset, expectedTerminals);
```

selects the best candidate that is:

- expected by the current LR state; or
- trivia.

The standalone API can remain:

```ts
lex(source);
```

using global priority, while:

```ts
parse(source);
```

uses contextual candidate filtering.

Document that distinction.

### Simpler alternative

In strict portable mode, reject every overlap between reachable named tokens,
even when priority differs.

That is more restrictive but correct.

Do not continue claiming portable equivalence while permitting overlaps that the
global lexer cannot resolve contextually.

---

## 4. Overlap handling still has a priority hole

Overlap diagnostics should not simply ignore two patterns because their
priorities differ.

Example:

```ebnf
skip IGNORED priority 10 = /x/ ;
token X priority 0 = /x/ ;

module = X ;
```

The higher-priority skip token consumes `x`. `X` can never reach the parser for
that witness.

The planner should classify overlaps by consequences:

```text
skip wins over parser token    → error
parser token wins over skip    → warning or information
parser token wins over token   → contextual-portability analysis
skip wins over skip            → warning
literal loses to token         → error
literal wins over token        → usually valid
```

For every diagnostic, include both declaration spans and a real witness.

---

## 5. Remove JavaScript regex validation from the EBNF parser

The grammar parser still appears to validate a token declaration with a
JavaScript `RegExp` construction before later portable-regex analysis.

That means Baba effectively has two regex validators:

```text
JavaScript RegExp parser
portable Baba regex parser
```

A regex should not need to be accepted by JavaScript merely because the Stage-0
compiler is implemented in TypeScript.

The EBNF parser should only capture the regex source. Semantic analysis should
call:

```ts
parsePortableRegex(pattern);
```

and store the result.

Change the analyzed token model:

```ts
interface AnalyzedToken {
  readonly patternSource: string;
  readonly pattern: RegexAst;
  readonly nullable: boolean;
  readonly priority: number;
}
```

No target should parse the same regex again.

---

## 6. Tree-sitter still receives raw regex source

The portable runtime is driven by Baba’s regex AST and automata, but Tree-sitter
generation still appears to format the original token pattern as a raw regex
literal.

That does not guarantee shared semantics.

For example, these concepts may differ between engines:

- dot behavior;
- negated classes;
- newline handling;
- astral code points;
- NUL;
- escape interpretation;
- character ranges.

Implement:

```ts
emitTreeSitterRegex(regexAst);
```

The Tree-sitter backend should receive a canonical rendering of Baba’s parsed
regex semantics—not the original spelling.

For constructs whose exact portable meaning cannot be represented in
Tree-sitter, return a backend capability diagnostic.

This is the only defensible meaning of “shared portable regex subset.”

---

## 7. Define and enforce the Wasm memory lifecycle

The Wasm code grows linear memory, but I did not find an obvious public
lifecycle contract describing:

- who owns input memory;
- how results are released;
- whether a later parse invalidates earlier results;
- whether allocations are reset;
- maximum page count;
- pointer-overflow behavior;
- repeated-parse behavior.

A parser cannot safely leak one arena per call.

A simple initial contract would be:

```text
parse_begin(source_length) -> source_pointer
parse_run(source_pointer, source_length) -> result_handle
result_* accessors
parse_reset()
```

Or:

```text
parse(source) uses one internal arena
result remains valid until the next parse or reset
```

Expose:

```text
abi_version() -> u32
plan_version() -> u32
reset() -> void
```

Enforce:

```text
maximum input units
maximum tokens
maximum CST nodes
maximum parser stack
maximum Wasm pages
maximum diagnostics
```

Every size calculation must check 32-bit overflow before:

```text
length × element_size
base + offset
memory.grow
```

Add a test that parses repeatedly—thousands of times—and proves memory stops
growing after reset or arena reuse.

---

## 8. Specify source encoding and span units

TypeScript naturally uses UTF-16 code-unit offsets. Wasm naturally receives
bytes unless Baba explicitly chooses another representation.

The ABI must state exactly what:

```ts
{
  start: number;
  end: number;
}
```

means.

Recommended choices:

### Option A: UTF-16 input

The Wasm adapter copies UTF-16 code units into linear memory.

Advantages:

- exact parity with JavaScript offsets;
- simple cross-target CST comparison.

Disadvantages:

- less natural for non-JavaScript hosts.

### Option B: UTF-8 input with dual offsets

Return:

```ts
interface Span {
  startByte: number;
  endByte: number;
  startUtf16: number;
  endUtf16: number;
}
```

More expensive, but unambiguous.

Whichever model is selected, test:

- non-BMP characters;
- combining sequences;
- CRLF;
- NUL;
- Unicode line separators;
- invalid input encoding.

# P1: architecture and correctness

## 9. Stop converting the analyzed IR back into raw EBNF

The Tree-sitter path appears to reconstruct an `EbnfGrammar` from
`AnalyzedGrammar` and feed it into legacy renderers.

That is an adapter, not genuine IR-based generation.

It introduces several risks:

- resolved references become names again;
- parsed regexes become raw strings again;
- stable IDs are discarded;
- target planning repeats lookups;
- future semantic annotations can be lost.

The dependency should be:

```text
AnalyzedGrammar
    ↓
TreeSitterPlan
    ↓
TreeSitterEmitter
```

Not:

```text
AnalyzedGrammar
    ↓
reconstructed EbnfGrammar
    ↓
legacy string renderer
```

Define a target plan:

```ts
interface TreeSitterPlan {
  readonly root: RuleId;
  readonly rules: readonly TreeSitterRulePlan[];
  readonly tokens: readonly TreeSitterTokenPlan[];
  readonly extras: readonly TreeSitterExtraPlan[];
  readonly queries: QueryPlan;
}
```

Once that exists, delete the IR-to-source-AST reconstruction layer.

---

## 10. Cache automata during overlap analysis

Pairwise overlap analysis appears to build DFAs repeatedly for each pair.

For `n` token patterns, that needlessly repeats determinization inside an
already quadratic comparison loop.

Compute once:

```ts
const automata = new Map<TokenId, Dfa>();

for (const token of tokens) {
  automata.set(token.id, buildDfa(token.pattern));
}
```

Then intersect cached DFAs.

Also add limits:

```ts
interface RegexCompilerLimits {
  regexAstNodeLimit: number;
  boundedRepeatLimit: number;
  nfaStateLimit: number;
  dfaStateLimit: number;
  overlapProductStateLimit: number;
}
```

Without these, a pattern such as:

```regex
(a|b|c|d){100000}
```

can consume significant memory before any generated-byte limit is considered.

Diagnostics should identify the pattern and phase:

```text
REGEX_NFA_STATE_LIMIT
REGEX_DFA_STATE_LIMIT
REGEX_OVERLAP_WORK_LIMIT
REGEX_AST_NODE_LIMIT
REGEX_REPEAT_EXPANSION_LIMIT
```

---

## 11. Optimize DFA transition dispatch

Generated lexer states appear to scan transition ranges linearly:

```ts
for (const [start, end, target] of transitions[state]) {
  ...
}
```

This is acceptable for tiny states, but expensive for grammars with many
character ranges.

Use one of:

- binary search over sorted ranges;
- an ASCII fast table plus range search for non-ASCII;
- state-specific generated switch logic.

A practical structure:

```ts
interface DfaStatePlan {
  readonly ascii?: readonly number[]; // 128 entries when useful
  readonly ranges: readonly RangeTransition[];
}
```

Benchmark before and after. Generated size matters as much as runtime speed.

---

## 12. Replace per-gap relexing in `parseTokens()`

Strict token-stream validation currently appears to re-lex omitted source gaps
independently.

That has two problems:

- repeated gaps cause repeated lexer startup and scanning;
- gap tokenization can differ from tokenization in surrounding context.

Choose a clear contract.

### Strict contract

`parseTokens()` requires complete source coverage, including trivia.

This is easiest and strongest.

### Convenience contract

Allow omitted trivia, but lex the complete source once and compare the supplied
token sequence against that canonical tokenization.

Do not invoke a fresh lexer separately for every gap.

Provide an intentionally unsafe API only if needed:

```ts
parseTokensUnchecked(source, tokens);
```

---

## 13. Specify the internal runtime language formally

The runtime language is now compiler infrastructure. It needs a semantic
specification, even if it remains private.

At minimum define:

- integer widths;
- signedness;
- overflow behavior;
- division by zero;
- shift behavior;
- bounds checking;
- evaluation order;
- boolean representation;
- record layout;
- array/vector ownership;
- text representation;
- allocation lifetime;
- trap versus structured-error behavior.

Example:

```text
u32 addition wraps modulo 2^32
array access traps on out-of-bounds
function arguments evaluate left-to-right
division by zero produces a runtime trap
```

Without this, TypeScript and Wasm backends can both be “correct” while
disagreeing.

Lower runtime-language source to one typed IR:

```text
runtime source
    ↓
typed AST
    ↓
control-flow IR
    ├── TypeScript emitter
    └── Wasm emitter
```

Avoid separate direct AST-to-target implementations.

---

## 14. Add runtime-language conformance tests

Create small programs that exercise every semantic rule:

```text
integer overflow
signed comparison
shift boundaries
nested loops
early return
record field access
array growth
bounds failure
Unicode iteration
allocation reset
```

Compile each program to TypeScript and Wasm, execute both, and compare:

- return values;
- emitted output;
- memory-visible data;
- traps;
- diagnostics.

This suite should be separate from parser tests. It validates the compiler used
to implement the parser runtime.

---

## 15. Add bootstrap reproducibility

The runtime language compiler still needs an existing Stage-0 implementation.
That is fine.

Do not make self-hosting a goal yet.

Instead add:

```sh
deno task bootstrap
deno task bootstrap:check
```

`bootstrap:check` should:

1. Compile the runtime-language sources.
2. Compare generated TypeScript and Wasm artifacts with checked-in artifacts.
3. Verify byte-for-byte determinism.
4. Verify the compiler/runtime semantic version embedded in the artifact.

Store an input hash or manifest:

```json
{
  "runtimeLanguageVersion": 1,
  "compilerVersion": "...",
  "sourceHash": "...",
  "artifactHash": "..."
}
```

This prevents published parser runtimes from silently differing from repository
sources.

# P1: Wasm product boundary

## 16. Be precise about what “Wasm support” means

There are several possible products:

1. Core Wasm module with a custom pointer ABI.
2. Wasm module plus JavaScript adapter.
3. WASI library.
4. Wasm Component with WIT.
5. Browser-only Wasm package.

Do not call all of them simply “Wasm.”

For the first release, something like this is honest:

> Baba emits a core WebAssembly parser runtime with a documented linear-memory
> ABI and an optional JavaScript adapter.

If it only works through the adapter, call it:

> JavaScript-hosted Wasm parser.

A host-neutral claim should require testing outside JavaScript.

---

## 17. Test Wasm in an independent engine

JavaScript’s `WebAssembly.instantiate` only demonstrates compatibility with one
host family.

Add:

- `wasm-tools validate`;
- Wasmtime execution;
- optionally Wasmer;
- Node and browser smoke tests for the adapter.

Test deterministic binary generation:

```text
same grammar + same options → identical .wasm bytes
```

Also test malformed plans and impossible indexes if plans are runtime-loaded.

# P2: API and ergonomics

## 18. Make parse results discriminated unions

Generate:

```ts
export type ParseResult<Root extends AnyRuleNode = RootNode> =
  | {
    readonly ok: true;
    readonly root: Root;
    readonly diagnostics: readonly [];
    readonly tokens: readonly Token[];
  }
  | {
    readonly ok: false;
    readonly root: null;
    readonly diagnostics: readonly ParseDiagnostic[];
    readonly tokens: readonly Token[];
  };
```

This is easier and safer for consumers than:

```ts
ok: boolean;
root: Root | null;
```

---

## 19. Separate significant and trivia token types

Generate impossible states out of the public API:

```ts
interface MainToken<K extends MainTokenKind> {
  readonly channel: "main";
  readonly kind: K;
}

interface TriviaToken<K extends TriviaTokenKind> {
  readonly channel: "trivia";
  readonly kind: K;
}
```

Then:

```ts
type Token =
  | MainToken
  | TriviaToken
  | LiteralToken
  | ErrorToken
  | EofToken;
```

This reduces the work required by `parseTokens()` validation.

---

## 20. Add token ranges to CST nodes

Node source spans do not directly identify surrounding trivia.

Add:

```ts
interface RuleNodeBase {
  readonly span: Span;
  readonly tokenRange: {
    readonly start: number;
    readonly end: number;
  };
}
```

Consumers can then locate comments and whitespace without forcing trivia into
the CST child list.

---

## 21. Provide capability reports

A useful command would be:

```sh
baba check grammar.ebnf --explain-targets
```

Output:

```text
Tree-sitter: supported
TypeScript: supported
Wasm: supported

Portable guarantees:
  ✓ identical regex semantics
  ✓ no external tokens
  ✗ contextual token overlap: TYPE_NAME / IDENT
```

This is more useful than discovering target limitations one error at a time.

# Testing priorities

The highest-value new tests are:

1. **TypeScript–Wasm exact equivalence**

   - token kinds;
   - token spans;
   - diagnostics;
   - CST rules;
   - children;
   - fields.

2. **Tree-sitter acceptance equivalence**

   - valid corpus accepted by all;
   - invalid corpus rejected by all;
   - CST shape is not compared.

3. **Contextual lexical ambiguity**

   ```ebnf
   token A priority 10 = /x/ ;
   token B priority 0 = /x/ ;
   module = "a" A | "b" B ;
   ```

4. **Wasm memory reuse**

   - parse 10,000 times;
   - assert bounded memory growth.

5. **Regex resource exhaustion**

   - very large bounded repeats;
   - alternation explosions;
   - negated classes;
   - many overlapping tokens.

6. **Unicode**

   - emoji;
   - combining marks;
   - CRLF;
   - NUL;
   - U+2028/U+2029.

7. **Runtime-language conformance**

   - every operator and control-flow construct under both backends.

8. **Bootstrap determinism**

   - runtime artifacts regenerate byte-for-byte.

9. **Fuzzing**

   - portable regex parser;
   - NFA/DFA construction;
   - overlap intersection;
   - LR table generation;
   - runtime-language compiler;
   - Wasm ABI;
   - generated parser source input.

# Recommended implementation order

## P0

1. Define `PortableParserPlanV1`.
2. Make the internal runtime language the only implementation of DFA/LR/CST
   execution.
3. Generate both TypeScript and Wasm runtimes from it.
4. Remove JavaScript `RegExp` validation.
5. Emit Tree-sitter regexes from the portable regex AST.
6. Resolve contextual token ambiguity.
7. Define Wasm memory ownership, reset, limits, encoding, and ABI version.
8. Add exact TypeScript–Wasm differential tests.

## P1

1. Make Tree-sitter lower directly from `AnalyzedGrammar`.
2. Cache token DFAs during overlap analysis.
3. Add NFA/DFA/repeat/intersection limits.
4. Optimize DFA transition dispatch.
5. Replace per-gap token-stream relexing.
6. Add a typed runtime-language IR and semantic conformance tests.
7. Add bootstrap reproducibility checks.
8. Validate Wasm with an independent engine.

## P2

1. Discriminated parse results.
2. Separate main/trivia token types.
3. CST token ranges.
4. Target-capability reports.
5. Improved source maps and diagnostic rendering.
6. Parser-conflict witness sequences.

# Bottom line

The runtime-language and Wasm direction is in scope and potentially gives Baba a
major advantage:

> one grammar can produce Tree-sitter integration plus a portable standalone
> parser that runs identically in TypeScript and Wasm.

But that advantage only exists when the runtime language actually eliminates
implementation duplication.

Right now, the most important question is not whether Baba can emit Wasm. It is:

> **Can Baba prove that TypeScript and Wasm are executing the same versioned
> parser plan with the same runtime semantics, memory rules, token choices, CST
> construction, and diagnostics?**

Make that proof the next release milestone.
