import type { Diagnostic } from "../../ast.ts";
import {
  computeNullableRules,
  isExpressionNullable,
  visitAnalyzedExpression,
} from "../../compiler/analyze.ts";
import type {
  AnalyzedExpression,
  AnalyzedGrammar,
  AnalyzedRule,
  RuleId,
} from "../../compiler/ir.ts";

export type TerminalKind = "eof" | "named" | "literal";

export interface TerminalInfo {
  id: number;
  kind: TerminalKind;
  key: string;
  display: string;
  tokenId?: number;
  literalId?: number;
}

export interface NonterminalInfo {
  id: number;
  name: string;
  ruleId?: RuleId;
  expressionId?: number;
}

export type BnfSymbol =
  | { kind: "terminal"; id: number }
  | { kind: "nonterminal"; id: number };

export type ReducerSpec =
  | { kind: "start" }
  | { kind: "rule"; ruleId: RuleId }
  | { kind: "terminal" }
  | { kind: "ruleRef" }
  | { kind: "identity" }
  | { kind: "sequence" }
  | { kind: "optionalEmpty" }
  | { kind: "optionalSome" }
  | { kind: "repeatEmpty" }
  | { kind: "repeatAppend" }
  | { kind: "repeat1First" }
  | { kind: "repeat1Append" }
  | { kind: "separatedFirst" }
  | { kind: "separatedAppend" }
  | { kind: "field"; name: string };

export interface BnfProduction {
  id: number;
  lhs: number;
  rhs: readonly BnfSymbol[];
  reducer: ReducerSpec;
  span?: { start: number; end: number; line: number; column: number };
  origin?: ProductionOrigin;
}

export interface ProductionOrigin {
  ruleId: RuleId;
  ruleName: string;
  expressionId?: number;
  span: { start: number; end: number; line: number; column: number };
  description: string;
}

export interface BnfGrammar {
  startNonterminal: number;
  rootRuleNonterminal: number;
  eofTerminal: number;
  terminals: readonly TerminalInfo[];
  nonterminals: readonly NonterminalInfo[];
  productions: readonly BnfProduction[];
  diagnostics: readonly Diagnostic[];
}

interface LoweringState {
  analyzed: AnalyzedGrammar;
  terminals: TerminalInfo[];
  terminalByKey: Map<string, number>;
  nonterminals: NonterminalInfo[];
  productions: BnfProduction[];
  ruleNonterminals: Map<RuleId, number>;
  expressionNonterminals: Map<number, number>;
  nullableRules: ReadonlySet<RuleId>;
}

export function lowerToBnf(analyzed: AnalyzedGrammar): BnfGrammar {
  const terminals: TerminalInfo[] = [{
    id: 0,
    kind: "eof",
    key: "eof",
    display: "EOF",
  }];
  const terminalByKey = new Map<string, number>([["eof", 0]]);
  const addTerminal = (terminal: Omit<TerminalInfo, "id">) => {
    if (terminalByKey.has(terminal.key)) return;
    const id = terminals.length;
    terminalByKey.set(terminal.key, id);
    terminals.push({ id, ...terminal });
  };

  for (const token of analyzed.tokens) {
    if (token.kind !== "token" || !analyzed.reachableTokens.has(token.id)) {
      continue;
    }
    addTerminal({
      kind: "named",
      key: `named:${token.id}`,
      display: token.name,
      tokenId: token.id,
    });
  }
  for (const literal of analyzed.literals) {
    if (!analyzed.reachableLiterals.has(literal.id)) continue;
    addTerminal({
      kind: "literal",
      key: `literal:${literal.id}`,
      display: JSON.stringify(literal.value),
      literalId: literal.id,
    });
  }

  const nonterminals: NonterminalInfo[] = [{
    id: 0,
    name: "$start",
  }];
  const ruleNonterminals = new Map<RuleId, number>();
  for (const rule of analyzed.rules) {
    if (!analyzed.reachableRules.has(rule.id)) continue;
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
    nullableRules: computeNullableRules(analyzed),
  };

  addProduction(
    state,
    0,
    [{
      kind: "nonterminal",
      id: ruleNonterminals.get(analyzed.rootRule)!,
    }],
    { kind: "start" },
    analyzed.rules[analyzed.rootRule]?.span,
  );

  const diagnostics: Diagnostic[] = [];
  for (const rule of analyzed.rules) {
    if (!analyzed.reachableRules.has(rule.id)) continue;
    visitAnalyzedExpression(rule.expression, (expression) => {
      if (
        (expression.kind === "repeat" || expression.kind === "repeat1") &&
        isExpressionNullable(expression.expression, state.nullableRules)
      ) {
        diagnostics.push({
          code: "TS_PARSER_NULLABLE_REPETITION",
          severity: "error",
          backend: "typescript",
          message:
            "The portable parser cannot lower repetition whose body is nullable.",
          span: expression.span,
        });
      }
      if (
        expression.kind === "separated" &&
        isExpressionNullable(expression.item, state.nullableRules)
      ) {
        diagnostics.push({
          code: "TS_PARSER_NULLABLE_LIST_ITEM",
          severity: "error",
          backend: "typescript",
          message:
            "The portable parser cannot lower a separated list whose item is nullable.",
          span: expression.item.span,
        });
      }
      if (
        expression.kind === "separated" &&
        isExpressionNullable(expression.separator, state.nullableRules)
      ) {
        diagnostics.push({
          code: "TS_PARSER_NULLABLE_LIST_SEPARATOR",
          severity: "error",
          backend: "typescript",
          message:
            "The portable parser cannot lower a separated list whose separator is nullable.",
          span: expression.separator.span,
        });
      }
    });
    const expression = lowerExpression(state, rule, rule.expression);
    addProduction(
      state,
      ruleNonterminals.get(rule.id)!,
      [{ kind: "nonterminal", id: expression }],
      { kind: "rule", ruleId: rule.id },
      rule.span,
      ruleOrigin(rule, rule.expression),
    );
  }

  return {
    startNonterminal: 0,
    rootRuleNonterminal: ruleNonterminals.get(analyzed.rootRule)!,
    eofTerminal: 0,
    terminals,
    nonterminals,
    productions: state.productions,
    diagnostics,
  };
}

function lowerExpression(
  state: LoweringState,
  rule: AnalyzedRule,
  expression: AnalyzedExpression,
): number {
  const existing = state.expressionNonterminals.get(expression.id);
  if (existing !== undefined) return existing;

  const nonterminal = state.nonterminals.length;
  state.expressionNonterminals.set(expression.id, nonterminal);
  state.nonterminals.push({
    id: nonterminal,
    name: `$e${expression.id}`,
    expressionId: expression.id,
  });
  const origin = expressionOrigin(state, rule, expression);

  switch (expression.kind) {
    case "field": {
      const child = lowerExpression(state, rule, expression.expression);
      addProduction(
        state,
        nonterminal,
        [{ kind: "nonterminal", id: child }],
        {
          kind: "field",
          name: expression.name,
        },
        expression.span,
        origin,
      );
      return nonterminal;
    }
    case "ref": {
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
      } else if (expression.reference.kind === "token") {
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
      }
      return nonterminal;
    }
    case "literal":
      addProduction(
        state,
        nonterminal,
        [{
          kind: "terminal",
          id: literalTerminal(state, expression.literalId),
        }],
        { kind: "terminal" },
        expression.span,
        origin,
      );
      return nonterminal;
    case "sequence":
      addProduction(
        state,
        nonterminal,
        expression.items.map((item) => lowerRhsExpression(state, rule, item)),
        { kind: "sequence" },
        expression.span,
        origin,
      );
      return nonterminal;
    case "choice":
      for (const option of expression.options) {
        addChoiceOptionProductions(state, rule, option, nonterminal);
      }
      return nonterminal;
    case "optional": {
      const child = lowerRhsExpression(state, rule, expression.expression);
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
        [child],
        { kind: "optionalSome" },
        expression.span,
        origin,
      );
      return nonterminal;
    }
    case "repeat": {
      const child = lowerRhsExpression(state, rule, expression.expression);
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
        [
          { kind: "nonterminal", id: nonterminal },
          child,
        ],
        { kind: "repeatAppend" },
        expression.span,
        origin,
      );
      return nonterminal;
    }
    case "repeat1": {
      const child = lowerRhsExpression(state, rule, expression.expression);
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
        [
          { kind: "nonterminal", id: nonterminal },
          child,
        ],
        { kind: "repeat1Append" },
        expression.span,
        origin,
      );
      return nonterminal;
    }
    case "separated": {
      const item = lowerRhsExpression(state, rule, expression.item);
      const separator = lowerRhsExpression(state, rule, expression.separator);
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
        [
          { kind: "nonterminal", id: nonterminal },
          separator,
          item,
        ],
        { kind: "separatedAppend" },
        expression.span,
        origin,
      );
      return nonterminal;
    }
  }
}

function addChoiceOptionProductions(
  state: LoweringState,
  rule: AnalyzedRule,
  expression: AnalyzedExpression,
  lhs: number,
): void {
  const origin = expressionOrigin(state, rule, expression);
  switch (expression.kind) {
    case "field": {
      addProduction(
        state,
        lhs,
        [{
          kind: "nonterminal",
          id: lowerExpression(state, rule, expression.expression),
        }],
        { kind: "field", name: expression.name },
        expression.span,
        origin,
      );
      return;
    }
    case "ref":
      if (expression.reference.kind === "rule") {
        const target = state.ruleNonterminals.get(expression.reference.ruleId);
        if (target !== undefined) {
          addProduction(
            state,
            lhs,
            [{ kind: "nonterminal", id: target }],
            { kind: "ruleRef" },
            expression.span,
            origin,
          );
        }
      } else if (expression.reference.kind === "token") {
        addProduction(
          state,
          lhs,
          [{
            kind: "terminal",
            id: tokenTerminal(state, expression.reference.tokenId),
          }],
          { kind: "terminal" },
          expression.span,
          origin,
        );
      }
      return;
    case "literal":
      addProduction(
        state,
        lhs,
        [{
          kind: "terminal",
          id: literalTerminal(state, expression.literalId),
        }],
        { kind: "terminal" },
        expression.span,
        origin,
      );
      return;
    case "sequence":
      addProduction(
        state,
        lhs,
        expression.items.map((item) => lowerRhsExpression(state, rule, item)),
        { kind: "sequence" },
        expression.span,
        origin,
      );
      return;
    case "choice":
      for (const option of expression.options) {
        addChoiceOptionProductions(state, rule, option, lhs);
      }
      return;
    case "optional": {
      const child = lowerRhsExpression(state, rule, expression.expression);
      addProduction(
        state,
        lhs,
        [],
        { kind: "optionalEmpty" },
        expression.span,
        origin,
      );
      addProduction(
        state,
        lhs,
        [child],
        { kind: "optionalSome" },
        expression.span,
        origin,
      );
      return;
    }
    case "repeat":
    case "repeat1":
    case "separated":
      addProduction(
        state,
        lhs,
        [{ kind: "nonterminal", id: lowerExpression(state, rule, expression) }],
        { kind: "identity" },
        expression.span,
        origin,
      );
      return;
  }
}

function lowerRhsExpression(
  state: LoweringState,
  rule: AnalyzedRule,
  expression: AnalyzedExpression,
): BnfSymbol {
  const direct = directRhsSymbol(state, expression);
  if (direct) return direct;
  return {
    kind: "nonterminal",
    id: lowerExpression(state, rule, expression),
  };
}

function directRhsSymbol(
  state: LoweringState,
  expression: AnalyzedExpression,
): BnfSymbol | undefined {
  if (expression.kind === "literal") {
    return {
      kind: "terminal",
      id: literalTerminal(state, expression.literalId),
    };
  }
  if (expression.kind !== "ref") return undefined;
  if (expression.reference.kind === "token") {
    return {
      kind: "terminal",
      id: tokenTerminal(state, expression.reference.tokenId),
    };
  }
  if (expression.reference.kind !== "rule") return undefined;
  const rule = state.ruleNonterminals.get(expression.reference.ruleId);
  return rule === undefined ? undefined : {
    kind: "nonterminal",
    id: rule,
  };
}

function addProduction(
  state: LoweringState,
  lhs: number,
  rhs: readonly BnfSymbol[],
  reducer: ReducerSpec,
  span?: BnfProduction["span"],
  origin?: ProductionOrigin,
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
  rule: AnalyzedRule,
  expression: AnalyzedExpression,
): ProductionOrigin {
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    expressionId: expression.id,
    span: rule.span,
    description: `${rule.name} = ${describeExpression(expression)}`,
  };
}

function expressionOrigin(
  _state: LoweringState,
  rule: AnalyzedRule,
  expression: AnalyzedExpression,
): ProductionOrigin {
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    expressionId: expression.id,
    span: expression.span,
    description: `${rule.name} = ${describeExpression(expression)}`,
  };
}

function describeExpression(expression: AnalyzedExpression): string {
  switch (expression.kind) {
    case "field":
      return `${expression.name}:${describeExpression(expression.expression)}`;
    case "ref":
      return expression.name;
    case "literal":
      return JSON.stringify(expression.value);
    case "sequence":
      return expression.items.map(describeExpression).join(" ");
    case "choice":
      return expression.options.map(describeExpression).join(" | ");
    case "optional":
      return `(${describeExpression(expression.expression)})?`;
    case "repeat":
      return `(${describeExpression(expression.expression)})*`;
    case "repeat1":
      return `(${describeExpression(expression.expression)})+`;
    case "separated":
      return `${describeExpression(expression.item)} % ${
        describeExpression(expression.separator)
      }`;
  }
}

function tokenTerminal(state: LoweringState, tokenId: number): number {
  return requiredTerminal(state, `named:${tokenId}`);
}

function literalTerminal(state: LoweringState, literalId: number): number {
  return requiredTerminal(state, `literal:${literalId}`);
}

function requiredTerminal(state: LoweringState, key: string): number {
  const terminal = state.terminalByKey.get(key);
  if (terminal === undefined) {
    throw new Error(`Internal error: missing terminal ${key}`);
  }
  return terminal;
}
