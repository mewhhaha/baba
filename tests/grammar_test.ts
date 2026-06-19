import {
  applyBundle,
  BabaError,
  formatDiagnostic,
  generate,
  parseGrammar,
  parseMetadata,
  validateGrammar,
} from "../src/mod.ts";
import {
  collectReachabilityDiagnostics,
  generateTreeSitterGrammar,
  generateTreeSitterHighlightsQuery,
  generateTreeSitterQueries,
  parseEbnf,
  parseTreeSitterMetadata,
} from "../src/advanced.ts";
import { main } from "../src/cli.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(
      message ??
        `Expected ${JSON.stringify(actual)} to equal ${
          JSON.stringify(expected)
        }`,
    );
  }
}

function assertIncludes(actual: string, expected: string): void {
  assert(
    actual.includes(expected),
    `Expected ${JSON.stringify(actual)} to include ${expected}`,
  );
}

function assertNotIncludes(actual: string, expected: string): void {
  assert(
    !actual.includes(expected),
    `Expected ${JSON.stringify(actual)} not to include ${expected}`,
  );
}

function assertThrowsIncludes(action: () => unknown, expected: string): void {
  let message = "";
  try {
    action();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertIncludes(message, expected);
}

async function assertRejectsIncludes(
  action: () => Promise<unknown>,
  expected: string,
): Promise<void> {
  let message = "";
  try {
    await action();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertIncludes(message, expected);
}

async function captureConsoleLog(
  action: () => Promise<void>,
): Promise<string[]> {
  const original = console.log;
  const logs: string[] = [];
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  try {
    await action();
  } finally {
    console.log = original;
  }
  return logs;
}

async function captureConsoleError(
  action: () => Promise<void>,
): Promise<string[]> {
  const original = console.error;
  const logs: string[] = [];
  console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  try {
    await action();
  } finally {
    console.error = original;
  }
  return logs;
}

async function assertMissing(path: string): Promise<void> {
  try {
    await Deno.stat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  throw new Error(`Expected ${path} to be missing`);
}

async function denoCheck(path: string): Promise<void> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["check", path],
  });
  const output = await command.output();
  if (!output.success) {
    const decoder = new TextDecoder();
    throw new Error(
      `${decoder.decode(output.stdout)}${decoder.decode(output.stderr)}`,
    );
  }
}

async function runCommand(
  commandName: string,
  args: string[],
  cwd?: string,
  env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string }> {
  const command = new Deno.Command(commandName, { args, cwd, env });
  const output = await command.output();
  const decoder = new TextDecoder();
  const stdout = decoder.decode(output.stdout);
  const stderr = decoder.decode(output.stderr);
  if (!output.success) {
    throw new Error(`${stdout}${stderr}`);
  }
  return { stdout, stderr };
}

const explicitGrammar = `
  token ident = /[A-Za-z_][A-Za-z0-9_]*/ ;
  token integer = /[0-9]+/ ;
  skip whitespace = /[ \\t\\r\\n]+/ ;

  module = "fn" name:ident "(" ")" body:block ;
  block = "{" value:integer "}" ;
`;

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

Deno.test("generates Tree-sitter grammar and query bundle only", () => {
  const bundle = generate(explicitGrammar, { name: "tiny" });

  assertEquals(
    bundle.files.map((file) => file.path).join(","),
    "grammar.js,queries/generated-highlights.scm,queries/generated-rainbows.scm",
  );
  assertIncludes(
    bundle.files.find((file) => file.path === "grammar.js")?.content ?? "",
    "export default grammar({",
  );
  assertIncludes(
    bundle.files.find((file) =>
      file.path === "queries/generated-highlights.scm"
    )
      ?.content ?? "",
    '"fn" @keyword',
  );
  assertEquals(bundle.cleanupPaths, undefined);
});

Deno.test("Tree-sitter grammar lowering uses explicit declarations only", () => {
  const grammar = generateTreeSitterGrammar(explicitGrammar, { name: "tiny" });

  assertIncludes(grammar, "source_file: $ => $.module,");
  assertIncludes(grammar, "module: $ => seq(");
  assertIncludes(grammar, 'field("name", $.ident)');
  assertIncludes(grammar, 'field("body", $.block)');
  assertIncludes(grammar, "ident: $ => token(/[A-Za-z_][A-Za-z0-9_]*/),");
  assertIncludes(grammar, "integer: $ => token(/[0-9]+/),");
  assertIncludes(grammar, "whitespace: $ => /[ \\t\\r\\n]+/,");
  assertNotIncludes(grammar, "line_comment:");
  assertNotIncludes(grammar, "fenced_text:");
  assertNotIncludes(grammar, "number: $ =>");
});

Deno.test("external tokens are explicit metadata", () => {
  const source = `
    token ident = /[a-z]+/ ;
    module = INDENT ident DEDENT ;
  `;
  assertThrowsIncludes(
    () => generate(source),
    "Unknown rule reference 'INDENT'",
  );

  const metadata = parseMetadata(JSON.stringify({
    version: 1,
    externals: ["INDENT", "DEDENT"],
  }));
  const grammar = generateTreeSitterGrammar(source, { metadata });

  assertEquals(validateGrammar(parseGrammar(source), { metadata }).length, 0);
  assertIncludes(grammar, "externals: $ => [$.INDENT, $.DEDENT],");
  assertIncludes(grammar, "module: $ => seq($.INDENT, $.ident, $.DEDENT)");
});

Deno.test("Tree-sitter backend rejects unsupported regex constructs", () => {
  assertThrowsIncludes(
    () =>
      generate(`
        token bad = /a(?=b)/ ;
        module = bad ;
      `),
    "unsupported by Tree-sitter regex tokens",
  );
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

Deno.test("metadata is Tree-sitter-only", () => {
  assertThrowsIncludes(
    () => parseMetadata(JSON.stringify({ formatter: { blocks: ["module"] } })),
    "Unknown metadata key 'formatter'",
  );
  assertThrowsIncludes(
    () => parseMetadata(JSON.stringify({ lsp: { diagnostics: ["module"] } })),
    "Unknown metadata key 'lsp'",
  );
  assertThrowsIncludes(
    () => parseMetadata(JSON.stringify({ language: { comment: "#" } })),
    "Unknown metadata key 'language'",
  );
});

Deno.test("metadata drives Tree-sitter shaping and queries", () => {
  const metadata = parseTreeSitterMetadata(JSON.stringify({
    version: 1,
    word: "ident",
    extras: [{ kind: "rule", name: "whitespace" }],
    rules: {
      module: {
        paths: {
          name: { alias_ref: "function_name" },
        },
      },
    },
    queries: {
      highlights: {
        entries: [{ node: "ident", capture: "function" }],
        defaults: { suppress: [{ node: "ident" }] },
      },
      locals: [{ node: "ident", capture: "local.definition" }],
      injections: [{ node: "block", language: "javascript" }],
    },
  }));

  const grammar = generateTreeSitterGrammar(explicitGrammar, {
    name: "tiny",
    metadata,
  });
  assertIncludes(grammar, "word: $ => $.ident");
  assertIncludes(grammar, 'field("name", alias($.ident, $.function_name))');

  const queries = generateTreeSitterQueries(explicitGrammar, { metadata });
  assertIncludes(queries["highlights.scm"], "(ident) @function");
  assertIncludes(queries["locals.scm"], "(ident) @local.definition");
  assertIncludes(queries["injections.scm"], "(#set! injection.language");
});

Deno.test("versioned metadata rejects legacy numeric paths", () => {
  assertThrowsIncludes(
    () =>
      generateTreeSitterGrammar(explicitGrammar, {
        name: "tiny",
        metadata: parseTreeSitterMetadata(JSON.stringify({
          version: 1,
          rules: {
            module: {
              paths: {
                "1": { alias_ref: "name" },
              },
            },
          },
        })),
      }),
    "uses legacy numeric metadata",
  );
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

Deno.test("query metadata must target the selected root graph", () => {
  const source = `
    token ident = /[a-z]+/ ;
    skip whitespace = /[ \\t\\n]+/ ;
    dead = "unused" ;
    module = ident ;
  `;

  assertThrowsIncludes(
    () =>
      generate(source, {
        rootRule: "module",
        metadata: parseTreeSitterMetadata(JSON.stringify({
          queries: {
            locals: [{ node: "dead", capture: "local.definition" }],
          },
        })),
      }),
    "Unknown locals capture node 'dead'",
  );
  assertThrowsIncludes(
    () =>
      generateTreeSitterQueries(source, {
        rootRule: "module",
        metadata: parseTreeSitterMetadata(JSON.stringify({
          queries: {
            highlights: {
              entries: [{ literal: "unused", capture: "keyword" }],
            },
          },
        })),
      }),
    "Unknown highlight capture literal 'unused'",
  );
  assertThrowsIncludes(
    () =>
      generate(source, {
        rootRule: "module",
        metadata: parseTreeSitterMetadata(JSON.stringify({
          rules: {
            dead: { paths: { "": { wrap: { kind: "prec", value: 1 } } } },
          },
        })),
      }),
    "Metadata rule 'dead' is unreachable from root rule 'module'",
  );
});

Deno.test("generated Tree-sitter artifacts compile, parse, and query", async () => {
  const treeSitterVersion = await runCommand("tree-sitter", ["--version"])
    .then((output) => output.stdout.trim())
    .catch(() => "");
  if (!treeSitterVersion) {
    throw new Error("tree-sitter executable is required for integration tests");
  }

  const source = `
    token ident = /[a-z]+/ ;
    token integer = /[0-9]+/ ;
    skip whitespace = /[ \\t\\n]+/ ;

    module = function+ ;
    function = "fn" name:ident "(" ")" body:block ;
    block = "{" "let" binding:ident "=" value:integer ";" "}" ;
  `;
  const metadata = parseMetadata(JSON.stringify({
    version: 1,
    word: "ident",
    queries: {
      highlights: {
        patterns: ["(function (ident) @function)"],
        entries: [
          { node: "integer", capture: "number" },
          { literal: "let", capture: "keyword" },
        ],
      },
      locals: [{ node: "ident", capture: "local.definition" }],
      folds: [{ node: "block", capture: "fold" }],
      tags: [{ node: "function", capture: "tag.definition" }],
      textobjects: [{ node: "function", capture: "function.outer" }],
      rainbows: { scopes: ["block"] },
      injections: [{ node: "block", language: "javascript" }],
    },
  }));
  const dir = await Deno.makeTempDir();
  try {
    const bundle = generate(source, { name: "tiny", metadata });
    await applyBundle(bundle, { root: dir });
    await Deno.writeTextFile(
      `${dir}/sample.tiny`,
      "fn main() { let answer = 42; }\n",
    );

    const env = {
      HOME: `${dir}/home`,
      XDG_CACHE_HOME: `${dir}/cache`,
    };
    await runCommand("tree-sitter", ["generate"], dir, env);
    await runCommand(
      "tree-sitter",
      ["build", "-o", `${dir}/parser.so`],
      dir,
      env,
    );
    const parse = await runCommand(
      "tree-sitter",
      [
        "parse",
        "--lib-path",
        `${dir}/parser.so`,
        "--lang-name",
        "tiny",
        `${dir}/sample.tiny`,
      ],
      dir,
      env,
    );
    assertIncludes(parse.stdout, "(module");
    assertNotIncludes(parse.stdout, "ERROR");

    for (const file of bundle.files.filter((file) => file.kind === "query")) {
      await runCommand(
        "tree-sitter",
        [
          "query",
          "--quiet",
          "--lib-path",
          `${dir}/parser.so`,
          "--lang-name",
          "tiny",
          `${dir}/${file.path}`,
          `${dir}/sample.tiny`,
        ],
        dir,
        env,
      );
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("safe bundle apply writes nested files and refuses user edits", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const bundle = generate(explicitGrammar, { name: "tiny" });
    await applyBundle(bundle, { root: dir });

    assertIncludes(
      await Deno.readTextFile(`${dir}/grammar.js`),
      "export default grammar",
    );
    assertIncludes(
      await Deno.readTextFile(`${dir}/queries/generated-highlights.scm`),
      '"fn" @keyword',
    );
    await Deno.writeTextFile(
      `${dir}/grammar.js`,
      `${await Deno.readTextFile(`${dir}/grammar.js`)}\n// user edit\n`,
    );
    await assertRejectsIncludes(
      () => applyBundle(bundle, { root: dir }),
      "Refusing to overwrite modified or unowned file 'grammar.js'",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("safe bundle apply rejects paths outside the root", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await assertRejectsIncludes(
      () =>
        applyBundle({
          files: [{
            path: "../outside.txt",
            content: "escape",
            kind: "source",
          }],
        }, { root: dir }),
      "Refusing unsafe generated path '../outside.txt'",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("CLI lists, diagnoses, and writes Tree-sitter outputs", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const grammarPath = `${dir}/grammar.ebnf`;
    await Deno.writeTextFile(
      grammarPath,
      `
        token ident = /[a-z]+/ ;
        skip whitespace = /[ \\t\\n]+/ ;
        module = "fn" ident ;
        dead = "unused" ;
      `,
    );
    let logs: string[] = [];
    await captureConsoleError(async () => {
      logs = await captureConsoleLog(() => main([grammarPath, "--list-files"]));
    });
    assertIncludes(logs.join("\n"), "grammar.js");
    assertIncludes(logs.join("\n"), "queries/generated-highlights.scm");

    let errors: string[] = [];
    await captureConsoleLog(async () => {
      errors = await captureConsoleError(() =>
        main([grammarPath, "--list-files"])
      );
    });
    assertIncludes(errors.join("\n"), "UNREACHABLE_RULE");

    const outDir = `${dir}/out`;
    await captureConsoleError(() =>
      main([grammarPath, "--out", outDir, "--name", "tiny"])
    );
    assertIncludes(await Deno.readTextFile(`${outDir}/grammar.js`), "tiny");
    assertIncludes(
      await Deno.readTextFile(`${outDir}/grammar.js`),
      "source_file: $ => $.module",
    );
    await assertMissing(`${outDir}/tree-sitter.json`);

    const rootedGrammarPath = `${dir}/rooted.ebnf`;
    await Deno.writeTextFile(
      rootedGrammarPath,
      `
        dead = missing ;
        module = "ok" ;
      `,
    );
    const rootedOutDir = `${dir}/rooted`;
    await captureConsoleError(() =>
      main([rootedGrammarPath, "--root", "module", "--out", rootedOutDir])
    );
    assertIncludes(
      await Deno.readTextFile(`${rootedOutDir}/grammar.js`),
      "source_file: $ => $.module",
    );

    const invalidGrammarPath = `${dir}/invalid.ebnf`;
    await Deno.writeTextFile(
      invalidGrammarPath,
      `
        token dup = /a*/ ;
        token dup = /b/ ;
        module = missing other ;
      `,
    );
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        `${Deno.cwd()}/src/cli.ts`,
        invalidGrammarPath,
        "--diagnostic-format",
        "json",
      ],
    });
    const output = await command.output();
    assertEquals(output.success, false);
    const diagnostics = JSON.parse(
      new TextDecoder().decode(output.stderr),
    ) as Array<{ code: string }>;
    assertEquals(
      diagnostics.map((diagnostic) => diagnostic.code).join(","),
      "INVALID_TOKEN_REGEX,DUPLICATE_DECLARATION,UNKNOWN_RULE_REFERENCE,UNKNOWN_RULE_REFERENCE",
    );

    await assertRejectsIncludes(
      () => main(["init", outDir]),
      "'init' was removed in baba 1.0",
    );
    await assertRejectsIncludes(
      () => main([grammarPath, "--backend", "typescript-ll1"]),
      "'--backend' was removed in baba 1.0",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("public entrypoints type-check", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = `${dir}/entrypoints.ts`;
    await Deno.writeTextFile(
      path,
      `import { applyBundle, generate, parseGrammar, parseMetadata, validateGrammar } from "${Deno.cwd()}/src/mod.ts";
import { generateTreeSitterGrammar, generateTreeSitterQueries } from "${Deno.cwd()}/src/advanced.ts";
const source = 'token ident = /[a-z]+/ ; module = ident ;';
const grammar = parseGrammar(source);
const metadata = parseMetadata("{}");
const diagnostics = validateGrammar(grammar);
const bundle = generate(grammar, { metadata });
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
  assertEquals(warning?.backend, "tree-sitter");
});
