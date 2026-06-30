import {
  analyzeGrammar,
  buildGrammarPortablePlan,
  type GrammarPortablePlan,
  parseGrammarPortablePlanJson,
  serializeGrammarPortablePlanJson,
  validateGrammarPortablePlan,
} from "./helpers.ts";
import {
  assert,
  assertEquals,
  assertIncludes,
  parseGrammar,
} from "./helpers.ts";

Deno.test("portable plan packages lexer parser CST AST and target metadata", () => {
  const plan = portablePlan();

  assertEquals(plan.format, "baba-portable-plan");
  assertEquals(plan.version, 2);
  assertEquals(plan.grammar.name, "Portable");
  assert(plan.grammar.hash.startsWith("fnv1a64:"));
  assertEquals(
    plan.symbols.tokens.map((token) => token.name).join(","),
    "LetToken,Ident,Int,Eq,Semi,Space",
  );
  assertEquals(plan.lexer.modes[0].name, "default");
  assert(plan.lexer.modes[0].dfa.states.length > 1);
  assertEquals(plan.parser.startRule, "module");
  assert(plan.parser.actions.length > 0);
  assert(plan.parser.gotos.length > 0);
  assert(plan.expressions.pratt.islands.length === 0);
  assert(plan.cst.nodeKinds.some((kind) => kind.name === "module"));
  assert(
    plan.ast.constructors.some((constructor) => constructor.name === "Module"),
  );
  assertEquals(plan.targets.typescript.adapter, "shared-runtime");
  assertEquals(plan.targets.parserKit.artifact, "portable-plan-json");
  assertEquals(plan.targets.wasm.status, "deferred");
  assert(plan.statistics.serializedJsonBytes > 0);
});

Deno.test("portable plan serializes deterministically and validates", () => {
  const first = portablePlan();
  const second = portablePlan();
  const firstJson = serializeGrammarPortablePlanJson(first);
  const secondJson = serializeGrammarPortablePlanJson(second);

  assertEquals(firstJson, secondJson);
  assertIncludes(firstJson, '"format": "baba-portable-plan"');
  assertIncludes(firstJson, '"version": 2');
  assertIncludes(firstJson, '"stableId": "p_');
  assertEquals(validateGrammarPortablePlan(first).length, 0);

  const parsed = parseGrammarPortablePlanJson(firstJson);
  assert("format" in parsed);
  assertEquals(parsed.version, 2);
  assertEquals(serializeGrammarPortablePlanJson(parsed), firstJson);
});

Deno.test("portable plan validation rejects malformed references", () => {
  const plan = portablePlan();
  const cases: Array<[string, (plan: any) => void, string]> = [
    ["wrong format", (copy) => copy.format = "wrong", "$.format"],
    ["wrong version", (copy) => copy.version = 3, "$.version"],
    [
      "non-dense token id",
      (copy) => copy.symbols.tokens[1].id = 5,
      "$.symbols.tokens[1].id",
    ],
    [
      "bad root rule",
      (copy) => copy.grammar.rootRule = 99,
      "$.grammar.rootRule",
    ],
    [
      "bad lexer spec token",
      (copy) => copy.lexer.modes[0].specs[0].tokenId = 99,
      "$.lexer.modes[0].specs[0].tokenId",
    ],
    [
      "bad DFA target",
      (copy) => copy.lexer.modes[0].dfa.states[0].transitions[0].target = 99,
      ".target",
    ],
    [
      "bad parser action state",
      (copy) => {
        const action = copy.parser.actions
          .flatMap((row: { entries: Array<{ actions: unknown[] }> }) =>
            row.entries
          )
          .flatMap((
            entry: { actions: Array<{ kind: string; state?: number }> },
          ) => entry.actions)
          .find((entry: { kind: string }) => entry.kind === "shift");
        action.state = 99;
      },
      ".state",
    ],
    [
      "bad parser production terminal",
      (copy) => {
        const production = copy.parser.productions.find((
          entry: { rhs: Array<{ kind: string; id: number }> },
        ) => entry.rhs.some((symbol) => symbol.kind === "terminal"));
        const symbol = production.rhs.find((
          entry: { kind: string; id: number },
        ) => entry.kind === "terminal");
        symbol.id = 99;
      },
      ".rhs",
    ],
    [
      "unsupported integer",
      (copy) => copy.parser.productions[0].lhs = Number.MAX_SAFE_INTEGER + 1,
      "$.parser.productions[0].lhs",
    ],
  ];

  for (const [name, mutate, expectedPath] of cases) {
    const copy = structuredClone(plan) as any;
    mutate(copy);
    const diagnostics = validateGrammarPortablePlan(copy);
    assert(
      diagnostics.length > 0,
      `Expected ${name} to produce validation diagnostics.`,
    );
    assertIncludes(
      diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
      expectedPath,
    );
  }
});

function portablePlan(): GrammarPortablePlan {
  const parsed = parseGrammar(`
    grammar Portable

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
