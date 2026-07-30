import type {
  BabaMetadata,
  Diagnostic,
  GeneratedBundle,
  GeneratedFile,
} from "../src/ast.ts";
import { generatedBundle } from "../src/bundle.ts";
import { analyzeGrammarDocumentForWasm } from "../src/compiler/grammar_wasm_analysis.ts";
import { DEFAULT_REGEX_NESTING_LIMIT } from "../src/compiler/regex/limits.ts";
import { parseGrammarSource } from "../src/grammar.ts";
import { parseMetadata } from "../src/metadata.ts";
import {
  planPortableRuntime,
  type RuntimeParserPlan,
  type RuntimePlanningMeasurement,
  type RuntimePlanningStage,
} from "../src/targets/runtime/plan.ts";
import { emitTreeSitterQueryFiles } from "../src/targets/tree_sitter_queries.ts";
import {
  emitWasmTarget,
  planWasmTarget,
  type WasmPlan,
  wasmRuntimePlanningOptions,
} from "../src/targets/wasm/plan.ts";

type CompilerStage =
  | "grammar-parse"
  | "grammar-analysis"
  | RuntimePlanningStage
  | "runtime-plan-total"
  | "wasm-plan"
  | "bundle-emission"
  | "pipeline-total";

interface SampleDistribution {
  readonly minimumMs: number;
  readonly p25Ms: number;
  readonly medianMs: number;
  readonly p75Ms: number;
  readonly maximumMs: number;
}

interface CompilerFixtureReport {
  readonly name: string;
  readonly path: string;
  readonly grammar: {
    readonly codeUnits: number;
    readonly bytes: number;
  };
  readonly analyzed: {
    readonly rules: number;
    readonly tokens: number;
    readonly literals: number;
  };
  readonly plan: {
    readonly lexerStates: number;
    readonly lexerTransitions: number;
    readonly parserStates: number;
    readonly parserActions: number;
    readonly parserGotos: number;
    readonly productions: number;
  };
  readonly output: {
    readonly files: number;
    readonly bytes: number;
  };
  readonly coldMs: Readonly<Record<CompilerStage, number>>;
  readonly steadyMs: Readonly<Record<CompilerStage, SampleDistribution>>;
}

interface CompilerBenchReport {
  readonly format: "baba-compiler-benchmark";
  readonly version: 1;
  readonly generatedAt: string;
  readonly engine: {
    readonly deno: string;
    readonly v8: string;
  };
  readonly warmupCount: number;
  readonly sampleCount: number;
  readonly fixtures: readonly CompilerFixtureReport[];
}

interface CompilerBenchOptions {
  readonly fixturesRoot: string;
  readonly fixtureNames: readonly string[];
  readonly warmupCount: number;
  readonly sampleCount: number;
  readonly jsonPath?: string;
  readonly jsonStdout: boolean;
}

interface PipelineRun {
  readonly stageMs: Readonly<Record<CompilerStage, number>>;
  readonly analyzed: {
    readonly rules: number;
    readonly tokens: number;
    readonly literals: number;
  };
  readonly runtimePlan: RuntimeParserPlan;
  readonly bundle: GeneratedBundle;
}

const compilerStages: readonly CompilerStage[] = [
  "grammar-parse",
  "grammar-analysis",
  "regex-automata",
  "literal-overlap",
  "combined-lexer-dfa",
  "bnf-lowering",
  "lr-table",
  "token-overlap",
  "token-shadowing",
  "unused-skips",
  "portable-encoding",
  "portable-metadata",
  "runtime-plan-total",
  "wasm-plan",
  "bundle-emission",
  "pipeline-total",
];
const textEncoder = new TextEncoder();

if (import.meta.main) {
  const options = parseArgs(Deno.args);
  const report = await buildCompilerBenchReport(options);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options.jsonPath !== undefined) {
    await Deno.writeTextFile(options.jsonPath, json);
  }
  if (options.jsonStdout) {
    console.log(json.trimEnd());
  } else {
    console.log(renderTextReport(report));
  }
}

async function buildCompilerBenchReport(
  options: CompilerBenchOptions,
): Promise<CompilerBenchReport> {
  let fixtureNames = [...options.fixtureNames];
  if (fixtureNames.length === 0) {
    fixtureNames = await discoverFixtures(options.fixturesRoot);
  }
  const fixtures: CompilerFixtureReport[] = [];
  for (const name of fixtureNames) {
    fixtures.push(await benchFixture(options, name));
  }
  return {
    format: "baba-compiler-benchmark",
    version: 1,
    generatedAt: new Date().toISOString(),
    engine: {
      deno: Deno.version.deno,
      v8: Deno.version.v8,
    },
    warmupCount: options.warmupCount,
    sampleCount: options.sampleCount,
    fixtures,
  };
}

async function benchFixture(
  options: CompilerBenchOptions,
  name: string,
): Promise<CompilerFixtureReport> {
  const fixturePath = `${options.fixturesRoot}/${name}`;
  const [grammarSource, metadata] = await Promise.all([
    Deno.readTextFile(`${fixturePath}/grammar.baba`),
    readOptionalMetadata(`${fixturePath}/baba.json`),
  ]);
  let selectedMetadata: BabaMetadata = {};
  if (metadata !== undefined) {
    selectedMetadata = metadata;
  }
  const cold = runPipeline(name, grammarSource, selectedMetadata);
  for (let warmup = 0; warmup < options.warmupCount; warmup++) {
    runPipeline(name, grammarSource, selectedMetadata);
  }
  const samples = new Map<CompilerStage, number[]>();
  for (const stage of compilerStages) {
    samples.set(stage, []);
  }
  let finalRun = cold;
  for (let sample = 0; sample < options.sampleCount; sample++) {
    finalRun = runPipeline(name, grammarSource, selectedMetadata);
    for (const stage of compilerStages) {
      const duration = finalRun.stageMs[stage];
      const stageSamples = samples.get(stage);
      if (stageSamples === undefined) {
        throw new Error(`Compiler benchmark stage '${stage}' disappeared.`);
      }
      stageSamples.push(duration);
    }
  }
  const steadyMs = {} as Record<CompilerStage, SampleDistribution>;
  for (const stage of compilerStages) {
    const stageSamples = samples.get(stage);
    if (stageSamples === undefined) {
      throw new Error(`Compiler benchmark stage '${stage}' has no samples.`);
    }
    steadyMs[stage] = distribution(stageSamples);
  }
  return {
    name,
    path: fixturePath,
    grammar: {
      codeUnits: grammarSource.length,
      bytes: textEncoder.encode(grammarSource).byteLength,
    },
    analyzed: finalRun.analyzed,
    plan: {
      lexerStates: finalRun.runtimePlan.dfa.states.length,
      lexerTransitions:
        finalRun.runtimePlan.analysisStats.combinedLexerDfaTransitions,
      parserStates: finalRun.runtimePlan.lr.states.length,
      parserActions: countTableEntries(finalRun.runtimePlan.lr.actions),
      parserGotos: countTableEntries(finalRun.runtimePlan.lr.gotos),
      productions: finalRun.runtimePlan.bnf.productions.length,
    },
    output: {
      files: finalRun.bundle.files.length,
      bytes: bundleBytes(finalRun.bundle),
    },
    coldMs: cold.stageMs,
    steadyMs,
  };
}

function runPipeline(
  name: string,
  grammarSource: string,
  metadata: BabaMetadata,
): PipelineRun {
  const stageMs = emptyStageRecord();
  const pipelineStarted = performance.now();

  let stageStarted = performance.now();
  const parsed = parseGrammarSource(grammarSource);
  stageMs["grammar-parse"] = performance.now() - stageStarted;
  throwOnDiagnostics(name, parsed.diagnostics);
  if (parsed.grammar === undefined) {
    throw new Error(`Fixture ${name} did not produce a grammar document.`);
  }

  const runtimeOptions = wasmRuntimePlanningOptions({});
  let regexNestingLimit = DEFAULT_REGEX_NESTING_LIMIT;
  if (runtimeOptions.regexNestingLimit !== undefined) {
    regexNestingLimit = runtimeOptions.regexNestingLimit;
  }
  stageStarted = performance.now();
  const analyzed = analyzeGrammarDocumentForWasm(parsed.grammar, {
    name,
    regexLimits: {
      sourceLengthLimit: runtimeOptions.regexSourceLengthLimit,
      nestingLimit: regexNestingLimit,
    },
    grammarExpressionDepthLimit: runtimeOptions.grammarExpressionDepthLimit,
  });
  stageMs["grammar-analysis"] = performance.now() - stageStarted;
  throwOnDiagnostics(name, analyzed.diagnostics);

  const planningMeasurements: RuntimePlanningMeasurement[] = [];
  stageStarted = performance.now();
  const runtimePlanResult = planPortableRuntime(
    analyzed,
    runtimeOptions,
    metadata,
    (measurement) => planningMeasurements.push(measurement),
  );
  stageMs["runtime-plan-total"] = performance.now() - stageStarted;
  throwOnDiagnostics(name, runtimePlanResult.diagnostics);
  if (!isRuntimePlan(runtimePlanResult)) {
    throw new Error(`Fixture ${name} did not produce a runtime plan.`);
  }
  for (const measurement of planningMeasurements) {
    stageMs[measurement.stage] = measurement.durationMs;
  }

  stageStarted = performance.now();
  const wasmPlanResult = planWasmTarget(
    analyzed,
    {},
    metadata,
    runtimePlanResult,
  );
  stageMs["wasm-plan"] = performance.now() - stageStarted;
  throwOnDiagnostics(name, wasmPlanResult.diagnostics);
  if (!isWasmPlan(wasmPlanResult)) {
    throw new Error(`Fixture ${name} did not produce a Wasm plan.`);
  }

  stageStarted = performance.now();
  const files: GeneratedFile[] = [
    ...emitWasmTarget(wasmPlanResult),
    ...emitTreeSitterQueryFiles(analyzed, metadata),
  ];
  const bundle = generatedBundle(files);
  stageMs["bundle-emission"] = performance.now() - stageStarted;
  stageMs["pipeline-total"] = performance.now() - pipelineStarted;

  return {
    stageMs,
    analyzed: {
      rules: analyzed.rules.length,
      tokens: analyzed.tokens.length,
      literals: analyzed.literals.length,
    },
    runtimePlan: runtimePlanResult,
    bundle,
  };
}

function emptyStageRecord(): Record<CompilerStage, number> {
  const stages = {} as Record<CompilerStage, number>;
  for (const stage of compilerStages) {
    stages[stage] = 0;
  }
  return stages;
}

function isRuntimePlan(
  result: RuntimeParserPlan | { diagnostics: readonly Diagnostic[] },
): result is RuntimeParserPlan {
  return "portable" in result;
}

function isWasmPlan(
  result: WasmPlan | { diagnostics: readonly Diagnostic[] },
): result is WasmPlan {
  return "wasm" in result;
}

function throwOnDiagnostics(
  fixture: string,
  diagnostics: readonly Diagnostic[],
): void {
  const errors = diagnostics.filter((diagnostic) => {
    if (diagnostic.severity === undefined) {
      return true;
    }
    return diagnostic.severity === "error";
  });
  if (errors.length === 0) {
    return;
  }
  throw new Error(
    `Fixture ${fixture} failed:\n${
      errors.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        .join("\n")
    }`,
  );
}

function countTableEntries<T>(
  rows: ReadonlyMap<number, ReadonlyMap<number, T>>,
): number {
  let count = 0;
  for (const row of rows.values()) {
    count += row.size;
  }
  return count;
}

function bundleBytes(bundle: GeneratedBundle): number {
  let bytes = 0;
  for (const file of bundle.files) {
    if (file.encoding === "binary") {
      bytes += file.content.byteLength;
    } else {
      bytes += textEncoder.encode(file.content).byteLength;
    }
  }
  return bytes;
}

function distribution(samples: readonly number[]): SampleDistribution {
  if (samples.length === 0) {
    throw new Error("Compiler benchmark distribution is empty.");
  }
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    minimumMs: selectedPercentile(sorted, 0),
    p25Ms: selectedPercentile(sorted, 0.25),
    medianMs: selectedPercentile(sorted, 0.5),
    p75Ms: selectedPercentile(sorted, 0.75),
    maximumMs: selectedPercentile(sorted, 1),
  };
}

function selectedPercentile(
  sorted: readonly number[],
  percentile: number,
): number {
  const index = Math.floor((sorted.length - 1) * percentile);
  const selected = sorted[index];
  if (selected === undefined) {
    throw new Error(
      `Compiler benchmark percentile ${percentile} has no sample at index ${index}.`,
    );
  }
  return selected;
}

async function discoverFixtures(fixturesRoot: string): Promise<string[]> {
  const names: string[] = [];
  await discoverFixtureDirectory(fixturesRoot, "", names);
  return names.sort();
}

async function discoverFixtureDirectory(
  fixturesRoot: string,
  relativeDirectory: string,
  names: string[],
): Promise<void> {
  let directory = fixturesRoot;
  if (relativeDirectory !== "") {
    directory = `${fixturesRoot}/${relativeDirectory}`;
  }
  for await (const entry of Deno.readDir(directory)) {
    if (!entry.isDirectory) {
      continue;
    }
    let relativePath = entry.name;
    if (relativeDirectory !== "") {
      relativePath = `${relativeDirectory}/${entry.name}`;
    }
    const grammarPath = `${fixturesRoot}/${relativePath}/grammar.baba`;
    try {
      const file = await Deno.stat(grammarPath);
      if (file.isFile) {
        names.push(relativePath);
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
    await discoverFixtureDirectory(fixturesRoot, relativePath, names);
  }
}

async function readOptionalMetadata(
  path: string,
): Promise<BabaMetadata | undefined> {
  try {
    return parseMetadata(await Deno.readTextFile(path));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return undefined;
    }
    throw error;
  }
}

function renderTextReport(report: CompilerBenchReport): string {
  const lines = [
    "Baba compiler benchmark",
    `engine: Deno ${report.engine.deno}, V8 ${report.engine.v8}; ${report.warmupCount} warmups, ${report.sampleCount} samples`,
  ];
  for (const fixture of report.fixtures) {
    const runtimeTotal = fixture.steadyMs["runtime-plan-total"].medianMs;
    lines.push(
      "",
      `${fixture.name}: ${fixture.grammar.bytes} grammar bytes, ${fixture.analyzed.rules} rules, ${fixture.analyzed.tokens} tokens`,
      `  pipeline: cold ${formatMs(fixture.coldMs["pipeline-total"])}, steady ${
        formatDistribution(fixture.steadyMs["pipeline-total"])
      }`,
      `  grammar parse: ${
        formatDistribution(fixture.steadyMs["grammar-parse"])
      }`,
      `  grammar analysis: ${
        formatDistribution(fixture.steadyMs["grammar-analysis"])
      }`,
      `  runtime plan: ${
        formatDistribution(fixture.steadyMs["runtime-plan-total"])
      }`,
    );
    for (const stage of runtimePlanningStages()) {
      const distribution = fixture.steadyMs[stage];
      lines.push(
        `    ${stage}: ${formatDistribution(distribution)}, ${
          formatPercent(distribution.medianMs, runtimeTotal)
        } of runtime plan`,
      );
    }
    lines.push(
      `  Wasm plan: ${formatDistribution(fixture.steadyMs["wasm-plan"])}`,
      `  bundle emission: ${
        formatDistribution(fixture.steadyMs["bundle-emission"])
      }`,
      `  output: ${fixture.output.files} files, ${fixture.output.bytes} bytes`,
      `  plan: ${fixture.plan.lexerStates} lexer states / ${fixture.plan.lexerTransitions} transitions, ${fixture.plan.parserStates} parser states / ${fixture.plan.parserActions} actions / ${fixture.plan.parserGotos} gotos`,
    );
  }
  return lines.join("\n");
}

function runtimePlanningStages(): readonly RuntimePlanningStage[] {
  return [
    "regex-automata",
    "literal-overlap",
    "combined-lexer-dfa",
    "bnf-lowering",
    "lr-table",
    "token-overlap",
    "token-shadowing",
    "unused-skips",
    "portable-encoding",
    "portable-metadata",
  ];
}

function formatDistribution(measurement: SampleDistribution): string {
  return `${formatMs(measurement.p25Ms)} p25 / ${
    formatMs(measurement.medianMs)
  } median / ${formatMs(measurement.p75Ms)} p75`;
}

function formatMs(milliseconds: number): string {
  return `${milliseconds.toFixed(2)} ms`;
}

function formatPercent(part: number, whole: number): string {
  if (whole === 0) {
    return "0.0%";
  }
  return `${(part * 100 / whole).toFixed(1)}%`;
}

function parseArgs(args: readonly string[]): CompilerBenchOptions {
  let fixturesRoot = "fixtures/perf";
  const fixtureNames: string[] = [];
  let warmupCount = 3;
  let sampleCount = 12;
  let jsonPath: string | undefined;
  let jsonStdout = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--") {
      continue;
    }
    if (argument === "--fixtures-root") {
      const path = args[++index];
      if (path === undefined) {
        throw new Error("Expected a path after --fixtures-root.");
      }
      fixturesRoot = path;
      continue;
    }
    if (argument === "--fixture") {
      const name = args[++index];
      if (name === undefined) {
        throw new Error("Expected a fixture name after --fixture.");
      }
      fixtureNames.push(name);
      continue;
    }
    if (argument === "--warmups") {
      warmupCount = positiveIntegerArgument(args[++index], "--warmups", true);
      continue;
    }
    if (argument === "--samples") {
      sampleCount = positiveIntegerArgument(args[++index], "--samples", false);
      continue;
    }
    if (argument === "--json") {
      const path = args[index + 1];
      if (path !== undefined && !path.startsWith("--")) {
        jsonPath = path;
        index++;
      } else {
        jsonStdout = true;
      }
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      console.log(
        "Usage: deno run --allow-read --allow-write scripts/compiler_bench.ts [--fixture NAME] [--warmups COUNT] [--samples COUNT] [--json [PATH]]",
      );
      Deno.exit(0);
    }
    throw new Error(`Unknown compiler benchmark argument '${argument}'.`);
  }
  return {
    fixturesRoot,
    fixtureNames,
    warmupCount,
    sampleCount,
    jsonPath,
    jsonStdout,
  };
}

function positiveIntegerArgument(
  source: string | undefined,
  name: string,
  allowZero: boolean,
): number {
  const value = Number(source);
  let valid = Number.isSafeInteger(value);
  if (allowZero) {
    valid = valid && value >= 0;
  } else {
    valid = valid && value > 0;
  }
  if (!valid) {
    let expectation = "a positive";
    if (allowZero) {
      expectation = "a non-negative";
    }
    throw new Error(
      `${name} must be ${expectation} integer, got '${source}'.`,
    );
  }
  return value;
}
