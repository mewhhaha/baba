import type { Diagnostic } from "../ast.ts";
import {
  buildGrammarV2TokenCst,
  type GrammarV2CstBuildResult,
} from "../compiler/grammar_v2_cst.ts";
import {
  type GrammarV2PortablePlan,
  grammarV2PortablePlanToAnalyzed,
  validateGrammarV2PortablePlan,
} from "../compiler/grammar_v2_portable_plan.ts";
import {
  type GrammarV2LexCandidateSite,
  type GrammarV2LexerPlan,
  type GrammarV2LexOptions,
  type GrammarV2LexResult,
  type GrammarV2LexToken,
  lexGrammarV2,
} from "../compiler/grammar_v2_lexer.ts";
import {
  type GrammarV2ParserCorePlan,
  type GrammarV2ParseValidationResult,
  recoverGrammarV2Parse,
  validateGrammarV2Parse,
} from "../compiler/grammar_v2_parser_core.ts";
import {
  type GrammarV2AstMaterializeResult,
  materializeGrammarV2Ast,
} from "../compiler/grammar_v2_ast.ts";
import {
  createGrammarV2IncrementalParser,
  type GrammarV2IncrementalParser,
} from "../compiler/grammar_v2_incremental.ts";
import type {
  BnfGrammar,
  BnfProduction,
} from "../compiler/runtime_plan/bnf.ts";
import type {
  LookaheadBitset,
  LrAction,
  LrActionSet,
  LrTable,
} from "../compiler/runtime_plan/lr1.ts";

export interface GrammarV2RuntimeOptions {
  readonly validatePlan?: boolean;
}

export interface GrammarV2RuntimeParseOptions {
  readonly mode?: "validate" | "cst" | "ast";
  readonly lex?: GrammarV2LexOptions;
}

export interface GrammarV2RuntimeParseResult {
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly acceptedTokens: number;
  readonly tokens?: readonly GrammarV2LexToken[];
  readonly cst?: GrammarV2CstBuildResult["root"];
  readonly ast?: GrammarV2AstMaterializeResult["ast"];
}

export interface GrammarV2RuntimeParseTokensResult {
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly acceptedTokens: number;
}

export interface GrammarV2SourceMapping {
  readonly lineStarts: readonly number[];
  positionAt(
    offset: number,
  ): { readonly line: number; readonly column: number };
}

export interface GrammarV2Runtime {
  readonly plan: GrammarV2PortablePlan;
  readonly validationDiagnostics: readonly Diagnostic[];
  lex(source: string, options?: GrammarV2LexOptions): GrammarV2LexResult;
  parse(
    source: string,
    options?: GrammarV2RuntimeParseOptions,
  ): GrammarV2RuntimeParseResult;
  parseTokens(
    source: string,
    tokens: readonly GrammarV2LexToken[],
    options?: GrammarV2RuntimeParseOptions,
  ): GrammarV2RuntimeParseTokensResult;
  parseTokensUnchecked(
    source: string,
    tokens: readonly GrammarV2LexToken[],
    options?: GrammarV2RuntimeParseOptions,
  ): GrammarV2RuntimeParseTokensResult;
  validateParse(source: string): GrammarV2ParseValidationResult;
  parseCst(
    source: string,
    options?: GrammarV2LexOptions,
  ): GrammarV2CstBuildResult;
  materializeAst(source: string): GrammarV2AstMaterializeResult;
  diagnostics(source: string): readonly Diagnostic[];
  sourceMap(source: string): GrammarV2SourceMapping;
  createIncrementalParser(): GrammarV2IncrementalParser;
  wasmStatus(): GrammarV2PortablePlan["targets"]["wasm"];
}

export function createGrammarV2Runtime(
  plan: GrammarV2PortablePlan,
  options: GrammarV2RuntimeOptions = {},
): GrammarV2Runtime {
  let validatePlan = true;
  if (options.validatePlan === false) {
    validatePlan = false;
  }
  let validationDiagnostics: readonly Diagnostic[] = [];
  if (validatePlan) {
    validationDiagnostics = validateGrammarV2PortablePlan(plan);
  }
  if (validationDiagnostics.length > 0) {
    const messages = validationDiagnostics.map((diagnostic) =>
      diagnostic.message
    ).join("\n");
    throw new Error(`Invalid grammar-v2 portable plan:\n${messages}`);
  }
  const analyzed = grammarV2PortablePlanToAnalyzed(plan);
  const lexer = lexerPlanFromPortable(plan);
  const parser = parserPlanFromPortable(plan, lexer);
  return {
    plan,
    validationDiagnostics,
    lex(
      source: string,
      lexOptions: GrammarV2LexOptions = {},
    ): GrammarV2LexResult {
      return lexGrammarV2(lexer, source, lexOptions);
    },
    parse(
      source: string,
      parseOptions: GrammarV2RuntimeParseOptions = {},
    ): GrammarV2RuntimeParseResult {
      const mode = parseMode(parseOptions);
      if (mode === "cst") {
        const cst = buildGrammarV2TokenCst(
          plan.cst,
          lexer,
          source,
          parseOptions.lex,
        );
        return {
          ok: cst.diagnostics.length === 0,
          diagnostics: cst.diagnostics,
          acceptedTokens: cst.tokens.length,
          tokens: cst.tokens,
          cst: cst.root,
        };
      }
      if (mode === "ast") {
        const ast = materializeGrammarV2Ast(analyzed, lexer, source);
        return {
          ok: ast.diagnostics.length === 0,
          diagnostics: ast.diagnostics,
          acceptedTokens: ast.acceptedTokens,
          ast: ast.ast,
        };
      }
      const parsed = validateGrammarV2Parse(parser, source);
      return {
        ok: parsed.ok,
        diagnostics: parsed.diagnostics,
        acceptedTokens: parsed.acceptedTokens,
      };
    },
    parseTokens(
      source: string,
      tokens: readonly GrammarV2LexToken[],
      parseOptions: GrammarV2RuntimeParseOptions = {},
    ): GrammarV2RuntimeParseTokensResult {
      const lexed = lexGrammarV2(lexer, source, parseOptions.lex);
      if (!sameTokenStream(lexed.tokens, tokens)) {
        return {
          ok: false,
          diagnostics: [{
            code: "GRAMMAR_V2_RUNTIME_TOKEN_STREAM_MISMATCH",
            severity: "error",
            message:
              "Provided tokens do not match the runtime lexer for this source.",
          }],
          acceptedTokens: 0,
        };
      }
      return parseTokenList(parser, tokens, []);
    },
    parseTokensUnchecked(
      _source: string,
      tokens: readonly GrammarV2LexToken[],
    ): GrammarV2RuntimeParseTokensResult {
      return parseTokenList(parser, tokens, []);
    },
    validateParse(source: string): GrammarV2ParseValidationResult {
      return validateGrammarV2Parse(parser, source);
    },
    parseCst(
      source: string,
      lexOptions: GrammarV2LexOptions = {},
    ): GrammarV2CstBuildResult {
      return buildGrammarV2TokenCst(plan.cst, lexer, source, lexOptions);
    },
    materializeAst(source: string): GrammarV2AstMaterializeResult {
      return materializeGrammarV2Ast(analyzed, lexer, source);
    },
    diagnostics(source: string): readonly Diagnostic[] {
      const recovered = recoverGrammarV2Parse(
        parser,
        source,
        plan.recovery.maxRecoveries,
      );
      return recovered.diagnostics;
    },
    sourceMap(source: string): GrammarV2SourceMapping {
      return createSourceMapping(source);
    },
    createIncrementalParser(): GrammarV2IncrementalParser {
      return createGrammarV2IncrementalParser(plan.cst, lexer);
    },
    wasmStatus(): GrammarV2PortablePlan["targets"]["wasm"] {
      return plan.targets.wasm;
    },
  };
}

function parseMode(
  options: GrammarV2RuntimeParseOptions,
): "validate" | "cst" | "ast" {
  if (options.mode !== undefined) {
    return options.mode;
  }
  return "validate";
}

function lexerPlanFromPortable(
  plan: GrammarV2PortablePlan,
): GrammarV2LexerPlan {
  return {
    defaultMode: plan.lexer.defaultMode,
    diagnostics: [],
    modes: plan.lexer.modes.map((mode) => ({
      id: mode.id,
      name: mode.name,
      specs: mode.specs.map((spec) => ({
        tokenId: spec.tokenId,
        name: spec.name,
        kind: spec.kind,
        channel: spec.channel,
        transition: spec.transition,
        span: spec.span,
      })),
      dfa: mode.dfa,
    })),
  };
}

function parserPlanFromPortable(
  plan: GrammarV2PortablePlan,
  lexer: GrammarV2LexerPlan,
): GrammarV2ParserCorePlan {
  return {
    bnf: bnfFromPortable(plan),
    lr: lrFromPortable(plan),
    lexer,
    diagnostics: [],
  };
}

function bnfFromPortable(plan: GrammarV2PortablePlan): BnfGrammar {
  return {
    terminals: plan.parser.terminals.map((terminal) => ({ ...terminal })),
    nonterminals: plan.parser.nonterminals.map((nonterminal) => ({
      ...nonterminal,
    })),
    productions: plan.parser.productions.map((production) =>
      bnfProductionFromPortable(production)
    ),
    startNonterminal: 0,
    rootRuleNonterminal: rootRuleNonterminal(plan),
    eofTerminal: plan.parser.eofTerminal,
    diagnostics: [],
  };
}

function rootRuleNonterminal(plan: GrammarV2PortablePlan): number {
  for (const nonterminal of plan.parser.nonterminals) {
    if (nonterminal.ruleId === plan.grammar.rootRule) {
      return nonterminal.id;
    }
  }
  throw new Error(
    `Missing root-rule nonterminal for rule ${plan.grammar.rootRule}.`,
  );
}

function bnfProductionFromPortable(
  production: GrammarV2PortablePlan["parser"]["productions"][number],
): BnfProduction {
  return {
    id: production.id,
    lhs: production.lhs,
    rhs: production.rhs.map((symbol) => ({ ...symbol })),
    reducer: { ...production.reducer },
    span: production.span,
    origin: production.origin,
  };
}

function lrFromPortable(plan: GrammarV2PortablePlan): LrTable {
  return {
    states: plan.parser.states.map((state) => ({
      id: state.id,
      items: state.items.map((item) => ({
        production: item.production,
        dot: item.dot,
        lookaheads: lookaheadBitset(
          item.lookaheads,
          plan.parser.terminals.length,
        ),
      })),
    })),
    actions: new Map(plan.parser.actions.map((row) => [
      row.state,
      new Map(row.entries.map((entry) => [
        entry.terminal,
        entry.actions.map((action) => ({ ...action })) as LrActionSet,
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

function parseTokenList(
  plan: GrammarV2ParserCorePlan,
  tokens: readonly GrammarV2LexToken[],
  candidateSites: readonly GrammarV2LexCandidateSite[],
): GrammarV2RuntimeParseTokensResult {
  const parserTokens = tokens.filter((token) => token.kind !== "trivia");
  const candidates = new Map<
    number,
    GrammarV2LexCandidateSite["candidates"]
  >();
  for (const site of candidateSites) {
    candidates.set(site.tokenIndex, site.candidates);
  }
  const stack = [0];
  let cursor = 0;
  const diagnostics: Diagnostic[] = [];
  while (cursor < parserTokens.length) {
    const state = stack[stack.length - 1];
    const token = parserTokens[cursor];
    const action = selectAction(plan, state, token, cursor, candidates);
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

function selectAction(
  plan: GrammarV2ParserCorePlan,
  state: number,
  token: GrammarV2LexToken,
  tokenIndex: number,
  candidateSites: ReadonlyMap<number, GrammarV2LexCandidateSite["candidates"]>,
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
  plan: GrammarV2ParserCorePlan,
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
  plan: GrammarV2ParserCorePlan,
  stack: number[],
  productionId: number,
): void {
  const production = plan.bnf.productions[productionId];
  if (production === undefined) {
    throw new Error(`Missing production ${productionId}.`);
  }
  for (let index = 0; index < production.rhs.length; index++) {
    stack.pop();
  }
  const state = stack[stack.length - 1];
  const gotoRow = plan.lr.gotos.get(state);
  let gotoState: number | undefined;
  if (gotoRow !== undefined) {
    gotoState = gotoRow.get(production.lhs);
  }
  if (gotoState === undefined) {
    throw new Error(
      `Missing goto for state ${state} and nonterminal ${production.lhs}.`,
    );
  }
  stack.push(gotoState);
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
  plan: GrammarV2ParserCorePlan,
  state: number,
  token: GrammarV2LexToken,
): Diagnostic {
  const expected = expectedTokenNames(plan, state);
  return {
    code: "GRAMMAR_V2_PARSE_UNEXPECTED_TOKEN",
    severity: "error",
    message: `Unexpected token '${token.name}'. Expected: ${
      expected.join(", ")
    }.`,
    span: token.span,
  };
}

function expectedTokenNames(
  plan: GrammarV2ParserCorePlan,
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

function sameTokenStream(
  left: readonly GrammarV2LexToken[],
  right: readonly GrammarV2LexToken[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index++) {
    const leftToken = left[index];
    const rightToken = right[index];
    if (
      leftToken.name !== rightToken.name ||
      leftToken.text !== rightToken.text ||
      leftToken.kind !== rightToken.kind ||
      leftToken.span.start !== rightToken.span.start ||
      leftToken.span.end !== rightToken.span.end
    ) {
      return false;
    }
  }
  return true;
}

function lookaheadBitset(
  values: readonly number[],
  size: number,
): LookaheadBitset {
  const words = new Array<number>(Math.ceil(size / 32)).fill(0);
  for (const value of values) {
    words[value >> 5] |= 1 << (value & 31);
  }
  return { words, size };
}

function createSourceMapping(source: string): GrammarV2SourceMapping {
  const lineStarts = [0];
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    if (code === 10) {
      lineStarts.push(index + 1);
    }
  }
  return {
    lineStarts,
    positionAt(
      offset: number,
    ): { readonly line: number; readonly column: number } {
      let line = 0;
      for (let index = 0; index < lineStarts.length; index++) {
        if (lineStarts[index] > offset) {
          break;
        }
        line = index;
      }
      return { line, column: offset - lineStarts[line] };
    },
  };
}
