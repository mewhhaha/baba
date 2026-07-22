import type {
  Diagnostic,
  GrammarDeclaration,
  GrammarDocument,
  GrammarExpression,
  GrammarExpressionOperator,
  GrammarModeDeclaration,
  GrammarRule,
  GrammarTerminalPattern,
  GrammarTokenDeclaration,
  SourceSpan,
} from "../ast.ts";
import type {
  AnalyzedGrammar,
  AnalyzedGrammarConstructor,
  AnalyzedGrammarExpression,
  AnalyzedGrammarExpressionIsland,
  AnalyzedGrammarExtension,
  AnalyzedGrammarField,
  AnalyzedGrammarLiteral,
  AnalyzedGrammarMode,
  AnalyzedGrammarRule,
  AnalyzedGrammarToken,
  GrammarConstructorId,
  GrammarExpressionId,
  GrammarExpressionIslandId,
  GrammarFieldId,
  GrammarLiteralId,
  GrammarModeId,
  GrammarResolvedReference,
  GrammarRuleId,
  GrammarTokenId,
} from "./grammar_ir.ts";
import type { RegexAst } from "./regex/ast.ts";
import { parseContextualRegex } from "./regex/contextual.ts";
import type { Dfa } from "./regex/dfa.ts";
import { parsePortableRegex } from "./regex/parser.ts";
import {
  dfaOverlapWitness,
  dfaUncoveredWitness,
  regexDfa,
} from "./regex/overlap.ts";

interface AnalyzeGrammarOptions {
  readonly rootRule?: string;
}

interface AnalyzerContext {
  readonly diagnostics: Diagnostic[];
  readonly modes: AnalyzedGrammarMode[];
  readonly tokens: AnalyzedGrammarToken[];
  readonly rules: AnalyzedGrammarRule[];
  readonly literals: AnalyzedGrammarLiteral[];
  readonly expressionIslands: AnalyzedGrammarExpressionIsland[];
  readonly constructors: AnalyzedGrammarConstructor[];
  readonly fields: AnalyzedGrammarField[];
  readonly modulesByName: Map<string, SourceSpan>;
  readonly exportsByName: Map<string, SourceSpan>;
  readonly tokensByName: Map<string, GrammarTokenId>;
  readonly modesByName: Map<string, GrammarModeId>;
  readonly rulesByName: Map<string, GrammarRuleId>;
  readonly syncByRuleName: Map<string, GrammarExpression>;
  readonly literalsByValue: Map<string, GrammarLiteralId>;
  readonly constructorIdsByShape: Map<string, GrammarConstructorId>;
  readonly fieldIdsByName: Map<string, GrammarFieldId>;
  readonly expressionIds: { next: number };
  readonly currentRuleId: { value: GrammarRuleId | undefined };
}

/** Lowers grammar syntax into deterministic target-neutral analysis data. */
export function analyzeGrammar(
  grammar: GrammarDocument,
  options: AnalyzeGrammarOptions = {},
): AnalyzedGrammar {
  const context = createAnalyzerContext();
  const defaultMode = addMode(context, "default", grammar.span);

  for (const declaration of grammar.declarations) {
    collectTopLevelName(context, declaration);
  }
  for (const declaration of grammar.declarations) {
    collectTopLevelTerminalsAndMetadata(context, declaration, defaultMode);
  }
  for (const declaration of grammar.declarations) {
    if (declaration.kind === "rule") {
      collectRule(context, declaration);
    }
  }

  const extensions: AnalyzedGrammarExtension[] = [];
  for (const declaration of grammar.declarations) {
    if (declaration.kind === "extend") {
      const expression = analyzeExpression(context, declaration.expression);
      extensions.push({
        target: declaration.target,
        expression,
        span: declaration.span,
      });
      if (!context.rulesByName.has(declaration.target)) {
        diagnostic(
          context,
          "GRAMMAR_UNKNOWN_EXTENSION_TARGET",
          `Unknown extension target '${declaration.target}'.`,
          declaration.span,
        );
      }
    }
  }

  analyzeRuleFacts(context);
  detectPrattLeftRecursion(context);
  const rootRule = selectRootRule(context, options.rootRule);
  const reachableRules = collectReachableRules(context.rules, rootRule);
  const reachableTokens = new Set<GrammarTokenId>();
  const reachableLiterals = new Set<GrammarLiteralId>();
  for (const rule of context.rules) {
    if (!reachableRules.has(rule.id)) {
      continue;
    }
    visitExpression(rule.expression, (expression) => {
      if (expression.kind === "literal") {
        reachableLiterals.add(expression.literalId);
      }
      if (expression.kind !== "ref") {
        return;
      }
      if (expression.reference.kind === "token") {
        reachableTokens.add(expression.reference.tokenId);
      }
      if (expression.reference.kind === "literal") {
        reachableLiterals.add(expression.reference.literalId);
      }
    });
  }
  analyzeTokenPatterns(context, reachableTokens);
  for (const rule of context.rules) {
    if (reachableRules.has(rule.id)) {
      continue;
    }
    diagnostic(
      context,
      "GRAMMAR_UNREACHABLE_RULE",
      `Rule '${rule.name}' is unreachable from the selected root.`,
      rule.span,
    );
  }
  for (const token of context.tokens) {
    if (token.kind === "skip") {
      continue;
    }
    if (reachableTokens.has(token.id)) {
      continue;
    }
    diagnostic(
      context,
      "GRAMMAR_UNUSED_TOKEN",
      `Token '${token.name}' is not referenced by any reachable rule.`,
      token.span,
    );
  }

  return {
    name: grammarName(grammar),
    rootRule,
    tokens: context.tokens,
    modes: context.modes,
    rules: context.rules,
    literals: context.literals,
    expressionIslands: context.expressionIslands,
    constructors: context.constructors,
    fields: context.fields,
    modules: [...context.modulesByName.entries()].map((entry, id) => ({
      id,
      name: entry[0],
      span: entry[1],
    })),
    exports: [...context.exportsByName.entries()].map((entry, id) => ({
      id,
      name: entry[0],
      span: entry[1],
    })),
    extensions,
    reachableRules,
    reachableTokens,
    reachableLiterals,
    diagnostics: context.diagnostics,
  };
}

function createAnalyzerContext(): AnalyzerContext {
  return {
    diagnostics: [],
    modes: [],
    tokens: [],
    rules: [],
    literals: [],
    expressionIslands: [],
    constructors: [],
    fields: [],
    modulesByName: new Map(),
    exportsByName: new Map(),
    tokensByName: new Map(),
    modesByName: new Map(),
    rulesByName: new Map(),
    syncByRuleName: new Map(),
    literalsByValue: new Map(),
    constructorIdsByShape: new Map(),
    fieldIdsByName: new Map(),
    expressionIds: { next: 0 },
    currentRuleId: { value: undefined },
  };
}

function grammarName(grammar: GrammarDocument): string {
  if (grammar.name !== undefined) {
    return grammar.name;
  }
  return "";
}

function collectTopLevelName(
  context: AnalyzerContext,
  declaration: GrammarDeclaration,
): void {
  if (declaration.kind === "rule") {
    if (isSyncOnlyRule(declaration)) {
      context.syncByRuleName.set(
        declaration.name,
        declaration.annotations[0].expression,
      );
      return;
    }
    const existing = context.rulesByName.get(declaration.name);
    if (existing !== undefined) {
      diagnostic(
        context,
        "GRAMMAR_DUPLICATE_RULE",
        `Duplicate rule '${declaration.name}'.`,
        declaration.span,
        context.rules[existing].span,
      );
      return;
    }
    const id = context.rules.length;
    context.rulesByName.set(declaration.name, id);
    context.rules.push({
      id,
      name: declaration.name,
      expression: emptyExpression(context, declaration.span),
      sync: undefined,
      nullable: false,
      productive: false,
      span: declaration.span,
    });
  } else if (declaration.kind === "module") {
    collectNamedSpan(
      context,
      context.modulesByName,
      declaration.name,
      declaration.span,
      "GRAMMAR_DUPLICATE_MODULE",
    );
  } else if (declaration.kind === "export") {
    collectNamedSpan(
      context,
      context.exportsByName,
      declaration.name,
      declaration.span,
      "GRAMMAR_DUPLICATE_EXPORT",
    );
  }
}

function collectTopLevelTerminalsAndMetadata(
  context: AnalyzerContext,
  declaration: GrammarDeclaration,
  defaultMode: GrammarModeId,
): void {
  if (
    declaration.kind === "token" || declaration.kind === "skip" ||
    declaration.kind === "contextual"
  ) {
    collectToken(context, declaration, defaultMode);
  } else if (declaration.kind === "mode") {
    collectMode(context, declaration);
  }
}

function collectMode(
  context: AnalyzerContext,
  declaration: GrammarModeDeclaration,
): void {
  const modeId = addMode(context, declaration.name, declaration.span);
  for (const token of declaration.declarations) {
    collectToken(context, token, modeId);
  }
}

function addMode(
  context: AnalyzerContext,
  name: string,
  span: SourceSpan,
): GrammarModeId {
  const existing = context.modesByName.get(name);
  if (existing !== undefined) {
    diagnostic(
      context,
      "GRAMMAR_DUPLICATE_MODE",
      `Duplicate lexer mode '${name}'.`,
      span,
      context.modes[existing].span,
    );
    return existing;
  }
  const id = context.modes.length;
  context.modesByName.set(name, id);
  context.modes.push({ id, name, span });
  return id;
}

function collectToken(
  context: AnalyzerContext,
  declaration: GrammarTokenDeclaration,
  fallbackModeId: GrammarModeId,
): void {
  let modeId = fallbackModeId;
  if (declaration.mode !== undefined) {
    const namedMode = context.modesByName.get(declaration.mode);
    if (namedMode === undefined) {
      diagnostic(
        context,
        "GRAMMAR_UNKNOWN_MODE",
        `Unknown lexer mode '${declaration.mode}'.`,
        declaration.span,
      );
    } else {
      modeId = namedMode;
    }
  }
  const existing = context.tokens.find((token) =>
    token.name === declaration.name && token.modeId === modeId
  );
  if (existing !== undefined) {
    diagnostic(
      context,
      "GRAMMAR_DUPLICATE_TOKEN",
      `Duplicate token '${declaration.name}'.`,
      declaration.span,
      existing.span,
    );
    return;
  }
  if (declaration.transition && declaration.transition.kind !== "pop") {
    const targetMode = context.modesByName.get(declaration.transition.mode);
    if (targetMode === undefined) {
      diagnostic(
        context,
        "GRAMMAR_UNKNOWN_MODE",
        `Unknown lexer mode '${declaration.transition.mode}'.`,
        declaration.transition.span,
      );
    }
  }
  const id = context.tokens.length;
  if (!context.tokensByName.has(declaration.name)) {
    context.tokensByName.set(declaration.name, id);
  }
  let priority = 0;
  if (declaration.priority !== undefined) {
    priority = declaration.priority;
  }
  context.tokens.push({
    id,
    name: declaration.name,
    kind: declaration.kind,
    pattern: declaration.pattern,
    priority,
    modeId,
    channel: declaration.channel,
    transition: declaration.transition,
    span: declaration.span,
  });
}

function collectRule(
  context: AnalyzerContext,
  declaration: GrammarRule,
): void {
  if (isSyncOnlyRule(declaration)) {
    return;
  }
  const ruleId = context.rulesByName.get(declaration.name);
  if (ruleId === undefined) {
    return;
  }
  if (context.rules[ruleId].span !== declaration.span) {
    return;
  }
  let sync: AnalyzedGrammarExpression | undefined;
  if (declaration.annotations.length > 0) {
    sync = analyzeExpression(context, declaration.annotations[0].expression);
    validateSyncExpression(context, sync);
  } else {
    const syncExpression = context.syncByRuleName.get(declaration.name);
    if (syncExpression !== undefined) {
      sync = analyzeExpression(context, syncExpression);
      validateSyncExpression(context, sync);
    }
  }
  context.currentRuleId.value = ruleId;
  const expression = analyzeExpression(context, declaration.expression);
  context.currentRuleId.value = undefined;
  context.rules[ruleId] = {
    id: ruleId,
    name: declaration.name,
    expression,
    sync,
    nullable: false,
    productive: false,
    span: declaration.span,
  };
}

function isSyncOnlyRule(rule: GrammarRule): boolean {
  if (rule.annotations.length === 0) {
    return false;
  }
  if (rule.expression.kind !== "sequence") {
    return false;
  }
  return rule.expression.items.length === 0;
}

function emptyExpression(
  context: AnalyzerContext,
  span: SourceSpan,
): AnalyzedGrammarExpression {
  return {
    id: nextExpressionId(context),
    kind: "sequence",
    items: [],
    span,
  };
}

function analyzeExpression(
  context: AnalyzerContext,
  expression: GrammarExpression,
): AnalyzedGrammarExpression {
  const id = nextExpressionId(context);
  if (expression.kind === "field") {
    collectField(context, expression.name, expression.span);
    return {
      id,
      kind: "field",
      name: expression.name,
      expression: analyzeExpression(context, expression.expression),
      span: expression.span,
    };
  }
  if (expression.kind === "ref") {
    return {
      id,
      kind: "ref",
      name: expression.name,
      reference: resolveReference(context, expression.name, expression.span),
      span: expression.span,
    };
  }
  if (expression.kind === "literal") {
    const literalId = literalIdFor(context, expression.value, expression.span);
    return {
      id,
      kind: "literal",
      value: expression.value,
      literalId,
      span: expression.span,
    };
  }
  if (expression.kind === "sequence") {
    return {
      id,
      kind: "sequence",
      items: expression.items.map((item) => analyzeExpression(context, item)),
      span: expression.span,
    };
  }
  if (expression.kind === "choice") {
    return {
      id,
      kind: "choice",
      options: expression.options.map((option) =>
        analyzeExpression(context, option)
      ),
      span: expression.span,
    };
  }
  if (expression.kind === "optional") {
    return {
      id,
      kind: "optional",
      expression: analyzeExpression(context, expression.expression),
      span: expression.span,
    };
  }
  if (expression.kind === "repeat") {
    return {
      id,
      kind: "repeat",
      expression: analyzeExpression(context, expression.expression),
      span: expression.span,
    };
  }
  if (expression.kind === "repeat1") {
    return {
      id,
      kind: "repeat1",
      expression: analyzeExpression(context, expression.expression),
      span: expression.span,
    };
  }
  if (expression.kind === "separated") {
    return {
      id,
      kind: "separated",
      item: analyzeExpression(context, expression.item),
      separator: analyzeExpression(context, expression.separator),
      span: expression.span,
    };
  }
  if (expression.kind === "constructor") {
    const innerExpression = analyzeExpression(context, expression.expression);
    validateConstructorFields(
      context,
      expression.name,
      expression.arguments,
      innerExpression,
      expression.span,
    );
    const constructorId = constructorIdFor(
      context,
      expression.name,
      expression.arguments,
      expression.span,
    );
    return {
      id,
      kind: "constructor",
      expression: innerExpression,
      constructorId,
      span: expression.span,
    };
  }
  const atom = analyzeExpression(context, expression.atom);
  validateExpressionOperators(context, expression.operators);
  const islandId: GrammarExpressionIslandId = context.expressionIslands.length;
  let ruleId: GrammarRuleId = -1;
  if (context.currentRuleId.value !== undefined) {
    ruleId = context.currentRuleId.value;
  }
  context.expressionIslands.push({
    id: islandId,
    ruleId,
    atom,
    operators: expression.operators,
    span: expression.span,
  });
  return {
    id,
    kind: "expressionIsland",
    islandId,
    atom,
    span: expression.span,
  };
}

function resolveReference(
  context: AnalyzerContext,
  name: string,
  span: SourceSpan,
): GrammarResolvedReference {
  const ruleId = context.rulesByName.get(name);
  if (ruleId !== undefined) {
    return { kind: "rule", ruleId };
  }
  const tokenId = context.tokensByName.get(name);
  if (tokenId !== undefined) {
    const token = context.tokens[tokenId];
    if (token.kind === "skip") {
      return { kind: "skip", tokenId };
    }
    return { kind: "token", tokenId };
  }
  if (name === "EOF") {
    const literalId = literalIdFor(context, "<EOF>", span);
    return { kind: "literal", literalId };
  }
  diagnostic(
    context,
    "GRAMMAR_UNKNOWN_REFERENCE",
    `Unknown reference '${name}'.`,
    span,
  );
  return { kind: "unknown", name };
}

interface TokenPatternAnalysis {
  readonly token: AnalyzedGrammarToken;
  readonly dfa: Dfa;
}

function analyzeTokenPatterns(
  context: AnalyzerContext,
  reachableTokens: ReadonlySet<GrammarTokenId>,
): void {
  const patterns: TokenPatternAnalysis[] = [];
  for (const token of context.tokens) {
    if (token.kind !== "skip" && !reachableTokens.has(token.id)) {
      continue;
    }
    const ast = tokenPatternAst(context, token);
    if (ast === undefined) {
      continue;
    }
    try {
      patterns.push({ token, dfa: regexDfa(ast) });
    } catch (error) {
      diagnostic(
        context,
        "GRAMMAR_INVALID_TOKEN_PATTERN",
        tokenPatternErrorMessage(token, error),
        token.span,
      );
    }
  }
  for (let leftIndex = 0; leftIndex < patterns.length; leftIndex++) {
    const left = patterns[leftIndex];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < patterns.length;
      rightIndex++
    ) {
      const right = patterns[rightIndex];
      let witness: string | null;
      try {
        witness = dfaOverlapWitness(left.dfa, right.dfa);
      } catch (error) {
        diagnostic(
          context,
          "GRAMMAR_TOKEN_OVERLAP_LIMIT",
          tokenPatternErrorMessage(right.token, error),
          right.token.span,
          left.token.span,
        );
        continue;
      }
      if (witness === null) {
        continue;
      }
      if (left.token.priority !== right.token.priority) {
        continue;
      }
      diagnostic(
        context,
        "GRAMMAR_TOKEN_OVERLAP",
        `${tokenLabel(left.token)} and ${
          tokenLabel(right.token)
        } can both match ${JSON.stringify(witness)}.`,
        right.token.span,
        left.token.span,
      );
    }
  }
  for (let tokenIndex = 0; tokenIndex < patterns.length; tokenIndex++) {
    const token = patterns[tokenIndex];
    if (token.token.kind === "skip") {
      continue;
    }
    const previousDfas = patterns
      .slice(0, tokenIndex)
      .filter((pattern) => pattern.token.priority === token.token.priority)
      .map((pattern) => pattern.dfa);
    if (previousDfas.length === 0) {
      continue;
    }
    let uncovered: string | null;
    try {
      uncovered = dfaUncoveredWitness(token.dfa, previousDfas);
    } catch (error) {
      diagnostic(
        context,
        "GRAMMAR_TOKEN_SHADOW_LIMIT",
        tokenPatternErrorMessage(token.token, error),
        token.token.span,
      );
      continue;
    }
    if (uncovered !== null) {
      continue;
    }
    const related = patterns
      .slice(0, tokenIndex)
      .filter((pattern) => pattern.token.priority === token.token.priority)
      .slice(0, 5)
      .map((pattern) => pattern.token.span);
    diagnosticWithRelated(
      context,
      "GRAMMAR_TOKEN_SHADOWED",
      `${
        tokenLabel(token.token)
      } is completely shadowed by earlier lexer candidates.`,
      token.token.span,
      related,
    );
  }
}

function tokenPatternAst(
  context: AnalyzerContext,
  token: AnalyzedGrammarToken,
): RegexAst | undefined {
  if (token.pattern.kind === "literal") {
    return literalAst(token.pattern.value);
  }
  try {
    if (token.kind === "contextual") {
      return parseContextualRegex(token.pattern.pattern).pattern;
    }
    return parsePortableRegex(token.pattern.pattern);
  } catch (error) {
    diagnostic(
      context,
      "GRAMMAR_INVALID_TOKEN_PATTERN",
      tokenPatternErrorMessage(token, error),
      token.pattern.span,
    );
    return undefined;
  }
}

function literalAst(value: string): RegexAst {
  const items: RegexAst[] = [];
  for (let index = 0; index < value.length;) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) {
      throw new Error("Expected literal code point.");
    }
    items.push({ kind: "literal", codePoint });
    if (codePoint > 0xffff) {
      index += 2;
    } else {
      index++;
    }
  }
  if (items.length === 0) {
    return { kind: "empty" };
  }
  if (items.length === 1) {
    return items[0];
  }
  return { kind: "sequence", items };
}

function tokenPatternErrorMessage(
  token: AnalyzedGrammarToken,
  error: unknown,
): string {
  if (error instanceof Error) {
    return `${
      tokenLabel(token)
    } has an invalid token pattern: ${error.message}`;
  }
  return `${tokenLabel(token)} has an invalid token pattern.`;
}

function tokenLabel(token: AnalyzedGrammarToken): string {
  return `${token.kind} '${token.name}'`;
}

function validateSyncExpression(
  context: AnalyzerContext,
  expression: AnalyzedGrammarExpression,
): void {
  if (expression.kind === "literal") {
    return;
  }
  if (expression.kind === "ref") {
    if (expression.reference.kind === "token") {
      return;
    }
    if (expression.reference.kind === "skip") {
      return;
    }
    if (expression.reference.kind === "literal") {
      return;
    }
    if (expression.reference.kind === "rule") {
      diagnostic(
        context,
        "GRAMMAR_INVALID_SYNC_REFERENCE",
        `Sync reference '${expression.name}' must resolve to a token, skip, literal, or EOF.`,
        expression.span,
      );
    }
    return;
  }
  if (expression.kind === "choice") {
    for (const option of expression.options) {
      validateSyncExpression(context, option);
    }
    return;
  }
  diagnostic(
    context,
    "GRAMMAR_INVALID_SYNC_DECLARATION",
    "Sync declarations must be a token, skip, literal, EOF, or a choice of those terminals.",
    expression.span,
  );
}

function validateConstructorFields(
  context: AnalyzerContext,
  constructorName: string,
  fields: readonly string[],
  expression: AnalyzedGrammarExpression,
  span: SourceSpan,
): void {
  const available = new Set<string>();
  collectConstructorFieldNames(expression, available);
  const seen = new Map<string, SourceSpan>();
  for (const field of fields) {
    const existing = seen.get(field);
    if (existing !== undefined) {
      diagnostic(
        context,
        "GRAMMAR_DUPLICATE_CONSTRUCTOR_FIELD",
        `Constructor '${constructorName}' lists field '${field}' more than once.`,
        span,
        existing,
      );
      continue;
    }
    seen.set(field, span);
    if (field === "text") {
      continue;
    }
    if (available.has(field)) {
      continue;
    }
    diagnostic(
      context,
      "GRAMMAR_INVALID_CONSTRUCTOR_FIELD",
      `Constructor '${constructorName}' references unknown field '${field}'.`,
      span,
    );
  }
}

function collectConstructorFieldNames(
  expression: AnalyzedGrammarExpression,
  fields: Set<string>,
): void {
  if (expression.kind === "field") {
    fields.add(expression.name);
    collectConstructorFieldNames(expression.expression, fields);
  } else if (expression.kind === "ref") {
    if (expression.reference.kind !== "unknown") {
      fields.add(expression.name);
    }
  } else if (expression.kind === "sequence") {
    for (const item of expression.items) {
      collectConstructorFieldNames(item, fields);
    }
  } else if (expression.kind === "choice") {
    for (const option of expression.options) {
      collectConstructorFieldNames(option, fields);
    }
  } else if (
    expression.kind === "optional" || expression.kind === "repeat" ||
    expression.kind === "repeat1" || expression.kind === "constructor"
  ) {
    collectConstructorFieldNames(expression.expression, fields);
  } else if (expression.kind === "separated") {
    collectConstructorFieldNames(expression.item, fields);
    collectConstructorFieldNames(expression.separator, fields);
  } else if (expression.kind === "expressionIsland") {
    collectConstructorFieldNames(expression.atom, fields);
  }
}

function validateExpressionOperators(
  context: AnalyzerContext,
  operators: readonly GrammarExpressionOperator[],
): void {
  const operatorsByShape = new Map<string, SourceSpan>();
  const precedenceByToken = new Map<string, GrammarExpressionOperator>();
  for (const operator of operators) {
    const tokenKey = terminalPatternKey(operator.token);
    const associativity = operator.associativity;
    let associativityKey = "";
    if (associativity !== undefined) {
      associativityKey = associativity;
    }
    const shapeKey =
      `${operator.kind}:${associativityKey}:${operator.precedence}:${tokenKey}`;
    const existing = operatorsByShape.get(shapeKey);
    if (existing !== undefined) {
      diagnostic(
        context,
        "GRAMMAR_DUPLICATE_PRECEDENCE",
        "Duplicate expression operator precedence declaration.",
        operator.span,
        existing,
      );
    } else {
      operatorsByShape.set(shapeKey, operator.span);
    }
    const tokenConflictKey = `${operator.kind}:${tokenKey}`;
    const conflicting = precedenceByToken.get(tokenConflictKey);
    if (conflicting === undefined) {
      precedenceByToken.set(tokenConflictKey, operator);
      continue;
    }
    if (conflicting.precedence !== operator.precedence) {
      diagnostic(
        context,
        "GRAMMAR_PRECEDENCE_CONFLICT",
        "Expression operator has conflicting precedence declarations.",
        operator.span,
        conflicting.span,
      );
    }
  }
}

function terminalPatternKey(pattern: GrammarTerminalPattern): string {
  if (pattern.kind === "literal") {
    return `literal:${pattern.value}`;
  }
  return `regex:${pattern.pattern}`;
}

function analyzeRuleFacts(context: AnalyzerContext): void {
  const nullable = new Map<GrammarRuleId, boolean>();
  const productive = new Map<GrammarRuleId, boolean>();
  for (const rule of context.rules) {
    nullable.set(rule.id, false);
    productive.set(rule.id, false);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of context.rules) {
      if (
        !nullable.get(rule.id) && expressionNullable(rule.expression, nullable)
      ) {
        nullable.set(rule.id, true);
        changed = true;
      }
      if (
        !productive.get(rule.id) &&
        expressionProductive(rule.expression, productive)
      ) {
        productive.set(rule.id, true);
        changed = true;
      }
    }
  }
  for (let index = 0; index < context.rules.length; index++) {
    const rule = context.rules[index];
    let isNullable = false;
    if (nullable.get(rule.id) === true) {
      isNullable = true;
    }
    let isProductive = false;
    if (productive.get(rule.id) === true) {
      isProductive = true;
    }
    context.rules[index] = {
      ...rule,
      nullable: isNullable,
      productive: isProductive,
    };
    if (!isProductive) {
      diagnostic(
        context,
        "GRAMMAR_NONPRODUCTIVE_RULE",
        `Rule '${rule.name}' cannot produce a token or literal.`,
        rule.span,
      );
    }
    if (isNullable) {
      diagnostic(
        context,
        "GRAMMAR_EMPTY_ONLY_RULE",
        `Rule '${rule.name}' can match empty input.`,
        rule.span,
      );
    }
  }
}

function detectPrattLeftRecursion(context: AnalyzerContext): void {
  const nullableRules = new Map<GrammarRuleId, boolean>();
  for (const rule of context.rules) {
    nullableRules.set(rule.id, rule.nullable);
  }
  const firstRefsByRule = new Map<
    GrammarRuleId,
    readonly GrammarRuleId[]
  >();
  for (const rule of context.rules) {
    firstRefsByRule.set(
      rule.id,
      firstRuleRefs(rule.expression, nullableRules),
    );
  }
  for (const island of context.expressionIslands) {
    if (island.ruleId < 0) {
      continue;
    }
    const roots = firstRuleRefs(island.atom, nullableRules);
    for (const root of roots) {
      const cycle = findRuleCycle(
        root,
        island.ruleId,
        firstRefsByRule,
        new Set(),
      );
      if (cycle === undefined) {
        continue;
      }
      const names = [context.rules[island.ruleId].name];
      for (const ruleId of cycle) {
        names.push(context.rules[ruleId].name);
      }
      diagnosticWithRelated(
        context,
        "EXPR_LEFT_RECURSION",
        `Expression atom rule is left-recursive through ${names.join(" -> ")}.`,
        island.span,
        cycle.map((ruleId) => context.rules[ruleId].span),
      );
      break;
    }
  }
}

function firstRuleRefs(
  expression: AnalyzedGrammarExpression,
  nullableRules: ReadonlyMap<GrammarRuleId, boolean>,
): readonly GrammarRuleId[] {
  const refs = new Set<GrammarRuleId>();
  collectFirstRuleRefs(expression, nullableRules, refs);
  return [...refs];
}

function collectFirstRuleRefs(
  expression: AnalyzedGrammarExpression,
  nullableRules: ReadonlyMap<GrammarRuleId, boolean>,
  refs: Set<GrammarRuleId>,
): void {
  if (expression.kind === "ref") {
    if (expression.reference.kind === "rule") {
      refs.add(expression.reference.ruleId);
    }
  } else if (expression.kind === "field" || expression.kind === "constructor") {
    collectFirstRuleRefs(expression.expression, nullableRules, refs);
  } else if (expression.kind === "choice") {
    for (const option of expression.options) {
      collectFirstRuleRefs(option, nullableRules, refs);
    }
  } else if (expression.kind === "sequence") {
    for (const item of expression.items) {
      collectFirstRuleRefs(item, nullableRules, refs);
      if (!expressionNullable(item, nullableRules)) {
        break;
      }
    }
  } else if (
    expression.kind === "optional" || expression.kind === "repeat" ||
    expression.kind === "repeat1"
  ) {
    collectFirstRuleRefs(expression.expression, nullableRules, refs);
  } else if (expression.kind === "separated") {
    collectFirstRuleRefs(expression.item, nullableRules, refs);
  } else if (expression.kind === "expressionIsland") {
    collectFirstRuleRefs(expression.atom, nullableRules, refs);
  }
}

function findRuleCycle(
  ruleId: GrammarRuleId,
  targetRuleId: GrammarRuleId,
  firstRefsByRule: ReadonlyMap<GrammarRuleId, readonly GrammarRuleId[]>,
  visited: Set<GrammarRuleId>,
): readonly GrammarRuleId[] | undefined {
  if (visited.has(ruleId)) {
    return undefined;
  }
  if (ruleId === targetRuleId) {
    return [ruleId];
  }
  visited.add(ruleId);
  const refs = firstRefsByRule.get(ruleId);
  if (refs === undefined) {
    throw new Error(`Missing first-reference graph for rule ${ruleId}.`);
  }
  for (const ref of refs) {
    const cycle = findRuleCycle(
      ref,
      targetRuleId,
      firstRefsByRule,
      visited,
    );
    if (cycle !== undefined) {
      return [ruleId, ...cycle];
    }
  }
  visited.delete(ruleId);
  return undefined;
}

function expressionNullable(
  expression: AnalyzedGrammarExpression,
  nullableRules: ReadonlyMap<GrammarRuleId, boolean>,
): boolean {
  if (expression.kind === "sequence") {
    return expression.items.every((item) =>
      expressionNullable(item, nullableRules)
    );
  }
  if (expression.kind === "choice") {
    return expression.options.some((option) =>
      expressionNullable(option, nullableRules)
    );
  }
  if (expression.kind === "optional" || expression.kind === "repeat") {
    return true;
  }
  if (expression.kind === "field" || expression.kind === "constructor") {
    return expressionNullable(expression.expression, nullableRules);
  }
  if (expression.kind === "ref" && expression.reference.kind === "rule") {
    return nullableRules.get(expression.reference.ruleId) === true;
  }
  return false;
}

function expressionProductive(
  expression: AnalyzedGrammarExpression,
  productiveRules: ReadonlyMap<GrammarRuleId, boolean>,
): boolean {
  if (expression.kind === "literal") {
    return expression.value.length > 0;
  }
  if (expression.kind === "ref") {
    if (expression.reference.kind === "token") {
      return true;
    }
    if (expression.reference.kind === "rule") {
      return productiveRules.get(expression.reference.ruleId) === true;
    }
    if (expression.reference.kind === "literal") {
      return true;
    }
    return false;
  }
  if (expression.kind === "sequence") {
    return expression.items.some((item) =>
      expressionProductive(item, productiveRules)
    );
  }
  if (expression.kind === "choice") {
    return expression.options.some((option) =>
      expressionProductive(option, productiveRules)
    );
  }
  if (
    expression.kind === "optional" || expression.kind === "repeat" ||
    expression.kind === "repeat1" || expression.kind === "field" ||
    expression.kind === "constructor"
  ) {
    return expressionProductive(expression.expression, productiveRules);
  }
  if (expression.kind === "separated") {
    return expressionProductive(expression.item, productiveRules);
  }
  if (expression.kind === "expressionIsland") {
    return expressionProductive(expression.atom, productiveRules);
  }
  return false;
}

function collectReachableRules(
  rules: readonly AnalyzedGrammarRule[],
  rootRule: GrammarRuleId | undefined,
): ReadonlySet<GrammarRuleId> {
  const reachable = new Set<GrammarRuleId>();
  if (rootRule === undefined) {
    return reachable;
  }
  const queue = [rootRule];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined || reachable.has(id)) {
      continue;
    }
    reachable.add(id);
    const rule = rules[id];
    visitExpression(rule.expression, (expression) => {
      if (expression.kind !== "ref") {
        return;
      }
      if (expression.reference.kind === "rule") {
        queue.push(expression.reference.ruleId);
      }
    });
  }
  return reachable;
}

function selectRootRule(
  context: AnalyzerContext,
  requested: string | undefined,
): GrammarRuleId | undefined {
  if (requested !== undefined) {
    const root = context.rulesByName.get(requested);
    if (root === undefined) {
      diagnostic(
        context,
        "GRAMMAR_UNKNOWN_ROOT",
        `Unknown root rule '${requested}'.`,
        fallbackRootDiagnosticSpan(context),
      );
      return undefined;
    }
    return root;
  }
  if (context.rules.length === 0) {
    diagnostic(
      context,
      "GRAMMAR_MISSING_ROOT",
      "Grammar analysis requires at least one rule.",
      context.modes[0].span,
    );
    return undefined;
  }
  return context.rules[0].id;
}

function fallbackRootDiagnosticSpan(context: AnalyzerContext): SourceSpan {
  if (context.rules.length > 0) {
    return context.rules[0].span;
  }
  return context.modes[0].span;
}

function visitExpression(
  expression: AnalyzedGrammarExpression,
  visitor: (expression: AnalyzedGrammarExpression) => void,
): void {
  visitor(expression);
  if (expression.kind === "field" || expression.kind === "constructor") {
    visitExpression(expression.expression, visitor);
  } else if (expression.kind === "sequence") {
    for (const item of expression.items) {
      visitExpression(item, visitor);
    }
  } else if (expression.kind === "choice") {
    for (const option of expression.options) {
      visitExpression(option, visitor);
    }
  } else if (
    expression.kind === "optional" || expression.kind === "repeat" ||
    expression.kind === "repeat1"
  ) {
    visitExpression(expression.expression, visitor);
  } else if (expression.kind === "separated") {
    visitExpression(expression.item, visitor);
    visitExpression(expression.separator, visitor);
  } else if (expression.kind === "expressionIsland") {
    visitExpression(expression.atom, visitor);
  }
}

function collectField(
  context: AnalyzerContext,
  name: string,
  span: SourceSpan,
): GrammarFieldId {
  const existing = context.fieldIdsByName.get(name);
  if (existing !== undefined) {
    return existing;
  }
  const id = context.fields.length;
  context.fieldIdsByName.set(name, id);
  context.fields.push({ id, name, span });
  return id;
}

function constructorIdFor(
  context: AnalyzerContext,
  name: string,
  fields: readonly string[],
  span: SourceSpan,
): GrammarConstructorId {
  const key = `${name}(${fields.join(",")})`;
  const existing = context.constructorIdsByShape.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const id = context.constructors.length;
  context.constructorIdsByShape.set(key, id);
  context.constructors.push({ id, name, fields, span });
  return id;
}

function literalIdFor(
  context: AnalyzerContext,
  value: string,
  span: SourceSpan,
): GrammarLiteralId {
  const existing = context.literalsByValue.get(value);
  if (existing !== undefined) {
    return existing;
  }
  const id = context.literals.length;
  context.literalsByValue.set(value, id);
  context.literals.push({
    id,
    value,
    sourceOrder: id,
    span,
  });
  return id;
}

function collectNamedSpan(
  context: AnalyzerContext,
  map: Map<string, SourceSpan>,
  name: string,
  span: SourceSpan,
  duplicateCode: string,
): void {
  const existing = map.get(name);
  if (existing !== undefined) {
    diagnostic(
      context,
      duplicateCode,
      `Duplicate declaration '${name}'.`,
      span,
      existing,
    );
    return;
  }
  map.set(name, span);
}

function nextExpressionId(context: AnalyzerContext): GrammarExpressionId {
  const id = context.expressionIds.next;
  context.expressionIds.next++;
  return id;
}

function diagnostic(
  context: AnalyzerContext,
  code: string,
  message: string,
  span: SourceSpan,
  relatedSpan?: SourceSpan,
): void {
  const diagnostic: Diagnostic = {
    code,
    severity: "error",
    message,
    span,
  };
  if (relatedSpan !== undefined) {
    diagnostic.related = [{
      message: "Original declaration.",
      span: relatedSpan,
    }];
  }
  context.diagnostics.push(diagnostic);
}

function diagnosticWithRelated(
  context: AnalyzerContext,
  code: string,
  message: string,
  span: SourceSpan,
  relatedSpans: readonly SourceSpan[],
): void {
  const diagnostic: Diagnostic = {
    code,
    severity: "error",
    message,
    span,
  };
  if (relatedSpans.length > 0) {
    diagnostic.related = relatedSpans.map((relatedSpan) => ({
      message: "Related declaration.",
      span: relatedSpan,
    }));
  }
  context.diagnostics.push(diagnostic);
}
