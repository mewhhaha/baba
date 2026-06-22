// Core Wasm parser runtime byte emitter shared by Wasm target packaging.
import type { Dfa } from "../../compiler/regex/dfa.ts";
import type { LrAction, LrActionSet, LrTable } from "../typescript/lr1.ts";
import {
  RUNTIME_ACTION_ACCEPT as ACTION_ACCEPT,
  RUNTIME_ACTION_PAYLOAD_MASK,
  RUNTIME_ACTION_REDUCE as ACTION_REDUCE,
  RUNTIME_ACTION_SHIFT as ACTION_SHIFT,
} from "./language_sources.ts";

export interface WasmModuleImage {
  bytes: Uint8Array;
  inputBase: number;
}

interface DataLayout {
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

const PAGE_SIZE = 65_536;
const MAX_WASM_PAGES = 65_535;
const WASM_ABI_VERSION = 1;
const WASM_SOURCE_ENCODING_UTF16 = 1;
const WASM_SPAN_UNIT_UTF16 = 1;
const WASM_HOST_OWNERSHIP_CALLER_MANAGED = 1;
const WASM_RESULT_LIFETIME_CALLER_BUFFER = 1;
const LEX_RESULT_I32_COUNT = 2;
const TOKEN_RECORD_I32_COUNT = 3;
const I32 = 0x7f;
const FUNC = 0x60;
const EMPTY_BLOCK = 0x40;

export function emitWasmModule(
  dfa: Dfa,
  lr: LrTable,
  parserPlanVersion = 1,
): WasmModuleImage {
  const layout = buildDataLayout(dfa, lr);
  const initialPages = Math.max(1, Math.ceil(layout.inputBase / PAGE_SIZE));
  if (initialPages > MAX_WASM_PAGES) {
    throw new Error(
      `Wasm static data needs ${initialPages} pages, exceeding the maximum ${MAX_WASM_PAGES}.`,
    );
  }
  const sections = [
    section(1, typeSection()),
    section(3, functionSection()),
    section(5, memorySection(initialPages)),
    section(7, exportSection()),
    section(
      10,
      codeSection(
        layout,
        dfa.states.length,
        lr.states.length,
        parserPlanVersion,
      ),
    ),
    section(11, dataSection(layout.bytes)),
  ];
  return {
    bytes: Uint8Array.from([
      0x00,
      0x61,
      0x73,
      0x6d,
      0x01,
      0x00,
      0x00,
      0x00,
      ...sections.flat(),
    ]),
    inputBase: layout.inputBase,
  };
}

function buildDataLayout(
  dfa: Dfa,
  lr: LrTable,
): DataLayout {
  const data: number[] = [];
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

  return {
    accepts,
    asciiTransitions: asciiTransitionsOffset,
    transitionRows: transitionRowsOffset,
    transitions: transitionsOffset,
    actionRows: actionRowsOffset,
    actionPairs: actionPairsOffset,
    gotoRows: gotoRowsOffset,
    gotoPairs: gotoPairsOffset,
    inputBase: align(data.length, 8),
    bytes: Uint8Array.from(data),
  };
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
    exportEntry("abi_version", 0x00, 5),
    exportEntry("plan_version", 0x00, 6),
    exportEntry("reset", 0x00, 7),
    exportEntry("input_base", 0x00, 8),
    exportEntry("max_pages", 0x00, 9),
    exportEntry("source_encoding", 0x00, 10),
    exportEntry("span_unit", 0x00, 11),
    exportEntry("lex_result_i32_count", 0x00, 12),
    exportEntry("token_record_i32_count", 0x00, 13),
    exportEntry("host_ownership_model", 0x00, 14),
    exportEntry("result_lifetime_model", 0x00, 15),
  ]);
}

function codeSection(
  layout: DataLayout,
  dfaStateCount: number,
  parserStateCount: number,
  parserPlanVersion: number,
): number[] {
  return vec([
    functionBody(3, transitionFunction(layout, dfaStateCount)),
    functionBody(10, lexOneFunction(layout.accepts)),
    functionBody(
      3,
      tableLookupFunction({
        rows: layout.actionRows,
        pairs: layout.actionPairs,
        stateCount: parserStateCount,
        missing: 0,
      }),
    ),
    functionBody(
      3,
      tableLookupFunction({
        rows: layout.gotoRows,
        pairs: layout.gotoPairs,
        stateCount: parserStateCount,
        missing: -1,
      }),
    ),
    functionBody(15, lexAllFunction(layout)),
    functionBody(0, versionFunction(WASM_ABI_VERSION)),
    functionBody(0, versionFunction(parserPlanVersion)),
    functionBody(0, resetFunction()),
    functionBody(0, versionFunction(layout.inputBase)),
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

function resetFunction(): number[] {
  return [];
}

function dataSection(data: Uint8Array): number[] {
  return vec([[
    0x00,
    0x41,
    ...s32(0),
    0x0b,
    ...u32(data.length),
    ...data,
  ]]);
}

function transitionFunction(
  layout: DataLayout,
  dfaStateCount: number,
): number[] {
  const state = 0;
  const codePoint = 1;
  const index = 2;
  const end = 3;
  const base = 4;
  return [
    ...get(state),
    ...i32(dfaStateCount),
    0x4f,
    0x04,
    EMPTY_BLOCK,
    ...i32(-1),
    0x0f,
    0x0b,

    ...(layout.asciiTransitions === null ? [] : [
      ...get(codePoint),
      ...i32(128),
      0x49,
      0x04,
      EMPTY_BLOCK,
      ...loadAsciiTransition(
        layout.asciiTransitions,
        state,
        codePoint,
      ),
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
    ]),

    ...loadTableValue(layout.transitionRows, state),
    ...set(index),
    ...loadTableValuePlusOne(layout.transitionRows, state),
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

    ...i32(layout.transitions),
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

function lexOneFunction(acceptsOffset: number): number[] {
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

    ...loadTableValue(acceptsOffset, state),
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

function lexAllFunction(layout: DataLayout): number[] {
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
      layout,
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

    ...loadTableValue(layout.accepts, state),
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
  layout: DataLayout,
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
    ...(layout.asciiTransitions === null
      ? [
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
      ]
      : [
        ...get(unitLocal),
        ...i32(128),
        0x49,
        0x04,
        EMPTY_BLOCK,
        ...get(unitLocal),
        ...set(codePointLocal),
        ...i32(1),
        ...set(widthLocal),
        ...loadAsciiTransition(
          layout.asciiTransitions,
          stateLocal,
          unitLocal,
        ),
        ...set(targetLocal),
        0x05,
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
        0x0b,
      ]),
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
  asciiTransitionsOffset: number,
  stateLocal: number,
  unitLocal: number,
): number[] {
  return [
    ...i32(asciiTransitionsOffset),
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
  rows: number;
  pairs: number;
  stateCount: number;
  missing: number;
}): number[] {
  const state = 0;
  const key = 1;
  const index = 2;
  const end = 3;
  const base = 4;
  return [
    ...get(state),
    ...i32(options.stateCount),
    0x4f,
    0x04,
    EMPTY_BLOCK,
    ...i32(options.missing),
    0x0f,
    0x0b,

    ...loadTableValue(options.rows, state),
    ...set(index),
    ...loadTableValuePlusOne(options.rows, state),
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

    ...i32(options.pairs),
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

function loadTableValue(offset: number, indexLocal: number): number[] {
  return [
    ...i32(offset),
    ...get(indexLocal),
    ...i32(4),
    0x6c,
    0x6a,
    ...load32(),
  ];
}

function loadTableValuePlusOne(offset: number, indexLocal: number): number[] {
  return [
    ...i32(offset),
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
