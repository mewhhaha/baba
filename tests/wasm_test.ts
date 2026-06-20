import {
  applyBundle,
  assert,
  assertEquals,
  assertIncludes,
  assertThrowsIncludes,
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

    const reparsed = mod.parseTokensUnchecked(
      "let x = 42;",
      mod.lex("let x = 42;").tokens,
    );
    assertEquals(reparsed.ok, true);
    const checkedReparse = mod.parseTokens(
      "let x = 42;",
      mod.lex("let x = 42;").tokens,
    );
    assertEquals(checkedReparse.ok, true);

    const parseError = mod.parse("let x 42;");
    assertEquals(parseError.ok, false);
    assertEquals(parseError.diagnostics[0].code, "PARSE_UNEXPECTED_TOKEN");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm parser reports trailing input through trace replay", async () => {
  const result = compile(`module = "a" ;`, { targets: ["wasm"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    const mod = await import(`file://${dir}/wasm/mod.ts`);

    const parsed = mod.parse("aa");
    assertEquals(parsed.ok, false);
    assertEquals(parsed.diagnostics[0].code, "PARSE_TRAILING_INPUT");
    assertEquals(parsed.diagnostics[0].found, JSON.stringify("a"));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm runtime validates parse trace input bounds", async () => {
  const result = compile(`module = "a" ;`, { targets: ["wasm"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    const runtime = await import(`file://${dir}/wasm/wasm.ts`);

    assertThrowsIncludes(
      () => runtime.createParseTraceInput(0),
      "terminalCapacity must be a positive integer",
    );
    const input = runtime.createParseTraceInput(1);
    assertThrowsIncludes(
      () => runtime.parseTrace(input, 2),
      "terminalCount exceeds parse input terminalCapacity",
    );
    assertThrowsIncludes(
      () => runtime.parseTrace(input, -1),
      "terminalCount must be a non-negative integer",
    );
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

Deno.test("Wasm parse fast path handles large parser buffers", async () => {
  const source = `
    token INT = /[0-9]+/ ;
    skip WS = /[ \\t\\r\\n]+/ ;

    module = expr ;
    expr = additive ;
    additive = first:multiplicative rest:(("+" | "-") multiplicative)* ;
    multiplicative = first:primary rest:(("*" | "/") primary)* ;
    primary = INT | "(" expr ")" ;
  `;
  const result = compile(source, { targets: ["wasm"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    const mod = await import(`file://${dir}/wasm/mod.ts`);
    const parsed = mod.parse(expressionSource(900));
    assertEquals(parsed.ok, true);
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

function expressionSource(count: number): string {
  const parts: string[] = [];
  for (let index = 1; index <= count; index++) {
    if (index > 1) parts.push(index % 2 === 0 ? " + " : " - ");
    parts.push(String(index), index % 3 === 0 ? " * 2" : "");
  }
  return parts.join("");
}
