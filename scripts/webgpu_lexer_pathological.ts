/**
 * The kernel's former worst case, re-measured.
 *
 *   deno task bench:webgpu-lexer:pathological
 *
 * Reads `examples/funcfuck/generated/wasm/`, a gitignored local build output.
 * Run `deno task bootstrap` first on a fresh clone.
 *
 * History, because the shape of this file is the point. The original kernel
 * computed `next(p)` at every UTF-16 offset with an unbounded forward DFA scan,
 * so the cost of `next(p)` was O(length of the scan out of p). On ordinary
 * source the mean scan is ~2.5 code units and the pass was effectively O(n); on
 * input that is one enormous token every one of the n threads scanned O(n)
 * codepoints and the pass became O(n^2) inside a single un-interruptible
 * dispatch. At 2 MiB of one token that dispatch ran for 5.4 s and the lex was
 * 169x slower than `lex_all`; 16 MiB was never run at all, because a
 * multi-minute compute dispatch risks a GPU hang.
 *
 * `pass_x`/`pass_y`/`pass_z` replaced that scan. `pass_x` sweeps each segment
 * backwards with one thread per DFA state, so its cost is n*S transitions and is
 * completely independent of token length. This file now exists to show that the
 * curve is linear, not to document a defect.
 *
 * funcfuck's `WS = /[ \t\r\n]+/` makes the input trivial to construct: a file of
 * nothing but spaces lexes to a single token, so the CPU does one scan of n
 * while the old GPU pass did n scans averaging n/2.
 */

import { CpuReferenceLexer, toUtf16 } from "./webgpu_lexer_cpu_reference.ts";
import { WebGpuLexer } from "../src/runtime/webgpu/lexer.ts";
import { exampleGrammar } from "./webgpu_lexer_corpus.ts";
import { SEG_SIZE } from "../src/runtime/webgpu/kernel_wgsl.ts";

const MIB = 1024 * 1024;
const RUNS = 5;

function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("median of an empty sample");
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[sorted.length >> 1];
}

function stageMs(
  stages: Readonly<Record<string, number>> | null,
  name: string,
): number {
  if (stages === null) {
    throw new Error(
      "timestamp queries are unavailable on this device; per-stage GPU timing cannot be reported",
    );
  }
  const value = stages[name];
  if (value === undefined) {
    throw new Error(`the kernel reported no stage named ${name}`);
  }
  return value;
}

const grammar = exampleGrammar("funcfuck");
const planBytes = await Deno.readFile(grammar.planPath);
const wasmBytes = await Deno.readFile(grammar.wasmPath);
const cpu = CpuReferenceLexer.create(wasmBytes, planBytes);
const gpu = await WebGpuLexer.create(planBytes);

console.log(
  `single-token input (funcfuck WS run): states=${gpu.plan.stateCount} segSize=${SEG_SIZE} chunkSize=${gpu.chunkSize}`,
);
console.log(
  `medians of ${RUNS} runs after 1 warmup. "x+y+z" is pass_x + pass_y + pass_z, the stages that replaced the quadratic scan.`,
);
console.log("");
console.log(
  [
    "chars".padStart(9),
    "tokens".padStart(7),
    "parity".padStart(7),
    "cpu ms".padStart(9),
    "pass_x ms".padStart(10),
    "x+y+z ms".padStart(9),
    "x+y+z/MiB".padStart(10),
    "gpu total".padStart(10),
    "gpu/cpu".padStart(8),
  ].join(" "),
);

const sizes = [
  16 * 1024,
  32 * 1024,
  64 * 1024,
  128 * 1024,
  256 * 1024,
  512 * 1024,
  1 * MIB,
  2 * MIB,
  4 * MIB,
  8 * MIB,
  16 * MIB,
];

let mismatches = 0;
for (const chars of sizes) {
  const units = toUtf16(" ".repeat(chars));
  const expected = cpu.lex(units);

  const warmup = await gpu.lex(units);
  let equal = warmup.records.length === expected.records.length;
  if (equal) {
    for (let index = 0; index < expected.records.length; index += 1) {
      if (expected.records[index] !== warmup.records[index]) {
        equal = false;
        break;
      }
    }
  }
  if (!equal) {
    mismatches += 1;
  }

  const cpuSamples: number[] = [];
  const passXSamples: number[] = [];
  const sweepSamples: number[] = [];
  const totalSamples: number[] = [];
  let tokenCount = warmup.tokenCount;
  for (let run = 0; run < RUNS; run += 1) {
    cpuSamples.push(cpu.lex(units).timings.lexAllMs);
    const actual = await gpu.lex(units);
    tokenCount = actual.tokenCount;
    const stages = actual.timings.stagesMs;
    const passX = stageMs(stages, "pass_x_sweep");
    const passY = stageMs(stages, "pass_y_segscan");
    const passZ = stageMs(stages, "pass_z_finalize");
    passXSamples.push(passX);
    sweepSamples.push(passX + passY + passZ);
    totalSamples.push(actual.timings.totalMs);
  }

  const cpuMs = median(cpuSamples);
  const sweepMs = median(sweepSamples);
  const totalMs = median(totalSamples);
  console.log(
    [
      String(chars).padStart(9),
      String(tokenCount).padStart(7),
      String(equal).padStart(7),
      cpuMs.toFixed(2).padStart(9),
      median(passXSamples).toFixed(2).padStart(10),
      sweepMs.toFixed(2).padStart(9),
      (sweepMs / (chars / MIB)).toFixed(2).padStart(10),
      totalMs.toFixed(2).padStart(10),
      `${(totalMs / cpuMs).toFixed(2)}x`.padStart(8),
    ].join(" "),
  );
}

console.log("");
if (mismatches > 0) {
  console.error(
    `PARITY FAILURE: ${mismatches} of ${sizes.length} sizes did not match lex_all.`,
  );
  gpu.destroy();
  Deno.exit(1);
}
console.log(
  "x+y+z/MiB is the linearity check. It falls to a floor and stays within a small " +
    "constant of it; it does NOT double from row to row. The removed scan's " +
    "equivalent column did double from row to row (369, 699, 1368, 2708 ms/MiB at " +
    "0.25/0.5/1/2 MiB), which is what O(n^2) looks like in this column.",
);
console.log(
  "Two artefacts to read past. Below ~1 MiB, pass_x is pinned at its latency " +
    "floor: each workgroup walks SEG_SIZE code units serially, so a segment costs " +
    "the same wall time whether the input has four segments or four thousand. And " +
    "below ~1 MiB the gpu/cpu column is set by the ~12 ms host<->device " +
    "synchronization floor rather than by this input being hard, which is the same " +
    "floor every other size pays.",
);
gpu.destroy();
