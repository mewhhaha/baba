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

function createSourceTextBoundary(source: string): SourceTextBoundary {
  return {
    source,
    length: source.length,
  };
}

function sourceTextSlice(sourceText: SourceTextBoundary, span: Span): string {
  return sourceText.source.slice(span.start, span.end);
}

function sourceTextMatches(
  sourceText: SourceTextBoundary,
  span: Span,
  text: string,
): boolean {
  return text === sourceTextSlice(sourceText, span);
}

${
    options.includeCodePoint
      ? `function sourceTextCodePointAt(
  sourceText: SourceTextBoundary,
  offset: number,
): number {
  const leadUnit = sourceTextCodeUnitAt(sourceText, offset);
  const trailOffset = offset + 1;
  const hasTrail = utf16HasCodeUnit(trailOffset, sourceText.length);
  const trailUnit = hasTrail === 1
    ? sourceTextCodeUnitAt(sourceText, trailOffset)
    : 0;
  return utf16CodePointFromUnits(leadUnit, trailUnit, hasTrail);
}

`
      : ""
  }function sourceTextCodeUnitAt(
  sourceText: SourceTextBoundary,
  offset: number,
): number {
  const normalized = offset >>> 0;
  if (normalized >= sourceText.length) {
    throw new Error("Source text offset out of bounds.");
  }
  return sourceText.source.charCodeAt(normalized) >>> 0;
}`;
}
