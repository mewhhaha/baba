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
  generatedContentForComparison,
  generatedTextContent,
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

Deno.test("skip declarations cannot be referenced by parser rules", () => {
  const grammar = parseGrammar(`
    skip WS = / +/ ;
    module = WS "x" ;
  `);
  const diagnostics = validateGrammar(grammar, { targets: ["typescript"] });
  assertEquals(diagnostics[0].code, "SKIP_TOKEN_REFERENCE");
  assertIncludes(diagnostics[0].message, "cannot appear in parser rules");
  assertEquals(compile(grammar, { targets: ["typescript"] }).bundle, undefined);
});

Deno.test("grammar analysis reports nonproductive rules", () => {
  const nonproductiveRoot = validateGrammar(
    parseGrammar(`module = module ;`),
    { targets: ["typescript"] },
  );
  assertEquals(nonproductiveRoot[0].code, "NONPRODUCTIVE_ROOT");
  assertIncludes(nonproductiveRoot[0].message, "cannot derive any sentence");

  const nonproductiveRule = validateGrammar(
    parseGrammar(`
      module = bad? "ok" ;
      bad = bad ;
    `),
    { targets: ["typescript"] },
  );
  assert(
    nonproductiveRule.some((diagnostic) =>
      diagnostic.code === "NONPRODUCTIVE_RULE"
    ),
  );
});

Deno.test("grammar analysis reports nullable recursive cycles", () => {
  const diagnostics = validateGrammar(
    parseGrammar(`
      module = a "done" ;
      a = b? ;
      b = a? ;
    `),
    { targets: ["typescript"] },
  );
  assert(
    diagnostics.some((diagnostic) =>
      diagnostic.code === "NULLABLE_RECURSIVE_CYCLE"
    ),
  );
});

Deno.test("grammar analysis reports rules that only derive empty text", () => {
  const emptyRoot = validateGrammar(
    parseGrammar(`module = "" ;`),
    { targets: ["typescript"] },
  );
  assertEquals(emptyRoot[0].code, "EMPTY_ONLY_RULE");
  assertEquals(emptyRoot[0].severity, "warning");
  assertIncludes(emptyRoot[0].message, "can only derive empty text");

  const emptyHelper = validateGrammar(
    parseGrammar(`
      module = empty? "ok" ;
      empty = "" ;
    `),
    { targets: ["typescript"] },
  );
  const diagnostic = emptyHelper.find((entry) =>
    entry.code === "EMPTY_ONLY_RULE"
  );
  assertEquals(diagnostic?.severity, "warning");
  assertIncludes(diagnostic?.message ?? "", "Rule 'empty'");
});

Deno.test("grammar analysis reports expression depth limit exhaustion", () => {
  const diagnostics = validateGrammar(
    parseGrammar(`module = ((("ok")?)?)? ;`),
    {
      targets: ["typescript"],
      typescript: { grammarExpressionDepthLimit: 2 },
    },
  );
  assertEquals(diagnostics[0].code, "PORTABLE_GRAMMAR_EXPRESSION_DEPTH_LIMIT");
  assertEquals(diagnostics[0].severity, "error");
  assertIncludes(diagnostics[0].message, "configured limit (2)");
});

Deno.test("deep EBNF expressions hit default depth diagnostics before stack overflow", () => {
  let sourceExpression = `"ok"`;
  for (let index = 0; index < 1_100; index++) {
    sourceExpression = `(${sourceExpression})`;
  }
  const parsed = compile(`module = ${sourceExpression} ;`, {
    targets: ["typescript"],
  });
  assertEquals(parsed.bundle, undefined);
  assertEquals(parsed.diagnostics[0].code, "EBNF_PARSE_ERROR");
  assertIncludes(parsed.diagnostics[0].message, "expression depth");

  let expression: any = {
    kind: "literal" as const,
    value: "ok",
    span: { start: 0, end: 4, line: 1, column: 1 },
  };
  for (let index = 0; index < 1_100; index++) {
    expression = {
      kind: "optional" as const,
      expression,
      span: { start: 0, end: 4, line: 1, column: 1 },
    };
  }
  const analyzed = validateGrammar({
    tokens: [],
    rules: [{
      name: "module",
      expression,
      span: { start: 0, end: 4, line: 1, column: 1 },
    }],
    span: { start: 0, end: 4, line: 1, column: 1 },
  }, { targets: ["typescript"] });
  assertEquals(analyzed[0].code, "PORTABLE_GRAMMAR_EXPRESSION_DEPTH_LIMIT");
  assertIncludes(analyzed[0].message, "configured limit (1024)");
});

Deno.test("TypeScript parser target supports left-recursive arithmetic", async () => {
  const source = `
    token INTEGER = /[0-9]+/ ;
    skip WS = /[ \\t\\r\\n]+/ ;

    module = expr ;
    expr = additive ;
    additive =
        left:additive op:("+" | "-") right:multiplicative
      | multiplicative
    ;
    multiplicative =
        left:multiplicative op:("*" | "/") right:primary
      | primary
    ;
    primary = INTEGER | "(" expr ")" ;
  `;
  const result = compile(source, { targets: ["typescript"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    const parsed = mod.parse("1 + 2 * 3");
    assertEquals(parsed.ok, true);
    assertEquals(parsed.root.children[0].name, "expr");
    const additive = parsed.root.children[0].children[0];
    assertEquals(additive.name, "additive");
    assertEquals(additive.fields.op.literal, "+");
    assertEquals(additive.fields.right.name, "multiplicative");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TypeScript parse uses parser-contextual token selection", async () => {
  const result = compile(
    `
    skip WS = / +/ ;
    token A priority 10 = /x/ ;
    token B priority 0 = /x/ ;
    module = "a" A | "b" B ;
  `,
    { targets: ["typescript"] },
  );
  assert(result.bundle);
  assertEquals(result.diagnostics[0].code, "PORTABLE_LEXER_TOKEN_OVERLAP");
  assertEquals(result.diagnostics[0].severity, "warning");

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const mod = await import(`file://${dir}/typescript/mod.ts`);

    const lexed = mod.lex("b x", { preserveTrivia: false });
    assertEquals(
      lexed.tokens.filter((token: { channel: string }) =>
        token.channel !== "eof"
      )[1].kind,
      "A",
    );
    assertEquals(mod.parse("a x").ok, true);
    assertEquals(mod.parse("b x").ok, true);
    const stats: unknown[] = [];
    assertEquals(
      mod.parse("b x", {
        contextualLexingStats: (entry: unknown) => stats.push(entry),
      }).ok,
      true,
    );
    assertEquals(stats.length, 1);
    assertEquals(
      JSON.stringify(stats[0]),
      JSON.stringify({
        ambiguousLexicalSites: 1,
        contextualCandidateChecks: 5,
        attemptedTokenSelections: 2,
        reductionsBeforeTokenSelection: 2,
      }),
    );
    assertEquals(mod.parseTokens(lexed.source, lexed.tokens).ok, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TypeScript ParseResult narrows successful roots", async () => {
  const result = compile(`module = "x" ;`, { targets: ["typescript"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await Deno.writeTextFile(
      `${dir}/parse_result_check.ts`,
      `import { parse, type ParseDiagnostic } from "./typescript/mod.ts";

const result = parse("x");
if (result.ok) {
  result.root.children;
  const diagnostics: readonly [] = result.diagnostics;
  void diagnostics;
} else {
  const root: null = result.root;
  const diagnostics: readonly ParseDiagnostic[] = result.diagnostics;
  void root;
  void diagnostics;
}
`,
    );
    await denoCheck(`${dir}/parse_result_check.ts`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TypeScript parser diagnostics expose runtime payloads", async () => {
  const result = compile(`module = "a" ;`, { targets: ["typescript"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    const parsed = mod.parse("aa");
    assertEquals(parsed.ok, false);
    assertEquals(parsed.diagnostics[0].code, "PARSE_TRAILING_INPUT");
    assertEquals(
      parsed.diagnostics[0].runtimeCode,
      mod.parserDiagnosticCodeParseTrailingInput,
    );
    assertEquals(Number.isInteger(parsed.diagnostics[0].runtimeDetail), true);
    assertEquals(parsed.diagnostics[0].runtimeDetailKind, "parser-state");
    assertEquals(
      parsed.diagnostics[0].runtimeDetailKindId,
      mod.parserDiagnosticDetailKindParserState,
    );
    assertEquals(mod.parserDiagnosticDetailKindNone, 0);
    assertEquals(mod.parserDiagnosticDetailKindParserState, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TypeScript syntax separates main/trivia tokens and maps positions", async () => {
  const source = `
    token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
    skip WS = /[ \\t\\r\\n]+/ ;
    module = IDENT ;
  `;
  const result = compile(source, { targets: ["typescript"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await Deno.writeTextFile(
      `${dir}/syntax_contract_check.ts`,
      `import {
  createSourceMap,
  lex,
  parse,
  parseTokensUnchecked,
  positionAt,
  type MainNamedToken,
  type ParseDiagnostic,
  type TriviaToken,
} from "./typescript/mod.ts";

const main: MainNamedToken<"IDENT"> = {
  type: "named",
  kind: "IDENT",
  text: "value",
  span: { start: 0, end: 5 },
  channel: "main",
};
const trivia: TriviaToken<"WS"> = {
  type: "named",
  kind: "WS",
  text: " ",
  span: { start: 5, end: 6 },
  channel: "trivia",
};
const source = "value\\nnext";
const direct = positionAt(source, 6);
const mapped = createSourceMap(source).positionAt(6);
if (direct.line !== 2 || direct.column !== 1) throw new Error("bad position");
if (mapped.line !== 2 || mapped.column !== 1) throw new Error("bad source map");
const lexed = lex("value");
const unchecked = parseTokensUnchecked(lexed.source, lexed.tokens);
const parsed = parse("value");
if (!unchecked.ok || !parsed.ok) throw new Error("parse failed");
const diagnostics: readonly ParseDiagnostic[] = [];
void main;
void trivia;
void diagnostics;
`,
    );
    await denoCheck(`${dir}/syntax_contract_check.ts`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TypeScript CST nodes expose public token ranges", async () => {
  const source = `
    token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
    skip WS = /[ \\t\\r\\n]+/ ;
    skip COMMENT = /#[^\\n]*/ ;
    module = items:item+ ;
    item = value:IDENT ;
  `;
  const result = compile(source, { targets: ["typescript"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    const parsed = mod.parse("a # comment\nb", { preserveTrivia: true });
    assertEquals(parsed.ok, true);
    assertEquals(parsed.root.tokenRange.start, 0);
    assertEquals(parsed.root.tokenRange.end, 5);
    const items = parsed.root.fields.items;
    assertEquals(items[0].tokenRange.start, 0);
    assertEquals(items[0].tokenRange.end, 1);
    assertEquals(items[1].tokenRange.start, 4);
    assertEquals(items[1].tokenRange.end, 5);
    assertEquals(
      parsed.tokens
        .slice(parsed.root.tokenRange.start, parsed.root.tokenRange.end)
        .map((token: { channel: string }) => token.channel)
        .join(","),
      "main,trivia,trivia,trivia,main",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TypeScript target rejects nonportable character class escapes", () => {
  for (const pattern of ["[\\s]+", "[\\d]+", "[\\p{L}]+"]) {
    const result = compile(
      `
      token VALUE = /${pattern}/ ;
      module = VALUE ;
    `,
      { targets: ["typescript"] },
    );
    assertEquals(result.bundle, undefined);
    assertEquals(result.diagnostics[0].code, "INVALID_TOKEN_REGEX");
  }
});

Deno.test("EBNF parser captures regex text for compiler validation", () => {
  const grammar = parseEbnf(`
    token VALUE = /a{2,1}/ ;
    module = VALUE ;
  `);

  assertEquals(grammar.tokens[0].pattern, "a{2,1}");
  const result = compile(grammar, { targets: ["typescript"] });
  assertEquals(result.bundle, undefined);
  assertEquals(result.diagnostics[0].code, "INVALID_TOKEN_REGEX");
});

Deno.test("TypeScript parser derives optional separated-list fields", async () => {
  const source = `
    token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
    skip WS = /[ \\t\\r\\n]+/ ;

    call = callee:IDENT "(" args:(expr % ",")? ")" ;
    expr = IDENT ;
  `;
  const result = compile(source, { targets: ["typescript"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    assertEquals(mod.parse("f()").root.fields.args, null);
    const parsed = mod.parse("f(a, b)");
    assertEquals(parsed.root.fields.args.length, 2);
    assertEquals(parsed.root.fields.args[0].name, "expr");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TypeScript parser emits valid repeated tuple and nested array fields", async () => {
  const cases = [
    `token ID = /[a-z]+/ ; module = pairs:(ID ":" ID)* ;`,
    `token ID = /[a-z]+/ ; module = groups:("[" ID* "]")* ;`,
    `token ID = /[a-z]+/ ; token INTEGER = /[0-9]+/ ; module = values:((ID | INTEGER)*) ;`,
    `token ID = /[a-z]+/ ; module = (pair:(ID ":" ID))* ;`,
  ];

  for (const source of cases) {
    const result = compile(source, { targets: ["typescript"] });
    assertEquals(result.diagnostics.length, 0);
    assert(result.bundle);
    const dir = await Deno.makeTempDir();
    try {
      await applyBundle(result.bundle, { root: dir });
      await denoCheck(`${dir}/typescript/mod.ts`);
      const syntax = await Deno.readTextFile(`${dir}/typescript/syntax.ts`);
      assertIncludes(syntax, "ReadonlyArray<");
      assertNotIncludes(syntax, "readonly readonly");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  }
});

Deno.test("TypeScript parser ignores trivia in parseTokens and rejects unknown tokens", async () => {
  const source = `
    token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
    skip WS = /[ \\t\\r\\n]+/ ;
    module = "if" name:IDENT ;
  `;
  const result = compile(source, { targets: ["typescript"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    const lexed = mod.lex("if value");
    const parsed = mod.parseTokens(lexed.source, lexed.tokens);
    assertEquals(parsed.ok, true);
    assertEquals(parsed.root.fields.name.text, "value");

    const omittedTrivia = mod.parseTokens("if value", [
      lexed.tokens[0],
      lexed.tokens[2],
      lexed.tokens.at(-1),
    ]);
    assertEquals(omittedTrivia.ok, true);
    assertEquals(omittedTrivia.root.fields.name.text, "value");

    const unknown = mod.parseTokens("if value", [
      ...lexed.tokens.slice(0, 2),
      {
        type: "literal",
        literal: "value",
        text: "value",
        span: { start: 3, end: 8 },
        channel: "main",
      },
      lexed.tokens.at(-1),
    ]);
    assertEquals(unknown.ok, false);
    assertEquals(
      unknown.diagnostics[0].code,
      "PARSE_INVALID_TOKEN_STREAM",
    );

    const spoofedUnchecked = mod.parseTokensUnchecked("if value", [
      ...lexed.tokens.slice(0, 2),
      {
        type: "literal",
        literal: "value",
        text: "value",
        span: { start: 3, end: 8 },
        channel: "main",
        __babaTerminal: 2,
      },
      lexed.tokens.at(-1),
    ]);
    assertEquals(spoofedUnchecked.ok, false);
    assertEquals(
      spoofedUnchecked.diagnostics[0].code,
      "PARSE_LEXICAL_ERROR",
    );

    const eofBeforeMore = mod.parseTokens("if value", [
      lexed.tokens.at(-1),
      ...lexed.tokens.slice(0, -1),
    ]);
    assertEquals(eofBeforeMore.ok, false);
    assertEquals(
      eofBeforeMore.diagnostics[0].code,
      "PARSE_INVALID_TOKEN_STREAM",
    );

    const wrongTriviaKind = mod.parseTokens("if value", [
      lexed.tokens[0],
      lexed.tokens[1],
      {
        type: "named",
        kind: "BOGUS",
        text: "value",
        span: { start: 3, end: 8 },
        channel: "trivia",
      },
      lexed.tokens.at(-1),
    ]);
    assertEquals(wrongTriviaKind.ok, false);
    assertEquals(
      wrongTriviaKind.diagnostics[0].code,
      "PARSE_INVALID_TOKEN_STREAM",
    );

    const mainAsTrivia = mod.parseTokens("if value", [
      lexed.tokens[0],
      lexed.tokens[1],
      { ...lexed.tokens[2], channel: "trivia" },
      lexed.tokens.at(-1),
    ]);
    assertEquals(mainAsTrivia.ok, false);
    assertEquals(
      mainAsTrivia.diagnostics[0].code,
      "PARSE_INVALID_TOKEN_STREAM",
    );

    const zeroWidth = mod.parseTokens("if value", [
      lexed.tokens[0],
      lexed.tokens[1],
      {
        type: "named",
        kind: "IDENT",
        text: "",
        span: { start: 3, end: 3 },
        channel: "main",
      },
      lexed.tokens.at(-1),
    ]);
    assertEquals(zeroWidth.ok, false);
    assertEquals(
      zeroWidth.diagnostics[0].code,
      "PARSE_INVALID_TOKEN_STREAM",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TypeScript parseTokens rejects EOF before source end and nontrivia gaps", async () => {
  const result = compile(`module = ;`, { targets: ["typescript"] });
  assertEquals(
    result.diagnostics.map((diagnostic) => diagnostic.code).join(","),
    "EMPTY_ONLY_RULE",
  );
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const mod = await import(`file://${dir}/typescript/mod.ts`);

    const earlyEof = mod.parseTokens("garbage", [{
      type: "eof",
      text: "",
      span: { start: 0, end: 0 },
      channel: "main",
    }]);
    assertEquals(earlyEof.ok, false);
    assertEquals(earlyEof.diagnostics[0].code, "PARSE_INVALID_TOKEN_STREAM");

    const omittedSource = mod.parseTokens("garbage", []);
    assertEquals(omittedSource.ok, false);
    assertEquals(
      omittedSource.diagnostics[0].code,
      "PARSE_INVALID_TOKEN_STREAM",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TypeScript parser accepts multiple omitted trivia gaps in parseTokens", async () => {
  const source = `
    token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
    skip WS = /[ \\t\\r\\n]+/ ;

    module = "if" name:IDENT "," value:IDENT ";" ;
  `;
  const result = compile(source, { targets: ["typescript"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    const gapySource = "if   alpha   ,   beta ;";
    const lexed = mod.lex(gapySource);
    const mainOnly = lexed.tokens.filter((token: {
      channel: "main" | "trivia" | "error";
    }) => token.channel !== "trivia");
    const parsed = mod.parseTokens(gapySource, mainOnly);
    assertEquals(parsed.ok, true);
    assertEquals(parsed.root.fields.name.text, "alpha");
    assertEquals(parsed.root.fields.value.text, "beta");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TypeScript parseTokensUnchecked bypasses strict token stream span validation", async () => {
  const source = `
    token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
    skip WS = /[ \\t\\r\\n]+/ ;

    module = "if" name:IDENT "," value:IDENT ";" ;
  `;
  const result = compile(source, { targets: ["typescript"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    const gapySource = "if alpha , beta ;";
    const lexed = mod.lex(gapySource);
    const mainOnly = lexed.tokens.filter((token: {
      channel: "main" | "trivia" | "error";
    }) => token.channel !== "trivia");
    const malformed = mainOnly.map((token: {
      type: string;
      kind?: string;
      text: string;
      span: { start: number; end: number };
      channel: "main" | "trivia" | "error";
      literal?: string;
    }) =>
      token.type === "named" && token.kind === "IDENT" && token.text === "alpha"
        ? { ...token, span: { ...token.span, end: token.span.start } }
        : token
    );
    const strict = mod.parseTokens(gapySource, malformed);
    assertEquals(strict.ok, false);
    assertEquals(strict.diagnostics[0].code, "PARSE_INVALID_TOKEN_STREAM");
    const unchecked = mod.parseTokensUnchecked(gapySource, malformed);
    assert(
      !unchecked.diagnostics.some((diagnostic: { code: string }) =>
        diagnostic.code === "PARSE_INVALID_TOKEN_STREAM"
      ),
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TypeScript parser assigns current offsets to empty rule spans", async () => {
  const source = `
    skip WS = /[ \\t\\r\\n]+/ ;
    module = start:empty "a" middle:empty "b" after_trivia:empty "c" eof:empty ;
    empty = ;
  `;
  const result = compile(source, { targets: ["typescript"] });
  assertEquals(
    result.diagnostics.map((diagnostic) => diagnostic.code).join(","),
    "EMPTY_ONLY_RULE",
  );
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    const parsed = mod.parse("ab c");
    assertEquals(parsed.ok, true);
    assertEquals(
      JSON.stringify(parsed.root.fields.start.span),
      '{"start":0,"end":0}',
    );
    assertEquals(
      JSON.stringify(parsed.root.fields.middle.span),
      '{"start":1,"end":1}',
    );
    assertEquals(
      JSON.stringify(parsed.root.fields.after_trivia.span),
      '{"start":3,"end":3}',
    );
    assertEquals(
      JSON.stringify(parsed.root.fields.eof.span),
      '{"start":4,"end":4}',
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TypeScript target supports literal-only grammars and deterministic output", async () => {
  const result = compile(`module = "ok" ;`, { targets: ["typescript"] });
  const repeated = compile(`module = "ok" ;`, { targets: ["typescript"] });
  assert(result.bundle);
  assert(repeated.bundle);
  assertEquals(
    result.bundle.files.map(generatedContentForComparison).join("\n---\n"),
    repeated.bundle.files.map(generatedContentForComparison).join("\n---\n"),
  );

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    const parsed = mod.parse("ok");
    assertEquals(parsed.ok, true);
    assertEquals(parsed.root.name, "module");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TypeScript syntax emitter avoids rule node type name collisions", async () => {
  const source = `
    module = lower:foo upper:Foo ;
    foo = "a" ;
    Foo = "b" ;
  `;
  const result = compile(source, { targets: ["typescript"] });
  assert(result.bundle);
  const syntax = generatedTextContent(result.bundle, "typescript/syntax.ts");
  assertIncludes(syntax, "export interface FooNode ");
  assertIncludes(syntax, "export interface FooNode2 ");
  assertIncludes(syntax, "lower: FooNode;");
  assertIncludes(syntax, "upper: FooNode2;");

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    const parsed = mod.parse("ab");
    assertEquals(parsed.ok, true);
    assertEquals(parsed.root.fields.lower.name, "foo");
    assertEquals(parsed.root.fields.upper.name, "Foo");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TypeScript syntax emitter reserves public API type names", async () => {
  const source = `
    root = any:any_rule ;
    any_rule = "x" ;
  `;
  const result = compile(source, { targets: ["typescript"], rootRule: "root" });
  assert(result.bundle);
  const syntax = generatedTextContent(result.bundle, "typescript/syntax.ts");
  assertIncludes(syntax, "export interface RootNode2 ");
  assertIncludes(syntax, "export interface AnyRuleNode2 ");
  assertIncludes(syntax, "export type RootNode = RootNode2;");

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TypeScript parser handles prototype-like token and field names", async () => {
  const source = `
    token __proto__ = /x/ ;
    token constructor = /y/ ;
    token toString = /z/ ;
    module =
      __proto__:__proto__
      constructor:constructor
      toString:toString
    ;
  `;
  const result = compile(source, { targets: ["typescript"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    const parsed = mod.parse("xyz");
    assertEquals(parsed.ok, true);
    assertEquals(parsed.root.fields.__proto__.text, "x");
    assertEquals(parsed.root.fields.constructor.text, "y");
    assertEquals(parsed.root.fields.toString.text, "z");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TypeScript target rejects unsafe options and zero-length literals", () => {
  const source = `module = "" ;`;
  const emptyLiteral = compile(source, { targets: ["typescript"] });
  assertEquals(emptyLiteral.bundle, undefined);
  assert(
    emptyLiteral.diagnostics.some((diagnostic) =>
      diagnostic.code === "PORTABLE_LEXER_GENERATION_ERROR"
    ),
  );

  const invalidDirectory = compile(`module = "ok" ;`, {
    targets: ["typescript"],
    typescript: { directory: "../typescript" },
  });
  assertEquals(invalidDirectory.bundle, undefined);
  assertEquals(
    invalidDirectory.diagnostics.map((diagnostic) => diagnostic.code).join(","),
    "TS_INVALID_OUTPUT_DIRECTORY",
  );

  const invalidLexerLimit = compile(`module = "ok" ;`, {
    targets: ["typescript"],
    typescript: { lexerStateLimit: 0 },
  });
  assertEquals(invalidLexerLimit.bundle, undefined);
  assertEquals(
    invalidLexerLimit.diagnostics[0].code,
    "PORTABLE_LEXER_STATE_LIMIT",
  );

  const invalidStateLimit = compile(`module = "ok" ;`, {
    targets: ["typescript"],
    typescript: { parserStateLimit: 0 },
  });
  assertEquals(invalidStateLimit.bundle, undefined);
  assertEquals(
    invalidStateLimit.diagnostics[0].code,
    "PORTABLE_PARSER_STATE_LIMIT",
  );

  const invalidItemLimit = compile(`module = "ok" ;`, {
    targets: ["typescript"],
    typescript: { parserItemLimit: 0 },
  });
  assertEquals(invalidItemLimit.bundle, undefined);
  assertEquals(
    invalidItemLimit.diagnostics[0].code,
    "PORTABLE_PARSER_ITEM_LIMIT",
  );

  const invalidTableLimit = compile(`module = "ok" ;`, {
    targets: ["typescript"],
    typescript: { parserTableEntryLimit: 0 },
  });
  assertEquals(invalidTableLimit.bundle, undefined);
  assertEquals(
    invalidTableLimit.diagnostics[0].code,
    "PORTABLE_PARSER_TABLE_ENTRY_LIMIT",
  );

  const invalidByteLimit = compile(`module = "ok" ;`, {
    targets: ["typescript"],
    typescript: { generatedByteLimit: 0 },
  });
  assertEquals(invalidByteLimit.bundle, undefined);
  assertEquals(
    invalidByteLimit.diagnostics[0].code,
    "TS_GENERATED_BYTE_LIMIT",
  );
});

Deno.test("TypeScript target rejects nullable separated-list parts", () => {
  const nullableItem = compile(
    `
    empty = ;
    module = empty % "," ;
  `,
    { targets: ["typescript"], rootRule: "module" },
  );
  assertEquals(nullableItem.bundle, undefined);
  assert(
    nullableItem.diagnostics.some((diagnostic) =>
      diagnostic.code === "PORTABLE_PARSER_NULLABLE_LIST_ITEM"
    ),
  );

  const nullableSeparator = compile(
    `
    token ID = /[a-z]+/ ;
    empty = ;
    module = ID % empty ;
  `,
    { targets: ["typescript"], rootRule: "module" },
  );
  assertEquals(nullableSeparator.bundle, undefined);
  assert(
    nullableSeparator.diagnostics.some((diagnostic) =>
      diagnostic.code === "PORTABLE_PARSER_NULLABLE_LIST_SEPARATOR"
    ),
  );
});

Deno.test("TypeScript parser reports deliberately small state limits", () => {
  const lexerLimit = compile(`module = "a" | "b" ;`, {
    targets: ["typescript"],
    typescript: { lexerStateLimit: 1 },
  });
  assertEquals(lexerLimit.bundle, undefined);
  assertEquals(lexerLimit.diagnostics[0].code, "PORTABLE_LEXER_STATE_LIMIT");

  const stateLimit = compile(
    `
    module = "a" | "b" ;
  `,
    {
      targets: ["typescript"],
      typescript: { parserStateLimit: 1 },
    },
  );
  assertEquals(stateLimit.bundle, undefined);
  assertEquals(stateLimit.diagnostics[0].code, "PORTABLE_PARSER_STATE_LIMIT");

  const itemLimit = compile(`module = "a" | "b" ;`, {
    targets: ["typescript"],
    typescript: { parserItemLimit: 1 },
  });
  assertEquals(itemLimit.bundle, undefined);
  assertEquals(itemLimit.diagnostics[0].code, "PORTABLE_PARSER_ITEM_LIMIT");

  const closureLimit = compile(`module = "a" | "b" ;`, {
    targets: ["typescript"],
    typescript: { lrClosureWorkLimit: 1 },
  });
  assertEquals(closureLimit.bundle, undefined);
  assertEquals(
    closureLimit.diagnostics[0].code,
    "PORTABLE_LR_CLOSURE_WORK_LIMIT",
  );

  const tableLimit = compile(`module = "a" | "b" ;`, {
    targets: ["typescript"],
    typescript: { parserTableEntryLimit: 1 },
  });
  assertEquals(tableLimit.bundle, undefined);
  assertEquals(
    tableLimit.diagnostics[0].code,
    "PORTABLE_PARSER_TABLE_ENTRY_LIMIT",
  );

  const generatedByteLimit = compile(`module = "a" | "b" ;`, {
    targets: ["typescript"],
    typescript: { generatedByteLimit: 1 },
  });
  assertEquals(generatedByteLimit.bundle, undefined);
  assertEquals(
    generatedByteLimit.diagnostics[0].code,
    "TS_GENERATED_BYTE_LIMIT",
  );
});

Deno.test("TypeScript parser can report planning statistics", () => {
  const result = compile(`module = "a" | "b" ;`, {
    targets: ["typescript"],
    typescript: { reportParserStats: true },
  });
  assert(result.bundle);
  assertEquals(result.diagnostics[0].code, "TS_PARSER_STATS");
  assertIncludes(result.diagnostics[0].message, "BNF productions: 4");
  assertIncludes(result.diagnostics[0].message, "lexer states:");
  assertIncludes(result.diagnostics[0].message, "lexer accept candidates:");
  assertIncludes(
    result.diagnostics[0].message,
    "lexer average accept candidates/state:",
  );
  assertIncludes(
    result.diagnostics[0].message,
    "lexer max accept candidates/state:",
  );
  assertIncludes(
    result.diagnostics[0].message,
    "lexer ambiguous accept states:",
  );
  assertIncludes(result.diagnostics[0].message, "regex AST nodes:");
  assertIncludes(result.diagnostics[0].message, "regex NFA states:");
  assertIncludes(result.diagnostics[0].message, "regex DFA states:");
  assertIncludes(
    result.diagnostics[0].message,
    "overlap token pairs compared:",
  );
  assertIncludes(result.diagnostics[0].message, "grammar SCCs:");
  assertIncludes(result.diagnostics[0].message, "nullable iterations:");
  assertIncludes(result.diagnostics[0].message, "productive iterations:");
  assertIncludes(result.diagnostics[0].message, "LR states:");
  assertIncludes(result.diagnostics[0].message, "LR core items:");
  assertIncludes(result.diagnostics[0].message, "LR closure work:");
  assertIncludes(result.diagnostics[0].message, "ACTION entries:");
  assertIncludes(result.diagnostics[0].message, "diagnostics emitted:");
  assertIncludes(result.diagnostics[0].message, "diagnostics suppressed:");
  assertIncludes(result.diagnostics[0].message, "generated bytes:");
});
