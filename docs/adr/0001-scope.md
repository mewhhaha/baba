# ADR 0001: Scope

Status: accepted.

## Context

Baba supports grammar-driven syntax tooling across Tree-sitter, TypeScript,
Wasm, and parser-kit targets. The task program explicitly keeps semantic
analysis, language-specific code generation, formatting, LSP behavior, and
editor extension packaging outside the core generator.

## Decision

Baba is a syntax-runtime generator. It accepts EBNF plus Baba metadata and emits
syntax artifacts: Tree-sitter grammars and queries, standalone parser runtimes,
Wasm adapter artifacts, and parser-kit data. User-language semantics remain in
consumer code.

## Consequences

Compiler analysis may reject constructs that cannot be represented by the
selected syntax targets. Generated runtime APIs expose tokens, CST nodes,
diagnostics, and spans, not user-language interpretation or lowering.

## Rejected Alternatives

- Adding semantic analysis hooks to Baba's grammar format.
- Generating language-specific interpreters or compilers from parser metadata.
- Treating editor extension scaffolding as part of the generated output.

## Compatibility Impact

Existing syntax generation remains in scope. New non-syntax features require a
separate design and should not be added implicitly to metadata or generated
runtime contracts.
