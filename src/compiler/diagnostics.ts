import type { Diagnostic, EbnfExpression, EbnfGrammar } from "../ast.ts";
import { analyzeRegexPattern } from "./regex/diagnostics.ts";

const reservedGrammarRuleNames = new Set(["source_file"]);
const reservedTokenDeclarationNames = new Set(["source_file"]);

/** Validates grammar-level semantics before generation. */
export function validateEbnfGrammar(
  grammar: EbnfGrammar,
  options: { rootRule?: string; externals?: readonly string[] } = {},
): void {
  const errors = collectGrammarDiagnostics(grammar, options).filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (errors.length > 0) {
    throw new Error(errors[0].message);
  }
}

/** Collects grammar-level semantic diagnostics without stopping at first error. */
export function collectGrammarDiagnostics(
  grammar: EbnfGrammar,
  options: {
    rootRule?: string;
    externals?: readonly string[];
    regexDiagnostics?: ReadonlyMap<number, readonly Diagnostic[]>;
  } = {},
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (grammar.rules.length === 0) {
    diagnostics.push({
      code: "GRAMMAR_EMPTY",
      severity: "error",
      message: "Expected at least one grammar rule",
      span: grammar.span,
    });
    return diagnostics;
  }

  const declaredNames = new Set<string>();
  const tokenNames = new Set<string>();
  const skipNames = new Set<string>();
  const externalNames = new Set(options.externals ?? []);
  const seenExternalNames = new Set<string>();
  for (const [index, external] of (options.externals ?? []).entries()) {
    const path = `metadata.externals[${index}]`;
    if (seenExternalNames.has(external)) {
      diagnostics.push({
        code: "DUPLICATE_DECLARATION",
        severity: "error",
        message: `Duplicate declaration '${external}'`,
        path,
      });
    }
    seenExternalNames.add(external);
    if (!isValidSymbolName(external)) {
      diagnostics.push({
        code: "INVALID_EXTERNAL_TOKEN",
        severity: "error",
        message: `Invalid external token name '${external}'`,
        path,
      });
    }
    if (reservedTokenDeclarationNames.has(external)) {
      diagnostics.push({
        code: "RESERVED_GENERATED_NAME",
        severity: "error",
        message: `External token '${external}' uses reserved generated name`,
        path,
      });
    }
    declaredNames.add(external);
  }
  for (const [index, token] of grammar.tokens.entries()) {
    if (reservedTokenDeclarationNames.has(token.name)) {
      diagnostics.push({
        code: "RESERVED_GENERATED_NAME",
        severity: "error",
        message: `Token '${token.name}' uses reserved generated name`,
        span: token.span,
      });
    }
    if (declaredNames.has(token.name)) {
      diagnostics.push({
        code: "DUPLICATE_DECLARATION",
        severity: "error",
        message: `Duplicate declaration '${token.name}'`,
        span: token.span,
      });
    }
    const regexDiagnostics = options.regexDiagnostics?.get(index) ??
      analyzeRegexPattern({
        pattern: token.pattern,
        label: `Invalid regex for token '${token.name}'`,
        code: "INVALID_TOKEN_REGEX",
        span: token.span,
      }).diagnostics;
    diagnostics.push(...regexDiagnostics);
    declaredNames.add(token.name);
    if (token.kind === "skip") skipNames.add(token.name);
    else tokenNames.add(token.name);
  }

  const ruleNames = new Set<string>();
  for (const rule of grammar.rules) {
    if (reservedGrammarRuleNames.has(rule.name)) {
      diagnostics.push({
        code: "RESERVED_GENERATED_NAME",
        severity: "error",
        message: `Rule '${rule.name}' uses reserved generated name`,
        span: rule.span,
      });
    }
    if (ruleNames.has(rule.name)) {
      diagnostics.push({
        code: "DUPLICATE_RULE",
        severity: "error",
        message: `Duplicate rule '${rule.name}'`,
        span: rule.span,
      });
    }
    if (declaredNames.has(rule.name)) {
      diagnostics.push({
        code: "DUPLICATE_DECLARATION",
        severity: "error",
        message: `Duplicate declaration '${rule.name}'`,
        span: rule.span,
      });
    }
    declaredNames.add(rule.name);
    ruleNames.add(rule.name);
  }

  if (options.rootRule && !ruleNames.has(options.rootRule)) {
    diagnostics.push({
      code: "UNKNOWN_ROOT_RULE",
      severity: "error",
      message: `Unknown root rule '${options.rootRule}'`,
    });
    return diagnostics;
  }

  const rootRuleName = options.rootRule ?? grammar.rules[0]?.name;
  const reachableRuleNames = rootRuleName
    ? collectReachableRuleNames(grammar, rootRuleName)
    : new Set<string>();
  for (const rule of grammar.rules) {
    if (!reachableRuleNames.has(rule.name)) continue;
    visitRefExpressions(rule.expression, (ref) => {
      const name = ref.name;
      if (skipNames.has(name)) {
        diagnostics.push({
          code: "SKIP_TOKEN_REFERENCE",
          severity: "error",
          message:
            `Rule '${rule.name}' references skip declaration '${name}'. Skip declarations are consumed as trivia and cannot appear in parser rules. Use a token declaration if ${name} must be syntactically significant.`,
          span: ref.span,
        });
        return;
      }
      if (
        ruleNames.has(name) ||
        tokenNames.has(name) ||
        externalNames.has(name)
      ) return;
      diagnostics.push({
        code: "UNKNOWN_RULE_REFERENCE",
        severity: "error",
        message: `Unknown rule reference '${name}' in rule '${rule.name}'`,
        span: ref.span,
      });
    });
  }
  return diagnostics;
}

/** Collects warnings for declarations omitted from the selected root graph. */
export function collectReachabilityDiagnostics(
  grammar: EbnfGrammar,
  rootRuleName: string,
): Diagnostic[] {
  const reachable = collectReachableRuleNames(grammar, rootRuleName);
  return grammar.rules
    .filter((rule) => !reachable.has(rule.name))
    .map((rule): Diagnostic => ({
      code: "UNREACHABLE_RULE",
      severity: "warning",
      message:
        `Rule '${rule.name}' is unreachable from root rule '${rootRuleName}' and was omitted from generated outputs.`,
      span: rule.span,
    }));
}

function collectReachableRuleNames(
  grammar: EbnfGrammar,
  rootRuleName: string,
): Set<string> {
  const rulesByName = new Map(grammar.rules.map((rule) => [rule.name, rule]));
  const reachable = new Set<string>();
  const queue = [rootRuleName];
  for (let index = 0; index < queue.length; index++) {
    const name = queue[index];
    if (reachable.has(name)) continue;
    const rule = rulesByName.get(name);
    if (!rule) continue;
    reachable.add(name);
    visitRefExpressions(rule.expression, (ref) => {
      if (rulesByName.has(ref.name) && !reachable.has(ref.name)) {
        queue.push(ref.name);
      }
    });
  }
  return reachable;
}

function isValidSymbolName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function visitRefExpressions(
  expression: EbnfExpression,
  callback: (ref: Extract<EbnfExpression, { kind: "ref" }>) => void,
): void {
  switch (expression.kind) {
    case "ref":
      callback(expression);
      return;
    case "field":
      visitRefExpressions(expression.expression, callback);
      return;
    case "literal":
      return;
    case "sequence":
      for (const item of expression.items) visitRefExpressions(item, callback);
      return;
    case "choice":
      for (const option of expression.options) {
        visitRefExpressions(option, callback);
      }
      return;
    case "optional":
    case "repeat":
    case "repeat1":
      visitRefExpressions(expression.expression, callback);
      return;
    case "separated":
      visitRefExpressions(expression.item, callback);
      visitRefExpressions(expression.separator, callback);
      return;
  }
}
