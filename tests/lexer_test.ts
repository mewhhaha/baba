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

Deno.test("generates standalone TypeScript lexer and parser", async () => {
  const source = `
    token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
    token INTEGER = /[0-9]+/ ;
    skip WS = /[ \\t\\r\\n]+/ ;
    skip LINE_COMMENT = /\\/\\/[^\\n]*/ ;

    module = statement* ;
    statement = "let" name:IDENT "=" value:INTEGER ";" ;
  `;
  const result = compile(source, { targets: ["typescript"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);
  assertEquals(
    result.bundle.files.map((file) => file.path).join(","),
    "typescript/lexer.ts,typescript/mod.ts,typescript/parser.ts,typescript/syntax.ts",
  );

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    assertEquals(mod.parserPlanVersion, 1);
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

    const parsed = mod.parse("let x = 42;");
    assertEquals(parsed.ok, true);
    const statement = parsed.root.children[0];
    assertEquals(statement.fields.name.text, "x");
    assertEquals(statement.fields.value.text, "42");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TypeScript lexer uses maximal munch for literals and identifiers", async () => {
  const source = `
    token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
    skip WS = /[ \\t\\r\\n]+/ ;
    module = "if" IDENT ;
  `;
  const result = compile(source, { targets: ["typescript"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    const tokenKinds = (source: string) =>
      mod.lex(source).tokens
        .filter((token: { channel: string }) => token.channel !== "trivia")
        .map((token: { type: string; literal?: string; kind?: string }) =>
          token.type === "literal" ? token.literal : token.kind ?? token.type
        )
        .join(",");
    assertEquals(tokenKinds("if value"), "if,IDENT,eof");
    assertEquals(tokenKinds("iffy"), "IDENT,eof");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TypeScript lexer matches the longest prefix within one regex", async () => {
  const source = `
    token TEST = /a|ab/ ;
    module = value:TEST ;
  `;
  const result = compile(source, { targets: ["typescript"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    const parsed = mod.parse("ab");
    assertEquals(parsed.ok, true);
    assertEquals(parsed.root.fields.value.text, "ab");
    assertEquals(
      mod.lex("ab").tokens.map((token: { text: string }) => token.text).join(
        ",",
      ),
      "ab,",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TypeScript lexer reports overlapping named tokens", () => {
  const source = `
    token A = /x/ ;
    token B = /x/ ;
    module = "a" A | "b" B ;
  `;
  const result = compile(source, { targets: ["typescript"] });
  assertEquals(result.bundle, undefined);
  assertEquals(result.diagnostics[0].code, "TS_LEXER_TOKEN_OVERLAP");
  assertIncludes(result.diagnostics[0].message, '"x"');
});

Deno.test("TypeScript lexer reports skip and token overlaps", () => {
  const result = compile(
    `
    skip IGNORED_X = /x/ ;
    token X = /x/ ;
    module = X ;
  `,
    { targets: ["typescript"] },
  );
  assertEquals(result.bundle, undefined);
  assertEquals(result.diagnostics[0].code, "TS_LEXER_TOKEN_OVERLAP");
  assertIncludes(result.diagnostics[0].message, "skip IGNORED_X");
  assertIncludes(result.diagnostics[0].message, "token X");
  assertIncludes(result.diagnostics[0].message, '"x"');
});

Deno.test("TypeScript lexer warns for overlapping skip declarations", () => {
  const result = compile(
    `
    skip A = /[ ]+/ ;
    skip B = / +/ ;
    module = "x" ;
  `,
    { targets: ["typescript"] },
  );
  assert(result.bundle);
  assertEquals(result.diagnostics[0].code, "TS_LEXER_TOKEN_OVERLAP");
  assertEquals(result.diagnostics[0].severity, "warning");
});

Deno.test("Lexical priority resolves Tree-sitter token overlaps but not portable ones", () => {
  const source = `
    token IDENT priority 0 = /[A-Za-z_][A-Za-z0-9_]*/ ;
    token TYPE_IDENT priority 10 = /[A-Z][A-Za-z0-9_]*/ ;
    module = typed:TYPE_IDENT | plain:IDENT ;
  `;
  const treeSitter = compile(source, { targets: ["tree-sitter"] });
  assertEquals(treeSitter.diagnostics.length, 0);
  assert(treeSitter.bundle);
  const grammar =
    treeSitter.bundle.files.find((file) => file.path === "grammar.js")
      ?.content ?? "";
  assertIncludes(
    grammar,
    "TYPE_IDENT: $ => token(prec(10, /[A-Z][0-9A-Z_a-z]*/))",
  );

  const portable = compile(source, { targets: ["typescript"] });
  assertEquals(portable.bundle, undefined);
  assertEquals(portable.diagnostics[0].code, "TS_LEXER_TOKEN_OVERLAP");
  assertIncludes(portable.diagnostics[0].message, "portable global lexer");
});

Deno.test("Lexical priority can keep a token above overlapping trivia", async () => {
  const source = `
    skip IGNORED_X = /x/ ;
    token X priority 10 = /x/ ;
    module = X ;
  `;
  const result = compile(source, { targets: ["typescript"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    const parsed = mod.parse("x");
    assertEquals(parsed.ok, true);
    assertEquals(parsed.root.children[0].kind, "X");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Lexical priority cannot let trivia shadow a reachable token", () => {
  const result = compile(
    `
    skip IGNORED_X priority 10 = /x/ ;
    token X priority 0 = /x/ ;
    module = X ;
  `,
    { targets: ["typescript"] },
  );
  assertEquals(result.bundle, undefined);
  assertEquals(result.diagnostics[0].code, "TS_LEXER_TOKEN_OVERLAP");
  assertIncludes(result.diagnostics[0].message, "cannot reach the parser");
});

Deno.test("Lexical priority cannot hide a reachable literal", () => {
  const result = compile(
    `
    token WORD priority 10 = /[a-z]+/ ;
    module = "if" | WORD ;
  `,
    { targets: ["typescript"] },
  );
  assertEquals(result.bundle, undefined);
  assertEquals(result.diagnostics[0].code, "TS_LEXER_TOKEN_OVERLAP");
  assertIncludes(result.diagnostics[0].message, 'literal "if"');
});

Deno.test("Trivia cannot overlap a reachable literal", () => {
  const result = compile(
    `
    skip WORDS = /[a-z]+/ ;
    module = "if" ;
  `,
    { targets: ["typescript"] },
  );
  assertEquals(result.bundle, undefined);
  assertEquals(result.diagnostics[0].code, "TS_LEXER_TOKEN_OVERLAP");
  assertIncludes(result.diagnostics[0].message, "skip WORDS");
  assertIncludes(result.diagnostics[0].message, 'literal "if"');
});

Deno.test("TypeScript lexer reports real overlap witnesses", () => {
  const classLiteral = compile(
    `
    token A = /x/ ;
    token B = /[x]/ ;
    module = "a" A | "b" B ;
  `,
    { targets: ["typescript"] },
  );
  assertEquals(classLiteral.bundle, undefined);
  assertEquals(classLiteral.diagnostics[0].code, "TS_LEXER_TOKEN_OVERLAP");
  assertIncludes(classLiteral.diagnostics[0].message, '"x"');

  const keyword = compile(
    `
    token WORD = /[a-z]+/ ;
    token IF = /if/ ;
    module = "a" WORD | "b" IF ;
  `,
    { targets: ["typescript"] },
  );
  assertEquals(keyword.bundle, undefined);
  assertEquals(keyword.diagnostics[0].code, "TS_LEXER_TOKEN_OVERLAP");
  assertIncludes(keyword.diagnostics[0].message, '"if"');

  const duplicateClass = compile(
    `
    token A = /[a-z]+/ ;
    token B = /[a-z]+/ ;
    module = "a" A | "b" B ;
  `,
    { targets: ["typescript"] },
  );
  assertEquals(duplicateClass.bundle, undefined);
  assertEquals(duplicateClass.diagnostics[0].code, "TS_LEXER_TOKEN_OVERLAP");
  assertIncludes(duplicateClass.diagnostics[0].message, '"a"');
  assertNotIncludes(duplicateClass.diagnostics[0].message, '"[a-z]+"');

  const equivalentRepeats = compile(
    `
    token A = /a+/ ;
    token B = /aa*/ ;
    module = "a" A | "b" B ;
  `,
    { targets: ["typescript"] },
  );
  assertEquals(equivalentRepeats.bundle, undefined);
  assertEquals(
    equivalentRepeats.diagnostics[0].code,
    "TS_LEXER_TOKEN_OVERLAP",
  );
  assertIncludes(equivalentRepeats.diagnostics[0].message, '"a"');
});

Deno.test("TypeScript lexer uses generated DFA tables for many short tokens", async () => {
  const result = compile(
    `
    token A = /a/ ;
    module = A* ;
  `,
    { targets: ["typescript"] },
  );
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const lexerSource = await Deno.readTextFile(`${dir}/typescript/lexer.ts`);
    assertIncludes(lexerSource, "function dfaTransition");
    assertIncludes(lexerSource, "__baba_table_dfaTransitionRows");
    assertIncludes(lexerSource, "__baba_table_dfaAsciiTransitions");
    assertNotIncludes(lexerSource, "function transition");
    assertNotIncludes(lexerSource, "new RegExp");
    assertNotIncludes(lexerSource, "longestRegexPrefix");
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    const input = "a".repeat(10_000);
    const start = performance.now();
    const lexed = mod.lex(input, { preserveTrivia: false });
    const elapsed = performance.now() - start;
    assertEquals(lexed.diagnostics.length, 0);
    assertEquals(lexed.tokens.length, 10_001);
    assert(
      elapsed < 1_000,
      `Expected lexing to finish quickly, took ${elapsed}ms`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TypeScript lexer performance gates cover large inputs", async () => {
  const result = compile(
    `
    token A_RUN = /a+/ ;
    module = A_RUN ;
  `,
    { targets: ["typescript"] },
  );
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    for (
      const [size, limitMs] of [
        [10_000, 1_000],
        [100_000, 1_500],
        [1_000_000, 5_000],
      ] as const
    ) {
      const input = "a".repeat(size);
      const start = performance.now();
      const lexed = mod.lex(input, { preserveTrivia: false });
      const elapsed = performance.now() - start;
      assertEquals(lexed.diagnostics.length, 0);
      assertEquals(lexed.tokens.length, 2);
      assert(
        elapsed < limitMs,
        `Expected ${size} bytes to lex in under ${limitMs}ms, took ${elapsed}ms`,
      );
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TypeScript target rejects nonportable regex shorthand classes", () => {
  const result = compile(
    `
    token WS = /\\s+/ ;
    module = WS ;
  `,
    { targets: ["typescript"], rootRule: "module" },
  );
  assertEquals(result.bundle, undefined);
  assertEquals(result.diagnostics[0].code, "INVALID_TOKEN_REGEX");
});

Deno.test("TypeScript target reports regex resource limits", () => {
  const ast = compile(
    `
    token MANY = /(a|b|c|d)/ ;
    module = MANY ;
  `,
    {
      targets: ["typescript"],
      typescript: { regexAstNodeLimit: 3 },
    },
  );
  assertEquals(ast.bundle, undefined);
  assertEquals(ast.diagnostics[0].code, "TS_REGEX_AST_NODE_LIMIT");
  assertIncludes(ast.diagnostics[0].message, "regex AST has");

  const repeat = compile(
    `
    token MANY = /a{11}/ ;
    module = MANY ;
  `,
    {
      targets: ["typescript"],
      typescript: { regexBoundedRepeatLimit: 10 },
    },
  );
  assertEquals(repeat.bundle, undefined);
  assertEquals(
    repeat.diagnostics[0].code,
    "TS_REGEX_REPEAT_EXPANSION_LIMIT",
  );

  const nfa = compile(
    `
    token WORD = /abcdef/ ;
    module = WORD ;
  `,
    {
      targets: ["typescript"],
      typescript: { regexNfaStateLimit: 3 },
    },
  );
  assertEquals(nfa.bundle, undefined);
  assertEquals(nfa.diagnostics[0].code, "TS_REGEX_NFA_STATE_LIMIT");

  const overlap = compile(
    `
    token AB = /ab/ ;
    token AC = /ac/ ;
    module = AB | AC ;
  `,
    {
      targets: ["typescript"],
      typescript: { regexOverlapStateLimit: 1 },
    },
  );
  assertEquals(overlap.bundle, undefined);
  assertEquals(overlap.diagnostics[0].code, "TS_REGEX_OVERLAP_WORK_LIMIT");
});

Deno.test("TypeScript lexer treats non-BMP characters as single dot tokens", async () => {
  const result = compile(
    `
    token ANY = /./ ;
    module = ANY ;
  `,
    { targets: ["typescript"] },
  );
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    const lexed = mod.lex("🙂");
    assertEquals(lexed.diagnostics.length, 0);
    assertEquals(lexed.tokens[0].text, "🙂");
    assertEquals(lexed.tokens[0].span.end, 2);
    assertEquals(lexed.tokens.length, 2);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TypeScript lexer can consume trivia without preserving tokens", async () => {
  const source = `
    token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
    skip WS = /[ \\t\\r\\n]+/ ;
    module = left:IDENT right:IDENT ;
  `;
  const result = compile(source, {
    targets: ["typescript"],
    typescript: { preserveTrivia: false },
  });
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    const lexed = mod.lex("a b");
    assertEquals(
      lexed.tokens.map((token: { kind?: string; type: string }) =>
        token.kind ?? token.type
      ).join(","),
      "IDENT,IDENT,eof",
    );
    const parsed = mod.parse("a b");
    assertEquals(parsed.ok, true);
    assertEquals(parsed.root.fields.right.text, "b");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
