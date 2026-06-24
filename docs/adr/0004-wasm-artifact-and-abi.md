# ADR 0004: Wasm Artifact And ABI

Status: accepted for ABI version 1.

## Context

The Wasm target emits a core module plus TypeScript adapter. Hosts need a clear
contract for versioning, memory layout, source encoding, result lifetimes, and
validation without scraping adapter implementation details.

## Decision

The current target kind is `javascript-hosted-core-wasm`. Generated Wasm bundles
emit `wasm/abi.json`, export ABI metadata from `wasm/mod.ts`, and define the
normative core contract in `docs/wasm-abi.md`. ABI version 1 uses UTF-16 source
units and UTF-16 public spans.

## Consequences

The adapter validates core exports against generated constants before use.
External-binary packaging can emit `parser.wasm` plus a manifest. Independent
tool validation is supported when `wasm-tools` or Wasmtime are installed.

## Rejected Alternatives

- Publishing only embedded TypeScript byte arrays.
- Requiring hosts to infer the ABI from generated adapter source.
- Claiming Component Model or WASI support before those packages exist.

## Compatibility Impact

Core ABI changes that alter exports, record layouts, source encoding, span
units, ownership, or lifetime semantics require an ABI version change and
descriptor update.
