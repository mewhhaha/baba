# T09: Release gates and docs

- **Priority:** P1
- **Size:** Medium
- **Depends on:** all slim-runtime implementation tasks
- **Suggested PR title:** `Document slim runtime architecture and enforce release gates`

[Back to index](./README.md)

## Objective

Make the slim runtime architecture understandable and enforce it with CI gates. Users and future agents should not accidentally reintroduce giant generated parsers or slow cold starts.

## Problem

Architecture changes rot unless documented and guarded. The repo needs clear docs that say:

- what is generated;
- what is shared runtime;
- what is data;
- when Wasm helps;
- when TypeScript is faster;
- what budgets must not be exceeded;
- how to inspect size and latency.

## Required work

### 1. Add a slim runtime architecture doc

Create:

```text
docs/slim-runtime.md
```

It should explain:

```text
grammar -> analyzed grammar -> compact parser plan -> shared runtime
```

Include diagrams for:

- Tree-sitter output;
- TypeScript shared runtime output;
- optional generic Wasm output;
- parser-kit output;
- validation-only parse;
- full CST parse.

### 2. Document the new output structure

Update README and docs to show normal output as small:

```text
generated/
  plan.bin or plan.ts
  types.ts
  mod.ts
```

Do not show heavy `lexer.ts`, `parser.ts`, or embedded `wasm.ts` as normal output if they are legacy.

### 3. Add a performance guide

Create:

```text
docs/performance.md
```

Explain:

- cold start vs hot parse;
- why Wasm can be slower for small files;
- when to use TypeScript runtime;
- when to use Wasm runtime;
- validation-only mode;
- lazy CST mode;
- how to run benchmarks;
- how to interpret runtime timing events;
- how to use budgets.

### 4. Add a migration guide

Create:

```text
docs/migration-slim-runtime.md
```

Include:

- old generated output shape;
- new generated output shape;
- import changes;
- type emission modes;
- legacy packaging option;
- how to vendor the shared runtime;
- how to keep using full CST;
- how to use validation mode;
- expected improvements.

### 5. Add release checklist

Create:

```text
docs/release-checklist.md
```

Include required commands:

```sh
deno task check
deno task test
deno task bench:runtime --json runtime-bench.json
deno task size:check
deno task publish:dry-run
```

Include manual review checks:

- no giant generated runtime in examples;
- no embedded Wasm byte arrays in default output;
- large-runtime fixture within budget;
- parser-plan debug data not emitted in runtime plan;
- Wasm cold start measured;
- TypeScript small-file parse measured;
- docs updated.

### 6. Enforce budgets in CI

Budgets should fail PRs for deterministic size regressions.

Suggested budgets:

```json
{
  "generated": {
    "tinyDefaultBytes": 15000,
    "largeRuntimeDefaultBytes": 100000,
    "defaultEmbeddedWasmBytes": 0
  },
  "plan": {
    "largeRuntimeBinaryBytes": 50000,
    "largeRuntimeJsonBytes": 150000
  },
  "package": {
    "publishPayloadBytes": 1600000,
    "largestPublishFileBytes": 260000
  }
}
```

Timing budgets should be recorded but not overly strict on PR CI unless stable in the environment.

### 7. Add no-regression generated-output tests

Tests should assert:

- default generated output has no embedded Wasm byte array;
- default generated output has no copied parser algorithm;
- default generated output stays under fixture budgets;
- legacy output requires explicit option;
- large-runtime benchmark is present.

### 8. Document task ownership for future work

Add a short note:

```text
docs/runtime-maintenance.md
```

Explain where future changes belong:

```text
shared runtime algorithm -> src/runtime
plan format -> src/targets/runtime or compiler plan module
generated adapters -> target emitters
benchmarks -> scripts/runtime_bench.ts
examples -> examples/*
```

### 9. Add release note template

Create a release-note checklist for this architecture change:

```text
Breaking changes
New defaults
Legacy flags
Migration examples
Performance numbers
Known limitations
```

## Example docs snippet

```md
For small CLIs and editor plugins, prefer the shared TypeScript runtime:

```ts
import { parse } from "./generated/mod.ts";
parse(source, { mode: "validate" });
```

Use Wasm only when you parse enough input to amortize startup:

```ts
const parser = await createWasmParser(plan);
parser.parse(largeSource, { mode: "cst-lazy" });
```
```

## Likely files

- `README.md`
- `docs/slim-runtime.md`
- `docs/performance.md`
- `docs/migration-slim-runtime.md`
- `docs/release-checklist.md`
- `docs/runtime-maintenance.md`
- `size-budgets.json`
- `.github/workflows/ci.yml`
- `scripts/runtime_bench.ts`
- `tests/*budget*`

## Tests/checks

1. docs links valid;
2. budget script fails on synthetic oversize output;
3. default generated output no-heavy-pattern test;
4. benchmark JSON schema test;
5. release checklist command names exist;
6. README output tree matches actual default output;
7. legacy docs marked clearly.

## Acceptance criteria

- Slim runtime architecture is documented.
- Performance guide and migration guide exist.
- CI enforces generated-size and package-size budgets.
- No-heavy-output tests exist.
- Release checklist includes benchmark and budget commands.
- README no longer implies heavy generated runtimes are normal.

## Out of scope

- implementing runtime changes;
- changing parser semantics;
- benchmark optimization;
- adding new output targets.

## Copy-ready agent prompt

> Implement T09 from `tasks/T09-release-gates-and-docs.md`. Add slim-runtime, performance, migration, release-checklist, and maintenance docs. Enforce generated-size and package-size budgets in CI, add no-heavy-output tests, and update README to show the new small default output. Do not change runtime behavior.
