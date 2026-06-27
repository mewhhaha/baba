# T08: Delete heavy generated artifacts and legacy paths

- **Priority:** P1
- **Size:** Medium
- **Depends on:** [T01](./T01-data-first-runtime-architecture.md), [T03](./T03-wasm-cold-start-and-packaging.md), [T04](./T04-typescript-output-slimming.md)
- **Suggested PR title:** `Remove heavy generated runtime artifacts and legacy packaging`

[Back to index](./README.md)

## Objective

After the shared-runtime architecture lands, delete the old heavy generated outputs and legacy code paths rather than leaving them as permanent maintenance burden.

## Problem

Performance work often fails because the old slow path remains as a compatibility option forever. Every retained path adds:

- more tests;
- more generated examples;
- more docs;
- more codegen branches;
- more accidental default regressions;
- more confusion for users.

The goal is not to support every historical packaging mode. The goal is to make the fast, small architecture the normal and obvious architecture.

## Required work

### 1. Inventory all heavy generated outputs

Measure and list all generated files that should disappear from normal output:

```text
typescript/lexer.ts
typescript/parser.ts
wasm/lexer.ts
wasm/parser.ts
wasm/wasm.ts with embedded runtime bytes
grammar-specialized parser.wasm
large generated syntax.ts when minimal types are enough
checked-in examples/*/generated/**
```

Use the T00 size report as the source of truth.

### 2. Delete or gate legacy packaging

Remove default generation of:

- inline TypeScript parser implementation;
- inline Wasm runtime implementation;
- grammar-specialized Wasm binary;
- embedded Wasm byte arrays;
- eager full-type output where not requested.

If a legacy path must remain temporarily, require an explicit flag:

```sh
--runtime-packaging legacy-generated
```

and emit:

```text
LEGACY_GENERATED_RUNTIME_DEPRECATED
```

The deprecation diagnostic should mention size and cold-start costs.

### 3. Update CLI defaults

Recommended defaults:

```text
--target tree-sitter       unchanged
--target typescript        shared runtime + compact plan + minimal types
--target wasm              shared generic runtime + compact plan adapter, no specialized binary
--target all               tree-sitter + shared TypeScript + optional Wasm adapter, no heavy generated runtime
```

Consider making `--target all` exclude Wasm unless explicitly requested. If `all` keeps Wasm, it must use the light path.

### 4. Remove generated examples from Git or snapshots

Generated example directories should not contain huge runtime copies.

Preferred:

```text
examples/*/generated/ removed from Git
examples use deno task generate into temp/build directories
```

If snapshots are needed:

```text
examples/*/snapshots/minimal/**
```

with strict size budgets.

### 5. Update documentation

Docs should stop showing large output trees as the normal path.

Replace:

```text
generated/typescript/lexer.ts
generated/typescript/parser.ts
generated/wasm/wasm.ts
```

with:

```text
generated/plan.bin
generated/types.ts
generated/mod.ts
```

or the actual new structure.

### 6. Add migration guide

Add a guide:

```text
docs/migration-runtime-packaging.md
```

Include:

- old output shape;
- new output shape;
- how to update imports;
- how to request full types;
- how to vendor the shared runtime;
- how to use legacy mode temporarily;
- when legacy mode will be removed;
- expected size/startup improvements.

### 7. Remove dead implementation code

After defaults are changed, delete unused modules. Do not leave dead emitters hidden behind no tests.

Search for and remove:

- old TypeScript lexer emitter;
- old TypeScript parser emitter;
- old Wasm module emitter for grammar-specific binaries;
- old adapter helpers that only support embedded bytes;
- old example generated files;
- obsolete tests that assert generated source contains implementation functions.

Replace substring tests with behavior tests.

### 8. Add a no-heavy-output test

Add a test that generates representative grammars and asserts normal output does **not** contain forbidden patterns:

```text
function parseTokenList(
function reduceProduction(
new Uint8Array([
wasmBytes =
grammar-specialized parser.wasm
```

The exact forbidden patterns should match current code.

### 9. Enforce output budgets

Use T00/T09 budgets to fail if the normal generated payload exceeds limits.

Example:

```text
tiny TypeScript output > 15 KB -> fail
large-runtime generated payload > target budget -> fail
embedded Wasm bytes in default output -> fail
```

## Likely files

- `src/targets/typescript/*`
- `src/targets/wasm/*`
- `src/cli.ts`
- `README.md`
- `docs/*`
- `examples/**/*`
- `tests/*`
- `size-budgets.json`
- `.gitignore`

## Tests

1. default TypeScript output has no generated parser implementation;
2. default Wasm output has no embedded byte array;
3. default `--target all` stays under budget;
4. legacy mode still works if retained;
5. legacy mode emits deprecation warning;
6. docs examples generate successfully;
7. package publish payload remains small;
8. no checked-in generated example output unless intentionally snapshotted;
9. old substring tests replaced with behavior tests;
10. migration guide examples compile.

## Acceptance criteria

- Normal generated output no longer contains heavy runtime implementations.
- Old heavy paths are deleted or explicitly deprecated.
- Examples no longer check in large generated parser runtimes.
- Documentation reflects the slim architecture.
- Output budgets prevent accidental regression.

## Out of scope

- implementing the shared runtime; see T01;
- compact plan format; see T02;
- Wasm cold-start design; see T03;
- adding new parser features.

## Copy-ready agent prompt

> Implement T08 from `tasks/T08-delete-heavy-generated-artifacts.md`. After the slim shared-runtime path exists, remove heavy generated runtime outputs from defaults, gate or delete legacy packaging, update examples/docs, add migration notes, and enforce tests proving normal output no longer contains embedded Wasm bytes or generated parser implementation code.
