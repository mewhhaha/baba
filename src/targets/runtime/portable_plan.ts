import type { Diagnostic, SourceSpan } from "../../ast.ts";
import type { AnalyzedGrammar } from "../../compiler/ir.ts";
import type { Dfa } from "../../compiler/regex/dfa.ts";
import type {
  BnfGrammar,
  BnfProduction,
  BnfSymbol,
  ReducerSpec,
} from "../../compiler/runtime_plan/bnf.ts";
import type {
  LookaheadBitset,
  LrAction,
  LrActionSet,
  LrTable,
} from "../../compiler/runtime_plan/lr1.ts";
import { collectRuleFieldSchemas } from "./field_schema.ts";
import {
  canonicalValue,
  fnv1a64String,
  hasId,
  integerProperty,
  isRecord,
  isSupportedInteger,
  isUnicodeScalar,
  lookaheadValues,
  stringProperty,
  visitJson,
} from "../../compiler/portable_plan_shared.ts";

const PORTABLE_PLAN_FORMAT = "baba-parser-plan";
const PORTABLE_PLAN_VERSION = 2;
const PORTABLE_PLAN_SEMANTICS = "baba-portable-v2";
const PORTABLE_REDUCER_SEMANTICS = "baba-reducer-v1";
const PORTABLE_DIAGNOSTIC_SEMANTICS = "baba-runtime-diagnostics-v1";
const PORTABLE_SOURCE_SPAN_UNIT = "utf16-code-units";
const PORTABLE_UNICODE_SEMANTICS = "unicode-code-point-v1";

/**
 * Portable parser-plan v2 is a runtime data contract, not a package-versioned
 * implementation detail. New runtime semantics require a new plan version or a
 * separately versioned subsection; additive debug-only metadata may be ignored
 * by older tools after validation succeeds.
 */
export interface PortableParserPlan {
  readonly format: "baba-parser-plan";
  readonly version: 2;
  readonly semantics: "baba-portable-v2";
  readonly rootRule: number;
  readonly symbols: SymbolPlan;
  readonly lexer: LexerPlan;
  readonly parser: LrParserPlan;
  readonly reducerSemantics: "baba-reducer-v1";
  readonly reducers: readonly PortableReducerPlan[];
  readonly cst: CstPlan;
  readonly diagnostics: PortableDiagnosticPlan;
  readonly statistics: PortablePlanStatistics;
}

export interface PortableParserPlanMetadata {
  readonly format: PortableParserPlan["format"];
  readonly version: PortableParserPlan["version"];
  readonly semantics: PortableParserPlan["semantics"];
  readonly hash: string;
}

export interface SymbolPlan {
  readonly grammarName: string;
  readonly rootRule: number;
  readonly rootRuleName: string;
  readonly tokens: readonly TokenPlan[];
  readonly literals: readonly LiteralPlan[];
  readonly terminals: readonly TerminalPlan[];
  readonly nonterminals: readonly NonterminalPlan[];
  readonly fields: readonly FieldSymbolPlan[];
}

export interface TokenPlan {
  readonly id: number;
  readonly name: string;
  readonly kind: "token" | "skip" | "contextual";
  readonly channel: "main" | "trivia";
  readonly patternSource: string;
  readonly nullable: boolean;
  readonly priority: number;
  readonly declarationOrder: number;
  readonly reachable: boolean;
  readonly span: SourceSpan;
}

export interface LiteralPlan {
  readonly id: number;
  readonly value: string;
  readonly sourceOrder: number;
  readonly reachable: boolean;
  readonly span: SourceSpan;
}

export interface TerminalPlan {
  readonly id: number;
  readonly kind: "eof" | "named" | "literal";
  readonly key: string;
  readonly display: string;
  readonly tokenId?: number;
  readonly literalId?: number;
}

export interface NonterminalPlan {
  readonly id: number;
  readonly name: string;
  readonly ruleId?: number;
  readonly expressionId?: number;
}

export interface FieldSymbolPlan {
  readonly id: number;
  readonly name: string;
}

export interface LexerPlan {
  readonly unicodeSemantics: "unicode-code-point-v1";
  readonly startState: number;
  readonly specifications: readonly LexerSpecificationPlan[];
  readonly states: readonly LexerStatePlan[];
}

export type LexerSpecificationPlan =
  | {
    readonly id: number;
    readonly type: "named";
    readonly tokenId: number;
    readonly terminalId: number | null;
    readonly channel: "main" | "trivia";
    readonly priority: number;
    readonly order: number;
    readonly literal: false;
    readonly contextual: boolean;
    readonly trailingContext: ContextualTrailingContextPlan | undefined;
  }
  | {
    readonly id: number;
    readonly type: "literal";
    readonly literalId: number;
    readonly terminalId: number;
    readonly channel: "main";
    readonly priority: number;
    readonly order: number;
    readonly literal: true;
    readonly contextual: false;
    readonly trailingContext: undefined;
  };

export interface ContextualTrailingContextPlan {
  readonly followedBy: Dfa | undefined;
  readonly followedByEof: boolean;
  readonly notFollowedBy: Dfa | undefined;
  readonly excludedWords: readonly string[];
}

export interface LexerStatePlan {
  readonly id: number;
  readonly transitions: readonly LexerTransitionPlan[];
  readonly accepts: readonly number[];
  readonly selectedAccept: number | null;
}

export interface LexerTransitionPlan {
  readonly start: number;
  readonly end: number;
  readonly target: number;
}

export interface LrParserPlan {
  readonly startState: number;
  readonly eofTerminal: number;
  readonly startProduction: number;
  readonly states: readonly LrStatePlan[];
  readonly actions: readonly ActionRowPlan[];
  readonly gotos: readonly GotoRowPlan[];
  readonly productions: readonly ProductionPlan[];
  readonly expectedTerminals: readonly ExpectedTerminalRowPlan[];
  readonly statistics: LrParserStatisticsPlan;
  readonly conflictPolicy: ConflictPolicyPlan;
}

export interface LrStatePlan {
  readonly id: number;
  readonly items: readonly LrItemPlan[];
}

export interface LrItemPlan {
  readonly production: number;
  readonly dot: number;
  readonly lookaheads: readonly number[];
}

export interface ActionRowPlan {
  readonly state: number;
  readonly entries: readonly ActionEntryPlan[];
}

export interface ActionEntryPlan {
  readonly terminal: number;
  readonly actions: readonly LrActionPlan[];
}

export type LrActionPlan =
  | { readonly kind: "shift"; readonly state: number }
  | { readonly kind: "reduce"; readonly production: number }
  | { readonly kind: "accept" };

export interface GotoRowPlan {
  readonly state: number;
  readonly entries: readonly GotoEntryPlan[];
}

export interface GotoEntryPlan {
  readonly nonterminal: number;
  readonly target: number;
}

export interface ProductionPlan {
  readonly id: number;
  readonly stableId: string;
  readonly lhs: number;
  readonly rhs: readonly BnfSymbol[];
  readonly reducerId: number;
  readonly reducer: ReducerSpec;
  readonly span?: SourceSpan;
  readonly origin?: BnfProduction["origin"];
}

export interface ExpectedTerminalRowPlan {
  readonly state: number;
  readonly terminals: readonly number[];
}

export interface LrParserStatisticsPlan {
  readonly bnfProductions: number;
  readonly states: number;
  readonly coreItems: number;
  readonly items: number;
  readonly closureWork: number;
  readonly actionEntries: number;
  readonly gotoEntries: number;
  readonly tableEntries: number;
}

export interface ConflictPolicyPlan {
  readonly kind: "deterministic-or-declared-branching";
}

export type PortableReducerPlan =
  | { readonly id: number; readonly op: "start" }
  | { readonly id: number; readonly op: "rule"; readonly ruleId: number }
  | { readonly id: number; readonly op: "terminal" }
  | { readonly id: number; readonly op: "rule-ref" }
  | { readonly id: number; readonly op: "identity" }
  | { readonly id: number; readonly op: "sequence" }
  | { readonly id: number; readonly op: "optional-empty" }
  | { readonly id: number; readonly op: "optional-some" }
  | { readonly id: number; readonly op: "repeat-empty" }
  | { readonly id: number; readonly op: "repeat-append" }
  | { readonly id: number; readonly op: "repeat1-first" }
  | { readonly id: number; readonly op: "repeat1-append" }
  | { readonly id: number; readonly op: "separated-first" }
  | { readonly id: number; readonly op: "separated-append" }
  | { readonly id: number; readonly op: "field"; readonly fieldId: number };

export interface CstPlan {
  readonly rootRule: number;
  readonly rootNodeType: string;
  readonly rules: readonly CstRulePlan[];
}

export interface CstRulePlan {
  readonly ruleId: number;
  readonly ruleName: string;
  readonly nodeType: string;
  readonly fields: readonly CstFieldPlan[];
}

export interface CstFieldPlan {
  readonly name: string;
  readonly type: string;
  readonly cardinality: "required" | "nullable" | "array";
  readonly valueKind: "node" | "token" | "unknown";
}

export interface PortableDiagnosticPlan {
  readonly semantics: "baba-runtime-diagnostics-v1";
  readonly sourceSpanUnit: "utf16-code-units";
  readonly expectedTerminalsByState: readonly ExpectedTerminalRowPlan[];
  readonly terminalDisplays: readonly {
    readonly id: number;
    readonly display: string;
  }[];
  readonly ruleDisplays: readonly {
    readonly id: number;
    readonly display: string;
  }[];
}

export interface PortablePlanStatistics {
  readonly lexerStates: number;
  readonly lexerTransitions: number;
  readonly lexerAcceptCandidates: number;
  readonly lexerAverageAcceptCandidatesPerStateMilli: number;
  readonly lexerMaxAcceptCandidatesPerState: number;
  readonly lexerAmbiguousAcceptStates: number;
  readonly bnfProductions: number;
  readonly lrStates: number;
  readonly lrItems: number;
  readonly actionEntries: number;
  readonly gotoEntries: number;
  readonly reducerCount: number;
  readonly fieldCount: number;
  readonly serializedJsonBytes: number;
}

export function createPortableParserPlan(
  analyzed: AnalyzedGrammar,
  bnf: BnfGrammar,
  lr: LrTable,
  dfa: Dfa,
  trailingContextByTokenId: ReadonlyMap<
    number,
    ContextualTrailingContextPlan
  > = new Map(),
): PortableParserPlan {
  const rootRule = analyzed.rules[analyzed.rootRule];
  const cstRules = collectRuleFieldSchemas(analyzed);
  const rootCstRule = cstRules.find((rule) =>
    rule.ruleId === analyzed.rootRule
  );
  const fields = fieldSymbols(cstRules);
  const productions = bnf.productions.map((production) =>
    productionPlan(bnf, production)
  );
  const reducers = bnf.productions.map((production) =>
    reducerPlan(production.id, production.reducer, fields)
  );
  const expectedTerminals = expectedTerminalRows(lr.actions);
  const parserStatistics = { ...lr.stats };
  const planWithoutStatistics = {
    format: PORTABLE_PLAN_FORMAT,
    version: PORTABLE_PLAN_VERSION,
    semantics: PORTABLE_PLAN_SEMANTICS,
    rootRule: analyzed.rootRule,
    symbols: {
      grammarName: analyzed.name,
      rootRule: analyzed.rootRule,
      rootRuleName: rootRule?.name ?? "module",
      tokens: analyzed.tokens.map((token) => ({
        id: token.id,
        name: token.name,
        kind: token.kind,
        channel: token.kind === "skip" ? "trivia" : "main",
        patternSource: token.patternSource,
        nullable: token.nullable,
        priority: token.priority,
        declarationOrder: token.declarationOrder,
        reachable: token.kind === "skip" ||
          analyzed.reachableTokens.has(token.id),
        span: token.span,
      })),
      literals: analyzed.literals.map((literal) => ({
        id: literal.id,
        value: literal.value,
        sourceOrder: literal.sourceOrder,
        reachable: analyzed.reachableLiterals.has(literal.id),
        span: literal.span,
      })),
      terminals: bnf.terminals.map((terminal) => ({ ...terminal })),
      nonterminals: bnf.nonterminals.map((nonterminal) => ({
        ...nonterminal,
      })),
      fields,
    },
    lexer: {
      unicodeSemantics: PORTABLE_UNICODE_SEMANTICS,
      startState: dfa.start,
      specifications: lexerSpecifications(
        analyzed,
        bnf,
        trailingContextByTokenId,
      ),
      states: dfa.states.map((state) => ({
        id: state.id,
        transitions: state.transitions.map((transition) => ({
          start: transition.start,
          end: transition.end,
          target: transition.target,
        })),
        accepts: [...state.accepts],
        selectedAccept: state.selectedAccept,
      })),
    },
    parser: {
      startState: 0,
      eofTerminal: bnf.eofTerminal,
      startProduction: 0,
      states: lr.states.map((state) => ({
        id: state.id,
        items: state.items.map((item) => ({
          production: item.production,
          dot: item.dot,
          lookaheads: lookaheadValues(item.lookaheads),
        })),
      })),
      actions: actionRows(lr.actions),
      gotos: gotoRows(lr.gotos),
      productions,
      expectedTerminals,
      statistics: parserStatistics,
      conflictPolicy: { kind: "deterministic-or-declared-branching" },
    },
    reducerSemantics: PORTABLE_REDUCER_SEMANTICS,
    reducers,
    cst: {
      rootRule: analyzed.rootRule,
      rootNodeType: rootCstRule?.nodeType ?? "RuleNode",
      rules: cstRules.map((rule) => ({
        ruleId: rule.ruleId,
        ruleName: rule.ruleName,
        nodeType: rule.nodeType,
        fields: rule.fields.map((field) => {
          let cardinality: CstFieldPlan["cardinality"] = "required";
          if (field.array) {
            cardinality = "array";
          } else if (field.nullable) {
            cardinality = "nullable";
          }
          return {
            name: field.name,
            type: field.type,
            cardinality,
            valueKind: "unknown",
          };
        }),
      })),
    },
    diagnostics: {
      semantics: PORTABLE_DIAGNOSTIC_SEMANTICS,
      sourceSpanUnit: PORTABLE_SOURCE_SPAN_UNIT,
      expectedTerminalsByState: expectedTerminals,
      terminalDisplays: bnf.terminals.map((terminal) => ({
        id: terminal.id,
        display: terminal.display,
      })),
      ruleDisplays: analyzed.rules.map((rule) => ({
        id: rule.id,
        display: rule.name,
      })),
    },
  } satisfies Omit<PortableParserPlan, "statistics">;
  const statistics = portablePlanStatistics({
    ...planWithoutStatistics,
    statistics: zeroPortablePlanStatistics(),
  });
  return { ...planWithoutStatistics, statistics };
}

export function portableParserPlanMetadata(
  plan: PortableParserPlan,
): PortableParserPlanMetadata {
  return {
    format: plan.format,
    version: plan.version,
    semantics: plan.semantics,
    hash: hashPortableParserPlan(plan),
  };
}

function lexerSpecifications(
  analyzed: AnalyzedGrammar,
  bnf: BnfGrammar,
  trailingContextByTokenId: ReadonlyMap<
    number,
    ContextualTrailingContextPlan
  >,
): LexerSpecificationPlan[] {
  const specs: LexerSpecificationPlan[] = [];
  for (const token of analyzed.tokens) {
    if (
      token.kind !== "skip" &&
      !analyzed.reachableTokens.has(token.id)
    ) {
      continue;
    }
    let trailingContext: ContextualTrailingContextPlan | undefined;
    if (token.trailingContext !== undefined) {
      trailingContext = trailingContextByTokenId.get(token.id);
      if (trailingContext === undefined) {
        throw new Error(
          `Missing compiled trailing context for token '${token.name}' (${token.id}).`,
        );
      }
    }
    specs.push({
      id: specs.length,
      type: "named",
      tokenId: token.id,
      terminalId: token.kind !== "skip"
        ? terminalIdForToken(bnf, token.id)
        : null,
      channel: token.kind === "skip" ? "trivia" : "main",
      priority: token.priority,
      order: token.declarationOrder,
      literal: false,
      contextual: token.kind === "contextual",
      trailingContext,
    });
  }
  for (const literal of analyzed.literals) {
    if (!analyzed.reachableLiterals.has(literal.id)) continue;
    specs.push({
      id: specs.length,
      type: "literal",
      literalId: literal.id,
      terminalId: terminalIdForLiteral(bnf, literal.id),
      channel: "main",
      priority: 0,
      order: literal.sourceOrder,
      literal: true,
      contextual: false,
      trailingContext: undefined,
    });
  }
  return specs;
}

function actionRows(
  table: LrTable["actions"],
): ActionRowPlan[] {
  return [...table.entries()]
    .sort(([left], [right]) => left - right)
    .map(([state, row]) => ({
      state,
      entries: [...row.entries()]
        .sort(([left], [right]) => left - right)
        .map(([terminal, actions]) => ({
          terminal,
          actions: actions.map(actionPlan).sort(compareActions),
        })),
    }));
}

function gotoRows(table: LrTable["gotos"]): GotoRowPlan[] {
  return [...table.entries()]
    .sort(([left], [right]) => left - right)
    .map(([state, row]) => ({
      state,
      entries: [...row.entries()]
        .sort(([left], [right]) => left - right)
        .map(([nonterminal, target]) => ({ nonterminal, target })),
    }));
}

function expectedTerminalRows(
  table: LrTable["actions"],
): ExpectedTerminalRowPlan[] {
  return [...table.entries()]
    .sort(([left], [right]) => left - right)
    .map(([state, row]) => ({
      state,
      terminals: [...row.keys()].sort((left, right) => left - right),
    }));
}

function actionPlan(action: LrAction): LrActionPlan {
  if (action.kind === "shift") return { kind: "shift", state: action.state };
  if (action.kind === "reduce") {
    return { kind: "reduce", production: action.production };
  }
  return { kind: "accept" };
}

function productionPlan(
  grammar: BnfGrammar,
  production: BnfProduction,
): ProductionPlan {
  return {
    id: production.id,
    stableId: productionStableId(grammar, production),
    lhs: production.lhs,
    rhs: production.rhs.map((symbol) => ({ ...symbol })),
    reducerId: production.id,
    reducer: { ...production.reducer },
    ...(production.span ? { span: production.span } : {}),
    ...(production.origin ? { origin: production.origin } : {}),
  };
}

function productionStableId(
  grammar: BnfGrammar,
  production: BnfProduction,
): string {
  const origin = production.origin;
  const payload = {
    semantics: "baba-production-v1",
    origin: origin
      ? {
        ruleName: origin.ruleName,
        expressionId: origin.expressionId ?? null,
      }
      : null,
    lhs: nonterminalStableKey(grammar, production.lhs),
    rhs: production.rhs.map((symbol) => symbolStableKey(grammar, symbol)),
    reducer: production.reducer,
  };
  return `p_${fnv1a64String(JSON.stringify(payload)).slice(0, 16)}`;
}

function symbolStableKey(grammar: BnfGrammar, symbol: BnfSymbol): string {
  if (symbol.kind === "terminal") return terminalStableKey(grammar, symbol.id);
  return nonterminalStableKey(grammar, symbol.id);
}

function terminalStableKey(grammar: BnfGrammar, terminal: number): string {
  const info = grammar.terminals[terminal];
  if (!info) return `terminal:${terminal}`;
  if (info.kind === "eof") return "eof";
  if (info.kind === "named") return `named:${info.display}`;
  return `literal:${info.display}`;
}

function nonterminalStableKey(
  grammar: BnfGrammar,
  nonterminal: number,
): string {
  const info = grammar.nonterminals[nonterminal];
  if (!info) return `nonterminal:${nonterminal}`;
  if (info.ruleId !== undefined) return `rule:${info.name}`;
  return `expr:${info.name}:${info.expressionId ?? nonterminal}`;
}

function reducerPlan(
  id: number,
  reducer: ReducerSpec,
  fields: readonly FieldSymbolPlan[],
): PortableReducerPlan {
  switch (reducer.kind) {
    case "start":
      return { id, op: "start" };
    case "rule":
      return { id, op: "rule", ruleId: reducer.ruleId };
    case "terminal":
      return { id, op: "terminal" };
    case "ruleRef":
      return { id, op: "rule-ref" };
    case "identity":
      return { id, op: "identity" };
    case "sequence":
      return { id, op: "sequence" };
    case "optionalEmpty":
      return { id, op: "optional-empty" };
    case "optionalSome":
      return { id, op: "optional-some" };
    case "repeatEmpty":
      return { id, op: "repeat-empty" };
    case "repeatAppend":
      return { id, op: "repeat-append" };
    case "repeat1First":
      return { id, op: "repeat1-first" };
    case "repeat1Append":
      return { id, op: "repeat1-append" };
    case "separatedFirst":
      return { id, op: "separated-first" };
    case "separatedAppend":
      return { id, op: "separated-append" };
    case "field":
      return {
        id,
        op: "field",
        fieldId: fields.find((field) => field.name === reducer.name)?.id ?? -1,
      };
  }
}

function compareActions(left: LrActionPlan, right: LrActionPlan): number {
  const kindOrder = { shift: 0, reduce: 1, accept: 2 } as const;
  return kindOrder[left.kind] - kindOrder[right.kind] ||
    actionValue(left) - actionValue(right);
}

function actionValue(action: LrActionPlan): number {
  if (action.kind === "shift") return action.state;
  if (action.kind === "reduce") return action.production;
  return 0;
}

function fieldSymbols(
  cstRules: ReturnType<typeof collectRuleFieldSchemas>,
): FieldSymbolPlan[] {
  return [
    ...new Set(
      cstRules.flatMap((rule) => rule.fields.map((field) => field.name)),
    ),
  ].sort().map((name, id) => ({ id, name }));
}

function terminalIdForToken(bnf: BnfGrammar, tokenId: number): number | null {
  return bnf.terminals.find((terminal) => terminal.tokenId === tokenId)?.id ??
    null;
}

function terminalIdForLiteral(bnf: BnfGrammar, literalId: number): number {
  return bnf.terminals.find((terminal) => terminal.literalId === literalId)
    ?.id ?? -1;
}

function lookaheadBitset(
  values: readonly number[],
  size: number,
): LookaheadBitset {
  const words = Array(Math.ceil(size / 32)).fill(0);
  for (const value of values) {
    words[value >> 5] |= 1 << (value & 31);
  }
  return { words, size };
}

function lrActionFromPlan(action: LrActionPlan): LrAction {
  if (action.kind === "shift") return { kind: "shift", state: action.state };
  if (action.kind === "reduce") {
    return { kind: "reduce", production: action.production };
  }
  return { kind: "accept" };
}

function zeroPortablePlanStatistics(): PortablePlanStatistics {
  return {
    lexerStates: 0,
    lexerTransitions: 0,
    lexerAcceptCandidates: 0,
    lexerAverageAcceptCandidatesPerStateMilli: 0,
    lexerMaxAcceptCandidatesPerState: 0,
    lexerAmbiguousAcceptStates: 0,
    bnfProductions: 0,
    lrStates: 0,
    lrItems: 0,
    actionEntries: 0,
    gotoEntries: 0,
    reducerCount: 0,
    fieldCount: 0,
    serializedJsonBytes: 0,
  };
}

export function portablePlanStatistics(
  plan: PortableParserPlan,
): PortablePlanStatistics {
  const lexerAcceptCounts = plan.lexer.states.map((state) =>
    state.accepts.length
  );
  const lexerAcceptCandidates = lexerAcceptCounts.reduce(
    (sum, count) => sum + count,
    0,
  );
  const withoutSerializedBytes = {
    lexerStates: plan.lexer.states.length,
    lexerTransitions: plan.lexer.states.reduce(
      (sum, state) => sum + state.transitions.length,
      0,
    ),
    lexerAcceptCandidates,
    lexerAverageAcceptCandidatesPerStateMilli: plan.lexer.states.length === 0
      ? 0
      : Math.round(lexerAcceptCandidates * 1000 / plan.lexer.states.length),
    lexerMaxAcceptCandidatesPerState: lexerAcceptCounts.reduce(
      (max, count) => Math.max(max, count),
      0,
    ),
    lexerAmbiguousAcceptStates: lexerAcceptCounts.filter((count) => count > 1)
      .length,
    bnfProductions: plan.parser.productions.length,
    lrStates: plan.parser.states.length,
    lrItems: plan.parser.states.reduce(
      (sum, state) => sum + state.items.length,
      0,
    ),
    actionEntries: plan.parser.actions.reduce(
      (sum, row) => sum + row.entries.length,
      0,
    ),
    gotoEntries: plan.parser.gotos.reduce(
      (sum, row) => sum + row.entries.length,
      0,
    ),
    reducerCount: plan.reducers.length,
    fieldCount: plan.symbols.fields.length,
  };
  const stablePlan = {
    ...plan,
    statistics: { ...withoutSerializedBytes, serializedJsonBytes: 0 },
  };
  return {
    ...withoutSerializedBytes,
    serializedJsonBytes: new TextEncoder().encode(
      serializePortableParserPlanJson(stablePlan),
    ).length,
  };
}

export function serializePortableParserPlanJson(
  plan: PortableParserPlan,
): string {
  return `${JSON.stringify(canonicalValue(plan), null, 2)}\n`;
}

export function parsePortableParserPlanJson(
  source: string,
): PortableParserPlan | { diagnostics: readonly Diagnostic[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    return {
      diagnostics: [{
        code: "PORTABLE_PLAN_JSON_PARSE_ERROR",
        severity: "error",
        message: error instanceof Error
          ? `Invalid portable parser plan JSON: ${error.message}`
          : "Invalid portable parser plan JSON.",
      }],
    };
  }
  const diagnostics = validatePortableParserPlan(parsed);
  if (diagnostics.length > 0) return { diagnostics };
  return parsed as PortableParserPlan;
}

export function portablePlanToBnf(plan: PortableParserPlan): BnfGrammar {
  return {
    startNonterminal: plan.symbols.nonterminals[0]?.id ?? 0,
    rootRuleNonterminal:
      plan.symbols.nonterminals.find((nonterminal) =>
        nonterminal.ruleId === plan.rootRule
      )?.id ?? 0,
    eofTerminal: plan.parser.eofTerminal,
    terminals: plan.symbols.terminals.map((terminal) => ({ ...terminal })),
    nonterminals: plan.symbols.nonterminals.map((nonterminal) => ({
      ...nonterminal,
    })),
    productions: plan.parser.productions.map((production) => ({
      id: production.id,
      lhs: production.lhs,
      rhs: production.rhs.map((symbol) => ({ ...symbol })),
      reducer: { ...production.reducer },
      ...(production.span ? { span: production.span } : {}),
      ...(production.origin ? { origin: production.origin } : {}),
    })),
    diagnostics: [],
  };
}

export function portablePlanToLrTable(plan: PortableParserPlan): LrTable {
  return {
    states: plan.parser.states.map((state) => ({
      id: state.id,
      items: state.items.map((item) => ({
        production: item.production,
        dot: item.dot,
        lookaheads: lookaheadBitset(
          item.lookaheads,
          plan.symbols.terminals.length,
        ),
      })),
    })),
    actions: new Map(plan.parser.actions.map((row) => [
      row.state,
      new Map(row.entries.map((entry) => [
        entry.terminal,
        entry.actions.map(lrActionFromPlan) as LrActionSet,
      ])),
    ])),
    gotos: new Map(plan.parser.gotos.map((row) => [
      row.state,
      new Map(row.entries.map((entry) => [entry.nonterminal, entry.target])),
    ])),
    stats: { ...plan.parser.statistics },
    diagnostics: [],
  };
}

export function portablePlanToDfa(plan: PortableParserPlan): Dfa {
  return {
    start: plan.lexer.startState,
    states: plan.lexer.states.map((state) => ({
      id: state.id,
      nfaStates: [],
      accepts: [...state.accepts],
      selectedAccept: state.selectedAccept,
      transitions: state.transitions.map((transition) => ({ ...transition })),
    })),
  };
}

export function validatePortableParserPlan(plan: unknown): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const fail = (path: string, message: string) => {
    diagnostics.push({
      code: "PORTABLE_PLAN_INVALID",
      severity: "error",
      message: `${path}: ${message}`,
    });
  };
  try {
    if (!isRecord(plan)) {
      fail("$", "plan must be an object.");
      return diagnostics;
    }
    if (plan.format !== PORTABLE_PLAN_FORMAT) {
      fail("$.format", `expected ${PORTABLE_PLAN_FORMAT}.`);
    }
    if (plan.version !== PORTABLE_PLAN_VERSION) {
      fail("$.version", `expected ${PORTABLE_PLAN_VERSION}.`);
    }
    if (plan.semantics !== PORTABLE_PLAN_SEMANTICS) {
      fail("$.semantics", `expected ${PORTABLE_PLAN_SEMANTICS}.`);
    }
    if (plan.reducerSemantics !== PORTABLE_REDUCER_SEMANTICS) {
      fail("$.reducerSemantics", `expected ${PORTABLE_REDUCER_SEMANTICS}.`);
    }
    const planRootRule = integerProperty(
      plan,
      "rootRule",
      "$.rootRule",
      fail,
    );
    const symbols = getRecord(plan, "symbols", fail);
    const lexer = getRecord(plan, "lexer", fail);
    const parser = getRecord(plan, "parser", fail);
    const cst = getRecord(plan, "cst", fail);
    const reducers = getArray(plan, "reducers", fail);
    if (!symbols || !lexer || !parser || !cst || !reducers) return diagnostics;

    const tokens = getArray(symbols, "tokens", fail) ?? [];
    const literals = getArray(symbols, "literals", fail) ?? [];
    const terminals = getArray(symbols, "terminals", fail) ?? [];
    const nonterminals = getArray(symbols, "nonterminals", fail) ?? [];
    const fields = getArray(symbols, "fields", fail) ?? [];
    const knownRuleId = (ruleId: number | undefined) =>
      ruleId !== undefined && hasRuleId(nonterminals, ruleId);
    if (!knownRuleId(planRootRule)) {
      fail("$.rootRule", "root rule must identify a known user rule.");
    }
    validateSequentialIds(tokens, "$.symbols.tokens", fail);
    validateSequentialIds(literals, "$.symbols.literals", fail);
    validateSequentialIds(terminals, "$.symbols.terminals", fail);
    validateSequentialIds(nonterminals, "$.symbols.nonterminals", fail);
    validateSequentialIds(fields, "$.symbols.fields", fail);
    for (const [index, token] of tokens.entries()) {
      if (!isRecord(token)) {
        continue;
      }
      if (
        token.kind !== "token" && token.kind !== "skip" &&
        token.kind !== "contextual"
      ) {
        fail(`$.symbols.tokens[${index}].kind`, "unknown token kind.");
      }
      if (token.channel !== "main" && token.channel !== "trivia") {
        fail(`$.symbols.tokens[${index}].channel`, "unknown token channel.");
      }
      if (token.kind === "skip" && token.channel !== "trivia") {
        fail(
          `$.symbols.tokens[${index}].channel`,
          "skip tokens must use the trivia channel.",
        );
      }
      if (token.kind !== "skip" && token.channel !== "main") {
        fail(
          `$.symbols.tokens[${index}].channel`,
          "parser tokens must use the main channel.",
        );
      }
    }
    const rootRule = integerProperty(
      symbols,
      "rootRule",
      "$.symbols.rootRule",
      fail,
    );
    if (
      rootRule === undefined ||
      !knownRuleId(rootRule)
    ) {
      fail("$.symbols.rootRule", "root rule must identify a known user rule.");
    }

    const specs = getArray(lexer, "specifications", fail) ?? [];
    const states = getArray(lexer, "states", fail) ?? [];
    validateSequentialIds(specs, "$.lexer.specifications", fail);
    validateSequentialIds(states, "$.lexer.states", fail);
    const startState = integerProperty(
      lexer,
      "startState",
      "$.lexer.startState",
      fail,
    );
    if (startState === undefined || !hasId(states, startState)) {
      fail("$.lexer.startState", "start state must refer to a lexer state.");
    }
    for (const [index, spec] of specs.entries()) {
      if (!isRecord(spec)) {
        fail(
          `$.lexer.specifications[${index}]`,
          "specification must be an object.",
        );
        continue;
      }
      let expectedContextual = false;
      if (spec.type === "named") {
        const tokenId = integerProperty(
          spec,
          "tokenId",
          `$.lexer.specifications[${index}].tokenId`,
          fail,
        );
        if (tokenId === undefined || !hasId(tokens, tokenId)) {
          fail(
            `$.lexer.specifications[${index}].tokenId`,
            "must refer to a token.",
          );
        } else {
          const token = tokens[tokenId];
          if (isRecord(token) && token.kind === "contextual") {
            expectedContextual = true;
          }
        }
      } else if (spec.type === "literal") {
        const literalId = integerProperty(
          spec,
          "literalId",
          `$.lexer.specifications[${index}].literalId`,
          fail,
        );
        if (literalId === undefined || !hasId(literals, literalId)) {
          fail(
            `$.lexer.specifications[${index}].literalId`,
            "must refer to a literal.",
          );
        }
      } else {
        fail(
          `$.lexer.specifications[${index}].type`,
          "unknown lexer specification type.",
        );
      }
      if (typeof spec.contextual !== "boolean") {
        fail(
          `$.lexer.specifications[${index}].contextual`,
          "must be a boolean.",
        );
      } else if (spec.contextual !== expectedContextual) {
        fail(
          `$.lexer.specifications[${index}].contextual`,
          "must match the referenced token kind.",
        );
      }
      const trailingContext = spec.trailingContext;
      if (trailingContext !== undefined) {
        if (!isRecord(trailingContext)) {
          fail(
            `$.lexer.specifications[${index}].trailingContext`,
            "must be an object when present.",
          );
        } else {
          validateContextualTrailingContext(
            trailingContext,
            `$.lexer.specifications[${index}].trailingContext`,
            fail,
          );
        }
        if (spec.contextual !== true) {
          fail(
            `$.lexer.specifications[${index}].trailingContext`,
            "is allowed only on contextual lexer specifications.",
          );
        }
      }
      if (spec.terminalId !== null && spec.terminalId !== undefined) {
        const terminalId = integerProperty(
          spec,
          "terminalId",
          `$.lexer.specifications[${index}].terminalId`,
          fail,
        );
        if (terminalId === undefined || !hasId(terminals, terminalId)) {
          fail(
            `$.lexer.specifications[${index}].terminalId`,
            "must refer to a terminal or null.",
          );
        }
      }
    }
    for (const [index, state] of states.entries()) {
      if (!isRecord(state)) continue;
      const transitions = getArray(state, "transitions", fail) ?? [];
      let previousEnd = -1;
      for (const [transitionIndex, transition] of transitions.entries()) {
        if (!isRecord(transition)) {
          fail(
            `$.lexer.states[${index}].transitions[${transitionIndex}]`,
            "transition must be an object.",
          );
          continue;
        }
        const start = integerProperty(
          transition,
          "start",
          `$.lexer.states[${index}].transitions[${transitionIndex}].start`,
          fail,
        );
        const end = integerProperty(
          transition,
          "end",
          `$.lexer.states[${index}].transitions[${transitionIndex}].end`,
          fail,
        );
        const target = integerProperty(
          transition,
          "target",
          `$.lexer.states[${index}].transitions[${transitionIndex}].target`,
          fail,
        );
        if (start === undefined || end === undefined || target === undefined) {
          continue;
        }
        if (!isUnicodeScalar(start) || !isUnicodeScalar(end) || start > end) {
          fail(
            `$.lexer.states[${index}].transitions[${transitionIndex}]`,
            "transition range must be sorted Unicode scalar values.",
          );
        }
        if (start <= previousEnd) {
          fail(
            `$.lexer.states[${index}].transitions[${transitionIndex}]`,
            "transition ranges must be sorted and nonoverlapping.",
          );
        }
        if (!hasId(states, target)) {
          fail(
            `$.lexer.states[${index}].transitions[${transitionIndex}].target`,
            "must refer to a lexer state.",
          );
        }
        previousEnd = end;
      }
      for (const accept of getArray(state, "accepts", fail) ?? []) {
        if (!isSupportedInteger(accept) || !hasId(specs, accept)) {
          fail(
            `$.lexer.states[${index}].accepts`,
            "accept candidate must refer to a lexer specification.",
          );
        }
      }
      if (state.selectedAccept !== null && state.selectedAccept !== undefined) {
        const selectedAccept = integerProperty(
          state,
          "selectedAccept",
          `$.lexer.states[${index}].selectedAccept`,
          fail,
        );
        if (selectedAccept === undefined || !hasId(specs, selectedAccept)) {
          fail(
            `$.lexer.states[${index}].selectedAccept`,
            "must refer to a lexer specification or null.",
          );
        }
      }
    }

    validateSequentialIds(reducers, "$.reducers", fail);
    for (const [index, reducer] of reducers.entries()) {
      if (!isRecord(reducer)) continue;
      if (!isReducerOp(reducer.op)) {
        fail(`$.reducers[${index}].op`, "unknown reducer opcode.");
      }
      if (reducer.op === "rule") {
        const ruleId = integerProperty(
          reducer,
          "ruleId",
          `$.reducers[${index}].ruleId`,
          fail,
        );
        if (ruleId === undefined || !hasRuleId(nonterminals, ruleId)) {
          fail(`$.reducers[${index}].ruleId`, "must refer to a rule.");
        }
      }
      if (reducer.op === "field") {
        const fieldId = integerProperty(
          reducer,
          "fieldId",
          `$.reducers[${index}].fieldId`,
          fail,
        );
        if (fieldId === undefined || !hasId(fields, fieldId)) {
          fail(`$.reducers[${index}].fieldId`, "must refer to a field.");
        }
      }
    }

    const parserStates = getArray(parser, "states", fail) ?? [];
    const productions = getArray(parser, "productions", fail) ?? [];
    validateSequentialIds(parserStates, "$.parser.states", fail);
    validateSequentialIds(productions, "$.parser.productions", fail);
    const eofTerminal = integerProperty(
      parser,
      "eofTerminal",
      "$.parser.eofTerminal",
      fail,
    );
    if (eofTerminal === undefined || !hasId(terminals, eofTerminal)) {
      fail("$.parser.eofTerminal", "must refer to a terminal.");
    }
    const parserStartState = integerProperty(
      parser,
      "startState",
      "$.parser.startState",
      fail,
    );
    if (
      parserStartState === undefined || !hasId(parserStates, parserStartState)
    ) {
      fail("$.parser.startState", "must refer to a parser state.");
    }
    const startProduction = integerProperty(
      parser,
      "startProduction",
      "$.parser.startProduction",
      fail,
    );
    if (startProduction === undefined || !hasId(productions, startProduction)) {
      fail("$.parser.startProduction", "must refer to a production.");
    }
    const productionStableIds = new Set<string>();
    for (const [index, production] of productions.entries()) {
      if (!isRecord(production)) continue;
      const stableId = stringProperty(
        production,
        "stableId",
        `$.parser.productions[${index}].stableId`,
        fail,
      );
      if (stableId !== undefined) {
        if (!/^p_[0-9a-f]{16}$/.test(stableId)) {
          fail(
            `$.parser.productions[${index}].stableId`,
            "must be a stable production id.",
          );
        } else if (productionStableIds.has(stableId)) {
          fail(
            `$.parser.productions[${index}].stableId`,
            "must be unique.",
          );
        } else {
          productionStableIds.add(stableId);
        }
      }
      const lhs = integerProperty(
        production,
        "lhs",
        `$.parser.productions[${index}].lhs`,
        fail,
      );
      const reducerId = integerProperty(
        production,
        "reducerId",
        `$.parser.productions[${index}].reducerId`,
        fail,
      );
      if (lhs === undefined || !hasId(nonterminals, lhs)) {
        fail(
          `$.parser.productions[${index}].lhs`,
          "must refer to a nonterminal.",
        );
      }
      if (reducerId === undefined || !hasId(reducers, reducerId)) {
        fail(
          `$.parser.productions[${index}].reducerId`,
          "must refer to a reducer.",
        );
      }
      for (
        const [rhsIndex, symbol] of (getArray(production, "rhs", fail) ?? [])
          .entries()
      ) {
        if (!isRecord(symbol)) {
          fail(
            `$.parser.productions[${index}].rhs[${rhsIndex}]`,
            "symbol must be an object.",
          );
          continue;
        }
        const id = integerProperty(
          symbol,
          "id",
          `$.parser.productions[${index}].rhs[${rhsIndex}].id`,
          fail,
        );
        if (
          symbol.kind === "terminal" &&
          (id === undefined || !hasId(terminals, id))
        ) {
          fail(
            `$.parser.productions[${index}].rhs[${rhsIndex}].id`,
            "must refer to a terminal.",
          );
        } else if (
          symbol.kind === "nonterminal" &&
          (id === undefined || !hasId(nonterminals, id))
        ) {
          fail(
            `$.parser.productions[${index}].rhs[${rhsIndex}].id`,
            "must refer to a nonterminal.",
          );
        } else if (
          symbol.kind !== "terminal" && symbol.kind !== "nonterminal"
        ) {
          fail(
            `$.parser.productions[${index}].rhs[${rhsIndex}].kind`,
            "unknown symbol kind.",
          );
        }
      }
    }
    validateActionRows(
      getArray(parser, "actions", fail) ?? [],
      terminals,
      parserStates,
      productions,
      fail,
    );
    validateGotoRows(
      getArray(parser, "gotos", fail) ?? [],
      nonterminals,
      parserStates,
      fail,
    );
    validateExpectedRows(
      getArray(parser, "expectedTerminals", fail) ?? [],
      terminals,
      parserStates,
      fail,
    );

    const cstRules = getArray(cst, "rules", fail) ?? [];
    for (const [ruleIndex, rule] of cstRules.entries()) {
      if (!isRecord(rule)) continue;
      const ruleId = integerProperty(
        rule,
        "ruleId",
        `$.cst.rules[${ruleIndex}].ruleId`,
        fail,
      );
      if (ruleId === undefined || !hasRuleId(nonterminals, ruleId)) {
        fail(`$.cst.rules[${ruleIndex}].ruleId`, "must refer to a rule.");
      }
      for (
        const [fieldIndex, field] of (getArray(rule, "fields", fail) ?? [])
          .entries()
      ) {
        if (!isRecord(field)) {
          fail(
            `$.cst.rules[${ruleIndex}].fields[${fieldIndex}]`,
            "field must be an object.",
          );
          continue;
        }
        if (
          field.cardinality !== "required" &&
          field.cardinality !== "nullable" &&
          field.cardinality !== "array"
        ) {
          fail(
            `$.cst.rules[${ruleIndex}].fields[${fieldIndex}].cardinality`,
            "invalid field cardinality.",
          );
        }
      }
    }
    visitJson(plan, "$", (path, value) => {
      if (typeof value === "number" && !isSupportedInteger(value)) {
        fail(path, "integer is outside the supported serialization range.");
      }
    });
  } catch (error) {
    fail(
      "$",
      error instanceof Error ? error.message : "unexpected validation failure.",
    );
  }
  return diagnostics;
}

function validateContextualTrailingContext(
  trailingContext: Record<string, unknown>,
  path: string,
  fail: (path: string, message: string) => void,
): void {
  if (typeof trailingContext.followedByEof !== "boolean") {
    fail(`${path}.followedByEof`, "must be a boolean.");
  }
  if (trailingContext.followedBy !== undefined) {
    validateContextualGuardDfa(
      trailingContext.followedBy,
      `${path}.followedBy`,
      fail,
    );
  }
  if (trailingContext.notFollowedBy !== undefined) {
    validateContextualGuardDfa(
      trailingContext.notFollowedBy,
      `${path}.notFollowedBy`,
      fail,
    );
  }
  if (!Array.isArray(trailingContext.excludedWords)) {
    fail(`${path}.excludedWords`, "must be an array.");
    return;
  }
  for (const [index, word] of trailingContext.excludedWords.entries()) {
    if (typeof word !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(word)) {
      fail(
        `${path}.excludedWords[${index}]`,
        "must be an ASCII identifier.",
      );
    }
  }
}

function validateContextualGuardDfa(
  value: unknown,
  path: string,
  fail: (path: string, message: string) => void,
): void {
  if (!isRecord(value)) {
    fail(path, "must be a DFA object.");
    return;
  }
  const states = value.states;
  if (!Array.isArray(states) || states.length === 0) {
    fail(`${path}.states`, "must be a nonempty array.");
    return;
  }
  validateSequentialIds(states, `${path}.states`, fail);
  const start = integerProperty(value, "start", `${path}.start`, fail);
  if (start === undefined || !hasId(states, start)) {
    fail(`${path}.start`, "must refer to a guard state.");
  }
  for (const [stateIndex, state] of states.entries()) {
    if (!isRecord(state)) {
      continue;
    }
    const transitions = state.transitions;
    if (!Array.isArray(transitions)) {
      fail(`${path}.states[${stateIndex}].transitions`, "must be an array.");
      continue;
    }
    let previousEnd = -1;
    for (const [transitionIndex, transition] of transitions.entries()) {
      const transitionPath =
        `${path}.states[${stateIndex}].transitions[${transitionIndex}]`;
      if (!isRecord(transition)) {
        fail(transitionPath, "must be an object.");
        continue;
      }
      const rangeStart = integerProperty(
        transition,
        "start",
        `${transitionPath}.start`,
        fail,
      );
      const rangeEnd = integerProperty(
        transition,
        "end",
        `${transitionPath}.end`,
        fail,
      );
      const target = integerProperty(
        transition,
        "target",
        `${transitionPath}.target`,
        fail,
      );
      if (
        rangeStart === undefined || rangeEnd === undefined ||
        target === undefined
      ) {
        continue;
      }
      if (
        !isUnicodeScalar(rangeStart) || !isUnicodeScalar(rangeEnd) ||
        rangeStart > rangeEnd || rangeStart <= previousEnd
      ) {
        fail(transitionPath, "range must be sorted Unicode scalar values.");
      }
      if (!hasId(states, target)) {
        fail(`${transitionPath}.target`, "must refer to a guard state.");
      }
      previousEnd = rangeEnd;
    }
  }
}

function hashPortableParserPlan(plan: PortableParserPlan): string {
  const bytes = new TextEncoder().encode(serializePortableParserPlanJson(plan));
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

function validateActionRows(
  rows: readonly unknown[],
  terminals: readonly unknown[],
  states: readonly unknown[],
  productions: readonly unknown[],
  fail: (path: string, message: string) => void,
): void {
  const seenStates = new Set<number>();
  let previousState = -1;
  for (const [rowIndex, row] of rows.entries()) {
    if (!isRecord(row)) continue;
    const rowPath = `$.parser.actions[${rowIndex}]`;
    const state = integerProperty(
      row,
      "state",
      `${rowPath}.state`,
      fail,
    );
    if (state === undefined || !hasId(states, state)) {
      fail(
        `${rowPath}.state`,
        "must refer to a parser state.",
      );
    } else {
      if (seenStates.has(state)) {
        fail(`${rowPath}.state`, "action rows must not duplicate states.");
      }
      if (state <= previousState) {
        fail(`${rowPath}.state`, "action rows must be sorted by state.");
      }
      seenStates.add(state);
      previousState = state;
    }
    const seenTerminals = new Set<number>();
    let previousTerminal = -1;
    for (
      const [entryIndex, entry] of (getArray(row, "entries", fail) ?? [])
        .entries()
    ) {
      if (!isRecord(entry)) continue;
      const entryPath = `${rowPath}.entries[${entryIndex}]`;
      const terminal = integerProperty(
        entry,
        "terminal",
        `${entryPath}.terminal`,
        fail,
      );
      if (terminal === undefined || !hasId(terminals, terminal)) {
        fail(
          `${entryPath}.terminal`,
          "must refer to a terminal.",
        );
      } else {
        if (seenTerminals.has(terminal)) {
          fail(
            `${entryPath}.terminal`,
            "action entries must not duplicate terminals.",
          );
        }
        if (terminal <= previousTerminal) {
          fail(`${entryPath}.terminal`, "action entries must be sorted.");
        }
        seenTerminals.add(terminal);
        previousTerminal = terminal;
      }
      const actions = getArray(entry, "actions", fail) ?? [];
      if (actions.length === 0) {
        fail(`${entryPath}.actions`, "action entry must contain an action.");
      }
      const seenActions = new Set<string>();
      let previousActionKey: LrActionSortKey | undefined;
      for (
        const [actionIndex, action] of actions.entries()
      ) {
        if (!isRecord(action)) continue;
        const actionPath = `${entryPath}.actions[${actionIndex}]`;
        let actionKey: LrActionSortKey | undefined;
        if (action.kind === "shift") {
          const target = integerProperty(
            action,
            "state",
            `${actionPath}.state`,
            fail,
          );
          if (target === undefined || !hasId(states, target)) {
            fail(
              `${actionPath}.state`,
              "must refer to a parser state.",
            );
          } else {
            actionKey = { kindOrder: 0, value: target };
          }
        } else if (action.kind === "reduce") {
          const production = integerProperty(
            action,
            "production",
            `${actionPath}.production`,
            fail,
          );
          if (production === undefined || !hasId(productions, production)) {
            fail(
              `${actionPath}.production`,
              "must refer to a production.",
            );
          } else {
            actionKey = { kindOrder: 1, value: production };
          }
        } else if (action.kind === "accept") {
          actionKey = { kindOrder: 2, value: 0 };
        } else {
          fail(
            `${actionPath}.kind`,
            "unknown LR action kind.",
          );
        }
        if (actionKey === undefined) continue;
        const key = `${actionKey.kindOrder}:${actionKey.value}`;
        if (seenActions.has(key)) {
          fail(`${actionPath}`, "action entries must not duplicate actions.");
        }
        if (
          previousActionKey !== undefined &&
          compareActionSortKeys(actionKey, previousActionKey) <= 0
        ) {
          fail(`${actionPath}`, "actions must be sorted canonically.");
        }
        seenActions.add(key);
        previousActionKey = actionKey;
      }
    }
  }
}

interface LrActionSortKey {
  readonly kindOrder: number;
  readonly value: number;
}

function compareActionSortKeys(
  left: LrActionSortKey,
  right: LrActionSortKey,
): number {
  return left.kindOrder - right.kindOrder || left.value - right.value;
}

function validateGotoRows(
  rows: readonly unknown[],
  nonterminals: readonly unknown[],
  states: readonly unknown[],
  fail: (path: string, message: string) => void,
): void {
  for (const [rowIndex, row] of rows.entries()) {
    if (!isRecord(row)) continue;
    const state = integerProperty(
      row,
      "state",
      `$.parser.gotos[${rowIndex}].state`,
      fail,
    );
    if (state === undefined || !hasId(states, state)) {
      fail(
        `$.parser.gotos[${rowIndex}].state`,
        "must refer to a parser state.",
      );
    }
    for (
      const [entryIndex, entry] of (getArray(row, "entries", fail) ?? [])
        .entries()
    ) {
      if (!isRecord(entry)) continue;
      const nonterminal = integerProperty(
        entry,
        "nonterminal",
        `$.parser.gotos[${rowIndex}].entries[${entryIndex}].nonterminal`,
        fail,
      );
      const target = integerProperty(
        entry,
        "target",
        `$.parser.gotos[${rowIndex}].entries[${entryIndex}].target`,
        fail,
      );
      if (nonterminal === undefined || !hasId(nonterminals, nonterminal)) {
        fail(
          `$.parser.gotos[${rowIndex}].entries[${entryIndex}].nonterminal`,
          "must refer to a nonterminal.",
        );
      }
      if (target === undefined || !hasId(states, target)) {
        fail(
          `$.parser.gotos[${rowIndex}].entries[${entryIndex}].target`,
          "must refer to a parser state.",
        );
      }
    }
  }
}

function validateExpectedRows(
  rows: readonly unknown[],
  terminals: readonly unknown[],
  states: readonly unknown[],
  fail: (path: string, message: string) => void,
): void {
  for (const [rowIndex, row] of rows.entries()) {
    if (!isRecord(row)) continue;
    const state = integerProperty(
      row,
      "state",
      `$.parser.expectedTerminals[${rowIndex}].state`,
      fail,
    );
    if (state === undefined || !hasId(states, state)) {
      fail(
        `$.parser.expectedTerminals[${rowIndex}].state`,
        "must refer to a parser state.",
      );
    }
    for (const terminal of getArray(row, "terminals", fail) ?? []) {
      if (!isSupportedInteger(terminal) || !hasId(terminals, terminal)) {
        fail(
          `$.parser.expectedTerminals[${rowIndex}].terminals`,
          "must contain terminal ids.",
        );
      }
    }
  }
}

function validateSequentialIds(
  values: readonly unknown[],
  path: string,
  fail: (path: string, message: string) => void,
): void {
  const seen = new Set<number>();
  for (const [index, value] of values.entries()) {
    if (!isRecord(value)) {
      fail(`${path}[${index}]`, "entry must be an object.");
      continue;
    }
    const id = integerProperty(value, "id", `${path}[${index}].id`, fail);
    if (id === undefined) continue;
    if (seen.has(id)) fail(`${path}[${index}].id`, "duplicate id.");
    seen.add(id);
    if (id !== index) {
      fail(`${path}[${index}].id`, "ids must be dense and sorted.");
    }
  }
}

function hasRuleId(nonterminals: readonly unknown[], ruleId: number): boolean {
  return nonterminals.some((value) =>
    isRecord(value) && value.ruleId === ruleId
  );
}

function getRecord(
  value: Record<string, unknown>,
  key: string,
  fail: (path: string, message: string) => void,
): Record<string, unknown> | undefined {
  const child = value[key];
  if (!isRecord(child)) {
    fail(`$.${key}`, "must be an object.");
    return undefined;
  }
  return child;
}

function getArray(
  value: Record<string, unknown>,
  key: string,
  fail: (path: string, message: string) => void,
): readonly unknown[] | undefined {
  const child = value[key];
  if (!Array.isArray(child)) {
    fail(`$.${key}`, "must be an array.");
    return undefined;
  }
  return child;
}

function isReducerOp(value: unknown): value is PortableReducerPlan["op"] {
  return value === "start" || value === "rule" || value === "terminal" ||
    value === "rule-ref" || value === "identity" || value === "sequence" ||
    value === "optional-empty" || value === "optional-some" ||
    value === "repeat-empty" || value === "repeat-append" ||
    value === "repeat1-first" || value === "repeat1-append" ||
    value === "separated-first" || value === "separated-append" ||
    value === "field";
}
