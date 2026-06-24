import type { BabaMetadata, Diagnostic, PortabilityMode } from "../../ast.ts";
import type { AnalyzedGrammar } from "../../compiler/ir.ts";
import type { RegexAst } from "../../compiler/regex/ast.ts";
import type { Dfa } from "../../compiler/regex/dfa.ts";
import {
  enforceRegexAstNodeLimit,
  type RegexCompilerLimits,
  RegexResourceLimitError,
} from "../../compiler/regex/limits.ts";
import {
  buildLexerDfa,
  type LexerRegexSpec,
} from "../../compiler/regex/lexer.ts";
import { dfaOverlapWitness, regexDfa } from "../../compiler/regex/overlap.ts";
import { type BnfGrammar, lowerToBnf } from "../typescript/bnf.ts";
import { buildCanonicalLr1Table, type LrTable } from "../typescript/lr1.ts";
import {
  createPortableParserPlanV1,
  type PortableParserPlanMetadata,
  portableParserPlanMetadata,
  type PortableParserPlanV1,
} from "./portable_plan.ts";

export interface RuntimeParserPlan {
  analyzed: AnalyzedGrammar;
  bnf: BnfGrammar;
  lr: LrTable;
  dfa: Dfa;
  portable: PortableParserPlanV1;
  portableMetadata: PortableParserPlanMetadata;
  diagnostics: readonly Diagnostic[];
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
  parserStateLimit?: number;
  parserItemLimit?: number;
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
}

interface RuntimeDfaAnalysis {
  diagnostics: readonly Diagnostic[];
  dfa?: Dfa;
}

export function planPortableRuntime(
  analyzed: AnalyzedGrammar,
  options: RuntimeParserPlanningOptions = {},
  metadata: BabaMetadata = {},
  portability: PortabilityMode = "warn",
): RuntimeParserPlan | { diagnostics: readonly Diagnostic[] } {
  portableRuntimePlanInvocationCountForTesting++;
  return planRuntimeParserTarget(
    analyzed,
    options,
    metadata,
    portability,
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
  portability: PortabilityMode = "warn",
  config: RuntimeParserTargetConfig,
): RuntimeParserPlan | { diagnostics: readonly Diagnostic[] } {
  const optionDiagnostics = runtimeOptionsDiagnostics(options, config);
  if (hasErrors(optionDiagnostics)) {
    return { diagnostics: capDiagnostics(optionDiagnostics, options, config) };
  }
  const regexLimits = runtimeRegexLimits(options);
  const regexAnalysis = analyzeRuntimeRegexes(analyzed, regexLimits, config);
  const diagnostics: Diagnostic[] = [
    ...optionDiagnostics,
    ...regexAnalysis.diagnostics,
    ...runtimeCapabilityDiagnostics(analyzed, metadata, portability, config),
    ...runtimeLiteralDiagnostics(analyzed, config),
    ...runtimeLiteralOverlapDiagnostics(
      analyzed,
      regexAnalysis.dfaByTokenId,
      regexLimits,
      options,
      config,
    ),
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
    tableEntryLimit: options.parserTableEntryLimit,
    conflictGroups: metadata.parser?.conflicts,
    conflictResolutions: metadata.parser?.resolutions,
  });
  diagnostics.push(
    ...lr.diagnostics.map((diagnostic) =>
      retargetRuntimeDiagnostic(diagnostic, config)
    ),
  );
  diagnostics.push(
    ...runtimeTokenOverlapDiagnostics(
      analyzed,
      regexAnalysis.dfaByTokenId,
      regexLimits,
      options,
      config,
      bnf,
      lr,
    ),
  );
  if (hasErrors(diagnostics)) {
    return { diagnostics: capDiagnostics(diagnostics, options, config) };
  }

  const portable = createPortableParserPlanV1(
    analyzed,
    bnf,
    lr,
    dfaAnalysis.dfa,
  );

  return {
    analyzed,
    bnf,
    lr,
    dfa: dfaAnalysis.dfa,
    portable,
    portableMetadata: portableParserPlanMetadata(portable),
    diagnostics: capDiagnostics(diagnostics, options, config),
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
      !(token.kind === "token" && analyzed.reachableTokens.has(token.id))
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
    });
  }
  for (const literal of analyzed.literals) {
    if (!analyzed.reachableLiterals.has(literal.id)) continue;
    specs.push({
      ast: literalAst(literal.value),
      type: "literal",
      priority: 0,
      order: literal.sourceOrder,
    });
  }
  return specs;
}

function runtimeCapabilityDiagnostics(
  analyzed: AnalyzedGrammar,
  metadata: BabaMetadata,
  portability: PortabilityMode,
  config: RuntimeParserTargetConfig,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const external of analyzed.reachableExternals) {
    diagnostics.push({
      code: `${config.codePrefix}_EXTERNAL_TOKENS_UNSUPPORTED`,
      severity: "error",
      backend: config.backend,
      message:
        `The ${config.label} target cannot generate scanner behavior for external token '${external}'. Generate only Tree-sitter output or replace the external token with an explicit portable token.`,
    });
  }

  for (const [ruleName, ruleMeta] of Object.entries(metadata.rules ?? {})) {
    if (ruleMeta.token?.kind === "token.immediate") {
      diagnostics.push({
        code: `${config.codePrefix}_TOKEN_IMMEDIATE_UNSUPPORTED`,
        severity: "error",
        backend: config.backend,
        message:
          `The ${config.label} target does not support token.immediate metadata on rule '${ruleName}' because it may alter accepted whitespace.`,
      });
    }
    if (
      portability !== "off" &&
      (ruleMeta.paths || ruleMeta.wrap || ruleMeta.fields)
    ) {
      diagnostics.push({
        code: "PORTABILITY_TREE_SHAPE_DIFFERS",
        severity: "warning",
        backend: config.backend,
        message:
          `Tree-sitter shaping metadata on rule '${ruleName}' is ignored by the ${config.label} CST target.`,
      });
    }
  }

  const skipNames = new Set(
    analyzed.tokens.filter((token) => token.kind === "skip").map((token) =>
      token.name
    ),
  );
  for (const extra of metadata.extras ?? []) {
    if (extra.kind !== "rule" || !skipNames.has(extra.name)) {
      if (portability === "off") continue;
      diagnostics.push({
        code: "PORTABILITY_TREE_SITTER_EXTRA",
        severity: portability === "strict" ? "error" : "warning",
        backend: config.backend,
        message:
          `Tree-sitter extras that are not EBNF skip declarations are ignored by the ${config.label} target.`,
      });
    }
  }

  return diagnostics;
}

function analyzeRuntimeRegexes(
  analyzed: AnalyzedGrammar,
  limits: RegexCompilerLimits,
  config: RuntimeParserTargetConfig,
): RuntimeRegexAnalysis {
  const diagnostics: Diagnostic[] = [];
  const astByTokenId = new Map<number, RegexAst>();
  const dfaByTokenId = new Map<number, Dfa>();
  for (const token of analyzed.tokens) {
    if (token.kind === "token" && !analyzed.reachableTokens.has(token.id)) {
      continue;
    }
    astByTokenId.set(token.id, token.pattern);
    try {
      enforceRegexAstNodeLimit(token.pattern, limits);
      dfaByTokenId.set(token.id, regexDfa(token.pattern, limits));
    } catch (error) {
      const diagnostic = regexLimitDiagnostic(error, config, token.span);
      if (diagnostic) {
        diagnostics.push(diagnostic);
        continue;
      }
      throw error;
    }
  }
  return { diagnostics, astByTokenId, dfaByTokenId };
}

function runtimeTokenOverlapDiagnostics(
  analyzed: AnalyzedGrammar,
  dfaByTokenId: ReadonlyMap<number, Dfa>,
  limits: RegexCompilerLimits,
  options: RuntimeParserPlanningOptions,
  config: RuntimeParserTargetConfig,
  bnf: BnfGrammar,
  lr: LrTable,
): Diagnostic[] {
  const tokens = analyzed.tokens.filter((token) =>
    token.kind === "skip" ||
    (token.kind === "token" && analyzed.reachableTokens.has(token.id))
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
      if (budgetDiagnostic) return [...diagnostics, budgetDiagnostic];
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
      const selected = selectNamedToken(left, right);
      const shadowed = selected === left ? right : left;
      const skipOnly = left.kind === "skip" && right.kind === "skip";
      const mainTokenOnly = left.kind === "token" && right.kind === "token";
      const tokenContext = mainTokenOnly
        ? tokenOverlapContext(left, right, bnf, lr)
        : { distinguishable: false };
      if (left.priority !== right.priority) {
        if (skipOnly) {
          diagnostics.push({
            code: `${config.codePrefix}_LEXER_TOKEN_OVERLAP`,
            severity: "warning",
            backend: config.backend,
            message: `${tokenLabel(left)} and ${
              tokenLabel(right)
            } can both match ${
              JSON.stringify(witness)
            }. Priority ${selected.priority} selects ${
              tokenLabel(selected)
            } before ${tokenLabel(shadowed)} for this trivia input.`,
            span: shadowed.span,
            related: overlapRelated(left, right),
          });
          continue;
        }
        if (selected.kind === "skip") {
          diagnostics.push({
            code: `${config.codePrefix}_LEXER_TOKEN_OVERLAP`,
            severity: "error",
            backend: config.backend,
            message: `${tokenLabel(left)} and ${
              tokenLabel(right)
            } can both match ${
              JSON.stringify(witness)
            }. Priority ${selected.priority} selects ${
              tokenLabel(selected)
            } before ${tokenLabel(shadowed)}, so ${
              tokenLabel(shadowed)
            } cannot reach the parser for this input.`,
            span: selected.span,
            related: overlapRelated(left, right),
          });
          continue;
        }
        if (shadowed.kind === "skip") {
          diagnostics.push({
            code: `${config.codePrefix}_LEXER_TOKEN_OVERLAP`,
            severity: "warning",
            backend: config.backend,
            message: `${tokenLabel(left)} and ${
              tokenLabel(right)
            } can both match ${
              JSON.stringify(witness)
            }. Priority ${selected.priority} selects ${
              tokenLabel(selected)
            } before ${
              tokenLabel(shadowed)
            }; the parser token remains reachable, but this input is not trivia for portable targets.`,
            span: shadowed.span,
            related: overlapRelated(left, right),
          });
          continue;
        }
        diagnostics.push({
          code: `${config.codePrefix}_LEXER_TOKEN_OVERLAP`,
          severity: "warning",
          backend: config.backend,
          message: `${tokenLabel(left)} and ${
            tokenLabel(right)
          } can both match ${
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
          span: shadowed.span,
          related: overlapRelated(left, right),
        });
        continue;
      }
      diagnostics.push({
        code: `${config.codePrefix}_LEXER_TOKEN_OVERLAP`,
        severity: skipOnly || (mainTokenOnly && tokenContext.distinguishable)
          ? "warning"
          : "error",
        backend: config.backend,
        message: `${tokenLabel(left)} and ${tokenLabel(right)} can both match ${
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
        span: right.span,
        related: overlapRelated(left, right),
      });
    }
  }
  return diagnostics;
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
  let leftOnly = false;
  let rightOnly = false;
  for (const row of lr.actions.values()) {
    const hasLeft = row.has(leftTerminal);
    const hasRight = row.has(rightTerminal);
    leftOnly ||= hasLeft && !hasRight;
    rightOnly ||= hasRight && !hasLeft;
    if (leftOnly && rightOnly) return { distinguishable: true };
  }
  return { distinguishable: false };
}

function terminalIdForToken(bnf: BnfGrammar, tokenId: number): number | null {
  return bnf.terminals.find((terminal) => terminal.tokenId === tokenId)?.id ??
    null;
}

function runtimeLiteralDiagnostics(
  analyzed: AnalyzedGrammar,
  config: RuntimeParserTargetConfig,
): Diagnostic[] {
  return analyzed.literals
    .filter((literal) =>
      analyzed.reachableLiterals.has(literal.id) && literal.value.length === 0
    )
    .map((literal): Diagnostic => ({
      code: `${config.codePrefix}_LEXER_GENERATION_ERROR`,
      severity: "error",
      backend: config.backend,
      message:
        `The ${config.label} target cannot generate a zero-length literal token.`,
      span: literal.span,
    }));
}

function runtimeLiteralOverlapDiagnostics(
  analyzed: AnalyzedGrammar,
  dfaByTokenId: ReadonlyMap<number, Dfa>,
  limits: RegexCompilerLimits,
  options: RuntimeParserPlanningOptions,
  config: RuntimeParserTargetConfig,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const tokens = analyzed.tokens.filter((token) =>
    token.kind === "skip" ||
    (token.priority > 0 &&
      (token.kind === "token" && analyzed.reachableTokens.has(token.id)))
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
      if (budgetDiagnostic) return [...diagnostics, budgetDiagnostic];
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
        diagnostics.push({
          code: `${config.codePrefix}_LEXER_TOKEN_OVERLAP`,
          severity: "error",
          backend: config.backend,
          message: `${tokenLabel(token)} and literal ${
            JSON.stringify(literal.value)
          } can both match ${
            JSON.stringify(witness)
          }. Trivia cannot overlap a reachable literal because that literal may be skipped before the parser can consume it.`,
          span: token.span,
          related: tokenLiteralOverlapRelated(token, literal),
        });
        continue;
      }
      diagnostics.push({
        code: `${config.codePrefix}_LEXER_TOKEN_OVERLAP`,
        severity: "error",
        backend: config.backend,
        message: `${tokenLabel(token)} and literal ${
          JSON.stringify(literal.value)
        } can both match ${
          JSON.stringify(witness)
        }. Priority ${token.priority} would select ${
          tokenLabel(token)
        } before the literal, making the literal unavailable for this input.`,
        span: token.span,
        related: tokenLiteralOverlapRelated(token, literal),
      });
    }
  }
  return diagnostics;
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
    if (diagnostic) return { diagnostics: [diagnostic] };
    throw error;
  }
  if (dfa.states.length <= limit) return { diagnostics: [], dfa };
  return {
    diagnostics: [{
      code: `${config.codePrefix}_LEXER_STATE_LIMIT`,
      severity: "error",
      backend: config.backend,
      message:
        `The ${config.label} lexer generated ${dfa.states.length} DFA states, exceeding the configured limit (${limit}).`,
    }],
  };
}

function runtimeOptionsDiagnostics(
  options: RuntimeParserPlanningOptions,
  config: RuntimeParserTargetConfig,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  validatePositiveIntegerOption(
    diagnostics,
    options.lexerStateLimit,
    "lexerStateLimit",
    `${config.codePrefix}_LEXER_STATE_LIMIT`,
    config,
  );
  validatePositiveIntegerOption(
    diagnostics,
    options.regexSourceLengthLimit,
    "regexSourceLengthLimit",
    `${config.codePrefix}_REGEX_SOURCE_LIMIT`,
    config,
  );
  validatePositiveIntegerOption(
    diagnostics,
    options.regexNestingLimit,
    "regexNestingLimit",
    `${config.codePrefix}_REGEX_NESTING_LIMIT`,
    config,
  );
  validatePositiveIntegerOption(
    diagnostics,
    options.regexAstNodeLimit,
    "regexAstNodeLimit",
    `${config.codePrefix}_REGEX_AST_NODE_LIMIT`,
    config,
  );
  validatePositiveIntegerOption(
    diagnostics,
    options.regexBoundedRepeatLimit,
    "regexBoundedRepeatLimit",
    `${config.codePrefix}_REGEX_REPEAT_EXPANSION_LIMIT`,
    config,
  );
  validatePositiveIntegerOption(
    diagnostics,
    options.regexNfaStateLimit,
    "regexNfaStateLimit",
    `${config.codePrefix}_REGEX_NFA_STATE_LIMIT`,
    config,
  );
  validatePositiveIntegerOption(
    diagnostics,
    options.regexDfaStateLimit,
    "regexDfaStateLimit",
    `${config.codePrefix}_REGEX_DFA_STATE_LIMIT`,
    config,
  );
  validatePositiveIntegerOption(
    diagnostics,
    options.regexOverlapStateLimit,
    "regexOverlapStateLimit",
    `${config.codePrefix}_REGEX_OVERLAP_WORK_LIMIT`,
    config,
  );
  validatePositiveIntegerOption(
    diagnostics,
    options.regexOverlapPairLimit,
    "regexOverlapPairLimit",
    `${config.codePrefix}_REGEX_OVERLAP_WORK_LIMIT`,
    config,
  );
  if (
    options.parserStateLimit !== undefined &&
    (!Number.isInteger(options.parserStateLimit) ||
      options.parserStateLimit < 1)
  ) {
    diagnostics.push({
      code: `${config.codePrefix}_PARSER_STATE_LIMIT`,
      severity: "error",
      backend: config.backend,
      message: "parserStateLimit must be a positive integer.",
    });
  }
  if (
    options.parserItemLimit !== undefined &&
    (!Number.isInteger(options.parserItemLimit) ||
      options.parserItemLimit < 1)
  ) {
    diagnostics.push({
      code: `${config.codePrefix}_PARSER_ITEM_LIMIT`,
      severity: "error",
      backend: config.backend,
      message: "parserItemLimit must be a positive integer.",
    });
  }
  if (
    options.parserTableEntryLimit !== undefined &&
    (!Number.isInteger(options.parserTableEntryLimit) ||
      options.parserTableEntryLimit < 1)
  ) {
    diagnostics.push({
      code: `${config.codePrefix}_PARSER_TABLE_ENTRY_LIMIT`,
      severity: "error",
      backend: config.backend,
      message: "parserTableEntryLimit must be a positive integer.",
    });
  }
  validatePositiveIntegerOption(
    diagnostics,
    options.diagnosticLimit,
    "diagnosticLimit",
    `${config.codePrefix}_DIAGNOSTIC_LIMIT_REACHED`,
    config,
  );
  return diagnostics;
}

function createOverlapPairBudget(
  options: RuntimeParserPlanningOptions,
  config: RuntimeParserTargetConfig,
): { consume: (span?: Diagnostic["span"]) => Diagnostic | null } {
  const limit = options.regexOverlapPairLimit;
  let pairs = 0;
  return {
    consume(span?: Diagnostic["span"]): Diagnostic | null {
      if (limit === undefined) {
        pairs++;
        return null;
      }
      if (pairs >= limit) {
        return {
          code: `${config.codePrefix}_REGEX_OVERLAP_WORK_LIMIT`,
          severity: "error",
          backend: config.backend,
          message:
            `${config.label} overlap analysis compared ${pairs} token/literal pairs, reaching regexOverlapPairLimit (${limit}).`,
          span,
        };
      }
      pairs++;
      return null;
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
    {
      code: `${config.codePrefix}_DIAGNOSTIC_LIMIT_REACHED`,
      severity: "warning",
      backend: config.backend,
      message:
        `The ${config.label} target suppressed ${suppressed} additional diagnostic${
          suppressed === 1 ? "" : "s"
        } after reaching diagnosticLimit (${limit}).`,
    },
  ];
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
    nestingLimit: options.regexNestingLimit,
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
  if (left.priority !== right.priority) {
    return left.priority > right.priority ? left : right;
  }
  return left.declarationOrder < right.declarationOrder ? left : right;
}

function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) =>
    (diagnostic.severity ?? "error") === "error"
  );
}
