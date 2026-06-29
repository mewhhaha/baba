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
  PortableParserPlan,
  PortableParserPlanMetadata,
} from "../runtime/portable_plan.ts";
import { RUNTIME_IMPLEMENTATION_METADATA } from "../runtime/implementation.ts";
import { emitLexerFromPortablePlan } from "./lexer_emit.ts";
import { emitParserFromPortablePlan } from "./parser_emit.ts";
import { emitSyntaxFromPortablePlan } from "./syntax_emit.ts";
import { createParserKit } from "../kit/plan.ts";
import type { ParserKit } from "../kit/schema.ts";
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
  portable: PortableParserPlan;
  portableMetadata: PortableParserPlanMetadata;
  parserKit: ParserKit;
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
    createParserKit(
      analyzed,
      runtimePlan,
      options.preserveTrivia ?? true,
      "runtime",
    ),
    options,
  );
  const generatedBytes = generatedSources.reduce(
    (sum, source) => sum + generatedSourceBytes(source.content),
    0,
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
    parserKit: createParserKit(
      analyzed,
      runtimePlan,
      options.preserveTrivia ?? true,
      "runtime",
    ),
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
    plan.parserKit,
    options,
  ).map((file) => ({
    path: `${dir}/${file.path}`,
    content: file.content,
    kind: "source" as const,
    encoding: "utf-8" as const,
  }));
}

function typeScriptSources(
  _analyzed: AnalyzedGrammar,
  _bnf: BnfGrammar,
  _lr: LrTable,
  portable: PortableParserPlan,
  portableMetadata: PortableParserPlanMetadata,
  parserKit: ParserKit,
  options: TypeScriptTargetOptions,
): Array<{ path: string; content: string }> {
  if ((options.runtimePackaging ?? "shared") === "shared") {
    return sharedRuntimeSources(portable, portableMetadata, parserKit, options);
  }
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

function sharedRuntimeSources(
  portable: PortableParserPlan,
  portableMetadata: PortableParserPlanMetadata,
  parserKit: ParserKit,
  options: TypeScriptTargetOptions,
): Array<{ path: string; content: string }> {
  const planSources = typeScriptPlanSources(
    portableMetadata,
    parserKit,
    options.planData ?? "inline",
  );
  return [
    ...planSources,
    {
      path: "types.ts",
      content: emitMinimalTypesFromPortablePlan(portable, portableMetadata),
    },
    {
      path: "mod.ts",
      content: sharedRuntimeModSource(portableMetadata),
    },
    {
      path: "syntax.ts",
      content: syntaxCompatibilitySource(portableMetadata),
    },
    {
      path: "lexer.ts",
      content: lexerCompatibilitySource(portableMetadata),
    },
    {
      path: "parser.ts",
      content: parserCompatibilitySource(portableMetadata),
    },
  ];
}

function typeScriptPlanSources(
  portableMetadata: PortableParserPlanMetadata,
  parserKit: ParserKit,
  planData: NonNullable<TypeScriptTargetOptions["planData"]>,
): Array<{ path: string; content: string }> {
  const compactPlan = compactRuntimePlan(parserKit);
  if (planData === "json") {
    return [
      {
        path: "plan.ts",
        content: `${
          generatedSourceBanner({
            parserPlanVersion: portableMetadata.version,
            parserPlanSemantics: portableMetadata.semantics,
          })
        }
import compactParserPlan from "./plan.json" with { type: "json" };

export { compactParserPlan };
`,
      },
      {
        path: "plan.json",
        content: `${JSON.stringify(compactPlan)}\n`,
      },
    ];
  }
  return [
    {
      path: "plan.ts",
      content: typeScriptPlanSourceFromCompactPlan(
        portableMetadata,
        compactPlan,
      ),
    },
  ];
}

function typeScriptPlanSourceFromCompactPlan(
  portableMetadata: PortableParserPlanMetadata,
  compactPlan: unknown,
): string {
  return `${
    generatedSourceBanner({
      parserPlanVersion: portableMetadata.version,
      parserPlanSemantics: portableMetadata.semantics,
    })
  }
export const compactParserPlan = ${JSON.stringify(compactPlan)} as const;
`;
}

export function compactRuntimePlan(kit: ParserKit): unknown {
  return {
    m: [
      kit.portablePlan.format,
      kit.portablePlan.version,
      kit.portablePlan.semantics,
      kit.portablePlan.hash,
      kit.runtimeImplementation?.hash ?? RUNTIME_IMPLEMENTATION_METADATA.hash,
    ],
    g: [
      kit.grammar.name,
      kit.grammar.rootRule,
      kit.grammar.rootRuleId,
      kit.grammar.rootNodeType,
      kit.grammar.rules.map((rule) => [
        rule.id,
        rule.name,
        rule.reachable,
        rule.nodeType,
      ]),
    ],
    t: [
      kit.tokens.named.map((token) => [
        token.id,
        token.name,
        token.kind === "token" ? 0 : 1,
        token.priority,
        token.declarationOrder,
        token.reachable,
      ]),
      kit.tokens.literals.map((literal) => [
        literal.id,
        literal.value,
        literal.sourceOrder,
        literal.reachable,
      ]),
    ],
    l: [
      kit.lexer.defaultPreserveTrivia,
      kit.lexer.specs.map((spec) =>
        spec.type === "named" ? [0, spec.tokenId] : [1, spec.literalId]
      ),
      kit.lexer.dfa.start,
      kit.lexer.dfa.transitions.map((row) =>
        row.map((transition) => [
          transition.start,
          transition.end,
          transition.target,
        ])
      ),
      kit.lexer.dfa.accepts,
      kit.lexer.dfa.acceptCandidates ?? [],
    ],
    b: [
      kit.bnf.startNonterminal,
      kit.bnf.rootRuleNonterminal,
      kit.bnf.eofTerminal,
      kit.bnf.terminals.map((terminal) => [
        terminal.id,
        terminal.kind === "eof" ? 0 : terminal.kind === "named" ? 1 : 2,
        terminal.key,
        terminal.display,
        terminal.kind === "named"
          ? terminal.tokenId
          : terminal.kind === "literal"
          ? terminal.literalId
          : undefined,
      ]),
      kit.bnf.nonterminals.map((nonterminal) => [
        nonterminal.id,
        nonterminal.name,
        nonterminal.ruleId,
        nonterminal.expressionId,
      ]),
      kit.bnf.productions.map((production) => [
        production.id,
        production.lhs,
        production.rhs.map((symbol) => [
          symbol.kind === "terminal" ? 0 : 1,
          symbol.id,
        ]),
        compactReducer(production.reducer),
      ]),
    ],
    r: [
      kit.lr.conflictProfile === "branching" ? 1 : 0,
      kit.lr.states.length,
      kit.lr.actions.map((entry) => [
        entry.state,
        entry.terminal,
        entry.actions.map(compactAction),
      ]),
      kit.lr.gotos.map((entry) => [
        entry.state,
        entry.nonterminal,
        entry.target,
      ]),
      [
        kit.lr.stats.bnfProductions,
        kit.lr.stats.states,
        kit.lr.stats.coreItems,
        kit.lr.stats.items,
        kit.lr.stats.closureWork,
        kit.lr.stats.actionEntries,
        kit.lr.stats.gotoEntries,
        kit.lr.stats.tableEntries,
      ],
    ],
    f: [
      kit.fields.rootNodeType,
      kit.fields.rules.map((rule) => [
        rule.ruleId,
        rule.ruleName,
        rule.nodeType,
        rule.fields.map((field) => [
          field.name,
          field.type,
          field.array,
          field.nullable,
        ]),
      ]),
    ],
    d: [
      kit.displayNames.terminals.map((entry) => [entry.id, entry.display]),
      kit.displayNames.rules.map((entry) => [entry.id, entry.display]),
    ],
  };
}

function compactReducer(
  reducer: ParserKit["bnf"]["productions"][number]["reducer"],
) {
  switch (reducer.kind) {
    case "start":
      return [0];
    case "rule":
      return [1, reducer.ruleId];
    case "terminal":
      return [2];
    case "ruleRef":
      return [3];
    case "identity":
      return [4];
    case "sequence":
      return [5];
    case "optionalEmpty":
      return [6];
    case "optionalSome":
      return [7];
    case "repeatEmpty":
      return [8];
    case "repeatAppend":
      return [9];
    case "repeat1First":
      return [10];
    case "repeat1Append":
      return [11];
    case "separatedFirst":
      return [12];
    case "separatedAppend":
      return [13];
    case "field":
      return [14, reducer.name];
  }
}

function compactAction(
  action: ParserKit["lr"]["actions"][number]["actions"][number],
) {
  if (action.kind === "shift") return [0, action.state];
  if (action.kind === "reduce") return [1, action.production];
  return [2];
}

function emitMinimalTypesFromPortablePlan(
  portable: PortableParserPlan,
  portableMetadata: PortableParserPlanMetadata,
): string {
  const mainTokenKinds = portable.symbols.tokens
    .filter((token) => token.kind === "token" && token.reachable)
    .map((token) => token.name);
  const triviaTokenKinds = portable.symbols.tokens
    .filter((token) => token.kind === "skip" && token.reachable)
    .map((token) => token.name);
  const literalKinds = portable.symbols.literals
    .filter((literal) => literal.reachable)
    .map((literal) => literal.value);
  const ruleNames = portable.cst.rules.map((rule) => rule.ruleName);
  const rootName = portable.cst.rootNodeType;
  return `${
    generatedSourceBanner({
      parserPlanVersion: portableMetadata.version,
      parserPlanSemantics: portableMetadata.semantics,
    })
  }
import type {
  EofToken,
  ErrorToken,
  LexDiagnostic,
  LexOptions,
  LexResult,
  LiteralToken,
  MainNamedToken,
  ParseDiagnostic,
  ParseOptions,
  ParseResult,
  Position,
  RuleNode,
  SourceMap,
  Span,
  SyntaxElement,
  Token,
  TriviaToken,
} from "@mewhhaha/baba/runtime";

export type NamedTokenKind = ${stringUnion(mainTokenKinds)};
export type TriviaTokenKind = ${stringUnion(triviaTokenKinds)};
export type LiteralKind = ${stringUnion(literalKinds)};
export type RuleName = ${stringUnion(ruleNames)};

export type {
  EofToken,
  ErrorToken,
  LexDiagnostic,
  LexOptions,
  LexResult,
  LiteralToken,
  MainNamedToken,
  ParseDiagnostic,
  ParseOptions,
  ParseResult,
  Position,
  RuleNode,
  SourceMap,
  Span,
  SyntaxElement,
  Token,
  TriviaToken,
};

export type RootNode = RuleNode<${JSON.stringify(rootName)}>;
`;
}

function sharedRuntimeModSource(
  portableMetadata: PortableParserPlanMetadata,
): string {
  return `${
    generatedSourceBanner({
      parserPlanVersion: portableMetadata.version,
      parserPlanSemantics: portableMetadata.semantics,
    })
  }
import { createParser, inflateCompactRuntimePlan } from "@mewhhaha/baba/runtime";
import { compactParserPlan } from "./plan.ts";

export const parserPlan = inflateCompactRuntimePlan(compactParserPlan);
const parser = createParser(parserPlan);

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

export const lex = parser.lex;
export const parse = parser.parse;
export const parseTokens = parser.parseTokens;
export const parseTokensUnchecked = parser.parseTokensUnchecked;
export { parser };
export { createSourceMap, positionAt } from "@mewhhaha/baba/runtime";
export * from "./types.ts";
export {
  parserDiagnosticCodeAmbiguousParse,
  parserDiagnosticCodeBranchLimit,
  parserDiagnosticCodeInternalError,
  parserDiagnosticCodeParseInvalidTokenStream,
  parserDiagnosticCodeParseLexicalError,
  parserDiagnosticCodeParseTrailingInput,
  parserDiagnosticCodeParseUnexpectedToken,
  parserDiagnosticCodeTraceLimit,
  parserDiagnosticDetailKindNone,
  parserDiagnosticDetailKindParserState,
} from "@mewhhaha/baba/runtime";
`;
}

function syntaxCompatibilitySource(
  portableMetadata: PortableParserPlanMetadata,
): string {
  return compatibilitySource(
    portableMetadata,
    'export * from "./types.ts";',
  );
}

function lexerCompatibilitySource(
  portableMetadata: PortableParserPlanMetadata,
): string {
  return compatibilitySource(
    portableMetadata,
    'export { lex } from "./mod.ts";\nexport type { LexDiagnostic, LexOptions, LexResult, Token } from "./types.ts";',
  );
}

function parserCompatibilitySource(
  portableMetadata: PortableParserPlanMetadata,
): string {
  return compatibilitySource(
    portableMetadata,
    'export { parse, parseTokens, parseTokensUnchecked, parserDiagnosticCodeAmbiguousParse, parserDiagnosticCodeBranchLimit, parserDiagnosticCodeInternalError, parserDiagnosticCodeParseInvalidTokenStream, parserDiagnosticCodeParseLexicalError, parserDiagnosticCodeParseTrailingInput, parserDiagnosticCodeParseUnexpectedToken, parserDiagnosticCodeTraceLimit, parserDiagnosticDetailKindNone, parserDiagnosticDetailKindParserState } from "./mod.ts";\nexport type { ParseDiagnostic, ParseOptions, ParseResult, RootNode } from "./types.ts";',
  );
}

function compatibilitySource(
  portableMetadata: PortableParserPlanMetadata,
  body: string,
): string {
  return `${
    generatedSourceBanner({
      parserPlanVersion: portableMetadata.version,
      parserPlanSemantics: portableMetadata.semantics,
    })
  }
${body}
`;
}

function stringUnion(values: readonly string[]): string {
  return values.length === 0
    ? "never"
    : values.map((value) => JSON.stringify(value)).join(" | ");
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
    options.runtimePackaging !== undefined &&
    options.runtimePackaging !== "shared" &&
    options.runtimePackaging !== "legacy-generated"
  ) {
    diagnostics.push({
      code: "TS_INVALID_RUNTIME_PACKAGING",
      severity: "error",
      backend: "typescript",
      message: "runtimePackaging must be shared or legacy-generated.",
    });
  }
  if (
    options.planData !== undefined &&
    options.planData !== "inline" &&
    options.planData !== "json"
  ) {
    diagnostics.push({
      code: "TS_INVALID_PLAN_DATA",
      severity: "error",
      backend: "typescript",
      message: "planData must be inline or json.",
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

function generatedSourceBytes(source: string | Uint8Array): number {
  return source instanceof Uint8Array ? source.length : byteLength(source);
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
