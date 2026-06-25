import type {
  BabaMetadata,
  Diagnostic,
  EbnfExpression,
  EbnfGrammar,
} from "../ast.ts";
import { collectGrammarDiagnostics } from "./diagnostics.ts";
import type {
  AnalyzedExpression,
  AnalyzedGrammar,
  AnalyzedLiteral,
  AnalyzedRule,
  AnalyzedToken,
  ExpressionId,
  LiteralExpression,
  LiteralId,
  ResolvedReference,
  RuleId,
  TokenId,
} from "./ir.ts";
import type { RegexAst } from "./regex/ast.ts";
import {
  type RegexCompilerLimits,
  RegexResourceLimitError,
} from "./regex/limits.ts";
import { isRegexNullable } from "./regex/nullable.ts";
import { parsePortableRegex } from "./regex/parser.ts";

export const DEFAULT_GRAMMAR_EXPRESSION_DEPTH_LIMIT = 1_024;

/** Builds the shared resolved grammar model used by target planners. */
export function analyzeGrammar(
  grammar: EbnfGrammar,
  options: {
    name?: string;
    rootRule?: string;
    metadata?: BabaMetadata;
    regexLimits?: RegexCompilerLimits;
    grammarExpressionDepthLimit?: number;
  } = {},
): AnalyzedGrammar {
  const rootRuleName = options.rootRule ?? grammar.rules[0]?.name ?? "module";
  const tokenRegexes = grammar.tokens.map((token) =>
    parseTokenRegex(token.pattern, token.name, token.span, options.regexLimits)
  );
  const regexDiagnostics = new Map<number, readonly Diagnostic[]>();
  tokenRegexes.forEach((regex, index) => {
    regexDiagnostics.set(index, regex.diagnostics);
  });
  const diagnostics = collectGrammarDiagnostics(grammar, {
    rootRule: rootRuleName,
    externals: options.metadata?.externals,
    regexDiagnostics,
  });

  const rulesByName = new Map<string, RuleId>();
  const tokensByName = new Map<string, TokenId>();
  grammar.rules.forEach((rule, index) => rulesByName.set(rule.name, index));
  grammar.tokens.forEach((token, index) => tokensByName.set(token.name, index));
  const externals = new Set(options.metadata?.externals ?? []);
  let expressionDepthLimitReported = false;

  const literalIds = new Map<string, LiteralId>();
  const literals: AnalyzedLiteral[] = [];
  const expressionIds = { next: 0 };

  const resolveReference = (name: string): ResolvedReference => {
    const ruleId = rulesByName.get(name);
    if (ruleId !== undefined) return { kind: "rule", ruleId };
    const tokenId = tokensByName.get(name);
    if (tokenId !== undefined) {
      const token = grammar.tokens[tokenId];
      return token.kind === "skip"
        ? { kind: "skip", tokenId }
        : { kind: "token", tokenId };
    }
    if (externals.has(name)) return { kind: "external", name };
    return { kind: "unknown", name };
  };

  const analyzeExpression = (
    expression: EbnfExpression,
    depth = 1,
  ): AnalyzedExpression => {
    const id = expressionIds.next++;
    const depthLimit = options.grammarExpressionDepthLimit ??
      DEFAULT_GRAMMAR_EXPRESSION_DEPTH_LIMIT;
    if (depth > depthLimit) {
      if (!expressionDepthLimitReported) {
        diagnostics.push({
          code: "PORTABLE_GRAMMAR_EXPRESSION_DEPTH_LIMIT",
          severity: "error",
          message:
            `Grammar expression depth exceeded the configured limit (${depthLimit}).`,
          span: expression.span,
        });
        expressionDepthLimitReported = true;
      }
      return {
        id,
        kind: "literal",
        value: "",
        literalId: analyzeLiteralId(""),
        span: expression.span,
      };
    }
    switch (expression.kind) {
      case "field":
        return {
          id,
          kind: "field",
          name: expression.name,
          expression: analyzeExpression(expression.expression, depth + 1),
          span: expression.span,
        };
      case "ref":
        return {
          id,
          kind: "ref",
          name: expression.name,
          reference: resolveReference(expression.name),
          span: expression.span,
        };
      case "literal":
        return analyzeLiteralExpression(id, expression);
      case "sequence":
        return {
          id,
          kind: "sequence",
          items: expression.items.map((item) =>
            analyzeExpression(item, depth + 1)
          ),
          span: expression.span,
        };
      case "choice":
        return {
          id,
          kind: "choice",
          options: expression.options.map((option) =>
            analyzeExpression(option, depth + 1)
          ),
          span: expression.span,
        };
      case "optional":
        return {
          id,
          kind: "optional",
          expression: analyzeExpression(expression.expression, depth + 1),
          span: expression.span,
        };
      case "repeat":
        return {
          id,
          kind: "repeat",
          expression: analyzeExpression(expression.expression, depth + 1),
          span: expression.span,
        };
      case "repeat1":
        return {
          id,
          kind: "repeat1",
          expression: analyzeExpression(expression.expression, depth + 1),
          span: expression.span,
        };
      case "separated":
        return {
          id,
          kind: "separated",
          item: analyzeExpression(expression.item, depth + 1),
          separator: analyzeExpression(expression.separator, depth + 1),
          span: expression.span,
        };
    }
  };

  const analyzeLiteralExpression = (
    id: ExpressionId,
    expression: Extract<EbnfExpression, { kind: "literal" }>,
  ): LiteralExpression => {
    let literalId = literalIds.get(expression.value);
    if (literalId === undefined) {
      literalId = analyzeLiteralId(expression.value, expression.span);
    }
    return {
      id,
      kind: "literal",
      value: expression.value,
      literalId,
      span: expression.span,
    };
  };

  const analyzeLiteralId = (
    value: string,
    span: Diagnostic["span"] = { start: 0, end: 0, line: 1, column: 1 },
  ): LiteralId => {
    let literalId = literalIds.get(value);
    if (literalId === undefined) {
      literalId = literals.length;
      literalIds.set(value, literalId);
      literals.push({
        id: literalId,
        value,
        sourceOrder: literalId,
        span,
      });
    }
    return literalId;
  };

  const rules: AnalyzedRule[] = grammar.rules.map((rule, id) => ({
    id,
    name: rule.name,
    expression: analyzeExpression(rule.expression),
    span: rule.span,
  }));
  const tokens: AnalyzedToken[] = grammar.tokens.map((token, id) => {
    const regex = tokenRegexes[id];
    return {
      id,
      name: token.name,
      kind: token.kind,
      patternSource: token.pattern,
      pattern: regex.pattern,
      nullable: regex.nullable,
      priority: token.priority ?? 0,
      declarationOrder: id,
      span: token.span,
    };
  });

  const rootRule = rulesByName.get(rootRuleName) ?? 0;
  const reachableRules = collectReachableRules(rules, rootRule);
  const reachableTokens = new Set<TokenId>();
  const reachableLiterals = new Set<LiteralId>();
  const reachableExternals = new Set<string>();
  for (const rule of rules) {
    if (!reachableRules.has(rule.id)) continue;
    visitAnalyzedExpression(rule.expression, (expression) => {
      if (expression.kind === "literal") {
        reachableLiterals.add(expression.literalId);
      }
      if (expression.kind !== "ref") return;
      if (expression.reference.kind === "token") {
        reachableTokens.add(expression.reference.tokenId);
      } else if (expression.reference.kind === "external") {
        reachableExternals.add(expression.reference.name);
      }
    });
  }
  if (diagnosticErrorCount(diagnostics) === 0) {
    for (const rule of rules) {
      if (reachableRules.has(rule.id)) continue;
      diagnostics.push({
        code: "UNREACHABLE_RULE",
        severity: "warning",
        message:
          `Rule '${rule.name}' is unreachable from root rule '${rootRuleName}' and was omitted from generated outputs.`,
        span: rule.span,
      });
    }
    diagnostics.push(
      ...collectGrammarHardeningDiagnostics(rules, reachableRules, rootRule),
    );
  }

  return {
    name: options.name ?? "grammar",
    rootRule,
    rules,
    tokens,
    literals,
    externals: [...externals].map((name) => ({ name })),
    reachableRules,
    reachableTokens,
    reachableLiterals,
    reachableExternals,
    diagnostics,
  };
}

function collectGrammarHardeningDiagnostics(
  rules: readonly AnalyzedRule[],
  reachableRules: ReadonlySet<RuleId>,
  rootRule: RuleId,
): Diagnostic[] {
  const productiveRules = computeProductiveRules(rules);
  const nullableRules = computeNullableRuleSet(rules);
  const nonemptyRules = computeNonemptyRuleSet(rules);
  const diagnostics: Diagnostic[] = [];
  for (const rule of rules) {
    if (!reachableRules.has(rule.id)) continue;
    if (!productiveRules.has(rule.id)) {
      diagnostics.push({
        code: rule.id === rootRule
          ? "NONPRODUCTIVE_ROOT"
          : "NONPRODUCTIVE_RULE",
        severity: "error",
        message: rule.id === rootRule
          ? `Root rule '${rule.name}' cannot derive any sentence.`
          : `Rule '${rule.name}' cannot derive any sentence.`,
        span: rule.span,
      });
      continue;
    }
    if (!nonemptyRules.has(rule.id)) {
      diagnostics.push({
        code: "EMPTY_ONLY_RULE",
        severity: "warning",
        message: rule.id === rootRule
          ? `Root rule '${rule.name}' can only derive empty text.`
          : `Rule '${rule.name}' can only derive empty text.`,
        span: rule.span,
      });
    }
  }
  diagnostics.push(
    ...collectNullableRecursiveCycleDiagnostics(
      rules,
      reachableRules,
      nullableRules,
    ),
  );
  return diagnostics;
}

function computeProductiveRules(
  rules: readonly AnalyzedRule[],
): ReadonlySet<RuleId> {
  const productive = new Set<RuleId>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of rules) {
      if (productive.has(rule.id)) continue;
      if (isExpressionProductive(rule.expression, productive)) {
        productive.add(rule.id);
        changed = true;
      }
    }
  }
  return productive;
}

function isExpressionProductive(
  expression: AnalyzedExpression,
  productiveRules: ReadonlySet<RuleId>,
): boolean {
  switch (expression.kind) {
    case "field":
      return isExpressionProductive(expression.expression, productiveRules);
    case "ref":
      return expression.reference.kind === "token" ||
        expression.reference.kind === "external" ||
        (expression.reference.kind === "rule" &&
          productiveRules.has(expression.reference.ruleId));
    case "literal":
      return true;
    case "sequence":
      return expression.items.every((item) =>
        isExpressionProductive(item, productiveRules)
      );
    case "choice":
      return expression.options.some((option) =>
        isExpressionProductive(option, productiveRules)
      );
    case "optional":
    case "repeat":
      return true;
    case "repeat1":
      return isExpressionProductive(expression.expression, productiveRules);
    case "separated":
      return isExpressionProductive(expression.item, productiveRules);
  }
}

function computeNullableRuleSet(
  rules: readonly AnalyzedRule[],
): ReadonlySet<RuleId> {
  const nullable = new Set<RuleId>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of rules) {
      if (nullable.has(rule.id)) continue;
      if (isExpressionNullable(rule.expression, nullable)) {
        nullable.add(rule.id);
        changed = true;
      }
    }
  }
  return nullable;
}

function computeNonemptyRuleSet(
  rules: readonly AnalyzedRule[],
): ReadonlySet<RuleId> {
  const nonempty = new Set<RuleId>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of rules) {
      if (nonempty.has(rule.id)) continue;
      if (canExpressionDeriveNonempty(rule.expression, nonempty)) {
        nonempty.add(rule.id);
        changed = true;
      }
    }
  }
  return nonempty;
}

function canExpressionDeriveNonempty(
  expression: AnalyzedExpression,
  nonemptyRules: ReadonlySet<RuleId>,
): boolean {
  switch (expression.kind) {
    case "field":
      return canExpressionDeriveNonempty(
        expression.expression,
        nonemptyRules,
      );
    case "ref":
      return expression.reference.kind === "token" ||
        expression.reference.kind === "external" ||
        (expression.reference.kind === "rule" &&
          nonemptyRules.has(expression.reference.ruleId));
    case "literal":
      return expression.value.length > 0;
    case "sequence":
      return expression.items.some((item) =>
        canExpressionDeriveNonempty(item, nonemptyRules)
      );
    case "choice":
      return expression.options.some((option) =>
        canExpressionDeriveNonempty(option, nonemptyRules)
      );
    case "optional":
    case "repeat":
    case "repeat1":
      return canExpressionDeriveNonempty(
        expression.expression,
        nonemptyRules,
      );
    case "separated":
      return canExpressionDeriveNonempty(expression.item, nonemptyRules) ||
        canExpressionDeriveNonempty(expression.separator, nonemptyRules);
  }
}

function collectNullableRecursiveCycleDiagnostics(
  rules: readonly AnalyzedRule[],
  reachableRules: ReadonlySet<RuleId>,
  nullableRules: ReadonlySet<RuleId>,
): readonly Diagnostic[] {
  const graph = new Map<RuleId, Set<RuleId>>();
  for (const rule of rules) {
    if (!reachableRules.has(rule.id) || !nullableRules.has(rule.id)) continue;
    const edges = new Set<RuleId>();
    visitAnalyzedExpression(rule.expression, (expression) => {
      if (
        expression.kind === "ref" &&
        expression.reference.kind === "rule" &&
        nullableRules.has(expression.reference.ruleId)
      ) {
        edges.add(expression.reference.ruleId);
      }
    });
    graph.set(rule.id, edges);
  }
  const components = stronglyConnectedComponents(graph);
  return components
    .filter((component) =>
      component.length > 1 ||
      (graph.get(component[0])?.has(component[0]) ?? false)
    )
    .map((component): Diagnostic => {
      const names = component.map((ruleId) => rules[ruleId].name).sort();
      return {
        code: "NULLABLE_RECURSIVE_CYCLE",
        severity: "warning",
        message:
          `Nullable recursive rule cycle can derive empty text indefinitely: ${
            names.join(", ")
          }.`,
        span: rules[component[0]].span,
        related: component.slice(1).map((ruleId) => ({
          message: `Cycle member '${rules[ruleId].name}'.`,
          span: rules[ruleId].span,
        })),
      };
    });
}

function stronglyConnectedComponents(
  graph: ReadonlyMap<RuleId, ReadonlySet<RuleId>>,
): readonly (readonly RuleId[])[] {
  const components: RuleId[][] = [];
  const indexByRule = new Map<RuleId, number>();
  const lowlinkByRule = new Map<RuleId, number>();
  const stack: RuleId[] = [];
  const onStack = new Set<RuleId>();
  let nextIndex = 0;

  const visit = (ruleId: RuleId) => {
    indexByRule.set(ruleId, nextIndex);
    lowlinkByRule.set(ruleId, nextIndex);
    nextIndex++;
    stack.push(ruleId);
    onStack.add(ruleId);

    for (const target of graph.get(ruleId) ?? []) {
      if (!graph.has(target)) continue;
      if (!indexByRule.has(target)) {
        visit(target);
        lowlinkByRule.set(
          ruleId,
          Math.min(lowlinkByRule.get(ruleId)!, lowlinkByRule.get(target)!),
        );
      } else if (onStack.has(target)) {
        lowlinkByRule.set(
          ruleId,
          Math.min(lowlinkByRule.get(ruleId)!, indexByRule.get(target)!),
        );
      }
    }

    if (lowlinkByRule.get(ruleId) !== indexByRule.get(ruleId)) return;
    const component: RuleId[] = [];
    while (stack.length > 0) {
      const member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
      if (member === ruleId) break;
    }
    components.push(component);
  };

  for (const ruleId of graph.keys()) {
    if (!indexByRule.has(ruleId)) visit(ruleId);
  }
  return components;
}

function parseTokenRegex(
  patternSource: string,
  tokenName: string,
  span: Diagnostic["span"],
  limits: RegexCompilerLimits = {},
): {
  pattern: RegexAst;
  nullable: boolean;
  diagnostics: readonly Diagnostic[];
} {
  try {
    const pattern = parsePortableRegex(patternSource, limits);
    const nullable = isRegexNullable(pattern);
    return {
      pattern,
      nullable,
      diagnostics: nullable
        ? [{
          code: "INVALID_TOKEN_REGEX",
          severity: "error",
          message:
            `Invalid regex for token '${tokenName}': must not match empty text`,
          span,
        }]
        : [],
    };
  } catch (error) {
    const code = error instanceof RegexResourceLimitError
      ? `PORTABLE_${error.code}`
      : "INVALID_TOKEN_REGEX";
    return {
      pattern: { kind: "empty" },
      nullable: true,
      diagnostics: [{
        code,
        severity: "error",
        message: `Invalid regex for token '${tokenName}': ${
          errorMessage(error)
        }`,
        span,
      }],
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function visitAnalyzedExpression(
  expression: AnalyzedExpression,
  visit: (expression: AnalyzedExpression) => void,
): void {
  visit(expression);
  switch (expression.kind) {
    case "field":
    case "optional":
    case "repeat":
    case "repeat1":
      visitAnalyzedExpression(expression.expression, visit);
      return;
    case "sequence":
      for (const item of expression.items) visitAnalyzedExpression(item, visit);
      return;
    case "choice":
      for (const option of expression.options) {
        visitAnalyzedExpression(option, visit);
      }
      return;
    case "separated":
      visitAnalyzedExpression(expression.item, visit);
      visitAnalyzedExpression(expression.separator, visit);
      return;
    case "ref":
    case "literal":
      return;
  }
}

export function computeNullableRules(
  analyzed: AnalyzedGrammar,
): ReadonlySet<RuleId> {
  const nullable = new Set<RuleId>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of analyzed.rules) {
      if (nullable.has(rule.id)) continue;
      if (isExpressionNullable(rule.expression, nullable)) {
        nullable.add(rule.id);
        changed = true;
      }
    }
  }
  return nullable;
}

export interface GrammarAnalysisStatistics {
  readonly stronglyConnectedComponents: number;
  readonly productiveIterations: number;
  readonly nullableIterations: number;
}

export function grammarAnalysisStatistics(
  rules: readonly AnalyzedRule[],
  reachableRules: ReadonlySet<RuleId>,
): GrammarAnalysisStatistics {
  const graph = new Map<RuleId, Set<RuleId>>();
  for (const rule of rules) {
    if (!reachableRules.has(rule.id)) continue;
    const edges = new Set<RuleId>();
    visitAnalyzedExpression(rule.expression, (expression) => {
      if (
        expression.kind === "ref" &&
        expression.reference.kind === "rule" &&
        reachableRules.has(expression.reference.ruleId)
      ) {
        edges.add(expression.reference.ruleId);
      }
    });
    graph.set(rule.id, edges);
  }
  return {
    stronglyConnectedComponents: stronglyConnectedComponents(graph).length,
    productiveIterations: countProductiveIterations(rules),
    nullableIterations: countNullableIterations(rules),
  };
}

function countProductiveIterations(rules: readonly AnalyzedRule[]): number {
  const productive = new Set<RuleId>();
  let iterations = 0;
  let changed = true;
  while (changed) {
    iterations++;
    changed = false;
    for (const rule of rules) {
      if (productive.has(rule.id)) continue;
      if (isExpressionProductive(rule.expression, productive)) {
        productive.add(rule.id);
        changed = true;
      }
    }
  }
  return iterations;
}

function countNullableIterations(rules: readonly AnalyzedRule[]): number {
  const nullable = new Set<RuleId>();
  let iterations = 0;
  let changed = true;
  while (changed) {
    iterations++;
    changed = false;
    for (const rule of rules) {
      if (nullable.has(rule.id)) continue;
      if (isExpressionNullable(rule.expression, nullable)) {
        nullable.add(rule.id);
        changed = true;
      }
    }
  }
  return iterations;
}

export function isExpressionNullable(
  expression: AnalyzedExpression,
  nullableRules: ReadonlySet<RuleId>,
): boolean {
  switch (expression.kind) {
    case "field":
      return isExpressionNullable(expression.expression, nullableRules);
    case "ref":
      return expression.reference.kind === "rule" &&
        nullableRules.has(expression.reference.ruleId);
    case "literal":
      return expression.value.length === 0;
    case "sequence":
      return expression.items.every((item) =>
        isExpressionNullable(item, nullableRules)
      );
    case "choice":
      return expression.options.some((option) =>
        isExpressionNullable(option, nullableRules)
      );
    case "optional":
    case "repeat":
      return true;
    case "repeat1":
      return isExpressionNullable(expression.expression, nullableRules);
    case "separated":
      return isExpressionNullable(expression.item, nullableRules);
  }
}

function collectReachableRules(
  rules: readonly AnalyzedRule[],
  rootRule: RuleId,
): ReadonlySet<RuleId> {
  const reachable = new Set<RuleId>();
  const queue = [rootRule];
  for (let index = 0; index < queue.length; index++) {
    const ruleId = queue[index];
    if (reachable.has(ruleId)) continue;
    const rule = rules[ruleId];
    if (!rule) continue;
    reachable.add(ruleId);
    visitAnalyzedExpression(rule.expression, (expression) => {
      if (
        expression.kind === "ref" &&
        expression.reference.kind === "rule" &&
        !reachable.has(expression.reference.ruleId)
      ) {
        queue.push(expression.reference.ruleId);
      }
    });
  }
  return reachable;
}

export function diagnosticErrorCount(
  diagnostics: readonly Diagnostic[],
): number {
  return diagnostics.filter((diagnostic) =>
    (diagnostic.severity ?? "error") === "error"
  ).length;
}
