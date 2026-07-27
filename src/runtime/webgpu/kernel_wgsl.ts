/**
 * WGSL compute kernels for the parallel lexer.
 *
 * ## Why this structure
 *
 * The brief suggested a chunked *speculative* scan (one thread per candidate DFA
 * start state) followed by a chunk-entry fixup. That is the right shape for a
 * plain DFA, but `lex_all` is not a plain DFA: it does longest-match with
 * *restart*, i.e. `offset := best_end` where `best_end` can be strictly less
 * than the position where the forward scan died. Composing per-chunk
 * `state -> state` maps therefore does not reproduce token boundaries at all.
 *
 * A simpler structure exists and is used here. Observe that the *entire* outer
 * loop state of `lex_all` is a single integer: `offset`. Everything else
 * (`state`, `best_*`) is reset at the top of every token. So:
 *
 *   next(p) = the offset `lex_all` would move to if it started a token at p
 *
 * is a total function of p alone, computable independently for every p. The
 * token stream is exactly the orbit `0 -> next(0) -> next(next(0)) -> ...`, and
 * the record emitted at p is fully determined by p.
 *
 * The hard part is computing `next(p)` for every p in bounded time. A direct
 * forward scan out of every offset costs O(length of the scan out of p), which
 * is ~2.5 code units on ordinary source but O(n) on input that is one huge
 * token, making the whole pass O(n^2). That is what PASS X/Y/Z exist to avoid.
 *
 *   PASS X  one workgroup per SEG_SIZE-unit segment, one thread per DFA state.
 *           Sweeps the segment BACKWARD maintaining, for every entry state q,
 *             E_p[q] = (exitState, lastAccept) of the run that enters position p
 *                      in state q and stops at the segment end (or at death).
 *           Emits E_p[0] for every p, and the segment element M_k = E_segStart.
 *           Cost is n*S transitions and does not depend on token length.
 *   PASS Y  suffix scan over the segment elements: F_k = M_k . F_{k+1}, in place.
 *   PASS Z  one thread per offset: next(p) = compose(E_p[0], F_{k+1}), plus the
 *           packed (specIndex, acceptingState) record. Restores `next` as a
 *           function of position alone, which is what PASS B needs.
 *   PASS B  one workgroup per chunk (grid-strided): guarded pointer-doubling in
 *           shared memory to get exit(p) = first orbit position >= chunkEnd, for
 *           every p. log2(chunkSize) rounds, entirely in LDS.
 *   PASS C  one thread, serial over chunks: entry(k) = the true orbit position
 *           at which chunk k is entered. Only numChunks dependent loads.
 *   PASS D  one thread per chunk: walk entry(k) .. chunkEnd counting tokens.
 *   PASS E  two-level exclusive prefix sum over the per-chunk counts.
 *   PASS F  one thread per chunk: walk again, writing the 4 x i32 records at
 *           the scanned offset.
 *
 * All nine stages are dispatches inside a single command encoder, so the whole
 * lex is ONE queue.submit() and ONE mapAsync(). No CPU is in the loop.
 *
 * ## Why PASS X composes and a capped forward scan does not
 *
 * Adjoin an absorbing DEAD state. A segment's element is the pair
 * `(phi: State -> State, alpha: State -> Accept_or_none)` where `alpha(q)` is
 * the last accept the segment produces when entered in state q. Composition is
 * function composition in the first component and "last non-none wins" in the
 * second, which is associative. DEAD being absorbing and non-accepting is what
 * makes "stop at death" and "run to the segment end and ignore the tail" the
 * same thing.
 *
 * The obstacle to simply capping the forward scan at L units and continuing
 * later is not associativity, it is the *index set*. PASS B doubles pointers:
 * `J[p] := J[J[p]]`, which is only meaningful when the array is indexed by the
 * same set its values live in. A capped scan's continuation lives in
 * `position x state`, not `position`: the entry stored at `p+L` continues the
 * run that STARTED at `p+L` in state 0, while the run started at p needs the
 * continuation from `p+L` in whatever state that run reached. Those are
 * different runs. Storing one slot per `(position, state)` would need `8*n*S`
 * bytes - 10.8 GB at 16 MiB with an 81-state DFA - and a `2*chunkSize*S` u32
 * LDS array in PASS B. PASS X materializes the same information at *segment*
 * granularity instead, which is `(n/SEG_SIZE)*S` and fits.
 *
 * The redundant work that remains is bounded and cheap: PASS Z computes next(p)
 * at every offset including the ones that are not token starts, and PASS D/F
 * walk the orbit twice. That is a constant factor, not an asymptotic cost, and
 * it buys exactness - the emitted records are `lex_all`'s records, including
 * backtracking, error tokens and surrogate widths.
 */

import type { AlphabetTables } from "./alphabet.ts";
import type { LexerPlanTables } from "./plan_tables.ts";

/**
 * Preferred chunk size. `pass_b` needs `2 * CHUNK_SIZE` u32 of workgroup storage
 * (8 bytes per unit), so this is only usable when the device offers at least
 * 32 KiB. The WebGPU-guaranteed floor is 16 KiB, so the chunk size is chosen per
 * device by `chooseChunkLog2` rather than hard-coded.
 */
export const PREFERRED_CHUNK_LOG2 = 12;
export const MIN_CHUNK_LOG2 = 8;
export const PASS_B_WORKGROUP = 256;
export const PASS_Z_WORKGROUP = 256;
export const SCAN_WORKGROUP = 256;
/**
 * Segment size for `pass_x`, as a power of two. Deliberately NOT tied to the
 * chunk size: unlike `pass_b`, `pass_x` keeps only four rotating state columns
 * in workgroup storage, so its LDS footprint does not depend on this at all and
 * a floor device does not have to shrink it.
 *
 * Measured at 16 MiB of randomized funcfuck source (pass_x + pass_y + pass_z):
 * 1024 -> 13.74 ms, 2048 -> 10.40 ms, 4096 -> 9.50 ms, 8192 -> 9.48 ms. Below
 * 4096 the single-workgroup `pass_y` scan dominates; above it the return
 * flattens while the per-workgroup serial chain grows.
 */
export const SEG_LOG2 = 12;
export const SEG_SIZE = 1 << SEG_LOG2;
/**
 * `pass_x` packs the last-accept offset relative to the segment's nominal base
 * into 16 bits. That offset can be one unit past the nominal end when a
 * surrogate pair straddles the boundary, so the usable ceiling is 65534.
 */
export const MAX_SEG_SIZE = 65534;
/** Largest `@workgroup_size` any entry point in this kernel declares. */
export const MAX_WORKGROUP_INVOCATIONS = 256;
/** Storage bindings the single bind group declares (2 read-only + 5 read-write). */
export const STORAGE_BINDING_COUNT = 7;
/** u32 per (segment, state) in the segment-summary region of `aux`. */
export const SEG_SUMMARY_U32_PER_STATE = 3;

/** Workgroup storage `pass_b` needs for a given chunk size, in bytes. */
export function passBWorkgroupBytes(chunkLog2: number): number {
  return 2 * (1 << chunkLog2) * 4;
}

/**
 * Threads per `pass_x` / `pass_y` workgroup: one per DFA state, rounded up to a
 * whole 32-lane group and capped at `MAX_WORKGROUP_INVOCATIONS`. Above the cap
 * each thread carries `passXStatesPerThread` states instead, so a large DFA
 * costs more time rather than becoming unsupported.
 */
export function passXWorkgroup(stateCount: number): number {
  if (stateCount <= 0) {
    throw new Error(
      `pass_x needs at least one DFA state; the plan reports ${stateCount}.`,
    );
  }
  const rounded = Math.ceil(stateCount / 32) * 32;
  if (rounded > MAX_WORKGROUP_INVOCATIONS) {
    return MAX_WORKGROUP_INVOCATIONS;
  }
  return rounded;
}

/**
 * Workgroup storage `pass_x` needs: the DFA tables plus four rotating columns of
 * two u32 per state. Independent of `SEG_SIZE`.
 */
export function passXWorkgroupBytes(
  stateCount: number,
  classCount: number,
): number {
  const tableWords = 128 + stateCount + stateCount * classCount;
  return tableWords * 4 + 8 * stateCount * 4;
}

/** Workgroup storage `pass_y` needs: three u32 per state. */
export function passYWorkgroupBytes(stateCount: number): number {
  return 3 * stateCount * 4;
}

/**
 * Largest chunk size whose `pass_b` LDS fits the device limit, capped at the
 * tuned preference. Throws rather than silently emitting a kernel the device
 * cannot run - wgpu does not validate workgroup storage at pipeline creation, so
 * an over-limit kernel would be accepted here and rejected on a conformant
 * implementation.
 */
export function chooseChunkLog2(
  maxComputeWorkgroupStorageSize: number,
): number {
  for (
    let log2 = PREFERRED_CHUNK_LOG2;
    log2 >= MIN_CHUNK_LOG2;
    log2 -= 1
  ) {
    if (passBWorkgroupBytes(log2) <= maxComputeWorkgroupStorageSize) {
      return log2;
    }
  }
  throw new Error(
    `Device reports maxComputeWorkgroupStorageSize=${maxComputeWorkgroupStorageSize} B; ` +
      `pass_b needs at least ${
        passBWorkgroupBytes(MIN_CHUNK_LOG2)
      } B for the smallest supported chunk size (2^${MIN_CHUNK_LOG2}).`,
  );
}

export const AUX_TOTAL_COUNT = 0;
export const AUX_OVERFLOW = 1;
export const AUX_HEADER_U32 = 4;

export interface PackedTables {
  /** i32 words uploaded as the `tables` storage buffer. */
  readonly words: Int32Array;
  readonly asciiOffset: number;
  readonly acceptOffset: number;
  /**
   * Offset of the dense transition table, stored TRANSPOSED as `[class][state]`.
   * `pass_x` runs one thread per state and reads `dense[cls * stateCount + q]`,
   * so consecutive threads must read consecutive words; a `[state][class]`
   * layout would make every one of those reads a 32-way LDS bank conflict.
   */
  readonly denseOffset: number;
  readonly rangesOffset: number;
  readonly rangeCount: number;
  readonly stateCount: number;
  /** DFA start state, read from the plan header rather than assumed to be 0. */
  readonly startState: number;
  readonly classCount: number;
  readonly workgroupTableBytes: number;
}

export function packTables(
  plan: LexerPlanTables,
  alphabet: AlphabetTables,
): PackedTables {
  if (plan.stateCount > 0xfffe) {
    throw new Error(
      `DFA has ${plan.stateCount} states; the packed record format supports at most 65534.`,
    );
  }
  if (plan.specCount > 0xfffe) {
    throw new Error(
      `Plan has ${plan.specCount} lexer specs; the packed record format supports at most 65534.`,
    );
  }

  const asciiOffset = 0;
  const acceptOffset = asciiOffset + 128;
  const denseOffset = acceptOffset + plan.stateCount;
  const denseLength = plan.stateCount * alphabet.classCount;
  const rangesOffset = denseOffset + denseLength;
  const rangeCount = alphabet.aboveAsciiRanges.length;

  const words = new Int32Array(rangesOffset + rangeCount * 3);
  words.set(alphabet.asciiClass, asciiOffset);
  words.set(plan.acceptSpecByState, acceptOffset);
  for (let state = 0; state < plan.stateCount; state += 1) {
    for (let classId = 0; classId < alphabet.classCount; classId += 1) {
      words[denseOffset + classId * plan.stateCount + state] =
        alphabet.dense[state * alphabet.classCount + classId];
    }
  }
  for (let index = 0; index < rangeCount; index += 1) {
    const range = alphabet.aboveAsciiRanges[index];
    words[rangesOffset + index * 3] = range.start;
    words[rangesOffset + index * 3 + 1] = range.end;
    words[rangesOffset + index * 3 + 2] = range.classId;
  }

  const workgroupTableBytes = (128 + plan.stateCount + denseLength) * 4;
  return {
    words,
    asciiOffset,
    acceptOffset,
    denseOffset,
    rangesOffset,
    rangeCount,
    stateCount: plan.stateCount,
    startState: plan.startState,
    classCount: alphabet.classCount,
    workgroupTableBytes,
  };
}

export function buildKernelSource(
  packed: PackedTables,
  chunkLog2: number,
  maxComputeWorkgroupStorageSize: number,
): string {
  const denseLength = packed.stateCount * packed.classCount;
  const CHUNK_SIZE = 1 << chunkLog2;
  if (SEG_SIZE > MAX_SEG_SIZE) {
    throw new Error(
      `pass_x stores the last-accept offset relative to the segment base in 16 bits, ` +
        `so SEG_SIZE must be at most ${MAX_SEG_SIZE}; it is ${SEG_SIZE}.`,
    );
  }
  // PASS X keeps the whole DFA + classifier in workgroup shared memory plus four
  // rotating state columns. PASS B needs 2 * CHUNK_SIZE u32. Each entry point's
  // requirement is checked against the device limit that was actually requested,
  // not against a constant chosen on one adapter.
  const passXBytes = passXWorkgroupBytes(packed.stateCount, packed.classCount);
  if (passXBytes > maxComputeWorkgroupStorageSize) {
    throw new Error(
      `pass_x needs ${passXBytes} B of workgroup storage: the DFA tables ` +
        `(128 + stateCount ${packed.stateCount} + stateCount*classCount ${denseLength} i32) ` +
        `plus four rotating columns of two u32 per state (${
          8 * packed.stateCount * 4
        } B); this device reports maxComputeWorkgroupStorageSize=${maxComputeWorkgroupStorageSize} B. ` +
        `A storage-buffer fallback for the DFA tables is not implemented.`,
    );
  }
  const passYBytes = passYWorkgroupBytes(packed.stateCount);
  if (passYBytes > maxComputeWorkgroupStorageSize) {
    throw new Error(
      `pass_y needs ${passYBytes} B of workgroup storage for ${packed.stateCount} states; ` +
        `this device reports maxComputeWorkgroupStorageSize=${maxComputeWorkgroupStorageSize} B.`,
    );
  }
  const passBBytes = passBWorkgroupBytes(chunkLog2);
  if (passBBytes > maxComputeWorkgroupStorageSize) {
    throw new Error(
      `pass_b needs ${passBBytes} B of workgroup storage for chunk size ${CHUNK_SIZE}; ` +
        `this device reports maxComputeWorkgroupStorageSize=${maxComputeWorkgroupStorageSize} B.`,
    );
  }
  const scanBytes = SCAN_WORKGROUP * 4;
  if (scanBytes > maxComputeWorkgroupStorageSize) {
    throw new Error(
      `pass_e1 needs ${scanBytes} B of workgroup storage; this device reports ` +
        `maxComputeWorkgroupStorageSize=${maxComputeWorkgroupStorageSize} B.`,
    );
  }

  const passXWg = passXWorkgroup(packed.stateCount);
  // States each `pass_x` thread carries. 1 for every DFA with at most
  // MAX_WORKGROUP_INVOCATIONS states, which is all four shipped grammars.
  const statesPerThread = Math.ceil(packed.stateCount / passXWg);
  const stateSlots: number[] = [];
  for (let slot = 0; slot < statesPerThread; slot += 1) {
    stateSlots.push(slot);
  }

  // The per-state carry is emitted as one unrolled block per slot with a literal
  // index, rather than as a `for` loop over an `array<u32, N>`. Measured on
  // wgpu/NVIDIA at 16 MiB of randomized funcfuck source: the loop-over-array
  // form runs pass_x in 10.67 ms and this form in 8.10 ms, because a
  // dynamically indexed private array does not get promoted to registers.
  // statesPerThread is 1 for every DFA with at most 256 states, which is all
  // four shipped grammars.
  const passXCompute = stateSlots.map((slot) =>
    `      {
        let q = li + ${slot}u * PASS_X_WG;
        w0_${slot} = DEAD;
        w1_${slot} = 0u;
        if (q < STATE_COUNT) {
          let nextState = wgDense[cls * STATE_COUNT + q];
          if (nextState >= 0) {
            let t = u32(nextState);
            // Identity element when the run leaves the segment alive in state t.
            var nw0: u32 = t;
            var nw1: u32 = 0u;
            if (np < limit) {
              nw0 = col[nextSlot * STATE_COUNT + t];
              nw1 = col[(nextSlot + 1u) * STATE_COUNT + t];
            }
            if ((nw1 >> 16u) != 0u) {
              // A later accept exists in the suffix, and the later one wins.
              w0_${slot} = nw0;
              w1_${slot} = nw1;
            } else {
              let sp = wgAccept[t];
              if (sp >= 0) {
                w0_${slot} = (nw0 & 0xFFFFu) | ((t + 1u) << 16u);
                w1_${slot} = (np - nominal) | ((u32(sp) + 1u) << 16u);
              } else {
                w0_${slot} = nw0 & 0xFFFFu;
                w1_${slot} = 0u;
              }
            }
          }
        }
      }`
  ).join("\n");

  const passYCompute = stateSlots.map((slot) =>
    `      {
        let q = li + ${slot}u * PASS_X_WG;
        r0_${slot} = 0u;
        r1_${slot} = 0u;
        r2_${slot} = 0u;
        if (q < STATE_COUNT) {
          let o = params.segSumOff + (k * STATE_COUNT + q) * 3u;
          let m0 = aux[o];
          let m1 = aux[o + 1u];
          let m2 = aux[o + 2u];
          r0_${slot} = m0;
          r1_${slot} = m1;
          r2_${slot} = m2;
          let exitState = m0 & 0xFFFFu;
          if (exitState != DEAD) {
            let fe = fExit[exitState];
            let fp = fPos[exitState];
            let fs = fSpec[exitState];
            if (fs != 0u) {
              r0_${slot} = fe;
              r1_${slot} = fp;
              r2_${slot} = fs;
            } else {
              r0_${slot} = (fe & 0xFFFFu) | (m0 & 0xFFFF0000u);
            }
          }
        }
      }`
  ).join("\n");

  const passYStore = stateSlots.map((slot) =>
    `      {
        let q = li + ${slot}u * PASS_X_WG;
        if (q < STATE_COUNT) {
          fExit[q] = r0_${slot};
          fPos[q] = r1_${slot};
          fSpec[q] = r2_${slot};
          let o = params.segSumOff + (k * STATE_COUNT + q) * 3u;
          aux[o] = r0_${slot};
          aux[o + 1u] = r1_${slot};
          aux[o + 2u] = r2_${slot};
        }
      }`
  ).join("\n");

  const passXStore = stateSlots.map((slot) =>
    `      {
        let q = li + ${slot}u * PASS_X_WG;
        if (q < STATE_COUNT) {
          col[writeSlot * STATE_COUNT + q] = w0_${slot};
          col[(writeSlot + 1u) * STATE_COUNT + q] = w1_${slot};
          if (q == START_STATE) {
            // Scratch handoff: pass_z reads these back and overwrites them in
            // place, so no per-offset storage is added. The row that matters is
            // the one for the DFA start state, which the plan header names.
            nextPos[p] = w0_${slot};
            packedRec[p] = w1_${slot};
          }
        }
      }`
  ).join("\n");

  return `
// ---------------------------------------------------------------------------
// Generated for stateCount=${packed.stateCount} classCount=${packed.classCount}
// ---------------------------------------------------------------------------

const STATE_COUNT: u32 = ${packed.stateCount}u;
const START_STATE: u32 = ${packed.startState}u;
const CLASS_COUNT: u32 = ${packed.classCount}u;
const DENSE_LEN: u32 = ${denseLength}u;
const RANGE_COUNT: i32 = ${packed.rangeCount};
const TBL_ASCII: u32 = ${packed.asciiOffset}u;
const TBL_ACCEPT: u32 = ${packed.acceptOffset}u;
const TBL_DENSE: u32 = ${packed.denseOffset}u;
const TBL_RANGES: u32 = ${packed.rangesOffset}u;

const CHUNK_SIZE: u32 = ${CHUNK_SIZE}u;
const CHUNK_LOG2: u32 = ${chunkLog2}u;
const SEG_SIZE: u32 = ${SEG_SIZE}u;
const SEG_LOG2: u32 = ${SEG_LOG2}u;
const PASS_X_WG: u32 = ${passXWg}u;
const STATES_PER_THREAD: u32 = ${statesPerThread}u;
const PASS_Z_WG: u32 = ${PASS_Z_WORKGROUP}u;
const PASS_B_WG: u32 = ${PASS_B_WORKGROUP}u;
const SCAN_WG: u32 = ${SCAN_WORKGROUP}u;

const NO_ENTRY: u32 = 0xFFFFFFFFu;
/** Absorbing "no transition" state. stateCount is asserted <= 65534 upstream. */
const DEAD: u32 = 0xFFFFu;

struct Params {
  n: u32,
  numChunks: u32,
  numBlocks: u32,
  capacityRecords: u32,
  entryOff: u32,
  countsOff: u32,
  blockSumOff: u32,
  numSeg: u32,
  segSumOff: u32,
  // Grid strides, in units of the thing each pass indexes. Every pass is a
  // grid-stride loop so that no dispatch ever has to exceed
  // maxComputeWorkgroupsPerDimension.
  passXStride: u32,
  passZStride: u32,
  passBStride: u32,
  passDfStride: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> src: array<u32>;
@group(0) @binding(2) var<storage, read> tables: array<i32>;
@group(0) @binding(3) var<storage, read_write> nextPos: array<u32>;
@group(0) @binding(4) var<storage, read_write> packedRec: array<u32>;
@group(0) @binding(5) var<storage, read_write> exitPos: array<u32>;
@group(0) @binding(6) var<storage, read_write> aux: array<u32>;
@group(0) @binding(7) var<storage, read_write> records: array<i32>;

// --- shared helpers ---------------------------------------------------------

var<workgroup> wgAscii: array<i32, 128>;
var<workgroup> wgAccept: array<i32, ${packed.stateCount}>;
// Dense transition table, TRANSPOSED as [class][state]: pass_x reads it with one
// thread per state, so this layout is what makes the read bank-conflict free.
var<workgroup> wgDense: array<i32, ${denseLength}>;

fn read_unit(i: u32) -> u32 {
  let w = src[i >> 1u];
  return (w >> ((i & 1u) * 16u)) & 0xFFFFu;
}

// Mirrors decode_code_point in wasm_engine_rs/src/lib.rs: surrogate-pair aware,
// unpaired surrogates pass through as raw scalars with width 1.
fn decode_width(i: u32, n: u32) -> u32 {
  let unit = read_unit(i);
  if (unit >= 0xD800u && unit <= 0xDBFFu && (i + 1u) < n) {
    let nxt = read_unit(i + 1u);
    if (nxt >= 0xDC00u && nxt <= 0xDFFFu) {
      return 2u;
    }
  }
  return 1u;
}

fn class_of(cp: u32) -> u32 {
  if (cp < 128u) {
    return u32(wgAscii[cp]);
  }
  var lo: i32 = 0;
  var hi: i32 = RANGE_COUNT - 1;
  var found: u32 = 0u;
  loop {
    if (lo > hi) { break; }
    let mid = (lo + hi) / 2;
    let base = TBL_RANGES + u32(mid) * 3u;
    let s = u32(tables[base]);
    let e = u32(tables[base + 1u]);
    if (cp < s) {
      hi = mid - 1;
    } else if (cp > e) {
      lo = mid + 1;
    } else {
      found = u32(tables[base + 2u]);
      break;
    }
  }
  return found;
}

// First offset belonging to segment k.
//
// Segments must never split a surrogate pair, or a run would leave a segment one
// unit past its end and the (state at segment end) handoff would not line up
// with the next segment's summary. If the nominal boundary would land between a
// high and a low surrogate it moves one unit right. This reads only two code
// units, so every workgroup computes the same boundaries without communicating,
// and the position that moves is still covered exactly once, by the segment on
// its left.
fn seg_start(k: u32, n: u32) -> u32 {
  let s = k << SEG_LOG2;
  if (s >= n) { return n; }
  if (s == 0u) { return 0u; }
  let prev = read_unit(s - 1u);
  if (prev >= 0xD800u && prev <= 0xDBFFu) {
    let cur = read_unit(s);
    if (cur >= 0xDC00u && cur <= 0xDFFFu) { return s + 1u; }
  }
  return s;
}

// --- PASS X -----------------------------------------------------------------
//
// Packing of one E entry, two u32:
//   w0 = exitState | ((acceptingState + 1) << 16)
//   w1 = (acceptOffset - nominalSegmentBase) | ((specIndex + 1) << 16)
// "w1 >> 16 == 0" means no accept in this suffix; "exitState == DEAD" means the
// run died before reaching the segment end.

// Four rotating columns x two u32 x stateCount. A step reads columns p+1 and p+2
// and writes column p; with four slots those never collide, so one barrier per
// step is sufficient. Independent of SEG_SIZE.
var<workgroup> col: array<u32, ${8 * packed.stateCount}>;

@compute @workgroup_size(${passXWg})
fn pass_x(
  @builtin(workgroup_id) wg: vec3<u32>,
  @builtin(local_invocation_index) li: u32,
) {
  for (var i = li; i < 128u; i += PASS_X_WG) { wgAscii[i] = tables[TBL_ASCII + i]; }
  for (var i = li; i < STATE_COUNT; i += PASS_X_WG) { wgAccept[i] = tables[TBL_ACCEPT + i]; }
  for (var i = li; i < DENSE_LEN; i += PASS_X_WG) { wgDense[i] = tables[TBL_DENSE + i]; }
  workgroupBarrier();

  let n = params.n;
${
    stateSlots.map((slot) => `  var w0_${slot}: u32;\n  var w1_${slot}: u32;`)
      .join("\n")
  }

  // wg.x and params.passXStride are workgroup uniform, and so are base and
  // limit, so every barrier below stays in uniform control flow.
  var seg = wg.x;
  loop {
    if (seg >= params.numSeg) { break; }
    let nominal = seg << SEG_LOG2;
    let base = seg_start(seg, n);
    let limit = seg_start(seg + 1u, n);

    // The previous segment's final reads of col must complete before it is
    // overwritten.
    workgroupBarrier();

    var p = limit;
    loop {
      if (p <= base) { break; }
      p -= 1u;

      let unit = read_unit(p);
      var cp: u32 = unit;
      var width: u32 = 1u;
      if (unit >= 0xD800u && unit <= 0xDBFFu && (p + 1u) < n) {
        let nxt = read_unit(p + 1u);
        if (nxt >= 0xDC00u && nxt <= 0xDFFFu) {
          cp = ((unit - 0xD800u) << 10u) + (nxt - 0xDC00u) + 0x10000u;
          width = 2u;
        }
      }
      let cls = class_of(cp);
      // The segment boundary never splits a pair, so np <= limit always.
      let np = p + width;
      let nextSlot = (np & 3u) * 2u;

${passXCompute}

      let writeSlot = (p & 3u) * 2u;
${passXStore}
      workgroupBarrier();
    }

    // M_k = E_base. An empty segment contributes the identity element. This runs
    // once per segment rather than once per code unit, so the loop stays a loop.
    let baseSlot = (base & 3u) * 2u;
    for (var i = 0u; i < STATES_PER_THREAD; i += 1u) {
      let q = li + i * PASS_X_WG;
      if (q < STATE_COUNT) {
        var m0: u32 = q;
        var m1: u32 = 0u;
        if (base < limit) {
          m0 = col[baseSlot * STATE_COUNT + q];
          m1 = col[(baseSlot + 1u) * STATE_COUNT + q];
        }
        let o = params.segSumOff + (seg * STATE_COUNT + q) * 3u;
        aux[o] = m0;
        aux[o + 1u] = nominal + (m1 & 0xFFFFu);
        aux[o + 2u] = m1 >> 16u;
      }
    }

    seg += params.passXStride;
  }
}

// --- PASS Y -----------------------------------------------------------------
//
// F_k = M_k . F_{k+1}, computed right to left and written back over M_k, so that
// aux[segSumOff + ((k+1)*S + q)*3 ..] is the summary of [segStart(k+1), n) by
// the time pass_z reads it. Three u32 per (segment, state):
//   [0] exitState | ((acceptingState + 1) << 16)
//   [1] absolute accept offset
//   [2] specIndex + 1, zero meaning "no accept"
//
// One workgroup: the recurrence is serial in k, and the running element is held
// in workgroup storage so the dependent chain is an LDS read rather than a
// global one.

var<workgroup> fExit: array<u32, ${packed.stateCount}>;
var<workgroup> fPos: array<u32, ${packed.stateCount}>;
var<workgroup> fSpec: array<u32, ${packed.stateCount}>;

@compute @workgroup_size(${passXWg})
fn pass_y(@builtin(local_invocation_index) li: u32) {
  for (var i = 0u; i < STATES_PER_THREAD; i += 1u) {
    let q = li + i * PASS_X_WG;
    if (q < STATE_COUNT) {
      fExit[q] = q;
      fPos[q] = 0u;
      fSpec[q] = 0u;
    }
  }
  workgroupBarrier();

${
    stateSlots.map((slot) =>
      `  var r0_${slot}: u32;\n  var r1_${slot}: u32;\n  var r2_${slot}: u32;`
    ).join("\n")
  }

  var k = params.numSeg;
  loop {
    if (k == 0u) { break; }
    k -= 1u;
${passYCompute}
    workgroupBarrier();
${passYStore}
    workgroupBarrier();
  }
}

// --- PASS Z -----------------------------------------------------------------

@compute @workgroup_size(${PASS_Z_WORKGROUP})
fn pass_z(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = params.n;
  var p = gid.x;
  loop {
    if (p >= n) { break; }

    // A low surrogate sitting on a nominal boundary belongs to the segment on
    // its left, which is the one that swept it.
    var k = p >> SEG_LOG2;
    if (p < seg_start(k, n)) { k -= 1u; }

    let e0 = nextPos[p];
    let e1 = packedRec[p];
    var accPos = (k << SEG_LOG2) + (e1 & 0xFFFFu);
    var accSpec = e1 >> 16u;
    var accState = e0 >> 16u;
    let exitState = e0 & 0xFFFFu;
    if (exitState != DEAD && (k + 1u) < params.numSeg) {
      let o = params.segSumOff + ((k + 1u) * STATE_COUNT + exitState) * 3u;
      let tailSpec = aux[o + 2u];
      if (tailSpec != 0u) {
        accSpec = tailSpec;
        accPos = aux[o + 1u];
        accState = aux[o] >> 16u;
      }
    }

    if (accSpec == 0u) {
      // Unexpected-character token: exactly one codepoint, specIndex -1,
      // acceptingState -1.
      nextPos[p] = p + decode_width(p, n);
      packedRec[p] = 0u;
    } else {
      nextPos[p] = accPos;
      packedRec[p] = accSpec | (accState << 16u);
    }
    p += params.passZStride;
  }
}

// --- PASS B -----------------------------------------------------------------

var<workgroup> ja: array<u32, ${CHUNK_SIZE}>;
var<workgroup> jb: array<u32, ${CHUNK_SIZE}>;

@compute @workgroup_size(${PASS_B_WORKGROUP})
fn pass_b(
  @builtin(workgroup_id) wg: vec3<u32>,
  @builtin(local_invocation_index) li: u32,
) {
  let n = params.n;
  // Grid-stride over chunks. wg.x and params.passBStride are both workgroup
  // uniform, so the barriers below stay in uniform control flow.
  var chunk = wg.x;
  loop {
    if (chunk >= params.numChunks) { break; }
    let base = chunk * CHUNK_SIZE;
    var limit = base + CHUNK_SIZE;
    if (limit > n) { limit = n; }

    // Previous iteration's final read of ja must complete before it is refilled.
    workgroupBarrier();
    for (var i = li; i < CHUNK_SIZE; i += PASS_B_WG) {
      let p = base + i;
      var v = n;
      if (p < n) { v = nextPos[p]; }
      ja[i] = v;
    }
    workgroupBarrier();

    // Guarded pointer doubling. Invariant after round r:
    //   ja[i] = min(position after 2^r orbit steps, first position >= limit).
    // Every step advances at least one code unit, so CHUNK_LOG2 rounds are
    // enough to push every position in the chunk to or past the limit.
    for (var r = 0u; r < CHUNK_LOG2; r += 1u) {
      for (var i = li; i < CHUNK_SIZE; i += PASS_B_WG) {
        let v = ja[i];
        var nv = v;
        if (v < limit) { nv = ja[v - base]; }
        jb[i] = nv;
      }
      workgroupBarrier();
      for (var i = li; i < CHUNK_SIZE; i += PASS_B_WG) { ja[i] = jb[i]; }
      workgroupBarrier();
    }

    for (var i = li; i < CHUNK_SIZE; i += PASS_B_WG) {
      let p = base + i;
      if (p < n) { exitPos[p] = ja[i]; }
    }

    chunk += params.passBStride;
  }
}

// --- PASS C -----------------------------------------------------------------

@compute @workgroup_size(1)
fn pass_c() {
  let n = params.n;
  var pos: u32 = 0u;
  var k: u32 = 0u;
  loop {
    if (k >= params.numChunks) { break; }
    var chunkEnd = (k + 1u) * CHUNK_SIZE;
    if (chunkEnd > n) { chunkEnd = n; }
    if (pos < chunkEnd) {
      aux[params.entryOff + k] = pos;
      pos = exitPos[pos];
    } else {
      // The orbit jumped clean over this chunk (a single token longer than one
      // chunk). The chunk emits no records.
      aux[params.entryOff + k] = NO_ENTRY;
    }
    k += 1u;
  }
}

// --- PASS D -----------------------------------------------------------------

@compute @workgroup_size(${SCAN_WORKGROUP})
fn pass_d(@builtin(global_invocation_id) gid: vec3<u32>) {
  var k = gid.x;
  loop {
    if (k >= params.numChunks) { break; }
    let entry = aux[params.entryOff + k];
    var count: u32 = 0u;
    if (entry != NO_ENTRY) {
      let n = params.n;
      var chunkEnd = (k + 1u) * CHUNK_SIZE;
      if (chunkEnd > n) { chunkEnd = n; }
      var p = entry;
      loop {
        if (p >= chunkEnd) { break; }
        count += 1u;
        p = nextPos[p];
      }
    }
    aux[params.countsOff + k] = count;
    k += params.passDfStride;
  }
}

// --- PASS E -----------------------------------------------------------------

var<workgroup> scanTmp: array<u32, ${SCAN_WORKGROUP}>;

@compute @workgroup_size(${SCAN_WORKGROUP})
fn pass_e1(
  @builtin(workgroup_id) wg: vec3<u32>,
  @builtin(local_invocation_index) li: u32,
) {
  let k = wg.x * SCAN_WG + li;
  var v: u32 = 0u;
  if (k < params.numChunks) { v = aux[params.countsOff + k]; }
  scanTmp[li] = v;
  workgroupBarrier();

  for (var off: u32 = 1u; off < SCAN_WG; off = off << 1u) {
    let own = scanTmp[li];
    var add: u32 = 0u;
    if (li >= off) { add = scanTmp[li - off]; }
    workgroupBarrier();
    scanTmp[li] = own + add;
    workgroupBarrier();
  }

  if (k < params.numChunks) {
    aux[params.countsOff + k] = scanTmp[li] - v;
  }
  if (li == SCAN_WG - 1u) {
    aux[params.blockSumOff + wg.x] = scanTmp[li];
  }
}

@compute @workgroup_size(1)
fn pass_e2() {
  let blockOffsetBase = params.blockSumOff + params.numBlocks;
  var running: u32 = 0u;
  var b: u32 = 0u;
  loop {
    if (b >= params.numBlocks) { break; }
    aux[blockOffsetBase + b] = running;
    running += aux[params.blockSumOff + b];
    b += 1u;
  }
  aux[${AUX_TOTAL_COUNT}u] = running;
  var overflow: u32 = 0u;
  if (running > params.capacityRecords) { overflow = 1u; }
  aux[${AUX_OVERFLOW}u] = overflow;
}

// --- PASS F -----------------------------------------------------------------

@compute @workgroup_size(${SCAN_WORKGROUP})
fn pass_f(@builtin(global_invocation_id) gid: vec3<u32>) {
  var k = gid.x;
  loop {
    if (k >= params.numChunks) { break; }
    let entry = aux[params.entryOff + k];
    if (entry != NO_ENTRY) {
      let blockOffsetBase = params.blockSumOff + params.numBlocks;
      var out = aux[blockOffsetBase + (k / SCAN_WG)] + aux[params.countsOff + k];

      let n = params.n;
      var chunkEnd = (k + 1u) * CHUNK_SIZE;
      if (chunkEnd > n) { chunkEnd = n; }

      var p = entry;
      loop {
        if (p >= chunkEnd) { break; }
        let end = nextPos[p];
        let bits = packedRec[p];
        if (out < params.capacityRecords) {
          let base = out * 4u;
          records[base] = i32(bits & 0xFFFFu) - 1;
          records[base + 1u] = i32(p);
          records[base + 2u] = i32(end);
          records[base + 3u] = i32(bits >> 16u) - 1;
        }
        out += 1u;
        p = end;
      }
    }
    k += params.passDfStride;
  }
}
`;
}
