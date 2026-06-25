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
- `PORTABLE_LEXER_STATE_LIMIT`;
- `PORTABLE_PARSER_STATE_LIMIT`;
- `TS_GENERATED_BYTE_LIMIT`;
- `WASM_GENERATED_BYTE_LIMIT`.

## Runtime Diagnostics

Generated parsers report lexical errors, unexpected tokens, trailing input,
token-stream validation failures, branch or trace exhaustion, ambiguous parse
results, and internal invariant failures through structured parse diagnostics.

Generated TypeScript and Wasm runtimes expose matching public diagnostic shapes.
Wasm `abi.json` additionally records numeric runtime diagnostic schemas for
low-level hosts.

## Messages

Diagnostic messages are for humans. Tests and downstream tooling should assert
stable diagnostic codes and payloads. Message wording may improve without a
compatibility break when the code and payload semantics stay the same.

## Parity Failures

Repository parity tests include reproducible mismatch diagnostics: fixture name,
source path, operation, first differing normalized JSON path, actual and
expected values, options, and a command that reproduces the case.
