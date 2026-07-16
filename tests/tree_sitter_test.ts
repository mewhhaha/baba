import {
  applyBundle,
  assert,
  assertEquals,
  assertIncludes,
  assertNotIncludes,
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

Deno.test("Tree-sitter metadata renders conflicts precedence aliases hidden rules and externals", () => {
  const metadata = parseMetadata(JSON.stringify({
    version: 2,
    externals: ["APPLICATION_WS"],
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
  assertIncludes(grammar, "externals: $ => [$.APPLICATION_WS]");
  assertIncludes(grammar, "[$.expression, $.application]");
  assertIncludes(grammar, "inline: $ => [$.hidden_name]");
  assertIncludes(grammar, "prec.left(4, choice(");
  assertIncludes(grammar, "alias($.IDENT, $.function_name)");
  assertIncludes(grammar, "$.optional_name");
  assertIncludes(grammar, 'optional_name: $ => choice($.IDENT, "none")');
  assertIncludes(grammar, "prec.right(3, seq(");
  assertIncludes(grammar, "IDENT: $ => token(prec(7, /[a-z]+/))");
});

Deno.test("external scanners are accepted only by the Tree-sitter target", () => {
  const metadata = parseMetadata(JSON.stringify({
    version: 2,
    externals: ["APPLICATION_WS"],
  }));
  const source = `module = "f" APPLICATION_WS "x" ;`;

  const treeSitter = compile(source, {
    name: "duck",
    targets: ["tree-sitter"],
    metadata,
  });
  assert(treeSitter.bundle);
  assertEquals(treeSitter.diagnostics.length, 0);

  const wasm = compile(source, { targets: ["wasm"], metadata });
  assertEquals(wasm.bundle, undefined);
  assert(
    wasm.diagnostics.some((diagnostic) =>
      diagnostic.code === "PORTABLE_EXTERNAL_TOKENS_UNSUPPORTED"
    ),
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

Deno.test("generated grammar.js is accepted by Tree-sitter", async () => {
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
    const command = new Deno.Command("tree-sitter", {
      args: ["generate"],
      cwd: directory,
      stdout: "piped",
      stderr: "piped",
      env: {
        HOME: `${directory}/home`,
        XDG_CACHE_HOME: `${directory}/cache`,
      },
    });
    const output = await command.output();
    const error = new TextDecoder().decode(output.stderr);
    assert(output.success, error);
    assertNotIncludes(error, "Error");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

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
