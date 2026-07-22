import type { Diagnostic } from "../ast.ts";
import type {
  AnalyzedExpression,
  AnalyzedGrammar,
  AnalyzedRule,
  RuleId,
} from "./ir.ts";
import type { RegexAst } from "./regex/ast.ts";
import {
  type RegexCompilerLimits,
  RegexResourceLimitError,
} from "./regex/limits.ts";
import { isRegexNullable } from "./regex/nullable.ts";
import { parsePortableRegex } from "./regex/parser.ts";

export const DEFAULT_GRAMMAR_EXPRESSION_DEPTH_LIMIT = 1_024;

export function collectGrammarHardeningDiagnostics(
  rules: readonly AnalyzedRule[],
  reachableRules: ReadonlySet<RuleId>,
  rootRule: RuleId,
): Diagnostic[] {
  const productiveRules = computeProductiveRules(rules);
  const nullableRules = computeNullableRuleSet(rules);
  const nonemptyRules = computeNonemptyRuleSet(rules);
  const diagnostics: Diagnostic[] = [];
  for (const rule of rules) {
    if (!reachableRules.has(rule.id)) {
      continue;
    }
    if (!productiveRules.has(rule.id)) {
      let code = "NONPRODUCTIVE_RULE";
      let message = `Rule '${rule.name}' cannot derive any sentence.`;
      if (rule.id === rootRule) {
        code = "NONPRODUCTIVE_ROOT";
        message = `Root rule '${rule.name}' cannot derive any sentence.`;
      }
      diagnostics.push({
        code,
        severity: "error",
        message,
        span: rule.span,
      });
      continue;
    }
    if (!nonemptyRules.has(rule.id)) {
      let message = `Rule '${rule.name}' can only derive empty text.`;
      if (rule.id === rootRule) {
        message = `Root rule '${rule.name}' can only derive empty text.`;
      }
      diagnostics.push({
        code: "EMPTY_ONLY_RULE",
        severity: "warning",
        message,
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

export function parseTokenRegex(
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
    const diagnostics: Diagnostic[] = [];
    if (nullable) {
      diagnostics.push({
        code: "INVALID_TOKEN_REGEX",
        severity: "error",
        message:
          `Invalid regex for token '${tokenName}': must not match empty text`,
        span,
      });
    }
    return { pattern, nullable, diagnostics };
  } catch (error) {
    let code = "INVALID_TOKEN_REGEX";
    if (error instanceof RegexResourceLimitError) {
      code = `PORTABLE_${error.code}`;
    }
    let message = String(error);
    if (error instanceof Error) {
      message = error.message;
    }
    return {
      pattern: { kind: "empty" },
      nullable: true,
      diagnostics: [{
        code,
        severity: "error",
        message: `Invalid regex for token '${tokenName}': ${message}`,
        span,
      }],
    };
  }
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
      for (const child of expression.items) {
        visitAnalyzedExpression(child, visit);
      }
      return;
    case "choice":
      for (const child of expression.options) {
        visitAnalyzedExpression(child, visit);
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
  return computeNullableRuleSet(analyzed.rules);
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
    if (!reachableRules.has(rule.id)) {
      continue;
    }
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
      return expression.items.every((child) =>
        isExpressionNullable(child, nullableRules)
      );
    case "choice":
      return expression.options.some((child) =>
        isExpressionNullable(child, nullableRules)
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

function computeProductiveRules(
  rules: readonly AnalyzedRule[],
): ReadonlySet<RuleId> {
  const productive = new Set<RuleId>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of rules) {
      if (productive.has(rule.id)) {
        continue;
      }
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
      if (expression.reference.kind === "token") {
        return true;
      }
      return expression.reference.kind === "rule" &&
        productiveRules.has(expression.reference.ruleId);
    case "literal":
      return true;
    case "sequence":
      return expression.items.every((child) =>
        isExpressionProductive(child, productiveRules)
      );
    case "choice":
      return expression.options.some((child) =>
        isExpressionProductive(child, productiveRules)
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
      if (nullable.has(rule.id)) {
        continue;
      }
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
      if (nonempty.has(rule.id)) {
        continue;
      }
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
      return canExpressionDeriveNonempty(expression.expression, nonemptyRules);
    case "ref":
      if (expression.reference.kind === "token") {
        return true;
      }
      return expression.reference.kind === "rule" &&
        nonemptyRules.has(expression.reference.ruleId);
    case "literal":
      return expression.value.length > 0;
    case "sequence":
      return expression.items.some((child) =>
        canExpressionDeriveNonempty(child, nonemptyRules)
      );
    case "choice":
      return expression.options.some((child) =>
        canExpressionDeriveNonempty(child, nonemptyRules)
      );
    case "optional":
    case "repeat":
    case "repeat1":
      return canExpressionDeriveNonempty(expression.expression, nonemptyRules);
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
    if (!reachableRules.has(rule.id) || !nullableRules.has(rule.id)) {
      continue;
    }
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

  const diagnostics: Diagnostic[] = [];
  for (const component of stronglyConnectedComponents(graph)) {
    const firstRuleId = component[0];
    const firstEdges = graph.get(firstRuleId);
    if (component.length === 1 && !firstEdges?.has(firstRuleId)) {
      continue;
    }
    const names = component.map((ruleId) => rules[ruleId].name).sort();
    diagnostics.push({
      code: "NULLABLE_RECURSIVE_CYCLE",
      severity: "warning",
      message:
        `Nullable recursive rule cycle can derive empty text indefinitely: ${
          names.join(", ")
        }.`,
      span: rules[firstRuleId].span,
      related: component.slice(1).map((ruleId) => ({
        message: `Cycle member '${rules[ruleId].name}'.`,
        span: rules[ruleId].span,
      })),
    });
  }
  return diagnostics;
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

  const visit = (ruleId: RuleId): void => {
    indexByRule.set(ruleId, nextIndex);
    lowlinkByRule.set(ruleId, nextIndex);
    nextIndex++;
    stack.push(ruleId);
    onStack.add(ruleId);

    const targets = graph.get(ruleId);
    if (targets === undefined) {
      throw new Error(`Missing nullable-rule graph entry for rule ${ruleId}.`);
    }
    for (const target of targets) {
      if (!graph.has(target)) {
        continue;
      }
      if (!indexByRule.has(target)) {
        visit(target);
        const ruleLowlink = lowlinkByRule.get(ruleId);
        const targetLowlink = lowlinkByRule.get(target);
        if (ruleLowlink === undefined || targetLowlink === undefined) {
          throw new Error(
            `Missing nullable-rule lowlink for edge ${ruleId} -> ${target}.`,
          );
        }
        lowlinkByRule.set(ruleId, Math.min(ruleLowlink, targetLowlink));
      } else if (onStack.has(target)) {
        const ruleLowlink = lowlinkByRule.get(ruleId);
        const targetIndex = indexByRule.get(target);
        if (ruleLowlink === undefined || targetIndex === undefined) {
          throw new Error(
            `Missing nullable-rule index for edge ${ruleId} -> ${target}.`,
          );
        }
        lowlinkByRule.set(ruleId, Math.min(ruleLowlink, targetIndex));
      }
    }

    if (lowlinkByRule.get(ruleId) !== indexByRule.get(ruleId)) {
      return;
    }
    const component: RuleId[] = [];
    while (stack.length > 0) {
      const member = stack.pop();
      if (member === undefined) {
        throw new Error(`Missing nullable-rule stack member for ${ruleId}.`);
      }
      onStack.delete(member);
      component.push(member);
      if (member === ruleId) {
        break;
      }
    }
    components.push(component);
  };

  for (const ruleId of graph.keys()) {
    if (!indexByRule.has(ruleId)) {
      visit(ruleId);
    }
  }
  return components;
}

function countProductiveIterations(rules: readonly AnalyzedRule[]): number {
  const productive = new Set<RuleId>();
  let iterations = 0;
  let changed = true;
  while (changed) {
    iterations++;
    changed = false;
    for (const rule of rules) {
      if (productive.has(rule.id)) {
        continue;
      }
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
      if (nullable.has(rule.id)) {
        continue;
      }
      if (isExpressionNullable(rule.expression, nullable)) {
        nullable.add(rule.id);
        changed = true;
      }
    }
  }
  return iterations;
}
