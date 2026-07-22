import type { Diagnostic, SourceSpan } from "../ast.ts";
import type {
  AnalyzedGrammar,
  AnalyzedGrammarToken,
  GrammarModeId,
} from "./grammar_ir.ts";
import type { Dfa } from "./regex/dfa.ts";
import { parsePortableRegex } from "./regex/parser.ts";
import { buildLexerDfa, type LexerRegexSpec } from "./regex/lexer.ts";

export interface GrammarLexerPlan {
  readonly modes: readonly GrammarLexerModePlan[];
  readonly defaultMode: GrammarModeId;
  readonly diagnostics: readonly Diagnostic[];
}

export interface GrammarLexerModePlan {
  readonly id: GrammarModeId;
  readonly name: string;
  readonly specs: readonly GrammarLexerSpec[];
  readonly dfa: Dfa;
}

export interface GrammarLexerSpec {
  readonly tokenId: number;
  readonly name: string;
  readonly kind: "token" | "skip" | "contextual";
  readonly channel: string;
  readonly transition: GrammarLexerTransition | undefined;
  readonly span: SourceSpan;
}

export type GrammarLexerTransition =
  | { readonly kind: "push"; readonly modeId: GrammarModeId }
  | { readonly kind: "mode"; readonly modeId: GrammarModeId }
  | { readonly kind: "pop" };

export interface GrammarLexOptions {
  readonly preserveTrivia?: boolean;
  readonly checkpoint?: GrammarLexerCheckpoint;
  readonly layout?: GrammarLayoutOptions;
}

export interface GrammarLayoutOptions {
  readonly newlineToken: string;
  readonly indentToken: string;
  readonly dedentToken: string;
  readonly openTokens?: readonly string[];
  readonly closeTokens?: readonly string[];
  readonly tabSize?: number;
}

export interface GrammarTokenStreamValidationOptions {
  readonly preserveTrivia?: boolean;
  readonly layout?: GrammarLayoutOptions;
}

export interface GrammarLexResult {
  readonly tokens: readonly GrammarLexToken[];
  readonly diagnostics: readonly Diagnostic[];
  readonly checkpoints: readonly GrammarLexerCheckpoint[];
  readonly candidateSites: readonly GrammarLexCandidateSite[];
  readonly finalCheckpoint: GrammarLexerCheckpoint;
}

export interface GrammarLexCandidateSite {
  readonly tokenIndex: number;
  readonly candidates: readonly GrammarLexCandidate[];
}

export interface GrammarLexCandidate {
  readonly tokenId: number;
  readonly name: string;
  readonly contextual: boolean;
  readonly channel: string;
}

export interface GrammarLexToken {
  readonly kind: "token" | "trivia" | "error" | "eof";
  readonly name: string;
  readonly text: string;
  readonly channel: string;
  readonly mode: string;
  readonly span: SourceSpan;
}

export interface GrammarLexerCheckpoint {
  readonly offset: number;
  readonly modeStack: readonly GrammarModeId[];
}

interface SourceMap {
  readonly source: string;
  readonly lineStarts: readonly number[];
}

/** Builds an inspectable grammar lexer plan with one combined DFA per mode. */
export function buildGrammarLexerPlan(
  analyzed: AnalyzedGrammar,
): GrammarLexerPlan {
  const diagnostics: Diagnostic[] = [];
  const modes: GrammarLexerModePlan[] = [];
  for (const mode of analyzed.modes) {
    const tokens = analyzed.tokens.filter((token) => token.modeId === mode.id);
    const specs: GrammarLexerSpec[] = [];
    const regexSpecs: LexerRegexSpec[] = [];
    for (const token of tokens) {
      const spec = lexerSpecForToken(analyzed, token, diagnostics);
      specs.push(spec);
      if (token.pattern.kind === "literal") {
        regexSpecs.push({
          ast: literalRegexAst(token.pattern.value),
          type: "literal",
          priority: token.priority,
          order: token.id,
          contextual: token.kind === "contextual",
        });
      } else {
        try {
          regexSpecs.push({
            ast: parsePortableRegex(token.pattern.pattern),
            type: "named",
            priority: token.priority,
            order: token.id,
            contextual: token.kind === "contextual",
          });
        } catch (error) {
          diagnostics.push(patternDiagnostic(token, error));
        }
      }
    }
    let dfa: Dfa = {
      start: 0,
      states: [{
        id: 0,
        nfaStates: [],
        accepts: [],
        selectedAccept: null,
        transitions: [],
      }],
    };
    if (regexSpecs.length > 0) {
      dfa = buildLexerDfa(regexSpecs);
    }
    modes.push({ id: mode.id, name: mode.name, specs, dfa });
  }
  return { modes, defaultMode: 0, diagnostics };
}

/** Executes a grammar lexer plan and optionally resumes from a checkpoint. */
export function lexGrammar(
  plan: GrammarLexerPlan,
  source: string,
  options: GrammarLexOptions = {},
): GrammarLexResult {
  const sourceMap = createSourceMap(source);
  const diagnostics: Diagnostic[] = [...plan.diagnostics];
  const tokens: GrammarLexToken[] = [];
  const checkpoints: GrammarLexerCheckpoint[] = [];
  const candidateSites: GrammarLexCandidateSite[] = [];
  let checkpoint = initialCheckpoint(plan, options.checkpoint);
  let preserveTrivia = true;
  if (options.preserveTrivia === false) {
    preserveTrivia = false;
  }
  const keepTriviaForLayout = options.layout !== undefined;

  while (checkpoint.offset < source.length) {
    const mode = modeForId(
      plan,
      checkpoint.modeStack[checkpoint.modeStack.length - 1],
    );
    const match = scanMode(mode, source, checkpoint.offset);
    if (match === undefined) {
      const end = nextOffset(source, checkpoint.offset);
      const span = spanFor(sourceMap, checkpoint.offset, end);
      tokens.push({
        kind: "error",
        name: "ERROR",
        text: source.slice(checkpoint.offset, end),
        channel: "error",
        mode: mode.name,
        span,
      });
      diagnostics.push({
        code: "GRAMMAR_LEX_UNEXPECTED_CHARACTER",
        severity: "error",
        message: "Unexpected character.",
        span,
      });
      checkpoint = {
        offset: end,
        modeStack: checkpoint.modeStack,
      };
      checkpoints.push(checkpoint);
      continue;
    }

    const spec = mode.specs[match.specIndex];
    const span = spanFor(sourceMap, checkpoint.offset, match.end);
    const nextCheckpoint = applyTransition(
      plan,
      checkpoint,
      spec.transition,
      match.end,
      span,
      diagnostics,
    );
    if (preserveTrivia || spec.channel !== "trivia" || keepTriviaForLayout) {
      const tokenIndex = tokens.length;
      let kind: GrammarLexToken["kind"] = "token";
      if (spec.channel === "trivia") {
        kind = "trivia";
      }
      tokens.push({
        kind,
        name: spec.name,
        text: source.slice(checkpoint.offset, match.end),
        channel: spec.channel,
        mode: mode.name,
        span,
      });
      if (spec.channel !== "trivia" && match.candidates.length > 0) {
        candidateSites.push({
          tokenIndex,
          candidates: match.candidates.map((candidate) => ({
            tokenId: candidate.tokenId,
            name: candidate.name,
            contextual: candidate.kind === "contextual",
            channel: candidate.channel,
          })),
        });
      }
      checkpoints.push(nextCheckpoint);
    }
    checkpoint = nextCheckpoint;
  }

  const eofSpan = spanFor(sourceMap, source.length, source.length);
  tokens.push({
    kind: "eof",
    name: "EOF",
    text: "",
    channel: "eof",
    mode: modeForId(plan, checkpoint.modeStack[checkpoint.modeStack.length - 1])
      .name,
    span: eofSpan,
  });
  checkpoints.push(checkpoint);
  let publicTokens: readonly GrammarLexToken[] = tokens;
  if (options.layout !== undefined) {
    publicTokens = applyLayout(
      tokens,
      options.layout,
      preserveTrivia,
      diagnostics,
    );
  }
  let publicCandidateSites: readonly GrammarLexCandidateSite[] = candidateSites;
  if (options.layout !== undefined) {
    publicCandidateSites = [];
  }
  return {
    tokens: publicTokens,
    diagnostics,
    checkpoints,
    candidateSites: publicCandidateSites,
    finalCheckpoint: checkpoint,
  };
}

export function validateGrammarTokenStream(
  plan: GrammarLexerPlan,
  source: string,
  tokens: readonly GrammarLexToken[],
  options: GrammarTokenStreamValidationOptions = {},
): readonly Diagnostic[] {
  const expected = lexGrammar(plan, source, {
    preserveTrivia: options.preserveTrivia,
    layout: options.layout,
  }).tokens;
  const diagnostics: Diagnostic[] = [];
  const count = Math.max(expected.length, tokens.length);
  for (let index = 0; index < count; index++) {
    const expectedToken = expected[index];
    const actualToken = tokens[index];
    if (expectedToken === undefined && actualToken !== undefined) {
      diagnostics.push({
        code: "GRAMMAR_TOKEN_STREAM_EXTRA_TOKEN",
        severity: "error",
        message: `Unexpected extra token '${actualToken.name}'.`,
        span: actualToken.span,
      });
      continue;
    }
    if (expectedToken !== undefined && actualToken === undefined) {
      diagnostics.push({
        code: "GRAMMAR_TOKEN_STREAM_MISSING_TOKEN",
        severity: "error",
        message: `Missing token '${expectedToken.name}'.`,
        span: expectedToken.span,
      });
      continue;
    }
    if (expectedToken === undefined || actualToken === undefined) {
      continue;
    }
    if (
      expectedToken.name !== actualToken.name ||
      expectedToken.kind !== actualToken.kind ||
      expectedToken.channel !== actualToken.channel
    ) {
      diagnostics.push({
        code: "GRAMMAR_TOKEN_STREAM_WRONG_KIND",
        severity: "error",
        message:
          `Expected token '${expectedToken.name}' but found '${actualToken.name}'.`,
        span: actualToken.span,
        related: [{
          message: "Expected token.",
          span: expectedToken.span,
        }],
      });
      continue;
    }
    if (
      expectedToken.span.start !== actualToken.span.start ||
      expectedToken.span.end !== actualToken.span.end
    ) {
      diagnostics.push({
        code: "GRAMMAR_TOKEN_STREAM_WRONG_SPAN",
        severity: "error",
        message: `Token '${actualToken.name}' has an unexpected source span.`,
        span: actualToken.span,
        related: [{
          message: "Expected span.",
          span: expectedToken.span,
        }],
      });
    }
  }
  return diagnostics;
}

function applyLayout(
  tokens: readonly GrammarLexToken[],
  options: GrammarLayoutOptions,
  preserveTrivia: boolean,
  diagnostics: Diagnostic[],
): readonly GrammarLexToken[] {
  const output: GrammarLexToken[] = [];
  const indents = [0];
  let delimiterDepth = 0;
  const openTokens = new Set(options.openTokens);
  const closeTokens = new Set(options.closeTokens);
  for (const token of tokens) {
    if (token.kind === "eof") {
      while (indents.length > 1) {
        indents.pop();
        output.push(virtualToken(options.dedentToken, token.span));
      }
      output.push(token);
      continue;
    }
    if (token.kind === "trivia") {
      if (preserveTrivia) {
        output.push(token);
      }
      if (delimiterDepth === 0) {
        applyLayoutTrivia(token, options, indents, output, diagnostics);
      }
      continue;
    }
    if (closeTokens.has(token.name) && delimiterDepth > 0) {
      delimiterDepth--;
    }
    output.push(token);
    if (openTokens.has(token.name)) {
      delimiterDepth++;
    }
  }
  return output;
}

function applyLayoutTrivia(
  token: GrammarLexToken,
  options: GrammarLayoutOptions,
  indents: number[],
  output: GrammarLexToken[],
  diagnostics: Diagnostic[],
): void {
  const newlineIndex = token.text.lastIndexOf("\n");
  if (newlineIndex < 0) {
    return;
  }
  const newlineStart = token.span.start + newlineIndex;
  const newlineSpan = {
    start: newlineStart,
    end: newlineStart + 1,
    line: token.span.line,
    column: token.span.column + newlineIndex,
  };
  output.push(virtualToken(options.newlineToken, newlineSpan));
  const indentText = token.text.slice(newlineIndex + 1);
  const indent = indentationWidth(indentText, options);
  const current = indents[indents.length - 1];
  if (indent > current) {
    indents.push(indent);
    output.push(virtualToken(options.indentToken, zeroWidthLayoutSpan(token)));
    return;
  }
  while (indent < indents[indents.length - 1] && indents.length > 1) {
    indents.pop();
    output.push(virtualToken(options.dedentToken, zeroWidthLayoutSpan(token)));
  }
  if (indent !== indents[indents.length - 1]) {
    diagnostics.push({
      code: "GRAMMAR_LAYOUT_INCONSISTENT_INDENT",
      severity: "error",
      message: "Indentation does not match any active layout level.",
      span: zeroWidthLayoutSpan(token),
    });
  }
}

function indentationWidth(
  text: string,
  options: GrammarLayoutOptions,
): number {
  let width = 0;
  let tabSize = 8;
  if (options.tabSize !== undefined) {
    tabSize = options.tabSize;
  }
  for (const char of text) {
    if (char === " ") {
      width++;
    } else if (char === "\t") {
      const remainder = width % tabSize;
      width += tabSize - remainder;
    }
  }
  return width;
}

function virtualToken(name: string, span: SourceSpan): GrammarLexToken {
  return {
    kind: "token",
    name,
    text: "",
    channel: "main",
    mode: "layout",
    span,
  };
}

function zeroWidthLayoutSpan(token: GrammarLexToken): SourceSpan {
  return {
    start: token.span.end,
    end: token.span.end,
    line: token.span.line,
    column: token.span.column + token.text.length,
  };
}

function lexerSpecForToken(
  analyzed: AnalyzedGrammar,
  token: AnalyzedGrammarToken,
  diagnostics: Diagnostic[],
): GrammarLexerSpec {
  let channel = "main";
  if (token.kind === "skip") {
    channel = "trivia";
  }
  if (token.channel !== undefined) {
    channel = token.channel;
  }
  let transition: GrammarLexerTransition | undefined;
  if (token.transition !== undefined) {
    if (token.transition.kind === "pop") {
      transition = { kind: "pop" };
    } else {
      const targetModeName = token.transition.mode;
      const mode = analyzed.modes.find((candidate) =>
        candidate.name === targetModeName
      );
      if (mode === undefined) {
        diagnostics.push({
          code: "GRAMMAR_UNKNOWN_MODE",
          severity: "error",
          message: `Unknown lexer mode '${targetModeName}'.`,
          span: token.transition.span,
        });
      } else if (token.transition.kind === "push") {
        transition = { kind: "push", modeId: mode.id };
      } else {
        transition = { kind: "mode", modeId: mode.id };
      }
    }
  }
  return {
    tokenId: token.id,
    name: token.name,
    kind: token.kind,
    channel,
    transition,
    span: token.span,
  };
}

function scanMode(
  mode: GrammarLexerModePlan,
  source: string,
  offset: number,
): {
  readonly specIndex: number;
  readonly end: number;
  readonly candidates: readonly GrammarLexerSpec[];
} | undefined {
  let stateId = mode.dfa.start;
  let cursor = offset;
  let bestState: number | undefined;
  let bestEnd = offset;
  while (cursor < source.length) {
    const codePoint = source.codePointAt(cursor);
    if (codePoint === undefined) {
      break;
    }
    const state = mode.dfa.states[stateId];
    const transition = state.transitions.find((candidate) =>
      candidate.start <= codePoint && codePoint <= candidate.end
    );
    if (transition === undefined) {
      break;
    }
    stateId = transition.target;
    cursor = nextOffset(source, cursor);
    const nextState = mode.dfa.states[stateId];
    if (nextState.accepts.length > 0) {
      bestState = stateId;
      bestEnd = cursor;
    }
  }
  if (bestState === undefined) {
    return undefined;
  }
  const state = mode.dfa.states[bestState];
  const candidates = sortedAcceptSpecs(mode, state.accepts);
  const selected = selectGlobalSpec(candidates);
  if (selected === undefined) {
    return undefined;
  }
  return {
    specIndex: mode.specs.indexOf(selected),
    end: bestEnd,
    candidates,
  };
}

function sortedAcceptSpecs(
  mode: GrammarLexerModePlan,
  accepts: readonly number[],
): readonly GrammarLexerSpec[] {
  return accepts.map((accept) => {
    const spec = mode.specs[accept];
    if (spec === undefined) {
      throw new Error(`Missing lexer spec ${accept} in mode '${mode.name}'.`);
    }
    return spec;
  }).sort(compareLexerSpecs);
}

function selectGlobalSpec(
  candidates: readonly GrammarLexerSpec[],
): GrammarLexerSpec | undefined {
  for (const candidate of candidates) {
    if (candidate.kind !== "contextual") {
      return candidate;
    }
  }
  return candidates[0];
}

function compareLexerSpecs(
  left: GrammarLexerSpec,
  right: GrammarLexerSpec,
): number {
  const leftRank = lexerSpecRank(left);
  const rightRank = lexerSpecRank(right);
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  return left.tokenId - right.tokenId;
}

function lexerSpecRank(spec: GrammarLexerSpec): number {
  if (spec.kind === "skip") {
    return 3;
  }
  if (spec.kind === "contextual") {
    return 2;
  }
  if (spec.channel === "trivia") {
    return 3;
  }
  return 1;
}

function applyTransition(
  plan: GrammarLexerPlan,
  checkpoint: GrammarLexerCheckpoint,
  transition: GrammarLexerTransition | undefined,
  offset: number,
  span: SourceSpan,
  diagnostics: Diagnostic[],
): GrammarLexerCheckpoint {
  const stack = [...checkpoint.modeStack];
  if (transition === undefined) {
    return { offset, modeStack: stack };
  }
  if (transition.kind === "push") {
    modeForId(plan, transition.modeId);
    stack.push(transition.modeId);
  } else if (transition.kind === "mode") {
    modeForId(plan, transition.modeId);
    stack[stack.length - 1] = transition.modeId;
  } else if (stack.length > 1) {
    stack.pop();
  } else {
    diagnostics.push({
      code: "GRAMMAR_LEX_MODE_STACK_UNDERFLOW",
      severity: "error",
      message: "Lexer mode pop cannot remove the default mode.",
      span,
    });
  }
  return { offset, modeStack: stack };
}

function initialCheckpoint(
  plan: GrammarLexerPlan,
  checkpoint: GrammarLexerCheckpoint | undefined,
): GrammarLexerCheckpoint {
  if (checkpoint !== undefined) {
    if (checkpoint.modeStack.length === 0) {
      throw new Error("Lexer checkpoint requires at least one mode.");
    }
    for (const modeId of checkpoint.modeStack) {
      modeForId(plan, modeId);
    }
    return {
      offset: checkpoint.offset,
      modeStack: [...checkpoint.modeStack],
    };
  }
  return { offset: 0, modeStack: [plan.defaultMode] };
}

function modeForId(
  plan: GrammarLexerPlan,
  modeId: GrammarModeId,
): GrammarLexerModePlan {
  const mode = plan.modes.find((candidate) => candidate.id === modeId);
  if (mode === undefined) {
    throw new Error(`Unknown lexer mode id ${modeId}.`);
  }
  return mode;
}

function patternDiagnostic(
  token: AnalyzedGrammarToken,
  error: unknown,
): Diagnostic {
  let message = `Token '${token.name}' has an invalid pattern.`;
  if (error instanceof Error) {
    message = `Token '${token.name}' has an invalid pattern: ${error.message}`;
  }
  return {
    code: "GRAMMAR_INVALID_TOKEN_PATTERN",
    severity: "error",
    message,
    span: token.pattern.span,
  };
}

function literalRegexAst(value: string): ReturnType<typeof parsePortableRegex> {
  const escaped = value.replace(/[\\/[|(){}*+?.^$]/g, "\\$&");
  return parsePortableRegex(escaped);
}

function createSourceMap(source: string): SourceMap {
  const lineStarts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source.charCodeAt(index) === 10) {
      lineStarts.push(index + 1);
    }
  }
  return { source, lineStarts };
}

function spanFor(sourceMap: SourceMap, start: number, end: number): SourceSpan {
  const lineIndex = lineIndexForOffset(sourceMap.lineStarts, start);
  return {
    start,
    end,
    line: lineIndex + 1,
    column: start - sourceMap.lineStarts[lineIndex] + 1,
  };
}

function lineIndexForOffset(
  lineStarts: readonly number[],
  offset: number,
): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const start = lineStarts[middle];
    if (start <= offset) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return high;
}

function nextOffset(source: string, offset: number): number {
  const codePoint = source.codePointAt(offset);
  if (codePoint === undefined) {
    return offset + 1;
  }
  if (codePoint > 0xffff) {
    return offset + 2;
  }
  return offset + 1;
}
