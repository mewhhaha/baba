import type {
  BabaMetadata,
  Diagnostic,
  GeneratedFile,
  WasmTargetOptions,
} from "../../ast.ts";
import type { AnalyzedGrammar } from "../../compiler/ir.ts";
import type { Dfa } from "../../compiler/regex/dfa.ts";
import type {
  BnfGrammar,
  ReducerSpec,
} from "../../compiler/runtime_plan/bnf.ts";
import type { LrTable } from "../../compiler/runtime_plan/lr1.ts";
import {
  collectRuleFieldSchemas,
  type RuleFieldSchema,
} from "../runtime/field_schema.ts";
import {
  PARSER_DIAGNOSTIC_CODES,
  PARSER_DIAGNOSTIC_DETAIL_KINDS,
  PARSER_DIAGNOSTIC_SCHEMAS,
} from "../runtime/diagnostic_codes.ts";
import { RUNTIME_IMPLEMENTATION_METADATA } from "../runtime/implementation.ts";
import type {
  PortableParserPlan,
  PortableParserPlanMetadata,
} from "../runtime/portable_plan.ts";
import {
  WASM_ABI_VERSION,
  WASM_ADAPTER_HANDLE_CAPABILITY_EPOCH,
  WASM_CURSOR_CHILD_RECORD_I32_COUNT,
  WASM_CURSOR_FIELD_RECORD_I32_COUNT,
  WASM_CURSOR_RULE_RECORD_I32_COUNT,
  WASM_CURSOR_VALUE_ITEM_RECORD_I32_COUNT,
  WASM_CURSOR_VALUE_RECORD_I32_COUNT,
  WASM_HOST_OWNERSHIP_CALLER_MANAGED,
  WASM_I32_BYTES,
  WASM_LEX_RESULT_I32_COUNT,
  WASM_MAX_PAGES,
  WASM_PAGE_BYTES,
  WASM_PARSE_CURSOR_RESULT_I32_COUNT,
  WASM_PARSE_STATUS_ACTION_LIMIT,
  WASM_PARSE_STATUS_AMBIGUOUS,
  WASM_PARSE_STATUS_CURSOR_CAPACITY,
  WASM_PARSE_STATUS_INTERNAL,
  WASM_PARSE_STATUS_MEMO_REQUIRED,
  WASM_PARSE_STATUS_OK,
  WASM_PARSE_STATUS_UNEXPECTED,
  WASM_RESULT_LIFETIME_CALLER_BUFFER,
  WASM_SOURCE_ENCODING_UTF16,
  WASM_SPAN_UNIT_UTF16,
  WASM_TARGET_KIND,
  WASM_TOKEN_RECORD_I32_COUNT,
  WASM_UTF16_UNIT_BYTES,
  WASM_VALIDATE_RESULT_I32_COUNT,
} from "../runtime/wasm_abi.ts";
import { emitSyntaxFromPortablePlan } from "../../compiler/runtime_plan/syntax_emit.ts";
import {
  planPortableRuntime,
  type RuntimeParserPlan,
  type RuntimeParserPlanningOptions,
} from "../runtime/plan.ts";
import { generatedSourceBanner } from "../runtime/provenance.ts";
import {
  emitWasmModule,
  type WasmModuleImage,
} from "../runtime/wasm_core_runtime.ts";
import {
  PARSER_PLAN_FORMAT,
  PARSER_PLAN_SEMANTICS,
  PARSER_PLAN_VERSION,
} from "../runtime/parser_plan_contract.ts";
import {
  encodeCombinedWasmParserPlan,
  parserPlanRuntimeMetadataVersion,
} from "../../runtime/wasm_plan.ts";
import {
  compileGpuFrontendPlan,
  type GpuFrontendPlan,
} from "../../compiler/gpu_frontend.ts";

export interface WasmRuntimeMetadata {
  readonly portablePlan: PortableParserPlanMetadata;
  readonly runtimeImplementation: typeof RUNTIME_IMPLEMENTATION_METADATA;
  readonly defaultPreserveTrivia: boolean;
  readonly conflictProfile: "deterministic" | "branching";
  readonly ruleNames: readonly string[];
  readonly namedTokens: readonly WasmRuntimeNamedToken[];
  readonly literalTokens: readonly WasmRuntimeLiteralToken[];
  readonly lexerSpecs: readonly WasmRuntimeLexerSpec[];
  readonly acceptCandidates: readonly (readonly number[])[];
  readonly terminals: readonly WasmRuntimeTerminal[];
  readonly fields: readonly RuleFieldSchema[];
  readonly gpuFrontend: GpuFrontendPlan | undefined;
}

export interface WasmRuntimeNamedToken {
  readonly id: number;
  readonly name: string;
  readonly trivia: boolean;
}

export interface WasmRuntimeLiteralToken {
  readonly id: number;
  readonly value: string;
}

export type WasmRuntimeLexerSpec =
  | { readonly type: "named"; readonly tokenId: number }
  | { readonly type: "literal"; readonly literalId: number };

export type WasmRuntimeTerminal =
  | { readonly id: number; readonly type: "eof"; readonly display: string }
  | {
    readonly id: number;
    readonly type: "named";
    readonly display: string;
    readonly tokenId: number;
  }
  | {
    readonly id: number;
    readonly type: "literal";
    readonly display: string;
    readonly literalId: number;
  };

export interface WasmPlan {
  analyzed: AnalyzedGrammar;
  bnf: BnfGrammar;
  lr: LrTable;
  dfa: Dfa;
  portable: PortableParserPlan;
  portableMetadata: PortableParserPlanMetadata;
  runtimeMetadata: WasmRuntimeMetadata;
  gpuFrontend: GpuFrontendPlan | undefined;
  wasm: WasmModuleImage;
  parserPlanBytes: Uint8Array;
  directory: string;
  preserveTrivia: boolean;
  generatedBytes: number;
  diagnostics: readonly Diagnostic[];
}

export function planWasmTarget(
  analyzed: AnalyzedGrammar,
  options: WasmTargetOptions = {},
  metadata: BabaMetadata = {},
  runtimePlanInput?: RuntimeParserPlan | { diagnostics: readonly Diagnostic[] },
): WasmPlan | { diagnostics: readonly Diagnostic[] } {
  const diagnostics = [...wasmOptionsDiagnostics(options)];
  const runtimePlan = runtimePlanInput ??
    planPortableRuntime(
      analyzed,
      runtimePlanningOptions(options),
      metadata,
    );
  if (!runtimePlanInput) diagnostics.push(...runtimePlan.diagnostics);
  if (hasErrors(diagnostics) || !isRuntimePlan(runtimePlan)) {
    return { diagnostics };
  }
  const portableBnf = runtimePlan.bnf;
  const portableLr = runtimePlan.lr;
  const portableDfa = runtimePlan.dfa;
  let preserveTrivia = true;
  if (options.preserveTrivia !== undefined) {
    preserveTrivia = options.preserveTrivia;
  }
  let gpuFrontend: GpuFrontendPlan | undefined;
  if (metadata.gpuFrontend !== undefined) {
    const compiledGpuFrontend = compileGpuFrontendPlan(
      analyzed,
      runtimePlan.portable,
      metadata.gpuFrontend,
    );
    if ("diagnostics" in compiledGpuFrontend) {
      diagnostics.push(...compiledGpuFrontend.diagnostics);
    } else {
      gpuFrontend = compiledGpuFrontend;
    }
  }
  if (hasErrors(diagnostics)) {
    return { diagnostics };
  }
  const runtimeMetadata = createWasmRuntimeMetadata(
    analyzed,
    runtimePlan,
    preserveTrivia,
    gpuFrontend,
  );
  const wasm = emitWasmModule(
    portableDfa,
    portableLr,
    wasmCoreRuntimeMetadata(analyzed, runtimePlan),
  );
  const parserPlanBytes = encodeCombinedWasmParserPlan(
    wasm.planBytes,
    compactWasmRuntimeMetadata(runtimeMetadata),
  );
  const generatedBytes = wasmGeneratedByteLengths(
    analyzed,
    runtimePlan,
    portableBnf,
    portableLr,
    wasm,
    parserPlanBytes,
    options,
  );
  if (
    options.generatedByteLimit !== undefined &&
    generatedBytes.total > options.generatedByteLimit
  ) {
    diagnostics.push({
      code: "WASM_GENERATED_BYTE_LIMIT",
      severity: "error",
      backend: "wasm",
      message:
        `The Wasm target generated ${generatedBytes.total} bytes, exceeding the configured limit (${options.generatedByteLimit}).`,
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
    runtimeMetadata,
    gpuFrontend,
    wasm,
    parserPlanBytes,
    directory: options.directory ?? "wasm",
    preserveTrivia: options.preserveTrivia ?? true,
    generatedBytes: generatedBytes.total,
    diagnostics,
  };
}

export function emitWasmTarget(
  plan: WasmPlan,
  options: WasmTargetOptions = {},
): GeneratedFile[] {
  const dir = plan.directory;
  void options;
  const files: GeneratedFile[] = [
    {
      path: `${dir}/abi.json`,
      content: wasmAbiDescriptorSource(),
      kind: "config",
      encoding: "utf-8",
    },
    {
      path: `${dir}/manifest.json`,
      content: wasmRuntimeManifestSource(),
      kind: "config",
      encoding: "utf-8",
    },
    {
      path: `${dir}/mod.ts`,
      content: wasmModSource(),
      kind: "source",
      encoding: "utf-8",
    },
    {
      path: `${dir}/parser.wasm`,
      content: plan.wasm.bytes,
      kind: "binary",
      encoding: "binary",
    },
    {
      path: `${dir}/parser.plan`,
      content: plan.parserPlanBytes,
      kind: "binary",
      encoding: "binary",
    },
    {
      path: `${dir}/syntax.ts`,
      content: emitSyntaxFromPortablePlan(plan.portable),
      kind: "source",
      encoding: "utf-8",
    },
  ];
  return files;
}

function wasmAbiDescriptorSource(): string {
  return `${JSON.stringify(wasmAbiDescriptor(), null, 2)}\n`;
}

function wasmRuntimeManifestSource(): string {
  return `${
    JSON.stringify(
      {
        format: "baba-wasm-runtime",
        version: 1,
        abiVersion: WASM_ABI_VERSION,
        parserPlan: {
          format: PARSER_PLAN_FORMAT,
          version: PARSER_PLAN_VERSION,
          runtimeMetadataVersion: parserPlanRuntimeMetadataVersion,
          semantics: PARSER_PLAN_SEMANTICS,
          storage: "external-binary",
          moduleExport: "load_plan",
          path: "parser.plan",
        },
        runtimeImplementation: {
          format: RUNTIME_IMPLEMENTATION_METADATA.format,
          version: RUNTIME_IMPLEMENTATION_METADATA.version,
          semantics: RUNTIME_IMPLEMENTATION_METADATA.semantics,
          hash: RUNTIME_IMPLEMENTATION_METADATA.hash,
        },
        module: "parser.wasm",
        plan: "parser.plan",
      },
      null,
      2,
    )
  }\n`;
}

function wasmAbiDescriptor(): unknown {
  return {
    format: "baba-wasm-abi",
    version: 1,
    targetKind: WASM_TARGET_KIND,
    parserPlan: {
      format: PARSER_PLAN_FORMAT,
      version: PARSER_PLAN_VERSION,
      runtimeMetadataVersion: parserPlanRuntimeMetadataVersion,
      semantics: PARSER_PLAN_SEMANTICS,
      storage: "external-binary",
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
        inputBase: "dynamic-after-load-plan",
      },
      plan: {
        storage: "external-binary",
        moduleExport: "load_plan",
        path: "parser.plan",
        layout: "core-tables-plus-runtime-metadata",
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
          fields: ["specIndex", "start", "end", "acceptingState"],
        },
        parserSelection: {
          i32Count: 4,
          bytes: 4 * WASM_I32_BYTES,
          fields: [
            "checkedCandidateCount",
            "selectedSpecIndex",
            "selectedTerminal",
            "encodedAction",
          ],
        },
        validateResult: {
          i32Count: WASM_VALIDATE_RESULT_I32_COUNT,
          bytes: WASM_VALIDATE_RESULT_I32_COUNT * WASM_I32_BYTES,
          fields: [
            "parserActionCount",
            "errorState",
            "errorSpecIndex",
            "errorStart",
            "errorEnd",
          ],
        },
        parseCursorResult: {
          i32Count: WASM_PARSE_CURSOR_RESULT_I32_COUNT,
          bytes: WASM_PARSE_CURSOR_RESULT_I32_COUNT * WASM_I32_BYTES,
          fields: [
            "tokenRecordCount",
            "ruleRecordCount",
            "childRefCount",
            "fieldRecordCount",
            "valueRecordCount",
            "valueItemCount",
            "rootRef",
            "errorOffset",
            "errorState",
            "tokenReadCount",
          ],
        },
        cursorRuleRecord: {
          i32Count: WASM_CURSOR_RULE_RECORD_I32_COUNT,
          bytes: WASM_CURSOR_RULE_RECORD_I32_COUNT * WASM_I32_BYTES,
          fields: [
            "ruleId",
            "start",
            "end",
            "tokenStart",
            "tokenEnd",
            "childHead",
            "childCount",
            "fieldStart",
            "fieldCount",
          ],
        },
        cursorFieldRecord: {
          i32Count: WASM_CURSOR_FIELD_RECORD_I32_COUNT,
          bytes: WASM_CURSOR_FIELD_RECORD_I32_COUNT * WASM_I32_BYTES,
          fields: ["fieldId", "valueId"],
        },
        cursorValueRecord: {
          i32Count: WASM_CURSOR_VALUE_RECORD_I32_COUNT,
          bytes: WASM_CURSOR_VALUE_RECORD_I32_COUNT * WASM_I32_BYTES,
          fields: ["kind", "numberOrItemTail", "itemHead", "itemCount"],
        },
        cursorChildRecord: {
          i32Count: WASM_CURSOR_CHILD_RECORD_I32_COUNT,
          bytes: WASM_CURSOR_CHILD_RECORD_I32_COUNT * WASM_I32_BYTES,
          fields: ["reference", "nextNode"],
        },
        cursorValueItemRecord: {
          i32Count: WASM_CURSOR_VALUE_ITEM_RECORD_I32_COUNT,
          bytes: WASM_CURSOR_VALUE_ITEM_RECORD_I32_COUNT * WASM_I32_BYTES,
          fields: ["valueId", "nextNode"],
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
          name: "parser_actions",
          params: ["state", "terminal", "actionPtr", "actionCapacity"],
          result: "actionCountOrMinusOne",
        },
        {
          name: "parser_select_action",
          params: [
            "state",
            "acceptingState",
            "fallbackSpecIndex",
            "selectionPtr",
          ],
          result:
            "selectionStatusOneSelectedZeroUnexpectedTwoMultipleChoicesMinusOneInvalid",
        },
        {
          name: "validate",
          params: [
            "sourcePtr",
            "sourceLength",
            "resultPtr",
            "stackPtr",
            "stackCapacity",
            "memoPtr",
            "memoCapacity",
            "maxParserActions",
          ],
          result:
            "parseStatusZeroOkOneUnexpectedTwoInternalFourActionLimitFiveAmbiguousSixMemoRequired",
        },
        {
          name: "parse_cursor",
          params: [
            "sourcePtr",
            "sourceLength",
            "tokenPtr",
            "tokenCapacity",
            "rulePtr",
            "ruleCapacity",
            "childPtr",
            "childCapacity",
            "fieldPtr",
            "fieldCapacity",
            "valuePtr",
            "valueCapacity",
            "valueItemPtr",
            "valueItemCapacity",
            "resultPtr",
            "stateStackPtr",
            "fragmentStackPtr",
            "fragmentCapacity",
            "memoPtr",
            "memoCapacity",
            "preserveTrivia",
            "maxParserActions",
          ],
          result:
            "cursorStatusZeroOkOneUnexpectedTwoInternalThreeCapacityFourTraceLimitFiveAmbiguous",
        },
        {
          name: "parse_cursor_records",
          params: [
            "sourcePtr",
            "sourceLength",
            "tokenPtr",
            "rawTokenCount",
            "tokenCapacity",
            "rulePtr",
            "ruleCapacity",
            "childPtr",
            "childCapacity",
            "fieldPtr",
            "fieldCapacity",
            "valuePtr",
            "valueCapacity",
            "valueItemPtr",
            "valueItemCapacity",
            "resultPtr",
            "stateStackPtr",
            "fragmentStackPtr",
            "fragmentCapacity",
            "preserveTrivia",
            "maxParserActions",
          ],
          result:
            "cursorStatusZeroOkOneUnexpectedTwoInternalThreeCapacityFourTraceLimitFiveAmbiguous",
        },
        {
          name: "parser_goto",
          params: ["state", "nonterminal"],
          result: "stateOrMinusOne",
        },
        {
          name: "lex_all",
          params: [
            "sourcePtr",
            "sourceLength",
            "mode",
            "tokenPtr",
            "tokenCapacity",
            "memoPtr",
            "memoCapacity",
          ],
          result: "tokenRecordCountOrMinusOneTokenCapacityMinusTwoMemoRequired",
        },
        {
          name: "lex_memo_i32_per_position",
          params: [],
          result: "memoI32CountPerSourcePosition",
        },
        {
          name: "load_plan",
          params: ["planPtr", "planLength"],
          result: "loadedFlag",
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
          name: "semantics_version",
          params: [],
          result: "i32",
        },
        {
          name: "reset",
          params: [],
          result: "void",
        },
        {
          name: "plan_buffer_base",
          params: [],
          result: "i32",
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
          name: "validate_result_i32_count",
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
    },
    parseStatuses: {
      ok: WASM_PARSE_STATUS_OK,
      unexpected: WASM_PARSE_STATUS_UNEXPECTED,
      internal: WASM_PARSE_STATUS_INTERNAL,
      cursorCapacity: WASM_PARSE_STATUS_CURSOR_CAPACITY,
      actionLimit: WASM_PARSE_STATUS_ACTION_LIMIT,
      ambiguous: WASM_PARSE_STATUS_AMBIGUOUS,
      memoRequired: WASM_PARSE_STATUS_MEMO_REQUIRED,
    },
    parserDiagnosticCodes: {
      parseLexicalError: PARSER_DIAGNOSTIC_CODES.parseLexicalError,
      parseUnexpectedToken: PARSER_DIAGNOSTIC_CODES.parseUnexpectedToken,
      parseTrailingInput: PARSER_DIAGNOSTIC_CODES.parseTrailingInput,
      internalError: PARSER_DIAGNOSTIC_CODES.internalError,
      traceLimit: PARSER_DIAGNOSTIC_CODES.traceLimit,
      ambiguousParse: PARSER_DIAGNOSTIC_CODES.ambiguousParse,
      inputTooLarge: PARSER_DIAGNOSTIC_CODES.inputTooLarge,
    },
    parserDiagnostics: {
      detailKinds: PARSER_DIAGNOSTIC_DETAIL_KINDS,
      schemas: PARSER_DIAGNOSTIC_SCHEMAS.filter((schema) => {
        return schema.name !== "parseInvalidTokenStream" &&
          schema.name !== "branchLimit";
      }),
    },
  };
}

function wasmModSource(): string {
  return `${
    generatedSourceBanner({
      parserPlanVersion: PARSER_PLAN_VERSION,
      parserPlanSemantics: PARSER_PLAN_SEMANTICS,
    })
  }
import type { CursorParseResult, LexOptions, LexTapeResult, ParseOptions, RootCursor, ValidateParseResult } from "./syntax.ts";
import {
  createParser as createSharedParser,
  createParserAsync as createSharedParserAsync,
} from "@mewhhaha/baba/runtime/generated-wasm";
import type {
  AsyncParserInstanceOptions as SharedAsyncParserInstanceOptions,
  ParserInstanceOptions as SharedParserInstanceOptions,
} from "@mewhhaha/baba/runtime/generated-wasm";

export * from "./syntax.ts";
export {
  parserDiagnosticCodeAmbiguousParse,
  parserDiagnosticCodeInternalError,
  parserDiagnosticCodeParseLexicalError,
  parserDiagnosticCodeParseTrailingInput,
  parserDiagnosticCodeParseUnexpectedToken,
  parserDiagnosticCodeTraceLimit,
  parserDiagnosticDetailKindNone,
  parserDiagnosticDetailKindParserState,
  parserPlanFormat,
  parserPlanRuntimeMetadataVersion,
  parserPlanSemantics,
  parserPlanVersion,
  runtimeImplementationFormat,
  runtimeImplementationHash,
  runtimeImplementationSemantics,
  runtimeImplementationVersion,
  wasmAbiVersion,
  wasmHostOwnershipModel,
  wasmLexResultI32Count,
  wasmMaxPages,
  wasmResultLifetimeModel,
  wasmSemanticsVersion,
  wasmSourceEncoding,
  wasmSpanUnit,
  wasmTargetKind,
  wasmTokenRecordI32Count,
} from "@mewhhaha/baba/runtime/generated-wasm";

export type ParserInstanceOptions = SharedParserInstanceOptions;
export type AsyncParserInstanceOptions = SharedAsyncParserInstanceOptions;

export interface ParserInstance {
  lex(source: string, options?: LexOptions): LexTapeResult;
  parse(source: string, options?: ParseOptions): CursorParseResult<RootCursor>;
  parseRecords(
    source: string,
    records: Int32Array,
    options?: ParseOptions,
  ): CursorParseResult<RootCursor>;
  validate(source: string, options?: ParseOptions): ValidateParseResult;
  reset(): void;
  dispose(): void;
}

export function createParser(options: ParserInstanceOptions): ParserInstance {
  return createSharedParser(options) as unknown as ParserInstance;
}

export async function createParserAsync(
  options: AsyncParserInstanceOptions,
): Promise<ParserInstance> {
  return await createSharedParserAsync(options) as unknown as ParserInstance;
}
`;
}

function createWasmRuntimeMetadata(
  analyzed: AnalyzedGrammar,
  runtime: RuntimeParserPlan,
  preserveTrivia: boolean,
  gpuFrontend: GpuFrontendPlan | undefined,
): WasmRuntimeMetadata {
  const namedTokens: WasmRuntimeNamedToken[] = [];
  const lexerSpecs: WasmRuntimeLexerSpec[] = [];
  for (const token of analyzed.tokens) {
    if (
      token.kind !== "skip" && !analyzed.reachableTokens.has(token.id)
    ) {
      continue;
    }
    namedTokens.push({
      id: token.id,
      name: token.name,
      trivia: token.kind === "skip",
    });
    lexerSpecs.push({ type: "named", tokenId: token.id });
  }
  const literalTokens: WasmRuntimeLiteralToken[] = [];
  for (const literal of analyzed.literals) {
    if (!analyzed.reachableLiterals.has(literal.id)) {
      continue;
    }
    literalTokens.push({ id: literal.id, value: literal.value });
    lexerSpecs.push({ type: "literal", literalId: literal.id });
  }
  const terminals: WasmRuntimeTerminal[] = [];
  for (const terminal of runtime.bnf.terminals) {
    if (terminal.kind === "eof") {
      terminals.push({
        id: terminal.id,
        type: "eof",
        display: terminal.display,
      });
      continue;
    }
    if (terminal.kind === "named") {
      if (terminal.tokenId === undefined) {
        throw new Error(
          `Wasm terminal ${terminal.id} is missing its named token id.`,
        );
      }
      terminals.push({
        id: terminal.id,
        type: "named",
        display: terminal.display,
        tokenId: terminal.tokenId,
      });
      continue;
    }
    if (terminal.literalId === undefined) {
      throw new Error(
        `Wasm terminal ${terminal.id} is missing its literal id.`,
      );
    }
    terminals.push({
      id: terminal.id,
      type: "literal",
      display: terminal.display,
      literalId: terminal.literalId,
    });
  }
  let conflictProfile: WasmRuntimeMetadata["conflictProfile"] = "deterministic";
  for (const row of runtime.lr.actions.values()) {
    for (const actions of row.values()) {
      if (actions.length > 1) {
        conflictProfile = "branching";
      }
    }
  }
  const acceptCandidates = runtime.portable.lexer.states.map((state) => {
    return [...state.accepts].sort((left, right) => {
      const leftSpec = runtime.portable.lexer.specifications[left];
      const rightSpec = runtime.portable.lexer.specifications[right];
      if (leftSpec === undefined || rightSpec === undefined) {
        return left - right;
      }
      let literalOrder = 0;
      let contextualOrder = 0;
      if (leftSpec.contextual !== rightSpec.contextual) {
        if (leftSpec.contextual) {
          contextualOrder = 1;
        } else {
          contextualOrder = -1;
        }
      }
      if (leftSpec.literal !== rightSpec.literal) {
        if (leftSpec.literal) {
          literalOrder = -1;
        } else {
          literalOrder = 1;
        }
      }
      return contextualOrder ||
        rightSpec.priority - leftSpec.priority ||
        literalOrder ||
        leftSpec.order - rightSpec.order ||
        left - right;
    });
  });
  return {
    portablePlan: runtime.portableMetadata,
    runtimeImplementation: RUNTIME_IMPLEMENTATION_METADATA,
    defaultPreserveTrivia: preserveTrivia,
    conflictProfile,
    ruleNames: analyzed.rules.map((rule) => rule.name),
    namedTokens,
    literalTokens,
    lexerSpecs,
    acceptCandidates,
    terminals,
    fields: collectRuleFieldSchemas(analyzed),
    gpuFrontend,
  };
}

function compactWasmRuntimeMetadata(
  metadata: WasmRuntimeMetadata,
): unknown {
  let conflictProfile = 0;
  if (metadata.conflictProfile === "branching") {
    conflictProfile = 1;
  }
  const fieldIds = new Map<string, number>();
  for (const schema of metadata.fields) {
    for (const field of schema.fields) {
      if (!fieldIds.has(field.name)) {
        fieldIds.set(field.name, fieldIds.size);
      }
    }
  }
  return {
    m: [
      parserPlanRuntimeMetadataVersion,
      metadata.portablePlan.format,
      metadata.portablePlan.version,
      metadata.portablePlan.semantics,
      metadata.portablePlan.hash,
      metadata.runtimeImplementation.format,
      metadata.runtimeImplementation.version,
      metadata.runtimeImplementation.semantics,
      metadata.runtimeImplementation.hash,
    ],
    p: [
      metadata.defaultPreserveTrivia,
      conflictProfile,
    ],
    r: metadata.ruleNames,
    n: metadata.namedTokens.map((token) => [
      token.id,
      token.name,
      token.trivia,
    ]),
    i: metadata.literalTokens.map((literal) => [
      literal.id,
      literal.value,
    ]),
    l: [
      metadata.lexerSpecs.map((spec) => {
        if (spec.type === "named") {
          return [0, spec.tokenId];
        }
        return [1, spec.literalId];
      }),
      metadata.acceptCandidates,
    ],
    d: metadata.terminals.map((terminal) => {
      if (terminal.type === "eof") {
        return [terminal.id, 0, terminal.display, -1];
      }
      if (terminal.type === "named") {
        return [terminal.id, 1, terminal.display, terminal.tokenId];
      }
      return [terminal.id, 2, terminal.display, terminal.literalId];
    }),
    f: [
      [...fieldIds.keys()],
      metadata.fields.map((schema) => [
        schema.ruleId,
        schema.fields.map((field) => {
          const fieldId = fieldIds.get(field.name);
          if (fieldId === undefined) {
            throw new Error(
              `Wasm field '${field.name}' is missing its runtime field id.`,
            );
          }
          return [
            fieldId,
            field.array,
            field.nullable,
            field.type.startsWith("ReadonlyArray<"),
          ];
        }),
      ]),
    ],
    g: metadata.gpuFrontend,
  };
}

function wasmCoreRuntimeMetadata(
  analyzed: AnalyzedGrammar,
  runtime: RuntimeParserPlan,
): {
  readonly eofTerminal: number;
  readonly terminalBySpec: readonly number[];
  readonly acceptCandidates: readonly (readonly number[])[];
  readonly specs: readonly {
    readonly contextual: boolean;
    readonly followedBy: Dfa | undefined;
    readonly followedByEof: boolean;
    readonly notFollowedBy: Dfa | undefined;
    readonly excludedWords: readonly string[];
  }[];
  readonly productions: readonly {
    readonly lhs: number;
    readonly rhsLength: number;
    readonly reducerKind: number;
    readonly reducerArg: number;
  }[];
} {
  const fieldIds = new Map<string, number>();
  for (const schema of collectRuleFieldSchemas(analyzed)) {
    for (const field of schema.fields) {
      if (!fieldIds.has(field.name)) {
        fieldIds.set(field.name, fieldIds.size);
      }
    }
  }
  const terminalByNamedTokenId = new Map<number, number>();
  const terminalByLiteralId = new Map<number, number>();
  for (const terminal of runtime.bnf.terminals) {
    if (terminal.kind === "named") {
      if (terminal.tokenId === undefined) {
        throw new Error(
          `Wasm terminal ${terminal.id} is missing its named token id.`,
        );
      }
      terminalByNamedTokenId.set(terminal.tokenId, terminal.id);
    }
    if (terminal.kind === "literal") {
      if (terminal.literalId === undefined) {
        throw new Error(
          `Wasm terminal ${terminal.id} is missing its literal id.`,
        );
      }
      terminalByLiteralId.set(terminal.literalId, terminal.id);
    }
  }
  const terminalBySpec: number[] = [];
  for (const token of analyzed.tokens) {
    if (
      token.kind !== "skip" && !analyzed.reachableTokens.has(token.id)
    ) {
      continue;
    }
    if (token.kind === "skip") {
      terminalBySpec.push(-1);
      continue;
    }
    const terminal = terminalByNamedTokenId.get(token.id);
    if (terminal === undefined) {
      throw new Error(
        `Wasm named token ${token.id} has no parser terminal.`,
      );
    }
    terminalBySpec.push(terminal);
  }
  for (const literal of analyzed.literals) {
    if (!analyzed.reachableLiterals.has(literal.id)) {
      continue;
    }
    const terminal = terminalByLiteralId.get(literal.id);
    if (terminal === undefined) {
      throw new Error(
        `Wasm literal ${literal.id} has no parser terminal.`,
      );
    }
    terminalBySpec.push(terminal);
  }
  const acceptCandidates = runtime.portable.lexer.states.map((state) => {
    return [...state.accepts].sort((left, right) => {
      const leftSpec = runtime.portable.lexer.specifications[left];
      const rightSpec = runtime.portable.lexer.specifications[right];
      if (leftSpec === undefined || rightSpec === undefined) {
        return left - right;
      }
      let literalOrder = 0;
      let contextualOrder = 0;
      if (leftSpec.contextual !== rightSpec.contextual) {
        if (leftSpec.contextual) {
          contextualOrder = 1;
        } else {
          contextualOrder = -1;
        }
      }
      if (leftSpec.literal !== rightSpec.literal) {
        if (leftSpec.literal) {
          literalOrder = -1;
        } else {
          literalOrder = 1;
        }
      }
      return contextualOrder ||
        rightSpec.priority - leftSpec.priority ||
        literalOrder ||
        leftSpec.order - rightSpec.order ||
        left - right;
    });
  });
  const productions = runtime.bnf.productions.map((production, index) => {
    if (production.id !== index) {
      throw new Error(
        `Wasm BNF production ${production.id} is not dense at index ${index}.`,
      );
    }
    let reducerKind: number;
    let reducerArg = -1;
    const reducer: ReducerSpec = production.reducer;
    switch (reducer.kind) {
      case "start":
        reducerKind = 0;
        break;
      case "rule":
        reducerKind = 1;
        reducerArg = reducer.ruleId;
        break;
      case "terminal":
        reducerKind = 2;
        break;
      case "ruleRef":
        reducerKind = 3;
        break;
      case "identity":
        reducerKind = 4;
        break;
      case "sequence":
        reducerKind = 5;
        break;
      case "optionalEmpty":
        reducerKind = 6;
        break;
      case "optionalSome":
        reducerKind = 7;
        break;
      case "repeatEmpty":
        reducerKind = 8;
        break;
      case "repeatAppend":
        reducerKind = 9;
        break;
      case "repeat1First":
        reducerKind = 10;
        break;
      case "repeat1Append":
        reducerKind = 11;
        break;
      case "separatedFirst":
        reducerKind = 12;
        break;
      case "separatedAppend":
        reducerKind = 13;
        break;
      case "field": {
        reducerKind = 14;
        const fieldId = fieldIds.get(reducer.name);
        if (fieldId === undefined) {
          throw new Error(
            `Wasm field reducer '${reducer.name}' has no runtime field id.`,
          );
        }
        reducerArg = fieldId;
        break;
      }
    }
    return {
      lhs: production.lhs,
      rhsLength: production.rhs.length,
      reducerKind,
      reducerArg,
    };
  });
  return {
    eofTerminal: runtime.bnf.eofTerminal,
    terminalBySpec,
    acceptCandidates,
    specs: runtime.portable.lexer.specifications.map((spec) => {
      const trailingContext = spec.trailingContext;
      if (trailingContext === undefined) {
        return {
          contextual: spec.contextual,
          followedBy: undefined,
          followedByEof: false,
          notFollowedBy: undefined,
          excludedWords: [],
        };
      }
      return {
        contextual: spec.contextual,
        followedBy: trailingContext.followedBy,
        followedByEof: trailingContext.followedByEof,
        notFollowedBy: trailingContext.notFollowedBy,
        excludedWords: trailingContext.excludedWords,
      };
    }),
    productions,
  };
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
    grammarExpressionDepthLimit: options.grammarExpressionDepthLimit,
    parserStateLimit: options.parserStateLimit,
    parserItemLimit: options.parserItemLimit,
    lrClosureWorkLimit: options.lrClosureWorkLimit,
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
  return diagnostics;
}

interface WasmGeneratedByteLengths {
  readonly total: number;
  readonly source: number;
  readonly coreBinary: number;
  readonly planBinary: number;
}

function wasmGeneratedByteLengths(
  _analyzed: AnalyzedGrammar,
  runtimePlan: RuntimeParserPlan,
  _bnf: BnfGrammar,
  _lr: LrTable,
  wasm: WasmModuleImage,
  parserPlanBytes: Uint8Array,
  options: WasmTargetOptions,
): WasmGeneratedByteLengths {
  void options;
  const source = byteLength([
    wasmAbiDescriptorSource(),
    wasmRuntimeManifestSource(),
    wasmModSource(),
    emitSyntaxFromPortablePlan(runtimePlan.portable),
  ].join(""));
  return {
    total: source + wasm.bytes.length + parserPlanBytes.length,
    source,
    coreBinary: wasm.bytes.length,
    planBinary: parserPlanBytes.length,
  };
}

function parserStatsDiagnostic(
  analyzed: AnalyzedGrammar,
  runtimePlan: RuntimeParserPlan,
  generatedBytes: WasmGeneratedByteLengths,
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
      `regex AST nodes: ${runtimePlan.analysisStats.regexAstNodes}`,
      `regex NFA states: ${runtimePlan.analysisStats.regexNfaStates}`,
      `regex DFA states: ${runtimePlan.analysisStats.regexDfaStates}`,
      `regex DFA transitions: ${runtimePlan.analysisStats.regexDfaTransitions}`,
      `overlap token pairs compared: ${runtimePlan.analysisStats.tokenOverlapPairsCompared}`,
      `overlap literal pairs compared: ${runtimePlan.analysisStats.literalOverlapPairsCompared}`,
      `shadowing analyses: ${runtimePlan.analysisStats.shadowingAnalyses}`,
      `grammar SCCs: ${runtimePlan.analysisStats.grammar.stronglyConnectedComponents}`,
      `nullable iterations: ${runtimePlan.analysisStats.grammar.nullableIterations}`,
      `productive iterations: ${runtimePlan.analysisStats.grammar.productiveIterations}`,
      `LR states: ${stats.states}`,
      `LR core items: ${stats.coreItems}`,
      `LR items: ${stats.items}`,
      `LR closure work: ${stats.closureWork}`,
      `ACTION entries: ${stats.actionEntries}`,
      `GOTO entries: ${stats.gotoEntries}`,
      `table entries: ${stats.tableEntries}`,
      `diagnostics emitted: ${runtimePlan.analysisStats.diagnosticsEmitted}`,
      `diagnostics suppressed: ${runtimePlan.analysisStats.diagnosticsSuppressed}`,
      `generated bytes: ${generatedBytes.total}`,
      `adapter/source bytes: ${generatedBytes.source}`,
      `core Wasm binary bytes: ${generatedBytes.coreBinary}`,
      `external plan binary bytes: ${generatedBytes.planBinary}`,
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
