/**
 * Shared runtime parser plan schema and TypeScript interpreter.
 *
 * This is not a generated kit target. The Wasm adapter stores grammar-specific
 * metadata in parser.plan and uses these helpers to materialize public lexer and
 * parser results.
 */

export const PARSER_KIT_SCHEMA_VERSION = 1;

export const parserDiagnosticCodeParseLexicalError = 1;
export const parserDiagnosticCodeParseUnexpectedToken = 2;
export const parserDiagnosticCodeParseTrailingInput = 3;
export const parserDiagnosticCodeParseInvalidTokenStream = 4;
export const parserDiagnosticCodeInternalError = 5;
export const parserDiagnosticCodeBranchLimit = 6;
export const parserDiagnosticCodeTraceLimit = 7;
export const parserDiagnosticCodeAmbiguousParse = 8;
export const parserDiagnosticDetailKindNone = 0;
export const parserDiagnosticDetailKindParserState = 1;

export interface ParserKit {
  schemaVersion: 1;
  generator: "@mewhhaha/baba";
  profile?: ParserKitProfile;
  portablePlan: ParserKitPortablePlanMetadata;
  runtimeImplementation?: ParserKitRuntimeImplementationMetadata;
  grammar: ParserKitGrammarInfo;
  tokens: ParserKitTokenMetadata;
  lexer: ParserKitLexer;
  bnf: ParserKitBnf;
  lr: ParserKitLr;
  fields: ParserKitFieldMetadata;
  displayNames: ParserKitDisplayNames;
}

export type ParserKitProfile = "full" | "runtime";

export interface ParserKitPortablePlanMetadata {
  format: "baba-parser-plan";
  version: 1;
  semantics: "baba-portable-v1";
  hash: string;
}

export interface ParserKitRuntimeImplementationMetadata {
  format: "baba-runtime-implementation";
  version: 1;
  semantics: "baba-runtime-portable-v1";
  hash: string;
}

export interface ParserKitGrammarInfo {
  name: string;
  rootRule: string;
  rootRuleId: number;
  rootNodeType: string;
  rules: readonly ParserKitRuleInfo[];
}

export interface ParserKitRuleInfo {
  id: number;
  name: string;
  reachable: boolean;
  nodeType?: string;
  span: ParserKitSourceSpan;
}

export interface ParserKitSourceSpan {
  start: number;
  end: number;
  line: number;
  column: number;
}

export interface ParserKitTokenMetadata {
  named: readonly ParserKitNamedTokenSpec[];
  literals: readonly ParserKitLiteralSpec[];
}

export interface ParserKitNamedTokenSpec {
  id: number;
  name: string;
  kind: "token" | "skip";
  channel: "main" | "trivia";
  pattern: string;
  priority: number;
  declarationOrder: number;
  reachable: boolean;
  span: ParserKitSourceSpan;
}

export interface ParserKitLiteralSpec {
  id: number;
  value: string;
  sourceOrder: number;
  reachable: boolean;
  span: ParserKitSourceSpan;
}

export interface ParserKitLexer {
  defaultPreserveTrivia: boolean;
  specs: readonly ParserKitLexerSpec[];
  dfa: ParserKitLexerDfa;
}

export type ParserKitLexerSpec =
  | { type: "named"; tokenId: number }
  | { type: "literal"; literalId: number };

export interface ParserKitLexerDfa {
  start: number;
  transitions: readonly (readonly ParserKitLexerTransition[])[];
  accepts: readonly number[];
  acceptCandidates?: readonly (readonly number[])[];
}

export interface ParserKitLexerTransition {
  start: number;
  end: number;
  target: number;
}

export interface ParserKitBnf {
  startNonterminal: number;
  rootRuleNonterminal: number;
  eofTerminal: number;
  terminals: readonly ParserKitTerminal[];
  nonterminals: readonly ParserKitNonterminal[];
  productions: readonly ParserKitProduction[];
}

export interface ParserKitTerminal {
  id: number;
  kind: "eof" | "named" | "literal";
  key: string;
  display: string;
  tokenId?: number;
  literalId?: number;
}

export interface ParserKitNonterminal {
  id: number;
  name: string;
  ruleId?: number;
  expressionId?: number;
}

export type ParserKitSymbol =
  | { kind: "terminal"; id: number }
  | { kind: "nonterminal"; id: number };

export type ParserKitReducerSpec =
  | { kind: "start" }
  | { kind: "rule"; ruleId: number }
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

export interface ParserKitProduction {
  id: number;
  lhs: number;
  rhs: readonly ParserKitSymbol[];
  reducer: ParserKitReducerSpec;
  span?: ParserKitSourceSpan;
  origin?: ParserKitProductionOrigin;
}

export interface ParserKitProductionOrigin {
  ruleId: number;
  ruleName: string;
  expressionId?: number;
  span: ParserKitSourceSpan;
  description: string;
}

export interface ParserKitLr {
  conflictProfile: "deterministic" | "branching";
  states: readonly ParserKitLrState[];
  actions: readonly ParserKitActionEntry[];
  gotos: readonly ParserKitGotoEntry[];
  stats: ParserKitLrStats;
}

export interface ParserKitLrState {
  id: number;
  items: readonly ParserKitLrItem[];
}

export interface ParserKitLrItem {
  production: number;
  dot: number;
  lookaheads: readonly number[];
}

export interface ParserKitActionEntry {
  state: number;
  terminal: number;
  actions: readonly ParserKitLrAction[];
}

export type ParserKitLrAction =
  | { kind: "shift"; state: number }
  | { kind: "reduce"; production: number }
  | { kind: "accept" };

export interface ParserKitGotoEntry {
  state: number;
  nonterminal: number;
  target: number;
}

export interface ParserKitLrStats {
  bnfProductions: number;
  states: number;
  coreItems: number;
  items: number;
  closureWork: number;
  actionEntries: number;
  gotoEntries: number;
  tableEntries: number;
}

export interface ParserKitFieldMetadata {
  rootNodeType: string;
  rules: readonly ParserKitRuleFieldSchema[];
}

export interface ParserKitRuleFieldSchema {
  ruleId: number;
  ruleName: string;
  nodeType: string;
  fields: readonly ParserKitFieldInfo[];
}

export interface ParserKitFieldInfo {
  name: string;
  type: string;
  array: boolean;
  nullable: boolean;
}

export interface ParserKitDisplayNames {
  terminals: readonly { id: number; display: string }[];
  rules: readonly { id: number; display: string }[];
}

export interface ParserKitValidationIssue {
  path: string;
  message: string;
}

export interface KitSpan {
  start: number;
  end: number;
}

export interface KitLexDiagnostic {
  code: "LEX_UNEXPECTED_CHARACTER";
  message: string;
  span: KitSpan;
}

export interface KitParseDiagnostic {
  code:
    | "PARSE_LEXICAL_ERROR"
    | "PARSE_UNEXPECTED_TOKEN"
    | "PARSE_TRAILING_INPUT"
    | "PARSE_INVALID_TOKEN_STREAM"
    | "PARSER_BRANCH_LIMIT"
    | "PARSER_TRACE_LIMIT"
    | "PARSER_AMBIGUOUS_PARSE"
    | "PARSER_INTERNAL_ERROR";
  message: string;
  span: KitSpan;
  runtimeCode: number;
  runtimeDetail: number;
  runtimeDetailKind: "none" | "parser-state";
  runtimeDetailKindId: number;
  expected?: readonly string[];
  found?: string;
}

export interface KitMainNamedToken<K extends string = string> {
  type: "named";
  kind: K;
  text: string;
  span: KitSpan;
  channel: "main";
}

export interface KitTriviaToken<K extends string = string> {
  type: "named";
  kind: K;
  text: string;
  span: KitSpan;
  channel: "trivia";
}

export interface KitLiteralToken<L extends string = string> {
  type: "literal";
  literal: L;
  text: L;
  span: KitSpan;
  channel: "main";
}

export interface KitErrorToken {
  type: "error";
  text: string;
  span: KitSpan;
  channel: "error";
}

export interface KitEofToken {
  type: "eof";
  text: "";
  span: KitSpan;
  channel: "main";
}

export type KitToken =
  | KitMainNamedToken
  | KitTriviaToken
  | KitLiteralToken
  | KitErrorToken
  | KitEofToken;

export type KitSyntaxElement =
  | KitRuleNode
  | KitMainNamedToken
  | KitLiteralToken;

export interface KitRuleNode<N extends string = string> {
  type: "rule";
  name: N;
  span: KitSpan;
  tokenRange: { start: number; end: number };
  children: readonly KitSyntaxElement[];
  fields: Record<string, unknown>;
}

export interface KitLexOptions {
  preserveTrivia?: boolean;
}

export interface KitLexResult {
  source: string;
  tokens: readonly KitToken[];
  diagnostics: readonly KitLexDiagnostic[];
}

export interface KitContextualLexingStats {
  ambiguousLexicalSites: number;
  contextualCandidateChecks: number;
  attemptedTokenSelections: number;
  reductionsBeforeTokenSelection: number;
}

export interface KitParseOptions extends KitLexOptions {
  contextualLexingStats?: (stats: KitContextualLexingStats) => void;
  maxExploredBranches?: number;
  maxTraceActions?: number;
  ambiguityMode?: "first-success" | "reject-ambiguous-success";
}

export type KitParseResult<Root extends KitRuleNode = KitRuleNode> =
  | {
    ok: true;
    root: Root;
    source: string;
    tokens: readonly KitToken[];
    diagnostics: readonly [];
  }
  | {
    ok: false;
    root: null;
    source: string;
    tokens: readonly KitToken[];
    diagnostics: readonly KitParseDiagnostic[];
  };

export type KitParseEvent =
  | {
    kind: "token";
    tokenId: number;
    terminalId: number;
    start: number;
    end: number;
  }
  | { kind: "enter"; ruleId: number; start: number }
  | { kind: "exit"; ruleId: number; end: number }
  | { kind: "field"; fieldId: number };

export type KitParseEventResult =
  | {
    ok: true;
    source: string;
    events: readonly KitParseEvent[];
    diagnostics: readonly [];
  }
  | {
    ok: false;
    source: string;
    events: readonly [];
    diagnostics: readonly KitParseDiagnostic[];
  };

export type KitValidateParseResult =
  | {
    ok: true;
    source: string;
    diagnostics: readonly [];
  }
  | {
    ok: false;
    source: string;
    diagnostics: readonly KitParseDiagnostic[];
  };

interface Fragment {
  value: unknown;
  children: KitSyntaxElement[];
  fields: FieldCapture[];
  span: KitSpan | null;
  tokenRange: TokenRange | null;
}

interface EventFragment {
  events: KitParseEvent[];
  span: KitSpan | null;
  tokenRange: TokenRange | null;
}

interface FieldCapture {
  name: string;
  value: unknown;
}

interface TokenRange {
  start: number;
  end: number;
}

interface ShiftedToken {
  token: KitToken;
  tokenIndex: number;
}

interface ParseLexCandidate {
  token: KitToken;
  terminal: number;
}

interface ParseLexCandidateSite {
  tokenIndex: number;
  candidates: readonly ParseLexCandidate[];
}

interface FieldConfig {
  array: boolean;
  nullable: boolean;
}

interface RuntimeRuleFieldSchema {
  entries: readonly (readonly [name: string, config: FieldConfig])[];
  byName: Record<string, FieldConfig>;
}

interface ParseBranch {
  states: number[];
  values: unknown[];
  index: number;
  tokenOverrides: Map<number, KitToken>;
}

type BranchAdvanceResult =
  | { kind: "continue" }
  | { kind: "forked" }
  | { kind: "success"; result: InternalParseResult }
  | { kind: "failure"; failure: ParseFailure };

type KitParseExecutionMode = "cst" | "validate" | "events";

type InternalParseResult =
  | KitParseResult
  | KitValidateParseResult
  | KitParseEventResult;

interface ParseFailure {
  diagnostic: KitParseDiagnostic;
  offset: number;
}

interface ContextualStatsState extends KitContextualLexingStats {}

const MAX_PARSE_BRANCHES = 100000;

function optionsLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

export function validateParserKit(
  value: unknown,
): ParserKitValidationIssue[] {
  const issues: ParserKitValidationIssue[] = [];
  const kit = value as Partial<ParserKit> | null;
  if (!kit || typeof kit !== "object") {
    return [{ path: "$", message: "ParserKit must be an object." }];
  }
  if (kit.schemaVersion !== PARSER_KIT_SCHEMA_VERSION) {
    issues.push({
      path: "$.schemaVersion",
      message: `Expected schema version ${PARSER_KIT_SCHEMA_VERSION}.`,
    });
  }
  if (kit.generator !== "@mewhhaha/baba") {
    issues.push({
      path: "$.generator",
      message: "Expected generator '@mewhhaha/baba'.",
    });
  }
  if (kit.profile !== undefined) {
    requireEnum(kit.profile, ["full", "runtime"], "$.profile", issues);
  }
  requireObject(kit.portablePlan, "$.portablePlan", issues);
  requireObject(kit.grammar, "$.grammar", issues);
  requireObject(kit.tokens, "$.tokens", issues);
  requireObject(kit.lexer, "$.lexer", issues);
  requireObject(kit.bnf, "$.bnf", issues);
  requireObject(kit.lr, "$.lr", issues);
  requireObject(kit.fields, "$.fields", issues);
  requireObject(kit.displayNames, "$.displayNames", issues);
  if (kit.portablePlan && typeof kit.portablePlan === "object") {
    requireEnum(
      kit.portablePlan.format,
      ["baba-parser-plan"],
      "$.portablePlan.format",
      issues,
    );
    requireNumber(kit.portablePlan.version, "$.portablePlan.version", issues);
    requireEnum(
      kit.portablePlan.semantics,
      ["baba-portable-v1"],
      "$.portablePlan.semantics",
      issues,
    );
    requireString(kit.portablePlan.hash, "$.portablePlan.hash", issues);
  }
  if (kit.runtimeImplementation !== undefined) {
    requireObject(
      kit.runtimeImplementation,
      "$.runtimeImplementation",
      issues,
    );
    if (
      kit.runtimeImplementation &&
      typeof kit.runtimeImplementation === "object"
    ) {
      requireEnum(
        kit.runtimeImplementation.format,
        ["baba-runtime-implementation"],
        "$.runtimeImplementation.format",
        issues,
      );
      requireNumber(
        kit.runtimeImplementation.version,
        "$.runtimeImplementation.version",
        issues,
      );
      requireEnum(
        kit.runtimeImplementation.semantics,
        ["baba-runtime-portable-v1"],
        "$.runtimeImplementation.semantics",
        issues,
      );
      requireString(
        kit.runtimeImplementation.hash,
        "$.runtimeImplementation.hash",
        issues,
      );
    }
  }
  if (kit.grammar && typeof kit.grammar === "object") {
    requireString(kit.grammar.name, "$.grammar.name", issues);
    requireString(kit.grammar.rootRule, "$.grammar.rootRule", issues);
    requireNumber(kit.grammar.rootRuleId, "$.grammar.rootRuleId", issues);
    requireString(kit.grammar.rootNodeType, "$.grammar.rootNodeType", issues);
    requireArray(kit.grammar.rules, "$.grammar.rules", issues);
    if (Array.isArray(kit.grammar.rules)) {
      kit.grammar.rules.forEach((rule, index) =>
        validateRuleInfo(rule, `$.grammar.rules[${index}]`, issues)
      );
    }
  }
  if (kit.tokens && typeof kit.tokens === "object") {
    requireArray(kit.tokens.named, "$.tokens.named", issues);
    requireArray(kit.tokens.literals, "$.tokens.literals", issues);
    if (Array.isArray(kit.tokens.named)) {
      kit.tokens.named.forEach((token, index) =>
        validateNamedToken(token, `$.tokens.named[${index}]`, issues)
      );
    }
    if (Array.isArray(kit.tokens.literals)) {
      kit.tokens.literals.forEach((literal, index) =>
        validateLiteral(literal, `$.tokens.literals[${index}]`, issues)
      );
    }
  }
  if (kit.lexer && typeof kit.lexer === "object") {
    if (typeof kit.lexer.defaultPreserveTrivia !== "boolean") {
      issues.push({
        path: "$.lexer.defaultPreserveTrivia",
        message: "Expected boolean.",
      });
    }
    requireArray(kit.lexer.specs, "$.lexer.specs", issues);
    requireObject(kit.lexer.dfa, "$.lexer.dfa", issues);
    if (Array.isArray(kit.lexer.specs)) {
      kit.lexer.specs.forEach((spec, index) =>
        validateLexerSpec(spec, `$.lexer.specs[${index}]`, issues)
      );
    }
    if (kit.lexer.dfa && typeof kit.lexer.dfa === "object") {
      validateLexerDfa(
        kit.lexer.dfa,
        "$.lexer.dfa",
        Array.isArray(kit.lexer.specs) ? kit.lexer.specs.length : undefined,
        issues,
      );
    }
  }
  if (kit.bnf && typeof kit.bnf === "object") {
    requireNumber(kit.bnf.startNonterminal, "$.bnf.startNonterminal", issues);
    requireNumber(
      kit.bnf.rootRuleNonterminal,
      "$.bnf.rootRuleNonterminal",
      issues,
    );
    requireNumber(kit.bnf.eofTerminal, "$.bnf.eofTerminal", issues);
    requireArray(kit.bnf.terminals, "$.bnf.terminals", issues);
    requireArray(kit.bnf.nonterminals, "$.bnf.nonterminals", issues);
    requireArray(kit.bnf.productions, "$.bnf.productions", issues);
    if (Array.isArray(kit.bnf.terminals)) {
      kit.bnf.terminals.forEach((terminal, index) =>
        validateTerminal(terminal, `$.bnf.terminals[${index}]`, issues)
      );
    }
    if (Array.isArray(kit.bnf.nonterminals)) {
      kit.bnf.nonterminals.forEach((nonterminal, index) =>
        validateNonterminal(
          nonterminal,
          `$.bnf.nonterminals[${index}]`,
          issues,
        )
      );
    }
    if (Array.isArray(kit.bnf.productions)) {
      kit.bnf.productions.forEach((production, index) =>
        validateProduction(production, `$.bnf.productions[${index}]`, issues)
      );
    }
  }
  if (kit.lr && typeof kit.lr === "object") {
    requireEnum(
      kit.lr.conflictProfile,
      ["deterministic", "branching"],
      "$.lr.conflictProfile",
      issues,
    );
    requireArray(kit.lr.states, "$.lr.states", issues);
    requireArray(kit.lr.actions, "$.lr.actions", issues);
    requireArray(kit.lr.gotos, "$.lr.gotos", issues);
    requireObject(kit.lr.stats, "$.lr.stats", issues);
    if (Array.isArray(kit.lr.states)) {
      kit.lr.states.forEach((state, index) =>
        validateLrState(state, `$.lr.states[${index}]`, issues)
      );
    }
    if (Array.isArray(kit.lr.actions)) {
      kit.lr.actions.forEach((entry, index) =>
        validateActionEntry(entry, `$.lr.actions[${index}]`, issues)
      );
    }
    if (Array.isArray(kit.lr.gotos)) {
      kit.lr.gotos.forEach((entry, index) =>
        validateGotoEntry(entry, `$.lr.gotos[${index}]`, issues)
      );
    }
    if (kit.lr.stats && typeof kit.lr.stats === "object") {
      validateLrStats(kit.lr.stats, "$.lr.stats", issues);
    }
  }
  if (kit.fields && typeof kit.fields === "object") {
    requireString(kit.fields.rootNodeType, "$.fields.rootNodeType", issues);
    requireArray(kit.fields.rules, "$.fields.rules", issues);
    if (Array.isArray(kit.fields.rules)) {
      kit.fields.rules.forEach((schema, index) =>
        validateFieldSchema(schema, `$.fields.rules[${index}]`, issues)
      );
    }
  }
  if (kit.displayNames && typeof kit.displayNames === "object") {
    requireArray(
      kit.displayNames.terminals,
      "$.displayNames.terminals",
      issues,
    );
    requireArray(kit.displayNames.rules, "$.displayNames.rules", issues);
    if (Array.isArray(kit.displayNames.terminals)) {
      kit.displayNames.terminals.forEach((entry, index) =>
        validateDisplayName(
          entry,
          "$.displayNames.terminals",
          index,
          issues,
        )
      );
    }
    if (Array.isArray(kit.displayNames.rules)) {
      kit.displayNames.rules.forEach((entry, index) =>
        validateDisplayName(entry, "$.displayNames.rules", index, issues)
      );
    }
  }
  validateParserKitReferences(kit, issues);
  return issues;
}

export function assertParserKit(value: unknown): asserts value is ParserKit {
  const issues = validateParserKit(value);
  if (issues.length === 0) return;
  const first = issues[0];
  throw new Error(`Invalid ParserKit at ${first.path}: ${first.message}`);
}

export function mainTokenKinds(kit: ParserKit): string[] {
  return kit.tokens.named
    .filter((token) => token.channel === "main" && token.reachable)
    .map((token) => token.name);
}

export function triviaTokenKinds(kit: ParserKit): string[] {
  return kit.tokens.named
    .filter((token) => token.channel === "trivia")
    .map((token) => token.name);
}

export function literalKinds(kit: ParserKit): string[] {
  return kit.tokens.literals
    .filter((literal) => literal.reachable)
    .map((literal) => literal.value);
}

export function terminalMappings(
  kit: ParserKit,
): {
  named: Record<string, number>;
  literals: Record<string, number>;
  eof: number;
} {
  const named = Object.create(null) as Record<string, number>;
  const literals = Object.create(null) as Record<string, number>;
  const tokenNames = new Map(kit.tokens.named.map((token) => [
    token.id,
    token.name,
  ]));
  const literalValues = new Map(kit.tokens.literals.map((literal) => [
    literal.id,
    literal.value,
  ]));
  for (const terminal of kit.bnf.terminals) {
    if (terminal.kind === "named" && terminal.tokenId !== undefined) {
      const name = tokenNames.get(terminal.tokenId);
      if (name !== undefined) named[name] = terminal.id;
    } else if (
      terminal.kind === "literal" && terminal.literalId !== undefined
    ) {
      const value = literalValues.get(terminal.literalId);
      if (value !== undefined) literals[value] = terminal.id;
    }
  }
  return { named, literals, eof: kit.bnf.eofTerminal };
}

export function tokenToTerminal(kit: ParserKit, token: KitToken): number {
  if (token.type === "eof") return kit.bnf.eofTerminal;
  const mappings = terminalMappings(kit);
  if (token.type === "named" && token.channel === "main") {
    return mappings.named[token.kind] ?? -1;
  }
  if (token.type === "literal") {
    return mappings.literals[token.literal] ?? -1;
  }
  return -1;
}

export function lexWithKit(
  kit: ParserKit,
  source: string,
  options: KitLexOptions = {},
): KitLexResult {
  assertParserKit(kit);
  const preserveTrivia = options.preserveTrivia ??
    kit.lexer.defaultPreserveTrivia;
  const runtime = runtimeTables(kit);
  const tokens: KitToken[] = [];
  const diagnostics: KitLexDiagnostic[] = [];
  let offset = 0;

  while (offset < source.length) {
    const candidate = bestCandidate(runtime, source, offset);
    if (candidate) {
      const start = offset;
      const end = candidate.end;
      const specRef = kit.lexer.specs[candidate.specIndex];
      if (specRef?.type === "literal") {
        const spec = runtime.literalById.get(specRef.literalId);
        if (spec) {
          tokens.push({
            type: "literal",
            literal: spec.value,
            text: spec.value,
            span: { start, end },
            channel: "main",
          });
        }
      } else if (specRef?.type === "named") {
        const spec = runtime.namedById.get(specRef.tokenId);
        if (spec?.channel === "trivia") {
          if (preserveTrivia) {
            tokens.push(namedToken(spec.name, source, start, end, "trivia"));
          }
        } else if (spec?.channel === "main") {
          tokens.push(namedToken(spec.name, source, start, end, "main"));
        }
      }
      offset = end;
      continue;
    }

    const start = offset;
    const codePoint = source.codePointAt(offset);
    offset += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    const text = source.slice(start, offset);
    tokens.push({
      type: "error",
      text,
      span: { start, end: offset },
      channel: "error",
    });
    diagnostics.push({
      code: "LEX_UNEXPECTED_CHARACTER",
      message: `Unexpected character ${JSON.stringify(text)}.`,
      span: { start, end: offset },
    });
  }

  tokens.push(eofToken(source.length));
  return { source, tokens, diagnostics };
}

function lexForParseWithKit(
  kit: ParserKit,
  source: string,
  options: KitLexOptions = {},
): KitLexResult & { sites: readonly ParseLexCandidateSite[] } {
  assertParserKit(kit);
  const preserveTrivia = options.preserveTrivia ??
    kit.lexer.defaultPreserveTrivia;
  const tokens: KitToken[] = [];
  const diagnostics: KitLexDiagnostic[] = [];
  const sites: ParseLexCandidateSite[] = [];
  const runtime = runtimeTables(kit);
  let offset = 0;

  while (offset < source.length) {
    const scanned = scanAcceptCandidates(runtime, source, offset);
    if (!scanned) {
      const start = offset;
      const codePoint = source.codePointAt(offset);
      offset += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
      const text = source.slice(start, offset);
      tokens.push({
        type: "error",
        text,
        span: { start, end: offset },
        channel: "error",
      });
      diagnostics.push({
        code: "LEX_UNEXPECTED_CHARACTER",
        message: `Unexpected character ${JSON.stringify(text)}.`,
        span: { start, end: offset },
      });
      continue;
    }

    const candidates = scanned.candidates.map((specIndex) =>
      materializeSpecCandidate(
        runtime,
        source,
        specIndex,
        offset,
        scanned.end,
      )
    );
    const trivia = candidates.find((candidate) =>
      candidate.token.channel === "trivia"
    );
    const mainCandidates = candidates.filter((candidate) =>
      candidate.token.channel !== "trivia" && candidate.terminal >= 0
    );
    if (trivia && mainCandidates.length === 0) {
      if (preserveTrivia) tokens.push(trivia.token);
      offset = scanned.end;
      continue;
    }
    if (mainCandidates.length === 0) {
      const text = source.slice(offset, scanned.end);
      tokens.push({
        type: "error",
        text,
        span: { start: offset, end: scanned.end },
        channel: "error",
      });
      diagnostics.push({
        code: "LEX_UNEXPECTED_CHARACTER",
        message: `Unexpected character ${JSON.stringify(text)}.`,
        span: { start: offset, end: scanned.end },
      });
      offset = scanned.end;
      continue;
    }
    const tokenIndex = tokens.length;
    tokens.push(mainCandidates[0].token);
    sites.push({ tokenIndex, candidates: mainCandidates });
    offset = scanned.end;
  }

  const eof = eofToken(source.length);
  const eofIndex = tokens.length;
  tokens.push(eof);
  sites.push({
    tokenIndex: eofIndex,
    candidates: [{ token: eof, terminal: kit.bnf.eofTerminal }],
  });
  return { source, tokens, diagnostics, sites };
}

export function parseWithKit(
  kit: ParserKit,
  source: string,
  options: KitParseOptions = {},
): KitParseResult {
  const lexed = lexForParseWithKit(kit, source, options);
  return parseTokenList(
    kit,
    source,
    lexed.tokens,
    lexicalDiagnostics(lexed.diagnostics),
    lexed.sites,
    options.contextualLexingStats,
    options,
  ) as KitParseResult;
}

export function validateWithKit(
  kit: ParserKit,
  source: string,
  options: KitParseOptions = {},
): KitValidateParseResult {
  const lexed = lexForParseWithKit(kit, source, options);
  return validateResult(
    parseTokenList(
      kit,
      source,
      lexed.tokens,
      lexicalDiagnostics(lexed.diagnostics),
      lexed.sites,
      options.contextualLexingStats,
      { ...options, mode: "validate" },
    ),
  );
}

export function parseEventsWithKit(
  kit: ParserKit,
  source: string,
  options: KitParseOptions = {},
): KitParseEventResult {
  const lexed = lexForParseWithKit(kit, source, options);
  return eventResult(
    parseTokenList(
      kit,
      source,
      lexed.tokens,
      lexicalDiagnostics(lexed.diagnostics),
      lexed.sites,
      options.contextualLexingStats,
      { ...options, mode: "events" },
    ),
  );
}

export function parseLazyWithKit(
  kit: ParserKit,
  source: string,
  options: KitParseOptions = {},
): KitParseResult {
  const lexed = lexForParseWithKit(kit, source, options);
  return lazyResultFromEvents(
    kit,
    source,
    lexed.tokens,
    parseTokenList(
      kit,
      source,
      lexed.tokens,
      lexicalDiagnostics(lexed.diagnostics),
      lexed.sites,
      options.contextualLexingStats,
      { ...options, mode: "events" },
    ),
  );
}

export function parseTokensWithKit(
  kit: ParserKit,
  source: string,
  tokens: readonly KitToken[],
): KitParseResult {
  assertParserKit(kit);
  const streamDiagnostics = validateTokenStream(kit, source, tokens);
  const tokenDiagnostics = lexicalTokenDiagnostics(kit, tokens);
  return parseTokenList(
    kit,
    source,
    tokens,
    combineDiagnostics(streamDiagnostics, tokenDiagnostics),
  ) as KitParseResult;
}

export function validateTokensWithKit(
  kit: ParserKit,
  source: string,
  tokens: readonly KitToken[],
): KitValidateParseResult {
  assertParserKit(kit);
  const streamDiagnostics = validateTokenStream(kit, source, tokens);
  const tokenDiagnostics = lexicalTokenDiagnostics(kit, tokens);
  return validateResult(
    parseTokenList(
      kit,
      source,
      tokens,
      combineDiagnostics(streamDiagnostics, tokenDiagnostics),
      [],
      undefined,
      { mode: "validate" },
    ),
  );
}

export function parseTokenEventsWithKit(
  kit: ParserKit,
  source: string,
  tokens: readonly KitToken[],
): KitParseEventResult {
  assertParserKit(kit);
  const streamDiagnostics = validateTokenStream(kit, source, tokens);
  const tokenDiagnostics = lexicalTokenDiagnostics(kit, tokens);
  return eventResult(
    parseTokenList(
      kit,
      source,
      tokens,
      combineDiagnostics(streamDiagnostics, tokenDiagnostics),
      [],
      undefined,
      { mode: "events" },
    ),
  );
}

export function parseTokensLazyWithKit(
  kit: ParserKit,
  source: string,
  tokens: readonly KitToken[],
): KitParseResult {
  assertParserKit(kit);
  const streamDiagnostics = validateTokenStream(kit, source, tokens);
  const tokenDiagnostics = lexicalTokenDiagnostics(kit, tokens);
  return lazyResultFromEvents(
    kit,
    source,
    tokens,
    parseTokenList(
      kit,
      source,
      tokens,
      combineDiagnostics(streamDiagnostics, tokenDiagnostics),
      [],
      undefined,
      { mode: "events" },
    ),
  );
}

export function parseTokensUncheckedWithKit(
  kit: ParserKit,
  source: string,
  tokens: readonly KitToken[],
): KitParseResult {
  assertParserKit(kit);
  return parseTokenList(
    kit,
    source,
    tokens,
    lexicalTokenDiagnostics(kit, tokens),
  ) as KitParseResult;
}

export function validateTokensUncheckedWithKit(
  kit: ParserKit,
  source: string,
  tokens: readonly KitToken[],
): KitValidateParseResult {
  assertParserKit(kit);
  return validateResult(
    parseTokenList(
      kit,
      source,
      tokens,
      lexicalTokenDiagnostics(kit, tokens),
      [],
      undefined,
      { mode: "validate" },
    ),
  );
}

export function parseTokenEventsUncheckedWithKit(
  kit: ParserKit,
  source: string,
  tokens: readonly KitToken[],
): KitParseEventResult {
  assertParserKit(kit);
  return eventResult(
    parseTokenList(
      kit,
      source,
      tokens,
      lexicalTokenDiagnostics(kit, tokens),
      [],
      undefined,
      { mode: "events" },
    ),
  );
}

export function parseTokensLazyUncheckedWithKit(
  kit: ParserKit,
  source: string,
  tokens: readonly KitToken[],
): KitParseResult {
  assertParserKit(kit);
  return lazyResultFromEvents(
    kit,
    source,
    tokens,
    parseTokenList(
      kit,
      source,
      tokens,
      lexicalTokenDiagnostics(kit, tokens),
      [],
      undefined,
      { mode: "events" },
    ),
  );
}

function validateResult(result: InternalParseResult): KitValidateParseResult {
  return result.ok
    ? {
      ok: true,
      source: result.source,
      diagnostics: [],
    }
    : {
      ok: false,
      source: result.source,
      diagnostics: result.diagnostics,
    };
}

function eventResult(result: InternalParseResult): KitParseEventResult {
  return result.ok
    ? {
      ok: true,
      source: result.source,
      events: "events" in result ? result.events : [],
      diagnostics: [],
    }
    : {
      ok: false,
      source: result.source,
      events: [],
      diagnostics: result.diagnostics,
    };
}

function parseTokenList(
  kit: ParserKit,
  source: string,
  tokens: readonly KitToken[],
  lexicalDiagnostics: readonly KitParseDiagnostic[],
  candidateSites: readonly ParseLexCandidateSite[] = [],
  contextualLexingStats?: (stats: KitContextualLexingStats) => void,
  options: KitParseOptions & { mode?: KitParseExecutionMode } = {},
): InternalParseResult {
  const mode = options.mode ?? "cst";
  if (lexicalDiagnostics.length > 0) {
    if (mode === "validate") {
      return { ok: false, source, diagnostics: lexicalDiagnostics };
    }
    if (mode === "events") {
      return { ok: false, source, events: [], diagnostics: lexicalDiagnostics };
    }
    return {
      ok: false,
      root: null,
      source,
      tokens,
      diagnostics: lexicalDiagnostics,
    };
  }

  const pending: ParseBranch[] = [{
    states: [0],
    values: mode === "validate" ? [] : [null],
    index: 0,
    tokenOverrides: new Map(),
  }];
  let bestFailure: ParseFailure | null = null;
  let firstSuccess: InternalParseResult | null = null;
  let exploredBranches = 0;
  let traceActions = 0;
  const maxExploredBranches = optionsLimit(
    options.maxExploredBranches,
    MAX_PARSE_BRANCHES,
  );
  const maxTraceActions = optionsLimit(
    options.maxTraceActions,
    1_000_000,
  );
  const ambiguityMode = options.ambiguityMode ?? "first-success";
  const runtime = runtimeTables(kit);
  const sitesByToken = new Map(
    candidateSites.map((site) => [site.tokenIndex, site.candidates]),
  );
  const stats: ContextualStatsState = {
    ambiguousLexicalSites:
      candidateSites.filter((site) => site.candidates.length > 1).length,
    contextualCandidateChecks: 0,
    attemptedTokenSelections: 0,
    reductionsBeforeTokenSelection: 0,
  };
  if (
    !runtime.hasBranchingActions && stats.ambiguousLexicalSites === 0 &&
    ambiguityMode === "first-success"
  ) {
    const result = parseDeterministicTokenList(
      kit,
      runtime,
      source,
      tokens,
      sitesByToken,
      stats,
      maxTraceActions,
      mode,
    );
    emitContextualStats(contextualLexingStats, stats);
    return result;
  }

  while (pending.length > 0) {
    const branch = pending.pop()!;
    exploredBranches++;
    if (exploredBranches > maxExploredBranches + 1) {
      if (bestFailure !== null) {
        emitContextualStats(contextualLexingStats, stats);
        return failedParseResult(mode, source, tokens, [
          bestFailure.diagnostic,
        ]);
      }
      return failedParseResult(
        mode,
        source,
        tokens,
        [
          kitParseDiagnostic(
            "PARSER_BRANCH_LIMIT",
            "Parser exceeded the branch exploration limit.",
            { start: source.length, end: source.length },
          ),
        ],
      );
    }

    while (true) {
      const advanced = advanceBranch(
        kit,
        runtime,
        source,
        tokens,
        branch,
        pending,
        sitesByToken,
        stats,
        maxExploredBranches,
        () => ++traceActions,
        mode,
      );
      if (traceActions > maxTraceActions) {
        const diagnostic = kitParseDiagnostic(
          "PARSER_TRACE_LIMIT",
          "Parser exceeded the trace action limit.",
          { start: source.length, end: source.length },
        );
        emitContextualStats(contextualLexingStats, stats);
        return failedParseResult(mode, source, tokens, [diagnostic]);
      }
      if (advanced.kind === "continue") continue;
      if (advanced.kind === "forked") break;
      if (advanced.kind === "success") {
        if (ambiguityMode === "reject-ambiguous-success") {
          if (firstSuccess) {
            emitContextualStats(contextualLexingStats, stats);
            return failedParseResult(
              mode,
              source,
              tokens,
              [
                kitParseDiagnostic(
                  "PARSER_AMBIGUOUS_PARSE",
                  "Parser found multiple successful conflict branches.",
                  { start: source.length, end: source.length },
                ),
              ],
            );
          }
          firstSuccess = advanced.result;
          break;
        }
        emitContextualStats(contextualLexingStats, stats);
        return advanced.result;
      }
      bestFailure = betterFailure(bestFailure, advanced.failure);
      break;
    }
  }

  emitContextualStats(contextualLexingStats, stats);
  if (firstSuccess) return firstSuccess;
  return failedParseResult(
    mode,
    source,
    tokens,
    [
      bestFailure?.diagnostic ??
        kitParseDiagnostic(
          "PARSER_INTERNAL_ERROR",
          "Parser exhausted all branches without a diagnostic.",
          { start: source.length, end: source.length },
        ),
    ],
  );
}

function parseDeterministicTokenList(
  kit: ParserKit,
  runtime: RuntimeTables,
  source: string,
  tokens: readonly KitToken[],
  candidateSites: ReadonlyMap<number, readonly ParseLexCandidate[]>,
  stats: ContextualStatsState,
  maxTraceActions: number,
  mode: KitParseExecutionMode,
): InternalParseResult {
  const branch: ParseBranch = {
    states: [0],
    values: mode === "validate" ? [] : [null],
    index: 0,
    tokenOverrides: new Map(),
  };
  let traceActions = 0;
  while (true) {
    const advanced = advanceBranch(
      kit,
      runtime,
      source,
      tokens,
      branch,
      [],
      candidateSites,
      stats,
      0,
      () => ++traceActions,
      mode,
    );
    if (traceActions > maxTraceActions) {
      return failedParseResult(
        mode,
        source,
        tokens,
        [
          kitParseDiagnostic(
            "PARSER_TRACE_LIMIT",
            "Parser exceeded the trace action limit.",
            { start: source.length, end: source.length },
          ),
        ],
      );
    }
    if (advanced.kind === "continue") continue;
    if (advanced.kind === "success") return advanced.result;
    if (advanced.kind === "failure") {
      return failedParseResult(mode, source, tokens, [
        advanced.failure.diagnostic,
      ]);
    }
    return failedParseResult(
      mode,
      source,
      tokens,
      [
        kitParseDiagnostic(
          "PARSER_INTERNAL_ERROR",
          "Deterministic parser unexpectedly forked.",
          { start: source.length, end: source.length },
        ),
      ],
    );
  }
}

function failedParseResult(
  mode: KitParseExecutionMode,
  source: string,
  tokens: readonly KitToken[],
  diagnostics: readonly KitParseDiagnostic[],
): InternalParseResult {
  if (mode === "validate") return { ok: false, source, diagnostics };
  if (mode === "events") {
    return { ok: false, source, events: [], diagnostics };
  }
  return { ok: false, root: null, source, tokens, diagnostics };
}

function advanceBranch(
  kit: ParserKit,
  runtime: RuntimeTables,
  source: string,
  tokens: readonly KitToken[],
  branch: ParseBranch,
  pending: ParseBranch[],
  candidateSites: ReadonlyMap<number, readonly ParseLexCandidate[]>,
  stats: ContextualStatsState,
  maxExploredBranches: number,
  nextTraceAction: () => number,
  mode: KitParseExecutionMode,
): BranchAdvanceResult {
  branch.index = skipTrivia(tokens, branch.index);
  const token = tokens[branch.index] ?? eofToken(source.length);
  const state = branch.states[branch.states.length - 1];
  const choices: { token: KitToken; action: ParserKitLrAction }[] = [];
  const candidates = candidateSites.get(branch.index) ?? [{
    token,
    terminal: tokenToTerminalFromMaps(runtime, token),
  }];
  if (candidates.length > 1) {
    stats.attemptedTokenSelections += candidates.length;
  }
  for (const candidate of candidates) {
    stats.contextualCandidateChecks++;
    if (candidate.terminal < 0) continue;
    for (const action of findActions(runtime, state, candidate.terminal)) {
      choices.push({ token: candidate.token, action });
    }
  }

  if (choices.length === 0) {
    return {
      kind: "failure",
      failure: {
        offset: token.span.start,
        diagnostic: unexpectedTokenDiagnostic(runtime, token, state),
      },
    };
  }

  if (choices.length > 1) {
    if (choices.length > maxExploredBranches) {
      return {
        kind: "failure",
        failure: {
          offset: token.span.start,
          diagnostic: kitParseDiagnostic(
            "PARSER_BRANCH_LIMIT",
            "Parser exceeded the branch exploration limit.",
            token.span,
          ),
        },
      };
    }
    for (let index = choices.length - 1; index >= 0; index--) {
      const fork = cloneBranch(branch);
      const choice = choices[index];
      const advanced = applyAction(
        kit,
        runtime,
        source,
        tokens,
        fork,
        choice.token,
        choice.action,
        candidateSites,
        stats,
        nextTraceAction,
        mode,
      );
      if (advanced.kind === "success" || advanced.kind === "failure") {
        return advanced;
      }
      pending.push(fork);
    }
    return { kind: "forked" };
  }

  return applyAction(
    kit,
    runtime,
    source,
    tokens,
    branch,
    choices[0].token,
    choices[0].action,
    candidateSites,
    stats,
    nextTraceAction,
    mode,
  );
}

function applyAction(
  kit: ParserKit,
  runtime: RuntimeTables,
  source: string,
  tokens: readonly KitToken[],
  branch: ParseBranch,
  token: KitToken,
  action: ParserKitLrAction,
  candidateSites: ReadonlyMap<number, readonly ParseLexCandidate[]>,
  stats: ContextualStatsState,
  nextTraceAction: () => number,
  mode: KitParseExecutionMode,
): BranchAdvanceResult {
  nextTraceAction();
  if (action.kind === "shift") {
    branch.states.push(action.state);
    if (mode !== "validate") {
      branch.values.push(
        mode === "events"
          ? eventTokenFragment(runtime, token, branch.index)
          : shiftedToken(token, branch.index),
      );
    }
    if (token !== tokens[branch.index]) {
      branch.tokenOverrides.set(branch.index, token);
    }
    branch.index++;
    return { kind: "continue" };
  }

  if (action.kind === "accept") {
    return {
      kind: "success",
      result: mode === "validate"
        ? { ok: true, source, diagnostics: [] }
        : mode === "events"
        ? acceptedEventResult(source, branch.values.at(-1))
        : acceptedParseResult(
          source,
          tokens,
          branch.values.at(-1),
          branch.tokenOverrides,
        ),
    };
  }
  if ((candidateSites.get(branch.index)?.length ?? 0) > 1) {
    stats.reductionsBeforeTokenSelection++;
  }

  const production = kit.bnf.productions[action.production];
  const rhsValues = mode === "validate"
    ? []
    : production.rhs.length === 0
    ? []
    : branch.values.splice(
      branch.values.length - production.rhs.length,
      production.rhs.length,
    );
  branch.states.splice(
    branch.states.length - production.rhs.length,
    production.rhs.length,
  );
  let reduced: unknown;
  try {
    reduced = mode === "validate"
      ? null
      : mode === "events"
      ? reduceEventProduction(
        runtime,
        production.reducer,
        rhsValues,
        token.span.start,
        branch.index,
      )
      : reduceProduction(
        kit,
        runtime,
        production.reducer,
        rhsValues,
        token.span.start,
        branch.index,
      );
  } catch (error) {
    return {
      kind: "failure",
      failure: {
        offset: token.span.start,
        diagnostic: internalParserDiagnostic(error, token.span),
      },
    };
  }
  const gotoState = findGoto(
    runtime,
    branch.states[branch.states.length - 1],
    production.lhs,
  );
  if (gotoState === undefined) {
    return {
      kind: "failure",
      failure: {
        offset: token.span.start,
        diagnostic: kitParseDiagnostic(
          "PARSER_INTERNAL_ERROR",
          "Parser table is missing a goto entry.",
          token.span,
        ),
      },
    };
  }
  branch.states.push(gotoState);
  if (mode !== "validate") branch.values.push(reduced);
  return { kind: "continue" };
}

function emitContextualStats(
  callback: ((stats: KitContextualLexingStats) => void) | undefined,
  stats: KitContextualLexingStats,
): void {
  if (!callback || stats.ambiguousLexicalSites === 0) return;
  callback({ ...stats });
}

function reduceProduction(
  kit: ParserKit,
  runtime: RuntimeTables,
  reducer: ParserKitReducerSpec,
  rhs: readonly unknown[],
  offset: number,
  tokenIndex: number,
): unknown {
  switch (reducer.kind) {
    case "start":
      return rhs[0];
    case "rule": {
      const fragment = toFragment(rhs[0]);
      const node = {
        type: "rule",
        name: runtime.ruleNames[reducer.ruleId],
        span: fragment.span ?? spanFromChildren(fragment.children) ??
          { start: 0, end: 0 },
        tokenRange: fragment.tokenRange ??
          tokenRangeFromChildren(fragment.children) ??
          { start: tokenIndex, end: tokenIndex },
        children: fragment.children,
        fields: buildFields(runtime, reducer.ruleId, fragment.fields),
      };
      return node as KitRuleNode;
    }
    case "terminal":
      return tokenFragment(rhs[0] as ShiftedToken);
    case "ruleRef":
      return ruleFragment(rhs[0] as KitRuleNode);
    case "identity":
    case "optionalSome":
      return toFragment(rhs[0]);
    case "sequence":
      return sequenceFragment(rhs, offset, tokenIndex);
    case "optionalEmpty":
      return emptyFragment(null, offset, tokenIndex);
    case "repeatEmpty":
      return emptyFragment([], offset, tokenIndex);
    case "repeatAppend":
    case "repeat1Append":
      return appendFragment(toFragment(rhs[0]), toFragment(rhs[1]));
    case "repeat1First": {
      const item = toFragment(rhs[0]);
      item.value = [item.value];
      return item;
    }
    case "separatedFirst": {
      const item = toFragment(rhs[0]);
      item.value = [item.value];
      return item;
    }
    case "separatedAppend":
      return appendSeparatedFragment(
        toFragment(rhs[0]),
        toFragment(rhs[1]),
        toFragment(rhs[2]),
      );
    case "field": {
      const fragment = toFragment(rhs[0]);
      return {
        value: fragment.value,
        children: fragment.children,
        fields: [{ name: reducer.name, value: fragment.value }],
        span: fragment.span,
        tokenRange: fragment.tokenRange,
      };
    }
  }
  void kit;
}

function reduceEventProduction(
  runtime: RuntimeTables,
  reducer: ParserKitReducerSpec,
  rhs: readonly unknown[],
  offset: number,
  tokenIndex: number,
): EventFragment {
  switch (reducer.kind) {
    case "start":
      return toEventFragment(rhs[0]);
    case "rule": {
      const fragment = toEventFragment(rhs[0]);
      const span = fragment.span ?? { start: offset, end: offset };
      const tokenRange = fragment.tokenRange ?? {
        start: tokenIndex,
        end: tokenIndex,
      };
      return {
        events: [
          { kind: "enter", ruleId: reducer.ruleId, start: span.start },
          ...fragment.events,
          { kind: "exit", ruleId: reducer.ruleId, end: span.end },
        ],
        span,
        tokenRange,
      };
    }
    case "terminal":
      return toEventFragment(rhs[0]);
    case "ruleRef":
    case "identity":
    case "optionalSome":
      return toEventFragment(rhs[0]);
    case "sequence":
      return sequenceEventFragment(rhs, offset, tokenIndex);
    case "optionalEmpty":
    case "repeatEmpty":
      return emptyEventFragment(offset, tokenIndex);
    case "repeatAppend":
    case "repeat1Append":
      return appendEventFragment(
        toEventFragment(rhs[0]),
        toEventFragment(rhs[1]),
      );
    case "repeat1First":
    case "separatedFirst":
      return toEventFragment(rhs[0]);
    case "separatedAppend":
      return appendEventFragment(
        appendEventFragment(toEventFragment(rhs[0]), toEventFragment(rhs[1])),
        toEventFragment(rhs[2]),
      );
    case "field": {
      const fragment = toEventFragment(rhs[0]);
      return {
        events: [
          { kind: "field", fieldId: runtime.fieldIds.get(reducer.name) ?? -1 },
          ...fragment.events,
        ],
        span: fragment.span,
        tokenRange: fragment.tokenRange,
      };
    }
  }
}

function eventTokenFragment(
  runtime: RuntimeTables,
  token: KitToken,
  tokenIndex: number,
): EventFragment {
  const terminalId = tokenToTerminalFromMaps(runtime, token);
  return {
    events: isMainSyntaxToken(token)
      ? [{
        kind: "token",
        tokenId: syntaxTokenId(runtime, token),
        terminalId,
        start: token.span.start,
        end: token.span.end,
      }]
      : [],
    span: token.span,
    tokenRange: { start: tokenIndex, end: tokenIndex + 1 },
  };
}

function sequenceEventFragment(
  values: readonly unknown[],
  offset: number,
  tokenIndex: number,
): EventFragment {
  let combined = emptyEventFragment(offset, tokenIndex);
  for (const value of values) {
    combined = appendEventFragment(combined, toEventFragment(value));
  }
  return combined;
}

function emptyEventFragment(offset: number, tokenIndex: number): EventFragment {
  return {
    events: [],
    span: { start: offset, end: offset },
    tokenRange: { start: tokenIndex, end: tokenIndex },
  };
}

function appendEventFragment(
  left: EventFragment,
  right: EventFragment,
): EventFragment {
  return {
    events: [...left.events, ...right.events],
    span: combineSpans(left.span, right.span),
    tokenRange: combineTokenRanges(left.tokenRange, right.tokenRange),
  };
}

function toEventFragment(value: unknown): EventFragment {
  if (isEventFragment(value)) return value;
  throw new Error("Expected parser reduction event fragment.");
}

function isEventFragment(value: unknown): value is EventFragment {
  return Boolean(
    value && typeof value === "object" && "events" in value &&
      Array.isArray((value as { events?: unknown }).events),
  );
}

function syntaxTokenId(runtime: RuntimeTables, token: KitToken): number {
  if (token.type === "named") {
    return runtime.namedTokenIds.get(token.kind) ?? -1;
  }
  if (token.type === "literal") {
    return runtime.literalIds.get(token.literal) ?? -1;
  }
  return -1;
}

function tokenFragment(shifted: ShiftedToken): Fragment {
  const token = shifted.token;
  if (!isMainSyntaxToken(token)) {
    throw new Error("Expected shifted main syntax token.");
  }
  return {
    value: token,
    children: [token],
    fields: [],
    span: token.span,
    tokenRange: { start: shifted.tokenIndex, end: shifted.tokenIndex + 1 },
  };
}

function ruleFragment(node: KitRuleNode): Fragment {
  return {
    value: node,
    children: [node],
    fields: [],
    span: node.span,
    tokenRange: node.tokenRange,
  };
}

function sequenceFragment(
  values: readonly unknown[],
  offset: number,
  tokenIndex: number,
): Fragment {
  const fragmentValues: unknown[] = [];
  const children: KitSyntaxElement[] = [];
  const fields: FieldCapture[] = [];
  let span: KitSpan | null = null;
  let tokenRange: TokenRange | null = null;
  for (const value of values) {
    const part = toFragment(value);
    fragmentValues.push(part.value);
    appendAll(children, part.children);
    appendAll(fields, part.fields);
    span = combineSpans(span, part.span);
    tokenRange = combineTokenRanges(tokenRange, part.tokenRange);
  }
  return {
    value: fragmentValues,
    children,
    fields,
    span: span ?? { start: offset, end: offset },
    tokenRange: tokenRange ?? { start: tokenIndex, end: tokenIndex },
  };
}

function emptyFragment(
  value: unknown,
  offset: number,
  tokenIndex: number,
): Fragment {
  return {
    value,
    children: [],
    fields: [],
    span: { start: offset, end: offset },
    tokenRange: { start: tokenIndex, end: tokenIndex },
  };
}

function appendFragment(list: Fragment, item: Fragment): Fragment {
  const values = asMutableArray(list.value);
  values.push(item.value);
  appendAll(list.children, item.children);
  appendAll(list.fields, item.fields);
  return {
    value: values,
    children: list.children,
    fields: list.fields,
    span: combineSpans(list.span, item.span),
    tokenRange: combineTokenRanges(list.tokenRange, item.tokenRange),
  };
}

function appendSeparatedFragment(
  list: Fragment,
  separator: Fragment,
  item: Fragment,
): Fragment {
  const values = asMutableArray(list.value);
  values.push(item.value);
  appendAll(list.children, separator.children);
  appendAll(list.children, item.children);
  appendAll(list.fields, separator.fields);
  appendAll(list.fields, item.fields);
  return {
    value: values,
    children: list.children,
    fields: list.fields,
    span: combineSpans(combineSpans(list.span, separator.span), item.span),
    tokenRange: combineTokenRanges(
      combineTokenRanges(list.tokenRange, separator.tokenRange),
      item.tokenRange,
    ),
  };
}

function toFragment(value: unknown): Fragment {
  if (isFragment(value)) return value;
  if (isRuleNode(value)) return ruleFragment(value);
  if (isShiftedToken(value)) return tokenFragment(value);
  throw new Error("Expected parser reduction fragment, rule node, or token.");
}

function buildFields(
  runtime: RuntimeTables,
  ruleId: number,
  captures: readonly FieldCapture[],
): Record<string, unknown> {
  const schema = runtime.fieldSchemas[ruleId];
  if (!schema || schema.entries.length === 0) {
    if (captures.length > 0) {
      throw new Error("Rule has field captures but no field schema.");
    }
    return Object.create(null) as Record<string, unknown>;
  }
  const fields = Object.create(null) as Record<string, unknown>;
  const counts = Object.create(null) as Record<string, number>;
  for (const [name, config] of schema.entries) {
    fields[name] = config.array ? [] : config.nullable ? null : undefined;
    counts[name] = 0;
  }
  for (const capture of captures) {
    const config = schema.byName[capture.name];
    if (!config) throw new Error(`Unknown field capture '${capture.name}'.`);
    counts[capture.name] = (counts[capture.name] ?? 0) + 1;
    if (config.array) {
      const values = fields[capture.name];
      if (!Array.isArray(values)) {
        throw new Error(
          `Array field '${capture.name}' was not initialized as an array.`,
        );
      }
      values.push(capture.value);
    } else {
      if ((counts[capture.name] ?? 0) > 1) {
        throw new Error(
          `Scalar field '${capture.name}' was captured more than once.`,
        );
      }
      fields[capture.name] = capture.value;
    }
  }
  for (const [name, config] of schema.entries) {
    const count = counts[name] ?? 0;
    if (config.array) {
      if (!Array.isArray(fields[name])) {
        throw new Error(
          `Array field '${name}' was not initialized as an array.`,
        );
      }
      continue;
    }
    if (!config.nullable && count !== 1) {
      throw new Error(`Required field '${name}' was captured ${count} times.`);
    }
    if (config.nullable && count > 1) {
      throw new Error(`Nullable field '${name}' was captured more than once.`);
    }
  }
  return fields;
}

function acceptedParseResult(
  source: string,
  tokens: readonly KitToken[],
  accepted: unknown,
  tokenOverrides: ReadonlyMap<number, KitToken> = new Map(),
): KitParseResult {
  const resultTokens = tokenOverrides.size === 0
    ? tokens
    : tokens.map((token, index) => tokenOverrides.get(index) ?? token);
  const root = isRuleNode(accepted)
    ? accepted
    : isFragment(accepted) && isRuleNode(accepted.value)
    ? accepted.value
    : null;
  if (root) {
    return {
      ok: true,
      root,
      source,
      tokens: resultTokens,
      diagnostics: [],
    };
  }
  return {
    ok: false,
    root: null,
    source,
    tokens: resultTokens,
    diagnostics: [
      kitParseDiagnostic(
        "PARSER_INTERNAL_ERROR",
        "Parser accepted without producing a root node.",
        { start: source.length, end: source.length },
      ),
    ],
  };
}

function acceptedEventResult(
  source: string,
  accepted: unknown,
): KitParseEventResult {
  if (isEventFragment(accepted)) {
    return {
      ok: true,
      source,
      events: accepted.events,
      diagnostics: [],
    };
  }
  return {
    ok: false,
    source,
    events: [],
    diagnostics: [
      kitParseDiagnostic(
        "PARSER_INTERNAL_ERROR",
        "Parser accepted without producing an event stream.",
        { start: source.length, end: source.length },
      ),
    ],
  };
}

interface LazyRuleDraft {
  ruleId: number;
  start: number;
  end: number;
  tokenRange: TokenRange | null;
  children: KitSyntaxElement[];
  fields: FieldCapture[];
  captureNames: string[];
}

function lazyResultFromEvents(
  kit: ParserKit,
  source: string,
  tokens: readonly KitToken[],
  result: InternalParseResult,
): KitParseResult {
  if (!result.ok) {
    return {
      ok: false,
      root: null,
      source,
      tokens,
      diagnostics: result.diagnostics,
    };
  }
  if (!("events" in result)) {
    return acceptedParseResult(source, tokens, null);
  }
  try {
    const root = lazyRootFromEvents(runtimeTables(kit), tokens, result.events);
    return root
      ? { ok: true, root, source, tokens, diagnostics: [] }
      : acceptedParseResult(source, tokens, null);
  } catch (error) {
    return {
      ok: false,
      root: null,
      source,
      tokens,
      diagnostics: [
        internalParserDiagnostic(error, {
          start: source.length,
          end: source.length,
        }),
      ],
    };
  }
}

function lazyRootFromEvents(
  runtime: RuntimeTables,
  tokens: readonly KitToken[],
  events: readonly KitParseEvent[],
): KitRuleNode | null {
  const stack: LazyRuleDraft[] = [];
  const pendingFields: string[] = [];
  let root: KitRuleNode | null = null;
  let tokenCursor = 0;
  for (const event of events) {
    switch (event.kind) {
      case "field":
        pendingFields.push(
          runtime.fieldNames[event.fieldId] ?? `#${event.fieldId}`,
        );
        break;
      case "enter":
        stack.push({
          ruleId: event.ruleId,
          start: event.start,
          end: event.start,
          tokenRange: null,
          children: [],
          fields: [],
          captureNames: pendingFields.splice(0),
        });
        break;
      case "token": {
        const tokenMatch = findEventToken(tokens, tokenCursor, event);
        tokenCursor = tokenMatch.index + 1;
        attachLazyElement(
          stack,
          tokenMatch.token,
          { start: tokenMatch.index, end: tokenMatch.index + 1 },
          pendingFields.splice(0),
        );
        break;
      }
      case "exit": {
        const draft = stack.pop();
        if (!draft || draft.ruleId !== event.ruleId) {
          throw new Error("Parse event stream has unbalanced rule events.");
        }
        draft.end = event.end;
        const node = createLazyRuleNode(runtime, draft);
        if (stack.length === 0) {
          root = node;
        } else {
          attachLazyElement(
            stack,
            node,
            node.tokenRange,
            draft.captureNames,
          );
        }
        break;
      }
    }
  }
  if (stack.length > 0) {
    throw new Error("Parse event stream ended before all rules exited.");
  }
  return root;
}

function attachLazyElement(
  stack: LazyRuleDraft[],
  element: KitSyntaxElement,
  tokenRange: TokenRange,
  captureNames: readonly string[],
): void {
  const parent = stack[stack.length - 1];
  if (!parent) {
    throw new Error("Parse event stream emitted syntax outside a rule.");
  }
  parent.children.push(element);
  parent.tokenRange = combineTokenRanges(parent.tokenRange, tokenRange);
  for (const name of captureNames) {
    parent.fields.push({ name, value: element });
  }
}

function createLazyRuleNode(
  runtime: RuntimeTables,
  draft: LazyRuleDraft,
): KitRuleNode {
  let childrenCache: readonly KitSyntaxElement[] | undefined;
  let fieldsCache: Record<string, unknown> | undefined;
  const node = {
    type: "rule",
    name: runtime.ruleNames[draft.ruleId],
    span: { start: draft.start, end: draft.end },
    tokenRange: draft.tokenRange ?? { start: 0, end: 0 },
  } as KitRuleNode;
  Object.defineProperties(node, {
    children: {
      enumerable: true,
      get() {
        childrenCache ??= draft.children;
        return childrenCache;
      },
    },
    fields: {
      enumerable: true,
      get() {
        fieldsCache ??= buildFields(runtime, draft.ruleId, draft.fields);
        return fieldsCache;
      },
    },
  });
  return node;
}

function findEventToken(
  tokens: readonly KitToken[],
  startIndex: number,
  event: Extract<KitParseEvent, { kind: "token" }>,
): { token: KitMainNamedToken | KitLiteralToken; index: number } {
  for (let index = startIndex; index < tokens.length; index++) {
    const token = tokens[index];
    if (!isMainSyntaxToken(token)) continue;
    if (token.span.start === event.start && token.span.end === event.end) {
      return { token, index };
    }
  }
  throw new Error("Parse event stream referenced an unknown token.");
}

interface RuntimeTables {
  kit: ParserKit;
  eofTerminal: number;
  dfaRows: readonly RuntimeDfaRow[];
  dfaRowKindCounts: RuntimeDfaRowKindCounts;
  actions: ReadonlyMap<string, readonly ParserKitLrAction[]>;
  gotos: ReadonlyMap<string, number>;
  expected: readonly (readonly string[])[];
  hasBranchingActions: boolean;
  namedTerminals: ReadonlyMap<string, number>;
  literalTerminals: ReadonlyMap<string, number>;
  namedById: ReadonlyMap<number, ParserKitNamedTokenSpec>;
  literalById: ReadonlyMap<number, ParserKitLiteralSpec>;
  terminalByNamedTokenId: ReadonlyMap<number, number>;
  terminalByLiteralId: ReadonlyMap<number, number>;
  namedTokenIds: ReadonlyMap<string, number>;
  literalIds: ReadonlyMap<string, number>;
  mainTokenKinds: ReadonlySet<string>;
  triviaTokenKinds: ReadonlySet<string>;
  ruleNames: readonly string[];
  fieldIds: ReadonlyMap<string, number>;
  fieldNames: readonly string[];
  fieldSchemas: readonly (RuntimeRuleFieldSchema | undefined)[];
}

type RuntimeDfaRow =
  | { kind: "empty" }
  | { kind: "single"; start: number; end: number; target: number }
  | {
    kind: "small" | "binary";
    transitions: readonly ParserKitLexerTransition[];
  }
  | {
    kind: "ascii";
    ascii: Int32Array;
    fallback: readonly ParserKitLexerTransition[];
  };

interface RuntimeDfaRowKindCounts {
  empty: number;
  single: number;
  small: number;
  binary: number;
  ascii: number;
}

const runtimeTableCache = new WeakMap<ParserKit, RuntimeTables>();

function runtimeTables(kit: ParserKit): RuntimeTables {
  const cached = runtimeTableCache.get(kit);
  if (cached) return cached;
  const mappings = terminalMappings(kit);
  const dfaRows = kit.lexer.dfa.transitions.map(compileDfaRow);
  const dfaRowKindCounts = countDfaRowKinds(dfaRows);
  const terminalByNamedTokenId = new Map<number, number>();
  const terminalByLiteralId = new Map<number, number>();
  for (const terminal of kit.bnf.terminals) {
    if (terminal.kind === "named" && terminal.tokenId !== undefined) {
      terminalByNamedTokenId.set(terminal.tokenId, terminal.id);
    } else if (
      terminal.kind === "literal" && terminal.literalId !== undefined
    ) {
      terminalByLiteralId.set(terminal.literalId, terminal.id);
    }
  }
  const actions = new Map<string, readonly ParserKitLrAction[]>();
  let hasBranchingActions = kit.lr.conflictProfile === "branching";
  for (const entry of kit.lr.actions) {
    actions.set(actionKey(entry.state, entry.terminal), entry.actions);
    if (entry.actions.length > 1) hasBranchingActions = true;
  }
  const gotos = new Map<string, number>();
  for (const entry of kit.lr.gotos) {
    gotos.set(gotoKey(entry.state, entry.nonterminal), entry.target);
  }
  const expected = kit.lr.states.map((state) => {
    const row = kit.lr.actions
      .filter((entry) => entry.state === state.id)
      .map((entry) =>
        kit.bnf.terminals[entry.terminal]?.display ?? `#${entry.terminal}`
      );
    return [...new Set(row)].sort();
  });
  const fieldSchemas: (RuntimeRuleFieldSchema | undefined)[] = [];
  const fieldIds = new Map<string, number>();
  const fieldNames: string[] = [];
  for (const schema of kit.fields.rules) {
    const entries = schema.fields.map((field) =>
      [
        field.name,
        { array: field.array, nullable: field.nullable },
      ] as const
    );
    const byName = Object.create(null) as Record<string, FieldConfig>;
    for (const [name, config] of entries) {
      byName[name] = config;
      if (!fieldIds.has(name)) {
        fieldIds.set(name, fieldIds.size);
        fieldNames.push(name);
      }
    }
    fieldSchemas[schema.ruleId] = { entries, byName };
  }
  const runtime = {
    kit,
    eofTerminal: mappings.eof,
    dfaRows,
    dfaRowKindCounts,
    actions,
    gotos,
    expected,
    hasBranchingActions,
    namedTerminals: new Map(Object.entries(mappings.named)),
    literalTerminals: new Map(Object.entries(mappings.literals)),
    namedById: new Map(kit.tokens.named.map((token) => [token.id, token])),
    literalById: new Map(
      kit.tokens.literals.map((literal) => [literal.id, literal]),
    ),
    terminalByNamedTokenId,
    terminalByLiteralId,
    namedTokenIds: new Map(
      kit.tokens.named.map((token) => [token.name, token.id]),
    ),
    literalIds: new Map(
      kit.tokens.literals.map((literal) => [literal.value, literal.id]),
    ),
    mainTokenKinds: new Set(mainTokenKinds(kit)),
    triviaTokenKinds: new Set(triviaTokenKinds(kit)),
    ruleNames: kit.grammar.rules.map((rule) => rule.name),
    fieldIds,
    fieldNames,
    fieldSchemas,
  };
  runtimeTableCache.set(kit, runtime);
  return runtime;
}

function compileDfaRow(
  transitions: readonly ParserKitLexerTransition[] = [],
): RuntimeDfaRow {
  if (transitions.length === 0) return { kind: "empty" };
  if (transitions.length === 1) {
    const [transition] = transitions;
    return {
      kind: "single",
      start: transition.start,
      end: transition.end,
      target: transition.target,
    };
  }

  const asciiCoverage = transitions.reduce((count, transition) => {
    const start = Math.max(0, transition.start);
    const end = Math.min(127, transition.end);
    return end >= start ? count + end - start + 1 : count;
  }, 0);
  if (asciiCoverage >= 8 || (asciiCoverage > 0 && transitions.length >= 4)) {
    const ascii = new Int32Array(128);
    ascii.fill(-1);
    const fallback: ParserKitLexerTransition[] = [];
    for (const transition of transitions) {
      const asciiStart = Math.max(0, transition.start);
      const asciiEnd = Math.min(127, transition.end);
      if (asciiEnd >= asciiStart) {
        for (let code = asciiStart; code <= asciiEnd; code++) {
          ascii[code] = transition.target;
        }
      }
      if (transition.start < 0 || transition.end > 127) {
        fallback.push(transition);
      }
    }
    return { kind: "ascii", ascii, fallback };
  }

  return {
    kind: transitions.length <= 4 ? "small" : "binary",
    transitions,
  };
}

function countDfaRowKinds(
  rows: readonly RuntimeDfaRow[],
): RuntimeDfaRowKindCounts {
  const counts: RuntimeDfaRowKindCounts = {
    empty: 0,
    single: 0,
    small: 0,
    binary: 0,
    ascii: 0,
  };
  for (const row of rows) counts[row.kind]++;
  return counts;
}

function findActions(
  runtime: RuntimeTables,
  state: number,
  terminal: number,
): readonly ParserKitLrAction[] {
  return runtime.actions.get(actionKey(state, terminal)) ?? [];
}

function findGoto(
  runtime: RuntimeTables,
  state: number,
  nonterminal: number,
): number | undefined {
  return runtime.gotos.get(gotoKey(state, nonterminal));
}

function tokenToTerminalFromMaps(
  runtime: RuntimeTables,
  token: KitToken,
): number {
  if (token.type === "eof") return runtime.eofTerminal;
  if (token.type === "named" && token.channel === "main") {
    return runtime.namedTerminals.get(token.kind) ?? -1;
  }
  if (token.type === "literal") {
    return runtime.literalTerminals.get(token.literal) ?? -1;
  }
  return -1;
}

function unexpectedTokenDiagnostic(
  runtime: RuntimeTables,
  token: KitToken,
  state: number,
): KitParseDiagnostic {
  const expected = runtime.expected[state] ?? [];
  const found = tokenDisplay(token);
  const code = expected.includes("EOF") && found !== "EOF"
    ? "PARSE_TRAILING_INPUT"
    : "PARSE_UNEXPECTED_TOKEN";
  return {
    ...kitParseDiagnostic(
      code,
      `Unexpected token ${found}.`,
      token.span,
      state,
    ),
    expected,
    found,
  };
}

function lexicalTokenDiagnostics(
  kit: ParserKit,
  tokens: readonly KitToken[],
): readonly KitParseDiagnostic[] {
  let diagnostics: KitParseDiagnostic[] | null = null;
  for (const token of tokens) {
    if (
      token.type !== "error" &&
      (isTriviaToken(token) || tokenToTerminal(kit, token) >= 0)
    ) {
      continue;
    }
    diagnostics ??= [];
    diagnostics.push(lexicalTokenDiagnostic(kit, token));
  }
  return diagnostics ?? [];
}

function lexicalTokenDiagnostic(
  kit: ParserKit,
  token: KitToken,
): KitParseDiagnostic {
  void kit;
  if (token.type === "error") {
    return {
      ...kitParseDiagnostic(
        "PARSE_LEXICAL_ERROR",
        `Unexpected character ${JSON.stringify(token.text)}.`,
        token.span,
      ),
      found: JSON.stringify(token.text),
    };
  }
  return {
    ...kitParseDiagnostic(
      "PARSE_LEXICAL_ERROR",
      `Token ${tokenDisplay(token)} is not part of this parser's terminal set.`,
      token.span,
    ),
    found: tokenDisplay(token),
  };
}

function validateTokenStream(
  kit: ParserKit,
  source: string,
  tokens: readonly KitToken[],
): KitParseDiagnostic[] {
  const diagnostics: KitParseDiagnostic[] = [];
  const canonical = lexWithKit(kit, source, { preserveTrivia: true });
  const canonicalTokens = canonical.tokens;
  let canonicalIndex = 0;
  let previousEnd = 0;
  let eofIndex = -1;
  const runtime = runtimeTables(kit);

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const span = token.span;
    if (
      !Number.isInteger(span.start) ||
      !Number.isInteger(span.end) ||
      span.start < 0 ||
      span.end < span.start ||
      span.end > source.length
    ) {
      diagnostics.push(invalidTokenStream(
        `Token at index ${index} has an invalid span.`,
        clampSpan(span, source.length),
      ));
      continue;
    }

    if (span.start > previousEnd) {
      const gapDiagnostic = validateSourceGap(
        canonicalTokens,
        previousEnd,
        span.start,
      );
      if (gapDiagnostic) diagnostics.push(gapDiagnostic);
    }

    if (span.start < previousEnd) {
      diagnostics.push(invalidTokenStream(
        `Token at index ${index} overlaps a previous token.`,
        span,
      ));
    }
    previousEnd = Math.max(previousEnd, span.end);

    if (token.type === "eof") {
      const matched = matchCanonicalToken(
        canonicalTokens,
        canonicalIndex,
        token,
      );
      if (matched < 0) {
        diagnostics.push(invalidTokenStream(
          `Token at index ${index} does not match canonical lexer output.`,
          span,
        ));
      } else {
        canonicalIndex = matched + 1;
      }
      if (eofIndex !== -1) {
        diagnostics.push(invalidTokenStream(
          "Token stream contains more than one EOF token.",
          span,
        ));
      }
      eofIndex = index;
      if (
        token.text !== "" ||
        token.channel !== "main" ||
        span.start !== span.end ||
        span.start !== source.length
      ) {
        diagnostics.push(invalidTokenStream(
          "EOF token must have empty text, main channel, and an empty span at the end of the source.",
          span,
        ));
      }
      continue;
    }

    if (eofIndex !== -1) {
      diagnostics.push(invalidTokenStream(
        "Token stream contains tokens after EOF.",
        span,
      ));
    }

    if (span.start === span.end) {
      diagnostics.push(invalidTokenStream(
        `Token at index ${index} has zero width.`,
        span,
      ));
    }

    const sourceText = source.slice(span.start, span.end);
    if (token.text !== sourceText) {
      diagnostics.push(invalidTokenStream(
        `Token at index ${index} text does not match the source slice.`,
        span,
      ));
    }
    if (token.type === "literal") {
      if (token.channel !== "main" || token.text !== token.literal) {
        diagnostics.push(invalidTokenStream(
          "Literal tokens must use the main channel and text equal to the literal.",
          span,
        ));
      }
    } else if (token.type === "named") {
      if (token.channel !== "main" && token.channel !== "trivia") {
        diagnostics.push(invalidTokenStream(
          "Named tokens must use the main or trivia channel.",
          span,
        ));
      } else if (token.channel === "main") {
        if (!runtime.mainTokenKinds.has(token.kind)) {
          diagnostics.push(invalidTokenStream(
            `Named token kind '${token.kind}' is not a main token kind.`,
            span,
          ));
        }
      } else if (!runtime.triviaTokenKinds.has(token.kind)) {
        diagnostics.push(invalidTokenStream(
          `Named token kind '${token.kind}' is not a trivia token kind.`,
          span,
        ));
      }
    } else if (token.type === "error") {
      if (token.channel !== "error") {
        diagnostics.push(invalidTokenStream(
          "Error tokens must use the error channel.",
          span,
        ));
      }
    } else {
      diagnostics.push(invalidTokenStream("Token has an unknown type.", span));
    }
    const matched = matchCanonicalToken(
      canonicalTokens,
      canonicalIndex,
      token,
    );
    if (matched < 0) {
      diagnostics.push(invalidTokenStream(
        `Token at index ${index} does not match canonical lexer output.`,
        span,
      ));
    } else {
      canonicalIndex = matched + 1;
    }
  }

  if (eofIndex !== -1 && eofIndex !== tokens.length - 1) {
    diagnostics.push(invalidTokenStream(
      "EOF must be the final token in the stream.",
      tokens[eofIndex]?.span ?? { start: source.length, end: source.length },
    ));
  }
  if (previousEnd < source.length && eofIndex === -1) {
    const gapDiagnostic = validateSourceGap(
      canonicalTokens,
      previousEnd,
      source.length,
    );
    if (gapDiagnostic) diagnostics.push(gapDiagnostic);
  }
  return diagnostics;
}

function validateSourceGap(
  canonicalTokens: readonly KitToken[],
  start: number,
  end: number,
): KitParseDiagnostic | null {
  if (start === end) return null;
  for (const token of canonicalTokens) {
    if (token.type === "eof") continue;
    if (token.span.end <= start) continue;
    if (token.span.start >= end) break;
    if (
      token.type !== "named" ||
      token.channel !== "trivia" ||
      token.span.start < start ||
      token.span.end > end
    ) {
      return invalidTokenStream(
        "Token stream omits nontrivia source text.",
        { start, end },
      );
    }
  }
  return null;
}

function matchCanonicalToken(
  canonicalTokens: readonly KitToken[],
  startIndex: number,
  token: KitToken,
): number {
  for (let index = startIndex; index < canonicalTokens.length; index++) {
    const canonical = canonicalTokens[index];
    if (canonical.type !== "eof" && isTriviaToken(canonical)) {
      if (sameToken(canonical, token)) return index;
      if (canonical.span.end <= token.span.start) continue;
    }
    return sameToken(canonical, token) ? index : -1;
  }
  return -1;
}

function sameToken(left: KitToken, right: KitToken): boolean {
  if (
    left.type !== right.type ||
    left.text !== right.text ||
    left.channel !== right.channel ||
    left.span.start !== right.span.start ||
    left.span.end !== right.span.end
  ) {
    return false;
  }
  if (left.type === "named" && right.type === "named") {
    return left.kind === right.kind;
  }
  if (left.type === "literal" && right.type === "literal") {
    return left.literal === right.literal;
  }
  return true;
}

function bestCandidate(
  runtime: RuntimeTables,
  source: string,
  offset: number,
): { specIndex: number; end: number } | null {
  let state = runtime.kit.lexer.dfa.start;
  let index = offset;
  let best: { specIndex: number; end: number } | null = null;

  while (index < source.length) {
    const codePoint = source.codePointAt(index);
    if (codePoint === undefined) break;
    const target = transition(runtime, state, codePoint);
    if (target < 0) break;
    index += codePoint > 0xffff ? 2 : 1;
    state = target;
    const specIndex = runtime.kit.lexer.dfa.accepts[state] ?? -1;
    if (specIndex >= 0) best = { specIndex, end: index };
  }

  return best;
}

function scanAcceptCandidates(
  runtime: RuntimeTables,
  source: string,
  offset: number,
): { end: number; candidates: readonly number[] } | null {
  const kit = runtime.kit;
  let state = kit.lexer.dfa.start;
  let index = offset;
  let best: { state: number; end: number } | null = null;

  while (index < source.length) {
    const codePoint = source.codePointAt(index);
    if (codePoint === undefined) break;
    const target = transition(runtime, state, codePoint);
    if (target < 0) break;
    index += codePoint > 0xffff ? 2 : 1;
    state = target;
    const selected = kit.lexer.dfa.accepts[state] ?? -1;
    const candidates = kit.lexer.dfa.acceptCandidates?.[state] ?? [];
    if (selected >= 0 || candidates.length > 0) best = { state, end: index };
  }

  if (!best) return null;
  const candidates = kit.lexer.dfa.acceptCandidates?.[best.state] ??
    [kit.lexer.dfa.accepts[best.state] ?? -1];
  const filtered = candidates.filter((candidate) => candidate >= 0);
  return filtered.length === 0 ? null : { end: best.end, candidates: filtered };
}

function materializeSpecCandidate(
  runtime: RuntimeTables,
  source: string,
  specIndex: number,
  start: number,
  end: number,
): ParseLexCandidate {
  const specRef = runtime.kit.lexer.specs[specIndex];
  if (specRef?.type === "literal") {
    const literal = runtime.literalById.get(specRef.literalId);
    const value = literal?.value ?? source.slice(start, end);
    return {
      token: {
        type: "literal",
        literal: value,
        text: value,
        span: { start, end },
        channel: "main",
      },
      terminal: runtime.terminalByLiteralId.get(specRef.literalId) ?? -1,
    };
  }
  if (specRef?.type === "named") {
    const named = runtime.namedById.get(specRef.tokenId);
    if (named?.channel === "main") {
      return {
        token: namedToken(named.name, source, start, end, "main"),
        terminal: runtime.terminalByNamedTokenId.get(specRef.tokenId) ?? -1,
      };
    }
    return {
      token: namedToken(
        named?.name ?? `token_${specRef?.tokenId ?? specIndex}`,
        source,
        start,
        end,
        "trivia",
      ),
      terminal: -1,
    };
  }
  return {
    token: {
      type: "error",
      text: source.slice(start, end),
      span: { start, end },
      channel: "error",
    },
    terminal: -1,
  };
}

function transition(
  runtime: RuntimeTables,
  state: number,
  codePoint: number,
): number {
  const row = runtime.dfaRows[state] ?? { kind: "empty" };
  switch (row.kind) {
    case "empty":
      return -1;
    case "single":
      return row.start <= codePoint && codePoint <= row.end ? row.target : -1;
    case "ascii":
      if (codePoint < 128) return row.ascii[codePoint] ?? -1;
      return transitionLinear(row.fallback, codePoint);
    case "binary":
      return transitionBinary(row.transitions, codePoint);
    case "small":
      return transitionLinear(row.transitions, codePoint);
  }
}

function transitionLinear(
  transitions: readonly ParserKitLexerTransition[],
  codePoint: number,
): number {
  for (const entry of transitions) {
    if (entry.start <= codePoint && codePoint <= entry.end) return entry.target;
  }
  return -1;
}

function transitionBinary(
  transitions: readonly ParserKitLexerTransition[],
  codePoint: number,
): number {
  let low = 0;
  let high = transitions.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const entry = transitions[mid];
    if (codePoint < entry.start) {
      high = mid - 1;
    } else if (codePoint > entry.end) {
      low = mid + 1;
    } else {
      return entry.target;
    }
  }
  return -1;
}

function lexicalDiagnostics(
  diagnostics: readonly KitLexDiagnostic[],
): readonly KitParseDiagnostic[] {
  if (diagnostics.length === 0) return [];
  return diagnostics.map((diagnostic) =>
    kitParseDiagnostic(
      "PARSE_LEXICAL_ERROR",
      diagnostic.message,
      diagnostic.span,
    )
  );
}

function combineDiagnostics(
  left: readonly KitParseDiagnostic[],
  right: readonly KitParseDiagnostic[],
): readonly KitParseDiagnostic[] {
  if (left.length === 0) return right;
  if (right.length === 0) return left;
  return [...left, ...right];
}

function invalidTokenStream(
  message: string,
  span: KitSpan,
): KitParseDiagnostic {
  return kitParseDiagnostic("PARSE_INVALID_TOKEN_STREAM", message, span);
}

function internalParserDiagnostic(
  error: unknown,
  span: KitSpan,
): KitParseDiagnostic {
  return kitParseDiagnostic(
    "PARSER_INTERNAL_ERROR",
    error instanceof Error ? error.message : String(error),
    span,
  );
}

function kitParseDiagnostic(
  code: KitParseDiagnostic["code"],
  message: string,
  span: KitSpan,
  detail = 0,
): KitParseDiagnostic {
  const runtimeCode = kitDiagnosticCodeId(code);
  return {
    code,
    message,
    span,
    runtimeCode,
    runtimeDetail: detail,
    runtimeDetailKind: kitDiagnosticDetailKind(runtimeCode),
    runtimeDetailKindId: kitDiagnosticDetailKindId(runtimeCode),
  };
}

function kitDiagnosticCodeId(code: KitParseDiagnostic["code"]): number {
  switch (code) {
    case "PARSE_LEXICAL_ERROR":
      return parserDiagnosticCodeParseLexicalError;
    case "PARSE_UNEXPECTED_TOKEN":
      return parserDiagnosticCodeParseUnexpectedToken;
    case "PARSE_TRAILING_INPUT":
      return parserDiagnosticCodeParseTrailingInput;
    case "PARSE_INVALID_TOKEN_STREAM":
      return parserDiagnosticCodeParseInvalidTokenStream;
    case "PARSER_INTERNAL_ERROR":
      return parserDiagnosticCodeInternalError;
    case "PARSER_BRANCH_LIMIT":
      return parserDiagnosticCodeBranchLimit;
    case "PARSER_TRACE_LIMIT":
      return parserDiagnosticCodeTraceLimit;
    case "PARSER_AMBIGUOUS_PARSE":
      return parserDiagnosticCodeAmbiguousParse;
  }
}

function kitDiagnosticDetailKind(
  runtimeCode: number,
): KitParseDiagnostic["runtimeDetailKind"] {
  switch (runtimeCode) {
    case parserDiagnosticCodeParseUnexpectedToken:
    case parserDiagnosticCodeParseTrailingInput:
      return "parser-state";
    default:
      return "none";
  }
}

function kitDiagnosticDetailKindId(runtimeCode: number): number {
  switch (runtimeCode) {
    case parserDiagnosticCodeParseUnexpectedToken:
    case parserDiagnosticCodeParseTrailingInput:
      return parserDiagnosticDetailKindParserState;
    default:
      return parserDiagnosticDetailKindNone;
  }
}

function tokenDisplay(token: KitToken): string {
  if (token.type === "eof") return "EOF";
  if (token.type === "named") return token.kind;
  if (token.type === "literal") return JSON.stringify(token.literal);
  return JSON.stringify(token.text);
}

function isTriviaToken(token: KitToken): boolean {
  return token.type === "named" && token.channel === "trivia";
}

function namedToken(
  kind: string,
  source: string,
  start: number,
  end: number,
  channel: "main",
): KitMainNamedToken;
function namedToken(
  kind: string,
  source: string,
  start: number,
  end: number,
  channel: "trivia",
): KitTriviaToken;
function namedToken(
  kind: string,
  source: string,
  start: number,
  end: number,
  channel: "main" | "trivia",
): KitMainNamedToken | KitTriviaToken {
  let text: string | undefined;
  return {
    type: "named",
    kind,
    get text() {
      text ??= source.slice(start, end);
      return text;
    },
    span: { start, end },
    channel,
  } as KitMainNamedToken | KitTriviaToken;
}

function eofToken(offset: number): KitEofToken {
  return {
    type: "eof",
    text: "",
    span: { start: offset, end: offset },
    channel: "main",
  };
}

function cloneBranch(branch: ParseBranch): ParseBranch {
  return {
    states: [...branch.states],
    values: branch.values.map(cloneBranchValue),
    index: branch.index,
    tokenOverrides: new Map(branch.tokenOverrides),
  };
}

function cloneBranchValue(value: unknown): unknown {
  if (isFragment(value)) {
    let fragmentValue = value.value;
    if (Array.isArray(value.value)) {
      fragmentValue = [...value.value];
    }
    const fields = value.fields.map((field) => {
      let fieldValue = field.value;
      if (Array.isArray(field.value)) {
        fieldValue = [...field.value];
      }
      return { name: field.name, value: fieldValue };
    });
    let span = value.span;
    if (value.span !== null) {
      span = { ...value.span };
    }
    let tokenRange = value.tokenRange;
    if (value.tokenRange !== null) {
      tokenRange = { ...value.tokenRange };
    }
    return {
      value: fragmentValue,
      children: [...value.children],
      fields,
      span,
      tokenRange,
    };
  }
  if (isEventFragment(value)) {
    let span = value.span;
    if (value.span !== null) {
      span = { ...value.span };
    }
    let tokenRange = value.tokenRange;
    if (value.tokenRange !== null) {
      tokenRange = { ...value.tokenRange };
    }
    return {
      events: [...value.events],
      span,
      tokenRange,
    };
  }
  return value;
}

function betterFailure(
  current: ParseFailure | null,
  candidate: ParseFailure,
): ParseFailure {
  if (!current || candidate.offset > current.offset) return candidate;
  if (candidate.offset < current.offset) return current;
  const currentExpected = current.diagnostic.expected?.length ?? 0;
  const candidateExpected = candidate.diagnostic.expected?.length ?? 0;
  return candidateExpected > currentExpected ? candidate : current;
}

function skipTrivia(tokens: readonly KitToken[], start: number): number {
  let index = start;
  while (
    tokens[index]?.type === "named" && tokens[index].channel === "trivia"
  ) {
    index++;
  }
  return index;
}

function spanFromChildren(
  children: readonly KitSyntaxElement[],
): KitSpan | null {
  return children.reduce<KitSpan | null>(
    (span, child) => combineSpans(span, child.span),
    null,
  );
}

function combineSpans(
  left: KitSpan | null,
  right: KitSpan | null,
): KitSpan | null {
  if (!left) return right;
  if (!right) return left;
  return {
    start: Math.min(left.start, right.start),
    end: Math.max(left.end, right.end),
  };
}

function tokenRangeFromChildren(
  children: readonly KitSyntaxElement[],
): TokenRange | null {
  return children.reduce<TokenRange | null>((range, child) => {
    if (child.type === "rule") {
      return combineTokenRanges(range, child.tokenRange);
    }
    return range;
  }, null);
}

function combineTokenRanges(
  left: TokenRange | null,
  right: TokenRange | null,
): TokenRange | null {
  if (!left) return right;
  if (!right) return left;
  return {
    start: Math.min(left.start, right.start),
    end: Math.max(left.end, right.end),
  };
}

function asMutableArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  throw new Error("Expected parser reduction array.");
}

function appendAll<T>(target: T[], values: readonly T[]): T[] {
  for (const value of values) target.push(value);
  return target;
}

function shiftedToken(token: KitToken, tokenIndex: number): ShiftedToken {
  return { token, tokenIndex };
}

function isRuleNode(value: unknown): value is KitRuleNode {
  return !!value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "rule";
}

function isFragment(value: unknown): value is Fragment {
  return !!value &&
    typeof value === "object" &&
    "value" in value &&
    "children" in value &&
    "fields" in value &&
    "tokenRange" in value;
}

function isShiftedToken(value: unknown): value is ShiftedToken {
  return !!value &&
    typeof value === "object" &&
    "token" in value &&
    "tokenIndex" in value;
}

function isMainSyntaxToken(
  value: unknown,
): value is KitMainNamedToken | KitLiteralToken {
  return !!value &&
    typeof value === "object" &&
    (
      (value as { type?: unknown }).type === "literal" ||
      ((value as { type?: unknown; channel?: unknown }).type === "named" &&
        (value as { channel?: unknown }).channel === "main")
    );
}

function clampSpan(span: KitSpan, sourceLength: number): KitSpan {
  const start = Math.min(Math.max(0, span.start), sourceLength);
  const end = Math.min(Math.max(start, span.end), sourceLength);
  return { start, end };
}

function actionKey(state: number, terminal: number): string {
  return `${state}:${terminal}`;
}

function gotoKey(state: number, nonterminal: number): string {
  return `${state}:${nonterminal}`;
}

function validateRuleInfo(
  value: unknown,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (!isRecord(value)) return requireObject(value, path, issues);
  requireNumber(value.id, `${path}.id`, issues);
  requireString(value.name, `${path}.name`, issues);
  requireBoolean(value.reachable, `${path}.reachable`, issues);
  if (value.nodeType !== undefined) {
    requireString(value.nodeType, `${path}.nodeType`, issues);
  }
  validateSourceSpan(value.span, `${path}.span`, issues);
}

function validateNamedToken(
  value: unknown,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (!isRecord(value)) return requireObject(value, path, issues);
  requireNumber(value.id, `${path}.id`, issues);
  requireString(value.name, `${path}.name`, issues);
  requireEnum(value.kind, ["token", "skip"], `${path}.kind`, issues);
  requireEnum(value.channel, ["main", "trivia"], `${path}.channel`, issues);
  if (value.kind === "token" && value.channel === "trivia") {
    issues.push({
      path: `${path}.channel`,
      message: "Token declarations must use the main channel.",
    });
  }
  if (value.kind === "skip" && value.channel === "main") {
    issues.push({
      path: `${path}.channel`,
      message: "Skip declarations must use the trivia channel.",
    });
  }
  requireString(value.pattern, `${path}.pattern`, issues);
  requireNumber(value.priority, `${path}.priority`, issues);
  requireNumber(value.declarationOrder, `${path}.declarationOrder`, issues);
  requireBoolean(value.reachable, `${path}.reachable`, issues);
  validateSourceSpan(value.span, `${path}.span`, issues);
}

function validateLiteral(
  value: unknown,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (!isRecord(value)) return requireObject(value, path, issues);
  requireNumber(value.id, `${path}.id`, issues);
  requireString(value.value, `${path}.value`, issues);
  requireNumber(value.sourceOrder, `${path}.sourceOrder`, issues);
  requireBoolean(value.reachable, `${path}.reachable`, issues);
  validateSourceSpan(value.span, `${path}.span`, issues);
}

function validateLexerSpec(
  value: unknown,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (!isRecord(value)) return requireObject(value, path, issues);
  requireEnum(value.type, ["named", "literal"], `${path}.type`, issues);
  if (value.type === "named") {
    requireNumber(value.tokenId, `${path}.tokenId`, issues);
  } else if (value.type === "literal") {
    requireNumber(value.literalId, `${path}.literalId`, issues);
  }
}

function validateLexerDfa(
  value: unknown,
  path: string,
  specCount: number | undefined,
  issues: ParserKitValidationIssue[],
): void {
  if (!isRecord(value)) return requireObject(value, path, issues);
  requireNumber(value.start, `${path}.start`, issues);
  requireArray(value.transitions, `${path}.transitions`, issues);
  requireArray(value.accepts, `${path}.accepts`, issues);
  if (value.acceptCandidates !== undefined) {
    requireArray(value.acceptCandidates, `${path}.acceptCandidates`, issues);
  }
  const stateCount = Array.isArray(value.transitions)
    ? value.transitions.length
    : undefined;
  if (
    isInteger(value.start) &&
    stateCount !== undefined &&
    !isIndex(value.start, stateCount)
  ) {
    issues.push({
      path: `${path}.start`,
      message: `Expected DFA state index between 0 and ${stateCount - 1}.`,
    });
  }
  if (Array.isArray(value.transitions)) {
    value.transitions.forEach((row, rowIndex) => {
      requireArray(row, `${path}.transitions[${rowIndex}]`, issues);
      if (!Array.isArray(row)) return;
      row.forEach((transition, index) =>
        validateLexerTransition(
          transition,
          `${path}.transitions[${rowIndex}][${index}]`,
          stateCount,
          issues,
        )
      );
    });
  }
  if (Array.isArray(value.accepts)) {
    if (stateCount !== undefined && value.accepts.length !== stateCount) {
      issues.push({
        path: `${path}.accepts`,
        message: "Expected one accept entry for each DFA transition state row.",
      });
    }
    value.accepts.forEach((accept, index) => {
      const acceptPath = `${path}.accepts[${index}]`;
      requireNumber(accept, acceptPath, issues);
      if (
        isInteger(accept) &&
        accept !== -1 &&
        specCount !== undefined &&
        !isIndex(accept, specCount)
      ) {
        issues.push({
          path: acceptPath,
          message: `Expected lexer spec index between 0 and ${specCount - 1}.`,
        });
      }
    });
  }
  if (Array.isArray(value.acceptCandidates)) {
    if (
      stateCount !== undefined && value.acceptCandidates.length !== stateCount
    ) {
      issues.push({
        path: `${path}.acceptCandidates`,
        message: "Expected one accept-candidate row for each DFA state.",
      });
    }
    value.acceptCandidates.forEach((row, rowIndex) => {
      requireArray(row, `${path}.acceptCandidates[${rowIndex}]`, issues);
      if (!Array.isArray(row)) return;
      row.forEach((accept, index) => {
        const acceptPath = `${path}.acceptCandidates[${rowIndex}][${index}]`;
        requireNumber(accept, acceptPath, issues);
        if (
          isInteger(accept) &&
          specCount !== undefined &&
          !isIndex(accept, specCount)
        ) {
          issues.push({
            path: acceptPath,
            message: `Expected lexer spec index between 0 and ${
              specCount - 1
            }.`,
          });
        }
      });
    });
  }
}

function validateLexerTransition(
  value: unknown,
  path: string,
  stateCount: number | undefined,
  issues: ParserKitValidationIssue[],
): void {
  if (!isRecord(value)) return requireObject(value, path, issues);
  requireNumber(value.start, `${path}.start`, issues);
  requireNumber(value.end, `${path}.end`, issues);
  requireNumber(value.target, `${path}.target`, issues);
  if (
    isInteger(value.start) &&
    isInteger(value.end) &&
    value.start > value.end
  ) {
    issues.push({
      path: `${path}.end`,
      message: "Expected transition end to be greater than or equal to start.",
    });
  }
  if (
    isInteger(value.target) &&
    stateCount !== undefined &&
    !isIndex(value.target, stateCount)
  ) {
    issues.push({
      path: `${path}.target`,
      message: `Expected DFA state index between 0 and ${stateCount - 1}.`,
    });
  }
}

function validateTerminal(
  value: unknown,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (!isRecord(value)) return requireObject(value, path, issues);
  requireNumber(value.id, `${path}.id`, issues);
  requireEnum(value.kind, ["eof", "named", "literal"], `${path}.kind`, issues);
  requireString(value.key, `${path}.key`, issues);
  requireString(value.display, `${path}.display`, issues);
  if (value.tokenId !== undefined) {
    requireNumber(value.tokenId, `${path}.tokenId`, issues);
  }
  if (value.literalId !== undefined) {
    requireNumber(value.literalId, `${path}.literalId`, issues);
  }
}

function validateNonterminal(
  value: unknown,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (!isRecord(value)) return requireObject(value, path, issues);
  requireNumber(value.id, `${path}.id`, issues);
  requireString(value.name, `${path}.name`, issues);
  if (value.ruleId !== undefined) {
    requireNumber(value.ruleId, `${path}.ruleId`, issues);
  }
  if (value.expressionId !== undefined) {
    requireNumber(value.expressionId, `${path}.expressionId`, issues);
  }
}

function validateProduction(
  value: unknown,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (!isRecord(value)) return requireObject(value, path, issues);
  requireNumber(value.id, `${path}.id`, issues);
  requireNumber(value.lhs, `${path}.lhs`, issues);
  requireArray(value.rhs, `${path}.rhs`, issues);
  if (Array.isArray(value.rhs)) {
    value.rhs.forEach((symbol, index) =>
      validateSymbol(symbol, `${path}.rhs[${index}]`, issues)
    );
  }
  validateReducer(value.reducer, `${path}.reducer`, issues);
  if (value.span !== undefined) {
    validateSourceSpan(value.span, `${path}.span`, issues);
  }
  if (value.origin !== undefined) {
    validateProductionOrigin(value.origin, `${path}.origin`, issues);
  }
}

function validateSymbol(
  value: unknown,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (!isRecord(value)) return requireObject(value, path, issues);
  requireEnum(value.kind, ["terminal", "nonterminal"], `${path}.kind`, issues);
  requireNumber(value.id, `${path}.id`, issues);
}

function validateReducer(
  value: unknown,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (!isRecord(value)) return requireObject(value, path, issues);
  requireEnum(
    value.kind,
    [
      "start",
      "rule",
      "terminal",
      "ruleRef",
      "identity",
      "sequence",
      "optionalEmpty",
      "optionalSome",
      "repeatEmpty",
      "repeatAppend",
      "repeat1First",
      "repeat1Append",
      "separatedFirst",
      "separatedAppend",
      "field",
    ],
    `${path}.kind`,
    issues,
  );
  if (value.kind === "rule") {
    requireNumber(value.ruleId, `${path}.ruleId`, issues);
  }
  if (value.kind === "field") requireString(value.name, `${path}.name`, issues);
}

function validateProductionOrigin(
  value: unknown,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (!isRecord(value)) return requireObject(value, path, issues);
  requireNumber(value.ruleId, `${path}.ruleId`, issues);
  requireString(value.ruleName, `${path}.ruleName`, issues);
  if (value.expressionId !== undefined) {
    requireNumber(value.expressionId, `${path}.expressionId`, issues);
  }
  validateSourceSpan(value.span, `${path}.span`, issues);
  requireString(value.description, `${path}.description`, issues);
}

function validateLrState(
  value: unknown,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (!isRecord(value)) return requireObject(value, path, issues);
  requireNumber(value.id, `${path}.id`, issues);
  requireArray(value.items, `${path}.items`, issues);
  if (Array.isArray(value.items)) {
    value.items.forEach((item, index) =>
      validateLrItem(item, `${path}.items[${index}]`, issues)
    );
  }
}

function validateLrItem(
  value: unknown,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (!isRecord(value)) return requireObject(value, path, issues);
  requireNumber(value.production, `${path}.production`, issues);
  requireNumber(value.dot, `${path}.dot`, issues);
  requireArray(value.lookaheads, `${path}.lookaheads`, issues);
  if (Array.isArray(value.lookaheads)) {
    value.lookaheads.forEach((lookahead, index) =>
      requireNumber(lookahead, `${path}.lookaheads[${index}]`, issues)
    );
  }
}

function validateActionEntry(
  value: unknown,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (!isRecord(value)) return requireObject(value, path, issues);
  requireNumber(value.state, `${path}.state`, issues);
  requireNumber(value.terminal, `${path}.terminal`, issues);
  requireArray(value.actions, `${path}.actions`, issues);
  if (Array.isArray(value.actions)) {
    value.actions.forEach((action, index) =>
      validateAction(action, `${path}.actions[${index}]`, issues)
    );
  }
}

function validateAction(
  value: unknown,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (!isRecord(value)) return requireObject(value, path, issues);
  requireEnum(
    value.kind,
    ["shift", "reduce", "accept"],
    `${path}.kind`,
    issues,
  );
  if (value.kind === "shift") {
    requireNumber(value.state, `${path}.state`, issues);
  }
  if (value.kind === "reduce") {
    requireNumber(value.production, `${path}.production`, issues);
  }
}

function validateGotoEntry(
  value: unknown,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (!isRecord(value)) return requireObject(value, path, issues);
  requireNumber(value.state, `${path}.state`, issues);
  requireNumber(value.nonterminal, `${path}.nonterminal`, issues);
  requireNumber(value.target, `${path}.target`, issues);
}

function validateLrStats(
  value: unknown,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (!isRecord(value)) return requireObject(value, path, issues);
  for (
    const key of [
      "bnfProductions",
      "states",
      "coreItems",
      "items",
      "closureWork",
      "actionEntries",
      "gotoEntries",
      "tableEntries",
    ]
  ) {
    requireNumber(value[key], `${path}.${key}`, issues);
  }
}

function validateFieldSchema(
  value: unknown,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (!isRecord(value)) return requireObject(value, path, issues);
  requireNumber(value.ruleId, `${path}.ruleId`, issues);
  requireString(value.ruleName, `${path}.ruleName`, issues);
  requireString(value.nodeType, `${path}.nodeType`, issues);
  requireArray(value.fields, `${path}.fields`, issues);
  if (Array.isArray(value.fields)) {
    value.fields.forEach((field, index) =>
      validateFieldInfo(field, `${path}.fields[${index}]`, issues)
    );
  }
}

function validateFieldInfo(
  value: unknown,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (!isRecord(value)) return requireObject(value, path, issues);
  requireString(value.name, `${path}.name`, issues);
  requireString(value.type, `${path}.type`, issues);
  requireBoolean(value.array, `${path}.array`, issues);
  requireBoolean(value.nullable, `${path}.nullable`, issues);
}

function validateDisplayName(
  value: unknown,
  path: string,
  index: number,
  issues: ParserKitValidationIssue[],
): void {
  const entryPath = `${path}[${index}]`;
  if (!isRecord(value)) return requireObject(value, entryPath, issues);
  requireNumber(value.id, `${entryPath}.id`, issues);
  requireString(value.display, `${entryPath}.display`, issues);
}

function validateParserKitReferences(
  kit: Partial<ParserKit>,
  issues: ParserKitValidationIssue[],
): void {
  const grammarRules = Array.isArray(kit.grammar?.rules)
    ? kit.grammar.rules
    : [];
  const namedTokens = Array.isArray(kit.tokens?.named) ? kit.tokens.named : [];
  const literals = Array.isArray(kit.tokens?.literals)
    ? kit.tokens.literals
    : [];
  const terminals = Array.isArray(kit.bnf?.terminals) ? kit.bnf.terminals : [];
  const nonterminals = Array.isArray(kit.bnf?.nonterminals)
    ? kit.bnf.nonterminals
    : [];
  const productions = Array.isArray(kit.bnf?.productions)
    ? kit.bnf.productions
    : [];
  const lrStates = Array.isArray(kit.lr?.states) ? kit.lr.states : [];

  const ruleIds = new Set<number>();
  const lexableNamedIds = new Set<number>();
  const reachableMainNamedIds = new Set<number>();
  const reachableLiteralIds = new Set<number>();
  const terminalIds = new Set<number>();
  const nonterminalIds = new Set<number>();
  const productionIds = new Set<number>();
  const stateIds = new Set<number>();

  grammarRules.forEach((rule, index) => {
    if (!isRecord(rule) || !isInteger(rule.id)) return;
    ruleIds.add(rule.id);
    requireCanonicalId(rule.id, index, `$.grammar.rules[${index}].id`, issues);
  });
  if (
    isInteger(kit.grammar?.rootRuleId) &&
    !ruleIds.has(kit.grammar.rootRuleId)
  ) {
    issues.push({
      path: "$.grammar.rootRuleId",
      message: `Unknown grammar rule id ${kit.grammar.rootRuleId}.`,
    });
  }

  namedTokens.forEach((token) => {
    if (!isRecord(token) || !isInteger(token.id)) return;
    if (
      token.kind === "token" && token.channel === "main" &&
      token.reachable === true
    ) {
      lexableNamedIds.add(token.id);
      reachableMainNamedIds.add(token.id);
    }
    if (token.kind === "skip" && token.channel === "trivia") {
      lexableNamedIds.add(token.id);
    }
  });
  literals.forEach((literal) => {
    if (!isRecord(literal) || !isInteger(literal.id)) return;
    if (literal.reachable === true) reachableLiteralIds.add(literal.id);
  });
  terminals.forEach((terminal, index) => {
    if (!isRecord(terminal) || !isInteger(terminal.id)) return;
    terminalIds.add(terminal.id);
    requireCanonicalId(
      terminal.id,
      index,
      `$.bnf.terminals[${index}].id`,
      issues,
    );
  });
  nonterminals.forEach((nonterminal, index) => {
    if (!isRecord(nonterminal) || !isInteger(nonterminal.id)) return;
    nonterminalIds.add(nonterminal.id);
    requireCanonicalId(
      nonterminal.id,
      index,
      `$.bnf.nonterminals[${index}].id`,
      issues,
    );
  });
  productions.forEach((production, index) => {
    if (!isRecord(production) || !isInteger(production.id)) return;
    productionIds.add(production.id);
    requireCanonicalId(
      production.id,
      index,
      `$.bnf.productions[${index}].id`,
      issues,
    );
  });
  lrStates.forEach((state, index) => {
    if (!isRecord(state) || !isInteger(state.id)) return;
    stateIds.add(state.id);
    requireCanonicalId(state.id, index, `$.lr.states[${index}].id`, issues);
  });

  if (Array.isArray(kit.lexer?.specs)) {
    kit.lexer.specs.forEach((spec, index) => {
      if (!isRecord(spec)) return;
      if (
        spec.type === "named" &&
        isInteger(spec.tokenId) &&
        !lexableNamedIds.has(spec.tokenId)
      ) {
        issues.push({
          path: `$.lexer.specs[${index}].tokenId`,
          message: `Unknown reachable lexer token id ${spec.tokenId}.`,
        });
      }
      if (
        spec.type === "literal" &&
        isInteger(spec.literalId) &&
        !reachableLiteralIds.has(spec.literalId)
      ) {
        issues.push({
          path: `$.lexer.specs[${index}].literalId`,
          message: `Unknown reachable literal id ${spec.literalId}.`,
        });
      }
    });
  }

  if (kit.bnf && typeof kit.bnf === "object") {
    validateIdReference(
      kit.bnf.startNonterminal,
      nonterminalIds,
      "$.bnf.startNonterminal",
      "nonterminal",
      issues,
    );
    validateIdReference(
      kit.bnf.rootRuleNonterminal,
      nonterminalIds,
      "$.bnf.rootRuleNonterminal",
      "nonterminal",
      issues,
    );
    validateIdReference(
      kit.bnf.eofTerminal,
      terminalIds,
      "$.bnf.eofTerminal",
      "terminal",
      issues,
    );
    if (isInteger(kit.bnf.eofTerminal)) {
      const terminal = terminals[kit.bnf.eofTerminal];
      if (isRecord(terminal) && terminal.kind !== "eof") {
        issues.push({
          path: "$.bnf.eofTerminal",
          message: "EOF terminal must reference an eof terminal.",
        });
      }
    }
  }

  terminals.forEach((terminal, index) => {
    if (!isRecord(terminal)) return;
    const path = `$.bnf.terminals[${index}]`;
    if (terminal.kind === "eof") {
      requireAbsent(terminal.tokenId, `${path}.tokenId`, issues);
      requireAbsent(terminal.literalId, `${path}.literalId`, issues);
      return;
    }
    if (terminal.kind === "named") {
      if (terminal.tokenId === undefined) {
        issues.push({
          path: `${path}.tokenId`,
          message: "Named terminals must reference a main token id.",
        });
      } else if (isInteger(terminal.tokenId)) {
        if (!reachableMainNamedIds.has(terminal.tokenId)) {
          issues.push({
            path: `${path}.tokenId`,
            message: `Unknown reachable main token id ${terminal.tokenId}.`,
          });
        }
      }
      requireAbsent(terminal.literalId, `${path}.literalId`, issues);
      return;
    }
    if (terminal.kind === "literal") {
      if (terminal.literalId === undefined) {
        issues.push({
          path: `${path}.literalId`,
          message: "Literal terminals must reference a literal id.",
        });
      } else if (
        isInteger(terminal.literalId) &&
        !reachableLiteralIds.has(terminal.literalId)
      ) {
        issues.push({
          path: `${path}.literalId`,
          message: `Unknown reachable literal id ${terminal.literalId}.`,
        });
      }
      requireAbsent(terminal.tokenId, `${path}.tokenId`, issues);
    }
  });

  nonterminals.forEach((nonterminal, index) => {
    if (!isRecord(nonterminal)) return;
    const path = `$.bnf.nonterminals[${index}]`;
    if (isInteger(nonterminal.ruleId) && !ruleIds.has(nonterminal.ruleId)) {
      issues.push({
        path: `${path}.ruleId`,
        message: `Unknown grammar rule id ${nonterminal.ruleId}.`,
      });
    }
  });

  productions.forEach((production, index) => {
    if (!isRecord(production)) return;
    const path = `$.bnf.productions[${index}]`;
    validateIdReference(
      production.lhs,
      nonterminalIds,
      `${path}.lhs`,
      "nonterminal",
      issues,
    );
    if (Array.isArray(production.rhs)) {
      production.rhs.forEach((symbol, symbolIndex) => {
        if (!isRecord(symbol)) return;
        const symbolPath = `${path}.rhs[${symbolIndex}].id`;
        if (symbol.kind === "terminal") {
          validateIdReference(
            symbol.id,
            terminalIds,
            symbolPath,
            "terminal",
            issues,
          );
        } else if (symbol.kind === "nonterminal") {
          validateIdReference(
            symbol.id,
            nonterminalIds,
            symbolPath,
            "nonterminal",
            issues,
          );
        }
      });
    }
    if (isRecord(production.reducer) && production.reducer.kind === "rule") {
      validateIdReference(
        production.reducer.ruleId,
        ruleIds,
        `${path}.reducer.ruleId`,
        "grammar rule",
        issues,
      );
    }
    if (isRecord(production.origin)) {
      validateIdReference(
        production.origin.ruleId,
        ruleIds,
        `${path}.origin.ruleId`,
        "grammar rule",
        issues,
      );
    }
  });

  lrStates.forEach((state, stateIndex) => {
    if (!isRecord(state) || !Array.isArray(state.items)) return;
    state.items.forEach((item, itemIndex) => {
      if (!isRecord(item)) return;
      const path = `$.lr.states[${stateIndex}].items[${itemIndex}]`;
      validateIdReference(
        item.production,
        productionIds,
        `${path}.production`,
        "production",
        issues,
      );
      const production = isInteger(item.production)
        ? productions[item.production]
        : undefined;
      if (
        isRecord(production) &&
        Array.isArray(production.rhs) &&
        isInteger(item.dot) &&
        (item.dot < 0 || item.dot > production.rhs.length)
      ) {
        issues.push({
          path: `${path}.dot`,
          message:
            "Expected LR item dot to be between 0 and the production RHS length.",
        });
      }
      if (Array.isArray(item.lookaheads)) {
        item.lookaheads.forEach((lookahead, lookaheadIndex) =>
          validateIdReference(
            lookahead,
            terminalIds,
            `${path}.lookaheads[${lookaheadIndex}]`,
            "terminal",
            issues,
          )
        );
      }
    });
  });

  if (Array.isArray(kit.lr?.actions)) {
    kit.lr.actions.forEach((entry, index) => {
      if (!isRecord(entry)) return;
      const path = `$.lr.actions[${index}]`;
      validateIdReference(
        entry.state,
        stateIds,
        `${path}.state`,
        "LR state",
        issues,
      );
      validateIdReference(
        entry.terminal,
        terminalIds,
        `${path}.terminal`,
        "terminal",
        issues,
      );
      if (!Array.isArray(entry.actions)) return;
      entry.actions.forEach((action, actionIndex) => {
        if (!isRecord(action)) return;
        const actionPath = `${path}.actions[${actionIndex}]`;
        if (action.kind === "shift") {
          validateIdReference(
            action.state,
            stateIds,
            `${actionPath}.state`,
            "LR state",
            issues,
          );
        } else if (action.kind === "reduce") {
          validateIdReference(
            action.production,
            productionIds,
            `${actionPath}.production`,
            "production",
            issues,
          );
        }
      });
    });
  }

  if (Array.isArray(kit.lr?.gotos)) {
    kit.lr.gotos.forEach((entry, index) => {
      if (!isRecord(entry)) return;
      const path = `$.lr.gotos[${index}]`;
      validateIdReference(
        entry.state,
        stateIds,
        `${path}.state`,
        "LR state",
        issues,
      );
      validateIdReference(
        entry.nonterminal,
        nonterminalIds,
        `${path}.nonterminal`,
        "nonterminal",
        issues,
      );
      validateIdReference(
        entry.target,
        stateIds,
        `${path}.target`,
        "LR state",
        issues,
      );
    });
  }

  if (isRecord(kit.lr?.stats)) {
    const actionEntries = Array.isArray(kit.lr?.actions)
      ? kit.lr.actions.reduce(
        (count, entry) =>
          count +
          (isRecord(entry) && Array.isArray(entry.actions)
            ? entry.actions.length
            : 0),
        0,
      )
      : 0;
    const gotoEntries = Array.isArray(kit.lr?.gotos) ? kit.lr.gotos.length : 0;
    const coreItems = lrStates.reduce(
      (count, state) =>
        count +
        (isRecord(state) && Array.isArray(state.items)
          ? state.items.length
          : 0),
      0,
    );
    const items = lrStates.reduce((count, state) => {
      if (!isRecord(state) || !Array.isArray(state.items)) return count;
      return count +
        state.items.reduce(
          (itemCount, item) =>
            itemCount +
            (isRecord(item) && Array.isArray(item.lookaheads)
              ? item.lookaheads.length
              : 0),
          0,
        );
    }, 0);
    validateExactNumber(
      kit.lr.stats.bnfProductions,
      productions.length,
      "$.lr.stats.bnfProductions",
      issues,
    );
    validateExactNumber(
      kit.lr.stats.states,
      lrStates.length,
      "$.lr.stats.states",
      issues,
    );
    validateExactNumber(
      kit.lr.stats.coreItems,
      coreItems,
      "$.lr.stats.coreItems",
      issues,
    );
    validateExactNumber(
      kit.lr.stats.items,
      items,
      "$.lr.stats.items",
      issues,
    );
    requireNumber(
      kit.lr.stats.closureWork,
      "$.lr.stats.closureWork",
      issues,
    );
    validateExactNumber(
      kit.lr.stats.actionEntries,
      actionEntries,
      "$.lr.stats.actionEntries",
      issues,
    );
    validateExactNumber(
      kit.lr.stats.gotoEntries,
      gotoEntries,
      "$.lr.stats.gotoEntries",
      issues,
    );
    validateExactNumber(
      kit.lr.stats.tableEntries,
      actionEntries + gotoEntries,
      "$.lr.stats.tableEntries",
      issues,
    );
  }

  if (Array.isArray(kit.fields?.rules)) {
    kit.fields.rules.forEach((schema, index) => {
      if (!isRecord(schema)) return;
      validateIdReference(
        schema.ruleId,
        ruleIds,
        `$.fields.rules[${index}].ruleId`,
        "grammar rule",
        issues,
      );
    });
  }

  if (Array.isArray(kit.displayNames?.terminals)) {
    kit.displayNames.terminals.forEach((display, index) => {
      if (!isRecord(display)) return;
      validateIdReference(
        display.id,
        terminalIds,
        `$.displayNames.terminals[${index}].id`,
        "terminal",
        issues,
      );
    });
  }
  if (Array.isArray(kit.displayNames?.rules)) {
    kit.displayNames.rules.forEach((display, index) => {
      if (!isRecord(display)) return;
      validateIdReference(
        display.id,
        ruleIds,
        `$.displayNames.rules[${index}].id`,
        "grammar rule",
        issues,
      );
    });
  }
}

function validateSourceSpan(
  value: unknown,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (!isRecord(value)) return requireObject(value, path, issues);
  requireNumber(value.start, `${path}.start`, issues);
  requireNumber(value.end, `${path}.end`, issues);
  requireNumber(value.line, `${path}.line`, issues);
  requireNumber(value.column, `${path}.column`, issues);
  if (isInteger(value.start) && value.start < 0) {
    issues.push({
      path: `${path}.start`,
      message: "Expected non-negative source offset.",
    });
  }
  if (isInteger(value.end) && value.end < 0) {
    issues.push({
      path: `${path}.end`,
      message: "Expected non-negative source offset.",
    });
  }
  if (
    isInteger(value.start) && isInteger(value.end) && value.end < value.start
  ) {
    issues.push({
      path: `${path}.end`,
      message: "Expected source span end to be greater than or equal to start.",
    });
  }
  if (isInteger(value.line) && value.line < 1) {
    issues.push({
      path: `${path}.line`,
      message: "Expected one-based source line.",
    });
  }
  if (isInteger(value.column) && value.column < 0) {
    issues.push({
      path: `${path}.column`,
      message: "Expected non-negative source column.",
    });
  }
}

function requireObject(
  value: unknown,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push({ path, message: "Expected object." });
  }
}

function requireArray(
  value: unknown,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (!Array.isArray(value)) issues.push({ path, message: "Expected array." });
}

function requireString(
  value: unknown,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (typeof value !== "string") {
    issues.push({ path, message: "Expected string." });
  }
}

function requireBoolean(
  value: unknown,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (typeof value !== "boolean") {
    issues.push({ path, message: "Expected boolean." });
  }
}

function requireNumber(
  value: unknown,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (!isInteger(value)) {
    issues.push({ path, message: "Expected integer." });
  }
}

function requireEnum(
  value: unknown,
  variants: readonly string[],
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (typeof value !== "string" || !variants.includes(value)) {
    issues.push({
      path,
      message: `Expected one of ${
        variants.map((variant) => JSON.stringify(variant)).join(", ")
      }.`,
    });
  }
}

function requireAbsent(
  value: unknown,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (value !== undefined) {
    issues.push({ path, message: "Expected field to be omitted." });
  }
}

function requireCanonicalId(
  id: number,
  index: number,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (id !== index) {
    issues.push({
      path,
      message: `Expected id ${index} to match array index.`,
    });
  }
}

function validateIdReference(
  value: unknown,
  ids: ReadonlySet<number>,
  path: string,
  label: string,
  issues: ParserKitValidationIssue[],
): void {
  if (!isInteger(value)) return;
  if (!ids.has(value)) {
    issues.push({
      path,
      message: `Unknown ${label} id ${value}.`,
    });
  }
}

function validateExactNumber(
  value: unknown,
  expected: number,
  path: string,
  issues: ParserKitValidationIssue[],
): void {
  if (!isInteger(value)) return;
  if (value !== expected) {
    issues.push({
      path,
      message: `Expected ${expected}.`,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return Number.isInteger(value);
}

function isIndex(value: number, length: number): boolean {
  return value >= 0 && value < length;
}
