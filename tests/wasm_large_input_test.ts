import { applyBundle, assert, assertEquals, compile } from "./helpers.ts";
import type { BabaMetadata } from "../src/ast.ts";

const LARGE_ISLAND_GRAMMAR = `
  skip WS = /[ \\t\\r\\n]+/ ;
  module = chunks:chunk* ;
  chunk = values:"x"* ";" ;
`;

const LARGE_ISLAND_METADATA: BabaMetadata = {
  gpuFrontend: {
    version: 3,
    throughput: "strict",
    root: "module",
    islands: [
      { rule: "module", boundary: { kind: "root" } },
      { rule: "chunk", boundary: { kind: "terminated", terminal: ";" } },
    ],
    semantics: { rules: {} },
  },
};

interface CursorRuleLike {
  readonly type: "rule";
  readonly name: string;
  readonly childCount: number;
  child(index: number): CursorRuleLike | { readonly type: "token" } | undefined;
}

interface GeneratedParser {
  parse(
    source: string,
    options?: Record<string, unknown>,
  ):
    | { readonly ok: true; readonly cursor: CursorRuleLike }
    | { readonly ok: false; readonly cursor: null };
  validate(source: string, options?: Record<string, unknown>): {
    readonly ok: boolean;
    readonly diagnostics: readonly { readonly code: string }[];
  };
  dispose(): void;
}

interface GeneratedWasmModule {
  createParser(options: unknown): GeneratedParser;
}

Deno.test("Wasm island parser materializes one hundred thousand regions", async () => {
  const { dir, parser } = await materialize();
  try {
    const regionCount = 100_000;
    const source = "x;".repeat(regionCount);
    const parsed = parser.parse(source, {
      preserveTrivia: false,
      maxParserActions: source.length,
    });
    assert(parsed.ok);
    assertEquals(parsed.cursor.name, "module");
    assertEquals(parsed.cursor.childCount, regionCount);

    for (const index of [0, 49_999, 99_999, 7_919]) {
      const child = parsed.cursor.child(index);
      assert(child !== undefined && child.type === "rule");
      assertEquals(child.name, "chunk");
      assertEquals(child.childCount, 2);
    }
  } finally {
    parser.dispose();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm island validation enforces the transition action limit", async () => {
  const { dir, parser } = await materialize();
  try {
    assertEquals(parser.validate("x;").ok, true);
    const limited = parser.validate("x;", { maxParserActions: 1 });
    assertEquals(limited.ok, false);
    assertEquals(limited.diagnostics[0]?.code, "PARSER_TRACE_LIMIT");
  } finally {
    parser.dispose();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm island validation reports lexical and boundary failures", async () => {
  const { dir, parser } = await materialize();
  try {
    const lexical = parser.validate("#;");
    assertEquals(lexical.ok, false);
    assertEquals(lexical.diagnostics[0]?.code, "PARSE_LEXICAL_ERROR");

    const boundary = parser.validate("x");
    assertEquals(boundary.ok, false);
    assertEquals(boundary.diagnostics[0]?.code, "PARSE_UNEXPECTED_TOKEN");

    assertEquals(parser.validate("").ok, true);
  } finally {
    parser.dispose();
    await Deno.remove(dir, { recursive: true });
  }
});

async function materialize(): Promise<
  { dir: string; parser: GeneratedParser }
> {
  const result = compile(LARGE_ISLAND_GRAMMAR, {
    targets: ["wasm"],
    metadata: LARGE_ISLAND_METADATA,
  });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle, "Expected a generated Wasm bundle.");
  const dir = await Deno.makeTempDir();
  await applyBundle(result.bundle, { root: dir });
  const mod = await import(`file://${dir}/wasm/mod.ts`) as GeneratedWasmModule;
  const parser = mod.createParser({
    bytes: await Deno.readFile(`${dir}/wasm/parser.wasm`),
    plan: await Deno.readFile(`${dir}/wasm/parser.plan`),
  });
  return { dir, parser };
}
