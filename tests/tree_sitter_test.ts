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

Deno.test("TypeScript target diagnoses conflicts without blocking Tree-sitter", () => {
  const source = `
    token IDENT = /[a-z]+/ ;
    skip WS = /[ \\t\\n]+/ ;
    module = expr ;
    expr = expr expr | IDENT ;
  `;
  const typescript = compile(source, { targets: ["typescript"] });
  assertEquals(typescript.bundle, undefined);
  assert(
    typescript.diagnostics.some((diagnostic) =>
      diagnostic.code === "TS_PARSER_REDUCE_REDUCE_CONFLICT" ||
      diagnostic.code === "TS_PARSER_SHIFT_REDUCE_CONFLICT"
    ),
  );
  const conflict = typescript.diagnostics.find((diagnostic) =>
    diagnostic.code === "TS_PARSER_REDUCE_REDUCE_CONFLICT" ||
    diagnostic.code === "TS_PARSER_SHIFT_REDUCE_CONFLICT"
  );
  assert(conflict);
  assertIncludes(conflict.message, 'rule "expr"');
  assertIncludes(conflict.message, "Reduction interpretation:");
  assertNotIncludes(conflict.message, "$e");

  const treeSitter = compile(source, { targets: ["tree-sitter"] });
  assert(treeSitter.bundle);
  assertEquals(
    treeSitter.bundle.files.some((file) => file.path === "grammar.js"),
    true,
  );
});

Deno.test("TypeScript target reports unsupported reachable external tokens", () => {
  const source = `
    token IDENT = /[a-z]+/ ;
    module = INDENT IDENT ;
  `;
  const metadata = parseMetadata(JSON.stringify({
    version: 1,
    externals: ["INDENT"],
  }));
  const typescript = compile(source, { targets: ["typescript"], metadata });
  assertEquals(
    typescript.diagnostics.map((diagnostic) => diagnostic.code).join(","),
    "TS_EXTERNAL_TOKENS_UNSUPPORTED",
  );
  assertEquals(typescript.bundle, undefined);

  const treeSitter = compile(source, { targets: ["tree-sitter"], metadata });
  assert(treeSitter.bundle);
});

Deno.test("Tree-sitter grammar lowering uses explicit declarations only", () => {
  const grammar = generateTreeSitterGrammar(explicitGrammar, { name: "tiny" });

  assertIncludes(grammar, "source_file: $ => $.module,");
  assertIncludes(grammar, "extras: $ => [");
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

Deno.test("Tree-sitter regex literals preserve escaped slash patterns", async () => {
  const source = `
    skip line_comment = /\\/\\/[^\\n\\r]*/ ;
    skip whitespace = /[ \\t\\r\\n]+/ ;
    module = "a" ;
  `;
  const bundle = generate(source, { name: "slashy" });
  const grammarSource = bundle.files.find((file) => file.path === "grammar.js")
    ?.content ?? "";
  assertIncludes(
    grammarSource,
    "line_comment: $ => /\\/\\/[^\\n\\r]*/",
  );
  assertNotIncludes(grammarSource, "line_comment: $ => /\\\\/\\\\/");

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(bundle, { root: dir });
    await Deno.writeTextFile(`${dir}/grammar.mjs`, grammarSource);
    const nodeCheck = new Deno.Command("node", {
      args: ["--check", `${dir}/grammar.mjs`],
    });
    const output = await nodeCheck.output();
    assert(
      output.success,
      new TextDecoder().decode(output.stderr),
    );

    const treeSitterVersion = await runCommand("tree-sitter", ["--version"])
      .then((result) => result.stdout.trim())
      .catch(() => "");
    if (treeSitterVersion) {
      await runCommand("tree-sitter", ["generate"], dir, {
        HOME: `${dir}/home`,
        XDG_CACHE_HOME: `${dir}/cache`,
      });
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Tree-sitter and TypeScript agree on explicit whitespace", async () => {
  const noSkip = `module = "a" "b" ;`;
  const noSkipTs = compile(noSkip, { targets: ["typescript"] });
  assert(noSkipTs.bundle);
  const noSkipDir = await Deno.makeTempDir();
  try {
    await applyBundle(noSkipTs.bundle, { root: noSkipDir });
    const mod = await import(`file://${noSkipDir}/typescript/mod.ts`);
    assertEquals(mod.parse("a b").ok, false);
  } finally {
    await Deno.remove(noSkipDir, { recursive: true });
  }
  assertEquals(await treeSitterAccepts(noSkip, "a b"), false);

  const withSkip = `
    skip WS = /[ \\t\\r\\n]+/ ;
    module = "a" "b" ;
  `;
  const withSkipTs = compile(withSkip, { targets: ["typescript"] });
  assert(withSkipTs.bundle);
  const withSkipDir = await Deno.makeTempDir();
  try {
    await applyBundle(withSkipTs.bundle, { root: withSkipDir });
    const mod = await import(`file://${withSkipDir}/typescript/mod.ts`);
    assertEquals(mod.parse("a b").ok, true);
  } finally {
    await Deno.remove(withSkipDir, { recursive: true });
  }
  assertEquals(await treeSitterAccepts(withSkip, "a b"), true);
});

Deno.test("portable fixtures have matching Tree-sitter and TypeScript acceptance", async () => {
  for (
    const fixture of [
      "expressions",
      "declarations",
      "json-like",
      "markup-like",
    ]
  ) {
    const source = await Deno.readTextFile(`fixtures/${fixture}/grammar.ebnf`);
    const languageName = fixture.replaceAll("-", "_");
    const result = compile(source, { targets: ["typescript"] });
    assertEquals(result.diagnostics.length, 0);
    assert(result.bundle);
    const dir = await Deno.makeTempDir();
    try {
      await applyBundle(result.bundle, { root: dir });
      await denoCheck(`${dir}/typescript/mod.ts`);
      const mod = await import(`file://${dir}/typescript/mod.ts`);
      for (const sample of await fixtureSamples(fixture, "valid")) {
        assertEquals(mod.parse(sample).ok, true);
        assertEquals(
          await treeSitterAccepts(source, sample, languageName),
          true,
        );
      }
      for (const sample of await fixtureSamples(fixture, "invalid")) {
        assertEquals(mod.parse(sample).ok, false);
        assertEquals(
          await treeSitterAccepts(source, sample, languageName),
          false,
        );
      }
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  }
});

Deno.test("multi-target generation rejects Tree-sitter-only extras by default", () => {
  const source = `module = "a" "b" ;`;
  const metadata = parseMetadata(JSON.stringify({
    version: 1,
    extras: [{ kind: "regex", value: "[ ]+" }],
  }));

  const strictDefault = compile(source, {
    targets: ["tree-sitter", "typescript"],
    metadata,
  });
  assertEquals(strictDefault.bundle, undefined);
  assertEquals(
    strictDefault.diagnostics[0].code,
    "PORTABILITY_TREE_SITTER_EXTRA",
  );
  assertEquals(strictDefault.diagnostics[0].severity, "error");

  const warnSingleTarget = compile(source, {
    targets: ["typescript"],
    metadata,
  });
  assert(warnSingleTarget.bundle);
  assertEquals(
    warnSingleTarget.diagnostics[0].code,
    "PORTABILITY_TREE_SITTER_EXTRA",
  );
  assertEquals(warnSingleTarget.diagnostics[0].severity, "warning");

  const warnRuntimeTargets = compile(source, {
    targets: ["typescript", "wasm", "kit"],
    metadata,
  });
  assert(warnRuntimeTargets.bundle);
  assertEquals(warnRuntimeTargets.diagnostics.length, 3);
  assert(
    warnRuntimeTargets.diagnostics.every((diagnostic) =>
      diagnostic.severity === "warning"
    ),
  );

  const explicitOff = compile(source, {
    targets: ["tree-sitter", "typescript"],
    metadata,
    portability: "off",
  });
  assert(explicitOff.bundle);
  assertEquals(explicitOff.diagnostics.length, 0);
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
    "outside Baba's portable regex subset",
  );
});

Deno.test("metadata rejects non-syntax feature blocks", () => {
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

Deno.test("compile reports structured Tree-sitter metadata diagnostics", () => {
  const unknownWord = compile(explicitGrammar, {
    targets: ["tree-sitter"],
    metadata: parseTreeSitterMetadata(JSON.stringify({
      version: 1,
      word: "missing",
    })),
  });
  assertEquals(unknownWord.bundle, undefined);
  assertEquals(unknownWord.diagnostics[0].code, "METADATA_UNKNOWN_REFERENCE");
  assertEquals(unknownWord.diagnostics[0].backend, "tree-sitter");
  assertEquals(unknownWord.diagnostics[0].path, "metadata.word");

  const invalidAlias = compile(explicitGrammar, {
    targets: ["tree-sitter"],
    metadata: parseTreeSitterMetadata(JSON.stringify({
      version: 1,
      rules: {
        module: {
          paths: {
            name: { alias_ref: "invalid-alias" },
          },
        },
      },
    })),
  });
  assertEquals(invalidAlias.diagnostics[0].code, "METADATA_INVALID_ALIAS");
  assertIncludes(invalidAlias.diagnostics[0].path ?? "", "alias_ref");
  assertEquals(invalidAlias.diagnostics[0].backend, "tree-sitter");

  const legacyPath = compile(explicitGrammar, {
    targets: ["tree-sitter"],
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
  });
  assertEquals(legacyPath.diagnostics[0].code, "METADATA_LEGACY_PATH");
  assertEquals(legacyPath.diagnostics[0].path, "metadata.rules.module.paths.1");

  const invalidExternal = compile(`module = "a" ;`, {
    targets: ["tree-sitter"],
    metadata: parseTreeSitterMetadata(JSON.stringify({
      version: 1,
      externals: ["bad-token"],
    })),
  });
  assertEquals(
    invalidExternal.diagnostics[0].code,
    "INVALID_EXTERNAL_TOKEN",
  );
  assertEquals(invalidExternal.diagnostics[0].path, "metadata.externals[0]");

  const unknownQueryNode = compile(
    `
    token ident = /[a-z]+/ ;
    module = ident ;
  `,
    {
      targets: ["tree-sitter"],
      metadata: parseTreeSitterMetadata(JSON.stringify({
        version: 1,
        queries: {
          locals: [{ node: "dead", capture: "local.definition" }],
        },
      })),
    },
  );
  assertEquals(
    unknownQueryNode.diagnostics[0].code,
    "METADATA_UNKNOWN_QUERY_NODE",
  );
  assertEquals(
    unknownQueryNode.diagnostics[0].path,
    "metadata.queries.locals[0].node",
  );
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
