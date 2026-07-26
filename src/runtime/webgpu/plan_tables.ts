/**
 * Decode the lexer DFA out of an already-generated `parser.plan`.
 *
 * This is deliberately a *reader*, not a new build target: the WebGPU lexer
 * consumes exactly the artifact the Wasm runtime consumes. Nothing has to be
 * regenerated.
 *
 * The header constants and the sign-tagged compact-offset scheme are mirrored
 * from `src/runtime/wasm_plan.ts` (module-private there) and from the Rust
 * reader `src/targets/runtime/wasm_engine_rs/src/lib.rs`. Because the copy can
 * rot, `inspectCombinedWasmParserPlan` is called first: it validates the magic,
 * the core format version and the parser plan version, and throws otherwise.
 *
 * The duplication is deliberate and must stay. `src/runtime/wasm_plan.ts` is one
 * of the files hashed into the runtime-implementation manifest in
 * `src/targets/runtime/implementation.ts`; widening its exports to share
 * `readI32`, `readRowValue`, `decodeCompactOffset` or the `CORE_HEADER_*`
 * constants would move the runtime-implementation hash and break
 * `deno task bootstrap:check` and every generated manifest in the wild. An
 * experimental backend is not a good enough reason to churn that hash, so the
 * decoder is re-declared here and pinned by the version assertions below.
 */

import { inspectCombinedWasmParserPlan } from "../wasm_plan.ts";

const CORE_PLAN_HEADER_I32_COUNT = 31;
const CORE_PLAN_HEADER_BYTES = CORE_PLAN_HEADER_I32_COUNT * 4;

const CORE_HEADER_FORMAT_VERSION = 1;
const CORE_HEADER_PARSER_PLAN_VERSION = 2;
const CORE_HEADER_DFA_STATE_COUNT = 3;
const CORE_HEADER_ASCII_TRANSITIONS = 6;
const CORE_HEADER_TRANSITION_ROWS = 7;
const CORE_HEADER_TRANSITIONS = 8;
const CORE_HEADER_SPEC_COUNT = 14;
const CORE_HEADER_SPEC_TERMINALS = 16;
const CORE_HEADER_ACCEPT_CANDIDATE_ROWS = 17;
const CORE_HEADER_ACCEPT_CANDIDATES = 18;
const CORE_HEADER_SPEC_FLAGS = 21;
const CORE_HEADER_SPEC_FOLLOW_STARTS = 22;
const CORE_HEADER_SPEC_NOT_FOLLOW_STARTS = 23;
const CORE_HEADER_GUARD_STATE_COUNT = 24;
const CORE_HEADER_SPEC_WORD_ROWS = 28;

const COMPACT_I16_OFFSET_TAG = 2;
const COMPACT_U16_OFFSET_BASE = 0x4000_0000;

const EXPECTED_CORE_FORMAT_VERSION = 3;
const EXPECTED_PARSER_PLAN_VERSION = 2;

/**
 * The lexer DFA start state is NOT stored in the plan. `buildDfa`
 * (`src/compiler/regex/dfa.ts`) creates it with the first `addState()` call, so
 * it is always id 0, and the Rust `lex_all` hard-codes `let mut state = 0;`.
 * The GPU kernel hard-codes the same value.
 */
export const DFA_START_STATE = 0;

export interface CompactSection {
  readonly offset: number;
  readonly cellBytes: 2 | 4;
}

export interface LexerPlanTables {
  readonly stateCount: number;
  readonly specCount: number;
  /** CSR row starts into `transitions`, in units of triples. Length stateCount + 1. */
  readonly transitionRows: Int32Array;
  /** Flat (start, end, target) i32 triples. Length 3 * transitionCount. */
  readonly transitions: Int32Array;
  /**
   * Collapsed `selected_global_spec` for guard-free grammars: the first accept
   * candidate of each DFA state, or -1 when the state is non-accepting.
   * See `guardFree` — this collapse is only valid when it holds.
   */
  readonly acceptSpecByState: Int32Array;
  readonly specTerminals: Int32Array;
  readonly guardFree: boolean;
  readonly guardDiagnostics: readonly string[];
}

function headerI32(bytes: Uint8Array, headerIndex: number): number {
  if (headerIndex < 0 || headerIndex >= CORE_PLAN_HEADER_I32_COUNT) {
    throw new Error(`Plan header index ${headerIndex} is out of range.`);
  }
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .getInt32(headerIndex * 4, true);
}

function decodeCompactOffset(encoded: number, name: string): CompactSection {
  if (encoded <= -COMPACT_U16_OFFSET_BASE) {
    return { offset: -encoded - COMPACT_U16_OFFSET_BASE, cellBytes: 2 };
  }
  if (encoded < -1) {
    return { offset: -encoded - COMPACT_I16_OFFSET_TAG, cellBytes: 2 };
  }
  if (encoded < CORE_PLAN_HEADER_BYTES) {
    throw new Error(`Plan section "${name}" has invalid offset ${encoded}.`);
  }
  return { offset: encoded, cellBytes: 4 };
}

function readRowValue(
  bytes: Uint8Array,
  section: CompactSection,
  index: number,
): number {
  const byteOffset = section.offset + index * section.cellBytes;
  if (byteOffset + section.cellBytes > bytes.byteLength) {
    throw new Error(`Plan row read at ${byteOffset} is out of bounds.`);
  }
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (section.cellBytes === 2) {
    return data.getUint16(byteOffset, true);
  }
  return data.getInt32(byteOffset, true);
}

function readRows(
  bytes: Uint8Array,
  section: CompactSection,
  count: number,
): Int32Array {
  const out = new Int32Array(count);
  for (let index = 0; index < count; index += 1) {
    out[index] = readRowValue(bytes, section, index);
  }
  return out;
}

function readPlainI32Array(
  bytes: Uint8Array,
  byteOffset: number,
  length: number,
  name: string,
): Int32Array {
  if (byteOffset % 4 !== 0) {
    throw new Error(
      `Plan section "${name}" offset ${byteOffset} is not 4-aligned.`,
    );
  }
  if (byteOffset + length * 4 > bytes.byteLength) {
    throw new Error(`Plan section "${name}" runs past the end of the plan.`);
  }
  // Copy rather than alias: callers keep these tables past the lifetime of the
  // plan Uint8Array, and aliasing a subarray would silently break if the caller
  // ever passes a non-zero byteOffset view.
  return new Int32Array(
    bytes.buffer.slice(
      bytes.byteOffset + byteOffset,
      bytes.byteOffset + byteOffset + length * 4,
    ),
  );
}

export function decodeLexerPlanTables(planBytes: Uint8Array): LexerPlanTables {
  // Validates magic + versions and throws on mismatch. This is the guard that
  // keeps the duplicated header constants below honest.
  inspectCombinedWasmParserPlan(planBytes);

  const formatVersion = headerI32(planBytes, CORE_HEADER_FORMAT_VERSION);
  if (formatVersion !== EXPECTED_CORE_FORMAT_VERSION) {
    throw new Error(
      `Unsupported core plan format version ${formatVersion}; this experiment pins ${EXPECTED_CORE_FORMAT_VERSION}.`,
    );
  }
  const parserPlanVersion = headerI32(
    planBytes,
    CORE_HEADER_PARSER_PLAN_VERSION,
  );
  if (parserPlanVersion !== EXPECTED_PARSER_PLAN_VERSION) {
    throw new Error(
      `Unsupported parser plan version ${parserPlanVersion}; this experiment pins ${EXPECTED_PARSER_PLAN_VERSION}.`,
    );
  }

  const stateCount = headerI32(planBytes, CORE_HEADER_DFA_STATE_COUNT);
  if (stateCount <= 0) {
    throw new Error(`Plan reports ${stateCount} lexer DFA states.`);
  }
  const specCount = headerI32(planBytes, CORE_HEADER_SPEC_COUNT);
  if (specCount <= 0) {
    throw new Error(`Plan reports ${specCount} lexer specifications.`);
  }

  // Slot 7 is routed through the compact decoder (the validator does), slot 8 is
  // always a plain i32 offset. Mixing these up produces a garbage offset rather
  // than an error, so they are handled separately and explicitly.
  const transitionRowSection = decodeCompactOffset(
    headerI32(planBytes, CORE_HEADER_TRANSITION_ROWS),
    "lexer transition rows",
  );
  const transitionRows = readRows(
    planBytes,
    transitionRowSection,
    stateCount + 1,
  );
  const transitionCount = transitionRows[stateCount];
  const transitions = readPlainI32Array(
    planBytes,
    headerI32(planBytes, CORE_HEADER_TRANSITIONS),
    transitionCount * 3,
    "lexer transitions",
  );
  // The Rust `fn transition` range-checks `state` on every step, so a target
  // outside [0, stateCount) degrades there into "no transition". The GPU kernel
  // indexes a dense table directly and WGSL clamps out-of-bounds reads, so the
  // same plan would diverge silently instead of erroring. Reject it here.
  for (let index = 0; index < transitionCount; index += 1) {
    const target = transitions[index * 3 + 2];
    if (target < 0 || target >= stateCount) {
      throw new Error(
        `Lexer transition ${index} targets state ${target}, which is outside [0, ${stateCount}).`,
      );
    }
  }
  for (let state = 0; state < stateCount; state += 1) {
    const rowStart = transitionRows[state];
    const rowEnd = transitionRows[state + 1];
    if (rowStart < 0 || rowEnd < rowStart || rowEnd > transitionCount) {
      throw new Error(
        `Lexer transition row ${state} is [${rowStart}, ${rowEnd}), which is not a valid range within ${transitionCount} transitions.`,
      );
    }
  }

  const acceptRowSection = decodeCompactOffset(
    headerI32(planBytes, CORE_HEADER_ACCEPT_CANDIDATE_ROWS),
    "lexer accept candidate rows",
  );
  const acceptRows = readRows(planBytes, acceptRowSection, stateCount + 1);
  const acceptCandidateCount = acceptRows[stateCount];
  const acceptCandidates = readPlainI32Array(
    planBytes,
    headerI32(planBytes, CORE_HEADER_ACCEPT_CANDIDATES),
    acceptCandidateCount,
    "lexer accept candidates",
  );

  const specTerminals = readPlainI32Array(
    planBytes,
    headerI32(planBytes, CORE_HEADER_SPEC_TERMINALS),
    specCount,
    "lexer spec terminals",
  );
  const specFlags = readPlainI32Array(
    planBytes,
    headerI32(planBytes, CORE_HEADER_SPEC_FLAGS),
    specCount,
    "lexer spec flags",
  );
  const specFollowStarts = readPlainI32Array(
    planBytes,
    headerI32(planBytes, CORE_HEADER_SPEC_FOLLOW_STARTS),
    specCount,
    "lexer spec follow starts",
  );
  const specNotFollowStarts = readPlainI32Array(
    planBytes,
    headerI32(planBytes, CORE_HEADER_SPEC_NOT_FOLLOW_STARTS),
    specCount,
    "lexer spec not-follow starts",
  );
  const guardStateCount = headerI32(planBytes, CORE_HEADER_GUARD_STATE_COUNT);
  const specWordRowSection = decodeCompactOffset(
    headerI32(planBytes, CORE_HEADER_SPEC_WORD_ROWS),
    "lexer spec word rows",
  );
  const excludedWordCount = readRowValue(
    planBytes,
    specWordRowSection,
    specCount,
  );

  const guardDiagnostics: string[] = [];
  if (guardStateCount !== 0) {
    guardDiagnostics.push(`guard DFA has ${guardStateCount} states`);
  }
  if (excludedWordCount !== 0) {
    guardDiagnostics.push(`${excludedWordCount} excluded words are present`);
  }
  for (let spec = 0; spec < specCount; spec += 1) {
    if (specFlags[spec] !== 0) {
      guardDiagnostics.push(`spec ${spec} has flags ${specFlags[spec]}`);
    }
    if (specFollowStarts[spec] !== -1) {
      guardDiagnostics.push(`spec ${spec} has a positive lookahead guard`);
    }
    if (specNotFollowStarts[spec] !== -1) {
      guardDiagnostics.push(`spec ${spec} has a negative lookahead guard`);
    }
  }
  const guardFree = guardDiagnostics.length === 0;

  // `selected_global_spec` walks the accept-candidate row and returns the first
  // spec whose guard matches. With no guards at all, `spec_guard_matches` is
  // unconditionally true, so this collapses to "first candidate in the row".
  // Slot 5 (`CORE_HEADER_ACCEPTS` / selectedAccept) is deliberately NOT used:
  // the shipping Rust runtime never reads it.
  const acceptSpecByState = new Int32Array(stateCount).fill(-1);
  for (let state = 0; state < stateCount; state += 1) {
    const start = acceptRows[state];
    const end = acceptRows[state + 1];
    if (start < 0 || end < start || end > acceptCandidateCount) {
      throw new Error(
        `Lexer accept-candidate row ${state} is [${start}, ${end}), which is not a valid range within ${acceptCandidateCount} candidates.`,
      );
    }
    if (start < end) {
      const spec = acceptCandidates[start];
      if (spec < 0 || spec >= specCount) {
        throw new Error(
          `Lexer accept candidate ${start} names spec ${spec}, which is outside [0, ${specCount}).`,
        );
      }
      acceptSpecByState[state] = spec;
    }
  }

  const asciiEncoded = headerI32(planBytes, CORE_HEADER_ASCII_TRANSITIONS);
  if (asciiEncoded === 0) {
    throw new Error(
      "Plan ASCII transition slot is 0, which is never a valid encoding.",
    );
  }

  return {
    stateCount,
    specCount,
    transitionRows,
    transitions,
    acceptSpecByState,
    specTerminals,
    guardFree,
    guardDiagnostics,
  };
}

/**
 * Reference sparse-CSR transition lookup, mirroring `fn transition` in lib.rs.
 *
 * `-1` is the plan's own "no transition from this state on this codepoint"
 * value, so it is a fact rather than a default. A state id that is not in the
 * plan at all is a different thing and throws: the Rust reader degrades it into
 * "no transition" because it range-checks defensively on a hot path, but here it
 * can only mean the caller built a state id the plan never described.
 */
export function sparseTransition(
  tables: LexerPlanTables,
  state: number,
  codePoint: number,
): number {
  if (state < 0 || state >= tables.stateCount) {
    throw new Error(
      `Lexer DFA state ${state} is outside [0, ${tables.stateCount}).`,
    );
  }
  const lo = tables.transitionRows[state];
  const hi = tables.transitionRows[state + 1];
  for (let index = lo; index < hi; index += 1) {
    const base = index * 3;
    const start = tables.transitions[base];
    const end = tables.transitions[base + 1];
    if (codePoint >= start && codePoint <= end) {
      return tables.transitions[base + 2];
    }
  }
  return -1;
}
