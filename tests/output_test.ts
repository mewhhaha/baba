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
  generateTreeSitterGrammar,
  generateTreeSitterHighlightsQuery,
  generateTreeSitterQueries,
  main,
  parseEbnf,
  parseGrammar,
  parseMetadata,
  parseTreeSitterMetadata,
  runCommand,
  treeSitterAccepts,
  validateGrammar,
} from "./helpers.ts";

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
      '"fn" @keyword',
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
          }],
        }, { root: dir }),
      "Refusing unsafe generated path '../outside.txt'",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
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
          "--parser-state-limit",
          "100",
          "--parser-item-limit",
          "1000",
          "--parser-table-entry-limit",
          "1000",
          "--generated-byte-limit",
          "1000000",
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
      await Deno.readTextFile(`${tsOutDir}/ts/lexer.ts`),
      "const DEFAULT_PRESERVE_TRIVIA = false",
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
      "'init' was removed in baba 1.0",
    );
    await assertRejectsIncludes(
      () => main([grammarPath, "--backend", "typescript-ll1"]),
      "'--backend' was removed in baba 1.0",
    );

    const verboseLogs = await captureConsoleError(() =>
      main([
        "check",
        grammarPath,
        "--target",
        "typescript",
        "--verbose",
      ])
    );
    assertIncludes(verboseLogs.join("\n"), "TS_PARSER_STATS");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
