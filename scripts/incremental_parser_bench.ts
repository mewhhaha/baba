import { parseGrammarSource } from "../src/grammar.ts";
import { analyzeGrammar } from "../src/compiler/grammar_analysis.ts";
import { buildGrammarCstSchema } from "../src/compiler/grammar_cst.ts";
import { buildGrammarLexerPlan } from "../src/compiler/grammar_lexer.ts";
import {
  createGrammarIncrementalParser,
  type GrammarTextEdit,
} from "../src/compiler/grammar_incremental.ts";

interface IncrementalBenchReport {
  readonly format: "baba-incremental-parser-benchmark";
  readonly version: 1;
  readonly generatedAt: string;
  readonly cases: readonly IncrementalBenchCase[];
}

interface IncrementalBenchCase {
  readonly name: string;
  readonly elapsedMs: number;
  readonly changedRanges: readonly {
    readonly start: number;
    readonly end: number;
  }[];
  readonly relexedRange: { readonly start: number; readonly end: number };
  readonly reparsedRange: { readonly start: number; readonly end: number };
  readonly reusedNodeCount: number;
  readonly diagnostics: number;
  readonly cancelled: boolean;
}

const options = parseArgs(Deno.args);
const report = runBench();
const json = `${JSON.stringify(report, null, 2)}\n`;
if (options.jsonPath !== undefined) {
  await Deno.writeTextFile(options.jsonPath, json);
}
if (options.jsonStdout) {
  console.log(json.trimEnd());
} else {
  console.log(renderReport(report));
}

function runBench(): IncrementalBenchReport {
  const parsed = parseGrammarSource(`
    grammar IncrementalBench

    token Let = "let" ;
    token Ident = /[a-z]+/ ;
    token Int = /[0-9]+/ ;
    token Eq = "=" ;
    token Plus = "+" ;
    token Star = "*" ;
    token Semi = ";" ;
    skip Space channel trivia = /[ \\n]+/ ;

    module = stmt+ ;
    stmt = Let Ident Eq expr Semi ;
    expr = atom (op atom)* ;
    op = Plus | Star ;
    atom = Ident | Int ;
  `);
  if (parsed.grammar === undefined) {
    throw new Error("Incremental benchmark grammar did not parse.");
  }
  const analyzed = analyzeGrammar(parsed.grammar);
  const schema = buildGrammarCstSchema(analyzed);
  const lexer = buildGrammarLexerPlan(analyzed);
  const parser = createGrammarIncrementalParser(schema, lexer);
  const source = [
    "let alpha = 1 + 2;",
    "let beta = alpha + 3;",
    "let gamma = beta + alpha;",
  ].join("\n");
  const initial = parser.parseInitial(source);
  const cases: IncrementalBenchCase[] = [];
  cases.push(runCase(parser, initial, "single-character", [{
    start: source.indexOf("+"),
    oldEnd: source.indexOf("+") + 1,
    newText: "*",
  }]));
  const secondLine = source.indexOf("let beta");
  cases.push(runCase(parser, initial, "line-edit", [{
    start: secondLine,
    oldEnd: secondLine + "let beta = alpha + 3;".length,
    newText: "let beta = alpha * 4;",
  }]));
  cases.push(runCase(parser, initial, "paste-edit", [{
    start: source.length,
    oldEnd: source.length,
    newText: "\nlet delta = gamma + beta;",
  }]));
  return {
    format: "baba-incremental-parser-benchmark",
    version: 1,
    generatedAt: new Date().toISOString(),
    cases,
  };
}

function runCase(
  parser: ReturnType<typeof createGrammarIncrementalParser>,
  initial: ReturnType<
    ReturnType<typeof createGrammarIncrementalParser>["parseInitial"]
  >,
  name: string,
  edits: readonly GrammarTextEdit[],
): IncrementalBenchCase {
  const start = performance.now();
  const result = parser.applyEdits(initial, edits);
  const elapsedMs = performance.now() - start;
  return {
    name,
    elapsedMs,
    changedRanges: result.changedRanges,
    relexedRange: result.relexedRange,
    reparsedRange: result.reparsedRange,
    reusedNodeCount: result.reusedNodeCount,
    diagnostics: result.diagnostics.length,
    cancelled: result.cancelled,
  };
}

function renderReport(report: IncrementalBenchReport): string {
  const lines = [
    "Baba incremental parser benchmark",
    `version: ${report.version}`,
    "",
  ];
  for (const entry of report.cases) {
    lines.push(
      `${entry.name}: ${
        entry.elapsedMs.toFixed(2)
      } ms, reused ${entry.reusedNodeCount}, diagnostics ${entry.diagnostics}`,
    );
  }
  return lines.join("\n");
}

function parseArgs(args: readonly string[]): {
  readonly jsonPath: string | undefined;
  readonly jsonStdout: boolean;
} {
  let jsonPath: string | undefined;
  let jsonStdout = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--json") {
      const next = args[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        jsonPath = next;
        index++;
      } else {
        jsonStdout = true;
      }
    }
  }
  return { jsonPath, jsonStdout };
}
