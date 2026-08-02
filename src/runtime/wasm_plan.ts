import {
  decodeCompactPlanBinary,
  encodeCompactPlanBinary,
} from "./compact_plan_binary.ts";
import {
  PARSER_PLAN_FORMAT,
  PARSER_PLAN_RUNTIME_METADATA_VERSION,
  PARSER_PLAN_VERSION,
  WASM_CORE_PLAN_FORMAT_VERSION,
  WASM_CORE_PLAN_MAGIC,
} from "../targets/runtime/parser_plan_contract.ts";

const CORE_PLAN_HEADER_I32_COUNT = 36;
const CORE_PLAN_HEADER_BYTES = CORE_PLAN_HEADER_I32_COUNT * 4;
const CORE_HEADER_MAGIC = 0;
const CORE_HEADER_FORMAT_VERSION = 1;
const CORE_HEADER_PARSER_PLAN_VERSION = 2;
const CORE_HEADER_DFA_STATE_COUNT = 3;
const CORE_HEADER_RETIRED_PARSER_STATE_COUNT = 4;
const CORE_HEADER_FAST_SPECS = 5;
const CORE_HEADER_ASCII_TRANSITIONS = 6;
const CORE_HEADER_TRANSITION_ROWS = 7;
const CORE_HEADER_TRANSITIONS = 8;
const CORE_HEADER_RETIRED_ACTION_ROWS = 9;
const CORE_HEADER_RETIRED_ACTION_PAIRS = 10;
const CORE_HEADER_RETIRED_GOTO_ROWS = 11;
const CORE_HEADER_RETIRED_GOTO_PAIRS = 12;
const CORE_HEADER_BYTE_LENGTH = 13;
const CORE_HEADER_SPEC_COUNT = 14;
const CORE_HEADER_RETIRED_EOF_TERMINAL = 15;
const CORE_HEADER_RETIRED_SPEC_TERMINALS = 16;
const CORE_HEADER_ACCEPT_CANDIDATE_ROWS = 17;
const CORE_HEADER_ACCEPT_CANDIDATES = 18;
const CORE_HEADER_RETIRED_PRODUCTION_COUNT = 19;
const CORE_HEADER_RETIRED_PRODUCTIONS = 20;
const CORE_HEADER_SPEC_FLAGS = 21;
const CORE_HEADER_SPEC_FOLLOW_STARTS = 22;
const CORE_HEADER_SPEC_NOT_FOLLOW_STARTS = 23;
const CORE_HEADER_GUARD_STATE_COUNT = 24;
const CORE_HEADER_GUARD_ACCEPTS = 25;
const CORE_HEADER_GUARD_TRANSITION_ROWS = 26;
const CORE_HEADER_GUARD_TRANSITIONS = 27;
const CORE_HEADER_SPEC_WORD_ROWS = 28;
const CORE_HEADER_WORD_ROWS = 29;
const CORE_HEADER_WORD_CODE_POINTS = 30;
const CORE_HEADER_DFA_START_STATE = 31;
const CORE_HEADER_ALPHABET_CLASS_COUNT = 32;
const CORE_HEADER_ALPHABET_ASCII_CLASSES = 33;
const CORE_HEADER_ALPHABET_RANGE_COUNT = 34;
const CORE_HEADER_ALPHABET_RANGES = 35;
const I32_BYTES = 4;
const ASCII_CLASS_LIMIT = 128;
const MAX_CODE_POINT = 0x10ffff;

// Ceiling on segment-state checks when verifying the alphabet partition. The
// work is inherent to the property, but both of its factors grow with plan
// size, so an untrusted plan could otherwise buy quadratic validation time.
// The shipped example grammars sit near 10^4 and the large-runtime fixture
// near 5x10^4, so this leaves roughly three orders of magnitude of headroom.
const MAX_ALPHABET_PARTITION_WORK = 1 << 24;
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
export {
  PARSER_PLAN_RUNTIME_METADATA_VERSION as parserPlanRuntimeMetadataVersion,
};

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
  readonly format: typeof PARSER_PLAN_FORMAT;
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
  writeU32(combined, offset, PARSER_PLAN_RUNTIME_METADATA_VERSION);
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
  if (sectionVersion !== PARSER_PLAN_RUNTIME_METADATA_VERSION) {
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
  const transitionRows = decodeCompactOffset(
    readI32(planBytes, CORE_HEADER_TRANSITION_ROWS),
    "transition rows",
  );
  const acceptCandidateRows = decodeCompactOffset(
    readI32(planBytes, CORE_HEADER_ACCEPT_CANDIDATE_ROWS),
    "lexer accept candidate rows",
  );
  return {
    format: PARSER_PLAN_FORMAT,
    coreFormatVersion: WASM_CORE_PLAN_FORMAT_VERSION,
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
  if (magic !== WASM_CORE_PLAN_MAGIC) {
    throw new Error("Wasm parser plan magic is invalid.");
  }
  const formatVersion = readI32(planBytes, CORE_HEADER_FORMAT_VERSION);
  if (formatVersion !== WASM_CORE_PLAN_FORMAT_VERSION) {
    throw new Error(
      `Unsupported Wasm parser plan core format version ${formatVersion}.`,
    );
  }
  const parserPlanVersion = readI32(
    planBytes,
    CORE_HEADER_PARSER_PLAN_VERSION,
  );
  if (parserPlanVersion !== PARSER_PLAN_VERSION) {
    throw new Error(`Unsupported parser plan version ${parserPlanVersion}.`);
  }
  const dfaStateCount = readNonNegativeI32(
    planBytes,
    CORE_HEADER_DFA_STATE_COUNT,
    "DFA state count",
  );
  const retiredParserStateCount = readNonNegativeI32(
    planBytes,
    CORE_HEADER_RETIRED_PARSER_STATE_COUNT,
    "parser state count",
  );
  if (retiredParserStateCount !== 0) {
    throw new Error(
      `Wasm island plan carries ${retiredParserStateCount} retired LR parser states.`,
    );
  }
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

  const fastSpecs = readI32(planBytes, CORE_HEADER_FAST_SPECS);
  const asciiTransitions = decodeOptionalCompactI16Offset(
    readI32(planBytes, CORE_HEADER_ASCII_TRANSITIONS),
    "ASCII transitions",
  );
  const transitionRows = decodeCompactOffset(
    readI32(planBytes, CORE_HEADER_TRANSITION_ROWS),
    "transition rows",
  );
  const transitions = readI32(planBytes, CORE_HEADER_TRANSITIONS);
  for (
    const retiredHeader of [
      CORE_HEADER_RETIRED_ACTION_ROWS,
      CORE_HEADER_RETIRED_ACTION_PAIRS,
      CORE_HEADER_RETIRED_GOTO_ROWS,
      CORE_HEADER_RETIRED_GOTO_PAIRS,
      CORE_HEADER_RETIRED_SPEC_TERMINALS,
      CORE_HEADER_RETIRED_PRODUCTION_COUNT,
      CORE_HEADER_RETIRED_PRODUCTIONS,
    ]
  ) {
    if (readI32(planBytes, retiredHeader) !== 0) {
      throw new Error(
        `Wasm island plan retired header ${retiredHeader} must be zero.`,
      );
    }
  }
  const specCount = readNonNegativeI32(
    planBytes,
    CORE_HEADER_SPEC_COUNT,
    "lexer spec count",
  );
  if (readI32(planBytes, CORE_HEADER_RETIRED_EOF_TERMINAL) !== -1) {
    throw new Error("Wasm island plan retired EOF terminal must be -1.");
  }
  const acceptCandidateRows = decodeCompactOffset(
    readI32(planBytes, CORE_HEADER_ACCEPT_CANDIDATE_ROWS),
    "lexer accept candidate rows",
  );
  const acceptCandidates = readI32(planBytes, CORE_HEADER_ACCEPT_CANDIDATES);
  const specFlags = readI32(planBytes, CORE_HEADER_SPEC_FLAGS);
  const specFollowStarts = readI32(planBytes, CORE_HEADER_SPEC_FOLLOW_STARTS);
  const specNotFollowStarts = readI32(
    planBytes,
    CORE_HEADER_SPEC_NOT_FOLLOW_STARTS,
  );
  const guardStateCount = readNonNegativeI32(
    planBytes,
    CORE_HEADER_GUARD_STATE_COUNT,
    "contextual guard state count",
  );
  const guardAccepts = readI32(planBytes, CORE_HEADER_GUARD_ACCEPTS);
  const guardTransitionRows = decodeCompactOffset(
    readI32(planBytes, CORE_HEADER_GUARD_TRANSITION_ROWS),
    "contextual guard transition rows",
  );
  const guardTransitions = readI32(
    planBytes,
    CORE_HEADER_GUARD_TRANSITIONS,
  );
  const specWordRows = decodeCompactOffset(
    readI32(planBytes, CORE_HEADER_SPEC_WORD_ROWS),
    "contextual excluded-word spec rows",
  );
  const wordRows = readI32(planBytes, CORE_HEADER_WORD_ROWS);
  const wordCodePoints = readI32(
    planBytes,
    CORE_HEADER_WORD_CODE_POINTS,
  );
  const dfaStartState = readNonNegativeI32(
    planBytes,
    CORE_HEADER_DFA_START_STATE,
    "DFA start state",
  );
  if (dfaStartState >= dfaStateCount) {
    throw new Error(
      `Wasm parser plan DFA start state ${dfaStartState} is outside [0, ${dfaStateCount}).`,
    );
  }
  const alphabetClassCount = readNonNegativeI32(
    planBytes,
    CORE_HEADER_ALPHABET_CLASS_COUNT,
    "alphabet class count",
  );
  if (alphabetClassCount < 1) {
    throw new Error("Wasm parser plan alphabet has no equivalence classes.");
  }
  const alphabetAsciiClasses = readI32(
    planBytes,
    CORE_HEADER_ALPHABET_ASCII_CLASSES,
  );
  const alphabetRangeCount = readNonNegativeI32(
    planBytes,
    CORE_HEADER_ALPHABET_RANGE_COUNT,
    "alphabet range count",
  );
  if (alphabetRangeCount < 1) {
    throw new Error("Wasm parser plan alphabet range list is empty.");
  }
  const alphabetRanges = readI32(planBytes, CORE_HEADER_ALPHABET_RANGES);

  validateSection(
    "lexer fast specs",
    fastSpecs,
    checkedMul(dfaStateCount, I32_BYTES, "lexer fast spec byte length"),
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
    "lexer spec flags",
    specFlags,
    checkedMul(specCount, I32_BYTES, "lexer spec flag byte length"),
    coreByteLength,
  );
  validateSection(
    "lexer spec positive guards",
    specFollowStarts,
    checkedMul(specCount, I32_BYTES, "lexer spec positive guard byte length"),
    coreByteLength,
  );
  validateSection(
    "lexer spec negative guards",
    specNotFollowStarts,
    checkedMul(specCount, I32_BYTES, "lexer spec negative guard byte length"),
    coreByteLength,
  );
  validateSection(
    "contextual guard accepts",
    guardAccepts,
    checkedMul(guardStateCount, I32_BYTES, "guard accept byte length"),
    coreByteLength,
  );
  validateSection(
    "contextual guard transition rows",
    guardTransitionRows.offset,
    checkedMul(
      guardStateCount + 1,
      guardTransitionRows.cellBytes,
      "guard transition row byte length",
    ),
    coreByteLength,
  );
  validateSection(
    "contextual guard transitions",
    guardTransitions,
    0,
    coreByteLength,
  );
  validateSection(
    "contextual excluded-word spec rows",
    specWordRows.offset,
    checkedMul(
      specCount + 1,
      specWordRows.cellBytes,
      "excluded-word spec row byte length",
    ),
    coreByteLength,
  );
  validateSection("contextual excluded-word rows", wordRows, 0, coreByteLength);
  validateSection(
    "contextual excluded-word code points",
    wordCodePoints,
    0,
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
    acceptCandidateRows,
    dfaStateCount + 1,
    "lexer accept candidate rows",
  );
  validateMonotonicRows(
    planBytes,
    guardTransitionRows,
    guardStateCount + 1,
    "contextual guard transition rows",
  );
  validateMonotonicRows(
    planBytes,
    specWordRows,
    specCount + 1,
    "contextual excluded-word spec rows",
  );
  const acceptCandidateCount = readRowValue(
    planBytes,
    acceptCandidateRows,
    dfaStateCount,
  );
  validateSection(
    "lexer accept candidates",
    acceptCandidates,
    checkedMul(
      acceptCandidateCount,
      I32_BYTES,
      "lexer accept candidate byte length",
    ),
    coreByteLength,
  );
  for (let index = 0; index < acceptCandidateCount; index++) {
    const candidate = readI32AtByteOffset(
      planBytes,
      acceptCandidates + index * I32_BYTES,
    );
    if (candidate < 0 || candidate >= specCount) {
      throw new Error(
        `Wasm parser plan lexer accept candidate ${candidate} is invalid.`,
      );
    }
  }
  for (let state = 0; state < dfaStateCount; state++) {
    const fastSpec = readI32AtByteOffset(
      planBytes,
      fastSpecs + state * I32_BYTES,
    );
    if (fastSpec < -1 || fastSpec >= specCount) {
      throw new Error(
        `Wasm parser plan lexer fast spec ${fastSpec} for state ${state} is invalid.`,
      );
    }
    if (fastSpec < 0) {
      continue;
    }
    const candidateStart = readRowValue(
      planBytes,
      acceptCandidateRows,
      state,
    );
    const candidateEnd = readRowValue(
      planBytes,
      acceptCandidateRows,
      state + 1,
    );
    if (candidateEnd !== candidateStart + 1) {
      throw new Error(
        `Wasm parser plan lexer fast spec for state ${state} does not name a singleton candidate row.`,
      );
    }
    const candidate = readI32AtByteOffset(
      planBytes,
      acceptCandidates + candidateStart * I32_BYTES,
    );
    if (candidate !== fastSpec) {
      throw new Error(
        `Wasm parser plan lexer fast spec ${fastSpec} for state ${state} does not match candidate ${candidate}.`,
      );
    }
    const flags = readI32AtByteOffset(
      planBytes,
      specFlags + fastSpec * I32_BYTES,
    );
    const notFollowStart = readI32AtByteOffset(
      planBytes,
      specNotFollowStarts + fastSpec * I32_BYTES,
    );
    const wordStart = readRowValue(planBytes, specWordRows, fastSpec);
    const wordEnd = readRowValue(planBytes, specWordRows, fastSpec + 1);
    if ((flags & 6) !== 0 || notFollowStart >= 0 || wordStart !== wordEnd) {
      throw new Error(
        `Wasm parser plan lexer fast spec ${fastSpec} for state ${state} has a source guard.`,
      );
    }
  }
  const guardTransitionCount = readRowValue(
    planBytes,
    guardTransitionRows,
    guardStateCount,
  );
  validateSection(
    "contextual guard transitions",
    guardTransitions,
    checkedMul(
      guardTransitionCount,
      3 * I32_BYTES,
      "contextual guard transition byte length",
    ),
    coreByteLength,
  );
  for (let spec = 0; spec < specCount; spec++) {
    const flags = readI32AtByteOffset(
      planBytes,
      specFlags + spec * I32_BYTES,
    );
    if (flags < 0 || flags > 7) {
      throw new Error(
        `Wasm parser plan lexer spec ${spec} has invalid contextual flags ${flags}.`,
      );
    }
    const followStart = readI32AtByteOffset(
      planBytes,
      specFollowStarts + spec * I32_BYTES,
    );
    const notFollowStart = readI32AtByteOffset(
      planBytes,
      specNotFollowStarts + spec * I32_BYTES,
    );
    for (const guardStart of [followStart, notFollowStart]) {
      if (guardStart >= -1 && guardStart < guardStateCount) {
        continue;
      }
      throw new Error(
        `Wasm parser plan lexer spec ${spec} has invalid guard state ${guardStart}.`,
      );
    }
    const hasPositiveGuard = flags & 4;
    if (hasPositiveGuard !== 0 && followStart < 0) {
      throw new Error(
        `Wasm parser plan lexer spec ${spec} is missing its positive guard.`,
      );
    }
    if (hasPositiveGuard === 0 && followStart >= 0) {
      throw new Error(
        `Wasm parser plan lexer spec ${spec} has an unflagged positive guard.`,
      );
    }
    const contextual = flags & 1;
    if (contextual === 0) {
      if ((flags & 6) !== 0 || notFollowStart >= 0) {
        throw new Error(
          `Wasm parser plan ordinary lexer spec ${spec} has contextual guards.`,
        );
      }
    }
  }
  for (let index = 0; index < guardTransitionCount; index++) {
    const transitionOffset = guardTransitions + index * 3 * I32_BYTES;
    const start = readI32AtByteOffset(planBytes, transitionOffset);
    const end = readI32AtByteOffset(planBytes, transitionOffset + I32_BYTES);
    const target = readI32AtByteOffset(
      planBytes,
      transitionOffset + 2 * I32_BYTES,
    );
    const startIsScalar = start >= 0 && start <= 0x10ffff &&
      !(start >= 0xd800 && start <= 0xdfff);
    const endIsScalar = end >= 0 && end <= 0x10ffff &&
      !(end >= 0xd800 && end <= 0xdfff);
    if (!startIsScalar || !endIsScalar || start > end) {
      throw new Error(
        `Wasm parser plan contextual guard transition ${index} has an invalid range.`,
      );
    }
    if (target < 0 || target >= guardStateCount) {
      throw new Error(
        `Wasm parser plan contextual guard transition ${index} has invalid target ${target}.`,
      );
    }
  }
  const wordCount = readRowValue(planBytes, specWordRows, specCount);
  for (let spec = 0; spec < specCount; spec++) {
    const start = readRowValue(planBytes, specWordRows, spec);
    const end = readRowValue(planBytes, specWordRows, spec + 1);
    const flags = readI32AtByteOffset(
      planBytes,
      specFlags + spec * I32_BYTES,
    );
    if (start !== end && (flags & 1) === 0) {
      throw new Error(
        `Wasm parser plan ordinary lexer spec ${spec} has excluded words.`,
      );
    }
  }
  validateSection(
    "contextual excluded-word rows",
    wordRows,
    checkedMul(wordCount + 1, I32_BYTES, "excluded-word row byte length"),
    coreByteLength,
  );
  const decodedWordRows = { offset: wordRows, cellBytes: 4 as const };
  validateMonotonicRows(
    planBytes,
    decodedWordRows,
    wordCount + 1,
    "contextual excluded-word rows",
  );
  const wordCodePointCount = readRowValue(
    planBytes,
    decodedWordRows,
    wordCount,
  );
  validateSection(
    "contextual excluded-word code points",
    wordCodePoints,
    checkedMul(
      wordCodePointCount,
      I32_BYTES,
      "excluded-word code point byte length",
    ),
    coreByteLength,
  );
  for (let word = 0; word < wordCount; word++) {
    const start = readRowValue(planBytes, decodedWordRows, word);
    const end = readRowValue(planBytes, decodedWordRows, word + 1);
    if (start === end) {
      throw new Error(`Wasm parser plan excluded word ${word} is empty.`);
    }
    const first = readI32AtByteOffset(
      planBytes,
      wordCodePoints + start * I32_BYTES,
    );
    const validFirst = first >= 65 && first <= 90 ||
      first >= 97 && first <= 122 || first === 95;
    if (!validFirst) {
      throw new Error(
        `Wasm parser plan excluded word ${word} has an invalid first code point.`,
      );
    }
  }
  for (let index = 0; index < wordCodePointCount; index++) {
    const codePoint = readI32AtByteOffset(
      planBytes,
      wordCodePoints + index * I32_BYTES,
    );
    const validCodePoint = codePoint >= 65 && codePoint <= 90 ||
      codePoint >= 97 && codePoint <= 122 ||
      codePoint >= 48 && codePoint <= 57 || codePoint === 95;
    if (!validCodePoint) {
      throw new Error(
        `Wasm parser plan excluded-word code point ${codePoint} is invalid.`,
      );
    }
  }
  const transitionCount = readRowValue(
    planBytes,
    transitionRows,
    dfaStateCount,
  );
  validateSection(
    "transitions",
    transitions,
    checkedMul(
      checkedMul(transitionCount, 3, "transition i32 count"),
      I32_BYTES,
      "transition byte length",
    ),
    coreByteLength,
  );
  validateSection(
    "alphabet ASCII classes",
    alphabetAsciiClasses,
    checkedMul(
      ASCII_CLASS_LIMIT,
      I32_BYTES,
      "alphabet ASCII class byte length",
    ),
    coreByteLength,
  );
  validateSection(
    "alphabet ranges",
    alphabetRanges,
    checkedMul(
      checkedMul(alphabetRangeCount, 3, "alphabet range i32 count"),
      I32_BYTES,
      "alphabet range byte length",
    ),
    coreByteLength,
  );
  validateAlphabetPartition(
    planBytes,
    {
      dfaStateCount,
      asciiTransitions,
      transitionRows,
      transitions,
      classCount: alphabetClassCount,
      asciiClasses: alphabetAsciiClasses,
      ranges: alphabetRanges,
      rangeCount: alphabetRangeCount,
    },
  );
  return { coreByteLength, parserPlanVersion };
}

interface AlphabetPartitionInput {
  readonly dfaStateCount: number;
  readonly asciiTransitions: CompactSectionOffset | null;
  readonly transitionRows: CompactSectionOffset;
  readonly transitions: number;
  readonly classCount: number;
  readonly asciiClasses: number;
  readonly ranges: number;
  readonly rangeCount: number;
}

/**
 * Validates the persisted alphabet equivalence classes.
 *
 * The partition is the contract that makes a dense `(states x classes)`
 * transition table well defined, so a wrong partition would not corrupt the
 * shipping lexer - which reads the CSR rows - but would silently give a
 * class-table consumer different transitions. There is no cheaper way to catch
 * that than to check the defining property directly, so this recomputes the
 * per-segment target vectors from the CSR rows and requires every segment of a
 * class to agree with the first segment of that class.
 */
function validateAlphabetPartition(
  bytes: Uint8Array,
  input: AlphabetPartitionInput,
): void {
  const asciiClasses = new Int32Array(ASCII_CLASS_LIMIT);
  for (let codePoint = 0; codePoint < ASCII_CLASS_LIMIT; codePoint++) {
    const classId = readI32AtByteOffset(
      bytes,
      input.asciiClasses + codePoint * I32_BYTES,
    );
    if (classId < 0 || classId >= input.classCount) {
      throw new Error(
        `Wasm parser plan alphabet class ${classId} at code point ${codePoint} is out of range.`,
      );
    }
    asciiClasses[codePoint] = classId;
  }

  // Segment boundaries of the partition, in ascending order: ASCII runs first,
  // then the range list, which must tile [ASCII_CLASS_LIMIT, MAX_CODE_POINT].
  const segmentStarts: number[] = [0];
  const segmentEnds: number[] = [];
  const segmentClasses: number[] = [asciiClasses[0]];
  for (let codePoint = 1; codePoint < ASCII_CLASS_LIMIT; codePoint++) {
    if (asciiClasses[codePoint] === asciiClasses[codePoint - 1]) continue;
    segmentEnds.push(codePoint - 1);
    segmentStarts.push(codePoint);
    segmentClasses.push(asciiClasses[codePoint]);
  }
  segmentEnds.push(ASCII_CLASS_LIMIT - 1);

  let expectedStart = ASCII_CLASS_LIMIT;
  for (let index = 0; index < input.rangeCount; index++) {
    const base = input.ranges + index * 3 * I32_BYTES;
    const start = readI32AtByteOffset(bytes, base);
    const end = readI32AtByteOffset(bytes, base + I32_BYTES);
    const classId = readI32AtByteOffset(bytes, base + 2 * I32_BYTES);
    if (start !== expectedStart) {
      throw new Error(
        `Wasm parser plan alphabet range ${index} starts at ${start}, expected ${expectedStart}.`,
      );
    }
    if (end < start || end > MAX_CODE_POINT) {
      throw new Error(
        `Wasm parser plan alphabet range ${index} has an invalid end ${end}.`,
      );
    }
    if (classId < 0 || classId >= input.classCount) {
      throw new Error(
        `Wasm parser plan alphabet range ${index} has class ${classId}, which is out of range.`,
      );
    }
    if (index > 0 && segmentClasses[segmentClasses.length - 1] === classId) {
      throw new Error(
        `Wasm parser plan alphabet range ${index} repeats the previous class ${classId} instead of being coalesced.`,
      );
    }
    segmentStarts.push(start);
    segmentEnds.push(end);
    segmentClasses.push(classId);
    expectedStart = end + 1;
  }
  if (expectedStart !== MAX_CODE_POINT + 1) {
    throw new Error(
      `Wasm parser plan alphabet ranges stop at ${
        expectedStart - 1
      }, expected ${MAX_CODE_POINT}.`,
    );
  }

  // Every class must own at least one segment, and there are at most
  // ASCII_CLASS_LIMIT + rangeCount segments, so a larger classCount cannot
  // describe a partition. Checked before allocating anything sized by it: this
  // runs on caller-supplied plan bytes, where a declared count is an attacker's
  // free variable rather than a fact.
  const segmentCount = segmentStarts.length;
  if (input.classCount > segmentCount) {
    throw new Error(
      `Wasm parser plan declares ${input.classCount} alphabet classes but only ${segmentCount} segments, so some class covers no code points.`,
    );
  }

  const classSeen = new Uint8Array(input.classCount);
  for (const classId of segmentClasses) {
    classSeen[classId] = 1;
  }
  for (let classId = 0; classId < input.classCount; classId++) {
    if (classSeen[classId] === 0) {
      throw new Error(
        `Wasm parser plan alphabet class ${classId} covers no code points.`,
      );
    }
  }

  // Verifying the partition means checking, for every state, that all segments
  // of a class share a transition target. The obvious shape is a
  // segment-by-state matrix, but both dimensions grow with plan size, so that
  // is quadratic in the bytes a caller hands us: a valid 1.5 MB plan wanted
  // 14.7 GiB. Only one question is ever asked of that matrix - does this
  // segment agree with the first segment of its class - and one state at a
  // time answers it in O(classCount), because segments are walked in ascending
  // order so a class's first segment is always reached before its others.
  const firstSegmentOfClass = new Int32Array(input.classCount).fill(-1);
  for (let segment = 0; segment < segmentCount; segment++) {
    const classId = segmentClasses[segment];
    if (firstSegmentOfClass[classId] < 0) {
      firstSegmentOfClass[classId] = segment;
    }
  }

  // Work is still stateCount * segmentCount, which is inherent to the property
  // being checked. Bound it so a plan cannot buy unbounded validation time:
  // the shipped grammars sit near 10^4, and large-runtime near 5x10^4.
  const partitionWork = checkedMul(
    segmentCount,
    input.dfaStateCount,
    "alphabet partition work",
  );
  if (partitionWork > MAX_ALPHABET_PARTITION_WORK) {
    throw new Error(
      `Wasm parser plan alphabet partition needs ${partitionWork} segment-state checks, above the ${MAX_ALPHABET_PARTITION_WORK} limit.`,
    );
  }

  // Reference target per class for the state being walked, refilled each state.
  const classTarget = new Int32Array(input.classCount);
  for (let state = 0; state < input.dfaStateCount; state++) {
    const rowStart = readRowValue(bytes, input.transitionRows, state);
    const rowEnd = readRowValue(bytes, input.transitionRows, state + 1);
    let cursor = rowStart;
    let previousEnd = -1;
    for (let segment = 0; segment < segmentCount; segment++) {
      const start = segmentStarts[segment];
      let target = -1;
      if (
        start < ASCII_CLASS_LIMIT &&
        input.asciiTransitions !== null
      ) {
        target = readSignedTableValue(
          bytes,
          input.asciiTransitions,
          state * ASCII_CLASS_LIMIT + start,
        );
        if (target < -1 || target >= input.dfaStateCount) {
          throw new Error(
            `Wasm parser plan ASCII transition for state ${state} and code point ${start} targets ${target}.`,
          );
        }
        for (
          let codePoint = start + 1;
          codePoint <= segmentEnds[segment];
          codePoint++
        ) {
          const nextTarget = readSignedTableValue(
            bytes,
            input.asciiTransitions,
            state * ASCII_CLASS_LIMIT + codePoint,
          );
          if (nextTarget !== target) {
            throw new Error(
              `Wasm parser plan ASCII class segment [${start}, ${
                segmentEnds[segment]
              }] has targets ${target} and ${nextTarget} in state ${state}.`,
            );
          }
        }
      }
      while (
        (
          start >= ASCII_CLASS_LIMIT ||
          input.asciiTransitions === null
        ) &&
        cursor < rowEnd
      ) {
        const base = input.transitions + cursor * 3 * I32_BYTES;
        const rangeStart = readI32AtByteOffset(bytes, base);
        const rangeEnd = readI32AtByteOffset(bytes, base + I32_BYTES);
        if (
          input.asciiTransitions !== null &&
          rangeStart < ASCII_CLASS_LIMIT
        ) {
          throw new Error(
            `Wasm parser plan lexer state ${state} retains ASCII range [${rangeStart}, ${rangeEnd}] alongside a dense ASCII table.`,
          );
        }
        if (rangeStart > rangeEnd || rangeStart <= previousEnd) {
          throw new Error(
            `Wasm parser plan lexer state ${state} has transitions that are not ascending and disjoint.`,
          );
        }
        if (rangeEnd < start) {
          previousEnd = rangeEnd;
          cursor++;
          continue;
        }
        if (rangeStart <= start) {
          if (rangeEnd < segmentEnds[segment]) {
            throw new Error(
              `Wasm parser plan lexer state ${state} has a transition ending at ${rangeEnd} inside alphabet segment [${start}, ${
                segmentEnds[segment]
              }].`,
            );
          }
          target = readI32AtByteOffset(bytes, base + 2 * I32_BYTES);
          break;
        }
        if (rangeStart <= segmentEnds[segment]) {
          throw new Error(
            `Wasm parser plan lexer state ${state} has a transition starting at ${rangeStart} inside alphabet segment [${start}, ${
              segmentEnds[segment]
            }].`,
          );
        }
        break;
      }
      const classId = segmentClasses[segment];
      const first = firstSegmentOfClass[classId];
      if (segment === first) {
        classTarget[classId] = target;
        continue;
      }
      const expected = classTarget[classId];
      const actual = target;
      if (expected === actual) continue;
      throw new Error(
        `Wasm parser plan alphabet class ${classId} is not an equivalence class: lexer state ${state} goes to ${expected} on code point ${
          segmentStarts[first]
        } but to ${actual} on code point ${segmentStarts[segment]}.`,
      );
    }
  }
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

function readSignedTableValue(
  bytes: Uint8Array,
  section: CompactSectionOffset,
  index: number,
): number {
  const byteOffset = section.offset + index * section.cellBytes;
  if (section.cellBytes === 2) {
    return readI16AtByteOffset(bytes, byteOffset);
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

function readI16AtByteOffset(bytes: Uint8Array, byteOffset: number): number {
  if (byteOffset + 2 > bytes.byteLength) {
    throw new Error("Wasm parser plan is truncated.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getInt16(byteOffset, true);
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
