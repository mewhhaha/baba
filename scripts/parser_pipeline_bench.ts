import {
  applyRuntimeBudgets,
  buildRuntimeBenchReport,
  type FixtureReport as RuntimeFixtureReport,
  type RuntimeBenchReport,
} from "./runtime_bench.ts";

interface CliOptions {
  fixturesRoot: string;
  fixtureNames: string[];
  jsonPath?: string;
  jsonStdout: boolean;
  budgetPath?: string;
  profile: PipelineProfile;
  compare?: readonly [string, string];
}

type PipelineProfile = "full" | "lexer-only" | "cst" | "ast";

interface ParserPipelineReport {
  readonly format: "baba-parser-pipeline-benchmark";
  readonly version: 1;
  readonly generatedAt: string;
  readonly profile: PipelineProfile;
  readonly fixtures: readonly PipelineFixtureReport[];
  readonly budget?: ParserPipelineBudgetResult;
}

interface PipelineFixtureReport {
  readonly fixture: string;
  readonly path: string;
  readonly grammar: string;
  readonly metrics: PipelineMetrics;
  readonly plan: PipelinePlanMetrics;
}

interface PipelineMetrics {
  readonly lexerMs: number;
  readonly parserConstructMs: number;
  readonly validationParseMs: number;
  readonly cstParseMs: number;
  readonly astMaterializeMs: number;
  readonly astMaterializeStatus: "measured-public-tree-delta";
  readonly generatedBytes: number;
  readonly tokens: number;
  readonly cstNodes: number;
}

interface PipelinePlanMetrics {
  readonly tokenCount: number;
  readonly literalCount: number;
  readonly lexerStateCount: number;
  readonly lexerTransitionCount: number;
  readonly lrStateCount: number;
  readonly actionEntries: number;
  readonly gotoEntries: number;
  readonly productionCount: number;
  readonly reducerCount: number;
  readonly fieldCount: number;
  readonly branchConflictCount: number;
  readonly portablePlanJsonBytes: number;
  readonly parserPlanBinaryBytes: number;
}

interface ParserPipelineBudgetConfig {
  readonly parserPipelineBudgets?: Record<string, ParserPipelineFixtureBudget>;
}

interface ParserPipelineFixtureBudget {
  readonly lexerMsMax?: number | BudgetPair;
  readonly parserConstructMsMax?: number | BudgetPair;
  readonly validationParseMsMax?: number | BudgetPair;
  readonly cstParseMsMax?: number | BudgetPair;
  readonly astMaterializeMsMax?: number | BudgetPair;
  readonly generatedBytesMax?: number | BudgetPair;
  readonly tokensMax?: number | BudgetPair;
  readonly cstNodesMax?: number | BudgetPair;
}

interface BudgetPair {
  readonly currentBudget: number;
  readonly targetBudget?: number;
}

interface ParserPipelineBudgetResult {
  readonly path: string;
  readonly ok: boolean;
  readonly checks: readonly ParserPipelineBudgetCheck[];
}

interface ParserPipelineBudgetCheck {
  readonly fixture: string;
  readonly name: string;
  readonly actual: number;
  readonly currentBudget: number;
  readonly targetBudget?: number;
  readonly ok: boolean;
}

if (import.meta.main) {
  const options = parseArgs(Deno.args);
  if (options.compare) {
    const before = JSON.parse(
      await Deno.readTextFile(options.compare[0]),
    ) as ParserPipelineReport;
    const after = JSON.parse(
      await Deno.readTextFile(options.compare[1]),
    ) as ParserPipelineReport;
    console.log(renderComparison(before, after));
    Deno.exit(0);
  }
  const runtimeReport = await buildRuntimeBenchReport({
    fixturesRoot: options.fixturesRoot,
    fixtureNames: options.fixtureNames,
  });
  let budgetedReport = runtimeReport;
  if (options.budgetPath) {
    budgetedReport = await applyRuntimeBudgets(
      runtimeReport,
      options.budgetPath,
    );
  }
  const report = pipelineReport(budgetedReport, options.profile);
  let finalReport = report;
  if (options.budgetPath) {
    finalReport = await applyParserPipelineBudgets(
      report,
      options.budgetPath,
    );
  }
  const json = `${JSON.stringify(finalReport, null, 2)}\n`;
  if (options.jsonPath) {
    await Deno.writeTextFile(options.jsonPath, json);
  }
  if (options.jsonStdout) {
    console.log(json.trimEnd());
  } else {
    console.log(renderTextReport(finalReport));
  }
  if (finalReport.budget && !finalReport.budget.ok) {
    Deno.exit(1);
  }
}

function pipelineReport(
  runtimeReport: RuntimeBenchReport,
  profile: PipelineProfile,
): ParserPipelineReport {
  const fixtures: PipelineFixtureReport[] = [];
  for (const fixture of runtimeReport.fixtures) {
    fixtures.push(pipelineFixtureReport(fixture));
  }
  const report: ParserPipelineReport = {
    format: "baba-parser-pipeline-benchmark",
    version: 1,
    generatedAt: runtimeReport.generatedAt,
    profile,
    fixtures,
  };
  if (runtimeReport.budget) {
    return {
      ...report,
      budget: runtimeReport.budget,
    };
  }
  return report;
}

async function applyParserPipelineBudgets(
  report: ParserPipelineReport,
  budgetPath: string,
): Promise<ParserPipelineReport> {
  const config = JSON.parse(
    await Deno.readTextFile(budgetPath),
  ) as ParserPipelineBudgetConfig;
  const checks: ParserPipelineBudgetCheck[] = [];
  if (report.budget) {
    for (const check of report.budget.checks) {
      checks.push(check);
    }
  }
  for (const fixture of report.fixtures) {
    const budget = config.parserPipelineBudgets?.[fixture.fixture];
    if (!budget) {
      continue;
    }
    addBudgetCheck(
      checks,
      fixture.fixture,
      "lexerMsMax",
      fixture.metrics.lexerMs,
      budget.lexerMsMax,
    );
    addBudgetCheck(
      checks,
      fixture.fixture,
      "parserConstructMsMax",
      fixture.metrics.parserConstructMs,
      budget.parserConstructMsMax,
    );
    addBudgetCheck(
      checks,
      fixture.fixture,
      "validationParseMsMax",
      fixture.metrics.validationParseMs,
      budget.validationParseMsMax,
    );
    addBudgetCheck(
      checks,
      fixture.fixture,
      "cstParseMsMax",
      fixture.metrics.cstParseMs,
      budget.cstParseMsMax,
    );
    addBudgetCheck(
      checks,
      fixture.fixture,
      "astMaterializeMsMax",
      fixture.metrics.astMaterializeMs,
      budget.astMaterializeMsMax,
    );
    addBudgetCheck(
      checks,
      fixture.fixture,
      "generatedBytesMax",
      fixture.metrics.generatedBytes,
      budget.generatedBytesMax,
    );
    addBudgetCheck(
      checks,
      fixture.fixture,
      "tokensMax",
      fixture.metrics.tokens,
      budget.tokensMax,
    );
    addBudgetCheck(
      checks,
      fixture.fixture,
      "cstNodesMax",
      fixture.metrics.cstNodes,
      budget.cstNodesMax,
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

function addBudgetCheck(
  checks: ParserPipelineBudgetCheck[],
  fixture: string,
  name: string,
  actual: number,
  budget: number | BudgetPair | undefined,
): void {
  if (budget === undefined) {
    return;
  }
  let currentBudget: number;
  let targetBudget: number | undefined;
  if (typeof budget === "number") {
    currentBudget = budget;
  } else {
    currentBudget = budget.currentBudget;
    targetBudget = budget.targetBudget;
  }
  checks.push({
    fixture,
    name,
    actual,
    currentBudget,
    targetBudget,
    ok: actual <= currentBudget,
  });
}

function pipelineFixtureReport(
  fixture: RuntimeFixtureReport,
): PipelineFixtureReport {
  const target = fixture.targets.typescript;
  if (!target) {
    throw new Error(
      `Fixture ${fixture.name} is missing TypeScript benchmark metrics.`,
    );
  }
  const astMaterializeMs = nonNegativeDelta(
    target.cstFullSmallMs,
    target.eventsSmallMs,
  );
  return {
    fixture: fixture.name,
    path: fixture.path,
    grammar: fixture.name,
    metrics: {
      lexerMs: target.tokensSmallMs,
      parserConstructMs: target.importMs + target.createParserMs,
      validationParseMs: target.validateSmallMs,
      cstParseMs: target.cstFullSmallMs,
      astMaterializeMs,
      astMaterializeStatus: "measured-public-tree-delta",
      generatedBytes: target.generatedBytes,
      tokens: target.tokensSmallCount,
      cstNodes: target.cstFullSmallNodeCount,
    },
    plan: {
      tokenCount: fixture.planStats.tokenCount,
      literalCount: fixture.planStats.literalCount,
      lexerStateCount: fixture.planStats.lexerStateCount,
      lexerTransitionCount: fixture.planStats.lexerTransitionCount,
      lrStateCount: fixture.planStats.lrStateCount,
      actionEntries: fixture.planStats.actionEntries,
      gotoEntries: fixture.planStats.gotoEntries,
      productionCount: fixture.planStats.productionCount,
      reducerCount: fixture.planStats.reducerCount,
      fieldCount: fixture.planStats.fieldCount,
      branchConflictCount: fixture.planStats.branchConflictCount,
      portablePlanJsonBytes: fixture.planStats.portablePlanJsonBytes,
      parserPlanBinaryBytes: fixture.artifactSizes.parserPlanBinaryBytes,
    },
  };
}

function nonNegativeDelta(after: number, before: number): number {
  const delta = after - before;
  if (delta < 0) {
    return 0;
  }
  return delta;
}

function parseArgs(args: readonly string[]): CliOptions {
  let fixturesRoot = "fixtures/perf";
  const fixtureNames: string[] = [];
  let jsonPath: string | undefined;
  let jsonStdout = false;
  let budgetPath: string | undefined;
  let profile: PipelineProfile = "full";
  let compare: readonly [string, string] | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--fixtures-root") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Expected path after --fixtures-root");
      }
      fixturesRoot = value;
      index++;
    } else if (arg === "--fixture") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Expected fixture name after --fixture");
      }
      fixtureNames.push(value);
      index++;
    } else if (arg === "--json") {
      const next = args[index + 1];
      if (next && !next.startsWith("--")) {
        jsonPath = next;
        index++;
      } else {
        jsonStdout = true;
      }
    } else if (arg === "--budget") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Expected path after --budget");
      }
      budgetPath = value;
      index++;
    } else if (arg === "--lexer-only") {
      profile = "lexer-only";
    } else if (arg === "--cst") {
      profile = "cst";
    } else if (arg === "--ast") {
      profile = "ast";
    } else if (arg === "--compare") {
      const before = args[index + 1];
      const after = args[index + 2];
      if (!before || !after) {
        throw new Error("Expected before and after JSON paths after --compare");
      }
      compare = [before, after];
      index += 2;
    } else if (arg === "--help" || arg === "-h") {
      console.log(helpText());
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
    profile,
    compare,
  };
}

function renderTextReport(report: ParserPipelineReport): string {
  const lines = [
    "Baba parser pipeline benchmark",
    `profile: ${report.profile}`,
  ];
  for (const fixture of report.fixtures) {
    lines.push(
      "",
      fixture.fixture,
      `  lexer ${formatMs(fixture.metrics.lexerMs)}, parser construct ${
        formatMs(fixture.metrics.parserConstructMs)
      }, validate ${formatMs(fixture.metrics.validationParseMs)}, cst ${
        formatMs(fixture.metrics.cstParseMs)
      }, public tree delta ${formatMs(fixture.metrics.astMaterializeMs)}`,
      `  generated ${
        formatNumber(fixture.metrics.generatedBytes)
      } bytes, tokens ${formatNumber(fixture.metrics.tokens)}, cst nodes ${
        formatNumber(fixture.metrics.cstNodes)
      }`,
    );
  }
  if (report.budget) {
    let budgetStatus = "failed";
    if (report.budget.ok) {
      budgetStatus = "ok";
    }
    lines.push("", `budgets: ${budgetStatus}`);
    for (const check of report.budget.checks) {
      let checkStatus = "FAIL";
      if (check.ok) {
        checkStatus = "ok";
      }
      lines.push(
        `  ${checkStatus} ${check.fixture} ${check.name}: ${
          formatNumber(check.actual)
        } <= ${formatNumber(check.currentBudget)}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderComparison(
  before: ParserPipelineReport,
  after: ParserPipelineReport,
): string {
  const lines: string[] = [];
  const previousByFixture = new Map(
    before.fixtures.map((fixture) => [fixture.fixture, fixture]),
  );
  for (const current of after.fixtures) {
    const previous = previousByFixture.get(current.fixture);
    if (!previous) {
      continue;
    }
    pushMetricDelta(
      lines,
      current.fixture,
      "lexerMs",
      previous.metrics.lexerMs,
      current.metrics.lexerMs,
      formatMs,
    );
    pushMetricDelta(
      lines,
      current.fixture,
      "parserConstructMs",
      previous.metrics.parserConstructMs,
      current.metrics.parserConstructMs,
      formatMs,
    );
    pushMetricDelta(
      lines,
      current.fixture,
      "validationParseMs",
      previous.metrics.validationParseMs,
      current.metrics.validationParseMs,
      formatMs,
    );
    pushMetricDelta(
      lines,
      current.fixture,
      "cstParseMs",
      previous.metrics.cstParseMs,
      current.metrics.cstParseMs,
      formatMs,
    );
    pushMetricDelta(
      lines,
      current.fixture,
      "generatedBytes",
      previous.metrics.generatedBytes,
      current.metrics.generatedBytes,
      formatNumber,
    );
    pushMetricDelta(
      lines,
      current.fixture,
      "tokens",
      previous.metrics.tokens,
      current.metrics.tokens,
      formatNumber,
    );
    pushMetricDelta(
      lines,
      current.fixture,
      "cstNodes",
      previous.metrics.cstNodes,
      current.metrics.cstNodes,
      formatNumber,
    );
  }
  if (lines.length === 0) {
    return "No comparable parser pipeline fixtures found.";
  }
  return lines.join("\n");
}

function pushMetricDelta(
  lines: string[],
  fixture: string,
  name: string,
  before: number,
  after: number,
  format: (value: number) => string,
): void {
  let percent = 0;
  if (before !== 0) {
    percent = (after - before) * 100 / before;
  }
  let sign = "";
  if (percent >= 0) {
    sign = "+";
  }
  lines.push(
    `${fixture} ${name}: ${format(before)} -> ${format(after)} (${sign}${
      percent.toFixed(1)
    }%)`,
  );
}

function formatMs(value: number): string {
  return `${value.toFixed(2)} ms`;
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function helpText(): string {
  return [
    "Usage: deno run --allow-read --allow-write --allow-run scripts/parser_pipeline_bench.ts [--fixture NAME] [--json [PATH]] [--budget PATH]",
    "       deno run --allow-read scripts/parser_pipeline_bench.ts --compare before.json after.json",
    "",
    "Options:",
    "  --lexer-only       Tag the report as the lexer-focused task profile.",
    "  --cst              Tag the report as the CST/materialization task profile.",
    "  --ast              Tag the report as the AST/materialization task profile.",
    "  --fixtures-root    Read performance fixtures from a custom directory.",
    "  --compare          Compare two parser pipeline JSON reports.",
  ].join("\n");
}
