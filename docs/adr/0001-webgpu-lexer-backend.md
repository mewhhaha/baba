# ADR 0001: WebGPU Lexer Runtime Backend

Status: accepted. The backend is implemented in `src/runtime/webgpu/` and
exported as the experimental module `@mewhhaha/baba/runtime/webgpu-lexer`. It is
opt-in, nothing selects it automatically, and Phase 4 integration remains
blocked on the Phase 0 gate below.

Date: 2026-07-26. Revised 2026-07-26 after the Phase 2 kernel change: the
quadratic `pass_a` stage was replaced by `pass_x` / `pass_y` / `pass_z`, so the
throughput table, the per-stage breakdown, the parity counts, the state-count
argument and the Phase 2 section all changed. Numbers predating that change are
labelled as such wherever they are retained for comparison.

Supersedes: nothing. Superseded by: nothing.

Evidence: `experiments/webgpu-lexer/README.md` plus `results.json`,
`results_crossover.json` and `results_thunkwasm.json` in the same directory.
Those four files are the record of the proof of concept and every measurement
quoted below; they are retained unchanged.

The code they describe now lives in `src/runtime/webgpu/` (backend),
`tests/webgpu_lexer_parity_test.ts` (the parity gate, which compiles its grammar
inline and skips when no GPU adapter exists), and
`scripts/webgpu_lexer_parity.ts`, `scripts/webgpu_lexer_bench.ts` and
`scripts/webgpu_lexer_pathological.ts` (multi-grammar sweep and benchmarks).
User-facing documentation is `docs/webgpu-lexer.md`.

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

Measured `submit+sync` at 16 KiB in the current benchmark is 12.58 ms, against a
total GPU wall time of 12.86 ms - so at the smallest measured size, 98% of the
wall clock is synchronization.

This is per-sync, not per-dispatch and not per-byte. It forces a hard
architectural constraint: **the whole pipeline must be one command encoder, one
`queue.submit()`, and one `mapAsync()`.** No intermediate readback, no
CPU-in-the-loop fixup pass. Every stage - chunk scan, pointer doubling, chunk
entry resolution, counting, prefix sum, emission - stays on device. The proof of
concept is nine dispatches under that constraint.

### Throughput

Grammar `funcfuck`, randomized source, medians of 7 runs after 2 warmups. GPU
column is worst-case output capacity (one record per code unit, cannot overflow)
with owned records - the same configuration the parity gate runs.

| size    | tokens  | cpu `lex_all` | gpu total | speedup |
| ------- | ------- | ------------- | --------- | ------- |
| 16 KiB  | 6505    | 0.45 ms       | 12.85 ms  | 0.04x   |
| 32 KiB  | 12826   | 0.89 ms       | 13.03 ms  | 0.07x   |
| 64 KiB  | 25764   | 1.57 ms       | 12.96 ms  | 0.12x   |
| 128 KiB | 51671   | 2.82 ms       | 13.21 ms  | 0.21x   |
| 256 KiB | 103243  | 5.53 ms       | 13.58 ms  | 0.41x   |
| 512 KiB | 206362  | 10.75 ms      | 16.24 ms  | 0.66x   |
| 1 MiB   | 413140  | 20.93 ms      | 16.45 ms  | 1.27x   |
| 4 MiB   | 1651674 | 82.56 ms      | 35.99 ms  | 2.29x   |
| 16 MiB  | 6605769 | 333.62 ms     | 133.87 ms | 2.49x   |

These are the `pass_x`/`pass_y`/`pass_z` kernel. The peak figure moved down when
the quadratic stage was removed: the same 16 MiB row read 110.16 ms and 3.07x
under the old `pass_a`. Two independent runs of the current kernel on the same
bytes produced 133.87 ms / 2.49x and 132.16 ms / 2.73x, so quote the range, not
a single median. See "Measurement variance" under Risks.

**Crossover is 768 KiB of source and did not move**, confirmed by a finer sweep
after the kernel change (0.68x at 512 KiB, 0.77x at 640 KiB, 1.03x at 768 KiB,
1.19x at 896 KiB). It does not move because the new stage's cost is proportional
to `n`, so at the crossover it is well under a millisecond against a total still
dominated by the synchronization floor. On the stricter test of worst GPU sample
against best CPU sample the crossover is 1 MiB.

Cross-check on `thunkwasm` (repeated example programs, periodic input): 1 MiB
0.94x, 16 MiB 2.05x - down from 1.08x and 2.60x. `thunkwasm` regressed harder
than `funcfuck` despite having **fewer** DFA states (65 vs 81), because the
per-state column read's LDS bank pattern is data-dependent. State count alone
does not predict the cost.

The CPU baseline here is `lex_all` records, ~40-48 MiB/s. It is deliberately not
`parser.lex()`, which measures ~12 MiB/s because it also materializes the token
tape and `Token` objects. Using `parser.lex()` as the baseline would have made
the GPU look roughly 4x better for free and moved the apparent crossover down
about 10x. Any future comparison must keep the unit of work identical on both
sides.

### Where the GPU time goes, at 16 MiB

| stage            | ms      |
| ---------------- | ------- |
| upload           | 1.609   |
| encode           | 0.778   |
| submit + sync    | 51.831  |
| `getMappedRange` | 38.817  |
| copy out (owned) | 40.705  |
| **total**        | 133.865 |

Kernel time inside that submit totals 27.97 ms: `pass_x` 16.622, `pass_y` 2.659,
`pass_z` 1.116, `pass_b` 0.930, `pass_c` 1.613, `pass_d` 0.935, `pass_e1` 0.005,
`pass_e2` 0.005, `pass_f` 3.759.

DFA work is now about 20% of wall time rather than under 10%, because the
linear-time sweep costs `n * stateCount` by construction where the old pointwise
scan cost `n * meanTokenLength`. The backend is still bound by synchronization
and host-side buffer movement, not by compute: readback alone (`getMappedRange`
plus copy out) is 79.5 ms, well over half the total.

Two serial scans remain, both single-workgroup walks over the same 4096 elements
and both wanting a two-level scan: `pass_c` (1.613 ms) and the newly added
`pass_y` (2.659 ms). Neither was addressed.

`pass_x` also carries a latency floor of roughly 0.8 ms at every size, because
each workgroup walks its segment serially - a segment costs the same wall time
whether the input has four segments or four thousand. That floor is invisible
under the ~12 ms synchronization floor today. It would become the dominant small
input cost if Phase 0 finds a host whose sync floor is ~1 ms.

### State count is a direct throughput multiplier

This is now the single most important cost lever, and it became **more**
important with the linear-time kernel, not less. `pass_x` runs one thread per
DFA state per segment, so its cost is `n * stateCount` **by construction** -
where the old `pass_a` cost `n * meanTokenLength` and only degenerated to
`n * n` on long tokens. State count is no longer an incidental property of the
speculative approach; it is a direct multiplier on every input.

A prototype chunk-transition-map kernel sustained the following on 16 MiB of
input as a function of DFA state count `S`:

| S   | MiB/s of DFA work |
| --- | ----------------- |
| 16  | 8792              |
| 64  | 2561              |
| 128 | 1211              |
| 241 | 613               |

Measured on the real `pass_x` sweep at 16 MiB, the added stage costs 5.38 ms at
S=16, 8.45 ms at S=64, 9.50 ms at S=81 (`funcfuck`, real tables), 15.83 ms at
S=128 and 31.86 ms at S=241.

Two caveats. State count does not predict cost on its own - `thunkwasm` at S=65
runs a slower `pass_x` than `funcfuck` at S=81, because the per-state column
read's LDS bank pattern is data-dependent. And reachable-state pruning is not a
way out: soundly narrowing the state set requires a forward set-valued scan
whose update is itself proportional to the set size, which is circular.

DFA minimization in Phase 1 is therefore the direct and only general lever.

### Parity

Records-vs-records, every field, first mismatch reported with context, non-zero
exit on failure.

| grammar      | states | specs | classes | cases   |
| ------------ | ------ | ----- | ------- | ------- |
| funcfuck     | 81     | 29    | 32      | 119/119 |
| thunkwasm    | 65     | 31    | 32      | 94/94   |
| brainfuck    | 16     | 13    | 13      | 94/94   |
| feature-tour | 32     | 22    | 27      | 88/88   |

Plus grid-stride reruns at artificially squeezed dispatch grids (348/279/279/261
passed), floor-device simulation at `chunkSize = 2048` (116/93/93/87 passed),
and 7/7 failure-mode guards per grammar. Coverage includes the empty string,
error tokens, lone and paired surrogates, above-ASCII BMP and U+2028/U+2029,
longest-match backtracking, unterminated constructs, 9000-unit single-token
runs, chunk-boundary injection at every offset 4090..4102, and randomized 1 MiB
and 4 MiB inputs. Negative controls confirm the comparison is not vacuous.

The case counts grew with the kernel change (from 83/58/58/52) because the
segment sweep introduced a boundary the old kernel did not have. The added cases
cover an astral character at every offset from `SEG_SIZE - 6` to `SEG_SIZE + 6`
in two shapes, an accept landing exactly on a segment boundary, and a live run
spanning three, four and five segments. The pre-existing 4090..4102 sweep is
ASCII-only and cannot reach a surrogate pair straddling a segment boundary,
which is the subtlest failure mode in the new design.

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
   the GPU and a table-size and cache-footprint win for the CPU. This became
   more valuable with the linear-time kernel, whose cost is `n * stateCount` by
   construction on every input rather than only on long tokens. It also relieves
   the workgroup-storage ceiling, since `pass_x` holds `stateCount * classCount`
   entries in shared memory plus four rotating per-state columns - a ceiling
   that the kernel change tightened.
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

**The quadratic stage has been replaced. This item is done.**

`pass_a` computed `next(p)` at every offset, and `next(p)` cost O(length of the
token starting at p) - effectively O(n) on normal source, O(n²) on a single long
token. It is deleted, and replaced by three dispatches:

- `pass_x`, a **backward per-segment DFA-state sweep**: one workgroup per
  4096-unit segment, one thread per DFA state, sweeping backward. It emits both
  the per-offset result and the segment's composed element. Only four rotating
  state columns live in workgroup storage, so its footprint is independent of
  segment size.
- `pass_y`, a suffix scan composing segment elements.
- `pass_z`, which combines the two into `next(p)`.

`next(p)` is restored as a pure function of position, so `pass_b` through
`pass_f` are untouched. Still one command encoder, one `queue.submit()`, one
`mapAsync()` - nine dispatches instead of seven.

Measured on input that is one `funcfuck` whitespace token, with parity asserted
at every row:

| size    | before                 | after                                  |
| ------- | ---------------------- | -------------------------------------- |
| 512 KiB | 45.4x slower           | 12.75 ms vs 8.34 ms cpu                |
| 1 MiB   | 85.0x slower           | 13.30 ms vs 16.21 ms cpu               |
| 2 MiB   | 169.4x slower (5.43 s) | 14.56 ms vs 32.99 ms cpu - 2.3x faster |
| 16 MiB  | not runnable           | 36.81 ms vs 256.51 ms cpu - 7x faster  |

The linearity check is the cost-per-MiB column of the added stages: it settles
at roughly 0.6 ms/MiB and stays there. The removed stage's equivalent column
doubled row over row - 369, 699, 1368, 2708 ms/MiB at 0.25/0.5/1/2 MiB.

This removed a hazard, not merely a cost. A 5.4-second un-interruptible dispatch
is a GPU-hang and TDR risk; the largest `pass_x` dispatch at 16 MiB is 10.8 ms.

The price is real and is recorded in the throughput table above: peak speedup at
16 MiB fell from 3.07x to 2.49-2.73x on `funcfuck` and from 2.60x to 2.05x on
`thunkwasm`, and `thunkwasm` at 1 MiB now loses to the CPU (0.94x) where it
previously won (1.08x). The crossover did not move.

Two options were evaluated and rejected, both with measurements:

- **Capped scan with state-carrying continuations.** Associativity holds, but
  pointer doubling indexes by position while the monoid's domain is
  `position x state`, so `J[J[p]]` splices the wrong run. Repairing it needs one
  slot per `(position, state)`: 10.8 GB at 16 MiB with S=81.
- **Cap and decline.** A static token-length bound is computable and cheap, but
  reports UNBOUNDED for all four shipped grammars - every one has a
  Kleene-starred token class. And no cap value works: the break-even against the
  linear design is L ~= 250, while the parity corpus contains 9000-unit tokens.

Still in scope for this phase: replace `pass_c`'s serial chunk walk (1.613 ms at
16 MiB) **and now also `pass_y`'s** (2.659 ms) with two-level scans; a
storage-buffer fallback for DFA tables that exceed workgroup storage; an
output-sizing policy driven by a running tokens-per-code-unit estimate plus the
existing overflow flag rather than always allocating the worst case; and
`pass_x`'s ~0.8 ms latency floor, which only matters if Phase 0 finds a ~1 ms
sync floor.

**Gate, non-negotiable:** byte-exact parity against `lex_all` across all
fixtures, in the same spirit as the TypeScript/Wasm parity convention in
`AGENTS.md`. Record count plus every field of every record. Including the
long-single-token corpus, which must also stop being asymptotically worse than
the CPU.

Status of this gate: **met** for the kernel change. All four grammars pass
byte-exact (119/94/94/88 cases, exit 0), including the grid-stride and
floor-device reruns and the failure-mode guards, and the long-single-token
corpus asserts parity at every size while measuring linear cost. The gate is not
yet wired into `deno task test`; see Phase 4.

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
107.78-208.03 ms across 7 runs under the old kernel, and kernel totals ranged
6.15-37.66 ms. The current kernel is no better: two full runs over identical
bytes put `pass_x` at 12.836 ms and 16.622 ms, a 29% swing, carrying total wall
time from 132.16 ms to 133.87 ms and the headline speedup from 2.73x to 2.49x. A
third measurement of the same stage in a sweep landed at 8.29 ms. The GPU
concurrently drives the desktop; no clock pinning or GPU isolation was applied.
Any performance gate must be stated with dispersion, not as a single median, and
any single-number speedup claim in this document should be read as +/- 15%.

**Memory footprint is roughly 10x the source.** At 16 MiB: 33.5 MB source, three
67 MB per-position arrays, up to 268 MB of records, and a same-sized staging
buffer.

**Parity gaps the proof of concept could not close.** Guard-carrying grammars
are refused rather than supported (Phase 3). The throughput corpus is
short-token-only for `funcfuck` and strictly periodic for `thunkwasm`, so both
generators exercise the kernel's fast case; the long-single-token case is now
measured separately and is no longer a worst case, but the two corpora still do
not represent real source.

The long-single-token quadratic case is **fixed** (Phase 2) and is no longer a
parity or performance gap.

**The workgroup-storage envelope narrowed.** `pass_x` needs
`(128 + S + S*C) * 4 + 32*S` bytes against `pass_a`'s `(128 + S + S*C) * 4`. All
four shipped grammars still fit the WebGPU-guaranteed 16384 B floor (`funcfuck`
is the largest at 13796 B), but on a floor device the largest supportable DFA at
32 alphabet classes drops from about 120 states to about 96. That is a narrowing
of an already-narrow window rather than a new class of failure - the backend
already refuses a 241-state grammar on a floor device - but it raises the stakes
on Phase 1 minimization.

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
