# Release Checklist

Run these checks before publishing:

```sh
deno task check
deno task test
deno task test:fuzz -- --seed 12345 --max-time-ms 30000 --artifacts tmp/fuzz-artifacts
deno task bench:runtime --json runtime-bench.json
deno run --allow-read --allow-write scripts/parser_pipeline_bench.ts --budget size-budgets.json --json tmp/parser-v2-cutover.json
deno task size:check
deno task inspect-plan generated/wasm/parser.plan
deno task publish:dry-run
```

Manual review:

- no giant generated runtime directories are checked into examples;
- default generated output has no embedded Wasm byte arrays once slim packaging
  is the default;
- `fixtures/perf/large-runtime` stays within current budgets and records target
  budget deltas;
- runtime parser plans do not include debug-only LR item metadata in production
  artifacts;
- Wasm cold start and small-file parse numbers are present in the benchmark
  report;
- README and target docs match the actual generated output shape;
- grammar v2 docs cover tokens, modes, contextual keywords, layout, expressions,
  AST constructors, recovery, CST, AST, modular grammars, and portable runtime
  target status;
- legacy EBNF docs and generated target docs are clearly marked as compatibility
  paths, not the current grammar-v2 path.
