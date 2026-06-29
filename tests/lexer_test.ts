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

function assertRelatedMessages(
  diagnostic: { related?: readonly { message: string }[] },
  messages: readonly string[],
): void {
  assertEquals(
    diagnostic.related?.map((entry) => entry.message).join("\n"),
    messages.join("\n"),
  );
}

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
    "typescript/lexer.ts,typescript/mod.ts,typescript/parser.ts,typescript/plan.ts,typescript/syntax.ts,typescript/types.ts",
  );

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    assertEquals(mod.parserPlanVersion, 1);
    assertEquals(mod.parserDiagnosticCodeParseLexicalError, 1);
    assertEquals(mod.parserDiagnosticCodeParseUnexpectedToken, 2);
    assertEquals(mod.parserDiagnosticCodeParseTrailingInput, 3);
    assertEquals(mod.parserDiagnosticCodeParseInvalidTokenStream, 4);
    assertEquals(mod.parserDiagnosticCodeInternalError, 5);
    assertEquals(mod.parserDiagnosticCodeBranchLimit, 6);
    assertEquals(mod.parserDiagnosticCodeTraceLimit, 7);
    assertEquals(mod.parserDiagnosticCodeAmbiguousParse, 8);
    const lexed = mod.lex("let x = 42; // ok");
    const firstToken = lexed.tokens[0] as Record<string, unknown>;
    assertEquals("__babaTerminal" in firstToken, false);
    assertEquals(Object.keys(firstToken).includes("__babaTerminal"), false);
    assertEquals(JSON.stringify(firstToken).includes("__babaTerminal"), false);
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
  assert(result.bundle);
  assertEquals(result.diagnostics[0].code, "PORTABLE_LEXER_TOKEN_OVERLAP");
  assertEquals(result.diagnostics[0].severity, "warning");
  assertIncludes(result.diagnostics[0].message, '"x"');
  assertIncludes(result.diagnostics[0].message, "expects it separately");
  assertRelatedMessages(result.diagnostics[0], [
    "Left declaration: token A",
    "Right declaration: token B",
  ]);
});

Deno.test("TypeScript lexer rejects indistinguishable equal-priority token overlaps", () => {
  const source = `
    token A = /x/ ;
    token B = /x/ ;
    module = A | B ;
  `;
  const result = compile(source, { targets: ["typescript"] });
  assertEquals(result.bundle, undefined);
  assertEquals(result.diagnostics[0].code, "PORTABLE_LEXER_TOKEN_OVERLAP");
  assertEquals(result.diagnostics[0].severity, "error");
  assertIncludes(result.diagnostics[0].message, '"x"');
  assertIncludes(result.diagnostics[0].message, "cannot distinguish");
  assertIncludes(result.diagnostics[0].message, "Add an explicit priority");
});

Deno.test("TypeScript lexer permits indistinguishable priority token overlaps", () => {
  const source = `
    token A priority 10 = /x/ ;
    token B priority 0 = /x/ ;
    module = A | B ;
  `;
  const result = compile(source, { targets: ["typescript"] });
  assert(result.bundle);
  assertEquals(result.diagnostics[0].code, "PORTABLE_LEXER_TOKEN_OVERLAP");
  assertEquals(result.diagnostics[0].severity, "warning");
  assertIncludes(result.diagnostics[0].message, "explicit priority");
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
  assertEquals(result.diagnostics[0].code, "PORTABLE_LEXER_TOKEN_OVERLAP");
  assertIncludes(result.diagnostics[0].message, "skip IGNORED_X");
  assertIncludes(result.diagnostics[0].message, "token X");
  assertIncludes(result.diagnostics[0].message, '"x"');
  assertRelatedMessages(result.diagnostics[0], [
    "Left declaration: skip IGNORED_X",
    "Right declaration: token X",
  ]);
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
  assertEquals(result.diagnostics[0].code, "PORTABLE_LEXER_TOKEN_OVERLAP");
  assertEquals(result.diagnostics[0].severity, "warning");
  assertRelatedMessages(result.diagnostics[0], [
    "Left declaration: skip A",
    "Right declaration: skip B",
  ]);
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
  const grammar = generatedTextContent(treeSitter.bundle, "grammar.js");
  assertIncludes(
    grammar,
    "TYPE_IDENT: $ => token(prec(10, /[A-Z][0-9A-Z_a-z]*/))",
  );

  const portable = compile(source, { targets: ["typescript"] });
  assert(portable.bundle);
  assertEquals(portable.diagnostics[0].code, "PORTABLE_LEXER_TOKEN_OVERLAP");
  assertEquals(portable.diagnostics[0].severity, "warning");
  assertIncludes(portable.diagnostics[0].message, "standalone lex()");
  assertRelatedMessages(portable.diagnostics[0], [
    "Left declaration: token IDENT",
    "Right declaration: token TYPE_IDENT",
  ]);
});

Deno.test("Lexical priority can keep a token above overlapping trivia", async () => {
  const source = `
    skip IGNORED_X = /x/ ;
    token X priority 10 = /x/ ;
    module = X ;
  `;
  const result = compile(source, { targets: ["typescript"] });
  assert(result.bundle);
  assertEquals(result.diagnostics[0].code, "PORTABLE_LEXER_TOKEN_OVERLAP");
  assertEquals(result.diagnostics[0].severity, "warning");
  assertIncludes(
    result.diagnostics[0].message,
    "parser token remains reachable",
  );
  assertRelatedMessages(result.diagnostics[0], [
    "Left declaration: skip IGNORED_X",
    "Right declaration: token X",
  ]);

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

Deno.test("TypeScript lexer reports unused skip declarations", async () => {
  const source = `
    skip IGNORED_X priority 0 = /x/ ;
    token X priority 10 = /x/ ;
    module = X ;
  `;
  const result = compile(source, { targets: ["typescript"] });
  assert(result.bundle);
  const diagnostic = result.diagnostics.find((item) =>
    item.code === "PORTABLE_UNUSED_SKIP_DECLARATION"
  );
  assert(diagnostic);
  assertEquals(diagnostic.severity, "warning");
  assertIncludes(diagnostic.message, "skip IGNORED_X");
  assertIncludes(diagnostic.message, "portable trivia");
  assertRelatedMessages(diagnostic, [
    "Covering candidate: token X",
  ]);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    const lexed = mod.lex("x");
    assertEquals(lexed.tokens[0].kind, "X");
    assertEquals(lexed.tokens[0].channel, "main");
    assertEquals(mod.parse("x").ok, true);
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
  assertEquals(result.diagnostics[0].code, "PORTABLE_LEXER_TOKEN_OVERLAP");
  assertIncludes(result.diagnostics[0].message, "cannot reach the parser");
  assertRelatedMessages(result.diagnostics[0], [
    "Left declaration: skip IGNORED_X",
    "Right declaration: token X",
  ]);
});

Deno.test("TypeScript lexer reports completely shadowed token languages", () => {
  const result = compile(
    `
    token WIN priority 10 = /x/ ;
    token LOSE priority 0 = /x/ ;
    module = WIN | LOSE ;
  `,
    { targets: ["typescript"] },
  );
  assert(result.bundle);
  const diagnostic = result.diagnostics.find((item) =>
    item.code === "PORTABLE_SHADOWED_TOKEN_LANGUAGE"
  );
  assert(diagnostic);
  assertEquals(diagnostic.severity, "warning");
  assertIncludes(diagnostic.message, "token LOSE");
  assertIncludes(diagnostic.message, "standalone lex()");
  assertIncludes(diagnostic.message, "No parser context can recover");
  assertRelatedMessages(diagnostic, [
    "Covering candidate: token WIN",
  ]);
});

Deno.test("contextual parsing can recover a globally shadowed token", async () => {
  const result = compile(
    `
    token A priority 10 = /x/ ;
    token B priority 0 = /x/ ;
    module = first | second ;
    first = "a" item:A ;
    second = "b" item:B ;
  `,
    { targets: ["typescript"] },
  );
  assert(result.bundle);
  const diagnostic = result.diagnostics.find((item) =>
    item.code === "PORTABLE_SHADOWED_TOKEN_LANGUAGE"
  );
  assert(diagnostic);
  assertEquals(diagnostic.severity, "warning");
  assertIncludes(diagnostic.message, "Contextual parse()");

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    const lexed = mod.lex("bx");
    assertEquals(lexed.tokens[1].kind, "A");
    const parsed = mod.parse("bx");
    assertEquals(parsed.ok, true);
    assertEquals(parsed.root.children[0].name, "second");
    assertEquals(parsed.root.children[0].fields.item.kind, "B");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
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
  assertEquals(result.diagnostics[0].code, "PORTABLE_LEXER_TOKEN_OVERLAP");
  assertIncludes(result.diagnostics[0].message, 'literal "if"');
  assertRelatedMessages(result.diagnostics[0], [
    "Token declaration: token WORD",
    'Literal occurrence: "if"',
  ]);
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
  assertEquals(result.diagnostics[0].code, "PORTABLE_LEXER_TOKEN_OVERLAP");
  assertIncludes(result.diagnostics[0].message, "skip WORDS");
  assertIncludes(result.diagnostics[0].message, 'literal "if"');
  assertRelatedMessages(result.diagnostics[0], [
    "Token declaration: skip WORDS",
    'Literal occurrence: "if"',
  ]);
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
  assert(classLiteral.bundle);
  assertEquals(
    classLiteral.diagnostics[0].code,
    "PORTABLE_LEXER_TOKEN_OVERLAP",
  );
  assertEquals(classLiteral.diagnostics[0].severity, "warning");
  assertIncludes(classLiteral.diagnostics[0].message, '"x"');

  const keyword = compile(
    `
    token WORD = /[a-z]+/ ;
    token IF = /if/ ;
    module = "a" WORD | "b" IF ;
  `,
    { targets: ["typescript"] },
  );
  assert(keyword.bundle);
  assertEquals(keyword.diagnostics[0].code, "PORTABLE_LEXER_TOKEN_OVERLAP");
  assertEquals(keyword.diagnostics[0].severity, "warning");
  assertIncludes(keyword.diagnostics[0].message, '"if"');

  const duplicateClass = compile(
    `
    token A = /[a-z]+/ ;
    token B = /[a-z]+/ ;
    module = "a" A | "b" B ;
  `,
    { targets: ["typescript"] },
  );
  assert(duplicateClass.bundle);
  assertEquals(
    duplicateClass.diagnostics[0].code,
    "PORTABLE_LEXER_TOKEN_OVERLAP",
  );
  assertEquals(duplicateClass.diagnostics[0].severity, "warning");
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
  assert(equivalentRepeats.bundle);
  assertEquals(
    equivalentRepeats.diagnostics[0].code,
    "PORTABLE_LEXER_TOKEN_OVERLAP",
  );
  assertEquals(equivalentRepeats.diagnostics[0].severity, "warning");
  assertIncludes(equivalentRepeats.diagnostics[0].message, '"a"');
});

Deno.test("TypeScript lexer uses generated DFA tables for many short tokens", async () => {
  const result = compile(
    `
    token A = /a/ ;
    module = A* ;
  `,
    {
      targets: ["typescript"],
      typescript: { runtimePackaging: "legacy-generated" },
    },
  );
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const lexerSource = await Deno.readTextFile(`${dir}/typescript/lexer.ts`);
    assertIncludes(lexerSource, "function dfaTransition");
    assertIncludes(lexerSource, "function lexerScanAdvance");
    assertIncludes(lexerSource, "__baba_table_dfaTransitionRows");
    assertIncludes(lexerSource, "__baba_table_dfaAsciiTransitions");
    assertIncludes(lexerSource, "__baba_table_dfaAccepts");
    assertNotIncludes(lexerSource, "const DFA_ACCEPTS");
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
  const sourceLengthOption = compile(`module = "ok" ;`, {
    targets: ["typescript"],
    typescript: { regexSourceLengthLimit: 0 },
  });
  assertEquals(sourceLengthOption.bundle, undefined);
  assertEquals(
    sourceLengthOption.diagnostics[0].code,
    "PORTABLE_REGEX_SOURCE_LIMIT",
  );

  const sourceLength = compile(
    `
    token LONG = /abcd/ ;
    module = LONG ;
  `,
    {
      targets: ["typescript"],
      typescript: { regexSourceLengthLimit: 3 },
    },
  );
  assertEquals(sourceLength.bundle, undefined);
  assertEquals(
    sourceLength.diagnostics[0].code,
    "PORTABLE_REGEX_SOURCE_LIMIT",
  );
  assertIncludes(sourceLength.diagnostics[0].message, "regex source has");

  const nestingOption = compile(`module = "ok" ;`, {
    targets: ["typescript"],
    typescript: { regexNestingLimit: 0 },
  });
  assertEquals(nestingOption.bundle, undefined);
  assertEquals(
    nestingOption.diagnostics[0].code,
    "PORTABLE_REGEX_NESTING_LIMIT",
  );

  const nesting = compile(
    `
    token NESTED = /((a))/ ;
    module = NESTED ;
  `,
    {
      targets: ["typescript"],
      typescript: { regexNestingLimit: 1 },
    },
  );
  assertEquals(nesting.bundle, undefined);
  assertEquals(nesting.diagnostics[0].code, "PORTABLE_REGEX_NESTING_LIMIT");
  assertIncludes(nesting.diagnostics[0].message, "regex nesting depth");

  const defaultNestedPattern = `${"(".repeat(300)}a${")".repeat(300)}`;
  const defaultNesting = compile(
    `
    token NESTED = /${defaultNestedPattern}/ ;
    module = NESTED ;
  `,
    { targets: ["typescript"] },
  );
  assertEquals(defaultNesting.bundle, undefined);
  assertEquals(
    defaultNesting.diagnostics[0].code,
    "PORTABLE_REGEX_NESTING_LIMIT",
  );
  assertIncludes(
    defaultNesting.diagnostics[0].message,
    "configured limit (256)",
  );

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
  assertEquals(ast.diagnostics[0].code, "PORTABLE_REGEX_AST_NODE_LIMIT");
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
    "PORTABLE_REGEX_REPEAT_EXPANSION_LIMIT",
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
  assertEquals(nfa.diagnostics[0].code, "PORTABLE_REGEX_NFA_STATE_LIMIT");

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
  assertEquals(
    overlap.diagnostics[0].code,
    "PORTABLE_REGEX_OVERLAP_WORK_LIMIT",
  );

  const overlapPairOption = compile(`module = "ok" ;`, {
    targets: ["typescript"],
    typescript: { regexOverlapPairLimit: 0 },
  });
  assertEquals(overlapPairOption.bundle, undefined);
  assertEquals(
    overlapPairOption.diagnostics[0].code,
    "PORTABLE_REGEX_OVERLAP_WORK_LIMIT",
  );

  const overlapPair = compile(
    `
    token A = /a/ ;
    token B = /b/ ;
    token C = /c/ ;
    module = A | B | C ;
  `,
    {
      targets: ["typescript"],
      typescript: { regexOverlapPairLimit: 1 },
    },
  );
  assertEquals(overlapPair.bundle, undefined);
  assertEquals(
    overlapPair.diagnostics[0].code,
    "PORTABLE_REGEX_OVERLAP_WORK_LIMIT",
  );
  assertIncludes(overlapPair.diagnostics[0].message, "regexOverlapPairLimit");
});

Deno.test("TypeScript target caps runtime planning diagnostics", () => {
  const invalidLimit = compile(`module = "ok" ;`, {
    targets: ["typescript"],
    typescript: { diagnosticLimit: 0 },
  });
  assertEquals(invalidLimit.bundle, undefined);
  assertEquals(
    invalidLimit.diagnostics[0].code,
    "PORTABLE_DIAGNOSTIC_LIMIT_REACHED",
  );

  const capped = compile(
    `
    token A = /x/ ;
    token B = /x/ ;
    token C = /x/ ;
    token D = /x/ ;
    module = A | B | C | D ;
  `,
    {
      targets: ["typescript"],
      typescript: { diagnosticLimit: 2 },
    },
  );
  assertEquals(capped.bundle, undefined);
  assertEquals(capped.diagnostics.length, 3);
  assertEquals(capped.diagnostics[0].code, "PORTABLE_LEXER_TOKEN_OVERLAP");
  assertEquals(capped.diagnostics[1].code, "PORTABLE_LEXER_TOKEN_OVERLAP");
  assertEquals(
    capped.diagnostics[2].code,
    "PORTABLE_DIAGNOSTIC_LIMIT_REACHED",
  );
  assertIncludes(capped.diagnostics[2].message, "suppressed");
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
