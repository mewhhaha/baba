import type {
  Diagnostic,
  ParserConflictResolutionMetadata,
} from "../../ast.ts";
import type {
  BnfGrammar,
  BnfProduction,
  BnfSymbol,
  ProductionOrigin,
} from "./bnf.ts";

export type LrAction =
  | { kind: "shift"; state: number }
  | { kind: "reduce"; production: number }
  | { kind: "accept" };

export type LrActionSet = readonly LrAction[];

export interface LrItem {
  production: number;
  dot: number;
  lookaheads: LookaheadBitset;
}

export interface LookaheadBitset {
  readonly words: readonly number[];
  readonly size: number;
}

export interface LrState {
  id: number;
  items: readonly LrItem[];
}

export interface LrTable {
  states: readonly LrState[];
  actions: ReadonlyMap<number, ReadonlyMap<number, LrActionSet>>;
  gotos: ReadonlyMap<number, ReadonlyMap<number, number>>;
  stats: LrPlanningStats;
  diagnostics: readonly Diagnostic[];
}

export interface LrPlanningStats {
  bnfProductions: number;
  states: number;
  coreItems: number;
  items: number;
  actionEntries: number;
  gotoEntries: number;
  tableEntries: number;
}

interface MutableLrItem {
  production: number;
  dot: number;
  lookaheads: MutableLookaheadBitset;
}

interface MutableLookaheadBitset {
  words: number[];
  size: number;
}

interface FirstAnalysis {
  nullable: ReadonlySet<number>;
  first: ReadonlyMap<number, ReadonlySet<number>>;
  productionsByLhs: ReadonlyMap<number, readonly BnfProduction[]>;
}

export function buildCanonicalLr1Table(
  grammar: BnfGrammar,
  options: {
    stateLimit: number;
    itemLimit?: number;
    tableEntryLimit?: number;
    conflictGroups?: readonly (readonly string[])[];
    conflictResolutions?: readonly ParserConflictResolutionMetadata[];
  },
): LrTable {
  const analysis = analyzeFirst(grammar);
  const diagnostics: Diagnostic[] = [];
  const stateByKey = new Map<string, number>();
  const transitions = new Map<string, number>();
  const states: LrState[] = [];
  const queue: LrState[] = [];
  let totalCoreItems = 0;
  let totalItems = 0;

  const addState = (items: readonly LrItem[]): LrState => {
    const closed = closure(grammar, analysis, items);
    const key = itemSetKey(closed);
    const existing = stateByKey.get(key);
    if (existing !== undefined) return states[existing];
    const closedItemCount = countLookaheadEntries(closed);
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
    if (
      options.itemLimit !== undefined &&
      totalItems + closedItemCount > options.itemLimit
    ) {
      diagnostics.push({
        code: "TS_PARSER_ITEM_LIMIT",
        severity: "error",
        backend: "typescript",
        message:
          `The TypeScript parser exceeded the canonical LR(1) item limit (${options.itemLimit}).`,
      });
      return states[0] ?? { id: 0, items: [] };
    }
    const state = { id: states.length, items: closed };
    states.push(state);
    totalCoreItems += closed.length;
    totalItems += closedItemCount;
    queue.push(state);
    stateByKey.set(key, state.id);
    return state;
  };

  addState([{
    production: 0,
    dot: 0,
    lookaheads: lookaheadBitset([grammar.eofTerminal]),
  }]);
  for (let index = 0; index < queue.length; index++) {
    if (diagnostics.length > 0) break;
    const state = queue[index];
    for (const symbol of nextSymbols(state.items, grammar)) {
      const target = gotoItems(grammar, analysis, state.items, symbol);
      const targetState = addState(target);
      transitions.set(transitionKey(state.id, symbol), targetState.id);
    }
  }

  const actions = new Map<number, Map<number, LrActionSet>>();
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
      row.set(terminal, [action]);
      return;
    }
    if (existing.some((candidate) => sameAction(candidate, action))) return;
    const nextActions = [...existing, action];
    const resolved = resolveConflict(
      grammar,
      state,
      terminal,
      nextActions,
      options.conflictResolutions ?? [],
      options.conflictGroups ?? [],
    );
    if (resolved) {
      row.set(terminal, resolved);
      return;
    }
    diagnostics.push(conflictDiagnostic(grammar, state, terminal, nextActions));
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
      for (const lookahead of lookaheadValues(item.lookaheads)) {
        if (item.production === 0 && lookahead === grammar.eofTerminal) {
          setAction(state, grammar.eofTerminal, { kind: "accept" });
        } else {
          setAction(state, lookahead, {
            kind: "reduce",
            production: item.production,
          });
        }
      }
    }
  }

  const actionEntries = countActionEntries(actions);
  const gotoEntries = countEntries(gotos);
  const tableEntries = actionEntries + gotoEntries;
  if (
    options.tableEntryLimit !== undefined &&
    tableEntries > options.tableEntryLimit
  ) {
    diagnostics.push({
      code: "TS_PARSER_TABLE_ENTRY_LIMIT",
      severity: "error",
      backend: "typescript",
      message:
        `The TypeScript parser exceeded the ACTION/GOTO table entry limit (${options.tableEntryLimit}).`,
    });
  }

  return {
    states,
    actions,
    gotos,
    stats: {
      bnfProductions: grammar.productions.length,
      states: states.length,
      coreItems: totalCoreItems,
      items: totalItems,
      actionEntries,
      gotoEntries,
      tableEntries,
    },
    diagnostics,
  };
}

function countLookaheadEntries(items: readonly LrItem[]): number {
  let count = 0;
  for (const item of items) count += item.lookaheads.size;
  return count;
}

function countEntries<K, V>(table: ReadonlyMap<K, ReadonlyMap<K, V>>): number {
  let count = 0;
  for (const row of table.values()) count += row.size;
  return count;
}

function countActionEntries(
  table: ReadonlyMap<number, ReadonlyMap<number, LrActionSet>>,
): number {
  let count = 0;
  for (const row of table.values()) {
    for (const actions of row.values()) count += actions.length;
  }
  return count;
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
  const byKey = new Map<string, MutableLrItem>();
  const queue: MutableLrItem[] = [];
  const add = (
    production: number,
    dot: number,
    lookaheads: Iterable<number>,
  ) => {
    const key = coreItemKey(production, dot);
    let item = byKey.get(key);
    let changed = false;
    if (!item) {
      item = { production, dot, lookaheads: mutableLookaheadBitset() };
      byKey.set(key, item);
      changed = true;
    }
    for (const lookahead of lookaheads) {
      changed = addLookahead(item.lookaheads, lookahead) || changed;
    }
    if (changed) queue.push(item);
  };
  for (const item of items) {
    add(item.production, item.dot, lookaheadValues(item.lookaheads));
  }

  for (let index = 0; index < queue.length; index++) {
    const item = queue[index];
    const production = grammar.productions[item.production];
    const symbol = production.rhs[item.dot];
    if (!symbol || symbol.kind !== "nonterminal") continue;
    const tail = production.rhs.slice(item.dot + 1);
    for (const next of analysis.productionsByLhs.get(symbol.id) ?? []) {
      for (const lookahead of lookaheadValues(item.lookaheads)) {
        const nextLookaheads = firstOfSequence(
          tail,
          analysis.nullable,
          analysis.first,
          lookahead,
        );
        add(next.id, 0, nextLookaheads);
      }
    }
  }

  return [...byKey.values()].map((item) => ({
    production: item.production,
    dot: item.dot,
    lookaheads: freezeLookaheadBitset(item.lookaheads),
  })).sort(compareItems);
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
      lookaheads: item.lookaheads,
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
  actions: readonly LrAction[],
): Diagnostic {
  const terminalName = grammar.terminals[terminal]?.display ?? String(terminal);
  const reductionProductions = actions
    .filter((action): action is { kind: "reduce"; production: number } =>
      action.kind === "reduce"
    )
    .map((action) => grammar.productions[action.production]);
  const shiftProductions = state.items
    .filter((item) => {
      const symbol = grammar.productions[item.production].rhs[item.dot];
      return symbol?.kind === "terminal" && symbol.id === terminal;
    })
    .map((item) => grammar.productions[item.production]);
  const origins = uniqueOrigins([
    ...shiftProductions,
    ...reductionProductions,
  ]);
  const ruleName = origins[0]?.ruleName;
  const code = shiftProductions.length > 0 && reductionProductions.length > 0
    ? "TS_PARSER_SHIFT_REDUCE_CONFLICT"
    : "TS_PARSER_REDUCE_REDUCE_CONFLICT";
  const details = [
    `${
      code === "TS_PARSER_REDUCE_REDUCE_CONFLICT"
        ? "Reduce/reduce"
        : "Shift/reduce"
    } conflict on ${terminalName}${
      ruleName ? ` in rule ${JSON.stringify(ruleName)}` : ""
    } while generating the TypeScript parser.`,
    "",
    ...originDescriptions(grammar, "Shift interpretation", shiftProductions),
    ...originDescriptions(
      grammar,
      "Reduction interpretation",
      reductionProductions,
    ),
    "Encode precedence structurally or generate only the Tree-sitter target.",
  ].filter((line, index, lines) => line !== "" || lines[index - 1] !== "");
  const primaryOrigin = origins[0];
  return {
    code,
    severity: "error",
    backend: "typescript",
    message: details.join("\n"),
    span: primaryOrigin?.span,
    related: origins.slice(1).map((origin) => ({
      message: `Related interpretation: ${origin.description}`,
      span: origin.span,
    })),
  };
}

function resolveConflict(
  grammar: BnfGrammar,
  state: LrState,
  terminal: number,
  actions: readonly LrAction[],
  resolutions: readonly ParserConflictResolutionMetadata[],
  conflictGroups: readonly (readonly string[])[],
): LrActionSet | undefined {
  const context = conflictContext(grammar, state, terminal, actions);
  for (const resolution of resolutions) {
    if (!resolutionMatches(grammar, context, resolution)) continue;
    const selected = selectResolvedAction(context, resolution);
    if (selected) return [selected];
  }
  for (const group of conflictGroups) {
    if (originGroupMatches(context.origins, group)) {
      return sortActions(actions);
    }
  }
  return undefined;
}

interface ConflictContext {
  terminal: number;
  shiftProductions: readonly BnfProduction[];
  reductionProductions: readonly BnfProduction[];
  origins: readonly ProductionOrigin[];
  actions: readonly LrAction[];
}

function conflictContext(
  grammar: BnfGrammar,
  state: LrState,
  terminal: number,
  actions: readonly LrAction[],
): ConflictContext {
  const reductionProductions = actions
    .filter((action): action is { kind: "reduce"; production: number } =>
      action.kind === "reduce"
    )
    .map((action) => grammar.productions[action.production]);
  const shiftProductions = state.items
    .filter((item) => {
      const symbol = grammar.productions[item.production].rhs[item.dot];
      return symbol?.kind === "terminal" && symbol.id === terminal;
    })
    .map((item) => grammar.productions[item.production]);
  return {
    terminal,
    shiftProductions,
    reductionProductions,
    origins: uniqueOrigins([...shiftProductions, ...reductionProductions]),
    actions,
  };
}

function resolutionMatches(
  grammar: BnfGrammar,
  context: ConflictContext,
  resolution: ParserConflictResolutionMetadata,
): boolean {
  if (
    resolution.on !== undefined &&
    !terminalMatches(grammar, context.terminal, resolution.on)
  ) {
    return false;
  }
  return originGroupMatches(context.origins, resolution.rules ?? []);
}

function terminalMatches(
  grammar: BnfGrammar,
  terminal: number,
  expected: string,
): boolean {
  const display = grammar.terminals[terminal]?.display ?? String(terminal);
  return display === expected || display === JSON.stringify(expected);
}

function originGroupMatches(
  origins: readonly ProductionOrigin[],
  group: readonly string[],
): boolean {
  return group.every((name) =>
    origins.some((origin) =>
      origin.ruleName === name || origin.description.includes(name)
    )
  );
}

function selectResolvedAction(
  context: ConflictContext,
  resolution: ParserConflictResolutionMetadata,
): LrAction | undefined {
  if (resolution.prefer === "shift") {
    return context.actions.find((action) => action.kind === "shift");
  }
  const reductions = context.actions.filter((
    action,
  ): action is { kind: "reduce"; production: number } =>
    action.kind === "reduce"
  );
  if (reductions.length <= 1 || resolution.reduce === undefined) {
    return reductions[0];
  }
  const reduce = resolution.reduce;
  return reductions.find((action) => {
    const production = context.reductionProductions.find((candidate) =>
      candidate.id === action.production
    );
    const origin = production?.origin;
    return origin
      ? origin.ruleName === reduce || origin.description.includes(reduce)
      : false;
  });
}

function sortActions(actions: readonly LrAction[]): LrActionSet {
  return [...actions].sort(compareActions);
}

function uniqueOrigins(
  productions: readonly BnfProduction[],
): ProductionOrigin[] {
  const seen = new Set<string>();
  const origins: ProductionOrigin[] = [];
  for (const production of productions) {
    const origin = production.origin;
    if (!origin) continue;
    const key = `${origin.ruleId}/${
      origin.expressionId ?? -1
    }/${origin.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    origins.push(origin);
  }
  return origins;
}

function originDescriptions(
  grammar: BnfGrammar,
  label: string,
  productions: readonly BnfProduction[],
): string[] {
  const origins = uniqueOrigins(productions);
  if (origins.length === 0) {
    return productions.map((production) =>
      `${label}:\n  ${productionDisplayFallback(grammar, production)}`
    );
  }
  return origins.map((origin) => `${label}:\n  ${origin.description}`);
}

function productionDisplayFallback(
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

function compareActions(left: LrAction, right: LrAction): number {
  const leftRank = actionRank(left);
  const rightRank = actionRank(right);
  if (leftRank !== rightRank) return leftRank - rightRank;
  if (left.kind === "shift" && right.kind === "shift") {
    return left.state - right.state;
  }
  if (left.kind === "reduce" && right.kind === "reduce") {
    return left.production - right.production;
  }
  return 0;
}

function actionRank(action: LrAction): number {
  if (action.kind === "shift") return 0;
  if (action.kind === "reduce") return 1;
  return 2;
}

function transitionKey(state: number, symbol: BnfSymbol): string {
  return `${state}:${symbolKey(symbol)}`;
}

function itemSetKey(items: readonly LrItem[]): string {
  return items.map(itemKey).join("|");
}

function itemKey(item: LrItem): string {
  return `${coreItemKey(item.production, item.dot)}/${
    lookaheadBitsetKey(item.lookaheads)
  }`;
}

function coreItemKey(production: number, dot: number): string {
  return `${production}/${dot}`;
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
    compareLookaheadBitsets(left.lookaheads, right.lookaheads);
}

function lookaheadBitset(values: Iterable<number>): LookaheadBitset {
  return freezeLookaheadBitset(mutableLookaheadBitset(values));
}

function mutableLookaheadBitset(
  values: Iterable<number> = [],
): MutableLookaheadBitset {
  const bitset: MutableLookaheadBitset = { words: [], size: 0 };
  for (const value of values) addLookahead(bitset, value);
  return bitset;
}

function addLookahead(bitset: MutableLookaheadBitset, value: number): boolean {
  const wordIndex = value >>> 5;
  const mask = 1 << (value & 31);
  const word = bitset.words[wordIndex] ?? 0;
  if ((word & mask) !== 0) return false;
  bitset.words[wordIndex] = word | mask;
  bitset.size++;
  return true;
}

function freezeLookaheadBitset(
  bitset: MutableLookaheadBitset,
): LookaheadBitset {
  let lastWord = bitset.words.length - 1;
  while (lastWord >= 0 && (bitset.words[lastWord] ?? 0) === 0) lastWord--;
  const words: number[] = [];
  for (let index = 0; index <= lastWord; index++) {
    words.push(bitset.words[index] ?? 0);
  }
  return { words, size: bitset.size };
}

function lookaheadValues(bitset: LookaheadBitset): number[] {
  const values: number[] = [];
  for (let wordIndex = 0; wordIndex < bitset.words.length; wordIndex++) {
    const word = bitset.words[wordIndex] ?? 0;
    for (let bit = 0; bit < 32; bit++) {
      if ((word & (1 << bit)) !== 0) values.push(wordIndex * 32 + bit);
    }
  }
  return values;
}

function lookaheadBitsetKey(bitset: LookaheadBitset): string {
  return `${bitset.size}:${bitset.words.join(",")}`;
}

function compareLookaheadBitsets(
  left: LookaheadBitset,
  right: LookaheadBitset,
): number {
  const leftValues = lookaheadValues(left);
  const rightValues = lookaheadValues(right);
  const length = Math.min(leftValues.length, rightValues.length);
  for (let index = 0; index < length; index++) {
    const delta = leftValues[index] - rightValues[index];
    if (delta !== 0) return delta;
  }
  return leftValues.length - rightValues.length;
}

function compareSymbols(left: BnfSymbol, right: BnfSymbol): number {
  if (left.kind !== right.kind) return left.kind === "terminal" ? -1 : 1;
  return left.id - right.id;
}
