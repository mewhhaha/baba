# large-runtime performance fixture

This fixture exists because a real grammar generated about 500 KB of Wasm and
took about 6s to instantiate before still spending tens of milliseconds on a
small parse. The original grammar is not committed here, so this synthetic
fixture stresses the same dimensions:

- many named token regexes and literal terminals;
- optional, repeated, and separated-list constructs;
- field-heavy rules that produce generated CST metadata;
- enough expression and block shapes to grow DFA and LR tables;
- small, medium, and large source files for cold-start and parse timing.

Use it with:

```sh
deno task bench:runtime
deno task bench:runtime --json runtime-bench.json
```
