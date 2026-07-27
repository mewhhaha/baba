/**
 * Multi-grammar parity runner: GPU records vs the shipping Wasm `lex_all`
 * records, raw 4 x i32 against raw 4 x i32. Exits non-zero on the first
 * mismatch.
 *
 *   deno task parity:webgpu-lexer
 *   deno task parity:webgpu-lexer --grammar thunkwasm
 *
 * This runs the four shipped example grammars against their real generated
 * artifacts under `examples/<name>/generated/wasm/`, which is a gitignored local
 * build output. Run `deno task bootstrap` first on a fresh clone.
 *
 * The enforced gate lives in `tests/webgpu_lexer_parity_test.ts`, which compiles
 * its grammar inline and therefore needs nothing on disk. This script is the
 * wider sweep: real shipped grammars, the 1 MiB and 4 MiB corpora, and the
 * failure-mode guards. Neither runs in CI, because CI has no GPU.
 */

import { CpuReferenceLexer, toUtf16 } from "./webgpu_lexer_cpu_reference.ts";
import {
  GpuLexerCapacityError,
  WebGpuLexer,
} from "../src/runtime/webgpu/lexer.ts";
import {
  buildAlphabetTables,
  verifyAlphabetAgainstSparse,
} from "../src/runtime/webgpu/alphabet.ts";
import { decodeLexerPlanTables } from "../src/runtime/webgpu/plan_tables.ts";
import {
  adversarialInputs,
  exampleGrammar,
  type NamedInput,
  randomizedFuncfuckSource,
  readExamplePrograms,
  repeatToSize,
  segmentBoundaryInputs,
} from "./webgpu_lexer_corpus.ts";
import { SEG_SIZE } from "../src/runtime/webgpu/kernel_wgsl.ts";

interface Mismatch {
  readonly kind: "count" | "field";
  readonly recordIndex: number;
  readonly detail: string;
}

function describeRecord(records: Int32Array, index: number): string {
  if (index < 0 || (index + 1) * 4 > records.length) {
    return "<none>";
  }
  const base = index * 4;
  return `{spec:${records[base]}, start:${records[base + 1]}, end:${
    records[base + 2]
  }, accState:${records[base + 3]}}`;
}

function contextOf(text: string, start: number, end: number): string {
  const from = Math.max(0, start - 24);
  const to = Math.min(text.length, end + 24);
  const slice = text.slice(from, to);
  return JSON.stringify(slice);
}

function compare(expected: Int32Array, actual: Int32Array): Mismatch | null {
  const expectedCount = expected.length / 4;
  const actualCount = actual.length / 4;
  const shared = Math.min(expectedCount, actualCount);
  for (let index = 0; index < shared; index += 1) {
    const base = index * 4;
    for (let field = 0; field < 4; field += 1) {
      if (expected[base + field] !== actual[base + field]) {
        const names = ["specIndex", "start", "end", "acceptingState"];
        return {
          kind: "field",
          recordIndex: index,
          detail: `${names[field]} differs: cpu=${expected[base + field]} gpu=${
            actual[base + field]
          }`,
        };
      }
    }
  }
  if (expectedCount !== actualCount) {
    return {
      kind: "count",
      recordIndex: shared,
      detail: `token count differs: cpu=${expectedCount} gpu=${actualCount}`,
    };
  }
  return null;
}

function parseArgs(): { grammar: string; heavy: boolean } {
  let grammar = "funcfuck";
  let heavy = true;
  const args = Deno.args;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--grammar" && index + 1 < args.length) {
      grammar = args[index + 1];
      index += 1;
      continue;
    }
    if (args[index] === "--no-heavy") {
      heavy = false;
    }
  }
  return { grammar, heavy };
}

async function main(): Promise<number> {
  const { grammar: grammarName, heavy } = parseArgs();
  const grammar = exampleGrammar(grammarName);
  const planBytes = await Deno.readFile(grammar.planPath);
  const wasmBytes = await Deno.readFile(grammar.wasmPath);

  const plan = decodeLexerPlanTables(planBytes);
  console.log(
    `grammar=${grammarName} states=${plan.stateCount} specs=${plan.specCount} guardFree=${plan.guardFree}`,
  );
  if (!plan.guardFree) {
    console.error(`REFUSED: ${plan.guardDiagnostics.join("; ")}`);
    return 2;
  }
  const alphabet = buildAlphabetTables(plan);
  const check = verifyAlphabetAgainstSparse(plan, alphabet);
  console.log(
    `alphabet: classes=${alphabet.classCount} aboveAsciiRanges=${alphabet.aboveAsciiRanges.length} denseCells=${alphabet.dense.length} sparseCrossCheck=${check.checked} mismatches=${check.mismatches}`,
  );
  if (check.mismatches !== 0) {
    console.error(
      "REFUSED: dense alphabet table disagrees with the plan CSR table.",
    );
    const first = check.firstMismatch;
    if (first !== null) {
      console.error(
        `  first: codePoint=${first.codePoint} class=${first.classId} state=${first.state} sparse=${first.sparseTarget} dense=${first.denseTarget}`,
      );
    }
    return 2;
  }

  const cpu = CpuReferenceLexer.create(wasmBytes, planBytes);
  const gpu = await WebGpuLexer.create(planBytes, {
    allowFallbackAdapter: true,
  });
  console.log(
    `wasm abi_version=${cpu.abiVersion} gpuTimestamps=${gpu.hasTimestamps}`,
  );

  const cases: NamedInput[] = [];
  for (const input of adversarialInputs()) {
    cases.push(input);
  }
  // pass_x's segment boundaries are a second, independent grid from pass_b's
  // chunk boundaries, and they are not covered by anything above.
  for (const input of segmentBoundaryInputs(SEG_SIZE)) {
    cases.push(input);
  }
  const programs = await readExamplePrograms(grammar);
  for (const program of programs) {
    cases.push({ name: `program:${program.name}`, text: program.text });
    cases.push({
      name: `program-repeat-64k:${program.name}`,
      text: repeatToSize(program.text + "\n", 64 * 1024),
    });
  }
  const joined = programs.map((p) => p.text).join("\n") + "\n";
  cases.push({ name: "programs-joined", text: joined });

  if (grammarName === "funcfuck") {
    for (let seed = 1; seed <= 12; seed += 1) {
      cases.push({
        name: `randomized-seed-${seed}`,
        text: randomizedFuncfuckSource(37_000 + seed * 911, seed),
      });
    }
    // Deliberately land junk near chunk boundaries.
    for (let offset = 4090; offset <= 4102; offset += 1) {
      const base = randomizedFuncfuckSource(9000, 77);
      cases.push({
        name: `chunk-edge-noise-${offset}`,
        text: `${base.slice(0, offset)}@\u{1F600}${base.slice(offset)}`,
      });
    }
  }

  if (heavy) {
    cases.push({
      name: "repeat-1MiB",
      text: repeatToSize(joined, 1024 * 1024),
    });
    if (grammarName === "funcfuck") {
      cases.push({
        name: "randomized-1MiB",
        text: randomizedFuncfuckSource(1024 * 1024, 4242),
      });
      cases.push({
        name: "randomized-4MiB",
        text: randomizedFuncfuckSource(4 * 1024 * 1024, 31337),
      });
    }
  }

  // Every pass is a grid-stride loop so an input that would need more than
  // maxComputeWorkgroupsPerDimension workgroups still dispatches legally. On a
  // device reporting 65535 no runnable input reaches that grid size, so the
  // stride path would never execute. Re-run the whole corpus with the grid
  // artificially squeezed to force it.
  const strideCaps = [1, 3, 7];

  let failures = 0;
  let passed = 0;
  let stridePassed = 0;
  let aborted = false;

  const runOne = async (
    label: string,
    text: string,
    units: Uint16Array,
    expected: Int32Array,
    gridCap: number | undefined,
  ): Promise<boolean> => {
    const actual = await gpu.lex(units, {
      debugMaxWorkgroupsPerDimension: gridCap,
    });
    if (actual.overflow) {
      console.error(
        `FAIL ${label}: GPU reported output-buffer overflow (${actual.tokenCount} tokens).`,
      );
      return false;
    }
    const mismatch = compare(expected, actual.records);
    if (mismatch === null) {
      return true;
    }
    console.error("");
    console.error(`FAIL ${label} (${text.length} UTF-16 units)`);
    console.error(`  ${mismatch.detail}`);
    const index = mismatch.recordIndex;
    for (let probe = Math.max(0, index - 2); probe <= index + 2; probe += 1) {
      console.error(
        `  [${probe}] cpu=${describeRecord(expected, probe)} gpu=${
          describeRecord(actual.records, probe)
        }`,
      );
    }
    if ((index + 1) * 4 <= expected.length) {
      const start = expected[index * 4 + 1];
      const end = expected[index * 4 + 2];
      console.error(
        `  source context around cpu record: ${contextOf(text, start, end)}`,
      );
    }
    return false;
  };

  for (const testCase of cases) {
    const units = toUtf16(testCase.text);
    const expected = cpu.lex(units).records;
    const ok = await runOne(
      testCase.name,
      testCase.text,
      units,
      expected,
      undefined,
    );
    if (!ok) {
      failures += 1;
      aborted = true;
      break;
    }
    passed += 1;
    // Squeezed-grid reruns are limited to inputs where a 1-workgroup pass_a is
    // still tractable; they are about covering the stride code, not throughput.
    if (units.length > 64 * 1024) {
      continue;
    }
    for (const cap of strideCaps) {
      const strideOk = await runOne(
        `${testCase.name} [gridCap=${cap}]`,
        testCase.text,
        units,
        expected,
        cap,
      );
      if (!strideOk) {
        failures += 1;
        aborted = true;
        break;
      }
      stridePassed += 1;
    }
    if (aborted) {
      break;
    }
  }

  // --- failure-mode gates ---------------------------------------------------
  // These do not compare records; they assert that the backend REFUSES rather
  // than silently returning a stale or zeroed result. Every one of them used to
  // return `tokenCount=0, overflow=false` with no exception.
  let guardsPassed = 0;
  let guardsFailed = 0;
  const guard = (name: string, ok: boolean, detail: string) => {
    if (ok) {
      guardsPassed += 1;
      return;
    }
    guardsFailed += 1;
    console.error(`FAIL guard ${name}: ${detail}`);
  };

  console.log(
    `device limits: maxStorageBufferBindingSize=${gpu.limits.maxStorageBufferBindingSize} maxBufferSize=${gpu.limits.maxBufferSize} maxComputeWorkgroupStorageSize=${gpu.limits.maxComputeWorkgroupStorageSize} chunkSize=${gpu.chunkSize}`,
  );
  console.log(
    `max input at worst-case capacity: ${gpu.maxInputUnits(1)} UTF-16 units`,
  );
  guard(
    "maxInputUnits-is-finite-and-positive",
    Number.isFinite(gpu.maxInputUnits(1)) && gpu.maxInputUnits(1) > 0,
    `maxInputUnits(1) = ${gpu.maxInputUnits(1)}`,
  );

  // Over-limit input must raise GpuLexerCapacityError, not return zero tokens.
  // The check runs before any GPU allocation, so the only real cost is the
  // probe Uint16Array itself.
  const recordsWall = Math.floor(gpu.limits.maxStorageBufferBindingSize / 16);
  if (recordsWall + 1 <= 300_000_000) {
    let capacityError: unknown = null;
    try {
      await gpu.lex(new Uint16Array(recordsWall + 1));
    } catch (error) {
      capacityError = error;
    }
    guard(
      "over-limit-input-throws",
      capacityError instanceof GpuLexerCapacityError,
      `expected GpuLexerCapacityError, got ${String(capacityError)}`,
    );
    // ...and the instance must still be usable afterwards.
    const afterUnits = toUtf16("def foo = add(1);");
    const afterExpected = cpu.lex(afterUnits).records;
    const afterActual = await gpu.lex(afterUnits);
    guard(
      "not-poisoned-after-refusal",
      compare(afterExpected, afterActual.records) === null,
      "records after a refused over-limit call do not match the CPU",
    );
  } else {
    console.log(
      `note: records binding wall is ${
        recordsWall + 1
      } units; too large to allocate a probe array, over-limit gate skipped`,
    );
  }

  // Overflow must be reported, and must be reported as overflow.
  const overflowUnits = toUtf16(randomizedFuncfuckSource(8192, 5150));
  const overflowResult = await gpu.lex(overflowUnits, { capacityRecords: 4 });
  guard(
    "undersized-capacity-sets-overflow",
    overflowResult.overflow === true && overflowResult.tokenCount > 4,
    `overflow=${overflowResult.overflow} tokenCount=${overflowResult.tokenCount}`,
  );

  // The WebGPU-guaranteed maxComputeWorkgroupStorageSize is 16384 B, half of
  // what a 4096-unit pass_b chunk needs. Re-run the whole corpus with the chunk
  // size the floor forces, so that path is covered rather than assumed.
  const floorGpu = await WebGpuLexer.create(planBytes, {
    allowFallbackAdapter: true,
    simulateWorkgroupStorageLimit: 16384,
  });
  console.log(
    `floor-device simulation (maxComputeWorkgroupStorageSize=16384): chunkSize=${floorGpu.chunkSize}`,
  );
  guard(
    "floor-device-picks-smaller-chunk",
    floorGpu.chunkSize === 2048,
    `expected chunkSize 2048, got ${floorGpu.chunkSize}`,
  );
  let floorPassed = 0;
  let floorFailed = 0;
  for (const testCase of cases) {
    const units = toUtf16(testCase.text);
    if (units.length > 64 * 1024) {
      continue;
    }
    const expected = cpu.lex(units).records;
    const actual = await floorGpu.lex(units);
    if (compare(expected, actual.records) === null && !actual.overflow) {
      floorPassed += 1;
      continue;
    }
    floorFailed += 1;
    console.error(`FAIL floor-device ${testCase.name}`);
    break;
  }
  guard(
    "floor-device-parity",
    floorFailed === 0,
    `${floorFailed} floor-device cases failed`,
  );
  floorGpu.destroy();

  gpu.destroy();

  // lex() after destroy() must throw, not reuse a bind group over dead buffers.
  let afterDestroy: unknown = null;
  try {
    await gpu.lex(toUtf16("def x = id(1);"));
  } catch (error) {
    afterDestroy = error;
  }
  guard(
    "lex-after-destroy-throws",
    afterDestroy instanceof Error,
    `expected an Error, got ${String(afterDestroy)}`,
  );

  console.log("");
  console.log(
    `parity: ${passed} passed, ${failures} failed, ${cases.length} total`,
  );
  console.log(
    `grid-stride reruns (gridCap ${
      strideCaps.join("/")
    }, inputs <= 64 KiB): ${stridePassed} passed`,
  );
  console.log(
    `floor-device reruns (chunkSize=${floorGpu.chunkSize}, inputs <= 64 KiB): ${floorPassed} passed, ${floorFailed} failed`,
  );
  console.log(
    `guards: ${guardsPassed} passed, ${guardsFailed} failed`,
  );
  if (failures > 0 || guardsFailed > 0) {
    return 1;
  }
  return 0;
}

Deno.exit(await main());
