// Core Wasm parser runtime byte emitter shared by Wasm target packaging.
import type { Dfa } from "../../compiler/regex/dfa.ts";
import type {
  LrAction,
  LrActionSet,
  LrTable,
} from "../../compiler/runtime_plan/lr1.ts";
import {
  RUNTIME_ACTION_ACCEPT as ACTION_ACCEPT,
  RUNTIME_ACTION_PAYLOAD_MASK,
  RUNTIME_ACTION_REDUCE as ACTION_REDUCE,
  RUNTIME_ACTION_SHIFT as ACTION_SHIFT,
} from "./language_sources.ts";
import { RUNTIME_IMPLEMENTATION_VERSION } from "./implementation.ts";
import {
  WASM_ABI_VERSION,
  WASM_HOST_OWNERSHIP_CALLER_MANAGED,
  WASM_LEX_RESULT_I32_COUNT as LEX_RESULT_I32_COUNT,
  WASM_MAX_PAGES as MAX_WASM_PAGES,
  WASM_PAGE_BYTES as PAGE_SIZE,
  WASM_RESULT_LIFETIME_CALLER_BUFFER,
  WASM_SOURCE_ENCODING_UTF16,
  WASM_SPAN_UNIT_UTF16,
  WASM_TOKEN_RECORD_I32_COUNT as TOKEN_RECORD_I32_COUNT,
} from "./wasm_abi.ts";

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
  inputBase: number;
  bytes: Uint8Array;
}

const I32 = 0x7f;
const FUNC = 0x60;
const EMPTY_BLOCK = 0x40;
const PLAN_MAGIC = 0x31505742;
const PLAN_FORMAT_VERSION = 1;
const PLAN_HEADER_MAGIC = 0;
const PLAN_HEADER_FORMAT_VERSION = 1;
const PLAN_HEADER_PARSER_PLAN_VERSION = 2;
const PLAN_HEADER_DFA_STATE_COUNT = 3;
const PLAN_HEADER_PARSER_STATE_COUNT = 4;
const PLAN_HEADER_ACCEPTS = 5;
const PLAN_HEADER_ASCII_TRANSITIONS = 6;
const PLAN_HEADER_TRANSITION_ROWS = 7;
const PLAN_HEADER_TRANSITIONS = 8;
const PLAN_HEADER_ACTION_ROWS = 9;
const PLAN_HEADER_ACTION_PAIRS = 10;
const PLAN_HEADER_GOTO_ROWS = 11;
const PLAN_HEADER_GOTO_PAIRS = 12;
const PLAN_HEADER_BYTE_LENGTH = 13;
const PLAN_HEADER_I32_COUNT = 14;
const PLAN_HEADER_BYTES = PLAN_HEADER_I32_COUNT * 4;

export function emitWasmModule(
  dfa: Dfa,
  lr: LrTable,
  parserPlanVersion = 1,
): WasmModuleImage {
  const layout = buildPlanDataLayout(dfa, lr, parserPlanVersion);
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
  const sections = [
    section(1, typeSection()),
    section(3, functionSection()),
    section(5, memorySection(1)),
    section(7, exportSection()),
    section(10, codeSection()),
  ];
  return Uint8Array.from([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    ...sections.flat(),
  ]);
}

function buildPlanDataLayout(
  dfa: Dfa,
  lr: LrTable,
  parserPlanVersion: number,
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

  const accepts = appendI32s(
    dfa.states.map((state) => state.selectedAccept ?? -1),
  );
  const asciiTransitions = buildAsciiTransitions(dfa);
  const asciiTransitionsOffset = asciiTransitions
    ? appendI32s(asciiTransitions)
    : null;
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
  const actionRowsOffset = appendI32s(actionRows);
  const actionPairsOffset = appendI32s(actionPairs);

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
  const gotoRowsOffset = appendI32s(gotoRows);
  const gotoPairsOffset = appendI32s(gotoPairs);

  const bytes = Uint8Array.from(data);
  const header = [
    PLAN_MAGIC,
    PLAN_FORMAT_VERSION,
    parserPlanVersion,
    dfa.states.length,
    lr.states.length,
    accepts,
    asciiTransitionsOffset === null ? -1 : asciiTransitionsOffset,
    transitionRowsOffset,
    transitionsOffset,
    actionRowsOffset,
    actionPairsOffset,
    gotoRowsOffset,
    gotoPairsOffset,
    bytes.length,
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

function buildAsciiTransitions(dfa: Dfa): number[] | null {
  const cellCount = dfa.states.length * 128;
  if (cellCount > 65_536) return null;
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
  return table;
}

function typeSection(): number[] {
  return vec([
    [
      FUNC,
      ...vec([I32, I32]),
      ...vec([I32]),
    ],
    [
      FUNC,
      ...vec([I32, I32, I32, I32]),
      ...vec([I32]),
    ],
    [
      FUNC,
      ...vec([]),
      ...vec([I32]),
    ],
    [
      FUNC,
      ...vec([]),
      ...vec([]),
    ],
  ]);
}

function functionSection(): number[] {
  return vec([
    u32(0),
    u32(1),
    u32(0),
    u32(0),
    u32(1),
    u32(0),
    u32(2),
    u32(2),
    u32(2),
    u32(3),
    u32(2),
    u32(2),
    u32(2),
    u32(2),
    u32(2),
    u32(2),
    u32(2),
    u32(2),
  ]);
}

function memorySection(initialPages: number): number[] {
  return vec([[0x01, ...u32(initialPages), ...u32(MAX_WASM_PAGES)]]);
}

function exportSection(): number[] {
  return vec([
    exportEntry("memory", 0x02, 0),
    exportEntry("lex_one", 0x00, 1),
    exportEntry("parser_action", 0x00, 2),
    exportEntry("parser_goto", 0x00, 3),
    exportEntry("lex_all", 0x00, 4),
    exportEntry("load_plan", 0x00, 5),
    exportEntry("abi_version", 0x00, 6),
    exportEntry("plan_version", 0x00, 7),
    exportEntry("semantics_version", 0x00, 8),
    exportEntry("reset", 0x00, 9),
    exportEntry("input_base", 0x00, 10),
    exportEntry("max_pages", 0x00, 11),
    exportEntry("source_encoding", 0x00, 12),
    exportEntry("span_unit", 0x00, 13),
    exportEntry("lex_result_i32_count", 0x00, 14),
    exportEntry("token_record_i32_count", 0x00, 15),
    exportEntry("host_ownership_model", 0x00, 16),
    exportEntry("result_lifetime_model", 0x00, 17),
  ]);
}

function codeSection(): number[] {
  return vec([
    functionBody(4, transitionFunction()),
    functionBody(10, lexOneFunction()),
    functionBody(
      3,
      tableLookupFunction({
        rowsHeader: PLAN_HEADER_ACTION_ROWS,
        pairsHeader: PLAN_HEADER_ACTION_PAIRS,
        stateCountHeader: PLAN_HEADER_PARSER_STATE_COUNT,
        missing: 0,
      }),
    ),
    functionBody(
      3,
      tableLookupFunction({
        rowsHeader: PLAN_HEADER_GOTO_ROWS,
        pairsHeader: PLAN_HEADER_GOTO_PAIRS,
        stateCountHeader: PLAN_HEADER_PARSER_STATE_COUNT,
        missing: -1,
      }),
    ),
    functionBody(15, lexAllFunction()),
    functionBody(0, loadPlanFunction()),
    functionBody(0, versionFunction(WASM_ABI_VERSION)),
    functionBody(0, planVersionFunction()),
    functionBody(0, versionFunction(RUNTIME_IMPLEMENTATION_VERSION)),
    functionBody(0, resetFunction()),
    functionBody(0, inputBaseFunction()),
    functionBody(0, versionFunction(MAX_WASM_PAGES)),
    functionBody(0, versionFunction(WASM_SOURCE_ENCODING_UTF16)),
    functionBody(0, versionFunction(WASM_SPAN_UNIT_UTF16)),
    functionBody(0, versionFunction(LEX_RESULT_I32_COUNT)),
    functionBody(0, versionFunction(TOKEN_RECORD_I32_COUNT)),
    functionBody(0, versionFunction(WASM_HOST_OWNERSHIP_CALLER_MANAGED)),
    functionBody(0, versionFunction(WASM_RESULT_LIFETIME_CALLER_BUFFER)),
  ]);
}

function versionFunction(version: number): number[] {
  return i32(version);
}

function planVersionFunction(): number[] {
  return loadHeaderValue(PLAN_HEADER_PARSER_PLAN_VERSION);
}

function inputBaseFunction(): number[] {
  return [
    ...loadHeaderValue(PLAN_HEADER_BYTE_LENGTH),
    ...i32(7),
    0x6a,
    ...i32(-8),
    0x71,
  ];
}

function resetFunction(): number[] {
  return [];
}

function loadPlanFunction(): number[] {
  const ptr = 0;
  const len = 1;
  return [
    ...get(ptr),
    ...i32(0),
    0x47,
    ...returnIfTrue(0),
    ...get(len),
    ...i32(PLAN_HEADER_BYTES),
    0x49,
    ...returnIfTrue(0),
    ...loadHeaderValue(PLAN_HEADER_MAGIC),
    ...i32(PLAN_MAGIC),
    0x47,
    ...returnIfTrue(0),
    ...loadHeaderValue(PLAN_HEADER_FORMAT_VERSION),
    ...i32(PLAN_FORMAT_VERSION),
    0x47,
    ...returnIfTrue(0),
    ...loadHeaderValue(PLAN_HEADER_BYTE_LENGTH),
    ...get(len),
    0x4b,
    ...returnIfTrue(0),
    ...i32(1),
  ];
}

function returnIfTrue(value: number): number[] {
  return [
    0x04,
    EMPTY_BLOCK,
    ...i32(value),
    0x0f,
    0x0b,
  ];
}

function transitionFunction(): number[] {
  const state = 0;
  const codePoint = 1;
  const index = 2;
  const end = 3;
  const base = 4;
  const asciiOffset = 5;
  return [
    ...get(state),
    ...loadHeaderValue(PLAN_HEADER_DFA_STATE_COUNT),
    0x4f,
    0x04,
    EMPTY_BLOCK,
    ...i32(-1),
    0x0f,
    0x0b,

    ...get(codePoint),
    ...i32(128),
    0x49,
    0x04,
    EMPTY_BLOCK,
    ...loadHeaderValue(PLAN_HEADER_ASCII_TRANSITIONS),
    ...set(asciiOffset),
    ...get(asciiOffset),
    ...i32(0),
    0x4e,
    0x04,
    EMPTY_BLOCK,
    ...loadAsciiTransition(asciiOffset, state, codePoint),
    ...set(base),
    ...get(base),
    ...i32(0),
    0x4e,
    0x04,
    EMPTY_BLOCK,
    ...get(base),
    0x0f,
    0x0b,
    0x0b,
    0x0b,

    ...loadHeaderValue(PLAN_HEADER_TRANSITION_ROWS),
    ...set(base),
    ...loadTableValueFromLocal(base, state),
    ...set(index),
    ...loadTableValuePlusOneFromLocal(base, state),
    ...set(end),

    0x02,
    EMPTY_BLOCK,
    0x03,
    EMPTY_BLOCK,
    ...get(index),
    ...get(end),
    0x4f,
    0x0d,
    ...u32(1),

    ...loadHeaderValue(PLAN_HEADER_TRANSITIONS),
    ...get(index),
    ...i32(12),
    0x6c,
    0x6a,
    ...set(base),

    ...get(codePoint),
    ...get(base),
    ...load32(),
    0x4f,
    0x04,
    EMPTY_BLOCK,
    ...get(codePoint),
    ...get(base),
    ...i32(4),
    0x6a,
    ...load32(),
    0x4d,
    0x04,
    EMPTY_BLOCK,
    ...get(base),
    ...i32(8),
    0x6a,
    ...load32(),
    0x0f,
    0x0b,
    0x0b,

    ...get(index),
    ...i32(1),
    0x6a,
    ...set(index),
    0x0c,
    ...u32(0),
    0x0b,
    0x0b,

    ...i32(-1),
  ];
}

function lexOneFunction(): number[] {
  const src = 0;
  const len = 1;
  const offset = 2;
  const result = 3;
  const state = 4;
  const index = 5;
  const bestSpec = 6;
  const bestEnd = 7;
  const unit = 8;
  const nextUnit = 9;
  const codePoint = 10;
  const width = 11;
  const target = 12;
  const accept = 13;
  return [
    ...i32(0),
    ...set(state),
    ...get(offset),
    ...set(index),
    ...i32(-1),
    ...set(bestSpec),
    ...get(offset),
    ...set(bestEnd),

    0x02,
    EMPTY_BLOCK,
    0x03,
    EMPTY_BLOCK,
    ...get(index),
    ...get(len),
    0x4f,
    0x0d,
    ...u32(1),

    ...loadUtf16(src, index),
    ...set(unit),
    ...get(unit),
    ...set(codePoint),
    ...i32(1),
    ...set(width),

    ...get(unit),
    ...i32(0xd800),
    0x4f,
    0x04,
    EMPTY_BLOCK,
    ...get(unit),
    ...i32(0xdbff),
    0x4d,
    0x04,
    EMPTY_BLOCK,
    ...get(index),
    ...i32(1),
    0x6a,
    ...get(len),
    0x49,
    0x04,
    EMPTY_BLOCK,
    ...loadUtf16AtIndexPlusOne(src, index),
    ...set(nextUnit),
    ...get(nextUnit),
    ...i32(0xdc00),
    0x4f,
    0x04,
    EMPTY_BLOCK,
    ...get(nextUnit),
    ...i32(0xdfff),
    0x4d,
    0x04,
    EMPTY_BLOCK,
    ...get(unit),
    ...i32(0xd800),
    0x6b,
    ...i32(10),
    0x74,
    ...get(nextUnit),
    ...i32(0xdc00),
    0x6b,
    0x6a,
    ...i32(0x1_00_00),
    0x6a,
    ...set(codePoint),
    ...i32(2),
    ...set(width),
    0x0b,
    0x0b,
    0x0b,
    0x0b,
    0x0b,

    ...get(state),
    ...get(codePoint),
    0x10,
    ...u32(0),
    ...set(target),
    ...get(target),
    ...i32(0),
    0x48,
    0x0d,
    ...u32(1),

    ...get(index),
    ...get(width),
    0x6a,
    ...set(index),
    ...get(target),
    ...set(state),

    ...loadTableValueFromHeader(PLAN_HEADER_ACCEPTS, state),
    ...set(accept),
    ...get(accept),
    ...i32(0),
    0x4e,
    0x04,
    EMPTY_BLOCK,
    ...get(accept),
    ...set(bestSpec),
    ...get(index),
    ...set(bestEnd),
    0x0b,

    0x0c,
    ...u32(0),
    0x0b,
    0x0b,

    ...get(bestSpec),
    ...i32(0),
    0x4e,
    0x04,
    EMPTY_BLOCK,
    ...get(result),
    ...get(bestSpec),
    ...store32(),
    ...get(result),
    ...i32(4),
    0x6a,
    ...get(bestEnd),
    ...store32(),
    ...i32(1),
    0x0f,
    0x0b,

    ...i32(0),
  ];
}

function lexAllFunction(): number[] {
  const src = 0;
  const len = 1;
  const tokens = 3;
  const offset = 4;
  const count = 5;
  const spec = 6;
  const end = 7;
  const unit = 8;
  const nextUnit = 9;
  const width = 10;
  const record = 11;
  const state = 12;
  const index = 13;
  const bestSpec = 14;
  const bestEnd = 15;
  const codePoint = 16;
  const target = 17;
  const accept = 18;
  return [
    ...i32(0),
    ...set(offset),
    ...i32(0),
    ...set(count),

    0x02,
    EMPTY_BLOCK,
    0x03,
    EMPTY_BLOCK,
    ...get(offset),
    ...get(len),
    0x4f,
    0x0d,
    ...u32(1),

    ...i32(0),
    ...set(state),
    ...get(offset),
    ...set(index),
    ...i32(-1),
    ...set(bestSpec),
    ...get(offset),
    ...set(bestEnd),

    0x02,
    EMPTY_BLOCK,
    0x03,
    EMPTY_BLOCK,
    ...get(index),
    ...get(len),
    0x4f,
    0x0d,
    ...u32(1),

    ...decodeAndTransition(
      src,
      index,
      len,
      unit,
      nextUnit,
      codePoint,
      width,
      state,
      target,
    ),
    ...get(target),
    ...i32(0),
    0x48,
    0x0d,
    ...u32(1),

    ...get(index),
    ...get(width),
    0x6a,
    ...set(index),
    ...get(target),
    ...set(state),

    ...loadTableValueFromHeader(PLAN_HEADER_ACCEPTS, state),
    ...set(accept),
    ...get(accept),
    ...i32(0),
    0x4e,
    0x04,
    EMPTY_BLOCK,
    ...get(accept),
    ...set(bestSpec),
    ...get(index),
    ...set(bestEnd),
    0x0b,

    0x0c,
    ...u32(0),
    0x0b,
    0x0b,

    ...get(bestSpec),
    ...i32(0),
    0x4e,
    0x04,
    EMPTY_BLOCK,
    ...get(bestSpec),
    ...set(spec),
    ...get(bestEnd),
    ...set(end),
    0x05,
    ...i32(-1),
    ...set(spec),
    ...decodeCodePoint(src, offset, len, unit, nextUnit, codePoint, width),
    ...get(offset),
    ...get(width),
    0x6a,
    ...set(end),
    0x0b,

    ...get(tokens),
    ...get(count),
    ...i32(12),
    0x6c,
    0x6a,
    ...set(record),
    ...get(record),
    ...get(spec),
    ...store32(),
    ...get(record),
    ...i32(4),
    0x6a,
    ...get(offset),
    ...store32(),
    ...get(record),
    ...i32(8),
    0x6a,
    ...get(end),
    ...store32(),

    ...get(end),
    ...set(offset),
    ...get(count),
    ...i32(1),
    0x6a,
    ...set(count),
    0x0c,
    ...u32(0),
    0x0b,
    0x0b,

    ...get(count),
  ];
}

function decodeCodePoint(
  srcLocal: number,
  indexLocal: number,
  lenLocal: number,
  unitLocal: number,
  nextUnitLocal: number,
  codePointLocal: number,
  widthLocal: number,
): number[] {
  return [
    ...loadUtf16(srcLocal, indexLocal),
    ...set(unitLocal),
    ...decodeCodePointFromLoadedUnit(
      srcLocal,
      indexLocal,
      lenLocal,
      unitLocal,
      nextUnitLocal,
      codePointLocal,
      widthLocal,
    ),
  ];
}

function decodeAndTransition(
  srcLocal: number,
  indexLocal: number,
  lenLocal: number,
  unitLocal: number,
  nextUnitLocal: number,
  codePointLocal: number,
  widthLocal: number,
  stateLocal: number,
  targetLocal: number,
): number[] {
  return [
    ...loadUtf16(srcLocal, indexLocal),
    ...set(unitLocal),
    ...decodeCodePointFromLoadedUnit(
      srcLocal,
      indexLocal,
      lenLocal,
      unitLocal,
      nextUnitLocal,
      codePointLocal,
      widthLocal,
    ),
    ...get(stateLocal),
    ...get(codePointLocal),
    0x10,
    ...u32(0),
    ...set(targetLocal),
  ];
}

function decodeCodePointFromLoadedUnit(
  srcLocal: number,
  indexLocal: number,
  lenLocal: number,
  unitLocal: number,
  nextUnitLocal: number,
  codePointLocal: number,
  widthLocal: number,
): number[] {
  return [
    ...get(unitLocal),
    ...set(codePointLocal),
    ...i32(1),
    ...set(widthLocal),

    ...get(unitLocal),
    ...i32(0xd800),
    0x4f,
    0x04,
    EMPTY_BLOCK,
    ...get(unitLocal),
    ...i32(0xdbff),
    0x4d,
    0x04,
    EMPTY_BLOCK,
    ...get(indexLocal),
    ...i32(1),
    0x6a,
    ...get(lenLocal),
    0x49,
    0x04,
    EMPTY_BLOCK,
    ...loadUtf16AtIndexPlusOne(srcLocal, indexLocal),
    ...set(nextUnitLocal),
    ...get(nextUnitLocal),
    ...i32(0xdc00),
    0x4f,
    0x04,
    EMPTY_BLOCK,
    ...get(nextUnitLocal),
    ...i32(0xdfff),
    0x4d,
    0x04,
    EMPTY_BLOCK,
    ...get(unitLocal),
    ...i32(0xd800),
    0x6b,
    ...i32(10),
    0x74,
    ...get(nextUnitLocal),
    ...i32(0xdc00),
    0x6b,
    0x6a,
    ...i32(0x1_00_00),
    0x6a,
    ...set(codePointLocal),
    ...i32(2),
    ...set(widthLocal),
    0x0b,
    0x0b,
    0x0b,
    0x0b,
    0x0b,
  ];
}

function loadAsciiTransition(
  asciiTransitionsOffsetLocal: number,
  stateLocal: number,
  unitLocal: number,
): number[] {
  return [
    ...get(asciiTransitionsOffsetLocal),
    ...get(stateLocal),
    ...i32(128),
    0x6c,
    ...get(unitLocal),
    0x6a,
    ...i32(4),
    0x6c,
    0x6a,
    ...load32(),
  ];
}

function tableLookupFunction(options: {
  rowsHeader: number;
  pairsHeader: number;
  stateCountHeader: number;
  missing: number;
}): number[] {
  const state = 0;
  const key = 1;
  const index = 2;
  const end = 3;
  const base = 4;
  return [
    ...get(state),
    ...loadHeaderValue(options.stateCountHeader),
    0x4f,
    0x04,
    EMPTY_BLOCK,
    ...i32(options.missing),
    0x0f,
    0x0b,

    ...loadHeaderValue(options.rowsHeader),
    ...set(base),
    ...loadTableValueFromLocal(base, state),
    ...set(index),
    ...loadTableValuePlusOneFromLocal(base, state),
    ...set(end),

    0x02,
    EMPTY_BLOCK,
    0x03,
    EMPTY_BLOCK,
    ...get(index),
    ...get(end),
    0x4f,
    0x0d,
    ...u32(1),

    ...loadHeaderValue(options.pairsHeader),
    ...get(index),
    ...i32(8),
    0x6c,
    0x6a,
    ...set(base),
    ...get(base),
    ...load32(),
    ...get(key),
    0x46,
    0x04,
    EMPTY_BLOCK,
    ...get(base),
    ...i32(4),
    0x6a,
    ...load32(),
    0x0f,
    0x0b,

    ...get(index),
    ...i32(1),
    0x6a,
    ...set(index),
    0x0c,
    ...u32(0),
    0x0b,
    0x0b,

    ...i32(options.missing),
  ];
}

function loadHeaderValue(field: number): number[] {
  return [
    ...i32(field * 4),
    ...load32(),
  ];
}

function loadTableValueFromHeader(
  field: number,
  indexLocal: number,
): number[] {
  return [
    ...loadHeaderValue(field),
    ...get(indexLocal),
    ...i32(4),
    0x6c,
    0x6a,
    ...load32(),
  ];
}

function loadTableValueFromLocal(
  offsetLocal: number,
  indexLocal: number,
): number[] {
  return [
    ...get(offsetLocal),
    ...get(indexLocal),
    ...i32(4),
    0x6c,
    0x6a,
    ...load32(),
  ];
}

function loadTableValuePlusOneFromLocal(
  offsetLocal: number,
  indexLocal: number,
): number[] {
  return [
    ...get(offsetLocal),
    ...get(indexLocal),
    ...i32(1),
    0x6a,
    ...i32(4),
    0x6c,
    0x6a,
    ...load32(),
  ];
}

function loadUtf16(srcLocal: number, indexLocal: number): number[] {
  return [
    ...get(srcLocal),
    ...get(indexLocal),
    ...i32(1),
    0x74,
    0x6a,
    0x2f,
    0x01,
    0x00,
  ];
}

function loadUtf16AtIndexPlusOne(
  srcLocal: number,
  indexLocal: number,
): number[] {
  return [
    ...get(srcLocal),
    ...get(indexLocal),
    ...i32(1),
    0x6a,
    ...i32(1),
    0x74,
    0x6a,
    0x2f,
    0x01,
    0x00,
  ];
}

function load32(): number[] {
  return [0x28, 0x02, 0x00];
}

function store32(): number[] {
  return [0x36, 0x02, 0x00];
}

function get(local: number): number[] {
  return [0x20, ...u32(local)];
}

function set(local: number): number[] {
  return [0x21, ...u32(local)];
}

function i32(value: number): number[] {
  return [0x41, ...s32(value)];
}

function functionBody(localCount: number, instructions: readonly number[]) {
  const localDecls = localCount === 0 ? [] : [[...u32(localCount), I32]];
  return [
    ...u32(vec(localDecls).length + instructions.length + 1),
    ...vec(localDecls),
    ...instructions,
    0x0b,
  ];
}

function exportEntry(name: string, kind: number, index: number): number[] {
  return [...nameBytes(name), kind, ...u32(index)];
}

function section(id: number, payload: readonly number[]): number[] {
  return [id, ...u32(payload.length), ...payload];
}

function vec(items: readonly (number | readonly number[])[]): number[] {
  return [
    ...u32(items.length),
    ...items.flatMap((item) => typeof item === "number" ? [item] : [...item]),
  ];
}

function nameBytes(name: string): number[] {
  const bytes = new TextEncoder().encode(name);
  return [...u32(bytes.length), ...bytes];
}

function u32(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value >>> 0;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== 0);
  return bytes;
}

function s32(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value | 0;
  let more = true;
  while (more) {
    let byte = remaining & 0x7f;
    remaining >>= 7;
    const signBitSet = (byte & 0x40) !== 0;
    more = !(
      (remaining === 0 && !signBitSet) ||
      (remaining === -1 && signBitSet)
    );
    if (more) byte |= 0x80;
    bytes.push(byte);
  }
  return bytes;
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}
