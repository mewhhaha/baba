import {
  analyzeGrammar,
  buildGrammarPortablePlan,
  createGrammarRuntime,
  type GrammarPortablePlan,
} from "./helpers.ts";
import { assert, assertEquals, parseGrammar } from "./helpers.ts";

Deno.test("grammar TypeScript runtime records explicit Wasm parity status", () => {
  const plan = portablePlan();
  const runtime = createGrammarRuntime(plan);
  const typescript = normalize(runtime.parse("let x = 1;"));

  assertEquals(typescript.ok, true);
  assertEquals(plan.targets.wasm.status, "deferred");
  assertEquals(runtime.wasmStatus().status, "deferred");
  assert(
    runtime.wasmStatus().reason.includes(
      "does not execute this portable grammar plan yet",
    ),
  );
});

function normalize(
  result: ReturnType<ReturnType<typeof createGrammarRuntime>["parse"]>,
): { readonly ok: boolean; readonly diagnostics: readonly string[] } {
  return {
    ok: result.ok,
    diagnostics: result.diagnostics.map((diagnostic) => diagnostic.code),
  };
}

function portablePlan(): GrammarPortablePlan {
  const parsed = parseGrammar(`
    grammar Parity

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
