# ADR 0003: Runtime Language

Status: accepted for Stage-0 compiler infrastructure.

## Context

Baba's shared runtime and Wasm adapter need exact semantic parity for lexer,
parser, branch-search, reducer, CST, and diagnostic behavior. Runtime helpers
were initially generated from the private runtime language before the full
standalone runtime cutline was complete. The current Wasm parser path satisfies
the source-of-truth cutline documented in `docs/runtime-language.md`: parser
semantics are runtime-language-owned, while generated host code owns
source/string capabilities, public object allocation, diagnostic text rendering,
adapter capabilities, and packaging.

## Decision

The internal runtime language, documented in `docs/runtime-language.md`, is
private compiler infrastructure. Stage-0 covers the verified frontend, resolved
IR, TypeScript backend, Wasm backend, conformance fixtures, helper artifact
manifests, and shared runtime helper sources. Runtime implementation identity is
tracked independently from package version.

## Consequences

Runtime-language source and generated helper artifacts are checked for drift.
Generated Wasm parsers package runtime-language-derived parser semantics and
expose runtime implementation identity separately from parser-plan identity.

## Rejected Alternatives

- Exposing BRL as a public user-facing language.
- Maintaining untracked generated helper artifacts.
- Moving JavaScript host-boundary work such as public object materialization and
  diagnostic text rendering into BRL before a host-neutral ABI requires it.

## Compatibility Impact

BRL syntax, IR, and helper artifact layout are private and unstable. Public
compatibility is expressed through generated parser APIs, runtime diagnostics,
portable parser-plan versions, and Wasm ABI versions.
