# Runtime Maintenance

Keep runtime changes in the layer that owns the behavior:

- shared runtime algorithms: `src/runtime` and `src/targets/runtime`;
- Wasm parser-plan format and validation: `src/runtime/wasm_plan.ts` and
  `src/targets/runtime/parser_plan_contract.ts`;
- reference grammar/parser lowering: `src/compiler/runtime_plan` and
  `src/targets/runtime/portable_plan.ts`;
- Rust grammar frontend work: `src/compiler/grammar_rs`;
- generated Wasm adapters, strict island execution, compact cursor tapes, and
  core ABI: `src/targets/wasm`, `src/targets/runtime/wasm_core_runtime.ts`, and
  the Rust engine under `src/targets/runtime/wasm_engine_rs`;
- isolated SIMD island-kernel benchmarks: `src/runtime/island_parser.ts` and
  `src/targets/runtime/island_parser_rs`;
- generated Wasm TypeScript loader API: `src/runtime/generated_wasm.ts`;
- compiler-stage benchmarks: `scripts/compiler_bench.ts`;
- size and cold-start benchmarks: `scripts/runtime_bench.ts`;
- package and generated-output budgets: `size-budgets.json` and
  `scripts/size_report.ts`;
- compiler performance fixtures: `fixtures/perf`;
- strict island runtime fixtures: `fixtures/perf/wasm`.

Do not add parser-driver logic to generated files.

After changing the Rust engine, run `deno task build:wasm-engine` to refresh the
embedded `parser.wasm` bytes. Run `deno task build:wasm-engine:check` in CI or
before publishing to verify the embedded bytes still match the Rust source.

After changing the island parser, run `deno task build:island-parser` and
`deno task build:island-parser:check` for the embedded SIMD module.

After changing the Rust grammar frontend, run `deno task check:grammar-rs` and
`deno task build:grammar-parser` to refresh the embedded parser bytes. Run
`deno task build:grammar-parser:check` before publishing.
