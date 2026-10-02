# WebGPU Lexer Backend

Status: experimental. See [Stability](stability.md#experimental-surfaces).

`@mewhhaha/baba/runtime/webgpu` includes a second implementation of the
generated parser's tokenizer that runs on the GPU. It is a **runtime backend,
not a generate target**: it consumes a `parser.plan` that ships today, produces
the identical token records, and emits no artifacts of its own.

Measure setup and complete owned-result latency on the intended host before
selecting a backend. Current comparisons below include setup costs separately;
the older results in ADR 0001 predate several CPU and GPU improvements.

## What It Is

Baba's shipping lexer is `fn lex_all` in the generated `parser.wasm`. It emits
token records of four `i32`: `{ specIndex, start, end, acceptingState }`. This
backend produces the same four-`i32` records, in the same order, with the same
values, from the same plan bytes.

Nothing has to be regenerated. There is no plan-format change, no grammar
change, and no semantic difference for supported plans. Token identity follows
each DFA accepting state's ordered candidates. Plans with source-dependent
guards are rejected.

The design and the measurements are recorded in
[ADR 0001](adr/0001-webgpu-lexer-backend.md). Regenerate the numbers with
`deno task bench:webgpu-lexer`.

## Using It

The backend is asynchronous, because a WebGPU submit-and-map round trip is
asynchronous. **The generated `parser.lex()` is synchronous and cannot host
it.** There is no drop-in switch on the generated parser; you drive the backend
yourself and get raw records rather than a token tape.

```ts
import { WebGpuLexer } from "@mewhhaha/baba/runtime/webgpu";

// `plan` is the bytes of the generated wasm/parser.plan.
const lexer = await WebGpuLexer.create(plan);

// UTF-16 code units, which is what the plan's spans are measured in.
const units = new Uint16Array(source.length);
for (let index = 0; index < source.length; index += 1) {
  units[index] = source.charCodeAt(index);
}

const result = await lexer.lex(units);
if (result.overflow) {
  throw new Error(`output buffer too small for ${result.tokenCount} tokens`);
}
for (let index = 0; index < result.tokenCount; index += 1) {
  const base = index * 4;
  const specIndex = result.records[base];
  const start = result.records[base + 1];
  const end = result.records[base + 2];
  const acceptingState = result.records[base + 3];
}

lexer.destroy();
```

Software fallback adapters are rejected by default. For explicit testing or
environments where a software adapter is intentional, opt in with
`WebGpuLexer.create(plan, { allowFallbackAdapter: true })`. The backend does not
automatically fall back to the generated CPU lexer; catch setup errors and
choose that path at the call site instead.

`lex()` accepts `capacityRecords` (defaults to the worst case of one record per
code unit, which can never overflow). GPU records use a compact two-word layout
for transfer, then expand into the public four-word `Int32Array`; every result
is therefore owned. `borrowRecords` is rejected because a mapped compact record
cannot satisfy the public layout without expansion.

Overflow is always detected and reported. It is never silent. Calls on one lexer
instance must be awaited serially. A second `lex()` call while the first is in
flight, or `destroy()` during a lex, throws immediately so shared GPU buffers
cannot be raced.

## Requirements

**A WebGPU adapter.** `WebGpuLexer.create` throws when the host exposes no
WebGPU implementation, when `requestAdapter()` returns null, and when it selects
a software fallback adapter without explicit opt-in. There is no automatic CPU
fallback: if you want one, catch setup errors and use the generated
`parser.lex()`.

**A guard-free grammar.** Contextual tokens with trailing lookahead make accept
a function of position rather than of DFA state alone, which the kernel's design
depends on. Guarded plans are refused loudly at `create()`, never mislexed. To
check without acquiring a device:

```ts
import { decodeLexerPlanTables } from "@mewhhaha/baba/runtime/webgpu";

const tables = decodeLexerPlanTables(plan);
if (!tables.guardFree) {
  console.error(tables.guardDiagnostics.join("; "));
}
```

Both shipped example grammars, Funcfuck and GPU Duck, are guard-free.

**Device headroom.** Every binding, buffer and dispatch grid is preflighted
against `device.limits` before anything is allocated, and an input that does not
fit raises `GpuLexerCapacityError` naming the limit, the requirement and the
device's value. The benchmark prints the actual worst-case capacity and skips
unsupported sizes as explicit rows; it never converts a capacity error into a
partial result. At the WebGPU-guaranteed floor, worst-case output capacity is
about 16.8 million UTF-16 units.

## Current Performance

Measured on 2026-10-02 with an RTX 4080 SUPER, driver 615.71.09, Deno 2.9.4 and
Vulkan. The baseline is the previous main revision (`d560268`), which already
includes cooperative character classification and shared worker setup. These are
GPU-to-GPU comparisons of complete owned-result calls, with default output
capacity of one record per UTF-16 unit. String encoding and setup are excluded.
Identical plan bytes and every word of the Wasm oracle's output were checked
before timing. Cells show medians and full ranges from nine alternating pairs
after four parity warmup pairs.

| corpus         | input  | previous GPU total, ms | current GPU total, ms |
| -------------- | ------ | ---------------------- | --------------------- |
| Funcfuck ASCII | 16 KiB | 12.92 [12.62, 14.84]   | 11.77 [11.69, 11.85]  |
| Funcfuck ASCII | 1 MiB  | 15.56 [14.60, 16.20]   | 14.91 [14.20, 16.00]  |
| Funcfuck ASCII | 4 MiB  | 22.78 [21.77, 23.71]   | 22.12 [21.41, 23.74]  |
| Funcfuck ASCII | 16 MiB | 54.47 [52.80, 58.51]   | 53.54 [52.52, 56.00]  |
| GPU Duck ASCII | 1 MiB  | 16.46 [16.20, 17.84]   | 15.39 [14.35, 16.97]  |
| GPU Duck ASCII | 4 MiB  | 27.05 [26.39, 29.90]   | 25.38 [24.56, 26.69]  |
| Unicode        | 1 MiB  | 15.80 [14.63, 17.63]   | 14.53 [13.59, 16.13]  |
| Unicode        | 4 MiB  | 20.09 [19.47, 21.28]   | 19.31 [18.34, 21.36]  |

Whole-call medians improve roughly 2–9% on this adapter. Several sample ranges
overlap, so these measurements do not establish a portable crossover or the same
gain on another device. Funcfuck uses the randomized short-token corpus with
seed 20250726. GPU Duck has 175 DFA states. The Unicode grammar uses `\p{L}`,
`\p{N}` and emoji, with five DFA states, 1590 above-ASCII ranges and about 80%
non-ASCII UTF-16 units.

Shorter sweeps reduce Funcfuck's `pass_x` stage at 16 KiB from 0.700 [0.700,
0.701] to 0.054 [0.049, 0.055] ms, and at 1 MiB from 0.748 [0.743, 0.757] to
0.443 [0.438, 0.448] ms. At 4 MiB its stage medians remain about 1.66 ms. The
Unicode stage at 1 MiB drops from 0.890 [0.889, 0.890] to 0.466 [0.465, 0.466]
ms. Complete calls still include the roughly 12 ms submit-and-map floor measured
on this stack, plus readback and record expansion.

Compare the current Wasm and GPU implementations with
`deno task bench:webgpu-lexer` on the intended host. CPU total includes source
copy, `lex_all`, and an owned record copy. GPU total includes upload, command
encoding, submission/map, and compact-record expansion. The generated
`parser.lex()` returns a lazy token tape and handles channels and diagnostics,
so its timings measure a different public surface. Earlier measurements and the
retired quadratic scan are recorded in
[ADR 0001](adr/0001-webgpu-lexer-backend.md); its older CPU rates and crossover
are historical.

### Kernel Work

The GPU computes the longest-match successor at every offset, then follows the
true token orbit to emit ordered records. The stages stay linear in input size
for a fixed grammar, including a source that contains one enormous token:

1. `pass_x` decodes and classifies offsets cooperatively in shared-memory tiles.
   Every DFA state reuses each class and UTF-16 width while applying the
   backward summary recurrence. Its work is **O(input length times DFA states)**
   and does not grow with token length. Decoding uses full source bounds;
   segment boundaries move right when necessary to avoid splitting a surrogate
   pair.
2. Sweep segments adapt between 256 and 4096 units. Selection keeps at most 512
   segments until the 4096-unit maximum is reached: 16 KiB uses 256-unit
   segments, 1 MiB uses 2048-unit segments, and larger inputs use the measured
   4096-unit preference. `pass_y` composes their suffix summaries, and `pass_z`
   reconstructs exact token successors. The sweep and finalize pipelines each
   have five upfront WGSL override variants, so segment shifts remain constants
   in the compiled shaders.
3. `pass_b` finds each offset's exit from its chunk by pointer doubling. It
   alternates shared arrays instead of copying them each round. `pass_c`
   prefetches short entry windows for 64 chunks at a time, then follows the
   exact chunk-entry recurrence in shared memory. Entries outside a window use
   the original global load; tokens that jump over chunks still emit no records
   there.
4. `pass_d` caches a chunk's successors in shared memory before counting its
   orbit. `pass_e` scans those counts into output offsets. `pass_f` walks the
   cached successors, collects token starts, and emits records in parallel.
   These chunk caches reuse the pointer-doubling arrays and its existing device
   memory budget, including the simulated 16 KiB workgroup-storage floor.

All stages remain inside one queue submission and one mapped readback. The
single-token benchmark verifies byte parity through 16 MiB and reports the
selected segment size and summary-stage cost per MiB. Its known output capacity
is one record, so this benchmark isolates long-token scaling rather than
worst-case output allocation.

### Reusing Worker Setup

`WebGpuRuntime.compileLexer()` caches equivalent plan bytes and supplies a
bounded pool of workers through `context.lex()` and `context.lexCompact()`. The
first worker decodes and packs the plan once. Additional workers share its 17
pipelines, bind-group layout, and immutable table buffer; mutable source,
result, parameter, and query buffers remain private. The last worker destroys
the shared table. Equal copied plans and views with a nonzero byte offset reuse
one context; distinct plan bytes remain distinct.

The extra eight sweep/finalize pipeline variants add about 3 ms to warmed setup.
Twelve alternating pairs after eight warmup pairs measured fresh GPU Duck
contexts on an initialized device. Each sample holds its first worker while
acquiring three more concurrently; device initialization, lexing and teardown
are excluded. Cells show medians and full ranges in milliseconds.

| operation             | previous GPU setup   | current GPU setup    |
| --------------------- | -------------------- | -------------------- |
| compile first context | 6.06 [5.83, 6.52]    | 9.03 [8.81, 9.62]    |
| acquire three workers | 0.037 [0.033, 0.048] | 0.037 [0.035, 0.046] |

Reuse amortizes this added compilation cost; a steady-state improvement does not
imply a faster one-off call. The plan's 38,324 bytes of packed lexer tables are
uploaded once per worker family. These timings exclude cold adapter and device
initialization, which must be measured separately for backend selection.

## Honest Reporting

The GPU also drives a desktop; clocks and competing work are not isolated.
Report full sample ranges alongside medians. A kernel-stage improvement may be
hidden by synchronization and readback in the whole-call measurements.

**One adapter, one stack.** Every number here is from a single NVIDIA GPU under
Deno's wgpu on Linux. No second GPU, driver or WebGPU implementation has been
measured.

**Not measured at all:**

- the synchronization floor in Chrome/Dawn or Firefox on real GPU hardware. The
  synchronization floor is a property of the measured stack and sets the
  crossover. A host with a ~1 ms floor would move the crossover by roughly an
  order of magnitude, but that is an estimate by substitution, not a result;
- floor-device throughput. Floor-device _behaviour_ is simulated and tested; its
  _speed_ is unmeasured. Compact output makes the 16 MiB row capacity-feasible
  at the spec floor, but it remains unmeasured there;
- readback cost on a non-Deno host. Its per-byte cost is discontinuous in the
  Deno data, so the claim that it "disappears in a browser" is untested;
- real application corpora at these sizes. The throughput inputs above are
  synthetic expansions of small example programs.

**Worst-case device allocation is roughly 15x the UTF-16 source bytes.** Per
UTF-16 unit this is 2 B of source, 12 B across the three per-position arrays, 8
B of compact records and 8 B of staging—about 30 B total. The owned public
four-word host result adds up to another 16 B per emitted record, so a
one-token-per-unit input reaches roughly 23x across device and host memory.

## Correctness

Parity is byte equality of the record array against `lex_all`, not a semantic
argument: record count plus every field of every record.

`tests/webgpu_lexer_parity_test.ts` is the gate. It compiles its grammar inline,
so it needs nothing on disk, and covers the empty string, error tokens, lone and
paired surrogates, above-ASCII classes, longest-match backtracking, unterminated
constructs, 9000-unit single tokens, classification-tile boundaries with
accepted astral strings and partial tiles, chunk and segment boundaries swept
unit by unit, every adaptive segment size, runs spanning three to five segments,
full and skipped chunks across prefix-scan blocks, a squeezed dispatch grid, and
a simulated floor device. The current CI workflow runs `deno task test` without
`--unstable-webgpu`, so adapter-dependent cases are skipped. The host-side
option and plan-decoding cases still run. Run the GPU gate explicitly on a
WebGPU-enabled host; software-adapter parity is correctness evidence and does
not measure hardware GPU performance.

`deno task parity:webgpu-lexer` sweeps one shipped example grammar at a time,
with multi-MiB corpora and failure-mode guards. It defaults to Funcfuck; use
`--grammar gpu-duck` for the second example. It needs `deno task bootstrap` to
have generated the example artifacts first.

## Benchmarks

```sh
deno task bench:webgpu-lexer
deno task bench:webgpu-lexer --grammar gpu-duck --runs 7 --json out.json
deno task bench:webgpu-lexer:pathological
deno test --unstable-webgpu --allow-read --allow-write --allow-run tests/webgpu_lexer_parity_test.ts
deno task parity:webgpu-lexer
deno task parity:webgpu-lexer --grammar gpu-duck
# Explicit software-adapter experiment only; never report this as hardware data.
deno task bench:webgpu-lexer --allow-fallback-adapter
```

The benchmark re-verifies byte-exact parity at every size before timing it; a
fast wrong kernel is worthless. Machine-readable output is opt-in via
`--json PATH`, records adapter identity and fallback status, marks software runs
as non-hardware, and reports timestamp-stage metrics as unavailable when
`timestamp-query` is unsupported. The pathological task measures the input class
that used to be quadratic - one enormous token - and asserts parity at every
capacity-supported size while printing cost per MiB when timestamps are
available.

Both read `examples/<grammar>/generated/wasm/`, a gitignored local build output.
