# Island SIMD parser experiment

This experiment measures the parser shape used by the WebGPU frontend on a
single pretokenized island. It consumes the existing compiler-proven GPU plan;
it does not define a second grammar analysis path.

The accepted subset is intentionally narrow:

- the island must appear in `execution.longRegions`;
- it must contain at most seven states;
- every transition must consume a terminal, with no nested-island placeholder;
- the result is acceptance or rejection, not a CST or AST.

The Rust Wasm module contains three validators over the same terminal stream:

- the normal LR action/goto loop using the generated core parser plan;
- a scalar finite-transducer loop using the generated GPU island;
- a SIMD finite-transducer loop where each lane tracks one possible entry state
  and `i8x16.swizzle` composes the next terminal transition.

Run the experiment with:

```sh
deno task build:island-simd-experiment
deno task bench:island-simd-experiment
deno test --allow-read --allow-write --allow-run tests/island_simd_experiment_test.ts
```

The benchmark excludes lexing, region discovery, and tree construction so it
isolates parser-core cost. Its LR-to-transducer result therefore answers whether
the restricted shape is promising; it is not an end-to-end throughput claim.
