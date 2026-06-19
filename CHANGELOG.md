# Changelog

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
