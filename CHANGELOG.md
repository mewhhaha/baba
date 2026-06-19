# Changelog

## 1.0.0

### Changed

- Baba is now a Tree-sitter compiler only: explicit EBNF in, `grammar.js` plus
  `queries/*.scm` out.
- Generated-file ownership is available through the public `applyBundle()` API.
- Root reachability is part of generation: unreachable rules are omitted and
  reported as warnings.
- Metadata is limited to Tree-sitter shaping and query configuration.

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

- Unreachable rules no longer affect generated Tree-sitter output.
- Query defaults are based on reachable literals and declared tokens.
- Query metadata is validated against the selected root graph.
- `validateGrammar()` now returns independent span-aware semantic diagnostics
  instead of wrapping only the first thrown error.
- Library users can safely apply bundles without reimplementing manifest
  ownership checks.
