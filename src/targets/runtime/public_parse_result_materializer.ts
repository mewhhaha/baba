export function emitPublicParseResultMaterializer(): string {
  return `function successfulParseResult(
  source: string,
  tokens: readonly Token[],
  root: RootNode,
): ParseResult<RootNode> {
  return {
    ok: true,
    root,
    source,
    tokens,
    diagnostics: EMPTY_PARSE_DIAGNOSTICS,
  };
}

function failedParseResult(
  source: string,
  tokens: readonly Token[],
  diagnostics: readonly ParseDiagnostic[],
): ParseResult<RootNode> {
  return {
    ok: false,
    root: null,
    source,
    tokens,
    diagnostics,
  };
}`;
}
