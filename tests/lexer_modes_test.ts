import {
  analyzeGrammar,
  assert,
  assertEquals,
  buildGrammarLexerPlan,
  lexGrammar,
  parseGrammar,
} from "./helpers.ts";

Deno.test("grammar lexer executes mode transitions and trivia policy", () => {
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

  const lexed = lexGrammar(plan, '"hi ${name}"', {
    preserveTrivia: false,
  });
  assertEquals(lexed.diagnostics.length, 0);
  assertEquals(
    lexed.tokens.map((token) =>
      `${token.name}:${token.text}:${token.mode}:${token.channel}`
    ).join("|"),
    'Quote:":default:main|StringText:hi :String:main|InterpStart:${:String:main|Ident:name:default:main|RBrace:}:default:main|Quote:":String:main|EOF::default:eof',
  );

  const withTrivia = lexGrammar(plan, '"a ${ name }"', {
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

Deno.test("grammar lexer checkpoints resume with the same suffix", () => {
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
  const full = lexGrammar(plan, source);
  assertEquals(full.diagnostics.length, 0);

  const checkpoint = full.checkpoints[2];
  assert(checkpoint);
  const resumed = lexGrammar(plan, source, { checkpoint });
  assertEquals(resumed.diagnostics.length, 0);
  assertEquals(
    resumed.tokens.map((token) => `${token.name}:${token.text}`).join("|"),
    full.tokens.slice(3).map((token) => `${token.name}:${token.text}`).join(
      "|",
    ),
  );
});

function lexerPlan(source: string) {
  const parsed = parseGrammar(source);
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);
  const analyzed = analyzeGrammar(parsed.grammar);
  const blockingDiagnostics = analyzed.diagnostics.filter((diagnostic) =>
    diagnostic.code !== "GRAMMAR_UNUSED_TOKEN"
  );
  assertEquals(
    blockingDiagnostics.map((diagnostic) => diagnostic.code).join(","),
    "",
  );
  const plan = buildGrammarLexerPlan(analyzed);
  assertEquals(plan.diagnostics.length, 0);
  return plan;
}
