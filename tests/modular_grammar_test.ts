import {
  assert,
  assertEquals,
  buildGrammarParserCorePlan,
  composeGrammarModules,
  parseGrammar,
  validateGrammarParse,
} from "./helpers.ts";

Deno.test("grammar modules compose exported extension alternatives deterministically", () => {
  const core = grammar(`
    grammar Core

    export item

    token Let = "let" ;
    token Test = "test" ;
    token Ident = /[a-z]+/ ;
    token Semi = ";" ;
    skip Space channel trivia = /[ ]+/ ;

    item = Let Ident Semi -> Let(Ident) ;
  `);
  const tests = grammar(`
    grammar Tests

    import Core ;

    extend item =
      Test Ident Semi -> TestDecl(Ident)
    ;
  `);

  const composed = composeGrammarModules([core, tests]);

  assertEquals(
    composed.diagnostics.filter((diagnostic) =>
      diagnostic.code !== "GRAMMAR_TOKEN_OVERLAP" &&
      diagnostic.code !== "GRAMMAR_TOKEN_SHADOWED"
    ).map((diagnostic) => diagnostic.code).join(","),
    "",
  );
  assertEquals(composed.moduleOrder.join(","), "Core,Tests");
  const item = composed.document.declarations.find((declaration) =>
    declaration.kind === "rule" && declaration.name === "item"
  );
  assert(item);
  assert(item.kind === "rule");
  assertEquals(item.expression.kind, "choice");
  if (item.expression.kind === "choice") {
    assertEquals(item.expression.options.length, 2);
    assertEquals(item.expression.options[0].kind, "constructor");
    assertEquals(item.expression.options[1].kind, "constructor");
  }

  const plan = buildGrammarParserCorePlan(composed.analyzed);
  const blockingPlanDiagnostics = plan.diagnostics.filter((diagnostic) =>
    diagnostic.code !== "GRAMMAR_TOKEN_OVERLAP" &&
    diagnostic.code !== "GRAMMAR_TOKEN_SHADOWED"
  );
  assertEquals(
    blockingPlanDiagnostics.map((diagnostic) => diagnostic.code).join(","),
    "",
  );
  assertEquals(validateGrammarParse(plan, "let a;").ok, true);
  assertEquals(validateGrammarParse(plan, "test b;").ok, true);
});

Deno.test("grammar modules reject extension points that are not exported", () => {
  const core = grammar(`
    grammar Core

    export item

    token Let = "let" ;
    token Ident = /[a-z]+/ ;
    token Semi = ";" ;

    item = Let Ident Semi ;
    stmt = Ident Semi ;
  `);
  const effects = grammar(`
    grammar Effects

    import Core ;

    extend stmt = Ident Semi ;
  `);

  const composed = composeGrammarModules([core, effects]);
  const diagnostic = composed.diagnostics.find((entry) =>
    entry.code === "GRAMMAR_EXTENSION_POINT_NOT_EXPORTED"
  );

  assert(diagnostic);
  assertEquals(diagnostic.module, "Effects");
  assertEquals(diagnostic.targetRule, "stmt");
  assertEquals(diagnostic.baseGrammar, "Core");
});

Deno.test("grammar modules report import cycles", () => {
  const left = grammar(`
    grammar Left
    import Right ;
    export item
    token A = "a" ;
    item = A ;
  `);
  const right = grammar(`
    grammar Right
    import Left ;
    export item
    token B = "b" ;
    item = B ;
  `);

  const composed = composeGrammarModules([left, right]);

  assert(
    composed.diagnostics.some((diagnostic) =>
      diagnostic.code === "GRAMMAR_MODULE_IMPORT_CYCLE"
    ),
  );
});

function grammar(source: string) {
  const parsed = parseGrammar(source);
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);
  return parsed.grammar;
}
