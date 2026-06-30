import type { Diagnostic, SourceSpan } from "../ast.ts";
import type {
  AnalyzedGrammar,
  AnalyzedGrammarExpression,
  AnalyzedGrammarRule,
  GrammarRuleId,
} from "./grammar_ir.ts";
import {
  buildGrammarLexerPlan,
  type GrammarLexCandidateSite,
  type GrammarLexerPlan,
  type GrammarLexToken,
  lexGrammar,
} from "./grammar_lexer.ts";
import type {
  BnfGrammar,
  BnfProduction,
  BnfSymbol,
  NonterminalInfo,
  ReducerSpec,
  TerminalInfo,
} from "./runtime_plan/bnf.ts";
import {
  buildCanonicalLr1Table,
  type LrAction,
  type LrTable,
} from "./runtime_plan/lr1.ts";

export interface GrammarParserCorePlan {
  readonly bnf: BnfGrammar;
  readonly lr: LrTable;
  readonly lexer: GrammarLexerPlan;
  readonly diagnostics: readonly Diagnostic[];
}

export interface GrammarParseValidationResult {
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly acceptedTokens: number;
}

export interface GrammarParseRecoveryResult {
  readonly ok: boolean;
  readonly diagnostics: readonly GrammarParseRecoveryDiagnostic[];
  readonly acceptedTokens: number;
  readonly recoveryCount: number;
}

export interface GrammarParseRecoveryDiagnostic extends Diagnostic {
  readonly expected: readonly string[];
  readonly actual: string;
  readonly recoveryAction:
    | { readonly kind: "insert"; readonly token: string }
    | { readonly kind: "delete"; readonly token: string }
    | { readonly kind: "abort" };
}

export interface GrammarParserCoreOptions {
  readonly stateLimit?: number;
  readonly itemLimit?: number;
  readonly closureWorkLimit?: number;
  readonly tableEntryLimit?: number;
}

interface LoweringState {
  readonly analyzed: AnalyzedGrammar;
  readonly terminals: TerminalInfo[];
  readonly terminalByKey: Map<string, number>;
  readonly nonterminals: Array<{
    id: number;
    name: string;
    ruleId?: number;
    expressionId?: number;
  }>;
  readonly productions: BnfProduction[];
  readonly ruleNonterminals: Map<number, number>;
  readonly expressionNonterminals: Map<number, number>;
}

export function buildGrammarParserCorePlan(
  analyzed: AnalyzedGrammar,
  options: GrammarParserCoreOptions = {},
): GrammarParserCorePlan {
  const bnf = lowerGrammarToBnf(analyzed);
  let stateLimit = 20_000;
  if (options.stateLimit !== undefined) {
    stateLimit = options.stateLimit;
  }
  const lr = buildCanonicalLr1Table(bnf, {
    stateLimit,
    itemLimit: options.itemLimit,
    closureWorkLimit: options.closureWorkLimit,
    tableEntryLimit: options.tableEntryLimit,
  });
  const lexer = buildGrammarLexerPlan(analyzed);
  return {
    bnf,
    lr,
    lexer,
    diagnostics: [
      ...bnf.diagnostics,
      ...lr.diagnostics,
      ...lexer.diagnostics,
    ],
  };
}

export function validateGrammarParse(
  plan: GrammarParserCorePlan,
  source: string,
): GrammarParseValidationResult {
  const lexed = lexGrammar(plan.lexer, source, { preserveTrivia: false });
  const diagnostics: Diagnostic[] = [...lexed.diagnostics];
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics, acceptedTokens: 0 };
  }
  const candidateSites = new Map<
    number,
    GrammarLexCandidateSite["candidates"]
  >();
  for (const site of lexed.candidateSites) {
    candidateSites.set(site.tokenIndex, site.candidates);
  }
  const stack = [0];
  let cursor = 0;
  while (cursor < lexed.tokens.length) {
    const state = stack[stack.length - 1];
    const token = lexed.tokens[cursor];
    const action = selectAction(plan, state, token, cursor, candidateSites);
    if (action === undefined) {
      diagnostics.push(unexpectedTokenDiagnostic(plan, state, token));
      return { ok: false, diagnostics, acceptedTokens: cursor };
    }
    if (action.kind === "shift") {
      stack.push(action.state);
      cursor++;
      continue;
    }
    if (action.kind === "reduce") {
      applyReduction(plan, stack, action.production);
      continue;
    }
    return { ok: true, diagnostics, acceptedTokens: cursor };
  }
  return { ok: false, diagnostics, acceptedTokens: cursor };
}

export function recoverGrammarParse(
  plan: GrammarParserCorePlan,
  source: string,
  maxRecoveries = 64,
): GrammarParseRecoveryResult {
  const lexed = lexGrammar(plan.lexer, source, { preserveTrivia: false });
  const diagnostics: GrammarParseRecoveryDiagnostic[] = [];
  if (lexed.diagnostics.length > 0) {
    for (const diagnostic of lexed.diagnostics) {
      diagnostics.push({
        ...diagnostic,
        expected: [],
        actual: "ERROR",
        recoveryAction: { kind: "abort" },
      });
    }
    return { ok: false, diagnostics, acceptedTokens: 0, recoveryCount: 0 };
  }
  const candidateSites = new Map<
    number,
    GrammarLexCandidateSite["candidates"]
  >();
  for (const site of lexed.candidateSites) {
    candidateSites.set(site.tokenIndex, site.candidates);
  }
  const stack = [0];
  let cursor = 0;
  let recoveryCount = 0;
  while (cursor < lexed.tokens.length) {
    const state = stack[stack.length - 1];
    const token = lexed.tokens[cursor];
    const action = selectAction(plan, state, token, cursor, candidateSites);
    if (action === undefined) {
      if (recoveryCount >= maxRecoveries) {
        diagnostics.push(recoveryDiagnostic(plan, state, token, {
          kind: "abort",
        }));
        return {
          ok: false,
          diagnostics,
          acceptedTokens: cursor,
          recoveryCount,
        };
      }
      const deleted = tryDeleteToken(
        plan,
        state,
        lexed.tokens,
        cursor,
        candidateSites,
      );
      if (deleted) {
        diagnostics.push(recoveryDiagnostic(plan, state, token, {
          kind: "delete",
          token: token.name,
        }));
        cursor++;
        recoveryCount++;
        continue;
      }
      const inserted = tryInsertToken(plan, state, stack);
      if (inserted !== undefined) {
        diagnostics.push(recoveryDiagnostic(plan, state, token, {
          kind: "insert",
          token: inserted,
        }));
        recoveryCount++;
        continue;
      }
      diagnostics.push(recoveryDiagnostic(plan, state, token, {
        kind: "abort",
      }));
      return { ok: false, diagnostics, acceptedTokens: cursor, recoveryCount };
    }
    if (action.kind === "shift") {
      stack.push(action.state);
      cursor++;
      continue;
    }
    if (action.kind === "reduce") {
      applyReduction(plan, stack, action.production);
      continue;
    }
    return {
      ok: true,
      diagnostics,
      acceptedTokens: cursor,
      recoveryCount,
    };
  }
  return { ok: false, diagnostics, acceptedTokens: cursor, recoveryCount };
}

export function lowerGrammarToBnf(analyzed: AnalyzedGrammar): BnfGrammar {
  if (analyzed.rootRule === undefined) {
    return emptyBnf([{
      code: "GRAMMAR_MISSING_ROOT",
      severity: "error",
      message: "Cannot lower grammar without a root rule.",
    }]);
  }
  const terminals: TerminalInfo[] = [{
    id: 0,
    kind: "eof",
    key: "eof",
    display: "EOF",
  }];
  const terminalByKey = new Map<string, number>([["eof", 0]]);
  const nonterminals: NonterminalInfo[] = [{ id: 0, name: "$start" }];
  const ruleNonterminals = new Map<number, number>();
  for (const rule of analyzed.rules) {
    if (!analyzed.reachableRules.has(rule.id)) {
      continue;
    }
    const id = nonterminals.length;
    ruleNonterminals.set(rule.id, id);
    nonterminals.push({ id, name: rule.name, ruleId: rule.id });
  }
  const state: LoweringState = {
    analyzed,
    terminals,
    terminalByKey,
    nonterminals,
    productions: [],
    ruleNonterminals,
    expressionNonterminals: new Map(),
  };
  const root = ruleNonterminals.get(analyzed.rootRule);
  if (root === undefined) {
    return emptyBnf([{
      code: "GRAMMAR_MISSING_ROOT",
      severity: "error",
      message: "Root rule is not reachable.",
    }]);
  }
  addProduction(state, 0, [{ kind: "nonterminal", id: root }], {
    kind: "start",
  }, analyzed.rules[analyzed.rootRule].span);
  for (const rule of analyzed.rules) {
    if (!analyzed.reachableRules.has(rule.id)) {
      continue;
    }
    const expression = lowerExpression(state, rule, rule.expression);
    const lhs = ruleNonterminals.get(rule.id);
    if (lhs === undefined) {
      throw new Error(`Missing BNF nonterminal for rule '${rule.name}'.`);
    }
    addProduction(
      state,
      lhs,
      [{ kind: "nonterminal", id: expression }],
      { kind: "rule", ruleId: rule.id },
      rule.span,
      ruleOrigin(rule, rule.expression),
    );
  }
  return {
    startNonterminal: 0,
    rootRuleNonterminal: root,
    eofTerminal: 0,
    terminals,
    nonterminals,
    productions: state.productions,
    diagnostics: [],
  };
}

function lowerExpression(
  state: LoweringState,
  rule: AnalyzedGrammarRule,
  expression: AnalyzedGrammarExpression,
): number {
  const existing = state.expressionNonterminals.get(expression.id);
  if (existing !== undefined) {
    return existing;
  }
  const nonterminal = state.nonterminals.length;
  state.expressionNonterminals.set(expression.id, nonterminal);
  state.nonterminals.push({
    id: nonterminal,
    name: `$expr${expression.id}`,
    expressionId: expression.id,
  });
  const origin = expressionOrigin(rule, expression);

  if (expression.kind === "field" || expression.kind === "constructor") {
    addProduction(
      state,
      nonterminal,
      [{
        kind: "nonterminal",
        id: lowerExpression(state, rule, expression.expression),
      }],
      { kind: "identity" },
      expression.span,
      origin,
    );
  } else if (expression.kind === "ref") {
    lowerRefExpression(state, expression, nonterminal, origin);
  } else if (expression.kind === "literal") {
    addProduction(
      state,
      nonterminal,
      [{ kind: "terminal", id: literalTerminal(state, expression.literalId) }],
      { kind: "terminal" },
      expression.span,
      origin,
    );
  } else if (expression.kind === "sequence") {
    addProduction(
      state,
      nonterminal,
      expression.items.map((item) => ({
        kind: "nonterminal",
        id: lowerExpression(state, rule, item),
      })),
      { kind: "sequence" },
      expression.span,
      origin,
    );
  } else if (expression.kind === "choice") {
    for (const option of expression.options) {
      addProduction(
        state,
        nonterminal,
        [{ kind: "nonterminal", id: lowerExpression(state, rule, option) }],
        { kind: "identity" },
        option.span,
        expressionOrigin(rule, option),
      );
    }
  } else if (expression.kind === "optional") {
    addProduction(
      state,
      nonterminal,
      [],
      { kind: "optionalEmpty" },
      expression.span,
      origin,
    );
    addProduction(
      state,
      nonterminal,
      [{
        kind: "nonterminal",
        id: lowerExpression(state, rule, expression.expression),
      }],
      { kind: "optionalSome" },
      expression.span,
      origin,
    );
  } else if (expression.kind === "repeat") {
    const child = {
      kind: "nonterminal" as const,
      id: lowerExpression(state, rule, expression.expression),
    };
    addProduction(
      state,
      nonterminal,
      [],
      { kind: "repeatEmpty" },
      expression.span,
      origin,
    );
    addProduction(
      state,
      nonterminal,
      [{ kind: "nonterminal", id: nonterminal }, child],
      { kind: "repeatAppend" },
      expression.span,
      origin,
    );
  } else if (expression.kind === "repeat1") {
    const child = {
      kind: "nonterminal" as const,
      id: lowerExpression(state, rule, expression.expression),
    };
    addProduction(
      state,
      nonterminal,
      [child],
      { kind: "repeat1First" },
      expression.span,
      origin,
    );
    addProduction(
      state,
      nonterminal,
      [{ kind: "nonterminal", id: nonterminal }, child],
      { kind: "repeat1Append" },
      expression.span,
      origin,
    );
  } else if (expression.kind === "separated") {
    const item = {
      kind: "nonterminal" as const,
      id: lowerExpression(state, rule, expression.item),
    };
    const separator = {
      kind: "nonterminal" as const,
      id: lowerExpression(state, rule, expression.separator),
    };
    addProduction(
      state,
      nonterminal,
      [item],
      { kind: "separatedFirst" },
      expression.span,
      origin,
    );
    addProduction(
      state,
      nonterminal,
      [{ kind: "nonterminal", id: nonterminal }, separator, item],
      { kind: "separatedAppend" },
      expression.span,
      origin,
    );
  } else if (expression.kind === "expressionIsland") {
    addProduction(
      state,
      nonterminal,
      [{
        kind: "nonterminal",
        id: lowerExpression(state, rule, expression.atom),
      }],
      { kind: "identity" },
      expression.span,
      origin,
    );
  }
  return nonterminal;
}

function lowerRefExpression(
  state: LoweringState,
  expression: Extract<AnalyzedGrammarExpression, { kind: "ref" }>,
  nonterminal: number,
  origin: BnfProduction["origin"],
): void {
  if (expression.reference.kind === "rule") {
    const rule = state.ruleNonterminals.get(expression.reference.ruleId);
    if (rule !== undefined) {
      addProduction(
        state,
        nonterminal,
        [{ kind: "nonterminal", id: rule }],
        { kind: "ruleRef" },
        expression.span,
        origin,
      );
    }
  } else if (
    expression.reference.kind === "token" ||
    expression.reference.kind === "skip"
  ) {
    addProduction(
      state,
      nonterminal,
      [{
        kind: "terminal",
        id: tokenTerminal(state, expression.reference.tokenId),
      }],
      { kind: "terminal" },
      expression.span,
      origin,
    );
  } else if (expression.reference.kind === "literal") {
    const literal = state.analyzed.literals[expression.reference.literalId];
    if (literal === undefined) {
      throw new Error(`Missing literal ${expression.reference.literalId}.`);
    }
    let terminal = 0;
    if (literal.value !== "<EOF>") {
      terminal = literalTerminal(state, expression.reference.literalId);
    }
    addProduction(
      state,
      nonterminal,
      [{ kind: "terminal", id: terminal }],
      { kind: "terminal" },
      expression.span,
      origin,
    );
  }
}

function selectAction(
  plan: GrammarParserCorePlan,
  state: number,
  token: GrammarLexToken,
  tokenIndex: number,
  candidateSites: ReadonlyMap<number, GrammarLexCandidateSite["candidates"]>,
): LrAction | undefined {
  const candidates = candidateSites.get(tokenIndex);
  if (candidates !== undefined) {
    for (const candidate of candidates) {
      const terminal = terminalForTokenName(plan.bnf, candidate.name);
      if (terminal === undefined) {
        continue;
      }
      const action = firstAction(actionSet(plan, state, terminal));
      if (action !== undefined) {
        return action;
      }
    }
  }
  let terminal: number | undefined;
  if (token.kind === "eof") {
    terminal = plan.bnf.eofTerminal;
  } else {
    terminal = terminalForTokenName(plan.bnf, token.name);
  }
  if (terminal === undefined) {
    return undefined;
  }
  return firstAction(actionSet(plan, state, terminal));
}

function actionSet(
  plan: GrammarParserCorePlan,
  state: number,
  terminal: number,
): readonly LrAction[] | undefined {
  const row = plan.lr.actions.get(state);
  if (row === undefined) {
    return undefined;
  }
  return row.get(terminal);
}

function applyReduction(
  plan: GrammarParserCorePlan,
  stack: number[],
  productionId: number,
): void {
  const production = plan.bnf.productions[productionId];
  for (let index = 0; index < production.rhs.length; index++) {
    stack.pop();
  }
  const gotoRow = plan.lr.gotos.get(stack[stack.length - 1]);
  let gotoState: number | undefined;
  if (gotoRow !== undefined) {
    gotoState = gotoRow.get(production.lhs);
  }
  if (gotoState === undefined) {
    throw new Error(
      `Missing goto for state ${
        stack[stack.length - 1]
      } and nonterminal ${production.lhs}.`,
    );
  }
  stack.push(gotoState);
}

function tryDeleteToken(
  plan: GrammarParserCorePlan,
  state: number,
  tokens: readonly GrammarLexToken[],
  cursor: number,
  candidateSites: ReadonlyMap<number, GrammarLexCandidateSite["candidates"]>,
): boolean {
  const next = tokens[cursor + 1];
  if (next === undefined) {
    return false;
  }
  if (next.kind === "eof") {
    return false;
  }
  const action = selectAction(plan, state, next, cursor + 1, candidateSites);
  return action !== undefined;
}

function tryInsertToken(
  plan: GrammarParserCorePlan,
  state: number,
  stack: number[],
): string | undefined {
  const row = plan.lr.actions.get(state);
  if (row === undefined) {
    return undefined;
  }
  for (const [terminal, actions] of row) {
    const info = plan.bnf.terminals[terminal];
    if (info === undefined || info.kind === "eof") {
      continue;
    }
    const workingStack = [...stack];
    let currentState = state;
    let steps = 0;
    while (steps < plan.bnf.productions.length + 1) {
      steps++;
      const action = firstAction(actionSet(plan, currentState, terminal));
      if (action === undefined || action.kind === "accept") {
        break;
      }
      if (action.kind === "shift") {
        stack.splice(0, stack.length, ...workingStack, action.state);
        return info.display;
      }
      applyReduction(plan, workingStack, action.production);
      currentState = workingStack[workingStack.length - 1];
    }
    const direct = firstAction(actions);
    if (direct !== undefined && direct.kind === "shift") {
      stack.push(direct.state);
      return info.display;
    }
  }
  return undefined;
}

function firstAction(
  actions: readonly LrAction[] | undefined,
): LrAction | undefined {
  if (actions === undefined || actions.length === 0) {
    return undefined;
  }
  return actions[0];
}

function terminalForTokenName(
  bnf: BnfGrammar,
  name: string,
): number | undefined {
  const terminal = bnf.terminals.find((candidate) =>
    candidate.display === name
  );
  if (terminal === undefined) {
    return undefined;
  }
  return terminal.id;
}

function unexpectedTokenDiagnostic(
  plan: GrammarParserCorePlan,
  state: number,
  token: GrammarLexToken,
): Diagnostic {
  const expected = expectedTokenNames(plan, state);
  return {
    code: "GRAMMAR_PARSE_UNEXPECTED_TOKEN",
    severity: "error",
    message: `Unexpected token '${token.name}'. Expected: ${
      expected.join(", ")
    }.`,
    span: token.span,
  };
}

function recoveryDiagnostic(
  plan: GrammarParserCorePlan,
  state: number,
  token: GrammarLexToken,
  action: GrammarParseRecoveryDiagnostic["recoveryAction"],
): GrammarParseRecoveryDiagnostic {
  const expected = expectedTokenNames(plan, state);
  let message = `Unexpected token '${token.name}'. Expected: ${
    expected.join(", ")
  }.`;
  if (action.kind === "insert") {
    message =
      `Inserted missing token '${action.token}' before '${token.name}'. Expected: ${
        expected.join(", ")
      }.`;
  } else if (action.kind === "delete") {
    message = `Deleted unexpected token '${token.name}'. Expected: ${
      expected.join(", ")
    }.`;
  }
  return {
    code: "GRAMMAR_PARSE_RECOVERY",
    severity: "error",
    message,
    span: token.span,
    expected,
    actual: token.name,
    recoveryAction: action,
  };
}

function expectedTokenNames(
  plan: GrammarParserCorePlan,
  state: number,
): string[] {
  const row = plan.lr.actions.get(state);
  const expected: string[] = [];
  if (row !== undefined) {
    for (const terminal of row.keys()) {
      const info = plan.bnf.terminals[terminal];
      if (info !== undefined) {
        expected.push(info.display);
      }
    }
  }
  return expected;
}

function tokenTerminal(state: LoweringState, tokenId: number): number {
  const key = `named:${tokenId}`;
  const existing = state.terminalByKey.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const token = state.analyzed.tokens[tokenId];
  if (token === undefined) {
    throw new Error(`Missing token ${tokenId}.`);
  }
  const id = state.terminals.length;
  state.terminalByKey.set(key, id);
  state.terminals.push({
    id,
    kind: "named",
    key,
    display: token.name,
    tokenId,
  });
  return id;
}

function literalTerminal(state: LoweringState, literalId: number): number {
  const key = `literal:${literalId}`;
  const existing = state.terminalByKey.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const literal = state.analyzed.literals[literalId];
  if (literal === undefined) {
    throw new Error(`Missing literal ${literalId}.`);
  }
  const id = state.terminals.length;
  state.terminalByKey.set(key, id);
  state.terminals.push({
    id,
    kind: "literal",
    key,
    display: literal.value,
    literalId,
  });
  return id;
}

function addProduction(
  state: LoweringState,
  lhs: number,
  rhs: readonly BnfSymbol[],
  reducer: ReducerSpec,
  span?: SourceSpan,
  origin?: BnfProduction["origin"],
): void {
  state.productions.push({
    id: state.productions.length,
    lhs,
    rhs,
    reducer,
    span,
    origin,
  });
}

function ruleOrigin(
  rule: AnalyzedGrammarRule,
  expression: AnalyzedGrammarExpression,
): BnfProduction["origin"] {
  return {
    ruleId: rule.id as GrammarRuleId,
    ruleName: rule.name,
    expressionId: expression.id,
    span: expression.span,
    description: `${rule.name} expression`,
  };
}

function expressionOrigin(
  rule: AnalyzedGrammarRule,
  expression: AnalyzedGrammarExpression,
): BnfProduction["origin"] {
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    expressionId: expression.id,
    span: expression.span,
    description: `${rule.name} expression ${expression.id}`,
  };
}

function emptyBnf(diagnostics: readonly Diagnostic[]): BnfGrammar {
  return {
    startNonterminal: 0,
    rootRuleNonterminal: 0,
    eofTerminal: 0,
    terminals: [{ id: 0, kind: "eof", key: "eof", display: "EOF" }],
    nonterminals: [{ id: 0, name: "$start" }],
    productions: [],
    diagnostics,
  };
}
