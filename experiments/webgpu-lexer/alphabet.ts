/**
 * Alphabet equivalence classes for the lexer DFA, plus a dense
 * (states x classes) transition table.
 *
 * This prototypes, in userland, a compiler stage that would eventually belong in
 * `src/compiler/regex/dfa.ts`. `collectAlphabetSegments` there already computes
 * the segments transiently and then re-coalesces them away; nothing equivalent
 * is persisted in `parser.plan`, so the classes are rebuilt here from the sparse
 * CSR ranges.
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
 * transition" (dead). It replaces the CSR linear scan entirely; the equivalence
 * is exact because the CSR rows are disjoint and ascending.
 */

import type { LexerPlanTables } from "./plan_tables.ts";
import { sparseTransition } from "./plan_tables.ts";

export const CODE_POINT_LIMIT = 0x110000;
export const ASCII_LIMIT = 128;

export interface ClassRange {
  readonly start: number;
  /** Inclusive. */
  readonly end: number;
  readonly classId: number;
}

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

  // 1. Cut the codepoint space at every transition boundary.
  const cuts = new Set<number>();
  cuts.add(0);
  cuts.add(CODE_POINT_LIMIT);
  const tripleCount = tables.transitions.length / 3;
  for (let index = 0; index < tripleCount; index += 1) {
    const start = tables.transitions[index * 3];
    const end = tables.transitions[index * 3 + 1];
    if (start < 0 || end < start || end >= CODE_POINT_LIMIT) {
      throw new Error(
        `Lexer transition ${index} has a malformed range [${start}, ${end}].`,
      );
    }
    cuts.add(start);
    cuts.add(end + 1);
  }
  // Cut at the ASCII boundary too so no segment straddles it. This is what lets
  // the direct-mapped ASCII table and the range list be built independently.
  cuts.add(ASCII_LIMIT);
  const boundaries = [...cuts].sort((left, right) => left - right);

  // 2. For each segment, the full target vector across all states identifies the
  //    equivalence class.
  const classKeyToId = new Map<string, number>();
  const segmentClassId: number[] = [];
  const classTargets: Int32Array[] = [];
  for (let segment = 0; segment + 1 < boundaries.length; segment += 1) {
    const representative = boundaries[segment];
    const targets = new Int32Array(stateCount);
    for (let state = 0; state < stateCount; state += 1) {
      targets[state] = sparseTransition(tables, state, representative);
    }
    const key = targets.join(",");
    const existing = classKeyToId.get(key);
    if (existing === undefined) {
      const classId = classTargets.length;
      classKeyToId.set(key, classId);
      classTargets.push(targets);
      segmentClassId.push(classId);
      continue;
    }
    segmentClassId.push(existing);
  }
  const classCount = classTargets.length;
  if (classCount === 0) {
    throw new Error("Alphabet partition produced zero equivalence classes.");
  }

  // 3. Dense (state x class) table.
  const dense = new Int32Array(stateCount * classCount);
  for (let classId = 0; classId < classCount; classId += 1) {
    const targets = classTargets[classId];
    for (let state = 0; state < stateCount; state += 1) {
      dense[state * classCount + classId] = targets[state];
    }
  }

  // 4. ASCII direct-mapped table.
  const asciiClass = new Int32Array(ASCII_LIMIT).fill(-1);
  for (let segment = 0; segment + 1 < boundaries.length; segment += 1) {
    const start = boundaries[segment];
    const end = boundaries[segment + 1] - 1;
    if (start >= ASCII_LIMIT) {
      continue;
    }
    const clampedEnd = Math.min(end, ASCII_LIMIT - 1);
    for (let codePoint = start; codePoint <= clampedEnd; codePoint += 1) {
      asciiClass[codePoint] = segmentClassId[segment];
    }
  }
  for (let codePoint = 0; codePoint < ASCII_LIMIT; codePoint += 1) {
    if (asciiClass[codePoint] < 0) {
      throw new Error(
        `ASCII class table has a hole at codepoint ${codePoint}.`,
      );
    }
  }

  // 5. Above-ASCII range list, coalescing adjacent same-class segments.
  const aboveAsciiRanges: ClassRange[] = [];
  for (let segment = 0; segment + 1 < boundaries.length; segment += 1) {
    const start = Math.max(boundaries[segment], ASCII_LIMIT);
    const end = boundaries[segment + 1] - 1;
    if (end < start) {
      continue;
    }
    const classId = segmentClassId[segment];
    const last = aboveAsciiRanges[aboveAsciiRanges.length - 1];
    if (
      last !== undefined && last.classId === classId && last.end + 1 === start
    ) {
      aboveAsciiRanges[aboveAsciiRanges.length - 1] = {
        start: last.start,
        end,
        classId,
      };
      continue;
    }
    aboveAsciiRanges.push({ start, end, classId });
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
  for (let index = 1; index < aboveAsciiRanges.length; index += 1) {
    if (aboveAsciiRanges[index - 1].end + 1 !== aboveAsciiRanges[index].start) {
      throw new Error(
        `Above-ASCII range list has a gap before index ${index}.`,
      );
    }
  }

  const classRanges: ClassRange[][] = [];
  for (let classId = 0; classId < classCount; classId += 1) {
    classRanges.push([]);
  }
  for (let segment = 0; segment + 1 < boundaries.length; segment += 1) {
    const classId = segmentClassId[segment];
    classRanges[classId].push({
      start: boundaries[segment],
      end: boundaries[segment + 1] - 1,
      classId,
    });
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

/**
 * Exhaustive-ish verification that the dense class table agrees with the sparse
 * CSR table the shipping runtime uses. Checks every ASCII codepoint plus every
 * range boundary (and its neighbours) above ASCII, for every state.
 */
export function verifyAlphabetAgainstSparse(
  tables: LexerPlanTables,
  alphabet: AlphabetTables,
): { checked: number; mismatches: number } {
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
  for (const codePoint of probes) {
    if (codePoint < 0 || codePoint >= CODE_POINT_LIMIT) {
      continue;
    }
    const classId = classifyCodePoint(alphabet, codePoint);
    for (let state = 0; state < tables.stateCount; state += 1) {
      const expected = sparseTransition(tables, state, codePoint);
      const actual = alphabet.dense[state * alphabet.classCount + classId];
      checked += 1;
      if (expected !== actual) {
        mismatches += 1;
      }
    }
  }
  return { checked, mismatches };
}
