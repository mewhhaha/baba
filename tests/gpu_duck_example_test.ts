import { assert, compile, parseMetadata } from "./helpers.ts";
import { CpuFrontend } from "../src/runtime/webgpu/mod.ts";

Deno.test("GPU Duck frontend parses the shipped member-block program", async () => {
  const grammarSource = await Deno.readTextFile(
    new URL("../examples/gpu-duck/grammar.baba", import.meta.url),
  );
  const programSource = await Deno.readTextFile(
    new URL("../examples/gpu-duck/programs/example.duck", import.meta.url),
  );
  const metadataSource = await Deno.readTextFile(
    new URL("../examples/gpu-duck/baba.json", import.meta.url),
  );

  const built = compile(grammarSource, {
    name: "gpu_duck",
    rootRule: "module",
    metadata: parseMetadata(metadataSource),
    targets: ["wasm"],
  });
  assert(
    built.bundle,
    built.diagnostics.map((diagnostic) =>
      `${diagnostic.code}: ${diagnostic.message}`
    ).join("\n"),
  );

  const plan = built.bundle.files.find((file) =>
    file.path === "wasm/parser.plan"
  );
  assert(plan);
  assert(
    plan.encoding === "binary",
    `Expected wasm/parser.plan to be binary, received ${plan.encoding}.`,
  );

  const frontendResult = CpuFrontend.create(plan.content).ingest(programSource);
  assert(
    frontendResult.ok,
    frontendResult.diagnostics.map((diagnostic) => diagnostic.message).join(
      "\n",
    ),
  );
  assert(frontendResult.program.nodes.length > 0);
});
