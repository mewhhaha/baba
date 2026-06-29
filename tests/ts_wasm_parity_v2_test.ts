import {
  analyzeGrammarV2,
  buildGrammarV2PortablePlan,
  createGrammarV2Runtime,
  type GrammarV2PortablePlan,
} from "./helpers.ts";
import { assert, assertEquals, parseGrammarV2 } from "./helpers.ts";

Deno.test("grammar v2 TypeScript runtime records explicit Wasm parity status", () => {
  const plan = portablePlan();
  const runtime = createGrammarV2Runtime(plan);
  const typescript = normalize(runtime.parse("let x = 1;"));

  assertEquals(typescript.ok, true);
  assertEquals(plan.targets.wasm.status, "deferred");
  assertEquals(runtime.wasmStatus().status, "deferred");
  assert(
    runtime.wasmStatus().reason.includes("portable parser plan v1"),
  );
});

function normalize(
  result: ReturnType<ReturnType<typeof createGrammarV2Runtime>["parse"]>,
): { readonly ok: boolean; readonly diagnostics: readonly string[] } {
  return {
    ok: result.ok,
    diagnostics: result.diagnostics.map((diagnostic) => diagnostic.code),
  };
}

function portablePlan(): GrammarV2PortablePlan {
  const parsed = parseGrammarV2(`
    grammar ParityV2

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
  const analyzed = analyzeGrammarV2(parsed.grammar);
  const blocking = analyzed.diagnostics.filter((diagnostic) =>
    diagnostic.code !== "GRAMMAR_V2_TOKEN_OVERLAP"
  );
  assertEquals(blocking.map((diagnostic) => diagnostic.code).join(","), "");
  const built = buildGrammarV2PortablePlan(analyzed);
  assertEquals(built.diagnostics.length, 0);
  assert(built.plan);
  return built.plan;
}
