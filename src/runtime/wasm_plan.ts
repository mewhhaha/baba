import {
  decodeCompactPlanBinary,
  encodeCompactPlanBinary,
} from "./compact_plan_binary.ts";

const CORE_PLAN_MAGIC = 0x31505742;
const CORE_PLAN_FORMAT_VERSION = 1;
const CORE_PLAN_VERSION = 1;
const CORE_PLAN_HEADER_I32_COUNT = 14;
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
const I32_BYTES = 4;
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
const WASM_PLAN_RUNTIME_SECTION_VERSION = 1;

export interface DecodedWasmParserPlan {
  readonly coreByteLength: number;
  readonly parserPlanVersion: number;
  readonly compactRuntimePlan: unknown;
}

export interface ValidatedWasmParserPlan {
  readonly coreByteLength: number;
  readonly parserPlanVersion: number;
  readonly runtimeMetadataHeaderOffset: number;
  readonly runtimeMetadataOffset: number;
  readonly runtimeMetadataLength: number;
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
  writeU32(combined, offset, WASM_PLAN_RUNTIME_SECTION_VERSION);
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
  if (sectionVersion !== WASM_PLAN_RUNTIME_SECTION_VERSION) {
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
    runtimeMetadataHeaderOffset,
    runtimeMetadataOffset: offset,
    runtimeMetadataLength: compactLength,
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
  const asciiTransitions = readI32(planBytes, CORE_HEADER_ASCII_TRANSITIONS);
  const transitionRows = readI32(planBytes, CORE_HEADER_TRANSITION_ROWS);
  const transitions = readI32(planBytes, CORE_HEADER_TRANSITIONS);
  const actionRows = readI32(planBytes, CORE_HEADER_ACTION_ROWS);
  const actionPairs = readI32(planBytes, CORE_HEADER_ACTION_PAIRS);
  const gotoRows = readI32(planBytes, CORE_HEADER_GOTO_ROWS);
  const gotoPairs = readI32(planBytes, CORE_HEADER_GOTO_PAIRS);

  validateSection(
    "accepts",
    accepts,
    checkedMul(dfaStateCount, I32_BYTES, "accepts byte length"),
    coreByteLength,
  );
  if (asciiTransitions !== -1) {
    validateSection(
      "ASCII transitions",
      asciiTransitions,
      checkedMul(
        checkedMul(dfaStateCount, 128, "ASCII transition count"),
        I32_BYTES,
        "ASCII transition byte length",
      ),
      coreByteLength,
    );
  }
  validateSection(
    "transition rows",
    transitionRows,
    checkedMul(dfaStateCount + 1, I32_BYTES, "transition row byte length"),
    coreByteLength,
  );
  validateSection("transitions", transitions, 0, coreByteLength);
  validateSection(
    "action rows",
    actionRows,
    checkedMul(parserStateCount + 1, I32_BYTES, "action row byte length"),
    coreByteLength,
  );
  validateSection("action pairs", actionPairs, 0, coreByteLength);
  validateSection(
    "goto rows",
    gotoRows,
    checkedMul(parserStateCount + 1, I32_BYTES, "goto row byte length"),
    coreByteLength,
  );
  validateSection("goto pairs", gotoPairs, 0, coreByteLength);
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

function validateMonotonicRows(
  bytes: Uint8Array,
  offset: number,
  count: number,
  name: string,
): void {
  let previous = 0;
  for (let index = 0; index < count; index++) {
    const current = readI32AtByteOffset(bytes, offset + index * I32_BYTES);
    if (current < previous) {
      throw new Error(`Wasm parser plan ${name} are not monotonic.`);
    }
    previous = current;
  }
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
