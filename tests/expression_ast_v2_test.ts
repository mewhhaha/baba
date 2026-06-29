import {
  analyzeGrammarV2,
  assert,
  assertEquals,
  buildGrammarV2LexerPlan,
  buildGrammarV2PrattPlan,
  lexGrammarV2,
  parseGrammarV2,
  parseGrammarV2PrattExpression,
} from "./helpers.ts";
import type { GrammarV2PrattNode } from "../src/mod.ts";

Deno.test("grammar v2 Pratt nodes expose expression constructor shape", () => {
  const parsed = parseGrammarV2(`
    grammar ExprAst

    token Ident = /[a-z]+/ ;
    token Plus = "+" ;
    token Star = "*" ;
    skip Space channel trivia = /[ ]+/ ;

    expr = atom {
      infix left 10 "+"
      infix left 20 "*"
    }

    atom = Ident ;
  `);
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);
  const analyzed = analyzeGrammarV2(parsed.grammar);
  const blockingDiagnostics = analyzed.diagnostics.filter((diagnostic) => {
    if (diagnostic.code === "GRAMMAR_V2_UNUSED_TOKEN") {
      return false;
    }
    return true;
  });
  assertEquals(
    blockingDiagnostics.map((diagnostic) => diagnostic.code).join(","),
    "",
  );
  const plan = buildGrammarV2PrattPlan(analyzed);
  assertEquals(plan.diagnostics.length, 0);
  const lexer = buildGrammarV2LexerPlan(analyzed);
  const lexed = lexGrammarV2(lexer, "a + b * c", { preserveTrivia: false });
  assertEquals(lexed.diagnostics.length, 0);

  const parsedExpression = parseGrammarV2PrattExpression(
    analyzed,
    plan,
    lexed.tokens,
    { candidateSites: lexed.candidateSites },
  );

  assertEquals(parsedExpression.ok, true);
  assert(parsedExpression.node);
  assertEquals(
    JSON.stringify(publicShape(parsedExpression.node), null, 2),
    `{
  "kind": "infix",
  "operator": "+",
  "left": "a",
  "right": {
    "kind": "infix",
    "operator": "*",
    "left": "b",
    "right": "c"
  }
}`,
  );
});

function publicShape(node: GrammarV2PrattNode): unknown {
  if (node.kind === "token") {
    return node.text;
  }
  if (node.kind === "sequence") {
    return node.children.map((child) => publicShape(child));
  }
  if (node.kind === "prefix") {
    return {
      kind: "prefix",
      operator: node.operator,
      operand: publicShape(node.operand),
    };
  }
  if (node.kind === "postfix") {
    return {
      kind: "postfix",
      operator: node.operator,
      operand: publicShape(node.operand),
    };
  }
  return {
    kind: "infix",
    operator: node.operator,
    left: publicShape(node.left),
    right: publicShape(node.right),
  };
}
