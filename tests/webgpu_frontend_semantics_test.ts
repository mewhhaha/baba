import { assert, assertEquals, compile, parseMetadata } from "./helpers.ts";
import { decodeGpuFrontendPlan } from "../src/runtime/webgpu/frontend_plan.ts";
import {
  type CompactFrontendProgram,
  executeCompactSemanticRecipes,
} from "../src/runtime/webgpu/frontend.ts";
import type { GpuFrontendDiagnosticRecord } from "../src/runtime/webgpu/frontend_contract.ts";

const [grammar, metadataSource] = await Promise.all([
  Deno.readTextFile(
    new URL("../examples/funcfuck/grammar.baba", import.meta.url),
  ),
  Deno.readTextFile(new URL("../examples/funcfuck/baba.json", import.meta.url)),
]);
const built = compile(grammar, {
  name: "funcfuck",
  rootRule: "module",
  metadata: parseMetadata(metadataSource),
  targets: ["wasm"],
});
assert(
  built.bundle,
  built.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
);
const planFile = built.bundle.files.find((file) =>
  file.path === "wasm/parser.plan"
);
assert(planFile);
assert(planFile.encoding === "binary");
const plan = decodeGpuFrontendPlan(planFile.content);

Deno.test("compact semantic recipes preserve diagnostics with absent recipe classes", () => {
  const definition = plan.semanticRecipes.find((recipe) =>
    recipe.opcode === "define"
  );
  const reference = plan.semanticRecipes.find((recipe) =>
    recipe.opcode === "reference"
  );
  const repeat = plan.semanticRecipes.find((recipe) =>
    recipe.opcode === "repeat-limit"
  );
  assert(definition);
  assert(reference);
  assert(repeat);
  const definitionField = definition.fields.find((field) =>
    field.target === "binder"
  );
  const referenceField = reference.fields.find((field) =>
    field.target === "name"
  );
  const repeatField = repeat.fields.find((field) => field.target === "count");
  assert(definitionField);
  assert(referenceField);
  assert(repeatField);
  const source = "alpha alpha missing 2147483648 1000001";
  const program: CompactFrontendProgram = {
    tokens: new Int32Array([
      0,
      0,
      5,
      0,
      0,
      6,
      11,
      0,
      0,
      12,
      19,
      0,
      0,
      20,
      30,
      0,
      0,
      31,
      38,
      0,
    ]),
    nodes: new Int32Array([
      definition.ruleId,
      0,
      0,
      5,
      0,
      1,
      -1,
      -1,
      definition.ruleId,
      0,
      6,
      11,
      1,
      1,
      -1,
      -1,
      reference.ruleId,
      0,
      12,
      19,
      2,
      1,
      -1,
      -1,
      repeat.ruleId,
      0,
      31,
      38,
      3,
      1,
      -1,
      -1,
    ]),
    edges: new Int32Array([
      definitionField.field,
      0,
      0,
      0,
      definitionField.field,
      0,
      0,
      1,
      referenceField.field,
      0,
      0,
      2,
      repeatField.field,
      0,
      0,
      4,
    ]),
    symbols: new Int32Array(0),
    types: new Int32Array([0]),
  };
  const duplicate = [7, 6, 11, 1, 0, 0];
  const unknownReference = [8, 12, 19, 2, 0, 0];
  const integerBounds = [10, 20, 30, 3, 0, 0];
  const repeatLimit = [11, 31, 38, 3, 1_000_000, 0];
  for (
    const [opcodes, expectedDiagnostics, expectedSymbols] of [
      [[], [integerBounds], []],
      [["define"], [duplicate, integerBounds], [0, 0, 0, -1, -1, 0]],
      [["reference"], [unknownReference, integerBounds], []],
      [["repeat-limit"], [integerBounds, repeatLimit], []],
      [
        ["define", "reference", "repeat-limit"],
        [duplicate, unknownReference, integerBounds, repeatLimit],
        [0, 0, 0, -1, -1, 0],
      ],
    ] as const
  ) {
    const selected = new Set<string>(opcodes);
    const partialPlan = {
      ...plan,
      semanticRecipes: plan.semanticRecipes.filter((recipe) =>
        selected.has(recipe.opcode)
      ),
    };
    const diagnostics: GpuFrontendDiagnosticRecord[] = [];
    const symbols = executeCompactSemanticRecipes(
      program,
      partialPlan,
      source,
      diagnostics,
    );
    assertEquals(
      JSON.stringify(diagnostics.map((diagnostic) => [
        diagnostic.code,
        diagnostic.start,
        diagnostic.end,
        diagnostic.subjectId,
        diagnostic.parameter0,
        diagnostic.parameter1,
      ])),
      JSON.stringify(expectedDiagnostics),
    );
    assertEquals(symbols.join(","), expectedSymbols.join(","));
  }
});

Deno.test("compact integer bounds retain signs, leading zeros, and i32 limits", () => {
  for (
    const [source, tokenStart, overflow] of [
      ["0", 0, false],
      ["999999999", 0, false],
      ["-999999999", 0, false],
      ["2147483647", 0, false],
      ["2147483648", 0, true],
      ["-2147483648", 0, false],
      ["-2147483648", 1, false],
      ["-2147483649", 0, true],
      ["-2147483649", 1, true],
      ["0000000000000000001", 0, false],
      ["00000000002147483648", 0, true],
      ["-00000000002147483648", 0, false],
      ["-00000000002147483648", 1, false],
      [
        "0000000000000000000000000000000000000000000000000000000000001",
        0,
        false,
      ],
      ["", 0, false],
      ["-", 0, false],
      ["+", 0, false],
      ["123x", 0, false],
      ["999999999999999999999999999999999999x", 0, false],
    ] as const
  ) {
    const diagnostics: GpuFrontendDiagnosticRecord[] = [];
    const program: CompactFrontendProgram = {
      tokens: new Int32Array([0, tokenStart, source.length, 0]),
      nodes: new Int32Array(0),
      edges: new Int32Array(0),
      symbols: new Int32Array(0),
      types: new Int32Array([0]),
    };
    executeCompactSemanticRecipes(
      program,
      { ...plan, semanticRecipes: [] },
      source,
      diagnostics,
    );
    if (overflow) {
      assertEquals(diagnostics.length, 1);
      assertEquals(diagnostics[0].code, 10);
      assertEquals(diagnostics[0].start, tokenStart);
      assertEquals(diagnostics[0].end, source.length);
      assertEquals(diagnostics[0].subjectId, 0);
    } else {
      assertEquals(diagnostics.length, 0);
    }
  }
});

Deno.test("compact reference ownership preserves definition order across span shapes", () => {
  const definition = plan.semanticRecipes.find((recipe) =>
    recipe.opcode === "define"
  );
  const reference = plan.semanticRecipes.find((recipe) =>
    recipe.opcode === "reference"
  );
  assert(definition);
  assert(reference);
  const definitionField = definition.fields.find((field) =>
    field.target === "binder"
  );
  const referenceField = reference.fields.find((field) =>
    field.target === "name"
  );
  assert(definitionField);
  assert(referenceField);
  for (
    const [
      source,
      definitionSpans,
      binderTokens,
      referenceSpans,
      expectedCycles,
    ] of [
      [
        "a b b a",
        [[0, 3], [4, 7]],
        [0, 2],
        [[2, 3], [6, 7]],
        [[9, 0, 3, 0, 0, 0]],
      ],
      [
        "a b b a",
        [[4, 7], [0, 3]],
        [2, 0],
        [[2, 3], [6, 7]],
        [[9, 4, 7, 0, 0, 0]],
      ],
      ["a b b b", [[0, 7], [4, 7]], [0, 2], [[2, 3], [6, 7]], []],
      [
        "a b b a",
        [[0, 7], [4, 5]],
        [0, 2],
        [[2, 3], [6, 7]],
        [[9, 0, 7, 0, 0, 0]],
      ],
      ["a b b b", [[0, 4], [4, 7]], [0, 2], [[2, 3], [4, 4]], []],
    ] as const
  ) {
    const nodeWords: number[] = [];
    for (let index = 0; index < 2; index += 1) {
      nodeWords.push(
        definition.ruleId,
        0,
        definitionSpans[index][0],
        definitionSpans[index][1],
        index,
        1,
        -1,
        -1,
      );
    }
    for (let index = 0; index < 2; index += 1) {
      nodeWords.push(
        reference.ruleId,
        0,
        referenceSpans[index][0],
        referenceSpans[index][1],
        index + 2,
        1,
        -1,
        -1,
      );
    }
    const program: CompactFrontendProgram = {
      tokens: new Int32Array([0, 0, 1, 0, 0, 2, 3, 0, 0, 4, 5, 0, 0, 6, 7, 0]),
      nodes: new Int32Array(nodeWords),
      edges: new Int32Array([
        definitionField.field,
        0,
        0,
        binderTokens[0],
        definitionField.field,
        0,
        0,
        binderTokens[1],
        referenceField.field,
        0,
        0,
        1,
        referenceField.field,
        0,
        0,
        3,
      ]),
      symbols: new Int32Array(0),
      types: new Int32Array([0]),
    };
    const diagnostics: GpuFrontendDiagnosticRecord[] = [];
    const symbols = executeCompactSemanticRecipes(
      program,
      plan,
      source,
      diagnostics,
    );
    assertEquals(
      symbols.join(","),
      [0, 0, binderTokens[0], -1, -1, 0, 0, 0, binderTokens[1], -1, -1, 1].join(
        ",",
      ),
    );
    assertEquals(
      JSON.stringify(diagnostics.map((diagnostic) => [
        diagnostic.code,
        diagnostic.start,
        diagnostic.end,
        diagnostic.subjectId,
        diagnostic.parameter0,
        diagnostic.parameter1,
      ])),
      JSON.stringify(expectedCycles),
    );
  }
});
