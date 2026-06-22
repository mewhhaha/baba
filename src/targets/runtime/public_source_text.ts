export function emitPublicSourceTextBoundary(): string {
  return `function sourceTextSlice(source: string, span: Span): string {
  return source.slice(span.start, span.end);
}

function sourceTextMatches(source: string, span: Span, text: string): boolean {
  return text === sourceTextSlice(source, span);
}`;
}
