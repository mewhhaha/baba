# Baba parallel improvement program

This directory contains independent, copy-ready task briefs for several coding agents. The plan is intentionally aggressive: the objective is to turn Baba's Tree-sitter, TypeScript, and Wasm outputs into one coherent, versioned syntax-runtime system rather than add more surface area.

Prepared against Baba 1.3.x.

## Desired architecture

```text
EBNF + metadata
      |
      v
AnalyzedGrammar
      |
      v
PortableParserPlanV1
  - canonical token specifications
  - DFA tables and accepting candidates
  - LR tables and conflict policy
  - production reducers
  - CST schema
  - diagnostic schema
      |
      +--------------------+
      |                    |
      v                    v
runtime-language       TreeSitterPlan
compiler                   |
  |                        v
  +--> TypeScript       grammar.js + queries
  |
  +--> core Wasm + documented ABI
```

The lexer, parser loop, branch search, reductions, CST construction, and runtime diagnostics should have one implementation. TypeScript and Wasm should be different compilations or packages of that implementation, not separate algorithms maintained by hand.

## Non-goals

Do not use these tasks to add:

- semantic analysis, name resolution, type checking for user languages, or user-language code generation;
- formatter, LSP, or editor-extension generation;
- hard-coded language-specific scanners, WGSL support, indentation, heredocs, or fenced blocks;
- a general-purpose user-facing programming language;
- self-hosting as a release requirement;
- unbounded GLR parsing or editor-grade recovery before the portable runtime is stable.

The internal runtime language is compiler infrastructure. Add only features required to implement the DFA/LR runtime.

## Rules for every agent

1. Take exactly one task ID per PR unless the task explicitly says otherwise.
2. Start from the latest `main`; do not base work on another agent's unmerged branch unless the dependency table says to.
3. Do not bump the package version or edit `CHANGELOG.md`. The integration owner handles release bookkeeping.
4. Do not regenerate all checked-in examples unless the task explicitly owns example regeneration. Generated examples are merge-conflict magnets.
5. Preserve public behavior unless the task explicitly defines a breaking change. Add a compatibility shim and deprecation diagnostic where practical.
6. Expected user failures must become structured diagnostics, not generic thrown errors.
7. Keep target-specific code out of generic compiler analysis.
8. Add focused regression tests. Prefer executing generated code over source-substring assertions.
9. Before opening a PR, run:

   ```sh
   deno fmt --check
   deno lint
   deno task check
   deno task test
   deno task publish:dry-run
   ```

10. Include in the PR description:
    - task ID;
    - design decisions;
    - files intentionally deleted;
    - commands run;
    - known follow-up work;
    - benchmark changes when runtime code changed.

## Task index

| ID | Priority | Size | Workstream | Depends on |
|---|---:|---:|---|---|
| [T00](./T00-correctness-and-planning-cleanup.md) | P0 | M | Multi-target planning, options, diagnostics | none |
| [T01](./T01-versioned-portable-parser-plan.md) | P0 | XL | Versioned shared parser-plan IR | T00 |
| [T02](./T02-binary-artifacts-and-wasm-packaging.md) | P0 | L | Binary artifacts and real `.wasm` packaging | T00 |
| [T03](./T03-runtime-language-frontend.md) | P0 | XL | BRL frontend, type checker, IR, verifier | T01 |
| [T04](./T04-runtime-language-typescript-backend.md) | P0 | XL | BRL TypeScript backend and runtime port | T01, T03, T06, T07 |
| [T05](./T05-runtime-language-wasm-backend.md) | P0 | XL | BRL Wasm backend and runtime port | T01, T02, T03, T06, T07 |
| [T06](./T06-contextual-lexing-and-token-selection.md) | P0 | L | Parser-contextual token selection | T01 |
| [T07](./T07-stable-conflicts-and-bounded-ambiguity.md) | P0 | L | Stable conflict IDs and branch semantics | T01 |
| [T08](./T08-wasm-abi-memory-lifecycle-and-reentrancy.md) | P0 | L | Wasm ABI, ownership, limits, reentrancy | T02, T05 |
| [T09](./T09-analysis-and-resource-hardening.md) | P1 | L | Regex/grammar analysis limits and caching | none |
| [T10](./T10-differential-fuzz-performance-release-gates.md) | P1 | XL | Parity, fuzzing, benchmarks, CI gates | runtime tasks |
| [T11](./T11-package-example-and-documentation-hygiene.md) | P1 | M | Package size, examples, ADRs, docs | none |

Each task file contains:

- objective and problem statement;
- detailed required work;
- likely files;
- concrete tests;
- acceptance criteria;
- explicit out-of-scope items;
- a copy-ready agent prompt;
- PR checklist.

## Merge waves

```text
Wave 0: T00, T09, T11
              |
              v
Wave 1: T01, T02
              |
              v
Wave 2: T03, T06, T07
              |
              v
Wave 3: T04 and T05
              |
              v
Wave 4: T08
              |
              v
Wave 5: T10
```

### Wave 0

These tasks can begin immediately because they have distinct ownership:

- T00 owns orchestration and option semantics.
- T09 owns generic analysis/resource hardening.
- T11 owns package, example, and documentation hygiene.

Avoid having T00 and T09 both restructure the same planner module. T09 should keep generic regex/grammar analysis below target orchestration.

### Wave 1

Start after T00 merges:

- T01 establishes the portable plan.
- T02 establishes binary artifact support.

They can run in parallel if T02 does not invent a competing parser-plan format. T02 owns `GeneratedFile`/output and Wasm artifact packaging; T01 owns parser-plan semantics.

### Wave 2

Start after T01:

- T03 builds the runtime language frontend.
- T06 defines contextual token selection in the plan/runtime contract.
- T07 defines stable conflicts and ambiguity policy.

T03 should avoid hard-coding old lexer/conflict behavior. T06/T07 should expose semantic requirements that T04/T05 will implement in BRL.

### Wave 3

T04 and T05 may run in parallel after T03, T06, and T07 stabilize.

Coordinate ownership of shared BRL runtime files:

- one agent should land the shared `.brl` runtime skeleton first, or
- both PRs should branch from a small shared-runtime preparation commit.

Do not allow TypeScript and Wasm agents to create separate BRL runtime implementations.

### Wave 4

T08 depends on the real Wasm backend and binary packaging. It owns the public ABI and instance lifecycle, not parser semantics.

### Wave 5

T10 is the final release gate. It may add scaffolding early, but exact parity, bootstrap drift, and final resource tests must be rebased after runtime work lands.

## Suggested agent assignment

For several GPT-5.5-medium agents, a practical first allocation is:

```text
Agent A: T00
Agent B: T09
Agent C: T11
```

After Wave 0:

```text
Agent A: T01
Agent B: T02
```

After Wave 1:

```text
Agent A: T03
Agent B: T06
Agent C: T07
```

After Wave 2:

```text
Agent A: T04
Agent B: T05
Agent C: prepare T10 fixtures without changing semantics
```

Then:

```text
Agent A or B: T08
Agent C: T10 final integration
```

Large tasks should be split into reviewable commits inside one PR, not silently divided between agents with overlapping file ownership.

## Integration checklist

After all task PRs are merged, verify:

- [ ] `AnalyzedGrammar` is the only generic target input before target planning.
- [ ] `PortableParserPlanV1` is built once per compile.
- [ ] TypeScript and Wasm execute the same BRL runtime source.
- [ ] No parser algorithm remains duplicated in target emitters.
- [ ] No parser-specific Wasm opcode template remains.
- [ ] Regexes are parsed once and canonically lowered to every backend.
- [ ] Contextual token selection has a written contract.
- [ ] Conflict selectors are stable and branch search is bounded.
- [ ] Wasm ABI, memory lifetime, encoding, and resource limits are versioned.
- [ ] Binary artifacts are first-class generated files.
- [ ] TypeScript/Wasm exact parity is enforced in CI.
- [ ] Tree-sitter acceptance parity is enforced for the portable subset.
- [ ] Runtime-language semantics have a conformance suite.
- [ ] Bootstrap artifacts regenerate deterministically.
- [ ] Package and generated-output size budgets are enforced.

## Release recommendation

Do not add another public target or another parser feature while P0 tasks remain incomplete.

The next credible major milestone is:

> One versioned parser plan and one portable runtime implementation, compiled to TypeScript and Wasm, with exact behavioral parity and explicit resource limits.
