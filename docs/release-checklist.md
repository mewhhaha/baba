# Release Checklist

Run these checks before publishing:

```sh
deno task check
deno task test
deno task bench:runtime --json runtime-bench.json
deno task size:check
deno task inspect-plan generated/kit/parser-plan.bin
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
- Wasm cold start and TypeScript small-file parse numbers are present in the
  benchmark report;
- README and target docs match the actual generated output shape.
