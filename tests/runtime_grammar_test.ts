import {
  analyzeGrammar,
  buildGrammarPortablePlan,
  createGrammarRuntime,
  debugGrammarCst,
  type GrammarPortablePlan,
} from "./helpers.ts";
import {
  assert,
  assertEquals,
  assertIncludes,
  parseGrammar,
} from "./helpers.ts";

Deno.test("grammar TypeScript runtime adapter lexes parses CSTs and ASTs", () => {
  const runtime = createGrammarRuntime(portablePlan());

  const lexed = runtime.lex("let x = 1;");
  assertEquals(
    lexed.tokens.map((token) => token.name).join(" "),
    "LetToken Space Ident Space Eq Space Int Semi EOF",
  );
  assertEquals(lexed.diagnostics.length, 0);

  const validated = runtime.parse("let x = 1;");
  assertEquals(validated.ok, true);
  assertEquals(validated.diagnostics.length, 0);
  assertEquals(runtime.validateParse("let x = 1;").ok, true);

  const cst = runtime.parse("let x = 1;", { mode: "cst" });
  assertEquals(cst.ok, true);
  assert(cst.cst);
  assertIncludes(debugGrammarCst(cst.cst), "LetToken");

  const ast = runtime.parse("let x = 1;", { mode: "ast" });
  assertEquals(ast.ok, true);
  assert(ast.ast);
  assertEquals((ast.ast as { kind: string }).kind, "Module");

  const checkedTokens = runtime.parseTokens("let x = 1;", lexed.tokens);
  assertEquals(checkedTokens.ok, true);
  const uncheckedTokens = runtime.parseTokensUnchecked(
    "let x = 1;",
    lexed.tokens,
  );
  assertEquals(uncheckedTokens.ok, true);
});

Deno.test("grammar runtime exposes diagnostics source maps and incremental parser", () => {
  const runtime = createGrammarRuntime(portablePlan());

  const invalid = runtime.parse("let x = ;");
  assertEquals(invalid.ok, false);
  assertEquals(
    invalid.diagnostics[0].code,
    "GRAMMAR_PARSE_UNEXPECTED_TOKEN",
  );

  const diagnostics = runtime.diagnostics("let x = ;");
  assertEquals(diagnostics.length > 0, true);
  assertEquals(diagnostics[0].code, "GRAMMAR_PARSE_RECOVERY");

  const sourceMap = runtime.sourceMap("a\nlet x = 1;");
  const position = sourceMap.positionAt(2);
  assertEquals(position.line, 1);
  assertEquals(position.column, 0);

  const incremental = runtime.createIncrementalParser();
  const initial = incremental.parseInitial("let x = 1;");
  const next = incremental.applyEdits(initial, [{
    start: 8,
    oldEnd: 9,
    newText: "2",
  }]);
  assertEquals(next.source, "let x = 2;");
});

function portablePlan(): GrammarPortablePlan {
  const parsed = parseGrammar(`
    grammar Runtime

    token LetToken = "let" ;
    token Ident = /[a-km-z]+/ ;
    token Int = /[0-9]+/ ;
    token Eq = "=" ;
    token Semi = ";" ;
    skip Space channel trivia = /[ ]+/ ;

    module = items:item+ -> Module(items) ;
    item = LetToken name:Ident Eq value:expr Semi -> Let(name, value) ;
    expr = Int -> IntLit(Int) | Ident -> Var(Ident) ;
  `);
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);
  const analyzed = analyzeGrammar(parsed.grammar);
  const blocking = analyzed.diagnostics.filter((diagnostic) =>
    diagnostic.code !== "GRAMMAR_TOKEN_OVERLAP"
  );
  assertEquals(blocking.map((diagnostic) => diagnostic.code).join(","), "");
  const built = buildGrammarPortablePlan(analyzed);
  assertEquals(built.diagnostics.length, 0);
  assert(built.plan);
  return built.plan;
}
