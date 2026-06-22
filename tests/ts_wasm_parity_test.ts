import {
  applyBundle,
  assert,
  assertEquals,
  compile,
  denoCheck,
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
      assertRuntimeParity(runtimes, source);
    }

    const source = "// trivia\nlet value = 7;";
    assertJsonEquals(
      normalizeLexResult(runtimes.ts.lex(source, { preserveTrivia: false })),
      normalizeLexResult(runtimes.wasm.lex(source, { preserveTrivia: false })),
    );
    assertJsonEquals(
      normalizeParseResult(
        runtimes.ts.parse(source, { preserveTrivia: false }),
      ),
      normalizeParseResult(
        runtimes.wasm.parse(source, { preserveTrivia: false }),
      ),
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

Deno.test("TypeScript and Wasm parseTokens APIs stay in parity", async () => {
  const runtimes = await buildParityRuntimes(deterministicGrammar);
  try {
    const source = "let alpha = 42; // ok\nif beta;";
    const tsLexed = runtimes.ts.lex(source);
    const wasmLexed = runtimes.wasm.lex(source);
    assertJsonEquals(
      normalizeParseResult(runtimes.ts.parseTokens(source, tsLexed.tokens)),
      normalizeParseResult(runtimes.wasm.parseTokens(source, wasmLexed.tokens)),
    );
    assertJsonEquals(
      normalizeParseResult(
        runtimes.ts.parseTokensUnchecked(source, tsLexed.tokens),
      ),
      normalizeParseResult(
        runtimes.wasm.parseTokensUnchecked(source, wasmLexed.tokens),
      ),
    );

    const withoutTrivia = tsLexed.tokens.filter((token: RuntimeToken) =>
      token.channel !== "trivia"
    );
    assertJsonEquals(
      normalizeParseResult(runtimes.ts.parseTokens(source, withoutTrivia)),
      normalizeParseResult(runtimes.wasm.parseTokens(source, withoutTrivia)),
    );

    const omittedMain = withoutTrivia.slice(1);
    assertJsonEquals(
      normalizeParseResult(runtimes.ts.parseTokens(source, omittedMain)),
      normalizeParseResult(runtimes.wasm.parseTokens(source, omittedMain)),
    );
  } finally {
    await runtimes.cleanup();
  }
});

Deno.test("TypeScript and Wasm runtimes match declared conflict branches", async () => {
  const metadata = parseMetadata(JSON.stringify({
    version: 1,
    parser: {
      conflicts: [
        ["tuple", "atom"],
        ["group", "atom"],
      ],
    },
  }));
  const runtimes = await buildParityRuntimes(conflictGrammar, { metadata });
  try {
    for (const source of ["(a)", "(a, b)", "((a))", "(mut a, b)", "(a, )"]) {
      assertRuntimeParity(runtimes, source);
    }
  } finally {
    await runtimes.cleanup();
  }
});

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
  assertEquals(result.diagnostics.length, 0);
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

function assertRuntimeParity(runtimes: ParityRuntimes, source: string): void {
  assertJsonEquals(
    normalizeLexResult(runtimes.ts.lex(source)),
    normalizeLexResult(runtimes.wasm.lex(source)),
  );
  assertJsonEquals(
    normalizeParseResult(runtimes.ts.parse(source)),
    normalizeParseResult(runtimes.wasm.parse(source)),
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

function assertJsonEquals(actual: unknown, expected: unknown): void {
  assertEquals(JSON.stringify(actual), JSON.stringify(expected));
}

interface ParityRuntimes {
  ts: RuntimeModule;
  wasm: RuntimeModule;
  cleanup: () => Promise<void>;
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
    options?: { preserveTrivia?: boolean },
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
