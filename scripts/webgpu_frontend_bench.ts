/**
 * CPU oracle versus the WebGPU-backed island frontend.
 *
 * Run `deno task bench:webgpu-frontend` after generating the GPU Duck example.
 * Sizes are MiB and may be overridden with `--sizes 1,4`.
 */

import {
  CpuFrontend,
  type GpuFrontendResult,
  inspectGpuFrontendPlan,
  WebGpuRuntime,
} from "../src/runtime/webgpu/mod.ts";

const MIB = 1024 * 1024;

interface Options {
  readonly sizes: readonly number[];
  readonly warmup: number;
  readonly runs: number;
  readonly allowFallbackAdapter: boolean;
  readonly resident: boolean;
}

interface Distribution {
  readonly median: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly samples: readonly number[];
}

function parseOptions(): Options {
  let sizes = [1, 4, 16];
  let warmup = 2;
  let runs = 7;
  let allowFallbackAdapter = false;
  let resident = false;
  for (let index = 0; index < Deno.args.length; index += 1) {
    const argument = Deno.args[index];
    if (argument === "--allow-fallback-adapter") {
      allowFallbackAdapter = true;
      continue;
    }
    if (argument === "--resident") {
      resident = true;
      continue;
    }
    if (argument === "--sizes" && index + 1 < Deno.args.length) {
      sizes = Deno.args[index + 1].split(",").map(Number);
      index += 1;
      continue;
    }
    if (argument === "--warmup" && index + 1 < Deno.args.length) {
      warmup = Number(Deno.args[index + 1]);
      index += 1;
      continue;
    }
    if (argument === "--runs" && index + 1 < Deno.args.length) {
      runs = Number(Deno.args[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(
      `Unknown WebGPU frontend benchmark argument '${argument}'.`,
    );
  }
  for (const size of sizes) {
    if (!Number.isSafeInteger(size) || size < 1) {
      throw new Error(
        `--sizes must contain positive integer MiB values, got '${size}'.`,
      );
    }
  }
  for (
    const [name, value] of [["--warmup", warmup], ["--runs", runs]] as const
  ) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(
        `${name} must be a positive safe integer, got '${value}'.`,
      );
    }
  }
  return { sizes, warmup, runs, allowFallbackAdapter, resident };
}

function gpuDuckCorpus(targetBytes: number): string {
  const prefix = "module Bench where\n\ndeclare operators {\n};\n\n";
  const suffix = "\nreturn {};\n";
  const declarations: string[] = [];
  let sourceBytes = prefix.length + suffix.length;
  let index = 0;
  while (sourceBytes < targetBytes) {
    const declaration = `let value_${index} = ${index % 1000};\n`;
    declarations.push(declaration);
    sourceBytes += declaration.length;
    index += 1;
  }
  return prefix + declarations.join("") + suffix;
}

function distribution(samples: readonly number[]): Distribution {
  if (samples.length === 0) {
    throw new Error("Cannot summarize an empty benchmark sample.");
  }
  const ordered = [...samples].sort((left, right) => left - right);
  return {
    median: ordered[Math.floor(ordered.length / 2)],
    minimum: ordered[0],
    maximum: ordered[ordered.length - 1],
    samples: [...samples],
  };
}

function assertEqualRecords(
  name: string,
  cpuRecords: Int32Array,
  gpuRecords: Int32Array,
): void {
  if (cpuRecords.length !== gpuRecords.length) {
    throw new Error(
      `${name} parity failed: CPU has ${cpuRecords.length} words and GPU has ${gpuRecords.length}.`,
    );
  }
  for (let index = 0; index < cpuRecords.length; index += 1) {
    if (cpuRecords[index] !== gpuRecords[index]) {
      throw new Error(
        `${name} parity failed at word ${index}: CPU has ${
          cpuRecords[index]
        } and GPU has ${gpuRecords[index]}.`,
      );
    }
  }
}

function requireProgram(result: GpuFrontendResult, backend: string) {
  if (!result.ok) {
    const diagnostic = result.diagnostics[0];
    let evidence = "no diagnostic";
    if (diagnostic !== undefined) {
      evidence = `${diagnostic.code} at ${diagnostic.start}..${diagnostic.end}`;
    }
    throw new Error(
      `${backend} frontend rejected benchmark input: ${evidence}.`,
    );
  }
  return result.program;
}

function assertProgramParity(
  cpuResult: GpuFrontendResult,
  gpuResult: GpuFrontendResult,
): void {
  const cpuProgram = requireProgram(cpuResult, "CPU");
  const gpuProgram = requireProgram(gpuResult, "GPU");
  assertEqualRecords("token", cpuProgram.tokens, gpuProgram.tokens);
  assertEqualRecords("node", cpuProgram.nodes, gpuProgram.nodes);
  assertEqualRecords("edge", cpuProgram.edges, gpuProgram.edges);
  assertEqualRecords("symbol", cpuProgram.symbols, gpuProgram.symbols);
  assertEqualRecords("type", cpuProgram.types, gpuProgram.types);
}

const options = parseOptions();
const plan = await Deno.readFile(
  new URL("../examples/gpu-duck/generated/wasm/parser.plan", import.meta.url),
);
const planInspection = inspectGpuFrontendPlan(plan);
if (planInspection === null) {
  throw new Error(
    "GPU Duck parser.plan has no version-3 GPU frontend section.",
  );
}

const cpuSetupStart = performance.now();
const cpu = CpuFrontend.create(plan);
const cpuSetupMs = performance.now() - cpuSetupStart;

const gpuSetupStart = performance.now();
const runtime = await WebGpuRuntime.create({
  allowFallbackAdapter: options.allowFallbackAdapter,
  powerPreference: "high-performance",
});
const frontend = await runtime.compileFrontend(plan);
const gpuSetupMs = performance.now() - gpuSetupStart;

console.log(JSON.stringify({
  adapter: runtime.capabilities,
  plan: planInspection,
  setupMs: { cpu: cpuSetupMs, gpu: gpuSetupMs },
}));

try {
  for (const mebibytes of options.sizes) {
    const source = gpuDuckCorpus(mebibytes * MIB);
    const sourceUnits = new Uint16Array(source.length);
    for (let index = 0; index < source.length; index += 1) {
      sourceUnits[index] = source.charCodeAt(index);
    }
    console.error(`${mebibytes} MiB parity`);
    const parityCpuResult = cpu.ingest(source);
    const parityProgram = requireProgram(parityCpuResult, "CPU");
    const lexerCapacityRecords = parityProgram.tokens.length / 4;
    const parityGpuResult = await frontend.ingest(source, {
      lexerCapacityRecords,
    });
    assertProgramParity(parityCpuResult, parityGpuResult);
    for (let warmup = 0; warmup < options.warmup; warmup += 1) {
      console.error(
        `${mebibytes} MiB warmup ${warmup + 1}/${options.warmup}`,
      );
      const cpuResult = cpu.ingest(source);
      const gpuResult = await frontend.ingest(source, {
        lexerCapacityRecords,
      });
      assertProgramParity(cpuResult, gpuResult);
      if (options.resident) {
        const resident = await frontend.ingestResident(sourceUnits, {
          lexerCapacityRecords,
        });
        resident.dispose();
      }
    }

    const cpuSamples: number[] = [];
    const gpuSamples: number[] = [];
    const residentSubmitSamples: number[] = [];
    const residentTotalSamples: number[] = [];
    const sourceEncodingSamples: number[] = [];
    const gpuRoundTripSamples: number[] = [];
    const semanticSamples: number[] = [];
    let tokenCount = 0;
    let nodeCount = 0;
    let edgeCount = 0;
    let compactProgramBytes = 0;
    let stagesMs: Readonly<Record<string, number>> | null = null;
    for (let run = 0; run < options.runs; run += 1) {
      console.error(`${mebibytes} MiB run ${run + 1}/${options.runs}`);
      const cpuStart = performance.now();
      const cpuResult = cpu.ingest(source);
      cpuSamples.push(performance.now() - cpuStart);

      const gpuStart = performance.now();
      const gpuResult = await frontend.ingest(source, {
        lexerCapacityRecords,
      });
      gpuSamples.push(performance.now() - gpuStart);
      sourceEncodingSamples.push(gpuResult.timings.uploadMs);
      gpuRoundTripSamples.push(gpuResult.timings.lexMs);
      semanticSamples.push(gpuResult.timings.semanticsMs);

      assertProgramParity(cpuResult, gpuResult);
      const program = requireProgram(gpuResult, "GPU");
      tokenCount = program.tokens.length / 4;
      nodeCount = program.nodes.length / 8;
      edgeCount = program.edges.length / 4;
      compactProgramBytes = program.tokens.byteLength +
        program.nodes.byteLength +
        program.edges.byteLength +
        program.symbols.byteLength +
        program.types.byteLength;

      if (options.resident) {
        const resident = await frontend.ingestResident(sourceUnits, {
          lexerCapacityRecords,
        });
        residentSubmitSamples.push(resident.timings.submitMs);
        residentTotalSamples.push(resident.timings.totalMs);
        resident.dispose();
      }
    }
    console.error(`${mebibytes} MiB stage profile`);
    const profiledGpuResult = await frontend.ingest(source, {
      lexerCapacityRecords,
      stageTimings: "collect",
    });
    assertProgramParity(parityCpuResult, profiledGpuResult);
    stagesMs = profiledGpuResult.timings.stagesMs;

    const cpuMs = distribution(cpuSamples);
    const gpuMs = distribution(gpuSamples);
    let residentSubmitMs: Distribution | null = null;
    let residentTotalMs: Distribution | null = null;
    if (residentSubmitSamples.length > 0) {
      residentSubmitMs = distribution(residentSubmitSamples);
      residentTotalMs = distribution(residentTotalSamples);
    }
    console.log(JSON.stringify({
      mebibytes,
      sourceBytes: source.length,
      tokenCount,
      nodeCount,
      edgeCount,
      compactProgramBytes,
      cpuMs,
      gpuMs,
      speedup: cpuMs.median / gpuMs.median,
      ownedPhasesMs: {
        sourceEncoding: distribution(sourceEncodingSamples),
        gpuRoundTrip: distribution(gpuRoundTripSamples),
        semantics: distribution(semanticSamples),
      },
      residentTotalMs,
      residentSubmitMs,
      stagesMs,
    }));
  }
} finally {
  runtime.dispose();
}
