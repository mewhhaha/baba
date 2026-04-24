import type {
  EbnfExpression,
  EbnfGrammar,
  LexicalSpec,
  LexicalTokenSpec,
  TreeSitterExtra,
  TreeSitterInjectionMetadata,
  TreeSitterMetadata,
  TreeSitterPathMetadata,
  TreeSitterRainbowsMetadata,
  TreeSitterRuleMetadata,
  TreeSitterRuleToken,
  TreeSitterRuleWrap,
} from "./ast.ts";
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
): LexicalSpec {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  validateEbnfGrammar(grammar);
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
): string {
  return `${JSON.stringify(createLexicalSpec(sourceOrGrammar), null, 2)}\n`;
}

/** Generates standalone TypeScript source for a tokenizer. */
export function generateTokenizerSource(
  sourceOrGrammar: string | EbnfGrammar,
  options: { exportName?: string } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  validateEbnfGrammar(grammar);
  const spec = createLexicalSpec(grammar);
  const exportName = options.exportName ?? "lex";
  if (usesLayoutTokens(grammar)) {
    return generateLayoutTokenizerSource(spec, exportName);
  }
  return `// Generated by @mewhhaha/baba. Do not edit by hand.
export type TokenKind = ${formatTokenKindUnion(tokenKindsForSpec(spec, false))};

export interface Token {
  kind: TokenKind;
  text: string;
  span: { start: number; end: number };
}

const keywords = new Set(${formatStringArray(spec.keywords)});
const symbols = ${formatStringArray(spec.symbols)};
const skipPatterns = ${formatPatternArray(spec.skips)};
const tokenPatterns = ${formatPatternArray(spec.tokens)};

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

    if (char === "/" && source[i + 1] === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\\n") i++;
      continue;
    }

    if (char === "#") {
      i++;
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

function generateLayoutTokenizerSource(
  spec: LexicalSpec,
  exportName: string,
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

const keywords = new Set(${formatStringArray(spec.keywords)});
const symbols = ${formatStringArray(spec.symbols)};
const skipPatterns = ${formatPatternArray(spec.skips)};
const tokenPatterns = ${formatPatternArray(spec.tokens)};

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

    if (char === "#") {
      while (i < source.length && source[i] !== "\\n" && source[i] !== "\\r") i++;
      continue;
    }

    if (char === "/" && source[i + 1] === "/") {
      i += 2;
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
  const hash = line.indexOf("#");
  const slash = line.indexOf("//");
  if (hash === -1) return slash === -1 ? line.length : slash;
  if (slash === -1) return hash;
  return Math.min(hash, slash);
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

function builtinTreeSitterRuleLines(grammar: EbnfGrammar): string[] {
  const declaredTokens = new Set(grammar.tokens.map((token) => token.name));
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
    line_comment:
      '    line_comment: $ => token(choice(seq("//", /[^\\n]*/), seq("#", /[^\\n]*/))),',
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

/** Parses and validates tree-sitter metadata JSON. */
export function parseTreeSitterMetadata(source: string): TreeSitterMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid tree-sitter metadata JSON: ${message}`);
  }
  return parseTreeSitterMetadataObject(parsed, "metadata");
}

type UnknownRecord = Record<string, unknown>;

function parseTreeSitterMetadataObject(
  value: unknown,
  path: string,
): TreeSitterMetadata {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, [
    "extras",
    "word",
    "supertypes",
    "conflicts",
    "inline",
    "queries",
    "rules",
  ]);

  const metadata: TreeSitterMetadata = {};
  if (hasKey(object, "extras")) {
    metadata.extras = expectArray(object.extras, `${path}.extras`).map((
      extra,
      index,
    ) => parseTreeSitterExtra(extra, `${path}.extras[${index}]`));
  }
  if (hasKey(object, "word")) {
    metadata.word = expectString(object.word, `${path}.word`);
  }
  if (hasKey(object, "supertypes")) {
    metadata.supertypes = expectStringArray(
      object.supertypes,
      `${path}.supertypes`,
    );
  }
  if (hasKey(object, "conflicts")) {
    metadata.conflicts = expectArray(object.conflicts, `${path}.conflicts`).map(
      (conflict, index) =>
        expectStringArray(conflict, `${path}.conflicts[${index}]`),
    );
  }
  if (hasKey(object, "inline")) {
    metadata.inline = expectStringArray(object.inline, `${path}.inline`);
  }
  if (hasKey(object, "queries")) {
    metadata.queries = parseQueriesMetadata(object.queries, `${path}.queries`);
  }
  if (hasKey(object, "rules")) {
    const rulesObject = expectObject(object.rules, `${path}.rules`);
    const rules: Record<string, TreeSitterRuleMetadata> = {};
    for (const [ruleName, ruleValue] of Object.entries(rulesObject)) {
      rules[ruleName] = parseRuleMetadataShape(
        ruleValue,
        `${path}.rules.${ruleName}`,
      );
    }
    metadata.rules = rules;
  }

  return metadata;
}

function parseTreeSitterExtra(value: unknown, path: string): TreeSitterExtra {
  const object = expectObject(value, path);
  const kind = expectString(object.kind, `${path}.kind`);
  if (kind === "regex") {
    assertKnownKeys(object, path, ["kind", "value"]);
    return { kind, value: parseRegexPattern(object.value, `${path}.value`) };
  }
  if (kind === "rule") {
    assertKnownKeys(object, path, ["kind", "name"]);
    return { kind, name: expectString(object.name, `${path}.name`) };
  }
  throw new Error(`Invalid ${path}.kind '${kind}'`);
}

function parseQueriesMetadata(
  value: unknown,
  path: string,
): TreeSitterMetadata["queries"] {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["rainbows", "injections"]);

  const queries: NonNullable<TreeSitterMetadata["queries"]> = {};
  if (hasKey(object, "rainbows")) {
    queries.rainbows = parseRainbowsMetadata(
      object.rainbows,
      `${path}.rainbows`,
    );
  }
  if (hasKey(object, "injections")) {
    queries.injections = expectArray(object.injections, `${path}.injections`)
      .map((injection, index) =>
        parseInjectionMetadata(injection, `${path}.injections[${index}]`)
      );
  }
  return queries;
}

function parseRainbowsMetadata(
  value: unknown,
  path: string,
): TreeSitterRainbowsMetadata {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["scopes", "brackets"]);

  const rainbows: TreeSitterRainbowsMetadata = {};
  if (hasKey(object, "scopes")) {
    rainbows.scopes = expectStringArray(object.scopes, `${path}.scopes`);
  }
  if (hasKey(object, "brackets")) {
    rainbows.brackets = expectStringArray(object.brackets, `${path}.brackets`);
  }
  return rainbows;
}

function parseInjectionMetadata(
  value: unknown,
  path: string,
): TreeSitterInjectionMetadata {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["node", "language"]);
  return {
    node: expectString(object.node, `${path}.node`),
    language: expectString(object.language, `${path}.language`),
  };
}

function parseRuleMetadataShape(
  value: unknown,
  path: string,
): TreeSitterRuleMetadata {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["fields", "token", "wrap", "paths"]);

  const metadata: TreeSitterRuleMetadata = {};
  if (hasKey(object, "fields")) {
    metadata.fields = expectStringRecord(object.fields, `${path}.fields`);
  }
  if (hasKey(object, "token")) {
    metadata.token = parseRuleToken(object.token, `${path}.token`);
  }
  if (hasKey(object, "wrap")) {
    metadata.wrap = parseRuleWrap(object.wrap, `${path}.wrap`);
  }
  if (hasKey(object, "paths")) {
    const pathsObject = expectObject(object.paths, `${path}.paths`);
    const paths: Record<string, TreeSitterPathMetadata> = {};
    for (const [pathKey, pathValue] of Object.entries(pathsObject)) {
      paths[pathKey] = parsePathMetadataShape(
        pathValue,
        `${path}.paths.${pathKey}`,
      );
    }
    metadata.paths = paths;
  }
  return metadata;
}

function parseRuleToken(value: unknown, path: string): TreeSitterRuleToken {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["kind"]);
  const kind = expectString(object.kind, `${path}.kind`);
  if (kind === "token" || kind === "token.immediate") return { kind };
  throw new Error(`Invalid ${path}.kind '${kind}'`);
}

function parseRuleWrap(value: unknown, path: string): TreeSitterRuleWrap {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["kind", "value"]);
  const kind = expectString(object.kind, `${path}.kind`);
  if (kind === "prec") {
    return { kind, value: expectInteger(object.value, `${path}.value`) };
  }
  if (kind === "prec.left" || kind === "prec.right") {
    if (!hasKey(object, "value")) return { kind };
    return { kind, value: expectInteger(object.value, `${path}.value`) };
  }
  throw new Error(`Invalid ${path}.kind '${kind}'`);
}

function parsePathMetadataShape(
  value: unknown,
  path: string,
): TreeSitterPathMetadata {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, [
    "field",
    "wrap",
    "alias_ref",
    "alias_node",
    "inline_path",
    "hidden_path",
  ]);

  const metadata: TreeSitterPathMetadata = {};
  if (hasKey(object, "field")) {
    metadata.field = expectString(object.field, `${path}.field`);
  }
  if (hasKey(object, "wrap")) {
    metadata.wrap = parseRuleWrap(object.wrap, `${path}.wrap`);
  }
  if (hasKey(object, "alias_ref")) {
    metadata.alias_ref = expectString(object.alias_ref, `${path}.alias_ref`);
  }
  if (hasKey(object, "alias_node")) {
    metadata.alias_node = expectString(object.alias_node, `${path}.alias_node`);
  }
  if (hasKey(object, "inline_path")) {
    metadata.inline_path = expectBoolean(
      object.inline_path,
      `${path}.inline_path`,
    );
  }
  if (hasKey(object, "hidden_path")) {
    metadata.hidden_path = expectBoolean(
      object.hidden_path,
      `${path}.hidden_path`,
    );
  }
  return metadata;
}

function expectObject(value: unknown, path: string): UnknownRecord {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as UnknownRecord;
  }
  throw new Error(`Expected ${path} to be object`);
}

function expectArray(value: unknown, path: string): unknown[] {
  if (Array.isArray(value)) return value;
  throw new Error(`Expected ${path} to be array`);
}

function expectString(value: unknown, path: string): string {
  if (typeof value === "string") return value;
  throw new Error(`Expected ${path} to be string`);
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value === "boolean") return value;
  throw new Error(`Expected ${path} to be boolean`);
}

function expectInteger(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  throw new Error(`Expected ${path} to be integer`);
}

function expectStringArray(value: unknown, path: string): string[] {
  return expectArray(value, path).map((item, index) =>
    expectString(item, `${path}[${index}]`)
  );
}

function expectStringRecord(
  value: unknown,
  path: string,
): Record<string, string> {
  const object = expectObject(value, path);
  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(object)) {
    record[key] = expectString(item, `${path}.${key}`);
  }
  return record;
}

function parseRegexPattern(value: unknown, path: string): string {
  const pattern = expectString(value, path);
  if (pattern.includes("\n") || pattern.includes("\r")) {
    throw new Error(`Expected ${path} to stay on one line`);
  }
  try {
    new RegExp(pattern);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${path}: ${message}`);
  }
  return pattern;
}

function assertKnownKeys(
  object: UnknownRecord,
  path: string,
  keys: string[],
): void {
  const known = new Set(keys);
  for (const key of Object.keys(object)) {
    if (!known.has(key)) throw new Error(`Unknown ${path} key '${key}'`);
  }
}

function hasKey(object: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** Generates an ESM tree-sitter grammar source file. */
export function generateTreeSitterGrammar(
  sourceOrGrammar: string | EbnfGrammar,
  options: {
    name?: string;
    rootRule?: string;
    metadata?: TreeSitterMetadata;
  } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  const name = options.name ?? "waesm";
  const rootRuleName = options.rootRule ?? grammar.rules[0]?.name ?? "module";
  validateEbnfGrammar(grammar, { rootRule: rootRuleName });
  const rootRule = grammar.rules.find((rule) => rule.name === rootRuleName);
  if (!rootRule) throw new Error(`Unknown root rule '${rootRuleName}'`);

  validateTreeSitterMetadataSemantics(grammar, rootRuleName, options.metadata);

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
    ...builtinTreeSitterRuleLines(grammar),
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
  options: { metadata?: TreeSitterMetadata } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  validateEbnfGrammar(grammar);
  const metadata = options.metadata ?? {};
  validateTreeSitterQueryMetadata(grammar, metadata);

  const rainbow = metadata.queries?.rainbows;
  const scopes = rainbow?.scopes ?? [];
  const brackets = rainbow?.brackets ?? collectDefaultRainbowBrackets(grammar);
  const lines: string[] = [];

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
  options: { metadata?: TreeSitterMetadata } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  validateEbnfGrammar(grammar);
  const metadata = options.metadata ?? {};
  validateTreeSitterQueryMetadata(grammar, metadata);

  const injections = metadata.queries?.injections ?? [];
  if (injections.length === 0) return "";

  const blocks: string[] = [];
  for (const injection of injections) {
    blocks.push(
      `((${injection.node}) @injection.content`,
      `  (#set! injection.language ${JSON.stringify(injection.language)}))`,
      "",
    );
  }
  return `${blocks.join("\n").trimEnd()}\n`;
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
}

function validateTreeSitterQueryMetadata(
  grammar: EbnfGrammar,
  metadata: TreeSitterMetadata,
): void {
  const queries = metadata.queries;
  if (!queries) return;

  validateTreeSitterRainbowsMetadata(grammar, metadata, queries.rainbows);
  validateTreeSitterInjectionsMetadata(grammar, metadata, queries.injections);
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
  metadata?: TreeSitterInjectionMetadata[],
): void {
  if (!metadata) return;

  const knownNodes = collectKnownTreeSitterNodeNamesWithMetadata(
    grammar,
    fullMetadata,
  );
  for (const injection of metadata) {
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
