import {
  analyzeGrammarV2,
  assert,
  assertEquals,
  parseGrammarV2,
} from "./helpers.ts";
import type { AnalyzedGrammarV2 } from "./helpers.ts";

Deno.test("grammar v2 analysis lowers syntax into stable target-neutral facts", async () => {
  const parsed = parseGrammarV2(
    await Deno.readTextFile("fixtures/grammar-v2/valid/analyzable.grammar"),
  );
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);

  const analyzed = analyzeGrammarV2(parsed.grammar);
  const diagnosticCodes = analyzed.diagnostics.map((diagnostic) =>
    diagnostic.code
  );
  assertEquals(diagnosticCodes.join(","), "");
  assertEquals(
    JSON.stringify(normalizeAnalysis(analyzed), null, 2),
    `{
  "name": "Analyze",
  "rootRule": 0,
  "tokens": [
    "0:token:Ident:0",
    "1:skip:Space:0:trivia"
  ],
  "modes": [
    "0:default"
  ],
  "rules": [
    "0:module:false:true:false",
    "1:item:false:true:false",
    "2:expr:false:true:false",
    "3:atom:false:true:false"
  ],
  "literals": [
    "0:let"
  ],
  "constructors": [
    "0:Module(items)",
    "1:Let(name,value)",
    "2:Name(text)"
  ],
  "fields": [
    "0:items",
    "1:name",
    "2:value"
  ],
  "expressionIslands": [
    "0:2:infix:10"
  ],
  "exports": [],
  "reachableRules": [
    0,
    1,
    2,
    3
  ],
  "reachableTokens": [
    0
  ],
  "reachableLiterals": [
    0
  ]
}`,
  );
});

Deno.test("grammar v2 analysis captures modes layout and extensions", async () => {
  const parsed = parseGrammarV2(
    await Deno.readTextFile(
      "fixtures/grammar-v2/valid/modes-layout-modules.grammar",
    ),
  );
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);

  const analyzed = analyzeGrammarV2(parsed.grammar);
  const diagnosticCodes = analyzed.diagnostics.map((diagnostic) =>
    diagnostic.code
  );
  assertEquals(
    diagnosticCodes.join(","),
    "GRAMMAR_V2_UNREACHABLE_RULE,GRAMMAR_V2_UNUSED_TOKEN,GRAMMAR_V2_UNUSED_TOKEN,GRAMMAR_V2_UNUSED_TOKEN",
  );
  assertEquals(
    analyzed.modes.map((mode) => mode.name).join(","),
    "default,String",
  );
  assertEquals(
    analyzed.modules.map((module) => module.name).join(","),
    "Core.Syntax",
  );
  assertEquals(
    analyzed.exports.map((entry) => entry.name).join(","),
    "Core.Syntax.module",
  );
  assertEquals(analyzed.extensions.length, 1);
  assertEquals(analyzed.extensions[0].target, "item");
  const quote = analyzed.tokens.find((token) => token.name === "Quote");
  assert(quote);
  assert(quote.transition);
  assertEquals(quote.transition.kind, "push");
});

function normalizeAnalysis(analyzed: AnalyzedGrammarV2): unknown {
  return {
    name: analyzed.name,
    rootRule: analyzed.rootRule,
    tokens: analyzed.tokens.map((token) => {
      let output = `${token.id}:${token.kind}:${token.name}:${token.modeId}`;
      if (token.channel !== undefined) {
        output = `${output}:${token.channel}`;
      }
      return output;
    }),
    modes: analyzed.modes.map((mode) => `${mode.id}:${mode.name}`),
    rules: analyzed.rules.map((rule) =>
      `${rule.id}:${rule.name}:${rule.nullable}:${rule.productive}:${
        rule.sync !== undefined
      }`
    ),
    literals: analyzed.literals.map((literal) =>
      `${literal.id}:${literal.value}`
    ),
    constructors: analyzed.constructors.map((constructor) =>
      `${constructor.id}:${constructor.name}(${constructor.fields.join(",")})`
    ),
    fields: analyzed.fields.map((field) => `${field.id}:${field.name}`),
    expressionIslands: analyzed.expressionIslands.map((island) => {
      const operators = island.operators.map((operator) =>
        `${operator.kind}:${operator.precedence}`
      ).join(",");
      return `${island.id}:${island.ruleId}:${operators}`;
    }),
    exports: analyzed.exports.map((entry) => `${entry.id}:${entry.name}`),
    reachableRules: [...analyzed.reachableRules],
    reachableTokens: [...analyzed.reachableTokens],
    reachableLiterals: [...analyzed.reachableLiterals],
  };
}
