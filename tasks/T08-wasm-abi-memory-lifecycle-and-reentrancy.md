# T08: Wasm ABI, memory lifecycle, and reentrancy

- **Priority:** P0
- **Estimated size:** Large
- **Merge wave:** 4
- **Depends on:** [T02](./T02-binary-artifacts-and-wasm-packaging.md), [T05](./T05-runtime-language-wasm-backend.md)
- **Suggested PR title:** `Stabilize the Wasm parser ABI and instance lifecycle`

[Back to task index](./README.md)

## Objective

Turn the generated Wasm parser into a versioned, host-neutral, resource-bounded runtime with explicit instance ownership and memory/result lifetimes.

## Problem

The current adapter model is convenient for JavaScript but not a complete ABI contract. Risks include:

- eager singleton instantiation;
- global source/cache state;
- unclear reentrancy;
- unclear result lifetime;
- memory growth invalidating views;
- no explicit reset/disposal contract;
- insufficient resource limits;
- pointer arithmetic overflow;
- claims of Wasm portability that are tested mainly through JavaScript hosts.

## Required work

### 1. Write the ABI specification

Create:

```text
docs/wasm-abi.md
```

Normatively define:

- core Wasm versus Component Model status;
- ABI version and parser-plan version;
- exported/imported functions;
- input encoding;
- span units;
- pointer and length types;
- endianness;
- alignment;
- record layouts;
- memory ownership;
- parser instance ownership;
- source/result lifetime;
- reset and disposal;
- error codes;
- trap policy;
- resource limits;
- thread/reentrancy guarantees;
- behavior after memory growth.

### 2. Export version information

The core module should expose functions or immutable globals equivalent to:

```text
baba_abi_version() -> u32
baba_plan_version() -> u32
baba_semantics_version() -> u32
```

The generated manifest must carry matching values.

### 3. Replace global singleton state with parser instances

Generate a factory API:

```ts
export interface ParserInstance {
  lex(source: string, options?: LexOptions): LexResult;
  parse(source: string, options?: ParseOptions): ParseResult;
  parseTokens(source: string, tokens: readonly Token[]): ParseResult;
  reset(): void;
  dispose(): void;
}

export function createParser(options?: ParserInstanceOptions): ParserInstance;
export function createParserAsync(
  options?: AsyncParserInstanceOptions,
): Promise<ParserInstance>;
```

Each instance owns:

- `WebAssembly.Instance`;
- memory;
- source buffers;
- token/result arenas;
- caches;
- configured limits;
- disposed state.

A backwards-compatible module-level `lex`/`parse` may lazily use one default instance, but it must be documented as a convenience wrapper.

### 4. Define source encoding and span units

Select one contract and test it.

Recommended initial contract for API parity:

```text
Input copied as UTF-16 code units.
All public spans use UTF-16 code-unit offsets.
```

If a host-neutral UTF-8 API is introduced, expose dual byte/UTF-16 offsets or a clearly separate ABI function set. Do not overload one ambiguous `start/end` representation.

Test:

- BMP characters;
- non-BMP characters;
- combining marks;
- CRLF;
- NUL;
- U+2028/U+2029;
- empty input.

### 5. Define arena/result lifetime

Choose an explicit model, for example:

```text
Each parse uses instance-owned scratch and result arenas.
Returned JavaScript objects are copied out and remain valid.
Raw ABI views remain valid until the next parse, reset, or dispose.
reset() reuses allocated memory without shrinking.
dispose() invalidates the instance.
```

Or use result handles with `result_free(handle)`.

Document and enforce the chosen model.

### 6. Add hard resource limits

Shared/configurable limits should include:

```ts
interface ParserInstanceLimits {
  maxInputUnits?: number;
  maxTokens?: number;
  maxParserStack?: number;
  maxTraceActions?: number;
  maxExploredBranches?: number;
  maxQueuedBranches?: number;
  maxBranchCells?: number;
  maxCstNodes?: number;
  maxCstChildren?: number;
  maxDiagnostics?: number;
  maxMemoryPages?: number;
}
```

Every limit failure should return a stable structured code:

```text
INPUT_LIMIT_EXCEEDED
TOKEN_LIMIT_EXCEEDED
PARSER_STACK_LIMIT_EXCEEDED
TRACE_LIMIT_EXCEEDED
PARSER_BRANCH_LIMIT_EXCEEDED
CST_NODE_LIMIT_EXCEEDED
MEMORY_LIMIT_EXCEEDED
```

### 7. Check arithmetic overflow

Before all linear-memory calculations, check:

- multiplication overflow;
- pointer addition overflow;
- alignment overflow;
- page-count overflow;
- capacities exceeding i32/u32 representation;
- negative values crossing the adapter boundary.

Do not rely on Wasm wrapping arithmetic for allocation safety.

### 8. Handle memory growth safely

Typed array/DataView objects become stale after `memory.grow`.

Requirements:

- never retain a view across a possible grow operation;
- recreate views after growth;
- do not expose raw mutable views without documenting invalidation;
- tests must force memory growth and exercise old-view behavior.

### 9. Make initialization host-friendly

Support:

- bytes;
- precompiled `WebAssembly.Module`;
- async URL/Response loading in adapters where appropriate;
- externally supplied memory only if the ABI can support it safely.

Avoid mandatory synchronous compilation at module import time.

### 10. Validate in independent hosts

Add CI/runtime checks with:

- JavaScript `WebAssembly.validate()`;
- Deno adapter;
- Node adapter;
- Bun adapter;
- `wasm-tools validate`;
- Wasmtime execution of at least a low-level ABI smoke test.

### 11. Add repeated/reentrant stress tests

Test:

- 10,000 sequential parses;
- memory stabilizes/reuses after warmup;
- two instances interleaved;
- reset between calls;
- dispose and subsequent method failure;
- parser creation from one module multiple times;
- concurrent workers where CI permits.

## Likely files

- `docs/wasm-abi.md`
- BRL Wasm runtime and intrinsic definitions
- `src/targets/wasm/runtime_emit.ts`
- `src/targets/wasm/plan.ts`
- `src/ast.ts`
- `src/cli.ts`
- `tests/wasm_test.ts`
- `tests/runtime_smoke.ts`
- `tests/ts_wasm_parity_test.ts`
- `.github/workflows/ci.yml`

## Acceptance criteria

- ABI and plan versions are exported and documented.
- Importing the adapter does not require eager synchronous Wasm compilation unless explicitly requested.
- Parser state is instance-owned, not globally shared.
- Source and result lifetimes are explicit.
- Reset/reuse and disposal are tested.
- Every memory calculation is overflow-checked.
- Memory growth cannot leave internally used stale views.
- Hard resource limits exist and match TypeScript semantics where applicable.
- Core module executes in an independent Wasm engine.

## Out of scope

- full Component Model/WIT conversion;
- WASI filesystem/network integration;
- external scanner ABI;
- shared-memory threads;
- incremental parsing;
- user-language code generation.

## Copy-ready agent prompt

> Implement T08 from `tasks/T08-wasm-abi-memory-lifecycle-and-reentrancy.md`. Version and document the core Wasm ABI, replace global singleton state with parser instances, define source/result/memory ownership, add reset/disposal and hard resource limits, guard all pointer arithmetic, and test repeated/reentrant use plus an independent Wasm engine.

## PR checklist

- [ ] Normative ABI document added.
- [ ] ABI/plan/semantics versions exported.
- [ ] Instance factory API added.
- [ ] Global cache/state removed or isolated to compatibility wrapper.
- [ ] Resource limits and overflow checks added.
- [ ] Memory growth view safety tested.
- [ ] Wasmtime/wasm-tools smoke added.
- [ ] Full repository checks pass.
