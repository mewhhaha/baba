import type { Dfa, DfaTransition } from "./dfa.ts";
import type { RegexCompilerLimits } from "./limits.ts";
import { RegexResourceLimitError } from "./limits.ts";

export interface DfaIntersectionWitness {
  text: string;
  leftState: number;
  rightState: number;
}

export interface DfaDifferenceWitness {
  text: string;
  leftState: number;
  rightStates: readonly (number | null)[];
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

export function dfaDifferenceWitness(
  left: Dfa,
  right: readonly Dfa[],
  limits: RegexCompilerLimits = {},
): DfaDifferenceWitness | null {
  const startRightStates = right.map((dfa) => dfa.start);
  const queue: Array<{
    left: number;
    right: readonly (number | null)[];
    text: string;
  }> = [{
    left: left.start,
    right: startRightStates,
    text: "",
  }];
  const visited = new Set<string>();
  for (let index = 0; index < queue.length; index++) {
    const item = queue[index];
    const key = `${item.left}/${
      item.right.map((state) => state === null ? "-" : state).join(",")
    }`;
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
    const rightStates = item.right.map((state, rightIndex) =>
      state === null ? null : right[rightIndex].states[state]
    );
    if (
      leftState.accepts.length > 0 &&
      rightStates.every((state) => !state || state.accepts.length === 0)
    ) {
      return {
        text: item.text,
        leftState: item.left,
        rightStates: item.right,
      };
    }
    for (
      const transition of differenceTransitions(
        leftState.transitions,
        rightStates.map((state) => state?.transitions ?? []),
      )
    ) {
      const nextRight = rightStates.map((state) =>
        state ? transitionTarget(state.transitions, transition.codePoint) : null
      );
      queue.push({
        left: transition.leftTarget,
        right: nextRight,
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

function differenceTransitions(
  left: readonly DfaTransition[],
  right: readonly (readonly DfaTransition[])[],
): Array<{ codePoint: number; leftTarget: number }> {
  const result: Array<{ codePoint: number; leftTarget: number }> = [];
  for (const leftTransition of left) {
    const boundaries = new Set([leftTransition.start]);
    for (const transitions of right) {
      for (const rightTransition of transitions) {
        if (
          leftTransition.start < rightTransition.start &&
          rightTransition.start <= leftTransition.end
        ) {
          boundaries.add(rightTransition.start);
        }
        const afterRight = rightTransition.end + 1;
        if (
          leftTransition.start < afterRight &&
          afterRight <= leftTransition.end
        ) {
          boundaries.add(afterRight);
        }
      }
    }
    for (const codePoint of boundaries) {
      result.push({ codePoint, leftTarget: leftTransition.target });
    }
  }
  return result.sort((leftTransition, rightTransition) =>
    leftTransition.codePoint - rightTransition.codePoint ||
    leftTransition.leftTarget - rightTransition.leftTarget
  );
}

function transitionTarget(
  transitions: readonly DfaTransition[],
  codePoint: number,
): number | null {
  for (const transition of transitions) {
    if (transition.start <= codePoint && codePoint <= transition.end) {
      return transition.target;
    }
  }
  return null;
}
