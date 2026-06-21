import type { Dfa, DfaTransition } from "./dfa.ts";
import type { RegexCompilerLimits } from "./limits.ts";
import { RegexResourceLimitError } from "./limits.ts";

export interface DfaIntersectionWitness {
  text: string;
  leftState: number;
  rightState: number;
}

export function dfaIntersectionWitness(
  left: Dfa,
  right: Dfa,
  limits: RegexCompilerLimits = {},
): DfaIntersectionWitness | null {
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
    const limit = limits.overlapProductStateLimit;
    if (limit !== undefined && visited.size >= limit) {
      throw new RegexResourceLimitError(
        "REGEX_OVERLAP_WORK_LIMIT",
        `Regex overlap product-state limit exceeded (${limit}).`,
        limit,
      );
    }
    visited.add(key);
    const leftState = left.states[item.left];
    const rightState = right.states[item.right];
    if (leftState.accepts.length > 0 && rightState.accepts.length > 0) {
      return {
        text: item.text,
        leftState: item.left,
        rightState: item.right,
      };
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
