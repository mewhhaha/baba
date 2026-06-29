# ADR 0001: Scope

Status: accepted.

## Context

Baba supports grammar-driven syntax tooling through compact runtime plans and a
shared Wasm parser runtime. Semantic analysis, language-specific code
generation, formatting, LSP behavior, and editor extension packaging stay
outside the core generator.

## Decision

Baba is a syntax-runtime generator. It accepts grammar source plus Baba metadata
and emits inspectable syntax artifacts: a compact parser plan, the generic Wasm
runtime, a small adapter, and optional type declarations. User-language
semantics remain in consumer code.

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
