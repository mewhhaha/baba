import {
  analyzeGrammarV2,
  assert,
  assertEquals,
  buildGrammarV2ParserCorePlan,
  parseGrammarV2,
  validateGrammarV2Parse,
} from "./helpers.ts";
import type { AnalyzedGrammarV2, GrammarV2ParserCorePlan } from "./helpers.ts";

Deno.test("grammar v2 parser core validates left-recursive LR syntax", () => {
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

  const accepted = validateGrammarV2Parse(plan, "a.b.c");
  assertEquals(accepted.ok, true);
  assertEquals(accepted.diagnostics.length, 0);
  assertEquals(accepted.acceptedTokens, 5);

  const rejected = validateGrammarV2Parse(plan, "a.");
  assertEquals(rejected.ok, false);
  assertEquals(
    rejected.diagnostics.map((diagnostic) => diagnostic.code).join(","),
    "GRAMMAR_V2_PARSE_UNEXPECTED_TOKEN",
  );
  assertEquals(rejected.acceptedTokens, 2);
});

Deno.test("grammar v2 parser core reports LR conflicts with stable metadata", () => {
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

Deno.test("grammar v2 parser core passes LR construction limits through", () => {
  const analyzed = analyzedGrammar(`
    grammar Limited

    token Ident = /[a-z]+/ ;

    start = Ident ;
  `);
  const plan = buildGrammarV2ParserCorePlan(analyzed, { stateLimit: 1 });

  assertEquals(
    plan.diagnostics.map((diagnostic) => diagnostic.code).join(","),
    "RUNTIME_PARSER_STATE_LIMIT",
  );
});

function parserCorePlan(source: string): GrammarV2ParserCorePlan {
  const analyzed = analyzedGrammar(source);
  const plan = buildGrammarV2ParserCorePlan(analyzed);
  return plan;
}

function analyzedGrammar(source: string): AnalyzedGrammarV2 {
  const parsed = parseGrammarV2(source);
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);
  const analyzed = analyzeGrammarV2(parsed.grammar);
  const blockingDiagnostics = analyzed.diagnostics.filter((diagnostic) => {
    if (diagnostic.code === "GRAMMAR_V2_TOKEN_OVERLAP") {
      return false;
    }
    if (diagnostic.code === "GRAMMAR_V2_UNUSED_TOKEN") {
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
