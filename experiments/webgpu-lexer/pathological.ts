/**
 * Reproduces the known worst case of this kernel design.
 *
 *   deno run --unstable-webgpu --allow-read experiments/webgpu-lexer/pathological.ts
 *
 * PASS A computes next(p) for EVERY UTF-16 offset, and the cost of next(p) is
 * O(length of the token starting at p). On normal source the mean token length
 * is ~2 codepoints so PASS A is effectively O(n). On input that is one enormous
 * token, every one of the n threads scans O(n) codepoints and PASS A becomes
 * O(n^2), while the sequential CPU lexer stays O(n).
 *
 * funcfuck's `WS = /[ \t\r\n]+/` makes this trivial to hit: a file of nothing
 * but spaces lexes to a single token.
 *
 * Parity still holds - the kernel is correct here, just asymptotically wrong.
 * "Asymptotically wrong" understates it in practice: by 1 MiB of single-token
 * input a single un-interruptible pass_a dispatch already runs for over a
 * second and is ~100x slower than lex_all, and the cost keeps squaring. The
 * table below goes far enough to make that concrete rather than extrapolated.
 *
 * This is the ONE mandatory change before any of this could be productionised:
 * per-thread scan length has to be bounded (chunked
 * (finalState, lastAcceptOffset, lastAcceptState) composition, or cap-and-fixup).
 */

import { CpuReferenceLexer, toUtf16 } from "./cpu_reference.ts";
import { WebGpuLexer } from "./gpu_lexer.ts";
import { exampleGrammar } from "./corpus.ts";

const grammar = exampleGrammar("funcfuck");
const planBytes = await Deno.readFile(grammar.planPath);
const wasmBytes = await Deno.readFile(grammar.wasmPath);
const cpu = CpuReferenceLexer.create(wasmBytes, planBytes);
const gpu = await WebGpuLexer.create(planBytes);

console.log("single-token input (funcfuck WS run): PASS A is O(n^2)");
console.log(
  [
    "chars".padStart(8),
    "tokens".padStart(7),
    "parity".padStart(7),
    "cpu ms".padStart(9),
    "pass_a ms".padStart(11),
    "gpu total ms".padStart(13),
    "gpu/cpu".padStart(9),
  ]
    .join(" "),
);
for (
  const chars of [
    16 * 1024,
    32 * 1024,
    64 * 1024,
    128 * 1024,
    256 * 1024,
    512 * 1024,
    1024 * 1024,
    2048 * 1024,
  ]
) {
  const units = toUtf16(" ".repeat(chars));
  const expected = cpu.lex(units);
  const actual = await gpu.lex(units);
  let equal = expected.records.length === actual.records.length;
  if (equal) {
    for (let index = 0; index < expected.records.length; index += 1) {
      if (expected.records[index] !== actual.records[index]) {
        equal = false;
        break;
      }
    }
  }
  const stages = actual.timings.stagesMs;
  let passA = Number.NaN;
  if (stages !== null) {
    passA = stages["pass_a_scan"];
  }
  console.log(
    [
      String(chars).padStart(8),
      String(actual.tokenCount).padStart(7),
      String(equal).padStart(7),
      expected.timings.lexAllMs.toFixed(2).padStart(9),
      passA.toFixed(2).padStart(11),
      actual.timings.totalMs.toFixed(2).padStart(13),
      `${(actual.timings.totalMs / expected.timings.lexAllMs).toFixed(1)}x`
        .padStart(9),
    ].join(" "),
  );
}
console.log("");
console.log(
  "pass_a is a single dispatch with no bound on per-thread scan length. The GPU " +
    "column is not just asymptotically worse, it is already ~100x slower than " +
    "lex_all at 1 MiB of one token.",
);
gpu.destroy();
