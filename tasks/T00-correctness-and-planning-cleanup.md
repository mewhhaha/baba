# T00: Correctness and planning cleanup

- **Priority:** P0
- **Estimated size:** Medium
- **Merge wave:** 0
- **Depends on:** None
- **Suggested PR title:** `Fix multi-target planning and portability semantics`

[Back to task index](./README.md)

## Objective

Make target selection, option handling, portability defaults, and runtime planning internally coherent before introducing a formal portable parser-plan IR.

This task is deliberately limited to orchestration. It must not redesign lexer, LR, CST, or Wasm execution semantics.

## Problem

The current orchestration has avoidable correctness and maintenance issues:

- portability is described as strict for multi-target generation, but normalization does not consistently apply that rule to every target combination;
- requesting TypeScript and Wasm can plan essentially the same BNF, DFA, and LR structures more than once;
- the Wasm planner delegates to the TypeScript planner and rewrites diagnostic codes and English messages;
- TypeScript and Wasm option types duplicate most planning fields and can drift;
- Wasm lacks equivalent generated-size and planning-stat controls;
- `validateGrammar()` and `compile()` can take subtly different routes through target planning.

## Required work

### 1. Introduce shared runtime planning options

Add a generic planning option type along these lines:

```ts
export interface PortableRuntimePlanningOptions {
  preserveTrivia?: boolean;
  lexerStateLimit?: number;
  parserStateLimit?: number;
  parserItemLimit?: number;
  parserTableEntryLimit?: number;
}
```

Target-specific options should extend it:

```ts
export interface TypeScriptTargetOptions
  extends PortableRuntimePlanningOptions {
  directory?: string;
  generatedByteLimit?: number;
  reportParserStats?: boolean;
}

export interface WasmTargetOptions
  extends PortableRuntimePlanningOptions {
  directory?: string;
  generatedByteLimit?: number;
  reportParserStats?: boolean;
  packaging?: "external-binary" | "embedded-typescript";
}
```

Do not preserve duplicated validators after introducing the shared type. Extract shared option validation into one function.

### 2. Correct portability defaults

The default rule must be explicit and tested:

```text
one semantic target selected   -> warn
more than one target selected  -> strict
explicit user setting          -> use it unchanged
```

At minimum test:

```text
tree-sitter only
typescript only
wasm only
tree-sitter + typescript
tree-sitter + wasm
typescript + wasm
all three targets
```

### 3. Split target-neutral planning from packaging

Create an interim architecture:

```text
planPortableRuntime(analyzed, options, metadata)
planTypeScriptPackaging(portablePlan, options)
planWasmPackaging(portablePlan, options)
```

`planPortableRuntime` may initially wrap the existing BNF, DFA, and LR planners. T01 will formalize its return type.

The packaging planners should own only:

- output directory validation;
- generated source/binary size checks;
- adapter/package-specific diagnostics;
- file emission configuration.

### 4. Plan once per compile

When TypeScript and Wasm are requested together, build the shared runtime plan exactly once and pass the same object to both packaging planners.

Add a test seam that proves this directly. Do not infer it from timing. Suitable options include:

- an injected planner callback in an internal compile function;
- an internal counter visible only to tests;
- a spy around a new exported-from-advanced planner function.

### 5. Remove diagnostic text rewriting

Delete message rewriting such as:

```ts
message.replaceAll("TypeScript target", "Wasm target")
```

Target-neutral planning failures should use target-neutral codes and wording:

```text
PORTABLE_EXTERNAL_TOKENS_UNSUPPORTED
PORTABLE_LEXER_STATE_LIMIT
PORTABLE_PARSER_STATE_LIMIT
PORTABLE_PARSER_ITEM_LIMIT
PORTABLE_PARSER_TABLE_ENTRY_LIMIT
```

Packaging failures may remain target-specific:

```text
TS_INVALID_OUTPUT_DIRECTORY
TS_GENERATED_BYTE_LIMIT
WASM_INVALID_OUTPUT_DIRECTORY
WASM_GENERATED_BYTE_LIMIT
```

If public consumers may rely on old codes, add a documented compatibility mapping rather than silently changing behavior.

### 6. Align validation and compilation

For identical grammar and options:

```ts
validateGrammar(grammar, options)
compile(grammar, options).diagnostics
```

must contain the same planning errors and warnings, modulo diagnostics that require actual emission.

Centralize planning so the APIs cannot drift.

### 7. Improve CLI wording

Update help text that refers to limits as TypeScript-only when they apply to the shared runtime or Wasm as well.

Keep target-specific size/stat flags clear.

## Likely files

- `src/api.ts`
- `src/ast.ts`
- `src/cli.ts`
- `src/targets/typescript/plan.ts`
- `src/targets/wasm/plan.ts`
- `tests/api_test.ts`
- `tests/wasm_test.ts`
- potentially a new `src/compiler/portable_runtime_plan.ts`

## Tests

Add focused tests for:

1. every target combination and its default portability mode;
2. explicit `strict`, `warn`, and `off` overriding defaults;
3. shared planner invocation count when TypeScript and Wasm are selected;
4. identical planner diagnostics from `validateGrammar()` and `compile()`;
5. Wasm diagnostic wording that never mentions TypeScript;
6. shared limit validation;
7. output-directory errors remaining target-specific.

## Acceptance criteria

- `targets: ["tree-sitter", "wasm"]` defaults to strict portability.
- `targets: ["typescript", "wasm"]` builds BNF/DFA/LR exactly once.
- No diagnostic implementation rewrites backend names in English strings.
- Shared planning diagnostics are backend-neutral.
- Target packaging diagnostics remain target-owned.
- `validateGrammar()` and `compile()` agree.
- Existing TypeScript-only and Wasm-only generation continues to work.

## Out of scope

- final `PortableParserPlanV1` design;
- lexer or parser algorithm changes;
- conflict-policy redesign;
- Wasm ABI redesign;
- generated runtime language work;
- example regeneration beyond the minimum fixture needed for tests.

## Copy-ready agent prompt

> Implement T00 from `tasks/T00-correctness-and-planning-cleanup.md`. Focus only on orchestration, shared option semantics, planner reuse, and diagnostic ownership. Do not design the final parser-plan IR and do not change lexer, parser, CST, or Wasm execution algorithms. Add executable tests for every target combination and prove that TypeScript plus Wasm invokes shared planning once.

## PR checklist

- [ ] Task ID included in PR description.
- [ ] Shared option type introduced.
- [ ] Multi-target portability default fixed.
- [ ] Portable runtime planned once.
- [ ] Diagnostic string replacement removed.
- [ ] Validation/compile diagnostic parity tested.
- [ ] Full repository checks pass.
