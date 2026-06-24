# T03: Internal runtime language front-end

- **Priority:** P0
- **Estimated size:** Extra large
- **Merge wave:** 2
- **Depends on:** [T01](./T01-versioned-portable-parser-plan.md)
- **Suggested PR title:** `Add the Baba runtime language frontend and typed IR`

[Back to task index](./README.md)

## Objective

Build a deliberately small, private implementation language for Baba's portable DFA/LR runtime. This task owns the language specification, parser, resolver, type checker, target-neutral control-flow IR, and verifier.

It does **not** port the current runtime and does **not** add TypeScript or Wasm code generation. Those are T04 and T05.

## Scope boundary

Suggested internal name: **BRL — Baba Runtime Language**.

BRL is compiler infrastructure, not a product for users. Every feature must have a concrete use in the lexer, parser, branch search, reductions, CST construction, diagnostics, memory management, or adapters.

### Required language features

- scalar types: `bool`, `u8`, `u16`, `u32`, `i32`;
- records with fixed fields;
- small closed tagged variants/enums;
- fixed arrays;
- immutable spans/views;
- growable vectors with explicit operations;
- functions with explicit parameters and results;
- local variables;
- assignment;
- `if`/`else`;
- `while`;
- bounded/range `for` where useful;
- `break`, `continue`, and `return`;
- field access and indexing;
- explicit casts supported by the semantics;
- a small declared intrinsic set;
- deterministic module/import ordering if multiple source files are supported.

### Explicitly forbidden initially

- exceptions;
- async/await;
- closures or first-class functions;
- inheritance or traits;
- dynamic dispatch;
- reflection;
- macros;
- arbitrary FFI;
- threads;
- filesystem, network, environment, clock, or random access;
- user-defined generics unless unavoidable for vectors/spans;
- garbage collection;
- implicit allocation;
- self-hosting requirements.

## Required work

### 1. Write a normative semantics specification

Create:

```text
src/runtime_language/SPEC.md
```

It must define, not merely describe informally:

- lexical grammar;
- source encoding;
- identifiers and keywords;
- integer literals;
- type grammar;
- expression grammar;
- statement grammar;
- module/import rules;
- name lookup and shadowing;
- initialization rules;
- integer overflow;
- signed/unsigned comparisons;
- cast legality;
- division and remainder by zero;
- shift semantics for excessive shift counts;
- evaluation order;
- boolean representation;
- bounds checking;
- trap versus structured-result behavior;
- record layout abstraction;
- array, span, and vector semantics;
- ownership and mutation;
- text/UTF-16 abstraction;
- allocation/reset lifetime;
- unreachable code policy;
- deterministic compilation requirements.

Example decisions must be explicit:

```text
u32 addition wraps modulo 2^32.
Function arguments evaluate left-to-right.
Out-of-bounds indexing traps the runtime program.
A span never owns storage.
Vector growth may fail with a structured capacity error.
```

### 2. Define BRL's own grammar

Add:

```text
src/runtime_language/grammar.ebnf
```

Use Baba's supported EBNF subset. Avoid requiring language features not yet implemented by Baba unless the Stage-0 bootstrap parser is isolated and justified.

Document the Stage-0 path:

- whether the BRL parser is generated and checked in;
- how it is regenerated;
- which artifact is authoritative;
- how drift is detected later by T10.

### 3. Add a source AST

Suggested files:

```text
src/runtime_language/ast.ts
src/runtime_language/parser.ts
src/runtime_language/diagnostics.ts
```

AST requirements:

- every declaration/expression/statement has a source span;
- parsed identifiers are not resolved IDs yet;
- source types are distinct from checked types;
- syntax recovery should collect multiple independent errors when practical;
- ordinary invalid BRL source never causes generic exceptions.

### 4. Add name resolution

Implement deterministic IDs for:

- modules;
- functions;
- records;
- variants;
- fields;
- locals;
- parameters;
- intrinsics.

Detect:

- duplicate declarations;
- unknown names;
- invalid imports;
- shadowing according to the spec;
- recursive type cycles that violate layout rules;
- function calls to non-functions;
- field access on wrong types.

### 5. Add type checking

Type-check:

- expressions;
- calls;
- conditions;
- assignments;
- returns;
- record construction;
- variant construction/matching if included;
- vector/span operations;
- casts;
- indexing;
- intrinsic arguments.

Return structured diagnostics with related spans.

### 6. Lower into target-neutral typed control-flow IR

Suggested files:

```text
src/runtime_language/ir.ts
src/runtime_language/lower.ts
src/runtime_language/verify.ts
```

IR requirements:

- explicit typed functions;
- basic blocks;
- typed values or typed locals;
- explicit branch/jump/return terminators;
- no target syntax;
- no TypeScript or Wasm operation names in generic semantics;
- stable record/function IDs;
- explicit loads/stores/indexing;
- explicit vector operations or intrinsics;
- explicit trap/error instructions;
- enough information to preserve source locations for backend diagnostics.

A possible shape:

```ts
interface RuntimeIrFunction {
  readonly id: number;
  readonly params: readonly RuntimeIrType[];
  readonly result: RuntimeIrType | null;
  readonly locals: readonly RuntimeIrType[];
  readonly blocks: readonly RuntimeIrBlock[];
}

interface RuntimeIrBlock {
  readonly id: number;
  readonly instructions: readonly RuntimeIrInstruction[];
  readonly terminator: RuntimeIrTerminator;
}
```

SSA is optional. A typed local-based IR is acceptable if invariants are explicit and both backends can consume it cleanly.

### 7. Verify IR invariants

`verifyRuntimeIr(program)` must catch:

- unknown function/block/local/value IDs;
- wrong operand types;
- missing terminators;
- multiple terminators;
- invalid branch targets;
- return type mismatch;
- invalid record field indexes;
- invalid intrinsic signatures;
- use before definition under the selected IR model;
- malformed control-flow merges;
- illegal casts;
- missing entrypoint where required.

The verifier must be independently tested by constructing malformed IR objects.

### 8. Add conformance fixtures

Suggested layout:

```text
src/runtime_language/fixtures/
  valid/
  invalid/
```

Cover every syntax and semantic rule. Each invalid fixture should state expected diagnostic codes.

## Suggested diagnostic families

```text
BRL_PARSE_*
BRL_DUPLICATE_*
BRL_UNKNOWN_*
BRL_TYPE_MISMATCH
BRL_INVALID_CAST
BRL_INVALID_RETURN
BRL_UNINITIALIZED_LOCAL
BRL_RECURSIVE_LAYOUT
BRL_UNREACHABLE_CODE
BRL_IR_*
```

## Likely files

- `src/runtime_language/SPEC.md`
- `src/runtime_language/grammar.ebnf`
- `src/runtime_language/ast.ts`
- `src/runtime_language/parser.ts`
- `src/runtime_language/diagnostics.ts`
- `src/runtime_language/resolve.ts`
- `src/runtime_language/typecheck.ts`
- `src/runtime_language/ir.ts`
- `src/runtime_language/lower.ts`
- `src/runtime_language/verify.ts`
- new `tests/runtime_language_frontend_test.ts`

## Tests

1. valid source covering every language construct;
2. multiple independent parse errors;
3. duplicate and unknown names;
4. shadowing rules;
5. every integer/cast edge case;
6. invalid returns and calls;
7. record/variant layout errors;
8. vector/span misuse;
9. deterministic IDs and IR output;
10. malformed IR verifier matrix;
11. source-span accuracy;
12. deeply nested input respecting explicit limits.

## Acceptance criteria

- BRL has a normative semantics document.
- The frontend can express representative DFA traversal, LR stack operations, branch queues, reducer dispatch, CST arenas, and diagnostics.
- Valid programs lower to verified target-neutral IR.
- Invalid programs produce structured diagnostics.
- The IR verifier has comprehensive negative tests.
- No TypeScript or Wasm backend is added in this PR.
- No general-purpose feature lacks a documented parser-runtime use case.

## Out of scope

- compiling BRL to TypeScript or Wasm;
- porting Baba's runtime;
- self-hosting;
- user-facing BRL CLI/package;
- arbitrary host FFI;
- optimizing the IR beyond simple canonicalization.

## Copy-ready agent prompt

> Implement T03 from `tasks/T03-runtime-language-frontend.md`. Build only the small internal BRL frontend, normative semantics spec, parser, resolver, type checker, target-neutral control-flow IR, and verifier. Do not port Baba's lexer/parser runtime and do not add TypeScript/Wasm emitters. Reject any language feature without a concrete portable-runtime requirement.

## PR checklist

- [ ] Normative BRL semantics written.
- [ ] BRL grammar and Stage-0 strategy documented.
- [ ] AST, resolver, and type checker implemented.
- [ ] Typed target-neutral IR implemented.
- [ ] IR verifier implemented and attacked with negative tests.
- [ ] No target backend included.
- [ ] Full repository checks pass.
