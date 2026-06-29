import {
  assert,
  assertEquals,
  composeGrammarV2Modules,
  parseGrammarV2,
} from "./helpers.ts";

Deno.test("grammar v2 module composition reports extension token shadowing", () => {
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

  const composed = composeGrammarV2Modules([core, extension]);

  assert(
    composed.diagnostics.some((diagnostic) =>
      diagnostic.code === "GRAMMAR_V2_TOKEN_SHADOWED"
    ),
  );
  assert(
    composed.diagnostics.some((diagnostic) =>
      diagnostic.code === "GRAMMAR_V2_TOKEN_OVERLAP"
    ),
  );
});

Deno.test("grammar v2 module composition reports duplicate exports", () => {
  const core = grammar(`
    grammar Core

    export item
    export item

    token A = "a" ;
    item = A ;
  `);

  const composed = composeGrammarV2Modules([core]);

  assert(
    composed.diagnostics.some((diagnostic) =>
      diagnostic.code === "GRAMMAR_V2_DUPLICATE_EXPORT"
    ),
  );
});

function grammar(source: string) {
  const parsed = parseGrammarV2(source);
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);
  return parsed.grammar;
}
