# Runtime Maintenance

Keep runtime changes in the layer that owns the behavior:

- shared runtime algorithms: `src/runtime` and `src/targets/runtime`;
- parser-plan format and validation: `src/targets/runtime/portable_plan.ts` and
  runtime planning modules;
- shared BNF/LR lowering helpers: `src/compiler/runtime_plan/bnf.ts` and
  `src/compiler/runtime_plan/lr1.ts`;
- Rust grammar frontend work: `src/compiler/grammar_rs`;
- generated Wasm adapters and core ABI: `src/targets/wasm`,
  `src/targets/runtime/wasm_core_runtime.ts`, and the Rust engine under
  `src/targets/runtime/wasm_engine_rs`;
- generated Wasm TypeScript loader API: `src/runtime/generated_wasm.ts`;
- internal TypeScript reference runtime and parity behavior:
  `src/runtime/parser_plan.ts` and `src/runtime/mod.ts`;
- size and cold-start benchmarks: `scripts/runtime_bench.ts`;
- package and generated-output budgets: `size-budgets.json` and
  `scripts/size_report.ts`;
- performance fixtures: `fixtures/perf`.

Do not add parser-driver logic to generated files.

After changing the Rust engine, run `deno task build:wasm-engine` to refresh the
embedded `parser.wasm` bytes. Run `deno task build:wasm-engine:check` in CI or
before publishing to verify the embedded bytes still match the Rust source.

After changing the Rust grammar frontend, run `deno task check:grammar-rs` and
`deno task build:grammar-parser` to refresh the embedded parser bytes. Run
`deno task build:grammar-parser:check` before publishing.
