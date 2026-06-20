import { buildDfa } from "./dfa.ts";
import { dfaIntersectionWitness } from "./intersect.ts";
import { buildRegexNfa } from "./nfa.ts";
import type { RegexAst } from "./ast.ts";

export function regexOverlapWitness(
  left: RegexAst,
  right: RegexAst,
): string | null {
  const leftDfa = buildDfa(buildRegexNfa(left));
  const rightDfa = buildDfa(buildRegexNfa(right));
  return dfaIntersectionWitness(leftDfa, rightDfa)?.text ?? null;
}
