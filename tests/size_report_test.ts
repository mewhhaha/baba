import { buildSizeReport } from "../scripts/size_report.ts";
import { assertEquals } from "./helpers.ts";

Deno.test("repository size excludes ignored artifacts without hiding generated example metrics", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/src/runtime`, { recursive: true });
    await Deno.mkdir(`${root}/src/compiler/grammar_rs/target`, {
      recursive: true,
    });
    await Deno.mkdir(`${root}/examples/tiny/generated`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/deno.json`,
      JSON.stringify({
        publish: {
          include: ["src/runtime/generated_wasm.ts"],
        },
      }),
    );
    await Deno.writeTextFile(
      `${root}/.gitignore`,
      [
        "examples/*/generated/",
        "src/compiler/grammar_rs/target/",
      ].join("\n"),
    );
    await Deno.writeTextFile(
      `${root}/src/runtime/generated_wasm.ts`,
      "export const runtime = true;\n",
    );
    await Deno.writeTextFile(
      `${root}/src/compiler/grammar_rs/target/engine.wasm`,
      "ignored engine",
    );
    await Deno.writeTextFile(
      `${root}/examples/tiny/generated/parser.wasm`,
      "ignored example",
    );

    const report = await buildSizeReport(root);

    assertEquals(report.repository.fileCount, 3);
    assertEquals(report.publishPayload.fileCount, 1);
    assertEquals(report.examples.generatedBytes, 15);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
