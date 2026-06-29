import {
  type CharRange,
  invertRanges,
  MAX_CODE_POINT,
  normalizeRanges,
  type RegexAst,
} from "./ast.ts";
import {
  enforceRegexAstNodeLimit,
  type RegexCompilerLimits,
  RegexResourceLimitError,
} from "./limits.ts";

export class RegexSyntaxError extends Error {
  constructor(message: string, readonly index: number) {
    super(`${message} at regex offset ${index}`);
    this.name = "RegexSyntaxError";
  }
}

let parsePortableRegexInvocationCountForTesting = 0;
const unicodePropertyRangeCache = new Map<string, readonly CharRange[]>();

export function parsePortableRegex(
  pattern: string,
  limits: RegexCompilerLimits = {},
): RegexAst {
  parsePortableRegexInvocationCountForTesting++;
  const sourceLimit = limits.sourceLengthLimit;
  if (sourceLimit !== undefined && pattern.length > sourceLimit) {
    throw new RegexResourceLimitError(
      "REGEX_SOURCE_LIMIT",
      `regex source has ${pattern.length} UTF-16 code units, exceeding the configured limit (${sourceLimit}).`,
      sourceLimit,
    );
  }
  const parser = new RegexParser(pattern, limits);
  const ast = parser.parseChoice();
  if (!parser.atEnd()) {
    throw parser.error(`Unexpected ${JSON.stringify(parser.peek())}`);
  }
  enforceRegexAstNodeLimit(ast, limits);
  return ast;
}

export function resetParsePortableRegexInvocationCountForTesting(): void {
  parsePortableRegexInvocationCountForTesting = 0;
}

export function getParsePortableRegexInvocationCountForTesting(): number {
  return parsePortableRegexInvocationCountForTesting;
}

class RegexParser {
  #index = 0;
  #groupDepth = 0;

  constructor(
    private readonly source: string,
    private readonly limits: RegexCompilerLimits,
  ) {}

  atEnd(): boolean {
    return this.#index >= this.source.length;
  }

  peek(): string {
    const char = this.source[this.#index];
    if (char === undefined) {
      return "";
    }
    return char;
  }

  parseChoice(): RegexAst {
    const options = [this.parseSequence()];
    while (this.match("|")) {
      options.push(this.parseSequence());
    }
    if (options.length === 1) {
      return options[0];
    }
    return { kind: "choice", options };
  }

  private parseSequence(): RegexAst {
    const items: RegexAst[] = [];
    while (
      !this.atEnd() &&
      this.peek() !== ")" &&
      this.peek() !== "|"
    ) {
      items.push(this.parseQuantified());
    }
    if (items.length === 0) return { kind: "empty" };
    if (items.length === 1) {
      return items[0];
    }
    return { kind: "sequence", items };
  }

  private parseQuantified(): RegexAst {
    let expression = this.parseAtom();
    while (!this.atEnd()) {
      const char = this.peek();
      if (char === "*") {
        this.#index++;
        this.rejectLazy();
        expression = { kind: "repeat", expression, min: 0, max: null };
        continue;
      }
      if (char === "+") {
        this.#index++;
        this.rejectLazy();
        expression = { kind: "repeat", expression, min: 1, max: null };
        continue;
      }
      if (char === "?") {
        this.#index++;
        this.rejectLazy();
        expression = { kind: "repeat", expression, min: 0, max: 1 };
        continue;
      }
      if (char === "{") {
        const { min, max } = this.parseBraceQuantifier();
        this.rejectLazy();
        expression = { kind: "repeat", expression, min, max };
        continue;
      }
      return expression;
    }
    return expression;
  }

  private parseAtom(): RegexAst {
    const char = this.peek();
    if (char === "") throw this.error("Expected regex atom");
    if (char === "^" || char === "$") {
      throw this.error("Anchors are outside Baba's portable regex subset");
    }
    if (char === ".") {
      this.#index++;
      return { kind: "dot" };
    }
    if (char === "(") return this.parseGroup();
    if (char === "[") return this.parseClass();
    if (char === "\\") {
      if (this.peekNext() === "p" || this.peekNext() === "P") {
        const property = this.parsePropertyEscape();
        return {
          kind: "class",
          ranges: property.ranges,
          negated: property.negated,
        };
      }
      return { kind: "literal", codePoint: this.parseEscape(false) };
    }
    if ("|)*+?{}".includes(char)) {
      throw this.error(`Unexpected regex operator ${JSON.stringify(char)}`);
    }
    return { kind: "literal", codePoint: this.advanceCodePoint() };
  }

  private parseGroup(): RegexAst {
    this.expect("(");
    this.#groupDepth++;
    const nestingLimit = this.limits.nestingLimit;
    if (nestingLimit !== undefined && this.#groupDepth > nestingLimit) {
      throw new RegexResourceLimitError(
        "REGEX_NESTING_LIMIT",
        `regex nesting depth ${this.#groupDepth} exceeds the configured limit (${nestingLimit}).`,
        nestingLimit,
      );
    }
    if (this.peek() === "?") {
      throw this.error(
        "Lookaround, inline flags, named groups, and noncapturing groups are outside Baba's portable regex subset",
      );
    }
    try {
      const expression = this.parseChoice();
      this.expect(")");
      return expression;
    } finally {
      this.#groupDepth--;
    }
  }

  private parseClass(): RegexAst {
    this.expect("[");
    const negated = this.match("^");
    const ranges: CharRange[] = [];
    let first = true;
    while (!this.atEnd()) {
      if (this.peek() === "]" && !first) {
        this.#index++;
        return { kind: "class", ranges: normalizeRanges(ranges), negated };
      }
      first = false;
      const startRanges = this.parseClassRanges();
      if (
        startRanges.length === 1 &&
        startRanges[0].start === startRanges[0].end &&
        this.peek() === "-" && this.source[this.#index + 1] !== "]"
      ) {
        this.#index++;
        const endRanges = this.parseClassRanges();
        if (
          endRanges.length !== 1 || endRanges[0].start !== endRanges[0].end
        ) {
          throw this.error("Character class range endpoint must be literal");
        }
        const start = startRanges[0].start;
        const end = endRanges[0].start;
        if (end < start) throw this.error("Character class range is reversed");
        ranges.push({ start, end });
      } else {
        ranges.push(...startRanges);
      }
    }
    throw this.error("Unterminated character class");
  }

  private parseClassRanges(): CharRange[] {
    if (this.peek() === "\\") {
      if (this.peekNext() === "p" || this.peekNext() === "P") {
        const property = this.parsePropertyEscape();
        if (property.negated) {
          return invertRanges(property.ranges);
        }
        return [...property.ranges];
      }
      const codePoint = this.parseEscape(true);
      return [{ start: codePoint, end: codePoint }];
    }
    if (this.peek() === "") throw this.error("Expected character class member");
    const codePoint = this.advanceCodePoint();
    return [{ start: codePoint, end: codePoint }];
  }

  private parseEscape(inClass: boolean): number {
    const slash = this.#index;
    this.expect("\\");
    const escaped = this.peek();
    if (!escaped) throw this.error("Unterminated escape");
    if (/^[1-9]$/.test(escaped)) {
      throw new RegexSyntaxError(
        "Backreferences are outside Baba's portable regex subset",
        slash,
      );
    }
    if (escaped === "p" || escaped === "P") {
      throw new RegexSyntaxError(
        "Unicode property escapes are outside Baba's portable regex subset",
        slash,
      );
    }
    if ("sSdDwWbB".includes(escaped)) {
      throw new RegexSyntaxError(
        "Regex shorthand classes and boundaries are outside Baba's portable regex subset",
        slash,
      );
    }
    if (
      escaped === "u" || escaped === "x" || escaped === "c" || escaped === "k"
    ) {
      throw new RegexSyntaxError(
        "Regex escape forms with target-specific semantics are outside Baba's portable regex subset",
        slash,
      );
    }
    this.#index++;
    switch (escaped) {
      case "n":
        return 10;
      case "r":
        return 13;
      case "t":
        return 9;
      case "f":
        return 12;
      case "v":
        return 11;
      case "0":
        return 0;
      case "-":
        return "-".codePointAt(0)!;
      case "]":
        if (inClass) return "]".codePointAt(0)!;
        break;
      case "/":
      case "\\":
      case "|":
      case "(":
      case ")":
      case "[":
      case "{":
      case "}":
      case "*":
      case "+":
      case "?":
      case ".":
      case "^":
      case "$":
        return escaped.codePointAt(0)!;
    }
    throw new RegexSyntaxError(
      `Escape \\${escaped} is outside Baba's portable regex subset`,
      slash,
    );
  }

  private parsePropertyEscape(): {
    readonly ranges: readonly CharRange[];
    readonly negated: boolean;
  } {
    const slash = this.#index;
    this.expect("\\");
    const escaped = this.peek();
    if (escaped !== "p" && escaped !== "P") {
      throw new RegexSyntaxError("Expected Unicode property escape", slash);
    }
    this.#index++;
    this.expect("{");
    const propertyStart = this.#index;
    while (!this.atEnd() && this.peek() !== "}") {
      this.#index++;
    }
    if (this.atEnd()) {
      throw new RegexSyntaxError("Unterminated Unicode property escape", slash);
    }
    const property = this.source.slice(propertyStart, this.#index);
    this.expect("}");
    return {
      ranges: unicodePropertyRanges(property, slash),
      negated: escaped === "P",
    };
  }

  private parseBraceQuantifier(): { min: number; max: number | null } {
    const start = this.#index;
    this.expect("{");
    const minText = this.readDigits();
    if (!minText) {
      throw new RegexSyntaxError("Expected quantifier lower bound", start);
    }
    const min = Number(minText);
    let max: number | null = min;
    if (this.match(",")) {
      const maxText = this.readDigits();
      if (maxText) {
        max = Number(maxText);
      } else {
        max = null;
      }
    }
    this.expect("}");
    if (!Number.isSafeInteger(min) || min < 0) {
      throw new RegexSyntaxError("Invalid quantifier lower bound", start);
    }
    if (max !== null && (!Number.isSafeInteger(max) || max < min)) {
      throw new RegexSyntaxError("Invalid quantifier upper bound", start);
    }
    return { min, max };
  }

  private readDigits(): string {
    const start = this.#index;
    while (/[0-9]/.test(this.peek())) this.#index++;
    return this.source.slice(start, this.#index);
  }

  private rejectLazy(): void {
    if (this.peek() === "?") {
      throw this.error(
        "Lazy quantifiers are outside Baba's portable regex subset",
      );
    }
  }

  private advanceCodePoint(): number {
    const codePoint = this.source.codePointAt(this.#index);
    if (codePoint === undefined || codePoint > MAX_CODE_POINT) {
      throw this.error("Expected Unicode code point");
    }
    if (codePoint > 0xffff) {
      this.#index += 2;
    } else {
      this.#index++;
    }
    return codePoint;
  }

  private match(text: string): boolean {
    if (!this.source.startsWith(text, this.#index)) return false;
    this.#index += text.length;
    return true;
  }

  private peekNext(): string {
    const next = this.source[this.#index + 1];
    if (next === undefined) {
      return "";
    }
    return next;
  }

  private expect(text: string): void {
    if (!this.match(text)) throw this.error(`Expected ${JSON.stringify(text)}`);
  }

  error(message: string): RegexSyntaxError {
    return new RegexSyntaxError(message, this.#index);
  }
}

function unicodePropertyRanges(
  property: string,
  index: number,
): readonly CharRange[] {
  const normalized = normalizeUnicodeProperty(property);
  const existing = unicodePropertyRangeCache.get(normalized);
  if (existing !== undefined) {
    return existing;
  }
  let matcher: RegExp;
  try {
    matcher = new RegExp(`^\\p{${normalized}}$`, "u");
  } catch (_error) {
    throw new RegexSyntaxError(
      `Unsupported Unicode property ${JSON.stringify(property)}`,
      index,
    );
  }
  const ranges: CharRange[] = [];
  let activeStart: number | undefined;
  for (let codePoint = 0; codePoint <= MAX_CODE_POINT; codePoint++) {
    const matches = matcher.test(String.fromCodePoint(codePoint));
    if (matches) {
      if (activeStart === undefined) {
        activeStart = codePoint;
      }
      continue;
    }
    if (activeStart !== undefined) {
      ranges.push({ start: activeStart, end: codePoint - 1 });
      activeStart = undefined;
    }
  }
  if (activeStart !== undefined) {
    ranges.push({ start: activeStart, end: MAX_CODE_POINT });
  }
  const normalizedRanges = normalizeRanges(ranges);
  unicodePropertyRangeCache.set(normalized, normalizedRanges);
  return normalizedRanges;
}

function normalizeUnicodeProperty(property: string): string {
  if (property === "Letter") {
    return "L";
  }
  if (property === "Number") {
    return "N";
  }
  return property;
}
