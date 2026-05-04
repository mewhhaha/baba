import {
  generate,
  generateInitBundle,
  parseGrammar,
  parseMetadata,
  validateGrammar,
} from "../src/mod.ts";
import {
  createLexicalSpec,
  formatEbnfError,
  generateAstTypesSource,
  generateAstVisitorSource,
  generateFormatterScaffoldSource,
  generateLspScaffoldSource,
  generateParserSource,
  generateTokenizerSource,
  generateTreeSitterFoldsQuery,
  generateTreeSitterGrammar,
  generateTreeSitterHighlightsQuery,
  generateTreeSitterIndentsQuery,
  generateTreeSitterInjectionsQuery,
  generateTreeSitterLocalsQuery,
  generateTreeSitterRainbowsQuery,
  generateTreeSitterTagsQuery,
  generateTreeSitterTextobjectsQuery,
  generateWorkbenchBundle,
  generateWorkbenchQueries,
  parseEbnf,
  parseTreeSitterMetadata,
  validateEbnfGrammar,
} from "../src/advanced.ts";
import { BabaError, formatDiagnostic } from "../src/errors.ts";
import { EbnfError } from "../src/parser.ts";
import { main } from "../src/cli.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
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

interface GeneratedToken {
  kind: string;
  text: string;
  span: { start: number; end: number };
}

interface GeneratedBundleLike {
  files: Array<{ path: string; content: string }>;
}

function fileMap(bundle: GeneratedBundleLike): Record<string, string> {
  return Object.fromEntries(
    bundle.files.map((file) => [file.path, file.content]),
  );
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
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    await action();
  } finally {
    console.log = original;
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

async function denoCheck(paths: string[]): Promise<void> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["check", ...paths],
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
): Promise<void> {
  const command = new Deno.Command(commandName, { args, cwd, env });
  const output = await command.output();
  if (!output.success) {
    const decoder = new TextDecoder();
    throw new Error(
      `${commandName} ${args.join(" ")} failed\n${
        decoder.decode(output.stdout)
      }${decoder.decode(output.stderr)}`,
    );
  }
}

async function writeGeneratedBundle(
  dir: string,
  bundle: GeneratedBundleLike,
): Promise<void> {
  for (const { path, content } of bundle.files) {
    const slash = path.lastIndexOf("/");
    if (slash !== -1) {
      await Deno.mkdir(`${dir}/${path.slice(0, slash)}`, {
        recursive: true,
      });
    }
    await Deno.writeTextFile(`${dir}/${path}`, content);
  }
}

Deno.test("parses EBNF rules and derives lexical terminals", () => {
  const grammar = parseEbnf(`
    module = { function } ;
    function = [ "export" ] "fn" ident "(" ")" "->" "i32" block ;
    block = "{" "}" ;
  `);

  const spec = createLexicalSpec(grammar);
  assert(spec.keywords.includes("export"));
  assert(spec.keywords.includes("fn"));
  assert(spec.keywords.includes("i32"));
  assert(spec.symbols.includes("->"));
  assert(spec.symbols.includes("("));
});

Deno.test("parser records spans and token declarations", () => {
  const grammar = parseEbnf(`
  token ident = /[a-z]+/ ;
  skip whitespace = /[ \\t]+/ ;
  module = ident+ ;
`);

  assertEquals(grammar.tokens.length, 2);
  assertEquals(grammar.tokens[0].kind, "token");
  assertEquals(grammar.tokens[0].name, "ident");
  assertEquals(grammar.tokens[0].pattern, "[a-z]+");
  assertEquals(grammar.tokens[0].span.line, 2);
  assertEquals(grammar.tokens[0].span.column, 3);
  assertEquals(grammar.tokens[1].kind, "skip");
  assertEquals(grammar.rules[0].expression.kind, "repeat1");
  assertEquals(grammar.rules[0].expression.span.line, 4);

  const groupedSource = `module = ( ident % "," )? ;`;
  const grouped = parseEbnf(groupedSource);
  const expression = grouped.rules[0].expression;
  assertEquals(expression.kind, "optional");
  assertEquals(expression.span.start, groupedSource.indexOf("("));
});

Deno.test("formats parse diagnostics with line and marker", () => {
  let error: unknown;
  try {
    parseEbnf(`module = "unterminated`);
  } catch (caught) {
    error = caught;
  }

  assert(error instanceof EbnfError);
  assertEquals(error.line, 1);
  assertEquals(error.column, 10);
  const formatted = formatEbnfError(error);
  assertIncludes(formatted, "Unterminated string literal at 1:10");
  assertIncludes(formatted, `module = "unterminated`);
  assertIncludes(formatted, "^");
});

Deno.test("reports unterminated regex diagnostics", () => {
  let error: unknown;
  try {
    parseEbnf(`token bad = /abc`);
  } catch (caught) {
    error = caught;
  }

  assert(error instanceof EbnfError);
  assertEquals(error.line, 1);
  assertEquals(error.column, 13);
  assertIncludes(error.message, "Unterminated regex literal at 1:13");
});

Deno.test("generates tokenizer and tree-sitter starter sources", () => {
  const source = `
    module = function ;
    function = "fn" ident "(" ")" block ;
    block = "{" "}" ;
  `;

  const tokenizer = generateTokenizerSource(source);
  assertIncludes(tokenizer, "export function lex(source: string): Token[]");
  assertIncludes(
    tokenizer,
    "function scanNumericLiteral(source: string, start: number): number",
  );
  const treeSitter = generateTreeSitterGrammar(source, { name: "tiny" });
  assertIncludes(treeSitter, "export default grammar({");
  assertIncludes(treeSitter, 'name: "tiny"');
  assert(
    !treeSitter.includes("module.exports"),
    "Expected tree-sitter output to be ESM-only",
  );
});

Deno.test("generated parser parses and projects deterministic grammars", async () => {
  const source = `
    token ident = /[A-Za-z_][A-Za-z0-9_]*/ ;
    token int = /[0-9]+/ ;
    module = function+ ;
    function = [ "export" ] "fn" ident "(" params? ")" block ;
    params = param % "," ;
    param = ident ":" ident ;
    block = "{" statement* "}" ;
    statement = "let" ident "=" int ";" ;
  `;
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${dir}/tokenizer.ts`,
    generateTokenizerSource(source),
  );
  await Deno.writeTextFile(`${dir}/parser.ts`, generateParserSource(source));
  await Deno.writeTextFile(
    `${dir}/parser_test.ts`,
    `import { parse, projectParseNode } from "./parser.ts";
const result = parse("export fn add(a: i32,b: i32){ let answer = 42; }");
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
if (result.tree?.kind !== "rule" || result.tree.name !== "module") throw new Error("missing module tree");
if (result.tree.span.start !== 0) throw new Error("missing root span");
if (!result.tree.children.some((child) => child.kind === "rule" && child.name === "function")) throw new Error("missing function child");
const functionNode = result.tree.children.find((child) => child.kind === "rule" && child.name === "function");
if (!functionNode || !("children" in functionNode)) throw new Error("missing function node");
if (!functionNode.children.some((child) => child.kind === "literal" && child.value === "fn")) throw new Error("missing literal node");
if (!functionNode.children.some((child) => child.kind === "token" && child.name === "ident" && child.text === "add")) throw new Error("missing token node");
if (result.ast?.kind !== "module") throw new Error("missing ast");
if (projectParseNode(functionNode)?.kind !== "function") throw new Error("missing projected function ast");
const invalid = parse("fn add(");
if (invalid.ok || invalid.diagnostics.length === 0) throw new Error("expected invalid input diagnostics");
`,
  );
  await denoCheck([`${dir}/parser_test.ts`]);
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", `${dir}/parser_test.ts`],
  });
  const output = await command.output();
  if (!output.success) {
    const decoder = new TextDecoder();
    throw new Error(
      `${decoder.decode(output.stdout)}${decoder.decode(output.stderr)}`,
    );
  }
});

Deno.test("generated parser supports layout tokens", async () => {
  const source = `
    module = block ;
    block = "do" newline indent statement+ dedent ;
    statement = ident newline ;
  `;
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${dir}/tokenizer.ts`,
    generateTokenizerSource(source),
  );
  await Deno.writeTextFile(`${dir}/parser.ts`, generateParserSource(source));
  await Deno.writeTextFile(
    `${dir}/layout_test.ts`,
    `import { parse } from "./parser.ts";
const result = parse("do\\n  alpha\\n  beta\\n");
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
if (!result.tokens.some((token) => token.kind === "indent")) throw new Error("missing indent");
if (!result.tokens.some((token) => token.kind === "dedent")) throw new Error("missing dedent");
`,
  );
  await denoCheck([`${dir}/layout_test.ts`]);
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", `${dir}/layout_test.ts`],
  });
  const output = await command.output();
  if (!output.success) {
    const decoder = new TextDecoder();
    throw new Error(
      `${decoder.decode(output.stdout)}${decoder.decode(output.stderr)}`,
    );
  }
});

Deno.test("tree-sitter keeps root rule addressable by other rules", () => {
  const source = `
    module = expr ;
    expr = module | ident ;
  `;

  const treeSitter = generateTreeSitterGrammar(source, { name: "tiny" });
  assertIncludes(treeSitter, "source_file: $ => $.expr");
  assertIncludes(treeSitter, "module: $ => $.expr");
  assertIncludes(treeSitter, "expr: $ => choice($.module, $.ident)");
});

Deno.test("postfix operators and separated lists generate tree-sitter rules", () => {
  const source = `
    module = item+ ;
    maybe = item? ;
    many = item* ;
    list = item % "," ;
    optional_list = ( item % "," )? ;
    item = ident ;
  `;

  const treeSitter = generateTreeSitterGrammar(source, { name: "tiny" });
  assertIncludes(treeSitter, "module: $ => repeat1($.item)");
  assertIncludes(treeSitter, "maybe: $ => optional($.item)");
  assertIncludes(treeSitter, "many: $ => repeat($.item)");
  assertIncludes(
    treeSitter,
    'list: $ => seq($.item, repeat(seq(",", $.item)))',
  );
  assertIncludes(
    treeSitter,
    'optional_list: $ => optional(seq($.item, repeat(seq(",", $.item))))',
  );
});

Deno.test("builtins for int char and string literals generate stable tokenizer and tree-sitter rules", () => {
  const source = `
    module = value ;
    value = int | char | string ;
  `;

  const tokenizer = generateTokenizerSource(source);
  assertIncludes(tokenizer, '| "char"');
  assertIncludes(tokenizer, '| "string"');
  assertIncludes(tokenizer, 'return { kind: "char"');
  assertIncludes(tokenizer, 'return { kind: "string"');
  assertIncludes(
    tokenizer,
    "function scanCharLiteral(source: string, start: number): number",
  );
  assertIncludes(
    tokenizer,
    "function scanStringLiteral(source: string, start: number): number",
  );
  const treeSitter = generateTreeSitterGrammar(source, { name: "tiny" });
  assertIncludes(
    treeSitter,
    "int: $ => token(choice(/[0-9](?:_?[0-9])*/, /0[xX][0-9A-Fa-f](?:_?[0-9A-Fa-f])*/, /0[bB][01](?:_?[01])*/)),",
  );
  assertIncludes(
    treeSitter,
    `char: $ => token(seq("'", choice(/[^'\\\\\\n\\r]/, /\\\\[0nrt'\\\\]/, /\\\\x[0-9A-Fa-f]{2}/, /\\\\u\\{[0-9A-Fa-f]+\\}/), "'")),`,
  );
  assertIncludes(
    treeSitter,
    `string: $ => token(seq('"', repeat(choice(/[^"\\\\\\n\\r]/, /\\\\[0nrt"\\\\]/, /\\\\x[0-9A-Fa-f]{2}/, /\\\\u\\{[0-9A-Fa-f]+\\}/)), '"')),`,
  );
});

Deno.test("tree-sitter metadata drives fields, precedence, and conflicts", () => {
  const source = `
    module = { top_item | blank_line } ;
    top_item = function_signature | function_clause ;
    blank_line = newline ;
    function_signature = "fun" ident "(" ")" "->" type newline ;
    function_clause = "fun" ident "(" [ pattern_list ] ")" "->" ( newline clause_body | expr ) "." newline ;
    pattern_list = pattern { "," pattern } ;
    pattern = int | ident ;
    clause_body = { statement | blank_line } expr ;
    statement = return_stmt ;
    return_stmt = "return" expr stmt_sep ;
    stmt_sep = "," newline | newline ;
    expr = comparison ;
    comparison = additive { ( "==" | "!=" ) additive } ;
    additive = primary { "+" primary } ;
    primary = int | ident | call ;
    call = ident "(" [ args ] ")" ;
    args = expr { "," expr } ;
    type = "i32" ;
  `;

  const metadata = parseTreeSitterMetadata(JSON.stringify({
    extras: [
      { kind: "regex", value: "[ \\t\\r]" },
      { kind: "rule", name: "line_comment" },
    ],
    word: "ident",
    supertypes: ["expr"],
    conflicts: [["pattern", "type"]],
    rules: {
      function_signature: {
        fields: { "1": "name", "6": "result" },
      },
      function_clause: {
        fields: {
          "1": "name",
          "6.0.1": "body",
          "6.1": "value",
        },
      },
      clause_body: {
        fields: { "1": "value" },
      },
      comparison: {
        wrap: { kind: "prec.left" },
      },
      call: {
        fields: { "0": "name" },
        wrap: { kind: "prec", value: 1 },
      },
      pattern: {
        paths: {
          "1": { alias_ref: "name_pattern" },
        },
      },
    },
  }));

  const treeSitter = generateTreeSitterGrammar(source, {
    name: "tiny",
    metadata,
  });
  assertIncludes(treeSitter, "word: $ => $.ident");
  assertIncludes(treeSitter, "supertypes: $ => [$.expr]");
  assertIncludes(treeSitter, "conflicts: $ => [");
  assertIncludes(treeSitter, 'field("name", $.ident)');
  assertIncludes(treeSitter, 'field("body", $.clause_body)');
  assertIncludes(treeSitter, "prec.left(");
  assertIncludes(treeSitter, "prec(1,");
  assertIncludes(treeSitter, "alias($.ident, $.name_pattern)");
});

Deno.test("tree-sitter metadata supports hidden paths and nested wraps", () => {
  const source = `
    module = list ;
    list = item { "," item } ;
    item = ident | ident "(" [ args ] ")" ;
    args = ident { "," ident } ;
  `;

  const metadata = parseTreeSitterMetadata(JSON.stringify({
    inline: ["args"],
    rules: {
      list: {
        paths: {
          "": { hidden_path: true },
          "0": { alias_ref: "item_ref" },
          "1.0.1": { wrap: { kind: "prec.left", value: 2 } },
        },
      },
      item: {
        paths: {
          "1": { alias_node: "call_item" },
        },
      },
    },
  }));

  const treeSitter = generateTreeSitterGrammar(source, {
    name: "tiny",
    metadata,
  });
  assertIncludes(treeSitter, "inline: $ => [$.args, $.list]");
  assertIncludes(treeSitter, "alias($.item, $.item_ref)");
  assertIncludes(treeSitter, "item: $ => choice($.ident, $.call_item)");
  assertIncludes(
    treeSitter,
    'call_item: $ => seq($.ident, "(", optional($.args), ")")',
  );
  assertIncludes(treeSitter, "prec.left(2, $.item)");
});

Deno.test("tree-sitter metadata can force postfix associativity and ambiguity conflicts", () => {
  const source = `
    expr = postfix "." ident | ident "{" ident "=" ident "}" | ident ;
    postfix = ident { "." ident } ;
    primary = ident | postfix ;
    arg = expr ;
  `;

  const metadata = parseTreeSitterMetadata(JSON.stringify({
    conflicts: [["primary", "postfix"], ["primary", "arg"]],
    rules: {
      postfix: {
        wrap: { kind: "prec.left" },
      },
    },
  }));

  const treeSitter = generateTreeSitterGrammar(source, {
    name: "tiny",
    metadata,
  });
  assertIncludes(treeSitter, "conflicts: $ => [");
  assertIncludes(treeSitter, "[$.primary, $.postfix]");
  assertIncludes(treeSitter, "[$.primary, $.arg]");
  assertIncludes(treeSitter, "postfix: $ => prec.left(");
});

Deno.test("tree-sitter metadata can emit immediate literal tokens", () => {
  const source = `
    expr = ident dot_immediate ident | ident "." ;
    dot_immediate = "." ;
  `;

  const metadata = parseTreeSitterMetadata(JSON.stringify({
    inline: ["dot_immediate"],
    rules: {
      dot_immediate: {
        token: { kind: "token.immediate" },
      },
    },
  }));

  const treeSitter = generateTreeSitterGrammar(source, {
    name: "tiny",
    metadata,
  });
  assertIncludes(treeSitter, "inline: $ => [$.dot_immediate]");
  assertIncludes(treeSitter, 'dot_immediate: $ => token.immediate(".")');
});

Deno.test("tree-sitter metadata can generate rainbow queries", () => {
  const source = `
    module = function ;
    function = "fun" ident "(" ")" block ;
    block = "{" "}" ;
  `;

  const metadata = parseTreeSitterMetadata(JSON.stringify({
    queries: {
      rainbows: {
        scopes: ["function", "block"],
      },
    },
  }));

  const rainbows = generateTreeSitterRainbowsQuery(source, { metadata });
  assertIncludes(rainbows, "(function)");
  assertIncludes(rainbows, "(block)");
  assertIncludes(rainbows, '"("');
  assertIncludes(rainbows, '"{"');
  assertIncludes(rainbows, "@rainbow.scope");
  assertIncludes(rainbows, "@rainbow.bracket");
});

Deno.test("WGSL builtin emits open, content, and close nodes for injections", () => {
  const source = `
    module = shader_decl ;
    shader_decl = "shader" ident "=" wgsl_block "." ;
  `;

  const treeSitter = generateTreeSitterGrammar(source, { name: "tiny" });
  assertIncludes(
    treeSitter,
    "wgsl_block: $ => choice(seq($.wgsl_open, $.wgsl_close), seq($.wgsl_open, $.wgsl_content, $.wgsl_close))",
  );
  assertIncludes(treeSitter, 'wgsl_open: $ => token("```wgsl")');
  assertIncludes(treeSitter, "wgsl_content: $ => repeat1(choice(");
  assertIncludes(treeSitter, 'wgsl_close: $ => token.immediate("```")');
});

Deno.test("tree-sitter metadata can generate injection queries", () => {
  const source = `
    module = shader_decl ;
    shader_decl = "shader" ident "=" wgsl_block "." ;
  `;

  const metadata = parseTreeSitterMetadata(JSON.stringify({
    queries: {
      injections: [
        { node: "wgsl_content", language: "wgsl" },
      ],
    },
  }));

  const injections = generateTreeSitterInjectionsQuery(source, { metadata });
  assertIncludes(injections, "((wgsl_content) @injection.content");
  assertIncludes(injections, '(#set! injection.language "wgsl"))');
});

Deno.test("workbench query generators emit metadata and defaults", () => {
  const source = `
    token ident = /[a-z]+/ ;
    module = function ;
    function = "fn" ident "(" ")" block ;
    block = "{" "}" ;
  `;
  const metadata = parseTreeSitterMetadata(JSON.stringify({
    queries: {
      highlights: [
        { node: "function", capture: "function" },
        { literal: "fn", capture: "keyword.function" },
      ],
      locals: [{ node: "ident", capture: "local.definition" }],
      folds: [{ node: "block", capture: "fold" }],
      indents: [{ literal: "{", capture: "indent.begin" }],
      tags: [{ node: "function", capture: "tag.definition" }],
      textobjects: [{ node: "function", capture: "function.outer" }],
    },
  }));

  const highlights = generateTreeSitterHighlightsQuery(source, { metadata });
  assertIncludes(highlights, "(function) @function");
  assertIncludes(highlights, '"fn" @keyword.function');
  assertIncludes(highlights, '"(" @punctuation.bracket');
  assertIncludes(highlights, "(ident) @variable");
  assertIncludes(
    generateTreeSitterLocalsQuery(source, { metadata }),
    "(ident) @local.definition",
  );
  assertIncludes(
    generateTreeSitterFoldsQuery(source, { metadata }),
    "(block) @fold",
  );
  assertIncludes(
    generateTreeSitterIndentsQuery(source, { metadata }),
    '"{" @indent.begin',
  );
  assertIncludes(
    generateTreeSitterTagsQuery(source, { metadata }),
    "(function) @tag.definition",
  );
  assertIncludes(
    generateTreeSitterTextobjectsQuery(source, { metadata }),
    "(function) @function.outer",
  );

  const queries = generateWorkbenchQueries(source, { metadata });
  assertIncludes(queries["highlights.scm"], "@keyword.function");
  assertIncludes(queries["textobjects.scm"], "(function) @function.outer");
  assertEquals(queries["rainbows.scm"].length > 0, true);
});

Deno.test("highlight generation suppresses default literals wrapped by named nodes", () => {
  const source = `
    module = Visibility ;
    Visibility = "pub" ;
  `;
  const metadata = parseTreeSitterMetadata(JSON.stringify({
    queries: {
      highlights: [{ node: "Visibility", capture: "keyword" }],
    },
  }));

  const highlights = generateTreeSitterHighlightsQuery(source, { metadata });
  assertIncludes(highlights, "(Visibility) @keyword");
  assertNotIncludes(highlights, '"pub" @keyword');
});

Deno.test("highlight defaults only reference exposed tree-sitter nodes", () => {
  const source = `
    token ident = /[a-z]+/ ;
    module = "fn" ident ;
  `;

  const highlights = generateTreeSitterHighlightsQuery(source);
  assertIncludes(highlights, "(ident) @variable");
  assertNotIncludes(highlights, "(string) @string");
  assertNotIncludes(highlights, "(char) @string.special");
  assertNotIncludes(highlights, "(int) @number");
});

Deno.test("generated workbench tree-sitter queries compile", async () => {
  const source = `
    token ident = /[a-z]+/ ;
    module = Visibility function block ;
    Visibility = "pub" ;
    function = "fn" ident "(" ")" block ;
    block = "{" "}" ;
  `;
  const metadata = parseTreeSitterMetadata(JSON.stringify({
    queries: {
      highlights: [{ node: "Visibility", capture: "keyword" }],
      tags: [{ node: "function", capture: "name.definition.function" }],
      textobjects: [{ node: "function", capture: "function.outer" }],
      rainbows: {
        scopes: ["function", "block"],
        brackets: ["(", ")", "{", "}"],
      },
    },
  }));
  const dir = await Deno.makeTempDir();
  const bundle = generateWorkbenchBundle(source, {
    name: "tiny",
    metadata,
  });
  const files = fileMap(bundle);

  assertIncludes(files["README.md"], "queries/highlights.scm");
  assertIncludes(files["README.md"], "metadata.queries.textobjects");
  assertIncludes(files["queries/highlights.scm"], "(Visibility) @keyword");
  assertNotIncludes(files["queries/highlights.scm"], '"pub" @keyword');
  assertNotIncludes(files["queries/highlights.scm"], "(string) @string");

  await writeGeneratedBundle(dir, bundle);
  await Deno.mkdir(`${dir}/cache`, { recursive: true });
  await Deno.writeTextFile(`${dir}/sample.tiny`, "pub fn example() {}\n");
  await runCommand("tree-sitter", ["generate"], dir);
  for (
    const query of [
      "highlights.scm",
      "textobjects.scm",
      "tags.scm",
      "rainbows.scm",
    ]
  ) {
    await runCommand(
      "tree-sitter",
      [
        "query",
        "--quiet",
        "--grammar-path",
        dir,
        `queries/${query}`,
        "sample.tiny",
      ],
      dir,
      { XDG_CACHE_HOME: `${dir}/cache` },
    );
  }
});

Deno.test("stable API parses validates and generates deterministic bundles", () => {
  const source = `module = "fn" ident ;`;
  const grammar = parseGrammar(source);
  assertEquals(validateGrammar(grammar).length, 0);
  const metadata = parseMetadata(JSON.stringify({
    queries: {
      highlights: [{ literal: "fn", capture: "keyword.function" }],
      textobjects: [{ node: "module", capture: "module.outer" }],
    },
  }));

  const core = generate(grammar, { name: "tiny", metadata });
  assertEquals(core.preset, "core");
  assertEquals(
    core.files.map((file) => file.path).join(","),
    "grammar.js,lexical.json,parser.ts,textobjects.scm,tokenizer.ts",
  );
  assertIncludes(
    core.files.find((file) => file.path === "textobjects.scm")?.content ?? "",
    "(module) @module.outer",
  );
  assertEquals(
    core.cleanupPaths?.join(","),
    "injections.scm,rainbows.scm",
  );
  assertEquals(
    core.files.map((file) => file.path).join(","),
    [...core.files].sort((left, right) => left.path.localeCompare(right.path))
      .map((file) => file.path)
      .join(","),
  );

  const workbench = generate(source, {
    name: "tiny",
    metadata,
    preset: "workbench",
  });
  assertEquals(workbench.preset, "workbench");
  assertIncludes(
    workbench.files.map((file) => `${file.kind}:${file.path}`).join("\n"),
    "query:queries/highlights.scm",
  );
  assertIncludes(
    workbench.files.map((file) => `${file.kind}:${file.path}`).join("\n"),
    "query:queries/textobjects.scm",
  );

  const cleanupCore = generate(grammar, { name: "tiny" });
  assertEquals(
    cleanupCore.cleanupPaths?.join(","),
    "injections.scm,rainbows.scm,textobjects.scm",
  );

  const diagnostics = validateGrammar(parseGrammar(`module = missing ;`));
  assertEquals(diagnostics.length, 1);
  assertIncludes(diagnostics[0].message, "Unknown rule reference");
});

Deno.test("stable diagnostics use BabaError and formatting", () => {
  let error: unknown;
  try {
    parseGrammar(`module = "unterminated`);
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof BabaError);
  assertEquals(error.code, "EBNF_PARSE_ERROR");
  assertIncludes(formatDiagnostic(error), "EBNF_PARSE_ERROR");

  let metadataError: unknown;
  try {
    parseMetadata(`[]`);
  } catch (caught) {
    metadataError = caught;
  }
  assert(metadataError instanceof BabaError);
  assertEquals(metadataError.code, "METADATA_SHAPE_ERROR");
  assertEquals(metadataError.path, "metadata");

  let jsonError: unknown;
  try {
    parseMetadata(`{`);
  } catch (caught) {
    jsonError = caught;
  }
  assert(jsonError instanceof BabaError);
  assertEquals(jsonError.code, "METADATA_JSON_ERROR");
  assertEquals(jsonError.path, "metadata");

  let nestedMetadataError: unknown;
  try {
    parseMetadata(JSON.stringify({
      queries: { highlights: { node: "x", capture: "keyword" } },
    }));
  } catch (caught) {
    nestedMetadataError = caught;
  }
  assert(nestedMetadataError instanceof BabaError);
  assertEquals(nestedMetadataError.code, "METADATA_SHAPE_ERROR");
  assertEquals(nestedMetadataError.path, "metadata.queries.highlights");

  let semanticMetadataError: unknown;
  try {
    generate(`module = "fn" ident ;`, {
      metadata: parseMetadata(JSON.stringify({
        queries: { highlights: [{ node: "missing", capture: "keyword" }] },
      })),
    });
  } catch (caught) {
    semanticMetadataError = caught;
  }
  assert(semanticMetadataError instanceof BabaError);
  assertEquals(semanticMetadataError.code, "METADATA_SEMANTIC_ERROR");
});

Deno.test("init bundle is generated through the stable API", () => {
  const bundle = generateInitBundle({ name: "tiny" });
  const files = fileMap(bundle);
  assertEquals(bundle.preset, "workbench");
  assertEquals(
    bundle.files.map((file) => file.path).join(","),
    "baba.json,grammar.ebnf,README.md,samples/main.tiny",
  );
  assertIncludes(files["grammar.ebnf"], "module = function+");
  assertIncludes(files["baba.json"], "source.tiny");
  assertIncludes(files["samples/main.tiny"], "fn main");
});

Deno.test("root and advanced entrypoints expose intended APIs", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const rootPath = `${dir}/root.ts`;
    await Deno.writeTextFile(
      rootPath,
      `import { generate, generateInitBundle, parseGrammar, parseMetadata, validateGrammar } from "${Deno.cwd()}/src/mod.ts";
const grammar = parseGrammar('module = "fn" ident ;');
const metadata = parseMetadata("{}");
const diagnostics = validateGrammar(grammar);
const bundle = generate(grammar, { metadata });
const init = generateInitBundle({ name: "tiny" });
console.log(diagnostics.length, bundle.files.length, init.files.length);
`,
    );
    const advancedPath = `${dir}/advanced.ts`;
    await Deno.writeTextFile(
      advancedPath,
      `import type { TreeSitterMetadata } from "${Deno.cwd()}/src/advanced.ts";
import { generateTokenizerSource, generateTreeSitterTextobjectsQuery, parseTreeSitterMetadata } from "${Deno.cwd()}/src/advanced.ts";
const metadata: TreeSitterMetadata = parseTreeSitterMetadata("{}");
console.log(generateTokenizerSource('module = "fn" ident ;').length, generateTreeSitterTextobjectsQuery('module = "fn" ident ;').length, metadata);
`,
    );
    await denoCheck([rootPath, advancedPath]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("workbench bundle emits stable scaffold and type-checks generated sources", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const source = `
      token ident = /[a-z]+/ ;
      module = function ;
      function = "fn" ident "(" ")" block ;
      block = "{" "}" ;
    `;
    const metadata = parseTreeSitterMetadata(JSON.stringify({
      language: {
        scope: "source.tiny",
        fileTypes: ["tiny"],
        comment: "//",
      },
      queries: {
        locals: [{ node: "ident", capture: "local.definition" }],
        folds: [{ node: "block", capture: "fold" }],
      },
      ast: {
        nodes: {
          function: {
            kind: "function",
            fields: { name: "name" },
          },
        },
      },
      formatter: {
        blocks: ["block"],
        lists: ["module"],
        spacing: { "(": "tight" },
      },
      lsp: {
        documentSymbols: ["function"],
        diagnostics: ["module"],
      },
    }));
    const bundle = generateWorkbenchBundle(source, {
      name: "tiny",
      metadata,
    });
    const files = fileMap(bundle);

    assertEquals(bundle.preset, "workbench");
    assertIncludes(files["tree-sitter.json"], '"scope": "source.tiny"');
    assertIncludes(files["package.json"], '"tree-sitter"');
    assertIncludes(files["queries/highlights.scm"], '"fn" @keyword');
    assertEquals(files["queries/locals.scm"], "(ident) @local.definition\n");
    assertIncludes(files["editor/helix/languages.toml"], 'name = "tiny"');
    assertIncludes(files["ast/types.ts"], "export type AstNode");
    assertIncludes(files["ast/visitor.ts"], "projectNode");
    assertIncludes(files["formatter/format.ts"], "formatNode");
    assertIncludes(files["lsp/server.ts"], "LanguageServerState");
    assertIncludes(files["tests/corpus/basic.txt"], "fn example");

    for (const { path, content } of bundle.files) {
      const slash = path.lastIndexOf("/");
      if (slash !== -1) {
        await Deno.mkdir(`${dir}/${path.slice(0, slash)}`, {
          recursive: true,
        });
      }
      await Deno.writeTextFile(`${dir}/${path}`, content);
    }
    await denoCheck([
      `${dir}/ast/types.ts`,
      `${dir}/ast/visitor.ts`,
      `${dir}/formatter/format.ts`,
      `${dir}/lsp/server.ts`,
    ]);

    assertIncludes(generateAstTypesSource(source, { metadata }), "name:");
    assertIncludes(generateAstVisitorSource(source, { metadata }), "readField");
    assertIncludes(
      generateFormatterScaffoldSource(source, { metadata }),
      "blockNodes",
    );
    assertIncludes(
      generateLspScaffoldSource(source, { metadata }),
      "documentSymbolNodes",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("fenced text and template builtins generate tokenizer and tree-sitter rules", () => {
  const source = `
    module = text_block | template_block | shader_decl ;
    text_block = fenced_text ;
    template_block = fenced_template ;
    shader_decl = "shader" ident "=" wgsl_block "." ;
  `;

  const tokenizer = generateTokenizerSource(source);
  assertIncludes(tokenizer, '| "fenced_text"');
  assertIncludes(tokenizer, '| "fenced_template"');
  assertIncludes(tokenizer, 'return { kind: "fenced_text"');
  assertIncludes(tokenizer, 'return { kind: "fenced_template"');

  const treeSitter = generateTreeSitterGrammar(source, { name: "tiny" });
  assertIncludes(
    treeSitter,
    "fenced_text: $ => choice(seq($.fenced_text_open, $.fenced_text_close), seq($.fenced_text_open, $.fenced_text_content, $.fenced_text_close))",
  );
  assertIncludes(
    treeSitter,
    "fenced_template: $ => choice(seq($.fenced_template_open, $.fenced_template_close), seq($.fenced_template_open, $.fenced_template_content, $.fenced_template_close))",
  );
});

Deno.test("token and skip declarations customize tokenizer and tree-sitter output", async () => {
  const source = `
    token ident = /[a-z]+/ ;
    skip whitespace = /[ \\t]+/ ;
    module = "fn" ident ident ;
  `;

  const tokenizer = generateTokenizerSource(source);
  assertIncludes(tokenizer, '"ident"');
  assertIncludes(tokenizer, "skipPatterns");
  assertIncludes(tokenizer, "tokenPatterns");

  const dir = await Deno.makeTempDir();
  try {
    const tokenizerPath = `${dir}/tokenizer.ts`;
    await Deno.writeTextFile(tokenizerPath, tokenizer);
    const module = await import(`file://${tokenizerPath}?${Date.now()}`) as {
      lex(source: string): GeneratedToken[];
    };

    const tokens = module.lex("fn alpha   beta");
    assertEquals(
      tokens.map((token) => token.kind).join(","),
      "keyword,ident,ident,eof",
    );
    assertEquals(tokens[0].text, "fn");
    assertEquals(tokens[1].text, "alpha");
    assertEquals(tokens[2].span.start, 11);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }

  const treeSitter = generateTreeSitterGrammar(source, { name: "tiny" });
  assertIncludes(treeSitter, "extras: $ => [");
  assertIncludes(treeSitter, "$.whitespace");
  assertIncludes(treeSitter, "ident: $ => token(/[a-z]+/)");
  assertIncludes(treeSitter, "whitespace: $ => /[ \\t]+/");
});

Deno.test("invalid path shaping metadata fails before tree-sitter generation", () => {
  const source = `
    module = function ;
    function = ident "(" ident ")" ;
  `;

  let conflictMessage = "";
  try {
    generateTreeSitterGrammar(source, {
      metadata: {
        rules: {
          function: {
            fields: { "": "name" },
            paths: { "": { hidden_path: true } },
          },
        },
      },
    });
  } catch (error) {
    conflictMessage = error instanceof Error ? error.message : String(error);
  }
  assertIncludes(conflictMessage, "cannot be both hidden and fielded");

  let aliasMessage = "";
  try {
    generateTreeSitterGrammar(source, {
      metadata: {
        rules: {
          function: {
            paths: { "0": { alias_ref: "not-valid!" } },
          },
        },
      },
    });
  } catch (error) {
    aliasMessage = error instanceof Error ? error.message : String(error);
  }
  assertIncludes(aliasMessage, "Invalid alias");

  let wrongTargetMessage = "";
  try {
    generateTreeSitterGrammar(source, {
      metadata: {
        rules: {
          function: {
            paths: { "": { alias_ref: "fn_ref" } },
          },
        },
      },
    });
  } catch (error) {
    wrongTargetMessage = error instanceof Error ? error.message : String(error);
  }
  assertIncludes(wrongTargetMessage, "must target a ref");

  let aliasConflictMessage = "";
  try {
    generateTreeSitterGrammar(source, {
      metadata: {
        rules: {
          function: {
            paths: { "0": { alias_ref: "fn_ref", alias_node: "fn_node" } },
          },
        },
      },
    });
  } catch (error) {
    aliasConflictMessage = error instanceof Error
      ? error.message
      : String(error);
  }
  assertIncludes(aliasConflictMessage, "both alias_ref and alias_node");

  let tokenRootPathMessage = "";
  try {
    generateTreeSitterGrammar(
      `
      module = dot ;
      dot = "." ;
    `,
      {
        metadata: {
          rules: {
            dot: {
              token: { kind: "token" },
              paths: { "": { field: "punct" } },
            },
          },
        },
      },
    );
  } catch (error) {
    tokenRootPathMessage = error instanceof Error
      ? error.message
      : String(error);
  }
  assertIncludes(tokenRootPathMessage, "root path metadata");

  let badRainbowScope = "";
  try {
    generateTreeSitterRainbowsQuery(source, {
      metadata: {
        queries: {
          rainbows: {
            scopes: ["missing_scope"],
          },
        },
      },
    });
  } catch (error) {
    badRainbowScope = error instanceof Error ? error.message : String(error);
  }
  assertIncludes(badRainbowScope, "Unknown rainbow scope node");

  let badRainbowBracket = "";
  try {
    generateTreeSitterRainbowsQuery(source, {
      metadata: {
        queries: {
          rainbows: {
            brackets: ["<"],
          },
        },
      },
    });
  } catch (error) {
    badRainbowBracket = error instanceof Error ? error.message : String(error);
  }
  assertIncludes(badRainbowBracket, "Unknown rainbow bracket literal");

  let badInjectionNode = "";
  try {
    generateTreeSitterInjectionsQuery(source, {
      metadata: {
        queries: {
          injections: [{ node: "missing_node", language: "wgsl" }],
        },
      },
    });
  } catch (error) {
    badInjectionNode = error instanceof Error ? error.message : String(error);
  }
  assertIncludes(badInjectionNode, "Unknown injection node 'missing_node'");

  let badInjectionLanguage = "";
  try {
    generateTreeSitterInjectionsQuery(source, {
      metadata: {
        queries: {
          injections: [{ node: "ident", language: "wgsl bad" }],
        },
      },
    });
  } catch (error) {
    badInjectionLanguage = error instanceof Error
      ? error.message
      : String(error);
  }
  assertIncludes(badInjectionLanguage, "Invalid injection language 'wgsl bad'");
});

Deno.test("invalid field metadata fails before tree-sitter generation", () => {
  const source = `
    module = function ;
    function = "fun" ident ;
  `;

  let message = "";
  try {
    generateTreeSitterGrammar(source, {
      metadata: {
        rules: {
          function: {
            fields: { "4": "name" },
          },
        },
      },
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assertIncludes(message, "out of bounds");
});

Deno.test("validates grammar semantics before generation", () => {
  assertThrowsIncludes(
    () => validateEbnfGrammar(parseEbnf(`module = "x" ; module = "y" ;`)),
    "Duplicate rule 'module'",
  );

  assertThrowsIncludes(
    () => validateEbnfGrammar(parseEbnf(`token name = /a/ ; name = "x" ;`)),
    "Duplicate declaration 'name'",
  );

  assertThrowsIncludes(
    () => validateEbnfGrammar(parseEbnf(`ident = "x" ;`)),
    "reserved builtin name",
  );

  assertThrowsIncludes(
    () => validateEbnfGrammar(parseEbnf(`module = missing ;`)),
    "Unknown rule reference 'missing' in rule 'module'",
  );

  assertThrowsIncludes(
    () =>
      validateEbnfGrammar(parseEbnf(`module = "x" ;`), { rootRule: "missing" }),
    "Unknown root rule 'missing'",
  );

  assertThrowsIncludes(
    () => parseEbnf(`token bad = /(/ ; module = bad ;`),
    "Invalid regex literal",
  );
});

Deno.test("parser generation rejects nondeterministic grammars", () => {
  assertThrowsIncludes(
    () => generateParserSource(`expr = expr "+" ident | ident ;`),
    "Left-recursive parser rule cycle",
  );
  assertThrowsIncludes(
    () =>
      generateParserSource(`
        module = item ;
        item = module | ident ;
      `),
    "Left-recursive parser rule cycle",
  );
  assertThrowsIncludes(
    () => generateParserSource(`module = ( ident? )* ;`),
    "Nullable repetition",
  );
  assertThrowsIncludes(
    () => generateParserSource(`module = "let" ident | "let" int ;`),
    "Ambiguous predictive choice",
  );
});

Deno.test("layout tokenizer treats fenced blocks as one token", async () => {
  const tokenizer = generateTokenizerSource(`
    module = block ;
    block = "block" newline indent fenced_text newline dedent ;
  `);
  assertIncludes(tokenizer, '| "fenced_text"');

  const dir = await Deno.makeTempDir();
  try {
    const tokenizerPath = `${dir}/tokenizer.ts`;
    await Deno.writeTextFile(tokenizerPath, tokenizer);
    const module = await import(`file://${tokenizerPath}?${Date.now()}`) as {
      lex(source: string): GeneratedToken[];
    };

    const source = "block\n  ```\n  # not comment\n  ```\n";
    const tokens = module.lex(source);
    assertEquals(
      tokens.map((token) => token.kind).join(","),
      "keyword,newline,indent,fenced_text,newline,dedent,eof",
    );

    const fenced = tokens.find((token) => token.kind === "fenced_text");
    assert(fenced, "Expected fenced_text token");
    const start = source.indexOf("```");
    const end = source.indexOf("```", start + 3) + 3;
    assertEquals(fenced.text, source.slice(start, end));
    assertEquals(fenced.span.start, start);
    assertEquals(fenced.span.end, end);
    assert(
      !tokens.some((token) => token.text === "not"),
      "Expected fenced internals to stay unlexed",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("tree-sitter metadata parser rejects invalid shapes", () => {
  assertThrowsIncludes(
    () => parseTreeSitterMetadata("{"),
    "Invalid tree-sitter metadata JSON",
  );
  assertThrowsIncludes(
    () => parseTreeSitterMetadata("[]"),
    "Expected metadata to be object",
  );
  assertThrowsIncludes(
    () => parseTreeSitterMetadata("null"),
    "Expected metadata to be object",
  );
  assertThrowsIncludes(
    () => parseTreeSitterMetadata(JSON.stringify({ unknown: true })),
    "Unknown metadata key 'unknown'",
  );
  assertThrowsIncludes(
    () =>
      parseTreeSitterMetadata(JSON.stringify({
        rules: { expr: { wrap: { kind: "bad", value: 1 } } },
      })),
    "Invalid metadata.rules.expr.wrap.kind 'bad'",
  );
  assertThrowsIncludes(
    () =>
      parseTreeSitterMetadata(JSON.stringify({
        rules: { expr: { wrap: { kind: "prec", value: 1.5 } } },
      })),
    "Expected metadata.rules.expr.wrap.value to be integer",
  );
  assertThrowsIncludes(
    () =>
      parseTreeSitterMetadata(JSON.stringify({
        rules: { dot: { token: { kind: "bad" } } },
      })),
    "Invalid metadata.rules.dot.token.kind 'bad'",
  );
  assertThrowsIncludes(
    () =>
      parseTreeSitterMetadata(JSON.stringify({
        queries: { injections: { node: "x", language: "y" } },
      })),
    "Expected metadata.queries.injections to be array",
  );
  assertThrowsIncludes(
    () =>
      parseTreeSitterMetadata(JSON.stringify({
        extras: [{ kind: "regex", value: "[" }],
      })),
    "Invalid metadata.extras[0].value",
  );
  assertThrowsIncludes(
    () =>
      parseTreeSitterMetadata(JSON.stringify({
        extras: [{ kind: "regex", value: "a\nb" }],
      })),
    "Expected metadata.extras[0].value to stay on one line",
  );
  assertThrowsIncludes(
    () =>
      parseTreeSitterMetadata(JSON.stringify({
        queries: { highlights: { node: "x", capture: "keyword" } },
      })),
    "Expected metadata.queries.highlights to be array",
  );
  const textobjectMetadata = parseTreeSitterMetadata(JSON.stringify({
    queries: {
      textobjects: [{ node: "function", capture: "function.outer" }],
    },
  }));
  assertEquals(
    textobjectMetadata.queries?.textobjects?.[0].capture,
    "function.outer",
  );
  assertThrowsIncludes(
    () =>
      parseTreeSitterMetadata(JSON.stringify({
        queries: { textobjects: { node: "x", capture: "function.outer" } },
      })),
    "Expected metadata.queries.textobjects to be array",
  );
  assertThrowsIncludes(
    () =>
      parseTreeSitterMetadata(JSON.stringify({
        queries: {
          highlights: [{ node: "x", literal: "fn", capture: "keyword" }],
        },
      })),
    "Expected metadata.queries.highlights[0] to specify exactly one of node or literal",
  );
  assertThrowsIncludes(
    () =>
      parseTreeSitterMetadata(JSON.stringify({
        queries: {
          textobjects: [{ node: "x", capture: "bad capture" }],
        },
      })),
    "Invalid metadata.queries.textobjects[0].capture",
  );
  assertThrowsIncludes(
    () =>
      generateTreeSitterTextobjectsQuery(`module = "fn" ident ;`, {
        metadata: parseTreeSitterMetadata(JSON.stringify({
          queries: {
            textobjects: [{ node: "missing", capture: "function.outer" }],
          },
        })),
      }),
    "Unknown textobject capture node 'missing'",
  );
  assertThrowsIncludes(
    () =>
      parseTreeSitterMetadata(JSON.stringify({
        formatter: { spacing: { ",": "wide" } },
      })),
    "Invalid metadata.formatter.spacing., 'wide'",
  );
  assertThrowsIncludes(
    () =>
      parseTreeSitterMetadata(JSON.stringify({
        language: { unknown: true },
      })),
    "Unknown metadata.language key 'unknown'",
  );
  assertThrowsIncludes(
    () =>
      generateTreeSitterHighlightsQuery(`module = "fn" ident ;`, {
        metadata: parseTreeSitterMetadata(JSON.stringify({
          queries: {
            highlights: [{ node: "missing", capture: "keyword" }],
          },
        })),
      }),
    "Unknown highlight capture node 'missing'",
  );
  assertThrowsIncludes(
    () =>
      generateWorkbenchBundle(`module = "fn" ident ;`, {
        metadata: parseTreeSitterMetadata(JSON.stringify({
          language: { fileTypes: ["bad type"] },
        })),
      }),
    "Invalid language file type 'bad type'",
  );
  assertThrowsIncludes(
    () =>
      generateWorkbenchBundle(`module = "fn" ident ;`, {
        metadata: parseTreeSitterMetadata(JSON.stringify({
          formatter: { blocks: ["missing"] },
        })),
      }),
    "Unknown formatter block 'missing'",
  );
});

Deno.test("cli writes requested output destinations", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const grammarPath = `${dir}/grammar.ebnf`;
    await Deno.writeTextFile(grammarPath, `module = "fn" ident ;\n`);
    const metadataPath = `${dir}/tree-sitter-meta.json`;
    await Deno.writeTextFile(
      metadataPath,
      JSON.stringify({
        queries: {
          rainbows: { scopes: ["module"] },
          injections: [{ node: "ident", language: "wgsl" }],
          textobjects: [{ node: "module", capture: "module.outer" }],
        },
      }),
    );

    const tsOnlyOut = `${dir}/ts-only/grammar.js`;
    const logs = await captureConsoleLog(() =>
      main([grammarPath, "--ts-out", tsOnlyOut])
    );
    assertEquals(logs.length, 1);
    assertIncludes(logs[0], '"keywords"');
    assertIncludes(
      await Deno.readTextFile(tsOnlyOut),
      "export default grammar({",
    );

    const generateOutDir = `${dir}/generate-subcommand`;
    await main(["generate", grammarPath, "--out", generateOutDir]);
    assertIncludes(
      await Deno.readTextFile(`${generateOutDir}/grammar.js`),
      "export default grammar({",
    );

    const listLogs = await captureConsoleLog(() =>
      main([
        "generate",
        grammarPath,
        "--preset",
        "workbench",
        "--list-files",
      ])
    );
    assertIncludes(listLogs.join("\n"), "queries/highlights.scm");
    assertIncludes(listLogs.join("\n"), "queries/textobjects.scm");
    await assertMissing(`${dir}/queries/highlights.scm`);

    const outDir = `${dir}/bundle`;
    await main([grammarPath, "--out", outDir]);
    assertIncludes(await Deno.readTextFile(`${outDir}/lexical.json`), '"fn"');
    assertIncludes(
      await Deno.readTextFile(`${outDir}/tokenizer.ts`),
      "export function lex",
    );
    assertIncludes(
      await Deno.readTextFile(`${outDir}/grammar.js`),
      "export default grammar({",
    );

    const duplicateTreeSitterOut = `${dir}/duplicate/tree-sitter/grammar.js`;
    await main([
      grammarPath,
      "--out",
      `${dir}/bundle-and-ts`,
      "--ts-out",
      duplicateTreeSitterOut,
    ]);
    assertIncludes(
      await Deno.readTextFile(duplicateTreeSitterOut),
      "export default grammar({",
    );

    const staleOutDir = `${dir}/stale-bundle`;
    const staleTreeSitterOut = `${dir}/stale-tree-sitter/grammar.js`;
    await main([
      grammarPath,
      "--out",
      staleOutDir,
      "--ts-out",
      staleTreeSitterOut,
      "--ts-meta",
      metadataPath,
    ]);
    assertIncludes(
      await Deno.readTextFile(`${staleOutDir}/rainbows.scm`),
      "@rainbow.scope",
    );
    assertIncludes(
      await Deno.readTextFile(`${staleOutDir}/injections.scm`),
      "@injection.content",
    );
    assertIncludes(
      await Deno.readTextFile(`${staleOutDir}/textobjects.scm`),
      "(module) @module.outer",
    );
    assertIncludes(
      await Deno.readTextFile(`${dir}/stale-tree-sitter/queries/rainbows.scm`),
      "@rainbow.scope",
    );
    assertIncludes(
      await Deno.readTextFile(
        `${dir}/stale-tree-sitter/queries/injections.scm`,
      ),
      "@injection.content",
    );
    assertIncludes(
      await Deno.readTextFile(
        `${dir}/stale-tree-sitter/queries/textobjects.scm`,
      ),
      "(module) @module.outer",
    );

    await main([
      grammarPath,
      "--out",
      staleOutDir,
      "--ts-out",
      staleTreeSitterOut,
    ]);
    await assertMissing(`${staleOutDir}/rainbows.scm`);
    await assertMissing(`${staleOutDir}/injections.scm`);
    await assertMissing(`${staleOutDir}/textobjects.scm`);
    await assertMissing(`${dir}/stale-tree-sitter/queries/rainbows.scm`);
    await assertMissing(`${dir}/stale-tree-sitter/queries/injections.scm`);
    await assertMissing(`${dir}/stale-tree-sitter/queries/textobjects.scm`);

    const workbenchOutDir = `${dir}/workbench`;
    const workbenchTreeSitterOut = `${dir}/workbench-tree-sitter/grammar.js`;
    await main([
      grammarPath,
      "--out",
      workbenchOutDir,
      "--ts-out",
      workbenchTreeSitterOut,
      "--preset",
      "workbench",
      "--name",
      "tiny",
      "--ts-meta",
      metadataPath,
    ]);
    assertIncludes(
      await Deno.readTextFile(`${workbenchOutDir}/queries/highlights.scm`),
      '"fn" @keyword',
    );
    assertEquals(
      await Deno.readTextFile(`${workbenchOutDir}/queries/locals.scm`),
      "",
    );
    assertIncludes(
      await Deno.readTextFile(`${workbenchOutDir}/queries/textobjects.scm`),
      "(module) @module.outer",
    );
    assertIncludes(
      await Deno.readTextFile(`${workbenchOutDir}/tree-sitter.json`),
      '"name": "tiny"',
    );
    assertIncludes(
      await Deno.readTextFile(`${workbenchOutDir}/ast/types.ts`),
      "export type AstNode",
    );
    assertIncludes(
      await Deno.readTextFile(`${workbenchTreeSitterOut}`),
      "export default grammar({",
    );
    assertIncludes(
      await Deno.readTextFile(
        `${dir}/workbench-tree-sitter/queries/highlights.scm`,
      ),
      '"fn" @keyword',
    );
    assertEquals(
      await Deno.readTextFile(
        `${dir}/workbench-tree-sitter/queries/locals.scm`,
      ),
      "",
    );
    assertIncludes(
      await Deno.readTextFile(
        `${dir}/workbench-tree-sitter/queries/textobjects.scm`,
      ),
      "(module) @module.outer",
    );

    const initDir = `${dir}/starter`;
    await main(["init", initDir, "--name", "tiny"]);
    assertIncludes(
      await Deno.readTextFile(`${initDir}/grammar.ebnf`),
      "module",
    );
    assertIncludes(
      await Deno.readTextFile(`${initDir}/baba.json`),
      "source.tiny",
    );
    assertIncludes(
      await Deno.readTextFile(`${initDir}/samples/main.tiny`),
      "fn main",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("cli reports argument errors", async () => {
  await assertRejectsIncludes(
    () => main([]),
    "Missing grammar input. Run with --help for usage.",
  );
  await assertRejectsIncludes(
    () => main(["--bad"]),
    "Unknown option '--bad'",
  );
  await assertRejectsIncludes(
    () => main(["--preset", "huge"]),
    "Unknown preset 'huge'",
  );
});
