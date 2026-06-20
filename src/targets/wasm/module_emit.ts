import type { Dfa } from "../../compiler/regex/dfa.ts";
import type { LrAction, LrTable } from "../typescript/lr1.ts";

export interface WasmModuleImage {
  bytes: Uint8Array;
  inputBase: number;
}

interface DataLayout {
  accepts: number;
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
const I32 = 0x7f;
const FUNC = 0x60;
const EMPTY_BLOCK = 0x40;

const ACTION_SHIFT = 0x01_00_00_00;
const ACTION_REDUCE = 0x02_00_00_00;
const ACTION_ACCEPT = 0x03_00_00_00;

export function emitWasmModule(
  dfa: Dfa,
  lr: LrTable,
): WasmModuleImage {
  const layout = buildDataLayout(dfa, lr);
  const initialPages = Math.max(1, Math.ceil(layout.inputBase / PAGE_SIZE));
  const sections = [
    section(1, typeSection()),
    section(3, functionSection()),
    section(5, memorySection(initialPages)),
    section(7, exportSection()),
    section(10, codeSection(layout, dfa.states.length, lr.states.length)),
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
  row: ReadonlyMap<number, LrAction> | undefined,
): Array<[number, LrAction]> {
  return [...(row?.entries() ?? [])].sort((left, right) => left[0] - right[0]);
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
  if (payload < 0 || payload > 0x00_ff_ff_ff) {
    throw new Error(`Wasm parser table payload ${payload} exceeds 24 bits.`);
  }
  return kind | payload;
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
  ]);
}

function functionSection(): number[] {
  return vec([
    u32(0),
    u32(1),
    u32(0),
    u32(0),
    u32(1),
  ]);
}

function memorySection(initialPages: number): number[] {
  return vec([[0x00, ...u32(initialPages)]]);
}

function exportSection(): number[] {
  return vec([
    exportEntry("memory", 0x02, 0),
    exportEntry("lex_one", 0x00, 1),
    exportEntry("parser_action", 0x00, 2),
    exportEntry("parser_goto", 0x00, 3),
    exportEntry("lex_all", 0x00, 4),
  ]);
}

function codeSection(
  layout: DataLayout,
  dfaStateCount: number,
  parserStateCount: number,
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
    functionBody(9, lexAllFunction()),
  ]);
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

function lexAllFunction(): number[] {
  const src = 0;
  const len = 1;
  const result = 2;
  const tokens = 3;
  const offset = 4;
  const count = 5;
  const matched = 6;
  const spec = 7;
  const end = 8;
  const unit = 9;
  const nextUnit = 10;
  const width = 11;
  const record = 12;
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

    ...get(src),
    ...get(len),
    ...get(offset),
    ...get(result),
    0x10,
    ...u32(1),
    ...set(matched),

    ...get(matched),
    ...i32(0),
    0x47,
    0x04,
    EMPTY_BLOCK,
    ...get(result),
    ...load32(),
    ...set(spec),
    ...get(result),
    ...i32(4),
    0x6a,
    ...load32(),
    ...set(end),
    0x05,
    ...i32(-1),
    ...set(spec),
    ...i32(1),
    ...set(width),
    ...loadUtf16(src, offset),
    ...set(unit),
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
    ...get(offset),
    ...i32(1),
    0x6a,
    ...get(len),
    0x49,
    0x04,
    EMPTY_BLOCK,
    ...loadUtf16AtIndexPlusOne(src, offset),
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
    ...i32(2),
    ...set(width),
    0x0b,
    0x0b,
    0x0b,
    0x0b,
    0x0b,
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
