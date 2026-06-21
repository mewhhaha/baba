import type { CharRange, RegexAst } from "./ast.ts";

export function emitPortableRegexSource(ast: RegexAst): string {
  return render(ast, 0);
}

function render(ast: RegexAst, parentPrecedence: number): string {
  switch (ast.kind) {
    case "empty":
      return "";
    case "literal":
      return escapeLiteral(ast.codePoint);
    case "dot":
      return ".";
    case "class":
      return classSource(ast.ranges, ast.negated);
    case "sequence": {
      const source = ast.items.map((item) => render(item, 2)).join("");
      return grouped(source, 2, parentPrecedence);
    }
    case "choice": {
      const source = ast.options.map((option) => render(option, 1)).join("|");
      return grouped(source, 1, parentPrecedence);
    }
    case "repeat": {
      const source = `${render(ast.expression, 3)}${
        quantifier(ast.min, ast.max)
      }`;
      return grouped(source, 3, parentPrecedence);
    }
  }
}

function grouped(
  source: string,
  precedence: number,
  parentPrecedence: number,
): string {
  return precedence < parentPrecedence ? `(${source})` : source;
}

function quantifier(min: number, max: number | null): string {
  if (min === 0 && max === null) return "*";
  if (min === 1 && max === null) return "+";
  if (min === 0 && max === 1) return "?";
  if (max === min) return `{${min}}`;
  if (max === null) return `{${min},}`;
  return `{${min},${max}}`;
}

function classSource(ranges: readonly CharRange[], negated: boolean): string {
  const parts = ranges.map((range) =>
    range.start === range.end
      ? escapeClassLiteral(range.start)
      : `${escapeClassLiteral(range.start)}-${escapeClassLiteral(range.end)}`
  );
  return `[${negated ? "^" : ""}${parts.join("")}]`;
}

function escapeLiteral(codePoint: number): string {
  switch (codePoint) {
    case 0:
      return "\\0";
    case 9:
      return "\\t";
    case 10:
      return "\\n";
    case 11:
      return "\\v";
    case 12:
      return "\\f";
    case 13:
      return "\\r";
    case 0x2028:
      return "\\u2028";
    case 0x2029:
      return "\\u2029";
  }
  const text = String.fromCodePoint(codePoint);
  return /[\\/[|(){}*+?.^$]/.test(text) ? `\\${text}` : text;
}

function escapeClassLiteral(codePoint: number): string {
  switch (codePoint) {
    case 0:
      return "\\0";
    case 9:
      return "\\t";
    case 10:
      return "\\n";
    case 11:
      return "\\v";
    case 12:
      return "\\f";
    case 13:
      return "\\r";
    case 0x2028:
      return "\\u2028";
    case 0x2029:
      return "\\u2029";
  }
  const text = String.fromCodePoint(codePoint);
  return /[\\\]\-]/.test(text) ? `\\${text}` : text;
}
