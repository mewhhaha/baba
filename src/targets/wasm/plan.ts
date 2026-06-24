import type {
  BabaMetadata,
  Diagnostic,
  GeneratedFile,
  PortabilityMode,
  WasmTargetOptions,
} from "../../ast.ts";
import type { AnalyzedGrammar } from "../../compiler/ir.ts";
import type { Dfa } from "../../compiler/regex/dfa.ts";
import type { BnfGrammar } from "../typescript/bnf.ts";
import type { LrAction, LrActionSet, LrTable } from "../typescript/lr1.ts";
import { compileRuntimeLanguageWasm } from "../runtime/language.ts";
import {
  PARSER_DIAGNOSTIC_CODES,
  PARSER_DIAGNOSTIC_DETAIL_KINDS,
  PARSER_DIAGNOSTIC_SCHEMAS,
} from "../runtime/diagnostic_codes.ts";
import { RUNTIME_IMPLEMENTATION_METADATA } from "../runtime/implementation.ts";
import {
  createParserConflictTraceRuntimeProgram,
  createParserTraceRuntimeProgram,
  RUNTIME_ACTION_ACCEPT,
  RUNTIME_ACTION_PAYLOAD_MASK,
  RUNTIME_ACTION_REDUCE,
  RUNTIME_ACTION_SHIFT,
  RUNTIME_TRACE_STATUS_AMBIGUOUS,
  RUNTIME_TRACE_STATUS_BRANCH_LIMIT,
  RUNTIME_TRACE_STATUS_INTERNAL,
  RUNTIME_TRACE_STATUS_OK,
  RUNTIME_TRACE_STATUS_TRACE_LIMIT,
  RUNTIME_TRACE_STATUS_UNEXPECTED,
} from "../runtime/language_sources.ts";
import type {
  PortableParserPlanMetadata,
  PortableParserPlanV1,
} from "../runtime/portable_plan.ts";
import {
  portablePlanToBnf,
  portablePlanToDfa,
  portablePlanToLrTable,
} from "../../compiler/portable_plan/adapters.ts";
import {
  WASM_ABI_VERSION,
  WASM_ADAPTER_HANDLE_CAPABILITY_EPOCH,
  WASM_HOST_OWNERSHIP_CALLER_MANAGED,
  WASM_I32_BYTES,
  WASM_LEX_RESULT_I32_COUNT,
  WASM_MAX_PAGES,
  WASM_PAGE_BYTES,
  WASM_RESULT_LIFETIME_CALLER_BUFFER,
  WASM_SOURCE_ENCODING_UTF16,
  WASM_SPAN_UNIT_UTF16,
  WASM_TARGET_KIND,
  WASM_TOKEN_RECORD_I32_COUNT,
  WASM_UTF16_UNIT_BYTES,
} from "../runtime/wasm_abi.ts";
import { emitSyntaxFromPortablePlan } from "../typescript/syntax_emit.ts";
import {
  planPortableRuntime,
  type RuntimeParserPlan,
  type RuntimeParserPlanningOptions,
} from "../runtime/plan.ts";
import { emitWasmLexerFromPortablePlan } from "./lexer_emit.ts";
import { emitWasmModule, type WasmModuleImage } from "./module_emit.ts";
import { emitWasmParser } from "./parser_emit.ts";
import { emitWasmRuntime } from "./runtime_emit.ts";

export interface WasmPlan {
  analyzed: AnalyzedGrammar;
  bnf: BnfGrammar;
  lr: LrTable;
  dfa: Dfa;
  portable: PortableParserPlanV1;
  portableMetadata: PortableParserPlanMetadata;
  wasm: WasmModuleImage;
  parserTraceWasm: Uint8Array;
  directory: string;
  preserveTrivia: boolean;
  generatedBytes: number;
  diagnostics: readonly Diagnostic[];
}

export function planWasmTarget(
  analyzed: AnalyzedGrammar,
  options: WasmTargetOptions = {},
  metadata: BabaMetadata = {},
  portability: PortabilityMode = "warn",
  runtimePlanInput?: RuntimeParserPlan | { diagnostics: readonly Diagnostic[] },
): WasmPlan | { diagnostics: readonly Diagnostic[] } {
  const diagnostics = [...wasmOptionsDiagnostics(options)];
  const runtimePlan = runtimePlanInput ??
    planPortableRuntime(
      analyzed,
      runtimePlanningOptions(options),
      metadata,
      portability,
    );
  if (!runtimePlanInput) diagnostics.push(...runtimePlan.diagnostics);
  if (hasErrors(diagnostics) || !isRuntimePlan(runtimePlan)) {
    return { diagnostics };
  }
  const portableBnf = portablePlanToBnf(runtimePlan.portable);
  const portableLr = portablePlanToLrTable(runtimePlan.portable);
  const portableDfa = portablePlanToDfa(runtimePlan.portable);
  const wasm = emitWasmModule(
    portableDfa,
    portableLr,
    runtimePlan.portable.version,
  );
  const parserTraceWasm = emitParserTraceWasm(
    portableBnf,
    portableLr,
  );
  const generatedBytes = wasmGeneratedByteLength(
    analyzed,
    runtimePlan,
    portableBnf,
    portableLr,
    wasm,
    parserTraceWasm,
    options,
  );
  if (
    options.generatedByteLimit !== undefined &&
    generatedBytes > options.generatedByteLimit
  ) {
    diagnostics.push({
      code: "WASM_GENERATED_BYTE_LIMIT",
      severity: "error",
      backend: "wasm",
      message:
        `The Wasm target generated ${generatedBytes} bytes, exceeding the configured limit (${options.generatedByteLimit}).`,
    });
  }
  if (hasErrors(diagnostics)) return { diagnostics };
  if (options.reportParserStats) {
    diagnostics.push(
      parserStatsDiagnostic(analyzed, runtimePlan, generatedBytes),
    );
  }
  return {
    analyzed,
    bnf: portableBnf,
    lr: portableLr,
    dfa: portableDfa,
    portable: runtimePlan.portable,
    portableMetadata: runtimePlan.portableMetadata,
    wasm,
    parserTraceWasm,
    directory: options.directory ?? "wasm",
    preserveTrivia: options.preserveTrivia ?? true,
    generatedBytes,
    diagnostics,
  };
}

export function emitWasmTarget(
  plan: WasmPlan,
  options: WasmTargetOptions = {},
): GeneratedFile[] {
  const dir = plan.directory;
  const files: GeneratedFile[] = [
    {
      path: `${dir}/syntax.ts`,
      content: emitSyntaxFromPortablePlan(plan.portable),
      kind: "source",
      encoding: "utf-8",
    },
    {
      path: `${dir}/wasm.ts`,
      content: emitWasmRuntime(
        plan.wasm,
        plan.parserTraceWasm,
        plan.portableMetadata,
        { packaging: options.packaging },
      ),
      kind: "source",
      encoding: "utf-8",
    },
    {
      path: `${dir}/abi.json`,
      content: wasmAbiDescriptorSource(plan),
      kind: "config",
      encoding: "utf-8",
    },
    {
      path: `${dir}/lexer.ts`,
      content: emitWasmLexerFromPortablePlan(
        plan.portable,
        plan.preserveTrivia,
      ),
      kind: "source",
      encoding: "utf-8",
    },
    {
      path: `${dir}/parser.ts`,
      content: emitWasmParser(plan.portable),
      kind: "source",
      encoding: "utf-8",
    },
    {
      path: `${dir}/mod.ts`,
      content: wasmModSource(options.packaging),
      kind: "source",
      encoding: "utf-8",
    },
  ];
  if ((options.packaging ?? "embedded-typescript") === "external-binary") {
    files.push(
      {
        path: `${dir}/parser.wasm`,
        content: plan.wasm.bytes,
        kind: "binary",
        encoding: "binary",
      },
      {
        path: `${dir}/manifest.json`,
        content: wasmRuntimeManifestSource(plan),
        kind: "config",
        encoding: "utf-8",
      },
    );
  }
  return files;
}

function wasmAbiDescriptorSource(plan: WasmPlan): string {
  return `${JSON.stringify(wasmAbiDescriptor(plan), null, 2)}\n`;
}

function wasmRuntimeManifestSource(plan: WasmPlan): string {
  return `${
    JSON.stringify(
      {
        format: "baba-wasm-runtime",
        version: 1,
        abiVersion: WASM_ABI_VERSION,
        parserPlanVersion: plan.portableMetadata.version,
        parserPlanSemantics: plan.portableMetadata.semantics,
        parserPlanHash: plan.portableMetadata.hash,
        runtimeImplementation: {
          format: RUNTIME_IMPLEMENTATION_METADATA.format,
          version: RUNTIME_IMPLEMENTATION_METADATA.version,
          semantics: RUNTIME_IMPLEMENTATION_METADATA.semantics,
          hash: RUNTIME_IMPLEMENTATION_METADATA.hash,
        },
        module: "parser.wasm",
      },
      null,
      2,
    )
  }\n`;
}

function wasmAbiDescriptor(plan: WasmPlan): unknown {
  return {
    format: "baba-wasm-abi",
    version: 1,
    targetKind: WASM_TARGET_KIND,
    parserPlan: {
      format: plan.portableMetadata.format,
      version: plan.portableMetadata.version,
      semantics: plan.portableMetadata.semantics,
      hash: plan.portableMetadata.hash,
    },
    runtimeImplementation: {
      format: RUNTIME_IMPLEMENTATION_METADATA.format,
      version: RUNTIME_IMPLEMENTATION_METADATA.version,
      semantics: RUNTIME_IMPLEMENTATION_METADATA.semantics,
      hash: RUNTIME_IMPLEMENTATION_METADATA.hash,
    },
    core: {
      abiVersion: WASM_ABI_VERSION,
      memory: {
        export: "memory",
        pageBytes: WASM_PAGE_BYTES,
        maxPages: WASM_MAX_PAGES,
        inputBase: plan.wasm.inputBase,
      },
      sourceEncoding: {
        kind: "utf16",
        value: WASM_SOURCE_ENCODING_UTF16,
        unitBytes: WASM_UTF16_UNIT_BYTES,
      },
      spanUnit: {
        kind: "utf16-code-units",
        value: WASM_SPAN_UNIT_UTF16,
      },
      ownership: {
        kind: "caller-managed-linear-memory",
        value: WASM_HOST_OWNERSHIP_CALLER_MANAGED,
      },
      resultLifetime: {
        kind: "caller-owned-result-buffer",
        value: WASM_RESULT_LIFETIME_CALLER_BUFFER,
      },
      layouts: {
        lexResult: {
          i32Count: WASM_LEX_RESULT_I32_COUNT,
          bytes: WASM_LEX_RESULT_I32_COUNT * WASM_I32_BYTES,
          fields: ["specIndex", "end"],
        },
        tokenRecord: {
          i32Count: WASM_TOKEN_RECORD_I32_COUNT,
          bytes: WASM_TOKEN_RECORD_I32_COUNT * WASM_I32_BYTES,
          fields: ["specIndex", "start", "end"],
        },
      },
      exports: [
        {
          name: "memory",
          kind: "memory",
        },
        {
          name: "lex_one",
          params: ["sourcePtr", "sourceLength", "offset", "resultPtr"],
          result: "matchedFlag",
        },
        {
          name: "parser_action",
          params: ["state", "terminal"],
          result: "encodedAction",
        },
        {
          name: "parser_goto",
          params: ["state", "nonterminal"],
          result: "stateOrMinusOne",
        },
        {
          name: "lex_all",
          params: ["sourcePtr", "sourceLength", "resultPtr", "tokenPtr"],
          result: "tokenRecordCount",
        },
        {
          name: "abi_version",
          params: [],
          result: "i32",
        },
        {
          name: "plan_version",
          params: [],
          result: "i32",
        },
        {
          name: "reset",
          params: [],
          result: "void",
        },
        {
          name: "input_base",
          params: [],
          result: "i32",
        },
        {
          name: "max_pages",
          params: [],
          result: "i32",
        },
        {
          name: "source_encoding",
          params: [],
          result: "i32",
        },
        {
          name: "span_unit",
          params: [],
          result: "i32",
        },
        {
          name: "lex_result_i32_count",
          params: [],
          result: "i32",
        },
        {
          name: "token_record_i32_count",
          params: [],
          result: "i32",
        },
        {
          name: "host_ownership_model",
          params: [],
          result: "i32",
        },
        {
          name: "result_lifetime_model",
          params: [],
          result: "i32",
        },
      ],
    },
    adapter: {
      language: "typescript",
      handleCapability: {
        kind: "javascript-epoch-checked-object",
        value: WASM_ADAPTER_HANDLE_CAPABILITY_EPOCH,
      },
      sourceBuffer: {
        type: "WasmSourceBuffer",
        staleAfter: ["reset", "writeSource(different source)"],
      },
      parseTraceInput: {
        type: "ParseTraceInput",
        staleAfter: ["reset"],
      },
    },
    traceStatuses: {
      ok: RUNTIME_TRACE_STATUS_OK,
      unexpected: RUNTIME_TRACE_STATUS_UNEXPECTED,
      internal: RUNTIME_TRACE_STATUS_INTERNAL,
      branchLimit: RUNTIME_TRACE_STATUS_BRANCH_LIMIT,
      traceLimit: RUNTIME_TRACE_STATUS_TRACE_LIMIT,
      ambiguous: RUNTIME_TRACE_STATUS_AMBIGUOUS,
    },
    parserDiagnosticCodes: PARSER_DIAGNOSTIC_CODES,
    parserDiagnostics: {
      detailKinds: PARSER_DIAGNOSTIC_DETAIL_KINDS,
      schemas: PARSER_DIAGNOSTIC_SCHEMAS,
    },
  };
}

function emitParserTraceWasm(bnf: BnfGrammar, lr: LrTable): Uint8Array {
  const actionRows = parserRuntimeActionRows(bnfActionTableRows(lr.actions));
  const gotoRows = bnfTableRows(lr.gotos, (nonterminal, target) => [
    nonterminal,
    target,
  ]);
  const productions = bnf.productions.map((production) =>
    [production.lhs, production.rhs.length] as const
  );
  const program = hasMultiActionEntries(lr.actions)
    ? createParserConflictTraceRuntimeProgram({
      actionRows,
      gotoRows,
      productions,
    })
    : createParserTraceRuntimeProgram({
      actionRows,
      gotoRows,
      productions,
    });
  return compileRuntimeLanguageWasm(program, {
    exports: [
      "parserTraceSetTerminal",
      "parserTrace",
      "parserTraceErrorState",
      "parserTraceErrorIndex",
      "parserTraceCount",
      "parserTraceAction",
      "parserTraceStatusKind",
    ],
  });
}

type EncodedAction =
  | readonly [terminal: number, kind: 1, state: number]
  | readonly [terminal: number, kind: 2, production: number]
  | readonly [terminal: number, kind: 3];

type RuntimeLookupEntry = readonly [key: number, value: number];

function bnfActionTableRows(
  table: ReadonlyMap<number, ReadonlyMap<number, LrActionSet>>,
): EncodedAction[][] {
  const maxState = Math.max(-1, ...table.keys());
  const rows: EncodedAction[][] = [];
  for (let state = 0; state <= maxState; state++) {
    const entries = [...(table.get(state)?.entries() ?? [])]
      .sort(([left], [right]) => left - right)
      .flatMap(([terminal, actions]) =>
        actions.map((action) => actionEntry(terminal, action))
      );
    rows.push(entries);
  }
  return rows;
}

function actionEntry(terminal: number, action: LrAction): EncodedAction {
  if (action.kind === "shift") return [terminal, 1, action.state];
  if (action.kind === "reduce") return [terminal, 2, action.production];
  return [terminal, 3];
}

function parserRuntimeActionRows(
  rows: readonly (readonly EncodedAction[])[],
): readonly (readonly RuntimeLookupEntry[])[] {
  return rows.map((row) =>
    row.map((entry) => [entry[0], encodeParserRuntimeAction(entry)] as const)
  );
}

function encodeParserRuntimeAction(action: EncodedAction): number {
  if (action[1] === 1) {
    assertParserRuntimePayload(action[2]);
    return RUNTIME_ACTION_SHIFT + action[2];
  }
  if (action[1] === 2) {
    assertParserRuntimePayload(action[2]);
    return RUNTIME_ACTION_REDUCE + action[2];
  }
  return RUNTIME_ACTION_ACCEPT;
}

function assertParserRuntimePayload(payload: number): void {
  if (payload < 0 || payload > RUNTIME_ACTION_PAYLOAD_MASK) {
    throw new Error(
      `Parser runtime action payload ${payload} exceeds the encoded action limit.`,
    );
  }
}

function bnfTableRows<T>(
  table: ReadonlyMap<number, ReadonlyMap<number, T>>,
  encode: (key: number, value: T) => RuntimeLookupEntry,
): RuntimeLookupEntry[][] {
  const maxState = Math.max(-1, ...table.keys());
  const rows: RuntimeLookupEntry[][] = [];
  for (let state = 0; state <= maxState; state++) {
    const entries = [...(table.get(state)?.entries() ?? [])]
      .sort(([left], [right]) => left - right)
      .map(([key, value]) => encode(key, value));
    rows.push(entries);
  }
  return rows;
}

function hasMultiActionEntries(
  table: ReadonlyMap<number, ReadonlyMap<number, LrActionSet>>,
): boolean {
  for (const row of table.values()) {
    for (const actions of row.values()) {
      if (actions.length > 1) return true;
    }
  }
  return false;
}

function wasmModSource(
  packaging: WasmTargetOptions["packaging"] = "embedded-typescript",
): string {
  const wasmExports = packaging === "external-binary"
    ? "createParserFromBytes, createParserFromModule, createParserFromUrl, memory, parserPlanFormat, parserPlanHash, parserPlanSemantics, parserPlanVersion, reset, runtimeImplementationFormat, runtimeImplementationHash, runtimeImplementationSemantics, runtimeImplementationVersion, wasmAbiVersion, wasmAdapterHandleCapabilityModel, wasmHostOwnershipModel, wasmInputBase, wasmLexResultI32Count, wasmMaxPages, wasmResultLifetimeModel, wasmSourceEncoding, wasmSpanUnit, wasmTargetKind, wasmTokenRecordI32Count, wasmTraceStatusAmbiguous, wasmTraceStatusBranchLimit, wasmTraceStatusInternal, wasmTraceStatusOk, wasmTraceStatusTraceLimit, wasmTraceStatusUnexpected"
    : "memory, parserPlanFormat, parserPlanHash, parserPlanSemantics, parserPlanVersion, reset, runtimeImplementationFormat, runtimeImplementationHash, runtimeImplementationSemantics, runtimeImplementationVersion, wasmAbiVersion, wasmAdapterHandleCapabilityModel, wasmBytes, wasmHostOwnershipModel, wasmInputBase, wasmLexResultI32Count, wasmMaxPages, wasmResultLifetimeModel, wasmSourceEncoding, wasmSpanUnit, wasmTargetKind, wasmTokenRecordI32Count, wasmTraceStatusAmbiguous, wasmTraceStatusBranchLimit, wasmTraceStatusInternal, wasmTraceStatusOk, wasmTraceStatusTraceLimit, wasmTraceStatusUnexpected";
  return `// Generated by @mewhhaha/baba. Do not edit by hand.
export * from "./syntax.ts";
export { lex } from "./lexer.ts";
export { parse, parserDiagnosticCodeAmbiguousParse, parserDiagnosticCodeBranchLimit, parserDiagnosticCodeInternalError, parserDiagnosticCodeParseInvalidTokenStream, parserDiagnosticCodeParseLexicalError, parserDiagnosticCodeParseTrailingInput, parserDiagnosticCodeParseUnexpectedToken, parserDiagnosticCodeTraceLimit, parserDiagnosticDetailKindNone, parserDiagnosticDetailKindParserState, parseTokens, parseTokensUnchecked } from "./parser.ts";
export { ${wasmExports} } from "./wasm.ts";
`;
}

function runtimePlanningOptions(
  options: WasmTargetOptions,
): RuntimeParserPlanningOptions {
  return {
    lexerStateLimit: options.lexerStateLimit,
    regexSourceLengthLimit: options.regexSourceLengthLimit,
    regexNestingLimit: options.regexNestingLimit,
    regexAstNodeLimit: options.regexAstNodeLimit,
    regexBoundedRepeatLimit: options.regexBoundedRepeatLimit,
    regexNfaStateLimit: options.regexNfaStateLimit,
    regexDfaStateLimit: options.regexDfaStateLimit,
    regexOverlapStateLimit: options.regexOverlapStateLimit,
    regexOverlapPairLimit: options.regexOverlapPairLimit,
    parserStateLimit: options.parserStateLimit,
    parserItemLimit: options.parserItemLimit,
    parserTableEntryLimit: options.parserTableEntryLimit,
    diagnosticLimit: options.diagnosticLimit,
  };
}

export { runtimePlanningOptions as wasmRuntimePlanningOptions };

function wasmOptionsDiagnostics(options: WasmTargetOptions): Diagnostic[] {
  const directory = options.directory ?? "wasm";
  const diagnostics: Diagnostic[] = [];
  if (!isSafeRelativeDirectory(directory)) {
    diagnostics.push({
      code: "WASM_INVALID_OUTPUT_DIRECTORY",
      severity: "error",
      backend: "wasm",
      message:
        `Invalid Wasm output directory '${directory}'. Use a relative directory without '.', '..', empty components, absolute paths, drive prefixes, or backslashes.`,
    });
  }
  if (
    options.generatedByteLimit !== undefined &&
    (!Number.isInteger(options.generatedByteLimit) ||
      options.generatedByteLimit < 1)
  ) {
    diagnostics.push({
      code: "WASM_GENERATED_BYTE_LIMIT",
      severity: "error",
      backend: "wasm",
      message: "generatedByteLimit must be a positive integer.",
    });
  }
  if (
    options.packaging !== undefined &&
    options.packaging !== "embedded-typescript" &&
    options.packaging !== "external-binary"
  ) {
    diagnostics.push({
      code: "WASM_PACKAGING_MODE",
      severity: "error",
      backend: "wasm",
      message: "packaging must be external-binary or embedded-typescript.",
    });
  }
  return diagnostics;
}

function wasmGeneratedByteLength(
  _analyzed: AnalyzedGrammar,
  runtimePlan: RuntimeParserPlan,
  _bnf: BnfGrammar,
  _lr: LrTable,
  wasm: WasmModuleImage,
  parserTraceWasm: Uint8Array,
  options: WasmTargetOptions,
): number {
  return wasm.bytes.length + parserTraceWasm.length + byteLength([
    emitSyntaxFromPortablePlan(runtimePlan.portable),
    emitWasmRuntime(
      wasm,
      parserTraceWasm,
      runtimePlan.portableMetadata,
      { packaging: options.packaging },
    ),
    emitWasmLexerFromPortablePlan(
      runtimePlan.portable,
      options.preserveTrivia ?? true,
    ),
    emitWasmParser(runtimePlan.portable),
    wasmModSource(options.packaging),
  ].join(""));
}

function parserStatsDiagnostic(
  analyzed: AnalyzedGrammar,
  runtimePlan: RuntimeParserPlan,
  generatedBytes: number,
): Diagnostic {
  const stats = runtimePlan.lr.stats;
  const portableStats = runtimePlan.portable.statistics;
  return {
    code: "WASM_PARSER_STATS",
    severity: "information",
    backend: "wasm",
    message: [
      "Wasm parser planning statistics:",
      `rules: ${analyzed.reachableRules.size}`,
      `BNF productions: ${runtimePlan.bnf.productions.length}`,
      `lexer states: ${portableStats.lexerStates}`,
      `lexer accept candidates: ${portableStats.lexerAcceptCandidates}`,
      `lexer average accept candidates/state: ${
        (portableStats.lexerAverageAcceptCandidatesPerStateMilli / 1000)
          .toFixed(2)
      }`,
      `lexer max accept candidates/state: ${portableStats.lexerMaxAcceptCandidatesPerState}`,
      `lexer ambiguous accept states: ${portableStats.lexerAmbiguousAcceptStates}`,
      `LR states: ${stats.states}`,
      `LR core items: ${stats.coreItems}`,
      `LR items: ${stats.items}`,
      `ACTION entries: ${stats.actionEntries}`,
      `GOTO entries: ${stats.gotoEntries}`,
      `table entries: ${stats.tableEntries}`,
      `generated bytes: ${generatedBytes}`,
    ].join("\n"),
  };
}

function byteLength(source: string): number {
  return new TextEncoder().encode(source).length;
}

function isSafeRelativeDirectory(directory: string): boolean {
  if (
    directory.length === 0 ||
    directory.includes("\0") ||
    directory.includes("\\") ||
    directory.startsWith("/") ||
    /^[A-Za-z]:/.test(directory)
  ) {
    return false;
  }
  return directory.split("/").every((component) =>
    component !== "" && component !== "." && component !== ".."
  );
}

function isRuntimePlan(
  value: RuntimeParserPlan | { diagnostics: readonly Diagnostic[] },
): value is RuntimeParserPlan {
  return "bnf" in value;
}

function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) =>
    (diagnostic.severity ?? "error") === "error"
  );
}
