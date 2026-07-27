/**
 * Pins BOTH halves of the `lex_all` backtracking fix: the token tape it emits
 * on the pathological input shape, and the cost bound that shape must now obey.
 *
 * `fixtures/perf/error-heavy/grammar.baba` declares the ordinary string-literal
 * regex `/"([^"\\]|\\.)*"/`. On the two-code-unit sequence `"\` repeated, every
 * `"` is consumed as the escaped character of the preceding `\`, so the string
 * never closes. Each scan used to run from its start offset to end of input,
 * find no accepting configuration, emit a one-unit error token and restart one
 * unit along - O(n^2) DFA steps in total, measured at 2.0x ms/MiB per doubling.
 * `lex_all` now carries a per-position failure memo, so a scan stops as soon as
 * it re-enters a (position, state) pair a previous scan already proved cannot
 * accept. See `docs/performance.md` ("Lexer backtracking worst case").
 *
 * The tape assertions are the correctness half: the memo is only ever consulted
 * strictly past a scan's last accepting position, so every emitted record -
 * `acceptingState` included - must be bit-identical to the pre-fix output.
 *
 * Sizes stay small on purpose: this is a correctness test first, and the cost
 * assertion only has to separate linear from quadratic, not measure throughput.
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

Deno.test("lex_all memo stays token-identical across surrogate boundaries", () => {
  const lexer = CpuReferenceLexer.create(
    wasmCoreRuntimeBytes(),
    errorHeavyPlan(),
  );

  // The memo advances by code point, so it steps over the trailing unit of a
  // surrogate pair and parks an impossible state there rather than leaving a
  // hole inside its valid interval. These inputs are the ones that can read
  // such a hole. All three open a string that never closes, so every code point
  // is its own error token, and the expected tape follows from the code-point
  // widths alone rather than from what the engine happens to emit.
  const inputs = [
    // Paired: `\` escapes the astral code point, so scan positions land on
    // whole pairs and the memo has to skip the low half.
    '"' + "\u{1f600}\\".repeat(16),
    // Unpaired high surrogate: width 1, so scan positions land inside what
    // would otherwise be a pair.
    '"' + "\ud83d\\".repeat(16),
    // Unpaired low surrogate: every scan starts on the half the memo skips.
    '"' + "\ude00\\".repeat(16),
  ];

  for (const text of inputs) {
    const records = lexer.lex(toUnits(text)).records;
    const count = records.length / TOKEN_RECORD_I32_COUNT;

    let index = 0;
    let start = 0;
    while (start < text.length) {
      const width = String.fromCodePoint(text.codePointAt(start)!).length;
      const base = index * TOKEN_RECORD_I32_COUNT;
      assertEquals(records[base], -1, `Token ${index} specIndex.`);
      assertEquals(records[base + 1], start, `Token ${index} start.`);
      assertEquals(records[base + 2], start + width, `Token ${index} end.`);
      assertEquals(records[base + 3], -1, `Token ${index} acceptingState.`);
      start += width;
      index += 1;
    }
    assertEquals(count, index, "Expected one error token per code point.");
  }
});

Deno.test("lex_all stays within a linear cost envelope on the backtracking shape", () => {
  const lexer = CpuReferenceLexer.create(
    wasmCoreRuntimeBytes(),
    errorHeavyPlan(),
  );

  // The bound is a RATIO against ordinary source of the same length on the same
  // grammar, not an absolute millisecond budget, so it does not depend on the
  // speed of the machine running it. Measured on the unfixed engine the ratio
  // at 32,768 units is about 2,900x; measured on the fixed engine it is under
  // 2x. `MAX_RATIO` sits far above the latter and far below the former, so a
  // wide margin of scheduling noise cannot flip the verdict in either
  // direction, while any return of the quadratic scan fails it outright.
  const MAX_RATIO = 25;
  const UNITS = 32768;

  const pathological = toUnits('"\\'.repeat(UNITS / 2));
  let ordinaryText = "";
  const seed = Deno.readTextFileSync("fixtures/perf/error-heavy/large.input");
  while (ordinaryText.length < UNITS) {
    ordinaryText += seed;
  }
  const ordinary = toUnits(ordinaryText.slice(0, UNITS));

  function medianLexMs(source: Uint16Array): number {
    const samples: number[] = [];
    for (let trial = 0; trial < 3; trial += 1) {
      samples.push(lexer.lex(source).timings.lexAllMs);
    }
    samples.sort((left, right) => left - right);
    return samples[1];
  }

  // Interleaved, ordinary first, so a cold instance cannot bias the ratio
  // toward the pathological side.
  const ordinaryMs = medianLexMs(ordinary);
  const pathologicalMs = medianLexMs(pathological);
  const ratio = pathologicalMs / ordinaryMs;

  assert(
    ratio < MAX_RATIO,
    `lex_all on ${UNITS} units of the backtracking shape took ${
      pathologicalMs.toFixed(2)
    } ms against ${
      ordinaryMs.toFixed(2)
    } ms for ordinary source of the same length (ratio ${
      ratio.toFixed(1)
    }x, bound ${MAX_RATIO}x). The per-position failure memo in fn lex_all has stopped working.`,
  );
});
