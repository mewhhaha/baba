import {
  analyzeGrammarV2,
  assert,
  assertEquals,
  buildGrammarV2CstSchema,
  buildGrammarV2LexerPlan,
  buildGrammarV2TokenCst,
  parseGrammarV2,
} from "./helpers.ts";

Deno.test("grammar v2 CST records UTF-16 spans and UTF-8 byte spans", () => {
  const parsed = parseGrammarV2(`
    grammar CstSpans

    token Any = /./ ;

    module = Any Any ;
  `);
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);
  const analyzed = analyzeGrammarV2(parsed.grammar);
  assertEquals(analyzed.diagnostics.length, 0);
  const schema = buildGrammarV2CstSchema(analyzed);
  const lexer = buildGrammarV2LexerPlan(analyzed);
  const cst = buildGrammarV2TokenCst(schema, lexer, "a😀");

  assertEquals(cst.diagnostics.length, 0);
  const first = cst.root.children[0];
  const second = cst.root.children[1];
  assert(first.kind === "token");
  assert(second.kind === "token");
  assertEquals(first.text, "a");
  assertEquals(first.span.start, 0);
  assertEquals(first.span.end, 1);
  assertEquals(first.byteSpan.start, 0);
  assertEquals(first.byteSpan.end, 1);
  assertEquals(second.text, "😀");
  assertEquals(second.span.start, 1);
  assertEquals(second.span.end, 3);
  assertEquals(second.byteSpan.start, 1);
  assertEquals(second.byteSpan.end, 5);
  assertEquals(cst.root.span.end, 3);
  assertEquals(cst.root.byteSpan.end, 5);
});
