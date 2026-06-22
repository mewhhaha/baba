import {
  applyBundle,
  assert,
  assertEquals,
  assertIncludes,
  assertNotIncludes,
  assertThrowsIncludes,
  captureConsoleError,
  captureConsoleLog,
  compile,
  denoCheck,
  main,
} from "./helpers.ts";

Deno.test("generates standalone Wasm lexer and parser", async () => {
  const source = `
    token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
    token INTEGER = /[0-9]+/ ;
    skip WS = /[ \\t\\r\\n]+/ ;
    skip LINE_COMMENT = /\\/\\/[^\\n]*/ ;

    module = statement* ;
    statement = "let" name:IDENT "=" value:INTEGER ";" ;
  `;
  const result = compile(source, { targets: ["wasm"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);
  assertEquals(
    result.bundle.files.map((file) => file.path).join(","),
    "wasm/abi.json,wasm/lexer.ts,wasm/mod.ts,wasm/parser.ts,wasm/syntax.ts,wasm/wasm.ts",
  );

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/wasm/mod.ts`);
    const wasmSource = await Deno.readTextFile(`${dir}/wasm/wasm.ts`);
    assertIncludes(wasmSource, "lex_all");
    assertIncludes(wasmSource, "parserTraceRuntimeBytes");
    assertIncludes(wasmSource, "parserTraceRuntime.parserTrace");
    assertIncludes(
      wasmSource,
      "parserTraceRuntime = instantiateParserTraceRuntime();",
    );
    assertIncludes(wasmSource, "validateWasmAbi();");
    assertIncludes(wasmSource, "wasm.input_base()");
    assertIncludes(wasmSource, "wasm.source_encoding()");
    assertIncludes(wasmSource, "wasm.host_ownership_model()");
    assertIncludes(wasmSource, "wasm.result_lifetime_model()");
    assertNotIncludes(wasmSource, "wasm.parse_trace");
    assertIncludes(wasmSource, "const MAX_WASM_PAGES = 65535");
    assertIncludes(wasmSource, "memory.grow(requiredPages - currentPages)");
    const abi = JSON.parse(await Deno.readTextFile(`${dir}/wasm/abi.json`));
    const mod = await import(`file://${dir}/wasm/mod.ts`);
    const wasmModule = new WebAssembly.Module(mod.wasmBytes);
    const wasmInstance = new WebAssembly.Instance(wasmModule, {});
    const wasmExports = wasmInstance.exports as unknown as {
      parse_trace?: unknown;
      abi_version(): number;
      plan_version(): number;
      reset(): void;
      input_base(): number;
      max_pages(): number;
      source_encoding(): number;
      span_unit(): number;
      lex_result_i32_count(): number;
      token_record_i32_count(): number;
      host_ownership_model(): number;
      result_lifetime_model(): number;
    };
    assertEquals(wasmExports.parse_trace, undefined);
    assertEquals(wasmExports.abi_version(), 1);
    assertEquals(wasmExports.plan_version(), 1);
    assert(wasmExports.input_base() > 0);
    assertEquals(wasmExports.max_pages(), 65_535);
    assertEquals(wasmExports.source_encoding(), 1);
    assertEquals(wasmExports.span_unit(), 1);
    assertEquals(wasmExports.lex_result_i32_count(), 2);
    assertEquals(wasmExports.token_record_i32_count(), 3);
    assertEquals(wasmExports.host_ownership_model(), 1);
    assertEquals(wasmExports.result_lifetime_model(), 1);
    wasmExports.reset();
    assertEquals(mod.wasmTargetKind, "javascript-hosted-core-wasm");
    assertEquals(mod.wasmAbiVersion, 1);
    assertEquals(mod.wasmInputBase, wasmExports.input_base());
    assertEquals(mod.wasmMaxPages, 65_535);
    assertEquals(mod.wasmSourceEncoding, 1);
    assertEquals(mod.wasmSpanUnit, 1);
    assertEquals(mod.wasmLexResultI32Count, 2);
    assertEquals(mod.wasmTokenRecordI32Count, 3);
    assertEquals(mod.wasmHostOwnershipModel, 1);
    assertEquals(mod.wasmResultLifetimeModel, 1);
    assertEquals(mod.wasmAdapterHandleCapabilityModel, 1);
    assertEquals(mod.wasmTraceStatusOk, 0);
    assertEquals(mod.wasmTraceStatusUnexpected, 1);
    assertEquals(mod.wasmTraceStatusInternal, 2);
    assertEquals(mod.wasmTraceStatusBranchLimit, 3);
    assertEquals(mod.parserDiagnosticCodeParseLexicalError, 1);
    assertEquals(mod.parserDiagnosticCodeParseUnexpectedToken, 2);
    assertEquals(mod.parserDiagnosticCodeParseTrailingInput, 3);
    assertEquals(mod.parserDiagnosticCodeParseInvalidTokenStream, 4);
    assertEquals(mod.parserDiagnosticCodeInternalError, 5);
    assertEquals(mod.parserDiagnosticCodeBranchLimit, 6);
    assertEquals(abi.format, "baba-wasm-abi");
    assertEquals(abi.version, 1);
    assertEquals(abi.targetKind, mod.wasmTargetKind);
    assertEquals(abi.parserPlan.format, mod.parserPlanFormat);
    assertEquals(abi.parserPlan.version, mod.parserPlanVersion);
    assertEquals(abi.parserPlan.semantics, mod.parserPlanSemantics);
    assertEquals(abi.parserPlan.hash, mod.parserPlanHash);
    assertEquals(
      abi.runtimeImplementation.format,
      mod.runtimeImplementationFormat,
    );
    assertEquals(
      abi.runtimeImplementation.version,
      mod.runtimeImplementationVersion,
    );
    assertEquals(
      abi.runtimeImplementation.semantics,
      mod.runtimeImplementationSemantics,
    );
    assertEquals(
      abi.runtimeImplementation.hash,
      mod.runtimeImplementationHash,
    );
    assertEquals(abi.core.abiVersion, mod.wasmAbiVersion);
    assertEquals(abi.core.memory.export, "memory");
    assertEquals(abi.core.memory.maxPages, mod.wasmMaxPages);
    assertEquals(abi.core.memory.inputBase, mod.wasmInputBase);
    assertEquals(abi.core.sourceEncoding.value, mod.wasmSourceEncoding);
    assertEquals(abi.core.sourceEncoding.kind, "utf16");
    assertEquals(abi.core.sourceEncoding.unitBytes, 2);
    assertEquals(abi.core.spanUnit.value, mod.wasmSpanUnit);
    assertEquals(abi.core.ownership.value, mod.wasmHostOwnershipModel);
    assertEquals(abi.core.resultLifetime.value, mod.wasmResultLifetimeModel);
    assertEquals(
      abi.core.layouts.lexResult.i32Count,
      mod.wasmLexResultI32Count,
    );
    assertEquals(
      abi.core.layouts.tokenRecord.i32Count,
      mod.wasmTokenRecordI32Count,
    );
    assertEquals(
      abi.core.exports.map((entry: { name: string }) => entry.name).join(","),
      "memory,lex_one,parser_action,parser_goto,lex_all,abi_version,plan_version,reset,input_base,max_pages,source_encoding,span_unit,lex_result_i32_count,token_record_i32_count,host_ownership_model,result_lifetime_model",
    );
    assertEquals(
      abi.adapter.handleCapability.value,
      mod.wasmAdapterHandleCapabilityModel,
    );
    assertEquals(abi.traceStatuses.ok, mod.wasmTraceStatusOk);
    assertEquals(abi.traceStatuses.unexpected, mod.wasmTraceStatusUnexpected);
    assertEquals(abi.traceStatuses.internal, mod.wasmTraceStatusInternal);
    assertEquals(abi.traceStatuses.branchLimit, mod.wasmTraceStatusBranchLimit);
    assertEquals(
      abi.parserDiagnosticCodes.parseLexicalError,
      mod.parserDiagnosticCodeParseLexicalError,
    );
    assertEquals(
      abi.parserDiagnosticCodes.parseUnexpectedToken,
      mod.parserDiagnosticCodeParseUnexpectedToken,
    );
    assertEquals(
      abi.parserDiagnosticCodes.parseTrailingInput,
      mod.parserDiagnosticCodeParseTrailingInput,
    );
    assertEquals(
      abi.parserDiagnosticCodes.parseInvalidTokenStream,
      mod.parserDiagnosticCodeParseInvalidTokenStream,
    );
    assertEquals(
      abi.parserDiagnosticCodes.internalError,
      mod.parserDiagnosticCodeInternalError,
    );
    assertEquals(
      abi.parserDiagnosticCodes.branchLimit,
      mod.parserDiagnosticCodeBranchLimit,
    );
    assertEquals(abi.parserDiagnostics.detailKinds.none, 0);
    assertEquals(abi.parserDiagnostics.detailKinds.parserState, 1);
    const unexpectedSchema = abi.parserDiagnostics.schemas.find((
      schema: { name: string },
    ) => schema.name === "parseUnexpectedToken");
    assert(unexpectedSchema);
    assertEquals(unexpectedSchema.publicCode, "PARSE_UNEXPECTED_TOKEN");
    assertEquals(
      unexpectedSchema.runtimeCode,
      mod.parserDiagnosticCodeParseUnexpectedToken,
    );
    assertEquals(unexpectedSchema.detailKind, "parser-state");
    assertEquals(unexpectedSchema.detailKindId, 1);
    assertEquals(unexpectedSchema.payloadFields.join(","), "expected,found");
    const lexicalSchema = abi.parserDiagnostics.schemas.find((
      schema: { name: string },
    ) => schema.name === "parseLexicalError");
    assert(lexicalSchema);
    assertEquals(lexicalSchema.detailKind, "none");
    assertEquals(lexicalSchema.payloadFields.join(","), "found");
    assertEquals(mod.parserPlanFormat, "baba-parser-plan");
    assertEquals(mod.parserPlanVersion, 1);
    assertEquals(mod.parserPlanSemantics, "baba-portable-v1");
    assert(mod.parserPlanHash.startsWith("fnv1a64:"));
    assertEquals(
      mod.runtimeImplementationFormat,
      "baba-runtime-implementation",
    );
    assertEquals(mod.runtimeImplementationVersion, 1);
    assertEquals(
      mod.runtimeImplementationSemantics,
      "baba-runtime-portable-v1",
    );
    assert(mod.runtimeImplementationHash.startsWith("fnv1a64:"));
    assert(typeof mod.reset === "function");

    const lexed = mod.lex("let x = 42; // ok");
    assertEquals(
      lexed.tokens
        .filter((token: { channel: string }) => token.channel !== "trivia")
        .map((token: { type: string; literal?: string; kind?: string }) =>
          token.type === "literal" ? token.literal : token.kind ?? token.type
        )
        .join(","),
      "let,IDENT,=,INTEGER,;,eof",
    );
    assert(
      lexed.tokens.some((token: { kind?: string; channel: string }) =>
        token.kind === "LINE_COMMENT" && token.channel === "trivia"
      ),
    );
    const invalid = mod.lex("let @ = 1;");
    assertEquals(invalid.diagnostics.length, 1);
    assertEquals(
      invalid.tokens.find((token: { type: string }) => token.type === "error")
        ?.text,
      "@",
    );

    const parsed = mod.parse("let x = 42;");
    assertEquals(parsed.ok, true);
    const statement = parsed.root.children[0];
    assertEquals(statement.fields.name.text, "x");
    assertEquals(statement.fields.value.text, "42");

    const reparsed = mod.parseTokensUnchecked(
      "let x = 42;",
      mod.lex("let x = 42;").tokens,
    );
    assertEquals(reparsed.ok, true);
    const checkedReparse = mod.parseTokens(
      "let x = 42;",
      mod.lex("let x = 42;").tokens,
    );
    assertEquals(checkedReparse.ok, true);

    const parseError = mod.parse("let x 42;");
    assertEquals(parseError.ok, false);
    assertEquals(parseError.diagnostics[0].code, "PARSE_UNEXPECTED_TOKEN");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm runtime reset keeps repeated parses within high-water memory", async () => {
  const result = compile(
    `
    token A = /a/ ;
    skip WS = /[ \\t\\r\\n]+/ ;
    module = A* ;
  `,
    { targets: ["wasm"] },
  );
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    const mod = await import(`file://${dir}/wasm/mod.ts`);
    const large = `${"a ".repeat(10_000)}`;
    assertEquals(mod.parse(large).ok, true);
    const highWaterBytes = mod.memory.buffer.byteLength;

    mod.reset();
    for (let index = 0; index < 1_000; index++) {
      assertEquals(mod.parse("a a a").ok, true);
    }
    assertEquals(mod.memory.buffer.byteLength, highWaterBytes);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm parser reports trailing input through trace replay", async () => {
  const result = compile(`module = "a" ;`, { targets: ["wasm"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    const mod = await import(`file://${dir}/wasm/mod.ts`);

    const parsed = mod.parse("aa");
    assertEquals(parsed.ok, false);
    assertEquals(parsed.diagnostics[0].code, "PARSE_TRAILING_INPUT");
    assertEquals(
      parsed.diagnostics[0].runtimeCode,
      mod.parserDiagnosticCodeParseTrailingInput,
    );
    assertEquals(
      Number.isInteger(parsed.diagnostics[0].runtimeDetail),
      true,
    );
    assertEquals(parsed.diagnostics[0].found, JSON.stringify("a"));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm runtime validates parse trace input bounds", async () => {
  const result = compile(`module = "a" ;`, { targets: ["wasm"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    const runtime = await import(`file://${dir}/wasm/wasm.ts`);

    assertThrowsIncludes(
      () => runtime.createParseTraceInput(0),
      "terminalCapacity must be a positive integer",
    );
    const input = runtime.createParseTraceInput(1);
    input.terminals[0] = 0;
    const unexpected = runtime.parseTrace(input, 1);
    assertEquals(unexpected.ok, false);
    assertEquals(unexpected.failureKind, "unexpected");
    assertEquals(unexpected.statusKind, runtime.wasmTraceStatusUnexpected);
    assertEquals(unexpected.internal, false);
    assertEquals(unexpected.limit, false);
    assertThrowsIncludes(
      () => runtime.parseTrace(input, 2),
      "terminalCount exceeds parse input terminalCapacity",
    );
    assertThrowsIncludes(
      () => runtime.parseTrace(input, -1),
      "terminalCount must be a non-negative integer",
    );
    assertThrowsIncludes(
      () =>
        runtime.parseTrace({
          terminals: new Int32Array(0),
          terminalCapacity: 1,
        }, 0),
      "ParseTraceInput is not owned by this adapter",
    );
    const tamperedInput = runtime.createParseTraceInput(1);
    tamperedInput.terminals = new Int32Array(0);
    assertThrowsIncludes(
      () => runtime.parseTrace(tamperedInput, 0),
      "terminals length must cover parse input terminalCapacity",
    );
    const staleInput = runtime.createParseTraceInput(1);
    runtime.reset();
    assertThrowsIncludes(
      () => runtime.parseTrace(staleInput, 0),
      "ParseTraceInput is stale; call createParseTraceInput() again",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm source buffers are adapter-owned capabilities", async () => {
  const result = compile(`module = "a" ;`, { targets: ["wasm"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    const runtime = await import(`file://${dir}/wasm/wasm.ts`);

    const buffer = runtime.writeSource("a");
    assertEquals(runtime.lexOne(buffer, 0)?.end, 1);
    assertEquals(runtime.lexAll(buffer).length, 3);
    assertThrowsIncludes(
      () => runtime.lexOne({ ...buffer }, 0),
      "WasmSourceBuffer is not owned by this adapter",
    );
    assertThrowsIncludes(
      () => runtime.lexAll({ ...buffer }),
      "WasmSourceBuffer is not owned by this adapter",
    );

    runtime.writeSource("aa");
    assertThrowsIncludes(
      () => runtime.lexOne(buffer, 0),
      "WasmSourceBuffer is stale; call writeSource() again",
    );

    const resetBuffer = runtime.writeSource("a");
    assertEquals(runtime.lexOne(resetBuffer, 0)?.end, 1);
    assertThrowsIncludes(
      () => runtime.lexOne(resetBuffer, 2),
      "offset exceeds source buffer length",
    );
    runtime.reset();
    assertThrowsIncludes(
      () => runtime.lexAll(resetBuffer),
      "WasmSourceBuffer is stale; call writeSource() again",
    );

    const nextBuffer = runtime.writeSource("a");
    assertEquals(runtime.lexOne(nextBuffer, 0)?.end, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm target generates deterministic runtime bytes", () => {
  const source = `
    token ID = /[A-Za-z_][A-Za-z0-9_]*/ ;
    skip WS = /[ \\t\\r\\n]+/ ;
    module = "let" name:ID ";" ;
  `;
  const first = compile(source, { targets: ["wasm"] });
  const second = compile(source, { targets: ["wasm"] });
  assertEquals(first.diagnostics.length, 0);
  assertEquals(second.diagnostics.length, 0);
  assert(first.bundle);
  assert(second.bundle);

  const firstWasmSource = first.bundle.files.find((file) =>
    file.path === "wasm/wasm.ts"
  )?.content;
  const secondWasmSource = second.bundle.files.find((file) =>
    file.path === "wasm/wasm.ts"
  )?.content;
  const firstAbiSource = first.bundle.files.find((file) =>
    file.path === "wasm/abi.json"
  )?.content;
  const secondAbiSource = second.bundle.files.find((file) =>
    file.path === "wasm/abi.json"
  )?.content;
  assertEquals(firstWasmSource, secondWasmSource);
  assertEquals(firstAbiSource, secondAbiSource);
});

Deno.test("Wasm lexer preserves UTF-16 offsets for non-BMP literals", async () => {
  const result = compile(`module = face:"😀" ;`, { targets: ["wasm"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    const mod = await import(`file://${dir}/wasm/mod.ts`);
    const parsed = mod.parse("😀");
    assertEquals(parsed.ok, true);
    assertEquals(parsed.root.span.end, 2);
    assertEquals(parsed.root.fields.face.span.end, 2);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm parse fast path handles large parser buffers", async () => {
  const source = `
    token INT = /[0-9]+/ ;
    skip WS = /[ \\t\\r\\n]+/ ;

    module = expr ;
    expr = additive ;
    additive = first:multiplicative rest:(("+" | "-") multiplicative)* ;
    multiplicative = first:primary rest:(("*" | "/") primary)* ;
    primary = INT | "(" expr ")" ;
  `;
  const result = compile(source, { targets: ["wasm"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    const mod = await import(`file://${dir}/wasm/mod.ts`);
    const parsed = mod.parse(expressionSource(900));
    assertEquals(parsed.ok, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("CLI generates Wasm target with custom directory", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const grammarPath = `${dir}/grammar.ebnf`;
    await Deno.writeTextFile(
      grammarPath,
      `
        token ident = /[a-z]+/ ;
        skip whitespace = /[ \\t\\n]+/ ;
        module = "fn" ident ;
      `,
    );

    let logs: string[] = [];
    await captureConsoleError(async () => {
      logs = await captureConsoleLog(() =>
        main([
          "check",
          grammarPath,
          "--target",
          "wasm",
          "--wasm-dir",
          "runtime",
          "--list-files",
        ])
      );
    });
    assertIncludes(logs.join("\n"), "runtime/mod.ts");
    assertIncludes(logs.join("\n"), "runtime/wasm.ts");
    assertIncludes(logs.join("\n"), "runtime/abi.json");

    const outDir = `${dir}/out`;
    await captureConsoleError(() =>
      main([
        "generate",
        grammarPath,
        "--target",
        "wasm",
        "--wasm-dir",
        "runtime",
        "--discard-trivia",
        "--out",
        outDir,
      ])
    );
    assertIncludes(
      await Deno.readTextFile(`${outDir}/runtime/lexer.ts`),
      "const DEFAULT_PRESERVE_TRIVIA = false",
    );
    await denoCheck(`${outDir}/runtime/mod.ts`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

function expressionSource(count: number): string {
  const parts: string[] = [];
  for (let index = 1; index <= count; index++) {
    if (index > 1) parts.push(index % 2 === 0 ? " + " : " - ");
    parts.push(String(index), index % 3 === 0 ? " * 2" : "");
  }
  return parts.join("");
}
