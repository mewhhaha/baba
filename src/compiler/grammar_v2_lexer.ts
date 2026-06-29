import type { Diagnostic, SourceSpan } from "../ast.ts";
import type {
  AnalyzedGrammarV2,
  AnalyzedGrammarV2Token,
  GrammarV2ModeId,
} from "./grammar_v2_ir.ts";
import type { Dfa } from "./regex/dfa.ts";
import { parsePortableRegex } from "./regex/parser.ts";
import { buildLexerDfa, type LexerRegexSpec } from "./regex/lexer.ts";

export interface GrammarV2LexerPlan {
  readonly modes: readonly GrammarV2LexerModePlan[];
  readonly defaultMode: GrammarV2ModeId;
  readonly diagnostics: readonly Diagnostic[];
}

export interface GrammarV2LexerModePlan {
  readonly id: GrammarV2ModeId;
  readonly name: string;
  readonly specs: readonly GrammarV2LexerSpec[];
  readonly dfa: Dfa;
}

export interface GrammarV2LexerSpec {
  readonly tokenId: number;
  readonly name: string;
  readonly kind: "token" | "skip" | "contextual";
  readonly channel: string;
  readonly transition: GrammarV2LexerTransition | undefined;
  readonly span: SourceSpan;
}

export type GrammarV2LexerTransition =
  | { readonly kind: "push"; readonly modeId: GrammarV2ModeId }
  | { readonly kind: "mode"; readonly modeId: GrammarV2ModeId }
  | { readonly kind: "pop" };

export interface GrammarV2LexOptions {
  readonly preserveTrivia?: boolean;
  readonly checkpoint?: GrammarV2LexerCheckpoint;
  readonly layout?: GrammarV2LayoutOptions;
}

export interface GrammarV2LayoutOptions {
  readonly newlineToken: string;
  readonly indentToken: string;
  readonly dedentToken: string;
  readonly openTokens?: readonly string[];
  readonly closeTokens?: readonly string[];
  readonly tabSize?: number;
}

export interface GrammarV2TokenStreamValidationOptions {
  readonly preserveTrivia?: boolean;
  readonly layout?: GrammarV2LayoutOptions;
}

export interface GrammarV2LexResult {
  readonly tokens: readonly GrammarV2LexToken[];
  readonly diagnostics: readonly Diagnostic[];
  readonly checkpoints: readonly GrammarV2LexerCheckpoint[];
  readonly candidateSites: readonly GrammarV2LexCandidateSite[];
  readonly finalCheckpoint: GrammarV2LexerCheckpoint;
}

export interface GrammarV2LexCandidateSite {
  readonly tokenIndex: number;
  readonly candidates: readonly GrammarV2LexCandidate[];
}

export interface GrammarV2LexCandidate {
  readonly tokenId: number;
  readonly name: string;
  readonly contextual: boolean;
  readonly channel: string;
}

export interface GrammarV2LexToken {
  readonly kind: "token" | "trivia" | "error" | "eof";
  readonly name: string;
  readonly text: string;
  readonly channel: string;
  readonly mode: string;
  readonly span: SourceSpan;
}

export interface GrammarV2LexerCheckpoint {
  readonly offset: number;
  readonly modeStack: readonly GrammarV2ModeId[];
}

interface SourceMap {
  readonly source: string;
  readonly lineStarts: readonly number[];
}

/** Builds an inspectable grammar-v2 lexer plan with one combined DFA per mode. */
export function buildGrammarV2LexerPlan(
  analyzed: AnalyzedGrammarV2,
): GrammarV2LexerPlan {
  const diagnostics: Diagnostic[] = [];
  const modes: GrammarV2LexerModePlan[] = [];
  for (const mode of analyzed.modes) {
    const tokens = analyzed.tokens.filter((token) => token.modeId === mode.id);
    const specs: GrammarV2LexerSpec[] = [];
    const regexSpecs: LexerRegexSpec[] = [];
    for (const token of tokens) {
      const spec = lexerSpecForToken(analyzed, token, diagnostics);
      specs.push(spec);
      if (token.pattern.kind === "literal") {
        regexSpecs.push({
          ast: literalRegexAst(token.pattern.value),
          type: "literal",
          priority: 0,
          order: token.id,
        });
      } else {
        try {
          regexSpecs.push({
            ast: parsePortableRegex(token.pattern.pattern),
            type: "named",
            priority: 0,
            order: token.id,
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

/** Executes a grammar-v2 lexer plan and optionally resumes from a checkpoint. */
export function lexGrammarV2(
  plan: GrammarV2LexerPlan,
  source: string,
  options: GrammarV2LexOptions = {},
): GrammarV2LexResult {
  const sourceMap = createSourceMap(source);
  const diagnostics: Diagnostic[] = [...plan.diagnostics];
  const tokens: GrammarV2LexToken[] = [];
  const checkpoints: GrammarV2LexerCheckpoint[] = [];
  const candidateSites: GrammarV2LexCandidateSite[] = [];
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
        code: "GRAMMAR_V2_LEX_UNEXPECTED_CHARACTER",
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
      let kind: GrammarV2LexToken["kind"] = "token";
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
  let publicTokens: readonly GrammarV2LexToken[] = tokens;
  if (options.layout !== undefined) {
    publicTokens = applyLayout(
      tokens,
      options.layout,
      preserveTrivia,
      diagnostics,
    );
  }
  let publicCandidateSites: readonly GrammarV2LexCandidateSite[] =
    candidateSites;
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

export function validateGrammarV2TokenStream(
  plan: GrammarV2LexerPlan,
  source: string,
  tokens: readonly GrammarV2LexToken[],
  options: GrammarV2TokenStreamValidationOptions = {},
): readonly Diagnostic[] {
  const expected = lexGrammarV2(plan, source, {
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
        code: "GRAMMAR_V2_TOKEN_STREAM_EXTRA_TOKEN",
        severity: "error",
        message: `Unexpected extra token '${actualToken.name}'.`,
        span: actualToken.span,
      });
      continue;
    }
    if (expectedToken !== undefined && actualToken === undefined) {
      diagnostics.push({
        code: "GRAMMAR_V2_TOKEN_STREAM_MISSING_TOKEN",
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
        code: "GRAMMAR_V2_TOKEN_STREAM_WRONG_KIND",
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
        code: "GRAMMAR_V2_TOKEN_STREAM_WRONG_SPAN",
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
  tokens: readonly GrammarV2LexToken[],
  options: GrammarV2LayoutOptions,
  preserveTrivia: boolean,
  diagnostics: Diagnostic[],
): readonly GrammarV2LexToken[] {
  const output: GrammarV2LexToken[] = [];
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
  token: GrammarV2LexToken,
  options: GrammarV2LayoutOptions,
  indents: number[],
  output: GrammarV2LexToken[],
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
      code: "GRAMMAR_V2_LAYOUT_INCONSISTENT_INDENT",
      severity: "error",
      message: "Indentation does not match any active layout level.",
      span: zeroWidthLayoutSpan(token),
    });
  }
}

function indentationWidth(
  text: string,
  options: GrammarV2LayoutOptions,
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

function virtualToken(name: string, span: SourceSpan): GrammarV2LexToken {
  return {
    kind: "token",
    name,
    text: "",
    channel: "main",
    mode: "layout",
    span,
  };
}

function zeroWidthLayoutSpan(token: GrammarV2LexToken): SourceSpan {
  return {
    start: token.span.end,
    end: token.span.end,
    line: token.span.line,
    column: token.span.column + token.text.length,
  };
}

function lexerSpecForToken(
  analyzed: AnalyzedGrammarV2,
  token: AnalyzedGrammarV2Token,
  diagnostics: Diagnostic[],
): GrammarV2LexerSpec {
  let channel = "main";
  if (token.kind === "skip") {
    channel = "trivia";
  }
  if (token.channel !== undefined) {
    channel = token.channel;
  }
  let transition: GrammarV2LexerTransition | undefined;
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
          code: "GRAMMAR_V2_UNKNOWN_MODE",
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
  mode: GrammarV2LexerModePlan,
  source: string,
  offset: number,
): {
  readonly specIndex: number;
  readonly end: number;
  readonly candidates: readonly GrammarV2LexerSpec[];
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
  mode: GrammarV2LexerModePlan,
  accepts: readonly number[],
): readonly GrammarV2LexerSpec[] {
  return accepts.map((accept) => {
    const spec = mode.specs[accept];
    if (spec === undefined) {
      throw new Error(`Missing lexer spec ${accept} in mode '${mode.name}'.`);
    }
    return spec;
  }).sort(compareLexerSpecs);
}

function selectGlobalSpec(
  candidates: readonly GrammarV2LexerSpec[],
): GrammarV2LexerSpec | undefined {
  for (const candidate of candidates) {
    if (candidate.kind !== "contextual") {
      return candidate;
    }
  }
  return candidates[0];
}

function compareLexerSpecs(
  left: GrammarV2LexerSpec,
  right: GrammarV2LexerSpec,
): number {
  const leftRank = lexerSpecRank(left);
  const rightRank = lexerSpecRank(right);
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  return left.tokenId - right.tokenId;
}

function lexerSpecRank(spec: GrammarV2LexerSpec): number {
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
  plan: GrammarV2LexerPlan,
  checkpoint: GrammarV2LexerCheckpoint,
  transition: GrammarV2LexerTransition | undefined,
  offset: number,
  span: SourceSpan,
  diagnostics: Diagnostic[],
): GrammarV2LexerCheckpoint {
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
      code: "GRAMMAR_V2_LEX_MODE_STACK_UNDERFLOW",
      severity: "error",
      message: "Lexer mode pop cannot remove the default mode.",
      span,
    });
  }
  return { offset, modeStack: stack };
}

function initialCheckpoint(
  plan: GrammarV2LexerPlan,
  checkpoint: GrammarV2LexerCheckpoint | undefined,
): GrammarV2LexerCheckpoint {
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
  plan: GrammarV2LexerPlan,
  modeId: GrammarV2ModeId,
): GrammarV2LexerModePlan {
  const mode = plan.modes.find((candidate) => candidate.id === modeId);
  if (mode === undefined) {
    throw new Error(`Unknown lexer mode id ${modeId}.`);
  }
  return mode;
}

function patternDiagnostic(
  token: AnalyzedGrammarV2Token,
  error: unknown,
): Diagnostic {
  let message = `Token '${token.name}' has an invalid pattern.`;
  if (error instanceof Error) {
    message = `Token '${token.name}' has an invalid pattern: ${error.message}`;
  }
  return {
    code: "GRAMMAR_V2_INVALID_TOKEN_PATTERN",
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
