export function emitPublicDiagnosticMaterializer(): string {
  return `function combineDiagnostics(
  left: readonly ParseDiagnostic[],
  right: readonly ParseDiagnostic[],
): readonly ParseDiagnostic[] {
  if (left.length === 0) return right;
  if (right.length === 0) return left;
  return [...left, ...right];
}

function parseDiagnostic(
  code: ParseDiagnostic["code"],
  message: string,
  span: Span,
  detail = 0,
): ParseDiagnostic {
  const expectedCode = diagnosticCodeId(code);
  const handle = parserDiagnosticNew(
    expectedCode,
    span.start,
    span.end,
    detail,
  );
  if (parserDiagnosticCode(handle) !== expectedCode) {
    throw new Error("Runtime diagnostic code mismatch.");
  }
  return {
    code,
    message,
    span: diagnosticSpan(handle),
    runtimeCode: parserDiagnosticCode(handle),
    runtimeDetail: parserDiagnosticDetail(handle),
    runtimeDetailKind: diagnosticDetailKind(expectedCode),
  };
}

function diagnosticCodeId(code: ParseDiagnostic["code"]): number {
  switch (code) {
    case "PARSE_LEXICAL_ERROR":
      return DIAGNOSTIC_PARSE_LEXICAL_ERROR;
    case "PARSE_UNEXPECTED_TOKEN":
      return DIAGNOSTIC_PARSE_UNEXPECTED_TOKEN;
    case "PARSE_TRAILING_INPUT":
      return DIAGNOSTIC_PARSE_TRAILING_INPUT;
    case "PARSE_INVALID_TOKEN_STREAM":
      return DIAGNOSTIC_PARSE_INVALID_TOKEN_STREAM;
    case "PARSER_INTERNAL_ERROR":
      return DIAGNOSTIC_PARSER_INTERNAL_ERROR;
    case "PARSER_BRANCH_LIMIT":
      return DIAGNOSTIC_PARSER_BRANCH_LIMIT;
  }
}

function diagnosticDetailKind(
  runtimeCode: number,
): ParseDiagnostic["runtimeDetailKind"] {
  switch (runtimeCode) {
    case DIAGNOSTIC_PARSE_UNEXPECTED_TOKEN:
    case DIAGNOSTIC_PARSE_TRAILING_INPUT:
      return "parser-state";
    default:
      return "none";
  }
}

function diagnosticSpan(handle: number): Span {
  return {
    start: parserDiagnosticSpanStart(handle),
    end: parserDiagnosticSpanEnd(handle),
  };
}

function lexicalDiagnostics(
  diagnostics: readonly LexDiagnostic[],
): readonly ParseDiagnostic[] {
  if (diagnostics.length === 0) return EMPTY_PARSE_DIAGNOSTICS;
  const parsed: ParseDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    parsed.push(lexicalDiagnostic(diagnostic));
  }
  return parsed;
}

function lexicalTokenDiagnostics(
  tokens: readonly Token[],
): readonly ParseDiagnostic[] {
  let diagnostics: ParseDiagnostic[] | null = null;
  for (const token of tokens) {
    const terminal = tokenToTerminal(token);
    const status = lexerTokenDiagnosticStatus(
      publicTokenClass(token),
      terminal < 0 ? NO_TERMINAL : terminal,
    );
    if (status === LEXICAL_TOKEN_OK) {
      continue;
    }
    diagnostics ??= [];
    diagnostics.push(lexicalTokenDiagnostic(token));
  }
  return diagnostics ?? EMPTY_PARSE_DIAGNOSTICS;
}

function expectedTerminals(state: number): readonly string[] {
  const start = parserExpectedStart(state);
  const end = parserExpectedEnd(state);
  if (end <= start) return [];
  return EXPECTED_TERMINALS.slice(start, end);
}

function unexpectedTokenDiagnostic(token: Token, state: number): ParseDiagnostic {
  const expected = expectedTerminals(state);
  const found = tokenDisplay(token);
  const code = parserExpectedHasEof(state) !== 0 && token.type !== "eof"
    ? "PARSE_TRAILING_INPUT"
    : "PARSE_UNEXPECTED_TOKEN";
  return {
    ...parseDiagnostic(
      code,
      \`Unexpected token \${found}.\`,
      token.span,
      state,
    ),
    expected,
    found,
  };
}

function lexicalTokenDiagnostic(token: Token): ParseDiagnostic {
  if (token.type === "error") {
    return {
      ...parseDiagnostic(
        "PARSE_LEXICAL_ERROR",
        \`Unexpected character \${JSON.stringify(token.text)}.\`,
        token.span,
      ),
      found: JSON.stringify(token.text),
    };
  }
  return {
    ...parseDiagnostic(
      "PARSE_LEXICAL_ERROR",
      \`Token \${tokenDisplay(token)} is not part of this parser's terminal set.\`,
      token.span,
    ),
    found: tokenDisplay(token),
  };
}

function invalidTokenStream(message: string, span: Span): ParseDiagnostic {
  return parseDiagnostic("PARSE_INVALID_TOKEN_STREAM", message, span);
}

function internalParserDiagnostic(error: unknown, span: Span): ParseDiagnostic {
  return parserInternalMessageDiagnostic(
    error instanceof Error ? error.message : String(error),
    span,
  );
}

function parserInternalMessageDiagnostic(
  message: string,
  span: Span,
): ParseDiagnostic {
  return parseDiagnostic("PARSER_INTERNAL_ERROR", message, span);
}

function branchLimitDiagnostic(offset: number): ParseDiagnostic {
  return parseDiagnostic(
    "PARSER_BRANCH_LIMIT",
    "Parser exceeded the branch exploration limit.",
    { start: offset, end: offset },
  );
}

function tokenDisplay(token: Token): string {
  if (token.type === "eof") return "EOF";
  if (token.type === "named") return token.kind;
  if (token.type === "literal") return JSON.stringify(token.literal);
  return JSON.stringify(token.text);
}

function lexicalDiagnostic(diagnostic: LexDiagnostic): ParseDiagnostic {
  return parseDiagnostic(
    "PARSE_LEXICAL_ERROR",
    diagnostic.message,
    diagnostic.span,
  );
}

function currentSpan(token: Token): Span {
  return token.span;
}`;
}
