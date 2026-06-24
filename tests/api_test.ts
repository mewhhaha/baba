import {
  applyBundle,
  assert,
  assertEquals,
  assertIncludes,
  assertMissing,
  assertNotIncludes,
  assertRejectsIncludes,
  assertThrowsIncludes,
  BabaError,
  captureConsoleError,
  captureConsoleLog,
  collectReachabilityDiagnostics,
  collectTreeSitterHighlightDiagnostics,
  compile,
  denoCheck,
  explicitGrammar,
  fixtureSamples,
  formatDiagnostic,
  generate,
  generatedTextContent,
  generatedTextContentOrEmpty,
  generateTreeSitterGrammar,
  generateTreeSitterHighlightsQuery,
  generateTreeSitterQueries,
  main,
  parseEbnf,
  parseGrammar,
  parseMetadata,
  parseTreeSitterMetadata,
  runCommand,
  treeSitterAccepts,
  validateGrammar,
} from "./helpers.ts";
import {
  getParsePortableRegexInvocationCountForTesting,
  resetParsePortableRegexInvocationCountForTesting,
} from "../src/compiler/regex/parser.ts";
import {
  getPortableRuntimePlanInvocationCountForTesting,
  resetPortableRuntimePlanInvocationCountForTesting,
} from "../src/targets/runtime/plan.ts";

Deno.test("parses and validates explicit token grammars", () => {
  const grammar = parseGrammar(explicitGrammar);

  assertEquals(grammar.tokens.length, 3);
  assertEquals(grammar.rules.length, 2);
  const module = grammar.rules.find((rule) => rule.name === "module");
  assert(module?.expression.kind === "sequence");
  const name = module.expression.items[1];
  assert(name.kind === "field");
  assertEquals(name.name, "name");
  assertEquals(validateGrammar(grammar).length, 0);
});

Deno.test("validateGrammar collects independent span-aware errors", () => {
  const grammar = parseGrammar(`
    token dup = /a*/ ;
    token dup = /b/ ;
    module = missing other ;
  `);
  const diagnostics = validateGrammar(grammar);

  assertEquals(
    diagnostics.map((diagnostic) => diagnostic.code).join(","),
    "INVALID_TOKEN_REGEX,DUPLICATE_DECLARATION,UNKNOWN_RULE_REFERENCE,UNKNOWN_RULE_REFERENCE",
  );
  assert(
    diagnostics.every((diagnostic) => diagnostic.severity === "error"),
  );
  assert(
    diagnostics
      .filter((diagnostic) => diagnostic.code === "UNKNOWN_RULE_REFERENCE")
      .every((diagnostic) => diagnostic.span?.line === 4),
  );
});

Deno.test("implicit token builtins are rejected", () => {
  assertThrowsIncludes(
    () => generate(`module = ident ;`),
    "Unknown rule reference 'ident'",
  );
  assertThrowsIncludes(
    () => generate(`module = string ;`),
    "Unknown rule reference 'string'",
  );
  assertThrowsIncludes(
    () => generate(`module = fenced_text ;`),
    "Unknown rule reference 'fenced_text'",
  );
  assertThrowsIncludes(
    () => generate(`module = newline indent dedent ;`),
    "Unknown rule reference 'newline'",
  );
});

Deno.test("target output paths cannot collide", () => {
  const result = compile(`module = "ok" ;`, {
    targets: ["tree-sitter", "typescript"],
    typescript: { directory: "grammar.js" },
  });
  assertEquals(result.bundle, undefined);
  assertEquals(result.diagnostics[0].code, "OUTPUT_PATH_COLLISION");
});

Deno.test("portability defaults are warn for one target and strict for multiple targets", () => {
  const grammar = parseGrammar(`module = "ok" ;`);
  const metadata = parseMetadata(JSON.stringify({
    extras: [{ kind: "rule", name: "not_skip" }],
  }));
  const cases: Array<
    [readonly string[], string | undefined, string | undefined]
  > = [
    [["tree-sitter"], undefined, undefined],
    [["typescript"], "warning", "PORTABILITY_TREE_SITTER_EXTRA"],
    [["wasm"], "warning", "PORTABILITY_TREE_SITTER_EXTRA"],
    [["tree-sitter", "typescript"], "error", "PORTABILITY_TREE_SITTER_EXTRA"],
    [["tree-sitter", "wasm"], "error", "PORTABILITY_TREE_SITTER_EXTRA"],
    [["typescript", "wasm"], "error", "PORTABILITY_TREE_SITTER_EXTRA"],
    [
      ["tree-sitter", "typescript", "wasm"],
      "error",
      "PORTABILITY_TREE_SITTER_EXTRA",
    ],
  ];

  for (const [targets, severity, code] of cases) {
    const diagnostics = validateGrammar(grammar, {
      metadata,
      targets: targets as ("tree-sitter" | "typescript" | "wasm")[],
    });
    const diagnostic = diagnostics.find((entry) =>
      entry.code === "PORTABILITY_TREE_SITTER_EXTRA"
    );
    assertEquals(diagnostic?.code, code);
    assertEquals(diagnostic?.severity, severity);
  }

  assertEquals(
    validateGrammar(grammar, {
      metadata,
      targets: ["typescript", "wasm"],
      portability: "warn",
    }).find((entry) => entry.code === "PORTABILITY_TREE_SITTER_EXTRA")
      ?.severity,
    "warning",
  );
  assertEquals(
    validateGrammar(grammar, {
      metadata,
      targets: ["typescript"],
      portability: "strict",
    }).find((entry) => entry.code === "PORTABILITY_TREE_SITTER_EXTRA")
      ?.severity,
    "error",
  );
  assertEquals(
    validateGrammar(grammar, {
      metadata,
      targets: ["typescript", "wasm"],
      portability: "off",
    }).some((entry) => entry.code === "PORTABILITY_TREE_SITTER_EXTRA"),
    false,
  );
});

Deno.test("TypeScript and Wasm share one portable runtime planning pass", () => {
  resetPortableRuntimePlanInvocationCountForTesting();
  const result = compile(`module = "ok" ;`, {
    targets: ["typescript", "wasm"],
  });

  assert(result.bundle);
  assertEquals(getPortableRuntimePlanInvocationCountForTesting(), 1);
});

Deno.test("shared analysis parses each token regex once per compile", () => {
  resetParsePortableRegexInvocationCountForTesting();
  const result = compile(
    `
    token A = /a+/ ;
    token B = /b+/ ;
    skip WS = /[ \\t\\n]+/ ;
    module = A B ;
  `,
    { targets: ["typescript", "wasm"] },
  );

  assert(result.bundle);
  assertEquals(getParsePortableRegexInvocationCountForTesting(), 3);
});

Deno.test("validateGrammar and compile agree on shared runtime planning diagnostics", () => {
  const grammar = parseGrammar(`module = "ok" ;`);
  const options = {
    targets: ["typescript", "wasm"] as const,
    typescript: { parserStateLimit: 0 },
  };

  const validateDiagnostics = validateGrammar(grammar, options);
  const compileDiagnostics = compile(grammar, options).diagnostics;
  assertEquals(
    compileDiagnostics.map((diagnostic) => diagnostic.code).join(","),
    validateDiagnostics.map((diagnostic) => diagnostic.code).join(","),
  );
  assertEquals(validateDiagnostics[0].code, "PORTABLE_PARSER_STATE_LIMIT");
});

Deno.test("root reachability omits dead rules and warns", () => {
  const source = `
    token ident = /[a-z]+/ ;
    skip whitespace = /[ \\t\\n]+/ ;
    dead = "special" missing ;
    module = ident ;
  `;

  const bundle = generate(source, { rootRule: "module" });
  const grammar = generatedTextContent(bundle, "grammar.js");
  const highlights = generatedTextContentOrEmpty(
    bundle,
    "queries/generated-highlights.scm",
  );

  assertIncludes(grammar, "module: $ => $.ident");
  assertNotIncludes(grammar, "dead: $ =>");
  assertNotIncludes(highlights, '"special" @keyword');
  assertEquals(bundle.diagnostics?.[0]?.code, "UNREACHABLE_RULE");
  assertEquals(
    collectReachabilityDiagnostics(parseEbnf(source), "module").length,
    1,
  );
});

Deno.test("TypeScript-only compilation reports target-neutral unreachable rules", () => {
  const result = compile(
    `
    token ident = /[a-z]+/ ;
    module = ident ;
    dead = "unused" ;
  `,
    { targets: ["typescript"], rootRule: "module" },
  );
  assert(result.bundle);
  assertEquals(result.diagnostics[0].code, "UNREACHABLE_RULE");
  assertEquals(result.diagnostics[0].backend, undefined);
});

Deno.test("highlight defaults are rooted and infer contextual identifier semantics", () => {
  const source = `
    token ident = /[a-z]+/ ;
    token Ghost = /ghost/ ;
    dead = "unused" name:Ghost ;
    module = function ;
    function = "fn" name:ident ;
  `;
  const highlights = generateTreeSitterHighlightsQuery(source, {
    rootRule: "module",
  });

  assertIncludes(highlights, '(function "fn" @keyword)');
  assertIncludes(highlights, "(function name: (ident) @function)");
  assertNotIncludes(highlights, "(ident) @variable");
  assertNotIncludes(highlights, '"unused" @keyword');
  assertNotIncludes(highlights, "(Ghost) @constant");
});

Deno.test("rich highlight defaults infer IDE-grade named and contextual captures", () => {
  const source = `
    token ident = /[a-z]+/ ;
    token integer = /[0-9]+/ ;
    token string_literal = /"[^"\\r\\n]*"/ ;
    token boolean_literal = /TRUE|FALSE/ ;
    token intrinsic = /@[a-z]+/ ;
    skip line_comment = /#[^\\r\\n]*/ ;
    skip whitespace = /[ \\t\\r\\n]+/ ;

    module = function_decl type_decl call member variable literal_value ;
    function_decl = "fn" name:ident ;
    type_decl = "type" name:ident ;
    call = callee:ident "(" ")" ;
    member = object:ident "." field:ident ;
    variable = "let" name:ident ;
    literal_value = integer string_literal boolean_literal intrinsic ;
  `;

  const highlights = generateTreeSitterHighlightsQuery(source);

  assertIncludes(highlights, '(function_decl "fn" @keyword)');
  assertIncludes(highlights, '"(" @punctuation.bracket');
  assertIncludes(highlights, '"." @punctuation.delimiter');
  assertIncludes(highlights, "(line_comment) @comment");
  assertIncludes(highlights, "(string_literal) @string");
  assertIncludes(highlights, "(integer) @number");
  assertIncludes(highlights, "(boolean_literal) @constant.builtin");
  assertIncludes(highlights, "(intrinsic) @function.builtin");
  assertIncludes(highlights, "(type_decl) @type");
  assertIncludes(highlights, "(function_decl name: (ident) @function)");
  assertIncludes(highlights, "(type_decl name: (ident) @type)");
  assertIncludes(highlights, "(call callee: (ident) @function.call)");
  assertIncludes(highlights, "(member field: (ident) @variable.other.member)");
  assertIncludes(highlights, "(variable name: (ident) @variable)");
  assert(!highlights.split("\n").includes("(ident) @variable"));
  assert(!highlights.split("\n").includes('"fn" @keyword'));
  assert(!highlights.split("\n").includes('"let" @keyword'));
});

Deno.test("rich highlight defaults avoid global word-fragment literals", () => {
  const source = `
    token ident = /[a-z_][a-z0-9_]*/ ;
    module = item+ ;
    item = const_decl | ident | "_" ;
    const_decl = "const" name:ident ;
  `;

  const highlights = generateTreeSitterHighlightsQuery(source);

  assertIncludes(highlights, '(const_decl "const" @keyword)');
  assertIncludes(highlights, '(item "_" @keyword)');
  assert(!highlights.split("\n").includes('"const" @keyword'));
  assert(!highlights.split("\n").includes('"_" @keyword'));
});

Deno.test("minimal highlight defaults preserve literal-only inference", () => {
  const source = `
    token ident = /[a-z]+/ ;
    token integer = /[0-9]+/ ;
    skip line_comment = /#[^\\r\\n]*/ ;

    module = function_decl integer ;
    function_decl = "fn" name:ident ;
  `;
  const metadata = parseTreeSitterMetadata(JSON.stringify({
    queries: {
      highlights: {
        defaults: { mode: "minimal" },
      },
    },
  }));

  const highlights = generateTreeSitterHighlightsQuery(source, { metadata });

  assertIncludes(highlights, '"fn" @keyword');
  assertNotIncludes(highlights, "(function_decl name: (ident) @function)");
  assertNotIncludes(highlights, "(integer) @number");
  assertNotIncludes(highlights, "(line_comment) @comment");
});

Deno.test("contextual highlight suppression only removes matching defaults", () => {
  const source = `
    token ident = /[a-z]+/ ;
    module = call variable ;
    call = callee:ident ;
    variable = name:ident ;
  `;
  const metadata = parseTreeSitterMetadata(JSON.stringify({
    queries: {
      highlights: {
        defaults: {
          suppress: [
            { parent: "call", field: "callee", node: "ident" },
          ],
          ignore: [
            { parent: "call", field: "callee", node: "ident" },
          ],
        },
      },
    },
  }));

  const highlights = generateTreeSitterHighlightsQuery(source, { metadata });

  assertNotIncludes(highlights, "(call callee: (ident) @function.call)");
  assertIncludes(highlights, "(variable name: (ident) @variable)");
  assertEquals(
    collectTreeSitterHighlightDiagnostics(source, { metadata }).length,
    0,
  );

  const warningMetadata = parseTreeSitterMetadata(JSON.stringify({
    queries: {
      highlights: {
        defaults: {
          suppress: [
            { parent: "call", field: "callee", node: "ident" },
          ],
        },
      },
    },
  }));
  const diagnostics = collectTreeSitterHighlightDiagnostics(source, {
    metadata: warningMetadata,
  });
  assertEquals(diagnostics[0]?.code, "QUERY_UNCAPTURED_CONTEXT");
  assertIncludes(diagnostics[0]?.message ?? "", "call field callee");
});

Deno.test("public entrypoints type-check", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = `${dir}/entrypoints.ts`;
    await Deno.writeTextFile(
      path,
      `import { applyBundle, generate, parseGrammar, parseMetadata, validateGrammar } from "${Deno.cwd()}/src/mod.ts";
import { generateTreeSitterGrammar, generateTreeSitterQueries } from "${Deno.cwd()}/src/advanced.ts";
import { compileParserKit, validateParserKit } from "${Deno.cwd()}/src/kit.ts";
const source = 'token ident = /[a-z]+/ ; module = ident ;';
const grammar = parseGrammar(source);
const metadata = parseMetadata("{}");
const diagnostics = validateGrammar(grammar);
const bundle = generate(grammar, { metadata });
const kit = compileParserKit(grammar).kit;
if (kit) console.log(validateParserKit(kit).length);
void applyBundle;
console.log(diagnostics.length, bundle.files.length, generateTreeSitterGrammar(grammar).length, generateTreeSitterQueries(grammar)["highlights.scm"].length);
`,
    );
    await denoCheck(path);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("stable diagnostics retain severity and backend", () => {
  let error: unknown;
  try {
    parseGrammar(`module = "unterminated`);
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof BabaError);
  assertIncludes(formatDiagnostic(error), "EBNF_PARSE_ERROR");

  const warning = generate(`
    token ident = /[a-z]+/ ;
    dead = ident ;
    module = "ok" ;
  `).diagnostics?.[0];
  assertEquals(warning?.severity, "warning");
  assertEquals(warning?.backend, undefined);
});
