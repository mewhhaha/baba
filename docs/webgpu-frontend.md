# WebGPU Frontend

Status: experimental. See [Stability](stability.md#experimental-surfaces).

The WebGPU frontend is an opt-in runtime for grammars that the compiler can
partition into lexically locatable islands. It executes lexing, structural
matching, island recognition, reachable-node allocation, edge emission, and
diagnostic ordering in one command submission and reads the result with one
`mapAsync()` call. Host code then applies semantic recipes to the compact flat
IR. `ingestResident()` instead keeps the staged syntax IR on the device with no
map. Neither API is a replacement for the generated synchronous parser.

The profile is deliberately narrower than Baba's ordinary grammar support. That
restriction is what lets the compiler emit parallel work instead of running a
conventional parser stack in one GPU invocation.

## Using It

Add a version-3 `gpuFrontend` profile to `baba.json`, regenerate the Wasm
target, and compile the resulting `parser.plan` into a long-lived runtime:

```ts
import {
  CpuFrontend,
  inspectGpuFrontendPlan,
  WebGpuRuntime,
} from "@mewhhaha/baba/runtime/webgpu";

const plan = await Deno.readFile("generated/wasm/parser.plan");
const inspection = inspectGpuFrontendPlan(plan);
if (inspection === null) {
  throw new Error("parser.plan has no version-3 GPU frontend section");
}

const runtime = await WebGpuRuntime.create({
  powerPreference: "high-performance",
});
const frontend = await runtime.compileFrontend(plan);
const result = await frontend.ingest(source);

if (!result.ok) {
  console.error(result.diagnostics);
} else {
  console.log(result.program.nodes);
  console.log(result.timings);
}

frontend.dispose();
runtime.dispose();
```

There is no automatic CPU fallback and no partial program on failure. Use
`CpuFrontend.create(plan)` explicitly when the caller wants the byte-parity
oracle or owns a fallback policy. A runtime should be reused: adapter and device
creation are far too expensive to repeat for each source.

Compiled frontends own grow-only execution buffers. Dispose a frontend when its
session ends; disposing the runtime also disposes every remaining frontend.
Neither operation is allowed while an ingestion or resident result is active.

`ingest()` sizes its device buffers before submission. An input that exceeds a
buffer, binding, or dispatch limit raises `GpuFrontendCapacityError` naming the
buffer and adapter limit. `lexerCapacityRecords`, `maxNodes`, and `maxEdges`
allow a caller with tighter proven bounds to avoid worst-case allocation.

### Keeping the Syntax IR on the GPU

Use the resident surface only when a downstream GPU pass understands Baba's flat
buffer layout. Pass UTF-16 units directly when the caller already owns them:

```ts
const resident = await frontend.ingestResident(sourceUnits);
try {
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: resident.buffer } },
      ],
    }),
  );
  pass.dispatchWorkgroups(workgroups);
  pass.end();
  device.queue.submit([encoder.finish()]);
} finally {
  resident.dispose();
}
```

`resident.layout` gives the status/count header words, capacity-sized token,
node, and edge offsets, and total byte length. Status and actual counts are
device values; the host does not learn whether syntax succeeded. Semantic
recipes, symbols, types, and diagnostics are therefore not materialized on the
host. The result holds its execution slot and runtime lease until `dispose()`,
which prevents its buffer from being overwritten or its device from being
destroyed while a caller owns it. `ingestResident()` returns after queue
submission rather than completion. Submit consumers to the same queue before
`dispose()`; a reused slot waits for its pending submission before recycling or
growing buffers.

Default ingestion batches dependent kernels into one lexer pass and two island
passes around the device-written indirect-dispatch copy. Set
`stageTimings: "collect"` on `ingest()` to restore per-dispatch timestamp
queries for profiling. Timestamp collection deliberately stays outside measured
benchmark runs because its pass boundaries change the workload being measured.

## Grammar Requirements

Generation accepts a profile only when it can prove:

1. The configured root is the parser root and the first declared island.
2. Every token has a fixed terminal identity. Contextual tokens and trailing
   lookahead guards are rejected.
3. Parser actions are deterministic after conflict resolution.
4. Each island has a non-empty, lexically identifiable FIRST set.
5. Boundary spellings each resolve to exactly one lexical terminal.
6. Paired structures have an unambiguous opener-to-closer mapping. An opener
   cannot also be a closer.
7. A separated structure uses distinct opener, closer, and separator terminals.
8. Replacing nested islands with typed placeholders leaves a deterministic
   finite transducer with bounded output.
9. The contracted grammar has no residual recursion, ambiguous transducer
   output, or zero-width output cycle.
10. Dense transition rows, semantic recipes, contraction descriptors, output
    bounds, and the packed plan remain within configured limits.

These are compile-time requirements. The runtime does not guess boundaries,
apply longest-match rules among candidate island types, or silently fall back to
a scalar parser.

The metadata shape and exact rejection behavior are documented under
[GPU Frontend Profile](metadata.md#gpu-frontend-profile). GPU Duck and Funcfuck
are complete profiles with different grammar shapes.

Set `"throughput": "strict"` when the root has exactly one repeated island with
an explicit structural boundary and that island is not self-nesting. Generation
rejects the setting unless it can persist that root loop as an execution fact.
The general profile remains available for roots such as Funcfuck's that do not
have one repeated-island loop.

Strict deployments can set `limits.maxContractionRounds` below the default 33.
Each omitted round removes one contraction dispatch and one reachability
dispatch, while also excluding source inputs with a deeper nested-island chain.
This is an input contract, not a heuristic: choose it from corpus parity tests
that include the deepest accepted nesting. GPU Duck retains the default because
its mutually recursive expression, type, and pattern islands need the complete
budget even for ordinary declarations.

## Grammar Shape for Throughput

Eligibility does not imply useful GPU occupancy. Prefer source and grammar
shapes with:

- hundreds or thousands of independent root-level declarations or records;
- explicit terminators for variable-width constructs;
- typed paired delimiters for nesting;
- distinct FIRST terminals for alternative island types;
- flat operand/operator or element sequences inside each region;
- a small lexer DFA and small island transducers;
- predictable token, node, and edge ratios.

Avoid using the GPU frontend for a single small file, heavy overlap between
island FIRST sets, or grammars that need contextual token identity. A large
terminal-only island can use chunk composition when its transducer has at most
seven states. Islands with more states or nested placeholders retain the serial
per-region path, so broad independent nesting still exposes more work than a
skewed chain.

`inspectGpuFrontendPlan()` exposes the values that matter before acquiring a
device:

- `lexerStates`: a direct multiplier in the current parallel DFA summary pass;
- `throughput` and `rootLoopIsland`: whether strict root-loop proofs succeeded;
- `parallelLongRegionIslands`: islands eligible for bounded chunk composition;
- `maxCandidateMultiplicity`: the worst number of island candidates allocated
  per token;
- `denseTransitionBytes`: immutable device table size;
- `contractionRounds`: the configured nested-island dispatch bound;
- `scratchExpansionFactors`: worst-case region, candidate, summary, node, edge,
  and diagnostic allocation per token;
- `packedBytes`: the version-3 runtime section size.

GPU Duck currently has candidate multiplicity 9. The reusable buffers still
reserve that worst-case capacity because the actual token terminals are not
known until the one submission is running. Recognition now flags those slots,
scans real locators into dense candidate IDs, and uses indirect dispatches sized
from the device count. The remaining affine cost is reserved capacity plus a
one-word lookup per potential slot, not sixteen hot candidate words processed
for every slot.

## Current Measurement

The reproducible command is:

```sh
WGPU_BACKENDS=vulkan WGPU_POWER_PREF=high \
  deno task bench:webgpu-frontend --warmup 2 --runs 7
```

Add `--resident` to time the no-map resident surface alongside owned `ingest()`.

The benchmark verifies byte parity before timing, prints progress to stderr, and
emits JSON containing adapter limits, plan expansion factors, actual compact
output bytes, full sample ranges, owned source/GPU/semantic phases, resident
submission timing, and a separate per-stage timestamp profile when the adapter
supports timestamp queries.

The current broad GPU Duck corpus measured on an NVIDIA GeForce RTX 4080 SUPER
with driver 610.43.03 as follows. Each cell is the median and full range of
seven runs after two warmups. Parity was verified before every size. These are
not portable crossover promises.

| source | CPU oracle                    | owned `ingest()`           | owned speedup |
| ------ | ----------------------------- | -------------------------- | ------------- |
| 1 MiB  | 351.61 ms [316.19, 367.35]    | 39.80 ms [32.20, 45.71]    | 8.84x         |
| 4 MiB  | 1742.67 ms [1454.76, 1911.74] | 153.32 ms [130.61, 346.36] | 11.37x        |
| 16 MiB | 6060.33 ms [5631.99, 7489.94] | 769.39 ms [605.48, 787.22] | 7.88x         |

The timestamped device work was 16.30, 22.54, and 91.10 ms respectively; queue
completion, the single map, compact-array copies, and host semantics account for
the rest of owned latency. Reusing one resident slot submitted in median 0.46,
0.50, and 0.48 ms for 1, 4, and 16 MiB, with full ranges of [0.43, 0.58], [0.45,
0.68], and [0.45, 0.71] ms. Resident submission is not a full parse latency or
CPU-oracle speedup because it deliberately stops before device completion,
mapped readback, and host semantic recipes.

## Comparison with Parallel Parsers

The closest published systems solve related but different problems, so their
headline throughput is not directly comparable with Baba's full token/node/edge
parity workload.

| system                                                                           | parallelism contract                                                                                                                                                                                                                      | lesson for Baba                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PAPAGENO](https://pradella.faculty.polimi.it/papers/cc2014.pdf)                 | Generates multicore parsers for operator-precedence grammars whose local parsability permits independent substring reductions.                                                                                                            | A stricter locally parsable grammar class can remove candidate search and make arbitrary partitions safe. Baba's declared islands retain broader grammar freedom but pay for locator candidates and contraction. |
| [ParPaRaw](https://www.vldb.org/pvldb/vol13/p616-stehle.pdf)                     | Splits delimiter-separated input into equal chunks, simulates DFA context in parallel, accumulates metadata, and streams transfers around GPU work.                                                                                       | Baba now applies bounded all-entry-state chunk summaries to compiler-selected long islands. Streaming remains a different API because it requires multiple submissions and readbacks.                            |
| [Pareas](https://futhark-lang.org/student-projects/robin-voetter-msc-thesis.pdf) | Runs lexing, LLP parsing, tree construction, and semantic analysis on the GPU for a deliberately restricted C-like language. Its grammar is reshaped for parallel parsing, including explicit braces and later tree-restructuring passes. | Baba's strict throughput profile similarly turns a grammar restriction into a compiler proof. Owned results now validate recipes directly over compact arrays; moving that catalog to the GPU remains optional.  |
| [RAPIDS cuDF](https://github.com/rapidsai/cudf)                                  | Parses format-specific tabular input into data that subsequent operators continue to consume on the GPU; [GPUDirect Storage](https://developer.nvidia.com/blog/?p=47682) can bypass CPU staging for storage-to-GPU transfers.             | `ingestResident()` accepts upload-ready UTF-16 units and returns after submission, so same-queue consumers no longer pay a host completion fence or compulsory readback.                                         |

PAPAGENO targets CPU threads, ParPaRaw and cuDF parse data formats rather than
programming languages, and the Pareas evaluation does not provide a like-for-
like production compiler baseline. The comparison supports architectural
choices; it does not establish a cross-system speed ranking.

## Implemented Optimization Boundaries

1. **Dense candidates.** Located slots are prefix-scanned into stable dense IDs.
   Candidate-domain work uses indirect dispatch counts. Worst-case reusable
   allocation remains necessary unless a caller supplies a tighter capacity.
2. **Long islands.** Terminal-only transducers with at most seven states
   summarize 256 chunks for every entry state, then compose those functions.
   Larger or placeholder-bearing islands keep the serial per-region path because
   simultaneous-state overhead or child spans would dominate.
3. **Resident syntax IR.** `ingestResident()` exposes the device buffer without
   a map. Baba semantic recipes still run only on the host-owned `ingest()`
   path.
4. **Lexer minimization.** The compiler merges DFA states only when their full
   accepting-candidate sets and future transitions agree. GPU Duck falls from
   187 to 175 lexer states; contextual candidate behavior remains observable.
5. **Strict root throughput.** The optional strict profile proves and persists
   one non-self-nesting repeated root island with an explicit boundary.
6. **Batched dispatches.** Normal ingestion uses three dependent compute passes.
   Per-dispatch pass boundaries remain an explicit profiling mode.
7. **Compact host semantics.** Owned ingestion validates recipes directly over
   the eight-word nodes and four-word edges without rebuilding an object graph.
8. **Queue-ordered resident work.** Resident ingestion returns after submit and
   accepts pre-encoded UTF-16 units. Slot reuse waits for completion before
   recycling its buffers.
9. **Explicit contraction budget.** Flat strict grammars can lower
   `maxContractionRounds` and remove two dispatches per round. GPU Duck cannot:
   its mutually recursive island graph needs all 33 rounds on the shipped
   corpus. Reducing that tax requires flattening expression, type, and pattern
   islands or giving them distinct non-recursive boundaries.

Transfer streaming and device semantic/lowering passes remain separate future
work. The principal owned-result cost is now the required one-map round trip and
copy into caller-owned arrays. Reducing it generally requires tighter
caller-proven capacities, a disposable mapped-result API, or relaxing the
one-map whole-program contract.
