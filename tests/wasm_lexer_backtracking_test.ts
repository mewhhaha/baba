/**
 * Pins the token tape `lex_all` produces for the input shape that drives its
 * quadratic worst case, so that a future fix can be proven token-identical.
 *
 * `fixtures/perf/error-heavy/grammar.baba` declares the ordinary string-literal
 * regex `/"([^"\\]|\\.)*"/`. On the two-code-unit sequence `"\` repeated, every
 * `"` is consumed as the escaped character of the preceding `\`, so the string
 * never closes. Each scan runs from its start offset to end of input, finds no
 * accepting configuration, emits a one-unit error token and restarts one unit
 * along - which is O(n^2) DFA steps in total. See `docs/performance.md`
 * ("Lexer backtracking worst case") for the measured curve; the fix is not
 * implemented, so this test documents current OUTPUT, not current cost.
 *
 * The value of pinning the tape is that the fix must not change it. The memo
 * that would make this linear works by aborting a scan early once the scan is
 * known to be past its last accepting position, which is supposed to leave
 * every emitted record bit-identical. This test is the oracle for that claim.
 *
 * Sizes stay small on purpose: this is a correctness test and must not import
 * the quadratic cost into the suite.
 */

import { assert, assertEquals, compile } from "./helpers.ts";
import { CpuReferenceLexer } from "../scripts/webgpu_lexer_cpu_reference.ts";
import { wasmCoreRuntimeBytes } from "../src/targets/runtime/wasm_core_runtime_bytes.ts";

const TOKEN_RECORD_I32_COUNT = 4;

function errorHeavyPlan(): Uint8Array {
  const source = Deno.readTextFileSync(
    "fixtures/perf/error-heavy/grammar.baba",
  );
  const result = compile(source, { targets: ["wasm"] });
  // The reproducer runs on a grammar that compiles CLEANLY. If this fixture
  // ever starts reporting diagnostics, the reproducer stops being evidence that
  // the shape reaches users, and this test should be re-derived rather than
  // relaxed.
  assertEquals(
    result.diagnostics.length,
    0,
    `fixtures/perf/error-heavy is expected to compile without diagnostics, got ${
      result.diagnostics.map((diagnostic) => diagnostic.code).join(", ")
    }.`,
  );
  assert(result.bundle !== undefined, "Expected a generated bundle.");
  const plan = result.bundle.files.find((file) =>
    file.path === "wasm/parser.plan"
  );
  assert(plan !== undefined, "Expected wasm/parser.plan.");
  assert(plan.encoding === "binary", "Expected a binary plan.");
  return plan.content;
}

function toUnits(text: string): Uint16Array {
  const units = new Uint16Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    units[index] = text.charCodeAt(index);
  }
  return units;
}

Deno.test("lex_all emits one error token per unit for an unterminated escaped string", () => {
  const lexer = CpuReferenceLexer.create(
    wasmCoreRuntimeBytes(),
    errorHeavyPlan(),
  );

  for (const pairs of [1, 2, 8, 64]) {
    const text = '"\\'.repeat(pairs);
    const records = lexer.lex(toUnits(text)).records;
    const count = records.length / TOKEN_RECORD_I32_COUNT;

    assertEquals(
      count,
      text.length,
      `Expected one token per code unit for ${pairs} \`"\\\` pairs.`,
    );
    for (let index = 0; index < count; index += 1) {
      const base = index * TOKEN_RECORD_I32_COUNT;
      assertEquals(
        records[base],
        -1,
        `Token ${index} should be an error token (specIndex -1).`,
      );
      assertEquals(records[base + 1], index, `Token ${index} start.`);
      assertEquals(records[base + 2], index + 1, `Token ${index} end.`);
      assertEquals(
        records[base + 3],
        -1,
        `Token ${index} should carry no accepting state.`,
      );
    }
  }
});

Deno.test("lex_all still closes a terminated string on the same grammar", () => {
  const lexer = CpuReferenceLexer.create(
    wasmCoreRuntimeBytes(),
    errorHeavyPlan(),
  );

  // The control for the test above: the same grammar and the same delimiter,
  // but the string closes, so the scan accepts and no error token is emitted.
  const records = lexer.lex(toUnits('"ab"')).records;
  assertEquals(records.length / TOKEN_RECORD_I32_COUNT, 1);
  assert(
    records[0] >= 0,
    `Expected a real STRING spec index, got ${records[0]}.`,
  );
  assertEquals(records[1], 0);
  assertEquals(records[2], 4);
});
