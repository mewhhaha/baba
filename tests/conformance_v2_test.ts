import {
  type AnalyzedGrammarV2,
  analyzeGrammarV2,
  buildGrammarV2AstSchema,
  buildGrammarV2CstSchema,
  buildGrammarV2LexerPlan,
  buildGrammarV2ParserCorePlan,
  buildGrammarV2TokenCst,
  composeGrammarV2Modules,
  createGrammarV2IncrementalParser,
  debugGrammarV2Cst,
  type GrammarV2LayoutOptions,
  lexGrammarV2,
  materializeGrammarV2Ast,
  parseGrammarV2,
  recoverGrammarV2Parse,
  validateGrammarV2Parse,
} from "./helpers.ts";
import { assert, assertEquals, assertIncludes } from "./helpers.ts";

const BASIC_GRAMMAR = `
  grammar Conformance
  token LetToken = "let" ;
  token Ident = /[a-km-z]+/ ;
  token Int = /[0-9]+/ ;
  token Eq = "=" ;
  token Semi = ";" ;
  skip Space channel trivia = /[ ]+/ ;
  module = item+ -> Module(item) ;
  item = LetToken name:Ident Eq value:expr Semi -> Let(name, value) ;
  expr = Int -> IntLit(Int) | Ident -> Var(Ident) ;
`;

const BASIC_SOURCES = [
  "let x = 1;",
  "let y = 22;",
  "let z = x;",
  "let x = 1; let y = 2;",
  "let x = 1; let y = x;",
  "let y = 2; let z = y;",
  "let x = 10;",
  "let z = 3;",
  "let x = y;",
  "let y = 4; let x = y;",
];

Deno.test("grammar v2 conformance matrix satisfies fast gate coverage", () => {
  assertEquals(grammarParserFixtures().length, 5);
  assertEquals(lexerFixtures().length, 10);
  assertEquals(parserCstFixtures().length, 10);
  assertEquals(recoveryFixtures().length, 5);
  assertEquals(astFixtures().length, 3);
  assertEquals(contextualFixtures().length, 3);
  assertEquals(layoutFixtures().length, 2);
  assertEquals(modularFixtures().length, 2);
  assertEquals(incrementalFixtures().length, 1);
});

Deno.test("grammar v2 conformance grammar parser fixtures are stable", () => {
  for (const fixture of grammarParserFixtures()) {
    const parsed = parseGrammarV2(fixture.source);
    assertEquals(parsed.diagnostics.length, 0, fixture.name);
    assert(parsed.grammar, fixture.name);
    assertEquals(parsed.grammar.name, fixture.expectedName, fixture.name);
  }
});

Deno.test("grammar v2 conformance lexer and parser CST goldens are stable", () => {
  const analyzed = analyzedGrammar(BASIC_GRAMMAR);
  const lexer = buildGrammarV2LexerPlan(analyzed);
  const parser = buildGrammarV2ParserCorePlan(analyzed);
  const cstSchema = buildGrammarV2CstSchema(analyzed);

  for (const fixture of lexerFixtures()) {
    const lexed = lexGrammarV2(lexer, fixture.source, {
      preserveTrivia: false,
    });
    assertEquals(lexed.diagnostics.length, 0, fixture.name);
    assertEquals(
      normalizeTokens(lexed.tokens),
      fixture.expectedTokens,
      fixture.name,
    );
  }

  for (const fixture of parserCstFixtures()) {
    const parsed = validateGrammarV2Parse(parser, fixture.source);
    assertEquals(parsed.ok, true, fixture.name);
    const cst = buildGrammarV2TokenCst(cstSchema, lexer, fixture.source);
    assertEquals(cst.diagnostics.length, 0, fixture.name);
    assertIncludes(debugGrammarV2Cst(cst.root), fixture.expectedCstIncludes);
  }
});

Deno.test("grammar v2 conformance AST and recovery goldens are stable", () => {
  const analyzed = analyzedGrammar(BASIC_GRAMMAR);
  const lexer = buildGrammarV2LexerPlan(analyzed);
  const parser = buildGrammarV2ParserCorePlan(analyzed);
  const astSchema = buildGrammarV2AstSchema(analyzed);
  assertEquals(astSchema.diagnostics.length, 0);

  for (const fixture of astFixtures()) {
    const ast = materializeGrammarV2Ast(analyzed, lexer, fixture.source);
    assertEquals(ast.diagnostics.length, 0, fixture.name);
    assert(ast.ast);
    assertEquals((ast.ast as { kind: string }).kind, fixture.expectedKind);
  }

  for (const fixture of recoveryFixtures()) {
    const recovered = recoverGrammarV2Parse(parser, fixture.source);
    assertEquals(
      recovered.diagnostics.map((diagnostic) => diagnostic.recoveryAction.kind)
        .join(","),
      fixture.expectedActions,
      fixture.name,
    );
  }
});

Deno.test("grammar v2 conformance contextual layout modular and incremental cases", () => {
  for (const fixture of contextualFixtures()) {
    const analyzed = analyzedGrammar(fixture.grammar);
    const lexer = buildGrammarV2LexerPlan(analyzed);
    const lexed = lexGrammarV2(lexer, fixture.source, {
      preserveTrivia: false,
    });
    assertEquals(lexed.diagnostics.length, 0, fixture.name);
    assertEquals(
      lexed.candidateSites.map((site) =>
        site.candidates.map((candidate) => candidate.name).join("/")
      ).join("|"),
      fixture.expectedCandidates,
      fixture.name,
    );
  }

  for (const fixture of layoutFixtures()) {
    const analyzed = analyzedGrammar(fixture.grammar);
    const lexer = buildGrammarV2LexerPlan(analyzed);
    const lexed = lexGrammarV2(lexer, fixture.source, {
      preserveTrivia: false,
      layout: fixture.layout,
    });
    assertEquals(
      lexed.tokens.map((token) => token.name).join(" "),
      fixture.expectedTokens,
      fixture.name,
    );
  }

  for (const fixture of modularFixtures()) {
    const documents = fixture.sources.map((source) => {
      const parsed = parseGrammarV2(source);
      assert(parsed.grammar, fixture.name);
      return parsed.grammar;
    });
    const composed = composeGrammarV2Modules(documents);
    assertEquals(
      composed.diagnostics.map((diagnostic) => diagnostic.code).join(","),
      fixture.expectedDiagnostics,
      fixture.name,
    );
  }

  for (const fixture of incrementalFixtures()) {
    const analyzed = analyzedGrammar(fixture.grammar);
    const lexer = buildGrammarV2LexerPlan(analyzed);
    const cstSchema = buildGrammarV2CstSchema(analyzed);
    const incremental = createGrammarV2IncrementalParser(cstSchema, lexer);
    const initial = incremental.parseInitial(fixture.source);
    const next = incremental.applyEdits(initial, fixture.edits);
    const full = buildGrammarV2TokenCst(cstSchema, lexer, next.source);
    assertEquals(
      debugGrammarV2Cst(next.tree),
      debugGrammarV2Cst(full.root),
      fixture.name,
    );
  }
});

function grammarParserFixtures() {
  return [
    { name: "basic", source: BASIC_GRAMMAR, expectedName: "Conformance" },
    {
      name: "contextual",
      source: contextualGrammar("ContextualOne"),
      expectedName: "ContextualOne",
    },
    {
      name: "layout",
      source: layoutGrammar("LayoutOne"),
      expectedName: "LayoutOne",
    },
    {
      name: "modular-core",
      source: 'grammar Core export item token A = "a" ; item = A ;',
      expectedName: "Core",
    },
    {
      name: "list",
      source:
        'grammar List token Ident = /[a-z]+/ ; token Comma = "," ; list = Ident separated by Comma ;',
      expectedName: "List",
    },
  ];
}

function lexerFixtures() {
  return BASIC_SOURCES.map((source, index) => ({
    name: `lexer-${index}`,
    source,
    expectedTokens: normalizeBasicSource(source),
  }));
}

function parserCstFixtures() {
  return BASIC_SOURCES.map((source, index) => ({
    name: `parser-cst-${index}`,
    source,
    expectedCstIncludes: source.includes("22") ? 'Int "22"' : "LetToken",
  }));
}

function recoveryFixtures() {
  return [
    {
      name: "missing-eq",
      source: "let x 1;",
      expectedActions: "insert",
    },
    {
      name: "extra-eq",
      source: "let x = = 1;",
      expectedActions: "delete",
    },
    {
      name: "missing-semi",
      source: "let x = 1",
      expectedActions: "insert",
    },
    {
      name: "missing-value",
      source: "let x = ;",
      expectedActions: "insert",
    },
    {
      name: "extra-token",
      source: "let x = 1 y;",
      expectedActions: "delete",
    },
  ];
}

function astFixtures() {
  return BASIC_SOURCES.slice(0, 3).map((source, index) => ({
    name: `ast-${index}`,
    source,
    expectedKind: "Module",
  }));
}

function contextualFixtures() {
  return [
    {
      name: "async",
      grammar: contextualGrammar("ContextualAsync"),
      source: "async fn async",
      expectedCandidates: "Ident/Async|Fn/Ident|Ident/Async",
    },
    {
      name: "await",
      grammar: contextualGrammar("ContextualAwait"),
      source: "async await",
      expectedCandidates: "Ident/Async|Ident",
    },
    {
      name: "plain",
      grammar: contextualGrammar("ContextualPlain"),
      source: "x async",
      expectedCandidates: "Ident|Ident/Async",
    },
  ];
}

function layoutFixtures() {
  const layout: GrammarV2LayoutOptions = {
    newlineToken: "NEWLINE",
    indentToken: "INDENT",
    dedentToken: "DEDENT",
    openTokens: ["LParen"],
    closeTokens: ["RParen"],
  };
  return [
    {
      name: "block",
      grammar: layoutGrammar("LayoutBlock"),
      source: "if x:\n  foo\n  bar\nbaz",
      layout,
      expectedTokens:
        "If Ident Colon NEWLINE INDENT Ident NEWLINE Ident NEWLINE DEDENT Ident EOF",
    },
    {
      name: "paren",
      grammar: layoutGrammar("LayoutParen"),
      source: "call(\n  x\n)\ny",
      layout,
      expectedTokens: "Ident LParen Ident RParen NEWLINE Ident EOF",
    },
  ];
}

function modularFixtures() {
  return [
    {
      name: "extends-export",
      sources: [
        'grammar Core export item token A = "a" ; item = A ;',
        'grammar Extra import Core ; token B = "b" ; extend item = B ;',
      ],
      expectedDiagnostics: "",
    },
    {
      name: "cycle",
      sources: [
        'grammar Left import Right ; export item token A = "a" ; item = A ;',
        'grammar Right import Left ; export item token B = "b" ; item = B ;',
      ],
      expectedDiagnostics:
        "GRAMMAR_MODULE_IMPORT_CYCLE,GRAMMAR_V2_DUPLICATE_EXPORT,GRAMMAR_V2_DUPLICATE_RULE,GRAMMAR_V2_UNUSED_TOKEN",
    },
  ];
}

function incrementalFixtures() {
  return [{
    name: "single-edit",
    grammar: BASIC_GRAMMAR,
    source: "let x = 1;",
    edits: [{ start: 8, oldEnd: 9, newText: "2" }],
  }];
}

function analyzedGrammar(source: string): AnalyzedGrammarV2 {
  const parsed = parseGrammarV2(source);
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);
  const analyzed = analyzeGrammarV2(parsed.grammar);
  const blocking = analyzed.diagnostics.filter((diagnostic) =>
    diagnostic.code !== "GRAMMAR_V2_UNUSED_TOKEN"
  );
  assertEquals(blocking.map((diagnostic) => diagnostic.code).join(","), "");
  return analyzed;
}

function normalizeTokens(tokens: readonly { readonly name: string }[]): string {
  return tokens.map((token) => token.name).join(" ");
}

function normalizeBasicSource(source: string): string {
  const names: string[] = [];
  const parts = source.split(" ");
  for (const part of parts) {
    if (part === "let") {
      names.push("LetToken");
    } else if (part === "=") {
      names.push("Eq");
    } else if (/^[0-9]+;?$/.test(part)) {
      names.push("Int");
      if (part.endsWith(";")) {
        names.push("Semi");
      }
    } else {
      const text = part.endsWith(";") ? part.slice(0, -1) : part;
      if (text.length > 0) {
        names.push("Ident");
      }
      if (part.endsWith(";")) {
        names.push("Semi");
      }
    }
  }
  names.push("EOF");
  return names.join(" ");
}

function contextualGrammar(name: string): string {
  return `
    grammar ${name}
    contextual Async = "async" ;
    token Fn = "fn" ;
    token Ident = /[a-z]+/ ;
    skip Space channel trivia = /[ ]+/ ;
    start = Ident+ ;
  `;
}

function layoutGrammar(name: string): string {
  return `
    grammar ${name}
    token If = "if" ;
    token Ident = /[A-Za-z]+/ ;
    token Colon = ":" ;
    token LParen = "\\(" ;
    token RParen = "\\)" ;
    skip Space channel trivia = /[ \\t]+/ ;
    skip Newline channel trivia = /\\n[ \\t]*/ ;
    start = Ident ;
  `;
}
