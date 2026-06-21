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
  compile,
  denoCheck,
  explicitGrammar,
  fixtureSamples,
  formatDiagnostic,
  generate,
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

Deno.test("root reachability omits dead rules and warns", () => {
  const source = `
    token ident = /[a-z]+/ ;
    skip whitespace = /[ \\t\\n]+/ ;
    dead = "special" missing ;
    module = ident ;
  `;

  const bundle = generate(source, { rootRule: "module" });
  const grammar = bundle.files.find((file) => file.path === "grammar.js")
    ?.content ?? "";
  const highlights =
    bundle.files.find((file) =>
      file.path === "queries/generated-highlights.scm"
    )
      ?.content ?? "";

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

Deno.test("highlight defaults are rooted and do not infer token semantics", () => {
  const source = `
    token ident = /[a-z]+/ ;
    token Ghost = /ghost/ ;
    dead = "unused" Ghost ;
    module = "fn" ident ;
  `;
  const highlights = generateTreeSitterHighlightsQuery(source, {
    rootRule: "module",
  });

  assertIncludes(highlights, '"fn" @keyword');
  assertNotIncludes(highlights, "(ident) @variable");
  assertNotIncludes(highlights, '"unused" @keyword');
  assertNotIncludes(highlights, "(Ghost) @constant");
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
