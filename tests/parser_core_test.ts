import {
  analyzeGrammar,
  assert,
  assertEquals,
  buildGrammarParserCorePlan,
  parseGrammar,
  validateGrammarParse,
} from "./helpers.ts";
import type { AnalyzedGrammar, GrammarParserCorePlan } from "./helpers.ts";

Deno.test("grammar parser core validates left-recursive LR syntax", () => {
  const plan = parserCorePlan(`
    grammar Path

    token Ident = /[a-z]+/ ;
    token Dot = "." ;
    skip Space channel trivia = /[ ]+/ ;

    path =
      path Dot Ident -> Member(path, Ident)
      | Ident -> Root(Ident)
      ;
  `);

  assertEquals(plan.diagnostics.length, 0);
  assertEquals(
    plan.bnf.terminals.map((terminal) => terminal.display).join(","),
    "EOF,Dot,Ident",
  );
  assert(plan.lr.stats.states > 0);

  const accepted = validateGrammarParse(plan, "a.b.c");
  assertEquals(accepted.ok, true);
  assertEquals(accepted.diagnostics.length, 0);
  assertEquals(accepted.acceptedTokens, 5);

  const rejected = validateGrammarParse(plan, "a.");
  assertEquals(rejected.ok, false);
  assertEquals(
    rejected.diagnostics.map((diagnostic) => diagnostic.code).join(","),
    "GRAMMAR_PARSE_UNEXPECTED_TOKEN",
  );
  assertEquals(rejected.acceptedTokens, 2);
});

Deno.test("grammar parser core reports LR conflicts with stable metadata", () => {
  const plan = parserCorePlan(`
    grammar Ambiguous

    token A = "a" ;

    start = left | right ;
    left = A ;
    right = A ;
  `);

  const conflict = plan.diagnostics.find((diagnostic) =>
    diagnostic.code === "RUNTIME_PARSER_REDUCE_REDUCE_CONFLICT"
  );
  assert(conflict);
  assert(conflict.message.includes("Conflict ID: c_"));
});

Deno.test("grammar parser core passes LR construction limits through", () => {
  const analyzed = analyzedGrammar(`
    grammar Limited

    token Ident = /[a-z]+/ ;

    start = Ident ;
  `);
  const plan = buildGrammarParserCorePlan(analyzed, { stateLimit: 1 });

  assertEquals(
    plan.diagnostics.map((diagnostic) => diagnostic.code).join(","),
    "RUNTIME_PARSER_STATE_LIMIT",
  );
});

function parserCorePlan(source: string): GrammarParserCorePlan {
  const analyzed = analyzedGrammar(source);
  const plan = buildGrammarParserCorePlan(analyzed);
  return plan;
}

function analyzedGrammar(source: string): AnalyzedGrammar {
  const parsed = parseGrammar(source);
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);
  const analyzed = analyzeGrammar(parsed.grammar);
  const blockingDiagnostics = analyzed.diagnostics.filter((diagnostic) => {
    if (diagnostic.code === "GRAMMAR_TOKEN_OVERLAP") {
      return false;
    }
    if (diagnostic.code === "GRAMMAR_UNUSED_TOKEN") {
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
