# Release Checklist

Run these checks before publishing:

```sh
deno task build:wasm-engine:check
deno task build:grammar-parser:check
deno task check
deno task test
deno task test:fuzz -- --seed 12345 --max-time-ms 30000 --artifacts tmp/fuzz-artifacts
for d in examples/brainfuck examples/feature-tour examples/funcfuck examples/thunkwasm; do (cd "$d" && deno task test); done
deno task bench:compiler --json compiler-bench.json
deno task bench:runtime --json runtime-bench.json
deno task size:check
deno task inspect-plan generated/wasm/parser.plan
deno task publish:dry-run
```

Manual review:

- no giant generated runtime directories are checked into examples;
- default generated output writes external `parser.wasm` and `parser.plan` files
  instead of embedding Wasm byte arrays in TypeScript;
- `fixtures/perf/large-runtime` stays within current budgets and records target
  budget deltas;
- runtime parser plans do not include debug-only LR item metadata in production
  artifacts;
- Wasm cold start and small-file parse numbers are present in the benchmark
  report;
- embedded Rust `parser.wasm` bytes match `src/targets/runtime/wasm_engine_rs`;
- runtime implementation manifest rebuild sources remain intentionally private
  while their embedded Wasm artifacts are included in the publish payload;
- README and target docs match the actual generated output shape;
- generated parser APIs in README, docs, and examples mention only the current
  cursor parse, lazy lex tape, validation trace, reset, and dispose surface;
- docs describe current behavior only and do not include stale migration labels
  or historical design notes.
