import type { PortableParserPlanV1 } from "../runtime/portable_plan.ts";
import { emitParserFromPortablePlan } from "../typescript/parser_emit.ts";

export function emitWasmParser(
  plan: PortableParserPlanV1,
): string {
  return emitParserFromPortablePlan(plan, { mode: "wasm" });
}
