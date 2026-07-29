import type { Diagnostic } from "../ast.ts";
import {
  buildGrammarTokenCst,
  type GrammarCstBuildResult,
} from "../compiler/grammar_cst.ts";
import {
  type GrammarPortablePlan,
  grammarPortablePlanToAnalyzed,
  validateGrammarPortablePlan,
} from "../compiler/grammar_portable_plan.ts";
import {
  type GrammarLexCandidateSite,
  type GrammarLexerPlan,
  type GrammarLexOptions,
  type GrammarLexResult,
  type GrammarLexToken,
  lexGrammar,
} from "../compiler/grammar_lexer.ts";
import {
  type GrammarParserCorePlan,
  type GrammarParseValidationResult,
  recoverGrammarParse,
  validateGrammarParse,
} from "../compiler/grammar_parser_core.ts";
import {
  type GrammarAstMaterializeResult,
  materializeGrammarAst,
} from "../compiler/grammar_ast.ts";
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

export interface GrammarRuntimeOptions {
  readonly validatePlan?: boolean;
}

export interface GrammarRuntimeParseOptions {
  readonly mode?: "validate" | "cst" | "ast";
  readonly lex?: GrammarLexOptions;
}

export interface GrammarRuntimeParseResult {
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly acceptedTokens: number;
  readonly tokens?: readonly GrammarLexToken[];
  readonly cst?: GrammarCstBuildResult["root"];
  readonly ast?: GrammarAstMaterializeResult["ast"];
}

export interface GrammarRuntimeParseTokensResult {
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly acceptedTokens: number;
}

export interface GrammarSourceMapping {
  readonly lineStarts: readonly number[];
  positionAt(
    offset: number,
  ): { readonly line: number; readonly column: number };
}

export interface GrammarRuntime {
  readonly plan: GrammarPortablePlan;
  readonly validationDiagnostics: readonly Diagnostic[];
  lex(source: string, options?: GrammarLexOptions): GrammarLexResult;
  parse(
    source: string,
    options?: GrammarRuntimeParseOptions,
  ): GrammarRuntimeParseResult;
  parseTokens(
    source: string,
    tokens: readonly GrammarLexToken[],
    options?: GrammarRuntimeParseOptions,
  ): GrammarRuntimeParseTokensResult;
  parseTokensUnchecked(
    source: string,
    tokens: readonly GrammarLexToken[],
    options?: GrammarRuntimeParseOptions,
  ): GrammarRuntimeParseTokensResult;
  validateParse(source: string): GrammarParseValidationResult;
  parseCst(
    source: string,
    options?: GrammarLexOptions,
  ): GrammarCstBuildResult;
  materializeAst(source: string): GrammarAstMaterializeResult;
  diagnostics(source: string): readonly Diagnostic[];
  sourceMap(source: string): GrammarSourceMapping;
  wasmStatus(): GrammarPortablePlan["targets"]["wasm"];
}

export function createGrammarRuntime(
  plan: GrammarPortablePlan,
  options: GrammarRuntimeOptions = {},
): GrammarRuntime {
  let validatePlan = true;
  if (options.validatePlan === false) {
    validatePlan = false;
  }
  let validationDiagnostics: readonly Diagnostic[] = [];
  if (validatePlan) {
    validationDiagnostics = validateGrammarPortablePlan(plan);
  }
  if (validationDiagnostics.length > 0) {
    const messages = validationDiagnostics.map((diagnostic) =>
      diagnostic.message
    ).join("\n");
    throw new Error(`Invalid grammar portable plan:\n${messages}`);
  }
  const analyzed = grammarPortablePlanToAnalyzed(plan);
  const lexer = lexerPlanFromPortable(plan);
  const parser = parserPlanFromPortable(plan, lexer);
  return {
    plan,
    validationDiagnostics,
    lex(
      source: string,
      lexOptions: GrammarLexOptions = {},
    ): GrammarLexResult {
      return lexGrammar(lexer, source, lexOptions);
    },
    parse(
      source: string,
      parseOptions: GrammarRuntimeParseOptions = {},
    ): GrammarRuntimeParseResult {
      const mode = parseMode(parseOptions);
      if (mode === "cst") {
        const cst = buildGrammarTokenCst(
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
        const ast = materializeGrammarAst(analyzed, lexer, source);
        return {
          ok: ast.diagnostics.length === 0,
          diagnostics: ast.diagnostics,
          acceptedTokens: ast.acceptedTokens,
          ast: ast.ast,
        };
      }
      const parsed = validateGrammarParse(parser, source);
      return {
        ok: parsed.ok,
        diagnostics: parsed.diagnostics,
        acceptedTokens: parsed.acceptedTokens,
      };
    },
    parseTokens(
      source: string,
      tokens: readonly GrammarLexToken[],
      parseOptions: GrammarRuntimeParseOptions = {},
    ): GrammarRuntimeParseTokensResult {
      const lexed = lexGrammar(lexer, source, parseOptions.lex);
      if (!sameTokenStream(lexed.tokens, tokens)) {
        return {
          ok: false,
          diagnostics: [{
            code: "GRAMMAR_RUNTIME_TOKEN_STREAM_MISMATCH",
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
      tokens: readonly GrammarLexToken[],
    ): GrammarRuntimeParseTokensResult {
      return parseTokenList(parser, tokens, []);
    },
    validateParse(source: string): GrammarParseValidationResult {
      return validateGrammarParse(parser, source);
    },
    parseCst(
      source: string,
      lexOptions: GrammarLexOptions = {},
    ): GrammarCstBuildResult {
      return buildGrammarTokenCst(plan.cst, lexer, source, lexOptions);
    },
    materializeAst(source: string): GrammarAstMaterializeResult {
      return materializeGrammarAst(analyzed, lexer, source);
    },
    diagnostics(source: string): readonly Diagnostic[] {
      const recovered = recoverGrammarParse(
        parser,
        source,
        plan.recovery.maxRecoveries,
      );
      return recovered.diagnostics;
    },
    sourceMap(source: string): GrammarSourceMapping {
      return createSourceMapping(source);
    },
    wasmStatus(): GrammarPortablePlan["targets"]["wasm"] {
      return plan.targets.wasm;
    },
  };
}

function parseMode(
  options: GrammarRuntimeParseOptions,
): "validate" | "cst" | "ast" {
  if (options.mode !== undefined) {
    return options.mode;
  }
  return "validate";
}

function lexerPlanFromPortable(
  plan: GrammarPortablePlan,
): GrammarLexerPlan {
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
  plan: GrammarPortablePlan,
  lexer: GrammarLexerPlan,
): GrammarParserCorePlan {
  return {
    bnf: bnfFromPortable(plan),
    lr: lrFromPortable(plan),
    lexer,
    diagnostics: [],
  };
}

function bnfFromPortable(plan: GrammarPortablePlan): BnfGrammar {
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

function rootRuleNonterminal(plan: GrammarPortablePlan): number {
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
  production: GrammarPortablePlan["parser"]["productions"][number],
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

function lrFromPortable(plan: GrammarPortablePlan): LrTable {
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
  plan: GrammarParserCorePlan,
  tokens: readonly GrammarLexToken[],
  candidateSites: readonly GrammarLexCandidateSite[],
): GrammarRuntimeParseTokensResult {
  const parserTokens = tokens.filter((token) => token.kind !== "trivia");
  const candidates = new Map<
    number,
    GrammarLexCandidateSite["candidates"]
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

function sameTokenStream(
  left: readonly GrammarLexToken[],
  right: readonly GrammarLexToken[],
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

function createSourceMapping(source: string): GrammarSourceMapping {
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
