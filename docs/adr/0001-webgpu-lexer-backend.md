# ADR 0001: WebGPU Lexer Runtime Backend

Status: proposed. Not implemented in `src/`. Blocked on the Phase 0 gate below.

Date: 2026-07-26.

Supersedes: nothing. Superseded by: nothing.

Evidence: `experiments/webgpu-lexer/` (proof of concept, parity gate, benchmark,
`results.json`, `results_crossover.json`, `results_thunkwasm.json`).

## Context

Baba's shipping lexer is `fn lex_all` in
`src/targets/runtime/wasm_engine_rs/src/lib.rs` (~line 342). It emits token
records of four `i32`: `{ specIndex, start, end, acceptingState }`. It performs
longest match with restart: scan forward tracking the best accepting position,
then restart at `best_end`. On no match it emits a single-codepoint error record
with `specIndex = -1`.

Lexing is the only stage of the pipeline that is a pointwise map over the source
rather than a sequential fold over a stack. It is therefore the only stage with
a plausible data-parallel formulation. A proof of concept was built to find out
whether that formulation is exact, and whether it is fast enough to matter.

The proof of concept reaches byte-exact parity with `lex_all` on all four
shipped example grammars and no excluded input class, but is slower than the CPU
below 768 KiB of source on the one stack it was measured on.

## Decision

Implement GPU lexing as an alternative **runtime backend** that consumes the
existing `parser.plan`, not as a new `GenerateTarget`.

The backend swaps the execution strategy for `lex_all` and nothing else. It
produces the same four-`i32` records, in the same order, with the same values.
No regeneration, no plan-format change, and no grammar change are required to
run it against a plan that ships today.

### Why not a generate target

`wasm` and `tree-sitter` are targets because they emit different artifact sets:
`wasm/parser.wasm` plus `wasm/parser.plan` plus adapters, versus `grammar.js`
plus `src/scanner.c` plus query fragments. A GPU lexer emits no artifacts. It is
a second implementation of an existing artifact's semantics.

Adding a `"webgpu"` target would mean editing six hardcoded dispatch sites:

| site                     | what it hardcodes                              |
| ------------------------ | ---------------------------------------------- |
| `src/ast.ts:216`         | `GenerateTarget = "wasm" \| "tree-sitter"`     |
| `src/api.ts:288`         | `normalizeTargets` accept-list and default     |
| `src/api.ts:162`, `:195` | `compile` per-target emission branches         |
| `src/api.ts:92`, `:114`  | `validateGrammar` per-target planning branches |
| `src/cli.ts:499`         | `addTarget` string mapping, including `all`    |
| `src/cli.ts:449`         | `explainTargets` per-target capability reports |

Each of those sites would then have to describe an artifact set that does not
exist. `--target all` would have to decide whether "all" includes a backend that
writes no files. `explainTargets` would have to report capabilities for an
output directory with nothing in it. The stability contract in
`docs/stability.md` would acquire a target whose "generated output" is
undefined.

A runtime backend has none of those problems. It is selected at
`createParser`/`lex` time against a plan that already exists.

## Why the Parser Stays on the CPU

Three structural properties of the parser block a GPU formulation. They are
stated concretely because each one is a separate blocker, and none of them is a
tuning problem.

1. **Token identity is parser-directed.** `fn select_action` (lib.rs ~line 720)
   picks the terminal from the accept-candidate rows for `acceptingState`, then
   consults `parser_action(state, terminal)` with the _current LR state_. The
   same `acceptingState` resolves to different terminals in different parse
   states. Identity therefore cannot be computed ahead of the parse at all, on
   any device.
2. **Canonical LR(1) over a sequential stack.** `parse_trace` and `parse_cursor`
   drive a single stack through `load_stack_value`/`store_stack_value` (lib.rs
   ~lines 1160-1166). Each shift/reduce depends on the immediately preceding
   one. There is no parallel prefix formulation of an LR stack without changing
   the algorithm.
3. **Branch search is bounded backtracking DFS, not GLR.** The declared-conflict
   policy is `deterministic-or-declared-branching`
   (`src/targets/runtime/portable_plan.ts:249`); the contract in
   `src/runtime/branch_search.brl` is depth-first with save/restore
   (`branch_next_depth`, `branch_can_enqueue`, `branch_restore_outcome`) and a
   `branchLimit` diagnostic. Branches are explored one at a time against a
   restored stack, not maintained as a frontier.

The corollary is what makes the lexer tractable. Because identity is resolved
later, the lexer's _only_ job is boundaries plus `acceptingState`. Token records
already carry `acceptingState` for exactly that reason. A GPU lexer that
produces only boundaries and `acceptingState` is a drop-in `lex_all` replacement
with zero semantic change, and the parity gate is byte equality of the record
array rather than a semantic argument.

## Measured Evidence

All numbers below are from `experiments/webgpu-lexer/`. Machine: NVIDIA GeForce
RTX 4080 SUPER, Deno 2.9.4 / wgpu, Linux. Sizes are UTF-16 code units.

Note on provenance: the initial recon reported an "AMD adapter" from vendor id
4318. That is `0x10DE`, which is NVIDIA. All benchmark numbers are from the
NVIDIA adapter named above.

### The synchronization floor

The dominant cost is not compute and not bandwidth. It is host-device
synchronization.

| operation                                     | cost                       |
| --------------------------------------------- | -------------------------- |
| `queue.submit()` alone                        | 0.031 ms                   |
| `await onSubmittedWorkDone()` or `mapAsync()` | ~11.3 ms, any payload size |
| 8 compute passes batched into one submit      | still ~11.3 ms total       |

Measured `submit+sync` at 16 KiB in the final benchmark is 11.75 ms, against a
total GPU wall time of 12.01 ms.

This is per-sync, not per-dispatch and not per-byte. It forces a hard
architectural constraint: **the whole pipeline must be one command encoder, one
`queue.submit()`, and one `mapAsync()`.** No intermediate readback, no
CPU-in-the-loop fixup pass. Every stage - chunk scan, pointer doubling, chunk
entry resolution, counting, prefix sum, emission - stays on device. The proof of
concept is seven dispatches under that constraint.

### Throughput

Grammar `funcfuck`, randomized source, medians of 7 runs after 2 warmups. GPU
column is worst-case output capacity (one record per code unit, cannot overflow)
with owned records - the same configuration the parity gate runs.

| size    | tokens  | cpu `lex_all` | gpu total | speedup |
| ------- | ------- | ------------- | --------- | ------- |
| 16 KiB  | 6505    | 0.39 ms       | 12.01 ms  | 0.03x   |
| 32 KiB  | 12826   | 0.77 ms       | 12.13 ms  | 0.06x   |
| 64 KiB  | 25764   | 1.47 ms       | 12.09 ms  | 0.12x   |
| 128 KiB | 51671   | 3.17 ms       | 12.44 ms  | 0.26x   |
| 256 KiB | 103243  | 5.65 ms       | 13.90 ms  | 0.41x   |
| 512 KiB | 206362  | 10.58 ms      | 14.01 ms  | 0.76x   |
| 1 MiB   | 413140  | 21.40 ms      | 17.39 ms  | 1.23x   |
| 4 MiB   | 1651674 | 84.30 ms      | 31.29 ms  | 2.69x   |
| 16 MiB  | 6605769 | 338.42 ms     | 110.16 ms | 3.07x   |

**Crossover is 768 KiB of source**, confirmed by two independent finer sweeps
(0.72x/0.73x at 512 KiB, 0.92x/0.88x at 640 KiB, 1.08x/1.04x at 768 KiB). On the
stricter test of worst GPU sample against best CPU sample the crossover is 896
KiB.

Cross-check on `thunkwasm` (repeated example programs, periodic input): 1 MiB
1.08x, 16 MiB 2.60x.

The CPU baseline here is `lex_all` records, ~40-48 MiB/s. It is deliberately not
`parser.lex()`, which measures ~12 MiB/s because it also materializes the token
tape and `Token` objects. Using `parser.lex()` as the baseline would have made
the GPU look roughly 4x better for free and moved the apparent crossover down
about 10x. Any future comparison must keep the unit of work identical on both
sides.

### Where the GPU time goes, at 16 MiB

| stage            | ms      |
| ---------------- | ------- |
| upload           | 1.676   |
| encode           | 0.825   |
| submit + sync    | 32.333  |
| `getMappedRange` | 38.676  |
| copy out (owned) | 37.966  |
| **total**        | 110.162 |

Kernel time inside that submit totals 9.44 ms: `pass_a` 1.110, `pass_b` 0.927,
`pass_c` 1.620, `pass_d` 0.963, `pass_e1` 0.004, `pass_e2` 0.005, `pass_f`
4.326.

Actual DFA work is under 10% of wall time. The backend is bound by
synchronization and by host-side buffer movement, not by compute.

### State count is a direct throughput multiplier

A prototype chunk-transition-map kernel sustained the following on 16 MiB of
input as a function of DFA state count `S`, because the speculative approach
runs one thread per possible start state:

| S   | MiB/s of DFA work |
| --- | ----------------- |
| 16  | 8792              |
| 64  | 2561              |
| 128 | 1211              |
| 241 | 613               |

Cost scales roughly linearly with `S`. That is the direct argument for DFA
minimization in Phase 1.

### Parity

Records-vs-records, every field, first mismatch reported with context, non-zero
exit on failure.

| grammar      | states | specs | classes | cases |
| ------------ | ------ | ----- | ------- | ----- |
| funcfuck     | 81     | 29    | 32      | 83/83 |
| thunkwasm    | 65     | 31    | 32      | 58/58 |
| brainfuck    | 16     | 13    | 13      | 58/58 |
| feature-tour | 32     | 22    | 27      | 52/52 |

Plus grid-stride reruns at artificially squeezed dispatch grids (240/171/171/153
passed), floor-device simulation at `chunkSize = 2048` (80/57/57/51 passed), and
7/7 failure-mode guards per grammar. Coverage includes the empty string, error
tokens, lone and paired surrogates, above-ASCII BMP and U+2028/U+2029,
longest-match backtracking, unterminated constructs, 9000-unit single-token
runs, chunk-boundary injection at every offset 4090..4102, and randomized 1 MiB
and 4 MiB inputs. Negative controls confirm the comparison is not vacuous.

### What was NOT measured

- **The synchronization floor on Chrome/Dawn on real GPU hardware is unknown.**
  The in-app browser available for testing had no GPU adapter. Every number
  above is Deno 2.9.4 / wgpu. The ~11.3 ms floor is a property of that stack,
  and it is what sets the crossover. If a browser's floor is ~1 ms rather than
  ~11 ms, the crossover drops roughly 10x (estimate, by direct substitution into
  the measured wall-clock breakdown - not measured), which moves it into
  editor-relevant file sizes. This is the single largest open question in this
  ADR.
- **Any second GPU, driver, or WebGPU implementation.** One adapter, one stack.
- **Floor-device performance.** Floor-device _behaviour_ is simulated and
  tested; floor-device _throughput_ is not measured at all.
- **`getMappedRange` on a non-Deno host.** Its per-byte cost is discontinuous in
  the Deno data (~13 GB/s at 4 MiB, ~2.7 GB/s at 16 MiB), so the common claim
  that it "disappears in a browser" is an untested hypothesis, not a result.
- **Any real Baba source file at these sizes.** The largest program file in this
  repo is 224 bytes; the largest whole-example corpus is 493 bytes. All
  throughput input is synthetic and about three orders of magnitude below the
  crossover.

## Remaining Work

Each phase has an explicit gate. A phase does not start until the previous gate
passes.

### Phase 0: measure the Chrome/Dawn sync floor on real hardware

Measure `queue.submit()` + `mapAsync()` round-trip latency as a function of
payload size in Chrome/Dawn on a real GPU, and again in Firefox if available.

**Gate for everything else.** If the floor is ~11 ms across implementations, the
crossover stays near 768 KiB, no file in this repo comes close, and the backend
is a server/batch feature at best. If the floor is ~1 ms, the estimated
crossover falls to roughly 100 KiB and the backend becomes interesting for
editor workloads. Phases 1-4 are not justified until this number exists.

### Phase 1: compiler prerequisites

Three changes to the compiler and plan, all of which also benefit the CPU path.

1. **Persist alphabet equivalence classes.** `collectAlphabetSegments`
   (`src/compiler/regex/dfa.ts:129`) already computes exactly the right
   partition, and `buildDfa` then re-coalesces adjacent segments away
   (`dfa.ts:80-82`) so the classes never reach the plan. Extend the stage to
   keep them and emit them, rather than rebuilding them at backend load time.
   The proof of concept's `alphabet.ts` is a prototype of this stage: it
   produced 32 classes from `funcfuck`'s 81 states, 13 from `brainfuck`'s 16,
   and 27 from `feature-tour`'s 32 (including 3 above-ASCII ranges). The
   above-ASCII ranges are not decoration - `feature-tour` has a class that
   exists only at U+2028..U+2029, and two of the four grammars have negated
   character classes whose catch-all class is live rather than dead.
2. **Add DFA minimization (Hopcroft).** There is no minimization pass today. GPU
   cost scales roughly linearly with state count - 8792 MiB/s at S=16 against
   613 MiB/s at S=241 - so minimization is a direct throughput multiplier for
   the GPU and a table-size and cache-footprint win for the CPU. It also
   relieves the proof of concept's workgroup-storage ceiling, since `pass_a`
   holds `stateCount * classCount` entries in shared memory.
3. **Add dense-table plan sections.** Store the dense `(states x classes)`
   transition table alongside the existing sparse CSR rows, so a backend can
   bind it directly.

Plan-format implications: `docs/stability.md` makes `PortableParserPlan` a
versioned runtime data contract at core format version 3 and plan version 2.
Additive sections require a version bump and a documented policy for how a
runtime that does not understand the new sections behaves. Note also that the
DFA start state is hardcoded to 0 in both `lex_all` and the proof-of-concept
kernel and is not stored in the plan; minimization or state renumbering must
either preserve that or introduce an explicit start-state field with a version
bump, because today nothing would catch the divergence.

**Gate:** existing CPU parity tests pass unchanged, plan version policy is
documented, and the minimized state counts are recorded for the shipped example
grammars.

### Phase 2: the production kernel

The proof of concept's central stage is asymptotically wrong and must be
replaced, not patched. `pass_a` computes `next(p)` at every offset, and
`next(p)` costs O(length of the token starting at p). On normal source (mean
token length ~2.5 code units) that is effectively O(n); on a single long token
it is O(n²). Measured on input that is one `funcfuck` whitespace token: 45.4x
slower than `lex_all` at 512 KiB, 85.0x at 1 MiB, 169.4x at 2 MiB (5.43 s in one
un-interruptible dispatch). Grammars with block comments or long string literals
hit this. The fix is either chunked composition of
`(finalState, lastAcceptOffset, lastAcceptState)` per candidate start state, or
a cap-and-fixup pass; both bound per-thread work by chunk size.

Also in scope: replace `pass_c`'s serial chunk walk (1.6 ms at 16 MiB, 4096
dependent global loads in a single thread) with a second level of guarded
doubling; a storage-buffer fallback for DFA tables that exceed workgroup
storage; an output-sizing policy driven by a running tokens-per-code-unit
estimate plus the existing overflow flag rather than always allocating the worst
case.

**Gate, non-negotiable:** byte-exact parity against `lex_all` across all
fixtures, in the same spirit as the TypeScript/Wasm parity convention in
`AGENTS.md`. Record count plus every field of every record. Including the
long-single-token corpus, which must also stop being asymptotically worse than
the CPU.

### Phase 3: guards

Contextual tokens with trailing lookahead are refused today, not mislexed. All
four shipped examples are guard-free, so nothing is excluded in practice, but
grammars using `contextual` with lookahead (`docs/grammar.md`) are out of reach.
The blocker is structural: `spec_guard_matches` (lib.rs ~line 462) makes accept
a function of position, not just DFA state, which destroys the
`acceptSpecByState` collapse the kernel is built on. Four guard shapes exist:
positive trailing lookahead, negative trailing lookahead, followed-by-EOF, and
excluded words.

Options, honestly stated:

- **Keep refusing.** Cheapest, already implemented, and correct. Grammars with
  guards use the Wasm path.
- **CPU fallback for guard resolution only.** GPU produces candidate boundaries;
  the CPU re-resolves the guarded specs. Correct, but reintroduces a per-token
  CPU pass whose cost has not been measured and which may erase the win.
- **Guard DFAs on device.** Run the guard DFAs in the kernel and make accept a
  function of `(state, position)`. Widens per-position state and defeats the
  collapse the current design depends on; effectively a second kernel design.

**Gate:** whichever option is chosen, guard-carrying grammars must either be
correct under parity or produce a structured diagnostic. Silent mislexing is not
an acceptable outcome at any stage.

### Phase 4: integration

- Auto-select the GPU backend only above the measured crossover, using the
  number Phase 0 produces for the target host - not the 768 KiB measured here.
- Always fall back to Wasm: no adapter, no device, device lost, over-limit
  input, unsupported grammar, or any validation error. Fallback must be
  observable, not silent.
- Unsupported-grammar diagnostics follow the existing
  `TREE_SITTER_UNSUPPORTED_CONTEXTUAL_GUARD` precedent
  (`src/targets/tree_sitter_scanner.ts:227`): a stable code, a named reason, and
  a documented entry in `docs/diagnostics.md`.
- Account for one-time setup. Measured: 226.06 ms for the GPU path
  (`requestAdapter` 138.79 ms, `requestDevice` 82.01 ms, ~4 ms for tables,
  shader, and pipelines) against 0.342 ms for `CpuReferenceLexer.create` - 660x.
  The per-call saving at the crossover is ~0 ms, and even the 16 MiB case saves
  only ~228 ms, roughly one device init. **No single document repays setup.**
  The backend is only defensible in a long-lived process that lexes repeatedly,
  and device acquisition must be shared across parser instances.

**Gate:** the whole existing test suite passes with the backend enabled and with
it disabled, and disabling it is the default.

## Risks and Open Questions

**Portability against WebGPU limit minimums.** The measured adapter is generous;
the guaranteed floor is not. Four walls, all now enforced by preflight in the
proof of concept, with values on this adapter against a spec-floor device:

| wall                               | this adapter      | spec floor  |
| ---------------------------------- | ----------------- | ----------- |
| `maxStorageBufferBindingSize`      | 2 147 483 644     | 134 217 728 |
| `maxBufferSize`                    | 1 099 511 627 776 | 268 435 456 |
| `maxComputeWorkgroupStorageSize`   | 49 152            | 16 384      |
| `maxComputeWorkgroupsPerDimension` | 65 535            | 65 535      |

At worst-case output capacity the records binding is the first wall: 134 217 727
code units here, 8 388 608 on a floor device. The 16 MiB benchmark row is
therefore **not runnable on a spec-floor device at all**. Workgroup storage is
the second: the proof of concept originally hardcoded 32 768 bytes of shared
memory, twice the guaranteed 16 384, and now picks the largest chunk size that
fits the granted limit (4096 here, 2048 on a floor device). wgpu does not
validate workgroup storage at all - a 262 144-byte allocation was accepted - so
this class of bug is invisible on the development stack and fatal on a
conformant one. Any production backend must preflight every binding, buffer, and
dispatch grid against `device.limits` and refuse loudly.

**Errors are silent by default in WebGPU.** Without error scopes, a validation
failure makes the whole command buffer a no-op while `mapAsync` still resolves,
so the host reads back the _previous_ submit's staging contents with no
exception. The proof of concept had this bug in four separate forms (over-limit
input, destroyed buffers, unclamped dispatch, oversized bind group) and every
one of them produced a plausible-looking wrong answer rather than a throw. A
production backend needs error scopes around the entire per-lex path,
`device.lost` checking, and a bind-group cache keyed so it can never outlive its
buffers.

**Measurement variance is large and unmodelled.** At 16 MiB the same work ranged
107.78-208.03 ms across 7 runs, and kernel totals ranged 6.15-37.66 ms. The GPU
concurrently drives the desktop; no clock pinning or GPU isolation was applied.
Any performance gate must be stated with dispersion, not as a single median.

**Memory footprint is roughly 10x the source.** At 16 MiB: 33.5 MB source, three
67 MB per-position arrays, up to 268 MB of records, and a same-sized staging
buffer.

**Parity gaps the proof of concept could not close.** The long-single-token
quadratic case is correct but asymptotically wrong and is not fixed (Phase 2).
Guard-carrying grammars are refused rather than supported (Phase 3). The
throughput corpus is short-token-only for `funcfuck` and strictly periodic for
`thunkwasm`, so both generators are the kernel's fast case and never its known
worst case.

**Plan header constants are duplicated.** `src/runtime/wasm_plan.ts` exposes
only table counts; `readI32`, `readRowValue`, `decodeCompactOffset` and the
`CORE_HEADER_*` constants are module-private. The proof of concept re-declares
them, pinned by asserting `formatVersion === 3` and `parserPlanVersion === 2`. A
production backend should share the decoder rather than duplicate it.

## Prerequisite and Related Work

**`parse()` dies below the input regime a GPU lexer targets.** `parser.parse()`
throws `RangeError("Wasm parser plan exceeds maximum memory pages.")`
(`src/runtime/generated_wasm.ts:2526`) above roughly 750 KiB of source.
`parser.lex()` and `parser.validate()` are fine at multi-MiB sizes. The
crossover measured here is 768 KiB. Cursor materialization therefore fails at
almost exactly the size where GPU lexing starts to win, so feeding multi-MiB
inputs to a faster lexer is of limited use until that is resolved. This is a
pre-existing limitation, unrelated to this work, and needs resolving in parallel
rather than as part of it.

**There is no incremental machinery to conflict with or to lean on.**
`src/compiler/grammar_incremental.ts` is a full reparse behind an incremental
API - it reports a `reparsedRange`, but the work is not incremental. A GPU lexer
neither breaks an incremental path nor gets to reuse one. If real incremental
relexing lands later, its interaction with a whole-buffer GPU pass will need its
own decision.

## Out of Scope

- **Any parser work on the GPU.** Three independent blockers, listed above. Not
  a tuning problem.
- **Terminal identity resolution in the kernel.** By design. `select_action`
  resolves the terminal from `(acceptingState, LR state)` at parse time.
  Emitting only boundaries and `acceptingState` is precisely what makes the
  backend a drop-in for `lex_all` with zero semantic change.
- **A `"webgpu"` generate target.** See the six dispatch sites above.
- **Incremental or streaming GPU lexing.** No incremental machinery exists to
  build on, and the one-submit/one-sync constraint is hostile to small edits.
- **Non-WebGPU compute backends** (CUDA, Metal, Vulkan directly). WebGPU is the
  only one that runs where Baba's generated parsers run.
- **Optimizing the Deno `getMappedRange` path.** It is 38.7 ms of the 110.2 ms
  at 16 MiB, but it is a host artifact. Measure a second implementation first
  (Phase 0) rather than working around one.
- **Parallel declared-conflict branch search.** This is the one genuinely
  GPU-shaped parser opportunity and it is a deliberate non-goal. The search is
  currently bounded backtracking DFS with full stack save/restore, which is
  breadth-parallel by nature: every enqueued branch is independent until one
  succeeds. But declared conflicts are rare - the default profile is
  `deterministic`, and `branching` is opt-in per grammar - so the expected
  frontier is a handful of branches, far below the ~11 ms sync floor. Recorded
  here so it is not rediscovered as novel; not worth pursuing.

## References

- `experiments/webgpu-lexer/README.md` - full proof-of-concept writeup, kernel
  design, and the raw numbers quoted above.
- `experiments/webgpu-lexer/results.json`, `results_crossover.json`,
  `results_thunkwasm.json` - machine-readable benchmark output including every
  per-run sample.
- `src/targets/runtime/wasm_engine_rs/src/lib.rs` - `lex_all` (~342),
  `decode_code_point` (~393), `spec_guard_matches` (~462), `select_action`
  (~720).
- `src/compiler/regex/dfa.ts` - `buildDfa` (23), segment re-coalescing (80),
  `collectAlphabetSegments` (129).
- `docs/stability.md` - parser-plan format versioning policy.
- `docs/grammar.md` - contextual tokens and trailing lookahead.
- `docs/performance.md` - existing runtime benchmark surfaces.
