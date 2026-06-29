import { compile, formatDiagnostic, parseMetadata } from "../../src/mod.ts";
import { applyBundle } from "../../src/output.ts";
import * as wasm from "./generated/wasm/mod.ts";

const here = new URL(".", import.meta.url);
const sourcePath = Deno.args.find((arg) => !arg.startsWith("--")) ??
  "programs/tour.ft";
const source = await Deno.readTextFile(new URL(sourcePath, here));
const grammar = await Deno.readTextFile(new URL("grammar.ebnf", here));
const metadataSource = await Deno.readTextFile(new URL("baba.json", here));
const metadata = parseMetadata(metadataSource);
const wasmBytes = await Deno.readFile(
  new URL("generated/wasm/parser.wasm", here),
);
const wasmPlan = await Deno.readFile(
  new URL("generated/wasm/parser.plan", here),
);

const wasmParser = wasm.createParser({ bytes: wasmBytes, plan: wasmPlan });
const parsedSource = wasmParser.parse(source);
try {
  assertSameParse("Wasm instance", parsedSource);
  wasmParser.reset();
  assertEquals(wasmParser.lex("< x;").diagnostics.length, 0);

  const wasmParserAsync = await wasm.createParserAsync({
    bytes: wasmBytes,
    plan: wasmPlan,
  });
  try {
    assertSameParse("async Wasm instance", wasmParserAsync.parse(source));
  } finally {
    wasmParserAsync.dispose();
  }

  assertEquals(wasm.parserPlanFormat, "baba-parser-plan");
  assertEquals(wasm.parserPlanVersion, 1);
  assertEquals(wasm.parserPlanSemantics, "baba-portable-v1");
  assertEquals(wasm.wasmAbiVersion, 1);

  const abi = JSON.parse(
    await Deno.readTextFile(new URL("generated/wasm/abi.json", here)),
  );
  assertEquals(abi.runtimeImplementation.hash, wasm.runtimeImplementationHash);

  const lexed = wasmParser.lex(source, { preserveTrivia: true });
  assertEquals(lexed.diagnostics.length, 0);
  assert(
    lexed.tokens.some((token) => token.type === "named" && token.kind === "A"),
    "standalone lex should choose the higher-priority A token for x",
  );

  const leftTokens = wasmParser.lex("< x;").tokens;
  const checkedTokens = wasmParser.parseTokens("< x;", leftTokens);
  assertSameParse("checked token stream", checkedTokens);
  assertSameParse(
    "unchecked token stream",
    wasmParser.parseTokensUnchecked("< x;", leftTokens),
  );

  const globallyLexedRight = wasmParser.lex("> x;");
  assert(
    globallyLexedRight.tokens.some((token) =>
      token.type === "named" && token.kind === "A"
    ),
    "standalone lex should choose the higher-priority A token for x",
  );
  const contextualRight = wasmParser.parse("> x;");
  assertSameParse("contextual right branch", contextualRight);
  const checkedRight = wasmParser.parseTokens(
    "> x;",
    globallyLexedRight.tokens,
  );
  assertEquals(checkedRight.ok, false);
  assert(
    checkedRight.diagnostics.some((diagnostic) =>
      diagnostic.code === "PARSE_UNEXPECTED_TOKEN" ||
      diagnostic.code === "PARSE_INVALID_TOKEN_STREAM"
    ),
    "checked token streams should report the globally lexed A token as invalid where B is required",
  );
} finally {
  wasmParser.dispose();
}

assertStableConflictIdExample();

if (Deno.args.includes("--external-wasm")) {
  await assertExternalWasmPackaging();
}

console.log(
  [
    `parsed ${parsedSource.root?.fields.items.length ?? 0} feature-tour items`,
    `plan ${wasm.parserPlanVersion}`,
    `runtime ${wasm.runtimeImplementationVersion} ${wasm.runtimeImplementationHash}`,
    `wasm ABI ${wasm.wasmAbiVersion}`,
  ].join("\n"),
);

function assertStableConflictIdExample(): void {
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
  const unresolved = compile(conflictGrammar, { targets: ["wasm"] });
  const conflict = conflictIdFromDiagnostics(unresolved.diagnostics);
  assert(conflict !== undefined, "unresolved conflict should report stable ID");

  const resolved = compile(conflictGrammar, {
    targets: ["wasm"],
    metadata: parseMetadata(JSON.stringify({
      version: 2,
      parser: { conflicts: [{ conflict }] },
    })),
  });
  assertNoErrors(resolved.diagnostics);
  assert(resolved.bundle !== undefined, "stable conflict ID should compile");
}

async function assertExternalWasmPackaging(): Promise<void> {
  const result = compile(grammar, {
    name: "feature_tour",
    rootRule: "module",
    metadata,
    targets: ["wasm"],
  });
  assertNoErrors(result.diagnostics);
  assert(result.bundle !== undefined, "external Wasm bundle should be emitted");

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    const bytes = await Deno.readFile(`${dir}/wasm/parser.wasm`);
    const plan = await Deno.readFile(`${dir}/wasm/parser.plan`);
    assert(WebAssembly.validate(bytes), "external parser.wasm should validate");
    const external = await import(`file://${dir}/wasm/mod.ts`);
    const parser = external.createParser({ bytes, plan });
    try {
      assertSameParse("external Wasm binary", parser.parse(source));
    } finally {
      parser.dispose();
    }
    const manifest = JSON.parse(
      await Deno.readTextFile(`${dir}/wasm/manifest.json`),
    );
    assertEquals(manifest.module, "parser.wasm");
    assertEquals(manifest.plan, "parser.plan");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

interface RuntimeDiagnosticLike {
  readonly code: string;
  readonly message: string;
}

function assertSameParse(
  label: string,
  result: { ok: boolean; diagnostics: readonly RuntimeDiagnosticLike[] },
): void {
  assert(
    result.ok,
    `${label} parse failed:\n${
      result.diagnostics.map((diagnostic) =>
        formatRuntimeDiagnostic(diagnostic)
      ).join(
        "\n",
      )
    }`,
  );
}

function assertNoErrors(
  diagnostics: readonly ReturnType<typeof compile>["diagnostics"][number][],
): void {
  const errors = diagnostics.filter((diagnostic) =>
    (diagnostic.severity ?? "error") === "error"
  );
  assert(
    errors.length === 0,
    errors.map((diagnostic) => formatDiagnostic(diagnostic)).join("\n"),
  );
}

function formatRuntimeDiagnostic(diagnostic: RuntimeDiagnosticLike): string {
  return `${diagnostic.code}: ${diagnostic.message}`;
}

function conflictIdFromDiagnostics(
  diagnostics: readonly ReturnType<typeof compile>["diagnostics"][number][],
): string | undefined {
  for (const diagnostic of diagnostics) {
    const match = diagnostic.message.match(/Conflict ID: (c_[a-f0-9]+)/);
    if (match) return match[1];
  }
  return undefined;
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(
      `Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`,
    );
  }
}
