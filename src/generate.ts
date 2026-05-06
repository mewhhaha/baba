import type {
  EbnfExpression,
  EbnfGrammar,
  EbnfRule,
  GeneratedBundle,
  LexicalSpec,
  LexicalTokenSpec,
  TreeSitterCaptureMetadata,
  TreeSitterCaptureQueryEntry,
  TreeSitterCaptureSelectorMetadata,
  TreeSitterExtra,
  TreeSitterInjectionQueryEntry,
  TreeSitterMetadata,
  TreeSitterPathMetadata,
  TreeSitterRainbowsMetadata,
  TreeSitterRuleMetadata,
  TreeSitterRuleToken,
  TreeSitterRuleWrap,
} from "./ast.ts";
import { generatedBundle } from "./bundle.ts";
import { parseEbnf } from "./parser.ts";

const lexicalBuiltins = new Set([
  "char",
  "dedent",
  "fenced_template",
  "fenced_text",
  "ident",
  "indent",
  "int",
  "newline",
  "string",
]);
const treeSitterBuiltins = new Set([
  "char",
  "fenced_template",
  "fenced_template_close",
  "fenced_template_content",
  "fenced_template_open",
  "fenced_text",
  "fenced_text_close",
  "fenced_text_content",
  "fenced_text_open",
  "ident",
  "int",
  "line_comment",
  "line_end",
  "line_indent",
  "string",
  "wgsl_block",
  "wgsl_open",
  "wgsl_content",
  "wgsl_close",
]);
const reservedGrammarRuleNames = new Set([
  "source_file",
  ...lexicalBuiltins,
  ...treeSitterBuiltins,
]);
const reservedTokenDeclarationNames = new Set([
  "source_file",
  "identifier",
  "keyword",
  "number",
  "symbol",
  "eof",
  "newline",
  "indent",
  "dedent",
]);

const literalTokenizerHelpers = `
function scanNumericLiteral(source: string, start: number): number {
  if (
    source[start] === "0" &&
    (source[start + 1] === "x" || source[start + 1] === "X")
  ) {
    return scanDigits(source, start + 2, isHexDigit, "Expected hex digit after '0x'");
  }
  if (
    source[start] === "0" &&
    (source[start + 1] === "b" || source[start + 1] === "B")
  ) {
    return scanDigits(source, start + 2, isBinaryDigit, "Expected binary digit after '0b'");
  }
  return scanDigits(source, start, isDigit, "Expected digit");
}

function scanDigits(
  source: string,
  start: number,
  isAllowed: (char: string) => boolean,
  missingMessage: string,
): number {
  let i = start;
  if (i >= source.length || !isAllowed(source[i])) {
    throw new Error(\`\${missingMessage} at \${start}..\${start + 1}\`);
  }
  i++;
  while (i < source.length) {
    const char = source[i];
    if (isAllowed(char)) {
      i++;
      continue;
    }
    if (char === "_") {
      const next = source[i + 1];
      if (!next || !isAllowed(next)) {
        throw new Error(\`Invalid numeric separator at \${i}..\${i + 1}\`);
      }
      i += 2;
      continue;
    }
    break;
  }
  return i;
}

function scanCharLiteral(source: string, start: number): number {
  let i = start + 1;
  if (i >= source.length) {
    throw new Error(\`Unterminated character literal at \${start}..\${source.length}\`);
  }

  if (source[i] === "\\\\") {
    i++;
    const escape = source[i];
    if (!escape) {
      throw new Error(\`Unterminated character literal at \${start}..\${source.length}\`);
    }
    if (escape === "x") {
      if (!isHexDigit(source[i + 1] ?? "") || !isHexDigit(source[i + 2] ?? "")) {
        throw new Error(\`Expected two hex digits after \\\\x at \${i}..\${i + 1}\`);
      }
      i += 3;
    } else if (escape === "u") {
      if (source[i + 1] !== "{") {
        throw new Error(\`Expected '{' after \\\\u at \${i}..\${i + 1}\`);
      }
      let j = i + 2;
      if (!isHexDigit(source[j] ?? "")) {
        throw new Error(\`Expected hex digit after \\\\u{ at \${j}..\${j + 1}\`);
      }
      while (isHexDigit(source[j] ?? "")) j++;
      if (source[j] !== "}") {
        throw new Error(\`Expected '}' to close Unicode escape at \${j}..\${j + 1}\`);
      }
      i = j + 1;
    } else if (!isSimpleCharEscape(escape)) {
      throw new Error(\`Unknown character escape '\\\\\${escape}' at \${i - 1}..\${i + 1}\`);
    } else {
      i++;
    }
  } else {
    const char = source[i];
    if (char === "'" || char === "\\n" || char === "\\r") {
      throw new Error(\`Invalid character literal at \${start}..\${i + 1}\`);
    }
    const codePoint = source.codePointAt(i);
    if (codePoint === undefined) {
      throw new Error(\`Unterminated character literal at \${start}..\${source.length}\`);
    }
    i += codePoint > 0xffff ? 2 : 1;
  }

  if (source[i] !== "'") {
    throw new Error(\`Character literal must contain exactly one character at \${start}..\${i}\`);
  }
  return i + 1;
}

function scanStringLiteral(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    const char = source[i];
    if (char === "\\"") return i + 1;
    if (char === "\\n" || char === "\\r") {
      throw new Error(\`Unterminated string literal at \${start}..\${i + 1}\`);
    }
    if (char === "\\\\") {
      i++;
      const escape = source[i];
      if (!escape) {
        throw new Error(\`Unterminated string literal at \${start}..\${source.length}\`);
      }
      if (escape === "x") {
        if (!isHexDigit(source[i + 1] ?? "") || !isHexDigit(source[i + 2] ?? "")) {
          throw new Error(\`Expected two hex digits after \\\\x at \${i}..\${i + 1}\`);
        }
        i += 3;
        continue;
      }
      if (escape === "u") {
        if (source[i + 1] !== "{") {
          throw new Error(\`Expected '{' after \\\\u at \${i}..\${i + 1}\`);
        }
        let j = i + 2;
        if (!isHexDigit(source[j] ?? "")) {
          throw new Error(\`Expected hex digit after \\\\u{ at \${j}..\${j + 1}\`);
        }
        while (isHexDigit(source[j] ?? "")) j++;
        if (source[j] !== "}") {
          throw new Error(\`Expected '}' to close Unicode escape at \${j}..\${j + 1}\`);
        }
        i = j + 1;
        continue;
      }
      if (!isSimpleStringEscape(escape)) {
        throw new Error(\`Unknown string escape '\\\\\${escape}' at \${i - 1}..\${i + 1}\`);
      }
      i++;
      continue;
    }
    const codePoint = source.codePointAt(i);
    if (codePoint === undefined) {
      throw new Error(\`Unterminated string literal at \${start}..\${source.length}\`);
    }
    i += codePoint > 0xffff ? 2 : 1;
  }
  throw new Error(\`Unterminated string literal at \${start}..\${source.length}\`);
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function isHexDigit(char: string): boolean {
  return isDigit(char) || (char >= "a" && char <= "f") || (char >= "A" && char <= "F");
}

function isBinaryDigit(char: string): boolean {
  return char === "0" || char === "1";
}

function isSimpleCharEscape(char: string): boolean {
  return char === "0" ||
    char === "n" ||
    char === "r" ||
    char === "t" ||
    char === "'" ||
    char === "\\\\";
}

function isSimpleStringEscape(char: string): boolean {
  return char === "0" ||
    char === "n" ||
    char === "r" ||
    char === "t" ||
    char === "\\"" ||
    char === "\\\\";
}
`;

/** Validates grammar-level semantics before generation. */
export function validateEbnfGrammar(
  grammar: EbnfGrammar,
  options: { rootRule?: string } = {},
): void {
  if (grammar.rules.length === 0) {
    throw new Error("Expected at least one grammar rule");
  }

  const declaredNames = new Set<string>();
  const tokenNames = new Set<string>();
  for (const token of grammar.tokens) {
    if (reservedTokenDeclarationNames.has(token.name)) {
      throw new Error(`Token '${token.name}' uses reserved generated name`);
    }
    if (declaredNames.has(token.name)) {
      throw new Error(`Duplicate declaration '${token.name}'`);
    }
    try {
      const regex = new RegExp(token.pattern);
      if (regex.test("")) {
        throw new Error("must not match empty text");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid regex for token '${token.name}': ${message}`);
    }
    declaredNames.add(token.name);
    tokenNames.add(token.name);
  }

  const ruleNames = new Set<string>();
  for (const rule of grammar.rules) {
    if (reservedGrammarRuleNames.has(rule.name)) {
      throw new Error(`Rule '${rule.name}' uses reserved builtin name`);
    }
    if (ruleNames.has(rule.name)) {
      throw new Error(`Duplicate rule '${rule.name}'`);
    }
    if (declaredNames.has(rule.name)) {
      throw new Error(`Duplicate declaration '${rule.name}'`);
    }
    declaredNames.add(rule.name);
    ruleNames.add(rule.name);
  }

  if (options.rootRule && !ruleNames.has(options.rootRule)) {
    throw new Error(`Unknown root rule '${options.rootRule}'`);
  }

  for (const rule of grammar.rules) {
    visitRefs(rule.expression, (name) => {
      if (
        ruleNames.has(name) ||
        tokenNames.has(name) ||
        reservedGrammarRuleNames.has(name)
      ) return;
      throw new Error(
        `Unknown rule reference '${name}' in rule '${rule.name}'`,
      );
    });
  }
}

/** Builds the lexical specification used by generated tokenizers. */
export function createLexicalSpec(
  sourceOrGrammar: string | EbnfGrammar,
  options: { skipValidation?: boolean } = {},
): LexicalSpec {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  if (!options.skipValidation) validateEbnfGrammar(grammar);
  const terminals = collectTerminals(grammar);
  const keywords: string[] = [];
  const symbols: string[] = [];

  for (const terminal of terminals) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(terminal)) {
      keywords.push(terminal);
    } else {
      symbols.push(terminal);
    }
  }

  return {
    keywords: keywords.sort(),
    symbols: symbols.sort((left, right) =>
      right.length - left.length || left.localeCompare(right)
    ),
    tokens: grammar.tokens
      .filter((token) => token.kind === "token")
      .map((token) => ({ name: token.name, pattern: token.pattern })),
    skips: grammar.tokens
      .filter((token) => token.kind === "skip")
      .map((token) => ({ name: token.name, pattern: token.pattern })),
  };
}

/** Collects literal terminal strings referenced by grammar rules. */
export function collectTerminals(grammar: EbnfGrammar): string[] {
  const terminals = new Set<string>();
  for (const rule of grammar.rules) visit(rule.expression, terminals);
  return [...terminals].sort();
}

/** Generates a formatted JSON manifest for lexical terminals. */
export function generateLexicalManifest(
  sourceOrGrammar: string | EbnfGrammar,
  options: { spec?: LexicalSpec; skipValidation?: boolean } = {},
): string {
  const spec = options.spec ??
    createLexicalSpec(sourceOrGrammar, {
      skipValidation: options.skipValidation,
    });
  return `${JSON.stringify(spec, null, 2)}\n`;
}

/** Generates standalone TypeScript source for a tokenizer. */
export function generateTokenizerSource(
  sourceOrGrammar: string | EbnfGrammar,
  options: {
    exportName?: string;
    spec?: LexicalSpec;
    skipValidation?: boolean;
    metadata?: TreeSitterMetadata;
  } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  if (!options.skipValidation) validateEbnfGrammar(grammar);
  const spec = options.spec ??
    createLexicalSpec(grammar, { skipValidation: options.skipValidation });
  const exportName = options.exportName ?? "lex";
  const lineComment = languageComment(options.metadata ?? {});
  if (usesLayoutTokens(grammar)) {
    return generateLayoutTokenizerSource(spec, exportName, lineComment);
  }
  return `// Generated by @mewhhaha/baba. Do not edit by hand.
export type TokenKind = ${formatTokenKindUnion(tokenKindsForSpec(spec, false))};

export interface Token {
  kind: TokenKind;
  text: string;
  span: { start: number; end: number };
}

const keywords = new Set<string>(${formatStringArray(spec.keywords)});
const symbols: string[] = ${formatStringArray(spec.symbols)};
const skipPatterns: Array<{ kind: string; pattern: RegExp }> = ${
    formatPatternArray(spec.skips)
  };
const tokenPatterns: Array<{ kind: string; pattern: RegExp }> = ${
    formatPatternArray(spec.tokens)
  };
const lineComment = ${JSON.stringify(lineComment)};

export function ${exportName}(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const skipped = scanSkip(source, i);
    if (skipped > i) {
      i = skipped;
      continue;
    }

    const char = source[i];
    if (char === " " || char === "\\t" || char === "\\n" || char === "\\r") {
      i++;
      continue;
    }

    if (lineComment && source.startsWith(lineComment, i)) {
      i += lineComment.length;
      while (i < source.length && source[i] !== "\\n") i++;
      continue;
    }

    const token = scanToken(source, i);
    tokens.push(token);
    i = token.span.end;
  }

  tokens.push({ kind: "eof", text: "<eof>", span: { start: source.length, end: source.length } });
  return tokens;
}

${generatedTokenScannerHelpers()}
`;
}

/** Generates standalone TypeScript source for a deterministic parser scaffold. */
export function generateParserSource(
  sourceOrGrammar: string | EbnfGrammar,
  options: { rootRule?: string; skipValidation?: boolean } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  const rootRuleName = options.rootRule ?? grammar.rules[0]?.name ?? "module";
  if (!options.skipValidation) {
    validateEbnfGrammar(grammar, { rootRule: rootRuleName });
  }
  validateParserGrammar(grammar, rootRuleName);
  const rules = grammar.rules.map((rule) =>
    `  ${JSON.stringify(rule.name)}: ${
      renderParserExpression(rule.expression)
    },`
  ).join("\n");
  const astUnion = grammar.rules.map((rule) => astTypeName(rule.name)).join(
    " | ",
  ) || "never";
  const astInterfaces = grammar.rules.map((rule) =>
    `export interface ${astTypeName(rule.name)} {
  kind: ${JSON.stringify(rule.name)};
  type: ${JSON.stringify(rule.name)};
  node: RuleParseNode;
  children: AstNode[];
}`
  ).join("\n\n");
  const projectCases = grammar.rules.map((rule) =>
    `    case ${JSON.stringify(rule.name)}:
      return {
        kind: ${JSON.stringify(rule.name)},
        type: ${JSON.stringify(rule.name)},
        node,
        children: node.children.map(projectParseNode).filter((child): child is AstNode => child !== null),
      };`
  ).join("\n");

  return `// Generated by @mewhhaha/baba. Do not edit by hand.
import { lex } from "./tokenizer.ts";
import type { Token } from "./tokenizer.ts";

export type ParseNode = RuleParseNode | TokenParseNode | LiteralParseNode;
export interface RuleParseNode { kind: "rule"; name: string; span: { start: number; end: number }; children: ParseNode[]; }
export interface TokenParseNode { kind: "token"; name: string; text: string; span: { start: number; end: number }; token: Token; }
export interface LiteralParseNode { kind: "literal"; value: string; text: string; span: { start: number; end: number }; token: Token; }
export interface ParseDiagnostic { message: string; span?: { start: number; end: number }; token?: Token; }
export interface ParseResult { ok: boolean; tree: RuleParseNode | null; ast: AstNode | null; diagnostics: ParseDiagnostic[]; tokens: Token[]; }

export type AstNode = ${astUnion};

${astInterfaces}

type Expression =
  | { kind: "ref"; name: string }
  | { kind: "literal"; value: string }
  | { kind: "sequence"; items: Expression[] }
  | { kind: "choice"; options: Expression[] }
  | { kind: "optional"; expression: Expression }
  | { kind: "repeat"; expression: Expression }
  | { kind: "repeat1"; expression: Expression }
  | { kind: "separated"; item: Expression; separator: Expression };

const rules: Record<string, Expression> = {
${rules}
};
const rootRuleName = ${JSON.stringify(rootRuleName)};
const ruleNames = new Set(Object.keys(rules));

export function parse(source: string): ParseResult {
  let tokens: Token[] = [];
  try {
    tokens = lex(source);
    const parser = new Parser(tokens);
    let tree: RuleParseNode | null = null;
    try {
      tree = parser.parseRule(rootRuleName);
      parser.expectEof();
    } catch (error) {
      if (!(error instanceof ParseFailure)) throw error;
    }
    const diagnostics = parser.diagnostics;
    return { ok: diagnostics.length === 0, tree: diagnostics.length === 0 ? tree : null, ast: diagnostics.length === 0 && tree ? projectParseNode(tree) : null, diagnostics, tokens };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, tree: null, ast: null, diagnostics: [{ message }], tokens };
  }
}

export function projectParseNode(node: ParseNode): AstNode | null {
  if (node.kind !== "rule") return null;
  switch (node.name) {
${projectCases}
    default:
      return null;
  }
}

class Parser {
  readonly diagnostics: ParseDiagnostic[] = [];
  private current = 0;
  constructor(private readonly tokens: Token[]) {}
  parseRule(name: string): RuleParseNode {
    const expression = rules[name];
    if (!expression) throw new Error(\`Unknown parser rule '\${name}'\`);
    const start = this.peek().span.start;
    const children = this.matchExpression(expression);
    const end = children.length ? children[children.length - 1].span.end : start;
    return { kind: "rule", name, span: { start, end }, children };
  }
  expectEof(): void {
    if (this.peek().kind !== "eof") this.fail(\`Expected end of input, found '\${this.peek().text}'\`);
  }
  private matchExpression(expression: Expression): ParseNode[] {
    switch (expression.kind) {
      case "ref":
        return [this.matchRef(expression.name)];
      case "literal":
        return [this.matchLiteral(expression.value)];
      case "sequence": {
        const nodes: ParseNode[] = [];
        for (const item of expression.items) nodes.push(...this.matchExpression(item));
        return nodes;
      }
      case "choice":
        for (const option of expression.options) if (this.canStart(option)) return this.matchExpression(option);
        this.fail(\`Expected \${describeExpected(expression)}, found '\${this.peek().text}'\`);
      case "optional":
        return this.canStart(expression.expression) ? this.matchExpression(expression.expression) : [];
      case "repeat": {
        const nodes: ParseNode[] = [];
        while (this.canStart(expression.expression)) nodes.push(...this.matchExpression(expression.expression));
        return nodes;
      }
      case "repeat1": {
        const nodes = this.matchExpression(expression.expression);
        while (this.canStart(expression.expression)) nodes.push(...this.matchExpression(expression.expression));
        return nodes;
      }
      case "separated": {
        const nodes = this.matchExpression(expression.item);
        while (this.canStart(expression.separator)) {
          const mark = this.current;
          const separator = this.matchExpression(expression.separator);
          if (!this.canStart(expression.item)) {
            this.current = mark;
            break;
          }
          nodes.push(...separator, ...this.matchExpression(expression.item));
        }
        return nodes;
      }
    }
  }
  private matchRef(name: string): ParseNode {
    if (ruleNames.has(name)) return this.parseRule(name);
    const token = this.peek();
    if (matchesTokenRef(name, token)) {
      this.current++;
      return { kind: "token", name, text: token.text, span: token.span, token };
    }
    this.fail(\`Expected \${name}, found '\${token.text}'\`);
  }
  private matchLiteral(value: string): ParseNode {
    const token = this.peek();
    if ((token.kind === "keyword" || token.kind === "symbol") && token.text === value) {
      this.current++;
      return { kind: "literal", value, text: token.text, span: token.span, token };
    }
    this.fail(\`Expected '\${value}', found '\${token.text}'\`);
  }
  private canStart(expression: Expression): boolean {
    switch (expression.kind) {
      case "literal":
        return (this.peek().kind === "keyword" || this.peek().kind === "symbol") && this.peek().text === expression.value;
      case "ref":
        return ruleNames.has(expression.name) ? this.canStart(rules[expression.name]) : matchesTokenRef(expression.name, this.peek());
      case "sequence":
        for (const item of expression.items) {
          if (this.canStart(item)) return true;
          if (!expressionNullable(item)) return false;
        }
        return true;
      case "choice":
        return expression.options.some((option) => this.canStart(option));
      case "optional":
      case "repeat":
        return this.canStart(expression.expression);
      case "repeat1":
        return this.canStart(expression.expression);
      case "separated":
        return this.canStart(expression.item);
    }
  }
  private peek(): Token {
    return this.tokens[this.current] ?? this.tokens[this.tokens.length - 1];
  }
  private fail(message: string): never {
    const token = this.peek();
    this.diagnostics.push({ message, span: token.span, token });
    throw new ParseFailure(message);
  }
}

class ParseFailure extends Error {}

function matchesTokenRef(name: string, token: Token): boolean {
  const kind = token.kind as string;
  switch (name) {
    case "ident":
      return kind === "ident" || kind === "identifier";
    case "int":
    case "number":
      return kind === "int" || kind === "number";
    case "char":
    case "string":
    case "fenced_text":
    case "fenced_template":
    case "newline":
    case "indent":
    case "dedent":
      return kind === name;
    default:
      return kind === name;
  }
}

function describeExpected(expression: Expression): string {
  switch (expression.kind) {
    case "literal":
      return \`'\${expression.value}'\`;
    case "ref":
      return expression.name;
    case "choice":
      return expression.options.map(describeExpected).join(" or ");
    case "sequence":
      return expression.items.length ? describeExpected(expression.items[0]) : "empty";
    case "optional":
    case "repeat":
    case "repeat1":
      return describeExpected(expression.expression);
    case "separated":
      return describeExpected(expression.item);
  }
}

function expressionNullable(expression: Expression): boolean {
  switch (expression.kind) {
    case "literal":
      return false;
    case "ref":
      return ruleNames.has(expression.name) ? expressionNullable(rules[expression.name]) : false;
    case "sequence":
      return expression.items.every(expressionNullable);
    case "choice":
      return expression.options.some(expressionNullable);
    case "optional":
    case "repeat":
      return true;
    case "repeat1":
      return expressionNullable(expression.expression);
    case "separated":
      return expressionNullable(expression.item);
  }
}
`;
}

function generateLayoutTokenizerSource(
  spec: LexicalSpec,
  exportName: string,
  lineComment: string,
): string {
  return `// Generated by @mewhhaha/baba. Do not edit by hand.
export type TokenKind =
${
    tokenKindsForSpec(spec, true).map((kind) => `  | ${JSON.stringify(kind)}`)
      .join("\n")
  }
  | "newline"
  | "indent"
  | "dedent"
  | "eof";

export interface Token {
  kind: TokenKind;
  text: string;
  span: { start: number; end: number };
}

const keywords = new Set<string>(${formatStringArray(spec.keywords)});
const symbols: string[] = ${formatStringArray(spec.symbols)};
const skipPatterns: Array<{ kind: string; pattern: RegExp }> = ${
    formatPatternArray(spec.skips)
  };
const tokenPatterns: Array<{ kind: string; pattern: RegExp }> = ${
    formatPatternArray(spec.tokens)
  };
const lineComment = ${JSON.stringify(lineComment)};

export function ${exportName}(source: string): Token[] {
  const tokens: Token[] = [];
  const indentStack = [0];
  let i = 0;
  let atLineStart = true;
  let needsFinalNewline = false;

  while (i < source.length) {
    if (atLineStart) {
      const lineEnd = findLineEnd(source, i);
      const contentEnd = i + stripComment(source.slice(i, lineEnd));
      const line = source.slice(i, contentEnd);

      if (line.trim().length === 0) {
        i = skipLineEnding(source, lineEnd);
        continue;
      }

      const indent = countIndent(source, i, contentEnd);
      const previousIndent = indentStack.at(-1) ?? 0;
      if (indent > previousIndent) {
        indentStack.push(indent);
        tokens.push({
          kind: "indent",
          text: "<indent>",
          span: { start: i, end: i + indent },
        });
      } else if (indent < previousIndent) {
        while (indent < (indentStack.at(-1) ?? 0)) {
          indentStack.pop();
          tokens.push({
            kind: "dedent",
            text: "<dedent>",
            span: { start: i, end: i + indent },
          });
        }
        if (indent !== (indentStack.at(-1) ?? 0)) {
          throw new Error(
            \`Indentation does not match any outer block at \${i}..\${i + indent}\`,
          );
        }
      }

      i += indent;
      atLineStart = false;
      needsFinalNewline = true;
      continue;
    }

    const char = source[i];
    if (char === "\\n" || char === "\\r") {
      const end = char === "\\r" && source[i + 1] === "\\n" ? i + 2 : i + 1;
      tokens.push({
        kind: "newline",
        text: "<newline>",
        span: { start: i, end },
      });
      i = end;
      atLineStart = true;
      needsFinalNewline = false;
      continue;
    }

    if (char === " " || char === "\\t") {
      i++;
      continue;
    }

    const skipped = scanSkip(source, i);
    if (skipped > i) {
      i = skipped;
      continue;
    }

    if (lineComment && source.startsWith(lineComment, i)) {
      i += lineComment.length;
      while (i < source.length && source[i] !== "\\n" && source[i] !== "\\r") i++;
      continue;
    }

    const token = scanToken(source, i);
    tokens.push(token);
    i = token.span.end;
  }

  if (needsFinalNewline) {
    tokens.push({
      kind: "newline",
      text: "<newline>",
      span: { start: source.length, end: source.length },
    });
  }

  while (indentStack.length > 1) {
    indentStack.pop();
    tokens.push({
      kind: "dedent",
      text: "<dedent>",
      span: { start: source.length, end: source.length },
    });
  }

  tokens.push({ kind: "eof", text: "<eof>", span: { start: source.length, end: source.length } });
  return tokens;
}

function findLineEnd(source: string, start: number): number {
  let i = start;
  while (i < source.length && source[i] !== "\\n" && source[i] !== "\\r") i++;
  return i;
}

function skipLineEnding(source: string, lineEnd: number): number {
  if (source[lineEnd] === "\\r" && source[lineEnd + 1] === "\\n") return lineEnd + 2;
  if (source[lineEnd] === "\\r" || source[lineEnd] === "\\n") return lineEnd + 1;
  return lineEnd;
}

function stripComment(line: string): number {
  if (!lineComment) return line.length;
  const comment = line.indexOf(lineComment);
  return comment === -1 ? line.length : comment;
}

function countIndent(source: string, start: number, end: number): number {
  let i = start;
  while (i < end) {
    const char = source[i];
    if (char === " ") {
      i++;
      continue;
    }
    if (char === "\\t") {
      throw new Error(\`Tabs are not allowed for indentation at \${i}..\${i + 1}\`);
    }
    break;
  }
  return i - start;
}

${generatedTokenScannerHelpers()}
`;
}

const scannedTokenKinds = [
  "identifier",
  "number",
  "char",
  "string",
  "fenced_text",
  "fenced_template",
  "keyword",
  "symbol",
];
const baseTokenKinds = [...scannedTokenKinds, "eof"];
const layoutTokenKinds = scannedTokenKinds;

function tokenKindsForSpec(spec: LexicalSpec, layout: boolean): string[] {
  const base = layout ? layoutTokenKinds : baseTokenKinds;
  return [...new Set([...base, ...spec.tokens.map((token) => token.name)])];
}

function formatTokenKindUnion(kinds: string[]): string {
  return kinds.map((kind) => JSON.stringify(kind)).join(" | ");
}

function formatPatternArray(tokens: LexicalTokenSpec[]): string {
  if (tokens.length === 0) return "[]";
  const items = tokens.map((token) =>
    `  { kind: ${JSON.stringify(token.name)}, pattern: new RegExp(${
      JSON.stringify(token.pattern)
    }, "y") },`
  ).join("\n");
  return `[\n${items}\n]`;
}

function builtinTreeSitterRuleLines(
  grammar: EbnfGrammar,
  metadata: TreeSitterMetadata = {},
): string[] {
  const declaredTokens = new Set(grammar.tokens.map((token) => token.name));
  const comment = languageComment(metadata);
  const builtins: Record<string, string> = {
    ident: "    ident: $ => /[A-Za-z_][A-Za-z0-9_]*/,",
    int:
      "    int: $ => token(choice(/[0-9](?:_?[0-9])*/, /0[xX][0-9A-Fa-f](?:_?[0-9A-Fa-f])*/, /0[bB][01](?:_?[01])*/)),",
    char:
      "    char: $ => token(seq(\"'\", choice(/[^'\\\\\\n\\r]/, /\\\\[0nrt'\\\\]/, /\\\\x[0-9A-Fa-f]{2}/, /\\\\u\\{[0-9A-Fa-f]+\\}/), \"'\")),",
    string:
      "    string: $ => token(seq('\"', repeat(choice(/[^\"\\\\\\n\\r]/, /\\\\[0nrt\"\\\\]/, /\\\\x[0-9A-Fa-f]{2}/, /\\\\u\\{[0-9A-Fa-f]+\\}/)), '\"')),",
    line_end: "    line_end: $ => /\\r?\\n/,",
    line_indent: "    line_indent: $ => /[ ]+/,",
    line_comment: `    line_comment: $ => token(seq(${
      JSON.stringify(comment)
    }, /[^\\n]*/)),`,
    fenced_text:
      "    fenced_text: $ => choice(seq($.fenced_text_open, $.fenced_text_close), seq($.fenced_text_open, $.fenced_text_content, $.fenced_text_close)),",
    fenced_text_open: '    fenced_text_open: $ => token("```"),',
    fenced_text_content:
      "    fenced_text_content: $ => repeat1(choice(token.immediate(/[^`]+/), token.immediate(/`[^`]/), token.immediate(/``[^`]/))),",
    fenced_text_close: '    fenced_text_close: $ => token.immediate("```"),',
    fenced_template:
      "    fenced_template: $ => choice(seq($.fenced_template_open, $.fenced_template_close), seq($.fenced_template_open, $.fenced_template_content, $.fenced_template_close)),",
    fenced_template_open:
      '    fenced_template_open: $ => token("```template"),',
    fenced_template_content:
      "    fenced_template_content: $ => repeat1(choice(token.immediate(/[^`]+/), token.immediate(/`[^`]/), token.immediate(/``[^`]/))),",
    fenced_template_close:
      '    fenced_template_close: $ => token.immediate("```"),',
    wgsl_block:
      "    wgsl_block: $ => choice(seq($.wgsl_open, $.wgsl_close), seq($.wgsl_open, $.wgsl_content, $.wgsl_close)),",
    wgsl_open: '    wgsl_open: $ => token("```wgsl"),',
    wgsl_content:
      "    wgsl_content: $ => repeat1(choice(token.immediate(/[^`]+/), token.immediate(/`[^`]/), token.immediate(/``[^`]/))),",
    wgsl_close: '    wgsl_close: $ => token.immediate("```"),',
  };
  return Object.entries(builtins)
    .filter(([name]) => !declaredTokens.has(name))
    .map(([, line]) => line);
}

function generatedTokenScannerHelpers(): string {
  return `function scanToken(source: string, start: number): Token {
  if (source.startsWith("\`\`\`template", start)) {
    const endFence = source.indexOf("\`\`\`", start + "\`\`\`template".length);
    if (endFence === -1) {
      throw new Error(\`Unterminated template block at \${start}..\${source.length}\`);
    }
    const end = endFence + 3;
    return { kind: "fenced_template", text: source.slice(start, end), span: { start, end } };
  }

  if (source.startsWith("\`\`\`", start)) {
    const endFence = source.indexOf("\`\`\`", start + "\`\`\`".length);
    if (endFence === -1) {
      throw new Error(\`Unterminated text block at \${start}..\${source.length}\`);
    }
    const end = endFence + 3;
    return { kind: "fenced_text", text: source.slice(start, end), span: { start, end } };
  }

  const char = source[start];
  const symbol = symbols.find((candidate) => source.startsWith(candidate, start));
  if (symbol) {
    const end = start + symbol.length;
    return { kind: "symbol", text: symbol, span: { start, end } };
  }

  const keyword = matchKeyword(source, start);
  if (keyword) {
    return { kind: "keyword", text: keyword, span: { start, end: start + keyword.length } };
  }

  const declared = scanDeclaredToken(source, start);
  if (declared) return declared;

  if (char >= "0" && char <= "9") {
    const end = scanNumericLiteral(source, start);
    return { kind: "number", text: source.slice(start, end), span: { start, end } };
  }

  if (char === "'") {
    const end = scanCharLiteral(source, start);
    return { kind: "char", text: source.slice(start, end), span: { start, end } };
  }

  if (char === "\\"") {
    const end = scanStringLiteral(source, start);
    return { kind: "string", text: source.slice(start, end), span: { start, end } };
  }

  if (isIdentStart(char)) {
    let end = start + 1;
    while (end < source.length && isIdentPart(source[end])) end++;
    const text = source.slice(start, end);
    return {
      kind: keywords.has(text) ? "keyword" : "identifier",
      text,
      span: { start, end },
    };
  }

  throw new Error(\`Unexpected character '\${char}' at \${start}..\${start + 1}\`);
}

function scanSkip(source: string, start: number): number {
  for (const { pattern } of skipPatterns) {
    const match = matchPattern(pattern, source, start);
    if (match) return match.end;
  }
  return start;
}

function matchKeyword(source: string, start: number): string | null {
  for (const keyword of keywords) {
    if (!source.startsWith(keyword, start)) continue;
    const next = source[start + keyword.length];
    if (next !== undefined && isIdentPart(next)) continue;
    return keyword;
  }
  return null;
}

function scanDeclaredToken(source: string, start: number): Token | null {
  for (const { kind, pattern } of tokenPatterns) {
    const match = matchPattern(pattern, source, start);
    if (match) {
      return { kind: kind as TokenKind, text: match.text, span: { start, end: match.end } };
    }
  }
  return null;
}

function matchPattern(pattern: RegExp, source: string, start: number): { text: string; end: number } | null {
  pattern.lastIndex = start;
  const match = pattern.exec(source);
  if (!match || match.index !== start || match[0].length === 0) return null;
  return { text: match[0], end: start + match[0].length };
}

${literalTokenizerHelpers}

function isIdentStart(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z") || char === "_";
}

function isIdentPart(char: string): boolean {
  return isIdentStart(char) || (char >= "0" && char <= "9");
}
`;
}

function renderParserExpression(expression: EbnfExpression): string {
  switch (expression.kind) {
    case "ref":
      return `{ kind: "ref", name: ${JSON.stringify(expression.name)} }`;
    case "literal":
      return `{ kind: "literal", value: ${JSON.stringify(expression.value)} }`;
    case "sequence":
      return `{ kind: "sequence", items: [${
        expression.items.map(renderParserExpression).join(", ")
      }] }`;
    case "choice":
      return `{ kind: "choice", options: [${
        expression.options.map(renderParserExpression).join(", ")
      }] }`;
    case "optional":
      return `{ kind: "optional", expression: ${
        renderParserExpression(expression.expression)
      } }`;
    case "repeat":
      return `{ kind: "repeat", expression: ${
        renderParserExpression(expression.expression)
      } }`;
    case "repeat1":
      return `{ kind: "repeat1", expression: ${
        renderParserExpression(expression.expression)
      } }`;
    case "separated":
      return `{ kind: "separated", item: ${
        renderParserExpression(expression.item)
      }, separator: ${renderParserExpression(expression.separator)} }`;
  }
}

function validateParserGrammar(
  grammar: EbnfGrammar,
  rootRuleName: string,
): void {
  const rules = new Map(grammar.rules.map((rule) => [rule.name, rule]));
  if (!rules.has(rootRuleName)) {
    throw new Error(`Unknown root rule '${rootRuleName}'`);
  }
  for (const rule of grammar.rules) {
    const cycle = leftRecursivePath(
      rule.name,
      rule.expression,
      rules,
      [rule.name],
    );
    if (cycle) {
      throw new Error(
        `Left-recursive parser rule cycle: ${cycle.join(" -> ")}`,
      );
    }
    validateNoNullableRepeat(rule.expression, rules, rule.name);
    validatePredictiveChoices(rule.expression, rules, rule.name);
  }
}

function leftRecursivePath(
  origin: string,
  expression: EbnfExpression,
  rules: Map<string, EbnfRule>,
  path: string[],
): string[] | null {
  for (const name of leadingRefs(expression, rules)) {
    if (name === origin) return [...path, name];
    if (path.includes(name)) continue;
    const rule = rules.get(name);
    if (!rule) continue;
    const cycle = leftRecursivePath(origin, rule.expression, rules, [
      ...path,
      name,
    ]);
    if (cycle) return cycle;
  }
  return null;
}

function leadingRefs(
  expression: EbnfExpression,
  rules: Map<string, EbnfRule>,
): string[] {
  switch (expression.kind) {
    case "ref":
      return rules.has(expression.name) ? [expression.name] : [];
    case "literal":
      return [];
    case "choice":
      return [
        ...new Set(
          expression.options.flatMap((option) => leadingRefs(option, rules)),
        ),
      ];
    case "sequence": {
      const refs: string[] = [];
      for (const item of expression.items) {
        refs.push(...leadingRefs(item, rules));
        if (!isNullable(item, rules, new Set())) break;
      }
      return [...new Set(refs)];
    }
    case "optional":
    case "repeat":
    case "repeat1":
      return leadingRefs(expression.expression, rules);
    case "separated":
      return leadingRefs(expression.item, rules);
  }
}

function validateNoNullableRepeat(
  expression: EbnfExpression,
  rules: Map<string, EbnfRule>,
  ruleName: string,
): void {
  switch (expression.kind) {
    case "repeat":
    case "repeat1":
      if (isNullable(expression.expression, rules, new Set())) {
        throw new Error(
          `Nullable repetition in rule '${ruleName}' can match empty input`,
        );
      }
      validateNoNullableRepeat(expression.expression, rules, ruleName);
      return;
    case "optional":
      validateNoNullableRepeat(expression.expression, rules, ruleName);
      return;
    case "sequence":
      for (const item of expression.items) {
        validateNoNullableRepeat(item, rules, ruleName);
      }
      return;
    case "choice":
      for (const option of expression.options) {
        validateNoNullableRepeat(option, rules, ruleName);
      }
      return;
    case "separated":
      validateNoNullableRepeat(expression.item, rules, ruleName);
      validateNoNullableRepeat(expression.separator, rules, ruleName);
      return;
    case "ref":
    case "literal":
      return;
  }
}

function validatePredictiveChoices(
  expression: EbnfExpression,
  rules: Map<string, EbnfRule>,
  ruleName: string,
): void {
  if (expression.kind === "choice") {
    const seen = new Set<string>();
    for (const option of expression.options) {
      const starts = firstSet(option, rules, new Set());
      if (starts.has("<empty>")) {
        throw new Error(`Ambiguous nullable choice in rule '${ruleName}'`);
      }
      for (const start of starts) {
        if (seen.has(start)) {
          throw new Error(
            `Ambiguous predictive choice in rule '${ruleName}' overlaps on ${start}`,
          );
        }
        seen.add(start);
      }
    }
  }
  switch (expression.kind) {
    case "sequence":
      for (const item of expression.items) {
        validatePredictiveChoices(item, rules, ruleName);
      }
      return;
    case "choice":
      for (const option of expression.options) {
        validatePredictiveChoices(option, rules, ruleName);
      }
      return;
    case "optional":
    case "repeat":
    case "repeat1":
      validatePredictiveChoices(expression.expression, rules, ruleName);
      return;
    case "separated":
      validatePredictiveChoices(expression.item, rules, ruleName);
      validatePredictiveChoices(expression.separator, rules, ruleName);
      return;
    case "ref":
    case "literal":
      return;
  }
}

function isNullable(
  expression: EbnfExpression,
  rules: Map<string, EbnfRule>,
  visiting: Set<string>,
): boolean {
  switch (expression.kind) {
    case "literal":
      return false;
    case "ref": {
      const rule = rules.get(expression.name);
      if (!rule || visiting.has(rule.name)) return false;
      visiting.add(rule.name);
      const nullable = isNullable(rule.expression, rules, visiting);
      visiting.delete(rule.name);
      return nullable;
    }
    case "sequence":
      return expression.items.every((item) =>
        isNullable(item, rules, visiting)
      );
    case "choice":
      return expression.options.some((option) =>
        isNullable(option, rules, visiting)
      );
    case "optional":
    case "repeat":
      return true;
    case "repeat1":
      return isNullable(expression.expression, rules, visiting);
    case "separated":
      return isNullable(expression.item, rules, visiting);
  }
}

function firstSet(
  expression: EbnfExpression,
  rules: Map<string, EbnfRule>,
  visiting: Set<string>,
): Set<string> {
  switch (expression.kind) {
    case "literal":
      return new Set([`literal:${expression.value}`]);
    case "ref": {
      const rule = rules.get(expression.name);
      if (!rule) {
        return new Set([`token:${parserTokenRefName(expression.name)}`]);
      }
      if (visiting.has(rule.name)) return new Set();
      visiting.add(rule.name);
      const starts = firstSet(rule.expression, rules, visiting);
      visiting.delete(rule.name);
      return starts;
    }
    case "sequence": {
      const starts = new Set<string>();
      for (const item of expression.items) {
        const itemStarts = firstSet(item, rules, visiting);
        for (const start of itemStarts) {
          if (start !== "<empty>") starts.add(start);
        }
        if (!isNullable(item, rules, new Set())) return starts;
      }
      starts.add("<empty>");
      return starts;
    }
    case "choice":
      return new Set(
        expression.options.flatMap((
          option,
        ) => [...firstSet(option, rules, visiting)]),
      );
    case "optional":
    case "repeat": {
      const starts = firstSet(expression.expression, rules, visiting);
      starts.add("<empty>");
      return starts;
    }
    case "repeat1":
      return firstSet(expression.expression, rules, visiting);
    case "separated":
      return firstSet(expression.item, rules, visiting);
  }
}

function parserTokenRefName(name: string): string {
  if (name === "ident") return "identifier";
  if (name === "int") return "number";
  return name;
}

export { parseTreeSitterMetadata } from "./metadata.ts";

/** Generates an ESM tree-sitter grammar source file. */
export function generateTreeSitterGrammar(
  sourceOrGrammar: string | EbnfGrammar,
  options: {
    name?: string;
    rootRule?: string;
    metadata?: TreeSitterMetadata;
    skipValidation?: boolean;
  } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  const name = options.name ?? "waesm";
  const rootRuleName = options.rootRule ?? grammar.rules[0]?.name ?? "module";
  if (!options.skipValidation) {
    validateEbnfGrammar(grammar, { rootRule: rootRuleName });
  }
  const rootRule = grammar.rules.find((rule) => rule.name === rootRuleName);
  if (!rootRule) throw new Error(`Unknown root rule '${rootRuleName}'`);

  if (!options.skipValidation) {
    validateTreeSitterMetadataSemantics(
      grammar,
      rootRuleName,
      options.metadata,
    );
  }

  const metadata = options.metadata ?? {};
  const context = createRenderContext(grammar, rootRuleName, metadata);
  const sourceFileMeta = metadata.rules?.source_file ??
    metadata.rules?.[rootRuleName];
  const ruleLines = [
    `    source_file: $ => ${
      renderRuleExpression(
        "source_file",
        rootRule.expression,
        sourceFileMeta,
        context,
      )
    },`,
    ...grammar.rules
      .map((rule) => {
        const rendered = renderRuleExpression(
          rule.name,
          rule.expression,
          metadata.rules?.[rule.name],
          context,
        );
        return `    ${formatRuleKey(rule.name)}: $ => ${rendered},`;
      }),
    ...grammar.tokens.map((token) => {
      const rendered = token.kind === "token"
        ? `token(${formatRegexLiteral(token.pattern)})`
        : formatRegexLiteral(token.pattern);
      return `    ${formatRuleKey(token.name)}: $ => ${rendered},`;
    }),
    ...[...context.helperRules.entries()].map(([name, rendered]) =>
      `    ${formatRuleKey(name)}: $ => ${rendered},`
    ),
    ...builtinTreeSitterRuleLines(grammar, metadata),
  ];

  const headerLines = [
    `// Generated by @mewhhaha/baba. Do not edit by hand.`,
    "export default grammar({",
    `  name: ${JSON.stringify(name)},`,
    "",
  ];

  const extras = [
    ...(metadata.extras ?? []),
    ...grammar.tokens
      .filter((token) => token.kind === "skip")
      .map((token): TreeSitterExtra => ({ kind: "rule", name: token.name })),
  ];
  if (extras.length) {
    headerLines.push("  extras: $ => [");
    for (const extra of extras) {
      headerLines.push(`    ${renderExtra(extra)},`);
    }
    headerLines.push("  ],", "");
  }

  if (metadata.word) {
    headerLines.push(`  word: $ => $.${metadata.word},`, "");
  }

  if (metadata.supertypes?.length) {
    headerLines.push(
      `  supertypes: $ => ${renderRuleRefArray(metadata.supertypes)},`,
      "",
    );
  }

  if (metadata.conflicts?.length) {
    headerLines.push("  conflicts: $ => [");
    for (const conflict of metadata.conflicts) {
      headerLines.push(`    ${renderRuleRefArray(conflict)},`);
    }
    headerLines.push("  ],", "");
  }

  const inlineRules = collectInlineRules(metadata);
  if (inlineRules.length) {
    headerLines.push(`  inline: $ => ${renderRuleRefArray(inlineRules)},`, "");
  }

  return `${headerLines.join("\n")}  rules: {\n${
    ruleLines.join("\n")
  }\n  },\n});\n`;
}

/** Generates an optional tree-sitter rainbow-bracket query. */
export function generateTreeSitterRainbowsQuery(
  sourceOrGrammar: string | EbnfGrammar,
  options: { metadata?: TreeSitterMetadata; skipValidation?: boolean } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  if (!options.skipValidation) validateEbnfGrammar(grammar);
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateTreeSitterQueryMetadata(grammar, metadata);
  }

  const rainbow = metadata.queries?.rainbows;
  const patterns = rainbow?.patterns ?? [];
  const scopes = rainbow?.scopes ?? [];
  const brackets = rainbow?.brackets ?? collectDefaultRainbowBrackets(grammar);
  const lines: string[] = [...patterns];
  if (patterns.length > 0 && (scopes.length > 0 || brackets.length > 0)) {
    lines.push("");
  }

  if (scopes.length > 0) {
    lines.push("[");
    for (const scope of scopes) lines.push(`  (${scope})`);
    lines.push("] @rainbow.scope", "");
  }

  if (brackets.length > 0) {
    lines.push("[");
    for (const bracket of brackets) lines.push(`  ${JSON.stringify(bracket)}`);
    lines.push("] @rainbow.bracket", "");
  }

  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

/** Generates an optional tree-sitter injection query. */
export function generateTreeSitterInjectionsQuery(
  sourceOrGrammar: string | EbnfGrammar,
  options: { metadata?: TreeSitterMetadata; skipValidation?: boolean } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  if (!options.skipValidation) validateEbnfGrammar(grammar);
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateTreeSitterQueryMetadata(grammar, metadata);
  }

  const injections = metadata.queries?.injections ?? [];
  if (injections.length === 0) return "";

  const blocks: string[] = [];
  for (const injection of injections) {
    if (isRawQueryEntry(injection)) {
      blocks.push(injection.pattern, "");
      continue;
    }
    blocks.push(
      `((${injection.node}) @injection.content`,
      `  (#set! injection.language ${JSON.stringify(injection.language)}))`,
      "",
    );
  }
  return `${blocks.join("\n").trimEnd()}\n`;
}

/** Generates a tree-sitter highlight query. */
export function generateTreeSitterHighlightsQuery(
  sourceOrGrammar: string | EbnfGrammar,
  options: { metadata?: TreeSitterMetadata; skipValidation?: boolean } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  if (!options.skipValidation) validateEbnfGrammar(grammar);
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateTreeSitterQueryMetadata(grammar, metadata);
  }

  const explicit = resolveHighlightCaptureSelectors(
    metadata.queries?.highlights?.entries ?? [],
    grammar,
  );
  const explicitSelectors = new Set(
    explicit.filter(isCaptureMetadata).map(captureSelectorKey),
  );
  for (
    const suppress of metadata.queries?.highlights?.defaults?.suppress ?? []
  ) {
    explicitSelectors.add(captureSelectorKey(suppress));
  }
  const lines = [
    ...renderCaptureQueryEntries(explicit),
    ...defaultHighlightQueryEntries(grammar, metadata, explicitSelectors),
  ];
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

/** Generates a metadata-driven tree-sitter locals query. */
export function generateTreeSitterLocalsQuery(
  sourceOrGrammar: string | EbnfGrammar,
  options: { metadata?: TreeSitterMetadata; skipValidation?: boolean } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  if (!options.skipValidation) validateEbnfGrammar(grammar);
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateTreeSitterQueryMetadata(grammar, metadata);
  }
  return renderCaptureQuery(metadata.queries?.locals ?? []);
}

/** Generates a metadata-driven tree-sitter folds query. */
export function generateTreeSitterFoldsQuery(
  sourceOrGrammar: string | EbnfGrammar,
  options: { metadata?: TreeSitterMetadata; skipValidation?: boolean } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  if (!options.skipValidation) validateEbnfGrammar(grammar);
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateTreeSitterQueryMetadata(grammar, metadata);
  }
  return renderCaptureQuery(metadata.queries?.folds ?? []);
}

/** Generates a metadata-driven tree-sitter indentation query. */
export function generateTreeSitterIndentsQuery(
  sourceOrGrammar: string | EbnfGrammar,
  options: { metadata?: TreeSitterMetadata; skipValidation?: boolean } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  if (!options.skipValidation) validateEbnfGrammar(grammar);
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateTreeSitterQueryMetadata(grammar, metadata);
  }
  return renderCaptureQuery(metadata.queries?.indents ?? []);
}

/** Generates a metadata-driven tree-sitter tags query. */
export function generateTreeSitterTagsQuery(
  sourceOrGrammar: string | EbnfGrammar,
  options: { metadata?: TreeSitterMetadata; skipValidation?: boolean } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  if (!options.skipValidation) validateEbnfGrammar(grammar);
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateTreeSitterQueryMetadata(grammar, metadata);
  }
  return renderCaptureQuery(metadata.queries?.tags ?? []);
}

/** Generates a metadata-driven tree-sitter textobjects query. */
export function generateTreeSitterTextobjectsQuery(
  sourceOrGrammar: string | EbnfGrammar,
  options: { metadata?: TreeSitterMetadata; skipValidation?: boolean } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  if (!options.skipValidation) validateEbnfGrammar(grammar);
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateTreeSitterQueryMetadata(grammar, metadata);
  }
  return renderCaptureQuery(metadata.queries?.textobjects ?? []);
}

/** Generates TypeScript AST facade types for tree-sitter nodes. */
export function generateAstTypesSource(
  sourceOrGrammar: string | EbnfGrammar,
  options: { metadata?: TreeSitterMetadata; skipValidation?: boolean } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  if (!options.skipValidation) validateEbnfGrammar(grammar);
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateWorkbenchMetadataSemantics(grammar, metadata);
  }

  const nodeTypes = grammar.rules.map((rule) => astTypeName(rule.name));
  const union = nodeTypes.length ? nodeTypes.join(" | ") : "never";
  const interfaces = grammar.rules.map((rule) => {
    const astNode = metadata.ast?.nodes?.[rule.name];
    const kind = astNode?.kind ?? rule.name;
    const fields = astFieldsForNode(rule.name, metadata);
    const fieldType = fields.length === 0
      ? "Record<string, never>"
      : `{\n${
        fields.map((field) =>
          `    ${quoteProperty(field.name)}: SyntaxNodeLike | null;`
        ).join("\n")
      }\n  }`;
    return `export interface ${astTypeName(rule.name)} {
  kind: ${JSON.stringify(kind)};
  type: ${JSON.stringify(rule.name)};
  node: SyntaxNodeLike;
  fields: ${fieldType};
}`;
  });

  return `// Generated by @mewhhaha/baba. Do not edit by hand.
export interface SyntaxNodeLike {
  type: string;
  text: string;
  namedChildren?: readonly SyntaxNodeLike[];
  childForFieldName?(name: string): SyntaxNodeLike | null;
}

export type AstNode = ${union};

${interfaces.join("\n\n")}
`;
}

/** Generates TypeScript visitor helpers for generated AST facade types. */
export function generateAstVisitorSource(
  sourceOrGrammar: string | EbnfGrammar,
  options: { metadata?: TreeSitterMetadata; skipValidation?: boolean } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  if (!options.skipValidation) validateEbnfGrammar(grammar);
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateWorkbenchMetadataSemantics(grammar, metadata);
  }

  const imports = [
    "AstNode",
    "SyntaxNodeLike",
    ...grammar.rules.map((rule) => astTypeName(rule.name)),
  ];
  const visitorMethods = grammar.rules.map((rule) => {
    const kind = metadata.ast?.nodes?.[rule.name]?.kind ?? rule.name;
    return `  ${quoteProperty(kind)}?: (node: ${astTypeName(rule.name)}) => R;`;
  });
  const projectCases = grammar.rules.map((rule) => {
    const fields = astFieldsForNode(rule.name, metadata);
    const renderedFields = fields.length === 0
      ? "{}"
      : `{\n${
        fields.map((field) =>
          `        ${quoteProperty(field.name)}: readField(node, ${
            JSON.stringify(field.treeField)
          }),`
        ).join("\n")
      }\n      }`;
    return `    case ${JSON.stringify(rule.name)}:
      return {
        kind: ${
      JSON.stringify(metadata.ast?.nodes?.[rule.name]?.kind ?? rule.name)
    },
        type: ${JSON.stringify(rule.name)},
        node,
        fields: ${renderedFields},
      };`;
  });

  return `// Generated by @mewhhaha/baba. Do not edit by hand.
import type { ${imports.join(", ")} } from "./types.ts";

export interface AstVisitor<R = void> {
${visitorMethods.join("\n")}
  unknown?: (node: SyntaxNodeLike) => R;
}

export function projectNode(node: SyntaxNodeLike): AstNode | null {
  switch (node.type) {
${projectCases.join("\n")}
    default:
      return null;
  }
}

export function visitAstNode<R>(
  node: AstNode,
  visitor: AstVisitor<R>,
): R | undefined {
  const visit = (visitor as Record<string, ((node: AstNode) => R) | undefined>)[node.kind];
  if (visit) return visit(node);
  return visitor.unknown?.(node.node);
}

export function walkSyntaxNode(
  node: SyntaxNodeLike,
  visit: (node: SyntaxNodeLike) => void,
): void {
  visit(node);
  for (const child of node.namedChildren ?? []) walkSyntaxNode(child, visit);
}

function readField(node: SyntaxNodeLike, name: string): SyntaxNodeLike | null {
  return node.childForFieldName?.(name) ?? null;
}
`;
}

/** Generates a conservative formatter scaffold that preserves unsupported text. */
export function generateFormatterScaffoldSource(
  sourceOrGrammar: string | EbnfGrammar,
  options: { metadata?: TreeSitterMetadata; skipValidation?: boolean } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  if (!options.skipValidation) validateEbnfGrammar(grammar);
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateWorkbenchMetadataSemantics(grammar, metadata);
  }

  return `// Generated by @mewhhaha/baba. Do not edit by hand.
export interface FormatNode {
  type: string;
  text: string;
  namedChildren?: readonly FormatNode[];
}

export interface FormatOptions {
  indent?: string;
}

const blockNodes = new Set(${
    formatStringArray(metadata.formatter?.blocks ?? [])
  });
const listNodes = new Set(${
    formatStringArray(metadata.formatter?.lists ?? [])
  });
const spacing = new Map(${
    JSON.stringify(Object.entries(metadata.formatter?.spacing ?? {}))
  });

export function formatNode(node: FormatNode, options: FormatOptions = {}): string {
  const indent = options.indent ?? "  ";
  if (blockNodes.has(node.type)) return formatBlock(node, indent);
  if (listNodes.has(node.type)) return formatList(node, indent);
  return node.text;
}

function formatBlock(node: FormatNode, _indent: string): string {
  return node.text;
}

function formatList(node: FormatNode, _indent: string): string {
  return node.text;
}

export function spacingForLiteral(literal: string): "tight" | "space" | "newline" | undefined {
  return spacing.get(literal) as "tight" | "space" | "newline" | undefined;
}
`;
}

/** Generates a Deno-friendly LSP state scaffold. */
export function generateLspScaffoldSource(
  sourceOrGrammar: string | EbnfGrammar,
  options: { metadata?: TreeSitterMetadata; skipValidation?: boolean } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  if (!options.skipValidation) validateEbnfGrammar(grammar);
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateWorkbenchMetadataSemantics(grammar, metadata);
  }

  return `// Generated by @mewhhaha/baba. Do not edit by hand.
export interface TextDocument {
  uri: string;
  version: number;
  text: string;
}

export interface Diagnostic {
  uri: string;
  message: string;
  severity: "error" | "warning" | "information";
}

export interface DocumentSymbol {
  name: string;
  kind: string;
}

const documentSymbolNodes = new Set(${
    formatStringArray(metadata.lsp?.documentSymbols ?? [])
  });
const diagnosticNodes = new Set(${
    formatStringArray(metadata.lsp?.diagnostics ?? [])
  });

export class LanguageServerState {
  readonly documents = new Map<string, TextDocument>();

  updateDocument(document: TextDocument): void {
    this.documents.set(document.uri, document);
  }

  removeDocument(uri: string): void {
    this.documents.delete(uri);
  }

  diagnostics(uri: string): Diagnostic[] {
    const document = this.documents.get(uri);
    if (!document) return [];
    void diagnosticNodes;
    return [];
  }

  documentSymbols(uri: string): DocumentSymbol[] {
    const document = this.documents.get(uri);
    if (!document) return [];
    void documentSymbolNodes;
    return [];
  }
}
`;
}

/** Generates the complete opt-in workbench scaffold as path/content pairs. */
export function generateWorkbenchBundle(
  sourceOrGrammar: string | EbnfGrammar,
  options: {
    name?: string;
    rootRule?: string;
    metadata?: TreeSitterMetadata;
    skipValidation?: boolean;
  } = {},
): GeneratedBundle {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  const name = options.name ?? "grammar";
  const rootRuleName = options.rootRule ?? grammar.rules[0]?.name ?? "module";
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateEbnfGrammar(grammar, { rootRule: rootRuleName });
    validateTreeSitterMetadataSemantics(grammar, rootRuleName, metadata);
    validateTreeSitterQueryMetadata(grammar, metadata);
    validateWorkbenchMetadataSemantics(grammar, metadata);
  }

  const treeSitter = generateTreeSitterGrammar(grammar, {
    name,
    rootRule: rootRuleName,
    metadata,
    skipValidation: true,
  });
  const spec = createLexicalSpec(grammar, { skipValidation: true });
  const queries = generateWorkbenchQueries(grammar, {
    metadata,
    skipValidation: true,
  });
  const sample = generateGrammarSample(grammar, rootRuleName);

  return generatedBundle("workbench", [
    ["lexical.json", generateLexicalManifest(grammar, { spec })],
    [
      "tokenizer.ts",
      generateTokenizerSource(grammar, {
        spec,
        metadata,
        skipValidation: true,
      }),
    ],
    [
      "parser.ts",
      generateParserSource(grammar, {
        rootRule: rootRuleName,
        skipValidation: true,
      }),
    ],
    ["grammar.js", treeSitter],
    ["tree-sitter.json", generateTreeSitterConfigSource(name, metadata)],
    ["package.json", generateTreeSitterPackageSource(name, metadata)],
    ["README.md", generateWorkbenchReadmeSource(name)],
    ["queries/highlights.scm", queries["highlights.scm"]],
    ["queries/locals.scm", queries["locals.scm"]],
    ["queries/folds.scm", queries["folds.scm"]],
    ["queries/indents.scm", queries["indents.scm"]],
    ["queries/tags.scm", queries["tags.scm"]],
    ["queries/textobjects.scm", queries["textobjects.scm"]],
    ["queries/rainbows.scm", queries["rainbows.scm"]],
    ["queries/injections.scm", queries["injections.scm"]],
    [
      "editor/helix/languages.toml",
      generateHelixLanguageSource(name, metadata),
    ],
    ["editor/nvim/README.md", generateNvimReadmeSource(name)],
    ["editor/vscode/package.json", generateVsCodePackageSource(name, metadata)],
    [
      "editor/vscode/language-configuration.json",
      generateVsCodeLanguageConfigurationSource(metadata),
    ],
    [
      "editor/vscode/syntaxes/README.md",
      generateVsCodeSyntaxReadmeSource(name),
    ],
    [
      "ast/types.ts",
      generateAstTypesSource(grammar, { metadata, skipValidation: true }),
    ],
    [
      "ast/visitor.ts",
      generateAstVisitorSource(grammar, { metadata, skipValidation: true }),
    ],
    ["tests/corpus/basic.txt", generateCorpusTestSource(sample)],
    ["tests/tokenizer_test.ts", generateTokenizerSmokeTestSource(sample)],
    [
      "lsp/server.ts",
      generateLspScaffoldSource(grammar, { metadata, skipValidation: true }),
    ],
    ["lsp/README.md", generateLspReadmeSource(name)],
    [
      "formatter/format.ts",
      generateFormatterScaffoldSource(grammar, {
        metadata,
        skipValidation: true,
      }),
    ],
    ["formatter/README.md", generateFormatterReadmeSource(name)],
  ]);
}

/** Generates every tree-sitter query file used by the workbench preset. */
export function generateWorkbenchQueries(
  sourceOrGrammar: string | EbnfGrammar,
  options: { metadata?: TreeSitterMetadata; skipValidation?: boolean } = {},
): Record<string, string> {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  const metadata = options.metadata;
  return {
    "highlights.scm": generateTreeSitterHighlightsQuery(grammar, {
      metadata,
      skipValidation: options.skipValidation,
    }),
    "locals.scm": generateTreeSitterLocalsQuery(grammar, {
      metadata,
      skipValidation: options.skipValidation,
    }),
    "folds.scm": generateTreeSitterFoldsQuery(grammar, {
      metadata,
      skipValidation: options.skipValidation,
    }),
    "indents.scm": generateTreeSitterIndentsQuery(grammar, {
      metadata,
      skipValidation: options.skipValidation,
    }),
    "tags.scm": generateTreeSitterTagsQuery(grammar, {
      metadata,
      skipValidation: options.skipValidation,
    }),
    "textobjects.scm": generateTreeSitterTextobjectsQuery(grammar, {
      metadata,
      skipValidation: options.skipValidation,
    }),
    "rainbows.scm": generateTreeSitterRainbowsQuery(grammar, {
      metadata,
      skipValidation: options.skipValidation,
    }),
    "injections.scm": generateTreeSitterInjectionsQuery(grammar, {
      metadata,
      skipValidation: options.skipValidation,
    }),
  };
}

function renderCaptureQuery(captures: TreeSitterCaptureQueryEntry[]): string {
  const lines = renderCaptureQueryEntries(captures);
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

function renderCaptureQueryEntries(
  captures: TreeSitterCaptureQueryEntry[],
): string[] {
  return captures.map((capture) => {
    if (isRawQueryEntry(capture)) return capture.pattern;
    if (capture.node) return `(${capture.node}) @${capture.capture}`;
    return `${JSON.stringify(capture.literal)} @${capture.capture}`;
  });
}

function captureSelectorKey(
  capture: TreeSitterCaptureSelectorMetadata,
): string {
  return capture.node ? `node:${capture.node}` : `literal:${capture.literal}`;
}

function resolveHighlightCaptureSelectors(
  captures: TreeSitterCaptureQueryEntry[],
  grammar: EbnfGrammar,
): TreeSitterCaptureQueryEntry[] {
  const anonymousLiterals = collectAnonymousLiteralTerminals(grammar);
  const singleLiteralRules = collectSingleLiteralRules(grammar);
  return captures.map((capture) => {
    if (isRawQueryEntry(capture)) return capture;
    if (!capture.literal || anonymousLiterals.has(capture.literal)) {
      return capture;
    }
    const wrapper = singleLiteralRules.get(capture.literal);
    if (!wrapper) return capture;
    return { node: wrapper, capture: capture.capture };
  });
}

function isRawQueryEntry(
  entry: TreeSitterCaptureQueryEntry | TreeSitterInjectionQueryEntry,
): entry is { pattern: string } {
  return "pattern" in entry;
}

function isCaptureMetadata(
  entry: TreeSitterCaptureQueryEntry,
): entry is TreeSitterCaptureMetadata {
  return !isRawQueryEntry(entry);
}

function defaultHighlightQueryEntries(
  grammar: EbnfGrammar,
  metadata: TreeSitterMetadata,
  explicitSelectors: Set<string>,
): string[] {
  const lines: string[] = [];
  const terminals = collectTerminals(grammar);
  const namedLiteralTerminals = collectNamedLiteralRuleTerminals(grammar);
  const exposedNodes = collectExposedTreeSitterNodeNames(
    grammar,
    metadata,
  );
  const pushNode = (node: string, capture: string) => {
    if (!exposedNodes.has(node) || explicitSelectors.has(`node:${node}`)) {
      return;
    }
    lines.push(`(${node}) @${capture}`);
  };
  const pushLiteral = (literal: string, capture: string) => {
    if (explicitSelectors.has(`literal:${literal}`)) return;
    lines.push(`${JSON.stringify(literal)} @${capture}`);
  };

  for (const terminal of terminals) {
    if (namedLiteralTerminals.has(terminal)) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(terminal)) {
      pushLiteral(terminal, "keyword");
    }
  }

  const bracketLiterals = new Set(["(", ")", "[", "]", "{", "}"]);
  const delimiterLiterals = new Set([",", ";", ":", "."]);
  for (const terminal of terminals) {
    if (namedLiteralTerminals.has(terminal)) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(terminal)) continue;
    if (bracketLiterals.has(terminal)) {
      pushLiteral(terminal, "punctuation.bracket");
    } else if (delimiterLiterals.has(terminal)) {
      pushLiteral(terminal, "punctuation.delimiter");
    } else {
      pushLiteral(terminal, "operator");
    }
  }

  pushNode("string", "string");
  pushNode("char", "string.special");
  pushNode("fenced_text", "string.special");
  pushNode("fenced_template", "string.special");
  pushNode("int", "number");
  pushNode("number", "number");
  pushNode("ident", "variable");
  pushNode("line_comment", "comment");

  for (const token of grammar.tokens) {
    if (token.kind !== "token") continue;
    if (explicitSelectors.has(`node:${token.name}`)) continue;
    const capture = token.name === "ident"
      ? "variable"
      : token.name === "int" || token.name === "number"
      ? "number"
      : "constant";
    lines.push(`(${token.name}) @${capture}`);
  }

  return lines;
}

function collectExposedTreeSitterNodeNames(
  grammar: EbnfGrammar,
  metadata: TreeSitterMetadata,
): Set<string> {
  const names = new Set<string>(["source_file"]);
  const rulesByName = new Map(grammar.rules.map((rule) => [rule.name, rule]));
  const tokensByName = new Map(
    grammar.tokens.map((token) => [token.name, token]),
  );
  const queue = grammar.rules[0] ? [grammar.rules[0].name] : [];

  for (let index = 0; index < queue.length; index++) {
    const name = queue[index];
    if (names.has(name)) continue;
    names.add(name);

    const rule = rulesByName.get(name);
    if (rule) {
      for (const ref of collectExpressionRefs(rule.expression)) {
        if (!names.has(ref)) queue.push(ref);
      }
      continue;
    }

    if (tokensByName.has(name) || treeSitterBuiltins.has(name)) {
      names.add(name);
    }
  }

  for (const ruleMeta of Object.values(metadata.rules ?? {})) {
    for (const pathMeta of Object.values(ruleMeta.paths ?? {})) {
      if (pathMeta.alias_node) names.add(pathMeta.alias_node);
      if (pathMeta.alias_ref) names.add(pathMeta.alias_ref);
    }
  }

  return names;
}

function collectExpressionRefs(expression: EbnfExpression): string[] {
  const refs: string[] = [];
  collectExpressionRefsInto(expression, refs);
  return refs;
}

function collectExpressionRefsInto(
  expression: EbnfExpression,
  refs: string[],
): void {
  switch (expression.kind) {
    case "ref":
      refs.push(expression.name);
      return;
    case "sequence":
      for (const item of expression.items) {
        collectExpressionRefsInto(item, refs);
      }
      return;
    case "choice":
      for (const option of expression.options) {
        collectExpressionRefsInto(option, refs);
      }
      return;
    case "optional":
    case "repeat":
    case "repeat1":
      collectExpressionRefsInto(expression.expression, refs);
      return;
    case "separated":
      collectExpressionRefsInto(expression.item, refs);
      collectExpressionRefsInto(expression.separator, refs);
      return;
    case "literal":
      return;
  }
}

function collectNamedLiteralRuleTerminals(grammar: EbnfGrammar): Set<string> {
  const terminals = new Set<string>();
  for (const rule of grammar.rules) {
    collectLiteralOnlyExpressionTerminals(rule.expression, terminals);
  }
  return terminals;
}

function collectLiteralOnlyExpressionTerminals(
  expression: EbnfExpression,
  terminals: Set<string>,
): boolean {
  switch (expression.kind) {
    case "literal":
      terminals.add(expression.value);
      return true;
    case "choice": {
      const optionTerminals = new Set<string>();
      for (const option of expression.options) {
        if (!collectLiteralOnlyExpressionTerminals(option, optionTerminals)) {
          return false;
        }
      }
      for (const terminal of optionTerminals) terminals.add(terminal);
      return true;
    }
    default:
      return false;
  }
}

function collectSingleLiteralRules(grammar: EbnfGrammar): Map<string, string> {
  const rules = new Map<string, string>();
  for (const rule of grammar.rules) {
    if (rule.expression.kind === "literal") {
      rules.set(rule.expression.value, rule.name);
    }
  }
  return rules;
}

function collectAnonymousLiteralTerminals(grammar: EbnfGrammar): Set<string> {
  const terminals = new Set<string>();
  for (const rule of grammar.rules) {
    if (rule.expression.kind === "literal") continue;
    collectLiteralTerminals(rule.expression, terminals);
  }
  return terminals;
}

function collectLiteralTerminals(
  expression: EbnfExpression,
  terminals: Set<string>,
): void {
  switch (expression.kind) {
    case "literal":
      terminals.add(expression.value);
      return;
    case "sequence":
      for (const item of expression.items) {
        collectLiteralTerminals(item, terminals);
      }
      return;
    case "choice":
      for (const option of expression.options) {
        collectLiteralTerminals(option, terminals);
      }
      return;
    case "optional":
    case "repeat":
    case "repeat1":
      collectLiteralTerminals(expression.expression, terminals);
      return;
    case "separated":
      collectLiteralTerminals(expression.item, terminals);
      collectLiteralTerminals(expression.separator, terminals);
      return;
    case "ref":
      return;
  }
}

function generateTreeSitterConfigSource(
  name: string,
  metadata: TreeSitterMetadata,
): string {
  return `${
    JSON.stringify(
      {
        grammars: [
          {
            name,
            scope: languageScope(name, metadata),
            "file-types": languageFileTypes(name, metadata),
            "injection-regex": name,
          },
        ],
        "tree-sitter": [
          {
            name,
            scope: languageScope(name, metadata),
            "file-types": languageFileTypes(name, metadata),
            "injection-regex": name,
          },
        ],
        metadata: {
          version: "0.0.0",
          license: "MIT",
          description: `${name} grammar generated by @mewhhaha/baba`,
          authors: [{ name: "Generated by @mewhhaha/baba" }],
        },
        bindings: {
          c: true,
          go: false,
          java: false,
          node: false,
          python: false,
          rust: false,
          swift: false,
          zig: false,
        },
      },
      null,
      2,
    )
  }\n`;
}

function generateTreeSitterPackageSource(
  name: string,
  metadata: TreeSitterMetadata,
): string {
  return `${
    JSON.stringify(
      {
        name: `tree-sitter-${name}`,
        version: "0.0.0",
        type: "module",
        main: "grammar.js",
        files: [
          "grammar.js",
          "queries",
          "tree-sitter.json",
        ],
        "tree-sitter": [
          {
            scope: languageScope(name, metadata),
            "file-types": languageFileTypes(name, metadata),
          },
        ],
      },
      null,
      2,
    )
  }\n`;
}

function generateWorkbenchReadmeSource(name: string): string {
  return `# ${name} generated workbench

This directory was generated by @mewhhaha/baba. It contains a Tree-sitter grammar, editor query files, typed AST helpers, formatter and LSP scaffolds, and smoke tests you can extend as the language grows.

## Query files

- \`queries/highlights.scm\` contains metadata-driven captures plus conservative defaults for exposed keywords, punctuation, identifiers, comments, strings, and numbers.
- \`queries/locals.scm\` contains local scope and definition captures from \`metadata.queries.locals\`.
- \`queries/folds.scm\` contains fold captures from \`metadata.queries.folds\`.
- \`queries/indents.scm\` contains indentation captures from \`metadata.queries.indents\`.
- \`queries/tags.scm\` contains symbol tag captures from \`metadata.queries.tags\`.
- \`queries/textobjects.scm\` contains textobject captures from \`metadata.queries.textobjects\`.
- \`queries/rainbows.scm\` contains rainbow scope and bracket captures from \`metadata.queries.rainbows\` or default bracket literals.
- \`queries/injections.scm\` contains embedded-language captures from \`metadata.queries.injections\`.

Raw query patterns in metadata are emitted directly into their query files. Highlight defaults can be suppressed with \`metadata.queries.highlights.defaults.suppress\`.

## Metadata keys

- \`language\`: configure scope, file types, and line comment text.
- \`queries\`: configure highlights, locals, folds, indents, tags, textobjects, rainbows, and injections.
- \`rules\`: configure Tree-sitter fields, precedence, aliases, hidden paths, wrapping, associativity, conflicts, and token behavior.
- \`ast\`: configure generated AST node kinds and facade fields.
- \`formatter\`: configure formatter block nodes, list nodes, and literal spacing hints.
- \`lsp\`: configure document symbol and diagnostic node lists.
`;
}

function generateHelixLanguageSource(
  name: string,
  metadata: TreeSitterMetadata,
): string {
  const fileTypes = languageFileTypes(name, metadata)
    .map((fileType) => JSON.stringify(fileType))
    .join(", ");
  return `[[language]]
name = ${JSON.stringify(name)}
scope = ${JSON.stringify(languageScope(name, metadata))}
file-types = [${fileTypes}]
roots = []
comment-token = ${JSON.stringify(languageComment(metadata))}

[[grammar]]
name = ${JSON.stringify(name)}
source = { path = "../.." }
`;
}

function generateNvimReadmeSource(name: string): string {
  return `# Neovim scaffold for ${name}

Copy the generated \`queries/\` directory into your Neovim tree-sitter runtime path for this language.
`;
}

function generateVsCodePackageSource(
  name: string,
  metadata: TreeSitterMetadata,
): string {
  return `${
    JSON.stringify(
      {
        name: `${name}-language`,
        displayName: `${name} language`,
        version: "0.0.0",
        engines: { vscode: "^1.90.0" },
        contributes: {
          languages: [
            {
              id: name,
              aliases: [name],
              extensions: languageFileTypes(name, metadata).map((fileType) =>
                fileType.startsWith(".") ? fileType : `.${fileType}`
              ),
              configuration: "./language-configuration.json",
            },
          ],
        },
      },
      null,
      2,
    )
  }\n`;
}

function generateVsCodeLanguageConfigurationSource(
  metadata: TreeSitterMetadata,
): string {
  const comment = languageComment(metadata);
  return `${
    JSON.stringify(
      {
        comments: {
          lineComment: comment,
        },
        brackets: [
          ["{", "}"],
          ["[", "]"],
          ["(", ")"],
        ],
        autoClosingPairs: [
          { open: "{", close: "}" },
          { open: "[", close: "]" },
          { open: "(", close: ")" },
          { open: '"', close: '"' },
        ],
      },
      null,
      2,
    )
  }\n`;
}

function generateVsCodeSyntaxReadmeSource(name: string): string {
  return `# VS Code syntax scaffold for ${name}

This directory is reserved for a TextMate grammar if you need VS Code syntax highlighting without tree-sitter support.
`;
}

function generateCorpusTestSource(sample: string): string {
  return `==================
basic
==================
${sample}

---

(source_file)
`;
}

function generateTokenizerSmokeTestSource(sample: string): string {
  return `import { lex } from "../tokenizer.ts";

Deno.test("tokenizer smoke", () => {
  const tokens = lex(${JSON.stringify(sample)});
  if (tokens.at(-1)?.kind !== "eof") {
    throw new Error("Expected eof token");
  }
});
`;
}

function generateLspReadmeSource(name: string): string {
  return `# ${name} LSP scaffold

This is a minimal state container for a language server. Wire it to a JSON-RPC transport and a parser implementation before using it as a production LSP.
`;
}

function generateFormatterReadmeSource(name: string): string {
  return `# ${name} formatter scaffold

The generated formatter preserves source text by default. Add node-specific formatting once the language syntax is stable.
`;
}

function languageScope(name: string, metadata: TreeSitterMetadata): string {
  return metadata.language?.scope ?? `source.${name}`;
}

function languageFileTypes(
  name: string,
  metadata: TreeSitterMetadata,
): string[] {
  return metadata.language?.fileTypes ?? [name];
}

function languageComment(metadata: TreeSitterMetadata): string {
  return metadata.language?.comment ?? "//";
}

function astFieldsForNode(
  nodeName: string,
  metadata: TreeSitterMetadata,
): Array<{ name: string; treeField: string }> {
  const astFields = metadata.ast?.nodes?.[nodeName]?.fields;
  if (astFields) {
    return Object.entries(astFields).map(([name, treeField]) => ({
      name,
      treeField,
    }));
  }

  const ruleFields = metadata.rules?.[nodeName]?.fields;
  if (!ruleFields) return [];
  return [...new Set(Object.values(ruleFields))].map((field) => ({
    name: field,
    treeField: field,
  }));
}

function astTypeName(name: string): string {
  return `${pascalCase(name)}AstNode`;
}

function pascalCase(name: string): string {
  const converted = name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
  return /^[A-Za-z]/.test(converted) ? converted : `Node${converted}`;
}

function quoteProperty(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function generateGrammarSample(
  grammar: EbnfGrammar,
  rootRuleName: string,
): string {
  const root = grammar.rules.find((rule) => rule.name === rootRuleName) ??
    grammar.rules[0];
  const sample = sampleExpression(grammar, root.expression, new Set()).trim();
  return sample.length === 0 ? "example" : sample;
}

function sampleExpression(
  grammar: EbnfGrammar,
  expression: EbnfExpression,
  seenRules: Set<string>,
): string {
  switch (expression.kind) {
    case "literal":
      return expression.value;
    case "ref":
      return sampleRef(grammar, expression.name, seenRules);
    case "sequence":
      return joinSampleParts(
        expression.items.map((item) =>
          sampleExpression(grammar, item, seenRules)
        )
          .filter((part) => part.length > 0),
      );
    case "choice":
      return expression.options.length === 0
        ? ""
        : sampleExpression(grammar, expression.options[0], seenRules);
    case "optional":
    case "repeat":
      return "";
    case "repeat1":
      return sampleExpression(grammar, expression.expression, seenRules);
    case "separated": {
      const item = sampleExpression(grammar, expression.item, seenRules);
      const separator = sampleExpression(
        grammar,
        expression.separator,
        seenRules,
      );
      return joinSampleParts(
        [item, separator, item].filter((part) => part.length > 0),
      );
    }
  }
}

function sampleRef(
  grammar: EbnfGrammar,
  name: string,
  seenRules: Set<string>,
): string {
  const token = grammar.tokens.find((candidate) => candidate.name === name);
  if (token?.kind === "token") return sampleToken(name);
  if (name === "ident") return "example";
  if (name === "int" || name === "number") return "1";
  if (name === "string") return `"text"`;
  if (name === "char") return `'x'`;
  if (name === "newline") return "\n";
  if (name === "indent" || name === "dedent") return "";
  if (name === "fenced_text") return "```text\nsample\n```";
  if (name === "fenced_template") return "```template\nsample\n```";

  if (seenRules.has(name)) return "";
  const rule = grammar.rules.find((candidate) => candidate.name === name);
  if (!rule) return name;
  const nextSeen = new Set(seenRules);
  nextSeen.add(name);
  return sampleExpression(grammar, rule.expression, nextSeen);
}

function sampleToken(name: string): string {
  if (name.includes("int") || name.includes("number")) return "1";
  if (name.includes("string")) return `"text"`;
  return "example";
}

function joinSampleParts(parts: string[]): string {
  let output = "";
  for (const part of parts) {
    if (output.length === 0) {
      output = part;
      continue;
    }
    if (/^[,.;:)\]}]/.test(part) || /[(\[{]$/.test(output)) {
      output += part;
    } else if (part === "\n" || output.endsWith("\n")) {
      output += part;
    } else {
      output += ` ${part}`;
    }
  }
  return output;
}

function validateTreeSitterMetadataSemantics(
  grammar: EbnfGrammar,
  rootRuleName: string,
  metadata?: TreeSitterMetadata,
): void {
  if (!metadata) return;
  const knownRules = new Set(grammar.rules.map((rule) => rule.name));
  for (const token of grammar.tokens) knownRules.add(token.name);
  knownRules.add("source_file");
  for (const builtin of treeSitterBuiltins) knownRules.add(builtin);

  const seenAliasNodes = new Set<string>();
  for (const [ruleName, ruleMeta] of Object.entries(metadata.rules ?? {})) {
    for (const [path, pathMeta] of Object.entries(ruleMeta.paths ?? {})) {
      const aliasName = pathMeta.alias_node;
      if (!aliasName) continue;
      if (knownRules.has(aliasName)) {
        throw new Error(
          `Rule '${ruleName}' path '${path}' alias_node '${aliasName}' conflicts with existing rule`,
        );
      }
      if (seenAliasNodes.has(aliasName)) {
        throw new Error(
          `Duplicate alias_node '${aliasName}' in tree-sitter metadata`,
        );
      }
      seenAliasNodes.add(aliasName);
      knownRules.add(aliasName);
    }
  }

  if (metadata.word) validateRuleRef(metadata.word, knownRules, "word");
  for (const extra of metadata.extras ?? []) validateExtra(extra, knownRules);
  for (const name of metadata.supertypes ?? []) {
    validateRuleRef(name, knownRules, "supertype");
  }
  for (const name of metadata.inline ?? []) {
    validateRuleRef(name, knownRules, "inline");
  }
  for (const conflict of metadata.conflicts ?? []) {
    for (const name of conflict) validateRuleRef(name, knownRules, "conflict");
  }

  for (const [ruleName, ruleMeta] of Object.entries(metadata.rules ?? {})) {
    if (ruleName !== "source_file" && !knownRules.has(ruleName)) {
      throw new Error(`Unknown metadata rule '${ruleName}'`);
    }
    if (ruleMeta.wrap) validateWrap(ruleMeta.wrap, ruleName);
    const expression = ruleName === "source_file"
      ? grammar.rules.find((rule) => rule.name === rootRuleName)?.expression
      : grammar.rules.find((rule) => rule.name === ruleName)?.expression;
    if (!expression) {
      throw new Error(`Missing grammar rule '${ruleName}' for metadata`);
    }
    for (const path of collectRulePaths(ruleMeta)) {
      validateFieldPath(expression, path, ruleName);
    }
    validateRuleMetadata(ruleMeta, expression, ruleName);
  }

  validateWorkbenchMetadataSemantics(grammar, metadata);
}

/** Validates metadata semantics against a parsed grammar. */
export function validateGenerationMetadataSemantics(
  grammar: EbnfGrammar,
  rootRuleName: string,
  metadata: TreeSitterMetadata = {},
): void {
  validateTreeSitterMetadataSemantics(grammar, rootRuleName, metadata);
  validateTreeSitterQueryMetadata(grammar, metadata);
}

function validateTreeSitterQueryMetadata(
  grammar: EbnfGrammar,
  metadata: TreeSitterMetadata,
): void {
  const queries = metadata.queries;
  if (!queries) return;

  validateTreeSitterRainbowsMetadata(grammar, metadata, queries.rainbows);
  validateTreeSitterInjectionsMetadata(grammar, metadata, queries.injections);
  validateCaptureMetadata(
    grammar,
    metadata,
    queries.highlights?.entries,
    "highlight",
  );
  validateCaptureSelectorsMetadata(
    grammar,
    metadata,
    queries.highlights?.defaults?.suppress,
    "highlight default suppression",
  );
  validateCaptureMetadata(grammar, metadata, queries.locals, "locals");
  validateCaptureMetadata(grammar, metadata, queries.folds, "fold");
  validateCaptureMetadata(grammar, metadata, queries.indents, "indent");
  validateCaptureMetadata(grammar, metadata, queries.tags, "tag");
  validateCaptureMetadata(grammar, metadata, queries.textobjects, "textobject");
}

function validateCaptureMetadata(
  grammar: EbnfGrammar,
  fullMetadata: TreeSitterMetadata,
  metadata: TreeSitterCaptureQueryEntry[] | undefined,
  context: string,
): void {
  if (!metadata) return;

  const knownNodes = collectKnownTreeSitterNodeNamesWithMetadata(
    grammar,
    fullMetadata,
  );
  const terminals = new Set(collectTerminals(grammar));
  for (const capture of metadata) {
    if (isRawQueryEntry(capture)) continue;
    if (capture.node && !knownNodes.has(capture.node)) {
      throw new Error(`Unknown ${context} capture node '${capture.node}'`);
    }
    if (capture.literal && !terminals.has(capture.literal)) {
      throw new Error(
        `Unknown ${context} capture literal '${capture.literal}'`,
      );
    }
  }
}

function validateCaptureSelectorsMetadata(
  grammar: EbnfGrammar,
  fullMetadata: TreeSitterMetadata,
  metadata: TreeSitterCaptureSelectorMetadata[] | undefined,
  context: string,
): void {
  if (!metadata) return;

  const knownNodes = collectKnownTreeSitterNodeNamesWithMetadata(
    grammar,
    fullMetadata,
  );
  const terminals = new Set(collectTerminals(grammar));
  for (const selector of metadata) {
    if (selector.node && !knownNodes.has(selector.node)) {
      throw new Error(`Unknown ${context} node '${selector.node}'`);
    }
    if (selector.literal && !terminals.has(selector.literal)) {
      throw new Error(`Unknown ${context} literal '${selector.literal}'`);
    }
  }
}

function validateWorkbenchMetadataSemantics(
  grammar: EbnfGrammar,
  metadata: TreeSitterMetadata,
): void {
  const knownNodes = collectKnownTreeSitterNodeNamesWithMetadata(
    grammar,
    metadata,
  );

  if (metadata.language?.scope !== undefined) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(metadata.language.scope)) {
      throw new Error(`Invalid language scope '${metadata.language.scope}'`);
    }
  }
  for (const fileType of metadata.language?.fileTypes ?? []) {
    if (!/^[A-Za-z0-9_.+-]+$/.test(fileType)) {
      throw new Error(`Invalid language file type '${fileType}'`);
    }
  }

  for (const node of Object.keys(metadata.ast?.nodes ?? {})) {
    if (!knownNodes.has(node)) throw new Error(`Unknown AST node '${node}'`);
  }
  for (
    const [node, nodeMetadata] of Object.entries(
      metadata.ast?.nodes ?? {},
    )
  ) {
    if (
      nodeMetadata.kind && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(nodeMetadata.kind)
    ) {
      throw new Error(
        `Invalid AST kind '${nodeMetadata.kind}' on node '${node}'`,
      );
    }
  }

  for (const node of metadata.formatter?.blocks ?? []) {
    if (!knownNodes.has(node)) {
      throw new Error(`Unknown formatter block '${node}'`);
    }
  }
  for (const node of metadata.formatter?.lists ?? []) {
    if (!knownNodes.has(node)) {
      throw new Error(`Unknown formatter list '${node}'`);
    }
  }
  const terminals = new Set(collectTerminals(grammar));
  for (const literal of Object.keys(metadata.formatter?.spacing ?? {})) {
    if (!terminals.has(literal)) {
      throw new Error(`Unknown formatter spacing literal '${literal}'`);
    }
  }

  for (const node of metadata.lsp?.documentSymbols ?? []) {
    if (!knownNodes.has(node)) {
      throw new Error(`Unknown LSP document symbol node '${node}'`);
    }
  }
  for (const node of metadata.lsp?.diagnostics ?? []) {
    if (!knownNodes.has(node)) {
      throw new Error(`Unknown LSP diagnostic node '${node}'`);
    }
  }
}

function validateTreeSitterRainbowsMetadata(
  grammar: EbnfGrammar,
  fullMetadata: TreeSitterMetadata,
  metadata?: TreeSitterRainbowsMetadata,
): void {
  if (!metadata) return;

  const knownNodes = collectKnownTreeSitterNodeNamesWithMetadata(
    grammar,
    fullMetadata,
  );
  for (const scope of metadata.scopes ?? []) {
    if (!knownNodes.has(scope)) {
      throw new Error(`Unknown rainbow scope node '${scope}'`);
    }
  }

  const terminals = new Set(collectTerminals(grammar));
  for (const bracket of metadata.brackets ?? []) {
    if (!terminals.has(bracket)) {
      throw new Error(`Unknown rainbow bracket literal '${bracket}'`);
    }
  }
}

function validateTreeSitterInjectionsMetadata(
  grammar: EbnfGrammar,
  fullMetadata: TreeSitterMetadata,
  metadata?: TreeSitterInjectionQueryEntry[],
): void {
  if (!metadata) return;

  const knownNodes = collectKnownTreeSitterNodeNamesWithMetadata(
    grammar,
    fullMetadata,
  );
  for (const injection of metadata) {
    if (isRawQueryEntry(injection)) continue;
    if (!knownNodes.has(injection.node)) {
      throw new Error(`Unknown injection node '${injection.node}'`);
    }
    if (!/^[A-Za-z0-9_+-]+$/.test(injection.language)) {
      throw new Error(`Invalid injection language '${injection.language}'`);
    }
  }
}

function collectKnownTreeSitterNodeNames(grammar: EbnfGrammar): Set<string> {
  const names = new Set<string>(grammar.rules.map((rule) => rule.name));
  for (const token of grammar.tokens) names.add(token.name);
  names.add("source_file");
  for (const builtin of treeSitterBuiltins) names.add(builtin);
  return names;
}

function collectKnownTreeSitterNodeNamesWithMetadata(
  grammar: EbnfGrammar,
  metadata: TreeSitterMetadata,
): Set<string> {
  const names = collectKnownTreeSitterNodeNames(grammar);
  for (const ruleMeta of Object.values(metadata.rules ?? {})) {
    for (const pathMeta of Object.values(ruleMeta.paths ?? {})) {
      if (pathMeta.alias_node) names.add(pathMeta.alias_node);
      if (pathMeta.alias_ref) names.add(pathMeta.alias_ref);
    }
  }
  return names;
}

function collectDefaultRainbowBrackets(grammar: EbnfGrammar): string[] {
  const terminals = new Set(collectTerminals(grammar));
  return ["(", ")", "[", "]", "{", "}"].filter((token) => terminals.has(token));
}

function validateExtra(extra: TreeSitterExtra, knownRules: Set<string>): void {
  if (extra.kind === "regex") return;
  validateRuleRef(extra.name, knownRules, "extra");
}

function validateRuleRef(
  name: string,
  knownRules: Set<string>,
  context: string,
): void {
  if (knownRules.has(name)) return;
  throw new Error(`Unknown ${context} rule '${name}'`);
}

function validateWrap(wrap: TreeSitterRuleWrap, ruleName: string): void {
  if (wrap.kind === "prec.left" || wrap.kind === "prec.right") {
    if (wrap.value !== undefined && !Number.isInteger(wrap.value)) {
      throw new Error(`Expected integer precedence for '${ruleName}'`);
    }
    return;
  }
  if (!Number.isInteger(wrap.value)) {
    throw new Error(`Expected integer precedence for '${ruleName}'`);
  }
}

function validateFieldPath(
  expression: EbnfExpression,
  path: string,
  ruleName: string,
): void {
  const segments = path.length === 0 ? [] : path.split(".").map((segment) => {
    const index = Number(segment);
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`Invalid field path '${path}' on rule '${ruleName}'`);
    }
    return index;
  });
  walkFieldPath(expression, segments, path, ruleName);
}

function walkFieldPath(
  expression: EbnfExpression,
  segments: number[],
  path: string,
  ruleName: string,
): void {
  if (segments.length === 0) return;
  const [head, ...rest] = segments;
  switch (expression.kind) {
    case "sequence":
      if (head >= expression.items.length) {
        throw new Error(
          `Field path '${path}' is out of bounds on rule '${ruleName}'`,
        );
      }
      walkFieldPath(expression.items[head], rest, path, ruleName);
      return;
    case "choice":
      if (head >= expression.options.length) {
        throw new Error(
          `Field path '${path}' is out of bounds on rule '${ruleName}'`,
        );
      }
      walkFieldPath(expression.options[head], rest, path, ruleName);
      return;
    case "optional":
    case "repeat":
    case "repeat1":
      if (head !== 0) {
        throw new Error(
          `Field path '${path}' is out of bounds on rule '${ruleName}'`,
        );
      }
      walkFieldPath(expression.expression, rest, path, ruleName);
      return;
    case "separated":
      if (head === 0) {
        walkFieldPath(expression.item, rest, path, ruleName);
        return;
      }
      if (head === 1) {
        walkFieldPath(expression.separator, rest, path, ruleName);
        return;
      }
      throw new Error(
        `Field path '${path}' is out of bounds on rule '${ruleName}'`,
      );
    case "ref":
    case "literal":
      throw new Error(
        `Field path '${path}' descends through a leaf on rule '${ruleName}'`,
      );
  }
}

function resolveExpressionAtPath(
  expression: EbnfExpression,
  path: string,
  ruleName: string,
): EbnfExpression {
  const segments = path.length === 0 ? [] : path.split(".").map((segment) => {
    const index = Number(segment);
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`Invalid field path '${path}' on rule '${ruleName}'`);
    }
    return index;
  });
  return walkResolvedPath(expression, segments, path, ruleName);
}

function walkResolvedPath(
  expression: EbnfExpression,
  segments: number[],
  path: string,
  ruleName: string,
): EbnfExpression {
  if (segments.length === 0) return expression;
  const [head, ...rest] = segments;
  switch (expression.kind) {
    case "sequence":
      if (head >= expression.items.length) {
        throw new Error(
          `Field path '${path}' is out of bounds on rule '${ruleName}'`,
        );
      }
      return walkResolvedPath(expression.items[head], rest, path, ruleName);
    case "choice":
      if (head >= expression.options.length) {
        throw new Error(
          `Field path '${path}' is out of bounds on rule '${ruleName}'`,
        );
      }
      return walkResolvedPath(expression.options[head], rest, path, ruleName);
    case "optional":
    case "repeat":
    case "repeat1":
      if (head !== 0) {
        throw new Error(
          `Field path '${path}' is out of bounds on rule '${ruleName}'`,
        );
      }
      return walkResolvedPath(expression.expression, rest, path, ruleName);
    case "separated":
      if (head === 0) {
        return walkResolvedPath(expression.item, rest, path, ruleName);
      }
      if (head === 1) {
        return walkResolvedPath(expression.separator, rest, path, ruleName);
      }
      throw new Error(
        `Field path '${path}' is out of bounds on rule '${ruleName}'`,
      );
    case "ref":
    case "literal":
      throw new Error(
        `Field path '${path}' descends through a leaf on rule '${ruleName}'`,
      );
  }
}

function renderRuleExpression(
  ruleName: string,
  expression: EbnfExpression,
  metadata?: TreeSitterRuleMetadata,
  context?: RenderContext,
  inlineStack = new Set<string>(),
): string {
  const normalized = context?.normalizedRules.get(ruleName) ??
    normalizeRuleMetadata(metadata);
  const renderContext = context ?? {
    metadata: {},
    normalizedRules: new Map([[ruleName, normalized]]),
    ruleExpressions: new Map([[ruleName, expression]]),
    helperRules: new Map(),
  };
  const rendered = renderExpression(
    ruleName,
    expression,
    [],
    normalized,
    renderContext,
    inlineStack,
  );
  return applyToken(rendered, normalized.token);
}

function renderExpression(
  ruleName: string,
  expression: EbnfExpression,
  path: number[],
  metadata: NormalizedRuleMetadata,
  context: RenderContext,
  inlineStack: Set<string>,
): string {
  const rendered = renderRawExpression(
    ruleName,
    expression,
    path,
    metadata,
    context,
    inlineStack,
  );
  const pathMeta = metadata.paths.get(pathKey(path));
  if (expression.kind === "ref") {
    if (!pathMeta?.field) return rendered;
    return `field(${JSON.stringify(pathMeta.field)}, ${rendered})`;
  }
  const wrapped = applyWrap(rendered, pathMeta?.wrap);
  const aliased = applyNodeAlias(
    ruleName,
    pathKey(path),
    wrapped,
    pathMeta,
    context,
  );
  if (!pathMeta?.field) return aliased;
  return `field(${JSON.stringify(pathMeta.field)}, ${aliased})`;
}

function renderRawExpression(
  ruleName: string,
  expression: EbnfExpression,
  path: number[],
  metadata: NormalizedRuleMetadata,
  context: RenderContext,
  inlineStack: Set<string>,
): string {
  const pathMeta = metadata.paths.get(pathKey(path));
  switch (expression.kind) {
    case "ref":
      return renderRefExpression(
        ruleName,
        expression,
        pathMeta,
        context,
        inlineStack,
      );
    case "literal":
      return JSON.stringify(expression.value);
    case "sequence":
      if (expression.items.length === 0) return "seq()";
      return `seq(${
        expression.items.map((item, index) =>
          renderExpression(
            ruleName,
            item,
            [...path, index],
            metadata,
            context,
            inlineStack,
          )
        )
          .join(", ")
      })`;
    case "choice":
      return `choice(${
        expression.options.map((option, index) =>
          renderExpression(
            ruleName,
            option,
            [...path, index],
            metadata,
            context,
            inlineStack,
          )
        ).join(", ")
      })`;
    case "optional":
      return `optional(${
        renderExpression(
          ruleName,
          expression.expression,
          [...path, 0],
          metadata,
          context,
          inlineStack,
        )
      })`;
    case "repeat":
      return `repeat(${
        renderExpression(
          ruleName,
          expression.expression,
          [...path, 0],
          metadata,
          context,
          inlineStack,
        )
      })`;
    case "repeat1":
      return `repeat1(${
        renderExpression(
          ruleName,
          expression.expression,
          [...path, 0],
          metadata,
          context,
          inlineStack,
        )
      })`;
    case "separated":
      return `seq(${
        renderExpression(
          ruleName,
          expression.item,
          [...path, 0],
          metadata,
          context,
          inlineStack,
        )
      }, repeat(seq(${
        renderExpression(
          ruleName,
          expression.separator,
          [...path, 1],
          metadata,
          context,
          inlineStack,
        )
      }, ${
        renderExpression(
          ruleName,
          expression.item,
          [...path, 0],
          metadata,
          context,
          inlineStack,
        )
      })))`;
  }
}

function applyWrap(rendered: string, wrap?: TreeSitterRuleWrap): string {
  if (!wrap) return rendered;
  switch (wrap.kind) {
    case "prec":
      return `prec(${wrap.value}, ${rendered})`;
    case "prec.left":
      return wrap.value === undefined
        ? `prec.left(${rendered})`
        : `prec.left(${wrap.value}, ${rendered})`;
    case "prec.right":
      return wrap.value === undefined
        ? `prec.right(${rendered})`
        : `prec.right(${wrap.value}, ${rendered})`;
  }
}

function applyToken(rendered: string, token?: TreeSitterRuleToken): string {
  if (!token) return rendered;
  switch (token.kind) {
    case "token":
      return `token(${rendered})`;
    case "token.immediate":
      return `token.immediate(${rendered})`;
  }
}

function renderRefExpression(
  ruleName: string,
  expression: Extract<EbnfExpression, { kind: "ref" }>,
  pathMeta: TreeSitterPathMetadata | undefined,
  context: RenderContext,
  inlineStack: Set<string>,
): string {
  const refName = renderRuleRef(expression.name);

  if (pathMeta?.inline_path || pathMeta?.hidden_path) {
    const target = resolveRenderableRef(expression.name, context);
    if (inlineStack.has(expression.name)) {
      throw new Error(
        `Cannot inline recursive rule '${expression.name}' from '${ruleName}'`,
      );
    }
    const targetMeta = context.metadata.rules?.[expression.name];
    const nextStack = new Set(inlineStack);
    nextStack.add(expression.name);
    const inlined = renderRuleExpression(
      expression.name,
      target,
      targetMeta,
      context,
      nextStack,
    );
    return applyWrap(inlined, pathMeta?.wrap);
  }

  const aliased = pathMeta?.alias_ref
    ? `alias(${refName}, $.${pathMeta.alias_ref})`
    : refName;
  return applyWrap(aliased, pathMeta?.wrap);
}

function resolveRenderableRef(
  name: string,
  context: RenderContext,
): EbnfExpression {
  switch (name) {
    case "newline":
    case "indent":
    case "dedent":
      throw new Error(`Cannot inline builtin token '${name}'`);
    default: {
      const target = context.ruleExpressions.get(name);
      if (!target) throw new Error(`Cannot inline unknown rule '${name}'`);
      return target;
    }
  }
}

function renderRuleRef(name: string): string {
  if (name === "newline") return "$.line_end";
  if (name === "indent") return "$.line_indent";
  if (name === "dedent") return "optional($.line_indent)";
  return lexicalBuiltins.has(name) ? `$.${name}` : `$.${name}`;
}

function applyNodeAlias(
  _ruleName: string,
  _path: string,
  rendered: string,
  pathMeta: TreeSitterPathMetadata | undefined,
  context: RenderContext,
): string {
  if (!pathMeta?.alias_node) return rendered;
  const helperName = pathMeta.alias_node;
  const existing = context.helperRules.get(helperName);
  if (existing && existing !== rendered) {
    throw new Error(`Conflicting helper rule '${helperName}'`);
  }
  context.helperRules.set(helperName, rendered);
  return `$.${helperName}`;
}

function renderExtra(extra: TreeSitterExtra): string {
  if (extra.kind === "rule") return `$.${extra.name}`;
  return formatRegexLiteral(extra.value);
}

function renderRuleRefArray(names: string[]): string {
  return `[${names.map((name) => `$.${name}`).join(", ")}]`;
}

interface NormalizedRuleMetadata {
  paths: Map<string, TreeSitterPathMetadata>;
  token?: TreeSitterRuleToken;
}

interface RenderContext {
  metadata: TreeSitterMetadata;
  normalizedRules: Map<string, NormalizedRuleMetadata>;
  ruleExpressions: Map<string, EbnfExpression>;
  helperRules: Map<string, string>;
}

function normalizeRuleMetadata(
  metadata?: TreeSitterRuleMetadata,
): NormalizedRuleMetadata {
  const paths = new Map<string, TreeSitterPathMetadata>();
  if (!metadata) return { paths };

  for (const [path, field] of Object.entries(metadata.fields ?? {})) {
    paths.set(path, { ...(paths.get(path) ?? {}), field });
  }
  if (metadata.wrap) {
    paths.set("", { ...(paths.get("") ?? {}), wrap: metadata.wrap });
  }
  for (const [path, pathMeta] of Object.entries(metadata.paths ?? {})) {
    paths.set(path, { ...(paths.get(path) ?? {}), ...pathMeta });
  }
  return { paths, token: metadata.token };
}

function createRenderContext(
  grammar: EbnfGrammar,
  rootRuleName: string,
  metadata: TreeSitterMetadata,
): RenderContext {
  const ruleExpressions = new Map<string, EbnfExpression>();
  for (const rule of grammar.rules) {
    ruleExpressions.set(rule.name, rule.expression);
  }
  ruleExpressions.set(
    "source_file",
    grammar.rules.find((rule) => rule.name === rootRuleName)!.expression,
  );

  const normalizedRules = new Map<string, NormalizedRuleMetadata>();
  for (const [ruleName, ruleMeta] of Object.entries(metadata.rules ?? {})) {
    normalizedRules.set(ruleName, normalizeRuleMetadata(ruleMeta));
  }
  if (!normalizedRules.has("source_file")) {
    const sourceFileMeta = metadata.rules?.source_file ??
      metadata.rules?.[rootRuleName];
    if (sourceFileMeta) {
      normalizedRules.set("source_file", normalizeRuleMetadata(sourceFileMeta));
    }
  }

  return { metadata, normalizedRules, ruleExpressions, helperRules: new Map() };
}

function collectInlineRules(metadata: TreeSitterMetadata): string[] {
  const inline = new Set(metadata.inline ?? []);
  for (const [ruleName, ruleMeta] of Object.entries(metadata.rules ?? {})) {
    if (ruleMeta.paths?.[""]?.hidden_path) inline.add(ruleName);
  }
  return [...inline];
}

function collectRulePaths(metadata: TreeSitterRuleMetadata): string[] {
  return [
    ...new Set([
      ...Object.keys(metadata.fields ?? {}),
      ...Object.keys(metadata.paths ?? {}),
    ]),
  ];
}

function validateRuleMetadata(
  metadata: TreeSitterRuleMetadata,
  expression: EbnfExpression,
  ruleName: string,
): void {
  if (metadata.token) {
    if (expression.kind !== "literal") {
      throw new Error(
        `Rule '${ruleName}' token metadata requires a literal rule`,
      );
    }
    if (
      metadata.wrap ||
      metadata.fields?.[""] ||
      Object.prototype.hasOwnProperty.call(metadata.paths ?? {}, "")
    ) {
      throw new Error(
        `Rule '${ruleName}' cannot combine token metadata with root path metadata`,
      );
    }
  }
  const fieldPaths = metadata.fields ?? {};
  for (const [path, pathMeta] of Object.entries(metadata.paths ?? {})) {
    const target = resolveExpressionAtPath(expression, path, ruleName);
    if (pathMeta.wrap) {
      validateWrap(pathMeta.wrap, `${ruleName}.${path || "<root>"}`);
    }
    if (pathMeta.alias_ref && !isValidAliasName(pathMeta.alias_ref)) {
      throw new Error(
        `Invalid alias '${pathMeta.alias_ref}' on rule '${ruleName}'`,
      );
    }
    if (pathMeta.alias_node && !isValidAliasName(pathMeta.alias_node)) {
      throw new Error(
        `Invalid alias '${pathMeta.alias_node}' on rule '${ruleName}'`,
      );
    }
    const fieldName = fieldPaths[path];
    if (fieldName && pathMeta.field && fieldName !== pathMeta.field) {
      throw new Error(
        `Conflicting field metadata on rule '${ruleName}' path '${path}'`,
      );
    }
    const mergedField = pathMeta.field ?? fieldName;
    if (pathMeta.alias_ref && pathMeta.alias_node) {
      throw new Error(
        `Rule '${ruleName}' path '${path}' cannot use both alias_ref and alias_node`,
      );
    }
    if (pathMeta.hidden_path && mergedField) {
      throw new Error(
        `Rule '${ruleName}' path '${path}' cannot be both hidden and fielded`,
      );
    }
    if (pathMeta.hidden_path && (pathMeta.alias_ref || pathMeta.alias_node)) {
      throw new Error(
        `Rule '${ruleName}' path '${path}' cannot be both hidden and aliased`,
      );
    }
    if (pathMeta.inline_path && (pathMeta.alias_ref || pathMeta.alias_node)) {
      throw new Error(
        `Rule '${ruleName}' path '${path}' cannot inline and alias at same time`,
      );
    }
    if ((pathMeta.alias_ref || pathMeta.inline_path) && target.kind !== "ref") {
      throw new Error(`Rule '${ruleName}' path '${path}' must target a ref`);
    }
    if (pathMeta.alias_node && target.kind === "ref") {
      throw new Error(
        `Rule '${ruleName}' path '${path}' must target a non-ref for alias_node`,
      );
    }
    if (pathMeta.hidden_path && path !== "" && target.kind !== "ref") {
      throw new Error(
        `Rule '${ruleName}' path '${path}' must target a ref for hidden_path`,
      );
    }
  }
}

function isValidAliasName(name: string): boolean {
  return /^[_A-Za-z$][_A-Za-z0-9$]*$/.test(name);
}

function formatRuleKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function formatRegexLiteral(pattern: string): string {
  return `/${pattern.replaceAll("/", "\\/")}/`;
}

function pathKey(path: number[]): string {
  return path.join(".");
}

function visit(expression: EbnfExpression, terminals: Set<string>): void {
  switch (expression.kind) {
    case "literal":
      terminals.add(expression.value);
      return;
    case "ref":
      return;
    case "sequence":
      for (const item of expression.items) visit(item, terminals);
      return;
    case "choice":
      for (const option of expression.options) visit(option, terminals);
      return;
    case "optional":
    case "repeat":
    case "repeat1":
      visit(expression.expression, terminals);
      return;
    case "separated":
      visit(expression.item, terminals);
      visit(expression.separator, terminals);
      return;
  }
}

function visitRefs(
  expression: EbnfExpression,
  callback: (name: string) => void,
): void {
  switch (expression.kind) {
    case "ref":
      callback(expression.name);
      return;
    case "literal":
      return;
    case "sequence":
      for (const item of expression.items) visitRefs(item, callback);
      return;
    case "choice":
      for (const option of expression.options) visitRefs(option, callback);
      return;
    case "optional":
    case "repeat":
    case "repeat1":
      visitRefs(expression.expression, callback);
      return;
    case "separated":
      visitRefs(expression.item, callback);
      visitRefs(expression.separator, callback);
      return;
  }
}

function usesLayoutTokens(grammar: EbnfGrammar): boolean {
  for (const rule of grammar.rules) {
    if (hasLayoutRef(rule.expression)) return true;
  }
  return false;
}

function hasLayoutRef(expression: EbnfExpression): boolean {
  switch (expression.kind) {
    case "ref":
      return expression.name === "newline" ||
        expression.name === "indent" ||
        expression.name === "dedent";
    case "literal":
      return false;
    case "sequence":
      return expression.items.some(hasLayoutRef);
    case "choice":
      return expression.options.some(hasLayoutRef);
    case "optional":
    case "repeat":
    case "repeat1":
      return hasLayoutRef(expression.expression);
    case "separated":
      return hasLayoutRef(expression.item) ||
        hasLayoutRef(expression.separator);
  }
}

function formatStringArray(values: string[]): string {
  if (values.length === 0) return "[]";
  const items = values.map((value) => `  ${JSON.stringify(value)},`).join("\n");
  return `[\n${items}\n]`;
}
