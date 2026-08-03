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
  WASM_I32_BYTES,
  WASM_ISLAND_RESULT_CHILD_COUNT,
  WASM_ISLAND_RESULT_FIELD_COUNT,
  WASM_ISLAND_RESULT_I32_COUNT,
  WASM_ISLAND_RESULT_REGION_COUNT,
  WASM_ISLAND_RESULT_RULE_COUNT,
  WASM_ISLAND_RESULT_STRUCTURAL_COUNT,
  WASM_ISLAND_RESULT_TOKEN_COUNT,
  WASM_ISLAND_RESULT_VALUE_COUNT,
  WASM_ISLAND_STATUS_INVALID,
  WASM_ISLAND_STATUS_OK,
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
import {
  getPortableRuntimePlanInvocationCountForTesting,
  resetPortableRuntimePlanInvocationCountForTesting,
} from "../src/targets/runtime/plan.ts";

const STATEMENT_GRAMMAR = `
  token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
  token INT = /[0-9]+/ ;
  skip WS = /[ \\t\\r\\n]+/ ;

  module = statements:statement* ;
  statement = "let" name:IDENT "=" value:INT ";" ;
`;

// No `skip` rule, so the lexer plan carries no trivia spec at all and the lex
// tape can index the raw records without a filter pass.
const NO_TRIVIA_GRAMMAR = `
  token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;

  module = items:item+ ;
  item = name:IDENT ";" ;
`;

const STRICT_STATEMENT_METADATA: BabaMetadata = {
  gpuFrontend: {
    version: 3,
    throughput: "strict",
    root: "module",
    islands: [
      { rule: "module", boundary: { kind: "root" } },
      { rule: "statement", boundary: { kind: "terminated", terminal: ";" } },
    ],
    semantics: { rules: {} },
  },
};

const STRICT_ITEM_METADATA: BabaMetadata = {
  gpuFrontend: {
    version: 3,
    throughput: "strict",
    root: "module",
    islands: [
      { rule: "module", boundary: { kind: "root" } },
      { rule: "item", boundary: { kind: "terminated", terminal: ";" } },
    ],
    semantics: { rules: {} },
  },
};

Deno.test("Wasm compilation does not construct the portable LR plan", () => {
  resetPortableRuntimePlanInvocationCountForTesting();
  const result = compile(STATEMENT_GRAMMAR, {
    targets: ["wasm"],
    metadata: STRICT_STATEMENT_METADATA,
  });

  assert(result.bundle);
  assertEquals(getPortableRuntimePlanInvocationCountForTesting(), 0);
});

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
  parseRecords(
    source: string,
    records: Int32Array,
    options?: Record<string, unknown>,
  ): CursorParseResultLike;
  validate(
    source: string,
    options?: Record<string, unknown>,
  ): ValidateResultLike;
  createDocument(
    source: string,
    options: Record<string, unknown>,
  ): GeneratedIncrementalDocument;
  dispose(): void;
}

interface GeneratedIncrementalDocument {
  readonly version: number;
  readonly snapshot: {
    readonly version: number;
    readonly length: number;
    slice(start?: number, end?: number): string;
    text(): string;
  };
  lex(): {
    readonly version: number;
    readonly tokenTape: TokenTapeLike;
    readonly diagnostics: readonly DiagnosticLike[];
  };
  validate(): ValidateResultLike;
  parse(): CursorParseResultLike;
  applyEdits(
    edits: readonly {
      readonly start: number;
      readonly oldEnd: number;
      readonly newText: string;
    }[],
  ): {
    readonly version: number;
    readonly lexer: {
      readonly relexedRange: { readonly start: number; readonly end: number };
      readonly createdTokens: number;
      readonly reusedTokens: number;
    };
    readonly parser?: {
      readonly parserActions: number;
      readonly reuseChecks: number;
      readonly reusedCheckpoints: number;
      readonly createdCheckpoints: number;
    };
  };
  dispose(): void;
}

interface RawWasmLexerExports {
  memory: WebAssembly.Memory;
  plan_buffer_base(): number;
  input_base(): number;
  load_plan(planPtr: number, planLength: number): number;
  lex_all(
    sourcePtr: number,
    sourceLength: number,
    mode: number,
    tokenPtr: number,
    tokenCapacity: number,
    memoPtr: number,
    memoCapacity: number,
  ): number;
  lex_memo_i32_per_position(): number;
  analyze_island_records(
    tokenPtr: number,
    rawTokenCount: number,
    maxParserActions: number,
    resultPtr: number,
  ): number;
  materialize_island_records(
    sourceLength: number,
    tokenPtr: number,
    rawTokenCount: number,
    preserveTrivia: number,
    rulePtr: number,
    ruleCapacity: number,
    childPtr: number,
    childCapacity: number,
    fieldPtr: number,
    fieldCapacity: number,
    valuePtr: number,
    valueCapacity: number,
    resultPtr: number,
  ): number;
}

Deno.test("core island exports reject missing result buffers", async () => {
  const { dir, bytes } = await materialize(STATEMENT_GRAMMAR);
  try {
    const instantiated = await WebAssembly.instantiate(
      bytes,
      {},
    ) as unknown as {
      instance: WebAssembly.Instance;
    };
    const wasm = instantiated.instance
      .exports as unknown as RawWasmLexerExports;
    assertEquals(
      wasm.analyze_island_records(0, 0, 1, -1),
      WASM_ISLAND_STATUS_INVALID,
    );
    assertEquals(
      wasm.materialize_island_records(
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        -1,
      ),
      WASM_ISLAND_STATUS_INVALID,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

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
    wasm: { reportStats: true },
  });
  assert(stats.bundle);
  assertEquals(stats.diagnostics[0].code, "WASM_PLAN_STATS");
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
  const bundle = wasmBundle(STATEMENT_GRAMMAR);
  assertEquals(
    bundle.files.map((file) => file.path).join(","),
    "queries/generated-highlights.scm,wasm/abi.json,wasm/manifest.json,wasm/mod.ts,wasm/parser.plan,wasm/parser.wasm,wasm/syntax.ts",
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
    "sourcePtr,sourceLength,mode,tokenPtr,tokenCapacity,memoPtr,memoCapacity",
  );
  const lexMemo = abi.core?.exports?.find((entry) =>
    entry.name === "lex_memo_i32_per_position"
  );
  assert(lexMemo, "Expected lex_memo_i32_per_position in abi.json.");
  assertEquals(lexMemo.params?.join(","), "");
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
    const parsed = parser.parse("let x = 42;", { preserveTrivia: false });
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
  assertEquals(RUNTIME_IMPLEMENTATION_METADATA.sources.length, 21);
  const roles = RUNTIME_IMPLEMENTATION_METADATA.sources.map((source) =>
    source.role
  );
  assertEquals(
    roles.join("\n"),
    [
      "compact-runtime-metadata-codec",
      "parser-plan-contract",
      "combined-wasm-parser-plan-format",
      "generated-wasm-parser-loader",
      "island-parser-loader",
      "island-parser-embedded-bytes",
      "parser-diagnostic-codes",
      "wasm-abi-constants",
      "wasm-core-runtime",
      "wasm-core-runtime-build-script",
      "island-parser-build-script",
      "wasm-core-runtime-rust-manifest",
      "wasm-core-runtime-rust-lockfile",
      "wasm-core-runtime-rust-build-config",
      "wasm-core-runtime-rust-source",
      "wasm-core-runtime-embedded-bytes",
      "island-parser-rust-manifest",
      "island-parser-rust-lockfile",
      "island-parser-rust-build-config",
      "island-parser-rust-source",
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

Deno.test({
  name: "emitted Wasm core validates with wasm-tools when installed",
  ignore: !(await commandAvailable("wasm-tools")),
  async fn() {
    const { dir } = await materialize(`module = "ok" ;`);
    try {
      const result = await runCommand("wasm-tools", [
        "validate",
        `${dir}/wasm/parser.wasm`,
      ]);
      assert(
        result.success,
        `wasm-tools validate failed:\n${result.stdout}${result.stderr}`,
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "emitted Wasm core ABI executes in Wasmtime when installed",
  ignore: !(await commandAvailable("wasmtime")),
  async fn() {
    const { dir } = await materialize(`module = "ok" ;`);
    try {
      const wasmPath = `${dir}/wasm/parser.wasm`;
      const result = await runCommand("wasmtime", [
        "run",
        "--invoke",
        "abi_version",
        wasmPath,
      ]);
      assert(
        result.success,
        `Wasmtime could not invoke abi_version:\n${result.stdout}${result.stderr}`,
      );
      // Wasmtime documents the exact `--invoke` output as unstable. The
      // generated loader tests assert the returned ABI version through the
      // JavaScript embedding API.
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test("combined parser plans round-trip current runtime metadata with exact section sizes", () => {
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

// Core plan format version 9 header slots. Named here rather than imported
// because the encoder and the validator both keep them module-private, and a
// test that reads the bytes is exactly the place that should re-state them.
const CORE_HEADER_DFA_STATE_COUNT = 3;
const CORE_HEADER_ISLAND_STATE_COUNT = 4;
const CORE_HEADER_ISLAND_PLAN = 9;
const CORE_HEADER_SPEC_COUNT = 14;
const CORE_HEADER_DFA_START_STATE = 31;
const CORE_HEADER_ALPHABET_CLASS_COUNT = 32;
const CORE_HEADER_ALPHABET_ASCII_CLASSES = 33;
const CORE_HEADER_ALPHABET_RANGE_COUNT = 34;
const CORE_HEADER_ALPHABET_RANGES = 35;
const ASCII_CLASS_LIMIT = 128;
const MAX_CODE_POINT = 0x10ffff;

function planI32(bytes: Uint8Array, byteOffset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .getInt32(byteOffset, true);
}

function planHeader(bytes: Uint8Array, slot: number): number {
  return planI32(bytes, slot * WASM_I32_BYTES);
}

function setPlanI32(
  bytes: Uint8Array,
  byteOffset: number,
  value: number,
): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .setInt32(byteOffset, value, true);
}

function corePlanBytes(source: string): Uint8Array {
  const bundle = wasmBundle(source);
  const file = bundle.files.find((entry) => entry.path === "wasm/parser.plan");
  assert(file, "Expected wasm/parser.plan.");
  assert(file.encoding === "binary", "Expected a binary parser plan.");
  return new Uint8Array(file.content);
}

Deno.test("core parser plans carry an explicit DFA start state", () => {
  const plan = corePlanBytes(STATEMENT_GRAMMAR);
  const stateCount = planHeader(plan, CORE_HEADER_DFA_STATE_COUNT);
  const startState = planHeader(plan, CORE_HEADER_DFA_START_STATE);
  assert(stateCount > 0, "Expected a non-empty lexer DFA.");
  assert(
    startState >= 0 && startState < stateCount,
    `Start state ${startState} is outside [0, ${stateCount}).`,
  );

  const outOfRange = new Uint8Array(plan);
  setPlanI32(
    outOfRange,
    CORE_HEADER_DFA_START_STATE * WASM_I32_BYTES,
    stateCount,
  );
  assertThrowsIncludes(
    () => validateCombinedWasmParserPlan(outOfRange),
    `DFA start state ${stateCount} is outside`,
  );

  const negative = new Uint8Array(plan);
  setPlanI32(negative, CORE_HEADER_DFA_START_STATE * WASM_I32_BYTES, -1);
  assertThrowsIncludes(
    () => validateCombinedWasmParserPlan(negative),
    "DFA start state must be non-negative",
  );
});

Deno.test("core parser plans persist the alphabet equivalence classes", () => {
  const plan = corePlanBytes(STATEMENT_GRAMMAR);
  const classCount = planHeader(plan, CORE_HEADER_ALPHABET_CLASS_COUNT);
  const asciiOffset = planHeader(plan, CORE_HEADER_ALPHABET_ASCII_CLASSES);
  const rangeCount = planHeader(plan, CORE_HEADER_ALPHABET_RANGE_COUNT);
  const rangesOffset = planHeader(plan, CORE_HEADER_ALPHABET_RANGES);
  assert(classCount > 1, `Expected several classes, got ${classCount}.`);
  assert(rangeCount >= 1, "Expected at least one above-ASCII range.");

  const used = new Set<number>();
  for (let codePoint = 0; codePoint < ASCII_CLASS_LIMIT; codePoint += 1) {
    const classId = planI32(
      plan,
      asciiOffset + codePoint * WASM_I32_BYTES,
    );
    assert(
      classId >= 0 && classId < classCount,
      `ASCII class ${classId} at ${codePoint} is out of range.`,
    );
    used.add(classId);
  }
  let expectedStart = ASCII_CLASS_LIMIT;
  for (let index = 0; index < rangeCount; index += 1) {
    const base = rangesOffset + index * 3 * WASM_I32_BYTES;
    const start = planI32(plan, base);
    const end = planI32(plan, base + WASM_I32_BYTES);
    const classId = planI32(plan, base + 2 * WASM_I32_BYTES);
    assertEquals(start, expectedStart);
    assert(end >= start, `Range ${index} is inverted.`);
    assert(
      classId >= 0 && classId < classCount,
      `Range class ${classId} is out of range.`,
    );
    used.add(classId);
    expectedStart = end + 1;
  }
  assertEquals(expectedStart, MAX_CODE_POINT + 1);
  assertEquals(used.size, classCount);
});

Deno.test("core plan validation rejects a corrupted alphabet section", () => {
  const plan = corePlanBytes(STATEMENT_GRAMMAR);
  const classCount = planHeader(plan, CORE_HEADER_ALPHABET_CLASS_COUNT);
  const asciiOffset = planHeader(plan, CORE_HEADER_ALPHABET_ASCII_CLASSES);
  const rangesOffset = planHeader(plan, CORE_HEADER_ALPHABET_RANGES);
  const asciiClasses: number[] = [];
  for (let codePoint = 0; codePoint < ASCII_CLASS_LIMIT; codePoint += 1) {
    asciiClasses.push(planI32(plan, asciiOffset + codePoint * WASM_I32_BYTES));
  }

  const emptyClasses = new Uint8Array(plan);
  setPlanI32(
    emptyClasses,
    CORE_HEADER_ALPHABET_CLASS_COUNT * WASM_I32_BYTES,
    0,
  );
  assertThrowsIncludes(
    () => validateCombinedWasmParserPlan(emptyClasses),
    "alphabet has no equivalence classes",
  );

  const badAsciiClass = new Uint8Array(plan);
  setPlanI32(badAsciiClass, asciiOffset, classCount);
  assertThrowsIncludes(
    () => validateCombinedWasmParserPlan(badAsciiClass),
    `alphabet class ${classCount} at code point 0 is out of range`,
  );

  const gappedRanges = new Uint8Array(plan);
  setPlanI32(gappedRanges, rangesOffset, ASCII_CLASS_LIMIT + 1);
  assertThrowsIncludes(
    () => validateCombinedWasmParserPlan(gappedRanges),
    `alphabet range 0 starts at ${ASCII_CLASS_LIMIT + 1}, expected 128`,
  );

  const truncatedRanges = new Uint8Array(plan);
  setPlanI32(
    truncatedRanges,
    rangesOffset + WASM_I32_BYTES,
    MAX_CODE_POINT - 1,
  );
  assertThrowsIncludes(
    () => validateCombinedWasmParserPlan(truncatedRanges),
    "alphabet ranges stop at",
  );

  // Merging two classes leaves every offset and length intact, so nothing but
  // the defining property of an equivalence class can catch it. The relabelled
  // code point keeps its own segment (both neighbours hold a third class) and
  // its old class stays populated, so this is exactly a class that no longer
  // has one target vector.
  let merged = -1;
  let mergedInto = -1;
  for (
    let codePoint = 1;
    codePoint < ASCII_CLASS_LIMIT - 1 && merged < 0;
    codePoint += 1
  ) {
    const own = asciiClasses[codePoint];
    const stillUsed = asciiClasses.some((classId, index) =>
      classId === own && index !== codePoint
    );
    if (!stillUsed) continue;
    for (let candidate = 0; candidate < classCount; candidate += 1) {
      if (candidate === own) continue;
      if (candidate === asciiClasses[codePoint - 1]) continue;
      if (candidate === asciiClasses[codePoint + 1]) continue;
      merged = codePoint;
      mergedInto = candidate;
      break;
    }
  }
  assert(merged >= 0, "Expected a relabellable ASCII code point.");
  const mergedClasses = new Uint8Array(plan);
  setPlanI32(
    mergedClasses,
    asciiOffset + merged * WASM_I32_BYTES,
    mergedInto,
  );
  assertThrowsIncludes(
    () => validateCombinedWasmParserPlan(mergedClasses),
    `alphabet class ${mergedInto} is not an equivalence class`,
  );
});

Deno.test("core plan validation rejects corrupted strict island tables", () => {
  const plan = corePlanBytes(STATEMENT_GRAMMAR);
  const stateCount = planHeader(plan, CORE_HEADER_ISLAND_STATE_COUNT);
  const islandOffset = planHeader(plan, CORE_HEADER_ISLAND_PLAN);
  const specCount = planHeader(plan, CORE_HEADER_SPEC_COUNT);
  assert(stateCount > 0, "Expected a strict island state table.");
  assert(islandOffset > 0, "Expected a strict island plan section.");

  const invalidStateCount = new Uint8Array(plan);
  setPlanI32(
    invalidStateCount,
    CORE_HEADER_ISLAND_STATE_COUNT * WASM_I32_BYTES,
    8,
  );
  assertThrowsIncludes(
    () => validateCombinedWasmParserPlan(invalidStateCount),
    "expected at most 7",
  );

  const invalidTransition = new Uint8Array(plan);
  const transitionOffset = islandOffset + (8 + specCount) * WASM_I32_BYTES;
  setPlanI32(invalidTransition, transitionOffset, stateCount + 1);
  assertThrowsIncludes(
    () => validateCombinedWasmParserPlan(invalidTransition),
    `targets state ${stateCount + 1}`,
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
    'field(name: "name"): TokenCursor<"named", "IDENT">;',
  );
  assertIncludes(syntax, "export type RootCursor = ModuleCursor;");
  assertEquals(syntax.includes("contextualLexingStats"), false);
  assertEquals(syntax.includes("maxExploredBranches"), false);
  assertEquals(syntax.includes("maxQueuedBranches"), false);
  assertEquals(syntax.includes("ambiguityMode"), false);
  assertEquals(syntax.includes("PARSE_INVALID_TOKEN_STREAM"), false);
  assertEquals(syntax.includes("PARSER_BRANCH_LIMIT"), false);
  assertEquals(syntax.includes("maxParserActions"), true);

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
          maxParserActions: 1024,
        });
        const records = new Int32Array();
        const recordResult: CursorParseResult<RootCursor> =
          parser.parseRecords("", records);
        parser.validate("let x = 42;", {
          maxParserActions: 1024,
        });
        recordResult;
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

    const cursorParsed = parser.parse("let x = 42;", {
      preserveTrivia: false,
    });
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
    assertThrowsIncludes(
      () => parser.lex("let x = 42;", { preserveTrivia: "yes" }),
      "preserveTrivia must be a boolean, got 'yes'",
    );
    assertThrowsIncludes(
      () => parser.parse("let x = 42;", { maxParserActions: 0 }),
      "maxParserActions must be a positive safe integer, got '0'",
    );
    assertThrowsIncludes(
      () =>
        parser.validate("let x = 42;", {
          maxParserActions: Number.MAX_SAFE_INTEGER + 1,
        }),
      "maxParserActions must be a positive safe integer",
    );
    parser.dispose();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm documents reuse lexer records across edits", async () => {
  const { dir, mod, bytes, plan } = await materialize(STATEMENT_GRAMMAR);
  try {
    const parser = mod.createParser({ bytes, plan }) as GeneratedParser;
    const source = [
      "let alpha = 1;",
      "let beta = 2;",
      "let gamma = 3;",
    ].join("\n");
    const document = parser.createDocument(source, {
      goal: "parse",
      trivia: "discard",
    });
    const oldParse = document.parse();
    assert(oldParse.ok);
    const valueStart = source.indexOf("2");
    const update = document.applyEdits([{
      start: valueStart,
      oldEnd: valueStart + 1,
      newText: "20",
    }]);

    assertEquals(document.version, 1);
    assertEquals(document.snapshot.version, 1);
    assertEquals(document.snapshot.text(), source.replace("2", "20"));
    assert(update.lexer.createdTokens < document.lex().tokenTape.length);
    assert(update.lexer.reusedTokens > 0);
    assert(update.lexer.relexedRange.start <= valueStart);
    assert(update.parser);
    assertEquals(update.parser.reuseChecks, 0);
    assertEquals(update.parser.reusedCheckpoints, 0);
    assertEquals(document.validate().ok, true);
    const newParse = document.parse();
    assert(newParse.ok);
    assertEquals(
      JSON.stringify(cursorShape(oldParse.cursor.child(0) as CursorRuleLike)),
      JSON.stringify(cursorShape(newParse.cursor.child(0) as CursorRuleLike)),
    );
    assertEquals(oldParse.cursor.span.end, source.length);

    const invalidUpdate = document.applyEdits([{
      start: valueStart,
      oldEnd: valueStart + 2,
      newText: "",
    }]);
    assertEquals(invalidUpdate.version, 2);
    const invalidParse = document.parse();
    assertEquals(invalidParse.ok, false);
    assertEquals(invalidParse.cursor, null);
    assertEquals(document.validate().ok, false);

    const versionBeforeRejectedEdits = document.version;
    const sourceBeforeRejectedEdits = document.snapshot.text();
    assertThrowsIncludes(
      () =>
        document.applyEdits([
          { start: 0, oldEnd: 3, newText: "if" },
          { start: 2, oldEnd: 4, newText: "x" },
        ]),
      "overlaps",
    );
    assertEquals(document.version, versionBeforeRejectedEdits);
    assertEquals(document.snapshot.text(), sourceBeforeRejectedEdits);

    const fresh = parser.lex(document.snapshot.text(), {
      preserveTrivia: false,
    });
    const incremental = document.lex();
    assertEquals(
      JSON.stringify(incremental.diagnostics),
      JSON.stringify(fresh.diagnostics),
    );
    assertEquals(incremental.tokenTape.length, fresh.tokenTape.length);
    for (let index = 0; index < fresh.tokenTape.length; index++) {
      assertEquals(
        JSON.stringify(incremental.tokenTape.token(index)),
        JSON.stringify(fresh.tokenTape.token(index)),
      );
    }

    document.dispose();
    parser.dispose();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm documents invalidate guarded tokens from their lookahead dependency", async () => {
  const grammar = `
    token IDENT = /[a-z]+/ ;
    skip WS = /[ ]+/ ;
    contextual APPLICATION_SPACE = /[ ]+(?=[a-z])/ ;
    module = "app" APPLICATION_SPACE IDENT ";" ;
  `;
  const { dir, mod, bytes, plan } = await materialize(grammar);
  try {
    const parser = mod.createParser({ bytes, plan }) as GeneratedParser;
    const source = "app x;";
    const document = parser.createDocument(source, {
      goal: "lex",
      trivia: "preserve",
    });
    const update = document.applyEdits([{
      start: 4,
      oldEnd: 5,
      newText: "#",
    }]);
    assertEquals(update.lexer.relexedRange.start, 3);

    const fresh = parser.lex("app #;", { preserveTrivia: true });
    const incremental = document.lex();
    assertEquals(
      JSON.stringify(incremental.diagnostics),
      JSON.stringify(fresh.diagnostics),
    );
    assertEquals(incremental.tokenTape.length, fresh.tokenTape.length);
    for (let index = 0; index < fresh.tokenTape.length; index++) {
      assertEquals(
        JSON.stringify(incremental.tokenTape.token(index)),
        JSON.stringify(fresh.tokenTape.token(index)),
      );
    }

    document.dispose();
    parser.dispose();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm documents report full island reparses without LR checkpoints", async () => {
  const { dir, mod, bytes, plan } = await materialize(STATEMENT_GRAMMAR);
  try {
    const parser = mod.createParser({ bytes, plan }) as GeneratedParser;
    const source = "let value = 1;\n".repeat(20_000);
    const document = parser.createDocument(source, { goal: "validate" });
    const editStart = Math.floor(source.length / 2) + 12;
    const update = document.applyEdits([{
      start: editStart,
      oldEnd: editStart + 1,
      newText: "2",
    }]);

    assertEquals(document.validate().ok, true);
    assert(update.parser);
    assert(update.parser.parserActions > 0);
    assertEquals(update.parser.reusedCheckpoints, 0);
    assertEquals(update.parser.createdCheckpoints, 0);

    document.dispose();
    parser.dispose();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm documents preserve an earlier diagnostic when a later edit changes no parser prefix", async () => {
  const { dir, mod, bytes, plan } = await materialize(STATEMENT_GRAMMAR);
  try {
    const parser = mod.createParser({ bytes, plan }) as GeneratedParser;
    const source = "let = 1;\nlet value = 2;";
    const document = parser.createDocument(source, { goal: "validate" });
    assertEquals(document.validate().ok, false);
    const unchanged = document.applyEdits([]);
    assertEquals(unchanged.parser?.reusedCheckpoints, 0);

    const editStart = source.lastIndexOf("2");
    const update = document.applyEdits([{
      start: editStart,
      oldEnd: editStart + 1,
      newText: "3",
    }]);
    const incremental = document.validate();
    const fresh = parser.validate(document.snapshot.text());

    assertEquals(incremental.ok, false);
    assertEquals(
      JSON.stringify(incremental.diagnostics),
      JSON.stringify(fresh.diagnostics),
    );
    assertEquals(update.parser?.createdCheckpoints, 0);
    assertEquals(update.parser?.reusedCheckpoints, 0);

    document.dispose();
    parser.dispose();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm documents read each edit field once at the trust boundary", async () => {
  const { dir, mod, bytes, plan } = await materialize(STATEMENT_GRAMMAR);
  try {
    const parser = mod.createParser({ bytes, plan }) as GeneratedParser;
    const document = parser.createDocument("let value = 1;", { goal: "lex" });
    let startReads = 0;
    let oldEndReads = 0;
    let newTextReads = 0;
    const edit = {
      get start(): number {
        startReads++;
        return 12;
      },
      get oldEnd(): number {
        oldEndReads++;
        return 13;
      },
      get newText(): string {
        newTextReads++;
        return "2";
      },
    };

    document.applyEdits([edit]);

    assertEquals(document.snapshot.text(), "let value = 2;");
    assertEquals(startReads, 1);
    assertEquals(oldEndReads, 1);
    assertEquals(newTextReads, 1);

    document.dispose();
    parser.dispose();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm documents read each creation option once at the trust boundary", async () => {
  const { dir, mod, bytes, plan } = await materialize(STATEMENT_GRAMMAR);
  try {
    const parser = mod.createParser({ bytes, plan }) as GeneratedParser;
    let goalReads = 0;
    let triviaReads = 0;
    let limitReads = 0;
    const options = {
      get goal(): "validate" {
        goalReads++;
        return "validate";
      },
      get trivia(): "discard" {
        triviaReads++;
        return "discard";
      },
      get maxParserActions(): number {
        limitReads++;
        return 10_000;
      },
    };

    const document = parser.createDocument("let value = 1;", options);

    assertEquals(document.validate().ok, true);
    assertEquals(goalReads, 1);
    assertEquals(triviaReads, 1);
    assertEquals(limitReads, 1);

    document.dispose();
    parser.dispose();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm documents preserve parity across compound edit shapes", async () => {
  const { dir, mod, bytes, plan } = await materialize(STATEMENT_GRAMMAR);
  try {
    const parser = mod.createParser({ bytes, plan }) as GeneratedParser;
    const source = [
      "let alpha = 1;",
      "let beta = 2;",
      "let gamma = 3;",
    ].join("\n");
    const document = parser.createDocument(source, {
      goal: "parse",
      trivia: "discard",
    });
    const initialParse = document.parse();
    assert(initialParse.ok);
    const alphaStart = source.indexOf("alpha");
    const betaStart = source.indexOf("beta");
    const secondValueStart = source.indexOf("2");
    document.applyEdits([
      { start: alphaStart, oldEnd: alphaStart + 5, newText: "a" },
      { start: betaStart, oldEnd: betaStart + 4, newText: "longBeta" },
      {
        start: secondValueStart,
        oldEnd: secondValueStart + 1,
        newText: "20",
      },
    ]);
    assertIncrementalDocumentParity(parser, document);

    const unrelatedParse = parser.parse("let detached = 5;");
    assertEquals(unrelatedParse.ok, true);

    const beforeBoundaryInsertions = document.snapshot.text();
    document.applyEdits([
      { start: 0, oldEnd: 0, newText: "let zero = 0;\n" },
      {
        start: beforeBoundaryInsertions.length,
        oldEnd: beforeBoundaryInsertions.length,
        newText: "\nlet omega = 4;",
      },
    ]);
    assertIncrementalDocumentParity(parser, document);

    document.applyEdits([
      { start: 4, oldEnd: 5, newText: "a" },
      { start: 5, oldEnd: 6, newText: "b" },
    ]);
    assertIncrementalDocumentParity(parser, document);

    const initialThirdStatement = initialParse.cursor.child(2);
    assertCursorRule(initialThirdStatement, "statement");
    const initialThirdName = initialThirdStatement.field("name");
    assertCursorToken(initialThirdName, "IDENT");
    assertEquals(initialThirdName.text, "gamma");

    document.dispose();
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

Deno.test("Wasm parser consumes externally supplied lexer records", async () => {
  const { dir, mod, bytes, plan } = await materialize(STATEMENT_GRAMMAR);
  try {
    const parser = mod.createParser({ bytes, plan });
    const instantiated = await WebAssembly.instantiate(
      bytes,
      {},
    ) as unknown as {
      instance: WebAssembly.Instance;
    };
    const wasm = instantiated.instance
      .exports as unknown as RawWasmLexerExports;
    const planPtr = wasm.plan_buffer_base();
    if (wasm.memory.buffer.byteLength < planPtr + plan.byteLength) {
      const missing = planPtr + plan.byteLength - wasm.memory.buffer.byteLength;
      wasm.memory.grow(Math.ceil(missing / 65_536));
    }
    new Uint8Array(wasm.memory.buffer, planPtr, plan.byteLength).set(plan);
    assertEquals(wasm.load_plan(planPtr, plan.byteLength), 1);

    const source = "let x = 42;";
    const sourcePtr = wasm.input_base();
    const tokenPtr = alignTest(
      sourcePtr + source.length * WASM_UTF16_UNIT_BYTES,
      WASM_I32_BYTES,
    );
    const tokenCapacity = source.length;
    const tokenBytes = tokenCapacity * WASM_TOKEN_RECORD_I32_COUNT *
      WASM_I32_BYTES;
    const memoPtr = alignTest(tokenPtr + tokenBytes, WASM_I32_BYTES);
    const memoCapacity = (source.length + 1) *
      wasm.lex_memo_i32_per_position();
    const analysisResultPtr = alignTest(
      memoPtr + memoCapacity * WASM_I32_BYTES,
      WASM_I32_BYTES,
    );
    const requiredBytes = analysisResultPtr +
      WASM_ISLAND_RESULT_I32_COUNT * WASM_I32_BYTES;
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
    const recordCount = wasm.lex_all(
      sourcePtr,
      source.length,
      0,
      tokenPtr,
      tokenCapacity,
      memoPtr,
      memoCapacity,
    );
    assert(recordCount > 0, "Expected raw lexer records.");
    assertEquals(
      wasm.analyze_island_records(
        tokenPtr,
        recordCount,
        1_000,
        analysisResultPtr,
      ),
      WASM_ISLAND_STATUS_OK,
    );
    const analysisResult = new Int32Array(
      wasm.memory.buffer,
      analysisResultPtr,
      WASM_ISLAND_RESULT_I32_COUNT,
    );
    assertEquals(analysisResult[WASM_ISLAND_RESULT_TOKEN_COUNT], 0);
    assertEquals(analysisResult[WASM_ISLAND_RESULT_RULE_COUNT], 0);
    assertEquals(analysisResult[WASM_ISLAND_RESULT_CHILD_COUNT], 0);
    assertEquals(analysisResult[WASM_ISLAND_RESULT_FIELD_COUNT], 2);
    assertEquals(analysisResult[WASM_ISLAND_RESULT_VALUE_COUNT], 0);
    assertEquals(analysisResult[WASM_ISLAND_RESULT_STRUCTURAL_COUNT], 5);
    assertEquals(analysisResult[WASM_ISLAND_RESULT_REGION_COUNT], 1);
    const records = new Int32Array(
      wasm.memory.buffer,
      tokenPtr,
      recordCount * WASM_TOKEN_RECORD_I32_COUNT,
    ).slice();

    const parsed = parser.parse(source, { preserveTrivia: false });
    const parsedRecords = parser.parseRecords(source, records, {
      preserveTrivia: false,
    });
    assertEquals(parsed.ok, true);
    assertEquals(parsedRecords.ok, true);
    assert(parsed.cursor);
    assert(parsedRecords.cursor);
    assertEquals(parsedRecords.cursor.name, parsed.cursor.name);
    assertEquals(parsedRecords.cursor.span.start, parsed.cursor.span.start);
    assertEquals(parsedRecords.cursor.span.end, parsed.cursor.span.end);
    assertEquals(
      parsedRecords.cursor.children().map(cursorLabel).join(","),
      parsed.cursor.children().map(cursorLabel).join(","),
    );
    const statement = parsedRecords.cursor.child(0);
    assertCursorRule(statement, "statement");
    const name = statement.field("name");
    assertCursorToken(name, "IDENT");
    assertEquals(name.text, "x");

    parser.dispose();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm parser rejects malformed external lexer records", async () => {
  const { dir, mod, bytes, plan } = await materialize(STATEMENT_GRAMMAR);
  try {
    const parser = mod.createParser({ bytes, plan });
    assertThrowsIncludes(
      () => parser.parseRecords("", new Int32Array(3)),
      "record length 3 is not divisible by 4",
    );
    assertThrowsIncludes(
      () => parser.parseRecords("x", new Int32Array(0)),
      "records end at 0, expected source length 1",
    );
    parser.dispose();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm generation does not run LR conflict analysis", () => {
  const grammar = `
    module = left | right ;
    left = "a" ;
    right = "a" ;
  `;
  const result = compile(grammar, {
    targets: ["wasm"],
  });
  assert(result.bundle);
});

Deno.test("Wasm generation rejects nested strict island regions", () => {
  const result = compile(
    `
    module = items:item* ;
    item = values:value* ";" ;
    value = "x" ;
  `,
    {
      targets: ["wasm"],
      metadata: {
        gpuFrontend: {
          version: 3,
          throughput: "strict",
          root: "module",
          islands: [
            { rule: "module", boundary: { kind: "root" } },
            { rule: "item", boundary: { kind: "terminated", terminal: ";" } },
            { rule: "value", boundary: { kind: "root" } },
          ],
          semantics: { rules: {} },
        },
      },
    },
  );
  assertEquals(result.bundle, undefined);
  const diagnostic = result.diagnostics.find((entry) =>
    entry.code === "WASM_ISLAND_SIMD_REGION_REQUIRED"
  );
  assert(diagnostic);
  assertIncludes(diagnostic.message, "terminal-only transducer");
});

Deno.test("shared Wasm adapter isolates concurrent lexer plans", async () => {
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
    assertEquals(alphaParser.lex("alpha").diagnostics.length, 0);
    assert(alphaParser.lex("beta!").diagnostics.length > 0);
    assertEquals(betaParser.lex("beta!").diagnostics.length, 0);
    assert(betaParser.lex("alpha").diagnostics.length > 0);
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
    const module = new WebAssembly.Module(new Uint8Array(bytes).buffer);
    assertThrowsIncludes(
      () => mod.createParser({ bytes, module, plan }),
      "exactly one of bytes or module; received bytes=true, module=true",
    );
    await assertRejectsIncludes(
      () => mod.createParserAsync({ bytes }),
      "exactly one of plan or planUrl; received plan=false, planUrl=false",
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

Deno.test("shared Wasm adapter supports async URL lexer loading", async () => {
  const { dir, mod, bytes, plan } = await materialize(`module = "ok" ;`);
  try {
    const parser = await mod.createParserAsync({
      url: dataUrl(bytes, "application/wasm"),
      planUrl: dataUrl(plan, "application/octet-stream"),
    });
    const lexed = parser.lex("ok");
    assertEquals(lexed.diagnostics.length, 0);
    assertEquals(lexed.tokenTape.token(0)?.text, "ok");
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

function assertIncrementalDocumentParity(
  parser: GeneratedParser,
  document: GeneratedIncrementalDocument,
): void {
  const source = document.snapshot.text();
  const incrementalLex = document.lex();
  const freshLex = parser.lex(source, { preserveTrivia: false });
  assertEquals(
    JSON.stringify(incrementalLex.diagnostics),
    JSON.stringify(freshLex.diagnostics),
  );
  assertEquals(incrementalLex.tokenTape.length, freshLex.tokenTape.length);
  for (let index = 0; index < freshLex.tokenTape.length; index++) {
    assertEquals(
      JSON.stringify(incrementalLex.tokenTape.token(index)),
      JSON.stringify(freshLex.tokenTape.token(index)),
    );
  }

  const incrementalValidate = document.validate();
  const freshValidate = parser.validate(source);
  assertEquals(incrementalValidate.ok, freshValidate.ok);
  assertEquals(
    JSON.stringify(incrementalValidate.diagnostics),
    JSON.stringify(freshValidate.diagnostics),
  );

  const incrementalParse = document.parse();
  const freshParse = parser.parse(source, { preserveTrivia: false });
  assertEquals(incrementalParse.ok, freshParse.ok);
  assertEquals(
    JSON.stringify(incrementalParse.diagnostics),
    JSON.stringify(freshParse.diagnostics),
  );
  if (incrementalParse.ok && freshParse.ok) {
    assertEquals(
      JSON.stringify(cursorShape(incrementalParse.cursor)),
      JSON.stringify(cursorShape(freshParse.cursor)),
    );
  }
}

function cursorShape(
  cursor: CursorRuleLike | CursorTokenLike,
): unknown {
  if (cursor.type === "token") {
    return {
      type: cursor.type,
      tokenType: cursor.tokenType,
      kind: cursor.kind,
      text: cursor.text,
      span: cursor.span,
      tokenIndex: cursor.tokenIndex,
    };
  }
  return {
    type: cursor.type,
    name: cursor.name,
    span: cursor.span,
    tokenRange: cursor.tokenRange,
    children: cursor.children().map(cursorShape),
  };
}

function wasmBundle(source: string, metadata?: BabaMetadata) {
  let selectedMetadata = metadata;
  if (selectedMetadata === undefined && source === STATEMENT_GRAMMAR) {
    selectedMetadata = STRICT_STATEMENT_METADATA;
  }
  if (selectedMetadata === undefined && source === NO_TRIVIA_GRAMMAR) {
    selectedMetadata = STRICT_ITEM_METADATA;
  }
  let result: ReturnType<typeof compile>;
  if (selectedMetadata === undefined) {
    result = compile(source, { targets: ["wasm"] });
  } else {
    result = compile(source, { targets: ["wasm"], metadata: selectedMetadata });
  }
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);
  return result.bundle;
}

async function commandAvailable(commandName: string): Promise<boolean> {
  try {
    const result = await new Deno.Command(commandName, {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    }).output();
    return result.success;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

async function runCommand(
  commandName: string,
  args: readonly string[],
): Promise<{
  readonly success: boolean;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const result = await new Deno.Command(commandName, {
    args: [...args],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return {
    success: result.success,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
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
