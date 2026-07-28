import { assert, assertEquals, compile, parseMetadata } from "./helpers.ts";
import { createParser } from "../src/runtime/generated_wasm.ts";
import { CpuFrontend } from "../src/runtime/webgpu/mod.ts";

Deno.test("GPU Duck grammar parses the shipped member-block program", async () => {
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

  const wasm = built.bundle.files.find((file) =>
    file.path === "wasm/parser.wasm"
  );
  assert(wasm);
  assert(
    wasm.encoding === "binary",
    `Expected wasm/parser.wasm to be binary, received ${wasm.encoding}.`,
  );
  const plan = built.bundle.files.find((file) =>
    file.path === "wasm/parser.plan"
  );
  assert(plan);
  assert(
    plan.encoding === "binary",
    `Expected wasm/parser.plan to be binary, received ${plan.encoding}.`,
  );

  const parser = createParser({ bytes: wasm.content, plan: plan.content });
  try {
    const result = parser.parse(programSource);
    assertEquals(
      result.diagnostics.map((diagnostic) => diagnostic.code).join(","),
      "",
    );
    assertEquals(result.ok, true);

    const frontendResult = CpuFrontend.create(plan.content).ingest(
      programSource,
    );
    assert(
      frontendResult.ok,
      frontendResult.diagnostics.map((diagnostic) => diagnostic.message).join(
        "\n",
      ),
    );
    assert(frontendResult.program.nodes.length > 0);
  } finally {
    parser.dispose();
  }
});
