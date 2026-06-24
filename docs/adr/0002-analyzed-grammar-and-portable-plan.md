# ADR 0002: Analyzed Grammar And Portable Plan

Status: accepted.

## Context

The TypeScript, Wasm, parser-kit, and Tree-sitter planning paths need consistent
grammar analysis. Earlier target-specific lowering made it easy for token,
regex, conflict, and diagnostic behavior to diverge.

## Decision

Generic compiler analysis produces an `AnalyzedGrammar`. Standalone parser
targets lower that analysis into `PortableParserPlanV1`, a versioned data
contract with deterministic symbol tables, lexer DFA data, LR tables, reducer
metadata, CST schema, diagnostic schema, statistics, and a stable plan hash.

## Consequences

Generated TypeScript, generated Wasm adapters, and parser-kit outputs expose the
same parser-plan identity fields. Untrusted serialized plans are validated for
version, references, dense IDs, canonical ordering, and supported integer ranges
before use.

## Rejected Alternatives

- Letting each target rebuild its own parser tables from the source grammar.
- Using package version alone as the runtime data contract.
- Treating parser-kit JSON as a separate schema unrelated to runtime plans.

## Compatibility Impact

Portable plan version `1` is stable for the current contract. Additive metadata
can be added only when older validators can safely ignore it. Breaking changes
require a new plan version or separately versioned subsection.
