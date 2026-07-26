import {
  applyBundle,
  assert,
  assertEquals,
  assertIncludes,
  assertNotIncludes,
  assertThrowsIncludes,
  compile,
  denoCheck,
  parsePublicGrammar,
} from "./helpers.ts";
import {
  hashRuntimeImplementationManifest,
  hashRuntimeImplementationSource,
  RUNTIME_IMPLEMENTATION_METADATA,
} from "../src/targets/runtime/implementation.ts";
import {
  WASM_CURSOR_FIELD_RECORD_I32_COUNT,
  WASM_CURSOR_RULE_RECORD_I32_COUNT,
  WASM_CURSOR_VALUE_RECORD_I32_COUNT,
  WASM_I32_BYTES,
  WASM_PARSE_CURSOR_RESULT_I32_COUNT,
  WASM_TOKEN_RECORD_I32_COUNT,
  WASM_UTF16_UNIT_BYTES,
} from "../src/targets/runtime/wasm_abi.ts";
import {
  decodeCombinedWasmParserPlan,
  encodeCombinedWasmParserPlan,
  inspectCombinedWasmParserPlan,
  parserPlanRuntimeMetadataVersion,
  validateCombinedWasmParserPlan,
} from "../src/runtime/wasm_plan.ts";
import type { BabaMetadata } from "../src/ast.ts";

const STATEMENT_GRAMMAR = `
  token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
  token INT = /[0-9]+/ ;
  skip WS = /[ \\t\\r\\n]+/ ;

  module = statements:statement* ;
  statement = "let" name:IDENT "=" value:INT ";" | "if" condition:IDENT ";" ;
`;

// No `skip` rule, so the lexer plan carries no trivia spec at all and the lex
// tape can index the raw records without a filter pass.
const NO_TRIVIA_GRAMMAR = `
  token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;

  module = items:item+ ;
  item = name:IDENT ";" ;
`;

interface TokenLike {
  type: string;
  text: string;
  span: { start: number; end: number };
  channel: string;
  kind?: string;
  literal?: string;
}

interface DiagnosticLike {
  code: string;
  expected?: readonly string[];
  found?: string;
  span?: { start: number; end: number };
}

interface TokenTapeLike {
  length: number;
  token(index: number): TokenLike | undefined;
}

interface LexTapeResultLike {
  tokenTape: TokenTapeLike;
  diagnostics: readonly DiagnosticLike[];
}

type CursorFieldValueLike =
  | CursorRuleLike
  | CursorTokenLike
  | readonly CursorFieldValueLike[]
  | null;

interface CursorRuleLike {
  type: "rule";
  name: string;
  span: { start: number; end: number };
  tokenRange: { start: number; end: number };
  childCount: number;
  child(index: number): CursorRuleLike | CursorTokenLike | undefined;
  children(): readonly (CursorRuleLike | CursorTokenLike)[];
  field(name: string): CursorFieldValueLike | undefined;
  fieldArray(name: string): readonly CursorFieldValueLike[];
}

interface CursorTokenLike {
  type: "token";
  tokenType: "named" | "literal";
  kind: string;
  text: string;
  span: { start: number; end: number };
  tokenIndex: number;
}

type CursorParseResultLike =
  | { ok: true; cursor: CursorRuleLike; diagnostics: readonly DiagnosticLike[] }
  | { ok: false; cursor: null; diagnostics: readonly DiagnosticLike[] };

type ValidateResultLike = {
  ok: boolean;
  diagnostics: readonly DiagnosticLike[];
};

interface GeneratedParser {
  lex(source: string, options?: Record<string, unknown>): LexTapeResultLike;
  parse(
    source: string,
    options?: Record<string, unknown>,
  ): CursorParseResultLike;
  validate(
    source: string,
    options?: Record<string, unknown>,
  ): ValidateResultLike;
  dispose(): void;
}

interface RawCursorWasmExports {
  memory: WebAssembly.Memory;
  plan_buffer_base(): number;
  input_base(): number;
  load_plan(planPtr: number, planLength: number): number;
  parse_cursor(
    sourcePtr: number,
    sourceLength: number,
    tokenPtr: number,
    tokenCapacity: number,
    rulePtr: number,
    ruleCapacity: number,
    childPtr: number,
    childCapacity: number,
    fieldPtr: number,
    fieldCapacity: number,
    valuePtr: number,
    valueCapacity: number,
    valueItemPtr: number,
    valueItemCapacity: number,
    resultPtr: number,
    stackPtr: number,
    fragmentPtr: number,
    fragmentCapacity: number,
    preserveTrivia: number,
    maxTraceActions: number,
  ): number;
}

interface GeneratedWasmModule {
  createParser(options: unknown): GeneratedParser;
  createParserAsync(options: unknown): Promise<GeneratedParser>;
}

Deno.test("Wasm target validates generated size and parser stats options", () => {
  const invalidByteLimit = compile(`module = "ok" ;`, {
    targets: ["wasm"],
    wasm: { generatedByteLimit: 0 },
  });
  assertEquals(invalidByteLimit.bundle, undefined);
  assertEquals(
    invalidByteLimit.diagnostics[0].code,
    "WASM_GENERATED_BYTE_LIMIT",
  );

  const generatedByteLimit = compile(`module = "a" | "b" ;`, {
    targets: ["wasm"],
    wasm: { generatedByteLimit: 1 },
  });
  assertEquals(generatedByteLimit.bundle, undefined);
  assertEquals(
    generatedByteLimit.diagnostics[0].code,
    "WASM_GENERATED_BYTE_LIMIT",
  );

  const stats = compile(`module = "a" | "b" ;`, {
    targets: ["wasm"],
    wasm: { reportParserStats: true },
  });
  assert(stats.bundle);
  assertEquals(stats.diagnostics[0].code, "WASM_PARSER_STATS");
  assertIncludes(stats.diagnostics[0].message, "BNF productions: 4");
  assertIncludes(stats.diagnostics[0].message, "lexer states:");
  assertIncludes(stats.diagnostics[0].message, "generated bytes:");
  assertIncludes(stats.diagnostics[0].message, "adapter/source bytes:");
  assertIncludes(stats.diagnostics[0].message, "core Wasm binary bytes:");
  assertIncludes(stats.diagnostics[0].message, "external plan binary bytes:");
  assertNotIncludes(
    stats.diagnostics[0].message,
    "parser trace Wasm binary bytes:",
  );
});

Deno.test("public grammar parser returns documents accepted by Wasm generation", () => {
  const grammar = parsePublicGrammar(`
    grammar Tiny
    token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
    skip WS = /[ \\t\\r\\n]+/ ;
    module = name:IDENT ;
  `);
  assertEquals(grammar.name, "Tiny");

  const result = compile(grammar, { targets: ["wasm"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);
});

Deno.test("grammar features outside the Wasm subset report explicit diagnostics", () => {
  const result = compile(`
    grammar Expressions
    token INT = /[0-9]+/ ;
    skip WS = /[ \\t\\r\\n]+/ ;
    expr = INT {
      infix left 10 "+"
    } ;
  `);
  assertEquals(result.bundle, undefined);
  assertEquals(
    result.diagnostics[0].code,
    "GRAMMAR_UNSUPPORTED_EXPRESSION_ISLAND",
  );
});

Deno.test("Wasm target emits minimal external artifacts", async () => {
  const bundle = wasmBundle(`module = "ok" ;`);
  assertEquals(
    bundle.files.map((file) => file.path).join(","),
    "wasm/abi.json,wasm/manifest.json,wasm/mod.ts,wasm/parser.plan,wasm/parser.wasm,wasm/syntax.ts",
  );
  const modSource = textFile(bundle, "wasm/mod.ts");
  assertIncludes(modSource, "@mewhhaha/baba/runtime/generated-wasm");
  assertNotIncludes(modSource, "parserTraceRuntimeBytes");
  assertNotIncludes(modSource, "wasmBytes");
  const abi = JSON.parse(textFile(bundle, "wasm/abi.json")) as {
    parserPlan?: { runtimeMetadataVersion?: number };
    parserDiagnosticCodes?: Record<string, number>;
    core?: {
      exports?: readonly {
        name?: string;
        params?: readonly string[];
      }[];
    };
  };
  assertEquals(
    abi.parserPlan?.runtimeMetadataVersion,
    parserPlanRuntimeMetadataVersion,
  );
  assertEquals(abi.parserDiagnosticCodes?.parseInvalidTokenStream, undefined);
  assertEquals(abi.parserDiagnosticCodes?.branchLimit, undefined);
  const manifest = JSON.parse(textFile(bundle, "wasm/manifest.json")) as {
    parserPlan?: { runtimeMetadataVersion?: number };
  };
  assertEquals(
    manifest.parserPlan?.runtimeMetadataVersion,
    parserPlanRuntimeMetadataVersion,
  );
  const lexAll = abi.core?.exports?.find((entry) => entry.name === "lex_all");
  assert(lexAll, "Expected lex_all in abi.json.");
  assertEquals(
    lexAll.params?.join(","),
    "sourcePtr,sourceLength,mode,tokenPtr",
  );
  assertNotIncludes(
    bundle.files.map((file) => file.path).join(","),
    "lexer.ts",
  );
  assertNotIncludes(
    bundle.files.map((file) => file.path).join(","),
    "parser.ts",
  );
  assertNotIncludes(bundle.files.map((file) => file.path).join(","), "wasm.ts");

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(bundle, { root: dir });
    await denoCheck(`${dir}/wasm/mod.ts`);
    const mod = await import(`file://${dir}/wasm/mod.ts`);
    assertEquals("lex" in mod, false);
    assertEquals("parserDiagnosticCodeBranchLimit" in mod, false);
    assertEquals("parserDiagnosticCodeParseInvalidTokenStream" in mod, false);
    assertEquals(
      mod.parserPlanRuntimeMetadataVersion,
      parserPlanRuntimeMetadataVersion,
    );
    assertThrowsIncludes(
      () =>
        mod.createParser({
          bytes: Deno.readFileSync(`${dir}/wasm/parser.wasm`),
        }),
      "Wasm parser creation requires parser plan bytes",
    );
    const parser = mod.createParser({
      bytes: await Deno.readFile(`${dir}/wasm/parser.wasm`),
      plan: await Deno.readFile(`${dir}/wasm/parser.plan`),
    });
    assertEquals("parseTree" in parser, false);
    assertEquals("parseTokens" in parser, false);
    assertEquals("parseTokensUnchecked" in parser, false);
    const parsed = parser.parse("ok");
    assertEquals(parsed.ok, true);
    assert(parsed.cursor);
    parser.dispose();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm target emits Tree-sitter query fragments from metadata", () => {
  const metadata: BabaMetadata = {
    version: 2,
    queries: {
      highlights: {
        entries: [
          { node: "INT", capture: "number" },
          { literal: "let", capture: "keyword" },
        ],
      },
      locals: [
        { node: "IDENT", capture: "local.definition" },
      ],
      folds: [
        { node: "group", capture: "fold" },
      ],
      indents: [
        { node: "group", capture: "indent.begin" },
      ],
      tags: [
        { node: "variable_binding", capture: "tag.definition" },
      ],
      textobjects: [
        { node: "variable_binding", capture: "statement.outer" },
      ],
      rainbows: {
        brackets: ["(", ")"],
      },
      injections: [
        { node: "STRING", language: "markdown" },
      ],
    },
  };
  const bundle = wasmBundle(
    `
      token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
      token INT = /[0-9]+/ ;
      token STRING = /"[^"]*"/ ;
      skip WS = /[ \\t\\r\\n]+/ ;

      module = variable_binding | group | doc ;
      variable_binding = "let" name:IDENT "=" value:INT ";" ;
      group = "(" item:IDENT ")" ;
      doc = text:STRING ;
    `,
    metadata,
  );
  const paths = bundle.files.map((file) => file.path).join(",");
  assertIncludes(paths, "queries/generated-highlights.scm");
  assertIncludes(paths, "queries/generated-locals.scm");
  assertIncludes(paths, "queries/generated-folds.scm");
  assertIncludes(paths, "queries/generated-indents.scm");
  assertIncludes(paths, "queries/generated-tags.scm");
  assertIncludes(paths, "queries/generated-textobjects.scm");
  assertIncludes(paths, "queries/generated-rainbows.scm");
  assertIncludes(paths, "queries/generated-injections.scm");
  assertIncludes(paths, "wasm/parser.wasm");

  const highlights = textFile(bundle, "queries/generated-highlights.scm");
  assertIncludes(highlights, "(INT) @number");
  assertIncludes(highlights, '"let" @keyword');
  assertIncludes(highlights, "(variable_binding name: (IDENT) @variable)");
  assertIncludes(highlights, '"=" @operator');

  const locals = textFile(bundle, "queries/generated-locals.scm");
  assertIncludes(locals, "(IDENT) @local.definition");

  const folds = textFile(bundle, "queries/generated-folds.scm");
  assertIncludes(folds, "(group) @fold");

  const indents = textFile(bundle, "queries/generated-indents.scm");
  assertIncludes(indents, "(group) @indent.begin");

  const tags = textFile(bundle, "queries/generated-tags.scm");
  assertIncludes(tags, "(variable_binding) @tag.definition");

  const textobjects = textFile(bundle, "queries/generated-textobjects.scm");
  assertIncludes(textobjects, "(variable_binding) @statement.outer");

  const rainbows = textFile(bundle, "queries/generated-rainbows.scm");
  assertIncludes(rainbows, '"("');
  assertIncludes(rainbows, '")"');
  assertIncludes(rainbows, "@rainbow.bracket");

  const injections = textFile(bundle, "queries/generated-injections.scm");
  assertIncludes(injections, "((STRING) @injection.content");
  assertIncludes(injections, '#set! injection.language "markdown"');
});

Deno.test("runtime manifest contains only active Wasm sources", async () => {
  assertEquals(RUNTIME_IMPLEMENTATION_METADATA.sources.length, 13);
  const roles = RUNTIME_IMPLEMENTATION_METADATA.sources.map((source) =>
    source.role
  );
  assertEquals(
    roles.join("\n"),
    [
      "compact-runtime-metadata-codec",
      "combined-wasm-parser-plan-format",
      "generated-wasm-parser-loader",
      "parser-diagnostic-codes",
      "wasm-abi-constants",
      "wasm-core-runtime",
      "wasm-core-runtime-build-script",
      "wasm-core-runtime-rust-manifest",
      "wasm-core-runtime-rust-lockfile",
      "wasm-core-runtime-rust-build-config",
      "wasm-core-runtime-rust-source",
      "wasm-core-runtime-embedded-bytes",
      "generated-source-provenance",
    ].join("\n"),
  );

  const sources = [];
  for (const source of RUNTIME_IMPLEMENTATION_METADATA.sources) {
    const content = await Deno.readTextFile(source.path);
    assertEquals(hashRuntimeImplementationSource(content), source.hash);
    sources.push(source);
  }
  assertEquals(
    hashRuntimeImplementationManifest(sources),
    RUNTIME_IMPLEMENTATION_METADATA.hash,
  );
});

Deno.test("Wasm core and wrapper are stable across grammars", () => {
  const alpha = wasmBundle(`module = "alpha" ;`);
  const beta = wasmBundle(`module = "beta" "!" ;`);
  for (
    const path of [
      "wasm/parser.wasm",
      "wasm/mod.ts",
      "wasm/abi.json",
      "wasm/manifest.json",
    ]
  ) {
    assertEquals(serializedFile(alpha, path), serializedFile(beta, path), path);
  }
  assert(
    serializedFile(alpha, "wasm/parser.plan") !==
      serializedFile(beta, "wasm/parser.plan"),
    "Expected grammar-specific parser.plan bytes.",
  );
  assert(
    serializedFile(alpha, "wasm/syntax.ts") !==
      serializedFile(beta, "wasm/syntax.ts"),
    "Expected grammar-specific syntax types.",
  );
});

Deno.test("combined parser plans round-trip runtime metadata v2 with exact section sizes", () => {
  const bundle = wasmBundle(STATEMENT_GRAMMAR);
  const file = bundle.files.find((entry) => entry.path === "wasm/parser.plan");
  assert(file, "Expected wasm/parser.plan.");
  assert(file.encoding === "binary", "Expected a binary parser plan.");
  const validated = validateCombinedWasmParserPlan(file.content);
  const decoded = decodeCombinedWasmParserPlan(file.content);
  const inspected = inspectCombinedWasmParserPlan(file.content);
  assertEquals(
    validated.runtimeMetadataVersion,
    parserPlanRuntimeMetadataVersion,
  );
  assertEquals(
    decoded.runtimeMetadataVersion,
    parserPlanRuntimeMetadataVersion,
  );
  assertEquals(
    inspected.corePlanBytes + inspected.runtimeMetadataHeaderBytes +
      inspected.runtimeMetadataBytes,
    inspected.totalBytes,
  );
  assertEquals(inspected.totalBytes, file.content.byteLength);
  assertEquals(
    inspected.runtimeMetadataHeaderBytes,
    validated.runtimeMetadataOffset - validated.runtimeMetadataHeaderOffset,
  );
  const reencoded = encodeCombinedWasmParserPlan(
    file.content.subarray(0, validated.coreByteLength),
    decoded.compactRuntimePlan,
  );
  assertEquals(
    JSON.stringify(
      decodeCombinedWasmParserPlan(reencoded).compactRuntimePlan,
    ),
    JSON.stringify(decoded.compactRuntimePlan),
  );

  const versionOne = new Uint8Array(file.content);
  new DataView(
    versionOne.buffer,
    versionOne.byteOffset,
    versionOne.byteLength,
  ).setUint32(validated.runtimeMetadataHeaderOffset + 13, 1, true);
  assertThrowsIncludes(
    () => validateCombinedWasmParserPlan(versionOne),
    "runtime metadata version 1",
  );

  const malformedMagic = new Uint8Array(file.content);
  malformedMagic[validated.runtimeMetadataHeaderOffset] = 0;
  assertThrowsIncludes(
    () => validateCombinedWasmParserPlan(malformedMagic),
    "runtime metadata magic is invalid",
  );
  assertThrowsIncludes(
    () => validateCombinedWasmParserPlan(file.content.slice(0, -1)),
    "runtime metadata length is invalid",
  );
});

Deno.test("Wasm target emits typed cursor result surface", async () => {
  const bundle = wasmBundle(STATEMENT_GRAMMAR);
  const syntax = textFile(bundle, "wasm/syntax.ts");
  assertIncludes(
    syntax,
    'export interface ModuleCursor extends RuleCursorBase<"module">',
  );
  assertIncludes(
    syntax,
    'field(name: "statements"): ReadonlyArray<StatementCursor>;',
  );
  assertIncludes(
    syntax,
    'field(name: "name"): TokenCursor<"named", "IDENT"> | null;',
  );
  assertIncludes(syntax, "export type RootCursor = ModuleCursor;");
  assertEquals(syntax.includes("contextualLexingStats"), false);
  assertEquals(syntax.includes("maxExploredBranches"), false);
  assertEquals(syntax.includes("maxQueuedBranches"), false);
  assertEquals(syntax.includes("ambiguityMode"), false);
  assertEquals(syntax.includes("PARSE_INVALID_TOKEN_STREAM"), false);
  assertEquals(syntax.includes("PARSER_BRANCH_LIMIT"), false);
  assertEquals(syntax.includes("maxTraceActions"), true);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(bundle, { root: dir });
    await Deno.writeTextFile(
      `${dir}/consumer.ts`,
      `
        import {
          createParser,
          createParserAsync,
          type CursorParseResult,
          type ModuleCursor,
          type RootCursor,
          type StatementCursor,
          type TokenCursor,
        } from "./wasm/mod.ts";

        declare const bytes: Uint8Array;
        declare const module: WebAssembly.Module;
        declare const plan: Uint8Array;
        declare const url: URL;
        declare const planUrl: URL;

        const parser = createParser({ bytes, plan });
        createParser({ module, plan });
        await createParserAsync({ bytes, plan });
        await createParserAsync({ module, planUrl });
        await createParserAsync({ url, plan });
        await createParserAsync({ url, planUrl });
        // @ts-expect-error plan is required
        createParser({ bytes });
        // @ts-expect-error bytes and module are mutually exclusive
        createParser({ bytes, module, plan });
        // @ts-expect-error a Wasm source is required
        await createParserAsync({ plan });
        // @ts-expect-error plan and planUrl are mutually exclusive
        await createParserAsync({ bytes, plan, planUrl });
        const result = parser.parse("let x = 42;");
        const typedResult: CursorParseResult<RootCursor> = result;
        parser.parse("let x = 42;", {
          preserveTrivia: true,
          maxTraceActions: 1024,
        });
        parser.validate("let x = 42;", {
          maxTraceActions: 1024,
        });
        if (typedResult.ok) {
          const root: ModuleCursor = typedResult.cursor;
          const statements: ReadonlyArray<StatementCursor> =
            root.field("statements");
          const first = statements[0];
          if (first !== undefined) {
            const maybeName = first.field("name");
            if (maybeName !== null) {
              const token: TokenCursor<"named", "IDENT"> = maybeName;
              const kind: "IDENT" = token.kind;
              kind;
            }
          }
        }
      `,
    );
    await denoCheck(`${dir}/consumer.ts`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("package exports expose only current runtime entrypoint", async () => {
  const config = JSON.parse(await Deno.readTextFile("deno.json")) as {
    exports?: Record<string, string>;
  };
  assert(config.exports, "Expected deno.json exports.");
  assertEquals(config.exports["./runtime"], undefined);
  assertEquals(config.exports["./runtime/wasm"], undefined);
  assertEquals(
    config.exports["./runtime/generated-wasm"],
    "./src/runtime/generated_wasm.ts",
  );
});

Deno.test("shared Wasm adapter preserves lexer and parser behavior", async () => {
  const { dir, mod, bytes, plan } = await materialize(STATEMENT_GRAMMAR);
  try {
    const parser = mod.createParser({ bytes, plan });
    const lexed = parser.lex("let x = 42;");
    assertEquals(lexed.diagnostics.length, 0);
    assertEquals("tokens" in lexed, false);
    assertEquals("toTokens" in lexed, false);
    const firstToken = lexed.tokenTape.token(0);
    assert(firstToken);
    assertEquals(firstToken.type, "literal");
    assertEquals(firstToken.text, "let");
    const nameToken = lexed.tokenTape.token(2);
    assert(nameToken);
    assertEquals(nameToken.kind, "IDENT");
    assertEquals(nameToken.span.start, 4);
    assertEquals(lexed.tokenTape.token(2), nameToken);
    assertEquals("toTokens" in lexed.tokenTape, false);
    assertEquals(lexed.tokenTape.token(1)?.kind, "WS");
    assertEquals(lexed.tokenTape.token(1)?.channel, "trivia");

    const cursorParsed = parser.parse("let x = 42;");
    assertEquals(cursorParsed.ok, true);
    assert(cursorParsed.cursor);
    assertEquals(cursorParsed.cursor.name, "module");
    assertEquals(cursorParsed.cursor.span.start, 0);
    assertEquals(cursorParsed.cursor.span.end, 11);
    assertEquals(cursorParsed.cursor.tokenRange.start, 0);
    assertEquals(cursorParsed.cursor.childCount, 1);
    const cursorStatements = cursorParsed.cursor.field("statements");
    assert(Array.isArray(cursorStatements), "Expected repeated field array.");
    assertEquals(cursorStatements.length, 1);
    const cursorStatement = cursorParsed.cursor.child(0);
    assertCursorRule(cursorStatement, "statement");
    assertEquals(
      cursorStatement.children().map((child) => cursorLabel(child)).join(" "),
      'token:"let" token:IDENT token:"=" token:INT token:";"',
    );
    const cursorName = cursorStatement.field("name");
    assertCursorToken(cursorName, "IDENT");
    assertEquals(cursorName.text, "x");
    assertEquals("toToken" in cursorName, false);
    assertEquals(cursorName.span.start, 4);
    const cursorValue = cursorStatement.field("value");
    assertCursorToken(cursorValue, "INT");
    assertEquals(cursorValue.text, "42");
    assertEquals("parseTree" in parser, false);
    assertEquals("parseTokens" in parser, false);
    assertEquals("parseTokensUnchecked" in parser, false);

    const invalid = parser.parse("let = 42;");
    assertEquals(invalid.ok, false);
    assertEquals(invalid.cursor, null);
    assertEquals(invalid.diagnostics[0].code, "PARSE_UNEXPECTED_TOKEN");
    assert(invalid.diagnostics[0].expected);
    assertIncludes(invalid.diagnostics[0].expected.join(","), "IDENT");

    const missingFinalToken = parser.parse("let x = 42 ");
    assertEquals(missingFinalToken.ok, false);
    assertEquals(
      missingFinalToken.diagnostics[0].code,
      "PARSE_UNEXPECTED_TOKEN",
    );
    assertEquals(missingFinalToken.diagnostics[0].found, "EOF");
    assertEquals(missingFinalToken.diagnostics[0].span?.start, 11);
    assertEquals(missingFinalToken.diagnostics[0].span?.end, 11);

    const tokenMode = parser.lex("let x = 42;");
    assertEquals(tokenMode.tokenTape.length, lexed.tokenTape.length);
    const validateMode = parser.validate("let x = 42;");
    assertEquals(validateMode.ok, true);
    const invalidValidate = parser.validate("let = 42;");
    assertEquals(invalidValidate.ok, false);
    assertEquals(
      invalidValidate.diagnostics[0].code,
      "PARSE_UNEXPECTED_TOKEN",
    );
    const missingFinalTokenValidate = parser.validate("let x = 42 ");
    assertEquals(missingFinalTokenValidate.ok, false);
    assertEquals(missingFinalTokenValidate.diagnostics[0].found, "EOF");
    parser.dispose();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("lex tapes stay correct across later lex calls", async () => {
  const { dir, mod, bytes, plan } = await materialize(STATEMENT_GRAMMAR);
  try {
    const parser = mod.createParser({ bytes, plan });
    const first = parser.lex("let x = 42;");
    const firstLength = first.tokenTape.length;

    // Large enough that `ensureExternalWasmCapacity` has to call `memory.grow`,
    // which detaches every view onto the previous buffer. Nothing from `first`
    // has been materialized yet, so the tokens read below can only be right if
    // the records were copied out of Wasm memory rather than viewed in place.
    const large = "let y = 7;\n".repeat(200_000);
    const second = parser.lex(large);
    assert(
      second.tokenTape.length > firstLength,
      "Expected the second lex to produce more tokens.",
    );

    assertEquals(first.tokenTape.length, firstLength);
    const letToken = first.tokenTape.token(0);
    assert(letToken);
    assertEquals(letToken.type, "literal");
    assertEquals(letToken.text, "let");
    const nameToken = first.tokenTape.token(2);
    assert(nameToken);
    assertEquals(nameToken.kind, "IDENT");
    assertEquals(nameToken.text, "x");
    assertEquals(nameToken.span.start, 4);
    assertEquals(nameToken.span.end, 5);
    assertEquals(first.tokenTape.token(firstLength - 1)?.type, "eof");

    // A third, smaller lex reuses the same region again.
    const third = parser.lex("if z;");
    assertEquals(third.tokenTape.token(0)?.text, "if");
    assertEquals(first.tokenTape.token(2)?.text, "x");
    assertEquals(second.tokenTape.token(2)?.text, "y");
    assertEquals(first.tokenTape.length, firstLength);
    parser.dispose();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("lex tape drops trivia and keeps error tokens", async () => {
  const { dir, mod, bytes, plan } = await materialize(STATEMENT_GRAMMAR);
  try {
    const parser = mod.createParser({ bytes, plan });
    const preserved = parser.lex("let x = 42;", { preserveTrivia: true });
    assertEquals(preserved.tokenTape.token(1)?.kind, "WS");
    assertEquals(preserved.tokenTape.token(2)?.text, "x");

    const dropped = parser.lex("let x = 42;", { preserveTrivia: false });
    assertEquals(dropped.diagnostics.length, 0);
    assertEquals(dropped.tokenTape.length, 6);
    assertEquals(
      [0, 1, 2, 3, 4].map((index) => dropped.tokenTape.token(index)?.text)
        .join(" "),
      "let x = 42 ;",
    );
    assertEquals(dropped.tokenTape.token(5)?.type, "eof");
    assertEquals(dropped.tokenTape.token(6), undefined);
    assertEquals(dropped.tokenTape.token(-1), undefined);

    const withError = parser.lex("let # = 42;", { preserveTrivia: false });
    assertEquals(withError.diagnostics.length, 1);
    assertEquals(withError.diagnostics[0].code, "LEX_UNEXPECTED_CHARACTER");
    assertEquals(withError.diagnostics[0].span?.start, 4);
    assertEquals(withError.diagnostics[0].span?.end, 5);
    assertEquals(withError.tokenTape.token(1)?.type, "error");
    assertEquals(withError.tokenTape.token(1)?.text, "#");

    // The dropped-trivia tape must still be intact after the later calls.
    assertEquals(dropped.tokenTape.token(1)?.text, "x");
    assertEquals(preserved.tokenTape.token(1)?.kind, "WS");
    parser.dispose();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("lex tape maps records directly when a grammar has no trivia", async () => {
  const { dir, mod, bytes, plan } = await materialize(NO_TRIVIA_GRAMMAR);
  try {
    const parser = mod.createParser({ bytes, plan });
    const lexed = parser.lex("a;bb;c;", { preserveTrivia: false });
    assertEquals(lexed.diagnostics.length, 0);
    assertEquals(lexed.tokenTape.length, 7);
    assertEquals(
      [0, 1, 2, 3, 4, 5].map((index) => lexed.tokenTape.token(index)?.text)
        .join(" "),
      "a ; bb ; c ;",
    );
    assertEquals(lexed.tokenTape.token(6)?.type, "eof");

    const withError = parser.lex("a;#;", { preserveTrivia: false });
    assertEquals(withError.diagnostics.length, 1);
    assertEquals(withError.diagnostics[0].code, "LEX_UNEXPECTED_CHARACTER");
    assertEquals(withError.diagnostics[0].span?.start, 2);
    assertEquals(withError.diagnostics[0].span?.end, 3);
    assertEquals(withError.tokenTape.token(2)?.type, "error");
    assertEquals(lexed.tokenTape.token(2)?.text, "bb");
    parser.dispose();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm parse_cursor export materializes cursor tapes", async () => {
  const { dir, bytes, plan } = await materialize(STATEMENT_GRAMMAR);
  try {
    const instantiated = await WebAssembly.instantiate(
      bytes,
      {},
    ) as unknown as {
      instance: WebAssembly.Instance;
    };
    const wasm = instantiated.instance
      .exports as unknown as RawCursorWasmExports;
    const planPtr = wasm.plan_buffer_base();
    assert(planPtr > 0, "Expected nonzero Wasm plan buffer base.");
    if (wasm.memory.buffer.byteLength < planPtr + plan.byteLength) {
      const missing = planPtr + plan.byteLength - wasm.memory.buffer.byteLength;
      wasm.memory.grow(Math.ceil(missing / 65_536));
    }
    new Uint8Array(wasm.memory.buffer, planPtr, plan.byteLength).set(plan);
    assertEquals(wasm.load_plan(planPtr, plan.byteLength), 1);

    const source = "let x = 42;";
    const sourcePtr = wasm.input_base();
    assert(sourcePtr > planPtr);
    const tokenCapacity = source.length + 1;
    const structuralCapacity = 128;
    const tokenPtr = alignTest(
      sourcePtr + source.length * WASM_UTF16_UNIT_BYTES,
      WASM_I32_BYTES,
    );
    const rulePtr = alignTest(
      tokenPtr + tokenCapacity * WASM_TOKEN_RECORD_I32_COUNT * WASM_I32_BYTES,
      WASM_I32_BYTES,
    );
    const ruleCapacity = structuralCapacity;
    const childPtr = alignTest(
      rulePtr +
        ruleCapacity * WASM_CURSOR_RULE_RECORD_I32_COUNT * WASM_I32_BYTES,
      WASM_I32_BYTES,
    );
    const childCapacity = structuralCapacity * 4;
    const fieldPtr = alignTest(
      childPtr + childCapacity * WASM_I32_BYTES,
      WASM_I32_BYTES,
    );
    const fieldCapacity = structuralCapacity * 4;
    const valuePtr = alignTest(
      fieldPtr +
        fieldCapacity * WASM_CURSOR_FIELD_RECORD_I32_COUNT * WASM_I32_BYTES,
      WASM_I32_BYTES,
    );
    const valueCapacity = structuralCapacity * 8;
    const valueItemPtr = alignTest(
      valuePtr +
        valueCapacity * WASM_CURSOR_VALUE_RECORD_I32_COUNT * WASM_I32_BYTES,
      WASM_I32_BYTES,
    );
    const valueItemCapacity = structuralCapacity * 8;
    const resultPtr = alignTest(
      valueItemPtr + valueItemCapacity * WASM_I32_BYTES,
      WASM_I32_BYTES,
    );
    const stackPtr = alignTest(
      resultPtr + WASM_PARSE_CURSOR_RESULT_I32_COUNT * WASM_I32_BYTES,
      WASM_I32_BYTES,
    );
    const fragmentPtr = alignTest(
      stackPtr + structuralCapacity * WASM_I32_BYTES,
      WASM_I32_BYTES,
    );
    const requiredBytes = fragmentPtr +
      structuralCapacity * 9 * WASM_I32_BYTES;
    if (wasm.memory.buffer.byteLength < requiredBytes) {
      const missing = requiredBytes - wasm.memory.buffer.byteLength;
      wasm.memory.grow(Math.ceil(missing / 65_536));
    }
    const view = new DataView(wasm.memory.buffer);
    for (let index = 0; index < source.length; index++) {
      view.setUint16(
        sourcePtr + index * WASM_UTF16_UNIT_BYTES,
        source.charCodeAt(index),
        true,
      );
    }
    const status = wasm.parse_cursor(
      sourcePtr,
      source.length,
      tokenPtr,
      tokenCapacity,
      rulePtr,
      ruleCapacity,
      childPtr,
      childCapacity,
      fieldPtr,
      fieldCapacity,
      valuePtr,
      valueCapacity,
      valueItemPtr,
      valueItemCapacity,
      resultPtr,
      stackPtr,
      fragmentPtr,
      structuralCapacity,
      0,
      10_000,
    );
    assertEquals(status, 0);
    assertEquals(view.getInt32(resultPtr, true), 5);
    assert(view.getInt32(resultPtr + WASM_I32_BYTES, true) >= 2);
    assert(view.getInt32(resultPtr + WASM_I32_BYTES * 2, true) > 0);
    assert(view.getInt32(resultPtr + WASM_I32_BYTES * 3, true) > 0);
    assert(view.getInt32(resultPtr + WASM_I32_BYTES * 4, true) > 0);
    assert(view.getInt32(resultPtr + WASM_I32_BYTES * 5, true) > 0);
    const rootRef = view.getInt32(resultPtr + WASM_I32_BYTES * 6, true);
    assertEquals(rootRef % 2, 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("shared Wasm adapter resolves contextual token candidates from Wasm lex records", async () => {
  const grammar = `
    token IDENT = /[a-z]+/ ;
    skip WS = /[ \\t\\r\\n]+/ ;
    module = statement ;
    statement = value:IDENT ";" | "@" keyword:"if" ";" ;
  `;
  const { dir, mod, bytes, plan } = await materialize(grammar);
  try {
    const parser = mod.createParser({ bytes, plan });
    const cursorIdent = parser.parse("if;");
    assertEquals(cursorIdent.ok, true);
    assert(cursorIdent.cursor);
    const cursorIdentStatement = cursorIdent.cursor.child(0);
    assertCursorRule(cursorIdentStatement, "statement");
    const cursorIdentValue = cursorIdentStatement.field("value");
    assertCursorToken(cursorIdentValue, "IDENT");
    assertEquals(cursorIdentValue.text, "if");

    const cursorKeyword = parser.parse("@if;");
    assertEquals(cursorKeyword.ok, true);
    assert(cursorKeyword.cursor);
    const cursorStatement = cursorKeyword.cursor.child(0);
    assertCursorRule(cursorStatement, "statement");
    const cursorValue = cursorStatement.field("keyword");
    assertCursorToken(cursorValue, "if");
    assertEquals(cursorValue.text, "if");
    parser.dispose();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm parser promotes guarded contextual trivia by parser state", async () => {
  const grammar = `
    token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
    token INT = /[0-9]+/ ;
    skip WS = /[ \\t\\r\\n]+/ ;
    contextual APPLICATION_SPACE = /[ \\t]+(?=[A-Za-z_])(?!(if|in)\\b)/ ;
    contextual TYPE_APPLICATION_SPACE = /[ \\t]+(?=[A-Za-z_#&]|\\(|\\[)/ ;
    contextual BREAK_VALUE_SPACE = /[ \\t]+(?=[^\\r\\n;}])/ ;
    contextual BREAK_TERMINATOR_SPACE = /[ \\t]+(?=$|[\\r\\n;}])/ ;
    contextual EXTENSION_TERMINATOR = /[\\r\\n]/ ;
    contextual NON_SEMICOLON_SPACE = /[ \\t]+(?!;)/ ;

    module = application_case | type_case | break_case | extension_case | negative_case ;
    application_case = "app:" first:application "if" second:application ;
    application = head:IDENT (APPLICATION_SPACE arguments:IDENT)* ;
    type_case = "type:" constructor:IDENT TYPE_APPLICATION_SPACE argument:IDENT ;
    break_case = "break:" statement:break_statement trailing:INT? ;
    break_statement = "break" (
      BREAK_TERMINATOR_SPACE
    | BREAK_VALUE_SPACE value:INT
    )? ;
    extension_case = "ext:" first:IDENT EXTENSION_TERMINATOR second:IDENT ;
    negative_case = "neg:" first:IDENT NON_SEMICOLON_SPACE second:IDENT ";" ;
  `;
  const { dir, mod, bytes, plan } = await materialize(grammar);
  try {
    const parser = mod.createParser({ bytes, plan });

    const lexed = parser.lex("app:f x if y z");
    assertEquals(lexed.diagnostics.length, 0);
    assertEquals(lexed.tokenTape.token(2)?.kind, "WS");

    const applied = parser.parse("app:f x if y z");
    assertEquals(applied.ok, true);
    assert(applied.cursor);
    const applicationCase = applied.cursor.child(0);
    assertCursorRule(applicationCase, "application_case");
    const firstApplication = applicationCase.field("first");
    assertCursorRule(firstApplication, "application");
    assertEquals(firstApplication.fieldArray("arguments").length, 1);
    const secondApplication = applicationCase.field("second");
    assertCursorRule(secondApplication, "application");
    assertEquals(secondApplication.fieldArray("arguments").length, 1);

    const stopKeyword = parser.parse("app:f if y");
    assertEquals(stopKeyword.ok, true);

    assertEquals(parser.parse("type:Option Value").ok, true);

    const breakValue = parser.parse("break:break 42");
    assertEquals(breakValue.ok, true);
    assert(breakValue.cursor);
    const breakCase = breakValue.cursor.child(0);
    assertCursorRule(breakCase, "break_case");
    const breakStatement = breakCase.field("statement");
    assertCursorRule(breakStatement, "break_statement");
    const value = breakStatement.field("value");
    assertCursorToken(value, "INT");
    assertEquals(value.text, "42");
    assertEquals(breakCase.field("trailing"), null);

    assertEquals(parser.parse("break:break   ").ok, true);
    assertEquals(parser.parse("ext:first\nsecond").ok, true);
    assertEquals(parser.parse("neg:first second;").ok, true);
    assertEquals(parser.parse("neg:first ;").ok, false);
    parser.dispose();

    const corruptGuard = new Uint8Array(plan);
    const corruptGuardView = new DataView(
      corruptGuard.buffer,
      corruptGuard.byteOffset,
      corruptGuard.byteLength,
    );
    const positiveGuardStartsOffset = corruptGuardView.getInt32(22 * 4, true);
    corruptGuardView.setInt32(positiveGuardStartsOffset, 0x7fff_ffff, true);
    assertThrowsIncludes(
      () => mod.createParser({ bytes, plan: corruptGuard }),
      "invalid guard state",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm cursor parser selects the first viable token candidate deterministically", async () => {
  const grammar = `
    token IDENT = /[a-z]+/ ;
    skip WS = /[ \\t\\r\\n]+/ ;
    module = statement ;
    statement = "return" value:IDENT ";" | value:IDENT ";" ;
  `;
  const { dir, mod, bytes, plan } = await materialize(grammar);
  try {
    const parser = mod.createParser({ bytes, plan });
    const cursorKeyword = parser.parse("return x;");
    assertEquals(cursorKeyword.ok, true);
    assert(cursorKeyword.cursor);
    const keywordStatement = cursorKeyword.cursor.child(0);
    assertCursorRule(keywordStatement, "statement");
    const keywordValue = keywordStatement.field("value");
    assertCursorToken(keywordValue, "IDENT");
    assertEquals(keywordValue.text, "x");

    const validateKeyword = parser.validate("return x;");
    assertEquals(validateKeyword.ok, true);

    const cursorIdent = parser.parse("name;");
    assertEquals(cursorIdent.ok, true);
    assert(cursorIdent.cursor);
    const identStatement = cursorIdent.cursor.child(0);
    assertCursorRule(identStatement, "statement");
    const identValue = identStatement.field("value");
    assertCursorToken(identValue, "IDENT");
    assertEquals(identValue.text, "name");
    parser.dispose();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("shared Wasm adapter explores declared branching LR action sets", async () => {
  const grammar = `
    module = left | right ;
    left = "a" ;
    right = "a" ;
  `;
  const { dir, mod, bytes, plan } = await materialize(
    grammar,
    declaredConflictMetadata(grammar),
  );
  try {
    const parser = mod.createParser({ bytes, plan });
    assertEquals("parseTree" in parser, false);
    const cursorParsed = parser.parse("a");
    assertEquals(cursorParsed.ok, false);
    assertEquals(
      cursorParsed.diagnostics[0].code,
      "PARSER_AMBIGUOUS_PARSE",
    );
    const validateParsed = parser.validate("a");
    assertEquals(validateParsed.ok, false);
    assertEquals(
      validateParsed.diagnostics[0].code,
      "PARSER_AMBIGUOUS_PARSE",
    );

    parser.dispose();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("shared Wasm adapter loads concurrent parser instances with different plans", async () => {
  const alpha = await materialize(`module = "alpha" ;`);
  const beta = await materialize(`module = "beta" "!" ;`);
  try {
    const alphaParser = alpha.mod.createParser({
      bytes: alpha.bytes,
      plan: alpha.plan,
    });
    const betaParser = alpha.mod.createParser({
      bytes: beta.bytes,
      plan: beta.plan,
    });
    assertEquals(alphaParser.parse("alpha").ok, true);
    assertEquals(alphaParser.parse("beta!").ok, false);
    assertEquals(betaParser.parse("beta!").ok, true);
    assertEquals(betaParser.parse("alpha").ok, false);
    const alphaCursor = alphaParser.parse("alpha");
    const betaCursor = betaParser.parse("beta!");
    assertEquals(alphaCursor.ok, true);
    assertEquals(betaCursor.ok, true);
    assert(alphaCursor.cursor);
    assert(betaCursor.cursor);
    assertEquals(
      cursorLabel(alphaCursor.cursor.children()[0]),
      'token:"alpha"',
    );
    assertEquals(cursorLabel(betaCursor.cursor.children()[0]), 'token:"beta"');
    alphaParser.dispose();
    betaParser.dispose();
  } finally {
    await Deno.remove(alpha.dir, { recursive: true });
    await Deno.remove(beta.dir, { recursive: true });
  }
});

Deno.test("shared Wasm adapter validates external plan bytes", async () => {
  const { dir, mod, bytes, plan } = await materialize(`module = "ok" ;`);
  try {
    assertThrowsIncludes(
      () => mod.createParser({ bytes }),
      "requires parser plan bytes",
    );
    assertThrowsIncludes(
      () => mod.createParser({ plan }),
      "exactly one of bytes or module; received bytes=false, module=false",
    );
    const module = new WebAssembly.Module(
      new Uint8Array(bytes).buffer,
    );
    assertThrowsIncludes(
      () => mod.createParser({ bytes, module, plan }),
      "exactly one of bytes or module; received bytes=true, module=true",
    );
    await assertRejectsIncludes(
      () => mod.createParserAsync({ bytes }),
      "exactly one of plan or planUrl; received plan=false, planUrl=false",
    );
    await assertRejectsIncludes(
      () => mod.createParserAsync({ bytes, module, plan }),
      "exactly one of bytes, module, or url; received bytes=true, module=true, url=false",
    );
    await assertRejectsIncludes(
      () =>
        mod.createParserAsync({
          bytes,
          plan,
          planUrl: dataUrl(plan, "application/octet-stream"),
        }),
      "exactly one of plan or planUrl; received plan=true, planUrl=true",
    );
    assertThrowsIncludes(
      () => mod.createParser({ bytes, plan: plan.slice(0, 12) }),
      "truncated",
    );

    const wrongVersion = new Uint8Array(plan);
    new DataView(
      wrongVersion.buffer,
      wrongVersion.byteOffset,
      wrongVersion.byteLength,
    ).setInt32(8, 999, true);
    assertThrowsIncludes(
      () => mod.createParser({ bytes, plan: wrongVersion }),
      "Unsupported parser plan version 999",
    );

    const corruptOffset = new Uint8Array(plan);
    new DataView(
      corruptOffset.buffer,
      corruptOffset.byteOffset,
      corruptOffset.byteLength,
    ).setInt32(20, corruptOffset.byteLength + 4, true);
    assertThrowsIncludes(
      () => mod.createParser({ bytes, plan: corruptOffset }),
      "accepts offset is not aligned",
    );

    const corruptRuntimeMetadata = new Uint8Array(plan);
    const validated = validateCombinedWasmParserPlan(corruptRuntimeMetadata);
    corruptRuntimeMetadata[validated.runtimeMetadataOffset] = 0;
    const parser = mod.createParser({ bytes, plan: corruptRuntimeMetadata });
    assertThrowsIncludes(
      () => parser.lex("ok"),
      "Invalid compact plan magic",
    );
    parser.dispose();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("shared Wasm adapter supports async URL loading", async () => {
  const { dir, mod, bytes, plan } = await materialize(`module = "ok" ;`);
  try {
    const parser = await mod.createParserAsync({
      url: dataUrl(bytes, "application/wasm"),
      planUrl: dataUrl(plan, "application/octet-stream"),
    });
    const parsed = parser.parse("ok");
    assertEquals(parsed.ok, true);
    assert(parsed.cursor);
    parser.dispose();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

function assertCursorRule(
  value:
    | CursorFieldValueLike
    | CursorRuleLike
    | CursorTokenLike
    | undefined,
  name?: string,
): asserts value is CursorRuleLike {
  assert(value !== undefined && value !== null, "Expected cursor rule.");
  assert(!Array.isArray(value), "Expected cursor rule, found array.");
  const element = value as CursorRuleLike | CursorTokenLike;
  assert(element.type === "rule", "Expected cursor rule.");
  if (name !== undefined) {
    assertEquals(element.name, name);
  }
}

function assertCursorToken(
  value:
    | CursorFieldValueLike
    | CursorRuleLike
    | CursorTokenLike
    | undefined,
  kind: string,
): asserts value is CursorTokenLike {
  assert(value !== undefined && value !== null, "Expected cursor token.");
  assert(!Array.isArray(value), "Expected cursor token, found array.");
  const element = value as CursorRuleLike | CursorTokenLike;
  assert(element.type === "token", "Expected cursor token.");
  assertEquals(element.kind, kind);
}

function cursorLabel(
  value: CursorRuleLike | CursorTokenLike | undefined,
): string {
  assert(value !== undefined, "Expected cursor element.");
  if (value.type === "rule") return `rule:${value.name}`;
  if (value.tokenType === "literal") {
    return `token:${JSON.stringify(value.kind)}`;
  }
  return `token:${value.kind}`;
}

function wasmBundle(source: string, metadata?: BabaMetadata) {
  let result: ReturnType<typeof compile>;
  if (metadata === undefined) {
    result = compile(source, { targets: ["wasm"] });
  } else {
    result = compile(source, { targets: ["wasm"], metadata });
  }
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);
  return result.bundle;
}

async function materialize(source: string): Promise<{
  dir: string;
  mod: GeneratedWasmModule;
  bytes: Uint8Array;
  plan: Uint8Array;
}>;
async function materialize(
  source: string,
  metadata: BabaMetadata,
): Promise<{
  dir: string;
  mod: GeneratedWasmModule;
  bytes: Uint8Array;
  plan: Uint8Array;
}>;
async function materialize(
  source: string,
  metadata?: BabaMetadata,
): Promise<{
  dir: string;
  mod: GeneratedWasmModule;
  bytes: Uint8Array;
  plan: Uint8Array;
}> {
  const bundle = wasmBundle(source, metadata);
  const dir = await Deno.makeTempDir();
  await applyBundle(bundle, { root: dir });
  await denoCheck(`${dir}/wasm/mod.ts`);
  return {
    dir,
    mod: await import(`file://${dir}/wasm/mod.ts`) as GeneratedWasmModule,
    bytes: await Deno.readFile(`${dir}/wasm/parser.wasm`),
    plan: await Deno.readFile(`${dir}/wasm/parser.plan`),
  };
}

function declaredConflictMetadata(source: string): BabaMetadata {
  const result = compile(source, { targets: ["wasm"] });
  const conflict = result.diagnostics.find((diagnostic) =>
    diagnostic.code === "RUNTIME_PARSER_REDUCE_REDUCE_CONFLICT" ||
    diagnostic.code === "RUNTIME_PARSER_SHIFT_REDUCE_CONFLICT"
  );
  assert(conflict, "Expected the grammar to report an LR conflict.");
  const match = conflict.message.match(/Conflict ID: (c_[0-9a-f]+)/);
  assert(match, "Expected the conflict diagnostic to include a stable ID.");
  return {
    parser: {
      conflicts: [{ conflict: match[1] }],
    },
  };
}

function textFile(bundle: ReturnType<typeof wasmBundle>, path: string): string {
  const file = bundle.files.find((entry) => entry.path === path);
  assert(file, `Expected generated file ${path}.`);
  assert(file.encoding === "utf-8", `Expected text file ${path}.`);
  return file.content;
}

function serializedFile(
  bundle: ReturnType<typeof wasmBundle>,
  path: string,
): string {
  const file = bundle.files.find((entry) => entry.path === path);
  assert(file, `Expected generated file ${path}.`);
  if (file.encoding === "utf-8") return file.content;
  return [...file.content].join(",");
}

function dataUrl(bytes: Uint8Array, mime: string): URL {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return new URL(`data:${mime};base64,${btoa(binary)}`);
}

async function assertRejectsIncludes(
  operation: () => Promise<unknown>,
  expected: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    assertIncludes(String(error), expected);
    return;
  }
  throw new Error(`Expected promise rejection containing ${expected}.`);
}

function alignTest(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}
