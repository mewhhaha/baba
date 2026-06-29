# Stability Policy

Status: current compatibility policy.

Baba has several surfaces with different stability guarantees. This document
states them separately so private compiler infrastructure does not inherit the
same promise as published user APIs.

## Public Library API

The exported modules in `deno.json` are the stable public library surface:

- `@mewhhaha/baba`;
- `@mewhhaha/baba/cli`;
- `@mewhhaha/baba/runtime`;
- `@mewhhaha/baba/runtime/wasm`.

Patch and minor releases may add options, result fields, diagnostics, helper
exports, and target capabilities. Removing exports, changing accepted option
meaning, or changing successful result shapes requires a documented breaking
release.

## EBNF Syntax

The EBNF grammar language is stable for accepted constructs. New syntax may be
added when it does not change the meaning of existing grammars. Tightening an
ambiguous or unsafe construct is allowed only when it produces a structured
diagnostic and is documented as a semantic correction.

## Metadata Schema

Baba metadata is versioned. Metadata schema `version: 2` is the current stable
schema. Additive fields are allowed when older compilers can reject or ignore
them deterministically. Removing fields, changing selector meaning, or changing
default target behavior requires a new schema version or a documented breaking
release.

## Parser-Plan Format

`PortableParserPlan` is a versioned runtime data contract, not a package
implementation detail. Plan version `1` is stable for its current serialized
fields, canonical ordering, reducer opcodes, diagnostic schema, and validation
rules. Breaking changes require a new plan version or a separately versioned
subsection.

## Generated Wasm API

Generated Wasm parser modules expose a stable ergonomic API:

- `createParser({ bytes, plan })`;
- `createParser({ module, plan })`;
- `createParserAsync(options)`;
- parser instances with `lex`, `parse`, `parseTokens`, `parseTokensUnchecked`,
  `reset`, and `dispose`;
- generated token, node, result, and diagnostic types in `syntax.ts`.

Generated source layout and private helper names are not stable. Consumers
should import from the generated module entrypoint rather than reaching into
runtime helper internals.

## Wasm ABI

The generated Wasm core ABI is versioned separately from package and parser-plan
versions. ABI version `1` is documented in `docs/wasm-abi.md` and described by
each generated `wasm/abi.json`. Changes to exported core functions, record
layouts, source encoding, span units, ownership, result lifetime, or numeric
status tables require an ABI version change.

The TypeScript Wasm adapter API is stable at the generated module entrypoint.
Low-level helper names and embedded byte-array layout are implementation
details.

## Internal BRL

The internal runtime language is private and unstable. Its syntax, IR, verifier,
compiler helpers, artifact manifests, and generated helper layout may change
between releases. Public compatibility is expressed through generated parser
APIs, parser-plan versions, runtime diagnostic contracts, and Wasm ABI versions,
not through BRL source compatibility.
