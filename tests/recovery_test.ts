import {
  analyzeGrammar,
  assert,
  assertEquals,
  buildGrammarParserCorePlan,
  parseGrammar,
  recoverGrammarParse,
} from "./helpers.ts";
import type { GrammarParserCorePlan } from "./helpers.ts";

Deno.test("grammar recovery inserts a missing token", () => {
  const plan = recoveryPlan();
  const recovered = recoverGrammarParse(plan, "let x 1;");

  assertEquals(recovered.ok, true);
  assertEquals(recovered.recoveryCount, 1);
  assertEquals(
    recovered.diagnostics.map((diagnostic) =>
      recoveryActionText(diagnostic.recoveryAction)
    ).join(","),
    "insert:Eq",
  );
});

Deno.test("grammar recovery deletes an unexpected token", () => {
  const plan = recoveryPlan();
  const recovered = recoverGrammarParse(plan, "let x = = 1;");

  assertEquals(recovered.ok, true);
  assertEquals(recovered.recoveryCount, 1);
  assertEquals(
    recovered.diagnostics.map((diagnostic) =>
      `${diagnostic.recoveryAction.kind}:${diagnostic.actual}`
    ).join(","),
    "delete:Eq",
  );
});

function recoveryPlan(): GrammarParserCorePlan {
  const parsed = parseGrammar(`
    grammar Recovery

    token Let = "let" ;
    token Ident = /[a-z]+/ ;
    token Int = /[0-9]+/ ;
    token Eq = "=" ;
    token Semi = ";" ;
    skip Space channel trivia = /[ ]+/ ;

    module = stmt+ ;
    stmt sync = Semi | EOF ;
    stmt = Let Ident Eq Int Semi ;
  `);
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);
  const analyzed = analyzeGrammar(parsed.grammar);
  const blockingDiagnostics = analyzed.diagnostics.filter((diagnostic) => {
    if (diagnostic.code === "GRAMMAR_TOKEN_OVERLAP") {
      return false;
    }
    if (diagnostic.code === "GRAMMAR_TOKEN_SHADOWED") {
      return false;
    }
    return true;
  });
  assertEquals(
    blockingDiagnostics.map((diagnostic) => diagnostic.code).join(","),
    "",
  );
  const plan = buildGrammarParserCorePlan(analyzed);
  assert(plan.diagnostics.length === 0);
  return plan;
}

function recoveryActionText(
  action:
    | { readonly kind: "insert"; readonly token: string }
    | { readonly kind: "delete"; readonly token: string }
    | { readonly kind: "abort" },
): string {
  if (action.kind === "abort") {
    return "abort";
  }
  return `${action.kind}:${action.token}`;
}
