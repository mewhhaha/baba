import type { SourceSpan } from "../ast.ts";
import type {
  BrlBlockStatement,
  BrlExpression,
  BrlFieldDeclaration,
  BrlFunctionDeclaration,
  BrlIdentifier,
  BrlItem,
  BrlModule,
  BrlParameter,
  BrlScalarTypeName,
  BrlStatement,
  BrlTypeNode,
  BrlVariantDeclaration,
} from "./ast.ts";
import type { BrlDiagnostic } from "./diagnostics.ts";
import { brlDiagnostic } from "./diagnostics.ts";

type TokenKind = "identifier" | "integer" | "keyword" | "symbol" | "eof";

interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly span: SourceSpan;
}

const keywords = new Set([
  "as",
  "bool",
  "break",
  "continue",
  "else",
  "enum",
  "false",
  "fn",
  "for",
  "i32",
  "if",
  "in",
  "import",
  "let",
  "record",
  "return",
  "span",
  "true",
  "u8",
  "u16",
  "u32",
  "vec",
  "while",
]);

const binaryPrecedence = new Map([
  ["||", 1],
  ["&&", 2],
  ["==", 3],
  ["!=", 3],
  ["<", 4],
  ["<=", 4],
  [">", 4],
  [">=", 4],
  ["<<", 5],
  [">>", 5],
  ["+", 6],
  ["-", 6],
  ["*", 7],
  ["/", 7],
  ["%", 7],
]);

export function parseBrlModule(source: string): BrlModule {
  return new Parser(source, lex(source)).parseModule();
}

class Parser {
  private index = 0;
  private readonly diagnostics: BrlDiagnostic[] = [];

  constructor(
    private readonly source: string,
    private readonly tokens: readonly Token[],
  ) {}

  parseModule(): BrlModule {
    const items: BrlItem[] = [];
    while (!this.at("eof")) {
      const start = this.peek();
      const item = this.parseItem();
      if (item) {
        items.push(item);
      } else {
        this.diagnostic("BRL_PARSE_UNEXPECTED_TOKEN", "Expected declaration.");
        this.recoverTopLevel(start);
      }
    }
    return {
      kind: "module",
      items,
      span: this.spanFrom(0, this.source.length),
      diagnostics: this.diagnostics,
    };
  }

  private parseItem(): BrlItem | null {
    if (this.matchText("import")) return this.parseImport(this.previous());
    if (this.matchText("record")) return this.parseRecord(this.previous());
    if (this.matchText("enum")) return this.parseEnum(this.previous());
    if (this.matchText("fn")) return this.parseFunction(this.previous());
    return null;
  }

  private parseImport(start: Token): BrlItem {
    const path = [this.expectIdentifier("Expected import path segment.")];
    while (this.matchText(".")) {
      path.push(this.expectIdentifier("Expected import path segment."));
    }
    const end = this.expectText(";", "Expected ';' after import.");
    return { kind: "import", path, span: this.merge(start.span, end.span) };
  }

  private parseRecord(start: Token): BrlItem {
    const name = this.expectIdentifier("Expected record name.");
    this.expectText("{", "Expected '{' after record name.");
    const fields: BrlFieldDeclaration[] = [];
    while (!this.at("}") && !this.at("eof")) {
      const fieldStart = this.peek();
      const fieldName = this.expectIdentifier("Expected field name.");
      this.expectText(":", "Expected ':' after field name.");
      const type = this.parseType();
      const end = this.expectText(";", "Expected ';' after field.");
      fields.push({
        name: fieldName,
        type,
        span: this.merge(fieldStart.span, end.span),
      });
    }
    const end = this.expectText("}", "Expected '}' after record.");
    return {
      kind: "record",
      name,
      fields,
      span: this.merge(start.span, end.span),
    };
  }

  private parseEnum(start: Token): BrlItem {
    const name = this.expectIdentifier("Expected enum name.");
    this.expectText("{", "Expected '{' after enum name.");
    const variants: BrlVariantDeclaration[] = [];
    while (!this.at("}") && !this.at("eof")) {
      const variantStart = this.peek();
      const variantName = this.expectIdentifier("Expected variant name.");
      const payload: BrlTypeNode[] = [];
      if (this.matchText("(")) {
        if (!this.at(")")) {
          do {
            payload.push(this.parseType());
          } while (this.matchText(",") && !this.at(")"));
        }
        this.expectText(")", "Expected ')' after variant payload.");
      }
      variants.push({
        name: variantName,
        payload,
        span: this.merge(variantStart.span, this.previous().span),
      });
      if (!this.matchText(",")) break;
    }
    const end = this.expectText("}", "Expected '}' after enum.");
    return {
      kind: "enum",
      name,
      variants,
      span: this.merge(start.span, end.span),
    };
  }

  private parseFunction(start: Token): BrlFunctionDeclaration {
    const name = this.expectIdentifier("Expected function name.");
    this.expectText("(", "Expected '(' after function name.");
    const parameters: BrlParameter[] = [];
    if (!this.at(")")) {
      do {
        const paramStart = this.peek();
        const paramName = this.expectIdentifier("Expected parameter name.");
        this.expectText(":", "Expected ':' after parameter name.");
        const type = this.parseType();
        parameters.push({
          name: paramName,
          type,
          span: this.merge(paramStart.span, this.previous().span),
        });
      } while (this.matchText(",") && !this.at(")"));
    }
    this.expectText(")", "Expected ')' after parameters.");
    const result = this.matchText("->") ? this.parseType() : null;
    const body = this.parseBlock();
    return {
      kind: "function",
      name,
      parameters,
      result,
      body,
      span: this.merge(start.span, body.span),
    };
  }

  private parseType(): BrlTypeNode {
    const start = this.peek();
    if (
      this.matchText("bool") || this.matchText("u8") ||
      this.matchText("u16") || this.matchText("u32") || this.matchText("i32")
    ) {
      const token = this.previous();
      return {
        kind: "scalar",
        name: token.text as BrlScalarTypeName,
        span: token.span,
      };
    }
    if (this.matchText("span") || this.matchText("vec")) {
      const keyword = this.previous();
      this.expectText("<", `Expected '<' after ${keyword.text}.`);
      const element = this.parseType();
      const end = this.expectText(
        ">",
        `Expected '>' after ${keyword.text} type.`,
      );
      return {
        kind: keyword.text as "span" | "vec",
        element,
        span: this.merge(keyword.span, end.span),
      };
    }
    if (this.matchText("[")) {
      const element = this.parseType();
      this.expectText(";", "Expected ';' in array type.");
      const length = this.expectInteger("Expected array length.");
      const end = this.expectText("]", "Expected ']' after array type.");
      return {
        kind: "array",
        element,
        length: integerValue(length.text),
        span: this.merge(start.span, end.span),
      };
    }
    if (this.peek().kind === "identifier") {
      const name = this.advance();
      return {
        kind: "named",
        name: { text: name.text, span: name.span },
        span: name.span,
      };
    }
    this.diagnostic("BRL_PARSE_EXPECTED", "Expected type.");
    return { kind: "missing", span: this.advance().span };
  }

  private parseBlock(): BrlBlockStatement {
    const start = this.expectText("{", "Expected block.");
    const statements: BrlStatement[] = [];
    while (!this.at("}") && !this.at("eof")) {
      statements.push(this.parseStatement());
    }
    const end = this.expectText("}", "Expected '}' after block.");
    return {
      kind: "block",
      statements,
      span: this.merge(start.span, end.span),
    };
  }

  private parseStatement(): BrlStatement {
    const start = this.peek();
    if (this.at("{")) return this.parseBlock();
    if (this.matchText("let")) {
      const name = this.expectIdentifier("Expected local name.");
      const type = this.matchText(":") ? this.parseType() : null;
      this.expectText("=", "Expected '=' in let statement.");
      const expression = this.parseExpression();
      const end = this.expectText(";", "Expected ';' after let statement.");
      return {
        kind: "let",
        name,
        type,
        expression,
        span: this.merge(start.span, end.span),
      };
    }
    if (this.matchText("if")) {
      const condition = this.parseExpression();
      const consequent = this.parseBlock();
      const alternate = this.matchText("else") ? this.parseBlock() : null;
      return {
        kind: "if",
        condition,
        consequent,
        alternate,
        span: this.merge(start.span, (alternate ?? consequent).span),
      };
    }
    if (this.matchText("while")) {
      const condition = this.parseExpression();
      const body = this.parseBlock();
      return {
        kind: "while",
        condition,
        body,
        span: this.merge(start.span, body.span),
      };
    }
    if (this.matchText("for")) {
      const name = this.expectIdentifier("Expected loop variable name.");
      this.expectText("in", "Expected 'in' after loop variable.");
      const rangeStart = this.parseExpression();
      this.expectText("..", "Expected '..' in for range.");
      const rangeEnd = this.parseExpression();
      const body = this.parseBlock();
      return {
        kind: "for",
        name,
        start: rangeStart,
        end: rangeEnd,
        body,
        span: this.merge(start.span, body.span),
      };
    }
    if (this.matchText("break")) {
      const end = this.expectText(";", "Expected ';' after break.");
      return { kind: "break", span: this.merge(start.span, end.span) };
    }
    if (this.matchText("continue")) {
      const end = this.expectText(";", "Expected ';' after continue.");
      return { kind: "continue", span: this.merge(start.span, end.span) };
    }
    if (this.matchText("return")) {
      const expression = this.at(";") ? null : this.parseExpression();
      const end = this.expectText(";", "Expected ';' after return.");
      return {
        kind: "return",
        expression,
        span: this.merge(start.span, end.span),
      };
    }
    if (this.peek().kind === "identifier" && this.peek(1).text === "=") {
      const target = this.expectIdentifier("Expected assignment target.");
      this.expectText("=", "Expected '=' in assignment.");
      const expression = this.parseExpression();
      const end = this.expectText(";", "Expected ';' after assignment.");
      return {
        kind: "assign",
        target,
        expression,
        span: this.merge(start.span, end.span),
      };
    }
    const expression = this.parseExpression();
    const end = this.expectText(";", "Expected ';' after expression.");
    return {
      kind: "expression",
      expression,
      span: this.merge(start.span, end.span),
    };
  }

  private parseExpression(minPrecedence = 0): BrlExpression {
    let expression = this.parseUnary();
    while (true) {
      const precedence = binaryPrecedence.get(this.peek().text);
      if (precedence === undefined || precedence < minPrecedence) break;
      const operator = this.advance();
      const right = this.parseExpression(precedence + 1);
      expression = {
        kind: "binary",
        operator: operator.text,
        left: expression,
        right,
        span: this.merge(expression.span, right.span),
      };
    }
    return expression;
  }

  private parseUnary(): BrlExpression {
    if (this.matchText("!")) {
      const operator = this.previous();
      const operand = this.parseUnary();
      return {
        kind: "unary",
        operator: operator.text,
        operand,
        span: this.merge(operator.span, operand.span),
      };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): BrlExpression {
    let expression = this.parsePrimary();
    while (true) {
      if (this.matchText("(")) {
        const args: BrlExpression[] = [];
        if (!this.at(")")) {
          do {
            args.push(this.parseExpression());
          } while (this.matchText(",") && !this.at(")"));
        }
        const end = this.expectText(")", "Expected ')' after arguments.");
        expression = {
          kind: "call",
          callee: expression,
          args,
          span: this.merge(expression.span, end.span),
        };
        continue;
      }
      if (this.matchText(".")) {
        const field = this.expectIdentifier("Expected field name.");
        expression = {
          kind: "field",
          receiver: expression,
          field,
          span: this.merge(expression.span, field.span),
        };
        continue;
      }
      if (this.matchText("[")) {
        const index = this.parseExpression();
        const end = this.expectText("]", "Expected ']' after index.");
        expression = {
          kind: "index",
          receiver: expression,
          index,
          span: this.merge(expression.span, end.span),
        };
        continue;
      }
      if (this.matchText("as")) {
        const type = this.parseType();
        expression = {
          kind: "cast",
          expression,
          type,
          span: this.merge(expression.span, type.span),
        };
        continue;
      }
      break;
    }
    return expression;
  }

  private parsePrimary(): BrlExpression {
    if (this.peek().kind === "integer") {
      const token = this.advance();
      return {
        kind: "integer",
        raw: token.text,
        value: integerValue(token.text),
        span: token.span,
      };
    }
    if (this.matchText("true") || this.matchText("false")) {
      const token = this.previous();
      return { kind: "bool", value: token.text === "true", span: token.span };
    }
    if (this.matchText("record")) {
      return this.parseRecordLiteral(this.previous());
    }
    if (this.peek().kind === "identifier") {
      const token = this.advance();
      const name = { text: token.text, span: token.span };
      return { kind: "name", name, span: token.span };
    }
    if (this.matchText("(")) {
      const expression = this.parseExpression();
      this.expectText(")", "Expected ')' after expression.");
      return expression;
    }
    this.diagnostic("BRL_PARSE_EXPECTED", "Expected expression.");
    return { kind: "missing", span: this.advance().span };
  }

  private parseRecordLiteral(start: Token): BrlExpression {
    const name = this.expectIdentifier("Expected record literal type name.");
    this.expectText("{", "Expected '{' after record literal type.");
    const fields = [];
    if (!this.at("}")) {
      do {
        const fieldStart = this.peek();
        const fieldName = this.expectIdentifier(
          "Expected record literal field name.",
        );
        this.expectText(":", "Expected ':' after record literal field.");
        const expression = this.parseExpression();
        fields.push({
          name: fieldName,
          expression,
          span: this.merge(fieldStart.span, expression.span),
        });
      } while (this.matchText(",") && !this.at("}"));
    }
    const end = this.expectText("}", "Expected '}' after record literal.");
    return {
      kind: "record",
      name,
      fields,
      span: this.merge(start.span, end.span),
    };
  }

  private expectIdentifier(message: string): BrlIdentifier {
    const token = this.peek();
    if (token.kind === "identifier") {
      this.advance();
      return { text: token.text, span: token.span };
    }
    this.diagnostic("BRL_PARSE_EXPECTED", message, token.span);
    return { text: "", span: token.span };
  }

  private expectInteger(message: string): Token {
    if (this.peek().kind === "integer") return this.advance();
    const token = this.peek();
    this.diagnostic("BRL_PARSE_EXPECTED", message, token.span);
    return token;
  }

  private expectText(text: string, message: string): Token {
    if (this.matchText(text)) return this.previous();
    const token = this.peek();
    this.diagnostic("BRL_PARSE_EXPECTED", message, token.span);
    return token;
  }

  private matchText(text: string): boolean {
    if (!this.at(text)) return false;
    this.advance();
    return true;
  }

  private at(text: string): boolean {
    if (text === "eof") return this.peek().kind === "eof";
    return this.peek().text === text;
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)];
  }

  private previous(): Token {
    return this.tokens[Math.max(0, this.index - 1)];
  }

  private advance(): Token {
    const token = this.peek();
    if (token.kind !== "eof") this.index++;
    return token;
  }

  private diagnostic(
    code: BrlDiagnostic["code"],
    message: string,
    span = this.peek().span,
  ): void {
    this.diagnostics.push(brlDiagnostic(code, message, span));
  }

  private recoverTopLevel(start: Token): void {
    if (this.peek() === start) this.advance();
    while (
      !this.at("eof") && !this.at("fn") && !this.at("record") &&
      !this.at("enum") && !this.at("import")
    ) {
      this.advance();
    }
  }

  private spanFrom(start: number, end: number): SourceSpan {
    let line = 1;
    let column = 1;
    for (let index = 0; index < start; index++) {
      if (this.source.charCodeAt(index) === 10) {
        line++;
        column = 1;
      } else {
        column++;
      }
    }
    return { start, end, line, column };
  }

  private merge(left: SourceSpan, right: SourceSpan): SourceSpan {
    return {
      start: left.start,
      end: right.end,
      line: left.line,
      column: left.column,
    };
  }
}

function lex(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let line = 1;
  let column = 1;
  const token = (
    kind: TokenKind,
    text: string,
    start: number,
    end: number,
  ) => ({
    kind,
    text,
    span: { start, end, line, column },
  });
  const advanceText = (text: string) => {
    for (let offset = 0; offset < text.length; offset++) {
      if (text.charCodeAt(offset) === 10) {
        line++;
        column = 1;
      } else {
        column++;
      }
    }
    index += text.length;
  };
  while (index < source.length) {
    const rest = source.slice(index);
    const whitespace = /^[ \t\r\n]+/.exec(rest)?.[0];
    if (whitespace) {
      advanceText(whitespace);
      continue;
    }
    const comment = /^\/\/[^\n\r]*/.exec(rest)?.[0];
    if (comment) {
      advanceText(comment);
      continue;
    }
    const start = index;
    const two = source.slice(index, index + 2);
    if (
      two === "->" || two === "==" || two === "!=" || two === "<=" ||
      two === ">=" || two === "<<" || two === ">>" || two === "&&" ||
      two === "||" || two === ".."
    ) {
      tokens.push(token("symbol", two, start, start + 2));
      advanceText(two);
      continue;
    }
    const int = /^(?:0x[0-9A-Fa-f]+|[0-9]+)/.exec(rest)?.[0];
    if (int) {
      tokens.push(token("integer", int, start, start + int.length));
      advanceText(int);
      continue;
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest)?.[0];
    if (ident) {
      tokens.push(
        token(
          keywords.has(ident) ? "keyword" : "identifier",
          ident,
          start,
          start + ident.length,
        ),
      );
      advanceText(ident);
      continue;
    }
    const ch = source[index];
    tokens.push(token("symbol", ch, start, start + 1));
    advanceText(ch);
  }
  tokens.push({
    kind: "eof",
    text: "eof",
    span: { start: index, end: index, line, column },
  });
  return tokens;
}

function integerValue(raw: string): number {
  return raw.startsWith("0x") ? Number.parseInt(raw.slice(2), 16) : Number(raw);
}
