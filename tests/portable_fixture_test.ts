import {
  applyBundle,
  assert,
  assertEquals,
  compile,
  denoCheck,
  fixtureMetadata,
  fixtureNames,
  fixtureSamples,
  parseMetadata,
} from "./helpers.ts";

const REQUIRED_FIXTURES = [
  "expressions",
  "declarations",
  "json-like",
  "markup-like",
  "overlapping-tokens",
  "contextual-lexing",
  "nullable-rules",
  "empty-productions",
  "ambiguous-types",
  "conflict-resolution",
  "unicode",
  "comments-and-trivia",
  "large-generated",
  "invalid-regex",
  "resource-limits",
] as const;

Deno.test("portable fixture corpus covers every required category", async () => {
  const actual = await fixtureNames();
  for (const fixture of REQUIRED_FIXTURES) {
    assert(
      actual.includes(fixture),
      `Missing required portable fixture category: ${fixture}`,
    );
    const grammar = await Deno.readTextFile(`fixtures/${fixture}/grammar.ebnf`);
    assert(grammar.trim().length > 0, `${fixture} grammar must not be empty`);

    const validSamples = await fixtureSamples(fixture, "valid");
    const invalidSamples = await fixtureSamples(fixture, "invalid");
    if (fixture !== "invalid-regex") {
      assert(validSamples.length > 0, `${fixture} must have valid samples`);
    }
    assert(invalidSamples.length > 0, `${fixture} must have invalid samples`);
  }
});

Deno.test("portable fixture parsers satisfy CST and token-stream properties", async () => {
  for (const fixture of await fixtureNames()) {
    if (fixture === "invalid-regex") continue;
    const grammar = await Deno.readTextFile(`fixtures/${fixture}/grammar.ebnf`);
    const metadataJson = await fixtureMetadata(fixture);
    const options = metadataJson === undefined
      ? {}
      : { metadata: parseMetadata(JSON.stringify(metadataJson)) };
    const result = compile(grammar, {
      ...options,
      targets: ["typescript"],
    });
    assert(
      result.diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
      `${fixture} should compile without errors: ${
        result.diagnostics.map((diagnostic) => diagnostic.message).join("\n")
      }`,
    );
    assert(result.bundle);

    const dir = await Deno.makeTempDir();
    try {
      await applyBundle(result.bundle, { root: dir });
      await denoCheck(`${dir}/typescript/mod.ts`);
      const mod = await import(`file://${dir}/typescript/mod.ts`);

      for (const sample of await fixtureSamples(fixture, "valid")) {
        const first = mod.parse(sample);
        const second = mod.parse(sample);
        assertEquals(first.ok, true, `${fixture} valid sample should parse`);
        assertEquals(
          JSON.stringify(first),
          JSON.stringify(second),
          `${fixture} parse should be deterministic`,
        );
        assert(first.root, `${fixture} parse should expose a root node`);
        assertNodeInvariants(first.root, sample.length, fixture);

        const lexed = mod.lex(sample);
        assertLexerInvariants(lexed, sample.length, fixture);
        const parsedTokens = mod.parseTokens(lexed.source, lexed.tokens);
        if (fixture === "contextual-lexing") {
          assert(
            typeof parsedTokens.ok === "boolean",
            `${fixture} parseTokens should return a checked parse result`,
          );
        } else {
          assertEquals(
            JSON.stringify(normalizeParseContract(first)),
            JSON.stringify(normalizeParseContract(parsedTokens)),
            `${fixture} parseTokens should agree with canonical parse`,
          );
        }
      }
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  }
});

function assertLexerInvariants(
  lexed: RuntimeLexResult,
  sourceLength: number,
  fixture: string,
): void {
  assertEquals(
    lexed.diagnostics.length,
    0,
    `${fixture} valid sample should lex without diagnostics`,
  );
  let previousEnd = 0;
  for (const token of lexed.tokens) {
    assert(
      token.span.start >= previousEnd,
      `${fixture} token spans must be monotonic`,
    );
    assert(
      token.type === "eof" || token.span.end > token.span.start,
      `${fixture} non-EOF tokens must have positive width`,
    );
    previousEnd = token.span.end;
  }
  assertEquals(
    previousEnd,
    sourceLength,
    `${fixture} lexing should cover the full source through EOF`,
  );
}

function assertNodeInvariants(
  node: RuntimeRuleNode,
  sourceLength: number,
  fixture: string,
): void {
  assert(node.span.start >= 0, `${fixture} node starts before source`);
  assert(
    node.span.end <= sourceLength,
    `${fixture} node ends after source length`,
  );
  assert(
    node.span.start <= node.span.end,
    `${fixture} node span must be ordered`,
  );
  let previousChildStart = node.span.start;
  for (const child of node.children) {
    const span = child.span;
    assert(
      span.start >= node.span.start && span.end <= node.span.end,
      `${fixture} child span must be contained by parent`,
    );
    assert(
      span.start >= previousChildStart,
      `${fixture} children should preserve source order`,
    );
    previousChildStart = span.start;
    if (child.type === "rule") {
      assertNodeInvariants(child, sourceLength, fixture);
    }
  }
  for (const value of Object.values(node.fields)) {
    assertFieldValueInvariants(value, node, fixture);
  }
}

function assertFieldValueInvariants(
  value: unknown,
  owner: RuntimeRuleNode,
  fixture: string,
): void {
  if (Array.isArray(value)) {
    let previousStart = owner.span.start;
    for (const item of value) {
      if (isSyntaxElement(item)) {
        assert(
          item.span.start >= previousStart,
          `${fixture} array fields should preserve source order`,
        );
        previousStart = item.span.start;
      }
      assertFieldValueInvariants(item, owner, fixture);
    }
    return;
  }
  if (!isSyntaxElement(value)) return;
  const element = value;
  assert(
    element.span.start >= owner.span.start &&
      element.span.end <= owner.span.end,
    `${fixture} field value must be contained by its owning rule`,
  );
}

function isSyntaxElement(value: unknown): value is RuntimeSyntaxElement {
  if (!value || typeof value !== "object") return false;
  const typed = value as { type?: unknown; span?: unknown };
  return (
    typed.type === "rule" ||
    typed.type === "literal" ||
    typed.type === "named" ||
    typed.type === "eof" ||
    typed.type === "error"
  ) && !!typed.span && typeof typed.span === "object";
}

function normalizeParseContract(result: RuntimeParseResult): unknown {
  return {
    ok: result.ok,
    source: result.source,
    root: result.root,
    diagnostics: result.diagnostics,
  };
}

interface RuntimeLexResult {
  source: string;
  tokens: RuntimeToken[];
  diagnostics: unknown[];
}

interface RuntimeParseResult {
  ok: boolean;
  source: string;
  root: RuntimeRuleNode | null;
  diagnostics: unknown[];
}

type RuntimeSyntaxElement = RuntimeRuleNode | RuntimeToken;

interface RuntimeRuleNode {
  type: "rule";
  name: string;
  span: RuntimeSpan;
  children: RuntimeSyntaxElement[];
  fields: Record<string, unknown>;
}

interface RuntimeToken {
  type: "literal" | "named" | "eof" | "error";
  span: RuntimeSpan;
}

interface RuntimeSpan {
  start: number;
  end: number;
}
