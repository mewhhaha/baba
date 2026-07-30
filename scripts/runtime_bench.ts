import {
  applyBundle,
  type BabaMetadata,
  compile,
  type GeneratedBundle,
  type GeneratedFile,
  parseMetadata,
} from "../src/mod.ts";
import { inspectCombinedWasmParserPlan } from "../src/runtime/wasm_plan.ts";

export interface RuntimeBenchReport {
  readonly format: "baba-runtime-benchmark";
  readonly version: 2;
  readonly generatedAt: string;
  readonly engine: {
    readonly deno: string;
    readonly v8: string;
    readonly wasmCorePath: string | null;
    readonly sharedRuntimeImportMs: number;
  };
  readonly fixtures: readonly FixtureReport[];
  readonly budget?: RuntimeBudgetResult;
}

export interface FixtureReport {
  readonly name: string;
  readonly path: string;
  readonly planStats: PlanStats;
  readonly artifactSizes: ArtifactSizes;
  readonly targets: {
    readonly wasm?: WasmTargetTiming;
  };
}

export interface TargetTiming {
  readonly generatedBytes: number;
  readonly compileGrammarMs: number;
  readonly writeBundleMs: number;
  readonly importMs: number;
  readonly createParserMs: number;
  readonly cold: {
    readonly lexSmallMs: number;
    readonly validateSmallMs: number;
    readonly parseSmallMs: number;
    readonly parseMediumMs: number;
    readonly parseLargeMs: number;
  };
  readonly hot: {
    readonly sourceCodeUnits: number;
    readonly tokenCount: number;
    readonly lex: SampleDistribution;
    readonly validate: SampleDistribution;
    readonly parse: SampleDistribution;
    readonly validateEarlyError: SampleDistribution;
    readonly validateLateError: SampleDistribution;
    readonly incrementalValidate: SampleDistribution;
    readonly incrementalWork: {
      readonly scannedCodeUnits: number;
      readonly parserActions: number;
      readonly reusedTokens: number;
      readonly reusedCheckpoints: number;
    };
  };
  readonly memoryPages: {
    readonly afterCreate: number;
    readonly afterLex: number;
    readonly afterValidate: number;
    readonly afterParse: number;
    readonly highWater: number;
  };
}

export interface WasmTargetTiming extends TargetTiming {
  readonly wasmBytes: number;
  readonly compileModuleMs: number | null;
  readonly instantiateMs: number;
}

export interface SampleDistribution {
  readonly p25Ms: number;
  readonly medianMs: number;
}

export interface ArtifactSizes {
  readonly wasmAdapterSourceBytes: number;
  readonly externalWasmBytes: number;
  readonly abiJsonBytes: number;
  readonly parserPlanBinaryBytes: number;
  readonly corePlanBinaryBytes: number;
  readonly runtimeMetadataBinaryBytes: number;
  readonly totalGeneratedBytes: number;
  readonly largestFile: { readonly path: string; readonly bytes: number };
}

export interface PlanStats {
  readonly lexerStateCount: number;
  readonly lexerTransitionCount: number;
  readonly acceptCandidateCount: number;
  readonly lrStateCount: number;
  readonly actionEntries: number;
  readonly gotoEntries: number;
  readonly productionCount: number;
}

interface RuntimeBudgetConfig {
  readonly runtimeBudgets?: Record<string, RuntimeFixtureBudget>;
}

interface RuntimeFixtureBudget {
  readonly wasmBytesMax?: number | BudgetPair;
  readonly wasmColdInstantiateMsMax?: number | BudgetPair;
  readonly smallParseMsMax?: number | BudgetPair;
  readonly parserPlanBinaryBytesMax?: number | BudgetPair;
  readonly runtimeMetadataBinaryBytesMax?: number | BudgetPair;
}

interface BudgetPair {
  readonly currentBudget: number;
  readonly targetBudget?: number;
}

export interface RuntimeBudgetResult {
  readonly path: string;
  readonly ok: boolean;
  readonly checks: readonly RuntimeBudgetCheck[];
}

interface RuntimeBudgetCheck {
  readonly fixture: string;
  readonly name: string;
  readonly actual: number;
  readonly currentBudget: number;
  readonly targetBudget?: number;
  readonly ok: boolean;
}

interface CliOptions {
  readonly fixturesRoot: string;
  readonly fixtureNames: readonly string[];
  readonly jsonPath?: string;
  readonly jsonStdout: boolean;
  readonly budgetPath?: string;
  readonly compare?: readonly [string, string];
  readonly wasmCorePath?: string;
}

const textEncoder = new TextEncoder();
const pinnedDenoVersion = "2.9.4";
const pinnedV8Version = "15.0.245.2-rusty";
const hotSourceMinimumCodeUnits = 512 * 1024;
const hotWarmupCount = 12;
const hotSampleCount = 50;

if (import.meta.main) {
  const options = parseArgs(Deno.args);
  if (options.compare) {
    const [before, after] = options.compare;
    const beforeReport = JSON.parse(
      await Deno.readTextFile(before),
    ) as RuntimeBenchReport;
    const afterReport = JSON.parse(
      await Deno.readTextFile(after),
    ) as RuntimeBenchReport;
    console.log(renderComparison(beforeReport, afterReport));
  } else {
    const report = await buildRuntimeBenchReport(options);
    const budgeted = options.budgetPath
      ? await applyRuntimeBudgets(report, options.budgetPath)
      : report;
    const json = `${JSON.stringify(budgeted, null, 2)}\n`;
    if (options.jsonPath) await Deno.writeTextFile(options.jsonPath, json);
    console.log(
      options.jsonStdout ? json.trimEnd() : renderTextReport(budgeted),
    );
    if (budgeted.budget && !budgeted.budget.ok) Deno.exit(1);
  }
}

export async function buildRuntimeBenchReport(
  options: Partial<CliOptions> = {},
): Promise<RuntimeBenchReport> {
  assertPinnedEngine();
  const fixturesRoot = options.fixturesRoot ?? "fixtures/perf";
  const fixtureNames = options.fixtureNames?.length
    ? options.fixtureNames
    : await discoverFixtures(fixturesRoot);
  const fixtures: FixtureReport[] = [];
  const sharedRuntimeImport = await timeAsync(() =>
    import("@mewhhaha/baba/runtime/generated-wasm")
  );
  for (const name of fixtureNames) {
    fixtures.push(
      await benchFixture(fixturesRoot, name, options.wasmCorePath),
    );
  }
  return {
    format: "baba-runtime-benchmark",
    version: 2,
    generatedAt: new Date().toISOString(),
    engine: {
      deno: Deno.version.deno,
      v8: Deno.version.v8,
      wasmCorePath: optionalPath(options.wasmCorePath),
      sharedRuntimeImportMs: sharedRuntimeImport.ms,
    },
    fixtures,
  };
}

async function benchFixture(
  fixturesRoot: string,
  name: string,
  wasmCorePath: string | undefined,
): Promise<FixtureReport> {
  const fixturePath = `${fixturesRoot}/${name}`;
  const [grammarSource, metadata, smallInput, mediumInput, largeInput] =
    await Promise.all([
      Deno.readTextFile(`${fixturePath}/grammar.baba`),
      readOptionalMetadata(`${fixturePath}/baba.json`),
      Deno.readTextFile(`${fixturePath}/small.input`),
      Deno.readTextFile(`${fixturePath}/medium.input`),
      Deno.readTextFile(`${fixturePath}/large.input`),
    ]);

  const compiled = time(() =>
    compile(grammarSource, {
      name,
      metadata,
      targets: ["wasm"],
    })
  );
  throwOnDiagnostics(name, compiled.value.diagnostics);
  const bundle = requireBundle(name, compiled.value.bundle);

  const planStats = planStatsFromBundle(bundle);
  const artifactSizes = artifactSizesFromBundle(bundle);
  const wasm = await benchWasmTarget(
    name,
    bundle,
    compiled.ms,
    smallInput,
    mediumInput,
    largeInput,
    wasmCorePath,
  );

  return {
    name,
    path: fixturePath,
    planStats,
    artifactSizes,
    targets: {
      wasm,
    },
  };
}

async function benchWasmTarget(
  name: string,
  bundle: GeneratedBundle,
  compileGrammarMs: number,
  smallInput: string,
  mediumInput: string,
  largeInput: string,
  wasmCorePath: string | undefined,
): Promise<WasmTargetTiming> {
  const tempDir = await Deno.makeTempDir({
    prefix: "baba-runtime-bench-wasm-",
  });
  const write = await timeAsync(() => applyBundle(bundle, { root: tempDir }));
  const imported = await timeAsync(() =>
    import(pathToFileUrl(`${tempDir}/wasm/mod.ts`).href)
  );
  let wasmBytes = await Deno.readFile(`${tempDir}/wasm/parser.wasm`);
  if (wasmCorePath !== undefined) {
    wasmBytes = await Deno.readFile(wasmCorePath);
  }
  const planBytes = await Deno.readFile(`${tempDir}/wasm/parser.plan`);
  const compileModule = time(() =>
    new WebAssembly.Module(
      arrayBufferFor(wasmBytes),
    )
  );
  const create = time(() =>
    imported.value.createParser({
      module: compileModule.value,
      plan: planBytes,
    })
  );
  const parser = create.value as {
    lex(source: string): RuntimeLexTapeLike;
    parse(
      source: string,
    ): RuntimeCursorParseLike;
    validate(source: string): RuntimeParseLike;
    createDocument(
      source: string,
      options: { readonly goal: "validate" },
    ): RuntimeIncrementalDocumentLike;
    dispose(): void;
  };
  const afterCreate = runtimeMemoryPages(parser);
  assertValidTimedInput(name, "small", parser, smallInput);
  assertValidTimedInput(name, "medium", parser, mediumInput);
  assertValidTimedInput(name, "large", parser, largeInput);

  const coldLex = time(() => parser.lex(smallInput));
  const afterLex = runtimeMemoryPages(parser);
  const coldValidate = time(() => parser.validate(smallInput));
  const afterValidate = runtimeMemoryPages(parser);
  const coldParse = time(() => parser.parse(smallInput));
  const coldParseMedium = time(() => parser.parse(mediumInput));
  const coldParseLarge = time(() => parser.parse(largeInput));

  const hotSource = repeatSource(smallInput, hotSourceMinimumCodeUnits);
  assertValidTimedInput(name, "hot", parser, hotSource);
  const hot = benchmarkHotPaths(parser, hotSource);
  const afterParse = runtimeMemoryPages(parser);
  const timing: WasmTargetTiming = {
    generatedBytes: generatedBytes(bundle.files),
    wasmBytes: wasmBytes.byteLength,
    compileGrammarMs,
    writeBundleMs: write.ms,
    importMs: imported.ms,
    createParserMs: create.ms,
    compileModuleMs: compileModule.ms,
    instantiateMs: create.ms,
    cold: {
      lexSmallMs: coldLex.ms,
      validateSmallMs: coldValidate.ms,
      parseSmallMs: coldParse.ms,
      parseMediumMs: coldParseMedium.ms,
      parseLargeMs: coldParseLarge.ms,
    },
    hot,
    memoryPages: {
      afterCreate,
      afterLex,
      afterValidate,
      afterParse,
      highWater: Math.max(afterCreate, afterLex, afterValidate, afterParse),
    },
  };
  parser.dispose();
  await Deno.remove(tempDir, { recursive: true });
  return timing;
}

interface RuntimeLexTapeLike {
  readonly tokenTape: { readonly length: number };
  readonly diagnostics: readonly unknown[];
}

interface RuntimeCursorParseLike {
  readonly ok?: boolean;
  readonly cursor?: unknown;
  readonly diagnostics?: readonly unknown[];
}

interface RuntimeParseLike {
  readonly ok?: boolean;
  readonly diagnostics?: readonly unknown[];
}

interface RuntimeParserLike {
  lex(source: string): RuntimeLexTapeLike;
  parse(source: string): RuntimeCursorParseLike;
  validate(source: string): RuntimeParseLike;
  createDocument(
    source: string,
    options: { readonly goal: "validate" },
  ): RuntimeIncrementalDocumentLike;
}

interface RuntimeIncrementalDocumentLike {
  applyEdits(
    edits: readonly {
      readonly start: number;
      readonly oldEnd: number;
      readonly newText: string;
    }[],
  ): {
    readonly lexer: {
      readonly scannedCodeUnits: number;
      readonly reusedTokens: number;
    };
    readonly parser: {
      readonly parserActions: number;
      readonly reusedCheckpoints: number;
    };
  };
  dispose(): void;
}

function assertValidTimedInput(
  fixture: string,
  inputName: string,
  parser: RuntimeParserLike,
  source: string,
): void {
  const lexed = parser.lex(source);
  if (lexed.diagnostics.length !== 0) {
    throw new Error(
      `Fixture ${fixture} ${inputName} input lexed with ${lexed.diagnostics.length} diagnostics.`,
    );
  }
  const validated = parser.validate(source);
  if (validated.ok !== true) {
    throw new Error(
      `Fixture ${fixture} ${inputName} input did not validate: ${
        JSON.stringify(validated.diagnostics)
      }.`,
    );
  }
  const parsed = parser.parse(source);
  if (parsed.ok !== true) {
    throw new Error(
      `Fixture ${fixture} ${inputName} input did not parse: ${
        JSON.stringify(parsed.diagnostics)
      }.`,
    );
  }
}

function repeatSource(source: string, minimumCodeUnits: number): string {
  if (source.length === 0) {
    throw new Error("A runtime benchmark fixture input must not be empty.");
  }
  let repeated = source;
  while (repeated.length < minimumCodeUnits) {
    repeated += source;
  }
  return repeated;
}

function benchmarkHotPaths(
  parser: RuntimeParserLike,
  source: string,
): TargetTiming["hot"] {
  const earlyError = `\u0000${source}`;
  const lateError = `${source}\u0000`;
  const earlyResult = parser.validate(earlyError);
  if (earlyResult.ok !== false) {
    throw new Error(
      "Runtime benchmark early-error input unexpectedly validated.",
    );
  }
  const lateResult = parser.validate(lateError);
  if (lateResult.ok !== false) {
    throw new Error(
      "Runtime benchmark late-error input unexpectedly validated.",
    );
  }
  const operations: readonly (() => unknown)[] = [
    () => parser.lex(source),
    () => parser.validate(source),
    () => parser.parse(source),
    () => parser.validate(earlyError),
    () => parser.validate(lateError),
  ];
  for (let warmup = 0; warmup < hotWarmupCount; warmup++) {
    for (let offset = 0; offset < operations.length; offset++) {
      const operation = operations[(warmup + offset) % operations.length];
      if (operation === undefined) {
        throw new Error("Runtime benchmark operation disappeared.");
      }
      operation();
    }
  }

  const samples = operations.map(() => [] as number[]);
  for (let sample = 0; sample < hotSampleCount; sample++) {
    for (let offset = 0; offset < operations.length; offset++) {
      const operationIndex = (sample + offset) % operations.length;
      const operation = operations[operationIndex];
      const operationSamples = samples[operationIndex];
      if (operation === undefined || operationSamples === undefined) {
        throw new Error("Runtime benchmark sample operation disappeared.");
      }
      operationSamples.push(time(operation).ms);
    }
  }
  const lexed = parser.lex(source);
  const incremental = benchmarkIncrementalValidation(parser, source);
  return {
    sourceCodeUnits: source.length,
    tokenCount: lexed.tokenTape.length,
    lex: sampleDistribution(samples[0]),
    validate: sampleDistribution(samples[1]),
    parse: sampleDistribution(samples[2]),
    validateEarlyError: sampleDistribution(samples[3]),
    validateLateError: sampleDistribution(samples[4]),
    incrementalValidate: incremental.distribution,
    incrementalWork: incremental.work,
  };
}

function benchmarkIncrementalValidation(
  parser: RuntimeParserLike,
  source: string,
): {
  readonly distribution: SampleDistribution;
  readonly work: TargetTiming["hot"]["incrementalWork"];
} {
  const document = parser.createDocument(source, { goal: "validate" });
  const offset = Math.floor(source.length / 2);
  const replacement = source.slice(offset, offset + 1);
  const edit = [{ start: offset, oldEnd: offset + 1, newText: replacement }];
  for (let warmup = 0; warmup < hotWarmupCount; warmup++) {
    document.applyEdits(edit);
  }
  const samples: number[] = [];
  let work: TargetTiming["hot"]["incrementalWork"] | undefined;
  for (let sample = 0; sample < hotSampleCount; sample++) {
    const measured = time(() => document.applyEdits(edit));
    samples.push(measured.ms);
    work = {
      scannedCodeUnits: measured.value.lexer.scannedCodeUnits,
      parserActions: measured.value.parser.parserActions,
      reusedTokens: measured.value.lexer.reusedTokens,
      reusedCheckpoints: measured.value.parser.reusedCheckpoints,
    };
  }
  document.dispose();
  if (work === undefined) {
    throw new Error("Runtime incremental benchmark produced no work sample.");
  }
  return { distribution: sampleDistribution(samples), work };
}

function sampleDistribution(
  samples: readonly number[] | undefined,
): SampleDistribution {
  if (samples === undefined || samples.length !== hotSampleCount) {
    let sampleCount = 0;
    if (samples !== undefined) {
      sampleCount = samples.length;
    }
    throw new Error(
      `Expected ${hotSampleCount} runtime benchmark samples, received ${sampleCount}.`,
    );
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const p25Index = Math.floor((sorted.length - 1) * 0.25);
  const medianIndex = Math.floor((sorted.length - 1) * 0.5);
  const p25 = sorted[p25Index];
  const median = sorted[medianIndex];
  if (p25 === undefined || median === undefined) {
    throw new Error("Runtime benchmark distribution is empty.");
  }
  return { p25Ms: p25, medianMs: median };
}

function runtimeMemoryPages(parser: object): number {
  const runtime = parser as {
    readonly wasm?: { readonly memory?: WebAssembly.Memory };
  };
  const memory = runtime.wasm?.memory;
  if (memory === undefined) {
    throw new Error("Runtime benchmark could not inspect Wasm linear memory.");
  }
  return memory.buffer.byteLength / 65_536;
}

function assertPinnedEngine(): void {
  if (
    Deno.version.deno !== pinnedDenoVersion ||
    Deno.version.v8 !== pinnedV8Version
  ) {
    throw new Error(
      `Runtime benchmark requires Deno ${pinnedDenoVersion} / V8 ${pinnedV8Version}; received Deno ${Deno.version.deno} / V8 ${Deno.version.v8}.`,
    );
  }
}

function optionalPath(path: string | undefined): string | null {
  if (path === undefined) {
    return null;
  }
  return path;
}

function planStatsFromBundle(bundle: GeneratedBundle): PlanStats {
  const file = bundle.files.find((entry) => entry.path === "wasm/parser.plan");
  if (file === undefined) {
    throw new Error("Wasm bundle did not include wasm/parser.plan.");
  }
  if (file.encoding !== "binary") {
    throw new Error("wasm/parser.plan must be binary.");
  }
  const plan = inspectCombinedWasmParserPlan(file.content);
  return {
    lexerStateCount: plan.tables.lexerStates,
    lexerTransitionCount: plan.tables.lexerTransitions,
    acceptCandidateCount: plan.tables.lexerAcceptCandidates,
    lrStateCount: plan.tables.parserStates,
    actionEntries: plan.tables.parserActions,
    gotoEntries: plan.tables.parserGotos,
    productionCount: plan.tables.productions,
  };
}

function artifactSizesFromBundle(bundle: GeneratedBundle): ArtifactSizes {
  const files = bundle.files.map((file) => ({
    path: file.path,
    bytes: fileBytes(file),
  }));
  const byPath = new Map(files.map((file) => [file.path, file.bytes]));
  const largestFile = files.reduce(
    (largest, file) => file.bytes > largest.bytes ? file : largest,
    { path: "", bytes: 0 },
  );
  const parserPlan = bundle.files.find((file) =>
    file.path === "wasm/parser.plan"
  );
  if (parserPlan === undefined || parserPlan.encoding !== "binary") {
    throw new Error("Wasm bundle did not include a binary wasm/parser.plan.");
  }
  const plan = inspectCombinedWasmParserPlan(parserPlan.content);
  return {
    wasmAdapterSourceBytes: files.filter((file) =>
      file.path.startsWith("wasm/") && file.path.endsWith(".ts")
    ).reduce((sum, file) => sum + file.bytes, 0),
    externalWasmBytes: binaryBytes(bundle.files, ".wasm"),
    abiJsonBytes: byPath.get("wasm/abi.json") ?? 0,
    parserPlanBinaryBytes: files
      .filter((file) => file.path.endsWith("/parser.plan"))
      .reduce((sum, file) => sum + file.bytes, 0),
    corePlanBinaryBytes: plan.corePlanBytes,
    runtimeMetadataBinaryBytes: plan.runtimeMetadataBytes,
    totalGeneratedBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    largestFile,
  };
}

export async function applyRuntimeBudgets(
  report: RuntimeBenchReport,
  budgetPath: string,
): Promise<RuntimeBenchReport> {
  const config = JSON.parse(
    await Deno.readTextFile(budgetPath),
  ) as RuntimeBudgetConfig;
  const checks: RuntimeBudgetCheck[] = [];
  for (const fixture of report.fixtures) {
    const budget = config.runtimeBudgets?.[fixture.name];
    if (!budget) continue;
    const wasm = fixture.targets.wasm;
    addRuntimeBudgetCheck(
      checks,
      fixture.name,
      "wasmBytesMax",
      wasm?.wasmBytes,
      budget.wasmBytesMax,
    );
    addRuntimeBudgetCheck(
      checks,
      fixture.name,
      "wasmColdInstantiateMsMax",
      wasm?.instantiateMs,
      budget.wasmColdInstantiateMsMax,
    );
    addRuntimeBudgetCheck(
      checks,
      fixture.name,
      "smallParseMsMax",
      wasm?.cold.parseSmallMs,
      budget.smallParseMsMax,
    );
    addRuntimeBudgetCheck(
      checks,
      fixture.name,
      "parserPlanBinaryBytesMax",
      fixture.artifactSizes.parserPlanBinaryBytes,
      budget.parserPlanBinaryBytesMax,
    );
    addRuntimeBudgetCheck(
      checks,
      fixture.name,
      "runtimeMetadataBinaryBytesMax",
      fixture.artifactSizes.runtimeMetadataBinaryBytes,
      budget.runtimeMetadataBinaryBytesMax,
    );
  }
  return {
    ...report,
    budget: {
      path: budgetPath,
      checks,
      ok: checks.every((check) => check.ok),
    },
  };
}

function addRuntimeBudgetCheck(
  checks: RuntimeBudgetCheck[],
  fixture: string,
  name: string,
  actual: number | undefined,
  budget: number | BudgetPair | undefined,
): void {
  if (actual === undefined || budget === undefined) return;
  const currentBudget = typeof budget === "number"
    ? budget
    : budget.currentBudget;
  const targetBudget = typeof budget === "number"
    ? undefined
    : budget.targetBudget;
  checks.push({
    fixture,
    name,
    actual,
    currentBudget,
    targetBudget,
    ok: actual <= currentBudget,
  });
}

function renderTextReport(report: RuntimeBenchReport): string {
  const lines = [
    "Baba runtime benchmark",
    `shared runtime import: ${formatMs(report.engine.sharedRuntimeImportMs)}`,
  ];
  for (const fixture of report.fixtures) {
    lines.push(
      "",
      fixture.name,
      `  generated: ${
        formatBytes(fixture.artifactSizes.totalGeneratedBytes)
      }, largest ${
        formatBytes(fixture.artifactSizes.largestFile.bytes)
      } ${fixture.artifactSizes.largestFile.path}`,
      `  plan: ${fixture.planStats.lexerStateCount} lexer states, ${fixture.planStats.lexerTransitionCount} lexer transitions, ${fixture.planStats.acceptCandidateCount} accept candidates, ${fixture.planStats.lrStateCount} LR states, ${fixture.planStats.actionEntries} actions, ${fixture.planStats.gotoEntries} gotos, ${fixture.planStats.productionCount} productions`,
      `  plan bytes: ${
        formatBytes(fixture.artifactSizes.corePlanBinaryBytes)
      } core, ${
        formatBytes(fixture.artifactSizes.runtimeMetadataBinaryBytes)
      } runtime metadata, ${
        formatBytes(fixture.artifactSizes.parserPlanBinaryBytes)
      } total`,
    );
    const wasm = fixture.targets.wasm;
    if (wasm) {
      lines.push(
        `  compiler: ${formatMs(wasm.compileGrammarMs)}, bundle write ${
          formatMs(wasm.writeBundleMs)
        }`,
        `  wasm: ${formatBytes(wasm.generatedBytes)} generated, ${
          formatBytes(wasm.wasmBytes)
        } wasm, module compile ${
          formatOptionalMs(wasm.compileModuleMs)
        }, import ${formatMs(wasm.importMs)}, parser create ${
          formatMs(wasm.createParserMs)
        }`,
        `    cold: lex ${formatMs(wasm.cold.lexSmallMs)}, validate ${
          formatMs(wasm.cold.validateSmallMs)
        }, parse small ${formatMs(wasm.cold.parseSmallMs)}, medium ${
          formatMs(wasm.cold.parseMediumMs)
        }, large ${formatMs(wasm.cold.parseLargeMs)}`,
        `    hot ${formatBytes(wasm.hot.sourceCodeUnits * 2)}: lex ${
          formatDistribution(wasm.hot.lex)
        }, validate ${formatDistribution(wasm.hot.validate)}, parse ${
          formatDistribution(wasm.hot.parse)
        }`,
        `    validation errors: early ${
          formatDistribution(wasm.hot.validateEarlyError)
        }, late ${formatDistribution(wasm.hot.validateLateError)}`,
        `    incremental same-text validate: ${
          formatDistribution(wasm.hot.incrementalValidate)
        }, scanned ${wasm.hot.incrementalWork.scannedCodeUnits} code units, ${wasm.hot.incrementalWork.parserActions} parser actions, reused ${wasm.hot.incrementalWork.reusedTokens} tokens / ${wasm.hot.incrementalWork.reusedCheckpoints} parser checkpoints`,
        `    memory pages: create ${wasm.memoryPages.afterCreate}, lex ${wasm.memoryPages.afterLex}, validate ${wasm.memoryPages.afterValidate}, parse/high-water ${wasm.memoryPages.highWater}`,
      );
    }
  }
  if (report.budget) {
    lines.push("", `Runtime budgets: ${report.budget.ok ? "ok" : "failed"}`);
    for (const check of report.budget.checks) {
      lines.push(
        `  ${check.ok ? "ok" : "FAIL"} ${check.fixture} ${check.name}: ${
          formatNumber(check.actual)
        } <= ${formatNumber(check.currentBudget)}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderComparison(
  before: RuntimeBenchReport,
  after: RuntimeBenchReport,
): string {
  if (
    before.format !== "baba-runtime-benchmark" ||
    after.format !== "baba-runtime-benchmark" ||
    before.version !== after.version
  ) {
    throw new Error(
      `Runtime benchmark comparison requires matching report versions, received '${
        String(before.format)
      }' v${String(before.version)} and '${String(after.format)}' v${
        String(after.version)
      }.`,
    );
  }
  const lines: string[] = [];
  pushDelta(
    lines,
    "shared runtime",
    "import",
    before.engine.sharedRuntimeImportMs,
    after.engine.sharedRuntimeImportMs,
    formatMs,
  );
  const beforeByName = new Map(before.fixtures.map((fixture) => [
    fixture.name,
    fixture,
  ]));
  for (const current of after.fixtures) {
    const previous = beforeByName.get(current.name);
    if (!previous) continue;
    pushDelta(
      lines,
      current.name,
      "wasm generated bytes",
      previous.targets.wasm?.generatedBytes,
      current.targets.wasm?.generatedBytes,
      formatBytes,
    );
    pushDelta(
      lines,
      current.name,
      "wasm bytes",
      previous.targets.wasm?.wasmBytes,
      current.targets.wasm?.wasmBytes,
      formatBytes,
    );
    pushDelta(
      lines,
      current.name,
      "core plan bytes",
      previous.artifactSizes.corePlanBinaryBytes,
      current.artifactSizes.corePlanBinaryBytes,
      formatBytes,
    );
    pushDelta(
      lines,
      current.name,
      "runtime metadata bytes",
      previous.artifactSizes.runtimeMetadataBinaryBytes,
      current.artifactSizes.runtimeMetadataBinaryBytes,
      formatBytes,
    );
    pushDelta(
      lines,
      current.name,
      "compiler",
      previous.targets.wasm?.compileGrammarMs,
      current.targets.wasm?.compileGrammarMs,
      formatMs,
    );
    pushDelta(
      lines,
      current.name,
      "bundle write",
      previous.targets.wasm?.writeBundleMs,
      current.targets.wasm?.writeBundleMs,
      formatMs,
    );
    pushDelta(
      lines,
      current.name,
      "module compile",
      optionalNumber(previous.targets.wasm?.compileModuleMs),
      optionalNumber(current.targets.wasm?.compileModuleMs),
      formatMs,
    );
    pushDelta(
      lines,
      current.name,
      "module import",
      previous.targets.wasm?.importMs,
      current.targets.wasm?.importMs,
      formatMs,
    );
    pushDelta(
      lines,
      current.name,
      "parser create",
      previous.targets.wasm?.createParserMs,
      current.targets.wasm?.createParserMs,
      formatMs,
    );
    pushDelta(
      lines,
      current.name,
      "hot lex p25",
      previous.targets.wasm?.hot.lex.p25Ms,
      current.targets.wasm?.hot.lex.p25Ms,
      formatMs,
    );
    pushDelta(
      lines,
      current.name,
      "hot validate p25",
      previous.targets.wasm?.hot.validate.p25Ms,
      current.targets.wasm?.hot.validate.p25Ms,
      formatMs,
    );
    pushDelta(
      lines,
      current.name,
      "hot parse p25",
      previous.targets.wasm?.hot.parse.p25Ms,
      current.targets.wasm?.hot.parse.p25Ms,
      formatMs,
    );
    pushDelta(
      lines,
      current.name,
      "incremental validate p25",
      previous.targets.wasm?.hot.incrementalValidate.p25Ms,
      current.targets.wasm?.hot.incrementalValidate.p25Ms,
      formatMs,
    );
    pushDelta(
      lines,
      current.name,
      "memory high-water pages",
      previous.targets.wasm?.memoryPages.highWater,
      current.targets.wasm?.memoryPages.highWater,
      formatNumber,
    );
  }
  return lines.length ? lines.join("\n") : "No comparable fixtures found.";
}

function pushDelta(
  lines: string[],
  fixture: string,
  label: string,
  before: number | undefined,
  after: number | undefined,
  format: (value: number) => string,
): void {
  if (before === undefined || after === undefined) return;
  const percent = before === 0 ? 0 : (after - before) * 100 / before;
  lines.push(
    `${fixture} ${label}: ${format(before)} -> ${format(after)} (${
      percent >= 0 ? "+" : ""
    }${percent.toFixed(1)}%)`,
  );
}

async function discoverFixtures(fixturesRoot: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(fixturesRoot)) {
    if (!entry.isDirectory) {
      continue;
    }
    const grammarPath = `${fixturesRoot}/${entry.name}/grammar.baba`;
    try {
      const info = await Deno.stat(grammarPath);
      if (info.isFile) {
        names.push(entry.name);
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        continue;
      }
      throw error;
    }
  }
  return names.sort();
}

async function readOptionalMetadata(
  path: string,
): Promise<BabaMetadata | undefined> {
  try {
    return parseMetadata(await Deno.readTextFile(path));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

function throwOnDiagnostics(
  fixture: string,
  diagnostics: readonly { severity?: string; message: string; code: string }[],
): void {
  const errors = diagnostics.filter((diagnostic) =>
    (diagnostic.severity ?? "error") === "error"
  );
  if (errors.length === 0) return;
  throw new Error(
    `Fixture ${fixture} failed:\n${
      errors.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        .join("\n")
    }`,
  );
}

function requireBundle(
  fixture: string,
  bundle: GeneratedBundle | undefined,
): GeneratedBundle {
  if (!bundle) throw new Error(`Fixture ${fixture} did not produce a bundle.`);
  return bundle;
}

function binaryBytes(files: readonly GeneratedFile[], suffix: string): number {
  return files.filter((file) => file.path.endsWith(suffix)).reduce(
    (sum, file) => sum + fileBytes(file),
    0,
  );
}

function generatedBytes(files: readonly GeneratedFile[]): number {
  return files.reduce((sum, file) => sum + fileBytes(file), 0);
}

function fileBytes(file: GeneratedFile): number {
  return file.encoding === "binary"
    ? file.content.byteLength
    : byteLength(file.content);
}

function byteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function arrayBufferFor(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function time<T>(fn: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}

async function timeAsync<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; ms: number }> {
  const start = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - start };
}

function pathToFileUrl(path: string): URL {
  const absolute = path.startsWith("/") ? path : `${Deno.cwd()}/${path}`;
  return new URL(`file://${absolute}?bench=${Date.now()}-${Math.random()}`);
}

function parseArgs(args: readonly string[]): CliOptions {
  let fixturesRoot = "fixtures/perf";
  const fixtureNames: string[] = [];
  let jsonPath: string | undefined;
  let jsonStdout = false;
  let budgetPath: string | undefined;
  let compare: readonly [string, string] | undefined;
  let wasmCorePath: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--fixtures-root") {
      fixturesRoot = args[++index] ?? fixturesRoot;
    } else if (arg === "--fixture") {
      const name = args[++index];
      if (!name) throw new Error("Expected fixture name after --fixture");
      fixtureNames.push(name);
    } else if (arg === "--json") {
      const next = args[index + 1];
      if (next && !next.startsWith("--")) {
        jsonPath = next;
        index++;
      } else {
        jsonStdout = true;
      }
    } else if (arg === "--budget") {
      budgetPath = args[++index] ?? budgetPath;
    } else if (arg === "--wasm-core") {
      wasmCorePath = args[++index];
      if (wasmCorePath === undefined) {
        throw new Error("Expected a path after --wasm-core.");
      }
    } else if (arg === "--compare") {
      const before = args[++index];
      const after = args[++index];
      if (!before || !after) {
        throw new Error("Expected before and after JSON paths after --compare");
      }
      compare = [before, after];
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: deno run --allow-read --allow-write scripts/runtime_bench.ts [--fixture NAME] [--json [PATH]] [--budget PATH] [--wasm-core PATH]\n" +
          "       deno run --allow-read scripts/runtime_bench.ts --compare before.json after.json",
      );
      Deno.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return {
    fixturesRoot,
    fixtureNames,
    jsonPath,
    jsonStdout,
    budgetPath,
    compare,
    wasmCorePath,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  for (const unit of units) {
    if (value < 1024 || unit === units[units.length - 1]) {
      return `${value.toFixed(1)} ${unit}`;
    }
    value /= 1024;
  }
  return `${bytes} B`;
}

function formatMs(ms: number): string {
  return `${ms.toFixed(2)} ms`;
}

function formatOptionalMs(ms: number | null): string {
  if (ms === null) {
    return "unavailable";
  }
  return formatMs(ms);
}

function optionalNumber(value: number | null | undefined): number | undefined {
  if (value === null) {
    return undefined;
  }
  return value;
}

function formatDistribution(distribution: SampleDistribution): string {
  return `${formatMs(distribution.p25Ms)} p25 / ${
    formatMs(distribution.medianMs)
  } median`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
