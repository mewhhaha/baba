# Changelog

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
