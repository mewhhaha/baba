import type { Diagnostic } from "../../ast.ts";
import type { BnfGrammar, BnfProduction, BnfSymbol } from "./bnf.ts";

export type LrAction =
  | { kind: "shift"; state: number }
  | { kind: "reduce"; production: number }
  | { kind: "accept" };

export interface LrItem {
  production: number;
  dot: number;
  lookahead: number;
}

export interface LrState {
  id: number;
  items: readonly LrItem[];
}

export interface LrTable {
  states: readonly LrState[];
  actions: ReadonlyMap<number, ReadonlyMap<number, LrAction>>;
  gotos: ReadonlyMap<number, ReadonlyMap<number, number>>;
  diagnostics: readonly Diagnostic[];
}

interface FirstAnalysis {
  nullable: ReadonlySet<number>;
  first: ReadonlyMap<number, ReadonlySet<number>>;
  productionsByLhs: ReadonlyMap<number, readonly BnfProduction[]>;
}

export function buildCanonicalLr1Table(
  grammar: BnfGrammar,
  options: { stateLimit: number },
): LrTable {
  const analysis = analyzeFirst(grammar);
  const diagnostics: Diagnostic[] = [];
  const stateByKey = new Map<string, number>();
  const transitions = new Map<string, number>();
  const states: LrState[] = [];
  const queue: LrState[] = [];

  const addState = (items: readonly LrItem[]): LrState => {
    const closed = closure(grammar, analysis, items);
    const key = itemSetKey(closed);
    const existing = stateByKey.get(key);
    if (existing !== undefined) return states[existing];
    if (states.length >= options.stateLimit) {
      diagnostics.push({
        code: "TS_PARSER_STATE_LIMIT",
        severity: "error",
        backend: "typescript",
        message:
          `The TypeScript parser exceeded the canonical LR(1) state limit (${options.stateLimit}).`,
      });
      return states[0] ?? { id: 0, items: [] };
    }
    const state = { id: states.length, items: closed };
    states.push(state);
    queue.push(state);
    stateByKey.set(key, state.id);
    return state;
  };

  addState([{ production: 0, dot: 0, lookahead: grammar.eofTerminal }]);
  for (let index = 0; index < queue.length; index++) {
    if (diagnostics.length > 0) break;
    const state = queue[index];
    for (const symbol of nextSymbols(state.items, grammar)) {
      const target = gotoItems(grammar, analysis, state.items, symbol);
      const targetState = addState(target);
      transitions.set(transitionKey(state.id, symbol), targetState.id);
    }
  }

  const actions = new Map<number, Map<number, LrAction>>();
  const gotos = new Map<number, Map<number, number>>();

  const setAction = (
    state: LrState,
    terminal: number,
    action: LrAction,
  ) => {
    let row = actions.get(state.id);
    if (!row) {
      row = new Map();
      actions.set(state.id, row);
    }
    const existing = row.get(terminal);
    if (!existing) {
      row.set(terminal, action);
      return;
    }
    if (sameAction(existing, action)) return;
    diagnostics.push(
      conflictDiagnostic(grammar, state, terminal, existing, action),
    );
  };

  const setGoto = (state: number, nonterminal: number, target: number) => {
    let row = gotos.get(state);
    if (!row) {
      row = new Map();
      gotos.set(state, row);
    }
    row.set(nonterminal, target);
  };

  for (const state of states) {
    for (const item of state.items) {
      const production = grammar.productions[item.production];
      const symbol = production.rhs[item.dot];
      if (symbol) {
        const target = transitions.get(transitionKey(state.id, symbol));
        if (target === undefined) continue;
        if (symbol.kind === "terminal") {
          setAction(state, symbol.id, { kind: "shift", state: target });
        } else {
          setGoto(state.id, symbol.id, target);
        }
        continue;
      }
      if (item.production === 0 && item.lookahead === grammar.eofTerminal) {
        setAction(state, grammar.eofTerminal, { kind: "accept" });
      } else {
        setAction(state, item.lookahead, {
          kind: "reduce",
          production: item.production,
        });
      }
    }
  }

  return { states, actions, gotos, diagnostics };
}

function analyzeFirst(grammar: BnfGrammar): FirstAnalysis {
  const productionsByLhs = new Map<number, BnfProduction[]>();
  for (const production of grammar.productions) {
    const entries = productionsByLhs.get(production.lhs) ?? [];
    entries.push(production);
    productionsByLhs.set(production.lhs, entries);
  }

  const nullable = new Set<number>();
  const first = new Map<number, Set<number>>();
  for (const nonterminal of grammar.nonterminals) {
    first.set(nonterminal.id, new Set());
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const production of grammar.productions) {
      if (
        !nullable.has(production.lhs) &&
        production.rhs.every((symbol) =>
          symbol.kind === "nonterminal" && nullable.has(symbol.id)
        )
      ) {
        nullable.add(production.lhs);
        changed = true;
      }
      const targetFirst = first.get(production.lhs)!;
      const before = targetFirst.size;
      for (const terminal of firstOfSequence(production.rhs, nullable, first)) {
        targetFirst.add(terminal);
      }
      if (targetFirst.size !== before) changed = true;
    }
  }

  return { nullable, first, productionsByLhs };
}

function firstOfSequence(
  symbols: readonly BnfSymbol[],
  nullable: ReadonlySet<number>,
  first: ReadonlyMap<number, ReadonlySet<number>>,
  fallback?: number,
): Set<number> {
  const result = new Set<number>();
  for (const symbol of symbols) {
    if (symbol.kind === "terminal") {
      result.add(symbol.id);
      return result;
    }
    for (const terminal of first.get(symbol.id) ?? []) result.add(terminal);
    if (!nullable.has(symbol.id)) return result;
  }
  if (fallback !== undefined) result.add(fallback);
  return result;
}

function closure(
  grammar: BnfGrammar,
  analysis: FirstAnalysis,
  items: readonly LrItem[],
): LrItem[] {
  const byKey = new Map<string, LrItem>();
  const queue: LrItem[] = [];
  const add = (item: LrItem) => {
    const key = itemKey(item);
    if (byKey.has(key)) return;
    byKey.set(key, item);
    queue.push(item);
  };
  for (const item of items) add(item);

  for (let index = 0; index < queue.length; index++) {
    const item = queue[index];
    const production = grammar.productions[item.production];
    const symbol = production.rhs[item.dot];
    if (!symbol || symbol.kind !== "nonterminal") continue;
    const tail = production.rhs.slice(item.dot + 1);
    const lookaheads = firstOfSequence(
      tail,
      analysis.nullable,
      analysis.first,
      item.lookahead,
    );
    for (const next of analysis.productionsByLhs.get(symbol.id) ?? []) {
      for (const lookahead of lookaheads) {
        add({ production: next.id, dot: 0, lookahead });
      }
    }
  }

  return [...byKey.values()].sort(compareItems);
}

function gotoItems(
  grammar: BnfGrammar,
  analysis: FirstAnalysis,
  items: readonly LrItem[],
  symbol: BnfSymbol,
): LrItem[] {
  const advanced = items
    .filter((item) =>
      sameSymbol(grammar.productions[item.production].rhs[item.dot], symbol)
    )
    .map((item) => ({
      production: item.production,
      dot: item.dot + 1,
      lookahead: item.lookahead,
    }));
  return closure(grammar, analysis, advanced);
}

function nextSymbols(
  items: readonly LrItem[],
  grammar: BnfGrammar,
): BnfSymbol[] {
  const byKey = new Map<string, BnfSymbol>();
  for (const item of items) {
    const symbol = grammar.productions[item.production].rhs[item.dot];
    if (symbol) byKey.set(symbolKey(symbol), symbol);
  }
  return [...byKey.values()].sort(compareSymbols);
}

function conflictDiagnostic(
  grammar: BnfGrammar,
  state: LrState,
  terminal: number,
  left: LrAction,
  right: LrAction,
): Diagnostic {
  const terminalName = grammar.terminals[terminal]?.display ?? String(terminal);
  const reductions = [left, right]
    .filter((action): action is { kind: "reduce"; production: number } =>
      action.kind === "reduce"
    )
    .map((action) =>
      productionDisplay(grammar, grammar.productions[action.production])
    );
  const shifts = state.items
    .filter((item) => {
      const symbol = grammar.productions[item.production].rhs[item.dot];
      return symbol?.kind === "terminal" && symbol.id === terminal;
    })
    .map((item) =>
      productionDisplay(grammar, grammar.productions[item.production], item.dot)
    );
  const code = shifts.length > 0 && reductions.length > 0
    ? "TS_PARSER_SHIFT_REDUCE_CONFLICT"
    : "TS_PARSER_REDUCE_REDUCE_CONFLICT";
  const details = [
    `${
      code === "TS_PARSER_REDUCE_REDUCE_CONFLICT"
        ? "Reduce/reduce"
        : "Shift/reduce"
    } conflict on ${terminalName} while generating the TypeScript parser.`,
    "",
    ...shifts.flatMap((shift) => ["Possible shift:", `  ${shift}`]),
    ...reductions.flatMap((reduction) => [
      "Possible reduction:",
      `  ${reduction}`,
    ]),
    "Encode precedence structurally or generate only the Tree-sitter target.",
  ].filter((line, index, lines) => line !== "" || lines[index - 1] !== "");
  const spanProduction = [left, right]
    .find((action): action is { kind: "reduce"; production: number } =>
      action.kind === "reduce"
    );
  return {
    code,
    severity: "error",
    backend: "typescript",
    message: details.join("\n"),
    span: spanProduction
      ? grammar.productions[spanProduction.production]?.span
      : undefined,
  };
}

function productionDisplay(
  grammar: BnfGrammar,
  production: BnfProduction,
  dot?: number,
): string {
  const lhs = grammar.nonterminals[production.lhs]?.name ??
    String(production.lhs);
  const rhs = production.rhs.map((symbol) =>
    symbol.kind === "terminal"
      ? grammar.terminals[symbol.id]?.display ?? String(symbol.id)
      : grammar.nonterminals[symbol.id]?.name ?? String(symbol.id)
  );
  const displayed = dot === undefined
    ? rhs
    : [...rhs.slice(0, dot), "•", ...rhs.slice(dot)];
  return `${lhs} -> ${displayed.length ? displayed.join(" ") : "ε"}`;
}

function sameAction(left: LrAction, right: LrAction): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "shift" && right.kind === "shift") {
    return left.state === right.state;
  }
  if (left.kind === "reduce" && right.kind === "reduce") {
    return left.production === right.production;
  }
  return true;
}

function transitionKey(state: number, symbol: BnfSymbol): string {
  return `${state}:${symbolKey(symbol)}`;
}

function itemSetKey(items: readonly LrItem[]): string {
  return items.map(itemKey).join("|");
}

function itemKey(item: LrItem): string {
  return `${item.production}/${item.dot}/${item.lookahead}`;
}

function symbolKey(symbol: BnfSymbol): string {
  return `${symbol.kind === "terminal" ? "t" : "n"}${symbol.id}`;
}

function sameSymbol(left: BnfSymbol | undefined, right: BnfSymbol): boolean {
  return !!left && left.kind === right.kind && left.id === right.id;
}

function compareItems(left: LrItem, right: LrItem): number {
  return left.production - right.production ||
    left.dot - right.dot ||
    left.lookahead - right.lookahead;
}

function compareSymbols(left: BnfSymbol, right: BnfSymbol): number {
  if (left.kind !== right.kind) return left.kind === "terminal" ? -1 : 1;
  return left.id - right.id;
}
