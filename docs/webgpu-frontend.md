# WebGPU Frontend

Status: experimental. See [Stability](stability.md#experimental-surfaces).

The WebGPU frontend is an opt-in runtime for grammars that the compiler can
partition into lexically locatable islands. It executes lexing, structural
matching, island recognition, reachable-node allocation, edge emission, and
diagnostic ordering in one command submission and reads the result with one
`mapAsync()` call. Host code then applies semantic recipes to the compact flat
IR. It is not a replacement for the generated synchronous parser.

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

runtime.dispose();
```

There is no automatic CPU fallback and no partial program on failure. Use
`CpuFrontend.create(plan)` explicitly when the caller wants the byte-parity
oracle or owns a fallback policy. A runtime should be reused: adapter and device
creation are far too expensive to repeat for each source.

`ingest()` sizes its device buffers before submission. An input that exceeds a
buffer, binding, or dispatch limit raises `GpuFrontendCapacityError` naming the
buffer and adapter limit. `lexerCapacityRecords`, `maxNodes`, and `maxEdges`
allow a caller with tighter proven bounds to avoid worst-case allocation.

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

Avoid using the GPU frontend for a single small file, one source containing a
single enormous island, heavy overlap between island FIRST sets, or grammars
that need contextual token identity. Deep nesting is valid, but broad
independent nesting exposes more work than a skewed chain.

`inspectGpuFrontendPlan()` exposes the values that matter before acquiring a
device:

- `lexerStates`: a direct multiplier in the current parallel DFA summary pass;
- `maxCandidateMultiplicity`: the worst number of island candidates allocated
  per token;
- `denseTransitionBytes`: immutable device table size;
- `contractionRounds`: the fixed dispatch bound;
- `scratchExpansionFactors`: worst-case region, candidate, summary, node, edge,
  and diagnostic allocation per token;
- `packedBytes`: the version-3 runtime section size.

GPU Duck currently has candidate multiplicity 9. Its affine candidate records
therefore reserve nine candidate slots per token even when most locators do not
match. That is the clearest memory-bandwidth target in the current
implementation.

## Current Measurement

The reproducible command is:

```sh
WGPU_BACKENDS=vulkan WGPU_POWER_PREF=high \
  deno task bench:webgpu-frontend --warmup 2 --runs 7
```

The benchmark verifies byte parity before timing, prints progress to stderr, and
emits JSON containing adapter limits, plan expansion factors, actual compact
output bytes, full sample ranges, and per-stage device timestamps when the
adapter supports timestamp queries.

One NVIDIA GeForce RTX 4080 SUPER run with driver 610.43.03 measured the broad
GPU Duck corpus as follows. These are end-to-end medians after two warmups, not
portable crossover promises.

| source | CPU oracle | WebGPU frontend | speedup |
| ------ | ---------: | --------------: | ------: |
| 1 MiB  |  335.86 ms |       115.50 ms |   2.91x |
| 4 MiB  | 1434.30 ms |       395.48 ms |   3.63x |
| 16 MiB | 7945.77 ms |      2023.21 ms |   3.93x |

At 16 MiB, one timestamp sample attributed 303.27 ms to lexing, 0.80 ms to
structure, 38.26 ms to contraction, 16.72 ms to reachability, 15.71 ms to
allocation, and 1.62 ms to staging. Device work and end-to-end time differ
because upload, mapping, typed-array ownership, host semantic validation, and
driver scheduling are outside those timestamps.

## Comparison with Parallel Parsers

The closest published systems solve related but different problems, so their
headline throughput is not directly comparable with Baba's full token/node/edge
parity workload.

| system                                                                           | parallelism contract                                                                                                                                                                                                                      | lesson for Baba                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PAPAGENO](https://pradella.faculty.polimi.it/papers/cc2014.pdf)                 | Generates multicore parsers for operator-precedence grammars whose local parsability permits independent substring reductions.                                                                                                            | A stricter locally parsable grammar class can remove candidate search and make arbitrary partitions safe. Baba's declared islands retain broader grammar freedom but pay for locator candidates and contraction.                   |
| [ParPaRaw](https://www.vldb.org/pvldb/vol13/p616-stehle.pdf)                     | Splits delimiter-separated input into equal chunks, simulates DFA context in parallel, accumulates metadata, and streams transfers around GPU work.                                                                                       | Baba already composes finite-state lexer summaries. It should apply bounded chunk summaries to long islands and consider streaming only as an alternative API, because streaming requires multiple submissions and readbacks.      |
| [Pareas](https://futhark-lang.org/student-projects/robin-voetter-msc-thesis.pdf) | Runs lexing, LLP parsing, tree construction, and semantic analysis on the GPU for a deliberately restricted C-like language. Its grammar is reshaped for parallel parsing, including explicit braces and later tree-restructuring passes. | Grammar restrictions are a valid performance feature. An optional strict profile could require flat expressions and independently locatable root segments instead of making every eligible grammar pay the general candidate cost. |
| [RAPIDS cuDF](https://github.com/rapidsai/cudf)                                  | Parses format-specific tabular input into data that subsequent operators continue to consume on the GPU; [GPUDirect Storage](https://developer.nvidia.com/blog/?p=47682) can bypass CPU staging for storage-to-GPU transfers.             | The largest end-to-end opportunity is a GPU-resident program handle followed by device semantic/lowering passes, not a faster copy of the same owned host arrays.                                                                  |

PAPAGENO targets CPU threads, ParPaRaw and cuDF parse data formats rather than
programming languages, and the Pareas evaluation does not provide a like-for-
like production compiler baseline. The comparison supports architectural
choices; it does not establish a cross-system speed ranking.

## Ranked Improvement Directions

1. **Compact candidates before recognition.** Flag located candidates, scan them
   into dense IDs, and split hot reachability fields from cold transducer
   summaries. This attacks the current multiplicity-sized affine allocation and
   should improve both capacity and bandwidth for broad files.
2. **Compose long islands by chunk.** For regions above one workgroup, summarize
   bounded chunks for each possible entry state, scan those functions, and
   replay with resolved states. Enable it only below a compiler-selected state
   threshold so simultaneous-state simulation does not cost more than serial
   recognition.
3. **Keep the program resident.** Add a separate GPU-resident result surface and
   move semantic validation or lowering behind it. This changes ownership and
   API expectations but removes the compulsory full IR readback when the next
   consumer is also a GPU pass.
4. **Minimize lexer state work.** DFA minimization and compiler inspection of
   `source length * lexerStates` reduce the dominant current kernel without
   specializing for GPU Duck or Funcfuck.
5. **Offer a strict throughput profile.** Require one locatable root repetition,
   non-self-nesting repeated islands, explicit structural boundaries, and
   bounded prefix/suffix syntax. That permits flag-and-scan root allocation
   instead of general candidate ranking.
6. **Stream only for streaming consumers.** Overlapping source upload, compute,
   and result transfer is valuable for very large record streams, but it
   conflicts with the current one-submission, one-map ingestion contract and
   owned whole-program arrays.

The first two directions preserve the public `ingest()` result. The third and
sixth require a distinct API rather than hidden behavior changes.
