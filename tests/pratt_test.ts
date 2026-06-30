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
import type {
  AnalyzedGrammar,
  GrammarPrattNode,
  GrammarPrattPlan,
} from "./helpers.ts";

Deno.test("grammar Pratt parser applies declared precedence", () => {
  const { analyzed, plan, tokens, candidateSites } = prattFixture("a + b * c");
  const parsed = parseGrammarPrattExpression(analyzed, plan, tokens, {
    candidateSites,
  });

  assertEquals(parsed.ok, true);
  assert(parsed.node);
  assertEquals(parsed.nextToken, 5);
  assertEquals(formatPrattNode(parsed.node), "(+ a (* b c))");
});

Deno.test("grammar Pratt parser applies right associativity", () => {
  const { analyzed, plan, tokens, candidateSites } = prattFixture("a = b = c");
  const parsed = parseGrammarPrattExpression(analyzed, plan, tokens, {
    candidateSites,
  });

  assertEquals(parsed.ok, true);
  assert(parsed.node);
  assertEquals(formatPrattNode(parsed.node), "(= a (= b c))");
});

Deno.test("grammar Pratt parser composes prefix and postfix operators", () => {
  const { analyzed, plan, tokens, candidateSites } = prattFixture("-a?");
  const parsed = parseGrammarPrattExpression(analyzed, plan, tokens, {
    candidateSites,
  });

  assertEquals(parsed.ok, true);
  assert(parsed.node);
  assertEquals(formatPrattNode(parsed.node), "(- (? a))");
});

Deno.test("grammar Pratt parser rejects non-associative chains", () => {
  const { analyzed, plan, tokens, candidateSites } = prattFixture(
    "a .. b .. c",
  );
  const parsed = parseGrammarPrattExpression(analyzed, plan, tokens, {
    candidateSites,
  });

  assertEquals(parsed.ok, false);
  assertEquals(
    parsed.diagnostics.map((diagnostic) => diagnostic.code).join(","),
    "GRAMMAR_PRATT_NON_ASSOC_CHAIN",
  );
});

Deno.test("grammar Pratt parser reports expected operands", () => {
  const { analyzed, plan, tokens, candidateSites } = prattFixture("+ a");
  const parsed = parseGrammarPrattExpression(analyzed, plan, tokens, {
    candidateSites,
  });

  assertEquals(parsed.ok, false);
  assertEquals(
    parsed.diagnostics.map((diagnostic) => diagnostic.code).join(","),
    "GRAMMAR_PRATT_EXPECTED_OPERAND",
  );
});

function prattFixture(source: string): {
  readonly analyzed: AnalyzedGrammar;
  readonly plan: GrammarPrattPlan;
  readonly tokens: ReturnType<typeof lexGrammar>["tokens"];
  readonly candidateSites: ReturnType<typeof lexGrammar>["candidateSites"];
} {
  const parsed = parseGrammar(`
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
  const lexed = lexGrammar(lexer, source, { preserveTrivia: false });
  assertEquals(lexed.diagnostics.length, 0);
  return {
    analyzed,
    plan,
    tokens: lexed.tokens,
    candidateSites: lexed.candidateSites,
  };
}

function formatPrattNode(node: GrammarPrattNode): string {
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
