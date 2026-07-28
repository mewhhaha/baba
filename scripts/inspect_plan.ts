import { inspectCombinedWasmParserPlan } from "../src/runtime/wasm_plan.ts";
import { inspectGpuFrontendPlan } from "../src/runtime/webgpu/frontend.ts";

if (import.meta.main) {
  const path = Deno.args[0];
  if (!path) {
    console.error(
      "Usage: deno run --allow-read scripts/inspect_plan.ts <parser.plan>",
    );
    Deno.exit(2);
  }
  const bytes = await Deno.readFile(path);
  const info = inspectCombinedWasmParserPlan(bytes);
  const gpuFrontend = inspectGpuFrontendPlan(bytes);
  console.log(JSON.stringify({ ...info, gpuFrontend }, null, 2));
}
