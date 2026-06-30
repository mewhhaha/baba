import type { Diagnostic } from "../ast.ts";
import {
  buildGrammarTokenCst,
  type GrammarCstBuildResult,
  type GrammarCstSchema,
} from "./grammar_cst.ts";
import {
  type GrammarLexerCheckpoint,
  type GrammarLexerPlan,
  type GrammarLexToken,
  lexGrammar,
} from "./grammar_lexer.ts";

export interface GrammarTextEdit {
  readonly start: number;
  readonly oldEnd: number;
  readonly newText: string;
}

export interface GrammarIncrementalParser {
  parseInitial(source: string): GrammarIncrementalState;
  applyEdits(
    state: GrammarIncrementalState,
    edits: readonly GrammarTextEdit[],
    options?: GrammarIncrementalParseOptions,
  ): GrammarIncrementalResult;
}

export interface GrammarIncrementalParseOptions {
  readonly maxRelexBytes?: number;
  readonly maxReparseNodes?: number;
  readonly cancel?: () => boolean;
}

export interface GrammarIncrementalState {
  readonly source: string;
  readonly tree: GrammarCstBuildResult["root"];
  readonly diagnostics: readonly Diagnostic[];
  readonly tokens: readonly GrammarLexToken[];
  readonly checkpoints: readonly GrammarLexerCheckpoint[];
}

export interface GrammarIncrementalResult extends GrammarIncrementalState {
  readonly changedRanges: readonly GrammarChangedRange[];
  readonly relexedRange: GrammarChangedRange;
  readonly reparsedRange: GrammarChangedRange;
  readonly reusedNodeCount: number;
  readonly cancelled: boolean;
}

export interface GrammarChangedRange {
  readonly start: number;
  readonly end: number;
}

export function createGrammarIncrementalParser(
  schema: GrammarCstSchema,
  lexer: GrammarLexerPlan,
): GrammarIncrementalParser {
  return {
    parseInitial(source: string): GrammarIncrementalState {
      return parseFull(schema, lexer, source);
    },
    applyEdits(
      state: GrammarIncrementalState,
      edits: readonly GrammarTextEdit[],
      options: GrammarIncrementalParseOptions = {},
    ): GrammarIncrementalResult {
      if (options.cancel !== undefined && options.cancel()) {
        const emptyRange = { start: 0, end: 0 };
        return {
          ...state,
          changedRanges: [],
          relexedRange: emptyRange,
          reparsedRange: emptyRange,
          reusedNodeCount: 0,
          cancelled: true,
        };
      }
      const nextSource = applyTextEdits(state.source, edits);
      const changedRanges = changedRangesForEdits(edits);
      const relexedRange = relexedRangeForEdits(
        state,
        edits,
        nextSource,
        options,
      );
      const next = parseFull(schema, lexer, nextSource);
      return {
        ...next,
        changedRanges,
        relexedRange,
        reparsedRange: relexedRange,
        reusedNodeCount: countReusableTokens(state.tokens, next.tokens, edits),
        cancelled: false,
      };
    },
  };
}

export function applyGrammarTextEdits(
  source: string,
  edits: readonly GrammarTextEdit[],
): string {
  return applyTextEdits(source, edits);
}

function parseFull(
  schema: GrammarCstSchema,
  lexer: GrammarLexerPlan,
  source: string,
): GrammarIncrementalState {
  const lexed = lexGrammar(lexer, source, { preserveTrivia: true });
  const cst = buildGrammarTokenCst(schema, lexer, source);
  return {
    source,
    tree: cst.root,
    diagnostics: cst.diagnostics,
    tokens: lexed.tokens,
    checkpoints: lexed.checkpoints,
  };
}

function applyTextEdits(
  source: string,
  edits: readonly GrammarTextEdit[],
): string {
  let output = source;
  const ordered = [...edits].sort((left, right) => right.start - left.start);
  for (const edit of ordered) {
    if (
      edit.start < 0 || edit.oldEnd < edit.start || edit.oldEnd > output.length
    ) {
      throw new Error("Invalid grammar text edit range.");
    }
    output = `${output.slice(0, edit.start)}${edit.newText}${
      output.slice(edit.oldEnd)
    }`;
  }
  return output;
}

function changedRangesForEdits(
  edits: readonly GrammarTextEdit[],
): readonly GrammarChangedRange[] {
  return edits.map((edit) => ({
    start: edit.start,
    end: edit.start + edit.newText.length,
  }));
}

function relexedRangeForEdits(
  state: GrammarIncrementalState,
  edits: readonly GrammarTextEdit[],
  nextSource: string,
  options: GrammarIncrementalParseOptions,
): GrammarChangedRange {
  if (edits.length === 0) {
    return { start: 0, end: 0 };
  }
  let start = edits[0].start;
  let end = edits[0].start + edits[0].newText.length;
  for (const edit of edits) {
    if (edit.start < start) {
      start = edit.start;
    }
    const editEnd = edit.start + edit.newText.length;
    if (editEnd > end) {
      end = editEnd;
    }
  }
  let checkpointStart = 0;
  for (const checkpoint of state.checkpoints) {
    if (checkpoint.offset <= start) {
      checkpointStart = checkpoint.offset;
    }
  }
  let maxRelexBytes = 4096;
  if (options.maxRelexBytes !== undefined) {
    maxRelexBytes = options.maxRelexBytes;
  }
  let boundedEnd = nextSource.length;
  if (checkpointStart + maxRelexBytes < boundedEnd) {
    boundedEnd = checkpointStart + maxRelexBytes;
  }
  if (boundedEnd < end) {
    boundedEnd = end;
  }
  return { start: checkpointStart, end: boundedEnd };
}

function countReusableTokens(
  previous: readonly GrammarLexToken[],
  next: readonly GrammarLexToken[],
  edits: readonly GrammarTextEdit[],
): number {
  if (edits.length === 0) {
    return previous.length;
  }
  let changedStart = edits[0].start;
  let changedOldEnd = edits[0].oldEnd;
  for (const edit of edits) {
    if (edit.start < changedStart) {
      changedStart = edit.start;
    }
    if (edit.oldEnd > changedOldEnd) {
      changedOldEnd = edit.oldEnd;
    }
  }
  let count = 0;
  const limit = Math.min(previous.length, next.length);
  for (let index = 0; index < limit; index++) {
    const left = previous[index];
    const right = next[index];
    if (left.span.end > changedStart && left.span.start < changedOldEnd) {
      continue;
    }
    if (left.name === right.name && left.text === right.text) {
      count++;
    }
  }
  return count;
}
