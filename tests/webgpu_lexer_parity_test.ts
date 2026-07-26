/**
 * Byte-exact parity gate for the experimental WebGPU lexer backend
 * (`src/runtime/webgpu/`) against the shipping Rust/Wasm `lex_all`.
 *
 * ===========================================================================
 * THE PARITY PORTION OF THIS FILE DOES NOT RUN IN CI.
 *
 * CI is `ubuntu-latest` with no GPU. `requestAdapter()` returns null there (and
 * on a runtime that does not expose WebGPU at all, `navigator.gpu` is simply
 * absent), so every GPU test below is registered with `ignore: true` and
 * silently skips. The byte-exact parity gate for the WebGPU backend is
 * therefore UNENFORCED IN CI. It is enforced only on a machine that has a
 * WebGPU adapter.
 *
 * Do not read a green CI run as evidence that GPU parity holds. Run
 * `deno task test` locally on a GPU box, and `deno task parity:webgpu-lexer`
 * for the wider sweep across the four shipped example grammars.
 * ===========================================================================
 *
 * The two non-GPU tests at the end of this file (plan decoding / dense
 * alphabet cross-check, and guard refusal) DO run in CI. They cover the
 * host-side table decoding, which is where most of the plan-reading risk is.
 *
 * This file never reads `examples/<name>/generated/wasm/*`: that directory is
 * gitignored and absent on a fresh clone. Following `tests/wasm_test.ts`, the
 * grammar is compiled inline and `parser.plan` / `parser.wasm` are taken
 * straight out of the returned `GeneratedFile[]`.
 */

import { assert, assertEquals, compile } from "./helpers.ts";
import {
  CpuReferenceLexer,
  toUtf16,
} from "../scripts/webgpu_lexer_cpu_reference.ts";
import { WebGpuLexer } from "../src/runtime/webgpu/mod.ts";
import { decodeLexerPlanTables } from "../src/runtime/webgpu/plan_tables.ts";
import {
  buildAlphabetTables,
  verifyAlphabetAgainstSparse,
} from "../src/runtime/webgpu/alphabet.ts";
import { SEG_SIZE } from "../src/runtime/webgpu/kernel_wgsl.ts";

/**
 * A guard-free grammar. Guard-free is a hard requirement of the backend, and
 * every token class here exists to reach a specific part of the kernel:
 *
 * - `IDENT` / `INT` give longest-match-with-restart and backtracking ("12a");
 * - `STRING` is unterminated-able, which exercises a live run that dies at EOF;
 * - `MARK` is the one token class whose characters live above ASCII, so the
 *   kernel's binary-searched above-ASCII range list is load-bearing rather
 *   than a single dead catch-all range;
 * - `WS` and `COMMENT` give cheap ways to build a single token thousands of
 *   code units long, which is what spans three or more `pass_x` segments.
 *
 * Every token is referenced by a rule on purpose: an unreferenced named token
 * is pruned out of the lexer DFA, and a pruned `MARK` would take the whole
 * above-ASCII partition with it.
 *
 * Note on `MARK`: Baba's grammar frontend currently re-reads non-ASCII grammar
 * source as individual UTF-8 bytes, so the codepoints this class actually
 * covers are not the ones it reads like. That does not weaken anything here -
 * the point is only that a non-trivial partition exists above U+007F, and both
 * lexers under comparison read the same plan either way.
 */
const PARITY_GRAMMAR = `
  token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
  token INT = /[0-9]+/ ;
  token STRING = /"([^"\\\\]|\\\\.)*"/ ;
  token MARK = /[À-ɏ]+/ ;
  skip COMMENT = /\\/\\/[^\\n]*/ ;
  skip WS = /[ \\t\\r\\n]+/ ;

  module = statements:statement* ;
  statement =
      "let" name:IDENT "=" value:INT ";"
    | "text" text:STRING ";"
    | "mark" mark:MARK ";"
    ;
`;

/** A grammar the backend must refuse: trailing lookahead makes accept positional. */
const GUARDED_GRAMMAR = `
  token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
  token INT = /[0-9]+/ ;
  skip WS = /[\\r\\n]+/ ;
  contextual APPLICATION_SPACE = /[ \\t]+(?=[A-Za-z_])/ ;

  module = head:IDENT (APPLICATION_SPACE arguments:IDENT)* ;
`;

interface GrammarArtifacts {
  readonly plan: Uint8Array;
  readonly wasm: Uint8Array;
}

/**
 * Compile inline and pull the two binary artifacts out of the bundle. Nothing
 * touches the filesystem, so this works on a fresh clone with no `bootstrap`.
 */
function compileArtifacts(source: string): GrammarArtifacts {
  const result = compile(source, { targets: ["wasm"] });
  assertEquals(result.diagnostics.length, 0, "Expected a clean compile.");
  assert(result.bundle, "Expected a generated bundle.");
  return {
    plan: binaryFile(result.bundle.files, "wasm/parser.plan"),
    wasm: binaryFile(result.bundle.files, "wasm/parser.wasm"),
  };
}

function binaryFile(
  files: readonly { path: string; encoding: string; content: unknown }[],
  path: string,
): Uint8Array {
  const file = files.find((entry) => entry.path === path);
  if (file === undefined) {
    throw new Error(`The generated bundle has no ${path}.`);
  }
  if (file.encoding !== "binary") {
    throw new Error(`Generated file ${path} is ${file.encoding}, not binary.`);
  }
  return file.content as Uint8Array;
}

interface NamedInput {
  readonly name: string;
  readonly text: string;
}

/**
 * Adversarial inputs. Deliberately NOT a smoke test: every entry is here
 * because it reaches a branch the others do not.
 *
 * `segSize` is `pass_x`'s segment size and `chunkSize` is `pass_b`'s
 * device-chosen chunk size. They are two independent grids and each one needs
 * its own boundary sweep.
 */
function parityInputs(segSize: number, chunkSize: number): NamedInput[] {
  const inputs: NamedInput[] = [
    // --- degenerate ---------------------------------------------------------
    { name: "empty", text: "" },
    { name: "single-space", text: " " },
    { name: "single-letter", text: "x" },
    { name: "single-digit", text: "7" },

    // --- error tokens (specIndex -1, one codepoint each) --------------------
    { name: "single-bad-char", text: "@" },
    { name: "all-bad", text: "@@@@@@" },
    { name: "bad-between-good", text: "let@x@=@1@;" },
    { name: "long-error-run", text: "@".repeat(9000) },

    // --- surrogates ---------------------------------------------------------
    { name: "lone-high-surrogate", text: "\ud83d" },
    { name: "lone-low-surrogate", text: "\ude00" },
    { name: "high-then-non-low", text: "\ud83da" },
    { name: "paired-surrogate", text: "\u{1F600}" },
    { name: "paired-surrogate-run", text: "\u{1F600}\u{1F601}\u{1F602}" },
    { name: "surrogate-sandwich", text: "let \u{1F600} x = 1;" },
    { name: "trailing-high-surrogate", text: "let x\ud83d" },
    { name: "low-then-high", text: "\ude00\ud83d" },

    // --- above-ASCII BMP, where the range list is the classifier ------------
    { name: "accent-token", text: "let éèê = 1;" },
    { name: "arrows-token", text: "←→ let x = 1;" },
    { name: "above-ascii-unclassed", text: "let あい = 1;" },
    { name: "bmp-boundary-007f-0080", text: "¿À" },

    // --- longest match with restart / backtracking --------------------------
    { name: "backtrack-int-then-ident", text: "12a" },
    { name: "keyword-prefix-run", text: "l le let lets letter x" },
    { name: "run-past-accept", text: "let1234abc" },
    { name: "unterminated-string", text: 'let s = "abc' },
    { name: "unterminated-string-escape", text: 'let s = "abc\\' },
    { name: "string-quote-only", text: '"' },
    { name: "closed-string", text: 'let s = "a\\"b";' },
    { name: "comment-to-eof", text: "// trailing comment with no newline" },
    {
      name: "mixed-line-endings",
      text: "let a = 1;\r\nlet b = 2;\rlet c = 3;",
    },

    // --- one token thousands of code units long ------------------------------
    { name: "long-whitespace-run", text: `let${" ".repeat(9000)}x = 1;` },
    { name: "long-identifier", text: `let ${"a".repeat(9000)} = 1;` },
    { name: "long-integer", text: `let x = ${"9".repeat(9000)};` },
    { name: "long-unterminated-string", text: `"${"a".repeat(9000)}` },
    { name: "long-comment", text: `//${"c".repeat(9000)}\nx` },
    { name: "only-newlines", text: "\n".repeat(5000) },
  ];

  // --- pass_b chunk boundaries ---------------------------------------------
  inputs.push({
    name: "exactly-one-chunk",
    text: "a".repeat(chunkSize),
  });
  inputs.push({
    name: "one-chunk-plus-one",
    text: "a".repeat(chunkSize + 1),
  });
  inputs.push({
    name: "token-spanning-chunk",
    text: `${" ".repeat(chunkSize - 6)}${"z".repeat(2 * chunkSize)} let x;`,
  });
  for (let offset = chunkSize - 6; offset <= chunkSize + 6; offset += 1) {
    inputs.push({
      name: `chunk-edge-astral-${offset}`,
      text: `${"a".repeat(offset)}\u{1F600} let x = 12345;`,
    });
  }

  // --- pass_x segment boundaries -------------------------------------------
  // A surrogate pair straddling a nominal segment boundary is the subtlest
  // failure mode in the design: the boundary has to move one unit right or the
  // segment handoff does not line up. An ASCII-only sweep cannot reach it.
  for (let offset = segSize - 6; offset <= segSize + 6; offset += 1) {
    inputs.push({
      name: `seg-edge-astral-${offset}`,
      text: `${"a".repeat(offset)}\u{1F600} let x = 12345;`,
    });
    inputs.push({
      name: `seg-edge-live-run-${offset}`,
      text: `${" ".repeat(offset)}${"z".repeat(9000)} let x;`,
    });
  }
  // An accept landing EXACTLY on a segment boundary is the one offset where
  // "relative to the segment base" and "belongs to the next segment" disagree.
  inputs.push({
    name: "seg-accept-on-boundary-ident",
    text: `${"a".repeat(segSize)} tail`,
  });
  inputs.push({
    name: "seg-accept-on-boundary-ws",
    text: `${" ".repeat(segSize)}tail`,
  });
  inputs.push({
    name: "seg-accept-on-boundary-digits",
    text: `${"9".repeat(segSize)} tail`,
  });
  inputs.push({
    name: "seg-accept-on-boundary-then-dies",
    text: `${"a".repeat(segSize)}@tail`,
  });
  inputs.push({
    name: "seg-accept-just-before-boundary",
    text: `${"a".repeat(segSize - 1)} tail`,
  });
  inputs.push({
    name: "seg-accept-just-after-boundary",
    text: `${"a".repeat(segSize + 1)} tail`,
  });

  // --- tokens spanning three or more segments -------------------------------
  // The first case that needs pass_y's composition to be associative rather
  // than merely correct for a single hop.
  inputs.push({
    name: "run-spans-3-segments-ws",
    text: `${" ".repeat(3 * segSize + 37)}let x;`,
  });
  inputs.push({
    name: "run-spans-3-segments-to-eof",
    text: "a".repeat(3 * segSize),
  });
  inputs.push({
    name: "run-spans-4-segments-astral",
    text: "\u{1F600}".repeat(2 * segSize + 5),
  });
  inputs.push({
    name: "run-spans-5-segments-ident",
    text: `${"a".repeat(5 * segSize + 11)} let x;`,
  });
  inputs.push({
    name: "run-spans-4-segments-string",
    text: `"${"s".repeat(4 * segSize)}`,
  });
  inputs.push({
    name: "run-spans-3-segments-comment",
    text: `//${"c".repeat(3 * segSize)}\nlet x = 1;`,
  });

  // --- a realistic bulk input, and a randomized one -------------------------
  inputs.push({
    name: "repeated-statements",
    text: repeatTo(SAMPLE, 256 * 1024),
  });
  inputs.push({ name: "randomized-1MiB", text: randomizedSource(1024 * 1024) });

  return inputs;
}

const SAMPLE = [
  "let alpha = 1;",
  "// a comment",
  'let beta = 22; let s = "text";',
  "let éè = 333;",
  "let gamma = 4444;",
].join("\n") + "\n";

function repeatTo(unit: string, targetChars: number): string {
  const repeats = Math.max(1, Math.ceil(targetChars / unit.length));
  return unit.repeat(repeats).slice(0, targetChars);
}

/**
 * xorshift32-driven source, so chunk and segment boundaries land in many
 * different places relative to token structure. Strictly periodic input would
 * only ever produce a handful of distinct boundary contexts.
 */
function randomizedSource(targetChars: number): string {
  let state = 0x5eed_1234;
  const random = () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
  const spacing = [" ", "  ", "\n", "\t", " \n", "\r\n", "\n\n", "   \t "];
  const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_";
  const parts: string[] = [];
  let length = 0;
  while (length < targetChars) {
    const space = () => spacing[Math.floor(random() * spacing.length)];
    let ident = "";
    const identLength = 1 + Math.floor(random() * 12);
    for (let index = 0; index < identLength; index += 1) {
      ident += letters[Math.floor(random() * letters.length)];
    }
    let digits = "";
    const digitCount = 1 + Math.floor(random() * 9);
    for (let index = 0; index < digitCount; index += 1) {
      digits += String(Math.floor(random() * 10));
    }
    let piece =
      `let${space()}${ident}${space()}=${space()}${digits};${space()}`;
    const flavour = Math.floor(random() * 8);
    if (flavour === 0) {
      piece += `// note ${ident}\n`;
    }
    if (flavour === 1) {
      piece += `"${ident}" `;
    }
    if (flavour === 2) {
      piece += `@ `;
    }
    if (flavour === 3) {
      piece += `é${ident}→ `;
    }
    parts.push(piece);
    length += piece.length;
  }
  return parts.join("").slice(0, targetChars);
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

/**
 * Byte-exact comparison of the two record arrays, field by field. Returns null
 * on equality, otherwise a message naming the first differing field and its
 * neighbourhood on both sides.
 */
function recordDifference(
  expected: Int32Array,
  actual: Int32Array,
): string | null {
  const fieldNames = ["specIndex", "start", "end", "acceptingState"];
  const expectedCount = expected.length / 4;
  const actualCount = actual.length / 4;
  const shared = Math.min(expectedCount, actualCount);
  for (let index = 0; index < shared; index += 1) {
    const base = index * 4;
    for (let field = 0; field < 4; field += 1) {
      if (expected[base + field] === actual[base + field]) {
        continue;
      }
      const lines = [
        `record ${index} ${fieldNames[field]} differs: wasm=${
          expected[base + field]
        } gpu=${actual[base + field]}`,
      ];
      for (let probe = Math.max(0, index - 2); probe <= index + 2; probe += 1) {
        lines.push(
          `  [${probe}] wasm=${describeRecord(expected, probe)} gpu=${
            describeRecord(actual, probe)
          }`,
        );
      }
      return lines.join("\n");
    }
  }
  if (expectedCount !== actualCount) {
    return `token count differs: wasm=${expectedCount} gpu=${actualCount}`;
  }
  return null;
}

/**
 * Adapter probe. `navigator.gpu` is absent entirely without `--unstable-webgpu`
 * or on a runtime with no WebGPU at all, and `requestAdapter()` resolves to
 * null on a machine with no usable GPU (which is every CI runner here). An
 * explicit `if` for each, because AGENTS.md forbids `??` and ternaries.
 */
async function probeAdapter(): Promise<GPUAdapter | null> {
  if (typeof navigator === "undefined") {
    return null;
  }
  if (navigator.gpu === undefined) {
    return null;
  }
  try {
    return await navigator.gpu.requestAdapter();
  } catch {
    return null;
  }
}

const adapter = await probeAdapter();
const noWebGpu = adapter === null;
if (noWebGpu) {
  console.log(
    "[webgpu_lexer_parity_test] no WebGPU adapter; the byte-exact GPU parity gate is SKIPPED.",
  );
}

Deno.test({
  name:
    "WebGPU lexer emits byte-exact lex_all records on adversarial, boundary and long-token inputs",
  ignore: noWebGpu,
  fn: async () => {
    const { plan, wasm } = compileArtifacts(PARITY_GRAMMAR);

    const tables = decodeLexerPlanTables(plan);
    assert(
      tables.guardFree,
      `The parity grammar must be guard-free; plan reports: ${
        tables.guardDiagnostics.join("; ")
      }`,
    );

    const cpu = CpuReferenceLexer.create(wasm, plan);
    const gpu = await WebGpuLexer.create(plan);
    try {
      const inputs = parityInputs(SEG_SIZE, gpu.chunkSize);
      assert(inputs.length > 80, "Expected a substantial parity corpus.");

      for (const input of inputs) {
        const units = toUtf16(input.text);
        const expected = cpu.lex(units).records;
        const actual = await gpu.lex(units);
        assert(
          !actual.overflow,
          `${input.name}: GPU reported output-buffer overflow at ${actual.tokenCount} tokens.`,
        );
        const difference = recordDifference(expected, actual.records);
        assertEquals(
          difference,
          null,
          `${input.name} (${units.length} UTF-16 units)\n${difference}`,
        );
      }

      // Every pass is a grid-stride loop so that an input needing more than
      // maxComputeWorkgroupsPerDimension workgroups still dispatches legally.
      // No runnable input reaches that grid on a device reporting 65535, so the
      // stride path is unreachable without squeezing the grid by hand.
      for (const cap of [1, 3, 7]) {
        for (const input of inputs) {
          const units = toUtf16(input.text);
          if (units.length > 64 * 1024) {
            continue;
          }
          const expected = cpu.lex(units).records;
          const actual = await gpu.lex(units, {
            debugMaxWorkgroupsPerDimension: cap,
          });
          const difference = recordDifference(expected, actual.records);
          assertEquals(
            difference,
            null,
            `${input.name} [gridCap=${cap}]\n${difference}`,
          );
        }
      }
    } finally {
      gpu.destroy();
    }
  },
});

Deno.test({
  name:
    "WebGPU lexer keeps parity on a device simulated down to the WebGPU-guaranteed workgroup-storage floor",
  ignore: noWebGpu,
  fn: async () => {
    const { plan, wasm } = compileArtifacts(PARITY_GRAMMAR);
    const cpu = CpuReferenceLexer.create(wasm, plan);
    // The guaranteed floor is 16384 B, half of what a 4096-unit pass_b chunk
    // needs. wgpu does not validate workgroup storage at pipeline creation, so
    // without this hook the smaller-chunk fallback would ship untested.
    const gpu = await WebGpuLexer.create(plan, {
      simulateWorkgroupStorageLimit: 16384,
    });
    try {
      assertEquals(
        gpu.chunkSize,
        2048,
        "Expected the floor device to halve the chunk size.",
      );
      for (const input of parityInputs(SEG_SIZE, gpu.chunkSize)) {
        const units = toUtf16(input.text);
        if (units.length > 64 * 1024) {
          continue;
        }
        const expected = cpu.lex(units).records;
        const actual = await gpu.lex(units);
        assert(!actual.overflow, `${input.name}: unexpected overflow.`);
        const difference = recordDifference(expected, actual.records);
        assertEquals(
          difference,
          null,
          `floor-device ${input.name}\n${difference}`,
        );
      }
    } finally {
      gpu.destroy();
    }
  },
});

Deno.test({
  name: "WebGPU lexer reports overflow rather than silently truncating",
  ignore: noWebGpu,
  fn: async () => {
    const { plan, wasm } = compileArtifacts(PARITY_GRAMMAR);
    const cpu = CpuReferenceLexer.create(wasm, plan);
    const gpu = await WebGpuLexer.create(plan);
    try {
      const units = toUtf16(repeatTo(SAMPLE, 8192));
      const full = cpu.lex(units).records.length / 4;
      const squeezed = await gpu.lex(units, { capacityRecords: 4 });
      assertEquals(squeezed.overflow, true);
      assertEquals(squeezed.tokenCount, full);
      // The instance must still be usable after a reported overflow.
      const after = await gpu.lex(units);
      assertEquals(after.overflow, false);
      assertEquals(
        recordDifference(cpu.lex(units).records, after.records),
        null,
      );
    } finally {
      gpu.destroy();
    }
  },
});

// --- these two run everywhere, including CI ---------------------------------

Deno.test("WebGPU lexer plan decoding builds a dense alphabet that agrees with the plan CSR tables", () => {
  const { plan } = compileArtifacts(PARITY_GRAMMAR);
  const tables = decodeLexerPlanTables(plan);
  assert(tables.stateCount > 0, "Expected a non-empty lexer DFA.");
  assert(tables.specCount > 0, "Expected at least one lexer spec.");
  assertEquals(
    tables.guardDiagnostics.length,
    0,
    `unexpected guard diagnostics: ${tables.guardDiagnostics.join("; ")}`,
  );
  assertEquals(tables.guardFree, true);

  const alphabet = buildAlphabetTables(tables);
  assert(alphabet.classCount > 1, "Expected more than one equivalence class.");
  assert(
    alphabet.aboveAsciiRanges.length > 1,
    "The grammar has classes above ASCII; expected a real range list.",
  );

  const verification = verifyAlphabetAgainstSparse(tables, alphabet);
  assert(verification.checked > 0, "Expected the cross-check to probe cells.");
  assertEquals(
    verification.mismatches,
    0,
    `dense/sparse disagreement: ${JSON.stringify(verification.firstMismatch)}`,
  );
});

Deno.test("WebGPU lexer plan decoding reports guard-carrying grammars instead of collapsing them", () => {
  const { plan } = compileArtifacts(GUARDED_GRAMMAR);
  const tables = decodeLexerPlanTables(plan);
  assertEquals(tables.guardFree, false);
  assert(
    tables.guardDiagnostics.length > 0,
    "Expected at least one guard diagnostic.",
  );
});
