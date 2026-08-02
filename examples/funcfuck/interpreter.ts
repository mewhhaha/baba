import { CpuFrontend } from "@mewhhaha/baba/runtime/webgpu";

const frontend = CpuFrontend.create(
  Deno.readFileSync(
    new URL("generated/wasm/parser.plan", import.meta.url),
  ),
);

export function runFuncfuck(source: string): string {
  const result = frontend.ingest(source);
  if (!result.ok) {
    const diagnostics = result.diagnostics.map((diagnostic) =>
      `${diagnostic.code} at ${diagnostic.start}: ${diagnostic.message}`
    ).join("\n");
    throw new Error(`Funcfuck frontend failed:\n${diagnostics}`);
  }
  const tokenCount = result.program.tokens.length / 4;
  const nodeCount = result.program.nodes.length / 8;
  const edgeCount = result.program.edges.length / 4;
  return `accepted ${tokenCount} tokens into ${nodeCount} nodes and ${edgeCount} edges\n`;
}

if (import.meta.main) {
  let path = "programs/pipeline.ff";
  if (Deno.args[0] !== undefined) path = Deno.args[0];
  const source = await Deno.readTextFile(path);
  await Deno.stdout.write(new TextEncoder().encode(runFuncfuck(source)));
}
