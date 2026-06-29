import {
  assert,
  assertEquals,
  assertIncludes,
  parseGrammarV2,
} from "./helpers.ts";
import type { Diagnostic, GrammarV2Document } from "../src/mod.ts";

Deno.test("grammar v2 parser accepts the task syntax example", async () => {
  const source = await Deno.readTextFile(
    "fixtures/grammar-v2/valid/core.grammar",
  );
  const result = parseGrammarV2(source);

  assertEquals(result.diagnostics.length, 0);
  assert(result.grammar);
  assertEquals(result.grammar.name, "Core");

  const declarations = result.grammar.declarations;
  assertEquals(declarations.length, 11);
  const skipDecl = declarations.find((declaration) =>
    declaration.kind === "skip"
  );
  assert(skipDecl);
  assert(skipDecl.kind === "skip");
  assertEquals(skipDecl.channel, "trivia");

  const moduleRule = declarations.find((declaration) =>
    declaration.kind === "rule" && declaration.name === "module"
  );
  assert(moduleRule);
  assert(moduleRule.kind === "rule");
  assertEquals(moduleRule.expression.kind, "constructor");
  if (moduleRule.expression.kind === "constructor") {
    assertEquals(moduleRule.expression.name, "Module");
    assertEquals(moduleRule.expression.arguments.join(","), "items");
  }

  const exprRule = declarations.find((declaration) =>
    declaration.kind === "rule" && declaration.name === "expr"
  );
  assert(exprRule);
  assert(exprRule.kind === "rule");
  assertEquals(exprRule.expression.kind, "expressionIsland");
  if (exprRule.expression.kind === "expressionIsland") {
    assertEquals(exprRule.expression.operators.length, 4);
    assertEquals(exprRule.expression.operators[0].kind, "infix");
    assertEquals(exprRule.expression.operators[0].associativity, "left");
    assertEquals(exprRule.expression.operators[1].precedence, 20);
    assertEquals(exprRule.expression.operators[3].kind, "postfix");
  }

  const syncRule = declarations.find((declaration) =>
    declaration.kind === "rule" && declaration.name === "item" &&
    declaration.annotations.length === 1
  );
  assert(syncRule);
  assert(syncRule.kind === "rule");
  assertEquals(syncRule.annotations[0].kind, "sync");
});

Deno.test("grammar v2 parser covers imports and separated-list expressions", async () => {
  const source = await Deno.readTextFile(
    "fixtures/grammar-v2/valid/lists.grammar",
  );
  const result = parseGrammarV2(source);

  assertEquals(result.diagnostics.length, 0);
  assert(result.grammar);
  const importDecl = result.grammar.declarations[0];
  assertEquals(importDecl.kind, "import");
  if (importDecl.kind === "import") {
    assertEquals(importDecl.source, "core");
  }

  const listRule = result.grammar.declarations.find((declaration) =>
    declaration.kind === "rule" && declaration.name === "list"
  );
  assert(listRule);
  assert(listRule.kind === "rule");
  assertEquals(listRule.expression.kind, "constructor");
  if (listRule.expression.kind === "constructor") {
    assertEquals(listRule.expression.expression.kind, "field");
    if (listRule.expression.expression.kind === "field") {
      assertEquals(listRule.expression.expression.expression.kind, "separated");
    }
  }
});

Deno.test("grammar v2 parser covers modes, transitions, layout, modules, and extensions", async () => {
  const source = await Deno.readTextFile(
    "fixtures/grammar-v2/valid/modes-layout-modules.grammar",
  );
  const result = parseGrammarV2(source);

  assertEquals(result.diagnostics.length, 0);
  assert(result.grammar);

  const moduleDecl = result.grammar.declarations.find((declaration) =>
    declaration.kind === "module"
  );
  assert(moduleDecl);
  assert(moduleDecl.kind === "module");
  assertEquals(moduleDecl.name, "Core.Syntax");

  const importDecl = result.grammar.declarations.find((declaration) =>
    declaration.kind === "import"
  );
  assert(importDecl);
  assert(importDecl.kind === "import");
  assertEquals(importDecl.source, "Core.Base");

  const exportDecl = result.grammar.declarations.find((declaration) =>
    declaration.kind === "export"
  );
  assert(exportDecl);
  assert(exportDecl.kind === "export");
  assertEquals(exportDecl.name, "Core.Syntax.module");

  const modeDecl = result.grammar.declarations.find((declaration) =>
    declaration.kind === "mode"
  );
  assert(modeDecl);
  assert(modeDecl.kind === "mode");
  assertEquals(modeDecl.name, "String");
  assertEquals(modeDecl.declarations.length, 2);
  assertEquals(modeDecl.declarations[0].mode, "String");
  assert(modeDecl.declarations[0].transition);
  assertEquals(modeDecl.declarations[0].transition.kind, "pop");

  const quoteDecl = result.grammar.declarations.find((declaration) =>
    declaration.kind === "token" && declaration.name === "Quote"
  );
  assert(quoteDecl);
  assert(quoteDecl.kind === "token");
  assert(quoteDecl.transition);
  assertEquals(quoteDecl.transition.kind, "push");
  if (quoteDecl.transition.kind === "push") {
    assertEquals(quoteDecl.transition.mode, "String");
  }

  const identDecl = result.grammar.declarations.find((declaration) =>
    declaration.kind === "token" && declaration.name === "Ident"
  );
  assert(identDecl);
  assert(identDecl.kind === "token");
  assertEquals(identDecl.mode, "default");

  const layoutDecl = result.grammar.declarations.find((declaration) =>
    declaration.kind === "layout"
  );
  assert(layoutDecl);
  assert(layoutDecl.kind === "layout");
  assertEquals(layoutDecl.name, "indent");
  assertEquals(layoutDecl.expression.kind, "choice");

  const extensionDecl = result.grammar.declarations.find((declaration) =>
    declaration.kind === "extend"
  );
  assert(extensionDecl);
  assert(extensionDecl.kind === "extend");
  assertEquals(extensionDecl.target, "item");
  assertEquals(extensionDecl.expression.kind, "constructor");
});

Deno.test("grammar v2 parser reports multiple syntax diagnostics with spans", async () => {
  const source = await Deno.readTextFile(
    "fixtures/grammar-v2/invalid/broken.grammar",
  );
  const result = parseGrammarV2(source);

  assert(result.grammar);
  assert(result.diagnostics.length >= 3);
  for (const diagnostic of result.diagnostics) {
    assertEquals(diagnostic.code, "GRAMMAR_V2_PARSE_ERROR");
    assert(diagnostic.span);
    assert(diagnostic.sourceLine);
  }
  assertIncludes(
    result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
    "Expected '='.",
  );
  assertIncludes(
    result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
    "Unexpected character '@'.",
  );
  assert(
    result.grammar.declarations.some((declaration) =>
      declaration.kind === "rule" && declaration.name === "rule"
    ),
    "Expected parser to recover and parse the valid rule after earlier errors.",
  );
});

Deno.test("grammar v2 fixture snapshots stay stable without source spans", async () => {
  const validFixtures = [
    "fixtures/grammar-v2/valid/core.grammar",
    "fixtures/grammar-v2/valid/lists.grammar",
    "fixtures/grammar-v2/valid/modes-layout-modules.grammar",
  ];
  const validSnapshots: Record<string, unknown> = {};
  for (const path of validFixtures) {
    const result = parseGrammarV2(await Deno.readTextFile(path));
    assertEquals(result.diagnostics.length, 0);
    assert(result.grammar);
    validSnapshots[path] = normalizeGrammarV2(result.grammar);
  }
  assertEquals(
    JSON.stringify(validSnapshots, null, 2),
    `{
  "fixtures/grammar-v2/valid/core.grammar": {
    "name": "Core",
    "declarations": [
      {
        "kind": "token",
        "name": "Ident",
        "pattern": {
          "kind": "regex",
          "pattern": "[_\\\\p{L}][_\\\\p{L}\\\\p{N}]*"
        }
      },
      {
        "kind": "token",
        "name": "Int",
        "pattern": {
          "kind": "regex",
          "pattern": "[0-9]+"
        }
      },
      {
        "kind": "skip",
        "name": "Space",
        "pattern": {
          "kind": "regex",
          "pattern": "[ \\\\t\\\\r\\\\n]+"
        },
        "channel": "trivia"
      },
      {
        "kind": "contextual",
        "name": "Async",
        "pattern": {
          "kind": "literal",
          "value": "async"
        }
      },
      {
        "kind": "export",
        "name": "module"
      },
      {
        "kind": "export",
        "name": "expr"
      },
      {
        "kind": "rule",
        "name": "module",
        "annotations": [],
        "expression": {
          "kind": "constructor",
          "expression": {
            "kind": "sequence",
            "items": [
              {
                "kind": "field",
                "name": "items",
                "expression": {
                  "kind": "repeat",
                  "expression": {
                    "kind": "ref",
                    "name": "item"
                  }
                }
              },
              {
                "kind": "ref",
                "name": "EOF"
              }
            ]
          },
          "name": "Module",
          "arguments": [
            "items"
          ]
        }
      },
      {
        "kind": "rule",
        "name": "item",
        "annotations": [
          {
            "kind": "sync",
            "expression": {
              "kind": "choice",
              "options": [
                {
                  "kind": "literal",
                  "value": ";"
                },
                {
                  "kind": "literal",
                  "value": "}"
                },
                {
                  "kind": "ref",
                  "name": "EOF"
                }
              ]
            }
          }
        ],
        "expression": {
          "kind": "sequence",
          "items": []
        }
      },
      {
        "kind": "rule",
        "name": "item",
        "annotations": [],
        "expression": {
          "kind": "choice",
          "options": [
            {
              "kind": "constructor",
              "expression": {
                "kind": "sequence",
                "items": [
                  {
                    "kind": "literal",
                    "value": "let"
                  },
                  {
                    "kind": "field",
                    "name": "name",
                    "expression": {
                      "kind": "ref",
                      "name": "Ident"
                    }
                  },
                  {
                    "kind": "literal",
                    "value": "="
                  },
                  {
                    "kind": "field",
                    "name": "value",
                    "expression": {
                      "kind": "ref",
                      "name": "expr"
                    }
                  },
                  {
                    "kind": "literal",
                    "value": ";"
                  }
                ]
              },
              "name": "Let",
              "arguments": [
                "name",
                "value"
              ]
            },
            {
              "kind": "constructor",
              "expression": {
                "kind": "sequence",
                "items": [
                  {
                    "kind": "optional",
                    "expression": {
                      "kind": "ref",
                      "name": "Async"
                    }
                  },
                  {
                    "kind": "literal",
                    "value": "fn"
                  },
                  {
                    "kind": "field",
                    "name": "name",
                    "expression": {
                      "kind": "ref",
                      "name": "Ident"
                    }
                  },
                  {
                    "kind": "literal",
                    "value": "("
                  },
                  {
                    "kind": "field",
                    "name": "params",
                    "expression": {
                      "kind": "optional",
                      "expression": {
                        "kind": "ref",
                        "name": "param_list"
                      }
                    }
                  },
                  {
                    "kind": "literal",
                    "value": ")"
                  },
                  {
                    "kind": "field",
                    "name": "body",
                    "expression": {
                      "kind": "ref",
                      "name": "block"
                    }
                  }
                ]
              },
              "name": "Fn",
              "arguments": [
                "name",
                "params",
                "body"
              ]
            }
          ]
        }
      },
      {
        "kind": "rule",
        "name": "expr",
        "annotations": [],
        "expression": {
          "kind": "expressionIsland",
          "atom": {
            "kind": "ref",
            "name": "atom"
          },
          "operators": [
            {
              "kind": "infix",
              "precedence": 10,
              "token": {
                "kind": "literal",
                "value": "+"
              },
              "associativity": "left"
            },
            {
              "kind": "infix",
              "precedence": 20,
              "token": {
                "kind": "literal",
                "value": "*"
              },
              "associativity": "left"
            },
            {
              "kind": "prefix",
              "precedence": 30,
              "token": {
                "kind": "literal",
                "value": "-"
              }
            },
            {
              "kind": "postfix",
              "precedence": 40,
              "token": {
                "kind": "literal",
                "value": "?"
              }
            }
          ]
        }
      },
      {
        "kind": "rule",
        "name": "atom",
        "annotations": [],
        "expression": {
          "kind": "choice",
          "options": [
            {
              "kind": "constructor",
              "expression": {
                "kind": "ref",
                "name": "Int"
              },
              "name": "IntLiteral",
              "arguments": [
                "text"
              ]
            },
            {
              "kind": "constructor",
              "expression": {
                "kind": "ref",
                "name": "Ident"
              },
              "name": "Name",
              "arguments": [
                "text"
              ]
            },
            {
              "kind": "sequence",
              "items": [
                {
                  "kind": "literal",
                  "value": "("
                },
                {
                  "kind": "ref",
                  "name": "expr"
                },
                {
                  "kind": "literal",
                  "value": ")"
                }
              ]
            }
          ]
        }
      }
    ]
  },
  "fixtures/grammar-v2/valid/lists.grammar": {
    "name": "Lists",
    "declarations": [
      {
        "kind": "import",
        "source": "core"
      },
      {
        "kind": "token",
        "name": "Ident",
        "pattern": {
          "kind": "regex",
          "pattern": "[A-Za-z_][A-Za-z0-9_]*"
        }
      },
      {
        "kind": "token",
        "name": "Comma",
        "pattern": {
          "kind": "regex",
          "pattern": ","
        }
      },
      {
        "kind": "rule",
        "name": "list",
        "annotations": [],
        "expression": {
          "kind": "constructor",
          "expression": {
            "kind": "field",
            "name": "item",
            "expression": {
              "kind": "separated",
              "item": {
                "kind": "ref",
                "name": "Ident"
              },
              "separator": {
                "kind": "literal",
                "value": ","
              }
            }
          },
          "name": "List",
          "arguments": [
            "item"
          ]
        }
      }
    ]
  },
  "fixtures/grammar-v2/valid/modes-layout-modules.grammar": {
    "name": "FeatureSyntax",
    "declarations": [
      {
        "kind": "module",
        "name": "Core.Syntax"
      },
      {
        "kind": "import",
        "source": "Core.Base"
      },
      {
        "kind": "export",
        "name": "Core.Syntax.module"
      },
      {
        "kind": "mode",
        "name": "String",
        "declarations": [
          {
            "kind": "token",
            "name": "StringText",
            "pattern": {
              "kind": "regex",
              "pattern": "[^\\"]+"
            },
            "mode": "String",
            "transition": {
              "kind": "pop"
            }
          },
          {
            "kind": "token",
            "name": "Escape",
            "pattern": {
              "kind": "regex",
              "pattern": "\\\\\\\\."
            },
            "mode": "String"
          }
        ]
      },
      {
        "kind": "token",
        "name": "Quote",
        "pattern": {
          "kind": "regex",
          "pattern": "\\""
        },
        "transition": {
          "kind": "push",
          "mode": "String"
        }
      },
      {
        "kind": "token",
        "name": "Ident",
        "pattern": {
          "kind": "regex",
          "pattern": "[A-Za-z_][A-Za-z0-9_]*"
        },
        "mode": "default"
      },
      {
        "kind": "skip",
        "name": "Space",
        "pattern": {
          "kind": "regex",
          "pattern": "[ \\\\t\\\\r\\\\n]+"
        },
        "channel": "trivia"
      },
      {
        "kind": "layout",
        "name": "indent",
        "expression": {
          "kind": "choice",
          "options": [
            {
              "kind": "ref",
              "name": "INDENT"
            },
            {
              "kind": "ref",
              "name": "DEDENT"
            },
            {
              "kind": "ref",
              "name": "NEWLINE"
            }
          ]
        }
      },
      {
        "kind": "extend",
        "target": "item",
        "expression": {
          "kind": "constructor",
          "expression": {
            "kind": "sequence",
            "items": [
              {
                "kind": "literal",
                "value": "trace"
              },
              {
                "kind": "field",
                "name": "value",
                "expression": {
                  "kind": "ref",
                  "name": "expr"
                }
              },
              {
                "kind": "literal",
                "value": ";"
              }
            ]
          },
          "name": "Trace",
          "arguments": [
            "value"
          ]
        }
      },
      {
        "kind": "rule",
        "name": "module",
        "annotations": [],
        "expression": {
          "kind": "constructor",
          "expression": {
            "kind": "sequence",
            "items": [
              {
                "kind": "repeat",
                "expression": {
                  "kind": "ref",
                  "name": "item"
                }
              },
              {
                "kind": "ref",
                "name": "EOF"
              }
            ]
          },
          "name": "Module",
          "arguments": [
            "item"
          ]
        }
      },
      {
        "kind": "rule",
        "name": "item",
        "annotations": [],
        "expression": {
          "kind": "ref",
          "name": "Ident"
        }
      },
      {
        "kind": "rule",
        "name": "expr",
        "annotations": [],
        "expression": {
          "kind": "ref",
          "name": "Ident"
        }
      }
    ]
  }
}`,
  );

  const invalid = parseGrammarV2(
    await Deno.readTextFile("fixtures/grammar-v2/invalid/broken.grammar"),
  );
  assertEquals(
    JSON.stringify(normalizeDiagnostics(invalid.diagnostics), null, 2),
    `[
  {
    "code": "GRAMMAR_V2_PARSE_ERROR",
    "message": "Expected '='.",
    "line": 2,
    "column": 21
  },
  {
    "code": "GRAMMAR_V2_PARSE_ERROR",
    "message": "Expected ';'.",
    "line": 4,
    "column": 1
  },
  {
    "code": "GRAMMAR_V2_PARSE_ERROR",
    "message": "Unexpected character '@'.",
    "line": 5,
    "column": 1
  },
  {
    "code": "GRAMMAR_V2_PARSE_ERROR",
    "message": "Expected expression.",
    "line": 6,
    "column": 9
  }
]`,
  );
});

function normalizeGrammarV2(grammar: GrammarV2Document): unknown {
  const normalized: Record<string, unknown> = {};
  if (grammar.name !== undefined) {
    normalized.name = grammar.name;
  }
  normalized.declarations = stripUnstable(grammar.declarations);
  return normalized;
}

function normalizeDiagnostics(diagnostics: readonly Diagnostic[]): unknown {
  const normalized = diagnostics.map((diagnostic) => {
    const span = diagnostic.span;
    assert(span);
    return {
      code: diagnostic.code,
      message: diagnostic.message,
      line: span.line,
      column: span.column,
    };
  });
  normalized.sort((left, right) => {
    if (left.line !== right.line) {
      return left.line - right.line;
    }
    if (left.column !== right.column) {
      return left.column - right.column;
    }
    return left.message.localeCompare(right.message);
  });
  return normalized;
}

function stripUnstable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripUnstable);
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "span" || key === "sourceLine") {
        continue;
      }
      const normalized = stripUnstable(entry);
      if (normalized === undefined) {
        continue;
      }
      output[key] = normalized;
    }
    return output;
  }
  return value;
}
