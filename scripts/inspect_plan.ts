import { inspectCompactPlanBinary } from "../src/runtime/compact_plan_binary.ts";

if (import.meta.main) {
  const path = Deno.args[0];
  if (!path) {
    console.error(
      "Usage: deno run --allow-read scripts/inspect_plan.ts <plan.bin>",
    );
    Deno.exit(2);
  }
  const info = inspectCompactPlanBinary(await Deno.readFile(path));
  console.log(JSON.stringify(info, null, 2));
}
