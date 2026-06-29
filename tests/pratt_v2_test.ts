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
import type {
  AnalyzedGrammarV2,
  GrammarV2PrattNode,
  GrammarV2PrattPlan,
} from "../src/mod.ts";

Deno.test("grammar v2 Pratt parser applies declared precedence", () => {
  const { analyzed, plan, tokens, candidateSites } = prattFixture("a + b * c");
  const parsed = parseGrammarV2PrattExpression(analyzed, plan, tokens, {
    candidateSites,
  });

  assertEquals(parsed.ok, true);
  assert(parsed.node);
  assertEquals(parsed.nextToken, 5);
  assertEquals(formatPrattNode(parsed.node), "(+ a (* b c))");
});

Deno.test("grammar v2 Pratt parser applies right associativity", () => {
  const { analyzed, plan, tokens, candidateSites } = prattFixture("a = b = c");
  const parsed = parseGrammarV2PrattExpression(analyzed, plan, tokens, {
    candidateSites,
  });

  assertEquals(parsed.ok, true);
  assert(parsed.node);
  assertEquals(formatPrattNode(parsed.node), "(= a (= b c))");
});

Deno.test("grammar v2 Pratt parser composes prefix and postfix operators", () => {
  const { analyzed, plan, tokens, candidateSites } = prattFixture("-a?");
  const parsed = parseGrammarV2PrattExpression(analyzed, plan, tokens, {
    candidateSites,
  });

  assertEquals(parsed.ok, true);
  assert(parsed.node);
  assertEquals(formatPrattNode(parsed.node), "(- (? a))");
});

Deno.test("grammar v2 Pratt parser rejects non-associative chains", () => {
  const { analyzed, plan, tokens, candidateSites } = prattFixture(
    "a .. b .. c",
  );
  const parsed = parseGrammarV2PrattExpression(analyzed, plan, tokens, {
    candidateSites,
  });

  assertEquals(parsed.ok, false);
  assertEquals(
    parsed.diagnostics.map((diagnostic) => diagnostic.code).join(","),
    "GRAMMAR_V2_PRATT_NON_ASSOC_CHAIN",
  );
});

Deno.test("grammar v2 Pratt parser reports expected operands", () => {
  const { analyzed, plan, tokens, candidateSites } = prattFixture("+ a");
  const parsed = parseGrammarV2PrattExpression(analyzed, plan, tokens, {
    candidateSites,
  });

  assertEquals(parsed.ok, false);
  assertEquals(
    parsed.diagnostics.map((diagnostic) => diagnostic.code).join(","),
    "GRAMMAR_V2_PRATT_EXPECTED_OPERAND",
  );
});

function prattFixture(source: string): {
  readonly analyzed: AnalyzedGrammarV2;
  readonly plan: GrammarV2PrattPlan;
  readonly tokens: ReturnType<typeof lexGrammarV2>["tokens"];
  readonly candidateSites: ReturnType<typeof lexGrammarV2>["candidateSites"];
} {
  const parsed = parseGrammarV2(`
    grammar Pratt

    token Ident = /[a-z]+/ ;
    token Plus = "+" ;
    token Star = "*" ;
    token Eq = "=" ;
    token Minus = "-" ;
    token Question = "?" ;
    token Range = ".." ;
    token LParen = "(" ;
    token RParen = ")" ;
    skip Space channel trivia = /[ ]+/ ;

    expr = atom {
      infix right 5 "="
      infix none 7 ".."
      infix left 10 "+"
      infix left 20 "*"
      prefix 30 "-"
      postfix 40 "?"
    }

    atom = Ident | "(" expr ")" ;
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
  const lexed = lexGrammarV2(lexer, source, { preserveTrivia: false });
  assertEquals(lexed.diagnostics.length, 0);
  return {
    analyzed,
    plan,
    tokens: lexed.tokens,
    candidateSites: lexed.candidateSites,
  };
}

function formatPrattNode(node: GrammarV2PrattNode): string {
  if (node.kind === "token") {
    return node.text;
  }
  if (node.kind === "sequence") {
    return node.children.map((child) => formatPrattNode(child)).join(" ");
  }
  if (node.kind === "prefix") {
    return `(${node.operator} ${formatPrattNode(node.operand)})`;
  }
  if (node.kind === "postfix") {
    return `(${node.operator} ${formatPrattNode(node.operand)})`;
  }
  return `(${node.operator} ${formatPrattNode(node.left)} ${
    formatPrattNode(node.right)
  })`;
}
