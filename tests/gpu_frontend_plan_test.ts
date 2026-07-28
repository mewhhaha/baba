import { assert, assertEquals, compile, parseMetadata } from "./helpers.ts";
import {
  CpuFrontend,
  decodeGpuFrontendPlan,
  inspectGpuFrontendPlan,
  WebGpuRuntime,
} from "../src/runtime/webgpu/mod.ts";

const GRAMMAR = String.raw`
token IDENT = /[a-z]+/ ;
token INTEGER = /[0-9]+/ ;
skip WS = /[ \t\r\n]+/ ;

module = statements:statement* ;
statement = "let" name:IDENT "=" value:INTEGER ";" ;
`;

const METADATA = parseMetadata(JSON.stringify({
  version: 2,
  gpuFrontend: {
    version: 3,
    root: "module",
    islands: [
      { rule: "module", boundary: { kind: "root" } },
      {
        rule: "statement",
        boundary: { kind: "terminated", terminal: ";" },
      },
    ],
    semantics: {
      rules: {
        module: { opcode: "module" },
        statement: {
          opcode: "binding",
          fields: { name: "binder", value: "value" },
        },
      },
      scopes: ["module"],
      binders: ["statement"],
    },
  },
}));

Deno.test("GPU frontend v3 is persisted and interpreted by the CPU oracle", () => {
  const built = compile(GRAMMAR, {
    name: "gpu_frontend_test",
    rootRule: "module",
    metadata: METADATA,
    targets: ["wasm"],
  });
  assert(
    built.bundle,
    built.diagnostics.map((diagnostic) =>
      `${diagnostic.code}: ${diagnostic.message}`
    ).join("\n"),
  );
  const planFile = built.bundle.files.find((file) =>
    file.path === "wasm/parser.plan"
  );
  assert(planFile);
  assert(planFile.encoding === "binary");

  const plan = decodeGpuFrontendPlan(planFile.content);
  assertEquals(plan.version, 3);
  assertEquals(
    plan.islands.map((island) => island.ruleName).join(","),
    "module,statement",
  );
  assertEquals(
    plan.semanticRecipes.map((recipe) => recipe.opcode).join(","),
    "module,binding",
  );
  assertEquals(plan.execution.locators.length, 2);
  assert(plan.execution.denseTransitions.targets.length > 0);
  assertEquals(plan.execution.contractions.length, 2);

  const frontend = CpuFrontend.create(planFile.content);
  for (
    const [source, expectedNodes] of [
      ["", 1],
      ["let first = 1;", 2],
      ["let first = 1;\nlet second = 2;", 3],
    ] as const
  ) {
    const result = frontend.ingest(source);
    assert(
      result.ok,
      result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
    );
    assertEquals(result.program.tokens.length % 4, 0);
    assertEquals(result.program.nodes.length / 8, expectedNodes);
  }
});

Deno.test("GPU frontend reports malformed delimiter syntax deterministically", () => {
  const metadata = parseMetadata(JSON.stringify({
    version: 2,
    gpuFrontend: {
      version: 3,
      root: "module",
      islands: [
        { rule: "module", boundary: { kind: "root" } },
        {
          rule: "statement",
          boundary: { kind: "paired", open: "=", close: ";" },
        },
      ],
      semantics: { rules: {} },
    },
  }));
  const built = compile(GRAMMAR, {
    name: "gpu_frontend_test",
    rootRule: "module",
    metadata,
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
  const result = CpuFrontend.create(planFile.content).ingest("let value = 1");
  assertEquals(result.ok, false);
  if (result.ok) {
    throw new Error("Expected malformed delimiter diagnostics.");
  }
  assertEquals(result.diagnostics[0].code, "GPU_FRONTEND_MALFORMED_DELIMITER");
});

Deno.test("Funcfuck reuses the GPU frontend transducer and semantic catalog", async () => {
  const grammar = await Deno.readTextFile(
    new URL("../examples/funcfuck/grammar.baba", import.meta.url),
  );
  const metadata = parseMetadata(
    await Deno.readTextFile(
      new URL("../examples/funcfuck/baba.json", import.meta.url),
    ),
  );
  const built = compile(grammar, {
    name: "funcfuck",
    rootRule: "module",
    metadata,
    targets: ["wasm"],
  });
  assert(
    built.bundle,
    built.diagnostics.map((diagnostic) =>
      `${diagnostic.code}: ${diagnostic.message}`
    ).join("\n"),
  );
  const planFile = built.bundle.files.find((file) =>
    file.path === "wasm/parser.plan"
  );
  assert(planFile);
  assert(planFile.encoding === "binary");
  const plan = decodeGpuFrontendPlan(planFile.content);
  assertEquals(plan.version, 3);
  assertEquals(
    plan.semanticRecipes.map((recipe) => recipe.opcode).join(","),
    "module,define,reference,repeat-limit",
  );
  const inspection = inspectGpuFrontendPlan(planFile.content);
  assert(inspection);
  assertEquals(inspection.islandCount, 7);
  assert(inspection.islandTransitions > 0);
  assertEquals(inspection.locatorCount, 7);
  assert(inspection.denseTransitionBytes > 0);
  assert(inspection.maxCandidateMultiplicity > 0);
  assertEquals(inspection.contractionRounds, 33);
  assert(inspection.scratchExpansionFactors.candidates > 0);

  const frontend = CpuFrontend.create(planFile.content);
  for (const programName of ["pipeline.ff", "fanout.ff", "window.ff"]) {
    const source = await Deno.readTextFile(
      new URL(`../examples/funcfuck/programs/${programName}`, import.meta.url),
    );
    const result = frontend.ingest(source);
    assert(
      result.ok,
      `${programName}: ${
        result.diagnostics.map((diagnostic) => diagnostic.message).join("\n")
      }`,
    );
    if (programName === "pipeline.ff") {
      assert(result.program.symbols.length > 0);
    }
  }

  for (
    const [source, expectedCode] of [
      ["emit [1] => missing;", "GPU_FRONTEND_UNKNOWN_REFERENCE"],
      [
        "def a = b; def b = a; emit [1] => a;",
        "GPU_FRONTEND_REFERENCE_CYCLE",
      ],
      ["emit [2147483648] => id;", "GPU_FRONTEND_INTEGER_BOUNDS"],
      ["emit [1] => repeat(-1, id);", "GPU_FRONTEND_REPEAT_LIMIT"],
    ] as const
  ) {
    const result = frontend.ingest(source);
    assert(!result.ok, `Expected ${expectedCode} for ${source}`);
    assertEquals(result.diagnostics[0].code, expectedCode);
  }
});

Deno.test("GPU and CPU frontend sessions return byte-identical compact IR", async () => {
  if (
    typeof navigator === "undefined" ||
    navigator.gpu === undefined ||
    await navigator.gpu.requestAdapter() === null
  ) {
    return;
  }
  const built = compile(GRAMMAR, {
    name: "gpu_frontend_test",
    rootRule: "module",
    metadata: METADATA,
    targets: ["wasm"],
  });
  assert(built.bundle);
  const planFile = built.bundle.files.find((file) =>
    file.path === "wasm/parser.plan"
  );
  assert(planFile);
  assert(planFile.encoding === "binary");
  const source = "let first = 1;\nlet second = 2;";
  const cpu = CpuFrontend.create(planFile.content).ingest(source);
  assert(cpu.ok);
  const runtime = await WebGpuRuntime.create({ allowFallbackAdapter: true });
  try {
    const frontend = await runtime.compileFrontend(planFile.content);
    const gpu = await frontend.ingest(source);
    assert(
      gpu.ok,
      gpu.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
    );
    assertEquals(gpu.program.tokens.join(","), cpu.program.tokens.join(","));
    assertEquals(gpu.program.nodes.join(","), cpu.program.nodes.join(","));
    assertEquals(gpu.program.edges.join(","), cpu.program.edges.join(","));
    assertEquals(gpu.program.symbols.join(","), cpu.program.symbols.join(","));
    assertEquals(gpu.program.types.join(","), cpu.program.types.join(","));

    const gpuDuckPlan = await Deno.readFile(
      new URL(
        "../examples/gpu-duck/generated/wasm/parser.plan",
        import.meta.url,
      ),
    );
    const gpuDuckSource = await Deno.readTextFile(
      new URL("../examples/gpu-duck/programs/example.duck", import.meta.url),
    );
    const cpuDuck = CpuFrontend.create(gpuDuckPlan).ingest(gpuDuckSource);
    assert(cpuDuck.ok);
    const gpuDuckFrontend = await runtime.compileFrontend(gpuDuckPlan);
    const gpuDuck = await gpuDuckFrontend.ingest(gpuDuckSource);
    assert(
      gpuDuck.ok,
      gpuDuck.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
    );
    assertEquals(
      gpuDuck.program.tokens.join(","),
      cpuDuck.program.tokens.join(","),
    );
    assertEquals(
      gpuDuck.program.nodes.join(","),
      cpuDuck.program.nodes.join(","),
    );
    assertEquals(
      gpuDuck.program.edges.join(","),
      cpuDuck.program.edges.join(","),
    );
    assertEquals(
      gpuDuck.program.symbols.join(","),
      cpuDuck.program.symbols.join(","),
    );
    assertEquals(
      gpuDuck.program.types.join(","),
      cpuDuck.program.types.join(","),
    );
  } finally {
    runtime.dispose();
  }
});

Deno.test("GPU frontend eligibility failures use stable diagnostics", () => {
  const cases = [
    {
      source: `
        module = "x" module? ;
      `,
      gpuFrontend: {
        version: 3,
        root: "module",
        islands: [{ rule: "module", boundary: { kind: "root" } }],
        semantics: { rules: {} },
      },
      code: "GPU_FRONTEND_RESIDUAL_RECURSION",
    },
    {
      source: `
        contextual WORD = "word" ;
        token IDENT = /[a-z]+/ ;
        module = IDENT ;
      `,
      gpuFrontend: {
        version: 3,
        root: "module",
        islands: [{ rule: "module", boundary: { kind: "root" } }],
        semantics: { rules: {} },
      },
      code: "GPU_FRONTEND_CONTEXTUAL_TERMINAL",
    },
    {
      source: `module = value:"x" ;`,
      gpuFrontend: {
        version: 3,
        root: "module",
        islands: [{ rule: "module", boundary: { kind: "root" } }],
        semantics: {
          rules: {
            module: {
              opcode: "invented-opcode",
              fields: { missing: "value" },
            },
          },
        },
      },
      code: "GPU_FRONTEND_INVALID_SEMANTIC_OPCODE",
    },
    {
      source: `module = "x" ;`,
      gpuFrontend: {
        version: 3,
        root: "module",
        islands: [{ rule: "module", boundary: { kind: "root" } }],
        semantics: { rules: {} },
        limits: { maxLexerStates: 1 },
      },
      code: "GPU_FRONTEND_LEXER_STATE_LIMIT",
    },
  ] as const;
  for (const testCase of cases) {
    const result = compile(testCase.source, {
      name: "ineligible",
      rootRule: "module",
      targets: ["wasm"],
      metadata: parseMetadata(JSON.stringify({
        version: 2,
        gpuFrontend: testCase.gpuFrontend,
      })),
    });
    assert(
      result.diagnostics.some((diagnostic) =>
        diagnostic.code === testCase.code
      ),
      `${testCase.code}: ${
        result.diagnostics.map((diagnostic) => diagnostic.code).join(",")
      }`,
    );
  }
});
