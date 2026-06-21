import { analyzeGrammar } from "../src/compiler/analyze.ts";
import { planRuntimeParserTarget } from "../src/targets/runtime/plan.ts";
import { assert, assertEquals, parseGrammar } from "./helpers.ts";

Deno.test("runtime planner exposes a versioned portable parser plan", () => {
  const grammar = parseGrammar(`
    token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
    skip WS = /[ \\t\\r\\n]+/ ;
    module = name:IDENT "." ;
  `);
  const analyzed = analyzeGrammar(grammar, { name: "portable_fixture" });
  assertEquals(analyzed.diagnostics.length, 0);

  const planned = planRuntimeParserTarget(
    analyzed,
    {},
    {},
    "warn",
    { backend: "test", codePrefix: "TEST", label: "test" },
  );
  assert("portable" in planned);

  const plan = planned.portable;
  const metadata = planned.portableMetadata;
  assertEquals(plan.format, "baba-parser-plan");
  assertEquals(plan.version, 1);
  assertEquals(plan.semantics, "baba-portable-v1");
  assertEquals(metadata.format, plan.format);
  assertEquals(metadata.version, plan.version);
  assertEquals(metadata.semantics, plan.semantics);
  assert(metadata.hash.startsWith("fnv1a64:"));
  assertEquals(metadata.hash.length, "fnv1a64:".length + 16);
  assertEquals(plan.symbols.grammarName, "portable_fixture");
  assertEquals(plan.symbols.rootRuleName, "module");
  assertEquals(plan.lexer.startState, 0);
  assertEquals(plan.lexer.specifications.length, 3);
  assert(plan.lexer.states.some((state) => state.accepts.length > 0));
  assert(plan.parser.actions.length > 0);
  assert(plan.parser.gotos.length > 0);
  assertEquals(plan.parser.productions[0].reducer.kind, "start");
  assertEquals(plan.cst.rootNodeType, "ModuleNode");
  assertEquals(plan.cst.rules[0].fields[0].name, "name");
});
