# Task 050: Wasm ABI Lifecycle, Encoding, And Independent Hosts

## Goal

Finish FEEDBACK P0.7, P0.8, P1.16, and P1.17 for the current Wasm product
boundary.

## Files To Inspect

- `src/targets/runtime/wasm_abi.ts`
- `src/targets/runtime/wasm_core_runtime.ts`
- `src/targets/wasm/runtime_emit.ts`
- `src/targets/wasm/plan.ts`
- `tests/wasm_test.ts`
- `tests/ts_wasm_parity_test.ts`
- `README.md`
- `docs/runtime-language.md`

## Search Commands

```sh
rg -n "abi_version|plan_version|reset|max_pages|source_encoding|span_unit|ownership|lifetime|memory.grow|overflow|wasmtime|wasm-tools|deterministic" src tests README.md docs
```

## Work

1. Verify public docs state the actual product: JavaScript-hosted Wasm adapter
   unless independent host tests exist.
2. Verify ABI exports include version, plan version, reset, input base, max
   pages, source encoding, span unit, ownership, and result lifetime.
3. Add missing overflow checks before `length * element_size`, `base + offset`,
   and memory growth.
4. Add repeated-parse memory reuse coverage if not already present.
5. Add independent engine validation where available:
   - `wasm-tools validate`;
   - Wasmtime execution or a skipped test that explains the missing binary.

## Acceptance

- `wasm/abi.json` documents ownership and lifetime models.
- UTF-16 span units are tested with emoji, combining marks, CRLF, NUL, and
  U+2028/U+2029.
- Repeated parse test proves bounded memory growth.
- Deterministic Wasm bytes are tested.

## Commands

```sh
deno test -A tests/wasm_test.ts tests/ts_wasm_parity_test.ts
deno task bootstrap:check
```

## Do Not Touch

- Do not claim host-neutral Wasm support unless a non-JS engine test passes.
- Do not replace the JS adapter API in this task.
