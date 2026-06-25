import type { PortableParserPlan } from "../runtime/portable_plan.ts";
import { emitParserFromPortablePlan } from "../typescript/parser_emit.ts";

export function emitWasmParser(
  plan: PortableParserPlan,
): string {
  return emitParserFromPortablePlan(plan, { mode: "wasm" });
}
