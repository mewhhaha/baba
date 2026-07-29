# Changelog

## Unreleased

### Changed

- Wasm core plan format 6 stops duplicating ASCII ranges in sparse lexer rows
  when the complete dense ASCII table is present. Regenerate `parser.plan` and
  `parser.wasm` together.
- Removed the unused private BRL compiler, backends, runtime sources, manifests,
  fixtures, and conformance gates. Shipping runtimes continue to use the
  TypeScript and Rust implementations recorded by the runtime manifest.
- Removed the grammar runtime's incremental parser facade and benchmark because
  each edit reparsed the complete source. Editor integrations should use the
  Tree-sitter target until Baba has a runtime that reuses actual parse work.

## 7.0.0

Three versioned contracts move in this release, and all three require
regeneration: the package (6.1.0 -> 7.0.0), the Wasm core ABI (7 -> 9) and the
core plan format (3 -> 4). Regenerate `parser.wasm` and `parser.plan` together;
a mismatched pair is rejected rather than misread. `PortableParserPlan` version
2 and metadata schema version 2 are unchanged.

The behavioural break to check first: `parse()`, `validate()` and `lex()` no
longer throw `RangeError` on oversized input. They return the structured
`PARSER_INPUT_TOO_LARGE` diagnostic instead, so a caller that catches the throw
needs updating.

### Added

- `PARSER_INPUT_TOO_LARGE` parse diagnostic (runtime code `9`).
- Experimental `@mewhhaha/baba/runtime/webgpu-lexer` export: a WebGPU execution
  backend for the generated tokenizer. It consumes an existing `parser.plan`
  unchanged and produces byte-exact `lex_all` token records. It is async, so it
  cannot be hosted inside the synchronous generated `parser.lex()`; it supports
  guard-free grammars only and refuses others with a structured diagnostic; it
  requires a WebGPU adapter; and it is measurably slower than the shipping lexer
  below roughly 896 KiB of source, with a one-time device setup that no single
  document repays. `docs/webgpu-lexer.md` has the measured numbers and the
  limits, and `docs/stability.md` records that the module carries no
  compatibility or performance guarantee.
- `tests/webgpu_lexer_parity_test.ts` asserts byte-exact parity against the Wasm
  lexer across adversarial, surrogate, boundary and long-token inputs. It skips
  when no WebGPU adapter is present, which is the case in CI.
- `deno task bench:webgpu-lexer`, `deno task bench:webgpu-lexer:pathological`
  and `deno task parity:webgpu-lexer`.
- Generated Tree-sitter targets now lower guarded contextual tokens with
  positive trailing lookahead into named external tokens and a table-driven
  `src/scanner.c`. Positive and negative regex guards, end-of-input
  alternatives, and excluded-word boundaries share the analyzed portable regex
  plan with the Wasm target.

### Changed

- Wasm core ABI version 7 -> 9. Cursor child edges and array items are linked
  node records of two `i32` each rather than contiguous `i32` slices, and the
  internal fragment record widened from 9 to 10 `i32`. `wasm/abi.json` gains
  `core.layouts.cursorChildRecord` and `core.layouts.cursorValueItemRecord`.
  `lex_all` gains `tokenCapacity`, `memoPtr` and `memoCapacity`; `parse_trace`
  and `parse_cursor` gain `memoPtr` and `memoCapacity`; and the new
  `lex_memo_i32_per_position` export sizes the memo buffer. `PortableParserPlan`
  version 2 is unchanged. Regenerate `parser.wasm` alongside the adapter. The
  core plan format also moves this release, to 4; see below.
- `lex_all` takes a capacity for every buffer it writes and rejects an
  undersized one with a status instead of writing past it. It was the only
  buffer-writing export with no capacity argument. `tokenCapacity` must be at
  least `sourceLength` (the worst case is one error token per code point) and is
  rejected with `-1`; the failure memo now has its own buffer, sized
  `(sourceLength + 1) * lex_memo_i32_per_position()` and rejected with `-2`.
  `lex_all` writes nothing into the token records past the count it returns.
  `parse_trace` and `parse_cursor` apply the same memo requirement and report it
  through the statuses they already use for a short token buffer.
- `parser.lex()` is roughly 3x faster and no longer degrades with input size. It
  built two throwaway JavaScript objects per token before returning; the token
  tape now holds the raw records as a single `Int32Array` and materializes a
  `Token` only when `token()` asks for one, which it already did lazily.
  Measured on `funcfuck`: 12.1 -> 35.7 MiB/s at 47 KiB and 11.1 -> 34.8 MiB/s at
  3 MiB, with retained heap dropping from about 113 to 16 bytes per token.
  Trivia filtering uses an index array instead of wrapper objects and is skipped
  entirely when nothing can be dropped. The `LexTapeResult`, `TokenTape` and
  `Token` shapes are unchanged.
- Tree-sitter generation reports `TREE_SITTER_UNSUPPORTED_CONTEXTUAL_GUARD` only
  when its forward-only scanner cannot preserve a guard's longest-match
  behavior, including negative-only, nullable-positive, and overlapping-positive
  guards.

- Core plan format version 3 -> 4. Header slots 31-35 carry the explicit DFA
  start state and the lexer's alphabet equivalence classes (class count, ASCII
  class table, sorted range list). The dense `(state x class)` transition table
  is deliberately not persisted: measured across the four example grammars and
  `fixtures/perf/large-runtime` it is 1.4x to 3.9x the CSR bytes it would
  duplicate and is derivable in one lookup per class. `PortableParserPlan`
  version 2 is unchanged. Regenerate `parser.plan`.

### Removed

- `docs/migrating-to-5.md`, which described upgrading from Baba 4 to Baba 5.
- `src/targets/wasm/module_emit.ts`, a 93-byte re-export with one importer.
- `bench/ts_vs_wasm.ts`. It benchmarked the TypeScript runtime against the Wasm
  one, and the TypeScript runtime was removed in 6.0.0. It has failed to type
  check ever since (it still passes `targets: ["typescript", "wasm"]`), which
  nothing caught because `bench/` is outside `deno task check`, `deno lint` and
  the publish payload. No task, workflow, doc or test referenced it.
- `experiments/webgpu-lexer/`. It held the WebGPU proof-of-concept writeup and
  three `results*.json` files, which `docs/adr/0001` cited as its evidence. They
  benchmark against a version of `lex_all` that no longer exists, so they now
  understate the crossover. The ADR cites the benchmark tasks and the git commit
  instead, and `docs/webgpu-lexer.md` carries the current numbers.

### Fixed

- `fn lex_all` was O(n^2) on backtracking-heavy input and is now linear. The
  shape is a token regex whose scan can run far past its last accepting position
  and then fail, and it is reachable from grammars that compile with no
  diagnostics: `/"([^"\\]|\\.)*"/` on `"\` repeated, `/([0-9a-f][0-9a-f])+;/` on
  `a` repeated, `/([A-Za-z0-9+\/]{4})+=/` on `A` repeated, `/(aa)*b/` on `a`
  repeated. Every scan runs to end of input, finds nothing, emits a one-code-
  point error token and restarts one code point along. The trigger is an
  unterminated literal, which is what a file looks like while it is being typed.

  The memo is keyed by **(position, state)**: one bit per source position per
  DFA state, set for the positions a scan visited after its last accept.
  Re-entering the same pair is the same deterministic future over the same
  input, so the scan stops. Every wasted step therefore lands on a pair no scan
  has visited before or ends the scan, which bounds total work at
  `O(sourceLength * dfaStateCount)`.

  Measured at 32,768 code units, before and after: 5,665 -> 2.36 ms for the hex
  run, 5,692 -> 3.83 ms for the base64 run, 5,897 -> 1.62 ms for the pair run.
  Before, each of those was 4.0x per doubling at every size; after, all four
  shapes are 2.0x. At 65,536 units the hex run goes from 22,680 ms to 4.70 ms.
  The escaped-string shape stays linear and gets slower - 0.85 -> 1.47 ms at
  32,768 - because it has a single scan phase, which is the best case for the
  memo this replaces.

  Emitted token records are byte-identical, `acceptingState` included, because
  the memo is only consulted strictly past the point where the token being cut
  is already decided. Verified i32 by i32 on 1 MiB of source per example grammar
  and on every shape above.

  The memo needs `ceil(dfaStateCount / 32)` i32 per source position in a
  caller-owned buffer - 4 bytes per position for `examples/brainfuck`, 12 for
  `examples/funcfuck`, 32 for `fixtures/perf/large-runtime` - and it is switched
  on lazily, only once a call has thrown away more scan steps than the source
  has code units. Ordinary source regresses 14-20% against 7.0.0's earlier
  per-position memo and is at parity with 6.1.0; the difference is code layout,
  not work, and `docs/performance.md` has the controls that show it, along with
  the curves, the memory table and the shapes.

  This supersedes the per-position failure memo added earlier in this release,
  which fixed only the escaped-string shape. Scans starting at offsets in
  different phases of a repeated group reach the same position in different
  states, evict each other's single entry, and never hit.

- The DFA start state was hardcoded to `0` in the Rust engine and the WebGPU
  kernel and was never stored in the plan, so a plan whose DFA started anywhere
  else would have been mislexed with nothing to detect it. It is now an explicit
  plan field that both consumers read.
- The WebGPU backend's documented crossover was stale. Removing the lexer's dead
  ASCII fall-through made `lex_all` faster - about 48-50 MiB/s where it
  previously measured 44-48 - so the point where the GPU backend starts winning
  moved up from 768 KiB to **896 KiB** of source. At 768 KiB it now measures
  0.90x and loses. `docs/webgpu-lexer.md`, `docs/stability.md` and
  `docs/adr/0001` are corrected, and all three now say the threshold moves
  whenever the CPU lexer gets faster.
- `parser.parse()` no longer runs out of WebAssembly memory on ordinary inputs.
  The cursor engine materialized every repetition list by copying the whole
  accumulated list on each element, so the child and value-item arenas grew as
  `items^2 / 2`. That capped repetition-heavy grammars at roughly 8,000-9,000
  list elements whatever the file size: `examples/brainfuck` threw at 8,186
  characters of `+`, and `examples/feature-tour` threw at 238,560 bytes of its
  own repeated sample program. Child edges and array items are now singly linked
  node arenas, so appending one element is constant time and every cursor arena
  is linear in the token count. `examples/brainfuck` now parses 6 MiB, measured
  flat at 2.00 rule / 3.00 child / 2.00 field / 8.00 value / 3.00 value-item
  records per token across a 32x size range, and the `examples/feature-tour`
  source that used to throw now parses, as does one 11x larger. Cursor result
  shapes are unchanged.
- An input that genuinely exceeds the wasm32 address space now returns the
  structured `PARSER_INPUT_TOO_LARGE` diagnostic from `parse()`, `validate()`
  and `lex()` instead of throwing `RangeError`. The message names the byte count
  the call would need, the 4,294,901,760 byte limit, and the source size. The
  ceiling itself is intrinsic to wasm32 and remains; `docs/limits.md` documents
  it. On `lex()` the diagnostic accompanies a tape holding only the synthetic
  end-of-file token, so `LexDiagnostic.code` is now a union of
  `LEX_UNEXPECTED_CHARACTER` and `PARSER_INPUT_TOO_LARGE` in both the adapter
  and generated `syntax.ts`.
- `PARSER_INPUT_TOO_LARGE` from `validate()` no longer advises splitting an
  input that is not the problem. The trace buffer is sized as `maxTraceActions`
  i32 values, so a large enough `maxTraceActions` exceeded the address space for
  a ten-character source while the message still said to split the input. It now
  names the trace byte count and the `maxTraceActions` value and asks for a
  lower one.
- `RuleCursor.child(index)` is constant time again for reverse and random
  access. Linked child edges made every backward step restart the walk at the
  head of the list, which is quadratic: reverse traversal of a 40,000-child
  repetition measured 2,106 ms against 13 ms forward, and shuffled access 1,402
  ms. The first non-monotonic access now materializes a child-node index for
  that rule once, one `i32` per child; the same traversals measure 8 ms and 10
  ms. Purely sequential traversal is unchanged and allocates nothing.
- The Rust `fn transition` no longer does provably dead work on ASCII input. It
  consulted the plan's dense ASCII table and then, on a negative cell, still
  fell through to the sparse CSR range scan. `buildAsciiTransitions` writes
  every ASCII code point of every transition of every state, so the scan could
  only ever reach the same answer. Token tapes are byte-identical, the engine
  grew 9 bytes, and `tests/wasm_lexer_ascii_table_test.ts` pins the
  dense-versus-sparse equivalence the early return depends on. Regenerate
  `parser.wasm`.

  On the isolated lexer loop this measured -7% to -10% (p25 of 80 paired
  interleaved iterations over 200k code units: `thunkwasm` -10.4%, `brainfuck`
  -7.1%, `funcfuck` -7.0%, `fixtures/perf/large-runtime` -8.9%,
  `fixtures/perf/parser/tiny-dsl` -7.1%). It does **not** reliably show up in
  end-to-end `parser.lex()` throughput, which measured flat against the previous
  release on a median-of-9 run at 47 KiB, 752 KiB and 3 MiB. Treat this as an
  engine-loop improvement and a removal of dead code, not as a user-visible
  throughput claim.
- The adapter sized its cursor arenas from the source character count, at 9,106
  bytes of linear memory per character. They are now sized from the token count
  with measured per-token multipliers.
- Grammar source containing non-ASCII characters is no longer misread. The
  grammar scanner accumulated token text one UTF-8 byte at a time, widening each
  byte to the code point of its own numeric value, so `À` (U+00C0, encoded
  `C3 80`) became the two code points U+00C3 and U+0080. A class written
  `/[À-ɏ]+/` therefore compiled to a DFA cutting at the UTF-8 lead bytes and
  rejected most of the characters it names, and a literal terminal such as `"→"`
  could not match itself. Both the regex-literal and string-literal scanners now
  read whole characters. Grammars containing only ASCII are unaffected, and
  their generated artifacts are unchanged.

## 6.1.0

### Added

- Restored the `tree-sitter` target for `grammar.js` generation and
  Tree-sitter-specific metadata for extras, word selection, supertypes,
  conflicts, inline rules, precedence, aliases, and hidden paths.

### Changed

- `--target all` emits both Wasm and Tree-sitter artifacts again. Unguarded
  contextual tokens lower to Tree-sitter lexical rules; guarded contextual
  tokens report a target-specific diagnostic.

## 6.0.0

### Added

- Added portable trailing lookahead guards for contextual tokens. Generated Wasm
  parsers can promote guarded whitespace and terminator tokens according to
  parser state without external scanner callbacks.

### Changed

- Bumped the portable parser-plan format to version 2, runtime semantics to
  version 2, and the Wasm core-plan format to version 3. Existing generated
  plans must be regenerated.

### Removed

- Removed the unpublished legacy TypeScript `ParserKit` runtime. The generated
  Wasm runtime and portable parser-plan version 2 are now the only parser
  execution path.
- Removed the legacy EBNF object/parser entry path and test-only portable-plan
  compatibility modules. Public compilation now accepts grammar source or the
  canonical `GrammarDocument` returned by `parseGrammar()`.
- Removed `metadata.externals`; external scanner callbacks are replaced by
  portable contextual tokens.
- Removed ignored Tree-sitter grammar-generation metadata and the no-op
  portability mode. Metadata now owns parser conflict policy and generated query
  configuration only.
- Removed duplicate deprecated `array` and `nullable` flags from v2 CST field
  plans. `cardinality` is the sole serialized field-shape contract.

## 5.1.0

### Added

- Added a `tree-sitter` generation target that emits `grammar.js` alongside
  non-empty query fragments. `--target all` emits both Wasm and Tree-sitter
  artifacts.
- Restored Tree-sitter metadata lowering for conflicts, lexical and parse
  precedence, aliases, hidden/inline rules, extras, and user-owned external
  scanners.

## 5.0.0

### Added

- Added parser-plan runtime metadata subsection version 2 and exposed
  `parserPlanRuntimeMetadataVersion` from generated modules, manifests, and ABI
  descriptors.
- Added combined-plan inspection with exact core and runtime-metadata sizes and
  core table counts.

### Changed

- Made `@mewhhaha/baba/runtime/generated-wasm` the only public runtime export.
- Required synchronous parser creation to provide `plan` and exactly one of
  `bytes` or `module`. Asynchronous creation now requires exactly one of
  `bytes`, `module`, or `url`, and exactly one of `plan` or `planUrl`.
- Reduced generated parse options to `preserveTrivia` and `maxTraceActions`.
- Replaced the full TypeScript `ParserKit` copy in `parser.plan` with minimal
  host metadata. Core DFA/LR tables, productions, reducers, and planning
  statistics are no longer duplicated.
- Slimmed the generated Wasm loader to the source-only cursor, lazy lexer tape,
  trace validation, diagnostics, memory, reset, and disposal paths.
- Prepared package metadata and documentation for version 5.0.0.

### Removed

- Removed the `@mewhhaha/baba/runtime/wasm` compatibility facade and generic
  Wasm executor.
- Removed `contextualLexingStats`, `maxExploredBranches`, `ambiguityMode`, and
  the unused parser-creation `validate` option from the generated API.
- Removed generated public `PARSE_INVALID_TOKEN_STREAM` and
  `PARSER_BRANCH_LIMIT` diagnostics and numeric helpers. Their numeric IDs
  remain reserved by the internal reference runtime.
- Stopped publishing the internal TypeScript reference runtime, public BRL
  materializers, and modular BRL Wasm backend files.

Metadata-v1 `parser.plan` files must be regenerated with Baba 5. The portable
parser-plan version remains 1 and the Wasm ABI remains version 7. See
[Migrating to Baba 5](docs/migrating-to-5.md) for required consumer changes.

## 4.0.0

### Added

- Added a Rust/Wasm grammar parser frontend with embedded parser bytes and a
  drift-checkable build task.

### Changed

- Made `.baba` grammar sources canonical and changed `parseGrammar()` to return
  the current grammar document shape directly.
- Routed Wasm generation through the current grammar analysis instead of an EBNF
  compatibility lowering step.
- Removed versioned grammar-stack names from source files, tests, helper APIs,
  and grammar diagnostics.
- Split the generated Wasm runtime bytes from the hand-authored runtime facade.

### Removed

- Removed the old TypeScript grammar parser source and syntax-level EBNF
  lowering adapter.
- Replaced tracked example and fixture `grammar.ebnf` files with `grammar.baba`
  sources.

## 3.1.0

### Added

- Restored generated Tree-sitter query fragments alongside the Wasm parser
  bundle. Non-empty `queries/generated-*.scm` files are emitted for highlights,
  locals, folds, indents, tags, textobjects, rainbows, and injections.

### Changed

- Documented generated editor query output in the README and Wasm docs.

### Removed

- Removed stale bundle helpers for the old generated `grammar.js` Tree-sitter
  target.

## 3.0.0

### Added

- Added cursor-first generated parser output types in `syntax.ts`, including
  typed `RootCursor` and rule cursor surfaces for parser consumers.
- Added a Rust-authored, ahead-of-time built generic Wasm parser engine with
  embedded runtime bytes and a `build:wasm-engine:check` drift check.
- Added a current-state docs index and publish the maintained docs set with the
  package.

### Changed

- Updated README, docs, and examples to describe the current generated Wasm
  parser API: cursor parse, lazy lex tape, validation trace, reset, and dispose.
- Changed generated Wasm parser instances so `parse()` returns cursor parse
  results. The generated parser API no longer exposes CST/object parse modes.
- Changed generated `lex()` to return a lazy token tape and changed `validate()`
  to use Wasm trace validation without token or CST construction.
- Changed the Wasm core ABI to version 7. Hosts must load `parser.plan` at the
  exported `plan_buffer_base()` instead of assuming offset zero.
- Changed `parser.plan` core table encoding to format 2 with compact DFA/LR
  sections, reducing large grammar plan size while keeping `parser.wasm`
  grammar-independent.
- Changed runtime benchmarks to report `lexTape`, `validateTrace`, and
  `cursorParse` for the supported generated Wasm API.

### Removed

- Removed generated public `parse()` mode overloads that returned different
  shapes through the main generated Wasm parser API.
- Removed generated public `parseTree()`, `parseTokens()`, and
  `parseTokensUnchecked()` migration hooks.
- Removed generated public bulk token-object materialization helpers
  `LexTapeResult.tokens`, `LexTapeResult.toTokens()`, and
  `TokenTape.toTokens()`.
- Removed generated CST node and `ParseResult` types from `syntax.ts`.
- Removed obsolete ADR, research, and stale versioned public docs from `docs/`.

## 2.0.1

### Changed

- Removed obsolete cleanup task notes from the repository.
- Updated README metadata examples to match the schema 2 conflict and path
  selector requirements.

### Fixed

- Removed leftover metadata-version plumbing from Tree-sitter metadata path
  validation.

## 2.0.0

### Removed

- Removed legacy public metadata aliases `TreeSitterMetadata` and
  `parseTreeSitterMetadata`; use `BabaMetadata` and `parseMetadata`.
- Removed metadata schema `version: 1`, legacy parser conflict selectors,
  rule-array branch declarations, `rules.*.fields`, and numeric path
  compatibility. Metadata schema `version: 2` is current, and parser conflict
  metadata must use stable conflict IDs.
- Removed CLI compatibility aliases `--ts-meta`, `--generated-byte-limit`, and
  `--verbose`, plus special removed-option diagnostics for `init`, `--preset`,
  and `--backend`.
- Removed generated Wasm adapter exports `createParserFromBytes`,
  `createParserFromModule`, and `createParserFromUrl`.
- Removed tracked `examples/*/generated` outputs from the repository.

### Added

- Added `--typescript-generated-byte-limit` for explicit TypeScript target size
  limits.

### Changed

- Generated examples are ignored local artifacts. `deno task bootstrap:check`
  regenerates examples into temporary directories, validates manifests, and
  type-checks generated entrypoints instead of byte-comparing committed
  snapshots.
- Size reports keep local generated example bytes informational; CI size budgets
  gate publish payloads, not ignored generated example outputs.

## 1.6.0

### Added

- Added `PortableParserPlan`, a versioned target-neutral parser-plan contract
  with canonical lexer DFA tables, LR action/goto tables, reducer opcodes, CST
  schema, diagnostic schema, statistics, deterministic JSON serialization,
  metadata hashes, validation, and parser-kit/TypeScript/Wasm adapters.
- Added stable structural production IDs and stable LR conflict IDs, plus
  metadata selectors that can target conflicts by ID while preserving legacy
  selectors with exact matching and migration diagnostics.
- Added bounded parser branch-search semantics, shared branch/resource limits,
  ambiguity diagnostics, and TypeScript/Wasm parity coverage for declared parser
  conflicts.
- Added parser-contextual token selection for overlapping tokens while keeping
  standalone `lex()` globally deterministic and documenting the relationship
  between `lex()`, `parse()`, `parseTokens()`, and `parseTokensUnchecked()`.
- Added first-class binary generated artifacts, binary-safe manifests and output
  writes, Wasm packaging modes, external `parser.wasm` output, and generated
  Wasm ABI/runtime descriptors.
- Added the private BRL runtime-language frontend, typed IR, verifier,
  TypeScript backend, Wasm backend, runtime source modules, conformance
  fixtures, compiler manifests, artifact manifests, and bootstrap drift checks.
- Added generated parser runtime implementation identity metadata with checked
  source hashes and provenance banners in generated runtime outputs.
- Added a versioned Wasm ABI document and generated exports for ABI version,
  parser-plan version, runtime semantics version, memory layout, encoding,
  ownership, result lifetime, reset, resource limits, and adapter capability
  metadata.
- Added parser instance APIs for generated Wasm adapters, including
  `createParser`, `createParserAsync`, reset/dispose behavior, instance-owned
  memory/state, repeated parse reuse, and worker/concurrency coverage.
- Added compiler hardening for parsed regex reuse, regex/NFA/DFA/overlap work
  limits, grammar depth/productivity/nullability diagnostics, diagnostic caps,
  lexical shadowing analysis, and analysis statistics.
- Added portable fixture corpora, exact TypeScript/Wasm parity gates,
  Tree-sitter portable-subset acceptance gates, BRL backend conformance gates,
  deterministic fuzz seeds, machine-readable benchmark output, bootstrap drift
  checks, size budgets, and scheduled quality workflows.
- Added focused documentation for grammar syntax, metadata, portable runtime,
  TypeScript target, Wasm target, Wasm ABI, diagnostics, limits, examples,
  contributing, stability levels, and architecture decision records.
- Added a `feature-tour` example covering contextual lexing, parser conflicts,
  generated query metadata, TypeScript/Wasm APIs, parser-kit, parser-plan and
  runtime identity, token-stream validation, Wasm limits, and external Wasm
  packaging.

### Changed

- TypeScript, Wasm, and parser-kit targets now share one runtime planning pass
  and consume the same portable parser plan instead of rebuilding runtime data
  independently.
- Generated TypeScript and JavaScript-hosted Wasm parser runtimes now use the
  shared runtime-language helper layer for lexer scan/candidate lookup, parser
  traces, branch scheduling, token-stream validation, reducer dispatch, CST
  field assembly, accepted-root classification, and runtime diagnostic payloads.
- Wasm target packaging now separates the core Wasm runtime, parser trace Wasm
  helper, JavaScript adapter, ABI descriptor, manifest, and optional external
  binary artifact.
- Generated examples were refreshed against the current parser plan, runtime
  implementation identity, Wasm ABI metadata, provenance banners, and shared
  runtime-language helper artifacts.
- CLI help, target options, diagnostics, docs, and tests now describe shared
  portable runtime limits and Wasm-specific size/stat flags consistently.
- Package publish contents now exclude generated example snapshots while size
  reports and budgets explicitly track publish payload and checked-in generated
  snapshots.
- Release CI now installs independent Wasm and Tree-sitter tools and runs named
  gates for formatting, lint, type checking, full tests, parity, BRL
  conformance, portable fixtures, Tree-sitter acceptance, fuzz seeds, bootstrap
  drift, runtime smoke, size budgets, benchmark JSON, and publish dry run.

### Fixed

- Fixed multi-target portability defaults so one semantic target defaults to
  warnings, multiple semantic targets default to strict portability, and
  explicit user settings are preserved.
- Fixed duplicate TypeScript/Wasm planning work by proving TypeScript plus Wasm
  builds the shared portable runtime plan once per compile.
- Fixed `validateGrammar()` and `compile()` drift for shared planning
  diagnostics.
- Removed diagnostic message rewriting that replaced TypeScript wording with
  Wasm wording; shared planning diagnostics are now backend-neutral.
- Removed substring-based parser conflict matching through
  `description.includes(...)`; legacy selectors now require exact structural
  origin matches.
- Removed legacy target-local TypeScript lexer emitter responsibilities and
  target-local Wasm contextual DFA scan tables from generated runtime emitters
  where shared runtime-language helpers own the behavior.
- Fixed Wasm memory/lifetime hazards through instance-owned memory, reset and
  disposal checks, source-buffer ownership, handle provenance, memory growth
  view refresh, overflow checks, and structured resource-limit failures.

## 1.5.2

### Changed

- Moved more generated parser replay, token-stream validation, and field
  assembly decisions into shared runtime-language helpers so TypeScript, Wasm,
  and parser-kit consumers continue converging on the same runtime semantics.
- Refreshed generated examples and runtime manifests for the updated
  runtime-language artifacts.

## 1.5.1

### Changed

- Moved additional generated parser/runtime classification decisions into the
  shared runtime-language helper layer, including field schema validation,
  scalar and array field value status, and rule-node child-list status.
- Refreshed generated examples and runtime manifests so bootstrap checks prove
  the checked-in artifacts match the current runtime sources.

## 1.5.0

### Added

- Added the compact parser-kit `runtime` profile for helper-only consumers.
- Added portable parser-plan v1 metadata and hashes to generated TypeScript,
  generated Wasm, and parser-kit outputs.
- Added `check --explain-targets` capability reporting.
- Added regex compiler resource limits for parsed AST size, bounded repeat
  expansion, NFA/DFA construction, and overlap analysis.
- Added Wasm ABI/version/reset exports and repeated-parse memory reuse coverage.
- Added bootstrap reproducibility tasks for checked-in generated examples.
- Added TypeScript/Wasm/kit parity coverage for parser plans, conflict branches,
  token streams, spans, and CST token ranges.
- Added runtime implementation identity metadata and a checked source manifest
  for generated TypeScript, generated Wasm, and parser-kit outputs.
- Added a private runtime-language v1 semantic seed with TypeScript/Wasm
  conformance tests for the initial `u32` executable subset.
- Added a checked Stage-0 runtime-language compiler source manifest to
  `bootstrap:check`.
- Expanded the private runtime-language conformance subset with `u32`
  parameters, locals, assignments, branches, and loops.
- Added runtime-language unsigned less-than plus tagged arena-backed `u32`
  array, fixed-record, and growable-vector helper substrates with reset,
  allocation overflow checks, wrong-kind traps, stale-handle traps, and
  bounds-checked load/store/append conformance across TypeScript and Wasm.
- Moved deterministic runtime-language parser trace stack and accepted-action
  storage onto arena-backed growable vectors, with vector truncation used for LR
  reductions.
- Added rich generated Tree-sitter highlight defaults with contextual
  `parent`/`field` selectors, comment/string/number/constant/builtin/type/member
  inference, contextual identifier captures, and a `minimal` compatibility mode.
- Moved the generated TypeScript lexer UTF-16 code-point width helper onto a
  runtime-language source with TypeScript/Wasm conformance coverage.
- Added runtime-language function calls and multi-function TypeScript/Wasm
  conformance coverage.
- Added read-only `u32` runtime-language tables with checked TypeScript/Wasm
  table-load conformance coverage.
- Moved generated TypeScript lexer DFA transition lookup onto a runtime-language
  source program backed by read-only `u32` tables.
- Added TypeScript/Wasm runtime-language conformance coverage for the generated
  DFA transition helper.
- Added runtime-language lexer scan helpers for longest-match accept tracking,
  with TypeScript/Wasm conformance coverage for accepting candidate selection.
- Added a runtime-language lexer token diagnostic status helper for external
  token-stream lexical diagnostic classification.
- Moved generated deterministic TypeScript parser action/goto table lookup onto
  a runtime-language source program backed by read-only `u32` tables.
- Moved generated conflict-parser TypeScript goto lookup onto the same
  runtime-language table helper.
- Moved generated conflict-parser TypeScript multi-action lookup onto a
  runtime-language `parserActionAt` helper.
- Added growable checked `u32` scratch memory to the private runtime-language
  subset, with matching TypeScript/Wasm conformance coverage for stack-like
  load/store behavior and explicit growth.
- Added a runtime-language parser trace helper for deterministic LR parser
  control flow, with TypeScript/Wasm conformance coverage for emitted action
  traces.
- Added a resolved runtime-language IR boundary so TypeScript and Wasm runtime
  compiler backends consume one validated program model with resolved entry,
  function, table, scratch-memory, control-flow, and value metadata.
- Added a checked runtime-language artifact manifest for canonical helper
  programs, including source, TypeScript output, and Wasm output hashes verified
  by `bootstrap:check`.
- Added runtime-language parser expected-terminal range helpers and use them in
  generated TypeScript and Wasm-adapter parse diagnostics.
- Added runtime-language parser production metadata helpers and use them for
  generated TypeScript and Wasm-adapter reduce replay.
- Added a runtime-language `andU32` operator plus parser action kind/payload
  helpers for generated TypeScript, Wasm-adapter, and parser trace action
  decoding.
- Added a runtime-language parser replay action status helper for generated
  trace replay shift/reduce/accept dispatch.
- Switched the core Wasm parser trace decoder to the shared runtime action
  kind/payload masks.
- Added a runtime-language `parserActionCount` helper for conflict parser action
  fan-out.
- Moved generated TypeScript conflict-parser branch scheduling onto a
  runtime-language `parserTrace` helper with scratch-memory branch frames.
- Added multi-export support to the private runtime-language Wasm compiler and
  use it to package a runtime-language Wasm parser trace module for generated
  Wasm adapters.

### Changed

- Parser-kit JSON defaults to the schema-rich `full` profile; the `runtime`
  profile emits minified JSON and omits LR item/lookahead and production
  origin/span detail not needed by `lexWithKit()` or `parseWithKit()`.
- Standalone parser targets now share a versioned runtime parser planning layer
  for lexer DFA construction, BNF lowering, LR tables, field schema collection,
  reducer metadata, and diagnostics.
- TypeScript target emitters now package shared runtime source from
  `src/targets/runtime/` instead of carrying lexer/parser execution templates
  directly under `src/targets/typescript/`.
- Deterministic generated TypeScript parsers now drive LR shift/reduce/accept
  control flow through a runtime-language `parserTrace` helper and replay the
  resulting action trace to construct the CST.
- Generated TypeScript lexers now use runtime-language `lexerScan*` helpers for
  DFA accept tracking instead of carrying a generated `DFA_ACCEPTS` table and
  accept loop.
- The Wasm target now packages its core bytecode runtime emitter from
  `src/targets/runtime/` instead of carrying it directly under
  `src/targets/wasm/`.
- Generated Wasm adapters now run LR parser trace control flow through a
  runtime-language Wasm module and replay the returned trace in TypeScript to
  build CST nodes and diagnostics.
- The core Wasm bytecode runtime no longer emits or exports the legacy
  `parse_trace` LR execution function; generated adapters use the
  runtime-language trace module instead.
- Generated parsers now read reducer descriptor kind/payload metadata through
  runtime-language `parserReducerKind`/`parserReducerPayload` helpers instead of
  generated reducer-object tables.
- Generated parser replay now classifies reducer operations through
  runtime-language `parserReducerOperation` instead of switching directly on raw
  reducer descriptor kinds.
- Generated parser replay now validates rule/field reducer payload presence
  through runtime-language `parserReducerPayloadStatus`.
- Generated parser replay now reads reducer child-role requirements through
  runtime-language `parserReducerChildRole` before converting reduced values at
  the TypeScript object boundary.
- Generated parser replay now reads reducer result-shape classes through
  runtime-language `parserReducerResultKind` before assembling fragments, field
  captures, arrays, and rule nodes.
- Generated parsers now read CST field schema rows/config through
  runtime-language `parserField*` helpers instead of generated field-schema
  lookup object tables.
- Generated parser field assembly now uses runtime-language field value-class,
  capture-status, and final-status helpers for required/nullable/array
  cardinality decisions.
- Generated TypeScript lexers now read token spec classification, payload, and
  terminal metadata through runtime-language `lexerSpec*` helpers instead of a
  generated JavaScript spec-discriminant table.
- Generated TypeScript lexers and parser token-stream validation now use
  runtime-language `lexerSpecTokenClass` for literal/main/trivia classification.
- Generated Tree-sitter highlights now default to rich inference; use
  `queries.highlights.defaults.mode: "minimal"` for the previous literal-only
  keyword/punctuation/operator defaults.
- Generated parser token-stream validation now delegates public token
  literal/main/trivia compatibility decisions to runtime-language
  `lexerSpecPublicTokenStatus`.
- Generated parsers now map external `parseTokens()` token strings to lexer spec
  indexes and use runtime-language `lexerSpec*` helpers for channel and terminal
  metadata instead of generated terminal/channel lookup tables.
- Generated parser replay now uses runtime-language `parserMergeStart`/
  `parserMergeEnd` helpers for CST span and token-range merging.
- Generated parse diagnostics now use runtime-language `parserExpectedHasEof`
  state flags to choose trailing-input diagnostics instead of scanning expected
  display strings.
- Generated TypeScript parsers and Wasm adapters now classify parser trace
  statuses through runtime-language `parserTraceStatusKind` instead of hardcoded
  status numbers.
- Generated parser trace replay now classifies reduction validity through
  runtime-language `parserReplayReductionStatus` before emitting internal
  diagnostics for unknown productions, missing reducer payloads, or stack
  underflow.
- Portable regex validation now uses Baba's regex parser instead of JavaScript
  `RegExp`, and Tree-sitter regexes are emitted from the parsed Baba regex AST.
- `parseTokens()` now validates external token streams against one canonical
  whole-source lex rather than relexing gaps independently.
- The Wasm target is documented as a JavaScript-hosted core Wasm adapter rather
  than a host-neutral Wasm ABI.

## 1.4.0

### Added

- Added the generic parser-kit target with `--target kit`, `--kit-dir`, and
  generated `kit/parser-kit.json` output.
- Added `compileParserKit()` and the public `@mewhhaha/baba/kit` module with
  ParserKit schema types, schema validation, token/terminal mapping helpers, and
  reference `lexWithKit()` / `parseWithKit()` helpers.

### Changed

- TypeScript, Wasm, and kit planning now share the same standalone runtime
  analysis for lexer DFA construction, BNF lowering, LR tables, reducer specs,
  field schemas, diagnostics, and conflict policy.
- `--target all` remains the existing Tree-sitter plus TypeScript/Wasm output
  set; generate the parser kit explicitly with `--target kit`.
- Default portability diagnostics are strict only when Tree-sitter is selected
  with another target; runtime-only target combinations default to warnings.

## 1.3.0

### Added

- Added actionable LR conflict diagnostics that suggest
  `metadata.parser.resolutions` entries, declared `metadata.parser.conflicts`
  branches, and explicit reduce candidates for reduce/reduce conflicts.
- Added structured user-facing diagnostics for metadata and Tree-sitter
  validation failures, including stable codes plus backend, path, and span
  details when available.

### Changed

- Generated TypeScript parsers now emit branch-search runtime support only for
  grammars with declared parser conflicts.
- Generated Wasm parser adapters now use an explicit Wasm emission mode instead
  of rewriting the TypeScript parser output.
- Generated syntax types now share an `EmptyFields` type for nodes without
  fields.

### Fixed

- Fixed Tree-sitter `grammar.js` regex literal emission for Baba regexes that
  contain escaped slash delimiters, such as line comments written with
  `/\/\/[^\n\r]*/`.
- Removed unused generated parser constants and helpers from deterministic
  TypeScript and Wasm parser outputs.

## 1.2.0

### Added

- Added `parser.resolutions` metadata for explicit TypeScript LR conflict
  resolution.
- Added `parser.conflicts` metadata for bounded TypeScript parser branch
  exploration through declared local ambiguities. Wasm bundles trace the same
  declared conflict branches in the generated Wasm parser engine.

### Changed

- The TypeScript BNF lowering now avoids unnecessary helper reductions for
  direct terminals and rule references in sequence/list positions, reducing
  artificial LR conflicts.
- The Wasm parse-trace engine now supports declared parser conflict branches
  without falling back to the generated TypeScript parser loop.

## 1.1.0

### Added

- Added the standalone TypeScript target with a generated table-driven DFA
  lexer, canonical LR(1) parser, typed CST, and `parseTokens()` API.
- Added explicit lexical priorities with `priority <number>` on token and skip
  declarations. Priorities lower to both TypeScript and Tree-sitter.
- Added strict/warn/off portability mode. Multi-target generation defaults to
  strict and rejects known Tree-sitter/TypeScript acceptance differences.
- Added TypeScript CLI options for output directory, trivia preservation, parser
  state/item/table-entry/generated-byte limits, parser statistics, and
  portability.

### Changed

- Regex validation now uses one portable regex parser shared by both targets.
- Reachability diagnostics are target-neutral and reported by shared compiler
  analysis.
- Tree-sitter grammar emission now consumes the shared analyzed grammar used by
  the TypeScript planner.
- Tree-sitter query bundle emission now has analyzed-grammar entrypoints.
- LR item sets now store lookaheads as bitsets and simple choice alternatives
  avoid unnecessary synthetic BNF helper productions.
- The regression suite is split into API, lexer, parser, Tree-sitter, output,
  and shared helper files.

### Fixed

- Generated TypeScript field array types use `ReadonlyArray<T>`.
- `parseTokens()` validates EOF placement, token widths, source gaps, and
  token-kind/channel consistency.
- TypeScript lexer overlap diagnostics use automata intersections and real
  witness strings.
- Generated lexers treat non-BMP Unicode code points consistently.
- Runtime CST field construction checks required, nullable, array, and unknown
  field-capture invariants.
- Output path collision detection now checks every generated path ancestor.
- TypeScript parser conflicts now report user rule origins instead of only
  synthetic BNF nonterminals.

## 1.0.0

### Changed

- Baba is now a Tree-sitter compiler only: explicit EBNF in, `grammar.js` plus
  non-empty generated query fragments under `queries/generated-*.scm` out.
- Generated-file ownership is available through the public `applyBundle()` API.
- Root reachability is part of generation: unreachable rules are omitted and
  reported as warnings.
- Metadata is limited to Tree-sitter shaping and query configuration.
- Metadata now accepts schema `version: 1` and explicit `externals` declarations
  for user-owned Tree-sitter scanners.
- EBNF supports named fields such as `name:ident`, and versioned metadata uses
  those names instead of positional expression indexes.
- `source_file` now references the selected root rule, preserving the root node
  in generated syntax trees.
- CLI generation accepts `--root <rule>`.

### Removed

- Removed the `workbench` preset.
- Removed TypeScript tokenizer/parser generation from the public API and CLI.
- Removed implicit token builtins, including `ident`, numeric/string/char
  syntax, comments, layout tokens, and fenced block tokens.
- Removed formatter, LSP, AST facade, editor scaffold, package metadata, and
  project template generation.
- Removed fabricated `tree-sitter.json`, `package.json`, license, author,
  version, and binding metadata.
- Removed CLI `init`, `--backend`, `--preset`, and `--ts-out`.

### Fixed

- Generated artifacts are now exercised by tests with `tree-sitter generate`,
  `tree-sitter build`, `tree-sitter parse`, and `tree-sitter query`.
- Unreachable rules no longer affect generated Tree-sitter output.
- Query defaults are based on reachable literals and no longer infer semantic
  captures from token names.
- Generated query fragments no longer occupy user-owned `queries/*.scm` paths.
- Versioned metadata rejects legacy numeric expression paths.
- Query metadata is validated against the selected root graph.
- Token and skip regexes now reject known Tree-sitter-incompatible constructs
  such as lookaround assertions and backreferences.
- `validateGrammar()` now returns independent span-aware semantic diagnostics
  instead of wrapping only the first thrown error.
- CLI grammar validation now reports all independent grammar errors before
  generation, and fatal diagnostics respect `--diagnostic-format json`.
- `applyBundle()` rejects unsafe generated paths that are absolute, empty,
  backslash-based, or contain `..` components.
- Library users can safely apply bundles without reimplementing manifest
  ownership checks.

## 0.5.0

### Changed

- Core generation now defaults to the Tree-sitter backend only. Use
  `backends: ["typescript-ll1"]`, CLI `--backend typescript-ll1`, or
  `--backend all` to generate the standalone TypeScript tokenizer/parser.
- The core Tree-sitter backend now owns `grammar.js`, `tree-sitter.json`, and
  the complete `queries/*.scm` set.
- Parser-only generation no longer validates Tree-sitter query/workbench
  metadata.

### Fixed

- Generated-file protection now trusts only manifest hashes. A generated marker
  no longer authorizes overwrite or stale-file deletion.
- Manifest cleanup now derives stale files from the previous manifest, so
  backend and preset switches remove files Baba previously owned.
- CLI generation now emits bundle diagnostics to stderr, including
  `--list-files`, with `--diagnostic-format text|json`.
- Generated core tokenizers now receive `language.comment` metadata.
- Default Tree-sitter highlight captures now filter literals, token captures,
  literal wrappers, and aliases by the selected root.

## 0.4.0

### Added

- Added explicit core backend selection with `generate(..., { backends })` and
  CLI `--backend tree-sitter`, `--backend typescript-ll1`, or `--backend all`.
- Added structured non-fatal bundle diagnostics for highlight query coverage,
  including `QUERY_UNCAPTURED_CONTEXT`.
- Added CLI generated-file ownership tracking through `.baba-manifest.json` and
  overwrite/remove protection for modified or unowned files.

### Changed

- `--ts-out` without `--out` now generates only the Tree-sitter grammar/query
  output and does not build the standalone TypeScript parser backend.
- Tree-sitter highlight default reachability now starts from the selected root
  rule instead of the first grammar rule.
- EBNF parsing now reuses one line-start table per parse when producing spans.

### Fixed

- `number` is now a consistent builtin across validation, tokenizer/parser
  matching, Tree-sitter generation, highlighting, and samples.
- Library generation no longer writes highlight coverage warnings directly with
  `console.warn()`.

### Removed

- Removed WGSL-specific builtins from the generic core. Use `fenced_text`,
  declared tokens, metadata injections, or project-specific plugins instead.
- The Tree-sitter backend no longer lowers `dedent` to optional indentation
  whitespace. It now reports that indentation-stack layout requires a different
  model, such as an external scanner.
