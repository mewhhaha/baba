/** Render a checked-in program directly from resident syntax IR. */
import {
  type CompactFrontendProgram,
  CpuFrontend,
  type GpuResidentFrontendResult,
  WebGpuRuntime,
} from "../src/runtime/webgpu/mod.ts";
import { ResidentSyntaxOverviewRenderer } from "../examples/gpu-duck/resident_overview.ts";
import { exampleGrammar, readExamplePrograms } from "./webgpu_lexer_corpus.ts";

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

let grammarName = "gpu-duck";
let sourcePath: string | undefined;
let outputPath: string | undefined;
let jsonPath: string | undefined;
let runs = 9;
let warmup = 3;
let allowFallbackAdapter = false;
for (let index = 0; index < Deno.args.length; index += 1) {
  const argument = Deno.args[index];
  if (argument === "--allow-fallback-adapter") {
    allowFallbackAdapter = true;
    continue;
  }
  if (argument === "--help") {
    console.log(
      "Usage: webgpu_resident_overview.ts [--grammar gpu-duck|funcfuck] [--source PATH] [--output image.ppm] [--json PATH] [--runs 9] [--warmup 3] [--allow-fallback-adapter]",
    );
    Deno.exit(0);
  }
  const value = Deno.args[index + 1];
  expect(value !== undefined, `Missing value for '${argument}'.`);
  index += 1;
  if (argument === "--grammar") grammarName = value;
  else if (argument === "--source") sourcePath = value;
  else if (argument === "--output") outputPath = value;
  else if (argument === "--json") jsonPath = value;
  else if (argument === "--runs") runs = Number(value);
  else if (argument === "--warmup") warmup = Number(value);
  else throw new Error(`Unknown argument '${argument}'.`);
}
expect(Number.isSafeInteger(runs) && runs > 0, "Invalid --runs.");
expect(Number.isSafeInteger(warmup) && warmup >= 0, "Invalid --warmup.");

function distribution(samples: readonly number[]) {
  expect(samples.length > 0, "Expected benchmark samples.");
  const sorted = [...samples].sort((a, b) => a - b);
  let median = sorted[Math.floor(sorted.length / 2)];
  if (sorted.length % 2 === 0) {
    median = (median + sorted[sorted.length / 2 - 1]) / 2;
  }
  return {
    median,
    minimum: sorted[0],
    maximum: sorted[sorted.length - 1],
    samples,
  };
}

function uploadProgram(
  device: GPUDevice,
  program: CompactFrontendProgram,
): GpuResidentFrontendResult {
  const tokenOffsetWords = 40;
  const nodeOffsetWords = tokenOffsetWords + program.tokens.length;
  const edgeOffsetWords = nodeOffsetWords + program.nodes.length;
  const words = new Int32Array(edgeOffsetWords + program.edges.length);
  words[1] = program.tokens.length / 4;
  words[2] = program.nodes.length / 8;
  words[3] = program.edges.length / 4;
  words.set(program.tokens, tokenOffsetWords);
  words.set(program.nodes, nodeOffsetWords);
  words.set(program.edges, edgeOffsetWords);
  const buffer = device.createBuffer({
    size: words.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  try {
    device.queue.writeBuffer(buffer, 0, words);
  } catch (error) {
    buffer.destroy();
    throw error;
  }
  return {
    buffer,
    layout: {
      byteLength: words.byteLength,
      headerWords: 40,
      statusWord: 0,
      tokenCountWord: 1,
      nodeCountWord: 2,
      edgeCountWord: 3,
      tokenCapacity: words[1],
      nodeCapacity: words[2],
      edgeCapacity: words[3],
      tokenOffsetWords,
      nodeOffsetWords,
      edgeOffsetWords,
    },
    timings: { uploadMs: 0, submitMs: 0, totalMs: 0 },
    dispose: () => buffer.destroy(),
  };
}

const grammar = exampleGrammar(grammarName);
const plan = await Deno.readFile(grammar.planPath);
let source: string;
if (sourcePath === undefined) {
  const programs = await readExamplePrograms(grammar);
  expect(programs.length > 0, "No checked-in programs found.");
  source = programs[0].text;
  sourcePath = `examples/${grammarName}/programs/${programs[0].name}`;
} else {
  source = await Deno.readTextFile(sourcePath);
}
const cpu = CpuFrontend.create(plan);
const setupStarted = performance.now();
const runtime = await WebGpuRuntime.create({
  powerPreference: "high-performance",
  allowFallbackAdapter,
});
const device = runtime.device;
device.addEventListener("uncapturederror", (event) => {
  event.preventDefault();
  expect(
    event instanceof GPUUncapturedErrorEvent,
    "Expected a GPU error event.",
  );
  throw new Error(`Overview benchmark GPU error: ${event.error.message}`);
});
const width = 1200;
const height = 720;
const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
const texture = device.createTexture({
  size: { width, height },
  format: "rgba8unorm",
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
});
const view = texture.createView();
try {
  const frontend = await runtime.compileFrontend(plan);
  const renderer = await ResidentSyntaxOverviewRenderer.create(device);
  const setupMs = performance.now() - setupStarted;
  expect(frontend.plan.islands.length > 0, "Expected frontend rule metadata.");
  let ruleCount = 1;
  for (const island of frontend.plan.islands) {
    ruleCount = Math.max(ruleCount, island.ruleId + 1);
  }
  const renderOptions = {
    width,
    height,
    sourceLength: source.length,
    ruleCount,
    specCount: frontend.plan.terminalClassification.length,
  };
  type Mode = "cpu-upload" | "gpu-owned-upload" | "gpu-resident";
  const modes: readonly Mode[] = [
    "cpu-upload",
    "gpu-owned-upload",
    "gpu-resident",
  ];
  const sample = async (mode: Mode, capture = false) => {
    const started = performance.now();
    let syntax: GpuResidentFrontendResult | undefined;
    let program: CompactFrontendProgram | undefined;
    if (mode === "gpu-resident") {
      syntax = await frontend.ingestResident(source);
    } else {
      let parsed;
      if (mode === "cpu-upload") parsed = cpu.ingest(source);
      else parsed = await frontend.ingest(source);
      expect(
        parsed.ok,
        `Parsing failed: ${JSON.stringify(parsed.diagnostics)}`,
      );
      program = parsed.program;
    }
    let execution: ReturnType<typeof renderer.encode> | undefined;
    let staging: GPUBuffer | undefined;
    let pixels: Uint8Array | undefined;
    let summary: Uint32Array | undefined;
    let completed = false;
    let errors: Promise<PromiseSettledResult<GPUError | null>[]> | undefined;
    try {
      device.pushErrorScope("validation");
      device.pushErrorScope("out-of-memory");
      try {
        if (syntax === undefined) {
          expect(program, "Expected parsed IR to upload for rendering.");
          syntax = uploadProgram(device, program);
        }
        const encoder = device.createCommandEncoder();
        execution = renderer.encode(encoder, syntax, view, renderOptions);
        if (capture) {
          staging = device.createBuffer({
            size: 256 + bytesPerRow * height,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          });
          encoder.copyBufferToBuffer(
            execution.summaryBuffer,
            0,
            staging,
            0,
            48,
          );
          encoder.copyTextureToBuffer(
            { texture },
            { buffer: staging, offset: 256, bytesPerRow },
            { width, height },
          );
        }
        device.queue.submit([encoder.finish()]);
      } finally {
        const oom = device.popErrorScope();
        const validation = device.popErrorScope();
        errors = Promise.allSettled([oom, validation]);
      }
      await device.queue.onSubmittedWorkDone();
      completed = true;
      const elapsedMs = performance.now() - started;
      const scopedErrors = await errors;
      for (const error of scopedErrors) {
        if (error.status === "rejected") {
          throw error.reason;
        }
        if (error.value !== null) {
          throw new Error(`Overview GPU error: ${error.value.message}`);
        }
      }
      if (staging !== undefined) {
        await staging.mapAsync(GPUMapMode.READ);
        try {
          const mapped = staging.getMappedRange();
          summary = new Uint32Array(new Uint32Array(mapped, 0, 12));
          expect(
            summary[0] === 0,
            `Syntax status ${summary[0]} prevents drawing.`,
          );
          pixels = new Uint8Array(width * height * 4);
          const rows = new Uint8Array(mapped, 256);
          for (let y = 0; y < height; y += 1) {
            pixels.set(
              rows.subarray(y * bytesPerRow, y * bytesPerRow + width * 4),
              y * width * 4,
            );
          }
        } finally {
          staging.unmap();
        }
      }
      return { elapsedMs, pixels, summary };
    } finally {
      // The resident lease also keeps its frontend and device alive through
      // the downstream submission. Release it only after consumer completion.
      try {
        if (!completed) {
          await device.queue.onSubmittedWorkDone();
        }
      } finally {
        if (errors !== undefined) await errors;
        if (execution !== undefined) execution.dispose();
        if (staging !== undefined) staging.destroy();
        if (syntax !== undefined) syntax.dispose();
      }
    }
  };
  const baselineImage = await sample("cpu-upload", true);
  expect(
    baselineImage.pixels !== undefined,
    "Expected the CPU overview image.",
  );
  for (const mode of ["gpu-owned-upload", "gpu-resident"] as const) {
    const rendered = await sample(mode, true);
    expect(rendered.pixels !== undefined, "Expected a GPU overview image.");
    for (let index = 0; index < baselineImage.pixels.length; index += 1) {
      expect(
        baselineImage.pixels[index] === rendered.pixels[index],
        `${mode}: pixel byte ${index} differs from the CPU overview.`,
      );
    }
  }
  for (let index = 0; index < warmup; index += 1) {
    for (const mode of modes) await sample(mode);
  }
  const samples: Record<Mode, number[]> = {
    "cpu-upload": [],
    "gpu-owned-upload": [],
    "gpu-resident": [],
  };
  for (let run = 0; run < runs; run += 1) {
    for (let offset = 0; offset < modes.length; offset += 1) {
      const mode = modes[(run + offset) % modes.length];
      samples[mode].push((await sample(mode)).elapsedMs);
    }
  }
  const report = {
    input: sourcePath,
    sourceCodeUnits: source.length,
    adapter: runtime.capabilities,
    setupMs,
    warmup,
    runs,
    methodology: {
      timing: "Source string to completed offscreen render; setup excluded.",
      cpu: "TypeScript full frontend with host semantics, upload, render.",
      owned: "Owned GPU frontend with host semantics, reupload, render.",
      resident: "Device syntax frontend and render; host semantics excluded.",
      parity: "All three rendered images checked byte-for-byte outside timing.",
      output:
        "Only optional image export maps data; timed resident calls map no IR.",
      errors:
        "Uncaptured GPU errors abort; synchronous upload/render errors are scoped.",
    },
    completedMs: Object.fromEntries(
      modes.map((mode) => [mode, distribution(samples[mode])]),
    ),
    rules: frontend.plan.islands.map((island) => ({
      id: island.ruleId,
      name: island.ruleName,
    })),
  };
  console.log(JSON.stringify(report));
  if (jsonPath !== undefined) {
    await Deno.writeTextFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (outputPath !== undefined) {
    const image = await sample("gpu-resident", true);
    expect(image.pixels !== undefined, "Expected export pixels.");
    const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`);
    const ppm = new Uint8Array(header.length + width * height * 3);
    ppm.set(header);
    for (let index = 0; index < width * height; index += 1) {
      ppm.set(
        image.pixels.subarray(index * 4, index * 4 + 3),
        header.length + index * 3,
      );
    }
    await Deno.writeFile(outputPath, ppm);
  }
} finally {
  texture.destroy();
  runtime.dispose();
}
