import { type CharRange, MAX_CODE_POINT } from "./ast.ts";
import type { Nfa } from "./nfa.ts";

export interface DfaTransition extends CharRange {
  target: number;
}

export interface DfaState {
  id: number;
  nfaStates: readonly number[];
  accepts: readonly number[];
  selectedAccept: number | null;
  transitions: readonly DfaTransition[];
}

export interface Dfa {
  start: number;
  states: readonly DfaState[];
}

export function buildDfa(
  nfa: Nfa,
  chooseAccept: (accepts: readonly number[]) => number | null = defaultAccept,
): Dfa {
  const segments = collectAlphabetSegments(nfa);
  const states: DfaState[] = [];
  const stateByKey = new Map<string, number>();
  const queue: number[][] = [];

  const addState = (nfaStates: readonly number[]): number => {
    const normalized = [...new Set(nfaStates)].sort((left, right) =>
      left - right
    );
    const key = normalized.join(",");
    const existing = stateByKey.get(key);
    if (existing !== undefined) return existing;
    const accepts = [
      ...new Set(
        normalized.flatMap((state) => nfa.states[state]?.accepts ?? []),
      ),
    ].sort((left, right) => left - right);
    const id = states.length;
    states.push({
      id,
      nfaStates: normalized,
      accepts,
      selectedAccept: chooseAccept(accepts),
      transitions: [],
    });
    stateByKey.set(key, id);
    queue.push(normalized);
    return id;
  };

  const start = addState(epsilonClosure(nfa, [nfa.start]));
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
    const nfaStates = queue[queueIndex];
    const dfaState = states[queueIndex];
    const transitions: DfaTransition[] = [];
    for (const segment of segments) {
      const targets = move(nfa, nfaStates, segment.start);
      if (targets.length === 0) continue;
      const target = addState(epsilonClosure(nfa, targets));
      const previous = transitions[transitions.length - 1];
      if (
        previous && previous.target === target &&
        previous.end + 1 === segment.start
      ) {
        previous.end = segment.end;
      } else {
        transitions.push({ ...segment, target });
      }
    }
    states[dfaState.id] = { ...dfaState, transitions };
  }

  return { start, states };
}

function defaultAccept(accepts: readonly number[]): number | null {
  return accepts[0] ?? null;
}

function epsilonClosure(nfa: Nfa, roots: readonly number[]): number[] {
  const result = new Set<number>();
  const queue = [...roots];
  for (let index = 0; index < queue.length; index++) {
    const stateId = queue[index];
    if (result.has(stateId)) continue;
    result.add(stateId);
    for (const target of nfa.states[stateId]?.epsilon ?? []) {
      queue.push(target);
    }
  }
  return [...result].sort((left, right) => left - right);
}

function move(
  nfa: Nfa,
  stateIds: readonly number[],
  codePoint: number,
): number[] {
  const result = new Set<number>();
  for (const stateId of stateIds) {
    for (const transition of nfa.states[stateId]?.transitions ?? []) {
      if (
        transition.ranges.some((range) =>
          range.start <= codePoint && codePoint <= range.end
        )
      ) {
        result.add(transition.target);
      }
    }
  }
  return [...result].sort((left, right) => left - right);
}

function collectAlphabetSegments(nfa: Nfa): CharRange[] {
  const boundaries = new Set([0, MAX_CODE_POINT + 1]);
  for (const state of nfa.states) {
    for (const transition of state.transitions) {
      for (const range of transition.ranges) {
        boundaries.add(range.start);
        if (range.end < MAX_CODE_POINT) boundaries.add(range.end + 1);
      }
    }
  }
  const sorted = [...boundaries].sort((left, right) => left - right);
  const segments: CharRange[] = [];
  for (let index = 0; index < sorted.length - 1; index++) {
    const start = sorted[index];
    const end = sorted[index + 1] - 1;
    if (start <= end) segments.push({ start, end });
  }
  return segments;
}
