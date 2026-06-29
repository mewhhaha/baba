import { analyzeGrammar } from "../src/compiler/analyze.ts";
import { compileParserKit } from "../src/mod.ts";
import {
  createAutoParser,
  createWasmParser,
  getSharedWasmRuntimeStats,
  prepareSharedWasmRuntime,
} from "../src/runtime/wasm.ts";
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

Deno.test("runtime/wasm facade prepares once and supports auto policy", async () => {
  const first = compileParserKit(`
    token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
    token HASH = /#[A-Za-z_][A-Za-z0-9_]*/ ;
    skip WS = /[ \\t\\r\\n]+/ ;
    module = tag:HASH name:IDENT ;
  `);
  const second = compileParserKit(`
    token INT = /[0-9]+/ ;
    skip WS = /[ \\t\\r\\n]+/ ;
    module = value:INT ;
  `);
  assertEquals(first.diagnostics.length, 0);
  assertEquals(second.diagnostics.length, 0);
  assert(first.kit);
  assert(second.kit);

  const before = getSharedWasmRuntimeStats();
  const timing: string[] = [];
  const parser = await createWasmParser(first.kit, {
    timing(event) {
      timing.push(`${event.phase}:${event.engine}:${event.backend}`);
    },
  });
  const sibling = await createWasmParser(second.kit, {
    timing(event) {
      timing.push(`${event.phase}:${event.engine}:${event.backend}`);
    },
  });
  const after = getSharedWasmRuntimeStats();
  assertEquals(after.prepared, true);
  assert(after.wasmBytes > 0);
  assertEquals(
    after.prepareCount,
    before.prepared ? before.prepareCount : before.prepareCount + 1,
  );
  assertEquals(parser.parse("#let alpha").ok, true);
  const validated = parser.parse("#let alpha", { mode: "validate" });
  assertEquals(validated.ok, true);
  assertEquals("root" in validated, false);
  const invalid = parser.parse("#let", { mode: "validate" });
  assertEquals(invalid.ok, false);
  assertEquals(
    (invalid.diagnostics[0] as { code?: unknown }).code,
    "PARSE_UNEXPECTED_TOKEN",
  );
  assertEquals(sibling.parse("42").ok, true);
  assert(timing.includes("create instance:wasm:wasm+typescript"));
  assert(timing.includes("lex:wasm:wasm+typescript"));
  assert(timing.includes("parse trace:wasm:wasm+typescript"));
  assert(timing.includes("build result:wasm:wasm+typescript"));

  const executor = await prepareSharedWasmRuntime();
  const instance = executor.createInstance();
  assertEquals(instance.exports.baba_generic_runtime_version(), 1);
  const actionRows = instance.writeI32Table([0, 2, 2]);
  const actionPairs = instance.writeI32Table([1, 10, 3, 30]);
  assertEquals(
    instance.exports.find_pair(actionRows, 2, actionPairs, 0, 3),
    30,
  );
  assertEquals(
    instance.exports.find_pair(actionRows, 2, actionPairs, 1, 3),
    -1,
  );
  const dfaRows = instance.writeI32Table([0, 2]);
  const dfaRanges = instance.writeI32Table([65, 90, 1, 97, 122, 2]);
  assertEquals(instance.exports.find_range(dfaRows, 1, dfaRanges, 0, 66), 1);
  assertEquals(instance.exports.find_range(dfaRows, 1, dfaRanges, 0, 122), 2);
  assertEquals(instance.exports.find_range(dfaRows, 1, dfaRanges, 0, 48), -1);

  const autoEvents: string[] = [];
  const auto = await createAutoParser(first.kit, {
    smallInputThreshold: 5,
    timing(event) {
      autoEvents.push(`${event.phase}:${event.engine}`);
    },
  });
  assertEquals(auto.parse("#let alpha").ok, true);
  assert(autoEvents.includes("select engine:wasm"));
  assertEquals(auto.parse("#let").ok, false);
  assert(autoEvents.includes("select engine:typescript"));
});

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

Deno.test("runtime source-of-truth cutline tracks final gate", async () => {
  const docs = await Deno.readTextFile("docs/runtime-language.md");
  const adr = await Deno.readTextFile("docs/adr/0003-runtime-language.md");

  assertIncludes(docs, "## Runtime Source-Of-Truth Cutline");
  assertIncludes(docs, "Runtime-owned semantics:");
  assertIncludes(docs, "Host-owned boundaries:");
  assertIncludes(
    docs,
    "Forbidden source-of-truth duplication:",
  );
  assertIncludes(
    docs,
    "The generated TypeScript and JavaScript-hosted Wasm parser runtimes now satisfy",
  );
  assertIncludes(
    docs,
    "remaining JavaScript code in those targets is the documented",
  );
  assertIncludes(docs, "Parser-kit");
  assertIncludes(docs, "tooling/convenience");
  assertIncludes(
    adr,
    "now satisfy the source-of-truth cutline",
  );
  assertNotIncludes(adr, "has not yet completed the T04/T05 migration");
  assertNotIncludes(
    adr,
    "not a claim that every TypeScript and Wasm parser algorithm",
  );
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
  const lexerEmitSource = await Deno.readTextFile(
    "src/targets/typescript/lexer_emit.ts",
  );
  assertNotIncludes(lexerEmitSource, "buildLexerDfa");
  assertNotIncludes(lexerEmitSource, "AnalyzedGrammar");
  assertNotIncludes(lexerEmitSource, "export function emitLexer(");

  const lexerRuntimeSource = await Deno.readTextFile(
    "src/targets/runtime/typescript_lexer_runtime.ts",
  );
  const runtimeLanguageSourcesSource = await Deno.readTextFile(
    "src/targets/runtime/language_sources.ts",
  );
  const syntaxRuntimeSource = await Deno.readTextFile(
    "src/targets/typescript/syntax_emit.ts",
  );
  const publicLexDiagnosticMaterializerSource = await Deno.readTextFile(
    "src/targets/runtime/public_lex_diagnostic_materializer.ts",
  );
  const publicLexResultMaterializerSource = await Deno.readTextFile(
    "src/targets/runtime/public_lex_result_materializer.ts",
  );
  const publicSourceTextBoundarySource = await Deno.readTextFile(
    "src/targets/runtime/public_source_text.ts",
  );
  const publicTokenMaterializerSource = await Deno.readTextFile(
    "src/targets/runtime/public_token_materializer.ts",
  );
  assertIncludes(lexerRuntimeSource, "lexerDriverStart");
  assertIncludes(lexerRuntimeSource, "lexerDriverReadOffset");
  assertIncludes(lexerRuntimeSource, "lexerDriverAdvance");
  assertIncludes(lexerRuntimeSource, "lexerDriverTokenClass");
  assertIncludes(lexerRuntimeSource, "lexerDriverTokenPayload");
  assertIncludes(lexerRuntimeSource, "lexerDriverTokenTerminal");
  assertIncludes(lexerRuntimeSource, "lexerDriverConsume");
  assertIncludes(runtimeLanguageSourcesSource, "lexerScanAdvance");
  assertIncludes(runtimeLanguageSourcesSource, "lexerScanNextOffset");
  assertIncludes(runtimeLanguageSourcesSource, "lexerScanCandidateEnd");
  assertIncludes(runtimeLanguageSourcesSource, "lexerSpecTokenClass");
  assertIncludes(runtimeLanguageSourcesSource, "lexerSpecPayload");
  assertIncludes(runtimeLanguageSourcesSource, "lexerSpecTerminal");
  assertIncludes(runtimeLanguageSourcesSource, "lexerPublicTokenClass");
  assertIncludes(runtimeLanguageSourcesSource, "lexerTokenEmitStatus");
  assertIncludes(runtimeLanguageSourcesSource, "lexerDriverBeginEvent");
  assertIncludes(runtimeLanguageSourcesSource, "lexerDriverFinalizeEvent");
  assertIncludes(runtimeLanguageSourcesSource, "lexerDriverConsumeEvent");
  assertIncludes(runtimeLanguageSourcesSource, "lexerDriverFinalize");
  assertIncludes(lexerRuntimeSource, "createLexerRuntimeProgram");
  assertIncludes(lexerRuntimeSource, "emitRuntimeLanguageTypeScriptFunction");
  assertIncludes(lexerRuntimeSource, "parserTokenNew");
  assertIncludes(lexerRuntimeSource, "emitPublicTokenMaterializer");
  assertIncludes(lexerRuntimeSource, "emitPublicLexDiagnosticMaterializer");
  assertIncludes(lexerRuntimeSource, "emitPublicLexResultMaterializer");
  assertIncludes(lexerRuntimeSource, "emitPublicSourceTextBoundary");
  assertIncludes(
    lexerRuntimeSource,
    "const sourceText = createSourceTextBoundary(source)",
  );
  assertIncludes(lexerRuntimeSource, "sourceTextCodePointAt(");
  assertIncludes(lexerRuntimeSource, "materializeToken(sourceText, handle)");
  assertIncludes(
    publicSourceTextBoundarySource,
    "interface SourceTextBoundary",
  );
  assertIncludes(
    publicSourceTextBoundarySource,
    "function createSourceTextBoundary",
  );
  assertIncludes(
    publicSourceTextBoundarySource,
    "function sourceTextSlice",
  );
  assertIncludes(
    publicSourceTextBoundarySource,
    "function sourceTextMatches",
  );
  assertIncludes(
    publicSourceTextBoundarySource,
    "function sourceTextCodePointAt",
  );
  assertIncludes(
    publicSourceTextBoundarySource,
    "sourceTextOffsetStatus",
  );
  assertIncludes(publicSourceTextBoundarySource, "sourceTextSpanStatus");
  assertIncludes(publicSourceTextBoundarySource, "sourceTextTrailOffset");
  assertIncludes(publicSourceTextBoundarySource, "sourceTextHasTrailUnit");
  assertIncludes(
    publicSourceTextBoundarySource,
    "sourceTextCodePointFromUnits",
  );
  assertNotIncludes(
    publicSourceTextBoundarySource,
    "trailOffset < sourceText.length",
  );
  assertNotIncludes(publicSourceTextBoundarySource, "offset + 1");
  assertNotIncludes(
    publicSourceTextBoundarySource,
    "normalized >= sourceText.length",
  );
  assertNotIncludes(publicSourceTextBoundarySource, "utf16HasCodeUnit");
  assertIncludes(
    publicSourceTextBoundarySource,
    "function sourceTextCodeUnitAt",
  );
  assertIncludes(publicSourceTextBoundarySource, "source.slice");
  assertIncludes(publicSourceTextBoundarySource, "source.charCodeAt");
  assertIncludes(publicTokenMaterializerSource, "function materializeToken");
  assertIncludes(publicTokenMaterializerSource, "function materializeEofToken");
  assertIncludes(
    publicTokenMaterializerSource,
    "function materializeSourceEofToken",
  );
  assertIncludes(
    publicTokenMaterializerSource,
    "sourceText: SourceTextBoundary",
  );
  assertIncludes(publicTokenMaterializerSource, "parserTokenSpanStart");
  assertIncludes(publicTokenMaterializerSource, "PUBLIC_TOKEN_EOF");
  assertIncludes(publicTokenMaterializerSource, "sourceTextSlice(sourceText");
  assertNotIncludes(publicTokenMaterializerSource, "source.slice");
  assertIncludes(publicTokenMaterializerSource, "Object.defineProperty");
  assertIncludes(
    publicLexDiagnosticMaterializerSource,
    "function lexUnexpectedCharacterDiagnostic",
  );
  assertIncludes(
    publicLexDiagnosticMaterializerSource,
    '"LEX_UNEXPECTED_CHARACTER"',
  );
  assertIncludes(publicLexResultMaterializerSource, "function lexResult");
  assertIncludes(
    publicLexResultMaterializerSource,
    "return { source, tokens, diagnostics }",
  );
  assertNotIncludes(lexerRuntimeSource, "const DFA_ACCEPTS");
  assertNotIncludes(lexerRuntimeSource, "const SPECS");
  assertNotIncludes(lexerRuntimeSource, "function codePointLength");
  assertNotIncludes(lexerRuntimeSource, "function transition");
  assertNotIncludes(lexerRuntimeSource, "function publicTokenClass");
  assertNotIncludes(lexerRuntimeSource, "interface Candidate");
  assertNotIncludes(lexerRuntimeSource, "function bestCandidate");
  assertNotIncludes(lexerRuntimeSource, "const candidate =");
  assertIncludes(lexerRuntimeSource, "lexerScanAdvance(codePoint)");
  assertIncludes(lexerRuntimeSource, "lexerScanBestState()");
  assertIncludes(lexerRuntimeSource, "lexerAcceptCandidateCount(state)");
  assertIncludes(lexerRuntimeSource, "lexerAcceptCandidateSpec(state, index)");
  assertNotIncludes(
    lexerRuntimeSource,
    "lexerTokenEmitStatus(tokenClass, preserveTrivia",
  );
  assertNotIncludes(lexerRuntimeSource, "index += utf16CodePointWidth");
  assertNotIncludes(lexerRuntimeSource, "offset + lexerScanBestEnd()");
  assertNotIncludes(
    lexerRuntimeSource,
    "tokenClass !== TOKEN_TRIVIA || preserveTrivia",
  );
  assertNotIncludes(lexerRuntimeSource, '"LEX_UNEXPECTED_CHARACTER"');
  assertNotIncludes(
    lexerRuntimeSource,
    "return { source, tokens, diagnostics }",
  );

  const parserRuntimeSource = await Deno.readTextFile(
    "src/targets/runtime/typescript_parser_runtime.ts",
  );
  const publicDiagnosticMaterializerSource = await Deno.readTextFile(
    "src/targets/runtime/public_diagnostic_materializer.ts",
  );
  const publicFieldMaterializerSource = await Deno.readTextFile(
    "src/targets/runtime/public_field_materializer.ts",
  );
  const publicParseResultMaterializerSource = await Deno.readTextFile(
    "src/targets/runtime/public_parse_result_materializer.ts",
  );
  const publicRuleNodeMaterializerSource = await Deno.readTextFile(
    "src/targets/runtime/public_rule_node_materializer.ts",
  );
  assertIncludes(parserRuntimeSource, "function parseTokenList");
  assertIncludes(parserRuntimeSource, "createParserReplayRuntimeProgram");
  assertIncludes(parserRuntimeSource, "parserReplayVm");
  assertIncludes(parserRuntimeSource, "parserReplayResultStatus");
  assertNotIncludes(parserRuntimeSource, "function reduceProduction");
  assertIncludes(
    parserRuntimeSource,
    "createParserConflictTraceRuntimeProgram",
  );
  assertIncludes(parserRuntimeSource, "createParserTraceRuntimeProgram");
  assertIncludes(runtimeLanguageSourcesSource, "branchNextDepth");
  assertIncludes(parserRuntimeSource, "createParserReducerRuntimeProgram");
  assertIncludes(parserRuntimeSource, "createParserFieldRuntimeProgram");
  assertIncludes(parserRuntimeSource, "createLexerSpecRuntimeProgram");
  assertIncludes(parserRuntimeSource, "createParserObjectRuntimeProgram");
  assertIncludes(parserRuntimeSource, "createSourceTextRuntimeProgram");
  assertIncludes(runtimeLanguageSourcesSource, "parserReducerOperation");
  assertIncludes(runtimeLanguageSourcesSource, "parserReducerPayloadStatus");
  assertIncludes(runtimeLanguageSourcesSource, "parserReducerChildRole");
  assertIncludes(parserRuntimeSource, "catch (error)");
  assertIncludes(parserRuntimeSource, "internalParserDiagnostic(error");
  assertIncludes(runtimeLanguageSourcesSource, "parserReducerResultKind");
  assertIncludes(runtimeLanguageSourcesSource, "parserReplayReductionStatus");
  assertIncludes(runtimeLanguageSourcesSource, "parserReplayRhsStart");
  assertIncludes(runtimeLanguageSourcesSource, "parserReplayStackDepth");
  assertIncludes(runtimeLanguageSourcesSource, "parserReplayActionStatus");
  assertNotIncludes(parserRuntimeSource, "rhsLength === 0");
  assertNotIncludes(parserRuntimeSource, "values.length - rhsLength");
  assertNotIncludes(parserRuntimeSource, "values.length - 1");
  assertNotIncludes(parserRuntimeSource, "let streamIndex");
  assertNotIncludes(parserRuntimeSource, "values.splice");
  assertNotIncludes(parserRuntimeSource, "switch (reducerResultKind)");
  assertNotIncludes(parserRuntimeSource, "function tokenFragment");
  assertIncludes(parserRuntimeSource, "lexerSpecTerminal");
  assertIncludes(parserRuntimeSource, "lexerSpecPublicTokenStatus");
  assertIncludes(publicRuleNodeMaterializerSource, "parserFieldStorageStatus");
  assertIncludes(publicRuleNodeMaterializerSource, "parserFieldSchemaStatus");
  assertIncludes(publicRuleNodeMaterializerSource, "parserFieldBuildStatus");
  assertIncludes(publicRuleNodeMaterializerSource, "parserFieldEntryStatus");
  assertIncludes(runtimeLanguageSourcesSource, "parserFieldValueClass");
  assertIncludes(runtimeLanguageSourcesSource, "parserFieldStorageStatus");
  assertIncludes(publicRuleNodeMaterializerSource, "parserFieldCaptureStatus");
  assertIncludes(runtimeLanguageSourcesSource, "parserFieldFinalStatus");
  assertIncludes(
    publicRuleNodeMaterializerSource,
    "parserFieldFinalBuildStatus",
  );
  assertNotIncludes(parserRuntimeSource, "captureCount > 0");
  assertNotIncludes(
    parserRuntimeSource,
    "schemaStatus === FIELD_SCHEMA_CAPTURE_WITHOUT_SCHEMA",
  );
  assertNotIncludes(parserRuntimeSource, "if (end <= start)");
  assertNotIncludes(parserRuntimeSource, "valueClass === FIELD_VALUE_ARRAY");
  assertNotIncludes(
    parserRuntimeSource,
    "const valueClass = parserFieldValueClass(entry)",
  );
  assertNotIncludes(parserRuntimeSource, "entry === NO_FIELD");
  assertNotIncludes(
    parserRuntimeSource,
    "const status = parserFieldFinalStatus(entry, count)",
  );
  assertNotIncludes(
    parserRuntimeSource,
    "status === FIELD_FINAL_REQUIRED_MISSING",
  );
  assertNotIncludes(parserRuntimeSource, "status === FIELD_FINAL_TOO_MANY");
  assertNotIncludes(parserRuntimeSource, "values === 0");
  assertIncludes(publicFieldMaterializerSource, "parserFieldArrayValueStatus");
  assertIncludes(publicFieldMaterializerSource, "parserFieldScalarValueStatus");
  assertNotIncludes(publicFieldMaterializerSource, "vectorHandle === 0");
  assertNotIncludes(publicFieldMaterializerSource, "count === 0 ? null");
  assertIncludes(
    publicRuleNodeMaterializerSource,
    "parserRuleNodeChildListStatus",
  );
  assertNotIncludes(publicRuleNodeMaterializerSource, "if (count === 0)");
  assertIncludes(
    publicRuleNodeMaterializerSource,
    "const counts = runtimeArrayNew",
  );
  assertIncludes(publicRuleNodeMaterializerSource, "runtimeArrayStore(counts");
  assertIncludes(
    publicRuleNodeMaterializerSource,
    "const fieldValues = runtimeRecordNew",
  );
  assertIncludes(
    publicRuleNodeMaterializerSource,
    "runtimeRecordStore(fieldValues",
  );
  assertIncludes(
    publicRuleNodeMaterializerSource,
    "runtimeVectorAppend(values, value)",
  );
  assertIncludes(parserRuntimeSource, "emitPublicFieldMaterializer");
  assertIncludes(publicFieldMaterializerSource, "createPublicFieldObject");
  assertIncludes(publicFieldMaterializerSource, "storePublicField");
  assertIncludes(
    publicFieldMaterializerSource,
    "function materializeFieldArray",
  );
  assertIncludes(publicFieldMaterializerSource, "Object.create(null)");
  assertIncludes(publicFieldMaterializerSource, "fields[name] = value");
  assertIncludes(parserRuntimeSource, "emitPublicDiagnosticMaterializer");
  assertIncludes(
    parserRuntimeSource,
    "PARSER_DIAGNOSTIC_DETAIL_PARSER_STATE",
  );
  assertIncludes(runtimeLanguageSourcesSource, "parserDiagnosticDetailKindId");
  assertIncludes(parserRuntimeSource, "parserDiagnosticDetailKindNone");
  assertIncludes(
    parserRuntimeSource,
    "parserDiagnosticDetailKindParserState",
  );
  assertIncludes(parserRuntimeSource, "emitPublicParseResultMaterializer");
  assertIncludes(parserRuntimeSource, "emitPublicEofTokenMaterializer");
  assertIncludes(parserRuntimeSource, "emitPublicSourceTextBoundary");
  assertIncludes(
    parserRuntimeSource,
    "const sourceText = createSourceTextBoundary(source)",
  );
  assertIncludes(
    parserRuntimeSource,
    "validateTokenStream(sourceText, tokens)",
  );
  assertIncludes(
    parserRuntimeSource,
    "parserTokenStreamSpanBoundsStatus",
  );
  assertIncludes(
    runtimeLanguageSourcesSource,
    "parserTokenStreamSpanBoundsStatus",
  );
  assertIncludes(
    parserRuntimeSource,
    "parserTokenStreamSpanPositionStatus",
  );
  assertIncludes(
    runtimeLanguageSourcesSource,
    "parserTokenStreamSpanPositionStatus",
  );
  assertIncludes(
    parserRuntimeSource,
    "parserTokenStreamEofStatus",
  );
  assertIncludes(
    parserRuntimeSource,
    "parserTokenStreamEofSequenceStatus",
  );
  assertIncludes(
    runtimeLanguageSourcesSource,
    "parserTokenStreamEofStatus",
  );
  assertIncludes(
    runtimeLanguageSourcesSource,
    "parserTokenStreamEofSequenceStatus",
  );
  assertIncludes(
    parserRuntimeSource,
    "parserTokenStreamGapTokenStatus",
  );
  assertIncludes(
    parserRuntimeSource,
    "parserTokenStreamGapIsEmpty",
  );
  assertIncludes(
    parserRuntimeSource,
    "parserTokenStreamCanAdvance",
  );
  assertIncludes(
    runtimeLanguageSourcesSource,
    "parserTokenStreamGapTokenStatus",
  );
  assertIncludes(
    runtimeLanguageSourcesSource,
    "parserTokenStreamGapIsEmpty",
  );
  assertIncludes(
    runtimeLanguageSourcesSource,
    "parserTokenStreamCanAdvance",
  );
  assertIncludes(
    parserRuntimeSource,
    "parserTokenStreamTokenMatchStatus",
  );
  assertIncludes(
    runtimeLanguageSourcesSource,
    "parserTokenStreamTokenMatchStatus",
  );
  assertIncludes(
    parserRuntimeSource,
    "parserTokenStreamCanonicalMatchStatus",
  );
  assertIncludes(
    runtimeLanguageSourcesSource,
    "parserTokenStreamCanonicalMatchStatus",
  );
  assertIncludes(
    parserRuntimeSource,
    "parserTokenStreamFinalStatus",
  );
  assertIncludes(
    runtimeLanguageSourcesSource,
    "parserTokenStreamFinalStatus",
  );
  assertNotIncludes(
    parserRuntimeSource,
    "Generated from src/runtime/token_stream.brl",
  );
  assertNotIncludes(parserRuntimeSource, "if (start === end) return null");
  assertIncludes(runtimeLanguageSourcesSource, "parserExpectedRowStatus");
  assertNotIncludes(publicDiagnosticMaterializerSource, "end <= start");
  assertIncludes(
    parserRuntimeSource,
    "parserTokenStreamPublicTokenStatus",
  );
  assertIncludes(
    runtimeLanguageSourcesSource,
    "parserTraceTokenStreamStatus",
  );
  assertIncludes(
    parserRuntimeSource,
    "parserTraceTokenStreamPublicIndex",
  );
  assertIncludes(
    runtimeLanguageSourcesSource,
    "parserTraceTerminal",
  );
  assertIncludes(
    parserRuntimeSource,
    "parserTraceTokenStreamStep",
  );
  assertIncludes(
    runtimeLanguageSourcesSource,
    "parserTraceTokenStreamEncodedTerminal",
  );
  assertIncludes(
    parserRuntimeSource,
    "parserTraceTokenStreamStepStatus",
  );
  assertIncludes(
    parserRuntimeSource,
    "parserTraceTokenStreamStepTerminal",
  );
  assertIncludes(
    parserRuntimeSource,
    "parserAcceptedRootStatus",
  );
  assertIncludes(
    parserRuntimeSource,
    "parserShiftedTokenStatus",
  );
  assertIncludes(parserRuntimeSource, "sourceTextMatches");
  assertNotIncludes(parserRuntimeSource, "left.type !== right.type");
  assertNotIncludes(parserRuntimeSource, "left.kind === right.kind");
  assertNotIncludes(parserRuntimeSource, "left.literal === right.literal");
  assertNotIncludes(
    parserRuntimeSource,
    "eofIndex !== -1 && eofIndex !== tokens.length - 1",
  );
  assertNotIncludes(parserRuntimeSource, "if (eofIndex !== -1)");
  assertNotIncludes(
    parserRuntimeSource,
    "previousEnd < sourceText.length && eofIndex === -1",
  );
  assertNotIncludes(
    parserRuntimeSource,
    'token.channel !== "main" || token.text !== token.literal',
  );
  assertNotIncludes(
    parserRuntimeSource,
    'token.channel !== "main" && token.channel !== "trivia"',
  );
  assertNotIncludes(parserRuntimeSource, 'token.channel !== "error"');
  assertNotIncludes(parserRuntimeSource, "function isTraceTriviaToken");
  assertNotIncludes(parserRuntimeSource, "function skipTraceTrivia");
  assertNotIncludes(
    parserRuntimeSource,
    "traceTokenStreamStatus(tokens[index])",
  );
  assertNotIncludes(
    parserRuntimeSource,
    "index < tokens.length ? index : tokens.length",
  );
  assertNotIncludes(
    parserRuntimeSource,
    "canonical.span.end <= token.span.start",
  );
  assertNotIncludes(parserRuntimeSource, "token.span.end <= start");
  assertNotIncludes(parserRuntimeSource, "token.span.start >= end");
  assertNotIncludes(
    parserRuntimeSource,
    "if (isTraceTriviaToken(canonical))",
  );
  assertNotIncludes(parserRuntimeSource, "source.slice");
  assertIncludes(
    parserRuntimeSource,
    "materializeSourceEofToken(sourceText)",
  );
  assertIncludes(
    publicDiagnosticMaterializerSource,
    "function parseDiagnostic",
  );
  assertIncludes(
    publicDiagnosticMaterializerSource,
    "function unexpectedTokenDiagnostic",
  );
  assertIncludes(
    publicDiagnosticMaterializerSource,
    "parserUnexpectedDiagnosticCode",
  );
  assertIncludes(publicDiagnosticMaterializerSource, "parserDiagnosticNew");
  assertIncludes(
    publicDiagnosticMaterializerSource,
    "function diagnosticCodeName",
  );
  assertIncludes(
    publicDiagnosticMaterializerSource,
    "const detailKindId = parserDiagnosticDetailKindId(runtimeCode)",
  );
  assertIncludes(
    publicDiagnosticMaterializerSource,
    "parserDiagnosticCodeStatus",
  );
  assertIncludes(
    publicDiagnosticMaterializerSource,
    "const status = parserDiagnosticMergeStatus(left.length, right.length)",
  );
  assertIncludes(runtimeLanguageSourcesSource, "parserDiagnosticMergeStatus");
  assertNotIncludes(publicDiagnosticMaterializerSource, "left.length === 0");
  assertNotIncludes(publicDiagnosticMaterializerSource, "right.length === 0");
  assertNotIncludes(
    publicDiagnosticMaterializerSource,
    "parserDiagnosticCode(handle) !== runtimeCode",
  );
  assertIncludes(
    publicDiagnosticMaterializerSource,
    "DIAGNOSTIC_PARSE_LEXICAL_ERROR",
  );
  assertIncludes(
    publicDiagnosticMaterializerSource,
    "runtimeDetailKind: diagnosticDetailKindName(detailKindId)",
  );
  assertIncludes(
    publicDiagnosticMaterializerSource,
    "runtimeDetailKindId: detailKindId",
  );
  assertIncludes(
    publicDiagnosticMaterializerSource,
    "function diagnosticDetailKindName",
  );
  assertIncludes(
    publicDiagnosticMaterializerSource,
    "DIAGNOSTIC_DETAIL_PARSER_STATE",
  );
  assertIncludes(syntaxRuntimeSource, "runtimeDetailKindId: number");
  assertIncludes(
    publicDiagnosticMaterializerSource,
    "lexerTokenDiagnosticStatus",
  );
  assertIncludes(
    publicDiagnosticMaterializerSource,
    "parserDiagnosticSpanStart",
  );
  assertIncludes(publicDiagnosticMaterializerSource, '"PARSER_INTERNAL_ERROR"');
  assertIncludes(
    publicParseResultMaterializerSource,
    "function successfulParseResult",
  );
  assertIncludes(
    publicParseResultMaterializerSource,
    "function failedParseResult",
  );
  assertIncludes(publicParseResultMaterializerSource, "ok: true");
  assertIncludes(publicParseResultMaterializerSource, "ok: false");
  assertIncludes(parserRuntimeSource, "emitPublicRuleNodeMaterializer");
  assertIncludes(publicRuleNodeMaterializerSource, "hostRuleNodeRuntimeHandle");
  assertIncludes(parserRuntimeSource, "resetPublicSyntaxMaterialization");
  assertIncludes(
    publicRuleNodeMaterializerSource,
    "function materializeRuleNode",
  );
  assertIncludes(
    publicRuleNodeMaterializerSource,
    "parserRuleNodeRuleId(runtimeHandle)",
  );
  assertIncludes(publicRuleNodeMaterializerSource, "function buildChildren");
  assertIncludes(publicRuleNodeMaterializerSource, "parserRuleNodeChildren");
  assertIncludes(publicRuleNodeMaterializerSource, "RUNTIME_NODE_HANDLES");
  assertIncludes(publicRuleNodeMaterializerSource, "RUNTIME_SYNTAX_VALUES");
  assertIncludes(parserRuntimeSource, "parserTraceStatusKind");
  assertIncludes(parserRuntimeSource, "function replayTrace");
  assertNotIncludes(parserRuntimeSource, 'expected.includes("EOF")');
  assertNotIncludes(parserRuntimeSource, "status === 1");
  assertNotIncludes(parserRuntimeSource, "status === 3");
  assertNotIncludes(parserRuntimeSource, "NAMED_TERMINALS");
  assertNotIncludes(parserRuntimeSource, "LITERAL_TERMINALS");
  assertNotIncludes(parserRuntimeSource, "MAIN_TOKEN_KINDS");
  assertNotIncludes(parserRuntimeSource, "TRIVIA_TOKEN_KINDS");
  assertNotIncludes(
    parserRuntimeSource,
    'if (token.type === "eof") return EOF_TERMINAL',
  );
  assertNotIncludes(parserRuntimeSource, "if (terminal >= 0) return terminal");
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
  assertNotIncludes(parserRuntimeSource, "function isMainSyntaxToken");
  assertNotIncludes(
    parserRuntimeSource,
    '(value as { type?: unknown }).type === "literal"',
  );
  assertNotIncludes(parserRuntimeSource, "PRODUCTION_REDUCERS");
  assertNotIncludes(parserRuntimeSource, "RULE_FIELD_SCHEMA_ENTRIES");
  assertNotIncludes(parserRuntimeSource, "RULE_FIELD_SCHEMAS");
  assertNotIncludes(parserRuntimeSource, "const counts = Object.create(null)");
  assertNotIncludes(parserRuntimeSource, "Object.create(null)");
  assertNotIncludes(parserRuntimeSource, "counts[fieldId]");
  assertNotIncludes(parserRuntimeSource, "const fieldValues = runtimeArrayNew");
  assertNotIncludes(parserRuntimeSource, "const values = fields[name]");
  assertNotIncludes(parserRuntimeSource, "fields[name] =");
  assertNotIncludes(parserRuntimeSource, "function materializeRuleNode");
  assertNotIncludes(parserRuntimeSource, "function buildChildren");
  assertNotIncludes(parserRuntimeSource, "RUNTIME_NODE_HANDLES");
  assertNotIncludes(parserRuntimeSource, "RUNTIME_SYNTAX_VALUES");
  assertNotIncludes(parserRuntimeSource, "function parseDiagnostic");
  assertNotIncludes(parserRuntimeSource, "ok: true");
  assertNotIncludes(parserRuntimeSource, "ok: false");
  assertNotIncludes(parserRuntimeSource, "function unexpectedTokenDiagnostic");
  assertNotIncludes(parserRuntimeSource, "parserDiagnosticNew");
  assertNotIncludes(parserRuntimeSource, "parserDiagnosticSpanStart");
  assertNotIncludes(parserRuntimeSource, "function materializeEofToken");
  assertNotIncludes(parserRuntimeSource, "function eofToken");
  assertNotIncludes(parserRuntimeSource, "interface ParseBranch");
  assertNotIncludes(parserRuntimeSource, "function findActions");
  assertNotIncludes(parserRuntimeSource, "function skipTrivia");
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

  const wasmLexerSource = await Deno.readTextFile(
    "src/targets/wasm/lexer_emit.ts",
  );
  assertIncludes(wasmLexerSource, "createLexerRuntimeProgram");
  assertIncludes(wasmLexerSource, "emitPublicTokenMaterializer");
  assertNotIncludes(wasmLexerSource, "const SPECS:");
  assertNotIncludes(wasmLexerSource, "DFA_TRANSITIONS");
  assertNotIncludes(wasmLexerSource, "DFA_ASCII_TRANSITIONS");
  assertNotIncludes(wasmLexerSource, "DFA_ACCEPT_CANDIDATES");
  assertNotIncludes(wasmLexerSource, "contextualDfaTransition");

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
  assertEquals(RUNTIME_IMPLEMENTATION_METADATA.sources.length, 29);
  const roles = RUNTIME_IMPLEMENTATION_METADATA.sources.map((source) =>
    source.role
  );
  assert(roles.includes("shared-brl-lexer"));
  assert(roles.includes("shared-brl-parser"));
  assert(roles.includes("shared-brl-branch-search"));
  assert(roles.includes("shared-brl-reductions"));
  assert(roles.includes("shared-brl-cst"));
  assert(roles.includes("shared-brl-token-stream"));
  assert(roles.includes("shared-brl-diagnostics"));
  assert(roles.includes("shared-brl-source-map"));
  assert(roles.includes("public-source-text-boundary"));
  assert(roles.includes("shared-wasm-runtime-api"));
  assert(roles.includes("shared-generic-wasm-executor"));
  assert(roles.includes("parser-diagnostic-codes"));
  assert(roles.includes("shared-typescript-runtime-api"));
  assert(roles.includes("parser-kit-shared-runtime"));
  assert(roles.includes("wasm-abi-constants"));
  assert(roles.includes("generated-source-provenance"));

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
