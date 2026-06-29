import {
  applyBundle,
  assert,
  assertEquals,
  assertIncludes,
  assertMissing,
  assertNotIncludes,
  assertRejectsIncludes,
  assertThrowsIncludes,
  BabaError,
  captureConsoleError,
  captureConsoleLog,
  collectReachabilityDiagnostics,
  compile,
  denoCheck,
  explicitGrammar,
  fixtureSamples,
  formatDiagnostic,
  generate,
  generatedTextContent,
  generateTreeSitterGrammar,
  generateTreeSitterHighlightsQuery,
  generateTreeSitterQueries,
  main,
  parseEbnf,
  parseGrammar,
  parseMetadata,
  runCommand,
  treeSitterAccepts,
  validateGrammar,
} from "./helpers.ts";
import { inspectCompactPlanBinary } from "../src/runtime/compact_plan_binary.ts";

Deno.test("safe bundle apply writes nested files and refuses user edits", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const bundle = generate(explicitGrammar, { name: "tiny" });
    await applyBundle(bundle, { root: dir });

    assertIncludes(
      await Deno.readTextFile(`${dir}/grammar.js`),
      "export default grammar",
    );
    assertIncludes(
      await Deno.readTextFile(`${dir}/queries/generated-highlights.scm`),
      '(module "fn" @keyword)',
    );
    await Deno.writeTextFile(
      `${dir}/grammar.js`,
      `${await Deno.readTextFile(`${dir}/grammar.js`)}\n// user edit\n`,
    );
    await assertRejectsIncludes(
      () => applyBundle(bundle, { root: dir }),
      "Refusing to overwrite modified or unowned file 'grammar.js'",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("safe bundle apply rejects paths outside the root", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await assertRejectsIncludes(
      () =>
        applyBundle({
          files: [{
            path: "../outside.txt",
            content: "escape",
            kind: "source",
            encoding: "utf-8",
          }],
        }, { root: dir }),
      "Refusing unsafe generated path '../outside.txt'",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("safe bundle apply writes and protects binary files", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const first = {
      files: [
        {
          path: "wasm/parser.wasm",
          content: new Uint8Array([0, 97, 255, 10]),
          kind: "binary" as const,
          encoding: "binary" as const,
        },
        {
          path: "wasm/manifest.json",
          content: "{}\n",
          kind: "config" as const,
          encoding: "utf-8" as const,
        },
      ],
    };
    await applyBundle(first, { root: dir });
    assertEquals(
      [...await Deno.readFile(`${dir}/wasm/parser.wasm`)].join(","),
      "0,97,255,10",
    );

    const second = {
      files: [{
        path: "wasm/manifest.json",
        content: "{}\n",
        kind: "config" as const,
        encoding: "utf-8" as const,
      }],
    };
    await applyBundle(second, { root: dir });
    await assertMissing(`${dir}/wasm/parser.wasm`);

    await applyBundle(first, { root: dir });
    await Deno.writeFile(
      `${dir}/wasm/parser.wasm`,
      new Uint8Array([1, 2, 3, 4]),
    );
    await assertRejectsIncludes(
      () => applyBundle(first, { root: dir }),
      "Refusing to overwrite modified or unowned file 'wasm/parser.wasm'",
    );

    await assertRejectsIncludes(
      () =>
        applyBundle({
          files: [
            {
              path: "wasm",
              content: "not a dir\n",
              kind: "source" as const,
              encoding: "utf-8" as const,
            },
            {
              path: "wasm/parser.wasm",
              content: new Uint8Array([0]),
              kind: "binary" as const,
              encoding: "binary" as const,
            },
          ],
        }, { root: dir }),
      "Generated output path 'wasm' collides with nested path 'wasm/parser.wasm'",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("size report measures repository and publish payload", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const jsonPath = `${dir}/size-report.json`;
    const human = await runCommand(Deno.execPath(), [
      "run",
      "--allow-read",
      "--allow-write",
      "scripts/size_report.ts",
      "--json",
      jsonPath,
    ]);
    assertIncludes(human.stdout, "Baba size report");
    assertIncludes(human.stdout, "Publish include payload");
    assertIncludes(human.stdout, "Local generated example bytes");

    const report = JSON.parse(await Deno.readTextFile(jsonPath));
    assert(report.repository.bytes > 0);
    assert(report.repository.fileCount > 0);
    assert(report.publishPayload.bytes > 0);
    assert(report.publishPayload.fileCount > 0);
    assertEquals(report.publishPayload.generatedExampleBytes, 0);
    assert(
      !report.publishPayload.largestFiles.some((
        entry: { path: string },
      ) => entry.path.includes("/generated/")),
      "Expected generated example outputs to stay out of publish payload.",
    );
    assertEquals(report.examples.generatedBytes, 0);
    assertEquals(report.examples.generatedBytesByExample.length, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("size budget check reports pass and fail states", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const passingJsonPath = `${dir}/passing-size-report.json`;
    await runCommand(Deno.execPath(), [
      "run",
      "--allow-read",
      "--allow-write",
      "scripts/size_report.ts",
      "--budget",
      "size-budgets.json",
      "--json",
      passingJsonPath,
    ]);
    const passing = JSON.parse(await Deno.readTextFile(passingJsonPath));
    assertEquals(passing.budget.ok, true);
    assert(
      passing.budget.checks.some((
        check: { name: string; ok: boolean },
      ) => check.name === "publishGeneratedExampleBytes" && check.ok),
      "Expected generated publish payload budget check.",
    );

    const failingBudgetPath = `${dir}/failing-size-budget.json`;
    await Deno.writeTextFile(
      failingBudgetPath,
      JSON.stringify({ publishPayloadBytes: 1 }, null, 2),
    );
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "scripts/size_report.ts",
        "--budget",
        failingBudgetPath,
      ],
    });
    const output = await command.output();
    assertEquals(output.success, false);
    assertIncludes(
      new TextDecoder().decode(output.stdout),
      "Size budgets: failed",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("examples expose one-command reproducibility tasks", async () => {
  for (
    const example of ["brainfuck", "feature-tour", "funcfuck", "thunkwasm"]
  ) {
    const config = JSON.parse(
      await Deno.readTextFile(`examples/${example}/deno.json`),
    );
    for (const task of ["generate", "check", "run", "test"]) {
      assert(
        typeof config.tasks?.[task] === "string" &&
          config.tasks[task].length > 0,
        `Expected examples/${example}/deno.json to define task '${task}'.`,
      );
    }
  }
});

Deno.test("benchmark command writes machine-readable metrics", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const jsonPath = `${dir}/bench-results.json`;
    const result = await runCommand(Deno.execPath(), [
      "run",
      "--allow-read",
      "--allow-write",
      "bench/ts_vs_wasm.ts",
      "--quick",
      "--samples",
      "1",
      "--json",
      jsonPath,
    ]);
    assertIncludes(result.stdout, "preserveTrivia=true");
    assertIncludes(result.stdout, "sink=");

    const report = JSON.parse(await Deno.readTextFile(jsonPath));
    assertEquals(report.format, "baba-benchmark-results");
    assertEquals(report.version, 1);
    assertEquals(report.quick, true);
    assertEquals(report.samples, 1);
    assertEquals(report.cases.length, 6);
    assert(
      report.cases.every((
        entry: {
          compiler: { totalGenerationMs: number; diagnostics: number };
          artifacts: {
            totalBytes: number;
            textBytes: number;
            binaryBytes: number;
            typescriptRuntimeBytes: number;
            wasmAdapterBytes: number;
            wasmBinaryBytes: number;
            treeSitterArtifactBytes: number;
            largestFile: { path: string; bytes: number } | null;
          };
          setup: {
            applyBundleMs: number;
            tsImportMs: number;
            wasmImportMs: number;
          };
          metrics: Array<{ operation: string; tsMs: number; wasmMs: number }>;
        },
      ) =>
        entry.compiler.totalGenerationMs >= 0 &&
        entry.compiler.diagnostics >= 0 &&
        entry.artifacts.totalBytes > 0 &&
        entry.artifacts.textBytes > 0 &&
        entry.artifacts.binaryBytes >= 0 &&
        entry.artifacts.typescriptRuntimeBytes > 0 &&
        entry.artifacts.wasmAdapterBytes > 0 &&
        entry.artifacts.wasmBinaryBytes >= 0 &&
        entry.artifacts.treeSitterArtifactBytes >= 0 &&
        entry.artifacts.largestFile !== null &&
        entry.artifacts.largestFile.bytes > 0 &&
        entry.setup.applyBundleMs >= 0 &&
        entry.setup.tsImportMs >= 0 &&
        entry.setup.wasmImportMs >= 0 &&
        entry.metrics.some((metric) =>
          metric.operation === "parse" && metric.tsMs >= 0 &&
          metric.wasmMs >= 0
        )
      ),
      "Expected each benchmark case to include parse metrics.",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("runtime benchmark reports lexer row-kind counters", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const jsonPath = `${dir}/runtime-bench-results.json`;
    const result = await runCommand(Deno.execPath(), [
      "task",
      "bench:runtime",
      "--fixture",
      "large-runtime",
      "--json",
      jsonPath,
    ]);
    assertIncludes(result.stdout, "lexer rows:");

    const report = JSON.parse(await Deno.readTextFile(jsonPath));
    const rowKinds = report.fixtures[0].planStats.lexerRowKinds;
    assert(typeof rowKinds.ascii === "number");
    assert(typeof rowKinds.single === "number");
    assert(typeof rowKinds.small === "number");
    assert(typeof rowKinds.binary === "number");
    assert(typeof rowKinds.empty === "number");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("default TypeScript output is shared-runtime data and wrappers", () => {
  const result = compile(
    `
      token ID = /[A-Za-z_][A-Za-z0-9_]*/ ;
      skip WS = /[ \\t\\r\\n]+/ ;
      module = "let" name:ID ;
    `,
    { targets: ["typescript"] },
  );
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);
  const paths = result.bundle.files.map((file) => file.path).join(",");
  assertIncludes(paths, "typescript/plan.ts");
  assertIncludes(paths, "typescript/types.ts");
  const mod = generatedTextContent(result.bundle, "typescript/mod.ts");
  const lexer = generatedTextContent(result.bundle, "typescript/lexer.ts");
  const parser = generatedTextContent(result.bundle, "typescript/parser.ts");
  assertIncludes(mod, 'from "@mewhhaha/baba/runtime"');
  for (const source of [mod, lexer, parser]) {
    assertNotIncludes(source, "function parseTokenList(");
    assertNotIncludes(source, "function reduceProduction(");
    assertNotIncludes(source, "function parserTrace(");
    assertNotIncludes(source, "new Uint8Array([");
    assertNotIncludes(source, "wasmBytes =");
  }
});

Deno.test("shared TypeScript output can externalize parser plan JSON", async () => {
  const result = compile(
    `
      token ID = /[A-Za-z_][A-Za-z0-9_]*/ ;
      skip WS = /[ \\t\\r\\n]+/ ;
      module = "let" name:ID ;
    `,
    { targets: ["typescript"], typescript: { planData: "json" } },
  );
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);
  const paths = result.bundle.files.map((file) => file.path).join(",");
  assertIncludes(paths, "typescript/plan.ts");
  assertIncludes(paths, "typescript/plan.json");
  const planTs = generatedTextContent(result.bundle, "typescript/plan.ts");
  const planJson = generatedTextContent(result.bundle, "typescript/plan.json");
  assertIncludes(
    planTs,
    'import compactParserPlan from "./plan.json" with { type: "json" };',
  );
  assertNotIncludes(planTs, '"module"');
  assertEquals(JSON.parse(planJson).g[1], "module");

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("parser-kit target emits inspectable compact binary plan", async () => {
  const result = compile(
    `
      token ID = /[A-Za-z_][A-Za-z0-9_]*/ ;
      skip WS = /[ \\t\\r\\n]+/ ;
      module = "let" name:ID ;
    `,
    { targets: ["kit"], kit: { profile: "runtime" } },
  );
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);
  const planBinary = result.bundle.files.find((file) =>
    file.path === "kit/parser-plan.bin"
  );
  const planJson = generatedTextContent(result.bundle, "kit/parser-kit.json");
  assert(planBinary?.encoding === "binary");
  const planInfo = inspectCompactPlanBinary(planBinary.content);
  assertEquals(planInfo.format, "baba-compact-plan");
  assert(planInfo.bytes < new TextEncoder().encode(planJson).length);
  const dir = await Deno.makeTempDir();
  try {
    const path = `${dir}/parser-plan.bin`;
    await Deno.writeFile(path, planBinary.content);
    const inspected = await runCommand(Deno.execPath(), [
      "run",
      "--allow-read",
      "scripts/inspect_plan.ts",
      path,
    ]);
    assertIncludes(inspected.stdout, '"format": "baba-compact-plan"');
    assertIncludes(inspected.stdout, '"parserPlanVersion": 1');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("CI exposes named release gates for runtime quality", async () => {
  const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
  for (
    const task of [
      "test:parity",
      "test:brl-conformance",
      "test:portable",
      "test:runtime-smoke",
      "test:tree-sitter",
      "test:fuzz",
    ]
  ) {
    assert(
      typeof denoConfig.tasks?.[task] === "string",
      `Expected deno task '${task}' to be defined.`,
    );
  }

  const ci = await Deno.readTextFile(".github/workflows/ci.yml");
  for (
    const gate of [
      "Exact TypeScript/Wasm parity gate",
      "BRL backend conformance gate",
      "Portable fixture and plan gates",
      "Tree-sitter acceptance gate",
      "Deno Node Bun TypeScript and Wasm runtime smoke",
      "Short deterministic fuzz seeds",
      "Bootstrap drift check",
      "Size budget check",
      "Benchmark JSON smoke",
      "Publish dry run",
    ]
  ) {
    assertIncludes(ci, gate);
  }
  for (
    const command of [
      "deno task test:parity",
      "deno task test:brl-conformance",
      "deno task test:portable",
      "deno task test:runtime-smoke",
      "deno task test:tree-sitter",
      "deno task test:fuzz",
      "deno task bootstrap:check",
      "deno task size:check",
      "deno task bench -- --quick --samples 1 --json bench-results.json",
      "deno task publish:dry-run",
    ]
  ) {
    assertIncludes(ci, command);
  }
});

Deno.test("architecture decision records cover required contracts", async () => {
  const requiredAdrs = [
    "docs/adr/0001-scope.md",
    "docs/adr/0002-analyzed-grammar-and-portable-plan.md",
    "docs/adr/0003-runtime-language.md",
    "docs/adr/0004-wasm-artifact-and-abi.md",
    "docs/adr/0005-contextual-lexing.md",
    "docs/adr/0006-conflict-policy.md",
    "docs/adr/0007-generated-file-ownership.md",
  ];
  for (const path of requiredAdrs) {
    const source = await Deno.readTextFile(path);
    for (
      const section of [
        "Status:",
        "## Context",
        "## Decision",
        "## Consequences",
        "## Rejected Alternatives",
        "## Compatibility Impact",
      ]
    ) {
      assertIncludes(source, section);
    }
  }
  const conflictPolicy = await Deno.readTextFile(
    "docs/adr/0006-conflict-policy.md",
  );
  assertIncludes(conflictPolicy, "metadata.parser.conflicts");
  assertIncludes(conflictPolicy, '{ "conflict": "c_91a8..." }');
});

Deno.test("stability policy documents required compatibility levels", async () => {
  const source = await Deno.readTextFile("docs/stability.md");
  for (
    const required of [
      "## Public Library API",
      "## EBNF Syntax",
      "## Metadata Schema",
      "## Parser-Plan Format",
      "## Generated TypeScript API",
      "## Wasm ABI",
      "## Internal BRL",
      "## Tree-Sitter Compatibility",
      "private and unstable",
    ]
  ) {
    assertIncludes(source, required);
  }
});

Deno.test("README links split user documentation", async () => {
  const requiredDocs = [
    "docs/grammar.md",
    "docs/metadata.md",
    "docs/portable-runtime.md",
    "docs/typescript.md",
    "docs/wasm.md",
    "docs/diagnostics.md",
    "docs/limits.md",
    "docs/examples.md",
    "docs/stability.md",
    "docs/contributing.md",
  ];
  const readme = await Deno.readTextFile("README.md");
  for (const path of requiredDocs) {
    const source = await Deno.readTextFile(path);
    assertIncludes(source, "Status:");
    assertIncludes(readme, `](${path})`);
  }
  const metadata = await Deno.readTextFile("docs/metadata.md");
  assertIncludes(metadata, "## Portable Runtime Metadata");
  assertIncludes(metadata, "### Parser Conflict Policy");
  assertIncludes(metadata, '"conflicts": [');
  assertIncludes(metadata, '{ "conflict": "c_ef90..." }');
});

Deno.test("generated runtime source carries versioned provenance banners", () => {
  const result = compile(`module = "ok" ;`, {
    targets: ["typescript", "wasm"],
  });
  assert(result.bundle);
  const sourceFiles = result.bundle.files.filter((file) =>
    file.encoding === "utf-8" &&
    file.kind === "source" &&
    (file.path.startsWith("typescript/") || file.path.startsWith("wasm/"))
  );
  assert(
    sourceFiles.length >= 8,
    "Expected generated TypeScript and Wasm source files.",
  );
  for (const file of sourceFiles) {
    const content = file.content;
    assert(typeof content === "string");
    assertIncludes(content, "Generated by @mewhhaha/baba.");
    assertIncludes(content, "Parser plan version: 1.");
    assertIncludes(content, "Parser plan semantics: baba-portable-v1.");
    assertIncludes(content, "Runtime semantics version: 1.");
    assertIncludes(content, "Do not edit; regenerate from grammar.ebnf.");
  }
});

Deno.test("CLI lists, diagnoses, and writes Tree-sitter outputs", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const grammarPath = `${dir}/grammar.ebnf`;
    await Deno.writeTextFile(
      grammarPath,
      `
        token ident = /[a-z]+/ ;
        skip whitespace = /[ \\t\\n]+/ ;
        module = "fn" ident ;
        dead = "unused" ;
      `,
    );
    let logs: string[] = [];
    await captureConsoleError(async () => {
      logs = await captureConsoleLog(() => main([grammarPath, "--list-files"]));
    });
    assertIncludes(logs.join("\n"), "grammar.js");
    assertIncludes(logs.join("\n"), "queries/generated-highlights.scm");

    let errors: string[] = [];
    await captureConsoleLog(async () => {
      errors = await captureConsoleError(() =>
        main([grammarPath, "--list-files"])
      );
    });
    assertIncludes(errors.join("\n"), "UNREACHABLE_RULE");

    const outDir = `${dir}/out`;
    await captureConsoleError(() =>
      main([grammarPath, "--out", outDir, "--name", "tiny"])
    );
    assertIncludes(await Deno.readTextFile(`${outDir}/grammar.js`), "tiny");
    assertIncludes(
      await Deno.readTextFile(`${outDir}/grammar.js`),
      "source_file: $ => $.module",
    );
    await assertMissing(`${outDir}/tree-sitter.json`);

    let targetLogs: string[] = [];
    await captureConsoleError(async () => {
      targetLogs = await captureConsoleLog(() =>
        main([
          "check",
          grammarPath,
          "--target",
          "typescript",
          "--list-files",
        ])
      );
    });
    assertIncludes(targetLogs.join("\n"), "typescript/mod.ts");

    let explainLogs: string[] = [];
    await captureConsoleError(async () => {
      explainLogs = await captureConsoleLog(() =>
        main([
          "check",
          grammarPath,
          "--explain-targets",
        ])
      );
    });
    assertIncludes(explainLogs.join("\n"), "Target support:");
    assertIncludes(explainLogs.join("\n"), "Tree-sitter: supported");
    assertIncludes(explainLogs.join("\n"), "TypeScript: supported");
    assertIncludes(explainLogs.join("\n"), "Wasm: supported");
    assertIncludes(explainLogs.join("\n"), "Kit: supported");
    assertIncludes(
      explainLogs.join("\n"),
      "TypeScript, Wasm, and kit share portable parser plan v1",
    );
    assertIncludes(
      explainLogs.join("\n"),
      "identical Baba regex/DFA semantics",
    );
    assertIncludes(
      explainLogs.join("\n"),
      "External tokens are not supported by portable runtime targets",
    );
    assertIncludes(
      explainLogs.join("\n"),
      "Contextual token overlap status is reported",
    );
    assertIncludes(
      explainLogs.join("\n"),
      "unsupported backend constructs are reported per target",
    );

    const externalMetadataPath = `${dir}/externals.json`;
    await Deno.writeTextFile(
      externalMetadataPath,
      JSON.stringify({ version: 2, externals: ["INDENT"] }),
    );
    const externalGrammarPath = `${dir}/external.ebnf`;
    await Deno.writeTextFile(
      externalGrammarPath,
      `
        token ident = /[a-z]+/ ;
        module = INDENT ident ;
      `,
    );
    let externalExplainLogs: string[] = [];
    await captureConsoleError(async () => {
      externalExplainLogs = await captureConsoleLog(() =>
        main([
          "check",
          externalGrammarPath,
          "--metadata",
          externalMetadataPath,
          "--explain-targets",
        ])
      );
    });
    assertIncludes(externalExplainLogs.join("\n"), "Tree-sitter: supported");
    assertIncludes(
      externalExplainLogs.join("\n"),
      "TypeScript: unsupported",
    );
    assertIncludes(externalExplainLogs.join("\n"), "Wasm: unsupported");
    assertIncludes(externalExplainLogs.join("\n"), "Kit: unsupported");
    assertIncludes(
      externalExplainLogs.join("\n"),
      "PORTABLE_EXTERNAL_TOKENS_UNSUPPORTED",
    );

    const tsOutDir = `${dir}/ts-out`;
    let tsErrors: string[] = [];
    await captureConsoleLog(async () => {
      tsErrors = await captureConsoleError(() =>
        main([
          "generate",
          grammarPath,
          "--target",
          "typescript",
          "--out",
          tsOutDir,
          "--ts-out",
          "ts",
          "--discard-trivia",
          "--regex-ast-node-limit",
          "1000",
          "--regex-bounded-repeat-limit",
          "100",
          "--regex-nfa-state-limit",
          "1000",
          "--regex-dfa-state-limit",
          "1000",
          "--regex-overlap-state-limit",
          "1000",
          "--grammar-expression-depth-limit",
          "1000",
          "--parser-state-limit",
          "100",
          "--parser-item-limit",
          "1000",
          "--lr-closure-work-limit",
          "1000",
          "--parser-table-entry-limit",
          "1000",
          "--typescript-generated-byte-limit",
          "1000000",
          "--typescript-plan-data",
          "json",
          "--parser-stats",
        ])
      );
    });
    assertIncludes(tsErrors.join("\n"), "TS_PARSER_STATS");
    assertIncludes(
      await Deno.readTextFile(`${tsOutDir}/ts/mod.ts`),
      "parseTokens",
    );
    assertIncludes(
      await Deno.readTextFile(`${tsOutDir}/ts/plan.ts`),
      'import compactParserPlan from "./plan.json" with { type: "json" };',
    );
    assertIncludes(
      await Deno.readTextFile(`${tsOutDir}/ts/plan.json`),
      '"l":[false',
    );

    const allOutDir = `${dir}/all`;
    await captureConsoleError(() =>
      main([
        "generate",
        grammarPath,
        "--target",
        "all",
        "--out",
        allOutDir,
      ])
    );
    assertIncludes(
      await Deno.readTextFile(`${allOutDir}/grammar.js`),
      "grammar",
    );
    assertIncludes(
      await Deno.readTextFile(`${allOutDir}/typescript/mod.ts`),
      "parseTokens",
    );
    await assertMissing(`${allOutDir}/wasm/mod.ts`);
    await assertMissing(`${allOutDir}/kit/parser-kit.json`);

    const kitOutDir = `${dir}/kit-out`;
    await captureConsoleError(() =>
      main([
        "generate",
        grammarPath,
        "--target",
        "kit",
        "--out",
        kitOutDir,
        "--kit-dir",
        "parser-data",
        "--kit-profile",
        "runtime",
        "--discard-trivia",
      ])
    );
    const kitText = await Deno.readTextFile(
      `${kitOutDir}/parser-data/parser-kit.json`,
    );
    assertNotIncludes(kitText, "\n  ");
    const kit = JSON.parse(
      kitText,
    ) as {
      profile?: string;
      schemaVersion?: number;
      lexer?: { defaultPreserveTrivia?: boolean };
      lr?: { states?: Array<{ items?: unknown[] }> };
    };
    assertEquals(kit.schemaVersion, 1);
    assertEquals(kit.profile, "runtime");
    assertEquals(kit.lexer?.defaultPreserveTrivia, false);
    assertEquals(kit.lr?.states?.[0]?.items?.length, 0);

    const rootedGrammarPath = `${dir}/rooted.ebnf`;
    await Deno.writeTextFile(
      rootedGrammarPath,
      `
        dead = missing ;
        module = "ok" ;
      `,
    );
    const rootedOutDir = `${dir}/rooted`;
    await captureConsoleError(() =>
      main([rootedGrammarPath, "--root", "module", "--out", rootedOutDir])
    );
    assertIncludes(
      await Deno.readTextFile(`${rootedOutDir}/grammar.js`),
      "source_file: $ => $.module",
    );

    const invalidGrammarPath = `${dir}/invalid.ebnf`;
    await Deno.writeTextFile(
      invalidGrammarPath,
      `
        token dup = /a*/ ;
        token dup = /b/ ;
        module = missing other ;
      `,
    );
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        `${Deno.cwd()}/src/cli.ts`,
        invalidGrammarPath,
        "--diagnostic-format",
        "json",
      ],
    });
    const output = await command.output();
    assertEquals(output.success, false);
    const diagnostics = JSON.parse(
      new TextDecoder().decode(output.stderr),
    ) as Array<{ code: string }>;
    assertEquals(
      diagnostics.map((diagnostic) => diagnostic.code).join(","),
      "INVALID_TOKEN_REGEX,DUPLICATE_DECLARATION,UNKNOWN_RULE_REFERENCE,UNKNOWN_RULE_REFERENCE",
    );

    await assertRejectsIncludes(
      () => main(["init", outDir]),
      "Unexpected extra input",
    );
    await assertRejectsIncludes(
      () => main([grammarPath, "--backend", "typescript-ll1"]),
      "Unknown option '--backend'",
    );

    await assertRejectsIncludes(
      () => main(["check", grammarPath, "--target", "typescript", "--verbose"]),
      "Unknown option '--verbose'",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
