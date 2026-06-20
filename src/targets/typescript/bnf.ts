import type { Diagnostic } from "../../ast.ts";
import {
  computeNullableRules,
  isExpressionNullable,
  visitAnalyzedExpression,
} from "../../compiler/analyze.ts";
import type {
  AnalyzedExpression,
  AnalyzedGrammar,
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
            "The TypeScript parser target cannot lower repetition whose body is nullable.",
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
            "The TypeScript parser target cannot lower a separated list whose item is nullable.",
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
            "The TypeScript parser target cannot lower a separated list whose separator is nullable.",
          span: expression.separator.span,
        });
      }
    });
    const expression = lowerExpression(state, rule.expression);
    addProduction(
      state,
      ruleNonterminals.get(rule.id)!,
      [{ kind: "nonterminal", id: expression }],
      { kind: "rule", ruleId: rule.id },
      rule.span,
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

  switch (expression.kind) {
    case "field": {
      const child = lowerExpression(state, expression.expression);
      addProduction(state, nonterminal, [{ kind: "nonterminal", id: child }], {
        kind: "field",
        name: expression.name,
      }, expression.span);
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
      );
      return nonterminal;
    case "sequence":
      addProduction(
        state,
        nonterminal,
        expression.items.map((item) => ({
          kind: "nonterminal" as const,
          id: lowerExpression(state, item),
        })),
        { kind: "sequence" },
        expression.span,
      );
      return nonterminal;
    case "choice":
      for (const option of expression.options) {
        addProduction(
          state,
          nonterminal,
          [{ kind: "nonterminal", id: lowerExpression(state, option) }],
          { kind: "identity" },
          option.span,
        );
      }
      return nonterminal;
    case "optional": {
      const child = lowerExpression(state, expression.expression);
      addProduction(
        state,
        nonterminal,
        [],
        { kind: "optionalEmpty" },
        expression.span,
      );
      addProduction(
        state,
        nonterminal,
        [{ kind: "nonterminal", id: child }],
        { kind: "optionalSome" },
        expression.span,
      );
      return nonterminal;
    }
    case "repeat": {
      const child = lowerExpression(state, expression.expression);
      addProduction(
        state,
        nonterminal,
        [],
        { kind: "repeatEmpty" },
        expression.span,
      );
      addProduction(
        state,
        nonterminal,
        [
          { kind: "nonterminal", id: nonterminal },
          { kind: "nonterminal", id: child },
        ],
        { kind: "repeatAppend" },
        expression.span,
      );
      return nonterminal;
    }
    case "repeat1": {
      const child = lowerExpression(state, expression.expression);
      addProduction(
        state,
        nonterminal,
        [{ kind: "nonterminal", id: child }],
        { kind: "repeat1First" },
        expression.span,
      );
      addProduction(
        state,
        nonterminal,
        [
          { kind: "nonterminal", id: nonterminal },
          { kind: "nonterminal", id: child },
        ],
        { kind: "repeat1Append" },
        expression.span,
      );
      return nonterminal;
    }
    case "separated": {
      const item = lowerExpression(state, expression.item);
      const separator = lowerExpression(state, expression.separator);
      addProduction(
        state,
        nonterminal,
        [{ kind: "nonterminal", id: item }],
        { kind: "separatedFirst" },
        expression.span,
      );
      addProduction(
        state,
        nonterminal,
        [
          { kind: "nonterminal", id: nonterminal },
          { kind: "nonterminal", id: separator },
          { kind: "nonterminal", id: item },
        ],
        { kind: "separatedAppend" },
        expression.span,
      );
      return nonterminal;
    }
  }
}

function addProduction(
  state: LoweringState,
  lhs: number,
  rhs: readonly BnfSymbol[],
  reducer: ReducerSpec,
  span?: BnfProduction["span"],
): void {
  state.productions.push({
    id: state.productions.length,
    lhs,
    rhs,
    reducer,
    span,
  });
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
