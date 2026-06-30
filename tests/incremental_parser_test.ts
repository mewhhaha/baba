import {
  analyzeGrammar,
  assert,
  assertEquals,
  buildGrammarCstSchema,
  buildGrammarLexerPlan,
  buildGrammarTokenCst,
  createGrammarIncrementalParser,
  debugGrammarCst,
  parseGrammar,
} from "./helpers.ts";

Deno.test("grammar incremental parser matches full CST after edit", () => {
  const { parser, schema, lexer } = parserFixture();
  const initial = parser.parseInitial("let total = a + b;");
  const edit = { start: 14, oldEnd: 15, newText: "*" };
  const next = parser.applyEdits(initial, [edit], { maxRelexBytes: 64 });
  const full = buildGrammarTokenCst(schema, lexer, next.source);

  assertEquals(next.cancelled, false);
  assertEquals(next.changedRanges[0].start, 14);
  assertEquals(next.changedRanges[0].end, 15);
  assert(next.relexedRange.start <= edit.start);
  assert(next.reparsedRange.end >= edit.start + edit.newText.length);
  assert(next.reusedNodeCount > 0);
  assertEquals(debugGrammarCst(next.tree), debugGrammarCst(full.root));
});

Deno.test("grammar incremental parser refreshes diagnostics after error edit", () => {
  const { parser } = parserFixture();
  const initial = parser.parseInitial("let total = @;");
  assertEquals(
    initial.diagnostics.map((diagnostic) => diagnostic.code).join(","),
    "GRAMMAR_LEX_UNEXPECTED_CHARACTER",
  );

  const next = parser.applyEdits(initial, [{
    start: 12,
    oldEnd: 13,
    newText: "1",
  }]);

  assertEquals(next.diagnostics.length, 0);
  assertEquals(next.source, "let total = 1;");
});

Deno.test("grammar incremental parser cancellation returns old state safely", () => {
  const { parser } = parserFixture();
  const initial = parser.parseInitial("let total = 1;");
  const next = parser.applyEdits(initial, [{
    start: 12,
    oldEnd: 13,
    newText: "2",
  }], {
    cancel: () => true,
  });

  assertEquals(next.cancelled, true);
  assertEquals(next.source, initial.source);
  assertEquals(debugGrammarCst(next.tree), debugGrammarCst(initial.tree));
});

function parserFixture() {
  const parsed = parseGrammar(`
    grammar Incremental

    token Let = "let" ;
    token Ident = /[a-z]+/ ;
    token Int = /[0-9]+/ ;
    token Eq = "=" ;
    token Plus = "+" ;
    token Star = "*" ;
    token Semi = ";" ;
    skip Space channel trivia = /[ ]+/ ;

    module = stmt+ ;
    stmt = Let Ident Eq expr Semi ;
    expr = atom (op atom)* ;
    op = Plus | Star ;
    atom = Ident | Int ;
  `);
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);
  const analyzed = analyzeGrammar(parsed.grammar);
  const blockingDiagnostics = analyzed.diagnostics.filter((diagnostic) => {
    if (diagnostic.code === "GRAMMAR_TOKEN_OVERLAP") {
      return false;
    }
    if (diagnostic.code === "GRAMMAR_TOKEN_SHADOWED") {
      return false;
    }
    return true;
  });
  assertEquals(
    blockingDiagnostics.map((diagnostic) => diagnostic.code).join(","),
    "",
  );
  const schema = buildGrammarCstSchema(analyzed);
  const lexer = buildGrammarLexerPlan(analyzed);
  const parser = createGrammarIncrementalParser(schema, lexer);
  return { parser, schema, lexer };
}
