import {
  decodeCompactPlanBinary,
  encodeCompactPlanBinary,
} from "./compact_plan_binary.ts";

const CORE_PLAN_MAGIC = 0x31505742;
const CORE_PLAN_FORMAT_VERSION = 2;
const CORE_PLAN_VERSION = 1;
const CORE_PLAN_HEADER_I32_COUNT = 21;
const CORE_PLAN_HEADER_BYTES = CORE_PLAN_HEADER_I32_COUNT * 4;
const CORE_HEADER_MAGIC = 0;
const CORE_HEADER_FORMAT_VERSION = 1;
const CORE_HEADER_PARSER_PLAN_VERSION = 2;
const CORE_HEADER_DFA_STATE_COUNT = 3;
const CORE_HEADER_PARSER_STATE_COUNT = 4;
const CORE_HEADER_ACCEPTS = 5;
const CORE_HEADER_ASCII_TRANSITIONS = 6;
const CORE_HEADER_TRANSITION_ROWS = 7;
const CORE_HEADER_TRANSITIONS = 8;
const CORE_HEADER_ACTION_ROWS = 9;
const CORE_HEADER_ACTION_PAIRS = 10;
const CORE_HEADER_GOTO_ROWS = 11;
const CORE_HEADER_GOTO_PAIRS = 12;
const CORE_HEADER_BYTE_LENGTH = 13;
const CORE_HEADER_SPEC_COUNT = 14;
const CORE_HEADER_EOF_TERMINAL = 15;
const CORE_HEADER_SPEC_TERMINALS = 16;
const CORE_HEADER_ACCEPT_CANDIDATE_ROWS = 17;
const CORE_HEADER_ACCEPT_CANDIDATES = 18;
const CORE_HEADER_PRODUCTION_COUNT = 19;
const CORE_HEADER_PRODUCTIONS = 20;
const I32_BYTES = 4;
const COMPACT_I16_OFFSET_TAG = 2;
const COMPACT_U16_OFFSET_BASE = 0x4000_0000;
const WASM_PLAN_RUNTIME_SECTION_MAGIC = new Uint8Array([
  66,
  65,
  66,
  65,
  95,
  87,
  65,
  83,
  77,
  95,
  82,
  84,
  0,
]);
export const parserPlanRuntimeMetadataVersion = 2 as const;

export interface DecodedWasmParserPlan {
  readonly coreByteLength: number;
  readonly parserPlanVersion: number;
  readonly runtimeMetadataVersion: number;
  readonly compactRuntimePlan: unknown;
}

export interface ValidatedWasmParserPlan {
  readonly coreByteLength: number;
  readonly parserPlanVersion: number;
  readonly runtimeMetadataVersion: number;
  readonly runtimeMetadataHeaderOffset: number;
  readonly runtimeMetadataOffset: number;
  readonly runtimeMetadataLength: number;
}

export interface WasmParserPlanInfo {
  readonly format: "baba-parser-plan";
  readonly coreFormatVersion: number;
  readonly parserPlanVersion: number;
  readonly runtimeMetadataVersion: number;
  readonly totalBytes: number;
  readonly corePlanBytes: number;
  readonly runtimeMetadataHeaderBytes: number;
  readonly runtimeMetadataBytes: number;
  readonly tables: {
    readonly lexerStates: number;
    readonly lexerTransitions: number;
    readonly lexerSpecifications: number;
    readonly lexerAcceptCandidates: number;
    readonly parserStates: number;
    readonly parserActions: number;
    readonly parserGotos: number;
    readonly productions: number;
  };
}

interface CompactSectionOffset {
  readonly offset: number;
  readonly cellBytes: 2 | 4;
}

export function encodeCombinedWasmParserPlan(
  corePlanBytes: Uint8Array,
  compactRuntimePlan: unknown,
): Uint8Array {
  const core = validateCorePlan(corePlanBytes);
  if (core.coreByteLength !== corePlanBytes.byteLength) {
    throw new Error("Wasm core parser plan bytes contain trailing data.");
  }
  const compactBytes = encodeCompactPlanBinary(compactRuntimePlan);
  const headerLength = WASM_PLAN_RUNTIME_SECTION_MAGIC.byteLength +
    I32_BYTES * 2;
  const combined = new Uint8Array(
    corePlanBytes.byteLength + headerLength + compactBytes.byteLength,
  );
  combined.set(corePlanBytes, 0);
  let offset = corePlanBytes.byteLength;
  combined.set(WASM_PLAN_RUNTIME_SECTION_MAGIC, offset);
  offset += WASM_PLAN_RUNTIME_SECTION_MAGIC.byteLength;
  writeU32(combined, offset, parserPlanRuntimeMetadataVersion);
  offset += I32_BYTES;
  writeU32(combined, offset, compactBytes.byteLength);
  offset += I32_BYTES;
  combined.set(compactBytes, offset);
  return combined;
}

export function decodeCombinedWasmParserPlan(
  planBytes: Uint8Array,
): DecodedWasmParserPlan {
  const validated = validateCombinedWasmParserPlan(planBytes);
  const compactRuntimePlan = decodeCompactPlanBinary(
    planBytes.subarray(
      validated.runtimeMetadataOffset,
      validated.runtimeMetadataOffset + validated.runtimeMetadataLength,
    ),
  );
  return {
    coreByteLength: validated.coreByteLength,
    parserPlanVersion: validated.parserPlanVersion,
    runtimeMetadataVersion: validated.runtimeMetadataVersion,
    compactRuntimePlan,
  };
}

export function validateCombinedWasmParserPlan(
  planBytes: Uint8Array,
): ValidatedWasmParserPlan {
  const core = validateCorePlan(planBytes);
  let offset = core.coreByteLength;
  if (
    planBytes.byteLength <
      offset + WASM_PLAN_RUNTIME_SECTION_MAGIC.byteLength + I32_BYTES * 2
  ) {
    throw new Error("Wasm parser plan is missing runtime metadata.");
  }
  const runtimeMetadataHeaderOffset = offset;
  for (let index = 0; index < WASM_PLAN_RUNTIME_SECTION_MAGIC.length; index++) {
    if (planBytes[offset + index] !== WASM_PLAN_RUNTIME_SECTION_MAGIC[index]) {
      throw new Error("Wasm parser plan runtime metadata magic is invalid.");
    }
  }
  offset += WASM_PLAN_RUNTIME_SECTION_MAGIC.byteLength;
  const sectionVersion = readU32(planBytes, offset);
  offset += I32_BYTES;
  if (sectionVersion !== parserPlanRuntimeMetadataVersion) {
    if (sectionVersion === 1) {
      throw new Error(
        "Unsupported Wasm parser plan runtime metadata version 1. Regenerate the parser plan with Baba 5.",
      );
    }
    throw new Error(
      `Unsupported Wasm parser plan runtime metadata version ${sectionVersion}.`,
    );
  }
  const compactLength = readU32(planBytes, offset);
  offset += I32_BYTES;
  if (offset + compactLength !== planBytes.byteLength) {
    throw new Error("Wasm parser plan runtime metadata length is invalid.");
  }
  return {
    coreByteLength: core.coreByteLength,
    parserPlanVersion: core.parserPlanVersion,
    runtimeMetadataVersion: sectionVersion,
    runtimeMetadataHeaderOffset,
    runtimeMetadataOffset: offset,
    runtimeMetadataLength: compactLength,
  };
}

export function inspectCombinedWasmParserPlan(
  planBytes: Uint8Array,
): WasmParserPlanInfo {
  const validated = validateCombinedWasmParserPlan(planBytes);
  const dfaStateCount = readI32(planBytes, CORE_HEADER_DFA_STATE_COUNT);
  const parserStateCount = readI32(
    planBytes,
    CORE_HEADER_PARSER_STATE_COUNT,
  );
  const transitionRows = decodeCompactOffset(
    readI32(planBytes, CORE_HEADER_TRANSITION_ROWS),
    "transition rows",
  );
  const actionRows = decodeCompactOffset(
    readI32(planBytes, CORE_HEADER_ACTION_ROWS),
    "action rows",
  );
  const gotoRows = decodeCompactOffset(
    readI32(planBytes, CORE_HEADER_GOTO_ROWS),
    "goto rows",
  );
  const acceptCandidateRows = decodeCompactOffset(
    readI32(planBytes, CORE_HEADER_ACCEPT_CANDIDATE_ROWS),
    "lexer accept candidate rows",
  );
  return {
    format: "baba-parser-plan",
    coreFormatVersion: CORE_PLAN_FORMAT_VERSION,
    parserPlanVersion: validated.parserPlanVersion,
    runtimeMetadataVersion: validated.runtimeMetadataVersion,
    totalBytes: planBytes.byteLength,
    corePlanBytes: validated.coreByteLength,
    runtimeMetadataHeaderBytes: validated.runtimeMetadataOffset -
      validated.runtimeMetadataHeaderOffset,
    runtimeMetadataBytes: validated.runtimeMetadataLength,
    tables: {
      lexerStates: dfaStateCount,
      lexerTransitions: readRowValue(
        planBytes,
        transitionRows,
        dfaStateCount,
      ),
      lexerSpecifications: readI32(planBytes, CORE_HEADER_SPEC_COUNT),
      lexerAcceptCandidates: readRowValue(
        planBytes,
        acceptCandidateRows,
        dfaStateCount,
      ),
      parserStates: parserStateCount,
      parserActions: readRowValue(
        planBytes,
        actionRows,
        parserStateCount,
      ),
      parserGotos: readRowValue(
        planBytes,
        gotoRows,
        parserStateCount,
      ),
      productions: readI32(planBytes, CORE_HEADER_PRODUCTION_COUNT),
    },
  };
}

function validateCorePlan(planBytes: Uint8Array): {
  readonly coreByteLength: number;
  readonly parserPlanVersion: number;
} {
  if (!(planBytes instanceof Uint8Array)) {
    throw new TypeError("Wasm parser plan must be a Uint8Array.");
  }
  if (planBytes.byteLength < CORE_PLAN_HEADER_BYTES) {
    throw new Error("Wasm parser plan is truncated.");
  }
  const magic = readI32(planBytes, CORE_HEADER_MAGIC);
  if (magic !== CORE_PLAN_MAGIC) {
    throw new Error("Wasm parser plan magic is invalid.");
  }
  const formatVersion = readI32(planBytes, CORE_HEADER_FORMAT_VERSION);
  if (formatVersion !== CORE_PLAN_FORMAT_VERSION) {
    throw new Error(
      `Unsupported Wasm parser plan core format version ${formatVersion}.`,
    );
  }
  const parserPlanVersion = readI32(
    planBytes,
    CORE_HEADER_PARSER_PLAN_VERSION,
  );
  if (parserPlanVersion !== CORE_PLAN_VERSION) {
    throw new Error(`Unsupported parser plan version ${parserPlanVersion}.`);
  }
  const dfaStateCount = readNonNegativeI32(
    planBytes,
    CORE_HEADER_DFA_STATE_COUNT,
    "DFA state count",
  );
  const parserStateCount = readNonNegativeI32(
    planBytes,
    CORE_HEADER_PARSER_STATE_COUNT,
    "parser state count",
  );
  const coreByteLength = readNonNegativeI32(
    planBytes,
    CORE_HEADER_BYTE_LENGTH,
    "core byte length",
  );
  if (coreByteLength < CORE_PLAN_HEADER_BYTES) {
    throw new Error("Wasm parser plan core byte length is invalid.");
  }
  if (coreByteLength > planBytes.byteLength) {
    throw new Error("Wasm parser plan core byte length exceeds file length.");
  }

  const accepts = readI32(planBytes, CORE_HEADER_ACCEPTS);
  const asciiTransitions = decodeOptionalCompactI16Offset(
    readI32(planBytes, CORE_HEADER_ASCII_TRANSITIONS),
    "ASCII transitions",
  );
  const transitionRows = decodeCompactOffset(
    readI32(planBytes, CORE_HEADER_TRANSITION_ROWS),
    "transition rows",
  );
  const transitions = readI32(planBytes, CORE_HEADER_TRANSITIONS);
  const actionRows = decodeCompactOffset(
    readI32(planBytes, CORE_HEADER_ACTION_ROWS),
    "action rows",
  );
  const actionPairs = decodeCompactOffset(
    readI32(planBytes, CORE_HEADER_ACTION_PAIRS),
    "action pairs",
  );
  const gotoRows = decodeCompactOffset(
    readI32(planBytes, CORE_HEADER_GOTO_ROWS),
    "goto rows",
  );
  const gotoPairs = decodeCompactOffset(
    readI32(planBytes, CORE_HEADER_GOTO_PAIRS),
    "goto pairs",
  );
  const specCount = readNonNegativeI32(
    planBytes,
    CORE_HEADER_SPEC_COUNT,
    "lexer spec count",
  );
  const eofTerminal = readI32(planBytes, CORE_HEADER_EOF_TERMINAL);
  if (eofTerminal < 0) {
    throw new Error("Wasm parser plan EOF terminal must be non-negative.");
  }
  const specTerminals = readI32(planBytes, CORE_HEADER_SPEC_TERMINALS);
  const acceptCandidateRows = decodeCompactOffset(
    readI32(planBytes, CORE_HEADER_ACCEPT_CANDIDATE_ROWS),
    "lexer accept candidate rows",
  );
  const acceptCandidates = readI32(planBytes, CORE_HEADER_ACCEPT_CANDIDATES);
  const productionCount = readNonNegativeI32(
    planBytes,
    CORE_HEADER_PRODUCTION_COUNT,
    "production count",
  );
  const productions = readI32(planBytes, CORE_HEADER_PRODUCTIONS);

  validateSection(
    "accepts",
    accepts,
    checkedMul(dfaStateCount, I32_BYTES, "accepts byte length"),
    coreByteLength,
  );
  if (asciiTransitions !== null) {
    validateSection(
      "ASCII transitions",
      asciiTransitions.offset,
      checkedMul(
        checkedMul(dfaStateCount, 128, "ASCII transition count"),
        asciiTransitions.cellBytes,
        "ASCII transition byte length",
      ),
      coreByteLength,
    );
  }
  validateSection(
    "transition rows",
    transitionRows.offset,
    checkedMul(
      dfaStateCount + 1,
      transitionRows.cellBytes,
      "transition row byte length",
    ),
    coreByteLength,
  );
  validateSection("transitions", transitions, 0, coreByteLength);
  validateSection(
    "action rows",
    actionRows.offset,
    checkedMul(
      parserStateCount + 1,
      actionRows.cellBytes,
      "action row byte length",
    ),
    coreByteLength,
  );
  validateSection("action pairs", actionPairs.offset, 0, coreByteLength);
  validateSection(
    "goto rows",
    gotoRows.offset,
    checkedMul(
      parserStateCount + 1,
      gotoRows.cellBytes,
      "goto row byte length",
    ),
    coreByteLength,
  );
  validateSection("goto pairs", gotoPairs.offset, 0, coreByteLength);
  validateSection(
    "lexer spec terminals",
    specTerminals,
    checkedMul(specCount, I32_BYTES, "lexer spec terminal byte length"),
    coreByteLength,
  );
  validateSection(
    "lexer accept candidate rows",
    acceptCandidateRows.offset,
    checkedMul(
      dfaStateCount + 1,
      acceptCandidateRows.cellBytes,
      "lexer accept candidate row byte length",
    ),
    coreByteLength,
  );
  validateSection(
    "lexer accept candidates",
    acceptCandidates,
    0,
    coreByteLength,
  );
  validateSection(
    "productions",
    productions,
    checkedMul(
      checkedMul(productionCount, 4, "production row i32 count"),
      I32_BYTES,
      "production byte length",
    ),
    coreByteLength,
  );
  validateMonotonicRows(
    planBytes,
    transitionRows,
    dfaStateCount + 1,
    "transition rows",
  );
  validateMonotonicRows(
    planBytes,
    actionRows,
    parserStateCount + 1,
    "action rows",
  );
  validateMonotonicRows(
    planBytes,
    gotoRows,
    parserStateCount + 1,
    "goto rows",
  );
  validateMonotonicRows(
    planBytes,
    acceptCandidateRows,
    dfaStateCount + 1,
    "lexer accept candidate rows",
  );
  return { coreByteLength, parserPlanVersion };
}

function validateSection(
  name: string,
  offset: number,
  byteLength: number,
  coreByteLength: number,
): void {
  if (offset < CORE_PLAN_HEADER_BYTES) {
    throw new Error(`Wasm parser plan ${name} offset is invalid.`);
  }
  if (offset % I32_BYTES !== 0) {
    throw new Error(`Wasm parser plan ${name} offset is not aligned.`);
  }
  if (offset + byteLength > coreByteLength) {
    throw new Error(`Wasm parser plan ${name} section exceeds core length.`);
  }
}

function decodeOptionalCompactI16Offset(
  encoded: number,
  name: string,
): { readonly offset: number; readonly cellBytes: 2 | 4 } | null {
  if (encoded === -1) {
    return null;
  }
  if (encoded < -1) {
    const offset = -encoded - COMPACT_I16_OFFSET_TAG;
    if (offset < CORE_PLAN_HEADER_BYTES) {
      throw new Error(`Wasm parser plan ${name} compact offset is invalid.`);
    }
    return { offset, cellBytes: 2 };
  }
  return { offset: encoded, cellBytes: 4 };
}

function decodeCompactOffset(
  encoded: number,
  name: string,
): CompactSectionOffset {
  if (encoded <= -COMPACT_U16_OFFSET_BASE) {
    const offset = -encoded - COMPACT_U16_OFFSET_BASE;
    if (offset < CORE_PLAN_HEADER_BYTES) {
      throw new Error(`Wasm parser plan ${name} compact offset is invalid.`);
    }
    return { offset, cellBytes: 2 };
  }
  if (encoded < -1) {
    const offset = -encoded - COMPACT_I16_OFFSET_TAG;
    if (offset < CORE_PLAN_HEADER_BYTES) {
      throw new Error(`Wasm parser plan ${name} compact offset is invalid.`);
    }
    return { offset, cellBytes: 2 };
  }
  if (encoded < CORE_PLAN_HEADER_BYTES) {
    throw new Error(`Wasm parser plan ${name} offset is invalid.`);
  }
  return { offset: encoded, cellBytes: 4 };
}

function validateMonotonicRows(
  bytes: Uint8Array,
  section: CompactSectionOffset,
  count: number,
  name: string,
): void {
  let previous = 0;
  for (let index = 0; index < count; index++) {
    const current = readRowValue(bytes, section, index);
    if (current < previous) {
      throw new Error(`Wasm parser plan ${name} are not monotonic.`);
    }
    previous = current;
  }
}

function readRowValue(
  bytes: Uint8Array,
  section: CompactSectionOffset,
  index: number,
): number {
  const byteOffset = section.offset + index * section.cellBytes;
  if (section.cellBytes === 2) {
    return readU16AtByteOffset(bytes, byteOffset);
  }
  return readI32AtByteOffset(bytes, byteOffset);
}

function readNonNegativeI32(
  bytes: Uint8Array,
  headerIndex: number,
  name: string,
): number {
  const value = readI32(bytes, headerIndex);
  if (value < 0) {
    throw new Error(`Wasm parser plan ${name} must be non-negative.`);
  }
  return value;
}

function readI32(bytes: Uint8Array, headerIndex: number): number {
  return readI32AtByteOffset(bytes, headerIndex * I32_BYTES);
}

function readI32AtByteOffset(bytes: Uint8Array, byteOffset: number): number {
  if (byteOffset + I32_BYTES > bytes.byteLength) {
    throw new Error("Wasm parser plan is truncated.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getInt32(byteOffset, true);
}

function readU32(bytes: Uint8Array, byteOffset: number): number {
  if (byteOffset + I32_BYTES > bytes.byteLength) {
    throw new Error("Wasm parser plan is truncated.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(byteOffset, true);
}

function readU16AtByteOffset(bytes: Uint8Array, byteOffset: number): number {
  if (byteOffset + 2 > bytes.byteLength) {
    throw new Error("Wasm parser plan is truncated.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint16(byteOffset, true);
}

function writeU32(bytes: Uint8Array, byteOffset: number, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError("Expected unsigned 32-bit integer.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(byteOffset, value, true);
}

function checkedMul(left: number, right: number, label: string): number {
  if (!Number.isSafeInteger(left) || left < 0) {
    throw new RangeError(`${label} left operand is invalid.`);
  }
  if (!Number.isSafeInteger(right) || right < 0) {
    throw new RangeError(`${label} right operand is invalid.`);
  }
  const value = left * right;
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} is too large.`);
  }
  return value;
}
