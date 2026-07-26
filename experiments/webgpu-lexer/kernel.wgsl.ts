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
 * `state -> state` maps therefore does not reproduce token boundaries at all,
 * and the composable element would have to be the triple
 * `(finalState, lastAcceptOffset, lastAcceptState)` per candidate start state -
 * S times wider, and still not enough to place the boundaries.
 *
 * A simpler structure exists and is used here. Observe that the *entire* outer
 * loop state of `lex_all` is a single integer: `offset`. Everything else
 * (`state`, `best_*`) is reset at the top of every token. So:
 *
 *   next(p) = the offset `lex_all` would move to if it started a token at p
 *
 * is a total function of p alone, computable independently for every p. The
 * token stream is exactly the orbit `0 -> next(0) -> next(next(0)) -> ...`, and
 * the record emitted at p is fully determined by p. That turns lexing into:
 *
 *   PASS A  one thread per UTF-16 offset: compute next(p), spec(p), state(p).
 *           Embarrassingly parallel. Average cost is O(mean token length),
 *           which is ~2 codepoints for the target grammars.
 *   PASS B  one workgroup per chunk (grid-strided): guarded pointer-doubling in shared memory
 *           to get exit(p) = first orbit position >= chunkEnd, for every p.
 *           log2(chunkSize) rounds, entirely in LDS.
 *   PASS C  one thread, serial over chunks: entry(k) = the true orbit position
 *           at which chunk k is entered. Only numChunks dependent loads.
 *   PASS D  one thread per chunk: walk entry(k) .. chunkEnd counting tokens.
 *   PASS E  two-level exclusive prefix sum over the per-chunk counts.
 *   PASS F  one thread per chunk: walk again, writing the 4 x i32 records at
 *           the scanned offset.
 *
 * All six stages are dispatches inside a single command encoder, so the whole
 * lex is ONE queue.submit() and ONE mapAsync(). No CPU is in the loop.
 *
 * The redundant work is bounded and cheap: PASS A computes next(p) at every
 * offset, including the ~50% of offsets that are not token starts, and PASS D/F
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
export const PASS_A_WORKGROUP = 128;
export const PASS_B_WORKGROUP = 256;
export const SCAN_WORKGROUP = 256;
/** Largest `@workgroup_size` any entry point in this kernel declares. */
export const MAX_WORKGROUP_INVOCATIONS = 256;
/** Storage bindings the single bind group declares (2 read-only + 5 read-write). */
export const STORAGE_BINDING_COUNT = 7;

/** Workgroup storage `pass_b` needs for a given chunk size, in bytes. */
export function passBWorkgroupBytes(chunkLog2: number): number {
  return 2 * (1 << chunkLog2) * 4;
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
  readonly denseOffset: number;
  readonly rangesOffset: number;
  readonly rangeCount: number;
  readonly stateCount: number;
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
  words.set(alphabet.dense, denseOffset);
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
  // PASS A keeps the whole DFA + classifier in workgroup shared memory. PASS B
  // needs 2 * CHUNK_SIZE u32. Each entry point's requirement is checked against
  // the device limit that was actually requested, not against a constant chosen
  // on one adapter.
  if (packed.workgroupTableBytes > maxComputeWorkgroupStorageSize) {
    throw new Error(
      `pass_a needs ${packed.workgroupTableBytes} B of workgroup storage for the DFA tables ` +
        `(128 + stateCount ${packed.stateCount} + stateCount*classCount ${denseLength} i32); ` +
        `this device reports maxComputeWorkgroupStorageSize=${maxComputeWorkgroupStorageSize} B. ` +
        `A storage-buffer fallback for the DFA tables is not implemented.`,
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

  return `
// ---------------------------------------------------------------------------
// Generated for stateCount=${packed.stateCount} classCount=${packed.classCount}
// ---------------------------------------------------------------------------

const STATE_COUNT: u32 = ${packed.stateCount}u;
const CLASS_COUNT: u32 = ${packed.classCount}u;
const DENSE_LEN: u32 = ${denseLength}u;
const RANGE_COUNT: i32 = ${packed.rangeCount};
const TBL_ASCII: u32 = ${packed.asciiOffset}u;
const TBL_ACCEPT: u32 = ${packed.acceptOffset}u;
const TBL_DENSE: u32 = ${packed.denseOffset}u;
const TBL_RANGES: u32 = ${packed.rangesOffset}u;

const CHUNK_SIZE: u32 = ${CHUNK_SIZE}u;
const CHUNK_LOG2: u32 = ${chunkLog2}u;
const PASS_A_WG: u32 = ${PASS_A_WORKGROUP}u;
const PASS_B_WG: u32 = ${PASS_B_WORKGROUP}u;
const SCAN_WG: u32 = ${SCAN_WORKGROUP}u;

const NO_ENTRY: u32 = 0xFFFFFFFFu;

struct Params {
  n: u32,
  numChunks: u32,
  numBlocks: u32,
  capacityRecords: u32,
  entryOff: u32,
  countsOff: u32,
  blockSumOff: u32,
  // Grid strides, in units of the thing each pass indexes. Every pass is a
  // grid-stride loop so that no dispatch ever has to exceed
  // maxComputeWorkgroupsPerDimension.
  passAStride: u32,
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

// --- PASS A -----------------------------------------------------------------

var<workgroup> wgAscii: array<i32, 128>;
var<workgroup> wgAccept: array<i32, ${packed.stateCount}>;
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

@compute @workgroup_size(${PASS_A_WORKGROUP})
fn pass_a(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(local_invocation_index) li: u32,
) {
  for (var i = li; i < 128u; i += PASS_A_WG) { wgAscii[i] = tables[TBL_ASCII + i]; }
  for (var i = li; i < STATE_COUNT; i += PASS_A_WG) { wgAccept[i] = tables[TBL_ACCEPT + i]; }
  for (var i = li; i < DENSE_LEN; i += PASS_A_WG) { wgDense[i] = tables[TBL_DENSE + i]; }
  workgroupBarrier();

  let n = params.n;
  var start = gid.x;
  loop {
    if (start >= n) { break; }

    // The DFA start state is hard-coded 0, exactly as lex_all does; the plan
    // does not store it.
    var state: u32 = 0u;
    var idx: u32 = start;
    var bestSpec: i32 = -1;
    var bestEnd: u32 = start;
    var bestState: i32 = -1;

    loop {
      if (idx >= n) { break; }
      let unit = read_unit(idx);
      var cp: u32 = unit;
      var width: u32 = 1u;
      if (unit >= 0xD800u && unit <= 0xDBFFu && (idx + 1u) < n) {
        let nxt = read_unit(idx + 1u);
        if (nxt >= 0xDC00u && nxt <= 0xDFFFu) {
          cp = ((unit - 0xD800u) << 10u) + (nxt - 0xDC00u) + 0x10000u;
          width = 2u;
        }
      }
      let nextState = wgDense[state * CLASS_COUNT + class_of(cp)];
      if (nextState < 0) { break; }
      idx = idx + width;
      state = u32(nextState);
      let sp = wgAccept[state];
      if (sp >= 0) {
        bestSpec = sp;
        bestEnd = idx;
        bestState = i32(state);
      }
    }

    var spec = bestSpec;
    var end = bestEnd;
    var accState = bestState;
    if (bestSpec < 0) {
      // Unexpected-character token: exactly one codepoint, specIndex -1,
      // acceptingState -1.
      spec = -1;
      end = start + decode_width(start, n);
      accState = -1;
    }

    nextPos[start] = end;
    packedRec[start] = u32(spec + 1) | (u32(accState + 1) << 16u);

    start += params.passAStride;
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
