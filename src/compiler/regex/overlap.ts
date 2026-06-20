import { buildDfa, type Dfa, type DfaTransition } from "./dfa.ts";
import { buildRegexNfa } from "./nfa.ts";
import type { RegexAst } from "./ast.ts";

export function regexOverlapWitness(
  left: RegexAst,
  right: RegexAst,
): string | null {
  const leftDfa = buildDfa(buildRegexNfa(left));
  const rightDfa = buildDfa(buildRegexNfa(right));
  return dfaOverlapWitness(leftDfa, rightDfa);
}

function dfaOverlapWitness(left: Dfa, right: Dfa): string | null {
  const queue: Array<{ left: number; right: number; text: string }> = [{
    left: left.start,
    right: right.start,
    text: "",
  }];
  const visited = new Set<string>();
  for (let index = 0; index < queue.length; index++) {
    const item = queue[index];
    const key = `${item.left}/${item.right}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const leftState = left.states[item.left];
    const rightState = right.states[item.right];
    if (leftState.accepts.length > 0 && rightState.accepts.length > 0) {
      return item.text;
    }
    for (
      const transition of overlappingTransitions(
        leftState.transitions,
        rightState.transitions,
      )
    ) {
      queue.push({
        left: transition.leftTarget,
        right: transition.rightTarget,
        text: item.text + String.fromCodePoint(transition.codePoint),
      });
    }
  }
  return null;
}

function overlappingTransitions(
  left: readonly DfaTransition[],
  right: readonly DfaTransition[],
): Array<{ codePoint: number; leftTarget: number; rightTarget: number }> {
  const result: Array<{
    codePoint: number;
    leftTarget: number;
    rightTarget: number;
  }> = [];
  for (const leftTransition of left) {
    for (const rightTransition of right) {
      const start = Math.max(leftTransition.start, rightTransition.start);
      const end = Math.min(leftTransition.end, rightTransition.end);
      if (start <= end) {
        result.push({
          codePoint: start,
          leftTarget: leftTransition.target,
          rightTarget: rightTransition.target,
        });
      }
    }
  }
  return result.sort((leftTransition, rightTransition) =>
    leftTransition.codePoint - rightTransition.codePoint ||
    leftTransition.leftTarget - rightTransition.leftTarget ||
    leftTransition.rightTarget - rightTransition.rightTarget
  );
}
