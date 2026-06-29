import {
  analyzeGrammarV2,
  assert,
  assertEquals,
  buildGrammarV2LexerPlan,
  lexGrammarV2,
  parseGrammarV2,
} from "./helpers.ts";

Deno.test("grammar v2 lexer retains contextual keyword candidates", () => {
  const plan = lexerPlan(`
    grammar ContextualLex
    contextual Async = "async" ;
    token Fn = "fn" ;
    token Ident = /[a-z]+/ ;
    skip Space channel trivia = /[ ]+/ ;
    start = Ident ;
  `);

  const lexed = lexGrammarV2(plan, "async fn async", {
    preserveTrivia: false,
  });
  assertEquals(lexed.diagnostics.length, 0);
  assertEquals(
    lexed.tokens.map((token) => token.name).join(" "),
    "Ident Fn Ident EOF",
  );
  assertEquals(
    lexed.candidateSites.map((site) =>
      `${site.tokenIndex}:${
        site.candidates.map((candidate) =>
          `${candidate.name}:${candidate.contextual}`
        ).join(",")
      }`
    ).join("|"),
    "0:Ident:false,Async:true|1:Fn:false,Ident:false|2:Ident:false,Async:true",
  );
});

function lexerPlan(source: string) {
  const parsed = parseGrammarV2(source);
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);
  const analyzed = analyzeGrammarV2(parsed.grammar);
  const blockingDiagnostics = analyzed.diagnostics.filter((diagnostic) =>
    diagnostic.code !== "GRAMMAR_V2_UNUSED_TOKEN"
  );
  assertEquals(
    blockingDiagnostics.map((diagnostic) => diagnostic.code).join(","),
    "",
  );
  const plan = buildGrammarV2LexerPlan(analyzed);
  assertEquals(plan.diagnostics.length, 0);
  return plan;
}
