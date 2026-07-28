# WebGPU Lexer Backend

Status: experimental. See [Stability](stability.md#experimental-surfaces).

`@mewhhaha/baba/runtime/webgpu` includes a second implementation of the
generated parser's tokenizer that runs on the GPU. It is a **runtime backend,
not a generate target**: it consumes a `parser.plan` that ships today, produces
the identical token records, and emits no artifacts of its own.

Read the measurement rules below before adopting it. The only published hardware
run predates the current Wasm lexer throughput optimization, so it is historical
evidence about the kernel shape—not a current crossover threshold. Its one-time
setup cost is still not repaid by a single document.

## What It Is

Baba's shipping lexer is `fn lex_all` in the generated `parser.wasm`. It emits
token records of four `i32`: `{ specIndex, start, end, acceptingState }`. This
backend produces the same four-`i32` records, in the same order, with the same
values, from the same plan bytes.

Nothing has to be regenerated. There is no plan-format change, no grammar
change, and no semantic difference. Terminal identity is still resolved by the
parser at parse time from `(acceptingState, LR state)`, exactly as before.

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

All four shipped example grammars are guard-free.

**Device headroom.** Every binding, buffer and dispatch grid is preflighted
against `device.limits` before anything is allocated, and an input that does not
fit raises `GpuLexerCapacityError` naming the limit, the requirement and the
device's value. The benchmark prints the actual worst-case capacity and skips
unsupported sizes as explicit rows; it never converts a capacity error into a
partial result. At the WebGPU-guaranteed floor, worst-case output capacity is
about 16.8 million UTF-16 units.

## Historical Performance

This historical run used NVIDIA GeForce RTX 4080 SUPER, Deno 2.9.4 / wgpu on
Linux, grammar `funcfuck`, randomized source, medians of seven runs after two
warmups, and worst-case output capacity with owned records. It predates the
current Wasm lexer optimization and compact-record transfer, so it must not be
used to select the backend or claim a current CPU/GPU speedup. Sizes are UTF-16
code units.

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

**The historical crossover was 896 KiB of source.** Below it the backend lost,
and at the small end it loses by more than an order of magnitude. A finer sweep
reads 0.90x at 768 KiB, 1.04x at 896 KiB, 1.13x at 1 MiB and 1.34x at 1.25 MiB.
On the stricter comparison of the worst observed GPU sample against the best
observed CPU sample, the crossover is 1.25 MiB.

That historical crossover moved up from 768 KiB after the Rust lexer stopped
falling through the dense ASCII table into the sparse range scan. That made
`lex_all` faster - about 48-50 MiB/s where it previously measured 44-48 - so the
CPU side of this comparison improved and the GPU had further to climb. The table
above still carries the pre-change GPU column; only the crossover and the CPU
rate were re-measured. Any future engine change moves this number again, which
is the general point: this backend is only ever ahead by a factor that the CPU
lexer can erode.

The reason the small end was flat is that the dominant cost was neither compute
nor bandwidth. It is host-device synchronization: `await mapAsync()` costs about
11.3 ms on this stack regardless of payload size. At 16 KiB, 98% of the wall
clock is that one wait. The whole pipeline is therefore one command encoder, one
`queue.submit()` and one `mapAsync()`, and it still cannot get under the floor.

Cross-check on a second grammar (`thunkwasm`, periodic input): 0.94x at 1 MiB,
2.05x at 16 MiB. It is slower than `funcfuck` despite having fewer DFA states
(65 against 81), because the kernel's per-state table read has a data-dependent
shared-memory bank pattern. **State count alone does not predict cost**, though
it is a direct multiplier: the central pass costs `n * stateCount` by
construction.

### Historical Setup Cost

| step                                        | cost      |
| ------------------------------------------- | --------- |
| `requestAdapter`                            | 138.79 ms |
| `requestDevice`                             | 82.01 ms  |
| tables, shader module, pipelines            | ~4 ms     |
| **total `WebGpuLexer.create`**              | 226.06 ms |
| the Wasm engine's equivalent, for reference | 0.342 ms  |

That was 660x the CPU engine's setup. The per-call saving at the crossover was
about 0 ms, and even the 16 MiB case saves only ~228 ms, which is roughly one
device init. **No single document repays setup.** The backend is only defensible
in a long-lived process that lexes repeatedly, and a device should be shared
across every lexer that needs one.

### The Benchmark Baseline Matters

The historical CPU column above is raw `lex_all` records, not `parser.lex()`,
which also materializes the token tape and `Token` objects. The current
benchmark makes the headline comparison stricter: CPU time is source copy +
`lex_all` + owned raw-record copy, while GPU time is upload + encode +
submit/map + compact-record expansion. It retains raw `lex_all` time only as a
diagnostic. String-to-UTF-16 conversion is measured separately on both paths.
Using `parser.lex()` would measure different work and artificially flatter the
GPU result.

## Honest Reporting

**Dispersion is large and unmodelled.** Two full runs over identical bytes at 16
MiB produced 133.87 ms / 2.49x and 132.16 ms / 2.73x; the central pass alone
swung 29% between them, and a third measurement of the same stage in a sweep
landed 35% lower again. The GPU concurrently drove a desktop, and no clock
pinning or GPU isolation was applied. Read every single-number speedup in this
document as +/- 15%, and state any performance gate with dispersion rather than
as a median.

**One adapter, one stack.** Every number here is from a single NVIDIA GPU under
Deno's wgpu on Linux. No second GPU, driver or WebGPU implementation has been
measured.

**Not measured at all:**

- the synchronization floor in Chrome/Dawn or Firefox on real GPU hardware. The
  ~11.3 ms floor is a property of the measured stack and it is what sets the
  crossover. A host with a ~1 ms floor would move the crossover by roughly an
  order of magnitude, but that is an estimate by substitution, not a result;
- floor-device throughput. Floor-device _behaviour_ is simulated and tested; its
  _speed_ is unmeasured. Compact output makes the 16 MiB row capacity-feasible
  at the spec floor, but it remains unmeasured there;
- readback cost on a non-Deno host. Its per-byte cost is discontinuous in the
  Deno data, so the claim that it "disappears in a browser" is untested;
- any real Baba source file at these sizes. The largest program in this
  repository is 224 bytes. All throughput input is synthetic and about three
  orders of magnitude below the crossover.

**Worst-case device allocation is roughly 15x the UTF-16 source bytes.** Per
UTF-16 unit this is 2 B of source, 12 B across the three per-position arrays, 8
B of compact records and 8 B of staging—about 30 B total. The owned public
four-word host result adds up to another 16 B per emitted record, so a
one-token-per-unit input reaches roughly 23x across device and host memory.

**`parse()` no longer fails below the sizes this backend targets.** It used to
throw above roughly 8 KiB of repetition-heavy source, misrecorded here as
"roughly 750 KiB". Cursor materialization is now linear in the token count and
`examples/brainfuck`, the densest possible shape, parses 6 MiB; an input that
still does not fit reports `PARSER_INPUT_TOO_LARGE` rather than throwing. See
`docs/limits.md`.

## Correctness

Parity is byte equality of the record array against `lex_all`, not a semantic
argument: record count plus every field of every record.

`tests/webgpu_lexer_parity_test.ts` is the gate. It compiles its grammar inline,
so it needs nothing on disk, and covers the empty string, error tokens, lone and
paired surrogates, above-ASCII classes, longest-match backtracking, unterminated
constructs, 9000-unit single tokens, both grid boundaries swept unit by unit,
runs spanning three to five segments, a squeezed dispatch grid, and a simulated
floor device. **It does not run in CI, because CI has no GPU adapter**, so a
green CI run is not evidence that GPU parity holds.

`deno task parity:webgpu-lexer` is the wider sweep across the four shipped
example grammars, with multi-MiB corpora and failure-mode guards. It needs
`deno task bootstrap` to have generated the example artifacts first.

## Benchmarks

```sh
deno task bench:webgpu-lexer
deno task bench:webgpu-lexer --grammar thunkwasm --runs 7 --json out.json
deno task bench:webgpu-lexer:pathological
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
