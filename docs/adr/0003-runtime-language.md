# ADR 0003: Runtime Language

Status: accepted for Stage-0 compiler infrastructure.

## Context

Baba's TypeScript and Wasm runtimes need exact semantic parity for lexer,
parser, branch-search, reducer, CST, and diagnostic behavior. Some runtime
helpers are already generated from the private runtime language, while the full
standalone runtime has not yet completed the T04/T05 migration.

## Decision

The internal runtime language, documented in `docs/runtime-language.md`, is
private compiler infrastructure. Stage-0 covers the verified frontend, resolved
IR, TypeScript backend, Wasm backend, conformance fixtures, helper artifact
manifests, and shared runtime helper sources. Runtime implementation identity is
tracked independently from package version.

## Consequences

Runtime-language source and generated helper artifacts are checked for drift.
Generated parsers may package runtime-language-derived helpers, but this ADR is
not a claim that every TypeScript and Wasm parser algorithm has been fully
ported to one BRL source yet.

## Rejected Alternatives

- Exposing BRL as a public user-facing language.
- Maintaining untracked generated helper artifacts.
- Claiming source-of-truth unification before the full runtime port is complete.

## Compatibility Impact

BRL syntax, IR, and helper artifact layout are private and unstable. Public
compatibility is expressed through generated parser APIs, runtime diagnostics,
portable parser-plan versions, and Wasm ABI versions.
