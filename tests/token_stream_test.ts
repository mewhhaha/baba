import {
  analyzeGrammar,
  assert,
  assertEquals,
  buildGrammarLexerPlan,
  lexGrammar,
  parseGrammar,
  validateGrammarTokenStream,
} from "./helpers.ts";

Deno.test("grammar token-stream validation reports structural issues", () => {
  const plan = lexerPlan();
  const lexed = lexGrammar(plan, "if value", { preserveTrivia: false });
  assertEquals(lexed.diagnostics.length, 0);

  const missing = validateGrammarTokenStream(
    plan,
    "if value",
    lexed.tokens.slice(0, 1),
    { preserveTrivia: false },
  );
  assertEquals(
    missing.map((diagnostic) => diagnostic.code).join(","),
    "GRAMMAR_TOKEN_STREAM_MISSING_TOKEN,GRAMMAR_TOKEN_STREAM_MISSING_TOKEN",
  );

  const extraToken = { ...lexed.tokens[0], span: { ...lexed.tokens[0].span } };
  const extra = validateGrammarTokenStream(
    plan,
    "if value",
    [...lexed.tokens, extraToken],
    { preserveTrivia: false },
  );
  assertEquals(
    extra.map((diagnostic) => diagnostic.code).join(","),
    "GRAMMAR_TOKEN_STREAM_EXTRA_TOKEN",
  );

  const wrongKind = validateGrammarTokenStream(
    plan,
    "if value",
    [{ ...lexed.tokens[0], name: "Ident" }, ...lexed.tokens.slice(1)],
    { preserveTrivia: false },
  );
  assertEquals(
    wrongKind.map((diagnostic) => diagnostic.code).join(","),
    "GRAMMAR_TOKEN_STREAM_WRONG_KIND",
  );

  const wrongSpan = validateGrammarTokenStream(
    plan,
    "if value",
    [
      lexed.tokens[0],
      {
        ...lexed.tokens[1],
        span: {
          ...lexed.tokens[1].span,
          start: lexed.tokens[1].span.start - 1,
        },
      },
      lexed.tokens[2],
    ],
    { preserveTrivia: false },
  );
  assertEquals(
    wrongSpan.map((diagnostic) => diagnostic.code).join(","),
    "GRAMMAR_TOKEN_STREAM_WRONG_SPAN",
  );
});

Deno.test("grammar lexer honors explicit token priority", () => {
  const parsed = parseGrammar(`
    grammar PriorityLex
    token A priority 10 = /x/ ;
    token B priority 0 = /x/ ;
    start = A | B ;
  `);
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);
  const analyzed = analyzeGrammar(parsed.grammar);
  assertEquals(analyzed.diagnostics.length, 0);
  const plan = buildGrammarLexerPlan(analyzed);
  assertEquals(plan.diagnostics.length, 0);

  const lexed = lexGrammar(plan, "x", { preserveTrivia: false });
  assertEquals(lexed.diagnostics.length, 0);
  assertEquals(lexed.tokens[0].name, "A");
});

function lexerPlan() {
  const parsed = parseGrammar(`
    grammar StreamLex
    token If = "if" ;
    token Ident = /[a-z]+/ ;
    skip Space channel trivia = /[ ]+/ ;
    start = If Ident ;
  `);
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);
  const analyzed = analyzeGrammar(parsed.grammar);
  const blockingDiagnostics = analyzed.diagnostics.filter((diagnostic) =>
    diagnostic.code !== "GRAMMAR_TOKEN_OVERLAP"
  );
  assertEquals(
    blockingDiagnostics.map((diagnostic) => diagnostic.code).join(","),
    "",
  );
  const plan = buildGrammarLexerPlan(analyzed);
  assertEquals(plan.diagnostics.length, 0);
  return plan;
}
