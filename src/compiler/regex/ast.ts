export const MAX_CODE_POINT = 0x10ffff;

export interface CharRange {
  start: number;
  end: number;
}

export type RegexAst =
  | { kind: "empty" }
  | { kind: "literal"; codePoint: number }
  | { kind: "dot" }
  | { kind: "class"; ranges: readonly CharRange[]; negated: boolean }
  | { kind: "sequence"; items: readonly RegexAst[] }
  | { kind: "choice"; options: readonly RegexAst[] }
  | { kind: "repeat"; expression: RegexAst; min: number; max: number | null };

export function codePointLength(codePoint: number): 1 | 2 {
  return codePoint > 0xffff ? 2 : 1;
}

export function normalizeRanges(
  ranges: readonly CharRange[],
): CharRange[] {
  const sorted = ranges
    .filter((range) => range.start <= range.end)
    .map((range) => ({
      start: Math.max(0, range.start),
      end: Math.min(MAX_CODE_POINT, range.end),
    }))
    .filter((range) => range.start <= range.end)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const result: CharRange[] = [];
  for (const range of sorted) {
    const previous = result[result.length - 1];
    if (!previous || range.start > previous.end + 1) {
      result.push({ ...range });
      continue;
    }
    previous.end = Math.max(previous.end, range.end);
  }
  return result;
}

export function invertRanges(ranges: readonly CharRange[]): CharRange[] {
  const normalized = normalizeRanges(ranges);
  const result: CharRange[] = [];
  let next = 0;
  for (const range of normalized) {
    if (next < range.start) result.push({ start: next, end: range.start - 1 });
    next = range.end + 1;
  }
  if (next <= MAX_CODE_POINT) result.push({ start: next, end: MAX_CODE_POINT });
  return result;
}

export function isRegexNullable(ast: RegexAst): boolean {
  switch (ast.kind) {
    case "empty":
      return true;
    case "literal":
    case "dot":
    case "class":
      return false;
    case "sequence":
      return ast.items.every(isRegexNullable);
    case "choice":
      return ast.options.some(isRegexNullable);
    case "repeat":
      return ast.min === 0 || isRegexNullable(ast.expression);
  }
}
