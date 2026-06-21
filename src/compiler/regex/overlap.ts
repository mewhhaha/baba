import { buildDfa, type Dfa } from "./dfa.ts";
import { dfaIntersectionWitness } from "./intersect.ts";
import type { RegexCompilerLimits } from "./limits.ts";
import { buildRegexNfa } from "./nfa.ts";
import type { RegexAst } from "./ast.ts";

export function regexOverlapWitness(
  left: RegexAst,
  right: RegexAst,
  limits: RegexCompilerLimits = {},
): string | null {
  return dfaOverlapWitness(
    regexDfa(left, limits),
    regexDfa(right, limits),
    limits,
  );
}

export function regexDfa(
  ast: RegexAst,
  limits: RegexCompilerLimits = {},
): Dfa {
  return buildDfa(buildRegexNfa(ast, 0, limits), undefined, limits);
}

export function dfaOverlapWitness(
  leftDfa: Dfa,
  rightDfa: Dfa,
  limits: RegexCompilerLimits = {},
): string | null {
  return dfaIntersectionWitness(leftDfa, rightDfa, limits)?.text ?? null;
}
