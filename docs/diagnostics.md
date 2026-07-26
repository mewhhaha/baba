# Diagnostics

Status: current diagnostic contract.

Baba reports expected user failures as structured diagnostics. Public consumers
should inspect diagnostic `code`, span fields, and typed payloads rather than
matching English message text.

## Compiler Diagnostics

Compiler diagnostics cover grammar parsing, metadata validation, target support,
planning limits, output packaging, and generated-size checks. Target-neutral
planning diagnostics use portable codes. Target-specific packaging diagnostics
remain owned by their target.

Examples include:

- `PORTABLE_LEXER_TOKEN_OVERLAP`;
- `PORTABLE_LEXER_STATE_LIMIT`;
- `PORTABLE_PARSER_STATE_LIMIT`;
- `PORTABLE_PARSER_TABLE_ENTRY_LIMIT`;
- `TREE_SITTER_UNSUPPORTED_CONTEXTUAL_GUARD`;
- `WASM_GENERATED_BYTE_LIMIT`.

## Runtime Diagnostics

Generated Wasm parsers report lexical errors, unexpected tokens, trailing input,
trace exhaustion, unresolved parser branching, oversized inputs, and internal
invariant failures through structured parse diagnostics. `parse()` and
`validate()` return those diagnostics without constructing object trees.
Source-only generated parsers do not expose `PARSE_INVALID_TOKEN_STREAM` or
`PARSER_BRANCH_LIMIT`.

`PARSER_INPUT_TOO_LARGE` reports a source whose runtime buffers cannot fit in
the WebAssembly address space. Its message names the requested byte count, the
address-space limit, and the source size, and it ends with the remedy that
actually applies: splitting the input, or lowering `maxTraceActions` when the
trace buffer alone is what does not fit. It is returned, never thrown, by
`parse()`, `validate()` and `lex()`; on `lex()` it arrives in `diagnostics`
alongside `LEX_UNEXPECTED_CHARACTER` and the returned tape holds only the
synthetic end-of-file token. See `docs/limits.md` for the ceiling itself.

Generated `syntax.ts` includes the public diagnostic types for TypeScript
consumers. `wasm/abi.json` records the numeric runtime diagnostic schemas for
low-level hosts that call `parser.wasm` directly.

## Messages

Diagnostic messages are for humans. Tests and downstream tooling should assert
stable diagnostic codes and payloads. Message wording may improve without a
compatibility break when the code and payload semantics stay the same.

## Parity Failures

Repository parity tests include reproducible mismatch diagnostics: fixture name,
source path, operation, first differing normalized JSON path, actual and
expected values, options, and a command that reproduces the case.
