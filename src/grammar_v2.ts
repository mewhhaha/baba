import type {
  Diagnostic,
  GrammarV2Declaration,
  GrammarV2Document,
  GrammarV2Expression,
  GrammarV2ExpressionOperator,
  GrammarV2ExtensionDeclaration,
  GrammarV2LayoutDeclaration,
  GrammarV2ModeDeclaration,
  GrammarV2ModeTransition,
  GrammarV2ParseResult,
  GrammarV2Rule,
  GrammarV2RuleAnnotation,
  GrammarV2TerminalPattern,
  GrammarV2TokenDeclaration,
  SourceSpan,
} from "./ast.ts";

type TokenKind =
  | "identifier"
  | "literal"
  | "number"
  | "regex"
  | "symbol"
  | "arrow"
  | "eof";

interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly span: SourceSpan;
}

interface LexerResult {
  readonly tokens: Token[];
  readonly diagnostics: Diagnostic[];
  readonly lineStarts: number[];
}

/** Parses grammar v2 source into a spanned syntax AST and diagnostics. */
export function parseGrammarV2(source: string): GrammarV2ParseResult {
  const lexed = lexGrammarV2(source);
  const parser = new GrammarV2Parser(source, lexed.tokens, lexed.lineStarts, [
    ...lexed.diagnostics,
  ]);
  return parser.parse();
}

function lexGrammarV2(source: string): LexerResult {
  const lineStarts = createLineStarts(source);
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (isWhitespace(char)) {
      index++;
      continue;
    }

    if (char === "#") {
      index++;
      while (index < source.length && source[index] !== "\n") {
        index++;
      }
      continue;
    }

    if (char === "/" && source[index + 1] === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") {
        index++;
      }
      continue;
    }

    const start = index;
    if (char === "-" && source[index + 1] === ">") {
      index += 2;
      tokens.push({
        kind: "arrow",
        text: "->",
        span: spanAt(lineStarts, start, index),
      });
      continue;
    }

    if (char === '"') {
      const result = readString(source, lineStarts, start);
      tokens.push(result.token);
      index = result.nextIndex;
      if (result.diagnostic) {
        diagnostics.push(result.diagnostic);
      }
      continue;
    }

    if (char === "/") {
      const result = readRegex(source, lineStarts, start);
      tokens.push(result.token);
      index = result.nextIndex;
      if (result.diagnostic) {
        diagnostics.push(result.diagnostic);
      }
      continue;
    }

    if (isIdentStart(char)) {
      index++;
      while (index < source.length && isIdentPart(source[index])) {
        index++;
      }
      tokens.push({
        kind: "identifier",
        text: source.slice(start, index),
        span: spanAt(lineStarts, start, index),
      });
      continue;
    }

    if (isDigit(char)) {
      index++;
      while (index < source.length && isDigit(source[index])) {
        index++;
      }
      tokens.push({
        kind: "number",
        text: source.slice(start, index),
        span: spanAt(lineStarts, start, index),
      });
      continue;
    }

    if ("=;|{}[]()?*+%:,.".includes(char)) {
      index++;
      tokens.push({
        kind: "symbol",
        text: char,
        span: spanAt(lineStarts, start, index),
      });
      continue;
    }

    diagnostics.push(syntaxDiagnostic(
      `Unexpected character '${char}'.`,
      spanAt(lineStarts, start, start + 1),
      source,
    ));
    index++;
  }

  tokens.push({
    kind: "eof",
    text: "<eof>",
    span: spanAt(lineStarts, source.length, source.length),
  });
  return { tokens, diagnostics, lineStarts };
}

class GrammarV2Parser {
  #current = 0;

  constructor(
    private readonly source: string,
    private readonly tokens: readonly Token[],
    private readonly lineStarts: readonly number[],
    private readonly diagnostics: Diagnostic[],
  ) {}

  parse(): GrammarV2ParseResult {
    const start = this.peek().span.start;
    let name: string | undefined;
    if (this.matchText("grammar")) {
      const nameToken = this.expectKind(
        "identifier",
        "Expected grammar name after 'grammar'.",
      );
      if (nameToken) {
        name = nameToken.text;
      }
    }

    const declarations: GrammarV2Declaration[] = [];
    while (!this.checkKind("eof")) {
      const before = this.#current;
      const declaration = this.parseDeclaration();
      if (declaration) {
        declarations.push(declaration);
      }
      if (this.#current === before) {
        this.advance();
      }
    }

    const end = this.peek().span.end;
    const grammar: GrammarV2Document = {
      declarations,
      span: this.span(start, end),
    };
    if (name !== undefined) {
      grammar.name = name;
    }
    return { grammar, diagnostics: this.diagnostics };
  }

  private parseDeclaration(): GrammarV2Declaration | undefined {
    if (this.checkText("token") || this.checkText("skip")) {
      return this.parseTokenDeclaration();
    }
    if (this.checkText("contextual")) {
      return this.parseTokenDeclaration();
    }
    if (this.checkText("mode") && this.nextStartsModeDeclaration()) {
      return this.parseModeDeclaration();
    }
    if (this.checkText("layout") && this.nextStartsNamedDeclaration()) {
      return this.parseLayoutDeclaration();
    }
    if (this.checkText("export")) {
      return this.parseExportDeclaration();
    }
    if (this.checkText("import")) {
      return this.parseImportDeclaration();
    }
    if (this.checkText("module") && this.nextStartsNamedDeclaration()) {
      return this.parseModuleDeclaration();
    }
    if (this.checkText("extend") && this.nextStartsNamedDeclaration()) {
      return this.parseExtensionDeclaration();
    }
    if (this.checkKind("identifier")) {
      return this.parseRule();
    }

    this.reportHere("Expected grammar v2 declaration.");
    this.synchronizeTopLevel();
    return undefined;
  }

  private parseTokenDeclaration(
    modeName?: string,
  ): GrammarV2TokenDeclaration | undefined {
    const kindToken = this.advance();
    const nameToken = this.expectKind("identifier", "Expected token name.");
    let channel: string | undefined;
    let localModeName = modeName;
    let transition: GrammarV2ModeTransition | undefined;
    if (this.matchText("channel")) {
      const channelToken = this.expectKind(
        "identifier",
        "Expected channel name after 'channel'.",
      );
      if (channelToken) {
        channel = channelToken.text;
      }
    }
    if (this.matchText("in")) {
      const modeToken = this.expectKind(
        "identifier",
        "Expected lexer mode name after 'in'.",
      );
      if (modeToken) {
        localModeName = modeToken.text;
      }
    }
    if (
      this.checkText("push") || this.checkText("mode") ||
      this.checkText("pop")
    ) {
      transition = this.parseModeTransition();
    }
    if (!this.expectText("=")) {
      this.synchronizeTopLevel();
      return undefined;
    }

    const pattern = this.parseTerminalPattern("Expected token pattern.");
    const semicolon = this.expectText(";");
    if (!nameToken || !pattern || !semicolon) {
      this.synchronizeTopLevel();
      return undefined;
    }

    let declarationKind: "token" | "skip" | "contextual";
    if (kindToken.text === "token") {
      declarationKind = "token";
    } else if (kindToken.text === "skip") {
      declarationKind = "skip";
    } else if (kindToken.text === "contextual") {
      declarationKind = "contextual";
    } else {
      this.reportAt(kindToken, "Expected token, skip, or contextual.");
      return undefined;
    }

    const declaration = {
      kind: declarationKind,
      name: nameToken.text,
      pattern,
      span: this.span(kindToken.span.start, semicolon.span.end),
    };
    let result: GrammarV2TokenDeclaration = declaration;
    if (channel !== undefined) {
      result = { ...result, channel };
    }
    if (localModeName !== undefined) {
      result = { ...result, mode: localModeName };
    }
    if (transition !== undefined) {
      result = { ...result, transition };
    }
    return result;
  }

  private parseModeDeclaration(): GrammarV2ModeDeclaration | undefined {
    const modeToken = this.advance();
    const nameToken = this.expectKind(
      "identifier",
      "Expected lexer mode name.",
    );
    if (!nameToken) {
      this.synchronizeTopLevel();
      return undefined;
    }
    if (!this.expectText("{")) {
      this.synchronizeTopLevel();
      return undefined;
    }
    const declarations: GrammarV2TokenDeclaration[] = [];
    while (!this.checkText("}") && !this.checkKind("eof")) {
      if (
        this.checkText("token") || this.checkText("skip") ||
        this.checkText("contextual")
      ) {
        const declaration = this.parseTokenDeclaration(nameToken.text);
        if (declaration) {
          declarations.push(declaration);
        }
      } else {
        this.reportHere("Expected terminal declaration in lexer mode.");
        this.synchronizeModeDeclaration();
      }
    }
    const close = this.expectText("}");
    if (!close) {
      this.synchronizeTopLevel();
      return undefined;
    }
    return {
      kind: "mode",
      name: nameToken.text,
      declarations,
      span: this.span(modeToken.span.start, close.span.end),
    };
  }

  private parseLayoutDeclaration(): GrammarV2LayoutDeclaration | undefined {
    const layoutToken = this.advance();
    const nameToken = this.expectKind("identifier", "Expected layout name.");
    if (!nameToken) {
      this.synchronizeTopLevel();
      return undefined;
    }
    if (!this.expectText("=")) {
      this.synchronizeTopLevel();
      return undefined;
    }
    const expression = this.parseChoice();
    const semicolon = this.expectText(";");
    if (!expression || !semicolon) {
      this.synchronizeTopLevel();
      return undefined;
    }
    return {
      kind: "layout",
      name: nameToken.text,
      expression,
      span: this.span(layoutToken.span.start, semicolon.span.end),
    };
  }

  private parseExportDeclaration(): GrammarV2Declaration | undefined {
    const exportToken = this.advance();
    const name = this.parseQualifiedName("Expected exported name.");
    if (!name) {
      this.synchronizeTopLevel();
      return undefined;
    }
    return {
      kind: "export",
      name: name.text,
      span: this.span(exportToken.span.start, name.span.end),
    };
  }

  private parseImportDeclaration(): GrammarV2Declaration | undefined {
    const importToken = this.advance();
    let sourceToken: Token | undefined;
    let sourceName: { text: string; span: SourceSpan } | undefined;
    if (this.checkKind("literal")) {
      sourceToken = this.advance();
    } else if (this.checkKind("identifier")) {
      sourceName = this.parseQualifiedName("Expected imported module name.");
    } else {
      this.reportHere("Expected imported module name.");
    }
    const semicolon = this.expectText(";");
    if ((!sourceToken && !sourceName) || !semicolon) {
      this.synchronizeTopLevel();
      return undefined;
    }
    let source: string;
    if (sourceToken) {
      source = sourceToken.text;
    } else if (sourceName) {
      source = sourceName.text;
    } else {
      this.reportHere("Expected imported module name.");
      return undefined;
    }
    return {
      kind: "import",
      source,
      span: this.span(importToken.span.start, semicolon.span.end),
    };
  }

  private parseModuleDeclaration(): GrammarV2Declaration | undefined {
    const moduleToken = this.advance();
    const name = this.parseQualifiedName("Expected module name.");
    if (!name) {
      this.synchronizeTopLevel();
      return undefined;
    }
    return {
      kind: "module",
      name: name.text,
      span: this.span(moduleToken.span.start, name.span.end),
    };
  }

  private parseExtensionDeclaration():
    | GrammarV2ExtensionDeclaration
    | undefined {
    const extendToken = this.advance();
    const target = this.parseQualifiedName("Expected extension target.");
    if (!target) {
      this.synchronizeTopLevel();
      return undefined;
    }
    if (!this.expectText("=")) {
      this.synchronizeTopLevel();
      return undefined;
    }
    const expression = this.parseChoice();
    const semicolon = this.expectText(";");
    if (!expression || !semicolon) {
      this.synchronizeTopLevel();
      return undefined;
    }
    return {
      kind: "extend",
      target: target.text,
      expression,
      span: this.span(extendToken.span.start, semicolon.span.end),
    };
  }

  private parseModeTransition(): GrammarV2ModeTransition | undefined {
    const transitionToken = this.advance();
    if (transitionToken.text === "pop") {
      return {
        kind: "pop",
        span: transitionToken.span,
      };
    }
    if (transitionToken.text === "push" || transitionToken.text === "mode") {
      const modeToken = this.expectKind(
        "identifier",
        `Expected lexer mode name after '${transitionToken.text}'.`,
      );
      if (!modeToken) {
        return undefined;
      }
      return {
        kind: transitionToken.text,
        mode: modeToken.text,
        span: this.span(transitionToken.span.start, modeToken.span.end),
      };
    }
    this.reportAt(transitionToken, "Expected lexer mode transition.");
    return undefined;
  }

  private parseQualifiedName(
    message: string,
  ): { text: string; span: SourceSpan } | undefined {
    const first = this.expectKind("identifier", message);
    if (!first) {
      return undefined;
    }
    let text = first.text;
    let end = first.span.end;
    while (this.matchText(".")) {
      const part = this.expectKind("identifier", "Expected name after '.'.");
      if (!part) {
        return undefined;
      }
      text = `${text}.${part.text}`;
      end = part.span.end;
    }
    return {
      text,
      span: this.span(first.span.start, end),
    };
  }

  private parseRule(): GrammarV2Rule | undefined {
    const nameToken = this.advance();
    const annotations: GrammarV2RuleAnnotation[] = [];
    if (this.matchText("sync")) {
      const syncToken = this.previous();
      if (!this.expectText("=")) {
        this.synchronizeTopLevel();
        return undefined;
      }
      const expression = this.parseChoice();
      if (!expression) {
        this.synchronizeTopLevel();
        return undefined;
      }
      const semicolon = this.expectText(";");
      if (!semicolon) {
        this.synchronizeTopLevel();
        return undefined;
      }
      annotations.push({
        kind: "sync",
        expression,
        span: this.span(syncToken.span.start, semicolon.span.end),
      });
      return {
        kind: "rule",
        name: nameToken.text,
        annotations,
        expression: emptySequence(
          this.span(nameToken.span.end, nameToken.span.end),
        ),
        span: this.span(nameToken.span.start, semicolon.span.end),
      };
    }

    if (!this.expectText("=")) {
      this.synchronizeTopLevel();
      return undefined;
    }

    const expression = this.parseRuleExpression();
    let semicolon: Token | undefined;
    if (expression && expression.kind === "expressionIsland") {
      if (this.checkText(";")) {
        semicolon = this.advance();
      }
    } else {
      semicolon = this.expectText(";");
    }
    if (!expression) {
      this.synchronizeTopLevel();
      return undefined;
    }
    let end = expression.span.end;
    if (semicolon) {
      end = semicolon.span.end;
    }

    return {
      kind: "rule",
      name: nameToken.text,
      annotations,
      expression,
      span: this.span(nameToken.span.start, end),
    };
  }

  private parseRuleExpression(): GrammarV2Expression | undefined {
    if (this.ruleStartsExpressionIsland()) {
      const atom = this.parseConstructedField();
      if (!atom) {
        return undefined;
      }
      return this.parseExpressionIsland(atom);
    }
    const first = this.parseChoice();
    if (!first) {
      return undefined;
    }
    if (this.checkText("{") && this.nextStartsExpressionOperator()) {
      return this.parseExpressionIsland(first);
    }
    return first;
  }

  private parseExpressionIsland(
    atom: GrammarV2Expression,
  ): GrammarV2Expression | undefined {
    this.expectText("{");
    const operators: GrammarV2ExpressionOperator[] = [];
    while (!this.checkText("}") && !this.checkKind("eof")) {
      const operator = this.parseExpressionOperator();
      if (operator) {
        operators.push(operator);
      } else {
        this.advance();
      }
    }
    const close = this.expectText("}");
    if (!close) {
      return undefined;
    }
    return {
      kind: "expressionIsland",
      atom,
      operators,
      span: this.span(atom.span.start, close.span.end),
    };
  }

  private parseExpressionOperator(): GrammarV2ExpressionOperator | undefined {
    const kindToken = this.expectOneOfText(
      ["infix", "prefix", "postfix"],
      "Expected expression operator kind.",
    );
    if (!kindToken) {
      return undefined;
    }

    let associativity: "left" | "right" | "none" | undefined;
    if (kindToken.text === "infix") {
      const assocToken = this.expectOneOfText(
        ["left", "right", "none"],
        "Expected infix associativity.",
      );
      if (!assocToken) {
        return undefined;
      }
      if (
        assocToken.text === "left" || assocToken.text === "right" ||
        assocToken.text === "none"
      ) {
        associativity = assocToken.text;
      }
    }

    const precedenceToken = this.expectKind(
      "number",
      "Expected expression precedence.",
    );
    const token = this.parseTerminalPattern(
      "Expected expression operator token.",
    );
    if (!precedenceToken || !token) {
      return undefined;
    }
    const precedence = Number(precedenceToken.text);
    if (!Number.isSafeInteger(precedence)) {
      this.reportAt(precedenceToken, "Invalid expression precedence.");
      return undefined;
    }
    let operatorKind: "infix" | "prefix" | "postfix";
    if (kindToken.text === "infix") {
      operatorKind = "infix";
    } else if (kindToken.text === "prefix") {
      operatorKind = "prefix";
    } else if (kindToken.text === "postfix") {
      operatorKind = "postfix";
    } else {
      return undefined;
    }
    const operator = {
      kind: operatorKind,
      precedence,
      token,
      span: this.span(kindToken.span.start, token.span.end),
    };
    if (associativity !== undefined) {
      return { ...operator, associativity };
    }
    return operator;
  }

  private parseChoice(): GrammarV2Expression | undefined {
    const first = this.parseSequence();
    if (!first) {
      return undefined;
    }
    const options = [first];
    while (this.matchText("|")) {
      const next = this.parseSequence();
      if (next) {
        options.push(next);
      } else {
        this.reportHere("Expected expression after '|'.");
      }
    }
    if (options.length === 1) {
      return first;
    }
    return {
      kind: "choice",
      options,
      span: this.expressionSpan(options[0], options[options.length - 1]),
    };
  }

  private parseSequence(): GrammarV2Expression | undefined {
    const items: GrammarV2Expression[] = [];
    while (this.isExpressionStart()) {
      const expression = this.parseConstructedField();
      if (expression) {
        items.push(expression);
      } else {
        break;
      }
    }
    if (items.length === 0) {
      this.reportHere("Expected expression.");
      return undefined;
    }
    let expression: GrammarV2Expression;
    if (items.length === 1) {
      expression = items[0];
    } else {
      expression = {
        kind: "sequence",
        items,
        span: this.expressionSpan(items[0], items[items.length - 1]),
      };
    }
    if (this.matchKind("arrow")) {
      const arrow = this.previous();
      const constructor = this.parseConstructor(expression, arrow);
      if (constructor) {
        expression = constructor;
      }
    }
    return expression;
  }

  private parseConstructedField(): GrammarV2Expression | undefined {
    return this.parseField();
  }

  private parseField(): GrammarV2Expression | undefined {
    if (this.checkKind("identifier") && this.checkNextText(":")) {
      const name = this.advance();
      this.expectText(":");
      const expression = this.parseSeparator();
      if (!expression) {
        return undefined;
      }
      return {
        kind: "field",
        name: name.text,
        expression,
        span: this.span(name.span.start, expression.span.end),
      };
    }
    return this.parseSeparator();
  }

  private parseSeparator(): GrammarV2Expression | undefined {
    let expression = this.parsePostfix();
    if (!expression) {
      return undefined;
    }
    if (this.matchText("%")) {
      const separator = this.parsePostfix();
      if (!separator) {
        return undefined;
      }
      expression = {
        kind: "separated",
        item: expression,
        separator,
        span: this.expressionSpan(expression, separator),
      };
    }
    return expression;
  }

  private parsePostfix(): GrammarV2Expression | undefined {
    let expression = this.parsePrimary();
    if (!expression) {
      return undefined;
    }
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

  private parsePrimary(): GrammarV2Expression | undefined {
    if (this.matchKind("identifier")) {
      const token = this.previous();
      return { kind: "ref", name: token.text, span: token.span };
    }
    if (this.matchKind("literal")) {
      const token = this.previous();
      return { kind: "literal", value: token.text, span: token.span };
    }
    if (this.matchText("(")) {
      return this.parseDelimitedExpression(")");
    }
    if (this.matchText("[")) {
      const start = this.previous().span.start;
      const expression = this.parseChoice();
      const close = this.expectText("]");
      if (!expression || !close) {
        return undefined;
      }
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
      if (!expression || !close) {
        return undefined;
      }
      return {
        kind: "repeat",
        expression,
        span: this.span(start, close.span.end),
      };
    }
    this.reportHere("Expected expression.");
    return undefined;
  }

  private parseDelimitedExpression(
    closeText: string,
  ): GrammarV2Expression | undefined {
    const start = this.previous().span.start;
    const expression = this.parseChoice();
    const close = this.expectText(closeText);
    if (!expression || !close) {
      return undefined;
    }
    return withExpressionSpan(expression, this.span(start, close.span.end));
  }

  private parseConstructor(
    expression: GrammarV2Expression,
    arrow: Token,
  ): GrammarV2Expression | undefined {
    const name = this.expectKind("identifier", "Expected constructor name.");
    if (!name) {
      return undefined;
    }
    if (!this.expectText("(")) {
      return undefined;
    }
    const args: string[] = [];
    if (!this.checkText(")")) {
      while (!this.checkKind("eof")) {
        const arg = this.expectKind(
          "identifier",
          "Expected constructor argument.",
        );
        if (!arg) {
          return undefined;
        }
        args.push(arg.text);
        if (!this.matchText(",")) {
          break;
        }
      }
    }
    const close = this.expectText(")");
    if (!close) {
      return undefined;
    }
    return {
      kind: "constructor",
      expression,
      name: name.text,
      arguments: args,
      span: this.span(arrow.span.start, close.span.end),
    };
  }

  private parseTerminalPattern(
    message: string,
  ): GrammarV2TerminalPattern | undefined {
    if (this.matchKind("regex")) {
      const token = this.previous();
      return { kind: "regex", pattern: token.text, span: token.span };
    }
    if (this.matchKind("literal")) {
      const token = this.previous();
      return { kind: "literal", value: token.text, span: token.span };
    }
    this.reportHere(message);
    return undefined;
  }

  private nextStartsExpressionOperator(): boolean {
    const next = this.tokens[this.#current + 1];
    if (!next) {
      return false;
    }
    return next.text === "infix" || next.text === "prefix" ||
      next.text === "postfix";
  }

  private nextStartsNamedDeclaration(): boolean {
    const next = this.tokens[this.#current + 1];
    if (!next) {
      return false;
    }
    return next.kind === "identifier";
  }

  private nextStartsModeDeclaration(): boolean {
    const name = this.tokens[this.#current + 1];
    const open = this.tokens[this.#current + 2];
    if (!name || !open) {
      return false;
    }
    return name.kind === "identifier" && open.text === "{";
  }

  private ruleStartsExpressionIsland(): boolean {
    if (!this.isExpressionStart()) {
      return false;
    }
    let offset = 1;
    while (true) {
      const token = this.tokens[this.#current + offset];
      if (!token) {
        return false;
      }
      if (token.text === "?") {
        offset++;
        continue;
      }
      if (token.text === "*") {
        offset++;
        continue;
      }
      if (token.text === "+") {
        offset++;
        continue;
      }
      if (token.text !== "{") {
        return false;
      }
      const operator = this.tokens[this.#current + offset + 1];
      if (!operator) {
        return false;
      }
      return operator.text === "infix" || operator.text === "prefix" ||
        operator.text === "postfix";
    }
  }

  private isExpressionStart(): boolean {
    return this.checkKind("identifier") || this.checkKind("literal") ||
      this.checkText("(") || this.checkText("[") || this.checkText("{");
  }

  private synchronizeTopLevel(): void {
    while (!this.checkKind("eof")) {
      if (this.matchText(";")) {
        return;
      }
      if (
        this.checkText("token") || this.checkText("skip") ||
        this.checkText("contextual") || this.checkText("mode") ||
        this.checkText("layout") || this.checkText("export") ||
        this.checkText("import") || this.checkText("module") ||
        this.checkText("extend")
      ) {
        return;
      }
      if (this.checkKind("identifier") && this.checkNextText("=")) {
        return;
      }
      if (this.checkKind("identifier") && this.checkNextText("sync")) {
        return;
      }
      this.advance();
    }
  }

  private synchronizeModeDeclaration(): void {
    while (!this.checkKind("eof") && !this.checkText("}")) {
      if (this.matchText(";")) {
        return;
      }
      if (
        this.checkText("token") || this.checkText("skip") ||
        this.checkText("contextual")
      ) {
        return;
      }
      this.advance();
    }
  }

  private expectKind(kind: TokenKind, message: string): Token | undefined {
    if (this.checkKind(kind)) {
      return this.advance();
    }
    this.reportHere(message);
    return undefined;
  }

  private expectText(text: string): Token | undefined {
    if (this.checkText(text)) {
      return this.advance();
    }
    this.reportHere(`Expected '${text}'.`);
    return undefined;
  }

  private expectOneOfText(
    texts: readonly string[],
    message: string,
  ): Token | undefined {
    for (const text of texts) {
      if (this.checkText(text)) {
        return this.advance();
      }
    }
    this.reportHere(message);
    return undefined;
  }

  private matchKind(kind: TokenKind): boolean {
    if (!this.checkKind(kind)) {
      return false;
    }
    this.advance();
    return true;
  }

  private matchText(text: string): boolean {
    if (!this.checkText(text)) {
      return false;
    }
    this.advance();
    return true;
  }

  private checkKind(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  private checkText(text: string): boolean {
    return this.peek().text === text;
  }

  private checkNextText(text: string): boolean {
    const next = this.tokens[this.#current + 1];
    if (!next) {
      return false;
    }
    return next.text === text;
  }

  private advance(): Token {
    if (!this.checkKind("eof")) {
      this.#current++;
    }
    return this.previous();
  }

  private previous(): Token {
    return this.tokens[this.#current - 1];
  }

  private peek(): Token {
    return this.tokens[this.#current];
  }

  private reportHere(message: string): void {
    this.reportAt(this.peek(), message);
  }

  private reportAt(token: Token, message: string): void {
    this.diagnostics.push(syntaxDiagnostic(message, token.span, this.source));
  }

  private expressionSpan(
    left: GrammarV2Expression,
    right: GrammarV2Expression,
  ): SourceSpan {
    return this.span(left.span.start, right.span.end);
  }

  private span(start: number, end: number): SourceSpan {
    return spanAt(this.lineStarts, start, end);
  }
}

function readString(
  source: string,
  lineStarts: readonly number[],
  start: number,
): { token: Token; nextIndex: number; diagnostic?: Diagnostic } {
  let index = start + 1;
  let value = "";
  while (index < source.length && source[index] !== '"') {
    if (source[index] === "\\") {
      const escaped = source[index + 1];
      if (escaped === undefined) {
        const span = spanAt(lineStarts, start, index);
        return {
          token: { kind: "literal", text: value, span },
          nextIndex: index,
          diagnostic: syntaxDiagnostic("Unterminated escape.", span, source),
        };
      }
      value += escaped;
      index += 2;
      continue;
    }
    value += source[index];
    index++;
  }
  if (source[index] !== '"') {
    const span = spanAt(lineStarts, start, index);
    return {
      token: { kind: "literal", text: value, span },
      nextIndex: index,
      diagnostic: syntaxDiagnostic(
        "Unterminated string literal.",
        span,
        source,
      ),
    };
  }
  index++;
  return {
    token: {
      kind: "literal",
      text: value,
      span: spanAt(lineStarts, start, index),
    },
    nextIndex: index,
  };
}

function readRegex(
  source: string,
  lineStarts: readonly number[],
  start: number,
): { token: Token; nextIndex: number; diagnostic?: Diagnostic } {
  let index = start + 1;
  let pattern = "";
  let escaped = false;
  let inClass = false;
  while (index < source.length) {
    const current = source[index];
    if (current === "\n" || current === "\r") {
      const span = spanAt(lineStarts, start, index);
      return {
        token: { kind: "regex", text: pattern, span },
        nextIndex: index,
        diagnostic: syntaxDiagnostic(
          "Unterminated regex literal.",
          span,
          source,
        ),
      };
    }
    if (escaped) {
      pattern += current;
      escaped = false;
      index++;
      continue;
    }
    if (current === "\\") {
      pattern += current;
      escaped = true;
      index++;
      continue;
    }
    if (current === "[") {
      inClass = true;
      pattern += current;
      index++;
      continue;
    }
    if (current === "]") {
      inClass = false;
      pattern += current;
      index++;
      continue;
    }
    if (current === "/" && !inClass) {
      index++;
      return {
        token: {
          kind: "regex",
          text: pattern,
          span: spanAt(lineStarts, start, index),
        },
        nextIndex: index,
      };
    }
    pattern += current;
    index++;
  }
  const span = spanAt(lineStarts, start, index);
  return {
    token: { kind: "regex", text: pattern, span },
    nextIndex: index,
    diagnostic: syntaxDiagnostic("Unterminated regex literal.", span, source),
  };
}

function syntaxDiagnostic(
  message: string,
  span: SourceSpan,
  source: string,
): Diagnostic {
  return {
    code: "GRAMMAR_V2_PARSE_ERROR",
    severity: "error",
    message,
    span,
    sourceLine: getSourceLine(source, span.start),
  };
}

function emptySequence(span: SourceSpan): GrammarV2Expression {
  return { kind: "sequence", items: [], span };
}

function withExpressionSpan(
  expression: GrammarV2Expression,
  span: SourceSpan,
): GrammarV2Expression {
  return { ...expression, span };
}

function createLineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function spanAt(
  lineStarts: readonly number[],
  start: number,
  end: number,
): SourceSpan {
  const lineIndex = findLineIndex(lineStarts, start);
  return {
    start,
    end,
    line: lineIndex + 1,
    column: start - lineStarts[lineIndex] + 1,
  };
}

function findLineIndex(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return Math.max(0, low - 1);
}

function getSourceLine(source: string, offset: number): string {
  const lineStart = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const lineEnd = source.indexOf("\n", offset);
  if (lineEnd === -1) {
    return source.slice(lineStart);
  }
  return source.slice(lineStart, lineEnd);
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function isIdentStart(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z") ||
    char === "_";
}

function isIdentPart(char: string): boolean {
  return isIdentStart(char) || isDigit(char);
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}
