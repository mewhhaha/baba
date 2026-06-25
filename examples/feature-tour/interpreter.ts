import { compile, formatDiagnostic, parseMetadata } from "../../src/mod.ts";
import { applyBundle } from "../../src/output.ts";
import {
  compileParserKit,
  parseWithKit,
  validateParserKit,
} from "../../src/kit.ts";
import * as ts from "./generated/ts/mod.ts";
import * as wasm from "./generated/wasm/mod.ts";

const here = new URL(".", import.meta.url);
const sourcePath = Deno.args.find((arg) => !arg.startsWith("--")) ??
  "programs/tour.ft";
const source = await Deno.readTextFile(new URL(sourcePath, here));
const grammar = await Deno.readTextFile(new URL("grammar.ebnf", here));
const metadataSource = await Deno.readTextFile(new URL("baba.json", here));
const metadata = parseMetadata(metadataSource);

assertSameParse("TypeScript", ts.parse(source));

const wasmParser = wasm.createParser();
try {
  assertSameParse("Wasm instance", wasmParser.parse(source));
  wasmParser.reset();
  assertEquals(wasmParser.lex("< x;").diagnostics.length, 0);
} finally {
  wasmParser.dispose();
}

const wasmParserAsync = await wasm.createParserAsync();
try {
  assertSameParse("async Wasm instance", wasmParserAsync.parse(source));
} finally {
  wasmParserAsync.dispose();
}

assertEquals(ts.parserPlanFormat, "baba-parser-plan");
assertEquals(ts.parserPlanVersion, 1);
assertEquals(ts.parserPlanSemantics, "baba-portable-v1");
assertEquals(ts.parserPlanHash, wasm.parserPlanHash);
assertEquals(wasm.wasmAbiVersion, 1);
assertEquals(wasm.runtimeImplementationHash, ts.runtimeImplementationHash);

const abi = JSON.parse(
  await Deno.readTextFile(new URL("generated/wasm/abi.json", here)),
);
assertEquals(abi.parserPlan.hash, ts.parserPlanHash);
assertEquals(abi.runtimeImplementation.hash, ts.runtimeImplementationHash);

const lexed = ts.lex(source, { preserveTrivia: true });
assertEquals(lexed.diagnostics.length, 0);
assert(
  lexed.tokens.some((token) => token.type === "named" && token.kind === "A"),
  "standalone lex should choose the higher-priority A token for x",
);

const checkedTokens = ts.parseTokens("< x;", ts.lex("< x;").tokens);
assertSameParse("checked token stream", checkedTokens);
assertSameParse(
  "unchecked token stream",
  ts.parseTokensUnchecked("< x;", ts.lex("< x;").tokens),
);

const globallyLexedRight = ts.lex("> x;");
assert(
  globallyLexedRight.tokens.some((token) =>
    token.type === "named" && token.kind === "A"
  ),
  "standalone lex should choose the higher-priority A token for x",
);
const contextualRight = ts.parse("> x;");
assertSameParse("contextual right branch", contextualRight);
const checkedRight = ts.parseTokens("> x;", globallyLexedRight.tokens);
assertEquals(checkedRight.ok, false);
assert(
  checkedRight.diagnostics.some((diagnostic) =>
    diagnostic.code === "PARSE_UNEXPECTED_TOKEN" ||
    diagnostic.code === "PARSE_INVALID_TOKEN_STREAM"
  ),
  "checked token streams should report the globally lexed A token as invalid where B is required",
);

const tooSmall = wasm.createParser({ limits: { maxInputUnits: 4 } });
try {
  let sawLimit = false;
  try {
    tooSmall.parse(source);
  } catch (error) {
    sawLimit = error instanceof wasm.WasmResourceLimitError &&
      error.code === "INPUT_LIMIT_EXCEEDED";
  }
  assert(sawLimit, "small Wasm parser limits should throw a stable limit code");
} finally {
  tooSmall.dispose();
}

const kitResult = compileParserKit(grammar, {
  name: "feature_tour",
  rootRule: "module",
  metadata,
});
assertNoErrors(kitResult.diagnostics);
assert(kitResult.kit !== undefined, "parser-kit should be emitted");
const kitIssues = validateParserKit(kitResult.kit);
assertEquals(kitIssues.length, 0);
const kitParsed = parseWithKit(kitResult.kit, "< x;");
assertSameParse("parser-kit", kitParsed);

await assertGeneratedQueries();
assertStableConflictIdExample();

if (Deno.args.includes("--external-wasm")) {
  await assertExternalWasmPackaging();
}

console.log(
  [
    `parsed ${
      ts.parse(source).root?.fields.items.length ?? 0
    } feature-tour items`,
    `plan ${ts.parserPlanVersion} ${ts.parserPlanHash}`,
    `runtime ${ts.runtimeImplementationVersion} ${ts.runtimeImplementationHash}`,
    `wasm ABI ${wasm.wasmAbiVersion}`,
  ].join("\n"),
);

async function assertGeneratedQueries(): Promise<void> {
  const highlights = await Deno.readTextFile(
    new URL("generated/queries/generated-highlights.scm", here),
  );
  assert(highlights.includes("@number"), "highlight query should tag numbers");
  assert(highlights.includes("@type"), "highlight query should tag types");

  const folds = await Deno.readTextFile(
    new URL("generated/queries/generated-folds.scm", here),
  );
  assert(folds.includes("@fold"), "fold query should be generated");
}

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
  const unresolved = compile(conflictGrammar, { targets: ["typescript"] });
  const conflict = conflictIdFromDiagnostics(unresolved.diagnostics);
  assert(conflict !== undefined, "unresolved conflict should report stable ID");

  const resolved = compile(conflictGrammar, {
    targets: ["typescript", "wasm", "kit"],
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
    wasm: { packaging: "external-binary" },
  });
  assertNoErrors(result.diagnostics);
  assert(result.bundle !== undefined, "external Wasm bundle should be emitted");

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    const bytes = await Deno.readFile(`${dir}/wasm/parser.wasm`);
    assert(WebAssembly.validate(bytes), "external parser.wasm should validate");
    const external = await import(`file://${dir}/wasm/mod.ts`);
    const parser = external.createParser({ bytes });
    try {
      assertSameParse("external Wasm binary", parser.parse(source));
    } finally {
      parser.dispose();
    }
    const manifest = JSON.parse(
      await Deno.readTextFile(`${dir}/wasm/manifest.json`),
    );
    assertEquals(manifest.module, "parser.wasm");
    assertEquals(manifest.parserPlanVersion, 1);
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
