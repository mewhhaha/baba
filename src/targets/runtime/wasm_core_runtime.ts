// Core Wasm parser runtime byte emitter shared by Wasm target packaging.
import { ASCII_CLASS_LIMIT, type Dfa } from "../../compiler/regex/dfa.ts";
import type {
  LrAction,
  LrActionSet,
  LrTable,
} from "../../compiler/runtime_plan/lr1.ts";
import {
  WASM_ACTION_ACCEPT as ACTION_ACCEPT,
  WASM_ACTION_PAYLOAD_MASK as RUNTIME_ACTION_PAYLOAD_MASK,
  WASM_ACTION_REDUCE as ACTION_REDUCE,
  WASM_ACTION_SHIFT as ACTION_SHIFT,
  WASM_MAX_PAGES as MAX_WASM_PAGES,
  WASM_PAGE_BYTES as PAGE_SIZE,
} from "./wasm_abi.ts";
import { wasmCoreRuntimeBytes } from "./wasm_core_runtime_bytes.ts";

export interface WasmModuleImage {
  bytes: Uint8Array;
  planBytes: Uint8Array;
  inputBase: number;
}

interface PlanDataLayout {
  accepts: number;
  asciiTransitions: number | null;
  transitionRows: number;
  transitions: number;
  actionRows: number;
  actionPairs: number;
  gotoRows: number;
  gotoPairs: number;
  specTerminals: number;
  acceptCandidateRows: number;
  acceptCandidates: number;
  productions: number;
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
  readonly eofTerminal: number;
  readonly terminalBySpec: readonly number[];
  readonly acceptCandidates: readonly (readonly number[])[];
  readonly specs: readonly WasmCoreLexerSpecMetadata[];
  readonly productions: readonly {
    readonly lhs: number;
    readonly rhsLength: number;
    readonly reducerKind: number;
    readonly reducerArg: number;
  }[];
}

export interface WasmCoreLexerSpecMetadata {
  readonly contextual: boolean;
  readonly followedBy: Dfa | undefined;
  readonly followedByEof: boolean;
  readonly notFollowedBy: Dfa | undefined;
  readonly excludedWords: readonly string[];
}

const PLAN_MAGIC = 0x31505742;
const PLAN_FORMAT_VERSION = 4;
const PLAN_HEADER_I32_COUNT = 36;
const PLAN_HEADER_BYTES = PLAN_HEADER_I32_COUNT * 4;
const COMPACT_I16_OFFSET_TAG = 2;
const COMPACT_U16_OFFSET_BASE = 0x4000_0000;

export function emitWasmModule(
  dfa: Dfa,
  lr: LrTable,
  parserPlanVersion = 2,
  metadata: WasmCoreRuntimeMetadata = {
    eofTerminal: -1,
    terminalBySpec: [],
    acceptCandidates: [],
    specs: [],
    productions: [],
  },
): WasmModuleImage {
  const layout = buildPlanDataLayout(dfa, lr, parserPlanVersion, metadata);
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
  lr: LrTable,
  parserPlanVersion: number,
  metadata: WasmCoreRuntimeMetadata,
): PlanDataLayout {
  if (metadata.specs.length !== metadata.terminalBySpec.length) {
    throw new Error(
      `Wasm core metadata has ${metadata.specs.length} lexer specs for ${metadata.terminalBySpec.length} terminal mappings.`,
    );
  }
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
          `Wasm parser table i16 value ${value} is out of range.`,
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
  const appendU16s = (values: readonly number[]): number => {
    const offset = data.length;
    for (const value of values) {
      if (value < 0 || value > 65_535) {
        throw new Error(
          `Wasm parser table u16 value ${value} is out of range.`,
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

  const accepts = appendI32s(
    dfa.states.map((state) => state.selectedAccept ?? -1),
  );
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
      transitions.push(transition.start, transition.end, transition.target);
    }
  }
  transitionRows.push(transitions.length / 3);
  const transitionRowsOffset = appendI32s(transitionRows);
  const transitionsOffset = appendI32s(transitions);

  const actionRows: number[] = [];
  const actionPairs: number[] = [];
  for (let state = 0; state < lr.states.length; state++) {
    actionRows.push(actionPairs.length / 2);
    const row = lr.actions.get(state);
    for (const [terminal, action] of sortedActionEntries(row)) {
      actionPairs.push(terminal, encodeAction(action));
    }
  }
  actionRows.push(actionPairs.length / 2);
  let actionRowsOffset = 0;
  let actionPairsOffset = 0;
  let encodedActionRowsOffset = 0;
  let encodedActionPairsOffset = 0;
  const compactActionPairs = compactActionPairValues(actionPairs);
  if (canStoreU16(actionRows) && compactActionPairs !== null) {
    actionRowsOffset = appendU16s(actionRows);
    actionPairsOffset = appendU16s(compactActionPairs);
    encodedActionRowsOffset = encodeU16Offset(actionRowsOffset);
    encodedActionPairsOffset = encodeU16Offset(actionPairsOffset);
  } else {
    actionRowsOffset = appendI32s(actionRows);
    actionPairsOffset = appendI32s(actionPairs);
    encodedActionRowsOffset = actionRowsOffset;
    encodedActionPairsOffset = actionPairsOffset;
  }

  const gotoRows: number[] = [];
  const gotoPairs: number[] = [];
  for (let state = 0; state < lr.states.length; state++) {
    gotoRows.push(gotoPairs.length / 2);
    const row = lr.gotos.get(state);
    for (const [nonterminal, target] of sortedNumberEntries(row)) {
      gotoPairs.push(nonterminal, target);
    }
  }
  gotoRows.push(gotoPairs.length / 2);
  let gotoRowsOffset = 0;
  let gotoPairsOffset = 0;
  let encodedGotoRowsOffset = 0;
  let encodedGotoPairsOffset = 0;
  if (canStoreU16(gotoRows) && canStoreU16(gotoPairs)) {
    gotoRowsOffset = appendU16s(gotoRows);
    gotoPairsOffset = appendU16s(gotoPairs);
    encodedGotoRowsOffset = encodeU16Offset(gotoRowsOffset);
    encodedGotoPairsOffset = encodeU16Offset(gotoPairsOffset);
  } else {
    gotoRowsOffset = appendI32s(gotoRows);
    gotoPairsOffset = appendI32s(gotoPairs);
    encodedGotoRowsOffset = gotoRowsOffset;
    encodedGotoPairsOffset = gotoPairsOffset;
  }

  const specTerminalsOffset = appendI32s(metadata.terminalBySpec);
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
  const productionPairs: number[] = [];
  for (let index = 0; index < metadata.productions.length; index++) {
    const production = metadata.productions[index];
    if (production === undefined) {
      throw new Error("Wasm core metadata production row is missing.");
    }
    productionPairs.push(
      production.lhs,
      production.rhsLength,
      production.reducerKind,
      production.reducerArg,
    );
  }
  const productionsOffset = appendI32s(productionPairs);

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
    specIndex < metadata.terminalBySpec.length;
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
    PLAN_MAGIC,
    PLAN_FORMAT_VERSION,
    parserPlanVersion,
    dfa.states.length,
    lr.states.length,
    accepts,
    encodedAsciiTransitionsOffset,
    transitionRowsOffset,
    transitionsOffset,
    encodedActionRowsOffset,
    encodedActionPairsOffset,
    encodedGotoRowsOffset,
    encodedGotoPairsOffset,
    bytes.length,
    metadata.terminalBySpec.length,
    metadata.eofTerminal,
    specTerminalsOffset,
    acceptCandidateRowsOffset,
    acceptCandidatesOffset,
    metadata.productions.length,
    productionsOffset,
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
    accepts,
    asciiTransitions: asciiTransitionsOffset,
    transitionRows: transitionRowsOffset,
    transitions: transitionsOffset,
    actionRows: actionRowsOffset,
    actionPairs: actionPairsOffset,
    gotoRows: gotoRowsOffset,
    gotoPairs: gotoPairsOffset,
    specTerminals: specTerminalsOffset,
    acceptCandidateRows: acceptCandidateRowsOffset,
    acceptCandidates: acceptCandidatesOffset,
    productions: productionsOffset,
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

function sortedActionEntries(
  row: ReadonlyMap<number, LrActionSet> | undefined,
): Array<[number, LrAction]> {
  return [...(row?.entries() ?? [])]
    .sort((left, right) => left[0] - right[0])
    .flatMap(([terminal, actions]) =>
      actions.map((action) => [terminal, action] as [number, LrAction])
    );
}

function sortedNumberEntries(
  row: ReadonlyMap<number, number> | undefined,
): Array<[number, number]> {
  return [...(row?.entries() ?? [])].sort((left, right) => left[0] - right[0]);
}

function encodeAction(action: LrAction | number): number {
  if (typeof action === "number") return action;
  if (action.kind === "shift") return encodePayload(ACTION_SHIFT, action.state);
  if (action.kind === "reduce") {
    return encodePayload(ACTION_REDUCE, action.production);
  }
  return ACTION_ACCEPT;
}

function encodePayload(kind: number, payload: number): number {
  if (payload < 0 || payload > RUNTIME_ACTION_PAYLOAD_MASK) {
    throw new Error(`Wasm parser table payload ${payload} exceeds 24 bits.`);
  }
  return kind | payload;
}

function encodeI16Offset(offset: number): number {
  if (offset < PLAN_HEADER_BYTES) {
    throw new Error("Wasm parser compact section offset is invalid.");
  }
  return -(offset + COMPACT_I16_OFFSET_TAG);
}

function encodeU16Offset(offset: number): number {
  if (offset < PLAN_HEADER_BYTES) {
    throw new Error("Wasm parser compact section offset is invalid.");
  }
  if (offset >= COMPACT_U16_OFFSET_BASE) {
    throw new Error("Wasm parser compact section offset is too large.");
  }
  return -(offset + COMPACT_U16_OFFSET_BASE);
}

function canStoreU16(values: readonly number[]): boolean {
  for (const value of values) {
    if (value < 0 || value > 65_535) {
      return false;
    }
  }
  return true;
}

function compactActionPairValues(
  values: readonly number[],
): number[] | null {
  const compact: number[] = [];
  for (let index = 0; index < values.length; index += 2) {
    const terminal = values[index];
    const action = values[index + 1];
    if (terminal === undefined || action === undefined) {
      throw new Error("Wasm parser action pairs are malformed.");
    }
    if (terminal < 0 || terminal > 65_535) {
      return null;
    }
    const compactAction = compactActionValue(action);
    if (compactAction === null) {
      return null;
    }
    compact.push(terminal, compactAction);
  }
  return compact;
}

function compactActionValue(action: number): number | null {
  const kind = action & 0xff000000;
  const payload = action & RUNTIME_ACTION_PAYLOAD_MASK;
  let compactKind = 0;
  if (kind === ACTION_SHIFT) {
    compactKind = 1;
  } else if (kind === ACTION_REDUCE) {
    compactKind = 2;
  } else if (kind === ACTION_ACCEPT) {
    compactKind = 3;
  } else {
    return null;
  }
  if (payload > 0x3fff) {
    return null;
  }
  return (compactKind << 14) | payload;
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
