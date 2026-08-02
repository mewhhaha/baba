// Core Wasm lexer runtime byte emitter shared by Wasm target packaging.
import { ASCII_CLASS_LIMIT, type Dfa } from "../../compiler/regex/dfa.ts";
import {
  WASM_MAX_PAGES as MAX_WASM_PAGES,
  WASM_PAGE_BYTES as PAGE_SIZE,
} from "./wasm_abi.ts";
import {
  PARSER_PLAN_VERSION,
  WASM_CORE_PLAN_FORMAT_VERSION,
  WASM_CORE_PLAN_MAGIC,
} from "./parser_plan_contract.ts";
import { wasmCoreRuntimeBytes } from "./wasm_core_runtime_bytes.ts";

export interface WasmModuleImage {
  bytes: Uint8Array;
  planBytes: Uint8Array;
  inputBase: number;
}

interface PlanDataLayout {
  fastSpecs: number;
  asciiTransitions: number | null;
  transitionRows: number;
  transitions: number;
  acceptCandidateRows: number;
  acceptCandidates: number;
  specFlags: number;
  specFollowStarts: number;
  specNotFollowStarts: number;
  guardAccepts: number;
  guardTransitionRows: number;
  guardTransitions: number;
  specWordRows: number;
  wordRows: number;
  wordCodePoints: number;
  alphabetAsciiClasses: number;
  alphabetRanges: number;
  inputBase: number;
  bytes: Uint8Array;
}

export interface WasmCoreRuntimeMetadata {
  readonly acceptCandidates: readonly (readonly number[])[];
  readonly specs: readonly WasmCoreLexerSpecMetadata[];
}

export interface WasmCoreLexerSpecMetadata {
  readonly contextual: boolean;
  readonly followedBy: Dfa | undefined;
  readonly followedByEof: boolean;
  readonly notFollowedBy: Dfa | undefined;
  readonly excludedWords: readonly string[];
}

const PLAN_HEADER_I32_COUNT = 36;
const PLAN_HEADER_BYTES = PLAN_HEADER_I32_COUNT * 4;
const COMPACT_I16_OFFSET_TAG = 2;

export function emitWasmModule(
  dfa: Dfa,
  metadata: WasmCoreRuntimeMetadata = {
    acceptCandidates: [],
    specs: [],
  },
): WasmModuleImage {
  const layout = buildPlanDataLayout(dfa, metadata);
  const bytes = emitGenericWasmModule();
  const inputBase = align(layout.bytes.length, 8);
  const initialPages = Math.max(1, Math.ceil(inputBase / PAGE_SIZE));
  if (initialPages > MAX_WASM_PAGES) {
    throw new Error(
      `Wasm external plan needs ${initialPages} pages, exceeding the maximum ${MAX_WASM_PAGES}.`,
    );
  }
  return {
    bytes,
    planBytes: layout.bytes,
    inputBase,
  };
}

function emitGenericWasmModule(): Uint8Array {
  return wasmCoreRuntimeBytes();
}

function buildPlanDataLayout(
  dfa: Dfa,
  metadata: WasmCoreRuntimeMetadata,
): PlanDataLayout {
  const data = new Array(PLAN_HEADER_BYTES).fill(0);
  const appendI32s = (values: readonly number[]): number => {
    const offset = data.length;
    for (const value of values) {
      data.push(value & 0xff);
      data.push((value >>> 8) & 0xff);
      data.push((value >>> 16) & 0xff);
      data.push((value >>> 24) & 0xff);
    }
    return offset;
  };
  const appendI16s = (values: readonly number[]): number => {
    const offset = data.length;
    for (const value of values) {
      if (value < -32_768 || value > 32_767) {
        throw new Error(
          `Wasm lexer table i16 value ${value} is out of range.`,
        );
      }
      data.push(value & 0xff);
      data.push((value >>> 8) & 0xff);
    }
    while (data.length % 4 !== 0) {
      data.push(0);
    }
    return offset;
  };
  const fastSpecs: number[] = [];
  for (const state of dfa.states) {
    const configuredCandidates = metadata.acceptCandidates[state.id];
    let candidate = -1;
    if (
      configuredCandidates !== undefined &&
      configuredCandidates.length === 1
    ) {
      const configuredCandidate = configuredCandidates[0];
      if (configuredCandidate === undefined) {
        throw new Error(
          `Wasm core metadata accept candidate for DFA state ${state.id} is missing.`,
        );
      }
      candidate = configuredCandidate;
    } else if (
      (
        configuredCandidates === undefined ||
        configuredCandidates.length === 0
      ) &&
      state.selectedAccept !== undefined &&
      state.selectedAccept !== null
    ) {
      candidate = state.selectedAccept;
    }
    if (candidate < 0) {
      fastSpecs.push(-1);
      continue;
    }
    const spec = metadata.specs[candidate];
    if (spec === undefined) {
      throw new Error(
        `Wasm core metadata accept candidate ${candidate} for DFA state ${state.id} is missing its lexer spec.`,
      );
    }
    if (
      spec.followedBy !== undefined ||
      spec.followedByEof ||
      spec.notFollowedBy !== undefined ||
      spec.excludedWords.length !== 0
    ) {
      fastSpecs.push(-1);
      continue;
    }
    fastSpecs.push(candidate);
  }
  const fastSpecsOffset = appendI32s(fastSpecs);
  const asciiTransitions = buildAsciiTransitions(dfa);
  let asciiTransitionsOffset: number | null = null;
  let encodedAsciiTransitionsOffset = -1;
  if (asciiTransitions !== null) {
    if (asciiTransitions.cellBytes === 2) {
      asciiTransitionsOffset = appendI16s(asciiTransitions.values);
      encodedAsciiTransitionsOffset = encodeI16Offset(asciiTransitionsOffset);
    } else {
      asciiTransitionsOffset = appendI32s(asciiTransitions.values);
      encodedAsciiTransitionsOffset = asciiTransitionsOffset;
    }
  }
  const transitionRows: number[] = [];
  const transitions: number[] = [];
  for (const state of dfa.states) {
    transitionRows.push(transitions.length / 3);
    for (const transition of state.transitions) {
      let start = transition.start;
      if (asciiTransitions !== null) {
        if (transition.end < ASCII_CLASS_LIMIT) {
          continue;
        }
        if (start < ASCII_CLASS_LIMIT) {
          start = ASCII_CLASS_LIMIT;
        }
      }
      transitions.push(start, transition.end, transition.target);
    }
  }
  transitionRows.push(transitions.length / 3);
  const transitionRowsOffset = appendI32s(transitionRows);
  const transitionsOffset = appendI32s(transitions);

  const acceptCandidateRows: number[] = [];
  const acceptCandidates: number[] = [];
  for (const state of dfa.states) {
    acceptCandidateRows.push(acceptCandidates.length);
    const candidates = metadata.acceptCandidates[state.id];
    if (candidates !== undefined && candidates.length > 0) {
      for (const candidate of candidates) {
        acceptCandidates.push(candidate);
      }
      continue;
    }
    if (state.selectedAccept !== undefined && state.selectedAccept !== null) {
      acceptCandidates.push(state.selectedAccept);
    }
  }
  acceptCandidateRows.push(acceptCandidates.length);
  const acceptCandidateRowsOffset = appendI32s(acceptCandidateRows);
  const acceptCandidatesOffset = appendI32s(acceptCandidates);
  const specFlags: number[] = [];
  const specFollowStarts: number[] = [];
  const specNotFollowStarts: number[] = [];
  const guardAccepts: number[] = [];
  const guardTransitionRows: number[] = [];
  const guardTransitions: number[] = [];
  const appendGuardDfa = (guard: Dfa | undefined): number => {
    if (guard === undefined) {
      return -1;
    }
    const stateBase = guardAccepts.length;
    for (const state of guard.states) {
      let accepts = 1;
      if (state.selectedAccept === null) {
        accepts = 0;
      }
      guardAccepts.push(accepts);
      guardTransitionRows.push(guardTransitions.length / 3);
      for (const transition of state.transitions) {
        guardTransitions.push(
          transition.start,
          transition.end,
          stateBase + transition.target,
        );
      }
    }
    return stateBase + guard.start;
  };
  const specWordRows: number[] = [];
  const wordRows: number[] = [];
  const wordCodePoints: number[] = [];
  for (
    let specIndex = 0;
    specIndex < metadata.specs.length;
    specIndex++
  ) {
    const spec = metadata.specs[specIndex];
    if (spec === undefined) {
      throw new Error(`Wasm core metadata lexer spec ${specIndex} is missing.`);
    }
    let flags = 0;
    if (spec.contextual) {
      flags |= 1;
    }
    if (spec.followedByEof) {
      flags |= 2;
    }
    if (spec.followedBy !== undefined) {
      flags |= 4;
    }
    specFlags.push(flags);
    specFollowStarts.push(appendGuardDfa(spec.followedBy));
    specNotFollowStarts.push(appendGuardDfa(spec.notFollowedBy));
    specWordRows.push(wordRows.length);
    for (const word of spec.excludedWords) {
      wordRows.push(wordCodePoints.length);
      for (const character of word) {
        const codePoint = character.codePointAt(0);
        if (codePoint === undefined) {
          throw new Error(
            `Missing code point in excluded word ${JSON.stringify(word)}.`,
          );
        }
        wordCodePoints.push(codePoint);
      }
    }
  }
  guardTransitionRows.push(guardTransitions.length / 3);
  specWordRows.push(wordRows.length);
  wordRows.push(wordCodePoints.length);
  const specFlagsOffset = appendI32s(specFlags);
  const specFollowStartsOffset = appendI32s(specFollowStarts);
  const specNotFollowStartsOffset = appendI32s(specNotFollowStarts);
  const guardAcceptsOffset = appendI32s(guardAccepts);
  const guardTransitionRowsOffset = appendI32s(guardTransitionRows);
  const guardTransitionsOffset = appendI32s(guardTransitions);
  const specWordRowsOffset = appendI32s(specWordRows);
  const wordRowsOffset = appendI32s(wordRows);
  const wordCodePointsOffset = appendI32s(wordCodePoints);

  const alphabet = dfa.alphabet;
  if (alphabet.asciiClasses.length !== ASCII_CLASS_LIMIT) {
    throw new Error(
      `Wasm core plan alphabet ASCII table has ${alphabet.asciiClasses.length} entries, expected ${ASCII_CLASS_LIMIT}.`,
    );
  }
  if (alphabet.classCount < 1) {
    throw new Error(
      `Wasm core plan alphabet has ${alphabet.classCount} equivalence classes.`,
    );
  }
  const alphabetAsciiClassesOffset = appendI32s(alphabet.asciiClasses);
  const alphabetRangeValues: number[] = [];
  for (const range of alphabet.aboveAsciiRanges) {
    alphabetRangeValues.push(range.start, range.end, range.classId);
  }
  const alphabetRangesOffset = appendI32s(alphabetRangeValues);

  if (dfa.start < 0 || dfa.start >= dfa.states.length) {
    throw new Error(
      `Wasm core plan DFA start state ${dfa.start} is outside [0, ${dfa.states.length}).`,
    );
  }

  const bytes = Uint8Array.from(data);
  const header = [
    WASM_CORE_PLAN_MAGIC,
    WASM_CORE_PLAN_FORMAT_VERSION,
    PARSER_PLAN_VERSION,
    dfa.states.length,
    0,
    fastSpecsOffset,
    encodedAsciiTransitionsOffset,
    transitionRowsOffset,
    transitionsOffset,
    0,
    0,
    0,
    0,
    bytes.length,
    metadata.specs.length,
    -1,
    0,
    acceptCandidateRowsOffset,
    acceptCandidatesOffset,
    0,
    0,
    specFlagsOffset,
    specFollowStartsOffset,
    specNotFollowStartsOffset,
    guardAccepts.length,
    guardAcceptsOffset,
    guardTransitionRowsOffset,
    guardTransitionsOffset,
    specWordRowsOffset,
    wordRowsOffset,
    wordCodePointsOffset,
    dfa.start,
    alphabet.classCount,
    alphabetAsciiClassesOffset,
    alphabet.aboveAsciiRanges.length,
    alphabetRangesOffset,
  ];
  writeHeader(bytes, header);

  return {
    fastSpecs: fastSpecsOffset,
    asciiTransitions: asciiTransitionsOffset,
    transitionRows: transitionRowsOffset,
    transitions: transitionsOffset,
    acceptCandidateRows: acceptCandidateRowsOffset,
    acceptCandidates: acceptCandidatesOffset,
    specFlags: specFlagsOffset,
    specFollowStarts: specFollowStartsOffset,
    specNotFollowStarts: specNotFollowStartsOffset,
    guardAccepts: guardAcceptsOffset,
    guardTransitionRows: guardTransitionRowsOffset,
    guardTransitions: guardTransitionsOffset,
    specWordRows: specWordRowsOffset,
    wordRows: wordRowsOffset,
    wordCodePoints: wordCodePointsOffset,
    alphabetAsciiClasses: alphabetAsciiClassesOffset,
    alphabetRanges: alphabetRangesOffset,
    inputBase: align(bytes.length, 8),
    bytes,
  };
}

function writeHeader(bytes: Uint8Array, values: readonly number[]): void {
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setInt32(index * 4, value, true));
}

function encodeI16Offset(offset: number): number {
  if (offset < PLAN_HEADER_BYTES) {
    throw new Error("Wasm parser compact section offset is invalid.");
  }
  return -(offset + COMPACT_I16_OFFSET_TAG);
}

function buildAsciiTransitions(
  dfa: Dfa,
): { readonly values: number[]; readonly cellBytes: 2 | 4 } | null {
  const cellCount = dfa.states.length * 128;
  if (cellCount > 131_072) return null;
  const table = new Array(cellCount).fill(-1);
  for (const state of dfa.states) {
    const base = state.id * 128;
    for (const transition of state.transitions) {
      const start = Math.max(0, transition.start);
      const end = Math.min(127, transition.end);
      for (let codePoint = start; codePoint <= end; codePoint++) {
        table[base + codePoint] = transition.target;
      }
    }
  }
  if (dfa.states.length <= 32_767) {
    return { values: table, cellBytes: 2 };
  }
  return { values: table, cellBytes: 4 };
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}
