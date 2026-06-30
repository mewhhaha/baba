import type {
  BabaMetadata,
  Diagnostic,
  GrammarDeclaration,
  GrammarDocument,
  GrammarExpression,
  GrammarRule,
  GrammarRuleAnnotation,
  GrammarTerminalPattern,
  SourceSpan,
} from "../ast.ts";
import {
  collectGrammarHardeningDiagnostics,
  DEFAULT_GRAMMAR_EXPRESSION_DEPTH_LIMIT,
  parseTokenRegex,
  visitAnalyzedExpression,
} from "./analyze.ts";
import { analyzeGrammar } from "./grammar_analysis.ts";
import type {
  AnalyzedGrammar as AnalyzedSourceGrammar,
  AnalyzedGrammarExpression as AnalyzedSourceGrammarExpression,
  AnalyzedGrammarRule as AnalyzedSourceGrammarRule,
  AnalyzedGrammarToken as AnalyzedSourceGrammarToken,
  GrammarRuleId as SourceGrammarRuleId,
} from "./grammar_ir.ts";
import type {
  AnalyzedExpression,
  AnalyzedExternalToken,
  AnalyzedGrammar,
  AnalyzedLiteral,
  AnalyzedRule,
  AnalyzedToken,
  LiteralId,
  ResolvedReference,
  RuleId,
  TokenId,
} from "./ir.ts";
import type { RegexCompilerLimits } from "./regex/limits.ts";

export interface AnalyzeGrammarDocumentForWasmOptions {
  readonly name?: string;
  readonly rootRule?: string;
  readonly metadata?: BabaMetadata;
  readonly regexLimits?: RegexCompilerLimits;
  readonly grammarExpressionDepthLimit?: number;
}

interface ConversionContext {
  readonly source: AnalyzedSourceGrammar;
  readonly diagnostics: Diagnostic[];
  readonly externalNames: ReadonlySet<string>;
  readonly literals: AnalyzedLiteral[];
  readonly literalIdsByValue: Map<string, LiteralId>;
  readonly regexLimits: RegexCompilerLimits | undefined;
  readonly expressionDepthLimit: number;
  expressionDepthLimitReported: boolean;
}

export function analyzeGrammarDocumentForWasm(
  document: GrammarDocument,
  options: AnalyzeGrammarDocumentForWasmOptions = {},
): AnalyzedGrammar {
  const source = analyzeGrammar(document, { rootRule: options.rootRule });
  const externalNames = metadataExternalNames(options.metadata);
  const diagnostics: Diagnostic[] = [];
  diagnostics.push(
    ...publicSourceDiagnostics(source.diagnostics, externalNames),
  );
  collectWasmSubsetDiagnostics(document, source, diagnostics);

  const literals: AnalyzedLiteral[] = source.literals.map((literal) => ({
    id: literal.id,
    value: literal.value,
    sourceOrder: literal.sourceOrder,
    span: literal.span,
  }));
  const literalIdsByValue = new Map<string, LiteralId>();
  for (const literal of literals) {
    literalIdsByValue.set(literal.value, literal.id);
  }

  const expressionDepthLimit = selectedExpressionDepthLimit(
    options.grammarExpressionDepthLimit,
  );
  const context: ConversionContext = {
    source,
    diagnostics,
    externalNames,
    literals,
    literalIdsByValue,
    regexLimits: options.regexLimits,
    expressionDepthLimit,
    expressionDepthLimitReported: false,
  };

  const tokens = source.tokens.map((token) => convertToken(context, token));
  const rules = source.rules.map((rule) => convertRule(context, rule));
  const rootRule = selectedRootRule(source.rootRule, rules);
  const reachableRules = collectReachableRules(rules, rootRule);
  const reachableTokens = new Set<TokenId>();
  const reachableLiterals = new Set<LiteralId>();
  const reachableExternals = new Set<string>();
  for (const rule of rules) {
    if (!reachableRules.has(rule.id)) {
      continue;
    }
    visitAnalyzedExpression(rule.expression, (expression) => {
      if (expression.kind === "literal") {
        reachableLiterals.add(expression.literalId);
        return;
      }
      if (expression.kind !== "ref") {
        return;
      }
      if (expression.reference.kind === "token") {
        reachableTokens.add(expression.reference.tokenId);
        return;
      }
      if (expression.reference.kind === "external") {
        reachableExternals.add(expression.reference.name);
      }
    });
  }

  if (!hasErrorDiagnostics(diagnostics) && rules.length > 0) {
    diagnostics.push(
      ...collectGrammarHardeningDiagnostics(rules, reachableRules, rootRule),
    );
  }

  return {
    name: selectedGrammarName(options.name, source.name),
    rootRule,
    rules,
    tokens,
    literals: context.literals,
    externals: analyzedExternals(externalNames),
    reachableRules,
    reachableTokens,
    reachableLiterals,
    reachableExternals,
    diagnostics,
  };
}

function convertToken(
  context: ConversionContext,
  token: AnalyzedSourceGrammarToken,
): AnalyzedToken {
  const patternSource = terminalPatternSource(token.pattern);
  const regex = parseTokenRegex(
    patternSource,
    token.name,
    token.pattern.span,
    context.regexLimits,
  );
  context.diagnostics.push(...regex.diagnostics);
  let kind: "token" | "skip" = "token";
  if (token.kind === "skip") {
    kind = "skip";
  }
  return {
    id: token.id,
    name: token.name,
    kind,
    patternSource,
    pattern: regex.pattern,
    nullable: regex.nullable,
    priority: token.priority,
    declarationOrder: token.id,
    span: token.span,
  };
}

function convertRule(
  context: ConversionContext,
  rule: AnalyzedSourceGrammarRule,
): AnalyzedRule {
  return {
    id: rule.id,
    name: rule.name,
    expression: convertExpression(context, rule.expression, 1),
    span: rule.span,
  };
}

function convertExpression(
  context: ConversionContext,
  expression: AnalyzedSourceGrammarExpression,
  depth: number,
): AnalyzedExpression {
  const id = expression.id;
  if (depth > context.expressionDepthLimit) {
    if (!context.expressionDepthLimitReported) {
      context.diagnostics.push({
        code: "PORTABLE_GRAMMAR_EXPRESSION_DEPTH_LIMIT",
        severity: "error",
        message:
          `Grammar expression depth exceeded the configured limit (${context.expressionDepthLimit}).`,
        span: expression.span,
      });
      context.expressionDepthLimitReported = true;
    }
    return {
      id,
      kind: "literal",
      value: "",
      literalId: literalIdFor(context, "", expression.span),
      span: expression.span,
    };
  }

  if (expression.kind === "field") {
    return {
      id,
      kind: "field",
      name: expression.name,
      expression: convertExpression(context, expression.expression, depth + 1),
      span: expression.span,
    };
  }
  if (expression.kind === "ref") {
    return {
      id,
      kind: "ref",
      name: expression.name,
      reference: convertReference(context, expression),
      span: expression.span,
    };
  }
  if (expression.kind === "literal") {
    return {
      id,
      kind: "literal",
      value: expression.value,
      literalId: literalIdFor(context, expression.value, expression.span),
      span: expression.span,
    };
  }
  if (expression.kind === "sequence") {
    const items: AnalyzedExpression[] = [];
    for (const item of expression.items) {
      items.push(convertExpression(context, item, depth + 1));
    }
    return {
      id,
      kind: "sequence",
      items,
      span: expression.span,
    };
  }
  if (expression.kind === "choice") {
    const options: AnalyzedExpression[] = [];
    for (const option of expression.options) {
      options.push(convertExpression(context, option, depth + 1));
    }
    return {
      id,
      kind: "choice",
      options,
      span: expression.span,
    };
  }
  if (expression.kind === "optional") {
    return {
      id,
      kind: "optional",
      expression: convertExpression(context, expression.expression, depth + 1),
      span: expression.span,
    };
  }
  if (expression.kind === "repeat") {
    return {
      id,
      kind: "repeat",
      expression: convertExpression(context, expression.expression, depth + 1),
      span: expression.span,
    };
  }
  if (expression.kind === "repeat1") {
    return {
      id,
      kind: "repeat1",
      expression: convertExpression(context, expression.expression, depth + 1),
      span: expression.span,
    };
  }
  if (expression.kind === "separated") {
    return {
      id,
      kind: "separated",
      item: convertExpression(context, expression.item, depth + 1),
      separator: convertExpression(context, expression.separator, depth + 1),
      span: expression.span,
    };
  }
  if (expression.kind === "constructor") {
    return convertExpression(context, expression.expression, depth + 1);
  }
  return convertExpression(context, expression.atom, depth + 1);
}

function convertReference(
  context: ConversionContext,
  expression: Extract<AnalyzedSourceGrammarExpression, { kind: "ref" }>,
): ResolvedReference {
  if (expression.reference.kind === "rule") {
    return { kind: "rule", ruleId: expression.reference.ruleId };
  }
  if (expression.reference.kind === "token") {
    return { kind: "token", tokenId: expression.reference.tokenId };
  }
  if (expression.reference.kind === "skip") {
    context.diagnostics.push({
      code: "SKIP_TOKEN_REFERENCE",
      severity: "error",
      message:
        `Rule references skip declaration '${expression.name}'. Skip declarations are consumed as trivia and cannot appear in parser rules. Use a token declaration if ${expression.name} must be syntactically significant.`,
      span: expression.span,
    });
    return { kind: "skip", tokenId: expression.reference.tokenId };
  }
  if (expression.reference.kind === "literal") {
    context.diagnostics.push({
      code: "GRAMMAR_UNSUPPORTED_EOF_REFERENCE",
      severity: "error",
      message:
        `Reference '${expression.name}' resolves to a grammar literal that the current Wasm parser plan does not encode as a named reference.`,
      span: expression.span,
    });
    return { kind: "unknown", name: expression.name };
  }
  if (context.externalNames.has(expression.name)) {
    return { kind: "external", name: expression.name };
  }
  return { kind: "unknown", name: expression.name };
}

function collectWasmSubsetDiagnostics(
  document: GrammarDocument,
  source: AnalyzedSourceGrammar,
  diagnostics: Diagnostic[],
): void {
  const defaultMode = source.modes.find((mode) => mode.name === "default");
  if (defaultMode === undefined) {
    diagnostics.push({
      code: "GRAMMAR_INTERNAL_MISSING_DEFAULT_MODE",
      severity: "error",
      message: "Grammar analysis did not produce a default lexer mode.",
      span: document.span,
    });
  }
  const defaultModeId = defaultMode?.id;
  for (const declaration of document.declarations) {
    collectUnsupportedDeclarationDiagnostic(declaration, diagnostics);
    if (declaration.kind === "rule") {
      collectRuleSubsetDiagnostics(declaration, diagnostics);
    }
  }
  for (const token of source.tokens) {
    collectTokenSubsetDiagnostics(token, defaultModeId, diagnostics);
  }
}

function collectUnsupportedDeclarationDiagnostic(
  declaration: GrammarDeclaration,
  diagnostics: Diagnostic[],
): void {
  if (declaration.kind === "mode") {
    diagnostics.push({
      code: "GRAMMAR_UNSUPPORTED_LEXER_MODE_DECLARATION",
      severity: "error",
      message:
        `Lexer mode '${declaration.name}' cannot be encoded in the current Wasm parser plan.`,
      span: declaration.span,
    });
    return;
  }
  if (declaration.kind === "layout") {
    diagnostics.push({
      code: "GRAMMAR_UNSUPPORTED_LAYOUT_DECLARATION",
      severity: "error",
      message:
        `Layout declaration '${declaration.name}' cannot be encoded in the current Wasm parser plan.`,
      span: declaration.span,
    });
    return;
  }
  if (declaration.kind === "import") {
    diagnostics.push({
      code: "GRAMMAR_UNSUPPORTED_IMPORT_DECLARATION",
      severity: "error",
      message:
        `Import '${declaration.source}' must be composed before Wasm generation.`,
      span: declaration.span,
    });
    return;
  }
  if (declaration.kind === "extend") {
    diagnostics.push({
      code: "GRAMMAR_UNSUPPORTED_EXTENSION_DECLARATION",
      severity: "error",
      message:
        `Extension for '${declaration.target}' must be composed before Wasm generation.`,
      span: declaration.span,
    });
  }
}

function collectRuleSubsetDiagnostics(
  rule: GrammarRule,
  diagnostics: Diagnostic[],
): void {
  for (const annotation of rule.annotations) {
    collectUnsupportedRuleAnnotationDiagnostic(
      rule.name,
      annotation,
      diagnostics,
    );
  }
  collectExpressionSubsetDiagnostics(rule.expression, diagnostics);
}

function collectUnsupportedRuleAnnotationDiagnostic(
  ruleName: string,
  annotation: GrammarRuleAnnotation,
  diagnostics: Diagnostic[],
): void {
  if (annotation.kind === "sync") {
    diagnostics.push({
      code: "GRAMMAR_UNSUPPORTED_SYNC_ANNOTATION",
      severity: "error",
      message:
        `Rule '${ruleName}' declares sync recovery, but the current Wasm parser plan does not encode sync sets.`,
      span: annotation.span,
    });
  }
}

function collectTokenSubsetDiagnostics(
  token: AnalyzedSourceGrammarToken,
  defaultModeId: number | undefined,
  diagnostics: Diagnostic[],
): void {
  if (token.kind === "contextual") {
    diagnostics.push({
      code: "GRAMMAR_UNSUPPORTED_CONTEXTUAL_TOKEN",
      severity: "error",
      message:
        `Contextual token '${token.name}' cannot be encoded in the current Wasm parser plan.`,
      span: token.span,
    });
  }
  if (token.channel !== undefined) {
    diagnostics.push({
      code: "GRAMMAR_UNSUPPORTED_TOKEN_CHANNEL",
      severity: "error",
      message:
        `Token '${token.name}' declares channel '${token.channel}', but the current Wasm parser plan has no channel model.`,
      span: token.span,
    });
  }
  if (defaultModeId !== undefined && token.modeId !== defaultModeId) {
    diagnostics.push({
      code: "GRAMMAR_UNSUPPORTED_LEXER_MODE",
      severity: "error",
      message:
        `Token '${token.name}' is scoped to a non-default lexer mode, but the current Wasm parser plan is single-mode.`,
      span: token.span,
    });
  }
  if (token.transition !== undefined) {
    diagnostics.push({
      code: "GRAMMAR_UNSUPPORTED_LEXER_MODE_TRANSITION",
      severity: "error",
      message:
        `Token '${token.name}' declares a lexer mode transition, but the current Wasm parser plan is single-mode.`,
      span: token.transition.span,
    });
  }
}

function collectExpressionSubsetDiagnostics(
  expression: GrammarExpression,
  diagnostics: Diagnostic[],
): void {
  if (expression.kind === "field") {
    collectExpressionSubsetDiagnostics(expression.expression, diagnostics);
    return;
  }
  if (expression.kind === "sequence") {
    for (const item of expression.items) {
      collectExpressionSubsetDiagnostics(item, diagnostics);
    }
    return;
  }
  if (expression.kind === "choice") {
    for (const option of expression.options) {
      collectExpressionSubsetDiagnostics(option, diagnostics);
    }
    return;
  }
  if (
    expression.kind === "optional" || expression.kind === "repeat" ||
    expression.kind === "repeat1"
  ) {
    collectExpressionSubsetDiagnostics(expression.expression, diagnostics);
    return;
  }
  if (expression.kind === "separated") {
    collectExpressionSubsetDiagnostics(expression.item, diagnostics);
    collectExpressionSubsetDiagnostics(expression.separator, diagnostics);
    return;
  }
  if (expression.kind === "constructor") {
    diagnostics.push({
      code: "GRAMMAR_AST_CONSTRUCTOR_IGNORED",
      severity: "warning",
      message:
        `AST constructor '${expression.name}' is accepted by the grammar frontend, but the current Wasm bundle only emits cursor-shaped parse results.`,
      span: expression.span,
    });
    collectExpressionSubsetDiagnostics(expression.expression, diagnostics);
    return;
  }
  if (expression.kind === "expressionIsland") {
    diagnostics.push({
      code: "GRAMMAR_UNSUPPORTED_EXPRESSION_ISLAND",
      severity: "error",
      message:
        "Pratt expression islands cannot be encoded in the current Wasm parser plan.",
      span: expression.span,
    });
  }
}

function publicSourceDiagnostics(
  diagnostics: readonly Diagnostic[],
  externalNames: ReadonlySet<string>,
): Diagnostic[] {
  const result: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    if (isWasmPlannerDiagnostic(diagnostic.code)) {
      continue;
    }
    const externalName = unknownReferenceName(diagnostic);
    if (externalName !== undefined && externalNames.has(externalName)) {
      continue;
    }
    result.push(diagnostic);
  }
  return result;
}

function isWasmPlannerDiagnostic(code: string): boolean {
  return code === "GRAMMAR_UNREACHABLE_RULE" ||
    code === "GRAMMAR_UNUSED_TOKEN" ||
    code === "GRAMMAR_NONPRODUCTIVE_RULE" ||
    code === "GRAMMAR_EMPTY_ONLY_RULE" ||
    code === "GRAMMAR_INVALID_TOKEN_PATTERN" ||
    code === "GRAMMAR_TOKEN_OVERLAP_LIMIT" ||
    code === "GRAMMAR_TOKEN_OVERLAP" ||
    code === "GRAMMAR_TOKEN_SHADOW_LIMIT" ||
    code === "GRAMMAR_TOKEN_SHADOWED";
}

function unknownReferenceName(diagnostic: Diagnostic): string | undefined {
  if (diagnostic.code !== "GRAMMAR_UNKNOWN_REFERENCE") {
    return undefined;
  }
  const match = /^Unknown reference '([^']+)'\.$/.exec(diagnostic.message);
  if (match === null) {
    return undefined;
  }
  return match[1];
}

function selectedRootRule(
  sourceRootRule: SourceGrammarRuleId | undefined,
  rules: readonly AnalyzedRule[],
): RuleId {
  if (sourceRootRule !== undefined) {
    return sourceRootRule;
  }
  if (rules.length > 0) {
    return rules[0].id;
  }
  return 0;
}

function collectReachableRules(
  rules: readonly AnalyzedRule[],
  rootRule: RuleId,
): ReadonlySet<RuleId> {
  const reachable = new Set<RuleId>();
  if (rules[rootRule] === undefined) {
    return reachable;
  }
  const queue: RuleId[] = [rootRule];
  for (let index = 0; index < queue.length; index++) {
    const ruleId = queue[index];
    if (reachable.has(ruleId)) {
      continue;
    }
    const rule = rules[ruleId];
    if (rule === undefined) {
      continue;
    }
    reachable.add(ruleId);
    visitAnalyzedExpression(rule.expression, (expression) => {
      if (expression.kind !== "ref") {
        return;
      }
      if (expression.reference.kind !== "rule") {
        return;
      }
      if (!reachable.has(expression.reference.ruleId)) {
        queue.push(expression.reference.ruleId);
      }
    });
  }
  return reachable;
}

function terminalPatternSource(pattern: GrammarTerminalPattern): string {
  if (pattern.kind === "regex") {
    return pattern.pattern;
  }
  return escapeRegexLiteral(pattern.value);
}

function escapeRegexLiteral(value: string): string {
  let escaped = "";
  for (const char of value) {
    if (isRegexSpecialChar(char)) {
      escaped += "\\";
    }
    escaped += char;
  }
  return escaped;
}

function isRegexSpecialChar(char: string): boolean {
  return char === "\\" ||
    char === "." ||
    char === "+" ||
    char === "*" ||
    char === "?" ||
    char === "^" ||
    char === "$" ||
    char === "{" ||
    char === "}" ||
    char === "(" ||
    char === ")" ||
    char === "|" ||
    char === "[" ||
    char === "]";
}

function literalIdFor(
  context: ConversionContext,
  value: string,
  span: SourceSpan,
): LiteralId {
  const existing = context.literalIdsByValue.get(value);
  if (existing !== undefined) {
    return existing;
  }
  const id = context.literals.length;
  context.literalIdsByValue.set(value, id);
  context.literals.push({
    id,
    value,
    sourceOrder: id,
    span,
  });
  return id;
}

function selectedExpressionDepthLimit(limit: number | undefined): number {
  if (limit !== undefined) {
    return limit;
  }
  return DEFAULT_GRAMMAR_EXPRESSION_DEPTH_LIMIT;
}

function metadataExternalNames(
  metadata: BabaMetadata | undefined,
): ReadonlySet<string> {
  if (metadata === undefined || metadata.externals === undefined) {
    return new Set();
  }
  return new Set(metadata.externals);
}

function analyzedExternals(
  names: ReadonlySet<string>,
): AnalyzedExternalToken[] {
  const externals: AnalyzedExternalToken[] = [];
  for (const name of names) {
    externals.push({ name });
  }
  return externals;
}

function selectedGrammarName(
  optionName: string | undefined,
  analyzedName: string,
): string {
  if (optionName !== undefined) {
    return optionName;
  }
  return analyzedName;
}

function hasErrorDiagnostics(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
