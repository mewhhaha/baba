import {
  analyzeGrammarV2,
  assert,
  assertEquals,
  buildGrammarV2LexerPlan,
  lexGrammarV2,
  parseGrammarV2,
} from "./helpers.ts";

Deno.test("grammar v2 lexer executes mode transitions and trivia policy", () => {
  const plan = lexerPlan(`
    grammar ModeLex
    mode String {
      token StringText = /[^"$]+/ ;
      token InterpStart push default = /\\$\\{/ ;
      token Quote pop = /"/ ;
    }
    token Quote push String = /"/ ;
    token RBrace pop = /\\}/ ;
    token Ident = /[A-Za-z]+/ ;
    skip Space channel trivia = /[ \\t]+/ ;
    start = Quote ;
  `);

  const lexed = lexGrammarV2(plan, '"hi ${name}"', {
    preserveTrivia: false,
  });
  assertEquals(lexed.diagnostics.length, 0);
  assertEquals(
    lexed.tokens.map((token) =>
      `${token.name}:${token.text}:${token.mode}:${token.channel}`
    ).join("|"),
    'Quote:":default:main|StringText:hi :String:main|InterpStart:${:String:main|Ident:name:default:main|RBrace:}:default:main|Quote:":String:main|EOF::default:eof',
  );

  const withTrivia = lexGrammarV2(plan, '"a ${ name }"', {
    preserveTrivia: true,
  });
  assertEquals(withTrivia.diagnostics.length, 0);
  assertEquals(
    withTrivia.tokens.map((token) => `${token.name}:${token.channel}`).join(
      "|",
    ),
    "Quote:main|StringText:main|InterpStart:main|Space:trivia|Ident:main|Space:trivia|RBrace:main|Quote:main|EOF:eof",
  );
});

Deno.test("grammar v2 lexer checkpoints resume with the same suffix", () => {
  const plan = lexerPlan(`
    grammar ModeLex
    mode String {
      token StringText = /[^"$]+/ ;
      token InterpStart push default = /\\$\\{/ ;
      token Quote pop = /"/ ;
    }
    token Quote push String = /"/ ;
    token RBrace pop = /\\}/ ;
    token Ident = /[A-Za-z]+/ ;
    start = Quote ;
  `);
  const source = '"hi ${name}"';
  const full = lexGrammarV2(plan, source);
  assertEquals(full.diagnostics.length, 0);

  const checkpoint = full.checkpoints[2];
  assert(checkpoint);
  const resumed = lexGrammarV2(plan, source, { checkpoint });
  assertEquals(resumed.diagnostics.length, 0);
  assertEquals(
    resumed.tokens.map((token) => `${token.name}:${token.text}`).join("|"),
    full.tokens.slice(3).map((token) => `${token.name}:${token.text}`).join(
      "|",
    ),
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
