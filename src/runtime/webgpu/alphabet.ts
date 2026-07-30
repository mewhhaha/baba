/**
 * Alphabet equivalence classes for the lexer DFA, plus a dense
 * (states x classes) transition table.
 *
 * The classes are no longer derived here. `computeDfaAlphabet` in
 * `src/compiler/regex/dfa.ts` computes them, core plan format version 7
 * persists them, and this module reads them back. What is still built at load
 * time is the dense `(states x classes)` table, which is deliberately not in
 * the plan: it is a pure function of the persisted classes and transition
 * sections and would duplicate those sections.
 *
 * ## Why this shape for the codepoint -> class lookup
 *
 * The GPU inner loop executes one classify + one table read per input codepoint,
 * so the classifier is the hottest code in the kernel. The layout chosen is:
 *
 *   1. a direct-mapped `i32[128]` table for U+0000..U+007F, and
 *   2. a sorted, gap-free `(start, end, class)` range list covering
 *      U+0080..U+10FFFF, searched with a branch-only binary search.
 *
 * Rationale:
 *
 *   - Real source is overwhelmingly ASCII, so the common path is a single
 *     indexed load out of workgroup shared memory with no branching and no
 *     divergence inside a subgroup. A pure range search would cost
 *     log2(rangeCount) dependent loads on *every* codepoint.
 *   - A fully direct-mapped table over the whole codepoint space would be 4 MiB
 *     and would not fit anywhere useful.
 *   - The range list must still be exact: `feature-tour` has a class
 *     (U+2028..U+2029) that exists *only* above ASCII, and `brainfuck` /
 *     `feature-tour` have negated character classes whose "catch-all" class is
 *     live rather than dead. So the fallback is a real search, not a constant.
 *   - The range list is gap-free by construction (it is emitted from the same
 *     segment partition), which removes the "not found" branch from the search.
 *
 * The dense table is `stateCount * classCount` i32, with -1 meaning "no
 * transition" (dead). It replaces plan transition lookup entirely in the
 * kernel; the persisted alphabet makes the result exact.
 */

import type { LexerPlanTables, PlanClassRange } from "./plan_tables.ts";
import {
  ASCII_CLASS_LIMIT as ASCII_LIMIT,
  CODE_POINT_LIMIT,
  planTransition,
} from "./plan_tables.ts";

export { ASCII_LIMIT, CODE_POINT_LIMIT };

export type ClassRange = PlanClassRange;

export interface AlphabetTables {
  readonly classCount: number;
  readonly stateCount: number;
  /** Length 128; class id for each ASCII codepoint. */
  readonly asciiClass: Int32Array;
  /** Sorted, gap-free ranges covering [128, 0x10FFFF]. */
  readonly aboveAsciiRanges: readonly ClassRange[];
  /** Length stateCount * classCount; target state or -1. */
  readonly dense: Int32Array;
  /** Full class -> ranges map, for diagnostics only. */
  readonly classRanges: readonly (readonly ClassRange[])[];
}

export function buildAlphabetTables(tables: LexerPlanTables): AlphabetTables {
  const { stateCount } = tables;
  const { classCount, asciiClass, aboveAsciiRanges } = tables.alphabet;

  // 1. Re-check the structural invariants the GPU classifier relies on. The
  //    plan validator already enforces these, but this module is the parity
  //    gate's own reader and a violation here would be a silent wrong answer
  //    rather than an error.
  for (let codePoint = 0; codePoint < ASCII_LIMIT; codePoint += 1) {
    const classId = asciiClass[codePoint];
    if (classId < 0 || classId >= classCount) {
      throw new Error(
        `ASCII class table names class ${classId} at codepoint ${codePoint}, which is outside [0, ${classCount}).`,
      );
    }
  }
  if (aboveAsciiRanges.length === 0) {
    throw new Error("Above-ASCII range list is empty; expected full coverage.");
  }
  if (aboveAsciiRanges[0].start !== ASCII_LIMIT) {
    throw new Error("Above-ASCII range list does not start at U+0080.");
  }
  if (
    aboveAsciiRanges[aboveAsciiRanges.length - 1].end !== CODE_POINT_LIMIT - 1
  ) {
    throw new Error("Above-ASCII range list does not end at U+10FFFF.");
  }
  for (let index = 0; index < aboveAsciiRanges.length; index += 1) {
    const range = aboveAsciiRanges[index];
    if (range.classId < 0 || range.classId >= classCount) {
      throw new Error(
        `Above-ASCII range ${index} names class ${range.classId}, which is outside [0, ${classCount}).`,
      );
    }
    if (range.end < range.start) {
      throw new Error(`Above-ASCII range ${index} is inverted.`);
    }
    if (index > 0 && aboveAsciiRanges[index - 1].end + 1 !== range.start) {
      throw new Error(
        `Above-ASCII range list has a gap before index ${index}.`,
      );
    }
  }

  // 2. Every class, and one representative codepoint for it. The representative
  //    is a fact about the persisted partition rather than a choice: any member
  //    of a class gives the same column, which is what makes it a class.
  const representative = new Int32Array(classCount).fill(-1);
  const classRanges: ClassRange[][] = [];
  for (let classId = 0; classId < classCount; classId += 1) {
    classRanges.push([]);
  }
  let runStart = 0;
  for (let codePoint = 1; codePoint <= ASCII_LIMIT; codePoint += 1) {
    if (
      codePoint < ASCII_LIMIT && asciiClass[codePoint] === asciiClass[runStart]
    ) {
      continue;
    }
    const classId = asciiClass[runStart];
    classRanges[classId].push({ start: runStart, end: codePoint - 1, classId });
    if (representative[classId] < 0) {
      representative[classId] = runStart;
    }
    runStart = codePoint;
  }
  for (const range of aboveAsciiRanges) {
    classRanges[range.classId].push(range);
    if (representative[range.classId] < 0) {
      representative[range.classId] = range.start;
    }
  }
  for (let classId = 0; classId < classCount; classId += 1) {
    if (representative[classId] < 0) {
      throw new Error(
        `Alphabet class ${classId} covers no codepoint in the persisted partition.`,
      );
    }
  }

  // 3. Dense (state x class) table, filled from the plan at one codepoint
  //    per class. It is derivable in exactly this many lookups.
  const dense = new Int32Array(stateCount * classCount);
  for (let classId = 0; classId < classCount; classId += 1) {
    const codePoint = representative[classId];
    for (let state = 0; state < stateCount; state += 1) {
      dense[state * classCount + classId] = planTransition(
        tables,
        state,
        codePoint,
      );
    }
  }

  return {
    classCount,
    stateCount,
    asciiClass,
    aboveAsciiRanges,
    dense,
    classRanges,
  };
}

/** Host-side classifier with exactly the semantics the WGSL classifier implements. */
export function classifyCodePoint(
  alphabet: AlphabetTables,
  codePoint: number,
): number {
  if (codePoint < ASCII_LIMIT) {
    return alphabet.asciiClass[codePoint];
  }
  const ranges = alphabet.aboveAsciiRanges;
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (codePoint < ranges[mid].start) {
      high = mid - 1;
      continue;
    }
    if (codePoint > ranges[mid].end) {
      low = mid + 1;
      continue;
    }
    return ranges[mid].classId;
  }
  throw new Error(`Codepoint ${codePoint} is not covered by the range list.`);
}

export interface AlphabetMismatch {
  readonly codePoint: number;
  readonly classId: number;
  readonly state: number;
  /** Target state the plan's dense-ASCII/CSR lookup gives. */
  readonly planTarget: number;
  /** Target state the dense (state x class) table gives. */
  readonly denseTarget: number;
}

export interface AlphabetVerification {
  readonly checked: number;
  readonly mismatches: number;
  /** The first disagreement, so a failure names a cell rather than a count. */
  readonly firstMismatch: AlphabetMismatch | null;
}

/**
 * Exhaustive-ish verification that the dense class table agrees with the plan
 * transitions the shipping runtime uses. Checks every ASCII codepoint plus
 * every range boundary (and its neighbours) above ASCII, for every state.
 *
 * This returns a structured result rather than throwing because the caller is a
 * gate that wants to report the cell, not a subsystem boundary that wants to
 * abort.
 */
export function verifyAlphabetAgainstPlan(
  tables: LexerPlanTables,
  alphabet: AlphabetTables,
): AlphabetVerification {
  const probes = new Set<number>();
  for (let codePoint = 0; codePoint < ASCII_LIMIT; codePoint += 1) {
    probes.add(codePoint);
  }
  for (const range of alphabet.aboveAsciiRanges) {
    probes.add(range.start);
    probes.add(range.end);
    if (range.start > 0) {
      probes.add(range.start - 1);
    }
    if (range.end + 1 < CODE_POINT_LIMIT) {
      probes.add(range.end + 1);
    }
  }
  probes.add(0xd7ff);
  probes.add(0xd800);
  probes.add(0xdfff);
  probes.add(0xe000);
  probes.add(0xffff);
  probes.add(0x10000);
  probes.add(CODE_POINT_LIMIT - 1);

  let checked = 0;
  let mismatches = 0;
  let firstMismatch: AlphabetMismatch | null = null;
  for (const codePoint of probes) {
    if (codePoint < 0 || codePoint >= CODE_POINT_LIMIT) {
      continue;
    }
    const classId = classifyCodePoint(alphabet, codePoint);
    for (let state = 0; state < tables.stateCount; state += 1) {
      const planTarget = planTransition(tables, state, codePoint);
      const denseTarget = alphabet.dense[state * alphabet.classCount + classId];
      checked += 1;
      if (planTarget === denseTarget) {
        continue;
      }
      mismatches += 1;
      if (firstMismatch === null) {
        firstMismatch = {
          codePoint,
          classId,
          state,
          planTarget,
          denseTarget,
        };
      }
    }
  }
  return { checked, mismatches, firstMismatch };
}
