/**
 * Experimental WebGPU lexer and island-frontend backends.
 *
 * Both backends consume an existing `parser.plan`; they are runtime choices,
 * not generate targets. The standalone lexer emits the same four-`i32` token
 * records as the shipping Rust/Wasm `lex_all`. A plan with an opt-in version-3
 * GPU frontend section can also execute lexing, structural matching, island
 * recognition, and flat IR allocation in one submission. `ingest()` maps the
 * owned result once; `ingestResident()` leaves the syntax IR on the device.
 *
 * Read `docs/webgpu-frontend.md` or `docs/webgpu-lexer.md` before selecting a
 * backend. In particular:
 *
 * - both are **async** and cannot replace the generated synchronous methods;
 * - device setup and mapped readback make the CPU path preferable for small or
 *   one-off sources;
 * - both require guard-free terminal identity, while the full frontend also
 *   requires compiler-proven, locally locatable islands;
 * - a hardware WebGPU adapter is required by default; software fallback
 *   adapters require explicit `allowFallbackAdapter` opt-in.
 *
 * Stability: this module is listed as an experimental surface in
 * `docs/stability.md`. Option and result shapes may change in any minor release
 * and the module may be removed without a major release.
 */

export { GpuLexerCapacityError, WebGpuLexer } from "./lexer.ts";
export type {
  GpuCompactLexResult,
  GpuLexerLimits,
  GpuLexerOptions,
  GpuLexResult,
  GpuLexTimings,
  GpuSetupTimings,
  WebGpuLexerCreateOptions,
} from "./lexer.ts";

export { WebGpuLexerContext, WebGpuRuntime } from "./context.ts";
export type {
  WebGpuLexerContextOptions,
  WebGpuRuntimeCapabilities,
  WebGpuRuntimeCreateOptions,
  WebGpuRuntimeLease,
  WebGpuRuntimeLimits,
} from "./context.ts";

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

export {
  CpuFrontend,
  decodeGpuFrontendPlan,
  GpuFrontendCapacityError,
  inspectGpuFrontendPlan,
  WebGpuFrontend,
} from "./frontend.ts";
export type {
  CompactFrontendProgram,
  CpuFrontendOptions,
  FrontendDiagnostic,
  GpuFrontendPlanInspection,
  GpuFrontendResult,
  GpuFrontendTimings,
  GpuResidentFrontendLayout,
  GpuResidentFrontendOptions,
  GpuResidentFrontendResult,
  GpuResidentFrontendTimings,
  WebGpuFrontendOptions,
} from "./frontend.ts";
