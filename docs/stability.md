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

- `@mewhhaha/baba/runtime/webgpu`.

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

`PortableParserPlan` is a reference-runtime data contract, not the Wasm parser
plan. Its current version is `3` with deterministic-only `baba-portable-v3`
semantics.

Generated `parser.plan` files currently use runtime metadata subsection version
`6` and Wasm island plan version `4`. The loader accepts only this current
contract; regenerate plans produced by earlier Baba releases.

These numbers version independent contracts, not concurrently supported parser
generations. Baba emits and accepts one combination:

| Contract                         | Current version |
| -------------------------------- | --------------: |
| Portable reference parser plan   |               3 |
| Wasm island parser plan          |               4 |
| Wasm core table encoding         |               8 |
| Wasm runtime metadata subsection |               6 |
| Compact metadata container       |               1 |
| Optional GPU frontend section    |               3 |

There are no migrations or compatibility readers for older versions. The
compiler always emits the versions above, and each loader rejects a different
version at its input boundary.

The binary core table section that `load_plan` reads carries its own format
version, currently `8`. It is an internal encoding inside the Wasm island plan;
hosts are expected to validate a plan through `wasm/abi.json` and `load_plan`
rather than to decode the tables themselves. Adding, removing, or reordering a
header slot or a section changes that version, and the loader rejects any other
value outright rather than guessing at a layout. A reader that does not
understand the current core format version must regenerate the plan; there is no
forward-compatible partial read.

The current layout stores the explicit DFA start state and alphabet equivalence
classes. Dense-eligible DFAs store complete ASCII transitions in a direct table
and keep only U+0080 and above in their sparse CSR rows. DFAs above the
dense-table size limit keep complete CSR rows. The split removes duplicate ASCII
ranges without adding a lookup to the Wasm lexer hot path.

## Generated Wasm API

Generated Wasm parser modules expose a stable ergonomic API:

- `createParser({ bytes, plan })`;
- `createParser({ module, plan })`;
- `createParserAsync(options)`;
- parser instances with `lex`, `parse`, `validate`, `createDocument`, `reset`,
  and `dispose`;
- generated token, rule-specific cursor, lexer tape, cursor parse, validation,
  and diagnostic types in `syntax.ts`.

Generated source layout and private helper names are not stable. Consumers
should import from the generated module entrypoint rather than reaching into
runtime helper internals.

## Wasm ABI

The generated Wasm core ABI is versioned separately from package and parser-plan
versions. ABI version `14` is documented in `docs/wasm-abi.md` and described by
each generated `wasm/abi.json`. Changes to exported core functions, record
layouts, source encoding, span units, ownership, result lifetime, or numeric
status tables require an ABI version change.

How much of a caller-owned buffer an export may write is part of that contract,
and so is the capacity argument that bounds it. ABI version 14 adds strict
island analysis and compact cursor-tape materialization over caller-owned raw
token records. The TypeScript adapter owns public diagnostics and lazy cursor
objects. `lex_all` retains its explicit token and memo capacities and never
writes records it does not return.

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
