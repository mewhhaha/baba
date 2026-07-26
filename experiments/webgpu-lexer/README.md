# WebGPU lexer backend (proof of concept)

> **The code described below has moved.** The production backend is now
> `src/runtime/webgpu/`, the parity gate is `tests/webgpu_lexer_parity_test.ts`,
> and the benchmarks are `scripts/webgpu_lexer_bench.ts` and
> `scripts/webgpu_lexer_pathological.ts`. This README and the three
> `results*.json` files beside it are retained unchanged as the evidence
> `docs/adr/0001-webgpu-lexer-backend.md` cites; file paths and commands below
> describe the proof of concept as it was measured.

A WebGPU compute implementation of Baba's `lex_all`, producing **byte-exact
parity** with the shipping Rust/Wasm lexer.

It is a **runtime backend, not a build target**. It reads an existing
`examples/<name>/generated/wasm/parser.plan` and swaps only the execution
strategy. Nothing has to be regenerated, no plan format changes, no grammar
changes.

Everything here is additive and lives entirely under
`experiments/webgpu-lexer/`.

> **Decision record:**
> [`docs/adr/0001-webgpu-lexer-backend.md`](../../docs/adr/0001-webgpu-lexer-backend.md)
> records the architectural decision this experiment supports (runtime backend
> rather than generate target), why the parser stays on the CPU, the phased plan
> with its gates, and the open questions. This README is the evidence; the ADR
> is the decision. Numbers quoted in the ADR come from this directory.
>
> **The ADR is out of date with respect to this README.** Its Phase 2 says the
> central stage "is asymptotically wrong and must be replaced" and quotes the
> old quadratic numbers. That replacement has since landed here
> (`pass_x`/`pass_y`/`pass_z`); the ADR has not been revised to match, and doing
> so is a separate change.

---

## How to run

```bash
# parity gate (exits non-zero on any mismatch or failed guard)
deno run --unstable-webgpu --allow-read experiments/webgpu-lexer/parity.ts
deno run --unstable-webgpu --allow-read experiments/webgpu-lexer/parity.ts --grammar thunkwasm
deno run --unstable-webgpu --allow-read experiments/webgpu-lexer/parity.ts --grammar brainfuck
deno run --unstable-webgpu --allow-read experiments/webgpu-lexer/parity.ts --grammar feature-tour

# benchmark (writes results.json; --json PATH to write elsewhere)
deno run --unstable-webgpu --allow-read --allow-write experiments/webgpu-lexer/bench.ts --runs 7

# the former worst case (one enormous token), now linear
deno run --unstable-webgpu --allow-read experiments/webgpu-lexer/pathological.ts
```

## Files

| file                                                               | what it is                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan_tables.ts`                                                   | Decodes the lexer DFA out of a combined `parser.plan`. Re-declares the module-private header constants and compact-offset decoders from `src/runtime/wasm_plan.ts`, pinned by calling `inspectCombinedWasmParserPlan` first (it throws on magic/version mismatch). Range-checks every CSR row and transition target. |
| `alphabet.ts`                                                      | Builds alphabet equivalence classes from the sparse CSR ranges and emits a dense `(states x classes)` i32 table plus the codepoint -> class lookup. Prototypes a compiler stage that would eventually live in `src/compiler/regex/dfa.ts`.                                                                           |
| `kernel.wgsl.ts`                                                   | The WGSL compute kernels, generated with `stateCount` / `classCount` / `chunkSize` baked in.                                                                                                                                                                                                                         |
| `gpu_lexer.ts`                                                     | Device/buffer/pipeline management, device-limit preflight, error scopes. One `queue.submit()` and one `mapAsync()` per lex.                                                                                                                                                                                          |
| `cpu_reference.ts`                                                 | Ground truth: raw `lex_all` through the Wasm ABI.                                                                                                                                                                                                                                                                    |
| `corpus.ts`                                                        | Input generators (periodic for throughput, randomized for parity), the adversarial case list, and the `pass_x` segment-boundary case list.                                                                                                                                                                           |
| `parity.ts`                                                        | The gate. Raw 4 x i32 vs raw 4 x i32, plus grid-stride reruns, a floor-device simulation, and failure-mode guards.                                                                                                                                                                                                   |
| `bench.ts`                                                         | CPU vs GPU across 16 KiB .. 16 MiB, three GPU configurations, with dispersion. Re-verifies parity at every size.                                                                                                                                                                                                     |
| `pathological.ts`                                                  | The input class that used to be quadratic (one enormous token). Now a linearity check: it prints cost per MiB and asserts parity at every size.                                                                                                                                                                      |
| `results.json`, `results_crossover.json`, `results_thunkwasm.json` | Machine-readable output of the three benchmark runs quoted below, including every raw per-run sample.                                                                                                                                                                                                                |

---

## What it proves

**Lexing with longest-match-and-restart is not inherently sequential, and the
existing plan format already contains everything a GPU backend needs.**

The load-bearing observation is that the entire outer-loop state of `lex_all` is
a single integer, `offset`. `state`, `best_spec`, `best_end` and `best_state`
are all reset at the top of every token. So

```
next(p) = the offset lex_all would move to if it started a token at p
```

is a **total function of `p` alone**, and so is the whole record emitted at `p`.
The token stream is exactly the orbit `0 -> next(0) -> next(next(0)) -> ...`.

That orbit is what `pass_b`..`pass_f` consume, and it is why they can be pure
pointer doubling. The hard part is producing `next(p)` for every `p` in bounded
time, and it took two attempts.

**Attempt 1 (removed).** `pass_a` scanned forward from every offset until the
token there ended. Cost per offset is O(length of that scan), which is ~2.5 code
units on ordinary source and O(n) on input that is one enormous token — so the
pass was O(n²), and measurably so: 169x slower than `lex_all` at 2 MiB of a
single whitespace token, inside one un-interruptible 5.4 s dispatch.

**Attempt 2 (current).** The brief's original suggestion — compose per-chunk
`(finalState, lastAcceptOffset, lastAcceptState)` summaries, one per candidate
DFA start state — turns out to be right, with one correction: chunk-_aligned_
summaries alone say nothing about a run that _starts_ mid-chunk, and rescanning
from `p` to the chunk end would cost O(chunkSize) per offset, which is worse
than the bug. The fix is to run the per-segment sweep **backwards** and emit the
per-offset row as a by-product:

```
E_p[q] = (exitState, lastAccept) of the run that enters offset p in state q
         and stops at the segment end (or earlier, at death)
```

Only columns `p+1` and `p+2` are ever needed, so four rotating columns live in
LDS and nothing else does. `E_p[0]` is exactly what `next(p)` needs up to the
segment end, and `E_segStart[*]` _is_ the segment's composable element, free.
Cost is `n*S` transitions and is completely independent of token length.

Why a capped forward scan cannot be patched into the old `pass_a`: associativity
is not the problem (function composition plus "last accept wins" is associative
once DEAD is absorbing), the **index set** is. `pass_b` doubles pointers,
`J[p] := J[J[p]]`, which only means anything when the array is indexed by the
same set its values live in. A capped scan's continuation lives in
`position x state`: the entry at `p+L` continues the run that _started_ at `p+L`
in state 0, while the run started at `p` needs the continuation from `p+L` in
whatever state _it_ reached. Storing one slot per `(position, state)` would need
`8*n*S` bytes — 10.8 GB at 16 MiB with funcfuck's 81 states — plus a
`2*chunkSize*S` u32 LDS array in `pass_b`. `pass_x` stores the same information
at _segment_ granularity instead: `(n/4096)*S`, which is 3.98 MB at 16 MiB.

### Pipeline

All nine dispatches live inside **one** command encoder, followed by the
`copyBufferToBuffer`s and one `mapAsync`. There is no CPU in the loop, no
intermediate readback, no fixup round-trip.

| stage               | parallelism                                                   | what it does                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pass_x`            | one workgroup per 4096-unit segment, one thread per DFA state | Backward suffix sweep. Emits `E_p[0]` for every `p` (into `nextPos`/`packedRec` as scratch) and the segment element `M_k` for every state. `n*S` transitions, independent of token length. |
| `pass_y`            | one workgroup, one thread per DFA state                       | Suffix scan over segment elements, `F_k = M_k . F_{k+1}`, written back in place. Serial in `k`; the running element sits in LDS so the dependent chain is an LDS read, not a global one.   |
| `pass_z`            | one thread per UTF-16 offset                                  | `next(p) = compose(E_p[0], F_{k+1})`, plus the packed `(specIndex, acceptingState)`. Overwrites the scratch in place, so no per-offset storage is added.                                   |
| `pass_b`            | one workgroup per chunk                                       | Guarded pointer doubling in LDS: `exit(p)` = first orbit position `>= chunkEnd`, for every `p`. `log2(chunkSize)` rounds, entirely in shared memory.                                       |
| `pass_c`            | one thread, serial over chunks                                | `entry(k)` = the true orbit position at which chunk `k` is entered. Only `numChunks` dependent loads (4096 at 16 MiB).                                                                     |
| `pass_d`            | one thread per chunk                                          | Walk `entry(k) .. chunkEnd`, count tokens.                                                                                                                                                 |
| `pass_e1`/`pass_e2` | two-level workgroup scan                                      | Exclusive prefix sum over the per-chunk counts; writes the total count and the overflow flag.                                                                                              |
| `pass_f`            | one thread per chunk                                          | Walk again, write the 4 x i32 records at the scanned offset.                                                                                                                               |

`pass_b`'s guarded doubling invariant: after round `r`,
`ja[i] = min(position after 2^r orbit steps, first position >= limit)`. Every
orbit step advances at least one code unit, so `log2(chunkSize)` rounds are
sufficient. `pass_c` handles the case where a single token jumps clean over one
or more chunks (`entry(k) = NO_ENTRY`, chunk emits nothing).

`pass_x`'s segments must never split a surrogate pair, or a run would leave a
segment one unit past its end and the "state at segment end" handoff would not
line up with the next segment's summary. `seg_start(k)` therefore moves a
boundary one unit right when it would land between a high and a low surrogate.
It reads two code units, so every workgroup derives the same boundaries without
communicating, and the offset that moves is still swept exactly once, by the
segment on its left. `parity.ts` injects an astral character at every offset
from `SEG_SIZE-6` to `SEG_SIZE+6` specifically to exercise this.

`pass_x`, `pass_z`, `pass_b`, `pass_d` and `pass_f` are all **grid-stride
loops**, so no dispatch can exceed `maxComputeWorkgroupsPerDimension` regardless
of input size. Because a device reporting 65535 is never actually driven to that
grid by a runnable input, `parity.ts` re-runs the entire corpus with the grid
artificially squeezed to 1, 3 and 7 workgroups, which forces the stride path.

### Bind group

**7 storage bindings + 1 uniform**, in a single bind group: bindings 1–2 are
`read-only-storage` (`src`, `tables`), bindings 3–7 are `storage` (`nextPos`,
`packedRec`, `exitPos`, `aux`, `records`). Read-only storage counts toward
`maxStorageBuffersPerShaderStage`, whose guaranteed floor is 8 — so the kernel
fits with **one** spare binding, not two. (An earlier version of this document
said "6 storage + 1 uniform … fits even the default of 8"; the count was wrong
and the margin is half what was claimed.) `WebGpuLexer.create` checks that limit
and throws if it is not met. Per-chunk entries, per-chunk counts, block sums and
block offsets are all packed into the single `aux` buffer, with offsets passed
in the uniform, precisely to stay under that ceiling.

### Chunk size is chosen per device

`pass_b` needs `2 * chunkSize` u32 of workgroup storage — 32 KiB at the
preferred 4096-unit chunk. **The WebGPU-guaranteed
`maxComputeWorkgroupStorageSize` is 16384 B**, so a hard-coded 4096-unit chunk
is 2x over the portable floor. `chooseChunkLog2` picks the largest chunk whose
LDS fits the limit the device actually granted (4096 here, 2048 on a floor
device), and `buildKernelSource` checks each entry point's requirement against
that same limit rather than against a constant tuned on one adapter.

This cannot be discovered empirically on this stack: **wgpu does not validate
workgroup storage at `createComputePipeline` at all** — an `array<u32, 65536>`
(256 KiB, 16x the floor) is accepted on a device reporting 16384 B. Dawn/Chrome
does enforce it, so on a conformant floor device the old kernel's `pass_b`
pipeline would simply have been invalid. The floor path is therefore covered by
simulation: `parity.ts` builds a second lexer with
`simulateWorkgroupStorageLimit: 16384`, asserts it drops to a 2048-unit chunk,
and re-runs the corpus through it.

**`pass_x`'s segment size is not chunk size and does not shrink.** `pass_x`
keeps only four rotating state columns in LDS — `8 * stateCount` u32, and
nothing proportional to the segment — so `SEG_SIZE` is a fixed 4096 on every
device. What `pass_x` does spend LDS on is the DFA tables plus those columns:

```
passXWorkgroupBytes = (128 + stateCount + stateCount*classCount) * 4 + 32 * stateCount
```

| grammar      | states, classes | `pass_a` needed | `pass_x` needs | 16384 B floor |
| ------------ | --------------- | --------------- | -------------- | ------------- |
| funcfuck     | 81, 32          | 11 204 B        | **13 796 B**   | fits          |
| thunkwasm    | 65, 32          | 9 092 B         | **11 172 B**   | fits          |
| feature-tour | 32, 27          | 4 096 B         | **5 120 B**    | fits          |
| brainfuck    | 16, 13          | 1 408 B         | **1 920 B**    | fits          |

All four still fit the portable floor, but **the envelope did narrow**: the
constraint went from `stateCount * (4*classCount + 4) <= 15872` to
`stateCount * (4*classCount + 36) <= 15872`, so at 32 classes the largest
floor-device DFA drops from 120 states to 96. `buildKernelSource` computes this
per entry point against the granted limit and throws rather than emitting a
kernel the device cannot run.

`pass_x` also declares `@workgroup_size(ceil(stateCount/32)*32)`, capped at 256,
which is grammar-dependent rather than a constant. `WebGpuLexer.create` checks
it against `maxComputeInvocationsPerWorkgroup` explicitly. Above 256 states each
thread carries several states, so a large DFA gets slower rather than refused.

### Alphabet classifier

`alphabet.ts` partitions `0 .. 0x10FFFF` at every CSR transition boundary,
identifies segments by their full target vector across all states, and merges
identical ones. Output:

- a direct-mapped `i32[128]` table for ASCII, and
- a sorted, **gap-free** `(start, end, class)` range list for
  `U+0080..U+10FFFF`, searched with a binary search.

Real source is overwhelmingly ASCII, so the hot path is a single indexed load
out of shared memory with no branching and no subgroup divergence. The range
list is not decoration: `feature-tour` has a class that exists _only_ above
ASCII (`U+2028..U+2029`, carved out by `.` in its `STRING` regex), and
`brainfuck` / `feature-tour` have negated character classes whose catch-all
class is **live** rather than dead. `verifyAlphabetAgainstSparse` cross-checks
the dense table against the plan's own CSR rows on every run, and parity refuses
to proceed on any mismatch.

Measured, per grammar:

| grammar      | DFA states | classes | above-ASCII ranges | dense cells | CSR cross-check            |
| ------------ | ---------- | ------- | ------------------ | ----------- | -------------------------- |
| funcfuck     | 81         | 32      | 1                  | 2592        | 11016 probes, 0 mismatches |
| thunkwasm    | 65         | 32      | 1                  | 2080        | 8840 probes, 0 mismatches  |
| brainfuck    | 16         | 13      | 1                  | 208         | 2176 probes, 0 mismatches  |
| feature-tour | 32         | 27      | 3                  | 864         | 4480 probes, 0 mismatches  |

---

## Parity results (real)

Comparison is **raw vs raw**: the GPU's 4 x i32 records against `lex_all`'s 4 x
i32 records, `{specIndex, start, end, acceptingState}`, count and every field.
`parser.lex()` is not used because it exposes neither `specIndex` nor
`acceptingState`.

```
grammar=funcfuck states=81 specs=29 guardFree=true
alphabet: classes=32 aboveAsciiRanges=1 denseCells=2592 sparseCrossCheck=11016 mismatches=0
wasm abi_version=7 gpuTimestamps=true
device limits: maxStorageBufferBindingSize=2147483644 maxBufferSize=1099511627776 maxComputeWorkgroupStorageSize=49152 chunkSize=4096
max input at worst-case capacity: 134217727 UTF-16 units
floor-device simulation (maxComputeWorkgroupStorageSize=16384): chunkSize=2048

parity: 119 passed, 0 failed, 119 total
grid-stride reruns (gridCap 1/3/7, inputs <= 64 KiB): 348 passed
floor-device reruns (chunkSize=2048, inputs <= 64 KiB): 116 passed, 0 failed
guards: 7 passed, 0 failed
exit=0
```

The other three grammars, same shape, all `exit=0`:

| grammar      | parity  | grid-stride reruns | floor-device reruns  | guards |
| ------------ | ------- | ------------------ | -------------------- | ------ |
| funcfuck     | 119/119 | 348 passed         | 116 passed, 0 failed | 7/7    |
| thunkwasm    | 94/94   | 279 passed         | 93 passed, 0 failed  | 7/7    |
| brainfuck    | 94/94   | 279 passed         | 93 passed, 0 failed  | 7/7    |
| feature-tour | 88/88   | 261 passed         | 87 passed, 0 failed  | 7/7    |

**All four shipped example grammars pass on every input class. No input class is
excluded and none is known to fail.**

Covered:

- empty string, and every prefix of `"def foo = add(1);"` of length 1..8;
- every shipped example program, plus each one repeated to 64 KiB;
- error tokens (`specIndex = -1`), including runs of 9000 consecutive bad
  characters;
- surrogates: lone high, lone low, high-followed-by-non-low, correctly paired, a
  pair at EOF, and a high surrogate as the final code unit;
- above-ASCII BMP (`é`, `あ`) and `U+2028` / `U+2029`;
- longest-match backtracking (`"12a"`, `"add"` vs `"addx"`,
  `"de def defi definitely d"`);
- unterminated constructs (bracket, paren, string, string-ending-in-backslash,
  comment with no newline) and input ending mid-token;
- long runs of a single token: 9000-char whitespace / identifier / integer /
  comment / string runs;
- chunk-boundary stress: input of exactly 4096 and 4097 units, a token spanning
  a whole chunk, and 13 variants that inject `@` + an astral character at every
  offset from 4090 to 4102;
- **`pass_x` segment-boundary stress** (`segmentBoundaryInputs`, 36 cases),
  which is a second grid nothing else covers:
  - a surrogate pair straddling the boundary — an astral character placed at
    every offset from `SEG_SIZE-6` to `SEG_SIZE+6`, in two shapes (after an
    identifier run and after a whitespace run followed by a 9000-unit token).
    The pre-existing 4090..4102 sweep is ASCII-only and cannot reach this;
  - a token whose accept lands **exactly on** a segment boundary — identifier,
    whitespace and integer runs of exactly `SEG_SIZE` units, one that dies
    immediately after the boundary, and the `SEG_SIZE-1` / `SEG_SIZE+1`
    neighbours;
  - a live run spanning **three or more** segments: whitespace over 3 segments,
    an identifier over 5, an unterminated run to EOF over 3, and 2 segments of
    astral characters. `token-spanning-chunk` only spans two, which is the one
    case `pass_y`'s composition can get right by accident;
- 12 randomized funcfuck sources (varied whitespace runs, identifier lengths,
  integer widths) plus randomized 1 MiB and 4 MiB inputs;
- **every case above re-run with the workgroup grid squeezed to 1, 3 and 7**, so
  the grid-stride path in `pass_x`/`pass_z`/`pass_b`/`pass_d`/`pass_f` is
  exercised rather than assumed;
- **every case above re-run at `chunkSize = 2048`**, the chunk size a spec-floor
  device forces;
- `bench.ts` additionally re-verifies full record equality at every benchmark
  size up to 16 MiB.

The parity corpus deliberately uses a **randomized** generator rather than the
repeated example programs. Repetition has a short period, so with 4096-unit
chunks only a handful of distinct `(chunk offset mod period)` contexts ever
occur and a chunk-boundary bug could hide. The periodic generator is used for
throughput only.

### Failure-mode guards

Parity alone is not enough, because the interesting failures are the ones where
the backend returns _something_ instead of erroring. WebGPU does not throw on a
limit violation: it fires `uncapturederror`, drops the whole command buffer, and
leaves `mapAsync` resolving over the **previous** submit's staging bytes. So
`parity.ts` also asserts refusal. All seven guards pass:

| guard                                  | what it asserts                                                                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxInputUnits-is-finite-and-positive` | The backend can state its own input cap.                                                                                                                    |
| `over-limit-input-throws`              | An input past the records-binding wall raises `GpuLexerCapacityError` **before** anything is allocated — it does not return `tokenCount=0, overflow=false`. |
| `not-poisoned-after-refusal`           | A refused call leaves the instance fully usable; the next small lex still matches the CPU.                                                                  |
| `undersized-capacity-sets-overflow`    | An undersized output buffer reports `overflow === true`, never a silently truncated record set.                                                             |
| `floor-device-picks-smaller-chunk`     | A 16384 B workgroup-storage limit drops the chunk to 2048.                                                                                                  |
| `floor-device-parity`                  | The floor-device kernel still matches the CPU on the whole corpus.                                                                                          |
| `lex-after-destroy-throws`             | `lex()` after `destroy()` throws instead of reusing a cached bind group over destroyed buffers.                                                             |

Beyond the guards, every `lex()` wraps its allocate/encode/submit/map path in
`pushErrorScope("validation")` + `pushErrorScope("out-of-memory")` and pops both
after the sync — which costs no extra round trip, because the sync has already
happened. Any fault throws with the underlying message and invalidates the
cached bind group instead of returning stale bytes. Device loss is watched via
`device.lost` and checked before and after every submit. An impossible token
count (more tokens than code units) is also rejected.

---

## Benchmark results (real)

Machine: NVIDIA GeForce RTX 4080 SUPER, Deno 2.9.4, Linux. Grammar: funcfuck.
Input: randomized funcfuck source, seed 20250726. Medians of 7 runs after 2
warmup runs, printed as `median [min..max]` over the same samples. Sizes are
UTF-16 code units (ASCII, so 1 char = 1 byte of source = 2 bytes on the wire).
Raw per-run samples are in `results.json`.

### Three GPU configurations, because "the GPU number" is a choice

| #   | capacity                                     | records                                     | achievable?                                                                                    |
| --- | -------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| (1) | one token per code unit — can never overflow | copied into an owned `Int32Array`           | yes; this is what `parity.ts` runs                                                             |
| (2) | same                                         | borrowed view into the mapped staging range | yes, for a backend that consumes immediately                                                   |
| (3) | the **exact** token count                    | borrowed                                    | **no** — the count comes from lexing the same input first. This is an oracle, not an estimate. |

**Configuration (1) is the headline.** An earlier version of this document used
(3) for the speedup column, the MiB/s column and the crossover verdict, which
flattered all three.

```
grammar=funcfuck states=81 classes=32
runs=7 warmup=2 timestamps=true chunkSize=4096
device limits: maxStorageBufferBindingSize=2147483644 maxBufferSize=1099511627776 maxComputeWorkgroupStorageSize=49152 maxComputeWorkgroupsPerDimension=65535
max input at worst-case capacity: 134217727 UTF-16 units

one-time setup (NOT amortized into any number below, and NOT repaid at the crossover):
  cpu  CpuReferenceLexer.create (WebAssembly.Module + load_plan) = 0.343 ms
  gpu  requestAdapter=112.710 ms  requestDevice=134.794 ms  decodePlan=1.147 ms  buildAlphabet=0.818 ms  packTables=0.262 ms
  gpu  buildKernelSource=0.295 ms  createShaderModule=2.797 ms  createPipelines=2.526 ms  createBuffers=0.157 ms
  gpu  TOTAL = 255.837 ms (746.1x the CPU engine's setup)

corpus: randomized funcfuck (short tokens only, seed 20250726)

  16 KiB  tokens=     6505  cpu lex_all=       0.33 [0.33..0.34] ms (  46.92 MiB/s)  gpu total=    12.84 [12.81..13.29] ms (    1.22 MiB/s)  speedup=0.03x
  32 KiB  tokens=    12826  cpu lex_all=       0.78 [0.63..1.19] ms (  39.85 MiB/s)  gpu total=    13.07 [12.93..13.51] ms (    2.39 MiB/s)  speedup=0.06x
  64 KiB  tokens=    25764  cpu lex_all=       1.56 [1.39..2.44] ms (  40.12 MiB/s)  gpu total=    13.16 [13.02..13.65] ms (    4.75 MiB/s)  speedup=0.12x
 128 KiB  tokens=    51671  cpu lex_all=       2.61 [2.54..3.24] ms (  47.94 MiB/s)  gpu total=    13.71 [13.50..14.95] ms (    9.12 MiB/s)  speedup=0.19x
 256 KiB  tokens=   103243  cpu lex_all=       6.29 [5.29..8.27] ms (  39.73 MiB/s)  gpu total=    14.06 [13.82..15.12] ms (   17.78 MiB/s)  speedup=0.45x
 512 KiB  tokens=   206362  cpu lex_all=    10.84 [10.40..12.07] ms (  46.14 MiB/s)  gpu total=    14.88 [14.48..31.70] ms (   33.59 MiB/s)  speedup=0.73x
   1 MiB  tokens=   413140  cpu lex_all=    21.75 [20.83..23.47] ms (  45.97 MiB/s)  gpu total=    20.12 [16.31..21.63] ms (   49.69 MiB/s)  speedup=1.08x
   4 MiB  tokens=  1651674  cpu lex_all=    88.51 [84.92..95.07] ms (  45.19 MiB/s)  gpu total=    32.92 [25.27..40.39] ms (  121.52 MiB/s)  speedup=2.69x
  16 MiB  tokens=  6605769  cpu lex_all= 361.36 [349.70..386.69] ms (  44.28 MiB/s)  gpu total= 132.16 [120.86..143.86] ms (  121.06 MiB/s)  speedup=2.73x

median [min..max] over the same samples. GPU column above is configuration (1): worst-case capacity, owned records.

the other two GPU configurations, and what each gap costs:
    size   (1) worst/owned   (2) worst/borrowed   (3) oracle/borrowed   owned copy    sizing  (1) speedup  (3) speedup
  16 KiB             12.84                12.80                 12.84         0.04     -0.04        0.03x        0.03x
  32 KiB             13.07                13.05                 12.98         0.02      0.07        0.06x        0.06x
  64 KiB             13.16                13.21                 13.37        -0.05     -0.16        0.12x        0.12x
 128 KiB             13.71                13.43                 13.46         0.28     -0.03        0.19x        0.19x
 256 KiB             14.06                14.20                 14.06        -0.14      0.15        0.45x        0.45x
 512 KiB             14.88                14.31                 14.27         0.57      0.04        0.73x        0.76x
   1 MiB             20.12                17.43                 16.11         2.70      1.31        1.08x        1.35x
   4 MiB             32.92                22.93                 27.29         9.98     -4.36        2.69x        3.24x
  16 MiB            132.16                89.83                 85.17        42.33      4.66        2.73x        4.24x

GPU submit+sync and kernel time (ms, median [min..max], configuration (1)):
  16 KiB  submit+sync=    12.55 [12.54..13.01] ms  kernels=       1.24 [1.24..1.68] ms
  32 KiB  submit+sync=    12.74 [12.68..13.03] ms  kernels=       1.37 [1.37..1.68] ms
  64 KiB  submit+sync=    12.82 [12.77..13.32] ms  kernels=       1.41 [1.40..1.44] ms
 128 KiB  submit+sync=    13.18 [12.93..13.95] ms  kernels=       1.58 [1.54..2.54] ms
 256 KiB  submit+sync=    13.31 [13.24..13.93] ms  kernels=       1.73 [1.73..2.36] ms
 512 KiB  submit+sync=    14.03 [13.60..30.94] ms  kernels=       1.92 [1.91..2.53] ms
   1 MiB  submit+sync=    15.23 [14.80..19.51] ms  kernels=       2.85 [2.68..3.42] ms
   4 MiB  submit+sync=    19.68 [19.07..20.82] ms  kernels=       4.66 [4.11..6.26] ms
  16 MiB  submit+sync=    46.05 [38.98..54.30] ms  kernels=    21.21 [15.24..28.59] ms

per-stage GPU time (ms, median, configuration (1)):
    size         pass_x_sweep       pass_y_segscan      pass_z_finalize        pass_b_double       pass_c_entries        pass_d_counts    pass_e1_blockscan pass_e2_blockoffsets          pass_f_emit
  16 KiB                0.815                0.003                0.002                0.020                0.003                0.168                0.002                0.002                0.222
  32 KiB                0.854                0.004                0.002                0.022                0.003                0.208                0.003                0.002                0.274
  64 KiB                0.851                0.006                0.003                0.021                0.005                0.225                0.003                0.002                0.287
 128 KiB                0.854                0.011                0.003                0.021                0.007                0.233                0.003                0.002                0.415
 256 KiB                0.855                0.019                0.005                0.021                0.013                0.236                0.003                0.002                0.577
 512 KiB                0.872                0.036                0.007                0.024                0.024                0.244                0.003                0.002                0.710
   1 MiB                0.869                0.066                0.010                0.044                0.043                0.231                0.003                0.002                1.580
   4 MiB                2.168                0.322                0.033                0.117                0.175                0.241                0.003                0.003                1.480
  16 MiB               12.836                2.110                0.423                0.718                1.243                0.739                0.004                0.004                2.856

GPU wall-clock breakdown (ms, median, configuration (1)):
    size    upload    encode  submit+sync   mapRange   copyOut     total
  16 KiB     0.047     0.114       12.545      0.044     0.037    12.839
  32 KiB     0.049     0.127       12.737      0.077     0.064    13.072
  64 KiB     0.058     0.123       12.816      0.032     0.030    13.161
 128 KiB     0.069     0.122       13.176      0.271     0.229    13.713
 256 KiB     0.096     0.142       13.305      0.110     0.128    14.057
 512 KiB     0.123     0.145       14.027      0.266     0.307    14.884
   1 MiB     0.204     0.167       15.226      2.191     1.195    20.125
   4 MiB     0.569     0.156       19.679      2.260     9.163    32.916
  16 MiB     1.655     0.848       46.049     42.016    41.586   132.165

crossover (1) worst-case/owned, medians:                1 MiB
crossover (1) worst gpu sample vs best cpu sample:      4 MiB
crossover (3) oracle capacity, medians:                 1 MiB
The crossover is only ever reported as one of the sizes actually measured. Anything finer requires a --sizes sweep.
Setup is not repaid at any of these: the per-call saving at the crossover is ~0 ms against 256 ms of one-time GPU init.
```

### Crossover

The 9-size sweep can only resolve the crossover to "1 MiB", because that is the
first size it measures where the GPU wins. Two independent finer sweeps
(`--sizes 524288,655360,786432,917504,1048576,1310720 --runs 7`) both report 768
KiB. Sweep A (stored in `results_crossover.json`):

```
 512 KiB  cpu lex_all=    11.11 [10.34..12.59] ms  gpu total=    16.37 [14.27..16.93] ms  speedup=0.68x
 640 KiB  cpu lex_all=    13.34 [13.09..17.14] ms  gpu total=    17.33 [14.04..17.95] ms  speedup=0.77x
 768 KiB  cpu lex_all=    17.62 [16.27..18.50] ms  gpu total=    17.19 [15.05..19.53] ms  speedup=1.03x
 896 KiB  cpu lex_all=    19.69 [17.93..21.74] ms  gpu total=    16.53 [15.36..19.74] ms  speedup=1.19x
   1 MiB  cpu lex_all=    21.78 [20.99..25.07] ms  gpu total=    18.52 [16.59..20.34] ms  speedup=1.18x
1.25 MiB  cpu lex_all=    26.93 [26.71..31.50] ms  gpu total=    23.75 [19.61..25.32] ms  speedup=1.13x

crossover (1) worst-case/owned, medians:                768 KiB
crossover (1) worst gpu sample vs best cpu sample:      1 MiB
crossover (3) oracle capacity, medians:                 768 KiB
```

Sweep B:

```
 512 KiB  cpu lex_all=    10.99 [10.77..11.86] ms  gpu total=    16.34 [14.29..16.90] ms  speedup=0.67x
 640 KiB  cpu lex_all=    13.68 [13.26..15.15] ms  gpu total=    17.30 [14.71..17.68] ms  speedup=0.79x
 768 KiB  cpu lex_all=    16.47 [16.06..18.47] ms  gpu total=    16.11 [15.54..18.64] ms  speedup=1.02x
 896 KiB  cpu lex_all=    19.53 [19.27..22.74] ms  gpu total=    17.94 [16.14..20.14] ms  speedup=1.09x
   1 MiB  cpu lex_all=    22.39 [21.02..26.73] ms  gpu total=    16.71 [15.74..18.14] ms  speedup=1.34x
1.25 MiB  cpu lex_all=    27.63 [27.39..29.68] ms  gpu total=    23.72 [19.23..24.54] ms  speedup=1.16x

crossover (1) worst-case/owned, medians:                768 KiB
crossover (1) worst gpu sample vs best cpu sample:      1 MiB
crossover (3) oracle capacity, medians:                 768 KiB
```

**Crossover is 768 KiB of source** — the first measured size at which the GPU
wins, in both sweeps, in both configuration (1) and configuration (3). At 640
KiB the GPU lost in every measurement taken (0.77x and 0.79x). On the stricter
"worst GPU sample beats best CPU sample" test the crossover is 1 MiB.

The crossover is **unchanged** by the `pass_a` -> `pass_x`/`pass_y`/`pass_z`
replacement, which is not a coincidence: the new stages cost time proportional
to `n`, and at 768 KiB that is ~0.9 ms against a ~15 ms total dominated by the
fixed synchronization floor. The cost of making the kernel linear only becomes
visible at sizes where the GPU was already winning by 3x.

Below the crossover the ~12.5 ms fixed synchronization floor dominates and the
CPU wins outright.

Cross-check on a second grammar (thunkwasm, repeated example programs, 5 runs,
stored in `results_thunkwasm.json`):

```
corpus: repeated example programs (strictly periodic, 497-char period)

   1 MiB  tokens=   548555  cpu lex_all=    21.44 [20.58..24.23] ms  gpu total=    22.69 [18.06..23.51] ms  speedup=0.94x
  16 MiB  tokens=  8776813  cpu lex_all= 347.87 [345.35..353.61] ms  gpu total= 169.89 [161.81..180.33] ms  speedup=2.05x

per-stage GPU time (ms, median):
   1 MiB  pass_x=0.913  pass_y=0.069  pass_z=0.009  pass_b=0.046  pass_c=0.045  pass_d=0.309  pass_f=2.148
  16 MiB  pass_x=15.588 pass_y=3.082  pass_z=0.895  pass_b=0.950  pass_c=1.643  pass_d=1.723  pass_f=5.734
```

thunkwasm has **fewer** DFA states than funcfuck (65 vs 81) and yet its `pass_x`
is slower at 16 MiB (15.59 ms vs 12.84 ms). That is the one data-dependent cost
in an otherwise data-independent pass: every thread reads
`col[... + delta(q, c)]`, so the LDS bank pattern depends on how the current
character spreads the state set. It is not control flow — every thread still
executes exactly one classify, one table read and one column read/write per code
unit — but it is a real 20-40% swing that a state count alone does not predict.

### Reading these numbers honestly

- **One-time setup is ~256 ms and is never repaid.** `requestAdapter` (113 ms) +
  `requestDevice` (135 ms) + shader/pipeline/table construction (~6 ms), against
  0.34 ms for `WebAssembly.Module` + `load_plan`. That is ~746x. At the 768 KiB
  crossover the per-call saving is ~0 ms, so one document never pays for the
  backend. Even the 16 MiB case saves ~229 ms (361.36 − 132.16), i.e. roughly
  one device init. A GPU backend only makes sense for a long-lived process
  lexing many multi-MiB inputs.
- **The spread is large, and it is now printed rather than collapsed.** At 16
  MiB, configuration (1) ranged 120.86–143.86 ms across 7 runs and per-stage
  kernel totals ranged 15.24–28.59 ms for identical work. Across _runs_ it is
  worse still: `pass_x` at 16 MiB measured 12.84 ms in the run quoted above,
  8.29 ms in `pathological.ts`, and 19.13 ms in an earlier run of the same code
  taken while other benchmarks were competing for the device — a 2.3x band for
  identical work. A single "2.73x" with no error bar would be false precision.
  The GPU concurrently drives this desktop, clocks are not pinned, and no
  isolation was attempted. Read every quoted median at the largest sizes as
  carrying tens of percent of uncertainty.
- **The CPU baseline here is ~47 MiB/s, not the ~12 MiB/s quoted upstream.**
  That difference is real and matters: the 12 MiB/s figure was measured through
  `parser.lex()`, which also materializes the token tape and `Token` objects.
  This benchmark compares `lex_all` records against GPU records — the identical
  unit of work on both sides. Comparing against `parser.lex()` would have made
  the GPU look ~4x better for free and moved the apparent crossover down by
  roughly 4x.
- **Actual GPU compute is still a minority of wall time, but much less of one
  than before.** At 16 MiB the nine kernels total 21.2 ms out of 132.2 ms (16%),
  against 9.4 ms out of 110.2 ms (9%) for the old quadratic kernel. The rest is
  the ~12.5 ms Deno synchronization floor, the device->staging copy inside
  `submit+sync`, `mapRange` (42.0 ms) and the owned copy (41.6 ms).
- **`mapRange` does not behave like a fixed-rate memcpy, and this document no
  longer claims it does.** Its per-byte cost is discontinuous in the measured
  data: at 4 MiB, 2.260 ms for 26.4 MB is ~11.7 GB/s; at 16 MiB, 42.016 ms for
  105.7 MB is ~2.5 GB/s — the same call, ~4.7x apart per byte. The small-size
  regime is not explained by a copy model at all. What is established is only
  that the cost exists and that it is Deno-API behaviour; **no
  cross-implementation measurement was taken**, so "it would largely disappear
  in a browser or native wgpu host" is a hypothesis, not a result.
- **Output is bigger than input.** funcfuck emits ~0.39 tokens per code unit, so
  16 MiB of source produces 6.6 M records = 101 MiB of 4 x i32. The readback is
  dominated by the token tape, not by the source upload (1.7 ms).
- **`pass_x` is now the dominant kernel** (12.8 ms of 21.2 ms at 16 MiB) and it
  costs `n * stateCount` transitions by construction. That makes DFA
  minimization a direct throughput lever rather than a nicety. `pass_x` also has
  a **latency floor**: each workgroup walks its 4096-unit segment serially, so
  the pass costs ~0.85 ms at every size from 16 KiB to 1 MiB regardless of how
  little work there is. That is invisible under the ~12.5 ms sync floor today
  but it is the first thing that would matter if the sync floor were ~1 ms.
- **Two serial stages remain.** `pass_c` (1.2 ms at 16 MiB) walks 4096 dependent
  global loads in a single thread, and `pass_y` (2.1 ms) walks 4096 dependent
  LDS steps in a single workgroup. Both are suffix/prefix scans over the same
  4096 elements and both would fall to a two-level scan; neither was done here.
- **The benchmark input is synthetic, but it no longer flatters the kernel the
  way it used to.** Both generators emit only short tokens (mean ~2.5 code units
  for funcfuck; no comments, no string literals, no long tokens), and the
  `thunkwasm` cross-check is strictly periodic. Under the old `pass_a` that was
  precisely the shape that hid the quadratic case. `pass_x` costs the same per
  code unit whatever the token length, so the throughput corpus and the
  single-token corpus now cost within a small constant of each other — which is
  itself visible in `pathological.ts` below. The remaining corpus caveat is the
  data-dependent LDS bank pattern noted in the thunkwasm cross-check. The
  largest real Baba source file in this repo is 224 bytes and the largest
  whole-example corpus is 493 bytes — about three orders of magnitude below the
  crossover. **No real file in this repo is anywhere near the size where the GPU
  path wins.**

---

## What it does NOT do

### Hard scope limits

- **No contextual tokens / lookahead guards.** `spec_guard_matches` makes accept
  a function of _position_, not just DFA state, which destroys the
  `acceptSpecByState` collapse the kernel is built on. The backend **detects and
  refuses** rather than silently producing wrong output: `decodeLexerPlanTables`
  reports `guardFree`, and `WebGpuLexer.create` throws with the specific
  diagnostics if any spec has non-zero flags, a follow/not-follow start, an
  excluded-word row, or if `GUARD_STATE_COUNT != 0`. All four shipped example
  grammars are guard-free, so this is a deferred feature and not a silent
  hazard.
- **No terminal identity resolution.** The kernel emits `acceptingState` only.
  `select_action` resolves the terminal later from `(acceptingState, LR state)`.
  This is deliberate and is exactly what makes the backend a drop-in replacement
  for `lex_all` with zero semantic change.
- **No parsing.** Only `lex_all`. `parser.parse()` throws
  `RangeError: Wasm parser plan exceeds maximum memory pages` above roughly 750
  KiB (pre-existing, `src/runtime/generated_wasm.ts`), so it could not be used
  above the crossover even if it were in scope.
- **Not wired into `src/`.** Nothing here is imported by the shipping runtime.
  `parser.lex()` still goes through Wasm. This is a standalone experiment.

### Known limitations

- **Long single tokens used to be quadratic. They are not any more, and the fix
  is what most of this kernel now is.** `pass_a` computed `next(p)` at every
  offset with an unbounded forward scan, so a file that is one enormous token
  cost O(n²): 45.4x slower than `lex_all` at 512 KiB, 85.0x at 1 MiB, 169.4x at
  2 MiB (5.43 s in one un-interruptible dispatch), with 16 MiB never runnable at
  all. `pass_x` replaced it with a backward per-segment sweep whose cost is
  `n * stateCount` regardless of token length. Measured with funcfuck's
  `WS = /[ \t\r\n]+/` on a file of nothing but spaces (`pathological.ts`):

  ```
     chars  tokens  parity    cpu ms  pass_x ms  x+y+z ms  x+y+z/MiB  gpu total  gpu/cpu
     16384       1    true      0.27       0.77      0.78      49.90      12.41   45.78x
     32768       1    true      0.56       0.77      0.78      25.00      12.38   21.97x
     65536       1    true      1.39       0.77      0.78      12.53      12.45    8.98x
    131072       1    true      2.22       0.77      0.79       6.31      12.66    5.72x
    262144       1    true      5.05       0.77      0.80       3.21      13.78    2.73x
    524288       1    true      8.90       0.79      0.83       1.66      13.97    1.57x
   1048576       1    true     18.95       0.82      0.90       0.90      14.40    0.76x
   2097152       1    true     39.89       0.91      1.77       0.89      16.14    0.40x
   4194304       1    true     77.78       2.53      2.96       0.74      20.85    0.27x
   8388608       1    true    137.10       5.36      6.31       0.79      29.92    0.22x
  16777216       1    true    277.42      10.76     13.66       0.85      48.18    0.17x
  ```

  The `x+y+z/MiB` column is the linearity check: it settles at ~0.8 ms/MiB and
  stays within a small constant of that. The old kernel's equivalent column was
  369, 699, 1368, 2708 ms/MiB at 0.25/0.5/1/2 MiB — doubling every row, which is
  what O(n²) looks like in this column. At 16 MiB the GPU is now **5.8x faster**
  than `lex_all` on this input, where before it was ~1000x slower by
  extrapolation. The un-interruptible multi-second dispatch, and the GPU-hang
  risk that came with it, are gone: the largest `pass_x` dispatch measured at 16
  MiB of one token is 10.8 ms. Run-to-run spread on this table is real — three
  runs of these same bytes put 16 MiB `pass_x` at 8.29, 10.76 and 17.71 ms — so
  read the ratio as "single-digit multiple faster", not as 5.8x exactly.

  Two residual costs are honest to state. `pass_x` has a **~0.8 ms latency
  floor** at every size below ~1 MiB, because each workgroup walks its 4096-unit
  segment serially; it is hidden under the ~12.5 ms sync floor today. And on
  ordinary source the linear kernel is **more expensive than the quadratic one
  was**: at 16 MiB, `pass_x`+`pass_y`+`pass_z` cost 15.4 ms of kernel time where
  `pass_a` cost 1.1 ms, moving the 16 MiB speedup from 3.07x to 2.73x. The
  crossover does not move (768 KiB in both cases). That trade was taken
  deliberately: a bounded worst case is worth more than 0.3x at 16 MiB.

- **Cost is linear in DFA state count.** `pass_x` runs one thread per state for
  every code unit, so `n * stateCount` is the work, and a grammar with 3x the
  states costs ~3x the time in the dominant kernel. There is no minimization
  pass in the compiler today. This is a much stronger argument for Hopcroft than
  the old kernel gave.

- **Output buffer must be pre-sized.** Under the one-submit/one-sync rule the
  token count is not known until the pipeline finishes, so the capacity is a
  host-side decision. The default is the worst case (one token per code unit),
  which can never overflow, and it is what the headline numbers use. Overflow is
  _always detected_ (`aux[1]`, surfaced as `result.overflow`), parity fails
  loudly on it, and a guard asserts it — it is never silent.

- **Memory footprint is ~10x the source.** At 16 MiB the kernel allocates 33.5
  MB source + 3 x 67 MB per-position arrays + up to 268 MB records + a
  same-sized staging buffer.

- **Input size is capped by device limits, and the cap is now enforced rather
  than merely documented.** `WebGpuLexer.maxInputUnits(recordsPerUnit)` computes
  it, and `lex()` throws `GpuLexerCapacityError` before allocating anything. The
  binding order matters, and the previously documented cap was the wrong one:

  | wall                            | formula                                                           | this adapter      | spec-floor device   |
  | ------------------------------- | ----------------------------------------------------------------- | ----------------- | ------------------- |
  | `records` storage binding       | `n * 16 B` vs `maxStorageBufferBindingSize`                       | 134,217,727 units | **8,388,608 units** |
  | `staging` buffer                | `128 + n * 16 B` vs `maxBufferSize`                               | ~6.9e10 units     | 16,777,208 units    |
  | `nextPos`/`packedRec`/`exitPos` | `n * 4 B` vs `maxStorageBufferBindingSize`                        | 536,870,911 units | 33,554,432 units    |
  | `pass_e1` dispatch              | `ceil(n / chunkSize / 256)` vs `maxComputeWorkgroupsPerDimension` | ~6.9e10 units     | ~3.4e10 units       |

  This document previously claimed the cap came from
  `maxComputeWorkgroupsPerDimension` at ~268 M units. It does not: the `records`
  binding trips first, at half that figure on this adapter. **On a device
  reporting the WebGPU default `maxStorageBufferBindingSize` of 128 MiB, the 16
  MiB benchmark row is itself over the limit** (a 268 MB records binding); it is
  now refused with a structured error instead of silently returning zero tokens.
  `maxComputeWorkgroupsPerDimension` is no longer a wall at all for
  `pass_x`/`pass_z`/`pass_b`/`pass_d`/`pass_f`, which are grid-strided. `aux`
  now also carries the per-segment summaries (`stateCount * 12 / 4096` bytes per
  input unit, 3.98 MB at 16 MiB with funcfuck), which `maxInputUnits` accounts
  for; it is nowhere near the first wall at any realistic state count.

- **DFA tables must fit workgroup storage, and the envelope is now tighter.**
  `pass_x` holds `128 + stateCount + stateCount*classCount` i32 plus four
  rotating state columns (`8 * stateCount` u32) in shared memory, and
  `buildKernelSource` throws if that exceeds the limit the device actually
  granted. funcfuck needs 13.5 KiB, which still fits the 16 KiB floor, but the
  largest floor-device DFA at 32 classes drops from 120 states to 96 (see "Chunk
  size is chosen per device"). A storage-buffer fallback is not implemented.

- **`stateCount` and `specCount` must each be < 65535**, because the kernel
  packs `(specIndex+1, acceptingState+1)` into one u32. Asserted in
  `packTables`.

- **The DFA start state is hard-coded 0.** It is not stored in the plan
  (`wasm_core_runtime.ts` never writes `dfa.start`); `lex_all` hard-codes it
  too, and `buildDfa` guarantees it. If a DFA minimization or state-renumbering
  pass ever lands, both the Rust runtime and this kernel break silently — there
  is no format-version bump that would catch it.

- **The plan header constants are duplicated here.** `src/runtime/wasm_plan.ts`
  exposes only table _counts_; `readI32`, `readRowValue`, `decodeCompactOffset`
  and the `CORE_HEADER_*` constants are all module-private. The duplication is
  pinned by calling `inspectCombinedWasmParserPlan` first and by asserting
  `formatVersion === 3` and `parserPlanVersion === 2`, but it will still need
  updating if the plan format changes. `decodeLexerPlanTables` additionally
  range-checks every CSR row bound, every transition target and every accept
  candidate, so a malformed plan is a structured error rather than a silent
  CPU/GPU divergence (WGSL clamps out-of-bounds reads; the Rust `fn transition`
  returns -1, so the two would disagree without the check).

- **Benchmarked on exactly one GPU** (RTX 4080 SUPER) under exactly one WebGPU
  implementation (Deno 2.9.4 / wgpu). The ~12.5 ms synchronization floor in
  particular is a property of that stack, and it is what sets the crossover. The
  floor-device _behaviour_ is simulated and tested; floor-device _performance_
  is not measured at all. `pass_x`'s cost in particular is a shared-memory
  bandwidth and barrier story, and nothing about it should be assumed to carry
  to a different GPU architecture.

---

## What a real implementation would need to change

1. ~~**Bound per-thread scan length** to kill the O(n²) long-token case.~~
   **Done.** `pass_a` was replaced by `pass_x`/`pass_y`/`pass_z`; the long-token
   case is linear and the GPU is 7.1x faster than `lex_all` on it at 16 MiB. The
   cost is 15.4 ms of extra kernel time at 16 MiB of ordinary source and a
   `stateCount`-proportional term that did not exist before.
2. Replace the two remaining serial scans over the same 4096 elements with
   two-level scans: `pass_c`'s chunk walk (1.2 ms at 16 MiB) and `pass_y`'s
   segment scan (2.1 ms). Both are the same shape of fix. 2b. **DFA minimization
   is now a throughput lever, not a nicety.** `pass_x` costs `n * stateCount`,
   so it scales directly with a Hopcroft pass that does not exist yet.
3. Guard/contextual-token support, or keep the current explicit
   refuse-and-fall-back-to-CPU behaviour as the shipping policy.
4. Output sizing policy: a running tokens-per-code-unit estimate with the
   existing overflow flag driving a rare second submit. The measured cost of
   conservative sizing is 4.7 ms at 16 MiB (configuration (2) vs (3)), which is
   modest; the owned-copy cost (42.3 ms) is much larger and is avoidable by
   consuming the borrowed view directly.
5. Storage-buffer fallback for DFA tables that exceed workgroup storage, and a
   codepoint-classifier path for grammars with many above-ASCII ranges.
6. Persist the alphabet equivalence classes in the plan
   (`src/compiler/regex/dfa.ts` already computes them transiently and then
   re-coalesces them away) so the backend does not have to rebuild them at load
   time.
7. Measure `mapRange` on a browser or native wgpu host. It is 42.0 ms of the
   132.2 ms at 16 MiB, and its per-byte cost is discontinuous in the Deno data,
   so nothing should be assumed about it without a second implementation.
8. Amortize the ~256 ms device init, or accept that the backend is only for
   long-lived processes. As measured, no single document repays it.

Items 2-8 above are sequenced, gated, and given owners in
[`docs/adr/0001-webgpu-lexer-backend.md`](../../docs/adr/0001-webgpu-lexer-backend.md)
under "Remaining Work". Item 7 is the ADR's Phase 0 gate: nothing else is
justified until the Chrome/Dawn synchronization floor is measured on real
hardware, because that number is what sets the crossover.
