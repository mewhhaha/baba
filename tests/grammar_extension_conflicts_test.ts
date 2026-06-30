import {
  assert,
  assertEquals,
  composeGrammarModules,
  parseGrammar,
} from "./helpers.ts";

Deno.test("grammar module composition reports extension token shadowing", () => {
  const core = grammar(`
    grammar Core

    export item

    token Ident = /[a-z]+/ ;

    item = Ident ;
  `);
  const extension = grammar(`
    grammar Keywords

    import Core ;

    token Let = "let" ;

    extend item = Let ;
  `);

  const composed = composeGrammarModules([core, extension]);

  assert(
    composed.diagnostics.some((diagnostic) =>
      diagnostic.code === "GRAMMAR_TOKEN_SHADOWED"
    ),
  );
  assert(
    composed.diagnostics.some((diagnostic) =>
      diagnostic.code === "GRAMMAR_TOKEN_OVERLAP"
    ),
  );
});

Deno.test("grammar module composition reports duplicate exports", () => {
  const core = grammar(`
    grammar Core

    export item
    export item

    token A = "a" ;
    item = A ;
  `);

  const composed = composeGrammarModules([core]);

  assert(
    composed.diagnostics.some((diagnostic) =>
      diagnostic.code === "GRAMMAR_DUPLICATE_EXPORT"
    ),
  );
});

function grammar(source: string) {
  const parsed = parseGrammar(source);
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);
  return parsed.grammar;
}
