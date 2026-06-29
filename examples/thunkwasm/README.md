# ThunkWasm Example

ThunkWasm is a small functional language that compiles ahead-of-time to a Wasm
binary. It demonstrates explicit lazy thunks stored in linear memory, cached
`force`, closure allocation, branch-hint syntax, tagged one-word values, and
simple reference-counted heap objects without a tracing GC.

This example is intentionally a runnable v0.1 slice of the larger design:

- Small integers are represented as tagged `i32` values.
- Heap closures and thunks are pointers into Wasm linear memory.
- `lazy expr` allocates a heap thunk with captured environment values.
- `force expr` evaluates the thunk once, stores the result, releases the
  captured environment, and returns cached results after that.
- `fun x -> expr` allocates a unary heap closure.
- `if likely ... then ... else ...` and `if unlikely ...` parse and lower to
  normal Wasm branches.
- The thunk `force` helper can emit the `metadata.code.branch_hint` custom
  section for Deno/V8.
- `tick(expr)` is a tiny builtin used by the examples to prove a thunk body ran
  exactly once.

The compiler does not implement records, pattern matching, arenas, or free-list
reuse yet. The memory model is still explicit: heap objects carry tags, sizes,
refcounts, function table ids, environments, and cached thunk results.

## Run It

All commands assume your current directory is `examples/thunkwasm`.

Generate the Wasm parser artifacts used by the AOT compiler:

```sh
deno task generate
```

Run the AOT compiler and execute the generated Wasm in memory:

```sh
deno task cached
deno task closure
deno task branch
```

Expected output:

```text
result: 140
ticks: 1
allocations: 1
releases: 1

result: 17
ticks: 0
allocations: 1
releases: 1

result: 5
ticks: 0
allocations: 0
releases: 0
```

Write a `.wasm` file and run the same compiled module:

```sh
deno task emit:cached
```

Validate the generated runtime and compiler:

```sh
deno task check
```

## Lazy Benchmark

The compiler has a `forceBranchHint` option for cached thunks:

- `none`: omit branch-hint metadata.
- `metadata`: emit `metadata.code.branch_hint` for the cached/evaluated path.

This example targets Deno/V8, where branch-hint metadata is available. Other
runtimes may ignore the custom section.

Run:

```sh
deno task bench:lazy
```

The benchmark compiles `programs/lazy_bench.tw` twice with identical executable
code, once without metadata and once with branch-hint metadata. It instantiates
both modules, resets their linear memory before each sample, and performs
repeated calls where each call forces the same thunk 500 times. The counters
verify that the thunk body runs once per call.
