/**
 * Shared WebGPU runtime smoke tests.
 *
 * CI has no adapter, so this test returns before creating a runtime there. On
 * a GPU-capable host it verifies that equal plan bytes reuse one context and
 * that simultaneous calls are safely bounded through one runtime-owned device.
 */

import { assert, assertEquals, compile } from "./helpers.ts";
import { WebGpuRuntime } from "../src/runtime/webgpu/mod.ts";

const GRAMMAR = `
  token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
  token INT = /[0-9]+/ ;
  skip WS = /[ \\t\\r\\n]+/ ;
  module = value:(IDENT | INT)* ;
`;

function compilePlan(source: string): Uint8Array {
  const result = compile(source, { targets: ["wasm"] });
  assertEquals(result.diagnostics.length, 0, "Expected a clean compile.");
  assert(result.bundle, "Expected a generated bundle.");
  const file = result.bundle.files.find(
    (candidate) => candidate.path === "wasm/parser.plan",
  );
  assert(file, "Expected wasm/parser.plan in the generated bundle.");
  assertEquals(file.encoding, "binary");
  return file.content as Uint8Array;
}

function utf16Units(text: string): Uint16Array {
  const units = new Uint16Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    units[index] = text.charCodeAt(index);
  }
  return units;
}

async function hasAdapter(): Promise<boolean> {
  if (typeof navigator === "undefined" || navigator.gpu === undefined) {
    return false;
  }
  try {
    return await navigator.gpu.requestAdapter() !== null;
  } catch {
    return false;
  }
}

Deno.test({
  name:
    "WebGpuRuntime caches compiled plans and bounds concurrent context jobs on one device",
  fn: async () => {
    if (!(await hasAdapter())) {
      return;
    }
    const plan = compilePlan(GRAMMAR);
    const runtime = await WebGpuRuntime.create({
      allowFallbackAdapter: true,
      maxInFlight: 2,
    });
    try {
      const [firstContext, secondContext] = await Promise.all([
        runtime.compile(plan),
        runtime.compile(plan.slice()),
      ]);
      assert(
        firstContext === secondContext,
        "Equal parser.plan bytes must reuse the compiled context.",
      );
      assertEquals(runtime.maxInFlight, 2);

      const [first, second] = await Promise.all([
        firstContext.lex(utf16Units("alpha 1 beta 2")),
        firstContext.lex(utf16Units("gamma 3 delta 4")),
      ]);
      assertEquals(first.overflow, false);
      assertEquals(second.overflow, false);
      assert(first.tokenCount > 0, "Expected tokens from the first job.");
      assert(second.tokenCount > 0, "Expected tokens from the second job.");

      firstContext.dispose();
      const replacementContext = await runtime.compile(plan);
      assert(
        replacementContext !== firstContext,
        "Disposing a context must evict it from the compiled-plan cache.",
      );
      replacementContext.dispose();
    } finally {
      runtime.dispose();
    }
  },
});
