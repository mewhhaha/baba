export function emitPublicLexResultMaterializer(): string {
  return `function lexResult(
  source: string,
  tokens: readonly Token[],
  diagnostics: readonly LexDiagnostic[],
): LexResult {
  return { source, tokens, diagnostics };
}`;
}
