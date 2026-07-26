/**
 * Experimental WebGPU lexer backend.
 *
 * This is a second implementation of the shipping Rust/Wasm `lex_all`, not a new
 * generate target and not a new artifact. It consumes an existing `parser.plan`
 * unchanged and emits the identical four-`i32` token records
 * `{ specIndex, start, end, acceptingState }` in the identical order.
 *
 * Read `docs/webgpu-lexer.md` before using it. In particular:
 *
 * - it is **async**, so it cannot be hosted inside the generated `parser.lex()`,
 *   which is synchronous;
 * - it **loses to the CPU below ~768 KiB of source** on the one stack it was
 *   measured on, and the ~226 ms one-time device setup is never repaid by any
 *   single document;
 * - it supports **guard-free grammars only** and refuses others loudly;
 * - it requires a WebGPU adapter and has no fallback of its own.
 *
 * Stability: this module is listed as an experimental surface in
 * `docs/stability.md`. Option and result shapes may change in any minor release
 * and the module may be removed without a major release.
 */

export { GpuLexerCapacityError, WebGpuLexer } from "./lexer.ts";
export type {
  GpuLexerLimits,
  GpuLexerOptions,
  GpuLexResult,
  GpuLexTimings,
  GpuSetupTimings,
  WebGpuLexerCreateOptions,
} from "./lexer.ts";

/**
 * Guard-free preflight. `WebGpuLexer.create` refuses a guard-carrying plan, but
 * only after acquiring an adapter and a device; this answers the same question
 * from the plan bytes alone, with `guardFree` and a `guardDiagnostics` list
 * naming each offending spec.
 */
export { decodeLexerPlanTables } from "./plan_tables.ts";
export type { CompactSection, LexerPlanTables } from "./plan_tables.ts";

export type { AlphabetTables, ClassRange } from "./alphabet.ts";
export type { PackedTables } from "./kernel_wgsl.ts";
