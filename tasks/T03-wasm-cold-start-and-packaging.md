# T03: Wasm cold start and packaging

- **Priority:** P0
- **Size:** Large
- **Depends on:** [T00](./T00-measure-runtime-size-and-latency.md)
- **Suggested PR title:** `Use one cached generic Wasm runtime`

[Back to index](./README.md)

## Objective

Remove the architectural reason a grammar can produce hundreds of kilobytes of Wasm and take seconds to start. Wasm should be an optional cached executor for compact parser-plan data, not a newly emitted program for every grammar.

## Problem

A syntax runtime is mostly tables plus a small executor. If Baba emits a fresh Wasm binary for every grammar, users pay setup cost per grammar even though all binaries run the same DFA and LR algorithms.

For small files, Wasm can also be slower than TypeScript because setup, input copying, and JavaScript object construction dominate the actual parse.

## Required work

### 1. Define explicit Wasm modes

Add a mode option:

```text
shared-generic      one reusable executor plus parser-plan data
none                no Wasm output
legacy-specialized  old grammar-specific binary, opt-in only
```

Recommended behavior:

```text
--target wasm  -> shared-generic
--target all   -> shared-generic or no Wasm unless requested explicitly
```

The default must not create a grammar-specialized Wasm binary.

### 2. Add one generic Wasm executor

The package should include one reusable runtime that can execute parser-plan tables.

It should handle:

- DFA table execution;
- LR table execution;
- optional branch handling;
- resource limits;
- compact trace or result output.

It should not contain grammar-specific tables in code sections.

### 3. Cache startup work

The adapter should prepare the generic executor once per process or realm and reuse it for many parser plans. Parser instances can share prepared code while keeping separate memory and state.

Add tests proving two different parser plans do not repeat the expensive cold-start path.

### 4. Add TypeScript fallback and auto mode

Do not force Wasm for small files. Add an engine policy:

```text
typescript  always use the shared TypeScript runtime
wasm        always use the generic Wasm runtime
auto        use TypeScript for small or first parses, Wasm for larger inputs
```

Example behavior:

```text
source below threshold -> TypeScript runtime
source above threshold -> Wasm runtime
```

Expose a debug counter or callback so benchmarks can see which engine ran.

### 5. Make Wasm async and explicit

Preferred user model:

```text
createParser(plan)            -> synchronous TypeScript parser
createWasmParser(plan)        -> asynchronous Wasm parser
createAutoParser(plan)        -> hybrid policy
```

Avoid synchronous Wasm work at module import time.

### 6. Stop duplicating runtime payloads per generated grammar

Generated adapters should import or reference the shared runtime. They should not include a large byte array or generated binary for every grammar.

If offline vendoring is needed, make it explicit in a later command:

```text
baba vendor-runtime --target wasm --out vendor/
```

### 7. Add timing hooks

Expose optional benchmark events:

```text
load runtime
prepare runtime
create instance
load plan
copy input
lex
parse trace
build result
```

These events should be used by benchmarks and not appear in normal parse results.

### 8. Avoid duplicate Wasm executors

If the current path uses separate executor binaries for lexing and parser tracing, combine them or move one phase back to the TypeScript runtime. Two startup costs are worse than one unless benchmarks prove the split helps.

### 9. Do not always build a full result

For validation-only and trace-only paths, avoid building the full JavaScript CST. This task should expose the necessary Wasm API seam; T05 owns the parse-mode design.

## Good architecture

```text
package install -> one generic runtime available
compile grammar -> compact parser plan
run parser -> cached generic runtime plus plan data
```

## Bad architecture

```text
compile grammar -> emit a new runtime program -> embed a large runtime payload -> prepare it on first parse
```

## Likely files

- `src/runtime/wasm.ts`
- `src/runtime/mod.ts`
- `src/targets/wasm/plan.ts`
- `src/targets/wasm/runtime_emit.ts`
- `src/targets/wasm/module_emit.ts`
- `src/targets/wasm/parser_emit.ts`
- `src/cli.ts`
- `deno.json`
- `tests/wasm_test.ts`
- `tests/runtime_smoke.ts`
- `bench/ts_vs_wasm.ts`

## Tests

1. default Wasm target does not emit a grammar-specialized binary;
2. one generic executor is reused for two parser plans;
3. two parser instances share prepared code but have isolated state;
4. importing generated adapter performs no expensive synchronous Wasm setup;
5. async Wasm parser works;
6. TypeScript fallback works without Wasm;
7. auto mode selects TypeScript below threshold and Wasm above threshold;
8. timing hooks report cold-start phases;
9. large-runtime fixture no longer emits a huge per-grammar Wasm payload;
10. legacy-specialized mode works only when explicitly requested.

## Acceptance criteria

- Default Wasm generation emits no grammar-specialized runtime binary.
- Generic Wasm startup is cacheable and shared.
- Small-file parsing can avoid Wasm cold start entirely.
- Generated output no longer contains a large runtime payload per grammar.
- The reported multi-second startup failure is impossible in the default path.
- Benchmarks show cold-start improvement against the T00 baseline.

## Out of scope

- compact plan binary format; see T02;
- lazy CST; see T05;
- TypeScript output slimming; see T04;
- grammar semantics changes;
- Wasm Component/WIT packaging.

## Copy-ready agent prompt

> Implement T03 from `tasks/T03-wasm-cold-start-and-packaging.md`. Replace default grammar-specialized Wasm generation with one cached generic Wasm runtime that executes compact parser plans. Make Wasm async and explicit, add a TypeScript fallback/auto mode for small files, remove large per-grammar runtime payloads from normal output, and prove the large-runtime fixture no longer pays per-grammar cold-start cost.
