import type { GpuFrontendPlan } from "../../compiler/gpu_frontend.ts";
import {
  type CpuFrontendOptions,
  decodeGpuFrontendPlan,
  type GpuFrontendResult,
  ingestCpuFrontend,
} from "./frontend.ts";
import { decodeLexerPlanTables, type LexerPlanTables } from "./plan_tables.ts";

/**
 * Explicit CPU backend for parity-checking the GPU island frontend.
 */
export class CpuFrontend {
  readonly plan: GpuFrontendPlan;
  readonly lexer: LexerPlanTables;

  private constructor(plan: GpuFrontendPlan, lexer: LexerPlanTables) {
    this.plan = plan;
    this.lexer = lexer;
  }

  static create(planBytes: Uint8Array): CpuFrontend {
    return new CpuFrontend(
      decodeGpuFrontendPlan(planBytes),
      decodeLexerPlanTables(planBytes),
    );
  }

  ingest(source: string, options: CpuFrontendOptions = {}): GpuFrontendResult {
    return ingestCpuFrontend(this.plan, this.lexer, source, options);
  }
}
