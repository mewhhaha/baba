/**
 * Shared WebGPU runtime smoke tests.
 *
 * CI has no adapter, so this test returns before creating a runtime there. On
 * a GPU-capable host it verifies that equal plan bytes reuse one context and
 * that simultaneous calls are safely bounded through one runtime-owned device.
 */

import { assert, assertEquals, compile } from "./helpers.ts";
import { WebGpuLexer, WebGpuRuntime } from "../src/runtime/webgpu/mod.ts";

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
    const padded = new Uint8Array(plan.length + 14);
    padded.fill(0xA5);
    padded.set(plan, 7);
    const paddedPlan = padded.subarray(7, 7 + plan.length);
    const runtime = await WebGpuRuntime.create({
      allowFallbackAdapter: true,
      maxInFlight: 2,
    });
    try {
      const [firstContext, secondContext, paddedContext] = await Promise.all([
        runtime.compileLexer(plan),
        runtime.compileLexer(plan.slice()),
        runtime.compileLexer(paddedPlan),
      ]);
      assert(
        firstContext === secondContext,
        "Equal parser.plan bytes must reuse the compiled context.",
      );
      assert(
        firstContext === paddedContext,
        "A plan view with a nonzero byte offset must reuse the compiled context.",
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
      const leases = await Promise.all([
        firstContext.acquireIntegratedLexer(),
        firstContext.acquireIntegratedLexer(),
      ]);
      try {
        const results = await Promise.all([
          leases[0].lexer.lex(utf16Units("alpha 1 beta 2")),
          leases[1].lexer.lex(utf16Units("gamma 3 delta 4")),
        ]);
        assertEquals(results[0].records.join(","), first.records.join(","));
        assertEquals(results[1].records.join(","), second.records.join(","));
      } finally {
        for (const lease of leases) {
          lease.release();
        }
      }

      const compact = await firstContext.lexCompact(
        utf16Units("alpha 1 beta 2"),
      );
      assertEquals(compact.tokenCount, first.tokenCount);
      const reconstructed = new Int32Array(compact.tokenCount * 4);
      let start = 0;
      for (let index = 0; index < compact.tokenCount; index += 1) {
        const compactOffset = index * 2;
        const end = compact.records[compactOffset];
        const packed = compact.records[compactOffset + 1];
        reconstructed.set(
          [
            (packed & 0xFFFF) - 1,
            start,
            end,
            (packed >>> 16) - 1,
          ],
          index * 4,
        );
        start = end;
      }
      assertEquals(reconstructed.join(","), first.records.join(","));

      firstContext.dispose();
      const replacementContext = await runtime.compileLexer(plan);
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

Deno.test("WebGPU worker kernels survive either worker destruction order", async () => {
  if (!(await hasAdapter())) {
    return;
  }
  const plan = compilePlan(GRAMMAR);
  const runtime = await WebGpuRuntime.create({ allowFallbackAdapter: true });
  try {
    for (const destroySourceFirst of [false, true]) {
      const source = await WebGpuLexer.create(plan, { runtime });
      const sibling = await WebGpuLexer.createContextWorker(source);
      try {
        const expected = await source.lex(utf16Units("shared 123"));
        let survivor = source;
        if (destroySourceFirst) {
          source.destroy();
          survivor = sibling;
        } else {
          sibling.destroy();
        }
        const actual = await survivor.lex(utf16Units("shared 123"));
        assertEquals(actual.records.join(","), expected.records.join(","));
      } finally {
        source.destroy();
        sibling.destroy();
      }
    }
  } finally {
    runtime.dispose();
  }
});

Deno.test("WebGPU compiles distinct plans concurrently on one device", async () => {
  if (!(await hasAdapter())) {
    return;
  }
  const identifierPlan = compilePlan(GRAMMAR);
  const punctuationPlan = compilePlan('module = values:("x" | ";")*;');
  const runtime = await WebGpuRuntime.create({
    allowFallbackAdapter: true,
    maxInFlight: 2,
  });
  try {
    const [identifiers, punctuation] = await Promise.all([
      runtime.compileLexer(identifierPlan),
      runtime.compileLexer(punctuationPlan),
    ]);
    const [words, symbols] = await Promise.all([
      identifiers.lex(utf16Units("name 123")),
      punctuation.lex(utf16Units("x;x;")),
    ]);
    assertEquals(words.overflow, false);
    assertEquals(symbols.overflow, false);
    assertEquals(words.tokenCount, 3);
    assertEquals(symbols.tokenCount, 4);
    const original = words.records.slice();
    await punctuation.lex(utf16Units(";"));
    assertEquals(words.records.join(","), original.join(","));
  } finally {
    runtime.dispose();
  }
});
