import {
  analyzeGrammarV2,
  assert,
  assertEquals,
  buildGrammarV2LexerPlan,
  lexGrammarV2,
  parseGrammarV2,
  validateGrammarV2TokenStream,
} from "./helpers.ts";

Deno.test("grammar v2 token-stream validation reports structural issues", () => {
  const plan = lexerPlan();
  const lexed = lexGrammarV2(plan, "if value", { preserveTrivia: false });
  assertEquals(lexed.diagnostics.length, 0);

  const missing = validateGrammarV2TokenStream(
    plan,
    "if value",
    lexed.tokens.slice(0, 1),
    { preserveTrivia: false },
  );
  assertEquals(
    missing.map((diagnostic) => diagnostic.code).join(","),
    "GRAMMAR_V2_TOKEN_STREAM_MISSING_TOKEN,GRAMMAR_V2_TOKEN_STREAM_MISSING_TOKEN",
  );

  const extraToken = { ...lexed.tokens[0], span: { ...lexed.tokens[0].span } };
  const extra = validateGrammarV2TokenStream(
    plan,
    "if value",
    [...lexed.tokens, extraToken],
    { preserveTrivia: false },
  );
  assertEquals(
    extra.map((diagnostic) => diagnostic.code).join(","),
    "GRAMMAR_V2_TOKEN_STREAM_EXTRA_TOKEN",
  );

  const wrongKind = validateGrammarV2TokenStream(
    plan,
    "if value",
    [{ ...lexed.tokens[0], name: "Ident" }, ...lexed.tokens.slice(1)],
    { preserveTrivia: false },
  );
  assertEquals(
    wrongKind.map((diagnostic) => diagnostic.code).join(","),
    "GRAMMAR_V2_TOKEN_STREAM_WRONG_KIND",
  );

  const wrongSpan = validateGrammarV2TokenStream(
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
    "GRAMMAR_V2_TOKEN_STREAM_WRONG_SPAN",
  );
});

function lexerPlan() {
  const parsed = parseGrammarV2(`
    grammar StreamLex
    token If = "if" ;
    token Ident = /[a-z]+/ ;
    skip Space channel trivia = /[ ]+/ ;
    start = If Ident ;
  `);
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);
  const analyzed = analyzeGrammarV2(parsed.grammar);
  const blockingDiagnostics = analyzed.diagnostics.filter((diagnostic) =>
    diagnostic.code !== "GRAMMAR_V2_TOKEN_OVERLAP"
  );
  assertEquals(
    blockingDiagnostics.map((diagnostic) => diagnostic.code).join(","),
    "",
  );
  const plan = buildGrammarV2LexerPlan(analyzed);
  assertEquals(plan.diagnostics.length, 0);
  return plan;
}
