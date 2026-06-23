# Task 177: Runtime Wasm Host-Neutral ABI

## Goal

Close the Wasm side of the source-of-truth proof by ensuring non-JavaScript
hosts can execute the same runtime-language-owned parser runtime through a
documented core ABI.

Deno's JavaScript adapter and Wasmtime both prove useful pieces today. This task
turns the descriptor and core exports into an executable host-neutral contract
for source input, token/result buffers, parse tracing, diagnostics, and lifetime
rules.

## Depends On

- `170-runtime-source-of-truth-cutline.md`
- `172-runtime-lexer-driver-lowering.md`
- `173-runtime-token-stream-normalization-lowering.md`
- `174-runtime-replay-vm-lowering.md`

## Files To Inspect

- `src/targets/wasm/runtime_emit.ts`
- `src/targets/wasm/plan.ts`
- `src/targets/wasm/lexer_emit.ts`
- `src/targets/wasm/parser_emit.ts`
- `src/targets/runtime/wasm_abi.ts`
- `tests/wasm_test.ts`
- `docs/runtime-language.md`
- `README.md`

## Search Commands

```sh
rg -n "abi|wasmTargetKind|writeSource|reset|lexAll|parseTrace|wasmtime|wasm-tools|source_encoding|span_unit|host ownership|result lifetime" src tests docs README.md
```

## Work

1. Define the minimum non-JS core ABI required after runtime lowering.
2. Extend generated `wasm/abi.json` and core exports where descriptor-only
   fields are insufficient.
3. Add Wasmtime or `wasm-tools` driven tests for the host-neutral ABI surface.
4. Keep JavaScript adapter ergonomics unchanged.
5. Update README and runtime-language docs with exact support boundaries.
6. Update `tasks/status.md`.

## Acceptance

- A non-JS host can discover and exercise the documented core ABI without
  scraping generated TypeScript.
- CI validates the core ABI path with independent Wasm tooling.
- Focused checks pass:

```sh
deno task bootstrap:check
deno fmt --check
git diff --check
deno test -A tests/wasm_test.ts tests/ts_wasm_parity_test.ts
```

## Do Not Touch

- Do not claim WASI or Component Model support unless implemented.
- Do not remove or break the JavaScript-hosted adapter.
- Do not require Wasmtime for ordinary generated parser consumers.

## Completion Notes

Completed on 2026-06-23.

- Generated `wasm/abi.json` descriptors and core exports document the
  JavaScript-hosted core-Wasm ABI surface, including source encoding, span
  units, input/result buffer ownership, trace statuses, parser-plan identity,
  runtime implementation identity, diagnostic schemas, and adapter handle
  lifetime rules.
- `tests/wasm_test.ts` includes independent-tooling validation for `wasm-tools`
  and Wasmtime when those binaries are installed; CI provisions both before
  `deno task test`, while ordinary local consumers do not need Wasmtime.
- README and runtime-language docs keep the support boundary explicit: Baba
  emits JavaScript-hosted core Wasm adapters today, not WASI, Component Model,
  WIT, or browser-only packages.
