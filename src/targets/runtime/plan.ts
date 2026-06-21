import type { BabaMetadata, Diagnostic, PortabilityMode } from "../../ast.ts";
import type { AnalyzedGrammar } from "../../compiler/ir.ts";
import type { RegexAst } from "../../compiler/regex/ast.ts";
import type { Dfa } from "../../compiler/regex/dfa.ts";
import {
  buildLexerDfa,
  type LexerRegexSpec,
} from "../../compiler/regex/lexer.ts";
import { isRegexNullable } from "../../compiler/regex/nullable.ts";
import { regexOverlapWitness } from "../../compiler/regex/overlap.ts";
import { parsePortableRegex } from "../../compiler/regex/parser.ts";
import { type BnfGrammar, lowerToBnf } from "../typescript/bnf.ts";
import { buildCanonicalLr1Table, type LrTable } from "../typescript/lr1.ts";

export interface RuntimeParserPlan {
  analyzed: AnalyzedGrammar;
  bnf: BnfGrammar;
  lr: LrTable;
  dfa: Dfa;
  diagnostics: readonly Diagnostic[];
}

export interface RuntimeParserPlanningOptions {
  lexerStateLimit?: number;
  parserStateLimit?: number;
  parserItemLimit?: number;
  parserTableEntryLimit?: number;
}

export interface RuntimeParserTargetConfig {
  backend: string;
  codePrefix: string;
  label: string;
}

const DEFAULT_LEXER_STATE_LIMIT = 50_000;

interface RuntimeRegexAnalysis {
  diagnostics: readonly Diagnostic[];
  astByTokenId: ReadonlyMap<number, RegexAst>;
}

interface RuntimeDfaAnalysis {
  diagnostics: readonly Diagnostic[];
  dfa?: Dfa;
}

export function planRuntimeParserTarget(
  analyzed: AnalyzedGrammar,
  options: RuntimeParserPlanningOptions = {},
  metadata: BabaMetadata = {},
  portability: PortabilityMode = "warn",
  config: RuntimeParserTargetConfig,
): RuntimeParserPlan | { diagnostics: readonly Diagnostic[] } {
  const regexAnalysis = analyzeRuntimeRegexes(analyzed, config);
  const diagnostics: Diagnostic[] = [
    ...runtimeCapabilityDiagnostics(analyzed, metadata, portability, config),
    ...regexAnalysis.diagnostics,
    ...runtimeLiteralDiagnostics(analyzed, config),
    ...runtimeTokenOverlapDiagnostics(
      analyzed,
      regexAnalysis.astByTokenId,
      config,
    ),
    ...runtimeLiteralOverlapDiagnostics(
      analyzed,
      regexAnalysis.astByTokenId,
      config,
    ),
    ...runtimeOptionsDiagnostics(options, config),
  ];
  if (hasErrors(diagnostics)) return { diagnostics };

  const dfaAnalysis = runtimeLexerDfaDiagnostics(
    analyzed,
    regexAnalysis.astByTokenId,
    options,
    config,
  );
  diagnostics.push(...dfaAnalysis.diagnostics);
  if (hasErrors(diagnostics) || !dfaAnalysis.dfa) return { diagnostics };

  const bnf = lowerToBnf(analyzed);
  diagnostics.push(
    ...bnf.diagnostics.map((diagnostic) =>
      retargetRuntimeDiagnostic(diagnostic, config)
    ),
  );
  if (hasErrors(diagnostics)) return { diagnostics };

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
  if (hasErrors(diagnostics)) return { diagnostics };

  return {
    analyzed,
    bnf,
    lr,
    dfa: dfaAnalysis.dfa,
    diagnostics,
  };
}

export function retargetRuntimeDiagnostic(
  diagnostic: Diagnostic,
  config: RuntimeParserTargetConfig,
): Diagnostic {
  if (config.codePrefix === "TS" && config.backend === "typescript") {
    return diagnostic;
  }
  return {
    ...diagnostic,
    backend: config.backend,
    code: diagnostic.code.startsWith("TS_")
      ? `${config.codePrefix}_${diagnostic.code.slice("TS_".length)}`
      : diagnostic.code,
    message: retargetRuntimeMessage(diagnostic.message, config.label),
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
  config: RuntimeParserTargetConfig,
): RuntimeRegexAnalysis {
  const diagnostics: Diagnostic[] = [];
  const astByTokenId = new Map<number, RegexAst>();
  for (const token of analyzed.tokens) {
    if (token.kind === "token" && !analyzed.reachableTokens.has(token.id)) {
      continue;
    }
    let ast: RegexAst;
    try {
      ast = parsePortableRegex(token.pattern);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push({
        code: `${config.codePrefix}_LEXER_UNSUPPORTED_REGEX`,
        severity: "error",
        backend: config.backend,
        message:
          `Token '${token.name}' is outside Baba's portable regex subset: ${message}`,
        span: token.span,
      });
      continue;
    }
    astByTokenId.set(token.id, ast);
    if (isRegexNullable(ast)) {
      diagnostics.push({
        code: `${config.codePrefix}_LEXER_EMPTY_TOKEN`,
        severity: "error",
        backend: config.backend,
        message: `Token '${token.name}' must not match empty text.`,
        span: token.span,
      });
    }
  }
  return { diagnostics, astByTokenId };
}

function runtimeTokenOverlapDiagnostics(
  analyzed: AnalyzedGrammar,
  astByTokenId: ReadonlyMap<number, RegexAst>,
  config: RuntimeParserTargetConfig,
): Diagnostic[] {
  const tokens = analyzed.tokens.filter((token) =>
    token.kind === "skip" ||
    (token.kind === "token" && analyzed.reachableTokens.has(token.id))
  );
  const diagnostics: Diagnostic[] = [];
  for (let leftIndex = 0; leftIndex < tokens.length; leftIndex++) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < tokens.length;
      rightIndex++
    ) {
      const left = tokens[leftIndex];
      const right = tokens[rightIndex];
      const leftAst = astByTokenId.get(left.id);
      const rightAst = astByTokenId.get(right.id);
      if (!leftAst || !rightAst) continue;
      const witness = regexOverlapWitness(leftAst, rightAst);
      if (!witness) continue;
      if (left.priority !== right.priority) continue;
      const selected = left.declarationOrder < right.declarationOrder
        ? left
        : right;
      const shadowed = selected === left ? right : left;
      const skipOnly = left.kind === "skip" && right.kind === "skip";
      diagnostics.push({
        code: `${config.codePrefix}_LEXER_TOKEN_OVERLAP`,
        severity: skipOnly ? "warning" : "error",
        backend: config.backend,
        message: `${tokenLabel(left)} and ${tokenLabel(right)} can both match ${
          JSON.stringify(witness)
        }. The standalone lexer would select ${tokenLabel(selected)} before ${
          tokenLabel(shadowed)
        } for this input by declaration order.`,
        span: right.span,
      });
    }
  }
  return diagnostics;
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
  astByTokenId: ReadonlyMap<number, RegexAst>,
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
  for (const token of tokens) {
    const tokenAst = astByTokenId.get(token.id);
    if (!tokenAst) continue;
    for (const literal of literals) {
      const witness = regexOverlapWitness(tokenAst, literalAst(literal.value));
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
      });
    }
  }
  return diagnostics;
}

function runtimeLexerDfaDiagnostics(
  analyzed: AnalyzedGrammar,
  astByTokenId: ReadonlyMap<number, RegexAst>,
  options: RuntimeParserPlanningOptions,
  config: RuntimeParserTargetConfig,
): RuntimeDfaAnalysis {
  const limit = options.lexerStateLimit ?? DEFAULT_LEXER_STATE_LIMIT;
  const dfa = buildLexerDfa(runtimeLexerSpecs(analyzed, astByTokenId));
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
  if (
    options.lexerStateLimit !== undefined &&
    (!Number.isInteger(options.lexerStateLimit) ||
      options.lexerStateLimit < 1)
  ) {
    diagnostics.push({
      code: `${config.codePrefix}_LEXER_STATE_LIMIT`,
      severity: "error",
      backend: config.backend,
      message: "lexerStateLimit must be a positive integer.",
    });
  }
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
  return diagnostics;
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

function retargetRuntimeMessage(message: string, label: string): string {
  return message
    .replaceAll("TypeScript target", `${label} target`)
    .replaceAll("TypeScript parser", `${label} parser`)
    .replaceAll("TypeScript lexer", `${label} lexer`)
    .replaceAll("TypeScript output", `${label} output`)
    .replaceAll("TypeScript LR", `${label} LR`)
    .replaceAll("TypeScript ACTION/GOTO", `${label} ACTION/GOTO`)
    .replaceAll("the TypeScript parser", `the ${label} parser`)
    .replaceAll(
      "generating the TypeScript parser",
      `generating the ${label} parser`,
    );
}

function tokenLabel(token: AnalyzedGrammar["tokens"][number]): string {
  return `${token.kind} ${token.name}`;
}

function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) =>
    (diagnostic.severity ?? "error") === "error"
  );
}
