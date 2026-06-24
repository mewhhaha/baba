# Baba parallel improvement program

This directory is a handoff plan for several independent coding agents. It is intentionally aggressive. The objective is not to add more surface area; it is to turn Baba's current Tree-sitter, TypeScript, and Wasm outputs into one coherent, versioned syntax-runtime system.

Prepared against Baba 1.3.x.

## Target architecture

The desired end state is:

```text
EBNF + metadata
      |
      v
AnalyzedGrammar
      |
      v
PortableParserPlanV1
  - canonical token specifications
  - DFA tables and accepting candidates
  - LR tables and conflict policy
  - production reducers
  - CST schema
  - diagnostic schema
      |
      +--------------------+
      |                    |
      v                    v
runtime-language       TreeSitterPlan
compiler                   |
  |                        v
  +--> TypeScript       grammar.js + queries
  |
  +--> core Wasm + documented ABI
```

The lexer, parser loop, branch search, reductions, CST construction, and runtime diagnostics must have one implementation. TypeScript and Wasm should be different compilations or packages of that implementation, not separate algorithms maintained by hand.

## Non-goals

Do not use these tasks to add:

- semantic analysis, name resolution, type checking for user languages, or user-language code generation;
- formatter, LSP, or editor-extension generation;
- hard-coded language-specific scanners, WGSL support, indentation, heredocs, or fenced blocks;
- a general-purpose user-facing programming language;
- self-hosting as a release requirement;
- unbounded GLR parsing or editor-grade error recovery before the portable runtime is stable.

The internal runtime language is compiler infrastructure. Add only features required to implement the DFA/LR runtime.

## Rules for every agent

1. Take exactly one task ID per PR unless the task explicitly says otherwise.
2. Start from the latest `main`; do not base work on another agent's unmerged branch unless the dependency table says to.
3. Do not bump the package version or edit `CHANGELOG.md`. The integration owner will do release bookkeeping.
4. Do not regenerate all checked-in examples unless the task explicitly owns example regeneration. Generated examples are merge-conflict magnets.
5. Preserve public behavior unless the task explicitly defines a breaking change. When a breaking change is necessary, add a compatibility shim and a deprecation diagnostic where practical.
6. Expected user failures must become structured diagnostics, not thrown generic errors.
7. Keep target-specific code out of generic compiler analysis.
8. Add focused regression tests. Do not satisfy a task with only string-substring assertions when generated code can be executed.
9. Before opening a PR, run:

   ```sh
   deno fmt --check
   deno lint
   deno task check
   deno task test
   deno task publish:dry-run
   ```

10. Include in the PR description:
    - the task ID;
    - design decisions;
    - files intentionally deleted;
    - commands run;
    - known follow-up work;
    - benchmark changes when runtime code changed.

## Merge waves

```text
Wave 0: T00, T09, T11
              |
              v
Wave 1: T01, T02
              |
              v
Wave 2: T03, T06, T07
              |
              v
Wave 3: T04 and T05
              |
              v
Wave 4: T08
              |
              v
Wave 5: T10
```

`T09` and `T11` are mostly independent and can run immediately. `T10` may create test scaffolding early, but its final parity and release-gate work must be rebased after the runtime tasks land.

## Task index

| ID | Priority | Size | Owns | Depends on |
|---|---:|---:|---|---|
| [T00](#t00-correctness-and-planning-cleanup) | P0 | M | API planning and option semantics | none |
| [T01](#t01-versioned-portable-parser-plan) | P0 | XL | shared parser-plan IR | T00 |
| [T02](#t02-binary-artifacts-and-real-wasm-packaging) | P0 | L | generated-file model and binary output | T00 |
| [T03](#t03-internal-runtime-language-front-end) | P0 | XL | runtime-language parser, type checker, IR | T01 |
| [T04](#t04-runtime-language-typescript-backend-and-runtime-port) | P0 | XL | TypeScript runtime backend | T01, T03, T06, T07 |
| [T05](#t05-runtime-language-wasm-backend-and-runtime-port) | P0 | XL | Wasm backend and runtime | T01, T02, T03, T06, T07 |
| [T06](#t06-contextual-lexing-and-token-selection) | P0 | L | lexical semantics in the portable plan | T01 |
| [T07](#t07-stable-conflicts-and-bounded-ambiguity) | P0 | L | conflict identity and branch semantics | T01 |
| [T08](#t08-wasm-abi-memory-lifecycle-and-reentrancy) | P0 | L | public Wasm ABI and resource controls | T02, T05 |
| [T09](#t09-analysis-and-resource-hardening) | P1 | L | regex/grammar analysis limits | none |
| [T10](#t10-differential-fuzz-performance-and-release-gates) | P1 | XL | parity tests, fuzzing, CI and benchmarks | all runtime tasks |
| [T11](#t11-package-example-and-documentation-hygiene) | P1 | M | package size, examples and ADRs | none |

---

# T00: correctness and planning cleanup

**Suggested PR title:** `Fix multi-target planning and portability semantics`

## Problem

The current orchestration has avoidable correctness and maintenance issues:

- portability defaults are described as strict for multiple targets, but the normalization logic only selects strict for the specific Tree-sitter + TypeScript combination;
- planning TypeScript and Wasm can build essentially the same BNF/LR plan more than once;
- the Wasm planner delegates to the TypeScript planner, rewrites diagnostic codes, and performs English string replacements such as `TypeScript` -> `Wasm`;
- TypeScript and Wasm option types duplicate most fields and can drift;
- Wasm lacks equivalent generated-size and planning-stat options.

## Required work

1. Introduce a shared runtime-target option type:

   ```ts
   interface PortableRuntimePlanningOptions {
     preserveTrivia?: boolean;
     lexerStateLimit?: number;
     parserStateLimit?: number;
     parserItemLimit?: number;
     parserTableEntryLimit?: number;
   }
   ```

   Target-specific options should extend it with directory and packaging settings.

2. Make portability default to `strict` whenever two or more semantic targets are selected, not only for one pair.

3. Split planning into:

   ```text
   planPortableRuntime(analyzed, options, metadata)
   planTypeScriptPackaging(portablePlan, options)
   planWasmPackaging(portablePlan, options)
   ```

   It is acceptable for `planPortableRuntime` to initially wrap existing BNF/LR code. T01 will formalize the returned plan.

4. Plan the portable runtime once per `compile()`/`validateGrammar()` call and reuse it for TypeScript and Wasm.

5. Remove diagnostic string replacement. Generic planner diagnostics should use generic codes such as:

   ```text
   PORTABLE_EXTERNAL_TOKENS_UNSUPPORTED
   PORTABLE_PARSER_STATE_LIMIT
   PORTABLE_LEXER_STATE_LIMIT
   ```

   Packaging diagnostics may remain `TS_*` or `WASM_*`.

6. Ensure `validateGrammar()` and `compile()` report the same planning diagnostics for the same options.

## Likely files

- `src/api.ts`
- `src/ast.ts`
- `src/targets/typescript/plan.ts`
- `src/targets/wasm/plan.ts`
- `src/cli.ts`
- `tests/api_test.ts`
- `tests/wasm_test.ts`

## Acceptance criteria

- `targets: ["tree-sitter", "wasm"]` defaults to strict portability.
- `targets: ["typescript", "wasm"]` builds BNF/LR exactly once; add an injectable counter or planner test seam rather than relying on timing.
- No `.replaceAll("TypeScript", "Wasm")` diagnostic rewriting remains.
- TypeScript-only and Wasm-only generation continue to work.
- Existing diagnostic codes have compatibility mapping where users may depend on them.

## Agent prompt

> Implement T00 from `tasks/README.md`. Focus only on orchestration, shared option semantics, planner reuse, and diagnostic ownership. Do not design the final parser-plan IR and do not change parsing algorithms. Add executable tests for every target combination.

---

# T01: versioned portable parser plan

**Suggested PR title:** `Introduce PortableParserPlanV1`

## Problem

Baba has shared analysis, but there is no explicit, versioned data contract that both standalone runtimes execute. BNF, LR tables, lexer DFA, reducers, symbol lookup, and CST schemas are passed around as target-specific objects. This makes it easy for TypeScript and Wasm packaging to reinterpret or omit semantics.

## Required work

1. Add `src/compiler/portable_plan/` with a public-internal plan model. Suggested files:

   ```text
   plan.ts
   build.ts
   validate.ts
   serialize.ts
   statistics.ts
   ```

2. Define an immutable `PortableParserPlanV1` containing:

   - magic/format/version fields;
   - semantic version of the runtime contract;
   - token and literal symbol tables;
   - skip/main/error channel information;
   - DFA states, transitions, and all accepting candidates;
   - LR terminals, nonterminals, ACTION sets, GOTO rows, and start/eof IDs;
   - productions and target-neutral reducer opcodes;
   - rule names and stable rule IDs;
   - field schemas and cardinality;
   - expected-terminal rows for diagnostics;
   - declared conflict groups and runtime limits where applicable.

3. Add `buildPortableParserPlan(analyzed, metadata, options)`.

4. Add `validatePortableParserPlan(plan)` that treats the plan as untrusted data. It must reject:

   - invalid indexes;
   - invalid ranges;
   - unsorted or overlapping DFA transitions;
   - unknown reducer opcodes;
   - malformed action encodings;
   - missing root/eof symbols;
   - invalid field references;
   - impossible table dimensions.

5. Add deterministic JSON serialization for debugging and a compact binary serialization seam. T02 may implement the final binary artifact format; T01 should establish canonical ordering and version fields.

6. Refactor TypeScript and Wasm planners to depend on the plan object. Do not rewrite runtime emitters in this task.

## Design requirements

- Plan data must not contain JavaScript functions, Maps, Sets, or target source fragments.
- Stable IDs must be deterministic across repeated compilations of the same grammar.
- Runtime algorithms must not need `AnalyzedGrammar` after the plan is built.
- Reducer operations must be a closed tagged union or numeric opcode table with a documented version.
- Add a format evolution policy in a module-level comment.

## Likely files

- `src/compiler/portable_plan/*`
- `src/compiler/ir.ts`
- `src/targets/typescript/plan.ts`
- `src/targets/wasm/plan.ts`
- `src/targets/typescript/bnf.ts`
- `src/targets/typescript/lr1.ts`
- `tests/api_test.ts`
- new `tests/portable_plan_test.ts`

## Acceptance criteria

- TypeScript and Wasm planners receive the same plan object when both targets are requested.
- Serializing the same grammar twice is byte-for-byte deterministic.
- Corrupt-plan unit tests cover every index-bearing plan section.
- No target planner needs to call `lowerToBnf()` or `buildCanonicalLr1Table()` independently.
- Existing generated runtime behavior is unchanged.

## Agent prompt

> Implement T01 from `tasks/README.md`. Create a target-neutral, versioned `PortableParserPlanV1`, a single builder, strong invariant validation, and deterministic serialization. Adapt existing emitters without changing runtime behavior. Keep the plan free of target-specific objects and code strings.

---

# T02: binary artifacts and real Wasm packaging

**Suggested PR title:** `Support binary generated artifacts and emit parser.wasm`

## Problem

`GeneratedFile` currently carries only UTF-8 text. The Wasm target therefore embeds bytes into a generated `wasm.ts` array. That is useful for JavaScript, but it is not a host-neutral Wasm artifact and inflates generated source and published examples.

## Required work

1. Replace the single text-file model with a discriminated artifact model:

   ```ts
   type GeneratedFile =
     | {
         path: string;
         kind: "source" | "query" | "config" | "test" | "docs";
         encoding: "utf-8";
         content: string;
       }
     | {
         path: string;
         kind: "binary";
         encoding: "binary";
         content: Uint8Array;
       };
   ```

   A compatibility constructor/helper may preserve current call sites.

2. Update bundle sorting, path checking, hashing, manifests, staged writes, overwrite protection, and stale-file removal to support binary data.

3. Emit a real file:

   ```text
   wasm/parser.wasm
   ```

4. Make the TypeScript adapter load bytes using an explicit packaging mode:

   ```ts
   type WasmPackaging =
     | "external-binary"
     | "embedded-typescript";
   ```

   Default to `external-binary` for host neutrality unless this would break the published API; otherwise introduce it as the recommended mode with a compatibility default.

5. Add a generated manifest/schema file with Wasm ABI and parser-plan version numbers.

6. Add CLI flags and library options for packaging.

## Tests

- binary write, overwrite, stale cleanup, and hash mismatch;
- deterministic `.wasm` bytes;
- adapter loading from a relative file under Deno, Node, and Bun where supported;
- `WebAssembly.validate()` on generated bytes;
- no binary data is implicitly decoded as UTF-8;
- a text file and nested binary path collision is rejected.

## Likely files

- `src/ast.ts`
- `src/bundle.ts`
- `src/output.ts`
- `src/targets/wasm/plan.ts`
- `src/targets/wasm/runtime_emit.ts`
- `src/cli.ts`
- `tests/output_test.ts`
- `tests/wasm_test.ts`
- `tests/runtime_smoke.ts`

## Acceptance criteria

- `--target wasm` can produce `parser.wasm` without a giant byte-array source file.
- Generated ownership protection works identically for text and binary artifacts.
- Existing embedded packaging remains available during migration.
- The binary format and ABI versions are discoverable without parsing TypeScript source.

## Agent prompt

> Implement T02 from `tasks/README.md`. Generalize generated artifacts to support bytes, make the output writer binary-safe, and emit a real `.wasm` file with an optional TypeScript adapter. Preserve manifest safety and add end-to-end runtime tests.

---

# T03: internal runtime language front-end

**Suggested PR title:** `Add the Baba runtime language frontend and typed IR`

## Problem

The lexer/parser runtime is still represented by hand-maintained TypeScript templates and direct Wasm opcode emission. An internal language only helps if it becomes the single readable implementation of the runtime.

This task builds the front-end only. Do not port the parser runtime or delete current emitters yet.

## Language boundary

The runtime language is intentionally small and private. Suggested name: `BRL` (`Baba Runtime Language`). It should support only what the DFA/LR runtime needs:

- `bool`, `u8`, `u16`, `u32`, `i32`;
- records and fixed tagged variants;
- fixed arrays, spans/views, and growable vectors;
- functions with explicit parameter and result types;
- local variables;
- `if`, `while`, bounded `for`, `break`, `continue`, and `return`;
- explicit indexing and field access;
- a small set of declared intrinsics;
- no exceptions, async, reflection, closures, inheritance, dynamic dispatch, or host I/O.

## Required work

1. Write a normative semantics document at `src/runtime_language/SPEC.md` covering:

   - integer overflow and conversions;
   - signed/unsigned comparisons;
   - shift semantics;
   - evaluation order;
   - bounds checks;
   - trap versus structured error behavior;
   - record and vector ownership;
   - text and UTF-16 semantics;
   - allocation and reset rules.

2. Add `src/runtime_language/grammar.ebnf` and generate or hand-bootstrap its parser in a clearly documented Stage-0 path.

3. Add source AST types, name resolution, type checking, and diagnostics.

4. Lower valid programs into a target-neutral typed control-flow IR. Suggested properties:

   - basic blocks;
   - explicit branch/return terminators;
   - typed SSA-like values or typed locals;
   - no target syntax embedded in the IR;
   - stable function and record IDs;
   - verified control-flow and type invariants.

5. Add a verifier that rejects malformed IR.

6. Add conformance fixtures for every syntax form and type error.

## Suggested layout

```text
src/runtime_language/
  SPEC.md
  grammar.ebnf
  ast.ts
  parser.ts
  diagnostics.ts
  resolve.ts
  typecheck.ts
  ir.ts
  lower.ts
  verify.ts
  fixtures/
```

## Acceptance criteria

- The frontend can parse and type-check representative DFA traversal, stack manipulation, and reducer-like programs.
- Invalid programs produce multiple structured diagnostics where independent errors exist.
- The IR verifier has negative tests.
- No Wasm or TypeScript emitter exists in this PR.
- The language has no feature without a concrete parser-runtime use case documented in `SPEC.md`.

## Agent prompt

> Implement T03 from `tasks/README.md`. Build only the small internal BRL frontend, semantics spec, type checker, target-neutral control-flow IR, and verifier. Do not port Baba's runtime and do not add a general-purpose language feature without a documented runtime need.

---

# T04: runtime-language TypeScript backend and runtime port

**Suggested PR title:** `Compile the portable parser runtime to TypeScript`

## Problem

The TypeScript target currently emits the DFA walk, parser loop, branch search, reducers, CST construction, and diagnostics through hand-written source templates. This duplicates the Wasm implementation and makes semantic parity a permanent maintenance burden.

## Required work

1. Add a BRL-to-TypeScript backend that lowers the verified runtime IR.

2. Write the generic runtime once in BRL under:

   ```text
   src/runtime/
     lexer.brl
     parser.brl
     branch_search.brl
     reductions.brl
     diagnostics.brl
     cst.brl
   ```

3. The BRL runtime must consume `PortableParserPlanV1`; grammar-specific logic must remain plan data.

4. Generate a checked-in Stage-0 TypeScript runtime artifact or compile BRL during Baba generation. Prefer a checked-in deterministic compiler artifact if compiling for every grammar materially increases generation cost.

5. Change the TypeScript target to emit:

   - generated syntax types;
   - grammar-specific plan data;
   - compiled generic runtime;
   - a thin module adapter.

6. Delete or reduce target-template algorithms in:

   - `src/targets/typescript/lexer_emit.ts`
   - `src/targets/typescript/parser_emit.ts`

   These files may package data, but must not contain independent lexer/parser algorithms afterward.

7. Preserve the current public API unless an explicit compatibility shim is added:

   ```text
   lex
   parse
   parseTokens
   parseTokensUnchecked
   positionAt
   createSourceMap
   ```

## Tests

- exact output parity with the old TypeScript runtime over existing fixtures before deleting the old path;
- BRL TypeScript conformance suite;
- Deno, Node, and Bun runtime smoke;
- deterministic generated source;
- no imports from Baba at generated-runtime execution time;
- generated source-size comparison.

## Acceptance criteria

- There is one readable BRL implementation of DFA/LR/CST execution.
- TypeScript emitters no longer independently implement those algorithms.
- Existing fixtures and public API tests pass.
- Runtime-language compiler output is deterministic.

## Agent prompt

> Implement T04 from `tasks/README.md`. Add the BRL TypeScript backend, port the complete portable parser runtime to BRL, and make generated TypeScript consume `PortableParserPlanV1`. Remove algorithm duplication from TypeScript emitters while preserving the public runtime API.

---

# T05: runtime-language Wasm backend and runtime port

**Suggested PR title:** `Compile the portable parser runtime to WebAssembly`

## Problem

`src/targets/wasm/module_emit.ts` directly assembles a large parser-specific core Wasm program from opcode arrays. This is difficult to review, hard to evolve, and duplicates semantics implemented elsewhere.

## Required work

1. Add a BRL-to-core-Wasm backend using the verified runtime IR.

2. Separate the generic Wasm binary encoder from parser semantics:

   ```text
   runtime language IR -> Wasm IR -> binary encoder
   ```

   Parser-specific code must not manually append opcode bytes.

3. Compile the same BRL runtime modules used by T04.

4. Consume `PortableParserPlanV1` as data segments or a validated serialized plan.

5. Preserve UTF-16 span parity with TypeScript unless T08 changes the ABI contract.

6. Replace `src/targets/wasm/module_emit.ts` with a small packaging/lowering layer. Delete direct parser algorithm emission from it.

7. Add Wasm validation before including bytes in a bundle. Generation should return a structured diagnostic if the emitted module is invalid.

8. Preserve the generated TypeScript adapter temporarily; T08 will redesign instance and memory ownership.

## Tests

- BRL TypeScript and BRL Wasm conformance programs return identical results;
- generated Wasm validates in JavaScript and with an independent validator when available;
- exact TypeScript/Wasm lexer, parser, CST, field, and diagnostic parity;
- deterministic Wasm bytes;
- non-BMP Unicode and malformed source;
- declared conflict branches;
- large parser tables.

## Acceptance criteria

- No lexer/parser algorithm is hand-coded in Wasm opcodes.
- The Wasm backend is a general backend for the small runtime language, not a parser-specific byte template.
- TypeScript and Wasm compile the same runtime source and execute the same plan version.

## Agent prompt

> Implement T05 from `tasks/README.md`. Add a typed BRL-to-Wasm backend, compile the shared parser runtime, and replace parser-specific manual opcode emission. Keep a general Wasm encoder separate from parser semantics and prove exact parity with the BRL TypeScript backend.

---

# T06: contextual lexing and token selection

**Suggested PR title:** `Add parser-contextual token selection to the portable runtime`

## Problem

A global maximal-munch lexer cannot represent every grammar accepted by a contextual lexer. Explicit priority does not solve cases where two tokens match the same text but only one is valid in the current parser state.

Example:

```ebnf
token A priority 10 = /x/ ;
token B priority 0 = /x/ ;
module = "a" A | "b" B ;
```

A global lexer always emits `A`, making `b x` fail. The parser knows that only `B` is valid after `b`.

## Required work

1. Change DFA accept states to retain all accepting candidates in deterministic priority order, not only one selected token.

2. Add expected-terminal information to the portable parser plan in a form efficient enough for runtime filtering, preferably bitsets.

3. Define two explicit APIs/semantics:

   - `lex(source)`: global tokenization using documented priority rules;
   - `parse(source)`: contextual tokenization that selects the best candidate accepted by the current LR state, plus trivia.

4. Decide how contextual lexing interacts with reductions before shifts. The runtime may need to compute the parser state after zero or more reductions before selecting a token. Document the algorithm and prove termination.

5. Define conflict behavior when several expected candidates have equal match length and priority.

6. Update overlap diagnostics:

   - overlap is not automatically an error if contextual selection makes both tokens reachable;
   - skip-token overlap that can hide a parser token remains an error;
   - standalone `lex()` ambiguities should be warnings with a witness;
   - strict portability should reject cases that Tree-sitter and the portable runtime cannot align on.

7. Lower the same lexical-priority contract into Tree-sitter.

## Tests

- the example above accepts both branches under `parse()`;
- `lex()` remains deterministic and documented;
- keyword/identifier overlap;
- skip/token overlap;
- literal/token overlap;
- reductions before contextual token selection;
- TypeScript/Wasm exact parity;
- Tree-sitter acceptance parity for portable fixtures.

## Acceptance criteria

- Both token candidates can be reached when grammar context distinguishes them.
- DFA candidate ordering is deterministic.
- No backend invents separate priority semantics.
- Runtime complexity is bounded and benchmarked.

## Agent prompt

> Implement T06 from `tasks/README.md`. Preserve all DFA accept candidates and add parser-contextual token selection driven by LR expected-terminal sets. Keep standalone `lex()` deterministic, update overlap diagnostics, and prove TypeScript/Wasm plus Tree-sitter acceptance behavior with focused fixtures.

---

# T07: stable conflicts and bounded ambiguity

**Suggested PR title:** `Replace textual conflict matching with stable production identities`

## Problem

Parser conflict metadata currently matches rule names and substrings of generated production descriptions. A harmless grammar reformat or description change can alter which conflict is resolved. Declared conflicts also activate branch search whose resource behavior and ambiguity policy need a formal contract.

## Required work

1. Give every user-visible alternative and production a stable identity derived from grammar structure rather than display text. Possible model:

   ```text
   rule:primary/alternative:1
   rule:postfix/expression:field:suffixes/repeat
   ```

   IDs must survive whitespace and formatting changes.

2. Include stable conflict IDs in LR diagnostics.

3. Redesign parser metadata around stable selectors while preserving `version: 1` compatibility:

   ```json
   {
     "parser": {
       "resolutions": [
         {
           "conflict": "c_...",
           "on": "[",
           "prefer": "shift"
         }
       ]
     }
   }
   ```

   A future metadata `version: 2` is acceptable, but add a migration diagnostic/tool or continue reading v1.

4. Validate every resolution and conflict declaration:

   - unknown rule/production/conflict;
   - selector matches no action;
   - selector matches more actions than intended;
   - duplicate or contradictory resolutions;
   - declared conflict that never occurs.

5. Define branch-search semantics:

   - action ordering;
   - maximum explored branches;
   - maximum queued branches;
   - maximum copied stack/trace cells;
   - behavior when two parses succeed;
   - best-failure selection;
   - cancellation/resource-limit diagnostics.

6. Make limits configurable in shared runtime options and identical in TypeScript and Wasm.

7. Consider reporting ambiguity when more than one branch succeeds instead of silently returning the first. Provide an option if backward compatibility requires first-success behavior.

## Tests

- conflict selectors survive grammar whitespace changes;
- stale metadata is rejected clearly;
- reduce/reduce selection uses stable IDs;
- two-success ambiguity behavior;
- branch and memory limits;
- high fan-out conflicts;
- TypeScript/Wasm parity for success and failure ordering.

## Acceptance criteria

- No conflict resolution uses `description.includes(...)`.
- Diagnostics contain copy-pastable stable conflict selectors.
- Branch search cannot grow without explicit limits.
- The runtime has a documented deterministic policy for ambiguous success.

## Agent prompt

> Implement T07 from `tasks/README.md`. Replace textual conflict matching with stable structural IDs, validate all conflict metadata, formalize bounded branch-search semantics, and keep TypeScript/Wasm behavior exactly aligned.

---

# T08: Wasm ABI, memory lifecycle, and reentrancy

**Suggested PR title:** `Stabilize the Wasm parser ABI and instance lifecycle`

## Problem

The current generated Wasm adapter instantiates a module at import time, exposes a singleton memory, caches source globally, grows memory as needed, and does not present a complete host-neutral ownership contract. This is hard to use safely in workers, servers, and non-JavaScript hosts.

## Required work

1. Write `docs/wasm-abi.md` defining:

   - ABI version;
   - parser-plan version;
   - input encoding;
   - span units;
   - pointer and length types;
   - alignment;
   - result lifetime;
   - reset/free semantics;
   - error return codes;
   - memory growth and limits;
   - whether one instance is reentrant.

2. Export version functions from the core module:

   ```text
   baba_abi_version
   baba_plan_version
   ```

3. Replace the eager global singleton API with a factory:

   ```ts
   createParser(options?): ParserInstance
   createParserAsync(options?): Promise<ParserInstance>
   ```

   A compatibility singleton may remain as a convenience wrapper.

4. Each instance must own its module instance, memory, caches, and limits.

5. Add explicit reset/reuse behavior. A result must state whether it remains valid until next parse, reset, or disposal.

6. Add resource limits:

   ```text
   maxInputUnits
   maxTokens
   maxParserStack
   maxTraceActions
   maxBranches
   maxBranchCells
   maxMemoryPages
   ```

7. Check every multiplication and pointer addition for 32-bit overflow before touching memory.

8. Avoid returning typed-array views that become silently stale after `memory.grow`; copy results or document and enforce view lifetime.

9. Run the `.wasm` in at least one non-JavaScript engine in CI, such as Wasmtime, and validate with `wasm-tools validate`.

## Tests

- 10,000 sequential parses with bounded memory growth;
- two parser instances used interleaved;
- reset and disposal;
- resource-limit diagnostics;
- pointer/size overflow unit tests;
- memory growth invalidating old views;
- independent Wasm engine smoke;
- browser-compatible async factory where feasible.

## Acceptance criteria

- Importing the adapter does not require synchronous Wasm compilation unless using an explicit convenience path.
- Memory ownership and result lifetime are documented and tested.
- No global source cache is shared across parser instances.
- The core `.wasm` can be invoked without Baba or generated TypeScript source.

## Agent prompt

> Implement T08 from `tasks/README.md`. Stabilize and version the core Wasm ABI, replace global singleton state with parser instances, define memory/result ownership, add hard resource limits and overflow checks, and test repeated/reentrant use plus an independent Wasm engine.

---

# T09: analysis and resource hardening

**Suggested PR title:** `Harden regex and grammar analysis against pathological input`

## Problem

Compiler resource use is currently controlled mainly by final DFA/LR limits. Pathological regexes or grammars can consume substantial time and memory during parsing, NFA expansion, determinization, pairwise overlap checking, closure construction, or table generation before a final limit fires.

## Required work

1. Parse each token regex once during generic analysis and store the `RegexAst` on the analyzed token. Remove JavaScript `new RegExp(...)` validation from the EBNF parser.

2. Emit Tree-sitter regexes from the canonical `RegexAst`, not from raw source text. Add capability diagnostics for semantics that cannot be represented exactly.

3. Add configurable compiler work limits:

   ```text
   regexAstNodeLimit
   boundedRepeatLimit
   nfaStateLimit
   dfaStateLimit
   overlapProductStateLimit
   lrClosureWorkLimit
   grammarExpressionDepthLimit
   diagnosticLimit
   ```

4. Cache each token/literal automaton once. Pairwise overlap checks must intersect cached DFAs rather than determinizing both patterns repeatedly.

5. Add static grammar analyses:

   - productive/nonproductive rules;
   - nullable recursive cycles;
   - rules that can only derive empty text;
   - reachable tokens that can never be emitted because of priority;
   - unused skip declarations;
   - root language that is necessarily empty.

6. Avoid recursive traversals that can overflow the JavaScript call stack on adversarial input.

7. Add structured diagnostics with source spans and the phase that exceeded its budget.

## Tests

- huge bounded repetitions;
- deeply nested groups and EBNF expressions;
- exponential-looking alternations;
- many overlapping tokens;
- nullable cycles;
- nonproductive mutually recursive rules;
- deterministic early termination at every limit;
- no generic internal error for expected exhaustion.

## Acceptance criteria

- A user-controlled grammar cannot trigger unbounded intermediate expansion without a configurable limit.
- Regexes are parsed once and shared by all targets.
- Tree-sitter and portable runtimes derive regex semantics from the same AST.
- Overlap checking reuses cached automata.

## Agent prompt

> Implement T09 from `tasks/README.md`. Centralize parsed regexes in generic analysis, emit Tree-sitter regexes from the canonical AST, add work limits and automaton caching, and add productive/nullable-cycle analyses with adversarial tests.

---

# T10: differential, fuzz, performance, and release gates

**Suggested PR title:** `Make runtime parity and resource behavior release gates`

## Problem

Unit tests are strong but still mostly exercise curated grammars. The new architecture needs proof that runtime-language TypeScript and Wasm implementations execute the same plan, that Tree-sitter agrees on accepted input for the portable subset, and that memory/performance regressions are visible.

## Required work

1. Expand fixture families:

   ```text
   fixtures/
     expressions/
     declarations/
     json-like/
     markup-like/
     overlapping-tokens/
     nullable-rules/
     ambiguous-types/
     unicode/
     large-generated/
   ```

2. For every portable fixture:

   - generate Tree-sitter, TypeScript, and Wasm;
   - run valid and invalid corpora;
   - require TypeScript and Wasm to produce identical normalized lex results, parse results, diagnostics, CST children, fields, and spans;
   - compare only acceptance with Tree-sitter.

3. Add property tests:

   - lexer always advances or emits EOF;
   - token spans are monotonic;
   - CST children are contained by parents;
   - field values reference contained elements;
   - successful plans contain no unresolved action unless declared;
   - plan serialization is deterministic;
   - `parse(source)` agrees with checked token parsing for canonical tokenization.

4. Add fuzz targets for:

   - EBNF parsing;
   - portable regex parsing;
   - NFA/DFA construction;
   - DFA intersection;
   - LR table construction;
   - parser-plan validation/deserialization;
   - BRL parser/type checker/IR verifier;
   - generated TypeScript runtime;
   - Wasm ABI calls.

5. Turn benchmarks into tracked metrics:

   - compile time;
   - plan size;
   - generated TypeScript size;
   - Wasm byte size;
   - lex throughput;
   - deterministic parse throughput;
   - conflict parse throughput;
   - peak memory/pages;
   - repeated-parse memory growth.

6. Add CI jobs for:

   - Deno, Node, Bun runtime smoke for both TypeScript and Wasm adapters;
   - `wasm-tools validate`;
   - Wasmtime core-module smoke;
   - bootstrap artifact drift;
   - generated-example drift;
   - a short deterministic fuzz seed suite.

7. Keep long fuzzing and benchmarks in scheduled or manually dispatched workflows. PR CI should remain bounded and deterministic.

## Acceptance criteria

- Exact TypeScript/Wasm parity is a required CI gate.
- Tree-sitter portable-subset acceptance is a required CI gate.
- Wasm memory reuse has a regression test.
- Benchmark output is machine-readable JSON as well as human-readable text.
- Every previous production bug gets a minimal fixture.

## Agent prompt

> Implement T10 from `tasks/README.md`. Build comprehensive differential fixtures, property tests, deterministic fuzz seeds, runtime-language conformance tests, Wasm validation, and machine-readable benchmark/release gates. Do not change parser semantics to make tests pass; expose mismatches as failures.

---

# T11: package, example, and documentation hygiene

**Suggested PR title:** `Reduce published artifact weight and document architecture`

## Problem

The package publish list includes `examples/**/*`, including large checked-in generated TypeScript adapters and byte-array Wasm sources. Examples are valuable, but publishing every generated artifact increases package size and makes source reviews noisy. The architecture also needs explicit decision records now that Baba has three targets and an internal runtime language.

## Required work

1. Measure and document:

   - repository size by directory;
   - JSR publish payload size;
   - generated output size for each example;
   - duplicate bytes between TypeScript and Wasm outputs.

2. Stop publishing checked-in generated example artifacts unless they are necessary for consumers. Prefer:

   ```text
   examples/<name>/grammar.ebnf
   examples/<name>/baba.json
   examples/<name>/programs/*
   examples/<name>/README.md
   examples/<name>/interpreter.ts
   ```

   Generate parser artifacts during example tests.

3. Decide whether generated example outputs remain in Git:

   - If retained, add a CI drift check and place them under clearly marked snapshots.
   - If removed, provide one command per example to regenerate them.

4. Add architecture decision records:

   ```text
   docs/adr/0001-scope.md
   docs/adr/0002-portable-parser-plan.md
   docs/adr/0003-runtime-language.md
   docs/adr/0004-wasm-abi.md
   docs/adr/0005-contextual-lexing.md
   docs/adr/0006-conflict-policy.md
   ```

5. Split README details into focused documents while keeping a concise quick start:

   ```text
   docs/grammar.md
   docs/metadata.md
   docs/portable-runtime.md
   docs/wasm.md
   docs/diagnostics.md
   docs/limits.md
   ```

6. Add a package-size budget and a generated-artifact-size budget to CI.

7. Update stale module comments, especially any text that says the CLI emits only Tree-sitter artifacts.

## Acceptance criteria

- Published package size is materially smaller or has an explicit justified budget.
- Examples remain one-command reproducible.
- Architectural contracts are documented outside implementation source.
- No generated snapshot can drift silently.
- README remains concise enough for a new user to find installation, grammar syntax, target selection, and links to deeper docs quickly.

## Agent prompt

> Implement T11 from `tasks/README.md`. Reduce published/generated example weight, add reproducibility or drift checks, introduce architecture decision records and focused docs, and establish package/generated-size budgets. Do not change parser behavior.

---

# Integration checklist

After all task PRs are merged, the integration owner should verify:

- [ ] `AnalyzedGrammar` is the only target input before target planning.
- [ ] `PortableParserPlanV1` is built once per compile.
- [ ] TypeScript and Wasm execute the same BRL runtime source.
- [ ] No parser algorithm remains duplicated in target emitters.
- [ ] No parser-specific Wasm opcode template remains.
- [ ] Regexes are parsed once and canonically lowered to every backend.
- [ ] Contextual token selection has a written contract.
- [ ] Conflict selectors are stable and branch search is bounded.
- [ ] Wasm ABI, memory lifetime, encoding, and resource limits are versioned.
- [ ] Binary artifacts are first-class generated files.
- [ ] TypeScript/Wasm exact parity is enforced in CI.
- [ ] Tree-sitter acceptance parity is enforced for the portable subset.
- [ ] Runtime-language semantics have a conformance suite.
- [ ] Bootstrap artifacts regenerate deterministically.
- [ ] Package and generated-output size budgets are enforced.

# Release recommendation

Do not add another public target or another parser feature while P0 tasks remain incomplete.

A credible next major milestone is not “more backends.” It is:

> One versioned parser plan and one portable runtime implementation, compiled to TypeScript and Wasm, with exact behavioral parity and explicit resource limits.
