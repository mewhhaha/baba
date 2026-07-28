import { type CharRange, MAX_CODE_POINT } from "./ast.ts";
import type { RegexCompilerLimits } from "./limits.ts";
import { RegexResourceLimitError } from "./limits.ts";
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

/** First code point that is not covered by the direct-mapped ASCII class table. */
export const ASCII_CLASS_LIMIT = 128;

export interface DfaClassRange extends CharRange {
  classId: number;
}

/**
 * Alphabet equivalence classes of a lexer DFA.
 *
 * Two code points share a class exactly when every DFA state transitions on
 * them to the same target (with "no transition" counted as a distinct target).
 * The partition is therefore the coarsest one for which a dense
 * `(states x classes)` transition table is well defined, which is what a
 * consumer wanting such a table needs.
 *
 * The split into a direct-mapped ASCII table plus a range list above ASCII is
 * deliberate: `ASCII_CLASS_LIMIT` is always a class boundary, so the two halves
 * are independent and a consumer can classify ASCII with one indexed load.
 */
export interface DfaAlphabet {
  readonly classCount: number;
  /** Length `ASCII_CLASS_LIMIT`; class id of each code point below ASCII_CLASS_LIMIT. */
  readonly asciiClasses: readonly number[];
  /** Sorted, gap-free ranges covering `[ASCII_CLASS_LIMIT, MAX_CODE_POINT]`. */
  readonly aboveAsciiRanges: readonly DfaClassRange[];
}

export interface Dfa {
  start: number;
  states: readonly DfaState[];
  alphabet: DfaAlphabet;
}

/**
 * Partition of a DFA that has no transitions at all: every code point is dead,
 * so the whole space is one class. Written out rather than derived so that a
 * caller building a placeholder DFA state by state does not have to run the
 * partitioner to get a well-formed alphabet.
 */
export const DEAD_DFA_ALPHABET: DfaAlphabet = {
  classCount: 1,
  asciiClasses: new Array(ASCII_CLASS_LIMIT).fill(0),
  aboveAsciiRanges: [{
    start: ASCII_CLASS_LIMIT,
    end: MAX_CODE_POINT,
    classId: 0,
  }],
};

export function buildDfa(
  nfa: Nfa,
  chooseAccept: (accepts: readonly number[]) => number | null = defaultAccept,
  limits: RegexCompilerLimits = {},
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
    const limit = limits.dfaStateLimit;
    if (limit !== undefined && id >= limit) {
      throw new RegexResourceLimitError(
        "REGEX_DFA_STATE_LIMIT",
        `Regex DFA state limit exceeded (${limit}).`,
        limit,
      );
    }
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

  return { start, states, alphabet: computeDfaAlphabet(states) };
}

/**
 * Merges states that have identical accepting candidates and future behavior.
 *
 * The complete `accepts` set is observable because contextual-token resolution
 * consumes it after lexing. Partitioning only by `selectedAccept` would therefore
 * change parser behavior even when ordinary maximal-munch lexing stayed intact.
 */
export function minimizeDfa(dfa: Dfa): Dfa {
  if (dfa.states.length < 2) {
    return dfa;
  }

  const representatives = alphabetRepresentatives(dfa.alphabet);
  let partitionByState = partitionStates(
    dfa.states,
    (state) => acceptingSignature(state),
  );

  while (true) {
    const refined = partitionStates(dfa.states, (state) => {
      const targets: number[] = [];
      for (const codePoint of representatives) {
        const target = transitionTargetAt(state, codePoint);
        if (target < 0) {
          targets.push(-1);
          continue;
        }
        targets.push(partitionByState[target]);
      }
      return `${acceptingSignature(state)}|${targets.join(",")}`;
    });
    if (samePartitions(partitionByState, refined)) {
      break;
    }
    partitionByState = refined;
  }

  let partitionCount = 0;
  for (const partition of partitionByState) {
    partitionCount = Math.max(partitionCount, partition + 1);
  }
  if (partitionCount === dfa.states.length) {
    return dfa;
  }

  const members: number[][] = Array.from(
    { length: partitionCount },
    () => [],
  );
  for (let state = 0; state < dfa.states.length; state += 1) {
    members[partitionByState[state]].push(state);
  }

  const states: DfaState[] = [];
  for (let partition = 0; partition < members.length; partition += 1) {
    const representativeId = members[partition][0];
    const representative = dfa.states[representativeId];
    if (representative === undefined) {
      throw new Error(`DFA partition ${partition} has no representative.`);
    }
    const nfaStates = [
      ...new Set(
        members[partition].flatMap((state) => dfa.states[state].nfaStates),
      ),
    ].sort((left, right) => left - right);
    const transitions: DfaTransition[] = [];
    for (const transition of representative.transitions) {
      const target = partitionByState[transition.target];
      const previous = transitions[transitions.length - 1];
      if (
        previous !== undefined &&
        previous.target === target &&
        previous.end + 1 === transition.start
      ) {
        previous.end = transition.end;
        continue;
      }
      transitions.push({
        start: transition.start,
        end: transition.end,
        target,
      });
    }
    states.push({
      id: partition,
      nfaStates,
      accepts: representative.accepts,
      selectedAccept: representative.selectedAccept,
      transitions,
    });
  }

  return {
    start: partitionByState[dfa.start],
    states,
    alphabet: computeDfaAlphabet(states),
  };
}

/**
 * Computes the alphabet equivalence classes of an already-built DFA.
 *
 * The boundaries come from the DFA's own coalesced transition ranges rather than
 * from the NFA segments `collectAlphabetSegments` produces, for two reasons.
 * The DFA ranges give the coarsest correct partition, because segments the
 * subset construction merged back together cannot be distinguished by any state.
 * And it means a DFA rebuilt from a serialized plan partitions identically to
 * the DFA the compiler built, since the transitions are all that survives the
 * round trip.
 */
export function computeDfaAlphabet(
  states: readonly DfaState[],
): DfaAlphabet {
  const boundaries = new Set([0, ASCII_CLASS_LIMIT, MAX_CODE_POINT + 1]);
  for (const state of states) {
    for (const transition of state.transitions) {
      if (transition.start < 0 || transition.end > MAX_CODE_POINT) {
        throw new Error(
          `DFA transition range [${transition.start}, ${transition.end}] is outside the code point space.`,
        );
      }
      if (transition.start > transition.end) {
        throw new Error(
          `DFA transition range [${transition.start}, ${transition.end}] is inverted.`,
        );
      }
      boundaries.add(transition.start);
      if (transition.end < MAX_CODE_POINT) boundaries.add(transition.end + 1);
    }
  }
  const cuts = [...boundaries].sort((left, right) => left - right);

  // The target vector across every state is the class identity. Segments are
  // visited in ascending order, so class ids are assigned in order of first
  // appearance and are therefore stable for a given DFA.
  const classIdByKey = new Map<string, number>();
  const segmentClassIds: number[] = [];
  const segments: CharRange[] = [];
  for (let index = 0; index + 1 < cuts.length; index++) {
    const start = cuts[index];
    const end = cuts[index + 1] - 1;
    if (start > end) continue;
    const targets: number[] = [];
    for (const state of states) {
      targets.push(transitionTargetAt(state, start));
    }
    const key = targets.join(",");
    const existing = classIdByKey.get(key);
    if (existing === undefined) {
      const classId = classIdByKey.size;
      classIdByKey.set(key, classId);
      segments.push({ start, end });
      segmentClassIds.push(classId);
      continue;
    }
    segments.push({ start, end });
    segmentClassIds.push(existing);
  }
  const classCount = classIdByKey.size;
  if (classCount === 0) {
    throw new Error("DFA alphabet partition produced zero classes.");
  }

  const asciiClasses = new Array(ASCII_CLASS_LIMIT).fill(-1);
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (segment.start >= ASCII_CLASS_LIMIT) continue;
    const end = Math.min(segment.end, ASCII_CLASS_LIMIT - 1);
    for (let codePoint = segment.start; codePoint <= end; codePoint++) {
      asciiClasses[codePoint] = segmentClassIds[index];
    }
  }
  for (let codePoint = 0; codePoint < ASCII_CLASS_LIMIT; codePoint++) {
    if (asciiClasses[codePoint] < 0) {
      throw new Error(
        `DFA alphabet ASCII table has a hole at code point ${codePoint}.`,
      );
    }
  }

  const aboveAsciiRanges: DfaClassRange[] = [];
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (segment.end < ASCII_CLASS_LIMIT) continue;
    const start = Math.max(segment.start, ASCII_CLASS_LIMIT);
    const classId = segmentClassIds[index];
    const previous = aboveAsciiRanges[aboveAsciiRanges.length - 1];
    if (
      previous !== undefined && previous.classId === classId &&
      previous.end + 1 === start
    ) {
      previous.end = segment.end;
      continue;
    }
    aboveAsciiRanges.push({ start, end: segment.end, classId });
  }
  if (aboveAsciiRanges.length === 0) {
    throw new Error("DFA alphabet range list above ASCII is empty.");
  }
  return { classCount, asciiClasses, aboveAsciiRanges };
}

function transitionTargetAt(state: DfaState, codePoint: number): number {
  for (const transition of state.transitions) {
    if (transition.start <= codePoint && codePoint <= transition.end) {
      return transition.target;
    }
  }
  return -1;
}

function alphabetRepresentatives(alphabet: DfaAlphabet): number[] {
  const representatives = new Array<number>(alphabet.classCount).fill(-1);
  for (
    let codePoint = 0;
    codePoint < alphabet.asciiClasses.length;
    codePoint += 1
  ) {
    const classId = alphabet.asciiClasses[codePoint];
    if (representatives[classId] < 0) {
      representatives[classId] = codePoint;
    }
  }
  for (const range of alphabet.aboveAsciiRanges) {
    if (representatives[range.classId] < 0) {
      representatives[range.classId] = range.start;
    }
  }
  for (let classId = 0; classId < representatives.length; classId += 1) {
    if (representatives[classId] < 0) {
      throw new Error(`DFA alphabet class ${classId} has no representative.`);
    }
  }
  return representatives;
}

function acceptingSignature(state: DfaState): string {
  let selected = "none";
  if (state.selectedAccept !== null) {
    selected = String(state.selectedAccept);
  }
  return `${selected}:${state.accepts.join(",")}`;
}

function partitionStates(
  states: readonly DfaState[],
  signature: (state: DfaState) => string,
): number[] {
  const partitionBySignature = new Map<string, number>();
  const partitionByState: number[] = [];
  for (const state of states) {
    const key = signature(state);
    let partition = partitionBySignature.get(key);
    if (partition === undefined) {
      partition = partitionBySignature.size;
      partitionBySignature.set(key, partition);
    }
    partitionByState[state.id] = partition;
  }
  return partitionByState;
}

function samePartitions(
  left: readonly number[],
  right: readonly number[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
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
