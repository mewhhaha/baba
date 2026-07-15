# Diagnostics

Status: current diagnostic contract.

Baba reports expected user failures as structured diagnostics. Public consumers
should inspect diagnostic `code`, span fields, and typed payloads rather than
matching English message text.

## Compiler Diagnostics

Compiler diagnostics cover grammar parsing, metadata validation, portability,
target support, planning limits, output packaging, and generated-size checks.
Target-neutral planning diagnostics use portable codes. Target-specific
packaging diagnostics remain owned by their target.

Examples include:

- `PORTABLE_EXTERNAL_TOKENS_UNSUPPORTED`;
- `PORTABLE_LEXER_TOKEN_OVERLAP`;
- `PORTABLE_LEXER_STATE_LIMIT`;
- `PORTABLE_PARSER_STATE_LIMIT`;
- `PORTABLE_PARSER_TABLE_ENTRY_LIMIT`;
- `WASM_GENERATED_BYTE_LIMIT`.

## Runtime Diagnostics

Generated Wasm parsers report lexical errors, unexpected tokens, trailing input,
trace exhaustion, unresolved parser branching, and internal invariant failures
through structured parse diagnostics. `parse()` and `validate()` return those
diagnostics without constructing object trees. Source-only generated parsers do
not expose `PARSE_INVALID_TOKEN_STREAM` or `PARSER_BRANCH_LIMIT`.

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
