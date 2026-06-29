# Runtime Maintenance

Keep runtime changes in the layer that owns the behavior:

- shared runtime algorithms: `src/runtime` and `src/targets/runtime`;
- parser-plan format and validation: `src/targets/runtime/portable_plan.ts` and
  runtime planning modules;
- shared BNF/LR lowering helpers: `src/targets/typescript/bnf.ts` and
  `src/targets/typescript/lr1.ts`;
- generated Wasm adapters and core ABI: `src/targets/wasm` and
  `src/targets/runtime/wasm_core_runtime.ts`;
- shared runtime parser plan data: `src/runtime/parser_plan.ts`;
- size and cold-start benchmarks: `scripts/runtime_bench.ts`;
- package and generated-output budgets: `size-budgets.json` and
  `scripts/size_report.ts`;
- performance fixtures: `fixtures/perf`.

Do not add parser-driver logic to generated files.
