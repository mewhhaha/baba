import { inspectCombinedWasmParserPlan } from "../src/runtime/wasm_plan.ts";

if (import.meta.main) {
  const path = Deno.args[0];
  if (!path) {
    console.error(
      "Usage: deno run --allow-read scripts/inspect_plan.ts <parser.plan>",
    );
    Deno.exit(2);
  }
  const info = inspectCombinedWasmParserPlan(await Deno.readFile(path));
  console.log(JSON.stringify(info, null, 2));
}
