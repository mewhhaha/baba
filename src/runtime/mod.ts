/**
 * Shared TypeScript runtime for generated Baba parser adapters.
 *
 * @module
 */

export {
  parserDiagnosticCodeAmbiguousParse,
  parserDiagnosticCodeBranchLimit,
  parserDiagnosticCodeInternalError,
  parserDiagnosticCodeParseInvalidTokenStream,
  parserDiagnosticCodeParseLexicalError,
  parserDiagnosticCodeParseTrailingInput,
  parserDiagnosticCodeParseUnexpectedToken,
  parserDiagnosticCodeTraceLimit,
  parserDiagnosticDetailKindNone,
  parserDiagnosticDetailKindParserState,
} from "../targets/kit/schema.ts";
export type {
  KitEofToken as EofToken,
  KitErrorToken as ErrorToken,
  KitLexDiagnostic as LexDiagnostic,
  KitLexOptions as LexOptions,
  KitLexResult as LexResult,
  KitLiteralToken as LiteralToken,
  KitMainNamedToken as MainNamedToken,
  KitParseDiagnostic as ParseDiagnostic,
  KitRuleNode as RuleNode,
  KitSpan as Span,
  KitSyntaxElement as SyntaxElement,
  KitToken as Token,
  KitTriviaToken as TriviaToken,
  ParserKit as RuntimeParserPlan,
} from "../targets/kit/schema.ts";
import {
  assertParserKit,
  type KitLexOptions,
  type KitLexResult,
  type KitParseEvent,
  type KitParseEventResult,
  type KitParseResult,
  type KitRuleNode,
  type KitToken,
  lexWithKit,
  parseEventsWithKit,
  parseLazyWithKit,
  type ParserKit,
  parseTokenEventsUncheckedWithKit,
  parseTokenEventsWithKit,
  parseTokensLazyUncheckedWithKit,
  parseTokensLazyWithKit,
  parseTokensUncheckedWithKit,
  parseTokensWithKit,
  parseWithKit,
  validateParserKit,
  validateTokensUncheckedWithKit,
  validateTokensWithKit,
  validateWithKit,
} from "../targets/kit/schema.ts";

export type { KitParseEvent as ParseEvent };

export type ParseMode =
  | "tokens"
  | "validate"
  | "events"
  | "cst-full"
  | "cst-lazy";

export interface ParseOptions extends KitLexOptions {
  readonly mode?: ParseMode;
  readonly contextualLexingStats?: (stats: unknown) => void;
  readonly maxExploredBranches?: number;
  readonly maxTraceActions?: number;
  readonly ambiguityMode?: "first-success" | "reject-ambiguous-success";
}

export type ParseResult<Root extends KitRuleNode = KitRuleNode> =
  | KitParseResult<Root>
  | KitParseEventResult
  | KitLexResult
  | ValidateParseResult;

export type ValidateParseResult =
  | {
    readonly ok: true;
    readonly source: string;
    readonly diagnostics: readonly [];
  }
  | {
    readonly ok: false;
    readonly source: string;
    readonly diagnostics: readonly unknown[];
  };

export interface RuntimeParser<Root extends KitRuleNode = KitRuleNode> {
  readonly plan: ParserKit;
  lex(source: string, options?: KitLexOptions): KitLexResult;
  parse(
    source: string,
    options: ParseOptions & { mode: "tokens" },
  ): KitLexResult;
  parse(
    source: string,
    options: ParseOptions & { mode: "validate" },
  ): ValidateParseResult;
  parse(
    source: string,
    options: ParseOptions & { mode: "events" },
  ): KitParseEventResult;
  parse(source: string, options?: ParseOptions): KitParseResult<Root>;
  parseTokens(
    source: string,
    tokens: readonly KitToken[],
    options: ParseOptions & { mode: "tokens" },
  ): KitLexResult;
  parseTokens(
    source: string,
    tokens: readonly KitToken[],
    options: ParseOptions & { mode: "validate" },
  ): ValidateParseResult;
  parseTokens(
    source: string,
    tokens: readonly KitToken[],
    options: ParseOptions & { mode: "events" },
  ): KitParseEventResult;
  parseTokens(
    source: string,
    tokens: readonly KitToken[],
    options?: ParseOptions,
  ): KitParseResult<Root>;
  parseTokensUnchecked(
    source: string,
    tokens: readonly KitToken[],
    options: ParseOptions & { mode: "tokens" },
  ): KitLexResult;
  parseTokensUnchecked(
    source: string,
    tokens: readonly KitToken[],
    options: ParseOptions & { mode: "validate" },
  ): ValidateParseResult;
  parseTokensUnchecked(
    source: string,
    tokens: readonly KitToken[],
    options: ParseOptions & { mode: "events" },
  ): KitParseEventResult;
  parseTokensUnchecked(
    source: string,
    tokens: readonly KitToken[],
    options?: ParseOptions,
  ): KitParseResult<Root>;
}

export interface CreateParserOptions {
  readonly validate?: boolean;
}

export function createParser<Root extends KitRuleNode = KitRuleNode>(
  plan: ParserKit,
  options: CreateParserOptions = {},
): RuntimeParser<Root> {
  if (options.validate ?? true) assertParserKit(plan);
  const parse: RuntimeParser<Root>["parse"] = ((
    source: string,
    parseOptions?: ParseOptions,
  ) =>
    parseOptions?.mode === "tokens"
      ? lexWithKit(plan, source, parseOptions)
      : parseOptions?.mode === "validate"
      ? validateWithKit(plan, source, parseOptions)
      : parseOptions?.mode === "events"
      ? parseEventsWithKit(plan, source, parseOptions)
      : parseOptions?.mode === "cst-lazy"
      ? parseLazyWithKit(plan, source, parseOptions) as KitParseResult<Root>
      : parseWithKit(plan, source, parseOptions) as KitParseResult<
        Root
      >) as RuntimeParser<Root>["parse"];
  const parseTokens: RuntimeParser<Root>["parseTokens"] = ((
    source: string,
    tokens: readonly KitToken[],
    parseOptions?: ParseOptions,
  ) =>
    parseOptions?.mode === "tokens"
      ? { source, tokens, diagnostics: [] }
      : parseOptions?.mode === "validate"
      ? validateTokensWithKit(plan, source, tokens)
      : parseOptions?.mode === "events"
      ? parseTokenEventsWithKit(plan, source, tokens)
      : parseOptions?.mode === "cst-lazy"
      ? parseTokensLazyWithKit(plan, source, tokens) as KitParseResult<Root>
      : parseTokensWithKit(plan, source, tokens) as KitParseResult<
        Root
      >) as RuntimeParser<Root>["parseTokens"];
  const parseTokensUnchecked: RuntimeParser<Root>["parseTokensUnchecked"] = ((
    source: string,
    tokens: readonly KitToken[],
    parseOptions?: ParseOptions,
  ) =>
    parseOptions?.mode === "tokens"
      ? { source, tokens, diagnostics: [] }
      : parseOptions?.mode === "validate"
      ? validateTokensUncheckedWithKit(plan, source, tokens)
      : parseOptions?.mode === "events"
      ? parseTokenEventsUncheckedWithKit(plan, source, tokens)
      : parseOptions?.mode === "cst-lazy"
      ? parseTokensLazyUncheckedWithKit(plan, source, tokens) as KitParseResult<
        Root
      >
      : parseTokensUncheckedWithKit(
        plan,
        source,
        tokens,
      ) as KitParseResult<Root>) as RuntimeParser<Root>["parseTokensUnchecked"];
  return {
    plan,
    lex(source, lexOptions) {
      return lexWithKit(plan, source, lexOptions);
    },
    parse,
    parseTokens,
    parseTokensUnchecked,
  };
}

export function validatePlan(plan: unknown) {
  return validateParserKit(plan);
}

export const createLexer = createParser;

export function inflateCompactRuntimePlan(encoded: unknown): ParserKit {
  const value = encoded as {
    m: [string, number, string, string, string];
    g: [string, string, number, string, unknown[]];
    t: [unknown[], unknown[]];
    l: [boolean, unknown[], number, unknown[], number[], number[][]];
    b: [number, number, number, unknown[], unknown[], unknown[]];
    r: [number, number, unknown[], unknown[], number[]];
    f: [string, unknown[]];
    d: [unknown[], unknown[]];
  };
  const span = { start: 0, end: 0, line: 1, column: 1 };
  const symbol = (entry: unknown) => {
    const [kind, id] = entry as [number, number];
    return kind === 0 ? { kind: "terminal" as const, id } : {
      kind: "nonterminal" as const,
      id,
    };
  };
  const reducer = (entry: unknown) => {
    const [kind, payload] = entry as [number, number | string | undefined];
    switch (kind) {
      case 0:
        return { kind: "start" as const };
      case 1:
        return { kind: "rule" as const, ruleId: payload as number };
      case 2:
        return { kind: "terminal" as const };
      case 3:
        return { kind: "ruleRef" as const };
      case 4:
        return { kind: "identity" as const };
      case 5:
        return { kind: "sequence" as const };
      case 6:
        return { kind: "optionalEmpty" as const };
      case 7:
        return { kind: "optionalSome" as const };
      case 8:
        return { kind: "repeatEmpty" as const };
      case 9:
        return { kind: "repeatAppend" as const };
      case 10:
        return { kind: "repeat1First" as const };
      case 11:
        return { kind: "repeat1Append" as const };
      case 12:
        return { kind: "separatedFirst" as const };
      case 13:
        return { kind: "separatedAppend" as const };
      default:
        return { kind: "field" as const, name: payload as string };
    }
  };
  const action = (entry: unknown) => {
    const [kind, payload] = entry as [number, number | undefined];
    if (kind === 0) return { kind: "shift" as const, state: payload ?? 0 };
    if (kind === 1) {
      return { kind: "reduce" as const, production: payload ?? 0 };
    }
    return { kind: "accept" as const };
  };
  return {
    schemaVersion: 1,
    generator: "@mewhhaha/baba",
    profile: "runtime",
    portablePlan: {
      format: "baba-parser-plan",
      version: 1,
      semantics: "baba-portable-v1",
      hash: value.m[3],
    },
    runtimeImplementation: {
      format: "baba-runtime-implementation",
      version: 1,
      semantics: "baba-runtime-portable-v1",
      hash: value.m[4],
    },
    grammar: {
      name: value.g[0],
      rootRule: value.g[1],
      rootRuleId: value.g[2],
      rootNodeType: value.g[3],
      rules: value.g[4].map((entry) => {
        const [id, name, reachable, nodeType] = entry as [
          number,
          string,
          boolean,
          string | undefined,
        ];
        return { id, name, reachable, nodeType, span };
      }),
    },
    tokens: {
      named: value.t[0].map((entry) => {
        const [id, name, kind, priority, declarationOrder, reachable] =
          entry as [number, string, number, number, number, boolean];
        const tokenKind = kind === 0 ? "token" as const : "skip" as const;
        return {
          id,
          name,
          kind: tokenKind,
          channel: tokenKind === "skip" ? "trivia" as const : "main" as const,
          pattern: "",
          priority,
          declarationOrder,
          reachable,
          span,
        };
      }),
      literals: value.t[1].map((entry) => {
        const [id, literal, sourceOrder, reachable] = entry as [
          number,
          string,
          number,
          boolean,
        ];
        return { id, value: literal, sourceOrder, reachable, span };
      }),
    },
    lexer: {
      defaultPreserveTrivia: value.l[0],
      specs: value.l[1].map((entry) => {
        const [kind, id] = entry as [number, number];
        return kind === 0 ? { type: "named" as const, tokenId: id } : {
          type: "literal" as const,
          literalId: id,
        };
      }),
      dfa: {
        start: value.l[2],
        transitions: value.l[3].map((row) =>
          (row as unknown[]).map((entry) => {
            const [start, end, target] = entry as [number, number, number];
            return { start, end, target };
          })
        ),
        accepts: value.l[4],
        acceptCandidates: value.l[5],
      },
    },
    bnf: {
      startNonterminal: value.b[0],
      rootRuleNonterminal: value.b[1],
      eofTerminal: value.b[2],
      terminals: value.b[3].map((entry) => {
        const [id, kind, key, display, ref] = entry as [
          number,
          number,
          string,
          string,
          number | undefined,
        ];
        if (kind === 0) return { id, kind: "eof" as const, key, display };
        if (kind === 1) {
          return { id, kind: "named" as const, key, display, tokenId: ref };
        }
        return { id, kind: "literal" as const, key, display, literalId: ref };
      }),
      nonterminals: value.b[4].map((entry) => {
        const [id, name, ruleId, expressionId] = entry as [
          number,
          string,
          number | null | undefined,
          number | null | undefined,
        ];
        return {
          id,
          name,
          ...(ruleId == null ? {} : { ruleId }),
          ...(expressionId == null ? {} : { expressionId }),
        };
      }),
      productions: value.b[5].map((entry) => {
        const [id, lhs, rhs, reducerEntry] = entry as [
          number,
          number,
          unknown[],
          unknown,
        ];
        return {
          id,
          lhs,
          rhs: rhs.map(symbol),
          reducer: reducer(reducerEntry),
        };
      }),
    },
    lr: {
      conflictProfile: value.r[0] === 1 ? "branching" : "deterministic",
      states: Array.from(
        { length: value.r[1] },
        (_, id) => ({ id, items: [] }),
      ),
      actions: value.r[2].map((entry) => {
        const [state, terminal, actions] = entry as [number, number, unknown[]];
        return { state, terminal, actions: actions.map(action) };
      }),
      gotos: value.r[3].map((entry) => {
        const [state, nonterminal, target] = entry as [number, number, number];
        return { state, nonterminal, target };
      }),
      stats: {
        bnfProductions: value.r[4][0],
        states: value.r[4][1],
        coreItems: value.r[4][2],
        items: value.r[4][3],
        closureWork: value.r[4][4],
        actionEntries: value.r[4][5],
        gotoEntries: value.r[4][6],
        tableEntries: value.r[4][7],
      },
    },
    fields: {
      rootNodeType: value.f[0],
      rules: value.f[1].map((entry) => {
        const [ruleId, ruleName, nodeType, fields] = entry as [
          number,
          string,
          string,
          unknown[],
        ];
        return {
          ruleId,
          ruleName,
          nodeType,
          fields: fields.map((field) => {
            const [name, type, array, nullable] = field as [
              string,
              string,
              boolean,
              boolean,
            ];
            return { name, type, array, nullable };
          }),
        };
      }),
    },
    displayNames: {
      terminals: value.d[0].map((entry) => {
        const [id, display] = entry as [number, string];
        return { id, display };
      }),
      rules: value.d[1].map((entry) => {
        const [id, display] = entry as [number, string];
        return { id, display };
      }),
    },
  };
}

export interface Position {
  readonly line: number;
  readonly column: number;
}

export interface SourceMap {
  readonly source: string;
  positionAt(offset: number): Position;
}

export function positionAt(source: string, offset: number): Position {
  return createSourceMap(source).positionAt(offset);
}

export function createSourceMap(source: string): SourceMap {
  let lineStarts: readonly number[] | null = null;
  const starts = (): readonly number[] => {
    if (lineStarts) return lineStarts;
    const values = [0];
    for (let index = 0; index < source.length; index++) {
      const code = source.charCodeAt(index);
      if (code === 13) {
        if (source.charCodeAt(index + 1) === 10) index++;
        values.push(index + 1);
      } else if (code === 10) {
        values.push(index + 1);
      }
    }
    lineStarts = values;
    return values;
  };
  return {
    source,
    positionAt(offsetToMap: number): Position {
      const clamped = Math.min(Math.max(0, offsetToMap), source.length);
      const values = starts();
      let low = 0;
      let high = values.length - 1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (values[mid] <= clamped) low = mid + 1;
        else high = mid - 1;
      }
      const lineIndex = Math.max(0, high);
      return {
        line: lineIndex + 1,
        column: clamped - values[lineIndex],
      };
    },
  };
}
