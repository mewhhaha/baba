import {
  applyBundle,
  assert,
  assertEquals,
  compile,
  denoCheck,
  parseMetadata,
} from "./helpers.ts";
import {
  compileParserKit,
  type KitParseResult,
  type KitRuleNode,
  type KitSyntaxElement,
  type KitToken,
  lexWithKit,
  type ParserKit,
  parseTokensUncheckedWithKit,
  parseTokensWithKit,
  parseWithKit,
  terminalMappings,
  validateParserKit,
} from "../src/kit.ts";

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

Deno.test("compileParserKit returns stable parser-kit data", () => {
  const result = compileParserKit(deterministicGrammar, { name: "tiny" });
  assertEquals(result.diagnostics.length, 0);
  assert(result.kit);

  const kit = result.kit;
  assertEquals(validateParserKit(kit).length, 0);
  const invalidKit = structuredClone(kit) as unknown as {
    lexer: { dfa: { accepts: unknown } };
  };
  invalidKit.lexer.dfa.accepts = "bad";
  assert(
    validateParserKit(invalidKit).some((issue) =>
      issue.path === "$.lexer.dfa.accepts"
    ),
  );
  const invalidDfaAcceptKit = structuredClone(kit) as unknown as ParserKit & {
    lexer: { dfa: { accepts: number[] }; specs: unknown[] };
  };
  invalidDfaAcceptKit.lexer.dfa.accepts[0] = invalidDfaAcceptKit.lexer.specs
    .length;
  assert(
    validateParserKit(invalidDfaAcceptKit).some((issue) =>
      issue.path === "$.lexer.dfa.accepts[0]"
    ),
  );
  const invalidDfaTransitionKit = structuredClone(kit) as unknown as
    & ParserKit
    & {
      lexer: {
        dfa: {
          transitions: Array<
            Array<{ start: number; end: number; target: number }>
          >;
        };
      };
    };
  invalidDfaTransitionKit.lexer.dfa.transitions[0] = [{
    start: 2,
    end: 1,
    target: invalidDfaTransitionKit.lexer.dfa.transitions.length,
  }];
  assert(
    validateParserKit(invalidDfaTransitionKit).some((issue) =>
      issue.path === "$.lexer.dfa.transitions[0][0].target"
    ),
  );
  const invalidDisplayKit = structuredClone(kit) as unknown as {
    displayNames: { terminals: unknown };
  };
  invalidDisplayKit.displayNames.terminals = [{ id: "bad", display: 1 }];
  assert(
    validateParserKit(invalidDisplayKit).some((issue) =>
      issue.path === "$.displayNames.terminals[0].id"
    ),
  );
  const invalidTokenChannelKit = structuredClone(kit) as unknown as
    & ParserKit
    & {
      tokens: {
        named: Array<{ kind: "token" | "skip"; channel: "main" | "trivia" }>;
      };
    };
  invalidTokenChannelKit.tokens.named[0].channel = "trivia";
  assert(
    validateParserKit(invalidTokenChannelKit).some((issue) =>
      issue.path === "$.tokens.named[0].channel"
    ),
  );
  const invalidSpecReferenceKit = structuredClone(kit) as unknown as
    & ParserKit
    & {
      lexer: {
        specs: Array<{ type: "named"; tokenId: number }>;
      };
    };
  invalidSpecReferenceKit.lexer.specs[0] = {
    type: "named",
    tokenId: 999_999,
  };
  assert(
    validateParserKit(invalidSpecReferenceKit).some((issue) =>
      issue.path === "$.lexer.specs[0].tokenId"
    ),
  );
  const invalidUnreachableTokenKit = structuredClone(kit) as unknown as
    & ParserKit
    & {
      tokens: {
        named: Array<{ reachable: boolean }>;
      };
    };
  invalidUnreachableTokenKit.tokens.named[0].reachable = false;
  assert(
    validateParserKit(invalidUnreachableTokenKit).some((issue) =>
      issue.path === "$.lexer.specs[0].tokenId"
    ),
  );
  const literalSpecIndex = kit.lexer.specs.findIndex((spec) =>
    spec.type === "literal"
  );
  assert(literalSpecIndex >= 0);
  const literalSpec = kit.lexer.specs[literalSpecIndex];
  assert(literalSpec.type === "literal");
  const literalIndex = kit.tokens.literals.findIndex((literal) =>
    literal.id === literalSpec.literalId
  );
  assert(literalIndex >= 0);
  const invalidUnreachableLiteralKit = structuredClone(kit) as unknown as
    & ParserKit
    & {
      tokens: {
        literals: Array<{ reachable: boolean }>;
      };
    };
  invalidUnreachableLiteralKit.tokens.literals[literalIndex].reachable = false;
  assert(
    validateParserKit(invalidUnreachableLiteralKit).some((issue) =>
      issue.path === `$.lexer.specs[${literalSpecIndex}].literalId`
    ),
  );
  const namedTerminalIndex = kit.bnf.terminals.findIndex((terminal) =>
    terminal.kind === "named"
  );
  assert(namedTerminalIndex >= 0);
  const invalidTerminalReferenceKit = structuredClone(kit) as unknown as
    & ParserKit
    & {
      bnf: {
        terminals: Array<{ kind: "named"; tokenId: number }>;
      };
    };
  invalidTerminalReferenceKit.bnf.terminals[namedTerminalIndex] = {
    ...invalidTerminalReferenceKit.bnf.terminals[namedTerminalIndex],
    kind: "named",
    tokenId: 999_999,
  };
  assert(
    validateParserKit(invalidTerminalReferenceKit).some((issue) =>
      issue.path === `$.bnf.terminals[${namedTerminalIndex}].tokenId`
    ),
  );
  const invalidProductionIdKit = structuredClone(kit) as unknown as
    & ParserKit
    & {
      bnf: {
        productions: Array<{ id: number }>;
      };
    };
  invalidProductionIdKit.bnf.productions[0].id = 999_999;
  assert(
    validateParserKit(invalidProductionIdKit).some((issue) =>
      issue.path === "$.bnf.productions[0].id"
    ),
  );
  const terminalProductionIndex = kit.bnf.productions.findIndex((production) =>
    production.rhs.some((symbol) => symbol.kind === "terminal")
  );
  assert(terminalProductionIndex >= 0);
  const invalidSymbolReferenceKit = structuredClone(kit) as unknown as
    & ParserKit
    & {
      bnf: {
        productions: Array<{
          rhs: Array<{ kind: "terminal" | "nonterminal"; id: number }>;
        }>;
      };
    };
  const terminalSymbolIndex = invalidSymbolReferenceKit.bnf.productions[
    terminalProductionIndex
  ].rhs.findIndex((symbol) => symbol.kind === "terminal");
  assert(terminalSymbolIndex >= 0);
  invalidSymbolReferenceKit.bnf.productions[terminalProductionIndex].rhs[
    terminalSymbolIndex
  ].id = 999_999;
  assert(
    validateParserKit(invalidSymbolReferenceKit).some((issue) =>
      issue.path ===
        `$.bnf.productions[${terminalProductionIndex}].rhs[${terminalSymbolIndex}].id`
    ),
  );
  const invalidActionReferenceKit = structuredClone(kit) as unknown as
    & ParserKit
    & {
      lr: {
        actions: Array<{ terminal: number }>;
      };
    };
  invalidActionReferenceKit.lr.actions[0].terminal = 999_999;
  assert(
    validateParserKit(invalidActionReferenceKit).some((issue) =>
      issue.path === "$.lr.actions[0].terminal"
    ),
  );
  const invalidDisplayReferenceKit = structuredClone(kit) as unknown as
    & ParserKit
    & {
      displayNames: {
        terminals: Array<{ id: number }>;
      };
    };
  invalidDisplayReferenceKit.displayNames.terminals[0].id = 999_999;
  assert(
    validateParserKit(invalidDisplayReferenceKit).some((issue) =>
      issue.path === "$.displayNames.terminals[0].id"
    ),
  );
  const invalidSpanKit = structuredClone(kit) as unknown as
    & ParserKit
    & {
      grammar: {
        rules: Array<{ span: { start: number; end: number } }>;
      };
    };
  invalidSpanKit.grammar.rules[0].span.start = 3;
  invalidSpanKit.grammar.rules[0].span.end = 2;
  assert(
    validateParserKit(invalidSpanKit).some((issue) =>
      issue.path === "$.grammar.rules[0].span.end"
    ),
  );
  const invalidStatsKit = structuredClone(kit) as unknown as
    & ParserKit
    & {
      lr: {
        stats: { states: number };
      };
    };
  invalidStatsKit.lr.stats.states += 1;
  assert(
    validateParserKit(invalidStatsKit).some((issue) =>
      issue.path === "$.lr.stats.states"
    ),
  );
  assertEquals(kit.schemaVersion, 1);
  assertEquals(kit.profile, "full");
  assertEquals(kit.grammar.name, "tiny");
  assertEquals(kit.grammar.rootRule, "module");
  assert(kit.lexer.dfa.transitions.length > 0);
  assert(kit.bnf.productions.length > 0);
  assert(kit.lr.actions.length > 0);
  assert(kit.lr.states.some((state) => state.items.length > 0));
  assert(kit.bnf.productions.some((production) => production.origin));
  assertEquals(kit.fields.rootNodeType, "ModuleNode");

  const mappings = terminalMappings(kit);
  assert(typeof mappings.named.IDENT === "number");
  assert(typeof mappings.literals["let"] === "number");
  assertEquals(mappings.eof, kit.bnf.eofTerminal);

  const parsed = parseWithKit(kit, "let alpha = 42; emoji 😀;");
  assert(parsed.ok);
  assertEquals(parsed.root.name, "module");
  assertEquals((parsed.root.fields.items as unknown[]).length, 2);
});

Deno.test("compileParserKit runtime profile omits debug details but still parses", () => {
  const result = compileParserKit(deterministicGrammar, {
    name: "tiny",
    kit: { profile: "runtime" },
  });
  assertEquals(result.diagnostics.length, 0);
  assert(result.kit);

  const kit = result.kit;
  assertEquals(validateParserKit(kit).length, 0);
  assertEquals(kit.profile, "runtime");
  assert(kit.lr.states.every((state) => state.items.length === 0));
  assertEquals(kit.lr.stats.coreItems, 0);
  assertEquals(kit.lr.stats.items, 0);
  assert(
    kit.bnf.productions.every((production) =>
      !("origin" in production) && !("span" in production)
    ),
  );

  const parsed = parseWithKit(kit, "let alpha = 42; emoji 😀;");
  assert(parsed.ok);
  assertEquals(parsed.root.name, "module");
  assertEquals((parsed.root.fields.items as unknown[]).length, 2);
});

Deno.test("parser-kit helpers match generated TypeScript runtime behavior", async () => {
  const { kit, ts, cleanup } = await buildKitParityRuntime(
    deterministicGrammar,
  );
  try {
    for (
      const source of [
        "let alpha = 42; if beta; emoji 😀;",
        "// leading trivia\nlet iffy = if;\nemoji 😀;",
        "let = 1;",
        "if ;",
        "emoji x;",
      ]
    ) {
      assertJsonEquals(
        normalizeLexResult(lexWithKit(kit, source)),
        normalizeLexResult(ts.lex(source)),
      );
      assertJsonEquals(
        normalizeParseResult(parseWithKit(kit, source)),
        normalizeParseResult(ts.parse(source)),
      );
    }

    const source = "// trivia\nlet value = 7;";
    assertJsonEquals(
      normalizeLexResult(lexWithKit(kit, source, { preserveTrivia: false })),
      normalizeLexResult(ts.lex(source, { preserveTrivia: false })),
    );
    assertJsonEquals(
      normalizeParseResult(
        parseWithKit(kit, source, { preserveTrivia: false }),
      ),
      normalizeParseResult(ts.parse(source, { preserveTrivia: false })),
    );

    const lexed = lexWithKit(kit, "let alpha = 42; // ok\nif beta;");
    assertJsonEquals(
      normalizeParseResult(parseTokensWithKit(kit, lexed.source, lexed.tokens)),
      normalizeParseResult(ts.parseTokens(lexed.source, lexed.tokens)),
    );
    assertJsonEquals(
      normalizeParseResult(
        parseTokensUncheckedWithKit(kit, lexed.source, lexed.tokens),
      ),
      normalizeParseResult(ts.parseTokensUnchecked(lexed.source, lexed.tokens)),
    );
  } finally {
    await cleanup();
  }
});

Deno.test("parser-kit helpers preserve declared parser conflict branches", async () => {
  const metadata = parseMetadata(JSON.stringify({
    version: 1,
    parser: {
      conflicts: [
        ["tuple", "atom"],
        ["group", "atom"],
      ],
    },
  }));
  const { kit, ts, cleanup } = await buildKitParityRuntime(conflictGrammar, {
    metadata,
  });
  try {
    const multiActionEntries = kit.lr.actions.filter((entry) =>
      entry.actions.length > 1
    );
    assert(multiActionEntries.length > 0);
    for (const source of ["(a)", "(a, b)", "((a))", "(mut a, b)", "(a, )"]) {
      assertJsonEquals(
        normalizeParseResult(parseWithKit(kit, source)),
        normalizeParseResult(ts.parse(source)),
      );
    }
  } finally {
    await cleanup();
  }
});

async function buildKitParityRuntime(
  source: string,
  options: Record<string, unknown> = {},
): Promise<KitParityRuntime> {
  const kitResult = compileParserKit(source, options);
  assertEquals(kitResult.diagnostics.length, 0);
  assert(kitResult.kit);

  const runtimeResult = compile(source, {
    ...options,
    targets: ["typescript"],
    typescript: { directory: "ts" },
  });
  assertEquals(runtimeResult.diagnostics.length, 0);
  assert(runtimeResult.bundle);
  const dir = await Deno.makeTempDir();
  await applyBundle(runtimeResult.bundle, { root: dir });
  await denoCheck(`${dir}/ts/mod.ts`);
  return {
    kit: kitResult.kit,
    ts: await import(`file://${dir}/ts/mod.ts`),
    cleanup: () => Deno.remove(dir, { recursive: true }),
  };
}

function normalizeLexResult(result: RuntimeLexResult): unknown {
  return {
    source: result.source,
    tokens: result.tokens.map(normalizeToken),
    diagnostics: result.diagnostics.map(normalizeDiagnostic),
  };
}

function normalizeParseResult(
  result: RuntimeParseResult | KitParseResult,
): unknown {
  return {
    ok: result.ok,
    root: result.root ? normalizeNode(result.root) : null,
    source: result.source,
    tokens: result.tokens.map(normalizeToken),
    diagnostics: result.diagnostics.map(normalizeDiagnostic),
  };
}

function normalizeNode(node: RuntimeRuleNode | KitRuleNode): unknown {
  return {
    type: node.type,
    name: node.name,
    span: node.span,
    children: node.children.map(normalizeElement),
    fields: normalizeFields(node.fields),
  };
}

function normalizeElement(
  element: RuntimeSyntaxElement | KitSyntaxElement,
): unknown {
  return element.type === "rule"
    ? normalizeNode(element as RuntimeRuleNode | KitRuleNode)
    : normalizeToken(element as RuntimeToken | KitToken);
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

function normalizeToken(token: RuntimeToken | KitToken): unknown {
  return {
    type: token.type,
    kind: "kind" in token ? token.kind : undefined,
    literal: "literal" in token ? token.literal : undefined,
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
    expected: diagnostic.expected,
    found: diagnostic.found,
  };
}

function assertJsonEquals(actual: unknown, expected: unknown): void {
  assertEquals(JSON.stringify(actual), JSON.stringify(expected));
}

interface KitParityRuntime {
  kit: ParserKit;
  ts: RuntimeModule;
  cleanup: () => Promise<void>;
}

interface RuntimeModule {
  lex(source: string, options?: { preserveTrivia?: boolean }): RuntimeLexResult;
  parse(
    source: string,
    options?: { preserveTrivia?: boolean },
  ): RuntimeParseResult;
  parseTokens(
    source: string,
    tokens: readonly KitToken[],
  ): RuntimeParseResult;
  parseTokensUnchecked(
    source: string,
    tokens: readonly KitToken[],
  ): RuntimeParseResult;
}

interface RuntimeLexResult {
  source: string;
  tokens: readonly KitToken[];
  diagnostics: readonly RuntimeDiagnostic[];
}

interface RuntimeParseResult {
  ok: boolean;
  root: RuntimeRuleNode | null;
  source: string;
  tokens: readonly KitToken[];
  diagnostics: readonly RuntimeDiagnostic[];
}

type RuntimeSyntaxElement = RuntimeRuleNode | KitToken;

interface RuntimeRuleNode {
  type: "rule";
  name: string;
  span: { start: number; end: number };
  children: RuntimeSyntaxElement[];
  fields: Record<string, unknown>;
}

interface RuntimeToken {
  type: string;
  kind?: string;
  literal?: string;
  text: string;
  span: { start: number; end: number };
  channel: string;
}

interface RuntimeDiagnostic {
  code: string;
  message: string;
  span: { start: number; end: number };
  expected?: readonly string[];
  found?: string;
}
