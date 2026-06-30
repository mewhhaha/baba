import {
  analyzeGrammar,
  assert,
  assertEquals,
  buildGrammarParserCorePlan,
  parseGrammar,
  recoverGrammarParse,
} from "./helpers.ts";

Deno.test("grammar recovery diagnostics carry expected actual and action", () => {
  const plan = diagnosticsPlan();
  const recovered = recoverGrammarParse(plan, "a c");

  assertEquals(recovered.ok, true);
  assertEquals(recovered.diagnostics.length, 1);
  const diagnostic = recovered.diagnostics[0];
  assertEquals(diagnostic.code, "GRAMMAR_PARSE_RECOVERY");
  assertEquals(diagnostic.actual, "C");
  assertEquals(diagnostic.expected.join(","), "B");
  assertEquals(diagnostic.recoveryAction.kind, "insert");
  if (diagnostic.recoveryAction.kind === "insert") {
    assertEquals(diagnostic.recoveryAction.token, "B");
  }
  assert(diagnostic.message.includes("Inserted missing token 'B'"));
});

Deno.test("grammar recovery stops after the configured bound", () => {
  const plan = diagnosticsPlan();
  const recovered = recoverGrammarParse(plan, "c c c", 0);

  assertEquals(recovered.ok, false);
  assertEquals(recovered.recoveryCount, 0);
  assertEquals(recovered.diagnostics.length, 1);
  assertEquals(recovered.diagnostics[0].recoveryAction.kind, "abort");
});

function diagnosticsPlan() {
  const parsed = parseGrammar(`
    grammar RecoveryDiagnostics

    token A = "a" ;
    token B = "b" ;
    token C = "c" ;
    skip Space channel trivia = /[ ]+/ ;

    start = A B C ;
  `);
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);
  const analyzed = analyzeGrammar(parsed.grammar);
  assertEquals(analyzed.diagnostics.length, 0);
  const plan = buildGrammarParserCorePlan(analyzed);
  assertEquals(plan.diagnostics.length, 0);
  return plan;
}
