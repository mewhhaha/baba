# T04: Runtime-language TypeScript backend and runtime port

- **Priority:** P0
- **Estimated size:** Extra large
- **Merge wave:** 3
- **Depends on:** [T01](./T01-versioned-portable-parser-plan.md), [T03](./T03-runtime-language-frontend.md), [T06](./T06-contextual-lexing-and-token-selection.md), [T07](./T07-stable-conflicts-and-bounded-ambiguity.md)
- **Suggested PR title:** `Compile the portable parser runtime to TypeScript`

[Back to task index](./README.md)

## Objective

Make the internal runtime language the sole implementation of Baba's standalone TypeScript lexer/parser runtime.

After this task, TypeScript target code may package plan data and generated public types, but it must not independently implement DFA traversal, parser execution, branch search, reductions, CST construction, token-stream validation, or runtime diagnostics.

## Problem

The TypeScript target currently generates parser behavior from large hand-maintained source templates. That creates permanent duplication with the Wasm runtime and makes exact semantic parity difficult to guarantee.

The runtime-language work is only valuable when these templates are replaced by a compiler output derived from one readable runtime source.

## Required work

### 1. Add a verified BRL-to-TypeScript backend

Suggested layout:

```text
src/runtime_language/backends/typescript/
  emit.ts
  expressions.ts
  statements.ts
  types.ts
  intrinsics.ts
  names.ts
```

The backend must consume only verified BRL IR.

Requirements:

- deterministic symbol naming;
- valid strict TypeScript;
- no `any` in generated runtime internals unless justified at a typed boundary;
- explicit integer coercions preserving BRL overflow semantics;
- explicit bounds/trap handling;
- left-to-right evaluation matching BRL spec;
- source comments or mappings sufficient to diagnose compiler bugs;
- no Deno-specific APIs in the generated portable runtime;
- output compatible with Deno, Node, and Bun.

### 2. Write the generic runtime in BRL

Suggested source layout:

```text
src/runtime/
  lexer.brl
  parser.brl
  branch_search.brl
  reductions.brl
  cst.brl
  token_stream.brl
  diagnostics.brl
  source_map.brl
```

The runtime must consume `PortableParserPlanV1` and expose target-neutral operations corresponding to the public generated API.

It must implement:

- global and contextual DFA lexing as defined by T06;
- trivia preservation policy;
- lexical errors;
- deterministic LR execution;
- declared bounded branch search as defined by T07;
- reducer execution;
- CST node/children/field arena construction;
- required/nullable/array field invariants;
- strict token-stream validation;
- expected-token diagnostics;
- source positions/spans;
- runtime resource-limit failures.

### 3. Decide compilation timing

Choose and document one approach:

#### A. Compile BRL during every Baba generation

Advantages:

- no checked-in compiled runtime artifact;
- source is always authoritative.

Disadvantages:

- higher generation cost;
- more opportunities for nondeterministic generation.

#### B. Check in a deterministic Stage-0 compiled generic runtime artifact

Advantages:

- fast grammar generation;
- simple packaging.

Disadvantages:

- artifact drift must be checked.

Recommended initial approach: compile the generic BRL runtime during repository build/bootstrap, check in the generated target-neutral TypeScript runtime template, and add a drift check under T10.

Regardless of choice, grammar-specific plan data must remain separate from generic runtime implementation.

### 4. Refactor TypeScript generated output

The target should emit conceptually:

```text
typescript/
  syntax.ts            # generated public types
  plan.ts              # grammar-specific PortableParserPlanV1 data
  runtime.ts           # BRL-compiled generic runtime
  mod.ts               # ergonomic API adapter/reexports
```

The exact filenames can differ, but responsibilities must be separated.

### 5. Remove algorithm duplication

Delete or drastically reduce:

- `src/targets/typescript/lexer_emit.ts`
- `src/targets/typescript/parser_emit.ts`

Permitted remaining responsibilities:

- serialize plan constants;
- emit generated syntax types;
- emit thin imports/reexports;
- configure defaults;
- package the BRL-compiled runtime artifact.

Forbidden remaining responsibilities:

- loops that walk DFA transitions;
- LR ACTION/GOTO execution;
- branch cloning/search;
- reducer switch semantics;
- CST field construction;
- parse diagnostic selection.

### 6. Preserve public API compatibility

Preserve or shim:

```ts
lex(source, options?)
parse(source, options?)
parseTokens(source, tokens)
parseTokensUnchecked(source, tokens)
positionAt(source, offset)
createSourceMap(source)
```

Preserve generated token/node types and result shapes unless a breaking change is explicitly documented and a compatibility wrapper is feasible.

### 7. Add differential migration testing

Before deleting the old runtime path, build an internal test-only legacy emitter and compare old/new behavior across the complete fixture corpus:

- lex tokens and diagnostics;
- parse success/failure;
- CST children;
- fields;
- spans;
- expected/found diagnostic data;
- conflict branch ordering.

Remove the legacy path after parity is proven. Do not ship both runtime algorithms.

### 8. Add runtime compiler diagnostics

BRL compiler failures during Baba development should identify:

- BRL source file/span;
- function/block/instruction where applicable;
- target backend;
- violated IR invariant.

Published Baba generation should not need to compile invalid runtime source. Treat that as an internal build failure, not a user grammar error.

## Likely files

- `src/runtime/*.brl`
- `src/runtime_language/backends/typescript/*`
- `src/targets/typescript/plan.ts`
- `src/targets/typescript/lexer_emit.ts`
- `src/targets/typescript/parser_emit.ts`
- `src/targets/typescript/syntax_emit.ts`
- `src/targets/typescript/runtime_artifact.ts` or equivalent
- `tests/parser_test.ts`
- `tests/lexer_test.ts`
- `tests/runtime_smoke.ts`
- new `tests/runtime_language_typescript_test.ts`

## Tests

1. BRL backend conformance for every language semantic rule;
2. legacy/new runtime exact parity during migration;
3. full existing grammar fixture suite;
4. contextual lexing fixtures;
5. deterministic and ambiguous parser fixtures;
6. strict token-stream validation;
7. non-BMP Unicode;
8. empty and nullable rules;
9. repeated parse and resource limits;
10. Deno, Node, and Bun generated runtime smoke;
11. deterministic generated source;
12. generated source-size comparison;
13. no runtime dependency on Baba package modules.

## Acceptance criteria

- One readable BRL implementation owns portable lexer/parser runtime semantics.
- TypeScript emitters contain packaging/data code only.
- Generated TypeScript runs under Deno, Node, and Bun.
- Existing public generated API remains compatible.
- Existing fixture behavior remains identical unless a separately approved semantic correction is included.
- Runtime compiler output is deterministic.
- Old algorithm templates are deleted, not merely left unused.

## Out of scope

- Wasm backend implementation;
- Wasm ABI redesign;
- self-hosting BRL;
- new parser features beyond T06/T07 contracts;
- user-facing runtime-language tooling;
- semantic analysis for generated user languages.

## Copy-ready agent prompt

> Implement T04 from `tasks/T04-runtime-language-typescript-backend.md`. Add the verified BRL-to-TypeScript backend, port the complete portable parser runtime to BRL, and make generated TypeScript consume `PortableParserPlanV1`. Remove algorithm duplication from TypeScript emitters while preserving the current public runtime API and proving exact migration parity.

## PR checklist

- [ ] BRL TypeScript backend implemented.
- [ ] Generic runtime fully ported to BRL.
- [ ] Grammar plan separated from runtime code.
- [ ] Old TypeScript algorithm templates deleted.
- [ ] Public generated API preserved.
- [ ] Deno/Node/Bun smoke passes.
- [ ] Exact migration parity tested.
- [ ] Full repository checks pass.
