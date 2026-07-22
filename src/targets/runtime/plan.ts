import type { BabaMetadata, Diagnostic } from "../../ast.ts";
import {
  type GrammarAnalysisStatistics,
  grammarAnalysisStatistics,
} from "../../compiler/analyzed_grammar.ts";
import type { AnalyzedGrammar } from "../../compiler/ir.ts";
import { countRegexAstNodes, type RegexAst } from "../../compiler/regex/ast.ts";
import { buildDfa, type Dfa } from "../../compiler/regex/dfa.ts";
import {
  DEFAULT_REGEX_NESTING_LIMIT,
  enforceRegexAstNodeLimit,
  type RegexCompilerLimits,
  RegexResourceLimitError,
} from "../../compiler/regex/limits.ts";
import {
  buildLexerDfa,
  type LexerRegexSpec,
} from "../../compiler/regex/lexer.ts";
import {
  dfaOverlapWitness,
  dfaUncoveredWitness,
  regexDfa,
} from "../../compiler/regex/overlap.ts";
import { buildRegexNfa } from "../../compiler/regex/nfa.ts";
import {
  type BnfGrammar,
  lowerToBnf,
} from "../../compiler/runtime_plan/bnf.ts";
import {
  buildCanonicalLr1Table,
  type LrTable,
} from "../../compiler/runtime_plan/lr1.ts";
import {
  type ContextualTrailingContextPlan,
  createPortableParserPlan,
  type PortableParserPlan,
  type PortableParserPlanMetadata,
  portableParserPlanMetadata,
} from "./portable_plan.ts";

export interface RuntimeParserPlan {
  analyzed: AnalyzedGrammar;
  bnf: BnfGrammar;
  lr: LrTable;
  dfa: Dfa;
  portable: PortableParserPlan;
  portableMetadata: PortableParserPlanMetadata;
  analysisStats: RuntimeParserAnalysisStatistics;
  diagnostics: readonly Diagnostic[];
}

export interface RuntimeParserAnalysisStatistics {
  readonly regexAstNodes: number;
  readonly regexNfaStates: number;
  readonly regexDfaStates: number;
  readonly regexDfaTransitions: number;
  readonly combinedLexerDfaStates: number;
  readonly combinedLexerDfaTransitions: number;
  readonly tokenOverlapPairsCompared: number;
  readonly literalOverlapPairsCompared: number;
  readonly shadowingAnalyses: number;
  readonly grammar: GrammarAnalysisStatistics;
  readonly diagnosticsEmitted: number;
  readonly diagnosticsSuppressed: number;
}

export interface RuntimeParserPlanningOptions {
  lexerStateLimit?: number;
  regexSourceLengthLimit?: number;
  regexNestingLimit?: number;
  regexBoundedRepeatLimit?: number;
  regexAstNodeLimit?: number;
  regexNfaStateLimit?: number;
  regexDfaStateLimit?: number;
  regexOverlapStateLimit?: number;
  regexOverlapPairLimit?: number;
  grammarExpressionDepthLimit?: number;
  parserStateLimit?: number;
  parserItemLimit?: number;
  lrClosureWorkLimit?: number;
  parserTableEntryLimit?: number;
  diagnosticLimit?: number;
}

export interface RuntimeParserTargetConfig {
  backend: string;
  codePrefix: string;
  label: string;
}

export const PORTABLE_RUNTIME_TARGET_CONFIG: RuntimeParserTargetConfig = {
  backend: "portable",
  codePrefix: "PORTABLE",
  label: "portable runtime",
};

const DEFAULT_LEXER_STATE_LIMIT = 50_000;
const DEFAULT_REGEX_AST_NODE_LIMIT = 100_000;
const DEFAULT_REGEX_BOUNDED_REPEAT_LIMIT = 10_000;
const DEFAULT_REGEX_NFA_STATE_LIMIT = 100_000;
const DEFAULT_REGEX_DFA_STATE_LIMIT = 50_000;
const DEFAULT_REGEX_OVERLAP_STATE_LIMIT = 250_000;

let portableRuntimePlanInvocationCountForTesting = 0;

interface RuntimeRegexAnalysis {
  diagnostics: readonly Diagnostic[];
  astByTokenId: ReadonlyMap<number, RegexAst>;
  dfaByTokenId: ReadonlyMap<number, Dfa>;
  trailingContextByTokenId: ReadonlyMap<number, ContextualTrailingContextPlan>;
  stats: Pick<
    RuntimeParserAnalysisStatistics,
    | "regexAstNodes"
    | "regexNfaStates"
    | "regexDfaStates"
    | "regexDfaTransitions"
  >;
}

interface RuntimeDfaAnalysis {
  diagnostics: readonly Diagnostic[];
  dfa?: Dfa;
  stats: Pick<
    RuntimeParserAnalysisStatistics,
    "combinedLexerDfaStates" | "combinedLexerDfaTransitions"
  >;
}

export function planPortableRuntime(
  analyzed: AnalyzedGrammar,
  options: RuntimeParserPlanningOptions = {},
  metadata: BabaMetadata = {},
): RuntimeParserPlan | { diagnostics: readonly Diagnostic[] } {
  portableRuntimePlanInvocationCountForTesting++;
  return planRuntimeParserTarget(
    analyzed,
    options,
    metadata,
    PORTABLE_RUNTIME_TARGET_CONFIG,
  );
}

export function resetPortableRuntimePlanInvocationCountForTesting(): void {
  portableRuntimePlanInvocationCountForTesting = 0;
}

export function getPortableRuntimePlanInvocationCountForTesting(): number {
  return portableRuntimePlanInvocationCountForTesting;
}

export function planRuntimeParserTarget(
  analyzed: AnalyzedGrammar,
  options: RuntimeParserPlanningOptions = {},
  metadata: BabaMetadata = {},
  config: RuntimeParserTargetConfig,
): RuntimeParserPlan | { diagnostics: readonly Diagnostic[] } {
  const optionDiagnostics = runtimeOptionsDiagnostics(options, config);
  if (hasErrors(optionDiagnostics)) {
    return { diagnostics: capDiagnostics(optionDiagnostics, options, config) };
  }
  const regexLimits = runtimeRegexLimits(options);
  const regexAnalysis = analyzeRuntimeRegexes(analyzed, regexLimits, config);
  const literalOverlapAnalysis = runtimeLiteralOverlapDiagnostics(
    analyzed,
    regexAnalysis.dfaByTokenId,
    regexLimits,
    options,
    config,
  );
  const diagnostics: Diagnostic[] = [
    ...optionDiagnostics,
    ...regexAnalysis.diagnostics,
    ...runtimeLiteralDiagnostics(analyzed, config),
    ...literalOverlapAnalysis.diagnostics,
  ];
  if (hasErrors(diagnostics)) {
    return { diagnostics: capDiagnostics(diagnostics, options, config) };
  }

  const dfaAnalysis = runtimeLexerDfaDiagnostics(
    analyzed,
    regexAnalysis.astByTokenId,
    options,
    regexLimits,
    config,
  );
  diagnostics.push(...dfaAnalysis.diagnostics);
  if (hasErrors(diagnostics) || !dfaAnalysis.dfa) {
    return { diagnostics: capDiagnostics(diagnostics, options, config) };
  }

  const bnf = lowerToBnf(analyzed);
  diagnostics.push(
    ...bnf.diagnostics.map((diagnostic) =>
      retargetRuntimeDiagnostic(diagnostic, config)
    ),
  );
  if (hasErrors(diagnostics)) {
    return { diagnostics: capDiagnostics(diagnostics, options, config) };
  }

  const lr = buildCanonicalLr1Table(bnf, {
    stateLimit: options.parserStateLimit ?? 20_000,
    itemLimit: options.parserItemLimit,
    closureWorkLimit: options.lrClosureWorkLimit,
    tableEntryLimit: options.parserTableEntryLimit,
    conflictGroups: metadata.parser?.conflicts,
    conflictResolutions: metadata.parser?.resolutions,
  });
  diagnostics.push(
    ...lr.diagnostics.map((diagnostic) =>
      retargetRuntimeDiagnostic(diagnostic, config)
    ),
  );
  const tokenOverlapAnalysis = runtimeTokenOverlapDiagnostics(
    analyzed,
    regexAnalysis.dfaByTokenId,
    regexLimits,
    options,
    config,
    bnf,
    lr,
  );
  diagnostics.push(...tokenOverlapAnalysis.diagnostics);
  const shadowingAnalysis = runtimeShadowedTokenDiagnostics(
    analyzed,
    regexAnalysis.dfaByTokenId,
    regexLimits,
    config,
    bnf,
    lr,
  );
  diagnostics.push(...shadowingAnalysis.diagnostics);
  const unusedSkipAnalysis = runtimeUnusedSkipDiagnostics(
    analyzed,
    regexAnalysis.dfaByTokenId,
    regexLimits,
    config,
    bnf,
  );
  diagnostics.push(...unusedSkipAnalysis.diagnostics);
  if (hasErrors(diagnostics)) {
    return { diagnostics: capDiagnostics(diagnostics, options, config) };
  }

  const portable = createPortableParserPlan(
    analyzed,
    bnf,
    lr,
    dfaAnalysis.dfa,
    regexAnalysis.trailingContextByTokenId,
  );

  const cappedDiagnostics = capDiagnostics(diagnostics, options, config);
  const diagnosticsSuppressed = diagnosticSuppressedCount(diagnostics, options);
  return {
    analyzed,
    bnf,
    lr,
    dfa: dfaAnalysis.dfa,
    portable,
    portableMetadata: portableParserPlanMetadata(portable),
    analysisStats: {
      ...regexAnalysis.stats,
      ...dfaAnalysis.stats,
      tokenOverlapPairsCompared: tokenOverlapAnalysis.pairsCompared,
      literalOverlapPairsCompared: literalOverlapAnalysis.pairsCompared,
      shadowingAnalyses: shadowingAnalysis.analyses +
        unusedSkipAnalysis.analyses,
      grammar: grammarAnalysisStatistics(
        analyzed.rules,
        analyzed.reachableRules,
      ),
      diagnosticsEmitted: cappedDiagnostics.length,
      diagnosticsSuppressed,
    },
    diagnostics: cappedDiagnostics,
  };
}

export function retargetRuntimeDiagnostic(
  diagnostic: Diagnostic,
  config: RuntimeParserTargetConfig,
): Diagnostic {
  return {
    ...diagnostic,
    backend: config.backend,
    code: diagnostic.code.startsWith("TS_")
      ? `${config.codePrefix}_${diagnostic.code.slice("TS_".length)}`
      : diagnostic.code,
  };
}

export function runtimeLexerSpecs(
  analyzed: AnalyzedGrammar,
  astByTokenId: ReadonlyMap<number, RegexAst>,
): LexerRegexSpec[] {
  const specs: LexerRegexSpec[] = [];
  for (const token of analyzed.tokens) {
    if (
      token.kind !== "skip" &&
      !analyzed.reachableTokens.has(token.id)
    ) {
      continue;
    }
    const ast = astByTokenId.get(token.id);
    if (!ast) continue;
    specs.push({
      ast,
      type: "named",
      priority: token.priority,
      order: token.declarationOrder,
      contextual: token.kind === "contextual",
    });
  }
  for (const literal of analyzed.literals) {
    if (!analyzed.reachableLiterals.has(literal.id)) continue;
    specs.push({
      ast: literalAst(literal.value),
      type: "literal",
      priority: 0,
      order: literal.sourceOrder,
      contextual: false,
    });
  }
  return specs;
}

function analyzeRuntimeRegexes(
  analyzed: AnalyzedGrammar,
  limits: RegexCompilerLimits,
  config: RuntimeParserTargetConfig,
): RuntimeRegexAnalysis {
  const diagnostics: Diagnostic[] = [];
  const astByTokenId = new Map<number, RegexAst>();
  const dfaByTokenId = new Map<number, Dfa>();
  const trailingContextByTokenId = new Map<
    number,
    ContextualTrailingContextPlan
  >();
  let regexAstNodes = 0;
  let regexNfaStates = 0;
  let regexDfaStates = 0;
  let regexDfaTransitions = 0;
  for (const token of analyzed.tokens) {
    if (token.kind !== "skip" && !analyzed.reachableTokens.has(token.id)) {
      continue;
    }
    astByTokenId.set(token.id, token.pattern);
    try {
      const patterns: {
        readonly role: "token" | "followedBy" | "notFollowedBy";
        readonly ast: RegexAst;
      }[] = [{ role: "token", ast: token.pattern }];
      const trailingContext = token.trailingContext;
      if (trailingContext !== undefined) {
        if (trailingContext.followedBy !== undefined) {
          patterns.push({
            role: "followedBy",
            ast: trailingContext.followedBy,
          });
        }
        if (trailingContext.notFollowedBy !== undefined) {
          patterns.push({
            role: "notFollowedBy",
            ast: trailingContext.notFollowedBy,
          });
        }
      }
      let followedBy: Dfa | undefined;
      let notFollowedBy: Dfa | undefined;
      for (const pattern of patterns) {
        enforceRegexAstNodeLimit(pattern.ast, limits);
        regexAstNodes += countRegexAstNodes(pattern.ast);
        const nfa = buildRegexNfa(pattern.ast, 0, limits);
        regexNfaStates += nfa.states.length;
        const dfa = buildDfa(nfa, undefined, limits);
        regexDfaStates += dfa.states.length;
        regexDfaTransitions += countDfaTransitions(dfa);
        if (pattern.role === "token") {
          dfaByTokenId.set(token.id, dfa);
        } else if (pattern.role === "followedBy") {
          followedBy = dfa;
        } else {
          notFollowedBy = dfa;
        }
      }
      if (trailingContext !== undefined) {
        trailingContextByTokenId.set(token.id, {
          followedBy,
          followedByEof: trailingContext.followedByEof,
          notFollowedBy,
          excludedWords: trailingContext.excludedWords,
        });
      }
    } catch (error) {
      const diagnostic = regexLimitDiagnostic(error, config, token.span);
      if (diagnostic) {
        diagnostics.push(diagnostic);
        continue;
      }
      throw error;
    }
  }
  return {
    diagnostics,
    astByTokenId,
    dfaByTokenId,
    trailingContextByTokenId,
    stats: {
      regexAstNodes,
      regexNfaStates,
      regexDfaStates,
      regexDfaTransitions,
    },
  };
}

function runtimeTokenOverlapDiagnostics(
  analyzed: AnalyzedGrammar,
  dfaByTokenId: ReadonlyMap<number, Dfa>,
  limits: RegexCompilerLimits,
  options: RuntimeParserPlanningOptions,
  config: RuntimeParserTargetConfig,
  bnf: BnfGrammar,
  lr: LrTable,
): { diagnostics: Diagnostic[]; pairsCompared: number } {
  const tokens = analyzed.tokens.filter((token) =>
    token.kind === "skip" ||
    analyzed.reachableTokens.has(token.id)
  );
  const diagnostics: Diagnostic[] = [];
  const overlapBudget = createOverlapPairBudget(options, config);
  for (let leftIndex = 0; leftIndex < tokens.length; leftIndex++) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < tokens.length;
      rightIndex++
    ) {
      const left = tokens[leftIndex];
      const right = tokens[rightIndex];
      const budgetDiagnostic = overlapBudget.consume(right.span);
      if (budgetDiagnostic) {
        return {
          diagnostics: [...diagnostics, budgetDiagnostic],
          pairsCompared: overlapBudget.pairsCompared(),
        };
      }
      const leftDfa = dfaByTokenId.get(left.id);
      const rightDfa = dfaByTokenId.get(right.id);
      if (!leftDfa || !rightDfa) continue;
      let witness: string | null;
      try {
        witness = dfaOverlapWitness(leftDfa, rightDfa, limits);
      } catch (error) {
        const diagnostic = regexLimitDiagnostic(error, config, right.span);
        if (diagnostic) {
          diagnostics.push(diagnostic);
          continue;
        }
        throw error;
      }
      if (!witness) continue;
      if (left.kind === "contextual" || right.kind === "contextual") {
        continue;
      }
      const selected = selectNamedToken(left, right);
      const shadowed = selected === left ? right : left;
      const skipOnly = left.kind === "skip" && right.kind === "skip";
      const mainTokenOnly = left.kind !== "skip" && right.kind !== "skip";
      const tokenContext = mainTokenOnly
        ? tokenOverlapContext(left, right, bnf, lr)
        : { distinguishable: false };
      if (left.priority !== right.priority) {
        if (skipOnly) {
          diagnostics.push(targetDiagnostic(
            config,
            "LEXER_TOKEN_OVERLAP",
            "warning",
            `${tokenLabel(left)} and ${tokenLabel(right)} can both match ${
              JSON.stringify(witness)
            }. Priority ${selected.priority} selects ${
              tokenLabel(selected)
            } before ${tokenLabel(shadowed)} for this trivia input.`,
            { span: shadowed.span, related: overlapRelated(left, right) },
          ));
          continue;
        }
        if (selected.kind === "skip") {
          diagnostics.push(targetDiagnostic(
            config,
            "LEXER_TOKEN_OVERLAP",
            "error",
            `${tokenLabel(left)} and ${tokenLabel(right)} can both match ${
              JSON.stringify(witness)
            }. Priority ${selected.priority} selects ${
              tokenLabel(selected)
            } before ${tokenLabel(shadowed)}, so ${
              tokenLabel(shadowed)
            } cannot reach the parser for this input.`,
            { span: selected.span, related: overlapRelated(left, right) },
          ));
          continue;
        }
        if (shadowed.kind === "skip") {
          diagnostics.push(targetDiagnostic(
            config,
            "LEXER_TOKEN_OVERLAP",
            "warning",
            `${tokenLabel(left)} and ${tokenLabel(right)} can both match ${
              JSON.stringify(witness)
            }. Priority ${selected.priority} selects ${
              tokenLabel(selected)
            } before ${
              tokenLabel(shadowed)
            }; the parser token remains reachable, but this input is not trivia for portable targets.`,
            { span: shadowed.span, related: overlapRelated(left, right) },
          ));
          continue;
        }
        diagnostics.push(targetDiagnostic(
          config,
          "LEXER_TOKEN_OVERLAP",
          "warning",
          `${tokenLabel(left)} and ${tokenLabel(right)} can both match ${
            JSON.stringify(witness)
          }. Priority ${selected.priority} selects ${
            tokenLabel(selected)
          } before ${tokenLabel(shadowed)} with standalone lex(). ${
            tokenContext.distinguishable
              ? `Contextual parse() can still select ${
                tokenLabel(shadowed)
              } when the LR parser state expects it separately.`
              : "The LR table has no state pair that expects these tokens separately; the explicit priority is the only portable distinction for this witness."
          }`,
          { span: shadowed.span, related: overlapRelated(left, right) },
        ));
        continue;
      }
      let severity: "error" | "warning";
      if (
        skipOnly || (mainTokenOnly && tokenContext.distinguishable)
      ) {
        severity = "warning";
      } else {
        severity = "error";
      }
      diagnostics.push(targetDiagnostic(
        config,
        "LEXER_TOKEN_OVERLAP",
        severity,
        `${tokenLabel(left)} and ${tokenLabel(right)} can both match ${
          JSON.stringify(witness)
        }. The standalone lexer would select ${tokenLabel(selected)} before ${
          tokenLabel(shadowed)
        } for this input by declaration order${
          mainTokenOnly && tokenContext.distinguishable
            ? "; contextual parse() may choose another main token when the parser state expects it separately"
            : mainTokenOnly
            ? ". The LR table has no state pair that expects these tokens separately, so contextual parse() cannot distinguish them. Add an explicit priority if one token should win, merge the tokens, or change the grammar so each token is expected in a distinct parser context"
            : ""
        }.`,
        { span: right.span, related: overlapRelated(left, right) },
      ));
    }
  }
  return { diagnostics, pairsCompared: overlapBudget.pairsCompared() };
}

interface ShadowingCandidate {
  readonly label: string;
  readonly dfa: Dfa;
  readonly terminalId: number | null;
  readonly span: NonNullable<Diagnostic["span"]>;
}

function runtimeShadowedTokenDiagnostics(
  analyzed: AnalyzedGrammar,
  dfaByTokenId: ReadonlyMap<number, Dfa>,
  limits: RegexCompilerLimits,
  config: RuntimeParserTargetConfig,
  bnf: BnfGrammar,
  lr: LrTable,
): { diagnostics: Diagnostic[]; analyses: number } {
  const diagnostics: Diagnostic[] = [];
  let analyses = 0;
  const literalDfas = buildReachableLiteralDfas(analyzed, limits, config);
  diagnostics.push(...literalDfas.diagnostics);
  for (const token of analyzed.tokens) {
    if (
      token.kind === "skip" || token.kind === "contextual" ||
      !analyzed.reachableTokens.has(token.id)
    ) {
      continue;
    }
    const tokenDfa = dfaByTokenId.get(token.id);
    if (!tokenDfa) continue;
    const tokenTerminal = terminalIdForToken(bnf, token.id);
    const candidates = coveringCandidatesForToken(
      analyzed,
      dfaByTokenId,
      literalDfas.dfaByLiteralId,
      bnf,
      token,
    );
    if (candidates.length === 0) continue;
    let uncovered: string | null;
    try {
      analyses++;
      uncovered = dfaUncoveredWitness(
        tokenDfa,
        candidates.map((candidate) => candidate.dfa),
        limits,
      );
    } catch (error) {
      const diagnostic = regexLimitDiagnostic(error, config, token.span);
      if (diagnostic) {
        diagnostics.push(diagnostic);
        continue;
      }
      throw error;
    }
    if (uncovered !== null) continue;
    const contextual = tokenTerminal !== null &&
      candidates.some((candidate) =>
        candidate.terminalId !== null &&
        terminalsAreContextuallyDistinguishable(
          tokenTerminal,
          candidate.terminalId,
          lr,
        )
      );
    diagnostics.push(targetDiagnostic(
      config,
      "SHADOWED_TOKEN_LANGUAGE",
      "warning",
      `${
        tokenLabel(token)
      } is completely shadowed by higher-precedence lexer candidates under standalone lex() and cannot be emitted globally.${
        contextual
          ? " Contextual parse() can still recover it in parser states that expect the shadowed token separately."
          : " No parser context can recover it from the covering candidates."
      }`,
      {
        span: token.span,
        related: candidates.slice(0, 5).map((candidate) => ({
          message: `Covering candidate: ${candidate.label}`,
          span: candidate.span,
        })),
      },
    ));
  }
  return { diagnostics, analyses };
}

function buildReachableLiteralDfas(
  analyzed: AnalyzedGrammar,
  limits: RegexCompilerLimits,
  config: RuntimeParserTargetConfig,
): {
  diagnostics: readonly Diagnostic[];
  dfaByLiteralId: ReadonlyMap<number, Dfa>;
} {
  const diagnostics: Diagnostic[] = [];
  const dfaByLiteralId = new Map<number, Dfa>();
  for (const literal of analyzed.literals) {
    if (!analyzed.reachableLiterals.has(literal.id)) continue;
    try {
      dfaByLiteralId.set(
        literal.id,
        regexDfa(literalAst(literal.value), limits),
      );
    } catch (error) {
      const diagnostic = regexLimitDiagnostic(error, config, literal.span);
      if (diagnostic) {
        diagnostics.push(diagnostic);
        continue;
      }
      throw error;
    }
  }
  return { diagnostics, dfaByLiteralId };
}

function coveringCandidatesForToken(
  analyzed: AnalyzedGrammar,
  dfaByTokenId: ReadonlyMap<number, Dfa>,
  dfaByLiteralId: ReadonlyMap<number, Dfa>,
  bnf: BnfGrammar,
  token: AnalyzedGrammar["tokens"][number],
): ShadowingCandidate[] {
  const candidates: ShadowingCandidate[] = [];
  for (const other of analyzed.tokens) {
    if (other.id === token.id) continue;
    if (
      other.kind !== "skip" &&
      !analyzed.reachableTokens.has(other.id)
    ) {
      continue;
    }
    if (compareNamedTokenToToken(other, token) >= 0) continue;
    const dfa = dfaByTokenId.get(other.id);
    if (!dfa) continue;
    candidates.push({
      label: tokenLabel(other),
      dfa,
      terminalId: other.kind !== "skip"
        ? terminalIdForToken(bnf, other.id)
        : null,
      span: other.span,
    });
  }
  for (const literal of analyzed.literals) {
    if (!analyzed.reachableLiterals.has(literal.id)) continue;
    if (compareLiteralToToken(literal, token) >= 0) continue;
    const dfa = dfaByLiteralId.get(literal.id);
    if (!dfa) continue;
    candidates.push({
      label: `literal ${JSON.stringify(literal.value)}`,
      dfa,
      terminalId: terminalIdForLiteral(bnf, literal.id),
      span: literal.span,
    });
  }
  return candidates;
}

function runtimeUnusedSkipDiagnostics(
  analyzed: AnalyzedGrammar,
  dfaByTokenId: ReadonlyMap<number, Dfa>,
  limits: RegexCompilerLimits,
  config: RuntimeParserTargetConfig,
  bnf: BnfGrammar,
): { diagnostics: Diagnostic[]; analyses: number } {
  const diagnostics: Diagnostic[] = [];
  let analyses = 0;
  const literalDfas = buildReachableLiteralDfas(analyzed, limits, config);
  diagnostics.push(...literalDfas.diagnostics);
  for (const skip of analyzed.tokens) {
    if (skip.kind !== "skip") continue;
    const skipDfa = dfaByTokenId.get(skip.id);
    if (!skipDfa) continue;
    const candidates = coveringCandidatesForToken(
      analyzed,
      dfaByTokenId,
      literalDfas.dfaByLiteralId,
      bnf,
      skip,
    );
    if (candidates.length === 0) continue;
    let uncovered: string | null;
    try {
      analyses++;
      uncovered = dfaUncoveredWitness(
        skipDfa,
        candidates.map((candidate) => candidate.dfa),
        limits,
      );
    } catch (error) {
      const diagnostic = regexLimitDiagnostic(error, config, skip.span);
      if (diagnostic) {
        diagnostics.push(diagnostic);
        continue;
      }
      throw error;
    }
    if (uncovered !== null) continue;
    diagnostics.push(targetDiagnostic(
      config,
      "UNUSED_SKIP_DECLARATION",
      "warning",
      `${
        tokenLabel(skip)
      } is completely shadowed by higher-precedence lexer candidates and is never emitted as portable trivia.`,
      {
        span: skip.span,
        related: candidates.slice(0, 5).map((candidate) => ({
          message: `Covering candidate: ${candidate.label}`,
          span: candidate.span,
        })),
      },
    ));
  }
  return { diagnostics, analyses };
}

function tokenOverlapContext(
  left: AnalyzedGrammar["tokens"][number],
  right: AnalyzedGrammar["tokens"][number],
  bnf: BnfGrammar,
  lr: LrTable,
): { readonly distinguishable: boolean } {
  const leftTerminal = terminalIdForToken(bnf, left.id);
  const rightTerminal = terminalIdForToken(bnf, right.id);
  if (leftTerminal === null || rightTerminal === null) {
    return { distinguishable: false };
  }
  return {
    distinguishable: terminalsAreContextuallyDistinguishable(
      leftTerminal,
      rightTerminal,
      lr,
    ),
  };
}

function terminalsAreContextuallyDistinguishable(
  leftTerminal: number,
  rightTerminal: number,
  lr: LrTable,
): boolean {
  let leftOnly = false;
  let rightOnly = false;
  for (const row of lr.actions.values()) {
    const hasLeft = row.has(leftTerminal);
    const hasRight = row.has(rightTerminal);
    leftOnly ||= hasLeft && !hasRight;
    rightOnly ||= hasRight && !hasLeft;
    if (leftOnly && rightOnly) return true;
  }
  return false;
}

function terminalIdForToken(bnf: BnfGrammar, tokenId: number): number | null {
  return bnf.terminals.find((terminal) => terminal.tokenId === tokenId)?.id ??
    null;
}

function terminalIdForLiteral(
  bnf: BnfGrammar,
  literalId: number,
): number | null {
  return bnf.terminals.find((terminal) => terminal.literalId === literalId)
    ?.id ?? null;
}

function runtimeLiteralDiagnostics(
  analyzed: AnalyzedGrammar,
  config: RuntimeParserTargetConfig,
): Diagnostic[] {
  return analyzed.literals
    .filter((literal) =>
      analyzed.reachableLiterals.has(literal.id) && literal.value.length === 0
    )
    .map((literal): Diagnostic =>
      targetDiagnostic(
        config,
        "LEXER_GENERATION_ERROR",
        "error",
        `The ${config.label} target cannot generate a zero-length literal token.`,
        { span: literal.span },
      )
    );
}

function runtimeLiteralOverlapDiagnostics(
  analyzed: AnalyzedGrammar,
  dfaByTokenId: ReadonlyMap<number, Dfa>,
  limits: RegexCompilerLimits,
  options: RuntimeParserPlanningOptions,
  config: RuntimeParserTargetConfig,
): { diagnostics: Diagnostic[]; pairsCompared: number } {
  const diagnostics: Diagnostic[] = [];
  const tokens = analyzed.tokens.filter((token) =>
    token.kind === "skip" ||
    (token.kind === "token" && token.priority > 0 &&
      analyzed.reachableTokens.has(token.id))
  );
  const literals = analyzed.literals.filter((literal) =>
    analyzed.reachableLiterals.has(literal.id)
  );
  const dfaByLiteralId = new Map<number, Dfa>();
  for (const literal of literals) {
    try {
      dfaByLiteralId.set(
        literal.id,
        regexDfa(literalAst(literal.value), limits),
      );
    } catch (error) {
      const diagnostic = regexLimitDiagnostic(error, config, literal.span);
      if (diagnostic) {
        diagnostics.push(diagnostic);
        continue;
      }
      throw error;
    }
  }
  const overlapBudget = createOverlapPairBudget(options, config);
  for (const token of tokens) {
    const tokenDfa = dfaByTokenId.get(token.id);
    if (!tokenDfa) continue;
    for (const literal of literals) {
      const literalDfa = dfaByLiteralId.get(literal.id);
      if (!literalDfa) continue;
      const budgetDiagnostic = overlapBudget.consume(literal.span);
      if (budgetDiagnostic) {
        return {
          diagnostics: [...diagnostics, budgetDiagnostic],
          pairsCompared: overlapBudget.pairsCompared(),
        };
      }
      let witness: string | null;
      try {
        witness = dfaOverlapWitness(tokenDfa, literalDfa, limits);
      } catch (error) {
        const diagnostic = regexLimitDiagnostic(error, config, token.span);
        if (diagnostic) {
          diagnostics.push(diagnostic);
          continue;
        }
        throw error;
      }
      if (!witness) continue;
      if (token.kind === "skip") {
        diagnostics.push(targetDiagnostic(
          config,
          "LEXER_TOKEN_OVERLAP",
          "error",
          `${tokenLabel(token)} and literal ${
            JSON.stringify(literal.value)
          } can both match ${
            JSON.stringify(witness)
          }. Trivia cannot overlap a reachable literal because that literal may be skipped before the parser can consume it.`,
          {
            span: token.span,
            related: tokenLiteralOverlapRelated(token, literal),
          },
        ));
        continue;
      }
      diagnostics.push(targetDiagnostic(
        config,
        "LEXER_TOKEN_OVERLAP",
        "error",
        `${tokenLabel(token)} and literal ${
          JSON.stringify(literal.value)
        } can both match ${
          JSON.stringify(witness)
        }. Priority ${token.priority} would select ${
          tokenLabel(token)
        } before the literal, making the literal unavailable for this input.`,
        {
          span: token.span,
          related: tokenLiteralOverlapRelated(token, literal),
        },
      ));
    }
  }
  return { diagnostics, pairsCompared: overlapBudget.pairsCompared() };
}

function runtimeLexerDfaDiagnostics(
  analyzed: AnalyzedGrammar,
  astByTokenId: ReadonlyMap<number, RegexAst>,
  options: RuntimeParserPlanningOptions,
  limits: RegexCompilerLimits,
  config: RuntimeParserTargetConfig,
): RuntimeDfaAnalysis {
  const limit = options.lexerStateLimit ?? DEFAULT_LEXER_STATE_LIMIT;
  let dfa: Dfa;
  try {
    dfa = buildLexerDfa(runtimeLexerSpecs(analyzed, astByTokenId), limits);
  } catch (error) {
    const diagnostic = regexLimitDiagnostic(error, config);
    if (diagnostic) {
      return {
        diagnostics: [diagnostic],
        stats: {
          combinedLexerDfaStates: 0,
          combinedLexerDfaTransitions: 0,
        },
      };
    }
    throw error;
  }
  const stats = {
    combinedLexerDfaStates: dfa.states.length,
    combinedLexerDfaTransitions: countDfaTransitions(dfa),
  };
  if (dfa.states.length <= limit) return { diagnostics: [], dfa, stats };
  return {
    diagnostics: [targetDiagnostic(
      config,
      "LEXER_STATE_LIMIT",
      "error",
      `The ${config.label} lexer generated ${dfa.states.length} DFA states, exceeding the configured limit (${limit}).`,
    )],
    stats,
  };
}

const RUNTIME_LIMIT_OPTION_VALIDATIONS: ReadonlyArray<{
  readonly name: string;
  readonly codeSuffix: string;
  readonly value: (options: RuntimeParserPlanningOptions) => number | undefined;
}> = [
  {
    name: "lexerStateLimit",
    codeSuffix: "LEXER_STATE_LIMIT",
    value: (options) => options.lexerStateLimit,
  },
  {
    name: "regexSourceLengthLimit",
    codeSuffix: "REGEX_SOURCE_LIMIT",
    value: (options) => options.regexSourceLengthLimit,
  },
  {
    name: "regexNestingLimit",
    codeSuffix: "REGEX_NESTING_LIMIT",
    value: (options) => options.regexNestingLimit,
  },
  {
    name: "regexAstNodeLimit",
    codeSuffix: "REGEX_AST_NODE_LIMIT",
    value: (options) => options.regexAstNodeLimit,
  },
  {
    name: "regexBoundedRepeatLimit",
    codeSuffix: "REGEX_REPEAT_EXPANSION_LIMIT",
    value: (options) => options.regexBoundedRepeatLimit,
  },
  {
    name: "regexNfaStateLimit",
    codeSuffix: "REGEX_NFA_STATE_LIMIT",
    value: (options) => options.regexNfaStateLimit,
  },
  {
    name: "regexDfaStateLimit",
    codeSuffix: "REGEX_DFA_STATE_LIMIT",
    value: (options) => options.regexDfaStateLimit,
  },
  {
    name: "regexOverlapStateLimit",
    codeSuffix: "REGEX_OVERLAP_WORK_LIMIT",
    value: (options) => options.regexOverlapStateLimit,
  },
  {
    name: "regexOverlapPairLimit",
    codeSuffix: "REGEX_OVERLAP_WORK_LIMIT",
    value: (options) => options.regexOverlapPairLimit,
  },
  {
    name: "grammarExpressionDepthLimit",
    codeSuffix: "GRAMMAR_EXPRESSION_DEPTH_LIMIT",
    value: (options) => options.grammarExpressionDepthLimit,
  },
  {
    name: "lrClosureWorkLimit",
    codeSuffix: "LR_CLOSURE_WORK_LIMIT",
    value: (options) => options.lrClosureWorkLimit,
  },
  {
    name: "parserStateLimit",
    codeSuffix: "PARSER_STATE_LIMIT",
    value: (options) => options.parserStateLimit,
  },
  {
    name: "parserItemLimit",
    codeSuffix: "PARSER_ITEM_LIMIT",
    value: (options) => options.parserItemLimit,
  },
  {
    name: "parserTableEntryLimit",
    codeSuffix: "PARSER_TABLE_ENTRY_LIMIT",
    value: (options) => options.parserTableEntryLimit,
  },
  {
    name: "diagnosticLimit",
    codeSuffix: "DIAGNOSTIC_LIMIT_REACHED",
    value: (options) => options.diagnosticLimit,
  },
];

function runtimeOptionsDiagnostics(
  options: RuntimeParserPlanningOptions,
  config: RuntimeParserTargetConfig,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const validation of RUNTIME_LIMIT_OPTION_VALIDATIONS) {
    validatePositiveIntegerOption(
      diagnostics,
      validation.value(options),
      validation.name,
      `${config.codePrefix}_${validation.codeSuffix}`,
      config,
    );
  }
  return diagnostics;
}

function createOverlapPairBudget(
  options: RuntimeParserPlanningOptions,
  config: RuntimeParserTargetConfig,
): {
  consume: (span?: Diagnostic["span"]) => Diagnostic | null;
  pairsCompared: () => number;
} {
  const limit = options.regexOverlapPairLimit;
  let pairs = 0;
  return {
    consume(span?: Diagnostic["span"]): Diagnostic | null {
      if (limit === undefined) {
        pairs++;
        return null;
      }
      if (pairs >= limit) {
        return targetDiagnostic(
          config,
          "REGEX_OVERLAP_WORK_LIMIT",
          "error",
          `${config.label} overlap analysis compared ${pairs} token/literal pairs, reaching regexOverlapPairLimit (${limit}).`,
          { span },
        );
      }
      pairs++;
      return null;
    },
    pairsCompared() {
      return pairs;
    },
  };
}

function capDiagnostics(
  diagnostics: readonly Diagnostic[],
  options: RuntimeParserPlanningOptions,
  config: RuntimeParserTargetConfig,
): readonly Diagnostic[] {
  const limit = options.diagnosticLimit;
  if (
    limit === undefined || !Number.isInteger(limit) || limit < 1 ||
    diagnostics.length <= limit
  ) return diagnostics;
  const suppressed = diagnostics.length - limit;
  return [
    ...diagnostics.slice(0, limit),
    targetDiagnostic(
      config,
      "DIAGNOSTIC_LIMIT_REACHED",
      "warning",
      `The ${config.label} target suppressed ${suppressed} additional diagnostic${
        suppressed === 1 ? "" : "s"
      } after reaching diagnosticLimit (${limit}).`,
    ),
  ];
}

function diagnosticSuppressedCount(
  diagnostics: readonly Diagnostic[],
  options: RuntimeParserPlanningOptions,
): number {
  const limit = options.diagnosticLimit;
  if (
    limit === undefined || !Number.isInteger(limit) || limit < 1 ||
    diagnostics.length <= limit
  ) return 0;
  return diagnostics.length - limit;
}

function targetDiagnostic(
  config: RuntimeParserTargetConfig,
  codeSuffix: string,
  severity: "error" | "warning",
  message: string,
  details: {
    readonly span?: Diagnostic["span"];
    readonly path?: string;
    readonly related?: Diagnostic["related"];
  } = {},
): Diagnostic {
  const diagnostic: Diagnostic = {
    code: `${config.codePrefix}_${codeSuffix}`,
    severity,
    backend: config.backend,
    message,
  };
  if (details.span !== undefined) diagnostic.span = details.span;
  if (details.path !== undefined) diagnostic.path = details.path;
  if (details.related !== undefined) diagnostic.related = details.related;
  return diagnostic;
}

function validatePositiveIntegerOption(
  diagnostics: Diagnostic[],
  value: number | undefined,
  name: string,
  code: string,
  config: RuntimeParserTargetConfig,
): void {
  if (
    value !== undefined &&
    (!Number.isInteger(value) || value < 1)
  ) {
    diagnostics.push({
      code,
      severity: "error",
      backend: config.backend,
      message: `${name} must be a positive integer.`,
    });
  }
}

function runtimeRegexLimits(
  options: RuntimeParserPlanningOptions,
): RegexCompilerLimits {
  return {
    sourceLengthLimit: options.regexSourceLengthLimit,
    nestingLimit: options.regexNestingLimit ?? DEFAULT_REGEX_NESTING_LIMIT,
    astNodeLimit: options.regexAstNodeLimit ?? DEFAULT_REGEX_AST_NODE_LIMIT,
    boundedRepeatLimit: options.regexBoundedRepeatLimit ??
      DEFAULT_REGEX_BOUNDED_REPEAT_LIMIT,
    nfaStateLimit: options.regexNfaStateLimit ?? DEFAULT_REGEX_NFA_STATE_LIMIT,
    dfaStateLimit: options.regexDfaStateLimit ?? DEFAULT_REGEX_DFA_STATE_LIMIT,
    overlapProductStateLimit: options.regexOverlapStateLimit ??
      DEFAULT_REGEX_OVERLAP_STATE_LIMIT,
  };
}

function regexLimitDiagnostic(
  error: unknown,
  config: RuntimeParserTargetConfig,
  span?: Diagnostic["span"],
): Diagnostic | null {
  if (!(error instanceof RegexResourceLimitError)) return null;
  return {
    code: `${config.codePrefix}_${error.code}`,
    severity: "error",
    backend: config.backend,
    message:
      `${config.label} regex planning exceeded a resource limit: ${error.message}`,
    span,
  };
}

function countDfaTransitions(dfa: Dfa): number {
  let count = 0;
  for (const state of dfa.states) count += state.transitions.length;
  return count;
}

function literalAst(value: string): RegexAst {
  const items: RegexAst[] = [];
  for (let index = 0; index < value.length;) {
    const codePoint = value.codePointAt(index)!;
    items.push({ kind: "literal", codePoint });
    index += codePoint > 0xffff ? 2 : 1;
  }
  if (items.length === 0) return { kind: "empty" };
  return items.length === 1 ? items[0] : { kind: "sequence", items };
}

function tokenLabel(token: AnalyzedGrammar["tokens"][number]): string {
  return `${token.kind} ${token.name}`;
}

function overlapRelated(
  left: AnalyzedGrammar["tokens"][number],
  right: AnalyzedGrammar["tokens"][number],
): NonNullable<Diagnostic["related"]> {
  return [
    { message: `Left declaration: ${tokenLabel(left)}`, span: left.span },
    { message: `Right declaration: ${tokenLabel(right)}`, span: right.span },
  ];
}

function tokenLiteralOverlapRelated(
  token: AnalyzedGrammar["tokens"][number],
  literal: AnalyzedGrammar["literals"][number],
): NonNullable<Diagnostic["related"]> {
  return [
    { message: `Token declaration: ${tokenLabel(token)}`, span: token.span },
    {
      message: `Literal occurrence: ${JSON.stringify(literal.value)}`,
      span: literal.span,
    },
  ];
}

function selectNamedToken(
  left: AnalyzedGrammar["tokens"][number],
  right: AnalyzedGrammar["tokens"][number],
): AnalyzedGrammar["tokens"][number] {
  if (left.kind === "contextual" && right.kind !== "contextual") {
    return right;
  }
  if (right.kind === "contextual" && left.kind !== "contextual") {
    return left;
  }
  if (left.priority !== right.priority) {
    if (left.priority > right.priority) {
      return left;
    }
    return right;
  }
  if (left.declarationOrder < right.declarationOrder) {
    return left;
  }
  return right;
}

function compareNamedTokenToToken(
  candidate: AnalyzedGrammar["tokens"][number],
  token: AnalyzedGrammar["tokens"][number],
): number {
  let contextualOrder = 0;
  if (candidate.kind !== token.kind) {
    if (candidate.kind === "contextual") {
      contextualOrder = 1;
    } else if (token.kind === "contextual") {
      contextualOrder = -1;
    }
  }
  return contextualOrder ||
    token.priority - candidate.priority ||
    candidate.declarationOrder - token.declarationOrder;
}

function compareLiteralToToken(
  _literal: AnalyzedGrammar["literals"][number],
  token: AnalyzedGrammar["tokens"][number],
): number {
  return token.priority || -1;
}

function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) =>
    (diagnostic.severity ?? "error") === "error"
  );
}
