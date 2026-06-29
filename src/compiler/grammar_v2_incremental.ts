import type { Diagnostic } from "../ast.ts";
import {
  buildGrammarV2TokenCst,
  type GrammarV2CstBuildResult,
  type GrammarV2CstSchema,
} from "./grammar_v2_cst.ts";
import {
  type GrammarV2LexerCheckpoint,
  type GrammarV2LexerPlan,
  type GrammarV2LexToken,
  lexGrammarV2,
} from "./grammar_v2_lexer.ts";

export interface GrammarV2TextEdit {
  readonly start: number;
  readonly oldEnd: number;
  readonly newText: string;
}

export interface GrammarV2IncrementalParser {
  parseInitial(source: string): GrammarV2IncrementalState;
  applyEdits(
    state: GrammarV2IncrementalState,
    edits: readonly GrammarV2TextEdit[],
    options?: GrammarV2IncrementalParseOptions,
  ): GrammarV2IncrementalResult;
}

export interface GrammarV2IncrementalParseOptions {
  readonly maxRelexBytes?: number;
  readonly maxReparseNodes?: number;
  readonly cancel?: () => boolean;
}

export interface GrammarV2IncrementalState {
  readonly source: string;
  readonly tree: GrammarV2CstBuildResult["root"];
  readonly diagnostics: readonly Diagnostic[];
  readonly tokens: readonly GrammarV2LexToken[];
  readonly checkpoints: readonly GrammarV2LexerCheckpoint[];
}

export interface GrammarV2IncrementalResult extends GrammarV2IncrementalState {
  readonly changedRanges: readonly GrammarV2ChangedRange[];
  readonly relexedRange: GrammarV2ChangedRange;
  readonly reparsedRange: GrammarV2ChangedRange;
  readonly reusedNodeCount: number;
  readonly cancelled: boolean;
}

export interface GrammarV2ChangedRange {
  readonly start: number;
  readonly end: number;
}

export function createGrammarV2IncrementalParser(
  schema: GrammarV2CstSchema,
  lexer: GrammarV2LexerPlan,
): GrammarV2IncrementalParser {
  return {
    parseInitial(source: string): GrammarV2IncrementalState {
      return parseFull(schema, lexer, source);
    },
    applyEdits(
      state: GrammarV2IncrementalState,
      edits: readonly GrammarV2TextEdit[],
      options: GrammarV2IncrementalParseOptions = {},
    ): GrammarV2IncrementalResult {
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

export function applyGrammarV2TextEdits(
  source: string,
  edits: readonly GrammarV2TextEdit[],
): string {
  return applyTextEdits(source, edits);
}

function parseFull(
  schema: GrammarV2CstSchema,
  lexer: GrammarV2LexerPlan,
  source: string,
): GrammarV2IncrementalState {
  const lexed = lexGrammarV2(lexer, source, { preserveTrivia: true });
  const cst = buildGrammarV2TokenCst(schema, lexer, source);
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
  edits: readonly GrammarV2TextEdit[],
): string {
  let output = source;
  const ordered = [...edits].sort((left, right) => right.start - left.start);
  for (const edit of ordered) {
    if (
      edit.start < 0 || edit.oldEnd < edit.start || edit.oldEnd > output.length
    ) {
      throw new Error("Invalid grammar v2 text edit range.");
    }
    output = `${output.slice(0, edit.start)}${edit.newText}${
      output.slice(edit.oldEnd)
    }`;
  }
  return output;
}

function changedRangesForEdits(
  edits: readonly GrammarV2TextEdit[],
): readonly GrammarV2ChangedRange[] {
  return edits.map((edit) => ({
    start: edit.start,
    end: edit.start + edit.newText.length,
  }));
}

function relexedRangeForEdits(
  state: GrammarV2IncrementalState,
  edits: readonly GrammarV2TextEdit[],
  nextSource: string,
  options: GrammarV2IncrementalParseOptions,
): GrammarV2ChangedRange {
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
  previous: readonly GrammarV2LexToken[],
  next: readonly GrammarV2LexToken[],
  edits: readonly GrammarV2TextEdit[],
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
