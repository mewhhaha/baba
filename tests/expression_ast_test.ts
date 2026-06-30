import {
  analyzeGrammar,
  assert,
  assertEquals,
  buildGrammarLexerPlan,
  buildGrammarPrattPlan,
  lexGrammar,
  parseGrammar,
  parseGrammarPrattExpression,
} from "./helpers.ts";
import type { GrammarPrattNode } from "./helpers.ts";

Deno.test("grammar Pratt nodes expose expression constructor shape", () => {
  const parsed = parseGrammar(`
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
  const analyzed = analyzeGrammar(parsed.grammar);
  const blockingDiagnostics = analyzed.diagnostics.filter((diagnostic) => {
    if (diagnostic.code === "GRAMMAR_UNUSED_TOKEN") {
      return false;
    }
    return true;
  });
  assertEquals(
    blockingDiagnostics.map((diagnostic) => diagnostic.code).join(","),
    "",
  );
  const plan = buildGrammarPrattPlan(analyzed);
  assertEquals(plan.diagnostics.length, 0);
  const lexer = buildGrammarLexerPlan(analyzed);
  const lexed = lexGrammar(lexer, "a + b * c", { preserveTrivia: false });
  assertEquals(lexed.diagnostics.length, 0);

  const parsedExpression = parseGrammarPrattExpression(
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

function publicShape(node: GrammarPrattNode): unknown {
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
