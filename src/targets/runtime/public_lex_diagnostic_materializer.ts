export function emitPublicLexDiagnosticMaterializer(): string {
  return `function lexUnexpectedCharacterDiagnostic(token: Token): LexDiagnostic {
  if (token.type !== "error") {
    throw new Error("Expected lexical error token.");
  }
  return {
    code: "LEX_UNEXPECTED_CHARACTER",
    message: \`Unexpected character \${JSON.stringify(token.text)}.\`,
    span: token.span,
  };
}`;
}
