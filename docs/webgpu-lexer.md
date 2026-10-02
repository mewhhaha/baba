# WebGPU Lexer Backend

Status: experimental. See [Stability](stability.md#experimental-surfaces).

`@mewhhaha/baba/runtime/webgpu` includes a second implementation of the
generated parser's tokenizer that runs on the GPU. It is a **runtime backend,
not a generate target**: it consumes a `parser.plan` that ships today, produces
the identical token records, and emits no artifacts of its own.

Read the measurement rules below before adopting it. The historical hardware
results predate the current Wasm lexer throughput optimization and compact
record transfer. Measure setup and complete owned-result latency on the intended
host before selecting a backend.

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

The initial-cleanup snapshot was measured on 2026-10-02 with an RTX 4080 SUPER,
driver 615.71.09, Deno 2.9.4, Vulkan, and the randomized Funcfuck corpus (seed
20250726). The owned CPU/GPU comparison below predates the cooperative
classification improvement described afterward. These are medians and full
ranges from nine runs after four warmups. Sizes count UTF-16 units; string
encoding and cold setup are excluded from both steady-state columns. Both paths
return owned four-word records; GPU capacity is the default one record per input
unit. Byte parity was checked at every size.

| input  | Wasm total, ms       | GPU total, ms        |
| ------ | -------------------- | -------------------- |
| 16 KiB | 0.17 [0.12, 0.21]    | 13.93 [12.73, 14.95] |
| 1 MiB  | 7.65 [7.19, 8.76]    | 17.50 [15.40, 18.92] |
| 4 MiB  | 28.99 [28.19, 30.06] | 24.26 [22.68, 29.89] |

In that snapshot, the GPU wins narrowly at the largest sampled size. The
overlapping ranges and single adapter do not establish a portable crossover.
Small files still pay a roughly 12 ms synchronization floor. Cold GPU setup took
211 ms, versus 0.37 ms for the Wasm reference; reuse sessions and include setup
for one-off workloads.

The pointer-doubling kernel now alternates its shared arrays instead of copying
one into the other every round. Nine alternating before/after pairs reduced its
median device time from 0.046 to 0.033 ms at 1 MiB and from 0.118 to 0.083 ms at
4 MiB, about 29%; whole-call timings remained within the observed variation.

### Cooperative Character Classification

The DFA summary pass (`pass_x`) now decodes and classifies source offsets
cooperatively in shared-memory tiles. Each invocation classifies one offset;
every DFA state then reuses its character class and UTF-16 width. Unicode range
searches therefore happen once per offset instead of once per state. Decoding
uses the full source bounds, so a surrogate pair crossing a tile boundary keeps
its two-unit width. Segment boundaries still move to avoid splitting pairs. Both
shared-table and storage-table capacity checks include the tile's memory. The
backward DFA recurrence and its per-offset barrier remain **O(input length times
DFA states)**; each tile adds one classification barrier.

Isolated trials on the same adapter used nine alternating before/after pairs
after four parity warmup pairs, with identical plan bytes and default output
capacity. Their baseline is the initial-cleanup implementation, including the
pointer-doubling change above, rather than the historical implementation in
ADR 0001. The following device-stage medians and full ranges are separate from
the owned CPU/GPU comparison above:

| corpus         | input | initial-cleanup `pass_x`, ms | cooperative `pass_x`, ms |
| -------------- | ----- | ---------------------------- | ------------------------ |
| Funcfuck ASCII | 1 MiB | 0.911 [0.910, 0.929]         | 0.748 [0.748, 0.749]     |
| Funcfuck ASCII | 4 MiB | 1.993 [1.990, 3.095]         | 1.655 [1.655, 2.324]     |
| GPU Duck ASCII | 1 MiB | 2.027 [2.024, 2.746]         | 1.688 [1.684, 2.534]     |
| GPU Duck ASCII | 4 MiB | 7.422 [7.003, 7.921]         | 6.014 [5.755, 6.774]     |
| Unicode        | 1 MiB | 3.185 [3.049, 4.254]         | 0.931 [0.930, 0.936]     |
| Unicode        | 4 MiB | 4.474 [3.672, 5.389]         | 1.226 [1.062, 3.164]     |

ASCII stage medians improve 17–19%. GPU Duck has 175 DFA states; both versions
used shared tables on this adapter. The Unicode grammar uses `\p{L}`, `\p{N}`
and emoji, with five DFA states, 1590 above-ASCII ranges and about 80% non-ASCII
UTF-16 units. Its stage medians improve 71–73%, and its owned whole-call results
are:

| input | initial-cleanup total, ms | cooperative total, ms |
| ----- | ------------------------- | --------------------- |
| 1 MiB | 17.76 [17.31, 19.34]      | 15.65 [14.88, 16.56]  |
| 4 MiB | 23.05 [22.63, 26.30]      | 19.96 [19.18, 24.35]  |

Unicode whole-call medians improve 12–13%, with overlapping ranges at 4 MiB.
Funcfuck whole-call ranges overlap at both sizes. GPU Duck's 4 MiB whole-call
median moves from 28.27 [26.94, 28.64] to 26.36 [25.86, 27.08] ms. These are
single-adapter measurements; a faster device stage does not establish a portable
whole-call crossover.

The updated single-token benchmark verifies parity through 16 MiB. Total GPU
time grows from 14.34 ms at 4 MiB to 22.76 ms at 16 MiB; the DFA summary stages
stay near 0.57–0.59 ms/MiB across 4–16 MiB. This input uses its proven capacity
of one record and does not exhibit the retired quadratic scan.

CPU total includes source copy, `lex_all`, and an owned record copy. GPU total
includes upload, command encoding, submission/map, and compact-record expansion.
The generated `parser.lex()` returns a lazy token tape and handles channels and
diagnostics, so its timings measure a different public surface.

Earlier kernel measurements and the retired quadratic scan are recorded in
[ADR 0001](adr/0001-webgpu-lexer-backend.md). Its older CPU rates and crossover
are historical, not backend-selection data.

### Reusing Worker Setup

`WebGpuRuntime.compileLexer()` caches equivalent plan bytes and supplies a
bounded pool of workers through `context.lex()` and `context.lexCompact()`. The
first worker decodes and packs the plan once. Additional workers share its
pipelines, bind-group layout, and immutable table buffer; mutable source,
result, parameter, and query buffers remain private. The last worker destroys
the shared table.

Plan cache keys now assemble exact byte strings in bounded numeric chunks,
avoiding per-byte string allocations. Equal copied plans and views with a
nonzero byte offset still reuse one context; distinct plan bytes remain
distinct.

On the same adapter and Deno version, twelve alternating pairs after eight
warmup pairs measured the initial cleanup against shared worker setup and the
new keys. Each sample compiles a fresh GPU Duck context on an initialized
device, then holds its first worker while acquiring three more concurrently.
Device initialization, lexing, and teardown are excluded. Cells show medians and
full ranges in milliseconds; all first-compilation pairs improved.

| operation             | initial cleanup      | reused setup         |
| --------------------- | -------------------- | -------------------- |
| compile first context | 9.76 [9.01, 10.30]   | 6.45 [6.05, 7.69]    |
| acquire three workers | 16.00 [15.28, 16.47] | 0.045 [0.040, 0.061] |

The plan has 175 DFA states and 38,324 bytes of packed lexer tables, which are
uploaded once per worker family. These warm-device timings do not replace the
cold setup measurement above or imply a comparable steady-state lexing speedup.

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
unit by unit, runs spanning three to five segments, a squeezed dispatch grid,
and a simulated floor device. The current CI workflow runs `deno task test`
without `--unstable-webgpu`, so adapter-dependent cases are skipped. The
host-side option and plan-decoding cases still run. Run the GPU gate explicitly
on a WebGPU-enabled host; software-adapter parity is correctness evidence and
does not measure hardware GPU performance.

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
