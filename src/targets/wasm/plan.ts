import type {
  BabaMetadata,
  Diagnostic,
  GeneratedFile,
  PortabilityMode,
  WasmTargetOptions,
} from "../../ast.ts";
import type { AnalyzedGrammar } from "../../compiler/ir.ts";
import type { Dfa } from "../../compiler/regex/dfa.ts";
import type { BnfGrammar } from "../../compiler/runtime_plan/bnf.ts";
import type { LrAction } from "../../compiler/runtime_plan/lr1.ts";
import type { LrTable } from "../../compiler/runtime_plan/lr1.ts";
import { collectRuleFieldSchemas } from "../runtime/field_schema.ts";
import {
  PARSER_DIAGNOSTIC_CODES,
  PARSER_DIAGNOSTIC_DETAIL_KINDS,
  PARSER_DIAGNOSTIC_SCHEMAS,
} from "../runtime/diagnostic_codes.ts";
import { RUNTIME_IMPLEMENTATION_METADATA } from "../runtime/implementation.ts";
import {
  RUNTIME_TRACE_STATUS_AMBIGUOUS,
  RUNTIME_TRACE_STATUS_BRANCH_LIMIT,
  RUNTIME_TRACE_STATUS_INTERNAL,
  RUNTIME_TRACE_STATUS_OK,
  RUNTIME_TRACE_STATUS_TRACE_LIMIT,
  RUNTIME_TRACE_STATUS_UNEXPECTED,
} from "../runtime/language_sources.ts";
import type {
  PortableParserPlan,
  PortableParserPlanMetadata,
} from "../runtime/portable_plan.ts";
import {
  WASM_ABI_VERSION,
  WASM_ADAPTER_HANDLE_CAPABILITY_EPOCH,
  WASM_CURSOR_FIELD_RECORD_I32_COUNT,
  WASM_CURSOR_RULE_RECORD_I32_COUNT,
  WASM_CURSOR_VALUE_RECORD_I32_COUNT,
  WASM_HOST_OWNERSHIP_CALLER_MANAGED,
  WASM_I32_BYTES,
  WASM_LEX_RESULT_I32_COUNT,
  WASM_MAX_PAGES,
  WASM_PAGE_BYTES,
  WASM_PARSE_CURSOR_RESULT_I32_COUNT,
  WASM_PARSE_TRACE_RESULT_I32_COUNT,
  WASM_RESULT_LIFETIME_CALLER_BUFFER,
  WASM_SOURCE_ENCODING_UTF16,
  WASM_SPAN_UNIT_UTF16,
  WASM_TARGET_KIND,
  WASM_TOKEN_RECORD_I32_COUNT,
  WASM_UTF16_UNIT_BYTES,
} from "../runtime/wasm_abi.ts";
import { emitSyntaxFromPortablePlan } from "../../compiler/runtime_plan/syntax_emit.ts";
import {
  planPortableRuntime,
  type RuntimeParserPlan,
  type RuntimeParserPlanningOptions,
} from "../runtime/plan.ts";
import { generatedSourceBanner } from "../runtime/provenance.ts";
import { emitWasmModule, type WasmModuleImage } from "./module_emit.ts";
import type {
  ParserKit,
  ParserKitActionEntry,
  ParserKitGotoEntry,
  ParserKitLexerSpec,
  ParserKitLrAction,
} from "../../runtime/parser_plan.ts";
import { encodeCombinedWasmParserPlan } from "../../runtime/wasm_plan.ts";

export interface WasmPlan {
  analyzed: AnalyzedGrammar;
  bnf: BnfGrammar;
  lr: LrTable;
  dfa: Dfa;
  portable: PortableParserPlan;
  portableMetadata: PortableParserPlanMetadata;
  parserKit: ParserKit;
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
  const portableBnf = runtimePlan.bnf;
  const portableLr = runtimePlan.lr;
  const portableDfa = runtimePlan.dfa;
  let preserveTrivia = true;
  if (options.preserveTrivia !== undefined) {
    preserveTrivia = options.preserveTrivia;
  }
  const parserKit = createWasmRuntimeParserKit(
    analyzed,
    runtimePlan,
    preserveTrivia,
  );
  const wasm = emitWasmModule(
    portableDfa,
    portableLr,
    runtimePlan.portable.version,
    wasmCoreRuntimeMetadata(parserKit, portableBnf),
  );
  const parserPlanBytes = encodeCombinedWasmParserPlan(
    wasm.planBytes,
    compactWasmRuntimePlan(parserKit),
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
    parserKit,
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
          format: "baba-parser-plan",
          version: 1,
          semantics: "baba-portable-v1",
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
      format: "baba-parser-plan",
      version: 1,
      semantics: "baba-portable-v1",
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
        parseTraceResult: {
          i32Count: WASM_PARSE_TRACE_RESULT_I32_COUNT,
          bytes: WASM_PARSE_TRACE_RESULT_I32_COUNT * WASM_I32_BYTES,
          fields: [
            "tokenRecordCount",
            "traceActionCount",
            "errorOffset",
            "errorState",
            "tokenReadCount",
            "reserved",
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
            "childStart",
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
          fields: ["kind", "number", "itemStart", "itemCount"],
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
          name: "parse_trace",
          params: [
            "sourcePtr",
            "sourceLength",
            "tokenPtr",
            "tokenCapacity",
            "tracePtr",
            "traceCapacity",
            "resultPtr",
            "stackPtr",
            "stackCapacity",
            "preserveTrivia",
            "maxTraceActions",
          ],
          result:
            "traceStatusZeroOkOneUnexpectedTwoInternalFourTraceLimitFiveAmbiguous",
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
            "preserveTrivia",
            "maxTraceActions",
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
          params: ["sourcePtr", "sourceLength", "mode", "tokenPtr"],
          result: "tokenRecordCount",
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

function wasmModSource(): string {
  return `${
    generatedSourceBanner({
      parserPlanVersion: 1,
      parserPlanSemantics: "baba-portable-v1",
    })
  }
import type { CursorParseResult, LexOptions, LexTapeResult, ParseOptions, RootCursor, ValidateParseResult } from "./syntax.ts";
import {
  createParser as createSharedParser,
  createParserAsync as createSharedParserAsync,
} from "@mewhhaha/baba/runtime/generated-wasm";
import type {
  ParserInstanceOptions as SharedParserInstanceOptions,
} from "@mewhhaha/baba/runtime/generated-wasm";

export * from "./syntax.ts";
export {
  parserDiagnosticCodeAmbiguousParse,
  parserDiagnosticCodeBranchLimit,
  parserDiagnosticCodeInternalError,
  parserDiagnosticCodeParseInvalidTokenStream,
  parserDiagnosticCodeParseLexicalError,
  parserDiagnosticCodeParseTrailingInput,
  parserDiagnosticCodeParseUnexpectedToken,
  parserDiagnosticCodeTraceLimit,
  parserDiagnosticDetailKindNone,
  parserDiagnosticDetailKindParserState,
  parserPlanFormat,
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

export interface ParserInstanceOptions extends SharedParserInstanceOptions {
  plan: Uint8Array;
}

export interface AsyncParserInstanceOptions extends ParserInstanceOptions {
  url?: URL;
  planUrl?: URL;
}

export interface ParserInstance {
  lex(source: string, options?: LexOptions): LexTapeResult;
  parse(source: string, options?: ParseOptions): CursorParseResult<RootCursor>;
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

function createWasmRuntimeParserKit(
  analyzed: AnalyzedGrammar,
  runtime: RuntimeParserPlan,
  preserveTrivia: boolean,
): ParserKit {
  const fieldSchemas = collectRuleFieldSchemas(analyzed);
  const rootFieldSchema = fieldSchemas.find((schema) =>
    schema.ruleId === analyzed.rootRule
  );
  let rootNodeType = "RuleNode";
  if (rootFieldSchema !== undefined) {
    rootNodeType = rootFieldSchema.nodeType;
  }
  let rootRule = "module";
  const analyzedRootRule = analyzed.rules[analyzed.rootRule];
  if (analyzedRootRule !== undefined) {
    rootRule = analyzedRootRule.name;
  }
  let conflictProfile: "deterministic" | "branching" = "deterministic";
  if (hasBranchingActions(runtime.lr.actions)) {
    conflictProfile = "branching";
  }
  return {
    schemaVersion: 1,
    generator: "@mewhhaha/baba",
    profile: "runtime",
    portablePlan: { ...runtime.portableMetadata },
    runtimeImplementation: {
      format: RUNTIME_IMPLEMENTATION_METADATA.format,
      version: RUNTIME_IMPLEMENTATION_METADATA.version,
      semantics: RUNTIME_IMPLEMENTATION_METADATA.semantics,
      hash: RUNTIME_IMPLEMENTATION_METADATA.hash,
    },
    grammar: {
      name: analyzed.name,
      rootRule,
      rootRuleId: analyzed.rootRule,
      rootNodeType,
      rules: analyzed.rules.map((rule) => {
        const schema = fieldSchemas.find((entry) => entry.ruleId === rule.id);
        const ruleInfo: ParserKit["grammar"]["rules"][number] = {
          id: rule.id,
          name: rule.name,
          reachable: analyzed.reachableRules.has(rule.id),
          span: rule.span,
        };
        if (schema !== undefined) {
          return { ...ruleInfo, nodeType: schema.nodeType };
        }
        return ruleInfo;
      }),
    },
    tokens: {
      named: analyzed.tokens.map((token) => {
        let channel: "main" | "trivia" = "main";
        if (token.kind === "skip") {
          channel = "trivia";
        }
        return {
          id: token.id,
          name: token.name,
          kind: token.kind,
          channel,
          pattern: token.patternSource,
          priority: token.priority,
          declarationOrder: token.declarationOrder,
          reachable: token.kind === "skip" ||
            analyzed.reachableTokens.has(token.id),
          span: token.span,
        };
      }),
      literals: analyzed.literals.map((literal) => ({
        id: literal.id,
        value: literal.value,
        sourceOrder: literal.sourceOrder,
        reachable: analyzed.reachableLiterals.has(literal.id),
        span: literal.span,
      })),
    },
    lexer: {
      defaultPreserveTrivia: preserveTrivia,
      specs: wasmLexerSpecs(analyzed),
      dfa: {
        start: runtime.dfa.start,
        transitions: runtime.dfa.states.map((state) =>
          state.transitions.map((transition) => ({
            start: transition.start,
            end: transition.end,
            target: transition.target,
          }))
        ),
        accepts: runtime.dfa.states.map((state) => {
          if (state.selectedAccept === undefined) return -1;
          if (state.selectedAccept === null) return -1;
          return state.selectedAccept;
        }),
        acceptCandidates: runtime.portable.lexer.states.map((state) =>
          orderAcceptCandidates(
            runtime.portable.lexer.specifications,
            state.accepts,
          )
        ),
      },
    },
    bnf: {
      startNonterminal: runtime.bnf.startNonterminal,
      rootRuleNonterminal: runtime.bnf.rootRuleNonterminal,
      eofTerminal: runtime.bnf.eofTerminal,
      terminals: runtime.bnf.terminals.map((terminal) => ({ ...terminal })),
      nonterminals: runtime.bnf.nonterminals.map((nonterminal) => ({
        ...nonterminal,
      })),
      productions: runtime.bnf.productions.map((production) => ({
        id: production.id,
        lhs: production.lhs,
        rhs: production.rhs.map((symbol) => ({ ...symbol })),
        reducer: { ...production.reducer },
      })),
    },
    lr: {
      conflictProfile,
      states: runtime.lr.states.map((state) => ({
        id: state.id,
        items: [],
      })),
      actions: wasmActionEntries(runtime.lr.actions),
      gotos: wasmGotoEntries(runtime.lr.gotos),
      stats: {
        ...runtime.lr.stats,
        coreItems: 0,
        items: 0,
      },
    },
    fields: {
      rootNodeType,
      rules: fieldSchemas.map((schema) => ({
        ruleId: schema.ruleId,
        ruleName: schema.ruleName,
        nodeType: schema.nodeType,
        fields: schema.fields.map((field) => ({ ...field })),
      })),
    },
    displayNames: {
      terminals: runtime.bnf.terminals.map((terminal) => ({
        id: terminal.id,
        display: terminal.display,
      })),
      rules: analyzed.rules.map((rule) => ({
        id: rule.id,
        display: rule.name,
      })),
    },
  };
}

function compactWasmRuntimePlan(kit: ParserKit): unknown {
  let conflictProfile = 0;
  if (kit.lr.conflictProfile === "branching") {
    conflictProfile = 1;
  }
  return {
    m: [
      kit.portablePlan.format,
      kit.portablePlan.version,
      kit.portablePlan.semantics,
      kit.portablePlan.hash,
      runtimeImplementationHash(kit),
    ],
    g: [
      kit.grammar.name,
      kit.grammar.rootRule,
      kit.grammar.rootRuleId,
      kit.grammar.rootNodeType,
      kit.grammar.rules.map((rule) => [
        rule.id,
        rule.name,
        rule.reachable,
        rule.nodeType,
      ]),
    ],
    t: [
      kit.tokens.named.map((token) => {
        let kind = 1;
        if (token.kind === "token") kind = 0;
        return [
          token.id,
          token.name,
          kind,
          token.priority,
          token.declarationOrder,
          token.reachable,
        ];
      }),
      kit.tokens.literals.map((literal) => [
        literal.id,
        literal.value,
        literal.sourceOrder,
        literal.reachable,
      ]),
    ],
    l: [
      kit.lexer.defaultPreserveTrivia,
      kit.lexer.specs.map((spec) => {
        if (spec.type === "named") return [0, spec.tokenId];
        return [1, spec.literalId];
      }),
      kit.lexer.dfa.start,
      kit.lexer.dfa.transitions.map((row) =>
        row.map((transition) => [
          transition.start,
          transition.end,
          transition.target,
        ])
      ),
      kit.lexer.dfa.accepts,
      kit.lexer.dfa.acceptCandidates,
    ],
    b: [
      kit.bnf.startNonterminal,
      kit.bnf.rootRuleNonterminal,
      kit.bnf.eofTerminal,
      kit.bnf.terminals.map(compactTerminal),
      kit.bnf.nonterminals.map((nonterminal) => [
        nonterminal.id,
        nonterminal.name,
        nonterminal.ruleId,
        nonterminal.expressionId,
      ]),
      kit.bnf.productions.map((production) => [
        production.id,
        production.lhs,
        production.rhs.map((symbol) => {
          if (symbol.kind === "terminal") return [0, symbol.id];
          return [1, symbol.id];
        }),
        compactReducer(production.reducer),
      ]),
    ],
    r: [
      conflictProfile,
      kit.lr.states.length,
      kit.lr.actions.map((entry) => [
        entry.state,
        entry.terminal,
        entry.actions.map(compactAction),
      ]),
      kit.lr.gotos.map((entry) => [
        entry.state,
        entry.nonterminal,
        entry.target,
      ]),
      [
        kit.lr.stats.bnfProductions,
        kit.lr.stats.states,
        kit.lr.stats.coreItems,
        kit.lr.stats.items,
        kit.lr.stats.closureWork,
        kit.lr.stats.actionEntries,
        kit.lr.stats.gotoEntries,
        kit.lr.stats.tableEntries,
      ],
    ],
    f: [
      kit.fields.rootNodeType,
      kit.fields.rules.map((rule) => [
        rule.ruleId,
        rule.ruleName,
        rule.nodeType,
        rule.fields.map((field) => [
          field.name,
          field.type,
          field.array,
          field.nullable,
        ]),
      ]),
    ],
    d: [
      kit.displayNames.terminals.map((entry) => [entry.id, entry.display]),
      kit.displayNames.rules.map((entry) => [entry.id, entry.display]),
    ],
  };
}

function wasmCoreRuntimeMetadata(
  kit: ParserKit,
  bnf: BnfGrammar,
): {
  readonly eofTerminal: number;
  readonly terminalBySpec: readonly number[];
  readonly acceptCandidates: readonly (readonly number[])[];
  readonly productions: readonly {
    readonly lhs: number;
    readonly rhsLength: number;
    readonly reducerKind: number;
    readonly reducerArg: number;
  }[];
} {
  const fieldIds = new Map<string, number>();
  for (const schema of kit.fields.rules) {
    for (const field of schema.fields) {
      if (!fieldIds.has(field.name)) {
        fieldIds.set(field.name, fieldIds.size);
      }
    }
  }
  const terminalBySpec = kit.lexer.specs.map((spec) => {
    if (spec.type === "named") {
      const token = kit.tokens.named.find((entry) => entry.id === spec.tokenId);
      if (token === undefined) {
        throw new Error("Wasm lexer spec references an unknown named token.");
      }
      if (token.channel === "trivia") return -1;
      return terminalIdForNamedSpec(kit, spec.tokenId);
    }
    return terminalIdForLiteralSpec(kit, spec.literalId);
  });
  const acceptCandidates = kit.lexer.dfa.acceptCandidates;
  if (acceptCandidates === undefined) {
    throw new Error("Wasm lexer DFA is missing accept candidate rows.");
  }
  if (kit.bnf.productions.length !== bnf.productions.length) {
    throw new Error("Wasm BNF production metadata is not aligned.");
  }
  const productions = bnf.productions.map((production, index) => {
    if (production.id !== index) {
      throw new Error("Wasm BNF production ids must be dense by index.");
    }
    const kitProduction = kit.bnf.productions[index];
    if (kitProduction === undefined) {
      throw new Error("Wasm reducer metadata is missing a production.");
    }
    const reducer = compactCoreReducer(kitProduction.reducer, fieldIds);
    return {
      lhs: production.lhs,
      rhsLength: production.rhs.length,
      reducerKind: reducer.kind,
      reducerArg: reducer.arg,
    };
  });
  return {
    eofTerminal: kit.bnf.eofTerminal,
    terminalBySpec,
    acceptCandidates,
    productions,
  };
}

function compactCoreReducer(
  reducer: ParserKit["bnf"]["productions"][number]["reducer"],
  fieldIds: ReadonlyMap<string, number>,
): { readonly kind: number; readonly arg: number } {
  switch (reducer.kind) {
    case "start":
      return { kind: 0, arg: -1 };
    case "rule":
      return { kind: 1, arg: reducer.ruleId };
    case "terminal":
      return { kind: 2, arg: -1 };
    case "ruleRef":
      return { kind: 3, arg: -1 };
    case "identity":
      return { kind: 4, arg: -1 };
    case "sequence":
      return { kind: 5, arg: -1 };
    case "optionalEmpty":
      return { kind: 6, arg: -1 };
    case "optionalSome":
      return { kind: 7, arg: -1 };
    case "repeatEmpty":
      return { kind: 8, arg: -1 };
    case "repeatAppend":
      return { kind: 9, arg: -1 };
    case "repeat1First":
      return { kind: 10, arg: -1 };
    case "repeat1Append":
      return { kind: 11, arg: -1 };
    case "separatedFirst":
      return { kind: 12, arg: -1 };
    case "separatedAppend":
      return { kind: 13, arg: -1 };
    case "field": {
      const fieldId = fieldIds.get(reducer.name);
      if (fieldId === undefined) {
        throw new Error("Wasm field reducer references an unknown field.");
      }
      return { kind: 14, arg: fieldId };
    }
  }
}

function runtimeImplementationHash(kit: ParserKit): string {
  if (kit.runtimeImplementation !== undefined) {
    return kit.runtimeImplementation.hash;
  }
  return RUNTIME_IMPLEMENTATION_METADATA.hash;
}

function compactTerminal(terminal: ParserKit["bnf"]["terminals"][number]) {
  if (terminal.kind === "eof") {
    return [terminal.id, 0, terminal.key, terminal.display, undefined];
  }
  if (terminal.kind === "named") {
    return [terminal.id, 1, terminal.key, terminal.display, terminal.tokenId];
  }
  return [terminal.id, 2, terminal.key, terminal.display, terminal.literalId];
}

function compactReducer(
  reducer: ParserKit["bnf"]["productions"][number]["reducer"],
) {
  switch (reducer.kind) {
    case "start":
      return [0];
    case "rule":
      return [1, reducer.ruleId];
    case "terminal":
      return [2];
    case "ruleRef":
      return [3];
    case "identity":
      return [4];
    case "sequence":
      return [5];
    case "optionalEmpty":
      return [6];
    case "optionalSome":
      return [7];
    case "repeatEmpty":
      return [8];
    case "repeatAppend":
      return [9];
    case "repeat1First":
      return [10];
    case "repeat1Append":
      return [11];
    case "separatedFirst":
      return [12];
    case "separatedAppend":
      return [13];
    case "field":
      return [14, reducer.name];
  }
}

function compactAction(action: ParserKitLrAction) {
  if (action.kind === "shift") return [0, action.state];
  if (action.kind === "reduce") return [1, action.production];
  return [2];
}

function terminalIdForNamedSpec(kit: ParserKit, tokenId: number): number {
  const terminal = kit.bnf.terminals.find((entry) =>
    entry.kind === "named" && entry.tokenId === tokenId
  );
  if (terminal === undefined) {
    throw new Error("Wasm named lexer spec has no parser terminal.");
  }
  return terminal.id;
}

function terminalIdForLiteralSpec(kit: ParserKit, literalId: number): number {
  const terminal = kit.bnf.terminals.find((entry) =>
    entry.kind === "literal" && entry.literalId === literalId
  );
  if (terminal === undefined) {
    throw new Error("Wasm literal lexer spec has no parser terminal.");
  }
  return terminal.id;
}

function orderAcceptCandidates(
  specs: RuntimeParserPlan["portable"]["lexer"]["specifications"],
  accepts: readonly number[],
): readonly number[] {
  return [...accepts].sort((left, right) => {
    const leftSpec = specs[left];
    const rightSpec = specs[right];
    if (leftSpec === undefined || rightSpec === undefined) {
      return left - right;
    }
    let literalOrder = 0;
    if (leftSpec.literal !== rightSpec.literal) {
      if (leftSpec.literal) {
        literalOrder = -1;
      } else {
        literalOrder = 1;
      }
    }
    return rightSpec.priority - leftSpec.priority ||
      literalOrder ||
      leftSpec.order - rightSpec.order ||
      left - right;
  });
}

function wasmLexerSpecs(analyzed: AnalyzedGrammar): ParserKitLexerSpec[] {
  const specs: ParserKitLexerSpec[] = [];
  for (const token of analyzed.tokens) {
    if (
      token.kind === "skip" ||
      (token.kind === "token" && analyzed.reachableTokens.has(token.id))
    ) {
      specs.push({
        type: "named",
        tokenId: token.id,
      });
    }
  }
  for (const literal of analyzed.literals) {
    if (analyzed.reachableLiterals.has(literal.id)) {
      specs.push({
        type: "literal",
        literalId: literal.id,
      });
    }
  }
  return specs;
}

function wasmActionEntries(
  table: RuntimeParserPlan["lr"]["actions"],
): ParserKitActionEntry[] {
  const entries: ParserKitActionEntry[] = [];
  for (
    const [state, row] of [...table.entries()].sort(([left], [right]) =>
      left - right
    )
  ) {
    for (
      const [terminal, actions] of [...row.entries()].sort((
        [left],
        [right],
      ) => left - right)
    ) {
      entries.push({
        state,
        terminal,
        actions: actions.map(wasmActionEntry).sort(compareActions),
      });
    }
  }
  return entries;
}

function wasmGotoEntries(
  table: RuntimeParserPlan["lr"]["gotos"],
): ParserKitGotoEntry[] {
  const entries: ParserKitGotoEntry[] = [];
  for (
    const [state, row] of [...table.entries()].sort(([left], [right]) =>
      left - right
    )
  ) {
    for (
      const [nonterminal, target] of [...row.entries()].sort((
        [left],
        [right],
      ) => left - right)
    ) {
      entries.push({ state, nonterminal, target });
    }
  }
  return entries;
}

function hasBranchingActions(
  table: RuntimeParserPlan["lr"]["actions"],
): boolean {
  for (const row of table.values()) {
    for (const actions of row.values()) {
      if (actions.length > 1) return true;
    }
  }
  return false;
}

function wasmActionEntry(action: LrAction): ParserKitLrAction {
  if (action.kind === "shift") return { kind: "shift", state: action.state };
  if (action.kind === "reduce") {
    return { kind: "reduce", production: action.production };
  }
  return { kind: "accept" };
}

function compareActions(
  left: ParserKitLrAction,
  right: ParserKitLrAction,
): number {
  const leftRank = actionRank(left);
  const rightRank = actionRank(right);
  if (leftRank !== rightRank) return leftRank - rightRank;
  if (left.kind === "shift" && right.kind === "shift") {
    return left.state - right.state;
  }
  if (left.kind === "reduce" && right.kind === "reduce") {
    return left.production - right.production;
  }
  return 0;
}

function actionRank(action: ParserKitLrAction): number {
  if (action.kind === "shift") return 0;
  if (action.kind === "reduce") return 1;
  return 2;
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
