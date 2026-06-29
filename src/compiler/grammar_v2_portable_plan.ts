import type { Diagnostic, SourceSpan } from "../ast.ts";
import {
  buildGrammarV2AstSchema,
  type GrammarV2AstSchema,
} from "./grammar_v2_ast.ts";
import {
  buildGrammarV2CstSchema,
  type GrammarV2CstSchema,
} from "./grammar_v2_cst.ts";
import type {
  AnalyzedGrammarV2,
  AnalyzedGrammarV2Constructor,
  AnalyzedGrammarV2ExpressionIsland,
  AnalyzedGrammarV2Field,
  AnalyzedGrammarV2Literal,
  AnalyzedGrammarV2Mode,
  AnalyzedGrammarV2Rule,
  AnalyzedGrammarV2Token,
  GrammarV2LiteralId,
  GrammarV2RuleId,
  GrammarV2TokenId,
} from "./grammar_v2_ir.ts";
import {
  buildGrammarV2ParserCorePlan,
  type GrammarV2ParserCoreOptions,
  type GrammarV2ParserCorePlan,
} from "./grammar_v2_parser_core.ts";
import {
  buildGrammarV2PrattPlan,
  type GrammarV2PrattPlan,
} from "./grammar_v2_pratt.ts";
import type { Dfa } from "./regex/dfa.ts";
import type {
  BnfProduction,
  BnfSymbol,
  NonterminalInfo,
  TerminalInfo,
} from "./runtime_plan/bnf.ts";
import type {
  LookaheadBitset,
  LrAction,
  LrPlanningStats,
} from "./runtime_plan/lr1.ts";

const FORMAT = "baba-portable-plan";
const VERSION = 2;
const SEMANTICS = "baba-portable-v2";
const MAX_SAFE_SERIALIZED_INTEGER = Number.MAX_SAFE_INTEGER;

export interface GrammarV2PortablePlan {
  readonly format: "baba-portable-plan";
  readonly version: 2;
  readonly semantics: "baba-portable-v2";
  readonly grammar: GrammarV2PortableGrammarIdentity;
  readonly symbols: GrammarV2PortableSymbols;
  readonly lexer: GrammarV2PortableLexerPlan;
  readonly parser: GrammarV2PortableParserPlan;
  readonly expressions: GrammarV2PortableExpressionPlan;
  readonly recovery: GrammarV2PortableRecoveryPlan;
  readonly cst: GrammarV2CstSchema;
  readonly ast: GrammarV2AstSchema;
  readonly diagnostics: GrammarV2PortableDiagnosticsPlan;
  readonly debug: GrammarV2PortableDebugPlan;
  readonly statistics: GrammarV2PortablePlanStatistics;
  readonly targets: GrammarV2PortableTargetPlan;
  readonly grammarIr: GrammarV2PortableGrammarIr;
}

export interface GrammarV2PortablePlanMetadata {
  readonly format: GrammarV2PortablePlan["format"];
  readonly version: GrammarV2PortablePlan["version"];
  readonly semantics: GrammarV2PortablePlan["semantics"];
  readonly hash: string;
}

export interface GrammarV2PortableGrammarIdentity {
  readonly name: string;
  readonly rootRule: GrammarV2RuleId;
  readonly rootRuleName: string;
  readonly hash: string;
}

export interface GrammarV2PortableSymbols {
  readonly tokens: readonly GrammarV2PortableNamedSymbol[];
  readonly rules: readonly GrammarV2PortableNamedSymbol[];
  readonly literals: readonly GrammarV2PortableLiteralSymbol[];
  readonly modes: readonly GrammarV2PortableNamedSymbol[];
  readonly fields: readonly GrammarV2PortableNamedSymbol[];
  readonly constructors: readonly GrammarV2PortableNamedSymbol[];
  readonly terminals: readonly TerminalInfo[];
  readonly nonterminals: readonly NonterminalInfo[];
}

export interface GrammarV2PortableNamedSymbol {
  readonly id: number;
  readonly name: string;
}

export interface GrammarV2PortableLiteralSymbol {
  readonly id: number;
  readonly value: string;
}

export interface GrammarV2PortableLexerPlan {
  readonly defaultMode: number;
  readonly channels: readonly string[];
  readonly modes: readonly GrammarV2PortableLexerMode[];
  readonly contextualCandidates:
    readonly GrammarV2PortableContextualCandidate[];
  readonly layout: GrammarV2PortableLayoutPlan;
}

export interface GrammarV2PortableLexerMode {
  readonly id: number;
  readonly name: string;
  readonly specs: readonly GrammarV2PortableLexerSpec[];
  readonly dfa: Dfa;
}

export interface GrammarV2PortableLexerSpec {
  readonly id: number;
  readonly tokenId: number;
  readonly name: string;
  readonly kind: "token" | "skip" | "contextual";
  readonly channel: string;
  readonly transition:
    | { readonly kind: "push"; readonly modeId: number }
    | { readonly kind: "mode"; readonly modeId: number }
    | { readonly kind: "pop" }
    | undefined;
  readonly span: SourceSpan;
}

export interface GrammarV2PortableContextualCandidate {
  readonly tokenId: number;
  readonly name: string;
  readonly modeId: number;
  readonly channel: string;
}

export interface GrammarV2PortableLayoutPlan {
  readonly enabled: false;
}

export interface GrammarV2PortableParserPlan {
  readonly startRule: string;
  readonly eofTerminal: number;
  readonly startState: number;
  readonly terminals: readonly TerminalInfo[];
  readonly nonterminals: readonly NonterminalInfo[];
  readonly productions: readonly GrammarV2PortableProduction[];
  readonly states: readonly GrammarV2PortableLrState[];
  readonly actions: readonly GrammarV2PortableActionRow[];
  readonly gotos: readonly GrammarV2PortableGotoRow[];
  readonly expectedTerminals: readonly GrammarV2PortableExpectedTerminalRow[];
  readonly statistics: LrPlanningStats;
}

export interface GrammarV2PortableProduction {
  readonly id: number;
  readonly stableId: string;
  readonly lhs: number;
  readonly rhs: readonly BnfSymbol[];
  readonly reducer: BnfProduction["reducer"];
  readonly span?: SourceSpan;
  readonly origin?: BnfProduction["origin"];
}

export interface GrammarV2PortableLrState {
  readonly id: number;
  readonly items: readonly GrammarV2PortableLrItem[];
}

export interface GrammarV2PortableLrItem {
  readonly production: number;
  readonly dot: number;
  readonly lookaheads: readonly number[];
}

export interface GrammarV2PortableActionRow {
  readonly state: number;
  readonly entries: readonly GrammarV2PortableActionEntry[];
}

export interface GrammarV2PortableActionEntry {
  readonly terminal: number;
  readonly actions: readonly LrAction[];
}

export interface GrammarV2PortableGotoRow {
  readonly state: number;
  readonly entries: readonly GrammarV2PortableGotoEntry[];
}

export interface GrammarV2PortableGotoEntry {
  readonly nonterminal: number;
  readonly target: number;
}

export interface GrammarV2PortableExpectedTerminalRow {
  readonly state: number;
  readonly terminals: readonly number[];
}

export interface GrammarV2PortableExpressionPlan {
  readonly pratt: GrammarV2PrattPlan;
}

export interface GrammarV2PortableRecoveryPlan {
  readonly strategy: "single-token-insert-delete";
  readonly maxRecoveries: number;
  readonly expectedTerminals: readonly GrammarV2PortableExpectedTerminalRow[];
}

export interface GrammarV2PortableDiagnosticsPlan {
  readonly sourceSpanUnit: "utf16-code-units";
  readonly codes: readonly string[];
  readonly terminalDisplays: readonly GrammarV2PortableNamedSymbol[];
  readonly ruleDisplays: readonly GrammarV2PortableNamedSymbol[];
}

export interface GrammarV2PortableDebugPlan {
  readonly profile: "production" | "debug";
  readonly lrItems: boolean;
  readonly sourceExcerpts: boolean;
}

export interface GrammarV2PortablePlanStatistics {
  readonly lexerModes: number;
  readonly lexerStates: number;
  readonly lexerTransitions: number;
  readonly parserStates: number;
  readonly parserProductions: number;
  readonly parserActionEntries: number;
  readonly parserGotoEntries: number;
  readonly prattIslands: number;
  readonly cstNodeKinds: number;
  readonly astConstructors: number;
  readonly serializedJsonBytes: number;
}

export interface GrammarV2PortableTargetPlan {
  readonly typescript: {
    readonly adapter: "shared-runtime";
    readonly supportsLex: true;
    readonly supportsValidateParse: true;
    readonly supportsCst: true;
    readonly supportsAst: true;
  };
  readonly parserKit: {
    readonly artifact: "portable-plan-v2-json";
  };
  readonly wasm: {
    readonly status: "deferred";
    readonly reason: string;
  };
  readonly treeSitter: {
    readonly status: "deferred";
    readonly reason: string;
  };
}

export interface GrammarV2PortableGrammarIr {
  readonly name: string;
  readonly rootRule: GrammarV2RuleId;
  readonly tokens: readonly AnalyzedGrammarV2Token[];
  readonly modes: readonly AnalyzedGrammarV2Mode[];
  readonly rules: readonly AnalyzedGrammarV2Rule[];
  readonly literals: readonly AnalyzedGrammarV2Literal[];
  readonly expressionIslands: readonly AnalyzedGrammarV2ExpressionIsland[];
  readonly constructors: readonly AnalyzedGrammarV2Constructor[];
  readonly fields: readonly AnalyzedGrammarV2Field[];
  readonly modules: AnalyzedGrammarV2["modules"];
  readonly exports: AnalyzedGrammarV2["exports"];
  readonly extensions: AnalyzedGrammarV2["extensions"];
  readonly reachableRules: readonly GrammarV2RuleId[];
  readonly reachableTokens: readonly GrammarV2TokenId[];
  readonly reachableLiterals: readonly GrammarV2LiteralId[];
}

export interface GrammarV2PortablePlanBuildOptions
  extends GrammarV2ParserCoreOptions {
  readonly debugProfile?: "production" | "debug";
}

export interface GrammarV2PortablePlanBuildResult {
  readonly plan: GrammarV2PortablePlan | undefined;
  readonly metadata: GrammarV2PortablePlanMetadata | undefined;
  readonly diagnostics: readonly Diagnostic[];
  readonly parser: GrammarV2ParserCorePlan | undefined;
}

export function buildGrammarV2PortablePlan(
  analyzed: AnalyzedGrammarV2,
  options: GrammarV2PortablePlanBuildOptions = {},
): GrammarV2PortablePlanBuildResult {
  const diagnostics: Diagnostic[] = [...analyzed.diagnostics];
  if (analyzed.rootRule === undefined) {
    diagnostics.push({
      code: "GRAMMAR_V2_PORTABLE_MISSING_ROOT",
      severity: "error",
      message: "Cannot build a portable grammar-v2 plan without a root rule.",
    });
    return {
      plan: undefined,
      metadata: undefined,
      diagnostics,
      parser: undefined,
    };
  }
  const parser = buildGrammarV2ParserCorePlan(analyzed, options);
  const pratt = buildGrammarV2PrattPlan(analyzed);
  const cst = buildGrammarV2CstSchema(analyzed);
  const ast = buildGrammarV2AstSchema(analyzed);
  diagnostics.push(...parser.diagnostics);
  diagnostics.push(...pratt.diagnostics);
  diagnostics.push(...ast.diagnostics);
  if (hasError(diagnostics)) {
    return { plan: undefined, metadata: undefined, diagnostics, parser };
  }

  const rootRule = analyzed.rules[analyzed.rootRule];
  if (rootRule === undefined) {
    throw new Error(`Missing root rule ${analyzed.rootRule}.`);
  }
  const expectedTerminals = expectedTerminalRows(parser);
  const planWithoutStatistics = {
    format: FORMAT,
    version: VERSION,
    semantics: SEMANTICS,
    grammar: {
      name: analyzed.name,
      rootRule: analyzed.rootRule,
      rootRuleName: rootRule.name,
      hash: grammarHash(analyzed),
    },
    symbols: {
      tokens: analyzed.tokens.map((token) => ({
        id: token.id,
        name: token.name,
      })),
      rules: analyzed.rules.map((rule) => ({ id: rule.id, name: rule.name })),
      literals: analyzed.literals.map((literal) => ({
        id: literal.id,
        value: literal.value,
      })),
      modes: analyzed.modes.map((mode) => ({ id: mode.id, name: mode.name })),
      fields: analyzed.fields.map((field) => ({
        id: field.id,
        name: field.name,
      })),
      constructors: analyzed.constructors.map((constructor) => ({
        id: constructor.id,
        name: constructor.name,
      })),
      terminals: parser.bnf.terminals.map((terminal) => ({ ...terminal })),
      nonterminals: parser.bnf.nonterminals.map((nonterminal) => ({
        ...nonterminal,
      })),
    },
    lexer: {
      defaultMode: parser.lexer.defaultMode,
      channels: lexerChannels(analyzed),
      modes: parser.lexer.modes.map((mode) => ({
        id: mode.id,
        name: mode.name,
        specs: mode.specs.map((spec, index) => ({
          id: index,
          tokenId: spec.tokenId,
          name: spec.name,
          kind: spec.kind,
          channel: spec.channel,
          transition: spec.transition,
          span: spec.span,
        })),
        dfa: mode.dfa,
      })),
      contextualCandidates: analyzed.tokens
        .filter((token) => token.kind === "contextual")
        .map((token) => ({
          tokenId: token.id,
          name: token.name,
          modeId: token.modeId,
          channel: tokenChannel(token),
        })),
      layout: { enabled: false },
    },
    parser: {
      startRule: rootRule.name,
      eofTerminal: parser.bnf.eofTerminal,
      startState: 0,
      terminals: parser.bnf.terminals.map((terminal) => ({ ...terminal })),
      nonterminals: parser.bnf.nonterminals.map((nonterminal) => ({
        ...nonterminal,
      })),
      productions: parser.bnf.productions.map((production) =>
        productionPlan(parser, production)
      ),
      states: parser.lr.states.map((state) => ({
        id: state.id,
        items: state.items.map((item) => ({
          production: item.production,
          dot: item.dot,
          lookaheads: lookaheadValues(item.lookaheads),
        })),
      })),
      actions: actionRows(parser),
      gotos: gotoRows(parser),
      expectedTerminals,
      statistics: { ...parser.lr.stats },
    },
    expressions: { pratt },
    recovery: {
      strategy: "single-token-insert-delete",
      maxRecoveries: 64,
      expectedTerminals,
    },
    cst,
    ast,
    diagnostics: {
      sourceSpanUnit: "utf16-code-units",
      codes: diagnosticCodes(diagnostics),
      terminalDisplays: parser.bnf.terminals.map((terminal) => ({
        id: terminal.id,
        name: terminal.display,
      })),
      ruleDisplays: analyzed.rules.map((rule) => ({
        id: rule.id,
        name: rule.name,
      })),
    },
    debug: {
      profile: debugProfile(options),
      lrItems: true,
      sourceExcerpts: false,
    },
    targets: {
      typescript: {
        adapter: "shared-runtime",
        supportsLex: true,
        supportsValidateParse: true,
        supportsCst: true,
        supportsAst: true,
      },
      parserKit: { artifact: "portable-plan-v2-json" },
      wasm: {
        status: "deferred",
        reason:
          "The generic Wasm executor currently consumes portable parser plan v1; v2 mode/CST/AST sections are validated but not executed by Wasm yet.",
      },
      treeSitter: {
        status: "deferred",
        reason:
          "Tree-sitter generation needs a dedicated v2 subset mapper before it can safely emit artifacts.",
      },
    },
    grammarIr: grammarIr(analyzed),
  } satisfies Omit<GrammarV2PortablePlan, "statistics">;
  const statistics = portablePlanV2Statistics({
    ...planWithoutStatistics,
    statistics: zeroStatistics(),
  });
  const plan = { ...planWithoutStatistics, statistics };
  return {
    plan,
    metadata: grammarV2PortablePlanMetadata(plan),
    diagnostics,
    parser,
  };
}

export function serializeGrammarV2PortablePlanJson(
  plan: GrammarV2PortablePlan,
): string {
  return `${JSON.stringify(canonicalValue(plan), null, 2)}\n`;
}

export function parseGrammarV2PortablePlanJson(
  source: string,
): GrammarV2PortablePlan | { diagnostics: readonly Diagnostic[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    let message = "Invalid grammar-v2 portable plan JSON.";
    if (error instanceof Error) {
      message = `Invalid grammar-v2 portable plan JSON: ${error.message}`;
    }
    return {
      diagnostics: [{
        code: "GRAMMAR_V2_PORTABLE_JSON_PARSE_ERROR",
        severity: "error",
        message,
      }],
    };
  }
  const diagnostics = validateGrammarV2PortablePlan(parsed);
  if (diagnostics.length > 0) {
    return { diagnostics };
  }
  return parsed as GrammarV2PortablePlan;
}

export function grammarV2PortablePlanMetadata(
  plan: GrammarV2PortablePlan,
): GrammarV2PortablePlanMetadata {
  return {
    format: plan.format,
    version: plan.version,
    semantics: plan.semantics,
    hash: hashPlan(plan),
  };
}

export function portablePlanV2Statistics(
  plan: GrammarV2PortablePlan,
): GrammarV2PortablePlanStatistics {
  let lexerStates = 0;
  let lexerTransitions = 0;
  for (const mode of plan.lexer.modes) {
    lexerStates += mode.dfa.states.length;
    for (const state of mode.dfa.states) {
      lexerTransitions += state.transitions.length;
    }
  }
  let parserActionEntries = 0;
  for (const row of plan.parser.actions) {
    parserActionEntries += row.entries.length;
  }
  let parserGotoEntries = 0;
  for (const row of plan.parser.gotos) {
    parserGotoEntries += row.entries.length;
  }
  const withoutSerializedBytes = {
    lexerModes: plan.lexer.modes.length,
    lexerStates,
    lexerTransitions,
    parserStates: plan.parser.states.length,
    parserProductions: plan.parser.productions.length,
    parserActionEntries,
    parserGotoEntries,
    prattIslands: plan.expressions.pratt.islands.length,
    cstNodeKinds: plan.cst.nodeKinds.length,
    astConstructors: plan.ast.constructors.length,
  };
  const stablePlan = {
    ...plan,
    statistics: { ...withoutSerializedBytes, serializedJsonBytes: 0 },
  };
  return {
    ...withoutSerializedBytes,
    serializedJsonBytes: new TextEncoder().encode(
      serializeGrammarV2PortablePlanJson(stablePlan),
    ).length,
  };
}

export function validateGrammarV2PortablePlan(plan: unknown): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const fail = (path: string, message: string) => {
    diagnostics.push({
      code: "GRAMMAR_V2_PORTABLE_PLAN_INVALID",
      severity: "error",
      message: `${path}: ${message}`,
    });
  };
  try {
    if (!isRecord(plan)) {
      fail("$", "plan must be an object.");
      return diagnostics;
    }
    if (plan.format !== FORMAT) {
      fail("$.format", `expected ${FORMAT}.`);
    }
    if (plan.version !== VERSION) {
      fail("$.version", `expected ${VERSION}.`);
    }
    if (plan.semantics !== SEMANTICS) {
      fail("$.semantics", `expected ${SEMANTICS}.`);
    }
    const grammar = recordProperty(plan, "grammar", "$.grammar", fail);
    const symbols = recordProperty(plan, "symbols", "$.symbols", fail);
    const lexer = recordProperty(plan, "lexer", "$.lexer", fail);
    const parser = recordProperty(plan, "parser", "$.parser", fail);
    const cst = recordProperty(plan, "cst", "$.cst", fail);
    const ast = recordProperty(plan, "ast", "$.ast", fail);
    const grammarIrValue = recordProperty(
      plan,
      "grammarIr",
      "$.grammarIr",
      fail,
    );
    if (
      grammar === undefined || symbols === undefined || lexer === undefined ||
      parser === undefined || cst === undefined || ast === undefined ||
      grammarIrValue === undefined
    ) {
      return diagnostics;
    }

    const tokens = arrayProperty(symbols, "tokens", "$.symbols.tokens", fail);
    const rules = arrayProperty(symbols, "rules", "$.symbols.rules", fail);
    const literals = arrayProperty(
      symbols,
      "literals",
      "$.symbols.literals",
      fail,
    );
    const modes = arrayProperty(symbols, "modes", "$.symbols.modes", fail);
    const fields = arrayProperty(symbols, "fields", "$.symbols.fields", fail);
    const constructors = arrayProperty(
      symbols,
      "constructors",
      "$.symbols.constructors",
      fail,
    );
    const terminals = arrayProperty(
      parser,
      "terminals",
      "$.parser.terminals",
      fail,
    );
    const nonterminals = arrayProperty(
      parser,
      "nonterminals",
      "$.parser.nonterminals",
      fail,
    );
    validateDenseIds(tokens, "$.symbols.tokens", fail);
    validateDenseIds(rules, "$.symbols.rules", fail);
    validateDenseIds(literals, "$.symbols.literals", fail);
    validateDenseIds(modes, "$.symbols.modes", fail);
    validateDenseIds(fields, "$.symbols.fields", fail);
    validateDenseIds(constructors, "$.symbols.constructors", fail);
    validateDenseIds(terminals, "$.parser.terminals", fail);
    validateDenseIds(nonterminals, "$.parser.nonterminals", fail);

    const rootRule = integerProperty(
      grammar,
      "rootRule",
      "$.grammar.rootRule",
      fail,
    );
    if (rootRule === undefined || !hasId(rules, rootRule)) {
      fail("$.grammar.rootRule", "must reference a known rule id.");
    }
    const defaultMode = integerProperty(
      lexer,
      "defaultMode",
      "$.lexer.defaultMode",
      fail,
    );
    if (defaultMode === undefined || !hasId(modes, defaultMode)) {
      fail("$.lexer.defaultMode", "must reference a known mode id.");
    }
    validateLexer(lexer, tokens, modes, fail);
    validateParser(parser, terminals, nonterminals, fail);
    validateSchemaArray(cst, "nodeKinds", "$.cst.nodeKinds", fail);
    validateSchemaArray(cst, "tokenKinds", "$.cst.tokenKinds", fail);
    validateSchemaArray(ast, "constructors", "$.ast.constructors", fail);
    validateGrammarIr(grammarIrValue, tokens, rules, modes, fail);
    visitJson(plan, "$", (path, value) => {
      if (typeof value === "number" && !isSupportedInteger(value)) {
        fail(path, "must be a supported non-negative integer.");
      }
    });
  } catch (error) {
    let message = "unexpected validation failure.";
    if (error instanceof Error) {
      message = error.message;
    }
    fail("$", message);
  }
  return diagnostics;
}

export function grammarV2PortablePlanToAnalyzed(
  plan: GrammarV2PortablePlan,
): AnalyzedGrammarV2 {
  return {
    name: plan.grammarIr.name,
    rootRule: plan.grammarIr.rootRule,
    tokens: plan.grammarIr.tokens,
    modes: plan.grammarIr.modes,
    rules: plan.grammarIr.rules,
    literals: plan.grammarIr.literals,
    expressionIslands: plan.grammarIr.expressionIslands,
    constructors: plan.grammarIr.constructors,
    fields: plan.grammarIr.fields,
    modules: plan.grammarIr.modules,
    exports: plan.grammarIr.exports,
    extensions: plan.grammarIr.extensions,
    reachableRules: new Set(plan.grammarIr.reachableRules),
    reachableTokens: new Set(plan.grammarIr.reachableTokens),
    reachableLiterals: new Set(plan.grammarIr.reachableLiterals),
    diagnostics: [],
  };
}

function hasError(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function lexerChannels(analyzed: AnalyzedGrammarV2): string[] {
  const channels = new Set<string>();
  for (const token of analyzed.tokens) {
    let channel = token.channel;
    if (channel === undefined) {
      channel = "main";
      if (token.kind === "skip") {
        channel = "trivia";
      }
    }
    channels.add(channel);
  }
  return [...channels].sort();
}

function tokenChannel(token: AnalyzedGrammarV2Token): string {
  if (token.channel !== undefined) {
    return token.channel;
  }
  if (token.kind === "skip") {
    return "trivia";
  }
  return "main";
}

function grammarIr(analyzed: AnalyzedGrammarV2): GrammarV2PortableGrammarIr {
  if (analyzed.rootRule === undefined) {
    throw new Error("Cannot encode grammar IR without a root rule.");
  }
  return {
    name: analyzed.name,
    rootRule: analyzed.rootRule,
    tokens: analyzed.tokens,
    modes: analyzed.modes,
    rules: analyzed.rules,
    literals: analyzed.literals,
    expressionIslands: analyzed.expressionIslands,
    constructors: analyzed.constructors,
    fields: analyzed.fields,
    modules: analyzed.modules,
    exports: analyzed.exports,
    extensions: analyzed.extensions,
    reachableRules: [...analyzed.reachableRules].sort(numberCompare),
    reachableTokens: [...analyzed.reachableTokens].sort(numberCompare),
    reachableLiterals: [...analyzed.reachableLiterals].sort(numberCompare),
  };
}

function debugProfile(
  options: GrammarV2PortablePlanBuildOptions,
): "production" | "debug" {
  if (options.debugProfile !== undefined) {
    return options.debugProfile;
  }
  return "production";
}

function actionRows(
  plan: GrammarV2ParserCorePlan,
): GrammarV2PortableActionRow[] {
  return [...plan.lr.actions.entries()]
    .sort(([left], [right]) => left - right)
    .map(([state, row]) => ({
      state,
      entries: [...row.entries()]
        .sort(([left], [right]) => left - right)
        .map(([terminal, actions]) => ({
          terminal,
          actions: [...actions].sort(compareActions),
        })),
    }));
}

function gotoRows(plan: GrammarV2ParserCorePlan): GrammarV2PortableGotoRow[] {
  return [...plan.lr.gotos.entries()]
    .sort(([left], [right]) => left - right)
    .map(([state, row]) => ({
      state,
      entries: [...row.entries()]
        .sort(([left], [right]) => left - right)
        .map(([nonterminal, target]) => ({ nonterminal, target })),
    }));
}

function expectedTerminalRows(
  plan: GrammarV2ParserCorePlan,
): GrammarV2PortableExpectedTerminalRow[] {
  return [...plan.lr.actions.entries()]
    .sort(([left], [right]) => left - right)
    .map(([state, row]) => ({
      state,
      terminals: [...row.keys()].sort(numberCompare),
    }));
}

function productionPlan(
  plan: GrammarV2ParserCorePlan,
  production: BnfProduction,
): GrammarV2PortableProduction {
  return {
    id: production.id,
    stableId: productionStableId(plan, production),
    lhs: production.lhs,
    rhs: production.rhs.map((symbol) => ({ ...symbol })),
    reducer: { ...production.reducer },
    span: production.span,
    origin: production.origin,
  };
}

function productionStableId(
  plan: GrammarV2ParserCorePlan,
  production: BnfProduction,
): string {
  const payload = {
    semantics: "baba-grammar-v2-production",
    lhs: nonterminalStableKey(plan, production.lhs),
    rhs: production.rhs.map((symbol) => symbolStableKey(plan, symbol)),
    reducer: production.reducer,
    origin: production.origin,
  };
  return `p_${fnv1a64String(JSON.stringify(payload)).slice(0, 16)}`;
}

function symbolStableKey(
  plan: GrammarV2ParserCorePlan,
  symbol: BnfSymbol,
): string {
  if (symbol.kind === "terminal") {
    return terminalStableKey(plan, symbol.id);
  }
  return nonterminalStableKey(plan, symbol.id);
}

function terminalStableKey(plan: GrammarV2ParserCorePlan, id: number): string {
  const terminal = plan.bnf.terminals[id];
  if (terminal === undefined) {
    return `terminal:${id}`;
  }
  return `${terminal.kind}:${terminal.display}`;
}

function nonterminalStableKey(
  plan: GrammarV2ParserCorePlan,
  id: number,
): string {
  const nonterminal = plan.bnf.nonterminals[id];
  if (nonterminal === undefined) {
    return `nonterminal:${id}`;
  }
  return nonterminal.name;
}

function lookaheadValues(lookaheads: LookaheadBitset): number[] {
  const values: number[] = [];
  for (let index = 0; index < lookaheads.size; index++) {
    let word = 0;
    const existing = lookaheads.words[index >> 5];
    if (existing !== undefined) {
      word = existing;
    }
    if ((word & (1 << (index & 31))) !== 0) {
      values.push(index);
    }
  }
  return values;
}

function compareActions(left: LrAction, right: LrAction): number {
  const leftRank = actionRank(left);
  const rightRank = actionRank(right);
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  if (left.kind === "shift" && right.kind === "shift") {
    return left.state - right.state;
  }
  if (left.kind === "reduce" && right.kind === "reduce") {
    return left.production - right.production;
  }
  return 0;
}

function actionRank(action: LrAction): number {
  if (action.kind === "shift") {
    return 0;
  }
  if (action.kind === "reduce") {
    return 1;
  }
  return 2;
}

function diagnosticCodes(diagnostics: readonly Diagnostic[]): string[] {
  const codes = new Set<string>();
  for (const diagnostic of diagnostics) {
    codes.add(diagnostic.code);
  }
  codes.add("GRAMMAR_V2_LEX_UNEXPECTED_CHARACTER");
  codes.add("GRAMMAR_V2_PARSE_UNEXPECTED_TOKEN");
  codes.add("GRAMMAR_V2_PARSE_RECOVERY");
  codes.add("AST_MATERIALIZE_UNEXPECTED_TOKEN");
  codes.add("AST_MATERIALIZE_TRAILING_TOKEN");
  return [...codes].sort();
}

function zeroStatistics(): GrammarV2PortablePlanStatistics {
  return {
    lexerModes: 0,
    lexerStates: 0,
    lexerTransitions: 0,
    parserStates: 0,
    parserProductions: 0,
    parserActionEntries: 0,
    parserGotoEntries: 0,
    prattIslands: 0,
    cstNodeKinds: 0,
    astConstructors: 0,
    serializedJsonBytes: 0,
  };
}

function grammarHash(analyzed: AnalyzedGrammarV2): string {
  const payload = {
    name: analyzed.name,
    rootRule: analyzed.rootRule,
    tokens: analyzed.tokens,
    rules: analyzed.rules,
    literals: analyzed.literals,
    expressionIslands: analyzed.expressionIslands,
    constructors: analyzed.constructors,
  };
  return `fnv1a64:${fnv1a64String(JSON.stringify(canonicalValue(payload)))}`;
}

function hashPlan(plan: GrammarV2PortablePlan): string {
  const bytes = new TextEncoder().encode(serializeGrammarV2PortablePlanJson(
    plan,
  ));
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

function fnv1a64String(source: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < source.length; index++) {
    hash ^= BigInt(source.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function validateLexer(
  lexer: Record<string, unknown>,
  tokens: readonly unknown[],
  modes: readonly unknown[],
  fail: (path: string, message: string) => void,
): void {
  const lexerModes = arrayProperty(lexer, "modes", "$.lexer.modes", fail);
  validateDenseIds(lexerModes, "$.lexer.modes", fail);
  for (const [modeIndex, mode] of lexerModes.entries()) {
    if (!isRecord(mode)) {
      fail(`$.lexer.modes[${modeIndex}]`, "must be an object.");
      continue;
    }
    const modeId = integerProperty(
      mode,
      "id",
      `$.lexer.modes[${modeIndex}].id`,
      fail,
    );
    if (modeId === undefined || !hasId(modes, modeId)) {
      fail(`$.lexer.modes[${modeIndex}].id`, "must reference a known mode.");
    }
    const specs = arrayProperty(
      mode,
      "specs",
      `$.lexer.modes[${modeIndex}].specs`,
      fail,
    );
    validateDenseIds(specs, `$.lexer.modes[${modeIndex}].specs`, fail);
    for (const [specIndex, spec] of specs.entries()) {
      if (!isRecord(spec)) {
        fail(
          `$.lexer.modes[${modeIndex}].specs[${specIndex}]`,
          "must be an object.",
        );
        continue;
      }
      const tokenId = integerProperty(
        spec,
        "tokenId",
        `$.lexer.modes[${modeIndex}].specs[${specIndex}].tokenId`,
        fail,
      );
      if (tokenId === undefined || !hasId(tokens, tokenId)) {
        fail(
          `$.lexer.modes[${modeIndex}].specs[${specIndex}].tokenId`,
          "must reference a known token.",
        );
      }
    }
    const dfa = recordProperty(
      mode,
      "dfa",
      `$.lexer.modes[${modeIndex}].dfa`,
      fail,
    );
    if (dfa !== undefined) {
      validateDfa(dfa, specs, `$.lexer.modes[${modeIndex}].dfa`, fail);
    }
  }
}

function validateDfa(
  dfa: Record<string, unknown>,
  specs: readonly unknown[],
  path: string,
  fail: (path: string, message: string) => void,
): void {
  const states = arrayProperty(dfa, "states", `${path}.states`, fail);
  validateDenseIds(states, `${path}.states`, fail);
  const start = integerProperty(dfa, "start", `${path}.start`, fail);
  if (start === undefined || !hasId(states, start)) {
    fail(`${path}.start`, "must reference a known DFA state.");
  }
  for (const [stateIndex, state] of states.entries()) {
    if (!isRecord(state)) {
      fail(`${path}.states[${stateIndex}]`, "must be an object.");
      continue;
    }
    const accepts = arrayProperty(
      state,
      "accepts",
      `${path}.states[${stateIndex}].accepts`,
      fail,
    );
    for (const accept of accepts) {
      if (!isSupportedInteger(accept) || !hasId(specs, accept)) {
        fail(
          `${path}.states[${stateIndex}].accepts`,
          "must contain lexer spec ids.",
        );
      }
    }
    const selectedAccept = state.selectedAccept;
    if (
      selectedAccept !== null && selectedAccept !== undefined &&
      (!isSupportedInteger(selectedAccept) || !hasId(specs, selectedAccept))
    ) {
      fail(
        `${path}.states[${stateIndex}].selectedAccept`,
        "must reference a lexer spec id.",
      );
    }
    const transitions = arrayProperty(
      state,
      "transitions",
      `${path}.states[${stateIndex}].transitions`,
      fail,
    );
    let previousEnd = -1;
    for (const [transitionIndex, transition] of transitions.entries()) {
      if (!isRecord(transition)) {
        fail(
          `${path}.states[${stateIndex}].transitions[${transitionIndex}]`,
          "must be an object.",
        );
        continue;
      }
      const start = integerProperty(
        transition,
        "start",
        `${path}.states[${stateIndex}].transitions[${transitionIndex}].start`,
        fail,
      );
      const end = integerProperty(
        transition,
        "end",
        `${path}.states[${stateIndex}].transitions[${transitionIndex}].end`,
        fail,
      );
      const target = integerProperty(
        transition,
        "target",
        `${path}.states[${stateIndex}].transitions[${transitionIndex}].target`,
        fail,
      );
      if (target === undefined || !hasId(states, target)) {
        fail(
          `${path}.states[${stateIndex}].transitions[${transitionIndex}].target`,
          "must reference a DFA state.",
        );
      }
      if (
        start === undefined || end === undefined || start > end ||
        !isUnicodeScalar(start) || !isUnicodeScalar(end) || start <= previousEnd
      ) {
        fail(
          `${path}.states[${stateIndex}].transitions[${transitionIndex}]`,
          "must be sorted non-overlapping Unicode scalar ranges.",
        );
      } else {
        previousEnd = end;
      }
    }
  }
}

function validateParser(
  parser: Record<string, unknown>,
  terminals: readonly unknown[],
  nonterminals: readonly unknown[],
  fail: (path: string, message: string) => void,
): void {
  const productions = arrayProperty(
    parser,
    "productions",
    "$.parser.productions",
    fail,
  );
  const states = arrayProperty(parser, "states", "$.parser.states", fail);
  validateDenseIds(productions, "$.parser.productions", fail);
  validateDenseIds(states, "$.parser.states", fail);
  const eofTerminal = integerProperty(
    parser,
    "eofTerminal",
    "$.parser.eofTerminal",
    fail,
  );
  if (eofTerminal === undefined || !hasId(terminals, eofTerminal)) {
    fail("$.parser.eofTerminal", "must reference a terminal.");
  }
  const startState = integerProperty(
    parser,
    "startState",
    "$.parser.startState",
    fail,
  );
  if (startState === undefined || !hasId(states, startState)) {
    fail("$.parser.startState", "must reference a parser state.");
  }
  for (const [index, production] of productions.entries()) {
    validateProduction(
      production,
      index,
      terminals,
      nonterminals,
      "$.parser.productions",
      fail,
    );
  }
  validateActionRows(
    arrayProperty(parser, "actions", "$.parser.actions", fail),
    states,
    terminals,
    productions,
    fail,
  );
  validateGotoRows(
    arrayProperty(parser, "gotos", "$.parser.gotos", fail),
    states,
    nonterminals,
    fail,
  );
  validateExpectedRows(
    arrayProperty(
      parser,
      "expectedTerminals",
      "$.parser.expectedTerminals",
      fail,
    ),
    states,
    terminals,
    fail,
  );
}

function validateProduction(
  production: unknown,
  index: number,
  terminals: readonly unknown[],
  nonterminals: readonly unknown[],
  path: string,
  fail: (path: string, message: string) => void,
): void {
  if (!isRecord(production)) {
    fail(`${path}[${index}]`, "must be an object.");
    return;
  }
  const lhs = integerProperty(production, "lhs", `${path}[${index}].lhs`, fail);
  if (lhs === undefined || !hasId(nonterminals, lhs)) {
    fail(`${path}[${index}].lhs`, "must reference a nonterminal.");
  }
  const stableId = stringProperty(
    production,
    "stableId",
    `${path}[${index}].stableId`,
    fail,
  );
  if (stableId !== undefined && !/^p_[0-9a-f]{16}$/.test(stableId)) {
    fail(`${path}[${index}].stableId`, "must be a stable production id.");
  }
  const rhs = arrayProperty(production, "rhs", `${path}[${index}].rhs`, fail);
  for (const [rhsIndex, symbol] of rhs.entries()) {
    if (!isRecord(symbol)) {
      fail(`${path}[${index}].rhs[${rhsIndex}]`, "must be an object.");
      continue;
    }
    const symbolId = integerProperty(
      symbol,
      "id",
      `${path}[${index}].rhs[${rhsIndex}].id`,
      fail,
    );
    if (symbol.kind === "terminal") {
      if (symbolId === undefined || !hasId(terminals, symbolId)) {
        fail(`${path}[${index}].rhs[${rhsIndex}].id`, "unknown terminal.");
      }
    } else if (symbol.kind === "nonterminal") {
      if (symbolId === undefined || !hasId(nonterminals, symbolId)) {
        fail(`${path}[${index}].rhs[${rhsIndex}].id`, "unknown nonterminal.");
      }
    } else {
      fail(`${path}[${index}].rhs[${rhsIndex}].kind`, "unknown symbol kind.");
    }
  }
}

function validateActionRows(
  rows: readonly unknown[],
  states: readonly unknown[],
  terminals: readonly unknown[],
  productions: readonly unknown[],
  fail: (path: string, message: string) => void,
): void {
  let previousState = -1;
  for (const [rowIndex, row] of rows.entries()) {
    if (!isRecord(row)) {
      fail(`$.parser.actions[${rowIndex}]`, "must be an object.");
      continue;
    }
    const state = integerProperty(
      row,
      "state",
      `$.parser.actions[${rowIndex}].state`,
      fail,
    );
    if (state === undefined || !hasId(states, state)) {
      fail(`$.parser.actions[${rowIndex}].state`, "unknown parser state.");
    } else if (state <= previousState) {
      fail(
        `$.parser.actions[${rowIndex}].state`,
        "rows must be sorted by state.",
      );
    } else {
      previousState = state;
    }
    let previousTerminal = -1;
    const entries = arrayProperty(
      row,
      "entries",
      `$.parser.actions[${rowIndex}].entries`,
      fail,
    );
    for (const [entryIndex, entry] of entries.entries()) {
      if (!isRecord(entry)) {
        fail(
          `$.parser.actions[${rowIndex}].entries[${entryIndex}]`,
          "must be an object.",
        );
        continue;
      }
      const terminal = integerProperty(
        entry,
        "terminal",
        `$.parser.actions[${rowIndex}].entries[${entryIndex}].terminal`,
        fail,
      );
      if (terminal === undefined || !hasId(terminals, terminal)) {
        fail(
          `$.parser.actions[${rowIndex}].entries[${entryIndex}].terminal`,
          "unknown terminal.",
        );
      } else if (terminal <= previousTerminal) {
        fail(
          `$.parser.actions[${rowIndex}].entries[${entryIndex}].terminal`,
          "entries must be sorted by terminal.",
        );
      } else {
        previousTerminal = terminal;
      }
      const actions = arrayProperty(
        entry,
        "actions",
        `$.parser.actions[${rowIndex}].entries[${entryIndex}].actions`,
        fail,
      );
      if (actions.length === 0) {
        fail(
          `$.parser.actions[${rowIndex}].entries[${entryIndex}].actions`,
          "must not be empty.",
        );
      }
      for (const [actionIndex, action] of actions.entries()) {
        validateAction(
          action,
          `$.parser.actions[${rowIndex}].entries[${entryIndex}].actions[${actionIndex}]`,
          states,
          productions,
          fail,
        );
      }
    }
  }
}

function validateAction(
  action: unknown,
  path: string,
  states: readonly unknown[],
  productions: readonly unknown[],
  fail: (path: string, message: string) => void,
): void {
  if (!isRecord(action)) {
    fail(path, "must be an object.");
    return;
  }
  if (action.kind === "shift") {
    const state = integerProperty(action, "state", `${path}.state`, fail);
    if (state === undefined || !hasId(states, state)) {
      fail(`${path}.state`, "unknown parser state.");
    }
    return;
  }
  if (action.kind === "reduce") {
    const production = integerProperty(
      action,
      "production",
      `${path}.production`,
      fail,
    );
    if (production === undefined || !hasId(productions, production)) {
      fail(`${path}.production`, "unknown production.");
    }
    return;
  }
  if (action.kind !== "accept") {
    fail(`${path}.kind`, "unknown LR action kind.");
  }
}

function validateGotoRows(
  rows: readonly unknown[],
  states: readonly unknown[],
  nonterminals: readonly unknown[],
  fail: (path: string, message: string) => void,
): void {
  for (const [rowIndex, row] of rows.entries()) {
    if (!isRecord(row)) {
      fail(`$.parser.gotos[${rowIndex}]`, "must be an object.");
      continue;
    }
    const state = integerProperty(
      row,
      "state",
      `$.parser.gotos[${rowIndex}].state`,
      fail,
    );
    if (state === undefined || !hasId(states, state)) {
      fail(`$.parser.gotos[${rowIndex}].state`, "unknown parser state.");
    }
    const entries = arrayProperty(
      row,
      "entries",
      `$.parser.gotos[${rowIndex}].entries`,
      fail,
    );
    for (const [entryIndex, entry] of entries.entries()) {
      if (!isRecord(entry)) {
        fail(
          `$.parser.gotos[${rowIndex}].entries[${entryIndex}]`,
          "must be an object.",
        );
        continue;
      }
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
          "unknown nonterminal.",
        );
      }
      if (target === undefined || !hasId(states, target)) {
        fail(
          `$.parser.gotos[${rowIndex}].entries[${entryIndex}].target`,
          "unknown parser state.",
        );
      }
    }
  }
}

function validateExpectedRows(
  rows: readonly unknown[],
  states: readonly unknown[],
  terminals: readonly unknown[],
  fail: (path: string, message: string) => void,
): void {
  for (const [rowIndex, row] of rows.entries()) {
    if (!isRecord(row)) {
      fail(`$.parser.expectedTerminals[${rowIndex}]`, "must be an object.");
      continue;
    }
    const state = integerProperty(
      row,
      "state",
      `$.parser.expectedTerminals[${rowIndex}].state`,
      fail,
    );
    if (state === undefined || !hasId(states, state)) {
      fail(`$.parser.expectedTerminals[${rowIndex}].state`, "unknown state.");
    }
    const terminalsValue = arrayProperty(
      row,
      "terminals",
      `$.parser.expectedTerminals[${rowIndex}].terminals`,
      fail,
    );
    for (const terminal of terminalsValue) {
      if (!isSupportedInteger(terminal) || !hasId(terminals, terminal)) {
        fail(
          `$.parser.expectedTerminals[${rowIndex}].terminals`,
          "must contain terminal ids.",
        );
      }
    }
  }
}

function validateSchemaArray(
  value: Record<string, unknown>,
  key: string,
  path: string,
  fail: (path: string, message: string) => void,
): void {
  const values = arrayProperty(value, key, path, fail);
  validateDenseIds(values, path, fail);
}

function validateGrammarIr(
  grammarIrValue: Record<string, unknown>,
  tokens: readonly unknown[],
  rules: readonly unknown[],
  modes: readonly unknown[],
  fail: (path: string, message: string) => void,
): void {
  const irTokens = arrayProperty(
    grammarIrValue,
    "tokens",
    "$.grammarIr.tokens",
    fail,
  );
  const irRules = arrayProperty(
    grammarIrValue,
    "rules",
    "$.grammarIr.rules",
    fail,
  );
  const irModes = arrayProperty(
    grammarIrValue,
    "modes",
    "$.grammarIr.modes",
    fail,
  );
  if (irTokens.length !== tokens.length) {
    fail("$.grammarIr.tokens", "must match symbol token count.");
  }
  if (irRules.length !== rules.length) {
    fail("$.grammarIr.rules", "must match symbol rule count.");
  }
  if (irModes.length !== modes.length) {
    fail("$.grammarIr.modes", "must match symbol mode count.");
  }
}

function validateDenseIds(
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
    if (id === undefined) {
      continue;
    }
    if (seen.has(id)) {
      fail(`${path}[${index}].id`, "duplicate id.");
    }
    seen.add(id);
    if (id !== index) {
      fail(`${path}[${index}].id`, "ids must be dense and sorted.");
    }
  }
}

function recordProperty(
  value: Record<string, unknown>,
  key: string,
  path: string,
  fail: (path: string, message: string) => void,
): Record<string, unknown> | undefined {
  const child = value[key];
  if (!isRecord(child)) {
    fail(path, "must be an object.");
    return undefined;
  }
  return child;
}

function arrayProperty(
  value: Record<string, unknown>,
  key: string,
  path: string,
  fail: (path: string, message: string) => void,
): readonly unknown[] {
  const child = value[key];
  if (!Array.isArray(child)) {
    fail(path, "must be an array.");
    return [];
  }
  return child;
}

function integerProperty(
  value: Record<string, unknown>,
  key: string,
  path: string,
  fail: (path: string, message: string) => void,
): number | undefined {
  const child = value[key];
  if (!isSupportedInteger(child)) {
    fail(path, "must be a supported non-negative integer.");
    return undefined;
  }
  return child;
}

function stringProperty(
  value: Record<string, unknown>,
  key: string,
  path: string,
  fail: (path: string, message: string) => void,
): string | undefined {
  const child = value[key];
  if (typeof child !== "string") {
    fail(path, "must be a string.");
    return undefined;
  }
  return child;
}

function hasId(values: readonly unknown[], id: number): boolean {
  return values.some((value) => isRecord(value) && value.id === id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSupportedInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 &&
    value <= MAX_SAFE_SERIALIZED_INTEGER;
}

function isUnicodeScalar(value: number): boolean {
  return value >= 0 && value <= 0x10ffff &&
    !(value >= 0xd800 && value <= 0xdfff);
}

function visitJson(
  value: unknown,
  path: string,
  visit: (path: string, value: unknown) => void,
): void {
  visit(path, value);
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      visitJson(child, `${path}[${index}]`, visit);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const key of Object.keys(value)) {
    visitJson(value[key], `${path}.${key}`, visit);
  }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (!isRecord(value)) {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    result[key] = canonicalValue(value[key]);
  }
  return result;
}

function numberCompare(left: number, right: number): number {
  return left - right;
}
