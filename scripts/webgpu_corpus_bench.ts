/**
 * Benchmark the checked-in example programs without repetition or padding.
 * Run bootstrap first, then:
 * deno run --unstable-webgpu --allow-read --allow-write scripts/webgpu_corpus_bench.ts
 * Setup uses fresh instances per input; driver/JIT caches remain process-wide.
 */
import { compileStrictIslandParserProgram } from "../src/runtime/island_parser.ts";
import {
  type CompactFrontendProgram,
  CpuFrontend,
  type GpuResidentFrontendResult,
  inspectGpuFrontendPlan,
  type WebGpuFrontend,
  WebGpuLexer,
  WebGpuRuntime,
} from "../src/runtime/webgpu/mod.ts";
import { exampleGrammar, readExamplePrograms } from "./webgpu_lexer_corpus.ts";
import { CpuReferenceLexer, toUtf16 } from "./webgpu_lexer_cpu_reference.ts";

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function rejectGpuError(event: Event): void {
  event.preventDefault();
  expect(
    event instanceof GPUUncapturedErrorEvent,
    "Expected a GPU error event.",
  );
  throw new Error(`Corpus benchmark GPU error: ${event.error.message}`);
}

function options() {
  let warmup = 2;
  let runs = 7;
  let allowFallbackAdapter = false;
  let jsonPath: string | null = null;
  for (let index = 0; index < Deno.args.length; index += 1) {
    const argument = Deno.args[index];
    if (argument === "--allow-fallback-adapter") {
      allowFallbackAdapter = true;
      continue;
    }
    if (argument === "--help") {
      console.log(
        "Usage: webgpu_corpus_bench.ts [--warmup 2] [--runs 7] [--json PATH] [--allow-fallback-adapter]",
      );
      Deno.exit(0);
    }
    if (
      argument !== "--warmup" && argument !== "--runs" && argument !== "--json"
    ) {
      throw new Error(`Unknown argument '${argument}'.`);
    }
    const value = Deno.args[index + 1];
    expect(value !== undefined, `Missing value for '${argument}'.`);
    index += 1;
    if (argument === "--warmup") warmup = Number(value);
    if (argument === "--runs") runs = Number(value);
    if (argument === "--json") jsonPath = value;
  }
  expect(Number.isSafeInteger(warmup) && warmup >= 0, "Invalid --warmup.");
  expect(Number.isSafeInteger(runs) && runs > 0, "Invalid --runs.");
  return { warmup, runs, allowFallbackAdapter, jsonPath };
}

function distribution(samples: readonly number[]) {
  expect(samples.length > 0, "Cannot summarize empty samples.");
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

function equalRecords(name: string, expected: Int32Array, actual: Int32Array) {
  expect(expected.length === actual.length, `${name}: record lengths differ.`);
  for (let index = 0; index < expected.length; index += 1) {
    expect(
      expected[index] === actual[index],
      `${name}: word ${index} differs.`,
    );
  }
}

function equalPrograms(
  expected: CompactFrontendProgram,
  actual: CompactFrontendProgram,
) {
  for (
    const section of ["tokens", "nodes", "edges", "symbols", "types"] as const
  ) {
    equalRecords(section, expected[section], actual[section]);
  }
}

const config = options();
const runtimeOptions = {
  powerPreference: "high-performance" as const,
  allowFallbackAdapter: config.allowFallbackAdapter,
};

async function warmed(operation: () => number | Promise<number>) {
  for (let index = 0; index < config.warmup; index += 1) await operation();
  const samples: number[] = [];
  for (let index = 0; index < config.runs; index += 1) {
    samples.push(await operation());
  }
  return distribution(samples);
}

function cold(setupMs: number, firstCallMs: number, encodingMs = 0) {
  return {
    setupMs,
    firstCallMs,
    firstCallIncludingSetupMs: setupMs + firstCallMs,
    firstCallIncludingSetupAndEncodingMs: setupMs + firstCallMs + encodingMs,
  };
}

async function lexers(
  plan: Uint8Array,
  wasm: Uint8Array,
  units: Uint16Array,
  encodingMs: number,
) {
  const cpuStarted = performance.now();
  const cpu = CpuReferenceLexer.create(wasm, plan);
  const cpuSetupMs = performance.now() - cpuStarted;
  const cpuFirstStarted = performance.now();
  const expected = cpu.lex(units);
  const cpuFirstMs = performance.now() - cpuFirstStarted;
  const cpuWarmed = await warmed(() => {
    const started = performance.now();
    const result = cpu.lex(units);
    const elapsed = performance.now() - started;
    expect(
      result.records.length === expected.records.length,
      "CPU lexer count changed.",
    );
    return elapsed;
  });
  const gpuStarted = performance.now();
  const runtime = await WebGpuRuntime.create(runtimeOptions);
  runtime.device.addEventListener("uncapturederror", rejectGpuError);
  let lexer: WebGpuLexer | undefined;
  try {
    lexer = await WebGpuLexer.create(plan, { runtime });
    const gpuSetupMs = performance.now() - gpuStarted;
    const gpuFirstStarted = performance.now();
    const first = await lexer.lex(units);
    const gpuFirstMs = performance.now() - gpuFirstStarted;
    expect(!first.overflow, "Default GPU lexer capacity overflowed.");
    equalRecords("raw lexer", expected.records, first.records);
    const worker = lexer;
    const gpuWarmed = await warmed(async () => {
      const started = performance.now();
      const result = await worker.lex(units);
      const elapsed = performance.now() - started;
      expect(!result.overflow, "GPU lexer overflowed.");
      equalRecords("raw lexer", expected.records, result.records);
      return elapsed;
    });
    return {
      tokenCount: expected.records.length / 4,
      adapter: runtime.capabilities,
      wasm: {
        cold: cold(cpuSetupMs, cpuFirstMs, encodingMs),
        warmedMs: cpuWarmed,
      },
      gpu: {
        cold: cold(gpuSetupMs, gpuFirstMs, encodingMs),
        warmedMs: gpuWarmed,
      },
    };
  } finally {
    if (lexer !== undefined) lexer.destroy();
    runtime.dispose();
  }
}

async function residentParity(
  runtime: WebGpuRuntime,
  resident: GpuResidentFrontendResult,
  expected: CompactFrontendProgram,
) {
  const staging = runtime.device.createBuffer({
    size: resident.layout.byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  try {
    const encoder = runtime.device.createCommandEncoder();
    encoder.copyBufferToBuffer(
      resident.buffer,
      0,
      staging,
      0,
      resident.layout.byteLength,
    );
    runtime.device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    try {
      const words = new Int32Array(staging.getMappedRange());
      expect(
        words[resident.layout.statusWord] === 0,
        "Resident syntax failed.",
      );
      for (
        const [section, countWord, offset, width] of [
          [
            "tokens",
            resident.layout.tokenCountWord,
            resident.layout.tokenOffsetWords,
            4,
          ],
          [
            "nodes",
            resident.layout.nodeCountWord,
            resident.layout.nodeOffsetWords,
            8,
          ],
          [
            "edges",
            resident.layout.edgeCountWord,
            resident.layout.edgeOffsetWords,
            4,
          ],
        ] as const
      ) {
        equalRecords(
          section,
          expected[section],
          words.subarray(offset, offset + words[countWord] * width),
        );
      }
    } finally {
      staging.unmap();
    }
  } finally {
    staging.destroy();
  }
}

async function frontends(
  plan: Uint8Array,
  source: string,
  units: Uint16Array,
  encodingMs: number,
) {
  const cpuStarted = performance.now();
  const cpu = CpuFrontend.create(plan);
  const cpuSetupMs = performance.now() - cpuStarted;
  const cpuFirstStarted = performance.now();
  const firstCpu = cpu.ingest(source);
  const cpuFirstMs = performance.now() - cpuFirstStarted;
  expect(
    firstCpu.ok,
    `Frontend failed: ${JSON.stringify(firstCpu.diagnostics)}`,
  );
  const expected = firstCpu.program;
  const cpuWarmed = await warmed(() => {
    const started = performance.now();
    const result = cpu.ingest(source);
    const elapsed = performance.now() - started;
    expect(result.ok, `Frontend failed: ${JSON.stringify(result.diagnostics)}`);
    equalPrograms(expected, result.program);
    return elapsed;
  });
  const gpuStarted = performance.now();
  const runtime = await WebGpuRuntime.create(runtimeOptions);
  runtime.device.addEventListener("uncapturederror", rejectGpuError);
  let frontend: WebGpuFrontend | undefined;
  let owned;
  try {
    frontend = await runtime.compileFrontend(plan);
    const gpuSetupMs = performance.now() - gpuStarted;
    const gpuFirstStarted = performance.now();
    const first = await frontend.ingest(source);
    const gpuFirstMs = performance.now() - gpuFirstStarted;
    expect(first.ok, `Frontend failed: ${JSON.stringify(first.diagnostics)}`);
    equalPrograms(expected, first.program);
    const worker = frontend;
    owned = {
      cold: cold(gpuSetupMs, gpuFirstMs),
      warmedMs: await warmed(async () => {
        const started = performance.now();
        const result = await worker.ingest(source);
        const elapsed = performance.now() - started;
        expect(
          result.ok,
          `Frontend failed: ${JSON.stringify(result.diagnostics)}`,
        );
        equalPrograms(expected, result.program);
        return elapsed;
      }),
    };
  } finally {
    if (frontend !== undefined) frontend.dispose();
    runtime.dispose();
  }
  const residentStarted = performance.now();
  const residentRuntime = await WebGpuRuntime.create(runtimeOptions);
  residentRuntime.device.addEventListener("uncapturederror", rejectGpuError);
  try {
    const residentFrontend = await residentRuntime.compileFrontend(plan);
    const residentSetupMs = performance.now() - residentStarted;
    const started = performance.now();
    const first = await residentFrontend.ingestResident(units);
    let firstCompletionMs;
    try {
      await residentRuntime.device.queue.onSubmittedWorkDone();
      firstCompletionMs = performance.now() - started;
      await residentParity(residentRuntime, first, expected);
    } finally {
      first.dispose();
    }
    const warmedCompletionMs = await warmed(async () => {
      const started = performance.now();
      const result = await residentFrontend.ingestResident(units);
      try {
        await residentRuntime.device.queue.onSubmittedWorkDone();
        return performance.now() - started;
      } finally {
        result.dispose();
      }
    });
    return {
      cpuOracle: { cold: cold(cpuSetupMs, cpuFirstMs), warmedMs: cpuWarmed },
      gpuOwned: owned,
      gpuResident: {
        cold: cold(residentSetupMs, firstCompletionMs, encodingMs),
        warmedCompletionMs,
      },
    };
  } finally {
    residentRuntime.dispose();
  }
}

function wasmParserEligibility(plan: Uint8Array) {
  try {
    compileStrictIslandParserProgram(plan);
    return {
      eligible: true,
      reason: "Compiler-proven strict Wasm parser subset.",
    };
  } catch (error) {
    expect(
      error instanceof Error,
      "Wasm eligibility rejected with a non-Error.",
    );
    return { eligible: false, reason: error.message };
  }
}

const rows = [];
for (const name of ["funcfuck", "gpu-duck"]) {
  const grammar = exampleGrammar(name);
  const [plan, wasm, inputs] = await Promise.all([
    Deno.readFile(grammar.planPath),
    Deno.readFile(grammar.wasmPath),
    readExamplePrograms(grammar),
  ]);
  const inspection = inspectGpuFrontendPlan(plan);
  expect(inspection !== null, `${name} has no GPU frontend profile.`);
  expect(inputs.length > 0, `${name} has no example programs.`);
  for (const input of inputs) {
    console.error(
      `${name}/${input.name}: fresh setup, first calls, warmed samples`,
    );
    const encodingStarted = performance.now();
    const units = toUtf16(input.text);
    const encodingMs = performance.now() - encodingStarted;
    rows.push({
      grammar: name,
      input: `examples/${name}/programs/${input.name}`,
      sourceCodeUnits: input.text.length,
      sourceUtf8Bytes: new TextEncoder().encode(input.text).byteLength,
      utf16EncodingMs: encodingMs,
      plan: inspection,
      normalWasmParser: wasmParserEligibility(plan),
      lexers: await lexers(plan, wasm, units, encodingMs),
      frontends: await frontends(plan, input.text, units, encodingMs),
    });
  }
}
const report = {
  kind: "webgpu-checked-in-corpus",
  deno: Deno.version,
  options: config,
  methodology: {
    corpus:
      "Checked-in programs unchanged; no repetition, padding, or synthetic expansion.",
    cold:
      "Fresh backend instances per input; setup excludes file I/O; driver/JIT caches remain process-wide.",
    lexer:
      "Shipping raw Wasm lexer versus GPU; identical owned four-word records; preencoded UTF-16 units.",
    frontend:
      "TypeScript full-ingestion CPU oracle versus owned GPU flat IR and host semantics; not normal Wasm parsing.",
    resident:
      "Preencoded UTF-16 to device syntax IR; waits for completion; excludes readback and host semantics.",
    parity:
      "Full owned output checked outside timing; resident syntax checked once through separate readback outside timing.",
    capacity: "Default worst-case capacities for every GPU call.",
    errors: "Uncaptured GPU errors abort the benchmark.",
  },
  inputs: rows,
};
console.log(JSON.stringify(report));
if (config.jsonPath !== null) {
  await Deno.writeTextFile(
    config.jsonPath,
    `${JSON.stringify(report, null, 2)}\n`,
  );
}
