import type {
  BabaMetadata,
  Diagnostic,
  EbnfExpression,
  EbnfGrammar,
} from "../ast.ts";
import { collectGrammarDiagnostics } from "../generate.ts";
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

/** Builds the shared resolved grammar model used by target planners. */
export function analyzeGrammar(
  grammar: EbnfGrammar,
  options: {
    name?: string;
    rootRule?: string;
    metadata?: BabaMetadata;
  } = {},
): AnalyzedGrammar {
  const rootRuleName = options.rootRule ?? grammar.rules[0]?.name ?? "module";
  const diagnostics = collectGrammarDiagnostics(grammar, {
    rootRule: rootRuleName,
    externals: options.metadata?.externals,
  });

  const rulesByName = new Map<string, RuleId>();
  const tokensByName = new Map<string, TokenId>();
  grammar.rules.forEach((rule, index) => rulesByName.set(rule.name, index));
  grammar.tokens.forEach((token, index) => tokensByName.set(token.name, index));
  const externals = new Set(options.metadata?.externals ?? []);

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
  ): AnalyzedExpression => {
    const id = expressionIds.next++;
    switch (expression.kind) {
      case "field":
        return {
          id,
          kind: "field",
          name: expression.name,
          expression: analyzeExpression(expression.expression),
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
          items: expression.items.map(analyzeExpression),
          span: expression.span,
        };
      case "choice":
        return {
          id,
          kind: "choice",
          options: expression.options.map(analyzeExpression),
          span: expression.span,
        };
      case "optional":
        return {
          id,
          kind: "optional",
          expression: analyzeExpression(expression.expression),
          span: expression.span,
        };
      case "repeat":
        return {
          id,
          kind: "repeat",
          expression: analyzeExpression(expression.expression),
          span: expression.span,
        };
      case "repeat1":
        return {
          id,
          kind: "repeat1",
          expression: analyzeExpression(expression.expression),
          span: expression.span,
        };
      case "separated":
        return {
          id,
          kind: "separated",
          item: analyzeExpression(expression.item),
          separator: analyzeExpression(expression.separator),
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
      literalId = literals.length;
      literalIds.set(expression.value, literalId);
      literals.push({
        id: literalId,
        value: expression.value,
        sourceOrder: literalId,
        span: expression.span,
      });
    }
    return {
      id,
      kind: "literal",
      value: expression.value,
      literalId,
      span: expression.span,
    };
  };

  const rules: AnalyzedRule[] = grammar.rules.map((rule, id) => ({
    id,
    name: rule.name,
    expression: analyzeExpression(rule.expression),
    span: rule.span,
  }));
  const tokens: AnalyzedToken[] = grammar.tokens.map((token, id) => ({
    id,
    name: token.name,
    kind: token.kind,
    pattern: token.pattern,
    declarationOrder: id,
    span: token.span,
  }));

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
