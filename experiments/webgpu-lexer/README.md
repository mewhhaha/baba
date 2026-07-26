# WebGPU lexer backend (proof of concept)

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

# the known worst case, reproduced
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
| `corpus.ts`                                                        | Input generators (periodic for throughput, randomized for parity) and the adversarial case list.                                                                                                                                                                                                                     |
| `parity.ts`                                                        | The gate. Raw 4 x i32 vs raw 4 x i32, plus grid-stride reruns, a floor-device simulation, and failure-mode guards.                                                                                                                                                                                                   |
| `bench.ts`                                                         | CPU vs GPU across 16 KiB .. 16 MiB, three GPU configurations, with dispersion. Re-verifies parity at every size.                                                                                                                                                                                                     |
| `pathological.ts`                                                  | Reproduces the one input class where this design is asymptotically worse than the CPU.                                                                                                                                                                                                                               |
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

That is what makes the kernel simple. The brief suggested a chunked
_speculative_ scan (one thread per candidate DFA start state) plus a chunk-entry
fixup. That shape is right for a plain DFA but wrong here: composing per-chunk
`state -> state` maps does not reproduce token boundaries at all, because
`offset := best_end` can be strictly less than where the forward scan died. The
composable element would have to be
`(finalState, lastAcceptOffset,
lastAcceptState)` per candidate start state — S
times wider, and _still_ not enough to place boundaries. Computing `next(p)`
pointwise sidesteps the whole problem.

### Pipeline

All seven dispatches live inside **one** command encoder, followed by the
`copyBufferToBuffer`s and one `mapAsync`. There is no CPU in the loop, no
intermediate readback, no fixup round-trip.

| stage               | parallelism                    | what it does                                                                                                                                         |
| ------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pass_a`            | one thread per UTF-16 offset   | `next(p)`, `specIndex(p)`, `acceptingState(p)`. DFA + classifier held in workgroup shared memory.                                                    |
| `pass_b`            | one workgroup per chunk        | Guarded pointer doubling in LDS: `exit(p)` = first orbit position `>= chunkEnd`, for every `p`. `log2(chunkSize)` rounds, entirely in shared memory. |
| `pass_c`            | one thread, serial over chunks | `entry(k)` = the true orbit position at which chunk `k` is entered. Only `numChunks` dependent loads (4096 at 16 MiB).                               |
| `pass_d`            | one thread per chunk           | Walk `entry(k) .. chunkEnd`, count tokens.                                                                                                           |
| `pass_e1`/`pass_e2` | two-level workgroup scan       | Exclusive prefix sum over the per-chunk counts; writes the total count and the overflow flag.                                                        |
| `pass_f`            | one thread per chunk           | Walk again, write the 4 x i32 records at the scanned offset.                                                                                         |

`pass_b`'s guarded doubling invariant: after round `r`,
`ja[i] = min(position after 2^r orbit steps, first position >= limit)`. Every
orbit step advances at least one code unit, so `log2(chunkSize)` rounds are
sufficient. `pass_c` handles the case where a single token jumps clean over one
or more chunks (`entry(k) = NO_ENTRY`, chunk emits nothing).

`pass_a`, `pass_b`, `pass_d` and `pass_f` are all **grid-stride loops**, so no
dispatch can exceed `maxComputeWorkgroupsPerDimension` regardless of input size.
Because a device reporting 65535 is never actually driven to that grid by a
runnable input, `parity.ts` re-runs the entire corpus with the grid artificially
squeezed to 1, 3 and 7 workgroups, which forces the stride path.

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

parity: 83 passed, 0 failed, 83 total
grid-stride reruns (gridCap 1/3/7, inputs <= 64 KiB): 240 passed
floor-device reruns (chunkSize=2048, inputs <= 64 KiB): 80 passed, 0 failed
guards: 7 passed, 0 failed
exit=0
```

The other three grammars, same shape, all `exit=0`:

| grammar      | parity | grid-stride reruns | floor-device reruns | guards |
| ------------ | ------ | ------------------ | ------------------- | ------ |
| funcfuck     | 83/83  | 240 passed         | 80 passed, 0 failed | 7/7    |
| thunkwasm    | 58/58  | 171 passed         | 57 passed, 0 failed | 7/7    |
| brainfuck    | 58/58  | 171 passed         | 57 passed, 0 failed | 7/7    |
| feature-tour | 52/52  | 153 passed         | 51 passed, 0 failed | 7/7    |

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
- 12 randomized funcfuck sources (varied whitespace runs, identifier lengths,
  integer widths) plus randomized 1 MiB and 4 MiB inputs;
- **every case above re-run with the workgroup grid squeezed to 1, 3 and 7**, so
  the grid-stride path in `pass_a`/`pass_b`/`pass_d`/`pass_f` is exercised
  rather than assumed;
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
  cpu  CpuReferenceLexer.create (WebAssembly.Module + load_plan) = 0.342 ms
  gpu  requestAdapter=138.790 ms  requestDevice=82.005 ms  decodePlan=1.068 ms  buildAlphabet=0.627 ms  packTables=0.056 ms
  gpu  buildKernelSource=0.168 ms  createShaderModule=1.221 ms  createPipelines=1.660 ms  createBuffers=0.134 ms
  gpu  TOTAL = 226.057 ms (660.4x the CPU engine's setup)

corpus: randomized funcfuck (short tokens only, seed 20250726)

  16 KiB  tokens=     6505  cpu lex_all=       0.39 [0.32..0.41] ms (  39.62 MiB/s)  gpu total=    12.01 [11.91..12.12] ms (    1.30 MiB/s)  speedup=0.03x
  32 KiB  tokens=    12826  cpu lex_all=       0.77 [0.63..0.87] ms (  40.53 MiB/s)  gpu total=    12.13 [11.95..12.32] ms (    2.58 MiB/s)  speedup=0.06x
  64 KiB  tokens=    25764  cpu lex_all=       1.47 [1.34..1.78] ms (  42.56 MiB/s)  gpu total=    12.09 [12.05..12.64] ms (    5.17 MiB/s)  speedup=0.12x
 128 KiB  tokens=    51671  cpu lex_all=       3.17 [2.84..3.30] ms (  39.40 MiB/s)  gpu total=    12.44 [12.28..12.98] ms (   10.05 MiB/s)  speedup=0.26x
 256 KiB  tokens=   103243  cpu lex_all=       5.65 [5.37..5.76] ms (  44.23 MiB/s)  gpu total=    13.90 [12.93..14.22] ms (   17.99 MiB/s)  speedup=0.41x
 512 KiB  tokens=   206362  cpu lex_all=    10.58 [10.43..11.03] ms (  47.28 MiB/s)  gpu total=    14.01 [13.31..15.46] ms (   35.70 MiB/s)  speedup=0.76x
   1 MiB  tokens=   413140  cpu lex_all=    21.40 [20.88..21.95] ms (  46.72 MiB/s)  gpu total=    17.39 [14.03..19.66] ms (   57.49 MiB/s)  speedup=1.23x
   4 MiB  tokens=  1651674  cpu lex_all=    84.30 [83.62..86.21] ms (  47.45 MiB/s)  gpu total=    31.29 [26.48..33.90] ms (  127.83 MiB/s)  speedup=2.69x
  16 MiB  tokens=  6605769  cpu lex_all= 338.42 [336.63..375.60] ms (  47.28 MiB/s)  gpu total= 110.16 [107.78..208.03] ms (  145.24 MiB/s)  speedup=3.07x

the other two GPU configurations, and what each gap costs:
    size   (1) worst/owned   (2) worst/borrowed   (3) oracle/borrowed   owned copy    sizing  (1) speedup  (3) speedup
  16 KiB             12.01                11.95                 11.95         0.06     -0.00        0.03x        0.03x
  32 KiB             12.13                12.03                 12.02         0.10      0.01        0.06x        0.06x
  64 KiB             12.09                12.12                 12.08        -0.03      0.04        0.12x        0.12x
 128 KiB             12.44                12.32                 12.49         0.12     -0.17        0.26x        0.25x
 256 KiB             13.90                13.21                 13.02         0.68      0.19        0.41x        0.43x
 512 KiB             14.01                13.82                 13.26         0.19      0.56        0.76x        0.80x
   1 MiB             17.39                15.32                 14.64         2.07      0.68        1.23x        1.46x
   4 MiB             31.29                22.17                 27.31         9.12     -5.14        2.69x        3.09x
  16 MiB            110.16                73.90                 66.57        36.26      7.33        3.07x        5.08x

GPU submit+sync and kernel time (ms, median [min..max], configuration (1)):
  16 KiB  submit+sync=    11.75 [11.72..11.95] ms  kernels=       0.45 [0.44..0.45] ms
  32 KiB  submit+sync=    11.81 [11.79..11.86] ms  kernels=       0.51 [0.51..0.54] ms
  64 KiB  submit+sync=    11.90 [11.86..12.01] ms  kernels=       0.55 [0.55..0.55] ms
 128 KiB  submit+sync=    12.09 [12.03..12.14] ms  kernels=       0.69 [0.69..0.73] ms
 256 KiB  submit+sync=    12.30 [11.91..12.76] ms  kernels=       0.87 [0.75..0.87] ms
 512 KiB  submit+sync=    12.64 [12.62..13.25] ms  kernels=       1.04 [1.03..1.60] ms
   1 MiB  submit+sync=    13.82 [12.79..15.47] ms  kernels=       1.87 [1.85..3.02] ms
   4 MiB  submit+sync=    19.90 [18.82..21.75] ms  kernels=       4.97 [4.29..6.43] ms
  16 MiB  submit+sync=   32.33 [29.33..120.48] ms  kernels=      9.44 [6.15..37.66] ms

per-stage GPU time (ms, median, configuration (1)):
    size          pass_a_scan        pass_b_double       pass_c_entries        pass_d_counts    pass_e1_blockscan pass_e2_blockoffsets          pass_f_emit
  16 KiB                0.010                0.022                0.003                0.175                0.003                0.002                0.233
  32 KiB                0.010                0.021                0.003                0.208                0.003                0.002                0.266
  64 KiB                0.011                0.021                0.005                0.225                0.003                0.002                0.286
 128 KiB                0.014                0.022                0.007                0.233                0.003                0.002                0.414
 256 KiB                0.020                0.021                0.013                0.236                0.003                0.002                0.575
 512 KiB                0.034                0.024                0.023                0.240                0.003                0.002                0.709
   1 MiB                0.059                0.046                0.045                0.242                0.003                0.002                1.478
   4 MiB                0.393                0.251                0.321                0.459                0.005                0.004                3.417
  16 MiB                1.110                0.927                1.620                0.963                0.004                0.005                4.326

GPU wall-clock breakdown (ms, median, configuration (1)):
    size    upload    encode  submit+sync   mapRange   copyOut     total
  16 KiB     0.046     0.085       11.752      0.043     0.038    12.007
  32 KiB     0.043     0.080       11.813      0.083     0.075    12.131
  64 KiB     0.043     0.070       11.903      0.026     0.026    12.090
 128 KiB     0.051     0.071       12.087      0.054     0.056    12.440
 256 KiB     0.064     0.071       12.302      0.687     0.639    13.895
 512 KiB     0.094     0.079       12.636      0.227     0.370    14.006
   1 MiB     0.149     0.108       13.817      1.138     0.848    17.393
   4 MiB     0.640     0.142       19.904      2.024     8.837    31.291
  16 MiB     1.676     0.825       32.333     38.676    37.966   110.162

crossover (1) worst-case/owned, medians:                1 MiB
crossover (1) worst gpu sample vs best cpu sample:      1 MiB
crossover (3) oracle capacity, medians:                 1 MiB
```

### Crossover

The 9-size sweep can only resolve the crossover to "1 MiB", because that is the
first size it measures where the GPU wins. Two independent finer sweeps
(`--sizes 524288,655360,786432,917504,1048576,1310720 --runs 7`) both report 768
KiB. Sweep A (stored in `results_crossover.json`):

```
 512 KiB  cpu lex_all=    10.61 [10.30..11.61] ms  gpu total=    14.72 [13.25..16.42] ms  speedup=0.72x
 640 KiB  cpu lex_all=    13.47 [13.11..14.66] ms  gpu total=    14.63 [13.74..16.23] ms  speedup=0.92x
 768 KiB  cpu lex_all=    16.68 [15.73..26.85] ms  gpu total=    15.43 [14.39..17.39] ms  speedup=1.08x
 896 KiB  cpu lex_all=    18.71 [18.18..20.78] ms  gpu total=    15.09 [14.58..16.45] ms  speedup=1.24x
   1 MiB  cpu lex_all=    22.10 [20.99..24.46] ms  gpu total=    15.64 [14.90..16.21] ms  speedup=1.41x
1.25 MiB  cpu lex_all=    26.90 [26.42..28.01] ms  gpu total=    21.13 [16.15..21.67] ms  speedup=1.27x

crossover (1) worst-case/owned, medians:                768 KiB
crossover (1) worst gpu sample vs best cpu sample:      896 KiB
crossover (3) oracle capacity, medians:                 768 KiB
```

Sweep B:

```
 512 KiB  cpu lex_all=    10.79 [9.93..13.60] ms  gpu total=    14.87 [13.43..15.62] ms  speedup=0.73x
 640 KiB  cpu lex_all=    13.81 [13.66..14.94] ms  gpu total=    15.76 [13.06..16.60] ms  speedup=0.88x
 768 KiB  cpu lex_all=    17.16 [15.62..21.91] ms  gpu total=    16.43 [14.23..17.02] ms  speedup=1.04x
 896 KiB  cpu lex_all=    19.21 [18.47..22.46] ms  gpu total=    14.77 [14.38..15.63] ms  speedup=1.30x
   1 MiB  cpu lex_all=    21.50 [21.30..23.12] ms  gpu total=    15.28 [14.90..15.52] ms  speedup=1.41x
1.25 MiB  cpu lex_all=    27.40 [26.46..39.04] ms  gpu total=    20.88 [16.65..21.32] ms  speedup=1.31x

crossover (1) worst-case/owned, medians:                768 KiB
crossover (3) oracle capacity, medians:                 768 KiB
```

**Crossover is 768 KiB of source** — the first measured size at which the GPU
wins, in both sweeps, in both configuration (1) and configuration (3). At 640
KiB the GPU lost in every measurement taken (0.92x and 0.88x). An earlier
version of this document claimed "~640 KiB", which contradicted the tool's own
printed verdict. On the stricter "worst GPU sample beats best CPU sample" test
the crossover is 896 KiB.

Below the crossover the ~11.8 ms fixed synchronization floor dominates and the
CPU wins outright.

Cross-check on a second grammar (thunkwasm, repeated example programs, 5 runs,
stored in `results_thunkwasm.json`):

```
corpus: repeated example programs (strictly periodic, 497-char period)

   1 MiB  tokens=   548555  cpu lex_all=    21.95 [20.69..23.71] ms  gpu total=    20.41 [15.53..22.20] ms  speedup=1.08x
  16 MiB  tokens=  8776813  cpu lex_all= 359.50 [342.51..434.99] ms  gpu total= 138.15 [131.94..151.37] ms  speedup=2.60x

    size   (1) worst/owned   (2) worst/borrowed   (3) oracle/borrowed   owned copy    sizing  (1) speedup  (3) speedup
   1 MiB             20.41                15.75                 15.26         4.66      0.49        1.08x        1.44x
  16 MiB            138.15                86.63                 81.73        51.52      4.90        2.60x        4.40x
```

### Reading these numbers honestly

- **One-time setup is ~226 ms and is never repaid.** `requestAdapter` (139 ms) +
  `requestDevice` (82 ms) + shader/pipeline/table construction (~4 ms), against
  0.34 ms for `WebAssembly.Module` + `load_plan`. That is ~660x. At the 768 KiB
  crossover the per-call saving is ~0 ms, so one document never pays for the
  backend. Even the 16 MiB case saves ~228 ms (338.42 − 110.16), i.e. roughly
  one device init. A GPU backend only makes sense for a long-lived process
  lexing many multi-MiB inputs.
- **The spread is large, and it is now printed rather than collapsed.** At 16
  MiB, configuration (1) ranged 107.78–208.03 ms across 7 runs, and per-stage
  kernel totals ranged 6.15–37.66 ms for identical work. A single "3.07x" with
  no error bar would be false precision. The GPU concurrently drives this
  desktop (browser, terminal, chat client), clocks are not pinned, and no
  isolation was attempted. Read every quoted median at the largest sizes as
  carrying tens of percent of uncertainty.
- **The CPU baseline here is ~47 MiB/s, not the ~12 MiB/s quoted upstream.**
  That difference is real and matters: the 12 MiB/s figure was measured through
  `parser.lex()`, which also materializes the token tape and `Token` objects.
  This benchmark compares `lex_all` records against GPU records — the identical
  unit of work on both sides. Comparing against `parser.lex()` would have made
  the GPU look ~4x better for free and moved the apparent crossover down by
  roughly 4x.
- **Actual GPU compute is a small fraction of wall time.** At 16 MiB the seven
  kernels total 9.4 ms out of 110.2 ms. The rest is the ~11.8 ms Deno
  synchronization floor, the device->staging copy inside `submit+sync`,
  `mapRange` (38.7 ms) and the owned copy (38.0 ms).
- **`mapRange` does not behave like a fixed-rate memcpy, and this document no
  longer claims it does.** Its per-byte cost is discontinuous in the measured
  data: at 4 MiB, 2.024 ms for 26.4 MB is ~13 GB/s; at 16 MiB, 38.676 ms for
  105.7 MB is ~2.7 GB/s — the same call, ~5x apart per byte. The small-size
  regime is not explained by a copy model at all. What is established is only
  that the cost exists and that it is Deno-API behaviour; **no
  cross-implementation measurement was taken**, so "it would largely disappear
  in a browser or native wgpu host" is a hypothesis, not a result.
- **Output is bigger than input.** funcfuck emits ~0.39 tokens per code unit, so
  16 MiB of source produces 6.6 M records = 101 MiB of 4 x i32. The readback is
  dominated by the token tape, not by the source upload (1.7 ms).
- **`pass_c` is the serial stage** (1.6 ms at 16 MiB) — 4096 dependent global
  loads in a single thread. It is the first thing to attack if this were
  productionised; a second level of guarded doubling would remove it.
- **The benchmark input is synthetic and structurally favours this kernel.**
  Both generators emit only short tokens (mean ~2.5 code units for funcfuck; no
  comments, no string literals, no long tokens). That is exactly the shape that
  keeps `pass_a`'s per-offset scan effectively linear, and it never touches the
  quadratic case documented below. The `thunkwasm` cross-check additionally uses
  strictly periodic repeated input. The largest real Baba source file in this
  repo is 224 bytes and the largest whole-example corpus is 493 bytes — about
  three orders of magnitude below the crossover. **No real file in this repo is
  anywhere near the size where the GPU path wins.**

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

- **Long single tokens are quadratic, and it bites long before it is merely
  theoretical.** `pass_a` computes `next(p)` at _every_ offset, and `next(p)`
  costs O(length of the token starting at `p`). On normal source the mean token
  length is ~2.5 code units so this is effectively O(n). On input that is one
  enormous token it is O(n²), while the CPU stays O(n). Measured with funcfuck's
  `WS = /[ \t\r\n]+/` on a file of nothing but spaces (`pathological.ts`):

  ```
  single-token input (funcfuck WS run): PASS A is O(n^2)
     chars  tokens  parity    cpu ms   pass_a ms  gpu total ms   gpu/cpu
     16384       1    true      1.43        1.80         23.81     16.6x
     32768       1    true      0.86        4.16         16.07     18.8x
     65536       1    true      1.17        8.48         20.15     17.2x
    131072       1    true      2.05       27.09         38.95     19.0x
    262144       1    true      3.91       92.40        104.42     26.7x
    524288       1    true      7.95      349.72        361.12     45.4x
   1048576       1    true     16.25     1368.35       1381.17     85.0x
   2097152       1    true     32.06     5417.51       5431.30    169.4x
  ```

  Parity still holds — the kernel is correct here, just asymptotically wrong.
  Note the shape of the failure: this is a **single un-interruptible dispatch**
  that already runs for 5.4 s at 2 MiB of one token, and extrapolating the same
  fit puts the 16 MiB benchmark size at ~350 s inside one `pass_a`. (Sizes past
  2 MiB were not run: a multi-minute compute dispatch risks a GPU hang.) A
  device loss from such a dispatch would now be reported rather than swallowed —
  `device.lost` is checked and the submit path is inside error scopes — but the
  underlying cost is not fixed. Grammars with block comments or long string
  literals hit this too. **This is the one genuinely mandatory change before any
  of this could be productionised.** The fix is to bound per-thread scan length:
  either the chunked-composition scheme (compose
  `(finalState, lastAcceptOffset, lastAcceptState)` per candidate start state),
  or a cap-and-fixup pass. Not implemented here.

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
  `pass_a`/`pass_b`/`pass_d`/`pass_f`, which are grid-strided.

- **DFA tables must fit workgroup storage.** `pass_a` holds
  `128 + stateCount + stateCount*classCount` i32 in shared memory and
  `buildKernelSource` throws if that exceeds the limit the device actually
  granted. funcfuck needs 11.2 KiB, which fits even the 16 KiB floor; a
  241-state grammar with ~40 classes would need ~39 KiB and would be refused on
  a floor device. A storage-buffer fallback is not implemented.

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
  implementation (Deno 2.9.4 / wgpu). The ~11.8 ms synchronization floor in
  particular is a property of that stack, and it is what sets the crossover. The
  floor-device _behaviour_ is simulated and tested; floor-device _performance_
  is not measured at all.

---

## What a real implementation would need to change

1. **Bound per-thread scan length** to kill the O(n²) long-token case. This is
   the one genuinely mandatory change.
2. Replace `pass_c`'s serial chunk walk with a second level of guarded doubling
   (1.6 ms at 16 MiB today).
3. Guard/contextual-token support, or keep the current explicit
   refuse-and-fall-back-to-CPU behaviour as the shipping policy.
4. Output sizing policy: a running tokens-per-code-unit estimate with the
   existing overflow flag driving a rare second submit. The measured cost of
   conservative sizing is 7.3 ms at 16 MiB (configuration (2) vs (3)), which is
   modest; the owned-copy cost (36.3 ms) is much larger and is avoidable by
   consuming the borrowed view directly.
5. Storage-buffer fallback for DFA tables that exceed workgroup storage, and a
   codepoint-classifier path for grammars with many above-ASCII ranges.
6. Persist the alphabet equivalence classes in the plan
   (`src/compiler/regex/dfa.ts` already computes them transiently and then
   re-coalesces them away) so the backend does not have to rebuild them at load
   time.
7. Measure `mapRange` on a browser or native wgpu host. It is 38.7 ms of the
   110.2 ms at 16 MiB, and its per-byte cost is discontinuous in the Deno data,
   so nothing should be assumed about it without a second implementation.
8. Amortize the ~226 ms device init, or accept that the backend is only for
   long-lived processes. As measured, no single document repays it.

Items 1-8 above are sequenced, gated, and given owners in
[`docs/adr/0001-webgpu-lexer-backend.md`](../../docs/adr/0001-webgpu-lexer-backend.md)
under "Remaining Work". Item 7 is the ADR's Phase 0 gate: nothing else is
justified until the Chrome/Dawn synchronization floor is measured on real
hardware, because that number is what sets the crossover.
