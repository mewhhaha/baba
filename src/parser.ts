import type {
  EbnfExpression,
  EbnfGrammar,
  EbnfRule,
  EbnfTokenDeclaration,
  SourceSpan,
} from "./ast.ts";
import { BabaError } from "./errors.ts";

type TokenKind = "identifier" | "literal" | "regex" | "symbol" | "eof";

interface Token {
  kind: TokenKind;
  text: string;
  span: SourceSpan;
}

/** Syntax error raised while parsing EBNF source. */
export class EbnfError extends BabaError {
  /** One-based source line where the error starts. */
  readonly line: number;
  /** One-based source column where the error starts. */
  readonly column: number;

  /** Creates a parse error with source context. */
  constructor(
    message: string,
    override readonly span: SourceSpan,
    source: string,
  ) {
    super({
      code: "EBNF_PARSE_ERROR",
      message: `${message} at ${span.line}:${span.column}`,
      span,
      sourceLine: getSourceLine(source, span.start),
    });
    this.name = "EbnfError";
    this.line = span.line;
    this.column = span.column;
  }

  /** Zero-based inclusive source offset where the error starts. */
  get start(): number {
    return this.span.start;
  }

  /** Zero-based exclusive source offset where the error ends. */
  get end(): number {
    return this.span.end;
  }
}

/** Parses EBNF source into a span-rich grammar AST. */
export function parseEbnf(source: string): EbnfGrammar {
  return new Parser(source, lexEbnf(source)).parseGrammar();
}

/** Formats an EBNF parse error with source line and caret marker. */
export function formatEbnfError(error: EbnfError): string {
  const markerWidth = Math.max(1, error.span.end - error.span.start);
  const marker = `${" ".repeat(Math.max(0, error.column - 1))}${
    "^".repeat(markerWidth)
  }`;
  return `${error.message}\n${error.sourceLine}\n${marker}`;
}

function lexEbnf(source: string): Token[] {
  const tokens: Token[] = [];
  const lines = createLineStarts(source);
  let i = 0;

  while (i < source.length) {
    const char = source[i];
    if (isWhitespace(char)) {
      i++;
      continue;
    }

    if (char === "#") {
      i++;
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }

    if (char === "/" && source[i + 1] === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }

    const start = i;
    if (char === '"') {
      i++;
      let value = "";
      while (i < source.length && source[i] !== '"') {
        if (source[i] === "\\") {
          const escaped = source[++i];
          if (escaped === undefined) {
            throw new EbnfError(
              "Unterminated escape",
              spanAt(lines, start, i),
              source,
            );
          }
          value += escaped;
          i++;
          continue;
        }
        value += source[i++];
      }
      if (source[i] !== '"') {
        throw new EbnfError(
          "Unterminated string literal",
          spanAt(lines, start, i),
          source,
        );
      }
      i++;
      tokens.push({
        kind: "literal",
        text: value,
        span: spanAt(lines, start, i),
      });
      continue;
    }

    if (char === "/") {
      i++;
      let pattern = "";
      let escaped = false;
      let inClass = false;
      let closed = false;
      while (i < source.length) {
        const current = source[i];
        if (current === "\n" || current === "\r") {
          throw new EbnfError(
            "Unterminated regex literal",
            spanAt(lines, start, i),
            source,
          );
        }
        if (escaped) {
          pattern += current;
          escaped = false;
          i++;
          continue;
        }
        if (current === "\\") {
          pattern += current;
          escaped = true;
          i++;
          continue;
        }
        if (current === "[") {
          inClass = true;
          pattern += current;
          i++;
          continue;
        }
        if (current === "]") {
          inClass = false;
          pattern += current;
          i++;
          continue;
        }
        if (current === "/" && !inClass) {
          i++;
          tokens.push({
            kind: "regex",
            text: pattern,
            span: spanAt(lines, start, i),
          });
          closed = true;
          break;
        }
        pattern += current;
        i++;
      }
      if (closed) continue;
      throw new EbnfError(
        "Unterminated regex literal",
        spanAt(lines, start, i),
        source,
      );
    }

    if (isIdentStart(char)) {
      i++;
      while (i < source.length && isIdentPart(source[i])) i++;
      tokens.push({
        kind: "identifier",
        text: source.slice(start, i),
        span: spanAt(lines, start, i),
      });
      continue;
    }

    if ("=;|{}[]()?*+%".includes(char)) {
      tokens.push({
        kind: "symbol",
        text: char,
        span: spanAt(lines, start, i + 1),
      });
      i++;
      continue;
    }

    throw new EbnfError(
      `Unexpected character '${char}'`,
      spanAt(lines, start, start + 1),
      source,
    );
  }

  tokens.push({
    kind: "eof",
    text: "<eof>",
    span: spanAt(lines, source.length, source.length),
  });
  return tokens;
}

class Parser {
  #current = 0;

  constructor(
    private readonly source: string,
    private readonly tokens: Token[],
  ) {}

  parseGrammar(): EbnfGrammar {
    const start = this.peek().span.start;
    const tokens: EbnfTokenDeclaration[] = [];
    const rules: EbnfRule[] = [];

    while (!this.checkKind("eof")) {
      if (this.checkText("token") || this.checkText("skip")) {
        tokens.push(this.parseTokenDeclaration());
      } else {
        rules.push(this.parseRule());
      }
    }

    const end = this.peek().span.end;
    return { tokens, rules, span: this.span(start, end) };
  }

  private parseTokenDeclaration(): EbnfTokenDeclaration {
    const kindToken = this.expectKind(
      "identifier",
      "Expected token declaration",
    );
    const kind = kindToken.text;
    if (kind !== "token" && kind !== "skip") {
      throw this.errorAt(kindToken, "Expected token or skip declaration");
    }
    const name = this.expectKind("identifier", "Expected token name").text;
    this.expectText("=");
    const patternToken = this.expectKind("regex", "Expected regex literal");
    try {
      new RegExp(patternToken.text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw this.errorAt(patternToken, `Invalid regex literal: ${message}`);
    }
    const semicolon = this.expectText(";");
    return {
      kind,
      name,
      pattern: patternToken.text,
      span: this.span(kindToken.span.start, semicolon.span.end),
    };
  }

  private parseRule(): EbnfRule {
    const nameToken = this.expectKind("identifier", "Expected rule name");
    this.expectText("=");
    const expression = this.parseChoice();
    const semicolon = this.expectText(";");
    return {
      name: nameToken.text,
      expression,
      span: this.span(nameToken.span.start, semicolon.span.end),
    };
  }

  private parseChoice(): EbnfExpression {
    const first = this.parseSequence();
    const options = [first];
    while (this.matchText("|")) {
      options.push(this.parseSequence());
    }
    if (options.length === 1) return first;
    return {
      kind: "choice",
      options,
      span: this.expressionSpan(first, options[options.length - 1]),
    };
  }

  private parseSequence(): EbnfExpression {
    const items: EbnfExpression[] = [];
    while (this.isExpressionStart()) {
      items.push(this.parseSeparator());
    }

    if (items.length === 0) {
      const span = this.span(this.peek().span.start, this.peek().span.start);
      return { kind: "sequence", items, span };
    }
    if (items.length === 1) return items[0];
    return {
      kind: "sequence",
      items,
      span: this.expressionSpan(items[0], items[items.length - 1]),
    };
  }

  private parseSeparator(): EbnfExpression {
    let expression = this.parsePostfix();
    if (this.matchText("%")) {
      const separator = this.parsePostfix();
      expression = {
        kind: "separated",
        item: expression,
        separator,
        span: this.expressionSpan(expression, separator),
      };
    }
    return expression;
  }

  private parsePostfix(): EbnfExpression {
    let expression = this.parsePrimary();
    while (true) {
      if (this.matchText("?")) {
        const operator = this.previous();
        expression = {
          kind: "optional",
          expression,
          span: this.span(expression.span.start, operator.span.end),
        };
        continue;
      }
      if (this.matchText("*")) {
        const operator = this.previous();
        expression = {
          kind: "repeat",
          expression,
          span: this.span(expression.span.start, operator.span.end),
        };
        continue;
      }
      if (this.matchText("+")) {
        const operator = this.previous();
        expression = {
          kind: "repeat1",
          expression,
          span: this.span(expression.span.start, operator.span.end),
        };
        continue;
      }
      return expression;
    }
  }

  private parsePrimary(): EbnfExpression {
    if (this.matchKind("identifier")) {
      const token = this.previous();
      return { kind: "ref", name: token.text, span: token.span };
    }

    if (this.matchKind("literal")) {
      const token = this.previous();
      return { kind: "literal", value: token.text, span: token.span };
    }

    if (this.matchText("(")) {
      const start = this.previous().span.start;
      const expression = this.parseChoice();
      const close = this.expectText(")");
      return this.withSpan(expression, this.span(start, close.span.end));
    }

    if (this.matchText("[")) {
      const start = this.previous().span.start;
      const expression = this.parseChoice();
      const close = this.expectText("]");
      return {
        kind: "optional",
        expression,
        span: this.span(start, close.span.end),
      };
    }

    if (this.matchText("{")) {
      const start = this.previous().span.start;
      const expression = this.parseChoice();
      const close = this.expectText("}");
      return {
        kind: "repeat",
        expression,
        span: this.span(start, close.span.end),
      };
    }

    throw this.error("Expected expression");
  }

  private isExpressionStart(): boolean {
    return this.checkKind("identifier") ||
      this.checkKind("literal") ||
      this.checkText("(") ||
      this.checkText("[") ||
      this.checkText("{");
  }

  private matchKind(kind: TokenKind): boolean {
    if (!this.checkKind(kind)) return false;
    this.advance();
    return true;
  }

  private matchText(text: string): boolean {
    if (!this.checkText(text)) return false;
    this.advance();
    return true;
  }

  private expectKind(kind: TokenKind, message: string): Token {
    if (this.checkKind(kind)) return this.advance();
    throw this.error(message);
  }

  private expectText(text: string): Token {
    if (this.checkText(text)) return this.advance();
    throw this.error(`Expected '${text}'`);
  }

  private checkKind(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  private checkText(text: string): boolean {
    return this.peek().text === text;
  }

  private advance(): Token {
    if (!this.checkKind("eof")) this.#current++;
    return this.previous();
  }

  private previous(): Token {
    return this.tokens[this.#current - 1];
  }

  private peek(): Token {
    return this.tokens[this.#current];
  }

  private error(message: string): EbnfError {
    return this.errorAt(this.peek(), message);
  }

  private errorAt(token: Token, message: string): EbnfError {
    return new EbnfError(message, token.span, this.source);
  }

  private expressionSpan(
    left: EbnfExpression,
    right: EbnfExpression,
  ): SourceSpan {
    return this.span(left.span.start, right.span.end);
  }

  private withSpan(
    expression: EbnfExpression,
    span: SourceSpan,
  ): EbnfExpression {
    return { ...expression, span };
  }

  private span(start: number, end: number): SourceSpan {
    return spanAt(createLineStarts(this.source), start, end);
  }
}

function createLineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function spanAt(lineStarts: number[], start: number, end: number): SourceSpan {
  const lineIndex = findLineIndex(lineStarts, start);
  return {
    start,
    end,
    line: lineIndex + 1,
    column: start - lineStarts[lineIndex] + 1,
  };
}

function findLineIndex(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= offset) low = mid + 1;
    else high = mid - 1;
  }
  return Math.max(0, low - 1);
}

function getSourceLine(source: string, offset: number): string {
  const lineStart = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const lineEnd = source.indexOf("\n", offset);
  return source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function isIdentStart(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z") ||
    char === "_";
}

function isIdentPart(char: string): boolean {
  return isIdentStart(char) || (char >= "0" && char <= "9");
}
