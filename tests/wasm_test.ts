import {
  applyBundle,
  assert,
  assertEquals,
  assertIncludes,
  captureConsoleError,
  captureConsoleLog,
  compile,
  denoCheck,
  main,
} from "./helpers.ts";

Deno.test("generates standalone Wasm lexer and parser", async () => {
  const source = `
    token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
    token INTEGER = /[0-9]+/ ;
    skip WS = /[ \\t\\r\\n]+/ ;
    skip LINE_COMMENT = /\\/\\/[^\\n]*/ ;

    module = statement* ;
    statement = "let" name:IDENT "=" value:INTEGER ";" ;
  `;
  const result = compile(source, { targets: ["wasm"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);
  assertEquals(
    result.bundle.files.map((file) => file.path).join(","),
    "wasm/lexer.ts,wasm/mod.ts,wasm/parser.ts,wasm/syntax.ts,wasm/wasm.ts",
  );

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/wasm/mod.ts`);
    assertIncludes(await Deno.readTextFile(`${dir}/wasm/wasm.ts`), "lex_all");
    const mod = await import(`file://${dir}/wasm/mod.ts`);
    new WebAssembly.Module(mod.wasmBytes);

    const lexed = mod.lex("let x = 42; // ok");
    assertEquals(
      lexed.tokens
        .filter((token: { channel: string }) => token.channel !== "trivia")
        .map((token: { type: string; literal?: string; kind?: string }) =>
          token.type === "literal" ? token.literal : token.kind ?? token.type
        )
        .join(","),
      "let,IDENT,=,INTEGER,;,eof",
    );
    assert(
      lexed.tokens.some((token: { kind?: string; channel: string }) =>
        token.kind === "LINE_COMMENT" && token.channel === "trivia"
      ),
    );
    const invalid = mod.lex("let @ = 1;");
    assertEquals(invalid.diagnostics.length, 1);
    assertEquals(
      invalid.tokens.find((token: { type: string }) => token.type === "error")
        ?.text,
      "@",
    );

    const parsed = mod.parse("let x = 42;");
    assertEquals(parsed.ok, true);
    const statement = parsed.root.children[0];
    assertEquals(statement.fields.name.text, "x");
    assertEquals(statement.fields.value.text, "42");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm lexer preserves UTF-16 offsets for non-BMP literals", async () => {
  const result = compile(`module = face:"😀" ;`, { targets: ["wasm"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    const mod = await import(`file://${dir}/wasm/mod.ts`);
    const parsed = mod.parse("😀");
    assertEquals(parsed.ok, true);
    assertEquals(parsed.root.span.end, 2);
    assertEquals(parsed.root.fields.face.span.end, 2);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("CLI generates Wasm target with custom directory", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const grammarPath = `${dir}/grammar.ebnf`;
    await Deno.writeTextFile(
      grammarPath,
      `
        token ident = /[a-z]+/ ;
        skip whitespace = /[ \\t\\n]+/ ;
        module = "fn" ident ;
      `,
    );

    let logs: string[] = [];
    await captureConsoleError(async () => {
      logs = await captureConsoleLog(() =>
        main([
          "check",
          grammarPath,
          "--target",
          "wasm",
          "--wasm-dir",
          "runtime",
          "--list-files",
        ])
      );
    });
    assertIncludes(logs.join("\n"), "runtime/mod.ts");
    assertIncludes(logs.join("\n"), "runtime/wasm.ts");

    const outDir = `${dir}/out`;
    await captureConsoleError(() =>
      main([
        "generate",
        grammarPath,
        "--target",
        "wasm",
        "--wasm-dir",
        "runtime",
        "--discard-trivia",
        "--out",
        outDir,
      ])
    );
    assertIncludes(
      await Deno.readTextFile(`${outDir}/runtime/lexer.ts`),
      "const DEFAULT_PRESERVE_TRIVIA = false",
    );
    await denoCheck(`${outDir}/runtime/mod.ts`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
