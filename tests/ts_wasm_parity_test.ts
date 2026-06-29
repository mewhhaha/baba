import {
  applyBundle,
  assert,
  assertEquals,
  assertIncludes,
  compile,
  denoCheck,
  fixtureMetadata,
  fixtureNames,
  fixtureSampleEntries,
  parseMetadata,
} from "./helpers.ts";

const deterministicGrammar = `
  token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
  token INTEGER = /[0-9]+/ ;
  skip WS = /[ \\t\\r\\n]+/ ;
  skip COMMENT = /\\/\\/[^\\n\\r]*/ ;

  module = items:item* ;
  item = declaration | keyword | emoji ;
  declaration = "let" name:IDENT "=" value:(INTEGER | "if") ";" ;
  keyword = "if" subject:IDENT ";" ;
  emoji = "emoji" icon:"😀" ";" ;
`;

const conflictGrammar = `
  token ID = /[A-Za-z_][A-Za-z0-9_]*/ ;
  skip WS = /[ \\t\\r\\n]+/ ;

  module = primary ;
  primary = tuple | group | atom ;
  tuple = "(" atom "," atom ")" ;
  group = "(" atom ")" ;
  atom = modifier* term ;
  modifier = "mut" ;
  term = ID | "(" primary ")" ;
`;

Deno.test("parity mismatch diagnostics include a reproducible JSON diff", () => {
  let message = "";
  try {
    assertJsonEquals(
      { tokens: [{ type: "named", span: { start: 0, end: 1 } }] },
      { tokens: [{ type: "named", span: { start: 0, end: 2 } }] },
      {
        operation: "parse",
        fixture: "diagnostic-fixture",
        sourcePath: "fixtures/diagnostic-fixture/valid/sample.txt",
        source: "x",
        metadata: { targets: ["typescript", "wasm"] },
        command: "deno test --filter diagnostic-fixture",
      },
    );
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assertIncludes(message, "TypeScript/Wasm parity mismatch.");
  assertIncludes(message, "operation: parse");
  assertIncludes(message, "fixture: diagnostic-fixture");
  assertIncludes(
    message,
    "source path: fixtures/diagnostic-fixture/valid/sample.txt",
  );
  assertIncludes(
    message,
    "first differing normalized JSON path: $.tokens[0].span.end",
  );
  assertIncludes(message, "actual: 1");
  assertIncludes(message, "expected: 2");
  assertIncludes(
    message,
    'grammar/metadata options: {"targets":["typescript","wasm"]}',
  );
  assertIncludes(message, 'source: "x"');
  assertIncludes(
    message,
    "reproducible command: deno test --filter diagnostic-fixture",
  );
});

Deno.test("TypeScript and Wasm runtimes match deterministic parser behavior", async () => {
  const runtimes = await buildParityRuntimes(deterministicGrammar);
  try {
    assertPlanMetadataParity(runtimes);
    for (
      const source of [
        "let alpha = 42; if beta; emoji 😀;",
        "// leading trivia\nlet iffy = if;\nemoji 😀;",
        "let = 1;",
        "if ;",
        "emoji x;",
      ]
    ) {
      assertRuntimeParity(runtimes, source, {
        source,
        command:
          "deno test --allow-read --allow-write --allow-run tests/ts_wasm_parity_test.ts --filter deterministic",
      });
    }

    const source = "// trivia\nlet value = 7;";
    assertJsonEquals(
      normalizeLexResult(runtimes.ts.lex(source, { preserveTrivia: false })),
      normalizeLexResult(runtimes.wasm.lex(source, { preserveTrivia: false })),
      {
        operation: "lex preserveTrivia=false",
        source,
        command:
          "deno test --allow-read --allow-write --allow-run tests/ts_wasm_parity_test.ts --filter deterministic",
      },
    );
    assertJsonEquals(
      normalizeParseResult(
        runtimes.ts.parse(source, { preserveTrivia: false }),
      ),
      normalizeParseResult(
        runtimes.wasm.parse(source, { preserveTrivia: false }),
      ),
      {
        operation: "parse preserveTrivia=false",
        source,
        command:
          "deno test --allow-read --allow-write --allow-run tests/ts_wasm_parity_test.ts --filter deterministic",
      },
    );

    const emoji = runtimes.ts.parse("emoji 😀;");
    assert(emoji.ok);
    assert(emoji.root);
    const emojiItem = (emoji.root.fields.items as RuntimeRuleNode[])[0];
    const emojiNode = emojiItem.children[0] as RuntimeRuleNode;
    const icon = emojiNode.fields.icon as RuntimeToken;
    assertEquals(icon.span.end, 8);
  } finally {
    await runtimes.cleanup();
  }
});

Deno.test("TypeScript and Wasm runtimes match portable fixture corpus", async () => {
  for (const fixture of await fixtureNames()) {
    if (fixture === "invalid-regex") continue;
    try {
      await Deno.stat(`fixtures/${fixture}/grammar.ebnf`);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      throw error;
    }
    const source = await Deno.readTextFile(`fixtures/${fixture}/grammar.ebnf`);
    const metadataJson = await fixtureMetadata(fixture);
    const options = metadataJson === undefined
      ? {}
      : { metadata: parseMetadata(JSON.stringify(metadataJson)) };
    const runtimes = await buildParityRuntimes(source, options);
    try {
      assertPlanMetadataParity(runtimes);
      for (const sample of await fixtureSampleEntries(fixture, "valid")) {
        const context = fixtureParityContext(
          fixture,
          sample.path,
          sample.source,
          metadataJson,
        );
        assertRuntimeParity(runtimes, sample.source, context);
        assertEquals(
          runtimes.ts.parse(sample.source).ok,
          true,
          `${fixture} valid sample should parse`,
        );
      }
      for (const sample of await fixtureSampleEntries(fixture, "invalid")) {
        const context = fixtureParityContext(
          fixture,
          sample.path,
          sample.source,
          metadataJson,
        );
        assertRuntimeParity(runtimes, sample.source, context);
        assertEquals(
          runtimes.ts.parse(sample.source).ok,
          false,
          `${fixture} invalid sample should fail`,
        );
      }
    } finally {
      await runtimes.cleanup();
    }
  }
});

Deno.test("invalid regex fixture remains a compiler diagnostic", () => {
  const source = Deno.readTextFileSync("fixtures/invalid-regex/grammar.ebnf");
  const result = compile(source, { targets: ["typescript", "wasm"] });
  assertEquals(result.bundle, undefined);
  assert(
    result.diagnostics.some((diagnostic) =>
      diagnostic.code === "PORTABLE_REGEX_UNSUPPORTED" ||
      diagnostic.code === "EBNF_PARSE_ERROR"
    ),
  );
});

Deno.test("TypeScript and Wasm parseTokens APIs stay in parity", async () => {
  const runtimes = await buildParityRuntimes(deterministicGrammar);
  try {
    const source = "let alpha = 42; // ok\nif beta;";
    const tsLexed = runtimes.ts.lex(source);
    const wasmLexed = runtimes.wasm.lex(source);
    assertJsonEquals(
      normalizeParseResult(runtimes.ts.parseTokens(source, tsLexed.tokens)),
      normalizeParseResult(runtimes.wasm.parseTokens(source, wasmLexed.tokens)),
      { operation: "parseTokens", source },
    );
    assertJsonEquals(
      normalizeParseResult(
        runtimes.ts.parseTokensUnchecked(source, tsLexed.tokens),
      ),
      normalizeParseResult(
        runtimes.wasm.parseTokensUnchecked(source, wasmLexed.tokens),
      ),
      { operation: "parseTokensUnchecked", source },
    );

    const tsWithoutTrivia = tsLexed.tokens.filter((token: RuntimeToken) =>
      token.channel !== "trivia"
    );
    const wasmWithoutTrivia = wasmLexed.tokens.filter((token: RuntimeToken) =>
      token.channel !== "trivia"
    );
    assertJsonEquals(
      normalizeParseResult(runtimes.ts.parseTokens(source, tsWithoutTrivia)),
      normalizeParseResult(
        runtimes.wasm.parseTokens(source, wasmWithoutTrivia),
      ),
      { operation: "parseTokens without trivia", source },
    );
    assertJsonEquals(
      normalizeParseResult(
        runtimes.ts.parseTokensUnchecked(source, tsWithoutTrivia),
      ),
      normalizeParseResult(
        runtimes.wasm.parseTokensUnchecked(source, wasmWithoutTrivia),
      ),
      { operation: "parseTokensUnchecked without trivia", source },
    );

    const omittedMain = tsWithoutTrivia.slice(1);
    const omittedMainWasm = wasmWithoutTrivia.slice(1);
    assertJsonEquals(
      normalizeParseResult(runtimes.ts.parseTokens(source, omittedMain)),
      normalizeParseResult(runtimes.wasm.parseTokens(source, omittedMainWasm)),
      { operation: "parseTokens omitted main token", source },
    );

    const malformedTs = tsWithoutTrivia.map((token: RuntimeToken) =>
      token.type === "named" && token.kind === "IDENT" && token.text === "beta"
        ? { ...token, span: { ...token.span, end: token.span.start } }
        : token
    );
    const malformedWasm = wasmWithoutTrivia.map((token: RuntimeToken) =>
      token.type === "named" && token.kind === "IDENT" && token.text === "beta"
        ? { ...token, span: { ...token.span, end: token.span.start } }
        : token
    );
    const strictMalformedTs = runtimes.ts.parseTokens(source, malformedTs);
    const strictMalformedWasm = runtimes.wasm.parseTokens(
      source,
      malformedWasm,
    );
    assertJsonEquals(
      normalizeParseResult(strictMalformedTs),
      normalizeParseResult(strictMalformedWasm),
      { operation: "parseTokens malformed token stream", source },
    );
    assertEquals(strictMalformedTs.ok, false);
    assertEquals(strictMalformedWasm.ok, false);
    assert(
      strictMalformedTs.diagnostics.some((diagnostic) =>
        diagnostic.code === "PARSE_INVALID_TOKEN_STREAM"
      ),
    );
    assert(
      strictMalformedWasm.diagnostics.some((diagnostic) =>
        diagnostic.code === "PARSE_INVALID_TOKEN_STREAM"
      ),
    );

    const uncheckedMalformedTs = runtimes.ts.parseTokensUnchecked(
      source,
      malformedTs,
    );
    const uncheckedMalformedWasm = runtimes.wasm.parseTokensUnchecked(
      source,
      malformedWasm,
    );
    assertJsonEquals(
      normalizeParseResult(uncheckedMalformedTs),
      normalizeParseResult(uncheckedMalformedWasm),
      { operation: "parseTokensUnchecked malformed token stream", source },
    );
    assert(
      !uncheckedMalformedTs.diagnostics.some((diagnostic) =>
        diagnostic.code === "PARSE_INVALID_TOKEN_STREAM"
      ),
    );
    assert(
      !uncheckedMalformedWasm.diagnostics.some((diagnostic) =>
        diagnostic.code === "PARSE_INVALID_TOKEN_STREAM"
      ),
    );
  } finally {
    await runtimes.cleanup();
  }
});

Deno.test("TypeScript and Wasm runtimes match declared conflict branches", async () => {
  const unresolved = compile(conflictGrammar, {
    targets: ["typescript"],
  });
  assertEquals(unresolved.bundle, undefined);
  const conflict = conflictIdFromMessage(unresolved.diagnostics[0].message);
  const metadata = parseMetadata(JSON.stringify({
    version: 2,
    parser: {
      conflicts: [{ conflict }],
    },
  }));
  const runtimes = await buildParityRuntimes(conflictGrammar, { metadata });
  try {
    for (const source of ["(a)", "(a, b)", "((a))", "(mut a, b)", "(a, )"]) {
      assertRuntimeParity(runtimes, source, {
        operation: "declared conflict branch",
        source,
        metadata: { parser: { conflicts: [{ conflict }] } },
      });
    }
  } finally {
    await runtimes.cleanup();
  }
});

Deno.test("TypeScript and Wasm parse contextual token overlaps in parity", async () => {
  const result = compile(
    `
    skip WS = / +/ ;
    token A priority 10 = /x/ ;
    token B priority 0 = /x/ ;
    module = "a" A | "b" B ;
  `,
    {
      targets: ["typescript", "wasm"],
      typescript: { directory: "ts" },
      wasm: { directory: "wasm" },
    },
  );
  assertEquals(result.diagnostics.length, 2);
  assertEquals(result.diagnostics[0].code, "PORTABLE_LEXER_TOKEN_OVERLAP");
  assertEquals(result.diagnostics[0].severity, "warning");
  assertEquals(
    result.diagnostics[1].code,
    "PORTABLE_SHADOWED_TOKEN_LANGUAGE",
  );
  assertEquals(result.diagnostics[1].severity, "warning");
  assert(result.bundle);
  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/ts/mod.ts`);
    await denoCheck(`${dir}/wasm/mod.ts`);
    const runtimes: ParityRuntimes = {
      ts: await import(`file://${dir}/ts/mod.ts`),
      wasm: await import(`file://${dir}/wasm/mod.ts`),
      cleanup: () => Deno.remove(dir, { recursive: true }),
    };
    assertRuntimeParity(runtimes, "a x", {
      operation: "contextual overlap",
      source: "a x",
    });
    assertRuntimeParity(runtimes, "b x", {
      operation: "contextual overlap",
      source: "b x",
    });
    const tsStats: unknown[] = [];
    const wasmStats: unknown[] = [];
    assertEquals(
      runtimes.ts.parse("b x", {
        contextualLexingStats: (entry: unknown) => tsStats.push(entry),
      }).ok,
      true,
    );
    assertEquals(
      runtimes.wasm.parse("b x", {
        contextualLexingStats: (entry: unknown) => wasmStats.push(entry),
      }).ok,
      true,
    );
    assertEquals(tsStats.length, wasmStats.length);
    const tsFirst = tsStats[0] as {
      ambiguousLexicalSites: number;
      attemptedTokenSelections: number;
      contextualCandidateChecks: number;
    };
    const wasmFirst = wasmStats[0] as {
      ambiguousLexicalSites: number;
      attemptedTokenSelections: number;
      contextualCandidateChecks: number;
    };
    assertEquals(
      tsFirst.ambiguousLexicalSites,
      wasmFirst.ambiguousLexicalSites,
    );
    assertEquals(
      tsFirst.attemptedTokenSelections,
      wasmFirst.attemptedTokenSelections,
    );
    assert(tsFirst.contextualCandidateChecks >= 2);
    assert(wasmFirst.contextualCandidateChecks >= 2);

    const tsLexed = runtimes.ts.lex("b x", { preserveTrivia: false });
    const wasmLexed = runtimes.wasm.lex("b x", { preserveTrivia: false });
    assertJsonEquals(
      normalizeLexResult(tsLexed),
      normalizeLexResult(wasmLexed),
      { operation: "standalone contextual lex", source: "b x" },
    );
    assertEquals(
      tsLexed.tokens.filter((token) => token.channel !== "eof")[1].kind,
      "A",
    );
    assertEquals(
      runtimes.ts.parseTokens(tsLexed.source, tsLexed.tokens).ok,
      false,
    );
    assertEquals(
      runtimes.wasm.parseTokens(wasmLexed.source, wasmLexed.tokens).ok,
      false,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

function conflictIdFromMessage(message: string): string {
  const match = message.match(/Conflict ID: (c_[0-9a-f]+)/);
  assert(match);
  return match[1];
}

async function buildParityRuntimes(
  source: string,
  options: Record<string, unknown> = {},
): Promise<ParityRuntimes> {
  const result = compile(source, {
    ...options,
    targets: ["typescript", "wasm"],
    typescript: { directory: "ts" },
    wasm: { directory: "wasm" },
  });
  assert(
    result.diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    `Expected no compile errors, got ${JSON.stringify(result.diagnostics)}`,
  );
  assert(result.bundle);
  const dir = await Deno.makeTempDir();
  await applyBundle(result.bundle, { root: dir });
  await denoCheck(`${dir}/ts/mod.ts`);
  await denoCheck(`${dir}/wasm/mod.ts`);
  return {
    ts: await import(`file://${dir}/ts/mod.ts`),
    wasm: await import(`file://${dir}/wasm/mod.ts`),
    cleanup: () => Deno.remove(dir, { recursive: true }),
  };
}

function assertRuntimeParity(
  runtimes: ParityRuntimes,
  source: string,
  context: ParityAssertionContext = {},
): void {
  assertJsonEquals(
    normalizeLexResult(runtimes.ts.lex(source)),
    normalizeLexResult(runtimes.wasm.lex(source)),
    { ...context, operation: context.operation ?? "lex" },
  );
  assertJsonEquals(
    normalizeParseResult(runtimes.ts.parse(source)),
    normalizeParseResult(runtimes.wasm.parse(source)),
    { ...context, operation: context.operation ?? "parse" },
  );
}

function assertPlanMetadataParity(runtimes: ParityRuntimes): void {
  assertEquals(runtimes.ts.parserPlanFormat, "baba-parser-plan");
  assertEquals(runtimes.ts.parserPlanVersion, 1);
  assertEquals(runtimes.ts.parserPlanSemantics, "baba-portable-v1");
  assertEquals(runtimes.ts.parserPlanFormat, runtimes.wasm.parserPlanFormat);
  assertEquals(runtimes.ts.parserPlanVersion, runtimes.wasm.parserPlanVersion);
  assertEquals(
    runtimes.ts.parserPlanSemantics,
    runtimes.wasm.parserPlanSemantics,
  );
  assertEquals(runtimes.ts.parserPlanHash, runtimes.wasm.parserPlanHash);
  assert(runtimes.ts.parserPlanHash.startsWith("fnv1a64:"));
  assertEquals(
    runtimes.ts.runtimeImplementationFormat,
    "baba-runtime-implementation",
  );
  assertEquals(runtimes.ts.runtimeImplementationVersion, 1);
  assertEquals(
    runtimes.ts.runtimeImplementationSemantics,
    "baba-runtime-portable-v1",
  );
  assertEquals(
    runtimes.ts.runtimeImplementationFormat,
    runtimes.wasm.runtimeImplementationFormat,
  );
  assertEquals(
    runtimes.ts.runtimeImplementationVersion,
    runtimes.wasm.runtimeImplementationVersion,
  );
  assertEquals(
    runtimes.ts.runtimeImplementationSemantics,
    runtimes.wasm.runtimeImplementationSemantics,
  );
  assertEquals(
    runtimes.ts.runtimeImplementationHash,
    runtimes.wasm.runtimeImplementationHash,
  );
  assert(runtimes.ts.runtimeImplementationHash.startsWith("fnv1a64:"));
}

function normalizeLexResult(result: RuntimeLexResult): unknown {
  return {
    source: result.source,
    tokens: result.tokens.map(normalizeToken),
    diagnostics: result.diagnostics.map(normalizeDiagnostic),
  };
}

function normalizeParseResult(result: RuntimeParseResult): unknown {
  return {
    ok: result.ok,
    root: result.root ? normalizeNode(result.root) : null,
    source: result.source,
    tokens: result.tokens.map(normalizeToken),
    diagnostics: result.diagnostics.map(normalizeDiagnostic),
  };
}

function normalizeNode(node: RuntimeRuleNode): unknown {
  return {
    type: node.type,
    name: node.name,
    span: node.span,
    tokenRange: node.tokenRange,
    children: node.children.map(normalizeElement),
    fields: normalizeFields(node.fields),
  };
}

function normalizeElement(element: RuntimeSyntaxElement): unknown {
  return element.type === "rule"
    ? normalizeNode(element as RuntimeRuleNode)
    : normalizeToken(element as RuntimeToken);
}

function normalizeFields(fields: Record<string, unknown>): unknown {
  return Object.fromEntries(
    Object.entries(fields).sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => [name, normalizeFieldValue(value)]),
  );
}

function normalizeFieldValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeFieldValue);
  if (!value || typeof value !== "object") return value;
  const typed = value as { type?: unknown };
  if (typed.type === "rule") return normalizeNode(value as RuntimeRuleNode);
  if (
    typed.type === "literal" ||
    typed.type === "named" ||
    typed.type === "eof" ||
    typed.type === "error"
  ) {
    return normalizeToken(value as RuntimeToken);
  }
  return value;
}

function normalizeToken(token: RuntimeToken): unknown {
  return {
    type: token.type,
    kind: token.kind,
    literal: token.literal,
    text: token.text,
    span: token.span,
    channel: token.channel,
  };
}

function normalizeDiagnostic(diagnostic: RuntimeDiagnostic): unknown {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    span: diagnostic.span,
    runtimeCode: diagnostic.runtimeCode,
    runtimeDetail: diagnostic.runtimeDetail,
    runtimeDetailKind: diagnostic.runtimeDetailKind,
    runtimeDetailKindId: diagnostic.runtimeDetailKindId,
    expected: diagnostic.expected,
    found: diagnostic.found,
  };
}

function assertJsonEquals(
  actual: unknown,
  expected: unknown,
  context: ParityAssertionContext = {},
): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson === expectedJson) return;
  const difference = firstJsonDifference(actual, expected);
  assert(difference);
  throw new Error(
    [
      "TypeScript/Wasm parity mismatch.",
      `operation: ${context.operation ?? "unknown"}`,
      context.fixture ? `fixture: ${context.fixture}` : undefined,
      context.sourcePath ? `source path: ${context.sourcePath}` : undefined,
      "target comparison: TypeScript actual vs Wasm expected",
      `first differing normalized JSON path: ${difference.path}`,
      `actual: ${JSON.stringify(difference.actual)}`,
      `expected: ${JSON.stringify(difference.expected)}`,
      context.metadata
        ? `grammar/metadata options: ${JSON.stringify(context.metadata)}`
        : undefined,
      context.source ? `source: ${JSON.stringify(context.source)}` : undefined,
      `reproducible command: ${
        context.command ??
          "deno test --allow-read --allow-write --allow-run tests/ts_wasm_parity_test.ts"
      }`,
    ].filter((line): line is string => line !== undefined).join("\n"),
  );
}

function firstJsonDifference(
  actual: unknown,
  expected: unknown,
  path = "$",
): { path: string; actual: unknown; expected: unknown } | null {
  if (Object.is(actual, expected)) return null;
  if (
    Array.isArray(actual) && Array.isArray(expected)
  ) {
    const length = Math.max(actual.length, expected.length);
    for (let index = 0; index < length; index++) {
      if (index >= actual.length || index >= expected.length) {
        return {
          path: `${path}[${index}]`,
          actual: actual[index],
          expected: expected[index],
        };
      }
      const difference = firstJsonDifference(
        actual[index],
        expected[index],
        `${path}[${index}]`,
      );
      if (difference) return difference;
    }
    return null;
  }
  if (
    actual && expected && typeof actual === "object" &&
    typeof expected === "object"
  ) {
    const actualRecord = actual as Record<string, unknown>;
    const expectedRecord = expected as Record<string, unknown>;
    const keys = [
      ...new Set([
        ...Object.keys(actualRecord),
        ...Object.keys(expectedRecord),
      ]),
    ].sort();
    for (const key of keys) {
      if (!(key in actualRecord) || !(key in expectedRecord)) {
        return {
          path: `${path}.${key}`,
          actual: actualRecord[key],
          expected: expectedRecord[key],
        };
      }
      const difference = firstJsonDifference(
        actualRecord[key],
        expectedRecord[key],
        `${path}.${key}`,
      );
      if (difference) return difference;
    }
    return null;
  }
  return { path, actual, expected };
}

function fixtureParityContext(
  fixture: string,
  sourcePath: string,
  source: string,
  metadata: unknown,
): ParityAssertionContext {
  return {
    fixture,
    sourcePath,
    source,
    metadata,
    command:
      "deno test --allow-read --allow-write --allow-run tests/ts_wasm_parity_test.ts --filter 'portable fixture corpus'",
  };
}

interface ParityRuntimes {
  ts: RuntimeModule;
  wasm: RuntimeModule;
  cleanup: () => Promise<void>;
}

interface ParityAssertionContext {
  fixture?: string;
  sourcePath?: string;
  source?: string;
  operation?: string;
  metadata?: unknown;
  command?: string;
}

interface RuntimeModule {
  parserPlanFormat: "baba-parser-plan";
  parserPlanVersion: number;
  parserPlanSemantics: "baba-portable-v1";
  parserPlanHash: string;
  runtimeImplementationFormat: "baba-runtime-implementation";
  runtimeImplementationVersion: number;
  runtimeImplementationSemantics: "baba-runtime-portable-v1";
  runtimeImplementationHash: string;
  lex(source: string, options?: { preserveTrivia?: boolean }): RuntimeLexResult;
  parse(
    source: string,
    options?: {
      preserveTrivia?: boolean;
      contextualLexingStats?: (stats: unknown) => void;
    },
  ): RuntimeParseResult;
  parseTokens(
    source: string,
    tokens: readonly RuntimeToken[],
  ): RuntimeParseResult;
  parseTokensUnchecked(
    source: string,
    tokens: readonly RuntimeToken[],
  ): RuntimeParseResult;
}

interface RuntimeLexResult {
  source: string;
  tokens: RuntimeToken[];
  diagnostics: RuntimeDiagnostic[];
}

interface RuntimeParseResult {
  ok: boolean;
  root: RuntimeRuleNode | null;
  source: string;
  tokens: RuntimeToken[];
  diagnostics: RuntimeDiagnostic[];
}

type RuntimeSyntaxElement = RuntimeRuleNode | RuntimeToken;

interface RuntimeRuleNode {
  type: "rule";
  name: string;
  span: RuntimeSpan;
  tokenRange: { start: number; end: number };
  children: RuntimeSyntaxElement[];
  fields: Record<string, unknown>;
}

interface RuntimeToken {
  type: string;
  kind?: string;
  literal?: string;
  text: string;
  span: RuntimeSpan;
  channel: string;
}

interface RuntimeDiagnostic {
  code: string;
  message: string;
  span: RuntimeSpan;
  runtimeCode: number;
  runtimeDetail: number;
  runtimeDetailKind: "none" | "parser-state";
  runtimeDetailKindId: number;
  expected?: string[];
  found?: string;
}

interface RuntimeSpan {
  start: number;
  end: number;
}
