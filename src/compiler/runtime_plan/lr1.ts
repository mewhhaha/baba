import type {
  Diagnostic,
  ParserConflictDeclarationMetadata,
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
  closureWork: number;
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

interface LrTransitionEdge {
  from: number;
  to: number;
  symbol: BnfSymbol;
}

interface LrStateConstruction {
  states: LrState[];
  transitions: Map<string, number>;
  transitionEdges: LrTransitionEdge[];
  diagnostics: Diagnostic[];
  totalCoreItems: number;
  totalItems: number;
  closureWork: number;
}

interface ActionGotoTable {
  actions: Map<number, Map<number, LrActionSet>>;
  gotos: Map<number, Map<number, number>>;
  diagnostics: Diagnostic[];
}

export function buildCanonicalLr1Table(
  grammar: BnfGrammar,
  options: {
    stateLimit: number;
    itemLimit?: number;
    closureWorkLimit?: number;
    tableEntryLimit?: number;
    conflictGroups?: readonly ParserConflictDeclarationMetadata[];
    conflictResolutions?: readonly ParserConflictResolutionMetadata[];
  },
): LrTable {
  const analysis = analyzeFirst(grammar);
  const construction = buildLrStates(grammar, analysis, options);
  const table = buildActionGotoTable(
    grammar,
    construction.states,
    construction.transitions,
    construction.transitionEdges,
    options,
  );

  const diagnostics: Diagnostic[] = [
    ...construction.diagnostics,
    ...table.diagnostics,
  ];
  const actionEntries = countActionEntries(table.actions);
  const gotoEntries = countEntries(table.gotos);
  const tableEntries = actionEntries + gotoEntries;
  if (
    options.tableEntryLimit !== undefined &&
    tableEntries > options.tableEntryLimit
  ) {
    diagnostics.push({
      code: "RUNTIME_PARSER_TABLE_ENTRY_LIMIT",
      severity: "error",
      backend: "runtime",
      message:
        `The portable parser exceeded the ACTION/GOTO table entry limit (${options.tableEntryLimit}).`,
    });
  }

  return {
    states: construction.states,
    actions: table.actions,
    gotos: table.gotos,
    stats: {
      bnfProductions: grammar.productions.length,
      states: construction.states.length,
      coreItems: construction.totalCoreItems,
      items: construction.totalItems,
      closureWork: construction.closureWork,
      actionEntries,
      gotoEntries,
      tableEntries,
    },
    diagnostics,
  };
}

function buildLrStates(
  grammar: BnfGrammar,
  analysis: FirstAnalysis,
  options: {
    stateLimit: number;
    itemLimit?: number;
    closureWorkLimit?: number;
  },
): LrStateConstruction {
  const diagnostics: Diagnostic[] = [];
  const stateByKey = new Map<string, number>();
  const transitions = new Map<string, number>();
  const states: LrState[] = [];
  const queue: LrState[] = [];
  const transitionEdges: LrTransitionEdge[] = [];
  const closureBudget: ClosureBudget = {
    limit: options.closureWorkLimit,
    used: 0,
    exhausted: false,
  };
  let totalCoreItems = 0;
  let totalItems = 0;

  const addState = (items: readonly LrItem[]): LrState => {
    const closed = closure(grammar, analysis, items, closureBudget);
    if (closureBudget.exhausted) {
      diagnostics.push({
        code: "TS_LR_CLOSURE_WORK_LIMIT",
        severity: "error",
        backend: "runtime",
        message:
          `The portable parser exceeded the canonical LR(1) closure work limit (${options.closureWorkLimit}).`,
      });
      return states[0] ?? { id: 0, items: [] };
    }
    const key = itemSetKey(closed);
    const existing = stateByKey.get(key);
    if (existing !== undefined) return states[existing];
    const closedItemCount = countLookaheadEntries(closed);
    if (states.length >= options.stateLimit) {
      diagnostics.push({
        code: "RUNTIME_PARSER_STATE_LIMIT",
        severity: "error",
        backend: "runtime",
        message:
          `The portable parser exceeded the canonical LR(1) state limit (${options.stateLimit}).`,
      });
      return states[0] ?? { id: 0, items: [] };
    }
    if (
      options.itemLimit !== undefined &&
      totalItems + closedItemCount > options.itemLimit
    ) {
      diagnostics.push({
        code: "RUNTIME_PARSER_ITEM_LIMIT",
        severity: "error",
        backend: "runtime",
        message:
          `The portable parser exceeded the canonical LR(1) item limit (${options.itemLimit}).`,
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
      const target = gotoItems(
        grammar,
        analysis,
        state.items,
        symbol,
        closureBudget,
      );
      const targetState = addState(target);
      if (diagnostics.length > 0) break;
      transitions.set(transitionKey(state.id, symbol), targetState.id);
      transitionEdges.push({
        from: state.id,
        to: targetState.id,
        symbol,
      });
    }
  }

  return {
    states,
    transitions,
    transitionEdges,
    diagnostics,
    totalCoreItems,
    totalItems,
    closureWork: closureBudget.used,
  };
}

function buildActionGotoTable(
  grammar: BnfGrammar,
  states: readonly LrState[],
  transitions: ReadonlyMap<string, number>,
  transitionEdges: readonly LrTransitionEdge[],
  options: {
    conflictGroups?: readonly ParserConflictDeclarationMetadata[];
    conflictResolutions?: readonly ParserConflictResolutionMetadata[];
  },
): ActionGotoTable {
  const diagnostics: Diagnostic[] = [];
  const actions = new Map<number, Map<number, LrActionSet>>();
  const gotos = new Map<number, Map<number, number>>();
  const conflictResolutions = options.conflictResolutions ?? [];
  diagnostics.push(
    ...duplicateConflictResolutionDiagnostics(conflictResolutions),
  );
  const conflictResolutionUseCounts = new Array(conflictResolutions.length)
    .fill(0);
  const conflictGroups = options.conflictGroups ?? [];
  const conflictGroupUseCounts = new Array(conflictGroups.length).fill(0);

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
      conflictResolutions,
      conflictGroups,
      (index) => {
        conflictResolutionUseCounts[index]++;
      },
      (index) => {
        conflictGroupUseCounts[index]++;
      },
    );
    if (resolved) {
      row.set(terminal, resolved);
      return;
    }
    diagnostics.push(
      conflictDiagnostic(
        grammar,
        state,
        terminal,
        nextActions,
        transitionEdges,
      ),
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

  diagnostics.push(
    ...unusedConflictResolutionDiagnostics(
      conflictResolutions,
      conflictResolutionUseCounts,
    ),
    ...unusedConflictGroupDiagnostics(conflictGroups, conflictGroupUseCounts),
  );

  return { actions, gotos, diagnostics };
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

interface ClosureBudget {
  limit?: number;
  used: number;
  exhausted: boolean;
}

function consumeClosureWork(budget: ClosureBudget): boolean {
  if (budget.exhausted) return false;
  budget.used++;
  if (budget.limit !== undefined && budget.used > budget.limit) {
    budget.exhausted = true;
    return false;
  }
  return true;
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
  budget: ClosureBudget,
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
    if (!consumeClosureWork(budget)) break;
    const item = queue[index];
    const production = grammar.productions[item.production];
    const symbol = production.rhs[item.dot];
    if (!symbol || symbol.kind !== "nonterminal") continue;
    const tail = production.rhs.slice(item.dot + 1);
    const nextLookaheads = firstOfSequence(
      tail,
      analysis.nullable,
      analysis.first,
    );
    const tailIsNullable = tail.every((tailSymbol) =>
      tailSymbol.kind === "nonterminal" &&
      analysis.nullable.has(tailSymbol.id)
    );
    if (tailIsNullable) {
      for (const lookahead of lookaheadValues(item.lookaheads)) {
        nextLookaheads.add(lookahead);
      }
    }
    for (const next of analysis.productionsByLhs.get(symbol.id) ?? []) {
      add(next.id, 0, nextLookaheads);
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
  budget: ClosureBudget,
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
  return closure(grammar, analysis, advanced, budget);
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
  transitionEdges: readonly LrTransitionEdge[],
): Diagnostic {
  const context = conflictContext(grammar, state, terminal, actions);
  const terminalName = grammar.terminals[terminal]?.display ?? String(terminal);
  const origins = context.origins;
  const ruleName = origins[0]?.ruleName;
  const isShiftReduce = context.shiftProductions.length > 0 &&
    context.reductionProductions.length > 0;
  const code = isShiftReduce
    ? "RUNTIME_PARSER_SHIFT_REDUCE_CONFLICT"
    : "RUNTIME_PARSER_REDUCE_REDUCE_CONFLICT";
  const details = [
    `${
      isShiftReduce ? "Shift/reduce" : "Reduce/reduce"
    } conflict on ${terminalName}${
      ruleName ? ` in rule ${JSON.stringify(ruleName)}` : ""
    } while generating the portable parser.`,
    `Conflict ID: ${conflictId(grammar, context)}`,
    "",
    ...originDescriptions(
      grammar,
      "Shift interpretation",
      context.shiftProductions,
    ),
    ...originDescriptions(
      grammar,
      "Reduction interpretation",
      context.reductionProductions,
    ),
    ...conflictWitnessLines(grammar, state, terminal, transitionEdges),
    ...metadataSuggestionLines(grammar, context, isShiftReduce),
  ].filter((line, index, lines) => line !== "" || lines[index - 1] !== "");
  const primaryOrigin = origins[0];
  return {
    code,
    severity: "error",
    backend: "runtime",
    message: details.join("\n"),
    span: primaryOrigin?.span,
    related: origins.slice(1).map((origin) => ({
      message: `Related interpretation: ${origin.description}`,
      span: origin.span,
    })),
  };
}

function conflictWitnessLines(
  grammar: BnfGrammar,
  state: LrState,
  terminal: number,
  transitionEdges: readonly LrTransitionEdge[],
): string[] {
  const path = shortestStatePath(transitionEdges, state.id);
  if (!path) return [];
  const symbols = [...path.map((edge) => edge.symbol), {
    kind: "terminal" as const,
    id: terminal,
  }];
  return [
    `Conflict witness prefix: ${formatWitnessSequence(grammar, symbols)}`,
    "The final symbol is the conflicting lookahead.",
  ];
}

function metadataSuggestionLines(
  grammar: BnfGrammar,
  context: ConflictContext,
  isShiftReduce: boolean,
): string[] {
  const rules = uniqueRuleNames(context.origins);
  const terminal = terminalMetadataValue(grammar, context.terminal);
  const stableConflictId = conflictId(grammar, context);
  const resolution = {
    rules,
    on: terminal,
    prefer: isShiftReduce ? "shift" : "reduce",
    ...(!isShiftReduce
      ? { reduce: reduceCandidates(context)[0] ?? rules[0] ?? "" }
      : {}),
  };
  const lines = [
    "Resolve this in metadata.parser.resolutions with an entry like:",
    indentJson(resolution),
    "Stable conflict selector for metadata v2:",
    indentJson({ conflict: stableConflictId }),
  ];
  if (isShiftReduce) {
    lines.push(
      'Use prefer: "reduce" instead if the reduction interpretation should win.',
    );
  } else {
    const candidates = reduceCandidates(context);
    if (candidates.length > 0) {
      lines.push(
        `Candidate reduce values: ${
          candidates.map((candidate) => JSON.stringify(candidate)).join(", ")
        }`,
      );
    }
  }

  if (isShiftReduce && rules.length > 1) {
    lines.push(
      "If both interpretations are valid, allow branch search with metadata.parser.conflicts:",
      indentJson([rules]),
    );
  }
  return lines;
}

function shortestStatePath(
  edges: readonly LrTransitionEdge[],
  targetState: number,
): LrTransitionEdge[] | undefined {
  if (targetState === 0) return [];
  const edgesBySource = new Map<number, LrTransitionEdge[]>();
  for (const edge of edges) {
    const entries = edgesBySource.get(edge.from) ?? [];
    entries.push(edge);
    edgesBySource.set(edge.from, entries);
  }

  const queue: Array<{ state: number; path: LrTransitionEdge[] }> = [
    { state: 0, path: [] },
  ];
  const seen = new Set<number>([0]);
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    for (const edge of edgesBySource.get(current.state) ?? []) {
      if (seen.has(edge.to)) continue;
      const path = [...current.path, edge];
      if (edge.to === targetState) return path;
      seen.add(edge.to);
      queue.push({ state: edge.to, path });
    }
  }
  return undefined;
}

function formatWitnessSequence(
  grammar: BnfGrammar,
  symbols: readonly BnfSymbol[],
): string {
  const shortest = shortestTerminalSequences(grammar);
  const terminals: number[] = [];
  const fallback: string[] = [];
  for (const symbol of symbols) {
    if (symbol.kind === "terminal") {
      terminals.push(symbol.id);
      continue;
    }
    const derived = shortest.get(symbol.id);
    if (derived) {
      terminals.push(...derived);
    } else {
      fallback.push(nonterminalDisplay(grammar, symbol.id));
    }
  }
  const displayed = terminals.map((terminal) =>
    grammar.terminals[terminal]?.display ?? String(terminal)
  );
  displayed.push(...fallback);
  return displayed.length > 0 ? displayed.join(" ") : "ε";
}

function shortestTerminalSequences(
  grammar: BnfGrammar,
): ReadonlyMap<number, readonly number[]> {
  const best = new Map<number, readonly number[]>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const production of grammar.productions) {
      const sequence = productionTerminalSequence(production, best);
      if (!sequence) continue;
      const existing = best.get(production.lhs);
      if (
        existing === undefined ||
        sequence.length < existing.length ||
        (sequence.length === existing.length &&
          compareNumberArrays(sequence, existing) < 0)
      ) {
        best.set(production.lhs, sequence);
        changed = true;
      }
    }
  }
  return best;
}

function productionTerminalSequence(
  production: BnfProduction,
  best: ReadonlyMap<number, readonly number[]>,
): number[] | undefined {
  const sequence: number[] = [];
  for (const symbol of production.rhs) {
    if (symbol.kind === "terminal") {
      sequence.push(symbol.id);
      continue;
    }
    const derived = best.get(symbol.id);
    if (!derived) return undefined;
    sequence.push(...derived);
  }
  return sequence;
}

function compareNumberArrays(
  left: readonly number[],
  right: readonly number[],
): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const delta = left[index] - right[index];
    if (delta !== 0) return delta;
  }
  return left.length - right.length;
}

function resolveConflict(
  grammar: BnfGrammar,
  state: LrState,
  terminal: number,
  actions: readonly LrAction[],
  resolutions: readonly ParserConflictResolutionMetadata[],
  conflictGroups: readonly ParserConflictDeclarationMetadata[],
  markResolutionUsed: (index: number) => void,
  markConflictGroupUsed: (index: number) => void,
): LrActionSet | undefined {
  const context = conflictContext(grammar, state, terminal, actions);
  for (const [index, resolution] of resolutions.entries()) {
    if (!resolutionMatches(grammar, context, resolution)) continue;
    const selected = selectResolvedAction(context, resolution);
    if (selected) {
      markResolutionUsed(index);
      return [selected];
    }
  }
  for (const [index, group] of conflictGroups.entries()) {
    if (conflictDeclarationMatches(grammar, context, group)) {
      markConflictGroupUsed(index);
      return sortActions(actions);
    }
  }
  return undefined;
}

function unusedConflictResolutionDiagnostics(
  resolutions: readonly ParserConflictResolutionMetadata[],
  useCounts: readonly number[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const [index, resolution] of resolutions.entries()) {
    if ((useCounts[index] ?? 0) > 0) continue;
    diagnostics.push({
      code: "RUNTIME_PARSER_CONFLICT_METADATA",
      severity: "error",
      backend: "runtime",
      message:
        `metadata.parser.resolutions[${index}].conflict references unknown conflict ID ${
          JSON.stringify(resolution.conflict)
        }. Regenerate the conflict diagnostic and copy the current stable conflict ID, or remove this stale resolution.`,
    });
  }
  return diagnostics;
}

function unusedConflictGroupDiagnostics(
  conflictGroups: readonly ParserConflictDeclarationMetadata[],
  useCounts: readonly number[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const [index, group] of conflictGroups.entries()) {
    if ((useCounts[index] ?? 0) > 0) continue;
    diagnostics.push({
      code: "RUNTIME_PARSER_CONFLICT_METADATA",
      severity: "error",
      backend: "runtime",
      message:
        `metadata.parser.conflicts[${index}] did not match any LR conflict. Regenerate the conflict diagnostic and update this branch declaration, or remove the stale declaration ${
          JSON.stringify(group)
        }.`,
    });
  }
  return diagnostics;
}

function duplicateConflictResolutionDiagnostics(
  resolutions: readonly ParserConflictResolutionMetadata[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const firstByConflict = new Map<string, {
    index: number;
    prefer: ParserConflictResolutionMetadata["prefer"];
    reduce?: string;
  }>();
  for (const [index, resolution] of resolutions.entries()) {
    const previous = firstByConflict.get(resolution.conflict);
    if (!previous) {
      firstByConflict.set(resolution.conflict, {
        index,
        prefer: resolution.prefer,
        reduce: resolution.reduce,
      });
      continue;
    }
    const contradictory = previous.prefer !== resolution.prefer ||
      previous.reduce !== resolution.reduce;
    diagnostics.push({
      code: "RUNTIME_PARSER_CONFLICT_METADATA",
      severity: "error",
      backend: "runtime",
      message:
        `metadata.parser.resolutions[${index}].conflict duplicates metadata.parser.resolutions[${previous.index}].conflict for ${
          JSON.stringify(resolution.conflict)
        }${
          contradictory ? " with a contradictory resolution" : ""
        }. Keep exactly one resolution for each stable conflict ID.`,
    });
  }
  return diagnostics;
}

function conflictId(grammar: BnfGrammar, context: ConflictContext): string {
  const payload = {
    semantics: "baba-lr-conflict-v1",
    lookahead: terminalStableKey(grammar, context.terminal),
    actions: context.actions.map((action) =>
      actionStableKey(grammar, context, action)
    ).sort(),
  };
  return `c_${fnv1a64(JSON.stringify(payload)).slice(0, 16)}`;
}

function actionStableKey(
  grammar: BnfGrammar,
  context: ConflictContext,
  action: LrAction,
): string {
  if (action.kind === "accept") return "accept";
  if (action.kind === "reduce") {
    return `reduce:${
      productionStableKey(
        grammar,
        grammar.productions[action.production],
      )
    }`;
  }
  return `shift:${
    context.shiftProductions.map((production) =>
      productionStableKey(grammar, production)
    ).sort().join("|")
  }`;
}

function productionStableKey(
  grammar: BnfGrammar,
  production: BnfProduction,
): string {
  const lhs = grammar.nonterminals[production.lhs]?.name ??
    `nonterminal:${production.lhs}`;
  const rhs = production.rhs.map((symbol) => symbolStableKey(grammar, symbol));
  const origin = production.origin;
  const originKey = origin
    ? `rule:${origin.ruleName}:expr:${origin.expressionId ?? "rule"}`
    : "origin:none";
  return JSON.stringify({
    origin: originKey,
    lhs,
    rhs,
    reducer: production.reducer,
  });
}

function symbolStableKey(grammar: BnfGrammar, symbol: BnfSymbol): string {
  if (symbol.kind === "terminal") return terminalStableKey(grammar, symbol.id);
  const nonterminal = grammar.nonterminals[symbol.id];
  if (!nonterminal) return `nonterminal:${symbol.id}`;
  if (nonterminal.ruleId !== undefined) return `rule:${nonterminal.name}`;
  return `expr:${nonterminal.name}:${nonterminal.expressionId ?? symbol.id}`;
}

function terminalStableKey(grammar: BnfGrammar, terminal: number): string {
  const info = grammar.terminals[terminal];
  if (!info) return `terminal:${terminal}`;
  if (info.kind === "eof") return "eof";
  if (info.kind === "named") return `named:${info.key}`;
  return `literal:${info.key}`;
}

function fnv1a64(source: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < source.length; index++) {
    hash ^= BigInt(source.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
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
  return resolution.conflict === conflictId(grammar, context);
}

function conflictDeclarationMatches(
  grammar: BnfGrammar,
  context: ConflictContext,
  declaration: ParserConflictDeclarationMetadata,
): boolean {
  return declaration.conflict === conflictId(grammar, context);
}

function originSelectorMatches(
  origin: ProductionOrigin,
  selector: string,
): boolean {
  return origin.ruleName === selector || origin.description === selector;
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
    return origin ? originSelectorMatches(origin, reduce) : false;
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

function uniqueRuleNames(origins: readonly ProductionOrigin[]): string[] {
  const names: string[] = [];
  for (const origin of origins) {
    if (names.includes(origin.ruleName)) continue;
    names.push(origin.ruleName);
  }
  return names;
}

function terminalMetadataValue(grammar: BnfGrammar, terminal: number): string {
  const display = grammar.terminals[terminal]?.display ?? String(terminal);
  if (!display.startsWith('"')) return display;
  try {
    const parsed = JSON.parse(display);
    return typeof parsed === "string" ? parsed : display;
  } catch {
    return display;
  }
}

function nonterminalDisplay(grammar: BnfGrammar, nonterminal: number): string {
  return grammar.nonterminals[nonterminal]?.name ?? String(nonterminal);
}

function reduceCandidates(context: ConflictContext): string[] {
  const candidates: string[] = [];
  for (const production of context.reductionProductions) {
    const origin = production.origin;
    if (!origin) continue;
    const candidate = origin.description;
    if (candidates.includes(candidate)) continue;
    candidates.push(candidate);
  }
  return candidates;
}

function indentJson(value: unknown): string {
  return JSON.stringify(value, null, 2).split("\n").map((line) => `  ${line}`)
    .join("\n");
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
