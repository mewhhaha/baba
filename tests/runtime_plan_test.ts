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
  assertIncludes(lexerRuntimeSource, "lexerSpecTokenClass");
  assertIncludes(lexerRuntimeSource, "lexerSpecPayload");
  assertIncludes(lexerRuntimeSource, "lexerSpecTerminal");
  assertIncludes(lexerRuntimeSource, "createLexerRuntimeProgram");
  assertIncludes(lexerRuntimeSource, "emitRuntimeLanguageTypeScriptFunction");
  assertNotIncludes(lexerRuntimeSource, "const DFA_ACCEPTS");
  assertNotIncludes(lexerRuntimeSource, "const SPECS");
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
  assertIncludes(parserRuntimeSource, "createParserReducerRuntimeProgram");
  assertIncludes(parserRuntimeSource, "createParserFieldRuntimeProgram");
  assertIncludes(parserRuntimeSource, "createLexerSpecRuntimeProgram");
  assertIncludes(parserRuntimeSource, "createParserRangeRuntimeProgram");
  assertIncludes(parserRuntimeSource, "parserReducerOperation");
  assertIncludes(parserRuntimeSource, "parserReducerPayloadStatus");
  assertIncludes(parserRuntimeSource, "parserReducerChildRole");
  assertIncludes(parserRuntimeSource, "parserReducerResultKind");
  assertIncludes(parserRuntimeSource, "parserReplayReductionStatus");
  assertIncludes(parserRuntimeSource, "parserReplayActionStatus");
  assertIncludes(parserRuntimeSource, "lexerSpecTerminal");
  assertIncludes(parserRuntimeSource, "lexerSpecPublicTokenStatus");
  assertIncludes(parserRuntimeSource, "lexerTokenDiagnosticStatus");
  assertIncludes(parserRuntimeSource, "parserFieldValueClass");
  assertIncludes(parserRuntimeSource, "parserFieldCaptureStatus");
  assertIncludes(parserRuntimeSource, "parserFieldFinalStatus");
  assertIncludes(parserRuntimeSource, "parserExpectedHasEof");
  assertIncludes(parserRuntimeSource, "parserMergeStart");
  assertIncludes(parserRuntimeSource, "parserMergeEnd");
  assertIncludes(parserRuntimeSource, "parserTraceStatusKind");
  assertIncludes(parserRuntimeSource, "function replayTrace");
  assertNotIncludes(parserRuntimeSource, 'expected.includes("EOF")');
  assertNotIncludes(parserRuntimeSource, "status === 1");
  assertNotIncludes(parserRuntimeSource, "status === 3");
  assertNotIncludes(parserRuntimeSource, "NAMED_TERMINALS");
  assertNotIncludes(parserRuntimeSource, "LITERAL_TERMINALS");
  assertNotIncludes(parserRuntimeSource, "MAIN_TOKEN_KINDS");
  assertNotIncludes(parserRuntimeSource, "TRIVIA_TOKEN_KINDS");
  assertNotIncludes(parserRuntimeSource, "flags & FIELD_ARRAY");
  assertNotIncludes(parserRuntimeSource, "flags & FIELD_NULLABLE");
  assertNotIncludes(parserRuntimeSource, "tokenClass === TOKEN_TRIVIA");
  assertNotIncludes(parserRuntimeSource, "tokenToTerminal(token) >= 0");
  assertNotIncludes(parserRuntimeSource, "case REDUCER_START");
  assertNotIncludes(parserRuntimeSource, "case REDUCER_OPERATION_RULE");
  assertNotIncludes(parserRuntimeSource, "case REDUCER_OPERATION_EMPTY_ARRAY");
  assertNotIncludes(parserRuntimeSource, "kind !== ACTION_REDUCE");
  assertNotIncludes(parserRuntimeSource, "rhsLength > values.length - 1");
  assertNotIncludes(
    parserRuntimeSource,
    "reducerOperation === REDUCER_OPERATION_UNKNOWN",
  );
  assertNotIncludes(
    parserRuntimeSource,
    "reducerPayloadStatus === REDUCER_PAYLOAD_RULE_MISSING",
  );
  assertNotIncludes(parserRuntimeSource, "case REDUCER_OPTIONAL_SOME");
  assertNotIncludes(
    parserRuntimeSource,
    "reducerPayload === NO_REDUCER_PAYLOAD",
  );
  assertNotIncludes(parserRuntimeSource, "toFragment(rhs[0])");
  assertNotIncludes(parserRuntimeSource, "rhs[0] as ShiftedToken");
  assertNotIncludes(parserRuntimeSource, "rhs[0] as AnyRuleNode");
  assertNotIncludes(parserRuntimeSource, "PRODUCTION_REDUCERS");
  assertNotIncludes(parserRuntimeSource, "RULE_FIELD_SCHEMA_ENTRIES");
  assertNotIncludes(parserRuntimeSource, "RULE_FIELD_SCHEMAS");
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
  assertNotIncludes(wasmRuntimeSource, "function parseTraceFunction");
  assertNotIncludes(wasmRuntimeSource, "parse_trace");
  assertIncludes(wasmRuntimeSource, "RUNTIME_ACTION_PAYLOAD_MASK");
  assertIncludes(wasmRuntimeSource, "function emitWasmModule");

  const wasmAdapterSource = await Deno.readTextFile(
    "src/targets/wasm/runtime_emit.ts",
  );
  assertIncludes(wasmAdapterSource, "parserTraceRuntimeBytes");
  assertIncludes(wasmAdapterSource, "parserTraceRuntime.parserTrace");
  assertIncludes(wasmAdapterSource, "parserTraceStatusKind");
  assertNotIncludes(wasmAdapterSource, "status !== 1 && status !== 3");
  assertNotIncludes(wasmAdapterSource, "status === 3");
  assertNotIncludes(wasmAdapterSource, "wasm.parse_trace");
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
