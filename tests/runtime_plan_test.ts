import { analyzeGrammar } from "../src/compiler/analyze.ts";
import {
  hashRuntimeImplementationManifest,
  hashRuntimeImplementationSource,
  RUNTIME_IMPLEMENTATION_METADATA,
} from "../src/targets/runtime/implementation.ts";
import { planRuntimeParserTarget } from "../src/targets/runtime/plan.ts";
import {
  assert,
  assertEquals,
  assertIncludes,
  assertNotIncludes,
  parseGrammar,
} from "./helpers.ts";

Deno.test("runtime planner exposes a versioned portable parser plan", () => {
  const grammar = parseGrammar(`
    token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
    skip WS = /[ \\t\\r\\n]+/ ;
    module = name:IDENT "." ;
  `);
  const analyzed = analyzeGrammar(grammar, { name: "portable_fixture" });
  assertEquals(analyzed.diagnostics.length, 0);

  const planned = planRuntimeParserTarget(
    analyzed,
    {},
    {},
    "warn",
    { backend: "test", codePrefix: "TEST", label: "test" },
  );
  assert("portable" in planned);

  const plan = planned.portable;
  const metadata = planned.portableMetadata;
  assertEquals(plan.format, "baba-parser-plan");
  assertEquals(plan.version, 1);
  assertEquals(plan.semantics, "baba-portable-v1");
  assertEquals(metadata.format, plan.format);
  assertEquals(metadata.version, plan.version);
  assertEquals(metadata.semantics, plan.semantics);
  assert(metadata.hash.startsWith("fnv1a64:"));
  assertEquals(metadata.hash.length, "fnv1a64:".length + 16);
  assertEquals(plan.symbols.grammarName, "portable_fixture");
  assertEquals(plan.symbols.rootRuleName, "module");
  assertEquals(plan.lexer.startState, 0);
  assertEquals(plan.lexer.specifications.length, 3);
  assert(plan.lexer.states.some((state) => state.accepts.length > 0));
  assert(plan.parser.actions.length > 0);
  assert(plan.parser.gotos.length > 0);
  assertEquals(plan.parser.productions[0].reducer.kind, "start");
  assertEquals(plan.cst.rootNodeType, "ModuleNode");
  assertEquals(plan.cst.rules[0].fields[0].name, "name");
});

Deno.test("TypeScript target emitters package shared runtime source", async () => {
  const forbiddenRuntimeMarkers = [
    "DFA_TRANSITIONS",
    "function bestCandidate",
    "function parseTokenList",
    "function reduceProduction",
    "function tokenToTerminal",
    "function validateTokenStream",
    "function acceptedParseResult",
  ];
  for await (const entry of Deno.readDir("src/targets/typescript")) {
    if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
    const source = await Deno.readTextFile(
      `src/targets/typescript/${entry.name}`,
    );
    for (const marker of forbiddenRuntimeMarkers) {
      assertNotIncludes(source, marker);
    }
  }

  const lexerRuntimeSource = await Deno.readTextFile(
    "src/targets/runtime/typescript_lexer_runtime.ts",
  );
  assertIncludes(lexerRuntimeSource, "function bestCandidate");
  assertIncludes(lexerRuntimeSource, "lexerScanAdvance");
  assertIncludes(lexerRuntimeSource, "createLexerRuntimeProgram");
  assertIncludes(lexerRuntimeSource, "emitRuntimeLanguageTypeScriptFunction");
  assertNotIncludes(lexerRuntimeSource, "const DFA_ACCEPTS");
  assertNotIncludes(lexerRuntimeSource, "function codePointLength");
  assertNotIncludes(lexerRuntimeSource, "function transition");

  const parserRuntimeSource = await Deno.readTextFile(
    "src/targets/runtime/typescript_parser_runtime.ts",
  );
  assertIncludes(parserRuntimeSource, "function parseTokenList");
  assertIncludes(parserRuntimeSource, "function reduceProduction");
  assertIncludes(
    parserRuntimeSource,
    "createParserConflictTraceRuntimeProgram",
  );
  assertIncludes(parserRuntimeSource, "createParserTraceRuntimeProgram");
  assertIncludes(parserRuntimeSource, "function replayTrace");
  assertNotIncludes(parserRuntimeSource, "interface ParseBranch");
  assertNotIncludes(parserRuntimeSource, "function findActions");
});

Deno.test("Wasm target packages shared core runtime source", async () => {
  const wasmTargetSource = await Deno.readTextFile(
    "src/targets/wasm/module_emit.ts",
  );
  assertNotIncludes(wasmTargetSource, "function lexOneFunction");
  assertNotIncludes(wasmTargetSource, "function parseTraceFunction");
  assertNotIncludes(wasmTargetSource, "function emitWasmModule");

  const wasmRuntimeSource = await Deno.readTextFile(
    "src/targets/runtime/wasm_core_runtime.ts",
  );
  assertIncludes(wasmRuntimeSource, "function lexOneFunction");
  assertIncludes(wasmRuntimeSource, "function parseTraceFunction");
  assertIncludes(wasmRuntimeSource, "RUNTIME_ACTION_KIND_MASK");
  assertIncludes(wasmRuntimeSource, "RUNTIME_ACTION_PAYLOAD_MASK");
  assertIncludes(wasmRuntimeSource, "function emitWasmModule");
});

Deno.test("runtime implementation manifest identifies source artifacts", async () => {
  assertEquals(
    RUNTIME_IMPLEMENTATION_METADATA.format,
    "baba-runtime-implementation",
  );
  assertEquals(RUNTIME_IMPLEMENTATION_METADATA.version, 1);
  assertEquals(
    RUNTIME_IMPLEMENTATION_METADATA.semantics,
    "baba-runtime-portable-v1",
  );
  assertEquals(RUNTIME_IMPLEMENTATION_METADATA.sources.length, 6);

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
