# T05: Runtime-language Wasm backend and runtime port

- **Priority:** P0
- **Estimated size:** Extra large
- **Merge wave:** 3
- **Depends on:** [T01](./T01-versioned-portable-parser-plan.md), [T02](./T02-binary-artifacts-and-wasm-packaging.md), [T03](./T03-runtime-language-frontend.md), [T06](./T06-contextual-lexing-and-token-selection.md), [T07](./T07-stable-conflicts-and-bounded-ambiguity.md)
- **Suggested PR title:** `Compile the portable parser runtime to WebAssembly`

[Back to task index](./README.md)

## Objective

Compile the same BRL runtime used by the TypeScript target into core WebAssembly and eliminate parser-specific manual opcode emission.

After this task, Wasm generation should be a normal backend of the internal runtime language plus parser-plan packaging—not a second handwritten lexer/parser implementation.

## Problem

The current Wasm path directly constructs parser-specific bytecode through arrays of opcode bytes. This is difficult to audit and evolve. It also duplicates semantics implemented in TypeScript templates.

Direct opcode assembly is appropriate only inside a general Wasm binary encoder. It should not contain knowledge of DFA traversal, LR parsing, branch search, or CST reductions.

## Required work

### 1. Add a typed BRL-to-Wasm backend

Suggested layout:

```text
src/runtime_language/backends/wasm/
  lower.ts
  wasm_ir.ts
  verify.ts
  encode.ts
  layout.ts
  intrinsics.ts
  names.ts
```

Pipeline:

```text
verified BRL IR
    ↓
typed Wasm IR
    ↓
Wasm IR verifier
    ↓
core Wasm binary encoder
```

Do not lower BRL AST directly to byte arrays.

### 2. Define a typed Wasm IR

The Wasm IR should model:

- value types;
- function signatures;
- locals;
- blocks/loops/conditionals;
- calls;
- memory loads/stores;
- integer arithmetic/comparisons;
- data segments;
- exports/imports;
- memory configuration;
- traps/returns.

The verifier should reject:

- stack type mismatches;
- invalid function/local indexes;
- invalid branch depths;
- invalid memory alignment/access widths;
- duplicate exports;
- malformed data ranges;
- unsupported instructions;
- missing required exports.

### 3. Compile the shared BRL runtime

Compile exactly the runtime modules introduced by T04:

```text
lexer.brl
parser.brl
branch_search.brl
reductions.brl
cst.brl
token_stream.brl
diagnostics.brl
source_map.brl
```

Do not fork a Wasm-specific parser implementation in BRL. Backend-specific behavior should be expressed through a very small intrinsic layer.

### 4. Consume `PortableParserPlanV1`

Choose and document one representation:

- plan tables compiled into Wasm data segments;
- plan binary validated and loaded at runtime;
- a hybrid with immutable grammar tables in data segments and configurable limits passed at instance creation.

The first option is simplest for specialized generated parsers. Whatever is chosen, both TypeScript and Wasm must execute the same plan version and reducer opcodes.

### 5. Replace parser-specific opcode emission

Delete or reduce `src/targets/wasm/module_emit.ts` until it owns only:

- target packaging;
- plan/data-segment layout;
- invocation of the BRL Wasm backend;
- export/ABI configuration;
- final validation.

It must not contain parser algorithm functions such as:

- DFA transition routines;
- `lex_all` logic;
- ACTION/GOTO traversal;
- branch-frame save/restore;
- parser trace algorithms;
- reducer execution.

The generic Wasm encoder may still emit opcode bytes, but it must be parser-agnostic.

### 6. Preserve exact semantics

The Wasm backend must implement BRL semantics precisely:

- integer wrapping/sign behavior;
- bounds checks;
- UTF-16/code-point behavior;
- vector and arena growth;
- branch ordering;
- error and resource-limit behavior;
- evaluation order;
- reset/lifetime assumptions later formalized by T08.

### 7. Validate generated Wasm before bundling

Before returning a bundle:

- run the internal Wasm IR verifier;
- validate the encoded module with `WebAssembly.validate()` when available in the Stage-0 environment;
- return a structured internal generation diagnostic if invalid.

Tests should additionally use `wasm-tools validate` or another independent validator.

### 8. Preserve the JavaScript adapter temporarily

Keep a thin generated TypeScript adapter for the public API during migration. It should call the BRL-compiled Wasm runtime and replay/translate results only where the current ABI requires it.

T08 owns the final instance-oriented ABI and memory lifecycle.

### 9. Add a target conformance suite

Every BRL semantic fixture should compile and execute under:

- the BRL TypeScript backend;
- the BRL Wasm backend.

Compare:

- return values;
- memory-visible records;
- structured failures;
- traps;
- boundary cases.

## Likely files

- `src/runtime_language/backends/wasm/*`
- `src/runtime/*.brl`
- `src/targets/wasm/module_emit.ts`
- `src/targets/wasm/runtime_emit.ts`
- `src/targets/wasm/plan.ts`
- `src/targets/wasm/parser_emit.ts`
- `src/targets/wasm/lexer_emit.ts`
- `tests/wasm_test.ts`
- `tests/ts_wasm_parity_test.ts`
- new `tests/runtime_language_wasm_test.ts`

## Tests

1. BRL conformance program parity with TypeScript;
2. exact lexer result parity;
3. exact parse/CST/diagnostic parity;
4. deterministic parser;
5. declared conflicts and branch ordering;
6. Unicode and non-BMP offsets;
7. large DFA and LR tables;
8. resource-limit results;
9. malformed Wasm IR verifier cases;
10. deterministic `.wasm` bytes;
11. JavaScript `WebAssembly.validate()`;
12. independent validator smoke;
13. adapter API compatibility;
14. generated binary/source size comparison against old emitter.

## Acceptance criteria

- No lexer/parser algorithm remains hand-coded as Wasm opcodes.
- A general typed Wasm backend and binary encoder exist for BRL.
- TypeScript and Wasm compile the same runtime source.
- Both consume the same parser-plan version.
- Generated Wasm validates independently.
- TypeScript/Wasm runtime behavior is exactly equivalent over the parity suite.
- Parser-specific manual opcode code is deleted.

## Out of scope

- final public Wasm instance API and lifecycle;
- Component Model/WIT packaging;
- self-hosting BRL;
- arbitrary BRL FFI;
- optimizing generated Wasm beyond basic correctness and obvious table layout;
- user-language code generation to Wasm.

## Copy-ready agent prompt

> Implement T05 from `tasks/T05-runtime-language-wasm-backend.md`. Add a typed BRL-to-Wasm backend and parser-agnostic Wasm encoder, compile the shared portable runtime, consume `PortableParserPlanV1`, and remove parser-specific manual opcode emission. Preserve the generated adapter during migration and prove exact parity with the BRL TypeScript backend.

## PR checklist

- [ ] Typed Wasm IR and verifier added.
- [ ] General Wasm encoder added.
- [ ] Shared BRL runtime compiled.
- [ ] Parser plan embedded/loaded deterministically.
- [ ] Parser-specific opcode emission deleted.
- [ ] Generated module validated independently.
- [ ] TypeScript/Wasm parity suite passes.
- [ ] Full repository checks pass.
