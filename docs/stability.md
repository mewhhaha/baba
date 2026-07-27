# Stability Policy

Status: current compatibility policy.

Baba has several surfaces with different stability guarantees. This document
states them separately so private compiler infrastructure does not inherit the
same promise as published user APIs.

## Public Library API

The exported modules in `deno.json` are the stable public library surface,
except for the modules named under "Experimental Surfaces" below:

- `@mewhhaha/baba`;
- `@mewhhaha/baba/cli`;
- `@mewhhaha/baba/runtime/generated-wasm`.

Patch and minor releases may add options, result fields, diagnostics, helper
exports, and target capabilities. Removing exports, changing accepted option
meaning, or changing successful result shapes requires a documented breaking
release.

Being listed in `deno.json` `exports` is the mechanical test for this surface,
with exactly one exception: a module that "Experimental Surfaces" names is
exported so that it can be used, not because it carries these guarantees. That
list is the complete set of exceptions. Any export not on it is stable.

## Experimental Surfaces

- `@mewhhaha/baba/runtime/webgpu-lexer`.

This module does not carry the Public Library API guarantees above. Its option
shapes and its result shapes may change in any minor release, and it may be
removed entirely without a major release. It carries no performance guarantee of
any kind: it is measurably slower than the shipping lexer below roughly 896 KiB
of source, and its one-time setup cost is not repaid by a single document. That
threshold is not a promise either - it moves whenever the shipping lexer gets
faster, and it has already moved once for that reason. It requires a WebGPU
adapter and refuses to run without one.

Token records it produces are held to byte-exact parity with `lex_all`, which is
a correctness gate rather than a compatibility promise. See
`docs/webgpu-lexer.md`.

## Grammar Syntax

The grammar source language is stable for accepted constructs. New syntax may be
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
implementation detail. Plan version `2` is stable for its current serialized
fields, canonical ordering, reducer opcodes, diagnostic schema, and validation
rules. Breaking changes require a new plan version or a separately versioned
subsection.

Generated `parser.plan` files currently use runtime metadata subsection version
`2` and portable parser-plan version `2`. The loader accepts only this current
contract; regenerate plans produced by earlier Baba releases.

The binary core table section that `load_plan` reads carries its own format
version, currently `4`. It is an internal encoding, not part of the
`PortableParserPlan` contract: hosts are expected to validate a plan through
`wasm/abi.json` and `load_plan` rather than to decode the tables themselves.
Adding, removing, or reordering a header slot or a section changes that version,
and the loader rejects any other value outright rather than guessing at a
layout. A reader that does not understand the current core format version must
regenerate the plan; there is no forward-compatible partial read.

Version `4` adds header slots 31-35: the explicit DFA start state, and the
lexer's alphabet equivalence classes as a class count, an ASCII class table and
a sorted range list. The start state was previously hardcoded to `0` by every
consumer and not stored at all, so a plan whose DFA started elsewhere would have
been mislexed with nothing to detect it. The dense `(state x class)` transition
table is deliberately **not** persisted: measured across the four example
grammars and `fixtures/perf/large-runtime` it is 1.4x to 3.9x the size of the
CSR rows it would duplicate, and it is derivable from them in one lookup per
class.

## Generated Wasm API

Generated Wasm parser modules expose a stable ergonomic API:

- `createParser({ bytes, plan })`;
- `createParser({ module, plan })`;
- `createParserAsync(options)`;
- parser instances with `lex`, `parse`, `validate`, `reset`, and `dispose`;
- generated token, rule-specific cursor, lexer tape, cursor parse, validation,
  and diagnostic types in `syntax.ts`.

Generated source layout and private helper names are not stable. Consumers
should import from the generated module entrypoint rather than reaching into
runtime helper internals.

## Wasm ABI

The generated Wasm core ABI is versioned separately from package and parser-plan
versions. ABI version `9` is documented in `docs/wasm-abi.md` and described by
each generated `wasm/abi.json`. Changes to exported core functions, record
layouts, source encoding, span units, ownership, result lifetime, or numeric
status tables require an ABI version change.

How much of a caller-owned buffer an export may write is part of that contract,
and so is the capacity argument that bounds it. Every buffer-writing export now
takes an explicit capacity and rejects an undersized buffer with a status rather
than writing past it: `lex_all` gained `tokenCapacity` plus a separate `memoPtr`
and `memoCapacity` for its failure memo, and no longer writes anything into the
token records it does not return. `parse_trace` and `parse_cursor` carry the
same memo arguments. That is the `8 -> 9` bump. Narrowing what an export may
write is additive; widening it is not, and needs a version change.

The TypeScript Wasm adapter API is stable at the generated module entrypoint.
Generated modules import their loader from
`@mewhhaha/baba/runtime/generated-wasm`. Low-level helper names and embedded
byte-array layout are implementation details.

## Generated Tree-sitter API

The `tree-sitter` target emits `grammar.js` plus non-empty generated query
fragments. Tree-sitter rule names, fields, aliases, precedence wrappers,
supertypes, conflicts, inline rules, extras, and word-token selection are stable
when declared through grammar source and metadata. Formatting and private helper
expressions inside generated `grammar.js` are not stable.

Contextual tokens without trailing lookahead emit as named Tree-sitter lexical
rules. Safely lowerable positive trailing guards emit named external tokens and
a generated `src/scanner.c`; the portable analyzed regex remains the source of
truth. Guard shapes that Tree-sitter's forward-only scanner cannot preserve
produce `TREE_SITTER_UNSUPPORTED_CONTEXTUAL_GUARD`.

## Internal BRL

The internal runtime language is private and unstable. Its syntax, IR, verifier,
compiler helpers, artifact manifests, and generated helper layout may change
between releases. Public compatibility is expressed through generated parser
APIs, parser-plan versions, runtime diagnostic contracts, and Wasm ABI versions,
not through BRL source compatibility.
