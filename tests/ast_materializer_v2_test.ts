import {
  analyzeGrammarV2,
  assert,
  assertEquals,
  buildGrammarV2AstSchema,
  buildGrammarV2LexerPlan,
  materializeGrammarV2Ast,
  parseGrammarV2,
} from "./helpers.ts";
import type {
  AnalyzedGrammarV2,
  GrammarV2AstNode,
  GrammarV2AstValue,
} from "./helpers.ts";

Deno.test("grammar v2 AST materializer builds clean nodes from annotations", () => {
  const analyzed = astGrammar();
  const lexer = buildGrammarV2LexerPlan(analyzed);
  const result = materializeGrammarV2Ast(
    analyzed,
    lexer,
    "let x = 1; let y = x;",
  );

  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.acceptedTokens, 11);
  assertAstNode(result.ast);
  assertEquals(
    JSON.stringify(publicAst(result.ast), null, 2),
    `{
  "kind": "Module",
  "span": "0..21",
  "fields": {
    "items": [
      {
        "kind": "Let",
        "span": "0..10",
        "fields": {
          "name": "x",
          "value": {
            "kind": "IntLit",
            "span": "8..9",
            "fields": {
              "Int": "1"
            }
          }
        }
      },
      {
        "kind": "Let",
        "span": "11..21",
        "fields": {
          "name": "y",
          "value": {
            "kind": "Var",
            "span": "19..20",
            "fields": {
              "Ident": "x"
            }
          }
        }
      }
    ]
  }
}`,
  );
});

Deno.test("grammar v2 AST materializer returns invalid placeholder for broken input", () => {
  const analyzed = astGrammar();
  const schema = buildGrammarV2AstSchema(analyzed);
  assertEquals(schema.diagnostics.length, 0);
  const lexer = buildGrammarV2LexerPlan(analyzed);
  const result = materializeGrammarV2Ast(analyzed, lexer, "let x = ;");

  assert(!isAstArray(result.ast));
  assert(result.ast !== undefined);
  assertEquals(result.ast.kind, "Invalid");
  assertEquals(
    result.diagnostics.map((diagnostic) => diagnostic.code).join(","),
    "AST_MATERIALIZE_UNEXPECTED_TOKEN",
  );
});

function astGrammar(): AnalyzedGrammarV2 {
  const parsed = parseGrammarV2(`
    grammar AstMat

    token LetToken = "let" ;
    token Ident = /[a-z]+/ ;
    token Int = /[0-9]+/ ;
    token Eq = "=" ;
    token Semi = ";" ;
    skip Space channel trivia = /[ ]+/ ;

    module = items:item* EOF -> Module(items) ;
    item = LetToken name:Ident Eq value:expr Semi -> Let(name, value) ;
    expr = Int -> IntLit(Int) | Ident -> Var(Ident) ;
  `);
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);
  const analyzed = analyzeGrammarV2(parsed.grammar);
  const blockingDiagnostics = analyzed.diagnostics.filter((diagnostic) => {
    if (diagnostic.code === "GRAMMAR_V2_TOKEN_OVERLAP") {
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

function assertAstNode(
  value: GrammarV2AstValue,
): asserts value is GrammarV2AstNode {
  assert(value !== undefined);
  assert(!isAstArray(value));
  assert(!("text" in value));
  assert(!("message" in value));
}

function publicAst(value: GrammarV2AstValue): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (isAstArray(value)) {
    return value.map((item) => publicAst(item));
  }
  if ("text" in value) {
    return value.text;
  }
  if ("message" in value) {
    return { kind: "Invalid", message: value.message };
  }
  const fields: Record<string, unknown> = {};
  for (
    const [name, fieldValue] of Object.entries(value.fields) as Array<
      [string, GrammarV2AstValue]
    >
  ) {
    fields[name] = publicAst(fieldValue);
  }
  return {
    kind: value.kind,
    span: `${value.span.start}..${value.span.end}`,
    fields,
  };
}

function isAstArray(
  value: GrammarV2AstValue,
): value is readonly GrammarV2AstValue[] {
  return Array.isArray(value);
}
