import { analyzeGrammar } from "../src/compiler/analyze.ts";
import { buildPortableParserPlan } from "../src/compiler/portable_plan/build.ts";
import {
  portablePlanToBnf,
  portablePlanToDfa,
  portablePlanToLrTable,
} from "../src/compiler/portable_plan/adapters.ts";
import {
  parsePortableParserPlanJson,
  serializePortableParserPlanJson,
} from "../src/compiler/portable_plan/serialize_json.ts";
import { portablePlanStatistics } from "../src/compiler/portable_plan/statistics.ts";
import { validatePortableParserPlan } from "../src/compiler/portable_plan/validate.ts";
import type { PortableParserPlanV1 } from "../src/compiler/portable_plan/plan.ts";
import {
  assert,
  assertEquals,
  assertIncludes,
  parseGrammar,
} from "./helpers.ts";

function portablePlanFor(source: string): PortableParserPlanV1 {
  const grammar = parseGrammar(source);
  const analyzed = analyzeGrammar(grammar, { name: "portable_fixture" });
  assertEquals(analyzed.diagnostics.length, 0);
  const result = buildPortableParserPlan(analyzed);
  assertEquals(result.diagnostics.length, 0);
  assert(result.runtime);
  return result.runtime.portable;
}

function portableFixturePlan(): PortableParserPlanV1 {
  return portablePlanFor(`
    token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
    token INTEGER = /[0-9]+/ ;
    skip WS = /[ \\t\\r\\n]+/ ;
    module = item+ ;
    item = name:IDENT value:INTEGER? "." ;
  `);
}

Deno.test("portable parser plan serializes deterministically and round-trips", () => {
  const first = portableFixturePlan();
  const second = portableFixturePlan();

  const firstJson = serializePortableParserPlanJson(first);
  const secondJson = serializePortableParserPlanJson(second);
  assertEquals(firstJson, secondJson);
  assertIncludes(firstJson, '"format": "baba-parser-plan"');
  assertIncludes(firstJson, '"stableId": "p_');
  assertIncludes(firstJson, '"reducers": [');
  assertIncludes(firstJson, '"diagnostics": {');
  assert(
    first.parser.productions.every((production) =>
      /^p_[0-9a-f]{16}$/.test(production.stableId)
    ),
  );

  const parsed = parsePortableParserPlanJson(firstJson);
  assert("format" in parsed);
  assertEquals(parsed.format, "baba-parser-plan");
  assertEquals(serializePortableParserPlanJson(parsed), firstJson);
  assertEquals(validatePortableParserPlan(parsed).length, 0);
});

Deno.test("portable parser plan production stable IDs are structural", () => {
  const left = portablePlanFor(`
    token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
    skip WS = /[ \\t\\r\\n]+/ ;

    module = item+ ;
    item = IDENT "." ;
  `);
  const reformatted = portablePlanFor(`
    // Comments and formatting do not affect production identity.
    token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
    skip WS = /[ \\t\\r\\n]+/ ;
    module=item+;
    item = IDENT
      "." ;
  `);
  const changed = portablePlanFor(`
    token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
    skip WS = /[ \\t\\r\\n]+/ ;

    module = item+ ;
    item = IDENT "," ;
  `);

  const stableIds = (plan: PortableParserPlanV1) =>
    plan.parser.productions.map((production) => production.stableId).join(",");
  assertEquals(stableIds(reformatted), stableIds(left));
  assert(stableIds(changed) !== stableIds(left));
});

Deno.test("portable parser plan exposes stable runtime statistics", () => {
  const plan = portableFixturePlan();
  const statistics = portablePlanStatistics(plan);

  assertEquals(JSON.stringify(plan.statistics), JSON.stringify(statistics));
  assertEquals(statistics.lexerStates, plan.lexer.states.length);
  assertEquals(
    statistics.lexerAcceptCandidates,
    plan.lexer.states.reduce((sum, state) => sum + state.accepts.length, 0),
  );
  assertEquals(
    statistics.lexerAverageAcceptCandidatesPerStateMilli,
    Math.round(
      statistics.lexerAcceptCandidates * 1000 / plan.lexer.states.length,
    ),
  );
  assertEquals(
    statistics.lexerMaxAcceptCandidatesPerState,
    Math.max(...plan.lexer.states.map((state) => state.accepts.length)),
  );
  assertEquals(
    statistics.lexerAmbiguousAcceptStates,
    plan.lexer.states.filter((state) => state.accepts.length > 1).length,
  );
  assertEquals(statistics.bnfProductions, plan.parser.productions.length);
  assertEquals(statistics.lrStates, plan.parser.states.length);
  assertEquals(statistics.reducerCount, plan.reducers.length);
  assertEquals(statistics.fieldCount, plan.symbols.fields.length);
  assert(statistics.serializedJsonBytes > 0);
});

Deno.test("portable parser plan adapters preserve runtime table data", () => {
  const plan = portableFixturePlan();
  const bnf = portablePlanToBnf(plan);
  const lr = portablePlanToLrTable(plan);
  const dfa = portablePlanToDfa(plan);

  assertEquals(bnf.productions.length, plan.parser.productions.length);
  assertEquals(bnf.terminals.length, plan.symbols.terminals.length);
  assertEquals(lr.states.length, plan.parser.states.length);
  assertEquals(lr.stats.tableEntries, plan.parser.statistics.tableEntries);
  assertEquals(dfa.states.length, plan.lexer.states.length);
  assertEquals(
    dfa.states.map((state) => state.selectedAccept ?? -1).join(","),
    plan.lexer.states.map((state) => state.selectedAccept ?? -1).join(","),
  );
  assertEquals(
    [...lr.actions.entries()].flatMap(([state, row]) =>
      [...row.entries()].map(([terminal, actions]) =>
        `${state}:${terminal}:${actions.map((action) => action.kind).join("/")}`
      )
    ).join(","),
    plan.parser.actions.flatMap((row) =>
      row.entries.map((entry) =>
        `${row.state}:${entry.terminal}:${
          entry.actions.map((action) => action.kind).join("/")
        }`
      )
    ).join(","),
  );
});

Deno.test("portable parser plan validation reports malformed untrusted plans", () => {
  const plan = portableFixturePlan();
  const cases: Array<[string, (plan: any) => void, string]> = [
    ["wrong format", (copy) => copy.format = "other", "$.format"],
    ["wrong version", (copy) => copy.version = 2, "$.version"],
    ["bad top-level root rule", (copy) => copy.rootRule = 999, "$.rootRule"],
    [
      "bad symbol root rule",
      (copy) => copy.symbols.rootRule = 999,
      "$.symbols.rootRule",
    ],
    [
      "duplicate token id",
      (copy) => copy.symbols.tokens[1].id = copy.symbols.tokens[0].id,
      "$.symbols.tokens[1].id",
    ],
    [
      "bad lexer start state",
      (copy) => copy.lexer.startState = 999,
      "$.lexer.startState",
    ],
    [
      "bad lexer specification terminal",
      (copy) => {
        const spec = copy.lexer.specifications.find((
          entry: { terminalId?: number | null },
        ) => entry.terminalId !== null);
        spec.terminalId = 999;
      },
      ".terminalId",
    ],
    [
      "bad lexer transition target",
      (copy) => copy.lexer.states[0].transitions[0].target = 999,
      "$.lexer.states[0].transitions[0].target",
    ],
    [
      "overlapping lexer transitions",
      (copy) => {
        copy.lexer.states[0].transitions.unshift({
          ...copy.lexer.states[0].transitions[0],
        });
      },
      "$.lexer.states[0].transitions[1]",
    ],
    [
      "bad lexer transition scalar",
      (copy) => copy.lexer.states[0].transitions[0].start = 0xd800,
      "$.lexer.states[0].transitions[0]",
    ],
    [
      "bad accepting candidate",
      (copy) => copy.lexer.states[0].accepts = [999],
      "$.lexer.states[0].accepts",
    ],
    [
      "bad selected accept",
      (copy) => copy.lexer.states[0].selectedAccept = 999,
      "$.lexer.states[0].selectedAccept",
    ],
    [
      "bad parser start state",
      (copy) => copy.parser.startState = 999,
      "$.parser.startState",
    ],
    [
      "bad start production",
      (copy) => copy.parser.startProduction = 999,
      "$.parser.startProduction",
    ],
    [
      "bad production stable id",
      (copy) => copy.parser.productions[0].stableId = "production-0",
      "$.parser.productions[0].stableId",
    ],
    [
      "duplicate production stable id",
      (copy) => {
        copy.parser.productions[1].stableId =
          copy.parser.productions[0].stableId;
      },
      "$.parser.productions[1].stableId",
    ],
    [
      "bad production rhs terminal",
      (copy) => {
        const production = copy.parser.productions.find((
          entry: { rhs: Array<{ kind: string; id: number }> },
        ) => entry.rhs.some((symbol) => symbol.kind === "terminal"));
        const symbol = production.rhs.find((
          entry: { kind: string; id: number },
        ) => entry.kind === "terminal");
        symbol.id = 999;
      },
      ".rhs",
    ],
    [
      "bad LR action kind",
      (copy) => {
        copy.parser.actions[0].entries[0].actions[0].kind = "explode";
      },
      ".kind",
    ],
    [
      "duplicate LR action row state",
      (copy) => {
        copy.parser.actions.splice(
          1,
          0,
          structuredClone(copy.parser.actions[0]),
        );
      },
      "$.parser.actions[1].state",
    ],
    [
      "unsorted LR action rows",
      (copy) => {
        [copy.parser.actions[0], copy.parser.actions[1]] = [
          copy.parser.actions[1],
          copy.parser.actions[0],
        ];
      },
      "$.parser.actions[1].state",
    ],
    [
      "duplicate LR action entry terminal",
      (copy) => {
        copy.parser.actions[0].entries.splice(
          1,
          0,
          structuredClone(copy.parser.actions[0].entries[0]),
        );
      },
      "$.parser.actions[0].entries[1].terminal",
    ],
    [
      "unsorted LR action entries",
      (copy) => {
        const actions = copy.parser.actions[0].entries[0].actions;
        copy.parser.actions[0].entries = [
          { terminal: 1, actions },
          { terminal: 0, actions },
        ];
      },
      "$.parser.actions[0].entries[1].terminal",
    ],
    [
      "empty LR action entry",
      (copy) => copy.parser.actions[0].entries[0].actions = [],
      "$.parser.actions[0].entries[0].actions",
    ],
    [
      "duplicate LR action",
      (copy) => {
        copy.parser.actions[0].entries[0].actions = [
          { kind: "shift", state: 0 },
          { kind: "shift", state: 0 },
        ];
      },
      "$.parser.actions[0].entries[0].actions[1]",
    ],
    [
      "unsorted LR actions",
      (copy) => {
        copy.parser.actions[0].entries[0].actions = [
          { kind: "reduce", production: 0 },
          { kind: "shift", state: 0 },
        ];
      },
      "$.parser.actions[0].entries[0].actions[1]",
    ],
    [
      "bad LR shift target",
      (copy) => {
        const action = copy.parser.actions
          .flatMap((row: { entries: Array<{ actions: unknown[] }> }) =>
            row.entries
          )
          .flatMap((
            entry: { actions: Array<{ kind: string; state?: number }> },
          ) => entry.actions)
          .find((entry: { kind: string }) => entry.kind === "shift");
        action.state = 999;
      },
      ".state",
    ],
    [
      "bad LR reduce production",
      (copy) => {
        const action = copy.parser.actions
          .flatMap((row: { entries: Array<{ actions: unknown[] }> }) =>
            row.entries
          )
          .flatMap((
            entry: { actions: Array<{ kind: string; production?: number }> },
          ) => entry.actions)
          .find((entry: { kind: string }) => entry.kind === "reduce");
        action.production = 999;
      },
      ".production",
    ],
    [
      "bad goto state",
      (copy) => copy.parser.gotos[0].entries[0].target = 999,
      "$.parser.gotos[0].entries[0].target",
    ],
    [
      "bad expected terminal",
      (copy) => copy.parser.expectedTerminals[0].terminals = [999],
      "$.parser.expectedTerminals[0].terminals",
    ],
    [
      "bad reducer opcode",
      (copy) => copy.reducers[0].op = "unknown",
      "$.reducers[0].op",
    ],
    [
      "bad rule reducer reference",
      (copy) => {
        const reducer = copy.reducers.find((entry: { op: string }) =>
          entry.op === "rule"
        );
        reducer.ruleId = 999;
      },
      ".ruleId",
    ],
    [
      "bad field reducer reference",
      (copy) => {
        const reducer = copy.reducers.find((entry: { op: string }) =>
          entry.op === "field"
        );
        reducer.fieldId = 999;
      },
      ".fieldId",
    ],
    [
      "bad CST cardinality",
      (copy) => {
        const rule = copy.cst.rules.find((entry: { fields: unknown[] }) =>
          entry.fields.length > 0
        );
        rule.fields[0].cardinality = "sometimes";
      },
      ".cardinality",
    ],
    [
      "unsafe integer",
      (copy) => copy.parser.productions[0].lhs = Number.MAX_SAFE_INTEGER + 1,
      "$.parser.productions[0].lhs",
    ],
  ];

  for (const [name, mutate, expectedPath] of cases) {
    const copy = structuredClone(plan) as any;
    mutate(copy);
    const diagnostics = validatePortableParserPlan(copy);
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

Deno.test("portable parser plan JSON parser validates before returning a plan", () => {
  const parsed = parsePortableParserPlanJson('{"format":"wrong"}');

  assert(!("format" in parsed));
  assertEquals(parsed.diagnostics[0].code, "PORTABLE_PLAN_INVALID");
});
