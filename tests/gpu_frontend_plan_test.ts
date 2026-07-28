import {
  assert,
  assertEquals,
  assertThrowsIncludes,
  compile,
  parseMetadata,
} from "./helpers.ts";
import {
  decodeCombinedWasmParserPlan,
  encodeCombinedWasmParserPlan,
  validateCombinedWasmParserPlan,
} from "../src/runtime/wasm_plan.ts";
import {
  CpuFrontend,
  decodeGpuFrontendPlan,
  inspectGpuFrontendPlan,
  type WebGpuFrontendOptions,
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
    throughput: "strict",
    limits: {
      maxContractionRounds: 1,
    },
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
  assertEquals(plan.throughput, "strict");
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
  assertEquals(plan.execution.rootLoop?.island, 1);
  assertEquals(plan.execution.longRegions.length, 1);
  assertEquals(plan.statistics.contractionRounds, 1);

  const validated = validateCombinedWasmParserPlan(planFile.content);
  const decoded = decodeCombinedWasmParserPlan(planFile.content);
  const compact = decoded.compactRuntimePlan as {
    g: { capacity: { nodesPerToken: number } };
  };
  compact.g.capacity.nodesPerToken = 0;
  const corruptedCapacity = encodeCombinedWasmParserPlan(
    planFile.content.subarray(0, validated.coreByteLength),
    compact,
  );
  assertThrowsIncludes(
    () => decodeGpuFrontendPlan(corruptedCapacity),
    "GPU frontend capacity nodesPerToken must be a positive safe integer",
  );

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
  assertEquals(inspection.throughput, "general");
  assertEquals(inspection.rootLoopIsland, null);
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
  const cpuFrontend = CpuFrontend.create(planFile.content);
  const cpu = cpuFrontend.ingest(source);
  assert(cpu.ok);
  const runtime = await WebGpuRuntime.create({ allowFallbackAdapter: true });
  try {
    const frontend = await runtime.compileFrontend(planFile.content);
    let invalidTimingMessage = "";
    try {
      await frontend.ingest(source, {
        stageTimings: "invalid",
      } as unknown as WebGpuFrontendOptions);
    } catch (error) {
      if (error instanceof Error) {
        invalidTimingMessage = error.message;
      }
    }
    assert(
      invalidTimingMessage.includes(
        "stageTimings must be 'collect' when provided",
      ),
      invalidTimingMessage,
    );
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
    assertEquals(gpu.timings.stagesMs, null);
    const profiledGpu = await frontend.ingest(source, {
      stageTimings: "collect",
    });
    assert(profiledGpu.ok);
    assertEquals(
      profiledGpu.program.tokens.join(","),
      cpu.program.tokens.join(","),
    );
    if (runtime.capabilities.hasTimestampQueries) {
      assert(profiledGpu.timings.stagesMs);
    }
    const residentUnits = new Uint16Array(source.length);
    for (let index = 0; index < source.length; index += 1) {
      residentUnits[index] = source.charCodeAt(index);
    }
    const resident = await frontend.ingestResident(residentUnits);
    let residentReuseMessage = "";
    try {
      await frontend.ingest(source);
    } catch (error) {
      if (error instanceof Error) {
        residentReuseMessage = error.message;
      } else {
        residentReuseMessage = String(error);
      }
    }
    assert(
      residentReuseMessage.includes(
        "resident result must be disposed",
      ),
      residentReuseMessage,
    );
    const residentHeader = runtime.device.createBuffer({
      size: resident.layout.headerWords * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    try {
      const encoder = runtime.device.createCommandEncoder();
      encoder.copyBufferToBuffer(
        resident.buffer,
        0,
        residentHeader,
        0,
        resident.layout.headerWords * Uint32Array.BYTES_PER_ELEMENT,
      );
      runtime.device.queue.submit([encoder.finish()]);
      await residentHeader.mapAsync(GPUMapMode.READ);
      const header = new Uint32Array(residentHeader.getMappedRange());
      assertEquals(header[resident.layout.statusWord], 0);
      assertEquals(
        header[resident.layout.tokenCountWord],
        cpu.program.tokens.length / 4,
      );
      assertEquals(
        header[resident.layout.nodeCountWord],
        cpu.program.nodes.length / 8,
      );
      assertEquals(
        header[resident.layout.edgeCountWord],
        cpu.program.edges.length / 4,
      );
      residentHeader.unmap();
    } finally {
      resident.dispose();
      residentHeader.destroy();
    }
    const queuedResident = await frontend.ingestResident(residentUnits);
    queuedResident.dispose();
    const afterResidentReuse = await frontend.ingest(source);
    assert(afterResidentReuse.ok);
    assertEquals(
      afterResidentReuse.program.tokens.join(","),
      cpu.program.tokens.join(","),
    );

    const longGrammar = String.raw`
      skip WS = /[ \t\r\n]+/ ;
      module = chunks:chunk* ;
      chunk = values:"x"* ";" ;
    `;
    const longMetadata = parseMetadata(JSON.stringify({
      version: 2,
      gpuFrontend: {
        version: 3,
        throughput: "strict",
        root: "module",
        islands: [
          { rule: "module", boundary: { kind: "root" } },
          {
            rule: "chunk",
            boundary: { kind: "terminated", terminal: ";" },
          },
        ],
        semantics: { rules: {} },
      },
    }));
    const longBuilt = compile(longGrammar, {
      name: "gpu_long_region_test",
      rootRule: "module",
      metadata: longMetadata,
      targets: ["wasm"],
    });
    assert(
      longBuilt.bundle,
      longBuilt.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
    );
    const longPlanFile = longBuilt.bundle.files.find((file) =>
      file.path === "wasm/parser.plan"
    );
    assert(longPlanFile);
    assert(longPlanFile.encoding === "binary");
    const longInspection = inspectGpuFrontendPlan(longPlanFile.content);
    assert(longInspection);
    assertEquals(longInspection.parallelLongRegionIslands, 1);
    const longSource = `${"x ".repeat(4096)};`;
    const cpuLong = CpuFrontend.create(longPlanFile.content).ingest(longSource);
    assert(cpuLong.ok);
    const longFrontend = await runtime.compileFrontend(longPlanFile.content);
    const gpuLong = await longFrontend.ingest(longSource);
    assert(
      gpuLong.ok,
      gpuLong.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
    );
    assertEquals(
      gpuLong.program.tokens.join(","),
      cpuLong.program.tokens.join(","),
    );
    assertEquals(
      gpuLong.program.nodes.join(","),
      cpuLong.program.nodes.join(","),
    );
    assertEquals(
      gpuLong.program.edges.join(","),
      cpuLong.program.edges.join(","),
    );

    const tokenCount = cpu.program.tokens.length / 4;
    const nodeCount = cpu.program.nodes.length / 8;
    const edgeCount = cpu.program.edges.length / 4;
    for (
      const [cpuOptions, gpuOptions] of [
        [
          { maxTokens: tokenCount - 1 },
          { lexerCapacityRecords: tokenCount - 1 },
        ],
        [{ maxNodes: nodeCount - 1 }, { maxNodes: nodeCount - 1 }],
        [{ maxEdges: edgeCount - 1 }, { maxEdges: edgeCount - 1 }],
      ] as const
    ) {
      const cpuCapacity = cpuFrontend.ingest(source, cpuOptions);
      const gpuCapacity = await frontend.ingest(source, gpuOptions);
      assert(!cpuCapacity.ok);
      assert(!gpuCapacity.ok);
      assertEquals(
        gpuCapacity.diagnostics[0].record.join(","),
        cpuCapacity.diagnostics[0].record.join(","),
      );
    }

    const gpuDuckPlan = await Deno.readFile(
      new URL(
        "../examples/gpu-duck/generated/wasm/parser.plan",
        import.meta.url,
      ),
    );
    const gpuDuckSource = await Deno.readTextFile(
      new URL("../examples/gpu-duck/programs/example.duck", import.meta.url),
    );
    const gpuDuckInspection = inspectGpuFrontendPlan(gpuDuckPlan);
    assert(gpuDuckInspection);
    assertEquals(gpuDuckInspection.throughput, "strict");
    assertEquals(gpuDuckInspection.rootLoopIsland, 2);
    assertEquals(gpuDuckInspection.contractionRounds, 33);
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
    for (const declarationCount of [0, 1, 1024]) {
      const declarations: string[] = [];
      for (let index = 0; index < declarationCount; index += 1) {
        declarations.push(`let value_${index} = ${index % 1000};\n`);
      }
      const broadSource = "module Bench where\n\ndeclare operators {\n};\n\n" +
        declarations.join("") +
        "\nreturn {};\n";
      const cpuBroad = CpuFrontend.create(gpuDuckPlan).ingest(broadSource);
      const gpuBroad = await gpuDuckFrontend.ingest(broadSource);
      assert(cpuBroad.ok);
      assert(gpuBroad.ok);
      assertEquals(
        gpuBroad.program.tokens.join(","),
        cpuBroad.program.tokens.join(","),
      );
      assertEquals(
        gpuBroad.program.nodes.join(","),
        cpuBroad.program.nodes.join(","),
      );
      assertEquals(
        gpuBroad.program.edges.join(","),
        cpuBroad.program.edges.join(","),
      );
    }
    for (
      const malformed of [
        gpuDuckSource.replace("return {", "return ["),
        gpuDuckSource.trimEnd().slice(0, -1),
        gpuDuckSource + "\n~",
      ]
    ) {
      const cpuFailure = CpuFrontend.create(gpuDuckPlan).ingest(malformed);
      const gpuFailure = await gpuDuckFrontend.ingest(malformed);
      assert(!cpuFailure.ok);
      assert(!gpuFailure.ok);
      assertEquals(
        gpuFailure.diagnostics[0].record.join(","),
        cpuFailure.diagnostics[0].record.join(","),
      );
    }
    const unicodeSource = gpuDuckSource.replace('"hello"', '"😀"');
    const cpuUnicode = CpuFrontend.create(gpuDuckPlan).ingest(unicodeSource);
    const gpuUnicode = await gpuDuckFrontend.ingest(unicodeSource);
    assert(cpuUnicode.ok);
    assert(gpuUnicode.ok);
    assertEquals(
      gpuUnicode.program.tokens.join(","),
      cpuUnicode.program.tokens.join(","),
    );
    assertEquals(
      gpuUnicode.program.nodes.join(","),
      cpuUnicode.program.nodes.join(","),
    );
    assertEquals(
      gpuUnicode.program.edges.join(","),
      cpuUnicode.program.edges.join(","),
    );

    const funcfuckPlan = await Deno.readFile(
      new URL(
        "../examples/funcfuck/generated/wasm/parser.plan",
        import.meta.url,
      ),
    );
    const cpuFuncfuckFrontend = CpuFrontend.create(funcfuckPlan);
    const gpuFuncfuckFrontend = await runtime.compileFrontend(funcfuckPlan);
    for (
      const source of [
        await Deno.readTextFile(
          new URL(
            "../examples/funcfuck/programs/pipeline.ff",
            import.meta.url,
          ),
        ),
        await Deno.readTextFile(
          new URL(
            "../examples/funcfuck/programs/fanout.ff",
            import.meta.url,
          ),
        ),
        await Deno.readTextFile(
          new URL(
            "../examples/funcfuck/programs/window.ff",
            import.meta.url,
          ),
        ),
        `emit [1] => ${"(".repeat(16)}id${")".repeat(16)};`,
      ]
    ) {
      const cpuFuncfuck = cpuFuncfuckFrontend.ingest(source);
      const gpuFuncfuck = await gpuFuncfuckFrontend.ingest(source);
      assert(cpuFuncfuck.ok);
      assert(gpuFuncfuck.ok);
      assertEquals(
        gpuFuncfuck.program.tokens.join(","),
        cpuFuncfuck.program.tokens.join(","),
      );
      assertEquals(
        gpuFuncfuck.program.nodes.join(","),
        cpuFuncfuck.program.nodes.join(","),
      );
      assertEquals(
        gpuFuncfuck.program.edges.join(","),
        cpuFuncfuck.program.edges.join(","),
      );
      assertEquals(
        gpuFuncfuck.program.symbols.join(","),
        cpuFuncfuck.program.symbols.join(","),
      );
      assertEquals(
        gpuFuncfuck.program.types.join(","),
        cpuFuncfuck.program.types.join(","),
      );
    }
    for (
      const malformed of [
        "emit [1) => id;",
        "emit [1 => id;",
        "emit 1] => id;",
      ]
    ) {
      const cpuFailure = cpuFuncfuckFrontend.ingest(malformed);
      const gpuFailure = await gpuFuncfuckFrontend.ingest(malformed);
      assert(!cpuFailure.ok);
      assert(!gpuFailure.ok);
      assertEquals(
        gpuFailure.diagnostics[0].record.join(","),
        cpuFailure.diagnostics[0].record.join(","),
      );
    }
    for (
      const source of [
        "def a = id; def a = id; emit [1] => a;",
        "emit [1] => missing;",
        "def a = b; def b = a; emit [1] => a;",
        "emit [2147483648] => id;",
        "emit [1] => repeat(-1, id);",
      ]
    ) {
      const cpuFailure = cpuFuncfuckFrontend.ingest(source);
      const gpuFailure = await gpuFuncfuckFrontend.ingest(source);
      assert(!cpuFailure.ok);
      assert(!gpuFailure.ok);
      assertEquals(
        gpuFailure.diagnostics.map((diagnostic) => diagnostic.record.join(","))
          .join("|"),
        cpuFailure.diagnostics.map((diagnostic) => diagnostic.record.join(","))
          .join("|"),
      );
    }
    longFrontend.dispose();
    gpuDuckFrontend.dispose();
    gpuFuncfuckFrontend.dispose();
    frontend.dispose();
    let disposedMessage = "";
    try {
      await frontend.ingest(source);
    } catch (error) {
      if (error instanceof Error) {
        disposedMessage = error.message;
      }
    }
    assert(disposedMessage.includes("has been disposed"), disposedMessage);
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
    {
      source: `module = "x" ;`,
      gpuFrontend: {
        version: 3,
        root: "module",
        islands: [{ rule: "module", boundary: { kind: "root" } }],
        semantics: { rules: {} },
        limits: { maxContractionRounds: 34 },
      },
      code: "GPU_FRONTEND_CONTRACTION_ROUND_LIMIT",
    },
    {
      source: `module = "x" ;`,
      gpuFrontend: {
        version: 3,
        throughput: "strict",
        root: "module",
        islands: [{ rule: "module", boundary: { kind: "root" } }],
        semantics: { rules: {} },
      },
      code: "GPU_FRONTEND_STRICT_ROOT_LOOP",
    },
    {
      source: `
        module = first second ;
        first = "(" ")" ;
        second = ")" "]" ;
      `,
      gpuFrontend: {
        version: 3,
        root: "module",
        islands: [
          { rule: "module", boundary: { kind: "root" } },
          {
            rule: "first",
            boundary: { kind: "paired", open: "(", close: ")" },
          },
          {
            rule: "second",
            boundary: { kind: "paired", open: ")", close: "]" },
          },
        ],
        semantics: { rules: {} },
      },
      code: "GPU_FRONTEND_AMBIGUOUS_STRUCTURAL_TERMINAL",
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
