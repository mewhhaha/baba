# Changelog

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
