import {
  analyzeGrammarV2,
  assert,
  assertEquals,
  parseGrammarV2,
} from "./helpers.ts";

Deno.test("grammar v2 diagnostics are stable and keep related spans", () => {
  const source = `
    grammar Bad
    token Ident = /[a-z]+/ ;
    token Ident = /[A-Z]+/ ;
    mode String {
      token Text push Missing = /x+/ ;
    }
    start = known MissingToken ;
    known = Ident ;
    orphan = "x" ;
  `;
  const parsed = parseGrammarV2(source);
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);

  const analyzed = analyzeGrammarV2(parsed.grammar);
  const diagnostics = analyzed.diagnostics.map((diagnostic) => {
    assert(diagnostic.span);
    let related = 0;
    if (diagnostic.related !== undefined) {
      related = diagnostic.related.length;
    }
    return {
      code: diagnostic.code,
      line: diagnostic.span.line,
      column: diagnostic.span.column,
      related,
    };
  });
  assertEquals(
    JSON.stringify(diagnostics, null, 2),
    `[
  {
    "code": "GRAMMAR_V2_DUPLICATE_TOKEN",
    "line": 4,
    "column": 5,
    "related": 1
  },
  {
    "code": "GRAMMAR_V2_UNKNOWN_MODE",
    "line": 6,
    "column": 18,
    "related": 0
  },
  {
    "code": "GRAMMAR_V2_UNKNOWN_REFERENCE",
    "line": 8,
    "column": 19,
    "related": 0
  },
  {
    "code": "GRAMMAR_V2_UNREACHABLE_RULE",
    "line": 10,
    "column": 5,
    "related": 0
  },
  {
    "code": "GRAMMAR_V2_UNUSED_TOKEN",
    "line": 6,
    "column": 7,
    "related": 0
  }
]`,
  );
});

Deno.test("grammar v2 diagnostics reject invalid ast and recovery metadata", () => {
  const source = `
    grammar BadMetadata
    token Ident = /[a-z]+/ ;
    start = stmt expr ;
    stmt sync = start ;
    stmt = name:Ident -> Name(name, missing, text, text) ;
    expr = atom {
      infix left 10 "+"
      infix left 10 "+"
    }
    atom = Ident ;
  `;
  const parsed = parseGrammarV2(source);
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);

  const analyzed = analyzeGrammarV2(parsed.grammar);
  const diagnostics = analyzed.diagnostics.map((diagnostic) => {
    let related = 0;
    if (diagnostic.related !== undefined) {
      related = diagnostic.related.length;
    }
    return {
      code: diagnostic.code,
      related,
    };
  });
  assertEquals(
    JSON.stringify(diagnostics, null, 2),
    `[
  {
    "code": "GRAMMAR_V2_INVALID_SYNC_REFERENCE",
    "related": 0
  },
  {
    "code": "GRAMMAR_V2_INVALID_CONSTRUCTOR_FIELD",
    "related": 0
  },
  {
    "code": "GRAMMAR_V2_DUPLICATE_CONSTRUCTOR_FIELD",
    "related": 1
  },
  {
    "code": "GRAMMAR_V2_DUPLICATE_PRECEDENCE",
    "related": 1
  }
]`,
  );
});

Deno.test("grammar v2 diagnostics classify token pattern conflicts", () => {
  const source = `
    grammar TokenProblems
    token Word = /[a-z]+/ ;
    token Let = "let" ;
    token Bad = /\\d+/ ;
    start = Word Let Bad ;
  `;
  const parsed = parseGrammarV2(source);
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);

  const analyzed = analyzeGrammarV2(parsed.grammar);
  const diagnostics = analyzed.diagnostics.map((diagnostic) => {
    let related = 0;
    if (diagnostic.related !== undefined) {
      related = diagnostic.related.length;
    }
    return {
      code: diagnostic.code,
      line: diagnostic.span?.line,
      related,
    };
  });
  assertEquals(
    JSON.stringify(diagnostics, null, 2),
    `[
  {
    "code": "GRAMMAR_V2_INVALID_TOKEN_PATTERN",
    "line": 5,
    "related": 0
  },
  {
    "code": "GRAMMAR_V2_TOKEN_OVERLAP",
    "line": 4,
    "related": 1
  },
  {
    "code": "GRAMMAR_V2_TOKEN_SHADOWED",
    "line": 4,
    "related": 1
  }
]`,
  );
});

Deno.test("grammar v2 diagnostics reject pratt atom left recursion", () => {
  const source = `
    grammar PrattBad
    token Ident = /[a-z]+/ ;
    expr = atom {
      infix left 10 "."
    }
    atom = expr "." Ident -> Member(expr, Ident) | Ident ;
  `;
  const parsed = parseGrammarV2(source);
  assertEquals(parsed.diagnostics.length, 0);
  assert(parsed.grammar);

  const analyzed = analyzeGrammarV2(parsed.grammar);
  const diagnostics = analyzed.diagnostics.map((diagnostic) => {
    let related = 0;
    if (diagnostic.related !== undefined) {
      related = diagnostic.related.length;
    }
    return {
      code: diagnostic.code,
      line: diagnostic.span?.line,
      related,
    };
  });
  assertEquals(
    JSON.stringify(diagnostics, null, 2),
    `[
  {
    "code": "EXPR_LEFT_RECURSION",
    "line": 4,
    "related": 2
  }
]`,
  );
});
