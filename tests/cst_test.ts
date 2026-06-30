import {
  analyzeGrammar,
  assert,
  assertEquals,
  buildGrammarCstSchema,
  buildGrammarLexerPlan,
  buildGrammarTokenCst,
  debugGrammarCst,
  grammarCstText,
  missingGrammarCstNode,
  parseGrammar,
} from "./helpers.ts";
import type { AnalyzedGrammar } from "./helpers.ts";

Deno.test("grammar token CST preserves trivia and round-trips source", () => {
  const analyzed = analyzedGrammar(`
    grammar Cst

    token Let = "let" ;
    token Ident = /[a-z]+/ ;
    token Eq = "=" ;
    token Int = /[0-9]+/ ;
    token Semi = ";" ;
    skip Space channel trivia = /[ ]+/ ;
    skip Comment channel trivia = /\\/\\/[A-Za-z ]*/ ;

    module = Let Ident Eq Int Semi ;
  `);
  const schema = buildGrammarCstSchema(analyzed);
  const lexer = buildGrammarLexerPlan(analyzed);
  const source = "let x = 1; // keep me";
  const cst = buildGrammarTokenCst(schema, lexer, source);

  assertEquals(cst.diagnostics.length, 0);
  assertEquals(grammarCstText(cst.root), source);
  assertEquals(cst.stats.nodes, 1);
  assertEquals(cst.stats.tokens, 6);
  assertEquals(cst.stats.trivia, 5);
  assertEquals(cst.root.span.start, 0);
  assertEquals(cst.root.span.end, source.length);
  assertEquals(
    debugGrammarCst(cst.root),
    `Root@0..21
  Let "let"@0..3
  Space " "@3..4
  Ident "x"@4..5
  Space " "@5..6
  Eq "="@6..7
  Space " "@7..8
  Int "1"@8..9
  Semi ";"@9..10
  Space " "@10..11
  Comment "// keep me"@11..21
  EOF ""@21..21`,
  );
});

Deno.test("grammar token CST keeps invalid and missing nodes inspectable", () => {
  const analyzed = analyzedGrammar(`
    grammar BrokenCst

    token Ident = /[a-z]+/ ;
    skip Space channel trivia = /[ ]+/ ;

    module = Ident ;
  `);
  const schema = buildGrammarCstSchema(analyzed);
  const lexer = buildGrammarLexerPlan(analyzed);
  const cst = buildGrammarTokenCst(schema, lexer, "ok @");

  assertEquals(
    cst.diagnostics.map((diagnostic) => diagnostic.code).join(","),
    "GRAMMAR_LEX_UNEXPECTED_CHARACTER",
  );
  assertEquals(cst.root.invalid, true);
  assertEquals(cst.stats.invalid, 2);

  const missing = missingGrammarCstNode(
    schema,
    "MissingExpr",
    { start: 3, end: 3, line: 1, column: 4 },
    "value",
  );
  assertEquals(missing.missing, true);
  assertEquals(missing.field, "value");
  assertEquals(debugGrammarCst(missing), "value: MissingExpr@3..3 missing");
});

Deno.test("grammar CST schema gives stable IDs to rule and token kinds", () => {
  const analyzed = analyzedGrammar(`
    grammar StableCst

    token A = "a" ;
    token B = "b" ;

    start = A B ;
  `);
  const schema = buildGrammarCstSchema(analyzed);

  assertEquals(
    schema.nodeKinds.map((kind) => `${kind.id}:${kind.name}`).join(","),
    "0:Root,1:Invalid,2:Missing,3:start",
  );
  assertEquals(
    schema.tokenKinds.map((kind) => `${kind.id}:${kind.name}`).join(","),
    "0:EOF,1:ERROR,2:A,3:B",
  );
});

function analyzedGrammar(source: string): AnalyzedGrammar {
  const parsed = parseGrammar(source);
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);
  const analyzed = analyzeGrammar(parsed.grammar);
  const blockingDiagnostics = analyzed.diagnostics.filter((diagnostic) => {
    if (diagnostic.code === "GRAMMAR_UNUSED_TOKEN") {
      return false;
    }
    if (diagnostic.code === "GRAMMAR_TOKEN_OVERLAP") {
      return false;
    }
    return true;
  });
  assertEquals(
    blockingDiagnostics.map((diagnostic) => diagnostic.code).join(","),
    "",
  );
  return analyzed;
}
