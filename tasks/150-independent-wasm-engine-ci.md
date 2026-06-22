# Task 150: Independent Wasm Engine CI

## Goal

Close FEEDBACK P1.17 locally and in CI. The repository already has independent
engine checks in `tests/wasm_test.ts`, but they are ignored when
`wasm-tools`/`wasmtime` are absent. This task makes those checks execute in the
release environment and keeps the product claim honest.

## Why Deno Is Not Enough

Deno can run Wasm through JavaScript `WebAssembly.instantiate`, which proves the
JavaScript-hosted Wasm adapter works in a JS engine. It does not prove a
non-JavaScript host can load the core module, follow the documented
linear-memory ABI, call exported functions, and observe the same behavior.

Wasmtime is useful because it is an independent Wasm runtime outside the JS host
family. `wasm-tools validate` separately proves the module validates according
to Wasm tooling, without running through Deno's JS adapter path.

## Files To Inspect

- `tests/wasm_test.ts`
- `.github/workflows/` if present
- `deno.json`
- `README.md`
- `docs/runtime-language.md`
- `src/targets/wasm/runtime_emit.ts`
- `src/targets/runtime/wasm_abi.ts`
- `tasks/status.md`

## Search Commands

```sh
rg -n "wasm-tools|wasmtime|ignore|ignored|Deno.Command|WebAssembly.instantiate|abi_version|reset|source_encoding|span_unit" tests .github README.md docs src tasks
```

## Work

1. Decide the release-engine matrix:
   - required: Deno/JS adapter;
   - required: `wasm-tools validate`;
   - required or optional: Wasmtime core ABI execution.
2. Install or provision `wasm-tools` and `wasmtime` in CI.
3. Change the tests or CI so release-gate jobs fail if required independent
   engine tools are missing.
4. Keep local developer behavior reasonable: either skip with a clear message
   outside CI or document the tool installation command.
5. Update docs and `tasks/status.md`.

## Acceptance

- CI runs `wasm-tools validate` for generated core Wasm bytes.
- CI runs the Wasmtime core ABI execution test, unless the docs explicitly
  downgrade host-neutral Wasm support.
- Local `deno task test` behavior is documented when tools are missing.
- Focused checks pass:

```sh
deno fmt --check
git diff --check
deno test -A tests/wasm_test.ts tests/ts_wasm_parity_test.ts
deno task bootstrap:check
```

## Do Not Touch

- Do not claim WASI/component-model support.
- Do not replace the JavaScript-hosted adapter API.
- Do not require Wasmtime for ordinary parser users.

## Completion Notes

Completed on 2026-06-22.

- `.github/workflows/ci.yml` installs `wasm-tools` and `wasmtime` through the
  Bytecode Alliance setup actions and checks both binaries before the test step.
- Local tests continue to skip independent-engine checks with install hints when
  the binaries are absent.
- `README.md`, `docs/runtime-language.md`, and `tasks/status.md` document the
  CI/local split.
