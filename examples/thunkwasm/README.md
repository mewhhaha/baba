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
  normal Wasm branches; the hint is preserved in the source language, but MVP
  Wasm has no stable branch-hint opcode.
- `tick(expr)` is a tiny builtin used by the examples to prove a thunk body ran
  exactly once.

The compiler does not implement records, pattern matching, arenas, or free-list
reuse yet. The memory model is still explicit: heap objects carry tags, sizes,
refcounts, function table ids, environments, and cached thunk results.

## Run It

All commands assume your current directory is `examples/thunkwasm`.

Generate the parser artifacts:

```sh
deno task generate
deno task helix:sync
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

Validate the generated TypeScript:

```sh
deno task check
```

## Helix

Helix needs both query files and a compiled Tree-sitter parser before it can
highlight `.tw` files. To prepare the local runtime:

```sh
deno task helix:build
deno task helix:health
```

Plain `hx --health thunkwasm` can still show missing highlights from this
directory because Helix does not add project-local `.helix/runtime` to the
runtime search path automatically.

Open files with:

```sh
deno task helix:open
```

or:

```sh
HELIX_RUNTIME=$PWD/.helix/runtime hx programs/cached.tw
```
