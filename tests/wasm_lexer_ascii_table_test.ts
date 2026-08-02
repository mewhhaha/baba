/**
 * Dense-eligible plans store ASCII transitions only in their authoritative
 * direct table. Their CSR rows begin at U+0080; plans too large for the dense
 * table retain complete CSR rows instead.
 */

import { assert, compile } from "./helpers.ts";
import type { Dfa } from "../src/compiler/regex/dfa.ts";
import { encodeCombinedWasmParserPlan } from "../src/runtime/wasm_plan.ts";
import {
  decodeLexerPlanTables,
  planTransition,
} from "../src/runtime/webgpu/plan_tables.ts";
import { emitWasmModule } from "../src/targets/runtime/wasm_core_runtime.ts";

/** Header slot holding the ASCII transition section, mirrored from lib.rs. */
const CORE_HEADER_ASCII_TRANSITIONS = 6;
const CORE_PLAN_HEADER_BYTES = 31 * 4;
/**
 * Largest DFA state count that still fits `buildAsciiTransitions`' 131072-cell
 * budget (`src/targets/runtime/wasm_core_runtime.ts`). At or below it a plan
 * must carry a dense table; above it the encoder legitimately emits none.
 */
const ASCII_DENSE_MAX_STATES = 131_072 / 128;
const COMPACT_I16_OFFSET_TAG = 2;
const COMPACT_U16_OFFSET_BASE = 0x4000_0000;

interface AsciiTable {
  /** Reads cell `index`, sign-extended exactly as the engine reads it. */
  readonly cell: (index: number) => number;
  readonly cellBytes: 2 | 4;
}

/**
 * Decodes the dense ASCII section the way the Rust engine reads it.
 *
 * The engine takes two different paths depending on the sign-tagged offset
 * encoding: a plain i32 array when the header value is non-negative, and a
 * *signed* i16 array when it is compact-tagged. The signedness matters and is
 * the reason this does not reuse `readRowValue` from `plan_tables.ts`, which
 * reads 2-byte cells as UNSIGNED because it only ever serves CSR row starts.
 * Reading -1 as 65535 here would make the comparison below vacuous.
 */
function decodeAsciiTable(planBytes: Uint8Array): AsciiTable | null {
  const view = new DataView(
    planBytes.buffer,
    planBytes.byteOffset,
    planBytes.byteLength,
  );
  const encoded = view.getInt32(CORE_HEADER_ASCII_TRANSITIONS * 4, true);
  if (encoded === 0) {
    throw new Error(
      "Plan ASCII transition slot is 0, which is never a valid encoding.",
    );
  }
  if (encoded === -1) {
    // The plan genuinely has no dense table (over 1024 DFA states). The engine
    // falls through to the sparse rows for every code point, so there is no
    // authority claim to check.
    return null;
  }
  if (encoded >= CORE_PLAN_HEADER_BYTES) {
    return {
      cell: (index) => view.getInt32(encoded + index * 4, true),
      cellBytes: 4,
    };
  }
  let offset: number;
  if (encoded <= -COMPACT_U16_OFFSET_BASE) {
    offset = -encoded - COMPACT_U16_OFFSET_BASE;
  } else if (encoded < -1) {
    offset = -encoded - COMPACT_I16_OFFSET_TAG;
  } else {
    throw new Error(
      `Plan ASCII transition slot ${encoded} is not a valid section offset.`,
    );
  }
  return {
    cell: (index) => view.getInt16(offset + index * 2, true),
    cellBytes: 2,
  };
}

const GRAMMAR_PATHS: readonly string[] = [
  "fixtures/ambiguous-types",
  "fixtures/comments-and-trivia",
  "fixtures/contextual-lexing",
  "fixtures/declarations",
  "fixtures/expressions",
  "fixtures/json-like",
  "fixtures/large-generated",
  "fixtures/markup-like",
  "fixtures/nullable-rules",
  "fixtures/overlapping-tokens",
  "fixtures/resource-limits",
  "fixtures/unicode",
  "fixtures/perf/error-heavy",
  "fixtures/perf/large-runtime",
  "fixtures/perf/parser/expression-heavy",
  "fixtures/perf/parser/normal-subset",
  "fixtures/perf/parser/tiny-dsl",
  "examples/brainfuck",
  "examples/funcfuck",
  "examples/thunkwasm",
];

function planBytesFor(directory: string): Uint8Array | null {
  const source = Deno.readTextFileSync(`${directory}/grammar.baba`);
  const result = compile(source, { targets: ["wasm"] });
  if (result.bundle === undefined) {
    return null;
  }
  const plan = result.bundle.files.find((file) =>
    file.path === "wasm/parser.plan"
  );
  if (plan === undefined) {
    return null;
  }
  assert(
    plan.encoding === "binary",
    `${directory}: wasm/parser.plan is encoded as "${plan.encoding}", not binary.`,
  );
  return plan.content;
}

Deno.test("dense ASCII plans keep only above-ASCII CSR transitions", () => {
  let grammarsChecked = 0;
  let denseEligible = 0;
  let denseTables = 0;
  let cellsChecked = 0;
  let sparseRangesChecked = 0;

  for (const directory of GRAMMAR_PATHS) {
    const planBytes = planBytesFor(directory);
    if (planBytes === null) {
      // A fixture that only exists to produce diagnostics has no plan. That is
      // a fact about the fixture, not a silent skip of a real grammar.
      continue;
    }
    grammarsChecked += 1;

    const tables = decodeLexerPlanTables(planBytes);
    const ascii = decodeAsciiTable(planBytes);
    if (tables.stateCount <= ASCII_DENSE_MAX_STATES) {
      denseEligible += 1;
      assert(
        ascii !== null,
        `${directory}: ${tables.stateCount} DFA states fit the dense ASCII budget, but the plan carries no dense table.`,
      );
    }
    if (ascii === null) {
      continue;
    }
    denseTables += 1;
    assert(
      tables.asciiTransitions !== null,
      `${directory}: plan decoder did not expose the dense ASCII table.`,
    );

    for (let state = 0; state < tables.stateCount; state += 1) {
      for (let codePoint = 0; codePoint < 128; codePoint += 1) {
        const dense = ascii.cell(state * 128 + codePoint);
        const decoded = tables.asciiTransitions[state * 128 + codePoint];
        assert(
          dense === decoded,
          `${directory}: decoded ASCII cell for state ${state} code point ${codePoint} is ${decoded}, expected ${dense}.`,
        );
        cellsChecked += 1;
      }
      const start = tables.transitionRows[state];
      const end = tables.transitionRows[state + 1];
      for (let index = start; index < end; index += 1) {
        const rangeStart = tables.transitions[index * 3];
        assert(
          rangeStart >= 128,
          `${directory}: state ${state} retains sparse ASCII range ${rangeStart}.`,
        );
        sparseRangesChecked += 1;
      }
    }
  }

  // Guards against the whole test quietly degrading into a no-op if the fixture
  // paths move or `compile` starts returning bundles without plans.
  assert(
    grammarsChecked >= 15,
    `Expected at least 15 compiling grammars, checked ${grammarsChecked}.`,
  );
  // Every grammar small enough for a dense table must have one. Grammars above
  // the encoder's cell budget are excluded deliberately: they carry no
  // authority claim, so demanding a table from them would fail a correct plan.
  assert(
    denseTables === denseEligible,
    `Expected every dense-eligible grammar to carry a dense ASCII table, got ${denseTables} of ${denseEligible}.`,
  );
  assert(
    denseEligible >= 15,
    `Expected at least 15 dense-eligible grammars, checked ${denseEligible}.`,
  );
  assert(
    cellsChecked > 0,
    `Expected dense ASCII cells to be decoded, checked ${cellsChecked}.`,
  );
  assert(
    sparseRangesChecked > 0,
    `Expected above-ASCII CSR ranges to be checked, checked ${sparseRangesChecked}.`,
  );
});

Deno.test("plans above the dense ASCII limit retain complete CSR transitions", () => {
  const stateCount = ASCII_DENSE_MAX_STATES + 1;
  const states: Dfa["states"][number][] = [];
  for (let id = 0; id < stateCount; id++) {
    const transitions: Array<{
      readonly start: number;
      readonly end: number;
      readonly target: number;
    }> = [];
    if (id === 0) {
      transitions.push({ start: 65, end: 65, target: 0 });
    }
    states.push({
      id,
      nfaStates: [],
      accepts: [],
      selectedAccept: null,
      transitions,
    });
  }
  const asciiClasses = new Array(128).fill(0);
  asciiClasses[65] = 1;
  const dfa: Dfa = {
    start: 0,
    states,
    alphabet: {
      classCount: 2,
      asciiClasses,
      aboveAsciiRanges: [{
        start: 128,
        end: 0x10ffff,
        classId: 0,
      }],
    },
  };
  const acceptCandidates: number[][] = [];
  for (let state = 0; state < stateCount; state++) {
    acceptCandidates.push([]);
  }
  const image = emitWasmModule(dfa, {
    acceptCandidates,
    specs: [{
      contextual: false,
      followedBy: undefined,
      followedByEof: false,
      notFollowedBy: undefined,
      excludedWords: [],
    }],
  });
  const plan = encodeCombinedWasmParserPlan(image.planBytes, {});
  const tables = decodeLexerPlanTables(plan);

  assert(tables.asciiTransitions === null);
  assert(tables.transitions[0] === 65);
  assert(planTransition(tables, 0, 65) === 0);
  assert(planTransition(tables, 0, 66) === -1);
});
