# Wasm Frontend Research

Review date: 2026-06-29.

Target profile: `core-3-nonweb`. Baba's public target remains a generated core
Wasm parser/lexer plus a small TypeScript adapter. Frontend experiments must
produce the same raw core ABI described in [wasm-abi.md](./wasm-abi.md), not a
kit, component package, WASI app, or browser-only runtime.

The packaging constraint is explicit: the compiler path should run inside the
Baba package. We should not require users to install Rust, Zig, Grain, TinyGo,
or another native toolchain, and we should not add a large compiler dependency
unless it clearly pays for itself.

## Gate

Any replacement frontend must compile a minimal fixture and then a real Baba
parser core that satisfy these checks:

- `parser.wasm` passes `WebAssembly.validate()`.
- `wasm/abi.json` has `format: "baba-wasm-abi"` and ABI version `1`.
- The module exports `memory`, `lex_one`, `lex_all`, `parser_action`,
  `parser_goto`, `abi_version`, `plan_version`, `semantics_version`, `reset`,
  `input_base`, `max_pages`, `source_encoding`, `span_unit`,
  `lex_result_i32_count`, `token_record_i32_count`, `host_ownership_model`, and
  `result_lifetime_model`.
- All public core parameters and results remain `i32`.
- The core does not require WASI, browser APIs, component-model lowering, or
  hidden host-owned parser state by default.
- Cold compile, cold instantiate, warm parse, and `parser.wasm` byte size are
  measured against the current direct emitter.

The executable scaffold for this gate is `src/wasm_frontend/research.ts` plus
`tests/wasm_frontend_scaffold_test.ts`. Use `deno task wasm:frontend-probe` to
see which optional frontend compilers are installed locally.

## Recommendation

Keep the current direct binary emitter as the correctness oracle. The packaged
path should be a small Baba-owned TypeScript Wasm builder/compiler extracted
from the current emitter, not Rust, Zig, Grain, TinyGo, or AssemblyScript.

That builder should provide explicit module, section, type, function, local,
structured-control-flow, data-segment, and export APIs; validate builder
invariants before emission; and optionally emit WAT/debug dumps. This keeps the
compiler dependency-free and lets Baba's tests compare the new builder against
the existing `parser.wasm` and `abi.json`.

The most plausible optional package dependency is `@webassemblyjs/wasm-gen` plus
`@webassemblyjs/ast`: npm reports roughly 28 KB and 207 KB unpacked for those
two packages on 2026-06-29, with a few small helper packages. That is small
enough to spike, but it still leaves Baba responsible for ABI shaping and
validation. It should only become a dependency if it removes real encoder
complexity.

WABT's JavaScript package can compile WAT to Wasm inside JavaScript, which is
nice for bring-up and debugging. npm reports about 5.6 MB unpacked on
2026-06-29, so it should stay optional tooling unless WAT-first development
clearly wins.

Binaryen.js is powerful but too heavy for the default packaged path. npm reports
about 96 MB unpacked for `binaryen` on 2026-06-29. AssemblyScript is ergonomic,
but its npm package depends on Binaryen; npm reports about 7.9 MB unpacked for
`assemblyscript` itself, before the Binaryen dependency. Treat both as
comparison/optimizer experiments, not the thing Baba ships by default.

Rust and Zig remain useful control comparisons, not package candidates. Rust's
`wasm32-unknown-unknown` target is documented as making minimal host assumptions
and useful for bare-bones Wasm binaries, but using it would require an external
Rust toolchain. Zig documents `wasm32-freestanding` with `-fno-entry` and
explicit exported functions, but it would require an external Zig toolchain.

Grain is worth watching, not promoting yet. The Grain CLI compiles to
WebAssembly and exposes relevant flags including release mode, WAT output,
memory page sizing, memory import, `--no-gc`, and Wasm feature toggles. Before
using it for Baba, we would need both a package-embedded compiler story and a
proof that it can export the exact raw `i32` functions and memory shape without
a Grain-specific host/runtime cost that overwhelms the parser core.

TinyGo is watch-only for this use case. TinyGo's browser Wasm flow uses
`GOOS=js GOARCH=wasm` and `wasm_exec.js`; that is not a natural fit for Baba's
minimal parser-core ABI. It should only advance if a spike finds a WASI-free,
raw-export path with competitive startup and size.

## Primary Sources

- Grain CLI docs: <https://grain-lang.org/docs/tooling/grain_cli>
- webassemblyjs repository: <https://github.com/xtuc/webassemblyjs>
- webassemblyjs wasm-gen package:
  <https://www.npmjs.com/package/@webassemblyjs/wasm-gen>
- WABT JavaScript package: <https://www.npmjs.com/package/wabt>
- WABT repository: <https://github.com/WebAssembly/wabt>
- Binaryen.js package: <https://www.npmjs.com/package/binaryen>
- Binaryen repository: <https://github.com/WebAssembly/binaryen>
- AssemblyScript compiler docs: <https://www.assemblyscript.org/compiler.html>
- AssemblyScript runtime docs: <https://www.assemblyscript.org/runtime.html>
- AssemblyScript package: <https://www.npmjs.com/package/assemblyscript>
- Rust `wasm32-unknown-unknown`:
  <https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html>
- Rust `wasm32v1-none`:
  <https://doc.rust-lang.org/rustc/platform-support/wasm32v1-none.html>
- Zig WebAssembly docs: <https://ziglang.org/documentation/master/#WebAssembly>
- TinyGo WebAssembly docs: <https://tinygo.org/docs/guides/webassembly/>
- TinyGo browser Wasm docs: <https://tinygo.org/docs/guides/webassembly/wasm/>
