export interface PublicTokenMaterializerOptions {
  readonly label: string;
}

export function emitPublicTokenMaterializer(
  options: PublicTokenMaterializerOptions,
): string {
  const label = JSON.stringify(options.label);
  return `interface RuntimeTerminalToken {
  __babaTerminal?: number;
}

function materializeToken(
  sourceText: SourceTextBoundary,
  handle: number,
): Token {
  const tokenClass = parserTokenClass(handle);
  const payload = parserTokenPayload(handle);
  const span = {
    start: parserTokenSpanStart(handle),
    end: parserTokenSpanEnd(handle),
  };
  const terminal = parserTokenTerminal(handle);

  if (tokenClass === PUBLIC_TOKEN_LITERAL) {
    const spec = LITERAL_SPECS[payload];
    if (!spec) {
      throw new Error(${label} + " runtime emitted an invalid literal token.");
    }
    return attachRuntimeTerminal({
      type: "literal",
      literal: spec.literal as never,
      text: spec.literal as never,
      span,
      channel: "main",
    } as Token, terminal);
  }
  if (tokenClass === PUBLIC_TOKEN_MAIN || tokenClass === PUBLIC_TOKEN_TRIVIA) {
    const spec = NAMED_SPECS[payload];
    if (!spec) {
      throw new Error(${label} + " runtime emitted an invalid named token.");
    }
    return attachRuntimeTerminal({
      type: "named",
      kind: spec.kind as never,
      text: sourceTextSlice(sourceText, span),
      span,
      channel: tokenClass === PUBLIC_TOKEN_TRIVIA ? "trivia" : "main",
    } as Token, terminal);
  }
  if (tokenClass === PUBLIC_TOKEN_ERROR) {
    return {
      type: "error",
      text: sourceTextSlice(sourceText, span),
      span,
      channel: "error",
    };
  }
  if (tokenClass === PUBLIC_TOKEN_EOF) {
    return {
      type: "eof",
      text: "",
      span,
      channel: "main",
    };
  }
  throw new Error(${label} + " runtime emitted an unknown public token class.");
}

function attachRuntimeTerminal(token: Token, terminal: number): Token & RuntimeTerminalToken {
  Object.defineProperty(token, "__babaTerminal", {
    value: terminal === NO_TERMINAL ? -1 : terminal,
    enumerable: false,
  });
  return token as Token & RuntimeTerminalToken;
}`;
}

export function emitPublicEofTokenMaterializer(): string {
  return `
function materializeEofToken(offset: number): Token {
  const handle = parserTokenNew(
    PUBLIC_TOKEN_EOF,
    0,
    EOF_TERMINAL,
    offset,
    offset,
  );
  return {
    type: "eof",
    text: "",
    span: {
      start: parserTokenSpanStart(handle),
      end: parserTokenSpanEnd(handle),
    },
    channel: "main",
  };
}

function materializeSourceEofToken(sourceText: SourceTextBoundary): Token {
  return materializeEofToken(sourceText.length);
}`;
}
