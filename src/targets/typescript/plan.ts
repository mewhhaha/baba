import type {
  BabaMetadata,
  Diagnostic,
  GeneratedFile,
  PortabilityMode,
  TypeScriptTargetOptions,
} from "../../ast.ts";
import type { AnalyzedGrammar } from "../../compiler/ir.ts";
import type { Dfa } from "../../compiler/regex/dfa.ts";
import type { BnfGrammar } from "./bnf.ts";
import type { LrTable } from "./lr1.ts";
import type {
  PortableParserPlanMetadata,
  PortableParserPlanV1,
} from "../runtime/portable_plan.ts";
import { RUNTIME_IMPLEMENTATION_METADATA } from "../runtime/implementation.ts";
import { emitLexerFromPortablePlan } from "./lexer_emit.ts";
import { emitParserFromPortablePlan } from "./parser_emit.ts";
import { emitSyntaxFromPortablePlan } from "./syntax_emit.ts";
import {
  portablePlanToBnf,
  portablePlanToDfa,
  portablePlanToLrTable,
} from "../../compiler/portable_plan/adapters.ts";
import {
  planPortableRuntime,
  type RuntimeParserPlan,
  type RuntimeParserPlanningOptions,
} from "../runtime/plan.ts";
import { generatedSourceBanner } from "../runtime/provenance.ts";

export interface TypeScriptPlan {
  analyzed: AnalyzedGrammar;
  bnf: BnfGrammar;
  lr: LrTable;
  dfa: Dfa;
  portable: PortableParserPlanV1;
  portableMetadata: PortableParserPlanMetadata;
  directory: string;
  generatedBytes: number;
  diagnostics: readonly Diagnostic[];
}

export function planTypeScriptTarget(
  analyzed: AnalyzedGrammar,
  options: TypeScriptTargetOptions = {},
  metadata: BabaMetadata = {},
  portability: PortabilityMode = "warn",
  runtimePlanInput?: RuntimeParserPlan | { diagnostics: readonly Diagnostic[] },
): TypeScriptPlan | { diagnostics: readonly Diagnostic[] } {
  const diagnostics = [...typescriptOptionsDiagnostics(options)];
  const runtimePlan = runtimePlanInput ??
    planPortableRuntimeFallback(analyzed, options, metadata, portability);
  if (!runtimePlanInput) diagnostics.push(...runtimePlan.diagnostics);
  if (hasErrors(diagnostics) || !isRuntimePlan(runtimePlan)) {
    return { diagnostics };
  }
  const portableBnf = portablePlanToBnf(runtimePlan.portable);
  const portableLr = portablePlanToLrTable(runtimePlan.portable);
  const portableDfa = portablePlanToDfa(runtimePlan.portable);
  const generatedSources = typeScriptSources(
    analyzed,
    portableBnf,
    portableLr,
    runtimePlan.portable,
    runtimePlan.portableMetadata,
    options,
  );
  const generatedBytes = byteLength(
    generatedSources.map((source) => source.content).join(""),
  );
  if (
    options.generatedByteLimit !== undefined &&
    generatedBytes > options.generatedByteLimit
  ) {
    diagnostics.push({
      code: "TS_GENERATED_BYTE_LIMIT",
      severity: "error",
      backend: "typescript",
      message:
        `The TypeScript target generated ${generatedBytes} bytes, exceeding the configured limit (${options.generatedByteLimit}).`,
    });
  }
  if (hasErrors(diagnostics)) return { diagnostics };
  if (options.reportParserStats) {
    diagnostics.push(
      parserStatsDiagnostic(
        analyzed,
        runtimePlan,
        generatedBytes,
      ),
    );
  }

  return {
    analyzed,
    bnf: portableBnf,
    lr: portableLr,
    dfa: portableDfa,
    portable: runtimePlan.portable,
    portableMetadata: runtimePlan.portableMetadata,
    directory: options.directory ?? "typescript",
    generatedBytes,
    diagnostics,
  };
}

export function emitTypeScriptTarget(
  plan: TypeScriptPlan,
  options: TypeScriptTargetOptions = {},
): GeneratedFile[] {
  const dir = plan.directory;
  return typeScriptSources(
    plan.analyzed,
    plan.bnf,
    plan.lr,
    plan.portable,
    plan.portableMetadata,
    options,
  ).map((file) => ({
    path: `${dir}/${file.path}`,
    content: file.content,
    kind: "source",
    encoding: "utf-8",
  }));
}

function typeScriptSources(
  _analyzed: AnalyzedGrammar,
  _bnf: BnfGrammar,
  _lr: LrTable,
  portable: PortableParserPlanV1,
  portableMetadata: PortableParserPlanMetadata,
  options: TypeScriptTargetOptions,
): Array<{ path: string; content: string }> {
  return [
    {
      path: "syntax.ts",
      content: emitSyntaxFromPortablePlan(portable),
    },
    {
      path: "lexer.ts",
      content: emitLexerFromPortablePlan(portable, options),
    },
    {
      path: "parser.ts",
      content: emitParserFromPortablePlan(portable),
    },
    {
      path: "mod.ts",
      content: typeScriptModSource(portableMetadata),
    },
  ];
}

function typeScriptModSource(
  portableMetadata: PortableParserPlanMetadata,
): string {
  return `${
    generatedSourceBanner({
      parserPlanVersion: portableMetadata.version,
      parserPlanSemantics: portableMetadata.semantics,
    })
  }
export const parserPlanFormat = ${
    JSON.stringify(portableMetadata.format)
  } as const;
export const parserPlanVersion = ${portableMetadata.version};
export const parserPlanSemantics = ${
    JSON.stringify(portableMetadata.semantics)
  } as const;
export const parserPlanHash = ${JSON.stringify(portableMetadata.hash)} as const;
export const runtimeImplementationFormat = ${
    JSON.stringify(RUNTIME_IMPLEMENTATION_METADATA.format)
  } as const;
export const runtimeImplementationVersion = ${RUNTIME_IMPLEMENTATION_METADATA.version};
export const runtimeImplementationSemantics = ${
    JSON.stringify(RUNTIME_IMPLEMENTATION_METADATA.semantics)
  } as const;
export const runtimeImplementationHash = ${
    JSON.stringify(RUNTIME_IMPLEMENTATION_METADATA.hash)
  } as const;
export * from "./syntax.ts";
export { lex } from "./lexer.ts";
export { parse, parserDiagnosticCodeAmbiguousParse, parserDiagnosticCodeBranchLimit, parserDiagnosticCodeInternalError, parserDiagnosticCodeParseInvalidTokenStream, parserDiagnosticCodeParseLexicalError, parserDiagnosticCodeParseTrailingInput, parserDiagnosticCodeParseUnexpectedToken, parserDiagnosticCodeTraceLimit, parserDiagnosticDetailKindNone, parserDiagnosticDetailKindParserState, parseTokens, parseTokensUnchecked } from "./parser.ts";
`;
}

function typescriptOptionsDiagnostics(
  options: TypeScriptTargetOptions,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const directory = options.directory ?? "typescript";
  if (!isSafeRelativeDirectory(directory)) {
    diagnostics.push({
      code: "TS_INVALID_OUTPUT_DIRECTORY",
      severity: "error",
      backend: "typescript",
      message:
        `Invalid TypeScript output directory '${directory}'. Use a relative directory without '.', '..', empty components, absolute paths, drive prefixes, or backslashes.`,
    });
  }
  if (
    options.generatedByteLimit !== undefined &&
    (!Number.isInteger(options.generatedByteLimit) ||
      options.generatedByteLimit < 1)
  ) {
    diagnostics.push({
      code: "TS_GENERATED_BYTE_LIMIT",
      severity: "error",
      backend: "typescript",
      message: "generatedByteLimit must be a positive integer.",
    });
  }
  return diagnostics;
}

function parserStatsDiagnostic(
  analyzed: AnalyzedGrammar,
  runtimePlan: RuntimeParserPlan,
  generatedBytes: number,
): Diagnostic {
  const stats = runtimePlan.lr.stats;
  const portableStats = runtimePlan.portable.statistics;
  return {
    code: "TS_PARSER_STATS",
    severity: "information",
    backend: "typescript",
    message: [
      "TypeScript parser planning statistics:",
      `rules: ${analyzed.reachableRules.size}`,
      `BNF productions: ${runtimePlan.bnf.productions.length}`,
      `lexer states: ${portableStats.lexerStates}`,
      `lexer accept candidates: ${portableStats.lexerAcceptCandidates}`,
      `lexer average accept candidates/state: ${
        (portableStats.lexerAverageAcceptCandidatesPerStateMilli / 1000)
          .toFixed(2)
      }`,
      `lexer max accept candidates/state: ${portableStats.lexerMaxAcceptCandidatesPerState}`,
      `lexer ambiguous accept states: ${portableStats.lexerAmbiguousAcceptStates}`,
      `regex AST nodes: ${runtimePlan.analysisStats.regexAstNodes}`,
      `regex NFA states: ${runtimePlan.analysisStats.regexNfaStates}`,
      `regex DFA states: ${runtimePlan.analysisStats.regexDfaStates}`,
      `regex DFA transitions: ${runtimePlan.analysisStats.regexDfaTransitions}`,
      `overlap token pairs compared: ${runtimePlan.analysisStats.tokenOverlapPairsCompared}`,
      `overlap literal pairs compared: ${runtimePlan.analysisStats.literalOverlapPairsCompared}`,
      `shadowing analyses: ${runtimePlan.analysisStats.shadowingAnalyses}`,
      `grammar SCCs: ${runtimePlan.analysisStats.grammar.stronglyConnectedComponents}`,
      `nullable iterations: ${runtimePlan.analysisStats.grammar.nullableIterations}`,
      `productive iterations: ${runtimePlan.analysisStats.grammar.productiveIterations}`,
      `LR states: ${stats.states}`,
      `LR core items: ${stats.coreItems}`,
      `LR items: ${stats.items}`,
      `LR closure work: ${stats.closureWork}`,
      `ACTION entries: ${stats.actionEntries}`,
      `GOTO entries: ${stats.gotoEntries}`,
      `table entries: ${stats.tableEntries}`,
      `diagnostics emitted: ${runtimePlan.analysisStats.diagnosticsEmitted}`,
      `diagnostics suppressed: ${runtimePlan.analysisStats.diagnosticsSuppressed}`,
      `generated bytes: ${generatedBytes}`,
    ].join("\n"),
  };
}

function byteLength(source: string): number {
  return new TextEncoder().encode(source).length;
}

function isSafeRelativeDirectory(directory: string): boolean {
  if (
    directory.length === 0 ||
    directory.includes("\0") ||
    directory.includes("\\") ||
    directory.startsWith("/") ||
    /^[A-Za-z]:/.test(directory)
  ) {
    return false;
  }
  return directory.split("/").every((component) =>
    component !== "" && component !== "." && component !== ".."
  );
}

function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) =>
    (diagnostic.severity ?? "error") === "error"
  );
}

function runtimePlanningOptions(
  options: TypeScriptTargetOptions,
): RuntimeParserPlanningOptions {
  return {
    lexerStateLimit: options.lexerStateLimit,
    regexSourceLengthLimit: options.regexSourceLengthLimit,
    regexNestingLimit: options.regexNestingLimit,
    regexAstNodeLimit: options.regexAstNodeLimit,
    regexBoundedRepeatLimit: options.regexBoundedRepeatLimit,
    regexNfaStateLimit: options.regexNfaStateLimit,
    regexDfaStateLimit: options.regexDfaStateLimit,
    regexOverlapStateLimit: options.regexOverlapStateLimit,
    regexOverlapPairLimit: options.regexOverlapPairLimit,
    grammarExpressionDepthLimit: options.grammarExpressionDepthLimit,
    parserStateLimit: options.parserStateLimit,
    parserItemLimit: options.parserItemLimit,
    lrClosureWorkLimit: options.lrClosureWorkLimit,
    parserTableEntryLimit: options.parserTableEntryLimit,
    diagnosticLimit: options.diagnosticLimit,
  };
}

export { runtimePlanningOptions as typeScriptRuntimePlanningOptions };

function planPortableRuntimeFallback(
  analyzed: AnalyzedGrammar,
  options: TypeScriptTargetOptions,
  metadata: BabaMetadata,
  portability: PortabilityMode,
): RuntimeParserPlan | { diagnostics: readonly Diagnostic[] } {
  return planPortableRuntime(
    analyzed,
    runtimePlanningOptions(options),
    metadata,
    portability,
  );
}

function isRuntimePlan(
  value: RuntimeParserPlan | { diagnostics: readonly Diagnostic[] },
): value is RuntimeParserPlan {
  return "bnf" in value;
}
