# T01: Data-first runtime architecture

- **Priority:** P0
- **Size:** Extra large
- **Depends on:** [T00](./T00-measure-runtime-size-and-latency.md)
- **Suggested PR title:** `Make parser runtimes data-first instead of generated-code-first`

[Back to index](./README.md)

## Objective

Replace the default architecture of generating large per-grammar lexer/parser programs with a small shared runtime that consumes compact parser-plan data.

This is the core task. Everything else is a support task.

## Problem

The current output model still behaves as though each grammar needs its own runtime implementation. Even if some runtime code is generated from shared machinery, the generated files still include large lexer/parser source and Wasm artifacts.

That causes:

- large generated directories;
- slow TypeScript import/check time;
- slow Wasm compile/instantiate time;
- repeated parser code across every generated grammar;
- large examples;
- poor cold-start behavior for CLIs and editor plugins;
- unnecessary work for small files.

A parser for a grammar should mostly be **data**. The algorithms should live in one shared runtime.

## Required architecture

### Current shape to remove

```text
generated/typescript/lexer.ts     # generated runtime algorithm + tables
generated/typescript/parser.ts    # generated runtime algorithm + tables
generated/wasm/wasm.ts            # generated adapter + embedded or generated Wasm bytes
generated/wasm/lexer.ts           # generated runtime wrapper
generated/wasm/parser.ts          # generated runtime wrapper/replay logic
```

### Desired shape

```text
generated/
  parser-plan.json          # or parser-plan.bin after T02
  types.ts                  # optional generated CST/token types
  mod.ts                    # tiny adapter importing shared runtime
```

Optionally:

```text
generated/
  parser-plan.bin
  parser-plan.d.ts
```

The generated `mod.ts` should be conceptually tiny:

```ts
import { createParser } from "@mewhhaha/baba/runtime";
import plan from "./parser-plan.json" with { type: "json" };
export * from "./types.ts";

export const parser = createParser(plan);
export const lex = parser.lex;
export const parse = parser.parse;
export const parseTokens = parser.parseTokens;
export const parseTokensUnchecked = parser.parseTokensUnchecked;
```

If import assertions are inconvenient across runtimes, emit:

```ts
import { createParser } from "@mewhhaha/baba/runtime";
import { parserPlan } from "./parser-plan.ts";

const parser = createParser(parserPlan);
export const lex = parser.lex;
export const parse = parser.parse;
```

But `parser-plan.ts` should contain data only, not algorithms.

## Required work

### 1. Add a shared runtime package export

Add exports such as:

```json
{
  "exports": {
    "./runtime": "./src/runtime/mod.ts",
    "./runtime/wasm": "./src/runtime/wasm.ts"
  }
}
```

The shared TypeScript runtime should live in source once and be imported by generated adapters.

It should expose:

```ts
createParser(plan, options?)
createLexer(plan, options?)
validatePlan(plan)
```

The generated runtime must not copy the implementation into every output directory by default.

### 2. Keep generated types separate from runtime

Generated CST/token types may remain grammar-specific:

```text
generated/types.ts
```

But runtime code should not depend on huge generated interfaces at execution time.

The runtime can produce generic nodes:

```ts
interface GenericRuleNode {
  type: "rule";
  ruleId: number;
  name: string;
  span: Span;
  children: SyntaxElement[];
  fields: Record<string, unknown>;
}
```

The generated `types.ts` can provide type aliases or wrapper helpers:

```ts
export type ModuleNode = RuleNodeOf<typeof parserPlan, "module">;
```

If exact generated structural interfaces are kept, put them behind an option:

```sh
--emit-types full
--emit-types minimal
--emit-types none
```

Default should be minimal.

### 3. Make `--target typescript` produce adapter + plan

Change TypeScript target output from:

```text
syntax.ts
lexer.ts
parser.ts
mod.ts
```

To something like:

```text
plan.ts
mod.ts
types.ts
```

or:

```text
parser-plan.json
mod.ts
types.ts
```

Provide a compatibility target temporarily:

```sh
--target typescript-legacy-generated
```

or:

```sh
--runtime-packaging inline-generated
```

But the default should be shared-runtime packaging.

### 4. Make `--target wasm` use the same data-first boundary

Wasm should not generate a grammar-specialized module by default.

Preferred generated Wasm target:

```text
wasm/
  parser-plan.bin
  abi.json
  mod.ts
```

The adapter should import or receive one generic Wasm runtime:

```ts
import { createWasmParser } from "@mewhhaha/baba/runtime/wasm";
import { parserPlanBytes } from "./parser-plan.ts";

export const parser = await createWasmParser(parserPlanBytes);
```

If synchronous APIs are retained, make them TypeScript-runtime-backed by default or lazily instantiate Wasm only when explicitly requested.

### 5. Preserve current public API through adapters

Users should still be able to call:

```ts
import { parse, lex } from "./generated/mod.ts";
```

But those functions should forward to a shared parser instance.

Compatibility wrapper example:

```ts
import { createParser } from "@mewhhaha/baba/runtime";
import { parserPlan } from "./plan.ts";

const parser = createParser(parserPlan);

export function lex(source: string, options?: LexOptions) {
  return parser.lex(source, options);
}

export function parse(source: string, options?: ParseOptions) {
  return parser.parse(source, options);
}
```

### 6. Move heavy runtime code out of generated output

Delete generated copies of:

- DFA scanning loops;
- parser driver loops;
- branch search;
- reduction VM;
- CST builders;
- source map functions;
- token-stream validator;
- Wasm adapter internals.

These belong in the shared runtime package.

### 7. Keep debug data out of normal plans

The runtime plan should not include:

- LR item sets;
- source spans for every production;
- production origins;
- conflict explanation strings;
- grammar source text;
- README/debug labels;
- redundant deprecated fields.

Generate a debug plan separately:

```sh
--emit-debug-plan
```

or:

```text
parser-plan.debug.json
```

### 8. Add compatibility migration

For one release, support:

```sh
--runtime-packaging shared     # new default
--runtime-packaging generated  # old behavior, deprecated
```

Emit a warning when users request generated runtime code:

```text
GENERATED_RUNTIME_PACKAGING_DEPRECATED
Per-grammar generated runtimes are deprecated because they produce large artifacts and poor cold-start behavior. Use shared runtime packaging.
```

### 9. Update examples

Regenerate or update examples to use the new shared-runtime output. Do not check in enormous generated runtime copies.

If examples need to work offline, they can vendor one shared runtime artifact once, not one copy per grammar.

## Example before/after

### Before

```text
generated/typescript/syntax.ts    35 KB
generated/typescript/lexer.ts     120 KB
generated/typescript/parser.ts    300 KB
generated/wasm/wasm.ts            700 KB
generated/wasm/parser.ts          300 KB
```

### After

```text
generated/plan.ts                 25 KB
generated/types.ts                20 KB
generated/mod.ts                  1 KB
```

Shared package once:

```text
@babа/runtime                     40 KB
@baba/runtime/wasm                80 KB compressed or cached
```

The important improvement is that the shared runtime is paid once per application, not once per grammar.

## Likely files

- `deno.json`
- `src/runtime/mod.ts`
- `src/runtime/wasm.ts`
- `src/targets/typescript/plan.ts`
- `src/targets/typescript/*emit*.ts`
- `src/targets/wasm/*`
- `src/targets/kit/*`
- `src/cli.ts`
- `tests/runtime_smoke.ts`
- `tests/ts_wasm_parity_test.ts`
- `examples/**/*`

## Tests

1. generated TypeScript output no longer contains parser driver source;
2. generated Wasm output no longer embeds grammar-specialized Wasm by default;
3. generated `mod.ts` imports shared runtime;
4. public `lex`/`parse` APIs still work;
5. Deno/Node/Bun smoke;
6. two generated grammars in one app share the same runtime import;
7. shared runtime can load two different plans;
8. old generated packaging still works behind explicit legacy option;
9. generated byte count drops on representative fixtures;
10. runtime behavior matches legacy output for fixtures.

## Acceptance criteria

- Default TypeScript target output is plan data + tiny adapter + optional types.
- Default Wasm target does not emit grammar-specialized Wasm bytes.
- Shared runtime is exported from the package.
- Per-grammar generated runtime implementation is legacy-only or removed.
- Generated payload for the large-runtime fixture is reduced by at least 70% from the T00 baseline.
- Cold parser creation for small files is materially faster than the T00 baseline.

## Out of scope

- compact binary plan encoding details; see T02;
- lazy CST design; see T05;
- lexer micro-optimizations; see T06;
- changing the grammar language;
- changing Tree-sitter output.

## Copy-ready agent prompt

> Implement T01 from `tasks/T01-data-first-runtime-architecture.md`. Replace default per-grammar generated runtime code with shared runtime imports plus compact parser-plan data and tiny adapters. Preserve public `lex`/`parse` APIs, keep legacy generated packaging only behind an explicit option, and demonstrate a large generated-byte reduction using the T00 benchmark fixture.
