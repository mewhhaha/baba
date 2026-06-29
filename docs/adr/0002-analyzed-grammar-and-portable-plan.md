# ADR 0002: Analyzed Grammar And Portable Plan

Status: accepted.

## Context

The Wasm parser path needs grammar analysis that is independent from emitted
artifact layout. Earlier target-specific lowering made it easy for token, regex,
conflict, and diagnostic behavior to diverge.

## Decision

Generic compiler analysis produces an `AnalyzedGrammar`. Standalone parser
targets lower that analysis into `PortableParserPlan`, a versioned data contract
with deterministic symbol tables, lexer DFA data, LR tables, reducer metadata,
CST schema, diagnostic schema, statistics, and a stable plan hash.

## Consequences

Generated Wasm adapters expose parser-plan identity fields. Untrusted serialized
plans are validated for version, references, dense IDs, canonical ordering, and
supported integer ranges before use.

## Rejected Alternatives

- Letting each target rebuild its own parser tables from the source grammar.
- Using package version alone as the runtime data contract.
- Treating generated wrapper data as a separate schema unrelated to runtime
  plans.

## Compatibility Impact

Portable plan version `1` is stable for the current contract. Additive metadata
can be added only when older validators can safely ignore it. Breaking changes
require a new plan version or separately versioned subsection.
