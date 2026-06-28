# T05: Lazy CST and parse modes

- **Priority:** P0
- **Size:** Large
- **Depends on:** [T01](./T01-data-first-runtime-architecture.md)
- **Suggested PR title:** `Add validation-only and lazy-CST parse modes`

[Back to index](./README.md)

## Objective

Stop building a complete JavaScript CST for every parse. A small-file parse should not spend most of its time materializing objects the caller may never inspect.

## Problem

A reported small-file parse took about 30 ms after Wasm startup. For small inputs, the expensive part is often not table execution. It is:

- token object allocation;
- child array allocation;
- field map allocation;
- wrapping trace actions;
- replaying reductions into full JavaScript objects;
- copying strings for token text;
- preserving trivia;
- building line/column utilities eagerly.

Many users only need to know whether the input is valid, or only need diagnostics.

## Required work

### 1. Add parse modes

Expose modes such as:

```ts
type ParseMode =
  | "validate"      // success/failure and diagnostics only
  | "events"        // compact event stream
  | "tokens"        // tokenization plus diagnostics
  | "cst-lazy"      // default full API, but lazily materialized
  | "cst-full";     // eagerly materialized compatibility mode
```

API example:

```ts
parser.parse(source, { mode: "validate" });
parser.parse(source, { mode: "cst-lazy" });
parser.parse(source, { mode: "cst-full" });
```

Keep existing `parse(source)` behavior compatible, but consider making it lazy internally.

### 2. Add validation-only fast path

Validation mode should:

- run lexer/parser;
- stop after success or first/selected failure;
- avoid CST nodes;
- avoid field maps;
- avoid child arrays;
- avoid token text slices unless needed for diagnostics;
- return a small result.

Example:

```ts
const result = parser.parse(source, { mode: "validate" });
if (result.ok) { /* no root allocated */ }
```

Potential result shape:

```ts
type ValidateResult =
  | { ok: true; diagnostics: readonly [] }
  | { ok: false; diagnostics: readonly ParseDiagnostic[] };
```

### 3. Add compact event mode

Event mode should return or iterate parse events:

```ts
type ParseEvent =
  | { kind: "token"; tokenId: number; start: number; end: number }
  | { kind: "enter"; ruleId: number; start: number }
  | { kind: "exit"; ruleId: number; end: number }
  | { kind: "field"; fieldId: number };
```

This is useful for tooling that wants to build its own data structure.

For Wasm, this avoids building JavaScript object graphs inside the adapter.

### 4. Add lazy CST nodes

Lazy CST should store compact arrays internally:

```text
nodeRuleIds: Uint32Array
nodeStart: Uint32Array
nodeEnd: Uint32Array
childStart: Uint32Array
childCount: Uint32Array
children: Uint32Array
fieldStart: Uint32Array
fieldCount: Uint32Array
```

Then expose node objects lazily:

```ts
const root = result.root;
root.children; // materialized only here
root.fields;   // materialized only here
```

Cache materialized objects after first access.

### 5. Avoid token text slicing by default

Tokens should store spans and IDs. Text can be lazily sliced:

```ts
interface TokenView {
  readonly kind: string;
  readonly span: Span;
  get text(): string;
}
```

Full compatibility tokens may still expose `.text`, but internally do not create substrings until accessed.

### 6. Separate trivia retention from parser execution

For parse modes that do not need trivia:

```ts
parser.parse(source, {
  preserveTrivia: false,
  mode: "validate",
});
```

should not allocate trivia tokens at all.

### 7. Make source maps lazy

Do not compute line starts unless:

- a diagnostic needs line/column;
- user calls `positionAt` or `createSourceMap`;
- a parse option requests formatted diagnostics.

### 8. Support cheap diagnostics

Unexpected-token diagnostics need:

- offset;
- found display;
- expected displays.

They do not need a complete token object or CST.

### 9. Keep compatibility mode

`cst-full` should reproduce existing object shape so current consumers do not break. It can be implemented by forcing lazy materialization.

### 10. Wire parse modes into benchmarks

T00 benchmarks should report:

```text
validate small
cst-lazy small without accessing root
cst-lazy small accessing root.children
cst-full small
validate medium
cst-full medium
```

## Example

### Current-style eager usage

```ts
const result = parse(source);
if (result.ok) {
  console.log(result.root.children[0].fields.name.text);
}
```

### New validation-only usage

```ts
const result = parse(source, { mode: "validate" });
if (!result.ok) console.error(result.diagnostics);
```

### New lazy usage

```ts
const result = parse(source, { mode: "cst-lazy" });
if (result.ok) {
  // No child arrays built until this line.
  const first = result.root.children[0];
}
```

## Likely files

- shared runtime package
- `src/targets/runtime/portable_plan.ts`
- TypeScript adapter/runtime files
- Wasm adapter files
- generated type emitters
- `tests/parser_test.ts`
- `tests/ts_wasm_parity_test.ts`
- `tests/wasm_test.ts`
- `bench/ts_vs_wasm.ts`

## Tests

1. validate mode returns no root;
2. validate mode avoids CST allocation counters;
3. lazy mode returns compatible root object;
4. accessing `children` materializes once;
5. accessing `fields` materializes once;
6. token text is sliced lazily;
7. diagnostics work without CST;
8. `preserveTrivia: false` avoids trivia allocation;
9. Wasm and TypeScript results match by mode;
10. cst-full matches old eager object shape;
11. small-file parse latency improves;
12. medium/large parse still correct.

## Acceptance criteria

- Users can validate syntax without building a CST.
- Default parse no longer eagerly allocates every object if compatibility permits.
- Full CST remains available.
- Small-file parse time drops materially from T00 baseline.
- Wasm path can avoid JS object graph construction for validation-only parse.

## Out of scope

- incremental parsing;
- semantic AST construction;
- tree editing APIs;
- full Tree-sitter-style node navigation;
- changing grammar semantics.

## Copy-ready agent prompt

> Implement T05 from `tasks/T05-lazy-cst-and-parse-modes.md`. Add parse modes for validation, events, lazy CST, and full CST. Avoid token text slicing, trivia allocation, source-map computation, and CST object construction unless requested. Preserve compatibility through full materialization and prove small-file latency improves against the T00 benchmark.
