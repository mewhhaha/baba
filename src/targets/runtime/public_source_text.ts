import {
  RUNTIME_SOURCE_TEXT_OFFSET_STATUS_OK,
  RUNTIME_SOURCE_TEXT_SPAN_STATUS_OK,
} from "./language_sources.ts";

export interface PublicSourceTextBoundaryOptions {
  readonly includeCodePoint?: boolean;
}

export function emitPublicSourceTextBoundary(
  options: PublicSourceTextBoundaryOptions = {},
): string {
  return `interface SourceTextBoundary {
  readonly source: string;
  readonly length: number;
}

const SOURCE_TEXT_OFFSET_OK = ${RUNTIME_SOURCE_TEXT_OFFSET_STATUS_OK};
const SOURCE_TEXT_SPAN_OK = ${RUNTIME_SOURCE_TEXT_SPAN_STATUS_OK};

function createSourceTextBoundary(source: string): SourceTextBoundary {
  return {
    source,
    length: source.length,
  };
}

function sourceTextSlice(sourceText: SourceTextBoundary, span: Span): string {
  if (
    sourceTextSpanStatus(span.start, span.end, sourceText.length) !==
      SOURCE_TEXT_SPAN_OK
  ) {
    throw new Error("Source text span out of bounds.");
  }
  return sourceText.source.slice(span.start, span.end);
}

function sourceTextMatches(
  sourceText: SourceTextBoundary,
  span: Span,
  text: string,
): boolean {
  if (
    sourceTextSpanStatus(span.start, span.end, sourceText.length) !==
      SOURCE_TEXT_SPAN_OK
  ) {
    return false;
  }
  return text === sourceTextSlice(sourceText, span);
}

${
    options.includeCodePoint
      ? `function sourceTextCodePointAt(
  sourceText: SourceTextBoundary,
  offset: number,
): number {
  const leadUnit = sourceTextCodeUnitAt(sourceText, offset);
  const trailOffset = sourceTextTrailOffset(offset);
  const hasTrail = sourceTextHasTrailUnit(offset, sourceText.length);
  const trailUnit = hasTrail === 1
    ? sourceTextCodeUnitAt(sourceText, trailOffset)
    : 0;
  return sourceTextCodePointFromUnits(leadUnit, trailUnit, hasTrail);
}

`
      : ""
  }function sourceTextCodeUnitAt(
  sourceText: SourceTextBoundary,
  offset: number,
): number {
  const normalized = offset >>> 0;
  if (
    sourceTextOffsetStatus(normalized, sourceText.length) !==
      SOURCE_TEXT_OFFSET_OK
  ) {
    throw new Error("Source text offset out of bounds.");
  }
  return sourceText.source.charCodeAt(normalized) >>> 0;
}`;
}
