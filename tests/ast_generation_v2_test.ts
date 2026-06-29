import {
  analyzeGrammarV2,
  assert,
  assertEquals,
  buildGrammarV2AstSchema,
  emitGrammarV2AstTypes,
  parseGrammarV2,
} from "./helpers.ts";
import type { AnalyzedGrammarV2 } from "../src/mod.ts";

Deno.test("grammar v2 AST schema infers constructors fields and cardinality", () => {
  const analyzed = analyzedGrammar(`
    grammar AstGen

    token Ident = /[a-z]+/ ;
    token Int = /[0-9]+/ ;
    token Let = "let" ;
    token Fn = "fn" ;
    token LParen = "(" ;
    token RParen = ")" ;
    token Eq = "=" ;
    token Semi = ";" ;
    skip Space channel trivia = /[ ]+/ ;

    module = items:item* EOF -> Module(items) ;
    item =
      Let name:Ident Eq value:expr Semi -> Let(name, value)
      | Fn name:Ident LParen params:param_list? RParen -> Fn(name, params)
      ;
    param_list = values:Ident+ -> Params(values) ;
    expr = Int -> IntLit(Int) | Ident -> Var(Ident) ;
  `);

  const schema = buildGrammarV2AstSchema(analyzed);

  assertEquals(schema.diagnostics.length, 0);
  assertEquals(
    JSON.stringify(
      schema.constructors.map((constructor) => ({
        name: constructor.name,
        fields: constructor.fields.map((field) =>
          `${field.name}:${field.cardinality}:${field.valueType}`
        ),
      })),
      null,
      2,
    ),
    `[
  {
    "name": "Module",
    "fields": [
      "items:many:Let | Fn"
    ]
  },
  {
    "name": "Let",
    "fields": [
      "name:one:TokenText<\\"Ident\\">",
      "value:one:IntLit | Var"
    ]
  },
  {
    "name": "Fn",
    "fields": [
      "name:one:TokenText<\\"Ident\\">",
      "params:optional:Params"
    ]
  },
  {
    "name": "Params",
    "fields": [
      "values:nonempty:TokenText<\\"Ident\\">"
    ]
  },
  {
    "name": "IntLit",
    "fields": [
      "Int:one:TokenText<\\"Int\\">"
    ]
  },
  {
    "name": "Var",
    "fields": [
      "Ident:one:TokenText<\\"Ident\\">"
    ]
  }
]`,
  );

  const emitted = emitGrammarV2AstTypes(schema);
  assert(emitted.includes("export type AstNode = Module | Let | Fn"));
  assert(emitted.includes("readonly items: readonly (Let | Fn)[]"));
  assert(emitted.includes("readonly params: Params | undefined"));
  assert(emitted.includes('readonly values: readonly TokenText<"Ident">[]'));
});

Deno.test("grammar v2 AST schema reports incompatible constructor cardinality", () => {
  const analyzed = analyzedGrammar(`
    grammar AstBadCardinality

    token Ident = /[a-z]+/ ;

    start = (value:Ident | value:Ident*) -> MaybeMany(value) ;
  `);

  const schema = buildGrammarV2AstSchema(analyzed);

  assertEquals(
    schema.diagnostics.map((diagnostic) => diagnostic.code).join(","),
    "AST_FIELD_CARDINALITY_CONFLICT",
  );
});

function analyzedGrammar(source: string): AnalyzedGrammarV2 {
  const parsed = parseGrammarV2(source);
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);
  const analyzed = analyzeGrammarV2(parsed.grammar);
  const blockingDiagnostics = analyzed.diagnostics.filter((diagnostic) => {
    if (diagnostic.code === "GRAMMAR_V2_TOKEN_OVERLAP") {
      return false;
    }
    if (diagnostic.code === "GRAMMAR_V2_TOKEN_SHADOWED") {
      return false;
    }
    if (diagnostic.code === "GRAMMAR_V2_UNUSED_TOKEN") {
      return false;
    }
    if (diagnostic.code === "GRAMMAR_V2_EMPTY_ONLY_RULE") {
      return false;
    }
    return true;
  });
  assertEquals(
    blockingDiagnostics.map((diagnostic) => diagnostic.code).join(","),
    "",
  );
  return analyzed;
}
