export function emitPublicSourceTextBoundary(): string {
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

function sourceTextCodePointAt(
  sourceText: SourceTextBoundary,
  offset: number,
): number | undefined {
  return sourceText.source.codePointAt(offset);
}`;
}
