/**
 * CPU (Wasm `lex_all`) vs GPU (WebGPU kernel) lexing throughput.
 *
 *   deno run --unstable-webgpu --allow-read --allow-write experiments/webgpu-lexer/bench.ts
 *   deno run --unstable-webgpu --allow-read --allow-write experiments/webgpu-lexer/bench.ts --json out.json
 *
 * Every reported number is a median of `--runs` measured iterations after
 * `--warmup` discarded iterations, and every median is printed with the observed
 * [min..max] of the same samples. The raw per-run samples are written to the
 * JSON output so a median can be re-derived and the spread audited.
 *
 * Three GPU configurations are measured so that every cost is attributable to
 * exactly one decision:
 *
 *   1. "worst-case, owned"    capacity = one token per UTF-16 code unit (can
 *                             never overflow) and the records are copied into an
 *                             owned Int32Array. Most conservative; this is what
 *                             parity.ts runs. THE HEADLINE.
 *   2. "worst-case, borrowed" same capacity, records returned as a view into the
 *                             mapped staging range. What a real backend
 *                             integration would do. The gap against (1) is the
 *                             cost of materializing an owned array.
 *   3. "oracle-tuned"         capacity = the exact token count, obtained by
 *                             lexing the same input first. NO REAL CALLER CAN DO
 *                             THIS - it is an oracle, not an estimate. The gap
 *                             against (2) is the cost of conservative sizing.
 *
 * The headline is (1) rather than (3) because (3) was previously used for the
 * speedup column, the MiB/s column and the crossover verdict, which flattered
 * every one of them.
 *
 * One-time setup cost (adapter, device, shader compile, pipelines, dense
 * alphabet tables) is measured and printed. It is NOT amortized into any
 * throughput number; it is ~200 ms on the measured stack against ~0.5 ms for the
 * Wasm engine, which is more than the per-call saving at any size near the
 * crossover.
 */

import { CpuReferenceLexer, toUtf16 } from "./cpu_reference.ts";
import { type GpuLexResult, WebGpuLexer } from "./gpu_lexer.ts";
import {
  exampleGrammar,
  randomizedFuncfuckSource,
  readExamplePrograms,
  repeatToSize,
} from "./corpus.ts";

const KIB = 1024;
const MIB = 1024 * 1024;

interface Options {
  readonly grammar: string;
  readonly runs: number;
  readonly warmup: number;
  readonly sizes: readonly number[];
  readonly jsonPath: string | null;
}

function parseArgs(): Options {
  let grammar = "funcfuck";
  let runs = 5;
  let warmup = 2;
  let jsonPath: string | null = null;
  let sizes = [
    16 * KIB,
    32 * KIB,
    64 * KIB,
    128 * KIB,
    256 * KIB,
    512 * KIB,
    1 * MIB,
    4 * MIB,
    16 * MIB,
  ];
  const args = Deno.args;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--grammar" && index + 1 < args.length) {
      grammar = args[index + 1];
      index += 1;
      continue;
    }
    if (args[index] === "--runs" && index + 1 < args.length) {
      runs = Number(args[index + 1]);
      index += 1;
      continue;
    }
    if (args[index] === "--warmup" && index + 1 < args.length) {
      warmup = Number(args[index + 1]);
      index += 1;
      continue;
    }
    if (args[index] === "--json" && index + 1 < args.length) {
      jsonPath = args[index + 1];
      index += 1;
      continue;
    }
    if (args[index] === "--sizes" && index + 1 < args.length) {
      sizes = args[index + 1].split(",").map((value) => Number(value));
      index += 1;
    }
  }
  return { grammar, runs, warmup, sizes, jsonPath };
}

interface Stat {
  readonly median: number;
  readonly min: number;
  readonly max: number;
  readonly samples: readonly number[];
}

function stat(values: readonly number[]): Stat {
  if (values.length === 0) {
    throw new Error("statistics of an empty sample");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  let median = sorted[middle];
  if (sorted.length % 2 === 0) {
    median = (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return {
    median,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    samples: [...values],
  };
}

function mibPerSecond(chars: number, ms: number): number {
  if (ms <= 0) {
    return Infinity;
  }
  return (chars / MIB) / (ms / 1000);
}

function fmt(value: number, digits = 2): string {
  return value.toFixed(digits);
}

/** "12.34 [11.90..19.02]" - median plus the observed spread of the same samples. */
function fmtSpread(value: Stat, digits = 2): string {
  return `${fmt(value.median, digits)} [${fmt(value.min, digits)}..${
    fmt(value.max, digits)
  }]`;
}

function sizeLabel(chars: number): string {
  if (chars >= MIB) {
    return `${chars / MIB} MiB`;
  }
  return `${chars / KIB} KiB`;
}

interface SizeResult {
  readonly chars: number;
  readonly label: string;
  readonly tokens: number;
  readonly cpuWriteSourceMs: Stat;
  readonly cpuLexAllMs: Stat;
  readonly cpuTotalMs: Stat;
  readonly cpuMiBPerSec: number;
  readonly gpuWorstCaseOwned: GpuSample;
  readonly gpuWorstCaseBorrowed: GpuSample;
  readonly gpuTunedOracle: GpuSample;
  readonly utf16ConvertMs: number;
}

interface GpuSample {
  readonly capacityRecords: number;
  readonly uploadMs: Stat;
  readonly encodeMs: Stat;
  readonly submitAndSyncMs: Stat;
  readonly mapRangeMs: Stat;
  readonly copyOutMs: Stat;
  readonly readbackMs: Stat;
  readonly totalMs: Stat;
  readonly miBPerSec: number;
  readonly stagesMs: Record<string, Stat>;
  readonly gpuStagesTotalMs: Stat;
}

function summarizeGpu(
  samples: readonly GpuLexResult[],
  chars: number,
  capacityRecords: number,
): GpuSample {
  const firstStages = samples[0].timings.stagesMs;
  if (firstStages === null) {
    throw new Error(
      "timestamp queries are unavailable on this device; per-stage GPU timing cannot be reported",
    );
  }
  const stageNames = Object.keys(firstStages);
  const stagesMs: Record<string, Stat> = {};
  for (const name of stageNames) {
    stagesMs[name] = stat(
      samples.map((sample) => {
        const stages = sample.timings.stagesMs;
        if (stages === null) {
          throw new Error("timestamp queries are unavailable on this device");
        }
        return stages[name];
      }),
    );
  }
  const gpuStagesTotalMs = stat(
    samples.map((sample) => {
      const total = sample.timings.gpuStagesTotalMs;
      if (total === null) {
        throw new Error("timestamp queries are unavailable on this device");
      }
      return total;
    }),
  );
  const totalMs = stat(samples.map((sample) => sample.timings.totalMs));
  return {
    capacityRecords,
    uploadMs: stat(samples.map((sample) => sample.timings.uploadMs)),
    encodeMs: stat(samples.map((sample) => sample.timings.encodeMs)),
    submitAndSyncMs: stat(
      samples.map((sample) => sample.timings.submitAndSyncMs),
    ),
    mapRangeMs: stat(samples.map((sample) => sample.timings.mapRangeMs)),
    copyOutMs: stat(samples.map((sample) => sample.timings.copyOutMs)),
    readbackMs: stat(samples.map((sample) => sample.timings.readbackMs)),
    totalMs,
    miBPerSec: mibPerSecond(chars, totalMs.median),
    stagesMs,
    gpuStagesTotalMs,
  };
}

async function main(): Promise<void> {
  const options = parseArgs();
  const grammar = exampleGrammar(options.grammar);
  const planBytes = await Deno.readFile(grammar.planPath);
  const wasmBytes = await Deno.readFile(grammar.wasmPath);

  const cpuSetupStart = performance.now();
  const cpu = CpuReferenceLexer.create(wasmBytes, planBytes);
  const cpuSetupMs = performance.now() - cpuSetupStart;
  const gpu = await WebGpuLexer.create(planBytes);
  const setup = gpu.setupTimings;

  console.log(
    `grammar=${options.grammar} states=${gpu.plan.stateCount} classes=${gpu.alphabet.classCount}`,
  );
  console.log(
    `runs=${options.runs} warmup=${options.warmup} timestamps=${gpu.hasTimestamps} chunkSize=${gpu.chunkSize}`,
  );
  console.log(
    `device limits: maxStorageBufferBindingSize=${gpu.limits.maxStorageBufferBindingSize} ` +
      `maxBufferSize=${gpu.limits.maxBufferSize} ` +
      `maxComputeWorkgroupStorageSize=${gpu.limits.maxComputeWorkgroupStorageSize} ` +
      `maxComputeWorkgroupsPerDimension=${gpu.limits.maxComputeWorkgroupsPerDimension}`,
  );
  console.log(
    `max input at worst-case capacity: ${gpu.maxInputUnits(1)} UTF-16 units`,
  );
  console.log("");
  console.log(
    "one-time setup (NOT amortized into any number below, and NOT repaid at the crossover):",
  );
  console.log(
    `  cpu  CpuReferenceLexer.create (WebAssembly.Module + load_plan) = ${
      fmt(cpuSetupMs, 3)
    } ms`,
  );
  console.log(
    `  gpu  requestAdapter=${
      fmt(setup.requestAdapterMs, 3)
    } ms  requestDevice=${fmt(setup.requestDeviceMs, 3)} ms  ` +
      `decodePlan=${fmt(setup.decodePlanMs, 3)} ms  buildAlphabet=${
        fmt(setup.buildAlphabetMs, 3)
      } ms  ` +
      `packTables=${fmt(setup.packTablesMs, 3)} ms`,
  );
  console.log(
    `  gpu  buildKernelSource=${fmt(setup.buildKernelSourceMs, 3)} ms  ` +
      `createShaderModule=${fmt(setup.createShaderModuleMs, 3)} ms  ` +
      `createPipelines=${fmt(setup.createPipelinesMs, 3)} ms  ` +
      `createBuffers=${fmt(setup.createBuffersMs, 3)} ms`,
  );
  console.log(
    `  gpu  TOTAL = ${fmt(setup.totalMs, 3)} ms (${
      fmt(setup.totalMs / cpuSetupMs, 1)
    }x the CPU engine's setup)`,
  );
  console.log("");

  // funcfuck gets a randomized generator (varied whitespace runs, identifier
  // lengths and integer widths). Other grammars have no generator here, so they
  // fall back to repeating the shipped example programs - fine for throughput,
  // deliberately NOT used as the parity corpus because it is strictly periodic.
  //
  // Both generators emit only SHORT tokens (mean ~2.5 code units for funcfuck).
  // That is the fast case for this kernel and never its known quadratic case;
  // see pathological.ts for the long-single-token behaviour.
  let makeSource = (chars: number) => randomizedFuncfuckSource(chars, 20250726);
  let corpusKind = "randomized funcfuck (short tokens only, seed 20250726)";
  if (options.grammar !== "funcfuck") {
    const programs = await readExamplePrograms(grammar);
    const joined = `${programs.map((program) => program.text).join("\n")}\n`;
    makeSource = (chars: number) => repeatToSize(joined, chars);
    corpusKind =
      `repeated example programs (strictly periodic, ${joined.length}-char period)`;
  }
  console.log(`corpus: ${corpusKind}`);
  console.log("");

  const results: SizeResult[] = [];
  for (const chars of options.sizes) {
    const text = makeSource(chars);
    const convertStart = performance.now();
    const units = toUtf16(text);
    const utf16ConvertMs = performance.now() - convertStart;

    // Correctness is re-verified at every benchmark size; a fast wrong kernel is
    // worthless.
    const reference = cpu.lex(units).records;
    const probe = await gpu.lex(units);
    if (probe.overflow) {
      throw new Error(
        `bench parity failure at ${
          sizeLabel(chars)
        }: GPU reported output overflow`,
      );
    }
    if (probe.records.length !== reference.length) {
      throw new Error(
        `bench parity failure at ${sizeLabel(chars)}: cpu=${
          reference.length / 4
        } gpu=${probe.records.length / 4} tokens`,
      );
    }
    for (let index = 0; index < reference.length; index += 1) {
      if (reference[index] !== probe.records[index]) {
        throw new Error(
          `bench parity failure at ${
            sizeLabel(chars)
          }: record word ${index} differs`,
        );
      }
    }
    const tokens = probe.tokenCount;

    for (let index = 0; index < options.warmup; index += 1) {
      cpu.lex(units);
      await gpu.lex(units);
      await gpu.lex(units, { borrowRecords: true });
      await gpu.lex(units, { capacityRecords: tokens, borrowRecords: true });
    }

    const cpuWrite: number[] = [];
    const cpuLex: number[] = [];
    const cpuTotal: number[] = [];
    const worstCaseOwned: GpuLexResult[] = [];
    const worstCaseBorrowed: GpuLexResult[] = [];
    const tuned: GpuLexResult[] = [];
    for (let index = 0; index < options.runs; index += 1) {
      const cpuResult = cpu.lex(units);
      cpuWrite.push(cpuResult.timings.writeSourceMs);
      cpuLex.push(cpuResult.timings.lexAllMs);
      cpuTotal.push(cpuResult.timings.totalMs);
      worstCaseOwned.push(await gpu.lex(units));
      worstCaseBorrowed.push(await gpu.lex(units, { borrowRecords: true }));
      tuned.push(
        await gpu.lex(units, { capacityRecords: tokens, borrowRecords: true }),
      );
    }

    const cpuLexAllMs = stat(cpuLex);
    const result: SizeResult = {
      chars,
      label: sizeLabel(chars),
      tokens,
      cpuWriteSourceMs: stat(cpuWrite),
      cpuLexAllMs,
      cpuTotalMs: stat(cpuTotal),
      cpuMiBPerSec: mibPerSecond(chars, cpuLexAllMs.median),
      gpuWorstCaseOwned: summarizeGpu(worstCaseOwned, chars, units.length),
      gpuWorstCaseBorrowed: summarizeGpu(
        worstCaseBorrowed,
        chars,
        units.length,
      ),
      gpuTunedOracle: summarizeGpu(tuned, chars, tokens),
      utf16ConvertMs,
    };
    results.push(result);

    console.log(
      `${result.label.padStart(8)}  tokens=${String(tokens).padStart(9)}  ` +
        `cpu lex_all=${fmtSpread(cpuLexAllMs).padStart(24)} ms (${
          fmt(result.cpuMiBPerSec).padStart(7)
        } MiB/s)  ` +
        `gpu total=${
          fmtSpread(result.gpuWorstCaseOwned.totalMs).padStart(24)
        } ms (${fmt(result.gpuWorstCaseOwned.miBPerSec).padStart(8)} MiB/s)  ` +
        `speedup=${
          fmt(cpuLexAllMs.median / result.gpuWorstCaseOwned.totalMs.median)
        }x`,
    );
  }

  console.log("");
  console.log(
    "median [min..max] over the same samples. GPU column above is configuration (1): " +
      "worst-case capacity, owned records.",
  );

  console.log("");
  console.log("the other two GPU configurations, and what each gap costs:");
  console.log(
    [
      "size".padStart(8),
      "(1) worst/owned".padStart(17),
      "(2) worst/borrowed".padStart(20),
      "(3) oracle/borrowed".padStart(21),
      "owned copy".padStart(12),
      "sizing".padStart(9),
      "(1) speedup".padStart(12),
      "(3) speedup".padStart(12),
    ].join(" "),
  );
  for (const result of results) {
    const owned = result.gpuWorstCaseOwned.totalMs.median;
    const borrowed = result.gpuWorstCaseBorrowed.totalMs.median;
    const oracle = result.gpuTunedOracle.totalMs.median;
    console.log(
      [
        result.label.padStart(8),
        fmt(owned, 2).padStart(17),
        fmt(borrowed, 2).padStart(20),
        fmt(oracle, 2).padStart(21),
        fmt(owned - borrowed, 2).padStart(12),
        fmt(borrowed - oracle, 2).padStart(9),
        `${fmt(result.cpuLexAllMs.median / owned)}x`.padStart(12),
        `${fmt(result.cpuLexAllMs.median / oracle)}x`.padStart(12),
      ].join(" "),
    );
  }

  console.log("");
  console.log(
    "GPU submit+sync and kernel time (ms, median [min..max], configuration (1)):",
  );
  for (const result of results) {
    console.log(
      `${result.label.padStart(8)}  submit+sync=${
        fmtSpread(result.gpuWorstCaseOwned.submitAndSyncMs).padStart(24)
      } ms  ` +
        `kernels=${
          fmtSpread(result.gpuWorstCaseOwned.gpuStagesTotalMs).padStart(24)
        } ms`,
    );
  }

  console.log("");
  console.log(
    "per-stage GPU time (ms, median, configuration (1)):",
  );
  const stageNames = Object.keys(results[0].gpuWorstCaseOwned.stagesMs);
  console.log(
    ["size".padStart(8), ...stageNames.map((n) => n.padStart(20))].join(" "),
  );
  for (const result of results) {
    console.log(
      [
        result.label.padStart(8),
        ...stageNames.map((name) =>
          fmt(result.gpuWorstCaseOwned.stagesMs[name].median, 3).padStart(20)
        ),
      ].join(" "),
    );
  }

  console.log("");
  console.log(
    "GPU wall-clock breakdown (ms, median, configuration (1)):",
  );
  console.log(
    [
      "size".padStart(8),
      "upload".padStart(9),
      "encode".padStart(9),
      "submit+sync".padStart(12),
      "mapRange".padStart(10),
      "copyOut".padStart(9),
      "total".padStart(9),
    ].join(" "),
  );
  for (const result of results) {
    console.log(
      [
        result.label.padStart(8),
        fmt(result.gpuWorstCaseOwned.uploadMs.median, 3).padStart(9),
        fmt(result.gpuWorstCaseOwned.encodeMs.median, 3).padStart(9),
        fmt(result.gpuWorstCaseOwned.submitAndSyncMs.median, 3).padStart(12),
        fmt(result.gpuWorstCaseOwned.mapRangeMs.median, 3).padStart(10),
        fmt(result.gpuWorstCaseOwned.copyOutMs.median, 3).padStart(9),
        fmt(result.gpuWorstCaseOwned.totalMs.median, 3).padStart(9),
      ].join(" "),
    );
  }

  // Crossover is reported both as the first measured size that wins on medians
  // and as the first size that wins on the WORST observed GPU sample against the
  // BEST observed CPU sample. The gap between the two is the honest uncertainty.
  let crossoverWorstCaseOwned: string | null = null;
  let crossoverWorstCaseOwnedPessimistic: string | null = null;
  let crossoverTunedOracle: string | null = null;
  for (const result of results) {
    if (
      crossoverWorstCaseOwned === null &&
      result.gpuWorstCaseOwned.totalMs.median < result.cpuLexAllMs.median
    ) {
      crossoverWorstCaseOwned = result.label;
    }
    if (
      crossoverWorstCaseOwnedPessimistic === null &&
      result.gpuWorstCaseOwned.totalMs.max < result.cpuLexAllMs.min
    ) {
      crossoverWorstCaseOwnedPessimistic = result.label;
    }
    if (
      crossoverTunedOracle === null &&
      result.gpuTunedOracle.totalMs.median < result.cpuLexAllMs.median
    ) {
      crossoverTunedOracle = result.label;
    }
  }
  console.log("");
  console.log(
    `crossover (1) worst-case/owned, medians:                ${crossoverWorstCaseOwned}`,
  );
  console.log(
    `crossover (1) worst gpu sample vs best cpu sample:      ${crossoverWorstCaseOwnedPessimistic}`,
  );
  console.log(
    `crossover (3) oracle capacity, medians:                 ${crossoverTunedOracle}`,
  );
  console.log(
    "The crossover is only ever reported as one of the sizes actually measured. " +
      "Anything finer requires a --sizes sweep.",
  );
  console.log(
    "Setup is not repaid at any of these: the per-call saving at the crossover is ~0 ms " +
      `against ${fmt(setup.totalMs, 0)} ms of one-time GPU init.`,
  );

  const output = {
    generatedAt: new Date().toISOString(),
    grammar: options.grammar,
    corpus: corpusKind,
    runs: options.runs,
    warmup: options.warmup,
    deno: Deno.version.deno,
    dfaStateCount: gpu.plan.stateCount,
    alphabetClassCount: gpu.alphabet.classCount,
    chunkSize: gpu.chunkSize,
    deviceLimits: gpu.limits,
    maxInputUnitsWorstCaseCapacity: gpu.maxInputUnits(1),
    setup: { cpuCreateMs: cpuSetupMs, gpu: setup },
    headline: "gpuWorstCaseOwned",
    crossoverWorstCaseOwned,
    crossoverWorstCaseOwnedPessimistic,
    crossoverTunedOracle,
    results,
  };
  let outPath = new URL("./results.json", import.meta.url).pathname;
  if (options.jsonPath !== null) {
    outPath = options.jsonPath;
  }
  await Deno.writeTextFile(outPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log("");
  console.log(`wrote ${outPath}`);
  gpu.destroy();
}

await main();
