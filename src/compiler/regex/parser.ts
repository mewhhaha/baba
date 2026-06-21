import {
  type CharRange,
  MAX_CODE_POINT,
  normalizeRanges,
  type RegexAst,
} from "./ast.ts";
import {
  enforceRegexAstNodeLimit,
  type RegexCompilerLimits,
} from "./limits.ts";

export class RegexSyntaxError extends Error {
  constructor(message: string, readonly index: number) {
    super(`${message} at regex offset ${index}`);
    this.name = "RegexSyntaxError";
  }
}

export function parsePortableRegex(
  pattern: string,
  limits: RegexCompilerLimits = {},
): RegexAst {
  const parser = new RegexParser(pattern);
  const ast = parser.parseChoice();
  if (!parser.atEnd()) {
    throw parser.error(`Unexpected ${JSON.stringify(parser.peek())}`);
  }
  enforceRegexAstNodeLimit(ast, limits);
  return ast;
}

class RegexParser {
  #index = 0;

  constructor(private readonly source: string) {}

  atEnd(): boolean {
    return this.#index >= this.source.length;
  }

  peek(): string {
    return this.source[this.#index] ?? "";
  }

  parseChoice(): RegexAst {
    const options = [this.parseSequence()];
    while (this.match("|")) {
      options.push(this.parseSequence());
    }
    return options.length === 1 ? options[0] : { kind: "choice", options };
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
    return items.length === 1 ? items[0] : { kind: "sequence", items };
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
      return { kind: "literal", codePoint: this.parseEscape(false) };
    }
    if ("|)*+?{}".includes(char)) {
      throw this.error(`Unexpected regex operator ${JSON.stringify(char)}`);
    }
    return { kind: "literal", codePoint: this.advanceCodePoint() };
  }

  private parseGroup(): RegexAst {
    this.expect("(");
    if (this.peek() === "?") {
      throw this.error(
        "Lookaround, inline flags, named groups, and noncapturing groups are outside Baba's portable regex subset",
      );
    }
    const expression = this.parseChoice();
    this.expect(")");
    return expression;
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
      const start = this.parseClassCodePoint();
      if (this.peek() === "-" && this.source[this.#index + 1] !== "]") {
        this.#index++;
        const end = this.parseClassCodePoint();
        if (end < start) throw this.error("Character class range is reversed");
        ranges.push({ start, end });
      } else {
        ranges.push({ start, end: start });
      }
    }
    throw this.error("Unterminated character class");
  }

  private parseClassCodePoint(): number {
    if (this.peek() === "\\") return this.parseEscape(true);
    if (this.peek() === "") throw this.error("Expected character class member");
    return this.advanceCodePoint();
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
      max = maxText ? Number(maxText) : null;
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
    this.#index += codePoint > 0xffff ? 2 : 1;
    return codePoint;
  }

  private match(text: string): boolean {
    if (!this.source.startsWith(text, this.#index)) return false;
    this.#index += text.length;
    return true;
  }

  private expect(text: string): void {
    if (!this.match(text)) throw this.error(`Expected ${JSON.stringify(text)}`);
  }

  error(message: string): RegexSyntaxError {
    return new RegexSyntaxError(message, this.#index);
  }
}
