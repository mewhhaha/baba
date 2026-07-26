import {
  applyBundle,
  assert,
  assertEquals,
  assertIncludes,
  assertNotIncludes,
  assertThrowsIncludes,
  compile,
  parseMetadata,
} from "./helpers.ts";

Deno.test("Tree-sitter target emits grammar.js and query files", () => {
  const metadata = parseMetadata(JSON.stringify({
    version: 2,
    queries: {
      highlights: {
        entries: [{ node: "IDENT", capture: "variable" }],
      },
    },
  }));
  const result = compile(
    `
      token IDENT = /[a-z]+/ ;
      skip WS = /[ \\t\\r\\n]+/ ;
      module = name:IDENT ;
    `,
    { name: "tiny", targets: ["tree-sitter"], metadata },
  );

  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);
  assertEquals(
    result.bundle.files.map((file) => file.path).join(","),
    "grammar.js,queries/generated-highlights.scm",
  );
  const grammar = generatedText(result.bundle.files, "grammar.js");
  assertIncludes(grammar, 'name: "tiny"');
  assertIncludes(grammar, "source_file: $ => $.module");
  assertIncludes(grammar, 'field("name", $.IDENT)');
  assertIncludes(grammar, "IDENT: $ => token(/[a-z]+/)");
  assertIncludes(grammar, "WS: $ => /[ \\t\\r\\n]+/");
});

Deno.test("Tree-sitter metadata renders conflicts precedence aliases and hidden rules", () => {
  const metadata = parseMetadata(JSON.stringify({
    version: 2,
    conflicts: [["expression", "application"]],
    inline: ["hidden_name"],
    rules: {
      expression: {
        wrap: { kind: "prec.left", value: 4 },
        paths: {
          name: { alias_ref: "function_name" },
          value: { alias_node: "optional_name" },
        },
      },
      application: {
        wrap: { kind: "prec.right", value: 3 },
      },
      hidden_name: {
        paths: { "": { hidden_path: true } },
      },
    },
  }));
  const result = compile(
    `
      token IDENT priority 7 = /[a-z]+/ ;
      contextual APPLICATION_WS = /[ \\t]+/ ;
      module = expression ;
      expression = name:IDENT value:(IDENT | "none") | application ;
      application = IDENT APPLICATION_WS hidden_name ;
      hidden_name = IDENT ;
    `,
    { name: "duck", targets: ["tree-sitter"], metadata },
  );

  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);
  const grammar = generatedText(result.bundle.files, "grammar.js");
  assertIncludes(grammar, "[$.expression, $.application]");
  assertIncludes(grammar, "inline: $ => [$.hidden_name]");
  assertIncludes(grammar, "prec.left(4, choice(");
  assertIncludes(grammar, "alias($.IDENT, $.function_name)");
  assertIncludes(grammar, "$.optional_name");
  assertIncludes(grammar, 'optional_name: $ => choice($.IDENT, "none")');
  assertIncludes(grammar, "prec.right(3, seq(");
  assertIncludes(grammar, "IDENT: $ => token(prec(7, /[a-z]+/))");
  assertIncludes(grammar, "APPLICATION_WS: $ => token(/[ \\t]+/)");
});

Deno.test("Tree-sitter target emits guarded contextual tokens as externals", () => {
  const result = compile(
    `
      contextual APPLICATION_WS = /[ \\t]+(?=[a-z])(?!(if|in)\\b)/ ;
      module = "f" APPLICATION_WS "x" ;
    `,
    {
      name: "duck",
      targets: ["tree-sitter"],
    },
  );

  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);
  assertEquals(
    result.bundle.files.map((file) => file.path).join(","),
    "grammar.js,queries/generated-highlights.scm,src/scanner.c",
  );
  const grammar = generatedText(result.bundle.files, "grammar.js");
  assertIncludes(grammar, "externals: $ => [");
  assertIncludes(grammar, "$.APPLICATION_WS");
  assertIncludes(grammar, "$._baba_error_sentinel");
  assertNotIncludes(grammar, "APPLICATION_WS: $ =>");
  const scanner = generatedText(result.bundle.files, "src/scanner.c");
  assertIncludes(
    scanner,
    "bool tree_sitter_duck_external_scanner_scan(",
  );
  assertIncludes(scanner, "BABA_WORD_CODE_POINTS");
});

Deno.test("Tree-sitter target rejects negative-only contextual guards", () => {
  const result = compile(
    `
      contextual APPLICATION_WS = /[ \\t]+(?!;)/ ;
      module = "f" APPLICATION_WS "x" ;
    `,
    { name: "duck", targets: ["tree-sitter"] },
  );

  assertEquals(result.bundle, undefined);
  assert(
    result.diagnostics.some((diagnostic) =>
      diagnostic.code === "TREE_SITTER_UNSUPPORTED_CONTEXTUAL_GUARD"
    ),
  );
});

Deno.test("Tree-sitter target rejects guarded token fallback it cannot preserve", () => {
  const result = compile(
    `
      contextual PREFIX = /a+(?=a)/ ;
      module = PREFIX ;
    `,
    { name: "fallback", targets: ["tree-sitter"] },
  );

  assertEquals(result.bundle, undefined);
  assert(
    result.diagnostics.some((diagnostic) =>
      diagnostic.code === "TREE_SITTER_UNSUPPORTED_CONTEXTUAL_GUARD" &&
      diagnostic.message.includes("overlaps a longer guarded token match")
    ),
  );
});

Deno.test("external scanner metadata remains rejected", () => {
  assertThrowsIncludes(
    () =>
      parseMetadata(JSON.stringify({
        version: 2,
        externals: ["APPLICATION_WS"],
      })),
    "Unknown metadata key 'externals'",
  );
});

Deno.test("Tree-sitter-only generation does not plan a Wasm runtime", () => {
  const result = compile(`module = "ok" ;`, {
    targets: ["tree-sitter"],
  });

  assert(result.bundle);
  assertEquals(result.diagnostics.length, 0);
  assertEquals(
    result.bundle.files.map((file) => file.path).join(","),
    "grammar.js",
  );
});

Deno.test("all targets emit grammar.js and the Wasm bundle", () => {
  const result = compile(`module = "ok" ;`, {
    targets: ["wasm", "tree-sitter"],
  });

  assert(result.bundle);
  const paths = result.bundle.files.map((file) => file.path);
  assert(paths.includes("grammar.js"));
  assert(paths.includes("wasm/parser.wasm"));
});

Deno.test("generated grammar.js builds and parses with Tree-sitter", async () => {
  const metadata = parseMetadata(JSON.stringify({
    version: 2,
    rules: {
      module: {
        paths: { name: { alias_ref: "function_name" } },
      },
      hidden_name: {
        paths: { "": { hidden_path: true } },
      },
    },
  }));
  const result = compile(
    `
      token IDENT = /[a-z]+/ ;
      skip WS = /[ \\t\\r\\n]+/ ;
      module = name:IDENT hidden_name ;
      hidden_name = "(" IDENT ")" ;
    `,
    { name: "tiny", targets: ["tree-sitter"], metadata },
  );
  assert(result.bundle);

  const directory = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: directory });
    await Deno.writeTextFile(`${directory}/sample.tiny`, "name(other)");
    await runTreeSitter(directory, ["generate"]);
    await runTreeSitter(directory, ["build"]);
    const parsed = await runTreeSitter(directory, ["parse", "sample.tiny"]);
    assertIncludes(parsed, "(source_file");
    assertNotIncludes(parsed, "ERROR");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("generated Tree-sitter scanner enforces contextual guards", async () => {
  const result = compile(
    `
      token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
      skip WS = /[ \\t\\r\\n]+/ ;
      contextual APPLICATION_SPACE =
        /[ \\t]+(?=[A-Za-z_])(?!(if|in)\\b)/ ;
      contextual TYPE_APPLICATION_SPACE =
        /[ \\t]+(?=[A-Za-z_#&]|\\(|\\[)/ ;
      contextual TERMINATOR_SPACE =
        /[ \\t]+(?=$|[\\r\\n;}])/ ;

      document = application_case | type_case | terminator_case ;
      application_case = "app:" first:application "if" second:application ;
      application = head:IDENT (APPLICATION_SPACE arguments:IDENT)* ;
      type_case =
        "type:" constructor:IDENT TYPE_APPLICATION_SPACE argument:IDENT ;
      terminator_case = "end:" value:IDENT TERMINATOR_SPACE ;
    `,
    { name: "guarded", targets: ["tree-sitter"] },
  );
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const directory = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: directory });
    await Deno.writeTextFile(
      `${directory}/application.guarded`,
      "app:f x if y z",
    );
    await Deno.writeTextFile(
      `${directory}/type.guarded`,
      "type:Option Value",
    );
    await Deno.writeTextFile(
      `${directory}/terminator.guarded`,
      "end:value   ",
    );
    await runTreeSitter(directory, ["generate"]);
    await runTreeSitter(directory, ["build"]);
    const parsed = await runTreeSitter(directory, [
      "parse",
      "application.guarded",
      "type.guarded",
      "terminator.guarded",
    ]);
    assertNotIncludes(parsed, "ERROR");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("generated Tree-sitter scanner resolves guarded alternatives together", async () => {
  const result = compile(
    `
      token IDENT = /[a-z]+/ ;
      skip WS = /[ \\t\\r\\n]+/ ;
      contextual LONG priority 2 = /[ \\t]+(?=ab)/ ;
      contextual SHORT priority 1 = /[ \\t]+(?=a)/ ;
      module = "value:" (LONG | SHORT) IDENT ;
    `,
    { name: "alternatives", targets: ["tree-sitter"] },
  );
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const directory = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: directory });
    await Deno.writeTextFile(`${directory}/sample.alt`, "value: ax");
    await runTreeSitter(directory, ["generate"]);
    await runTreeSitter(directory, ["build"]);
    const parsed = await runTreeSitter(directory, ["parse", "sample.alt"]);
    assertIncludes(parsed, "(SHORT ");
    assertNotIncludes(parsed, "ERROR");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

async function runTreeSitter(
  directory: string,
  args: string[],
): Promise<string> {
  const command = new Deno.Command("tree-sitter", {
    args,
    cwd: directory,
    stdout: "piped",
    stderr: "piped",
    env: {
      HOME: `${directory}/home`,
      XDG_CACHE_HOME: `${directory}/cache`,
    },
  });
  const output = await command.output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);
  assert(output.success, `${args.join(" ")} failed:\n${stderr}`);
  assertNotIncludes(stderr, "Error");
  return stdout;
}

function generatedText(
  files: readonly {
    readonly path: string;
    readonly content: string | Uint8Array;
  }[],
  path: string,
): string {
  const file = files.find((candidate) => candidate.path === path);
  assert(file, `Expected generated file '${path}'.`);
  assert(typeof file.content === "string", `Expected '${path}' to be text.`);
  return file.content;
}
