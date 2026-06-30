import {
  analyzeGrammar,
  assert,
  assertEquals,
  buildGrammarLexerPlan,
  lexGrammar,
  parseGrammar,
} from "./helpers.ts";

const layout = {
  newlineToken: "NEWLINE",
  indentToken: "INDENT",
  dedentToken: "DEDENT",
  openTokens: ["LParen"],
  closeTokens: ["RParen"],
};

Deno.test("grammar layout lexer inserts stable indent tokens", () => {
  const plan = lexerPlan();
  const lexed = lexGrammar(plan, "if x:\n  foo\n  bar\nbaz", {
    preserveTrivia: false,
    layout,
  });
  assertEquals(lexed.diagnostics.length, 0);
  assertEquals(
    lexed.tokens.map((token) => token.name).join(" "),
    "If Ident Colon NEWLINE INDENT Ident NEWLINE Ident NEWLINE DEDENT Ident EOF",
  );
});

Deno.test("grammar layout lexer suppresses layout inside delimiters", () => {
  const plan = lexerPlan();
  const lexed = lexGrammar(plan, "call(\n  x\n)\ny", {
    preserveTrivia: false,
    layout,
  });
  assertEquals(lexed.diagnostics.length, 0);
  assertEquals(
    lexed.tokens.map((token) => token.name).join(" "),
    "Ident LParen Ident RParen NEWLINE Ident EOF",
  );
});

Deno.test("grammar layout lexer reports inconsistent indentation", () => {
  const plan = lexerPlan();
  const lexed = lexGrammar(plan, "if x:\n  foo\n bar", {
    preserveTrivia: false,
    layout,
  });
  assertEquals(
    lexed.diagnostics.map((diagnostic) => diagnostic.code).join(","),
    "GRAMMAR_LAYOUT_INCONSISTENT_INDENT",
  );
});

function lexerPlan() {
  const parsed = parseGrammar(`
    grammar LayoutLex
    token If = "if" ;
    token Ident = /[A-Za-z]+/ ;
    token Colon = ":" ;
    token LParen = "\\(" ;
    token RParen = "\\)" ;
    skip Space channel trivia = /[ \\t]+/ ;
    skip Newline channel trivia = /\\n[ \\t]*/ ;
    start = If ;
  `);
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
