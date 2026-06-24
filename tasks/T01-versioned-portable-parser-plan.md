# T01: Versioned portable parser plan

- **Priority:** P0
- **Estimated size:** Extra large
- **Merge wave:** 1
- **Depends on:** [T00](./T00-correctness-and-planning-cleanup.md)
- **Suggested PR title:** `Introduce PortableParserPlanV1`

[Back to task index](./README.md)

## Objective

Create one immutable, target-neutral, versioned parser-plan contract that contains every piece of deterministic data required by the standalone lexer/parser runtimes.

TypeScript and Wasm must consume the same plan. Runtime algorithms must not need `AnalyzedGrammar`, BNF builder objects, LR Maps, source-expression objects, or target-specific strings after the plan is built.

## Problem

Baba currently shares analysis but not a formal execution contract. BNF productions, LR tables, lexer DFA, reducers, symbol lookup, field schemas, and diagnostics are passed around through implementation-specific objects.

Consequences:

- TypeScript and Wasm can reinterpret the same data differently;
- stable compatibility cannot be described independently of the package version;
- plans cannot be serialized, inspected, fuzzed, validated, cached, or executed by another host;
- target emitters retain knowledge that belongs in generic planning;
- corruption or incompatible indexes are found late as runtime failures.

## Required work

### 1. Add a dedicated module

Suggested layout:

```text
src/compiler/portable_plan/
  plan.ts
  build.ts
  validate.ts
  serialize_json.ts
  statistics.ts
```

T02 may add `serialize_binary.ts`.

### 2. Define `PortableParserPlanV1`

The exact names may change, but the plan must cover these concepts:

```ts
export interface PortableParserPlanV1 {
  readonly format: "baba-parser-plan";
  readonly version: 1;
  readonly semantics: "baba-portable-v1";

  readonly rootRule: number;
  readonly symbols: PortableSymbolPlan;
  readonly lexer: PortableLexerPlan;
  readonly parser: PortableLrPlan;
  readonly reducers: readonly PortableReducerPlan[];
  readonly cst: PortableCstPlan;
  readonly diagnostics: PortableDiagnosticPlan;
}
```

#### Symbol plan

Include deterministic IDs and display names for:

- main named tokens;
- trivia tokens;
- literals;
- EOF;
- nonterminals;
- user rules;
- generated helper nonterminals;
- fields.

IDs must be stable for the same grammar and options.

#### Lexer plan

Include:

- start state;
- states;
- sorted, nonoverlapping transition ranges;
- all accepting candidates in deterministic order;
- token channel;
- priority;
- source order;
- literal-versus-regex distinction;
- terminal ID or trivia marker;
- Unicode/code-point semantics version.

Do not store only `selectedAccept`; T06 needs all candidates.

#### LR plan

Include:

- start state;
- EOF terminal;
- terminals and nonterminals;
- ACTION rows with action sets;
- GOTO rows;
- productions;
- start production;
- expected-terminal sets;
- conflict identity references;
- planning statistics useful to runtime limits.

#### Reducer plan

Replace target-language reducer objects with a closed target-neutral instruction set, for example:

```ts
export type PortableReducerPlan =
  | { readonly op: "start" }
  | { readonly op: "rule"; readonly ruleId: number }
  | { readonly op: "terminal" }
  | { readonly op: "rule-ref" }
  | { readonly op: "identity" }
  | { readonly op: "sequence" }
  | { readonly op: "optional-empty" }
  | { readonly op: "optional-some" }
  | { readonly op: "repeat-empty" }
  | { readonly op: "repeat-append" }
  | { readonly op: "repeat1-first" }
  | { readonly op: "repeat1-append" }
  | { readonly op: "separated-first" }
  | { readonly op: "separated-append" }
  | { readonly op: "field"; readonly fieldId: number };
```

Document the reducer-opcode compatibility policy.

#### CST plan

Include:

- rule names;
- root rule;
- field names;
- field cardinality (`required`, `nullable`, `array`);
- permitted value kinds where statically known;
- public node ordering;
- helper-node hiding/flattening rules.

#### Diagnostic plan

Include data needed by runtimes without retaining compiler objects:

- expected terminal displays by state;
- token and rule displays;
- stable diagnostic semantics version;
- source-span unit contract.

### 3. Add one plan builder

Implement:

```ts
buildPortableParserPlan(
  analyzed: AnalyzedGrammar,
  metadata: BabaMetadata,
  options: PortableRuntimePlanningOptions,
): PortablePlanResult
```

It should own:

- canonical regex/DFA planning input;
- BNF lowering;
- LR construction;
- conflict-policy application;
- reducer lowering;
- symbol allocation;
- CST schema construction;
- plan statistics;
- generic planning diagnostics.

No target planner may independently call `lowerToBnf()` or `buildCanonicalLr1Table()` after this task.

### 4. Validate the plan as untrusted data

Implement:

```ts
validatePortableParserPlan(plan: unknown): Diagnostic[]
```

It must reject at least:

- wrong format or version;
- duplicate or missing IDs;
- invalid root/start/EOF indexes;
- unsorted or overlapping DFA transitions;
- transitions outside Unicode scalar range;
- target states outside the DFA;
- accepting candidates referring to missing tokens;
- malformed LR action kinds;
- action/goto indexes outside table bounds;
- production LHS/RHS IDs outside symbol tables;
- unknown reducer opcodes;
- reducers referring to missing rules or fields;
- impossible field cardinalities;
- malformed expected-terminal rows;
- action sets that violate declared deterministic/conflict policy;
- integer values outside the supported serialization range.

Validation must not throw for ordinary malformed input.

### 5. Canonical deterministic serialization

Add a debug JSON serializer with canonical ordering:

```ts
serializePortableParserPlanJson(plan): string
```

Requirements:

- no Maps or Sets;
- no dependence on object insertion order from unrelated phases;
- stable arrays sorted by numeric ID;
- stable formatting;
- explicit version fields;
- repeat compilation produces byte-identical output.

Add a deserializer that validates before returning a plan.

### 6. Add statistics

Expose internal statistics:

```ts
interface PortablePlanStatistics {
  lexerStates: number;
  lexerTransitions: number;
  lexerAcceptCandidates: number;
  bnfProductions: number;
  lrStates: number;
  lrItems: number;
  actionEntries: number;
  gotoEntries: number;
  reducerCount: number;
  fieldCount: number;
  serializedJsonBytes: number;
}
```

### 7. Adapt current emitters without changing runtime behavior

TypeScript and Wasm planners should receive the new plan. Temporary adapter functions may convert plan arrays into the shape old emitters expect, but those adapters must be clearly marked for deletion by T04/T05.

## Design constraints

- The plan contains data only—no JavaScript functions, Maps, Sets, classes, closures, source-code fragments, or target imports.
- Target emitters do not need `AnalyzedGrammar` for runtime execution data.
- Source spans may remain in optional compiler-side debug metadata, but the portable execution plan should not carry arbitrary source AST objects.
- IDs must be deterministic.
- The format-evolution policy must be documented in `plan.ts`.
- The plan version must be separate from Baba's package version and metadata version.

## Likely files

- `src/compiler/portable_plan/*`
- `src/compiler/ir.ts`
- `src/targets/typescript/bnf.ts`
- `src/targets/typescript/lr1.ts`
- `src/targets/typescript/plan.ts`
- `src/targets/wasm/plan.ts`
- `src/api.ts`
- new `tests/portable_plan_test.ts`
- `tests/api_test.ts`

## Tests

1. stable plan IDs across repeated compilation;
2. stable JSON serialization;
3. same plan object reused by TypeScript and Wasm packaging;
4. negative validation test for every index-bearing section;
5. malformed reducer and field schemas;
6. corrupted action/goto tables;
7. transition overlap and order errors;
8. version mismatch;
9. large but valid plan;
10. round-trip JSON serialization;
11. existing generated runtime behavior unchanged.

Prefer table-driven corruption tests that mutate one invariant at a time.

## Acceptance criteria

- `PortableParserPlanV1` is the sole runtime planning input to TypeScript and Wasm packaging.
- BNF and LR planning execute once per compile.
- Runtime emitters can operate without `AnalyzedGrammar` after plan construction.
- Serializing the same grammar twice is byte-for-byte deterministic.
- Invalid plans produce structured diagnostics, not generic exceptions.
- Reducer and CST semantics are explicitly versioned.
- Existing lexer/parser behavior and public generated APIs remain unchanged.

## Out of scope

- final compact binary artifact format;
- BRL/runtime-language implementation;
- contextual lexing algorithm changes;
- conflict metadata redesign;
- Wasm memory ABI changes;
- deleting old target runtime templates.

## Copy-ready agent prompt

> Implement T01 from `tasks/T01-versioned-portable-parser-plan.md`. Create a target-neutral, immutable, versioned `PortableParserPlanV1`, one shared builder, strong invariant validation, deterministic JSON serialization, and statistics. Adapt existing TypeScript and Wasm emitters without changing runtime behavior. Keep the plan completely free of target-specific objects and source strings.

## PR checklist

- [ ] Plan format and semantics versions defined.
- [ ] One shared plan builder added.
- [ ] Plan contains lexer, LR, reducers, CST, symbols, and diagnostics.
- [ ] Strong untrusted-plan validator added.
- [ ] Deterministic serialization tested.
- [ ] Both runtime targets consume the same plan.
- [ ] Existing behavior preserved.
- [ ] Full repository checks pass.
