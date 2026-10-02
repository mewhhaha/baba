/**
 * TypeScript CPU parity oracle versus the WebGPU-backed island frontend.
 *
 * Run `deno task bench:webgpu-frontend` after generating the GPU Duck example.
 * Sizes are MiB and may be overridden with `--sizes 1,4`.
 * The headline uses default GPU capacity; `--oracle-capacity` adds a separately
 * labeled result with the exact token count learned from the CPU oracle.
 * `--resident` measures submission, return, and device completion separately.
 * Resident completion excludes mapped readback and host semantic recipes.
 */

import {
  CpuFrontend,
  GpuFrontendCapacityError,
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
  readonly oracleCapacity: boolean;
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
  let oracleCapacity = false;
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
    if (argument === "--oracle-capacity") {
      oracleCapacity = true;
      continue;
    }
    if (argument === "--help") {
      console.log(
        "Usage: deno task bench:webgpu-frontend [--sizes 1,4,16] [--warmup 2] [--runs 7] [--resident] [--oracle-capacity] [--allow-fallback-adapter]\n" +
          "Headline: TypeScript CpuFrontend versus owned GPU ingestion with default token capacity.\n" +
          "--oracle-capacity adds exact-token-capacity timings obtained from the CPU oracle.\n" +
          "--resident adds submission, return, and device-completion timings without readback or host semantics.",
      );
      Deno.exit(0);
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
  return {
    sizes,
    warmup,
    runs,
    allowFallbackAdapter,
    resident,
    oracleCapacity,
  };
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
  comparison: {
    cpu:
      "TypeScript CpuFrontend parity oracle with owned flat IR and semantics",
    gpu: "Owned WebGpuFrontend.ingest with default token capacity",
    resident:
      "UTF-16 units to device-resident syntax IR; completion excludes readback and host semantics",
  },
}));

try {
  for (const mebibytes of options.sizes) {
    const source = gpuDuckCorpus(mebibytes * MIB);
    const parityCpuResult = cpu.ingest(source);
    const parityProgram = requireProgram(parityCpuResult, "CPU");
    const tokenCount = parityProgram.tokens.length / 4;
    const nodeCount = parityProgram.nodes.length / 8;
    const edgeCount = parityProgram.edges.length / 4;
    const compactProgramBytes = parityProgram.tokens.byteLength +
      parityProgram.nodes.byteLength +
      parityProgram.edges.byteLength +
      parityProgram.symbols.byteLength +
      parityProgram.types.byteLength;

    for (let warmup = 0; warmup < options.warmup; warmup += 1) {
      console.error(
        `${mebibytes} MiB CPU warmup ${warmup + 1}/${options.warmup}`,
      );
      requireProgram(cpu.ingest(source), "CPU");
    }
    const cpuSamples: number[] = [];
    for (let run = 0; run < options.runs; run += 1) {
      console.error(`${mebibytes} MiB CPU run ${run + 1}/${options.runs}`);
      const started = performance.now();
      const result = cpu.ingest(source);
      cpuSamples.push(performance.now() - started);
      requireProgram(result, "CPU");
    }
    const cpuMs = distribution(cpuSamples);

    let sourceUnits: Uint16Array | undefined;
    if (options.resident) {
      sourceUnits = new Uint16Array(source.length);
      for (let index = 0; index < source.length; index += 1) {
        sourceUnits[index] = source.charCodeAt(index);
      }
    }
    const capacityModes: ("default" | "oracle-capacity")[] = ["default"];
    if (options.oracleCapacity) {
      capacityModes.push("oracle-capacity");
    }
    for (const capacityMode of capacityModes) {
      let lexerCapacityRecords = source.length;
      const allocationOptions: { lexerCapacityRecords?: number } = {};
      if (capacityMode === "oracle-capacity") {
        lexerCapacityRecords = tokenCount;
        allocationOptions.lexerCapacityRecords = lexerCapacityRecords;
      }
      const label = `${mebibytes} MiB ${capacityMode}`;
      try {
        console.error(`${label} parity`);
        const parityGpuResult = await frontend.ingest(
          source,
          allocationOptions,
        );
        assertProgramParity(parityCpuResult, parityGpuResult);
        for (let warmup = 0; warmup < options.warmup; warmup += 1) {
          console.error(`${label} warmup ${warmup + 1}/${options.warmup}`);
          const gpuResult = await frontend.ingest(source, allocationOptions);
          assertProgramParity(parityCpuResult, gpuResult);
        }

        const gpuSamples: number[] = [];
        const sourceEncodingSamples: number[] = [];
        const gpuRoundTripSamples: number[] = [];
        const semanticSamples: number[] = [];
        for (let run = 0; run < options.runs; run += 1) {
          console.error(`${label} run ${run + 1}/${options.runs}`);
          const started = performance.now();
          const gpuResult = await frontend.ingest(source, allocationOptions);
          gpuSamples.push(performance.now() - started);
          sourceEncodingSamples.push(gpuResult.timings.uploadMs);
          gpuRoundTripSamples.push(gpuResult.timings.lexMs);
          semanticSamples.push(gpuResult.timings.semanticsMs);
          assertProgramParity(parityCpuResult, gpuResult);
        }
        console.error(`${label} stage profile`);
        const profiledGpuResult = await frontend.ingest(source, {
          ...allocationOptions,
          stageTimings: "collect",
        });
        assertProgramParity(parityCpuResult, profiledGpuResult);

        const residentSubmitSamples: number[] = [];
        const residentReturnSamples: number[] = [];
        const residentCompletionSamples: number[] = [];
        if (sourceUnits !== undefined) {
          await runtime.device.queue.onSubmittedWorkDone();
          for (let warmup = 0; warmup < options.warmup; warmup += 1) {
            console.error(
              `${label} resident warmup ${warmup + 1}/${options.warmup}`,
            );
            const resident = await frontend.ingestResident(
              sourceUnits,
              allocationOptions,
            );
            await runtime.device.queue.onSubmittedWorkDone();
            resident.dispose();
          }
          for (let run = 0; run < options.runs; run += 1) {
            console.error(`${label} resident run ${run + 1}/${options.runs}`);
            const started = performance.now();
            const resident = await frontend.ingestResident(
              sourceUnits,
              allocationOptions,
            );
            residentSubmitSamples.push(resident.timings.submitMs);
            residentReturnSamples.push(performance.now() - started);
            await runtime.device.queue.onSubmittedWorkDone();
            residentCompletionSamples.push(performance.now() - started);
            resident.dispose();
          }
        }

        const gpuMs = distribution(gpuSamples);
        let residentSubmitMs: Distribution | null = null;
        let residentReturnMs: Distribution | null = null;
        let residentCompletionMs: Distribution | null = null;
        if (residentSubmitSamples.length > 0) {
          residentSubmitMs = distribution(residentSubmitSamples);
          residentReturnMs = distribution(residentReturnSamples);
          residentCompletionMs = distribution(residentCompletionSamples);
        }
        console.log(JSON.stringify({
          mebibytes,
          sourceBytes: source.length,
          capacityMode,
          status: "measured",
          lexerCapacityRecords,
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
          residentReturnMs,
          residentSubmitMs,
          residentCompletionMs,
          stagesMs: profiledGpuResult.timings.stagesMs,
        }));
      } catch (error) {
        if (!(error instanceof GpuFrontendCapacityError)) {
          throw error;
        }
        console.log(JSON.stringify({
          mebibytes,
          sourceBytes: source.length,
          capacityMode,
          status: "skipped",
          lexerCapacityRecords,
          cpuMs,
          reason: error.message,
          bufferName: error.bufferName,
          requiredBytes: error.required,
          availableBytes: error.available,
        }));
      }
    }
  }
} finally {
  runtime.dispose();
}
