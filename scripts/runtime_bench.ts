import {
  applyBundle,
  type BabaMetadata,
  compile,
  type GeneratedBundle,
  type GeneratedFile,
  parseMetadata,
} from "../src/mod.ts";
import { inflateCompactRuntimePlan } from "../src/runtime/mod.ts";
import { decodeCombinedWasmParserPlan } from "../src/runtime/wasm_plan.ts";

export interface RuntimeBenchReport {
  readonly generatedAt: string;
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
  readonly lexTapeSmallMs: number;
  readonly lexTapeMediumMs: number;
  readonly lexTapeSmallCount: number;
  readonly lexTapeSmallNsPerToken: number;
  readonly lexTapeSmallNsPerCodeUnit: number;
  readonly validateTraceSmallMs: number;
  readonly validateTraceMediumMs: number;
  readonly cursorParseFirstMs: number;
  readonly cursorParseSecondMs: number;
  readonly cursorParseMediumMs: number;
  readonly cursorParseLargeMs: number;
}

export interface WasmTargetTiming extends TargetTiming {
  readonly wasmBytes: number;
  readonly compileModuleMs: number | null;
  readonly instantiateMs: number;
}

export interface ArtifactSizes {
  readonly wasmAdapterSourceBytes: number;
  readonly externalWasmBytes: number;
  readonly abiJsonBytes: number;
  readonly parserPlanBinaryBytes: number;
  readonly totalGeneratedBytes: number;
  readonly largestFile: { readonly path: string; readonly bytes: number };
}

export interface PlanStats {
  readonly tokenCount: number;
  readonly literalCount: number;
  readonly lexerStateCount: number;
  readonly lexerTransitionCount: number;
  readonly lexerRowKinds: LexerRowKindStats;
  readonly acceptCandidateCount: number;
  readonly lrStateCount: number;
  readonly actionEntries: number;
  readonly gotoEntries: number;
  readonly productionCount: number;
  readonly reducerCount: number;
  readonly fieldCount: number;
  readonly branchConflictCount: number;
  readonly portablePlanJsonBytes: number;
}

export interface LexerRowKindStats {
  empty: number;
  single: number;
  small: number;
  binary: number;
  ascii: number;
}

interface RuntimeBudgetConfig {
  readonly runtimeBudgets?: Record<string, RuntimeFixtureBudget>;
}

interface RuntimeFixtureBudget {
  readonly wasmBytesMax?: number | BudgetPair;
  readonly wasmColdInstantiateMsMax?: number | BudgetPair;
  readonly smallParseMsMax?: number | BudgetPair;
  readonly portablePlanJsonBytesMax?: number | BudgetPair;
  readonly parserPlanBinaryBytesMax?: number | BudgetPair;
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
}

const textEncoder = new TextEncoder();

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
  const fixturesRoot = options.fixturesRoot ?? "fixtures/perf";
  const fixtureNames = options.fixtureNames?.length
    ? options.fixtureNames
    : await discoverFixtures(fixturesRoot);
  const fixtures: FixtureReport[] = [];
  for (const name of fixtureNames) {
    fixtures.push(await benchFixture(fixturesRoot, name));
  }
  return {
    generatedAt: new Date().toISOString(),
    fixtures,
  };
}

async function benchFixture(
  fixturesRoot: string,
  name: string,
): Promise<FixtureReport> {
  const fixturePath = `${fixturesRoot}/${name}`;
  const grammarSource = await Deno.readTextFile(`${fixturePath}/grammar.baba`);
  const metadata = await readOptionalMetadata(`${fixturePath}/baba.json`);
  const smallInput = await Deno.readTextFile(`${fixturePath}/small.input`);
  const mediumInput = await Deno.readTextFile(`${fixturePath}/medium.input`);
  const largeInput = await Deno.readTextFile(`${fixturePath}/large.input`);

  const allCompile = time(() =>
    compile(grammarSource, {
      name,
      metadata,
      targets: ["wasm"],
    })
  );
  throwOnDiagnostics(name, allCompile.value.diagnostics);
  const bundle = allCompile.value.bundle;
  if (!bundle) throw new Error(`Fixture ${name} did not produce a bundle.`);

  const planStats = planStatsFromRuntimePlan(runtimePlanFromBundle(bundle));
  const artifactSizes = artifactSizesFromBundle(bundle);
  const wasm = await benchWasmTarget(
    name,
    grammarSource,
    metadata,
    smallInput,
    mediumInput,
    largeInput,
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
  grammarSource: string,
  metadata: BabaMetadata | undefined,
  smallInput: string,
  mediumInput: string,
  largeInput: string,
): Promise<WasmTargetTiming> {
  const compileResult = time(() =>
    compile(grammarSource, {
      name,
      metadata,
      targets: ["wasm"],
    })
  );
  throwOnDiagnostics(name, compileResult.value.diagnostics);
  const bundle = requireBundle(name, compileResult.value.bundle);
  const tempDir = await Deno.makeTempDir({
    prefix: "baba-runtime-bench-wasm-",
  });
  const write = await timeAsync(() => applyBundle(bundle, { root: tempDir }));
  const imported = await timeAsync(() =>
    import(pathToFileUrl(`${tempDir}/wasm/mod.ts`).href)
  );
  const wasmBytes = await Deno.readFile(`${tempDir}/wasm/parser.wasm`);
  const planBytes = await Deno.readFile(`${tempDir}/wasm/parser.plan`);
  const compileModule = time(() =>
    new WebAssembly.Module(
      arrayBufferFor(wasmBytes),
    )
  ).ms;
  const create = time(() =>
    imported.value.createParser({ bytes: wasmBytes, plan: planBytes })
  );
  const parser = create.value as {
    lex(source: string): RuntimeLexTapeLike;
    parse(
      source: string,
    ): RuntimeCursorParseLike;
    validate(source: string): RuntimeParseLike;
  };
  const lexTapeSmall = time(() => parser.lex(smallInput));
  const lexTapeMedium = time(() => parser.lex(mediumInput));
  const lexTapeSmallCount = lexTapeSmall.value.tokenTape.length;
  const validateTraceSmall = time(() => parser.validate(smallInput));
  const validateTraceMedium = time(() => parser.validate(mediumInput));
  const cursorFirst = time(() => parser.parse(smallInput));
  const cursorSecond = time(() => parser.parse(smallInput));
  const cursorMedium = time(() => parser.parse(mediumInput));
  const cursorLarge = time(() => parser.parse(largeInput));
  return {
    generatedBytes: generatedBytes(bundle.files),
    wasmBytes: wasmBytes.byteLength,
    compileGrammarMs: compileResult.ms,
    writeBundleMs: write.ms,
    importMs: imported.ms,
    createParserMs: create.ms,
    compileModuleMs: compileModule,
    instantiateMs: create.ms,
    lexTapeSmallMs: lexTapeSmall.ms,
    lexTapeMediumMs: lexTapeMedium.ms,
    lexTapeSmallCount,
    lexTapeSmallNsPerToken: nsPerUnit(lexTapeSmall.ms, lexTapeSmallCount),
    lexTapeSmallNsPerCodeUnit: nsPerUnit(
      lexTapeSmall.ms,
      smallInput.length,
    ),
    validateTraceSmallMs: validateTraceSmall.ms,
    validateTraceMediumMs: validateTraceMedium.ms,
    cursorParseFirstMs: cursorFirst.ms,
    cursorParseSecondMs: cursorSecond.ms,
    cursorParseMediumMs: cursorMedium.ms,
    cursorParseLargeMs: cursorLarge.ms,
  };
}

interface RuntimeLexTapeLike {
  readonly tokenTape: { readonly length: number };
}

interface RuntimeCursorParseLike {
  readonly ok?: boolean;
  readonly cursor?: unknown;
  readonly diagnostics?: readonly unknown[];
}

interface RuntimeParseLike {
  readonly ok?: boolean;
}

function planStatsFromRuntimePlan(kit: {
  tokens: { named: readonly unknown[]; literals: readonly unknown[] };
  lexer: {
    dfa: {
      transitions: readonly (readonly unknown[])[];
      accepts: readonly number[];
    };
  };
  lr: {
    states: readonly unknown[];
    actions: readonly { actions: readonly unknown[] }[];
    gotos: readonly unknown[];
  };
  bnf: { productions: readonly { reducer: unknown }[] };
  fields: { rules: readonly { fields: readonly unknown[] }[] };
}): PlanStats {
  const portableJsonBytes = byteLength(JSON.stringify(kit));
  return {
    tokenCount: kit.tokens.named.length,
    literalCount: kit.tokens.literals.length,
    lexerStateCount: kit.lexer.dfa.transitions.length,
    lexerTransitionCount: kit.lexer.dfa.transitions.reduce(
      (sum, row) => sum + row.length,
      0,
    ),
    lexerRowKinds: lexerRowKindStats(kit.lexer.dfa.transitions),
    acceptCandidateCount: kit.lexer.dfa.accepts.length,
    lrStateCount: kit.lr.states.length,
    actionEntries: kit.lr.actions.length,
    gotoEntries: kit.lr.gotos.length,
    productionCount: kit.bnf.productions.length,
    reducerCount:
      kit.bnf.productions.filter((production) => production.reducer).length,
    fieldCount: kit.fields.rules.reduce(
      (sum, rule) => sum + rule.fields.length,
      0,
    ),
    branchConflictCount:
      kit.lr.actions.filter((entry) => entry.actions.length > 1).length,
    portablePlanJsonBytes: portableJsonBytes,
  };
}

function runtimePlanFromBundle(bundle: GeneratedBundle) {
  const file = bundle.files.find((entry) => entry.path === "wasm/parser.plan");
  if (file === undefined) {
    throw new Error("Wasm bundle did not include wasm/parser.plan.");
  }
  if (file.encoding !== "binary") {
    throw new Error("wasm/parser.plan must be binary.");
  }
  const decoded = decodeCombinedWasmParserPlan(file.content);
  return inflateCompactRuntimePlan(decoded.compactRuntimePlan);
}

function lexerRowKindStats(
  rows: readonly (readonly unknown[])[],
): LexerRowKindStats {
  const stats: LexerRowKindStats = {
    empty: 0,
    single: 0,
    small: 0,
    binary: 0,
    ascii: 0,
  };
  for (const row of rows) {
    const transitions = row as readonly {
      readonly start: number;
      readonly end: number;
    }[];
    if (transitions.length === 0) {
      stats.empty++;
    } else if (transitions.length === 1) {
      stats.single++;
    } else {
      const asciiCoverage = transitions.reduce((count, transition) => {
        const start = Math.max(0, transition.start);
        const end = Math.min(127, transition.end);
        return end >= start ? count + end - start + 1 : count;
      }, 0);
      if (
        asciiCoverage >= 8 || (asciiCoverage > 0 && transitions.length >= 4)
      ) {
        stats.ascii++;
      } else if (transitions.length <= 4) {
        stats.small++;
      } else {
        stats.binary++;
      }
    }
  }
  return stats;
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
  return {
    wasmAdapterSourceBytes: files.filter((file) =>
      file.path.startsWith("wasm/") && file.path.endsWith(".ts")
    ).reduce((sum, file) => sum + file.bytes, 0),
    externalWasmBytes: binaryBytes(bundle.files, ".wasm"),
    abiJsonBytes: byPath.get("wasm/abi.json") ?? 0,
    parserPlanBinaryBytes: files
      .filter((file) => file.path.endsWith("/parser.plan"))
      .reduce((sum, file) => sum + file.bytes, 0),
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
      wasm?.cursorParseFirstMs,
      budget.smallParseMsMax,
    );
    addRuntimeBudgetCheck(
      checks,
      fixture.name,
      "portablePlanJsonBytesMax",
      fixture.planStats.portablePlanJsonBytes,
      budget.portablePlanJsonBytesMax,
    );
    addRuntimeBudgetCheck(
      checks,
      fixture.name,
      "parserPlanBinaryBytesMax",
      fixture.artifactSizes.parserPlanBinaryBytes,
      budget.parserPlanBinaryBytesMax,
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
  const lines = ["Baba runtime benchmark"];
  for (const fixture of report.fixtures) {
    lines.push(
      "",
      fixture.name,
      `  generated: ${
        formatBytes(fixture.artifactSizes.totalGeneratedBytes)
      }, largest ${
        formatBytes(fixture.artifactSizes.largestFile.bytes)
      } ${fixture.artifactSizes.largestFile.path}`,
      `  plan: ${fixture.planStats.tokenCount} tokens, ${fixture.planStats.literalCount} literals, ${fixture.planStats.lexerStateCount} lexer states, ${fixture.planStats.lrStateCount} LR states, ${
        formatBytes(fixture.planStats.portablePlanJsonBytes)
      } runtime plan JSON`,
      `  lexer rows: ${fixture.planStats.lexerRowKinds.ascii} ascii, ${fixture.planStats.lexerRowKinds.single} single, ${fixture.planStats.lexerRowKinds.small} small, ${fixture.planStats.lexerRowKinds.binary} binary, ${fixture.planStats.lexerRowKinds.empty} empty`,
    );
    const wasm = fixture.targets.wasm;
    if (wasm) {
      lines.push(
        `  wasm: ${formatBytes(wasm.generatedBytes)} generated, ${
          formatBytes(wasm.wasmBytes)
        } wasm, import ${formatMs(wasm.importMs)}, instantiate ${
          formatMs(wasm.instantiateMs)
        }, cursorParse ${formatMs(wasm.cursorParseFirstMs)}, validateTrace ${
          formatMs(wasm.validateTraceSmallMs)
        }, lexTape ${formatMs(wasm.lexTapeSmallMs)}`,
        `    lexer: ${formatNumber(wasm.lexTapeSmallCount)} small tokens, ${
          formatNumber(wasm.lexTapeSmallNsPerToken)
        } ns/token, ${
          formatNumber(wasm.lexTapeSmallNsPerCodeUnit)
        } ns/code unit`,
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
  const lines: string[] = [];
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
      "instantiate",
      previous.targets.wasm?.instantiateMs,
      current.targets.wasm?.instantiateMs,
      formatMs,
    );
    pushDelta(
      lines,
      current.name,
      "cursor parse",
      previous.targets.wasm?.cursorParseFirstMs,
      current.targets.wasm?.cursorParseFirstMs,
      formatMs,
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
    } else if (arg === "--compare") {
      const before = args[++index];
      const after = args[++index];
      if (!before || !after) {
        throw new Error("Expected before and after JSON paths after --compare");
      }
      compare = [before, after];
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: deno run --allow-read --allow-write scripts/runtime_bench.ts [--fixture NAME] [--json [PATH]] [--budget PATH]\n" +
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

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function nsPerUnit(ms: number, count: number): number {
  return count > 0 ? (ms * 1_000_000) / count : 0;
}
