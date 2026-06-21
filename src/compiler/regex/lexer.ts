import type { RegexAst } from "./ast.ts";
import { buildDfa, type Dfa } from "./dfa.ts";
import type { RegexCompilerLimits } from "./limits.ts";
import { buildCombinedNfa } from "./nfa.ts";

export interface LexerRegexSpec {
  ast: RegexAst;
  type: "named" | "literal";
  priority: number;
  order: number;
}

export function buildLexerDfa(
  specs: readonly LexerRegexSpec[],
  limits: RegexCompilerLimits = {},
): Dfa {
  const nfa = buildCombinedNfa(
    specs.map((spec, index) => ({ ast: spec.ast, accept: index })),
    limits,
  );
  return buildDfa(nfa, (accepts) => chooseAccept(specs, accepts), limits);
}

function chooseAccept(
  specs: readonly LexerRegexSpec[],
  accepts: readonly number[],
): number | null {
  let best: number | null = null;
  for (const accept of accepts) {
    if (
      best === null ||
      compareSpecs(specs[accept], specs[best]) < 0
    ) {
      best = accept;
    }
  }
  return best;
}

function compareSpecs(left: LexerRegexSpec, right: LexerRegexSpec): number {
  return right.priority - left.priority ||
    (left.type === right.type ? 0 : left.type === "literal" ? -1 : 1) ||
    left.order - right.order;
}
