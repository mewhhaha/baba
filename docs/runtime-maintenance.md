# Runtime Maintenance

Keep runtime changes in the layer that owns the behavior:

- shared runtime algorithms: `src/runtime` and `src/targets/runtime`;
- parser-plan format and validation: `src/targets/runtime/portable_plan.ts` and
  runtime planning modules;
- generated TypeScript adapters: `src/targets/typescript`;
- generated Wasm adapters and core ABI: `src/targets/wasm` and
  `src/targets/runtime/wasm_core_runtime.ts`;
- parser-kit data: `src/targets/kit`;
- size and cold-start benchmarks: `scripts/runtime_bench.ts`;
- package and generated-output budgets: `size-budgets.json` and
  `scripts/size_report.ts`;
- performance fixtures: `fixtures/perf`.

Do not add parser-driver logic to generated files unless it is explicitly
legacy-gated and covered by generated-size budgets.
