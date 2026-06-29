import type { Diagnostic, SourceSpan } from "../ast.ts";
import type {
  AnalyzedGrammarV2,
  AnalyzedGrammarV2Expression,
  AnalyzedGrammarV2Rule,
  GrammarV2ConstructorId,
  GrammarV2RuleId,
} from "./grammar_v2_ir.ts";
import {
  type GrammarV2LexerPlan,
  type GrammarV2LexToken,
  lexGrammarV2,
} from "./grammar_v2_lexer.ts";

export type GrammarV2AstFieldCardinality =
  | "one"
  | "optional"
  | "many"
  | "nonempty";

export interface GrammarV2AstSchema {
  readonly constructors: readonly GrammarV2AstConstructorSchema[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface GrammarV2AstConstructorSchema {
  readonly id: GrammarV2ConstructorId;
  readonly name: string;
  readonly fields: readonly GrammarV2AstFieldSchema[];
  readonly span: SourceSpan;
}

export interface GrammarV2AstFieldSchema {
  readonly name: string;
  readonly cardinality: GrammarV2AstFieldCardinality;
  readonly valueType: string;
  readonly span: SourceSpan;
}

export interface GrammarV2AstMaterializeResult {
  readonly ast: GrammarV2AstValue;
  readonly diagnostics: readonly Diagnostic[];
  readonly acceptedTokens: number;
}

export type GrammarV2AstValue =
  | GrammarV2AstNode
  | GrammarV2AstToken
  | GrammarV2InvalidAstNode
  | readonly GrammarV2AstValue[]
  | undefined;

export interface GrammarV2AstNode {
  readonly kind: string;
  readonly fields: Readonly<Record<string, GrammarV2AstValue>>;
  readonly span: SourceSpan;
}

export interface GrammarV2AstToken {
  readonly kind: "Token";
  readonly token: string;
  readonly text: string;
  readonly span: SourceSpan;
}

export interface GrammarV2InvalidAstNode {
  readonly kind: "Invalid";
  readonly message: string;
  readonly span: SourceSpan;
}

interface CardinalityFact {
  readonly cardinality: GrammarV2AstFieldCardinality;
  readonly span: SourceSpan;
}

interface MatchState {
  readonly analyzed: AnalyzedGrammarV2;
  readonly tokens: readonly GrammarV2LexToken[];
  readonly diagnostics: Diagnostic[];
}

interface MatchResult {
  readonly value: GrammarV2AstValue;
  readonly captures: ReadonlyMap<string, GrammarV2AstValue>;
  readonly nextToken: number;
  readonly span: SourceSpan;
}

export function buildGrammarV2AstSchema(
  analyzed: AnalyzedGrammarV2,
): GrammarV2AstSchema {
  const diagnostics: Diagnostic[] = [];
  const constructors: GrammarV2AstConstructorSchema[] = [];
  for (const constructor of analyzed.constructors) {
    const expression = constructorExpression(analyzed, constructor.id);
    if (expression === undefined) {
      diagnostics.push({
        code: "AST_CONSTRUCTOR_EXPRESSION_MISSING",
        severity: "error",
        message:
          `Constructor '${constructor.name}' does not have an analyzed expression.`,
        span: constructor.span,
      });
      continue;
    }
    const fields: GrammarV2AstFieldSchema[] = [];
    for (const field of constructor.fields) {
      const facts = collectFieldFacts(expression.expression, field);
      if (facts.length === 0) {
        diagnostics.push({
          code: "AST_UNKNOWN_CONSTRUCTOR_FIELD",
          severity: "error",
          message:
            `Constructor '${constructor.name}' references unknown field '${field}'.`,
          span: constructor.span,
        });
        continue;
      }
      const cardinality = mergeCardinality(
        facts,
        diagnostics,
        constructor.name,
        field,
      );
      fields.push({
        name: field,
        cardinality,
        valueType: fieldValueType(analyzed, expression.expression, field),
        span: facts[0].span,
      });
    }
    constructors.push({
      id: constructor.id,
      name: constructor.name,
      fields,
      span: constructor.span,
    });
  }
  return { constructors, diagnostics };
}

export function emitGrammarV2AstTypes(schema: GrammarV2AstSchema): string {
  const lines: string[] = [
    'import type { SourceSpan } from "./mod.ts";',
    "",
    "export interface TokenText<Name extends string> {",
    '  readonly kind: "Token";',
    "  readonly token: Name;",
    "  readonly text: string;",
    "  readonly span: SourceSpan;",
    "}",
    "",
    "export interface InvalidAstNode {",
    '  readonly kind: "Invalid";',
    "  readonly message: string;",
    "  readonly span: SourceSpan;",
    "}",
    "",
  ];
  const names = schema.constructors.map((constructor) => constructor.name);
  if (names.length === 0) {
    lines.push("export type AstNode = InvalidAstNode;");
  } else {
    lines.push(`export type AstNode = ${names.join(" | ")} | InvalidAstNode;`);
  }
  lines.push("");
  for (const constructor of schema.constructors) {
    lines.push(`export interface ${constructor.name} {`);
    lines.push(`  readonly kind: "${constructor.name}";`);
    for (const field of constructor.fields) {
      lines.push(`  readonly ${field.name}: ${fieldType(field)};`);
    }
    lines.push("  readonly span: SourceSpan;");
    lines.push("}");
    lines.push("");
  }
  return lines.join("\n");
}

export function materializeGrammarV2Ast(
  analyzed: AnalyzedGrammarV2,
  lexer: GrammarV2LexerPlan,
  source: string,
): GrammarV2AstMaterializeResult {
  const lexed = lexGrammarV2(lexer, source, { preserveTrivia: false });
  const diagnostics: Diagnostic[] = [...lexed.diagnostics];
  if (analyzed.rootRule === undefined) {
    return {
      ast: invalidAst("Missing root rule.", eofSpan(lexed.tokens)),
      diagnostics,
      acceptedTokens: 0,
    };
  }
  const state: MatchState = {
    analyzed,
    tokens: lexed.tokens,
    diagnostics,
  };
  const rule = analyzed.rules[analyzed.rootRule];
  const matched = matchRule(state, rule, 0, new Set());
  if (matched === undefined) {
    const span = tokenSpan(lexed.tokens, 0);
    diagnostics.push({
      code: "AST_MATERIALIZE_UNEXPECTED_TOKEN",
      severity: "error",
      message: "Could not materialize AST from the root rule.",
      span,
    });
    return {
      ast: invalidAst("Could not materialize AST from the root rule.", span),
      diagnostics,
      acceptedTokens: 0,
    };
  }
  const eof = state.tokens[matched.nextToken];
  if (eof !== undefined && eof.kind !== "eof") {
    diagnostics.push({
      code: "AST_MATERIALIZE_TRAILING_TOKEN",
      severity: "error",
      message: `Unexpected trailing token '${eof.name}'.`,
      span: eof.span,
    });
  }
  return {
    ast: matched.value,
    diagnostics,
    acceptedTokens: matched.nextToken,
  };
}

function constructorExpression(
  analyzed: AnalyzedGrammarV2,
  constructorId: GrammarV2ConstructorId,
): Extract<AnalyzedGrammarV2Expression, { kind: "constructor" }> | undefined {
  for (const rule of analyzed.rules) {
    const found = findConstructorExpression(rule.expression, constructorId);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function findConstructorExpression(
  expression: AnalyzedGrammarV2Expression,
  constructorId: GrammarV2ConstructorId,
): Extract<AnalyzedGrammarV2Expression, { kind: "constructor" }> | undefined {
  if (expression.kind === "constructor") {
    if (expression.constructorId === constructorId) {
      return expression;
    }
    return findConstructorExpression(expression.expression, constructorId);
  }
  if (expression.kind === "field") {
    return findConstructorExpression(expression.expression, constructorId);
  }
  if (expression.kind === "sequence") {
    for (const item of expression.items) {
      const found = findConstructorExpression(item, constructorId);
      if (found !== undefined) {
        return found;
      }
    }
  } else if (expression.kind === "choice") {
    for (const option of expression.options) {
      const found = findConstructorExpression(option, constructorId);
      if (found !== undefined) {
        return found;
      }
    }
  } else if (
    expression.kind === "optional" ||
    expression.kind === "repeat" ||
    expression.kind === "repeat1"
  ) {
    return findConstructorExpression(expression.expression, constructorId);
  } else if (expression.kind === "separated") {
    return findConstructorExpression(expression.item, constructorId);
  } else if (expression.kind === "expressionIsland") {
    return findConstructorExpression(expression.atom, constructorId);
  }
  return undefined;
}

function collectFieldFacts(
  expression: AnalyzedGrammarV2Expression,
  field: string,
): readonly CardinalityFact[] {
  const facts: CardinalityFact[] = [];
  collectFieldFactsInto(expression, field, "one", facts);
  return facts;
}

function collectFieldFactsInto(
  expression: AnalyzedGrammarV2Expression,
  field: string,
  cardinality: GrammarV2AstFieldCardinality,
  facts: CardinalityFact[],
): void {
  if (expression.kind === "field") {
    if (expression.name === field) {
      facts.push({
        cardinality: fieldCardinality(cardinality, expression.expression),
        span: expression.span,
      });
    }
    collectFieldFactsInto(expression.expression, field, cardinality, facts);
    return;
  }
  if (expression.kind === "ref" && expression.name === field) {
    facts.push({ cardinality, span: expression.span });
    return;
  }
  if (expression.kind === "constructor") {
    collectFieldFactsInto(expression.expression, field, cardinality, facts);
  } else if (expression.kind === "sequence") {
    for (const item of expression.items) {
      collectFieldFactsInto(item, field, cardinality, facts);
    }
  } else if (expression.kind === "choice") {
    const optionFacts: CardinalityFact[] = [];
    for (const option of expression.options) {
      const before = optionFacts.length;
      collectFieldFactsInto(option, field, cardinality, optionFacts);
      if (optionFacts.length === before) {
        optionFacts.push({ cardinality: "optional", span: option.span });
      }
    }
    facts.push(...optionFacts);
  } else if (expression.kind === "optional") {
    collectFieldFactsInto(expression.expression, field, "optional", facts);
  } else if (expression.kind === "repeat") {
    collectFieldFactsInto(expression.expression, field, "many", facts);
  } else if (expression.kind === "repeat1") {
    collectFieldFactsInto(expression.expression, field, "nonempty", facts);
  } else if (expression.kind === "separated") {
    collectFieldFactsInto(expression.item, field, "nonempty", facts);
  } else if (expression.kind === "expressionIsland") {
    collectFieldFactsInto(expression.atom, field, cardinality, facts);
  }
}

function mergeCardinality(
  facts: readonly CardinalityFact[],
  diagnostics: Diagnostic[],
  constructorName: string,
  field: string,
): GrammarV2AstFieldCardinality {
  let cardinality = facts[0].cardinality;
  for (const fact of facts) {
    if (fact.cardinality === cardinality) {
      continue;
    }
    diagnostics.push({
      code: "AST_FIELD_CARDINALITY_CONFLICT",
      severity: "error",
      message:
        `Constructor '${constructorName}' field '${field}' has incompatible cardinalities.`,
      span: fact.span,
      related: [{
        message: `First inferred cardinality was '${cardinality}'.`,
        span: facts[0].span,
      }],
    });
    cardinality = widenCardinality(cardinality, fact.cardinality);
  }
  return cardinality;
}

function widenCardinality(
  left: GrammarV2AstFieldCardinality,
  right: GrammarV2AstFieldCardinality,
): GrammarV2AstFieldCardinality {
  if (left === "many" || right === "many") {
    return "many";
  }
  if (left === "nonempty" || right === "nonempty") {
    return "many";
  }
  if (left === "optional" || right === "optional") {
    return "optional";
  }
  return "one";
}

function fieldCardinality(
  outer: GrammarV2AstFieldCardinality,
  expression: AnalyzedGrammarV2Expression,
): GrammarV2AstFieldCardinality {
  let inner: GrammarV2AstFieldCardinality = "one";
  if (expression.kind === "optional") {
    inner = "optional";
  } else if (expression.kind === "repeat") {
    inner = "many";
  } else if (
    expression.kind === "repeat1" ||
    expression.kind === "separated"
  ) {
    inner = "nonempty";
  }
  if (outer === "many" || inner === "many") {
    return "many";
  }
  if (outer === "optional" || inner === "optional") {
    return "optional";
  }
  if (outer === "nonempty" || inner === "nonempty") {
    return "nonempty";
  }
  return "one";
}

function fieldValueType(
  analyzed: AnalyzedGrammarV2,
  expression: AnalyzedGrammarV2Expression,
  field: string,
): string {
  const target = findFieldInputExpression(expression, field);
  if (target === undefined) {
    return "AstNode";
  }
  return expressionValueType(analyzed, target);
}

function findFieldInputExpression(
  expression: AnalyzedGrammarV2Expression,
  field: string,
): AnalyzedGrammarV2Expression | undefined {
  if (expression.kind === "field") {
    if (expression.name === field) {
      return expression.expression;
    }
    return findFieldInputExpression(expression.expression, field);
  }
  if (expression.kind === "ref" && expression.name === field) {
    return expression;
  }
  if (expression.kind === "constructor") {
    return findFieldInputExpression(expression.expression, field);
  }
  if (expression.kind === "sequence") {
    for (const item of expression.items) {
      const found = findFieldInputExpression(item, field);
      if (found !== undefined) {
        return found;
      }
    }
  } else if (expression.kind === "choice") {
    for (const option of expression.options) {
      const found = findFieldInputExpression(option, field);
      if (found !== undefined) {
        return found;
      }
    }
  } else if (
    expression.kind === "optional" ||
    expression.kind === "repeat" ||
    expression.kind === "repeat1"
  ) {
    return findFieldInputExpression(expression.expression, field);
  } else if (expression.kind === "separated") {
    return findFieldInputExpression(expression.item, field);
  } else if (expression.kind === "expressionIsland") {
    return findFieldInputExpression(expression.atom, field);
  }
  return undefined;
}

function expressionValueType(
  analyzed: AnalyzedGrammarV2,
  expression: AnalyzedGrammarV2Expression,
): string {
  if (expression.kind === "ref") {
    if (expression.reference.kind === "token") {
      return `TokenText<"${expression.name}">`;
    }
    if (expression.reference.kind === "rule") {
      const rule = analyzed.rules[expression.reference.ruleId];
      if (rule === undefined) {
        throw new Error(`Missing rule ${expression.reference.ruleId}.`);
      }
      return ruleAstType(analyzed, rule);
    }
  }
  if (expression.kind === "literal") {
    return `TokenText<${JSON.stringify(expression.value)}>`;
  }
  if (expression.kind === "constructor") {
    const constructor = analyzed.constructors[expression.constructorId];
    if (constructor === undefined) {
      throw new Error(`Missing constructor ${expression.constructorId}.`);
    }
    return constructor.name;
  }
  if (expression.kind === "field") {
    return expressionValueType(analyzed, expression.expression);
  }
  if (
    expression.kind === "optional" ||
    expression.kind === "repeat" ||
    expression.kind === "repeat1"
  ) {
    return expressionValueType(analyzed, expression.expression);
  }
  if (expression.kind === "separated") {
    return expressionValueType(analyzed, expression.item);
  }
  return "AstNode";
}

function ruleAstType(
  analyzed: AnalyzedGrammarV2,
  rule: AnalyzedGrammarV2Rule,
): string {
  const names = new Set<string>();
  collectConstructorNames(analyzed, rule.expression, names);
  if (names.size === 0) {
    return "AstNode";
  }
  return [...names].join(" | ");
}

function collectConstructorNames(
  analyzed: AnalyzedGrammarV2,
  expression: AnalyzedGrammarV2Expression,
  names: Set<string>,
): void {
  if (expression.kind === "constructor") {
    const constructor = analyzed.constructors[expression.constructorId];
    if (constructor === undefined) {
      throw new Error(`Missing constructor ${expression.constructorId}.`);
    }
    names.add(constructor.name);
  } else if (expression.kind === "field") {
    collectConstructorNames(analyzed, expression.expression, names);
  } else if (expression.kind === "sequence") {
    for (const item of expression.items) {
      collectConstructorNames(analyzed, item, names);
    }
  } else if (expression.kind === "choice") {
    for (const option of expression.options) {
      collectConstructorNames(analyzed, option, names);
    }
  } else if (
    expression.kind === "optional" ||
    expression.kind === "repeat" ||
    expression.kind === "repeat1"
  ) {
    collectConstructorNames(analyzed, expression.expression, names);
  } else if (expression.kind === "separated") {
    collectConstructorNames(analyzed, expression.item, names);
  } else if (expression.kind === "expressionIsland") {
    collectConstructorNames(analyzed, expression.atom, names);
  } else if (
    expression.kind === "ref" && expression.reference.kind === "rule"
  ) {
    const rule = analyzed.rules[expression.reference.ruleId];
    if (rule === undefined) {
      throw new Error(`Missing rule ${expression.reference.ruleId}.`);
    }
    collectConstructorNames(analyzed, rule.expression, names);
  }
}

function fieldType(field: GrammarV2AstFieldSchema): string {
  let valueType = field.valueType;
  if (valueType.includes(" | ")) {
    valueType = `(${valueType})`;
  }
  if (field.cardinality === "many" || field.cardinality === "nonempty") {
    return `readonly ${valueType}[]`;
  }
  if (field.cardinality === "optional") {
    return `${valueType} | undefined`;
  }
  return valueType;
}

function matchRule(
  state: MatchState,
  rule: AnalyzedGrammarV2Rule,
  tokenIndex: number,
  activeRules: Set<GrammarV2RuleId>,
): MatchResult | undefined {
  if (activeRules.has(rule.id)) {
    return undefined;
  }
  activeRules.add(rule.id);
  const matched = matchExpression(
    state,
    rule.expression,
    tokenIndex,
    activeRules,
  );
  activeRules.delete(rule.id);
  return matched;
}

function matchExpression(
  state: MatchState,
  expression: AnalyzedGrammarV2Expression,
  tokenIndex: number,
  activeRules: Set<GrammarV2RuleId>,
): MatchResult | undefined {
  if (expression.kind === "constructor") {
    const matched = matchExpression(
      state,
      expression.expression,
      tokenIndex,
      activeRules,
    );
    if (matched === undefined) {
      return undefined;
    }
    const constructor = state.analyzed.constructors[expression.constructorId];
    if (constructor === undefined) {
      throw new Error(`Missing constructor ${expression.constructorId}.`);
    }
    const fields: Record<string, GrammarV2AstValue> = {};
    for (const field of constructor.fields) {
      fields[field] = matched.captures.get(field);
    }
    return {
      value: {
        kind: constructor.name,
        fields,
        span: matched.span,
      },
      captures: matched.captures,
      nextToken: matched.nextToken,
      span: matched.span,
    };
  }
  if (expression.kind === "field") {
    const matched = matchExpression(
      state,
      expression.expression,
      tokenIndex,
      activeRules,
    );
    if (matched === undefined) {
      return undefined;
    }
    const captures = new Map(matched.captures);
    captures.set(expression.name, matched.value);
    return {
      value: matched.value,
      captures,
      nextToken: matched.nextToken,
      span: matched.span,
    };
  }
  if (expression.kind === "ref") {
    return matchRef(state, expression, tokenIndex, activeRules);
  }
  if (expression.kind === "literal") {
    return matchLiteral(state, expression.value, tokenIndex);
  }
  if (expression.kind === "sequence") {
    return matchSequence(state, expression.items, tokenIndex, activeRules);
  }
  if (expression.kind === "choice") {
    for (const option of expression.options) {
      const matched = matchExpression(state, option, tokenIndex, activeRules);
      if (matched !== undefined) {
        return matched;
      }
    }
    return undefined;
  }
  if (expression.kind === "optional") {
    const matched = matchExpression(
      state,
      expression.expression,
      tokenIndex,
      activeRules,
    );
    if (matched !== undefined) {
      return matched;
    }
    return emptyMatch(state, tokenIndex);
  }
  if (expression.kind === "repeat" || expression.kind === "repeat1") {
    return matchRepeat(
      state,
      expression.expression,
      tokenIndex,
      expression.kind,
      activeRules,
    );
  }
  if (expression.kind === "separated") {
    return matchSeparated(state, expression, tokenIndex, activeRules);
  }
  if (expression.kind === "expressionIsland") {
    return matchExpression(state, expression.atom, tokenIndex, activeRules);
  }
  throw new Error("Unsupported AST materializer expression kind.");
}

function matchRef(
  state: MatchState,
  expression: Extract<AnalyzedGrammarV2Expression, { kind: "ref" }>,
  tokenIndex: number,
  activeRules: Set<GrammarV2RuleId>,
): MatchResult | undefined {
  if (expression.reference.kind === "token") {
    return matchToken(state, expression.name, tokenIndex);
  }
  if (expression.reference.kind === "literal") {
    const literal = state.analyzed.literals[expression.reference.literalId];
    if (literal === undefined) {
      throw new Error(`Missing literal ${expression.reference.literalId}.`);
    }
    return matchLiteral(state, literal.value, tokenIndex);
  }
  if (expression.reference.kind === "rule") {
    const rule = state.analyzed.rules[expression.reference.ruleId];
    if (rule === undefined) {
      throw new Error(`Missing rule ${expression.reference.ruleId}.`);
    }
    return matchRule(state, rule, tokenIndex, activeRules);
  }
  return undefined;
}

function matchSequence(
  state: MatchState,
  items: readonly AnalyzedGrammarV2Expression[],
  tokenIndex: number,
  activeRules: Set<GrammarV2RuleId>,
): MatchResult | undefined {
  let cursor = tokenIndex;
  const captures = new Map<string, GrammarV2AstValue>();
  const values: GrammarV2AstValue[] = [];
  let span = tokenSpan(state.tokens, tokenIndex);
  for (const item of items) {
    const matched = matchExpression(state, item, cursor, activeRules);
    if (matched === undefined) {
      return undefined;
    }
    mergeCaptures(captures, matched.captures);
    values.push(matched.value);
    cursor = matched.nextToken;
    span = combineSpans(span, matched.span);
  }
  return {
    value: values,
    captures,
    nextToken: cursor,
    span,
  };
}

function matchRepeat(
  state: MatchState,
  expression: AnalyzedGrammarV2Expression,
  tokenIndex: number,
  kind: "repeat" | "repeat1",
  activeRules: Set<GrammarV2RuleId>,
): MatchResult | undefined {
  const values: GrammarV2AstValue[] = [];
  const captures = new Map<string, GrammarV2AstValue>();
  let cursor = tokenIndex;
  let span = tokenSpan(state.tokens, tokenIndex);
  while (true) {
    const matched = matchExpression(state, expression, cursor, activeRules);
    if (matched === undefined || matched.nextToken === cursor) {
      break;
    }
    values.push(matched.value);
    mergeCaptures(captures, matched.captures);
    cursor = matched.nextToken;
    span = combineSpans(span, matched.span);
  }
  if (kind === "repeat1" && values.length === 0) {
    return undefined;
  }
  return {
    value: values,
    captures,
    nextToken: cursor,
    span,
  };
}

function matchSeparated(
  state: MatchState,
  expression: Extract<AnalyzedGrammarV2Expression, { kind: "separated" }>,
  tokenIndex: number,
  activeRules: Set<GrammarV2RuleId>,
): MatchResult | undefined {
  const first = matchExpression(
    state,
    expression.item,
    tokenIndex,
    activeRules,
  );
  if (first === undefined) {
    return undefined;
  }
  const captures = new Map(first.captures);
  const values: GrammarV2AstValue[] = [first.value];
  let cursor = first.nextToken;
  let span = first.span;
  while (true) {
    const separator = matchExpression(
      state,
      expression.separator,
      cursor,
      activeRules,
    );
    if (separator === undefined || separator.nextToken === cursor) {
      break;
    }
    const item = matchExpression(
      state,
      expression.item,
      separator.nextToken,
      activeRules,
    );
    if (item === undefined || item.nextToken === separator.nextToken) {
      break;
    }
    values.push(item.value);
    mergeCaptures(captures, item.captures);
    cursor = item.nextToken;
    span = combineSpans(span, item.span);
  }
  return {
    value: values,
    captures,
    nextToken: cursor,
    span,
  };
}

function matchToken(
  state: MatchState,
  name: string,
  tokenIndex: number,
): MatchResult | undefined {
  const token = state.tokens[tokenIndex];
  if (token === undefined || token.name !== name) {
    return undefined;
  }
  return tokenMatch(token, tokenIndex);
}

function matchLiteral(
  state: MatchState,
  value: string,
  tokenIndex: number,
): MatchResult | undefined {
  const token = state.tokens[tokenIndex];
  if (token === undefined) {
    return undefined;
  }
  if (value === "<EOF>") {
    if (token.kind !== "eof") {
      return undefined;
    }
  } else if (token.text !== value) {
    return undefined;
  }
  return tokenMatch(token, tokenIndex);
}

function tokenMatch(
  token: GrammarV2LexToken,
  tokenIndex: number,
): MatchResult {
  const captures = new Map<string, GrammarV2AstValue>();
  const value: GrammarV2AstToken = {
    kind: "Token",
    token: token.name,
    text: token.text,
    span: token.span,
  };
  captures.set(token.name, value);
  return {
    value,
    captures,
    nextToken: tokenIndex + 1,
    span: token.span,
  };
}

function emptyMatch(
  state: MatchState,
  tokenIndex: number,
): MatchResult {
  const span = tokenSpan(state.tokens, tokenIndex);
  return {
    value: undefined,
    captures: new Map(),
    nextToken: tokenIndex,
    span: {
      start: span.start,
      end: span.start,
      line: span.line,
      column: span.column,
    },
  };
}

function mergeCaptures(
  target: Map<string, GrammarV2AstValue>,
  source: ReadonlyMap<string, GrammarV2AstValue>,
): void {
  for (const [name, value] of source) {
    const existing = target.get(name);
    if (existing === undefined) {
      target.set(name, value);
      continue;
    }
    const values: GrammarV2AstValue[] = [];
    if (Array.isArray(existing)) {
      values.push(...existing);
    } else {
      values.push(existing);
    }
    if (Array.isArray(value)) {
      values.push(...value);
    } else {
      values.push(value);
    }
    target.set(name, values);
  }
}

function tokenSpan(
  tokens: readonly GrammarV2LexToken[],
  index: number,
): SourceSpan {
  const token = tokens[index];
  if (token !== undefined) {
    return token.span;
  }
  return eofSpan(tokens);
}

function eofSpan(tokens: readonly GrammarV2LexToken[]): SourceSpan {
  const last = tokens[tokens.length - 1];
  if (last !== undefined) {
    return last.span;
  }
  return { start: 0, end: 0, line: 1, column: 1 };
}

function combineSpans(left: SourceSpan, right: SourceSpan): SourceSpan {
  return {
    start: left.start,
    end: right.end,
    line: left.line,
    column: left.column,
  };
}

function invalidAst(
  message: string,
  span: SourceSpan,
): GrammarV2InvalidAstNode {
  return { kind: "Invalid", message, span };
}
