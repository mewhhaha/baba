import type {
  BabaMetadata,
  Diagnostic,
  PortabilityMode,
  PortableRuntimePlanningOptions,
} from "../../ast.ts";
import type { AnalyzedGrammar } from "../ir.ts";
import {
  planPortableRuntime,
  type RuntimeParserPlan,
} from "../../targets/runtime/plan.ts";

export interface PortablePlanResult {
  readonly runtime?: RuntimeParserPlan;
  readonly diagnostics: readonly Diagnostic[];
}

export function buildPortableParserPlan(
  analyzed: AnalyzedGrammar,
  metadata: BabaMetadata = {},
  options: PortableRuntimePlanningOptions = {},
  portability: PortabilityMode = "warn",
): PortablePlanResult {
  const runtime = planPortableRuntime(analyzed, options, metadata, portability);
  if (!("portable" in runtime)) return { diagnostics: runtime.diagnostics };
  return { runtime, diagnostics: runtime.diagnostics };
}
