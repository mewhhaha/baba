import type {
  Diagnostic,
  GrammarExpressionOperator,
  GrammarTerminalPattern,
  SourceSpan,
} from "../ast.ts";
import type {
  AnalyzedGrammar,
  AnalyzedGrammarExpression,
  GrammarExpressionIslandId,
  GrammarRuleId,
} from "./grammar_ir.ts";
import type {
  GrammarLexCandidateSite,
  GrammarLexToken,
} from "./grammar_lexer.ts";

export interface GrammarPrattPlan {
  readonly islands: readonly GrammarPrattIslandPlan[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface GrammarPrattIslandPlan {
  readonly id: GrammarExpressionIslandId;
  readonly ruleId: GrammarRuleId;
  readonly atom: AnalyzedGrammarExpression;
  readonly operators: readonly GrammarPrattOperatorPlan[];
  readonly span: SourceSpan;
}

export interface GrammarPrattOperatorPlan {
  readonly kind: "prefix" | "postfix" | "infix";
  readonly associativity: "left" | "right" | "none" | undefined;
  readonly precedence: number;
  readonly token: GrammarTerminalPattern;
  readonly tokenNames: readonly string[];
  readonly span: SourceSpan;
}

export interface GrammarPrattParseOptions {
  readonly islandId?: GrammarExpressionIslandId;
  readonly startToken?: number;
  readonly candidateSites?: readonly GrammarLexCandidateSite[];
}

export interface GrammarPrattParseResult {
  readonly ok: boolean;
  readonly node: GrammarPrattNode | undefined;
  readonly nextToken: number;
  readonly diagnostics: readonly Diagnostic[];
}

export type GrammarPrattNode =
  | {
    readonly kind: "token";
    readonly name: string;
    readonly text: string;
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "sequence";
    readonly children: readonly GrammarPrattNode[];
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "prefix";
    readonly operator: string;
    readonly operand: GrammarPrattNode;
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "postfix";
    readonly operator: string;
    readonly operand: GrammarPrattNode;
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "infix";
    readonly operator: string;
    readonly left: GrammarPrattNode;
    readonly right: GrammarPrattNode;
    readonly span: SourceSpan;
  };

interface PrattRuntime {
  readonly analyzed: AnalyzedGrammar;
  readonly plan: GrammarPrattPlan;
  readonly tokens: readonly GrammarLexToken[];
  readonly candidateSites: ReadonlyMap<number, GrammarLexCandidateSite>;
  readonly diagnostics: Diagnostic[];
}

interface MatchResult {
  readonly node: GrammarPrattNode;
  readonly nextToken: number;
}

export function buildGrammarPrattPlan(
  analyzed: AnalyzedGrammar,
): GrammarPrattPlan {
  const diagnostics: Diagnostic[] = [];
  const islands: GrammarPrattIslandPlan[] = [];
  for (const island of analyzed.expressionIslands) {
    islands.push({
      id: island.id,
      ruleId: island.ruleId,
      atom: island.atom,
      operators: island.operators.map((operator) =>
        prattOperator(analyzed, operator, diagnostics)
      ),
      span: island.span,
    });
  }
  return { islands, diagnostics };
}

export function parseGrammarPrattExpression(
  analyzed: AnalyzedGrammar,
  plan: GrammarPrattPlan,
  tokens: readonly GrammarLexToken[],
  options: GrammarPrattParseOptions = {},
): GrammarPrattParseResult {
  let islandId = 0;
  if (options.islandId !== undefined) {
    islandId = options.islandId;
  }
  let startToken = 0;
  if (options.startToken !== undefined) {
    startToken = options.startToken;
  }
  const island = plan.islands.find((candidate) => candidate.id === islandId);
  if (island === undefined) {
    return {
      ok: false,
      node: undefined,
      nextToken: startToken,
      diagnostics: [{
        code: "GRAMMAR_PRATT_UNKNOWN_ISLAND",
        severity: "error",
        message: `Unknown expression island ${islandId}.`,
      }],
    };
  }
  const candidateSites = new Map<number, GrammarLexCandidateSite>();
  if (options.candidateSites !== undefined) {
    for (const site of options.candidateSites) {
      candidateSites.set(site.tokenIndex, site);
    }
  }
  const diagnostics: Diagnostic[] = [...plan.diagnostics];
  const runtime: PrattRuntime = {
    analyzed,
    plan,
    tokens,
    candidateSites,
    diagnostics,
  };
  const parsed = parseIsland(runtime, island, startToken, 0);
  if (parsed === undefined) {
    return { ok: false, node: undefined, nextToken: startToken, diagnostics };
  }
  let ok = true;
  if (diagnostics.length > 0) {
    ok = false;
  }
  return {
    ok,
    node: parsed.node,
    nextToken: parsed.nextToken,
    diagnostics,
  };
}

function prattOperator(
  analyzed: AnalyzedGrammar,
  operator: GrammarExpressionOperator,
  diagnostics: Diagnostic[],
): GrammarPrattOperatorPlan {
  const tokenNames: string[] = [];
  for (const token of analyzed.tokens) {
    if (samePattern(token.pattern, operator.token)) {
      tokenNames.push(token.name);
    }
  }
  if (tokenNames.length === 0) {
    diagnostics.push({
      code: "GRAMMAR_PRATT_UNREACHABLE_OPERATOR",
      severity: "error",
      message: "Expression operator does not match any lexer token.",
      span: operator.span,
    });
  }
  let associativity: "left" | "right" | "none" | undefined;
  if (operator.kind === "infix") {
    associativity = operator.associativity;
  }
  return {
    kind: operator.kind,
    associativity,
    precedence: operator.precedence,
    token: operator.token,
    tokenNames,
    span: operator.span,
  };
}

function parseIsland(
  runtime: PrattRuntime,
  island: GrammarPrattIslandPlan,
  tokenIndex: number,
  minPrecedence: number,
): MatchResult | undefined {
  let left = parsePrefixOrAtom(runtime, island, tokenIndex);
  if (left === undefined) {
    const token = runtime.tokens[tokenIndex];
    runtime.diagnostics.push(expectedOperandDiagnostic(island, token));
    return undefined;
  }

  while (true) {
    const token: GrammarLexToken | undefined = runtime.tokens[left.nextToken];
    if (token === undefined || token.kind === "eof") {
      return left;
    }
    const postfix = matchingOperator(
      runtime,
      island,
      token,
      left.nextToken,
      "postfix",
    );
    if (postfix !== undefined && postfix.precedence >= minPrecedence) {
      left = {
        node: {
          kind: "postfix",
          operator: operatorDisplay(postfix),
          operand: left.node,
          span: combineSpans(left.node.span, token.span),
        },
        nextToken: left.nextToken + 1,
      };
      continue;
    }
    const infix = matchingOperator(
      runtime,
      island,
      token,
      left.nextToken,
      "infix",
    );
    if (infix === undefined || infix.precedence < minPrecedence) {
      return left;
    }
    if (infix.associativity === "none" && left.node.kind === "infix") {
      if (left.node.operator === operatorDisplay(infix)) {
        runtime.diagnostics.push(nonAssociativeDiagnostic(infix, token));
        return left;
      }
    }
    let rightPrecedence = infix.precedence + 1;
    if (infix.associativity === "right") {
      rightPrecedence = infix.precedence;
    }
    const right = parseIsland(
      runtime,
      island,
      left.nextToken + 1,
      rightPrecedence,
    );
    if (right === undefined) {
      return left;
    }
    left = {
      node: {
        kind: "infix",
        operator: operatorDisplay(infix),
        left: left.node,
        right: right.node,
        span: combineSpans(left.node.span, right.node.span),
      },
      nextToken: right.nextToken,
    };
    if (infix.associativity === "none") {
      const next = runtime.tokens[left.nextToken];
      if (
        next !== undefined &&
        matchingSameInfix(runtime, island, next, left.nextToken, infix)
      ) {
        runtime.diagnostics.push(nonAssociativeDiagnostic(infix, next));
        return left;
      }
    }
  }
}

function parsePrefixOrAtom(
  runtime: PrattRuntime,
  island: GrammarPrattIslandPlan,
  tokenIndex: number,
): MatchResult | undefined {
  const token = runtime.tokens[tokenIndex];
  if (token !== undefined) {
    const prefix = matchingOperator(
      runtime,
      island,
      token,
      tokenIndex,
      "prefix",
    );
    if (prefix !== undefined) {
      const operand = parseIsland(
        runtime,
        island,
        tokenIndex + 1,
        prefix.precedence,
      );
      if (operand === undefined) {
        return undefined;
      }
      return {
        node: {
          kind: "prefix",
          operator: operatorDisplay(prefix),
          operand: operand.node,
          span: combineSpans(token.span, operand.node.span),
        },
        nextToken: operand.nextToken,
      };
    }
  }
  return matchExpression(runtime, island, island.atom, tokenIndex);
}

function matchExpression(
  runtime: PrattRuntime,
  island: GrammarPrattIslandPlan,
  expression: AnalyzedGrammarExpression,
  tokenIndex: number,
): MatchResult | undefined {
  if (expression.kind === "field" || expression.kind === "constructor") {
    return matchExpression(runtime, island, expression.expression, tokenIndex);
  }
  if (expression.kind === "ref") {
    return matchRefExpression(runtime, island, expression, tokenIndex);
  }
  if (expression.kind === "literal") {
    return matchLiteral(runtime, expression.value, tokenIndex);
  }
  if (expression.kind === "sequence") {
    return matchSequence(runtime, island, expression.items, tokenIndex);
  }
  if (expression.kind === "choice") {
    for (const option of expression.options) {
      const matched = matchExpression(runtime, island, option, tokenIndex);
      if (matched !== undefined) {
        return matched;
      }
    }
    return undefined;
  }
  if (expression.kind === "optional") {
    const matched = matchExpression(
      runtime,
      island,
      expression.expression,
      tokenIndex,
    );
    if (matched !== undefined) {
      return matched;
    }
    return emptySequence(tokenIndex, tokenSpan(runtime, tokenIndex));
  }
  if (expression.kind === "repeat" || expression.kind === "repeat1") {
    return matchRepeat(
      runtime,
      island,
      expression.expression,
      tokenIndex,
      expression.kind,
    );
  }
  if (expression.kind === "separated") {
    return matchSeparated(runtime, island, expression, tokenIndex);
  }
  if (expression.kind === "expressionIsland") {
    const nested = runtime.plan.islands.find((candidate) =>
      candidate.id === expression.islandId
    );
    if (nested === undefined) {
      throw new Error(`Missing Pratt island ${expression.islandId}.`);
    }
    return parseIsland(runtime, nested, tokenIndex, 0);
  }
  throw new Error("Unsupported grammar expression kind.");
}

function matchRefExpression(
  runtime: PrattRuntime,
  island: GrammarPrattIslandPlan,
  expression: Extract<AnalyzedGrammarExpression, { kind: "ref" }>,
  tokenIndex: number,
): MatchResult | undefined {
  if (expression.reference.kind === "rule") {
    if (expression.reference.ruleId === island.ruleId) {
      return parseIsland(runtime, island, tokenIndex, 0);
    }
    const rule = runtime.analyzed.rules[expression.reference.ruleId];
    if (rule === undefined) {
      throw new Error(`Missing rule ${expression.reference.ruleId}.`);
    }
    return matchExpression(runtime, island, rule.expression, tokenIndex);
  }
  if (
    expression.reference.kind === "token" ||
    expression.reference.kind === "skip"
  ) {
    const token = runtime.analyzed.tokens[expression.reference.tokenId];
    if (token === undefined) {
      throw new Error(`Missing token ${expression.reference.tokenId}.`);
    }
    return matchTokenName(runtime, token.name, tokenIndex);
  }
  if (expression.reference.kind === "literal") {
    const literal = runtime.analyzed.literals[expression.reference.literalId];
    if (literal === undefined) {
      throw new Error(`Missing literal ${expression.reference.literalId}.`);
    }
    return matchLiteral(runtime, literal.value, tokenIndex);
  }
  return undefined;
}

function matchSequence(
  runtime: PrattRuntime,
  island: GrammarPrattIslandPlan,
  expressions: readonly AnalyzedGrammarExpression[],
  tokenIndex: number,
): MatchResult | undefined {
  const children: GrammarPrattNode[] = [];
  let cursor = tokenIndex;
  for (const expression of expressions) {
    const matched = matchExpression(runtime, island, expression, cursor);
    if (matched === undefined) {
      return undefined;
    }
    children.push(matched.node);
    cursor = matched.nextToken;
  }
  return {
    node: {
      kind: "sequence",
      children,
      span: spanForChildren(children, tokenSpan(runtime, tokenIndex)),
    },
    nextToken: cursor,
  };
}

function matchRepeat(
  runtime: PrattRuntime,
  island: GrammarPrattIslandPlan,
  expression: AnalyzedGrammarExpression,
  tokenIndex: number,
  kind: "repeat" | "repeat1",
): MatchResult | undefined {
  const children: GrammarPrattNode[] = [];
  let cursor = tokenIndex;
  while (true) {
    const matched = matchExpression(runtime, island, expression, cursor);
    if (matched === undefined || matched.nextToken === cursor) {
      break;
    }
    children.push(matched.node);
    cursor = matched.nextToken;
  }
  if (kind === "repeat1" && children.length === 0) {
    return undefined;
  }
  return {
    node: {
      kind: "sequence",
      children,
      span: spanForChildren(children, tokenSpan(runtime, tokenIndex)),
    },
    nextToken: cursor,
  };
}

function matchSeparated(
  runtime: PrattRuntime,
  island: GrammarPrattIslandPlan,
  expression: Extract<AnalyzedGrammarExpression, { kind: "separated" }>,
  tokenIndex: number,
): MatchResult | undefined {
  const first = matchExpression(runtime, island, expression.item, tokenIndex);
  if (first === undefined) {
    return undefined;
  }
  const children: GrammarPrattNode[] = [first.node];
  let cursor = first.nextToken;
  while (true) {
    const separator = matchExpression(
      runtime,
      island,
      expression.separator,
      cursor,
    );
    if (separator === undefined || separator.nextToken === cursor) {
      break;
    }
    const item = matchExpression(
      runtime,
      island,
      expression.item,
      separator.nextToken,
    );
    if (item === undefined || item.nextToken === separator.nextToken) {
      break;
    }
    children.push(separator.node);
    children.push(item.node);
    cursor = item.nextToken;
  }
  return {
    node: {
      kind: "sequence",
      children,
      span: spanForChildren(children, first.node.span),
    },
    nextToken: cursor,
  };
}

function matchTokenName(
  runtime: PrattRuntime,
  name: string,
  tokenIndex: number,
): MatchResult | undefined {
  const token = runtime.tokens[tokenIndex];
  if (token === undefined) {
    return undefined;
  }
  if (!tokenMatchesName(runtime, token, tokenIndex, name)) {
    return undefined;
  }
  return {
    node: {
      kind: "token",
      name: token.name,
      text: token.text,
      span: token.span,
    },
    nextToken: tokenIndex + 1,
  };
}

function matchLiteral(
  runtime: PrattRuntime,
  value: string,
  tokenIndex: number,
): MatchResult | undefined {
  const token = runtime.tokens[tokenIndex];
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
  return {
    node: {
      kind: "token",
      name: token.name,
      text: token.text,
      span: token.span,
    },
    nextToken: tokenIndex + 1,
  };
}

function matchingOperator(
  runtime: PrattRuntime,
  island: GrammarPrattIslandPlan,
  token: GrammarLexToken,
  tokenIndex: number,
  kind: "prefix" | "postfix" | "infix",
): GrammarPrattOperatorPlan | undefined {
  for (const operator of island.operators) {
    if (operator.kind !== kind) {
      continue;
    }
    if (operatorMatches(runtime, operator, token, tokenIndex)) {
      return operator;
    }
  }
  return undefined;
}

function matchingSameInfix(
  runtime: PrattRuntime,
  island: GrammarPrattIslandPlan,
  token: GrammarLexToken,
  tokenIndex: number,
  operator: GrammarPrattOperatorPlan,
): boolean {
  const matched = matchingOperator(runtime, island, token, tokenIndex, "infix");
  if (matched === undefined) {
    return false;
  }
  if (matched.precedence !== operator.precedence) {
    return false;
  }
  if (operatorDisplay(matched) !== operatorDisplay(operator)) {
    return false;
  }
  return true;
}

function operatorMatches(
  runtime: PrattRuntime,
  operator: GrammarPrattOperatorPlan,
  token: GrammarLexToken,
  tokenIndex: number,
): boolean {
  if (
    operator.token.kind === "literal" && token.text === operator.token.value
  ) {
    return true;
  }
  for (const name of operator.tokenNames) {
    if (tokenMatchesName(runtime, token, tokenIndex, name)) {
      return true;
    }
  }
  return false;
}

function tokenMatchesName(
  runtime: PrattRuntime,
  token: GrammarLexToken,
  tokenIndex: number,
  name: string,
): boolean {
  if (token.name === name) {
    return true;
  }
  const site = runtime.candidateSites.get(tokenIndex);
  if (site === undefined) {
    return false;
  }
  for (const candidate of site.candidates) {
    if (candidate.name === name) {
      return true;
    }
  }
  return false;
}

function samePattern(
  left: GrammarTerminalPattern,
  right: GrammarTerminalPattern,
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "literal" && right.kind === "literal") {
    return left.value === right.value;
  }
  if (left.kind === "regex" && right.kind === "regex") {
    return left.pattern === right.pattern;
  }
  return false;
}

function operatorDisplay(operator: GrammarPrattOperatorPlan): string {
  if (operator.token.kind === "literal") {
    return operator.token.value;
  }
  return `/${operator.token.pattern}/`;
}

function expectedOperandDiagnostic(
  island: GrammarPrattIslandPlan,
  token: GrammarLexToken | undefined,
): Diagnostic {
  let span = island.span;
  let found = "end of input";
  if (token !== undefined) {
    span = token.span;
    found = token.name;
  }
  return {
    code: "GRAMMAR_PRATT_EXPECTED_OPERAND",
    severity: "error",
    message: `Expected expression operand before ${found}.`,
    span,
  };
}

function nonAssociativeDiagnostic(
  operator: GrammarPrattOperatorPlan,
  token: GrammarLexToken,
): Diagnostic {
  return {
    code: "GRAMMAR_PRATT_NON_ASSOC_CHAIN",
    severity: "error",
    message: `Non-associative operator '${
      operatorDisplay(operator)
    }' cannot be chained.`,
    span: token.span,
  };
}

function emptySequence(
  tokenIndex: number,
  span: SourceSpan,
): MatchResult {
  return {
    node: {
      kind: "sequence",
      children: [],
      span,
    },
    nextToken: tokenIndex,
  };
}

function spanForChildren(
  children: readonly GrammarPrattNode[],
  fallback: SourceSpan,
): SourceSpan {
  if (children.length === 0) {
    return fallback;
  }
  return combineSpans(children[0].span, children[children.length - 1].span);
}

function tokenSpan(runtime: PrattRuntime, tokenIndex: number): SourceSpan {
  const token = runtime.tokens[tokenIndex];
  if (token !== undefined) {
    return token.span;
  }
  const last = runtime.tokens[runtime.tokens.length - 1];
  if (last !== undefined) {
    return last.span;
  }
  throw new Error("Cannot derive token span from an empty Pratt token stream.");
}

function combineSpans(left: SourceSpan, right: SourceSpan): SourceSpan {
  return {
    start: left.start,
    end: right.end,
    line: left.line,
    column: left.column,
  };
}
