import {
  analyzeGrammarV2,
  assert,
  assertEquals,
  buildGrammarV2ParserCorePlan,
  parseGrammarV2,
  recoverGrammarV2Parse,
} from "./helpers.ts";

Deno.test("grammar v2 recovery diagnostics carry expected actual and action", () => {
  const plan = diagnosticsPlan();
  const recovered = recoverGrammarV2Parse(plan, "a c");

  assertEquals(recovered.ok, true);
  assertEquals(recovered.diagnostics.length, 1);
  const diagnostic = recovered.diagnostics[0];
  assertEquals(diagnostic.code, "GRAMMAR_V2_PARSE_RECOVERY");
  assertEquals(diagnostic.actual, "C");
  assertEquals(diagnostic.expected.join(","), "B");
  assertEquals(diagnostic.recoveryAction.kind, "insert");
  if (diagnostic.recoveryAction.kind === "insert") {
    assertEquals(diagnostic.recoveryAction.token, "B");
  }
  assert(diagnostic.message.includes("Inserted missing token 'B'"));
});

Deno.test("grammar v2 recovery stops after the configured bound", () => {
  const plan = diagnosticsPlan();
  const recovered = recoverGrammarV2Parse(plan, "c c c", 0);

  assertEquals(recovered.ok, false);
  assertEquals(recovered.recoveryCount, 0);
  assertEquals(recovered.diagnostics.length, 1);
  assertEquals(recovered.diagnostics[0].recoveryAction.kind, "abort");
});

function diagnosticsPlan() {
  const parsed = parseGrammarV2(`
    grammar RecoveryDiagnostics

    token A = "a" ;
    token B = "b" ;
    token C = "c" ;
    skip Space channel trivia = /[ ]+/ ;

    start = A B C ;
  `);
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);
  const analyzed = analyzeGrammarV2(parsed.grammar);
  assertEquals(analyzed.diagnostics.length, 0);
  const plan = buildGrammarV2ParserCorePlan(analyzed);
  assertEquals(plan.diagnostics.length, 0);
  return plan;
}
