import type { RegexAst } from "./ast.ts";
import { buildDfa, type Dfa, minimizeDfa } from "./dfa.ts";
import type { RegexCompilerLimits } from "./limits.ts";
import { buildCombinedNfa } from "./nfa.ts";

export interface LexerRegexSpec {
  ast: RegexAst;
  type: "named" | "literal";
  priority: number;
  order: number;
  contextual: boolean;
}

export function buildLexerDfa(
  specs: readonly LexerRegexSpec[],
  limits: RegexCompilerLimits = {},
): Dfa {
  const nfa = buildCombinedNfa(
    specs.map((spec, index) => ({ ast: spec.ast, accept: index })),
    limits,
  );
  const dfa = buildDfa(
    nfa,
    (accepts) => chooseAccept(specs, accepts),
    limits,
  );
  return minimizeDfa(dfa);
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
  let contextualOrder = 0;
  if (left.contextual !== right.contextual) {
    if (left.contextual === true) {
      contextualOrder = 1;
    } else {
      contextualOrder = -1;
    }
  }
  let typeOrder = 0;
  if (left.type !== right.type) {
    if (left.type === "literal") {
      typeOrder = -1;
    } else {
      typeOrder = 1;
    }
  }
  return contextualOrder ||
    right.priority - left.priority ||
    typeOrder ||
    left.order - right.order;
}
