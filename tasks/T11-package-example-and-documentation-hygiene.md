# T11: Package, example, and documentation hygiene

- **Priority:** P1
- **Estimated size:** Medium
- **Merge wave:** 0
- **Depends on:** None
- **Suggested PR title:** `Reduce published artifact weight and document architecture`

[Back to task index](./README.md)

## Objective

Reduce repository and published-package weight, make examples reproducible without dominating diffs, and document the architecture and compatibility contracts that now govern Baba.

This task must not change parser behavior.

## Problem

The repository and publish payload include complete generated outputs for several examples, including large TypeScript files and embedded Wasm byte arrays. This creates several costs:

- package downloads contain artifacts most consumers do not need;
- generated snapshots dominate code review;
- runtime changes cause large unrelated diffs;
- examples are difficult to distinguish from product source;
- generated output can drift unless explicitly checked;
- architecture decisions exist mainly in implementation and conversation history;
- the root README is becoming responsible for every detail.

## Required work

### 1. Measure current size

Add a repeatable report that measures:

- repository bytes by top-level directory;
- publish dry-run payload bytes;
- generated output bytes by example and target;
- duplicate bytes between TypeScript and Wasm adapters;
- largest files;
- `.wasm` bytes versus embedded TypeScript representation;
- source code versus generated snapshots.

Output human-readable and JSON formats.

### 2. Reduce published package contents

Review `deno.json` publish includes.

Recommended publish contents:

```text
README.md
CHANGELOG.md
LICENSE
deno.json
src/**/*.ts
docs/**/*
examples/<name>/grammar.ebnf
examples/<name>/baba.json
examples/<name>/programs/**/*
examples/<name>/README.md
examples/<name>/interpreter.ts or aot.ts
```

Do not publish checked-in generated outputs unless a concrete consumer requires them.

If some generated artifact is intentionally published, document why and budget its size.

### 3. Decide generated example policy

Choose one policy explicitly.

#### Preferred policy: generate during tests

- remove `examples/*/generated/` from Git;
- add one command per example to regenerate;
- tests generate into temporary directories;
- README screenshots/output snippets remain hand-maintained or derived in docs generation.

#### Alternative: checked-in snapshots

If snapshots remain:

- move them under `examples/*/snapshots/`;
- label them clearly as generated;
- add exact drift checking in CI;
- do not publish them;
- update them in a dedicated commit/PR when possible.

Do not leave the current ambiguous state where generated outputs are both examples and apparent source.

### 4. Make every example one-command reproducible

Each example should provide commands such as:

```sh
deno task generate
deno task check
deno task run
deno task test
```

Example docs should state:

- what Baba generates;
- what code is user-owned;
- how to regenerate;
- which parser target the interpreter uses;
- how to switch targets where supported;
- expected output for included programs.

### 5. Add architecture decision records

Create:

```text
docs/adr/0001-scope.md
docs/adr/0002-analyzed-grammar-and-portable-plan.md
docs/adr/0003-runtime-language.md
docs/adr/0004-wasm-artifact-and-abi.md
docs/adr/0005-contextual-lexing.md
docs/adr/0006-conflict-policy.md
docs/adr/0007-generated-file-ownership.md
```

Each ADR should include:

- status;
- context;
- decision;
- consequences;
- rejected alternatives;
- compatibility impact.

Do not write aspirational ADRs as though unimplemented features already exist. Mark proposed decisions clearly.

### 6. Split detailed documentation

Keep the root README focused on:

- what Baba is;
- installation;
- five-minute quick start;
- grammar example;
- target selection;
- links to deeper docs;
- stability/support status.

Move detail into:

```text
docs/grammar.md
docs/metadata.md
docs/portable-runtime.md
docs/typescript.md
docs/wasm.md
docs/diagnostics.md
docs/limits.md
docs/examples.md
docs/contributing.md
```

### 7. Document stability levels

State separately:

- stable public library API;
- EBNF syntax stability;
- metadata schema stability;
- parser-plan format stability;
- generated TypeScript API stability;
- Wasm ABI stability;
- internal BRL stability;
- Tree-sitter compatibility policy.

Internal runtime language should be marked private/unstable unless intentionally exposed later.

### 8. Add size budgets

Add CI budgets for:

- JSR publish payload;
- representative generated TypeScript bytes;
- representative Wasm bytes;
- root README length if useful;
- individual generated file size;
- total checked-in generated snapshot size.

Budgets should start slightly above measured current values and require deliberate updates when exceeded.

### 9. Clean stale comments and terminology

Audit module comments and docs for obsolete statements such as:

- “Tree-sitter only” after runtime targets exist;
- TypeScript-only limits that also apply to Wasm;
- old backend names;
- old output directories;
- stale metadata terminology;
- claims of host-neutral Wasm when only the JavaScript adapter is supported.

Use consistent terms:

```text
Tree-sitter target
portable runtime
TypeScript target
Wasm core module
Wasm TypeScript adapter
portable parser plan
BRL/internal runtime language
```

### 10. Add generated file banners and provenance

Generated source should include concise provenance:

```text
Generated by @mewhhaha/baba.
Parser plan version: 1.
Runtime semantics version: 1.
Do not edit; regenerate from grammar.ebnf.
```

Binary artifacts should carry equivalent version/provenance in manifests or custom sections where appropriate.

## Likely files

- `deno.json`
- `README.md`
- `docs/**/*`
- `examples/**/*`
- `.gitignore`
- `.github/workflows/ci.yml`
- generated banner emitters
- new size-report script under `scripts/` or `tools/`
- `tests/output_test.ts`

## Tests and checks

1. publish dry-run size report;
2. package include/exclude assertions;
3. example regeneration commands;
4. snapshot drift if snapshots remain;
5. all example interpreters/programs still run;
6. generated banner/provenance tests;
7. documentation links checked;
8. size budget failure test or script unit tests;
9. no generated example directories in publish payload unless allowlisted.

## Acceptance criteria

- Published package size is materially smaller or bounded by an explicit justified budget.
- Generated example outputs are either removed or enforced as snapshots.
- Every example is one-command reproducible.
- Architectural contracts are documented in ADRs.
- Root README is concise and links to focused docs.
- Stability levels are explicit.
- Stale terminology is removed.
- No parser or lexer semantics change.

## Out of scope

- runtime architecture implementation;
- parser-plan design;
- Wasm ABI implementation;
- changing grammar or metadata semantics;
- redesigning example languages;
- marketing website or unrelated branding work.

## Copy-ready agent prompt

> Implement T11 from `tasks/T11-package-example-and-documentation-hygiene.md`. Measure and reduce the published/generated artifact footprint, establish a clear generated-example policy, make examples one-command reproducible, add ADRs and focused docs, define stability levels and size budgets, and clean stale terminology. Do not change parser behavior.

## PR checklist

- [ ] Size report added.
- [ ] Publish payload reduced/budgeted.
- [ ] Generated example policy made explicit.
- [ ] Examples reproducible with documented commands.
- [ ] ADRs and focused docs added.
- [ ] Stability levels documented.
- [ ] Size budgets enforced.
- [ ] No parser behavior changed.
- [ ] Full repository checks pass.
