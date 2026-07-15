/**
 * Generated Wasm parser loader used by Baba generated bundles.
 *
 * @module
 */

import {
  parserPlanRuntimeMetadataVersion,
  validateCombinedWasmParserPlan,
} from "./wasm_plan.ts";
import {
  PARSER_DIAGNOSTIC_CODE_AMBIGUOUS_PARSE as parserDiagnosticCodeAmbiguousParse,
  PARSER_DIAGNOSTIC_CODE_INTERNAL_ERROR as parserDiagnosticCodeInternalError,
  PARSER_DIAGNOSTIC_CODE_PARSE_LEXICAL_ERROR
    as parserDiagnosticCodeParseLexicalError,
  PARSER_DIAGNOSTIC_CODE_PARSE_TRAILING_INPUT
    as parserDiagnosticCodeParseTrailingInput,
  PARSER_DIAGNOSTIC_CODE_PARSE_UNEXPECTED_TOKEN
    as parserDiagnosticCodeParseUnexpectedToken,
  PARSER_DIAGNOSTIC_CODE_TRACE_LIMIT as parserDiagnosticCodeTraceLimit,
  PARSER_DIAGNOSTIC_DETAIL_NONE as parserDiagnosticDetailKindNone,
  PARSER_DIAGNOSTIC_DETAIL_PARSER_STATE
    as parserDiagnosticDetailKindParserState,
} from "../targets/runtime/diagnostic_codes.ts";
import { RUNTIME_IMPLEMENTATION_METADATA } from "../targets/runtime/implementation.ts";
import {
  WASM_ABI_VERSION,
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
} from "../targets/runtime/wasm_abi.ts";

type LocalWasmSource =
  | {
    readonly bytes: Uint8Array;
    readonly module?: never;
    readonly url?: never;
  }
  | {
    readonly bytes?: never;
    readonly module: WebAssembly.Module;
    readonly url?: never;
  };

type AsyncWasmSource =
  | LocalWasmSource
  | {
    readonly bytes?: never;
    readonly module?: never;
    readonly url: URL;
  };

type LocalPlanSource = {
  readonly plan: Uint8Array;
  readonly planUrl?: never;
};

type AsyncPlanSource =
  | LocalPlanSource
  | {
    readonly plan?: never;
    readonly planUrl: URL;
  };

export type ParserInstanceOptions = LocalWasmSource & LocalPlanSource;
export type AsyncParserInstanceOptions = AsyncWasmSource & AsyncPlanSource;

export interface ParserInstance<Root extends RuleCursor = RuleCursor> {
  lex(source: string, options?: LexOptions): LexTapeResult;
  parse(source: string, options?: ParseOptions): CursorParseResult<Root>;
  validate(source: string, options?: ParseOptions): ValidateParseResult;
  reset(): void;
  dispose(): void;
}

export interface LexOptions {
  readonly preserveTrivia?: boolean;
}

export interface ParseOptions extends LexOptions {
  readonly maxTraceActions?: number;
}

export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface MainNamedToken {
  readonly type: "named";
  readonly kind: string;
  readonly text: string;
  readonly span: Span;
  readonly channel: "main";
}

export interface TriviaToken {
  readonly type: "named";
  readonly kind: string;
  readonly text: string;
  readonly span: Span;
  readonly channel: "trivia";
}

export interface LiteralToken {
  readonly type: "literal";
  readonly literal: string;
  readonly text: string;
  readonly span: Span;
  readonly channel: "main";
}

export interface ErrorToken {
  readonly type: "error";
  readonly text: string;
  readonly span: Span;
  readonly channel: "error";
}

export interface EofToken {
  readonly type: "eof";
  readonly text: "";
  readonly span: Span;
  readonly channel: "main";
}

export type Token =
  | MainNamedToken
  | TriviaToken
  | LiteralToken
  | ErrorToken
  | EofToken;

export interface LexDiagnostic {
  readonly code: "LEX_UNEXPECTED_CHARACTER";
  readonly message: string;
  readonly span: Span;
}

export interface ParseDiagnostic {
  readonly code:
    | "PARSE_LEXICAL_ERROR"
    | "PARSE_UNEXPECTED_TOKEN"
    | "PARSE_TRAILING_INPUT"
    | "PARSER_TRACE_LIMIT"
    | "PARSER_AMBIGUOUS_PARSE"
    | "PARSER_INTERNAL_ERROR";
  readonly message: string;
  readonly span: Span;
  readonly runtimeCode: number;
  readonly runtimeDetail: number;
  readonly runtimeDetailKind: "none" | "parser-state";
  readonly runtimeDetailKindId: number;
  readonly expected?: readonly string[];
  readonly found?: string;
}

export interface TokenCursor {
  readonly type: "token";
  readonly tokenType: "named" | "literal";
  readonly kind: string;
  readonly text: string;
  readonly span: Span;
  readonly tokenIndex: number;
}

export type CursorFieldValue =
  | RuleCursor
  | TokenCursor
  | readonly CursorFieldValue[]
  | null;

export interface RuleCursor {
  readonly type: "rule";
  readonly name: string;
  readonly span: Span;
  readonly tokenRange: Span;
  readonly childCount: number;
  child(index: number): SyntaxCursor | undefined;
  children(): readonly SyntaxCursor[];
  field(name: string): CursorFieldValue | undefined;
  fieldArray(name: string): readonly CursorFieldValue[];
}

export type SyntaxCursor = RuleCursor | TokenCursor;

export type CursorParseResult<Root extends RuleCursor = RuleCursor> =
  | {
    readonly ok: true;
    readonly cursor: Root;
    readonly source: string;
    readonly diagnostics: readonly [];
  }
  | {
    readonly ok: false;
    readonly cursor: null;
    readonly source: string;
    readonly diagnostics: readonly ParseDiagnostic[];
  };

export type ValidateParseResult =
  | {
    readonly ok: true;
    readonly source: string;
    readonly diagnostics: readonly [];
  }
  | {
    readonly ok: false;
    readonly source: string;
    readonly diagnostics: readonly ParseDiagnostic[];
  };

export interface TokenTape {
  readonly length: number;
  token(index: number): Token | undefined;
}

export interface LexTapeResult {
  readonly source: string;
  readonly tokenTape: TokenTape;
  readonly diagnostics: readonly LexDiagnostic[];
}

interface ExternalParserWasmExports {
  memory: WebAssembly.Memory;
  lex_all(
    sourcePtr: number,
    sourceLength: number,
    mode: number,
    tokenPtr: number,
  ): number;
  parse_trace(
    sourcePtr: number,
    sourceLength: number,
    tokenPtr: number,
    tokenCapacity: number,
    tracePtr: number,
    traceCapacity: number,
    resultPtr: number,
    stackPtr: number,
    stackCapacity: number,
    preserveTrivia: number,
    maxTraceActions: number,
  ): number;
  parse_cursor(
    sourcePtr: number,
    sourceLength: number,
    tokenPtr: number,
    tokenCapacity: number,
    rulePtr: number,
    ruleCapacity: number,
    childPtr: number,
    childCapacity: number,
    fieldPtr: number,
    fieldCapacity: number,
    valuePtr: number,
    valueCapacity: number,
    valueItemPtr: number,
    valueItemCapacity: number,
    resultPtr: number,
    stackPtr: number,
    fragmentPtr: number,
    fragmentCapacity: number,
    preserveTrivia: number,
    maxTraceActions: number,
  ): number;
  load_plan(planPtr: number, planLength: number): number;
  abi_version(): number;
  plan_version(): number;
  semantics_version(): number;
  reset(): void;
  plan_buffer_base(): number;
  input_base(): number;
  max_pages(): number;
  source_encoding(): number;
  span_unit(): number;
  lex_result_i32_count(): number;
  token_record_i32_count(): number;
  host_ownership_model(): number;
  result_lifetime_model(): number;
}

export const wasmTargetKind = WASM_TARGET_KIND;
export const wasmAbiVersion = WASM_ABI_VERSION;
export const wasmSemanticsVersion = RUNTIME_IMPLEMENTATION_METADATA.version;
export const wasmMaxPages = WASM_MAX_PAGES;
export const wasmSourceEncoding = WASM_SOURCE_ENCODING_UTF16;
export const wasmSpanUnit = WASM_SPAN_UNIT_UTF16;
export const wasmLexResultI32Count = WASM_LEX_RESULT_I32_COUNT;
export const wasmTokenRecordI32Count = WASM_TOKEN_RECORD_I32_COUNT;
export const wasmHostOwnershipModel = WASM_HOST_OWNERSHIP_CALLER_MANAGED;
export const wasmResultLifetimeModel = WASM_RESULT_LIFETIME_CALLER_BUFFER;
export const parserPlanFormat = "baba-parser-plan" as const;
export const parserPlanVersion = 1;
export { parserPlanRuntimeMetadataVersion };
export const parserPlanSemantics = "baba-portable-v1" as const;
export const runtimeImplementationFormat = RUNTIME_IMPLEMENTATION_METADATA
  .format;
export const runtimeImplementationVersion = RUNTIME_IMPLEMENTATION_METADATA
  .version;
export const runtimeImplementationSemantics = RUNTIME_IMPLEMENTATION_METADATA
  .semantics;
export const runtimeImplementationHash = RUNTIME_IMPLEMENTATION_METADATA.hash;

export {
  parserDiagnosticCodeAmbiguousParse,
  parserDiagnosticCodeInternalError,
  parserDiagnosticCodeParseLexicalError,
  parserDiagnosticCodeParseTrailingInput,
  parserDiagnosticCodeParseUnexpectedToken,
  parserDiagnosticCodeTraceLimit,
  parserDiagnosticDetailKindNone,
  parserDiagnosticDetailKindParserState,
};

export function createParser<Root extends RuleCursor = RuleCursor>(
  options: ParserInstanceOptions,
): ParserInstance<Root> {
  if (options === undefined || options === null) {
    throw new Error("Wasm parser creation requires an options object.");
  }
  if (options.plan === undefined) {
    throw new Error("Wasm parser creation requires parser plan bytes.");
  }
  const hasBytes = options.bytes !== undefined;
  const hasModule = options.module !== undefined;
  if (hasBytes === hasModule) {
    throw new Error(
      `Wasm parser creation requires exactly one of bytes or module; received bytes=${hasBytes}, module=${hasModule}.`,
    );
  }
  const planBytes = new Uint8Array(options.plan);
  const validated = validateCombinedWasmParserPlan(planBytes);
  const module = externalWasmModule(options);
  const instance = new WebAssembly.Instance(module, {});
  const wasm = instance.exports as unknown as ExternalParserWasmExports;
  validateStaticExternalWasmAbi(wasm);
  const planPtr = loadExternalWasmPlan(wasm, planBytes);
  const inputBase = validateLoadedExternalWasmAbi(
    wasm,
    validated.parserPlanVersion,
    planPtr,
    validated.coreByteLength,
  );
  return new ExternalWasmParserInstance(
    planBytes,
    validated.parserPlanVersion,
    wasm,
    inputBase,
  );
}

export async function createParserAsync<Root extends RuleCursor = RuleCursor>(
  options: AsyncParserInstanceOptions,
): Promise<ParserInstance<Root>> {
  if (options === undefined || options === null) {
    throw new Error("Wasm parser async creation requires an options object.");
  }
  const hasBytes = options.bytes !== undefined;
  const hasModule = options.module !== undefined;
  const hasUrl = options.url !== undefined;
  const wasmSourceCount = Number(hasBytes) + Number(hasModule) + Number(hasUrl);
  if (wasmSourceCount !== 1) {
    throw new Error(
      `Wasm parser async creation requires exactly one of bytes, module, or url; received bytes=${hasBytes}, module=${hasModule}, url=${hasUrl}.`,
    );
  }
  const hasPlan = options.plan !== undefined;
  const hasPlanUrl = options.planUrl !== undefined;
  if (hasPlan === hasPlanUrl) {
    throw new Error(
      `Wasm parser async creation requires exactly one of plan or planUrl; received plan=${hasPlan}, planUrl=${hasPlanUrl}.`,
    );
  }
  let plan: Uint8Array;
  if (options.plan !== undefined) {
    plan = options.plan;
  } else {
    const planUrl = options.planUrl;
    if (planUrl === undefined) {
      throw new Error("Wasm parser async plan source disappeared.");
    }
    const planResponse = await fetch(planUrl);
    if (!planResponse.ok) {
      throw new Error(
        `Failed to load Wasm parser plan from ${planUrl.href}: HTTP ${planResponse.status}.`,
      );
    }
    plan = new Uint8Array(await planResponse.arrayBuffer());
  }
  if (options.bytes !== undefined) {
    return createParser<Root>({ bytes: options.bytes, plan });
  }
  if (options.module !== undefined) {
    return createParser<Root>({ module: options.module, plan });
  }
  const url = options.url;
  if (url === undefined) {
    throw new Error("Wasm parser async module source disappeared.");
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to load Wasm parser module from ${url.href}: HTTP ${response.status}.`,
    );
  }
  return createParser<Root>({
    bytes: new Uint8Array(await response.arrayBuffer()),
    plan,
  });
}

class ExternalWasmParserInstance<Root extends RuleCursor = RuleCursor>
  implements ParserInstance<Root> {
  #disposed = false;
  #metadata: ExternalRuntimeMetadata | undefined;

  readonly parse: ParserInstance<Root>["parse"];

  constructor(
    private readonly planBytes: Uint8Array,
    private readonly parserPlanVersionToMatch: number,
    private readonly wasm: ExternalParserWasmExports,
    private readonly inputBase: number,
  ) {
    this.parse = ((source: string, options?: ParseOptions) => {
      this.#assertLive();
      return parseExternalWasm<Root>(
        this.#loadMetadata(),
        this.wasm,
        this.inputBase,
        source,
        options,
      );
    }) as ParserInstance<Root>["parse"];
  }

  lex(source: string, options?: LexOptions): LexTapeResult {
    this.#assertLive();
    return lexExternalWasmTape(
      this.#loadMetadata(),
      this.wasm,
      this.inputBase,
      source,
      options,
    );
  }

  validate(source: string, options?: ParseOptions): ValidateParseResult {
    this.#assertLive();
    return validateExternalWasmTrace(
      this.#loadMetadata(),
      this.wasm,
      this.inputBase,
      source,
      options,
    );
  }

  reset(): void {
    this.#assertLive();
    this.wasm.reset();
  }

  dispose(): void {
    this.#disposed = true;
  }

  #assertLive(): void {
    if (this.#disposed) {
      throw new Error("Wasm parser instance is disposed.");
    }
  }

  #loadMetadata(): ExternalRuntimeMetadata {
    if (this.#metadata !== undefined) {
      return this.#metadata;
    }
    const metadata = decodeExternalRuntimeMetadata(
      this.planBytes,
      this.parserPlanVersionToMatch,
    );
    this.#metadata = metadata;
    return metadata;
  }
}

interface ExternalRuntimeMetadata {
  readonly defaultPreserveTrivia: boolean;
  readonly eofTerminal: number;
  readonly parserStateCount: number;
  readonly conflictProfile: "deterministic" | "branching";
  readonly specs: readonly ExternalLexerSpec[];
  readonly namedById: ReadonlyMap<number, ExternalNamedToken>;
  readonly literalById: ReadonlyMap<number, ExternalLiteralToken>;
  readonly terminalByNamedTokenId: ReadonlyMap<number, number>;
  readonly terminalByLiteralId: ReadonlyMap<number, number>;
  readonly acceptCandidatesByState: readonly (readonly number[])[];
  readonly terminalDisplays: readonly string[];
  readonly expected: readonly (readonly string[])[];
  readonly ruleNames: readonly string[];
  readonly fieldIds: ReadonlyMap<string, number>;
  readonly fieldNames: readonly string[];
  readonly fieldSchemas: readonly (ExternalRuleFieldSchema | undefined)[];
}

type ExternalLexerSpec =
  | { readonly type: "named"; readonly tokenId: number }
  | { readonly type: "literal"; readonly literalId: number };

interface ExternalNamedToken {
  readonly id: number;
  readonly name: string;
  readonly channel: "main" | "trivia";
}

interface ExternalLiteralToken {
  readonly id: number;
  readonly value: string;
}

interface ExternalRuleFieldSchema {
  readonly entries: readonly (readonly [string, ExternalFieldConfig])[];
  readonly byName: Record<string, ExternalFieldConfig>;
}

interface ExternalFieldConfig {
  readonly array: boolean;
  readonly nullable: boolean;
  readonly valueArray: boolean;
}

const EXTERNAL_CORE_HEADER_PARSER_STATE_COUNT = 4;
const EXTERNAL_CORE_HEADER_ACTION_ROWS = 9;
const EXTERNAL_CORE_HEADER_ACTION_PAIRS = 10;
const EXTERNAL_CORE_COMPACT_I16_OFFSET_TAG = 2;
const EXTERNAL_CORE_COMPACT_U16_OFFSET_BASE = 0x4000_0000;
const EXTERNAL_COMPACT_PLAN_MAGIC = new Uint8Array([
  66,
  65,
  66,
  65,
  95,
  80,
  76,
  65,
  78,
  0,
]);
const EXTERNAL_COMPACT_PLAN_VERSION = 1;

function decodeExternalRuntimeMetadata(
  planBytes: Uint8Array,
  parserPlanVersionToMatch: number,
): ExternalRuntimeMetadata {
  const validated = validateCombinedWasmParserPlan(planBytes);
  if (validated.parserPlanVersion !== parserPlanVersionToMatch) {
    throw new Error("Wasm parser plan version changed after load.");
  }
  const compact = decodeExternalCompactRuntimeMetadata(
    planBytes.subarray(
      validated.runtimeMetadataOffset,
      validated.runtimeMetadataOffset + validated.runtimeMetadataLength,
    ),
  );
  const identity = expectArray(compact.m, "runtime identity metadata");
  const metadataVersion = expectNumber(
    identity[0],
    "runtime metadata version",
  );
  if (metadataVersion !== parserPlanRuntimeMetadataVersion) {
    throw new Error(
      `Unsupported Wasm parser plan runtime metadata version ${metadataVersion}. Regenerate the parser plan with Baba 5.`,
    );
  }
  const parserPlanVersion = expectNumber(identity[2], "parser plan version");
  if (parserPlanVersion !== validated.parserPlanVersion) {
    throw new Error(
      `Wasm parser plan version ${validated.parserPlanVersion} does not match runtime metadata version ${parserPlanVersion}.`,
    );
  }
  const runtimeFormat = expectString(
    identity[5],
    "runtime implementation format",
  );
  const runtimeVersion = expectNumber(
    identity[6],
    "runtime implementation version",
  );
  const runtimeSemantics = expectString(
    identity[7],
    "runtime implementation semantics",
  );
  const runtimeHash = expectString(identity[8], "runtime implementation hash");
  if (
    runtimeFormat !== RUNTIME_IMPLEMENTATION_METADATA.format ||
    runtimeVersion !== RUNTIME_IMPLEMENTATION_METADATA.version ||
    runtimeSemantics !== RUNTIME_IMPLEMENTATION_METADATA.semantics ||
    runtimeHash !== RUNTIME_IMPLEMENTATION_METADATA.hash
  ) {
    throw new Error(
      `Wasm parser plan runtime identity ${runtimeFormat}/${runtimeVersion}/${runtimeSemantics}/${runtimeHash} does not match loader identity ${RUNTIME_IMPLEMENTATION_METADATA.format}/${RUNTIME_IMPLEMENTATION_METADATA.version}/${RUNTIME_IMPLEMENTATION_METADATA.semantics}/${RUNTIME_IMPLEMENTATION_METADATA.hash}.`,
    );
  }

  const policy = expectArray(compact.p, "runtime policy metadata");
  const defaultPreserveTrivia = expectBoolean(
    policy[0],
    "default preserve-trivia policy",
  );
  const conflictProfileValue = expectNumber(
    policy[1],
    "parser conflict profile",
  );
  let conflictProfile: ExternalRuntimeMetadata["conflictProfile"] =
    "deterministic";
  if (conflictProfileValue === 1) {
    conflictProfile = "branching";
  } else if (conflictProfileValue !== 0) {
    throw new Error(
      `Unsupported Wasm parser conflict profile ${conflictProfileValue}.`,
    );
  }

  const ruleNames = expectArray(compact.r, "rule-name metadata").map(
    (value, index) => expectString(value, `rule name ${index}`),
  );
  const namedById = new Map<number, ExternalNamedToken>();
  for (const value of expectArray(compact.n, "named-token metadata")) {
    const row = expectArray(value, "named-token metadata row");
    const id = expectNumber(row[0], "named token id");
    const name = expectString(row[1], `named token ${id} name`);
    const trivia = expectBoolean(row[2], `named token ${id} trivia flag`);
    let channel: ExternalNamedToken["channel"] = "main";
    if (trivia) {
      channel = "trivia";
    }
    namedById.set(id, { id, name, channel });
  }
  const literalById = new Map<number, ExternalLiteralToken>();
  for (const value of expectArray(compact.i, "literal-token metadata")) {
    const row = expectArray(value, "literal-token metadata row");
    const id = expectNumber(row[0], "literal token id");
    const literal = expectString(row[1], `literal token ${id} value`);
    literalById.set(id, { id, value: literal });
  }

  const lexer = expectArray(compact.l, "lexer metadata");
  const specs: ExternalLexerSpec[] = [];
  for (const value of expectArray(lexer[0], "lexer specifications")) {
    const row = expectArray(value, "lexer specification row");
    const kind = expectNumber(row[0], "lexer specification kind");
    const id = expectNumber(row[1], "lexer specification id");
    if (kind === 0) {
      if (!namedById.has(id)) {
        throw new Error(`Lexer specification references named token ${id}.`);
      }
      specs.push({ type: "named", tokenId: id });
      continue;
    }
    if (kind === 1) {
      if (!literalById.has(id)) {
        throw new Error(`Lexer specification references literal token ${id}.`);
      }
      specs.push({ type: "literal", literalId: id });
      continue;
    }
    throw new Error(`Unsupported lexer specification kind ${kind}.`);
  }
  const acceptCandidatesByState = expectArray(
    lexer[1],
    "lexer accept candidates",
  ).map((value, state) => {
    return expectArray(value, `lexer accept candidates for state ${state}`).map(
      (candidate, index) => {
        return expectNumber(
          candidate,
          `lexer accept candidate ${index} for state ${state}`,
        );
      },
    );
  });

  const terminalDisplays: string[] = [];
  const terminalByNamedTokenId = new Map<number, number>();
  const terminalByLiteralId = new Map<number, number>();
  let eofTerminal = -1;
  for (const value of expectArray(compact.d, "terminal metadata")) {
    const row = expectArray(value, "terminal metadata row");
    const terminal = expectNumber(row[0], "terminal id");
    const kind = expectNumber(row[1], `terminal ${terminal} kind`);
    const display = expectString(row[2], `terminal ${terminal} display`);
    const referencedId = expectNumber(
      row[3],
      `terminal ${terminal} referenced id`,
    );
    terminalDisplays[terminal] = display;
    if (kind === 0) {
      eofTerminal = terminal;
      continue;
    }
    if (kind === 1) {
      terminalByNamedTokenId.set(referencedId, terminal);
      continue;
    }
    if (kind === 2) {
      terminalByLiteralId.set(referencedId, terminal);
      continue;
    }
    throw new Error(
      `Unsupported terminal kind ${kind} for terminal ${terminal}.`,
    );
  }
  if (eofTerminal < 0) {
    throw new Error(
      "Wasm parser runtime metadata is missing the EOF terminal.",
    );
  }

  const fields = expectArray(compact.f, "cursor field metadata");
  const fieldNames = expectArray(fields[0], "cursor field names").map(
    (value, index) => expectString(value, `cursor field name ${index}`),
  );
  const fieldIds = new Map<string, number>();
  for (let fieldId = 0; fieldId < fieldNames.length; fieldId++) {
    const fieldName = fieldNames[fieldId];
    if (fieldName === undefined) {
      throw new Error(`Cursor field name ${fieldId} is missing.`);
    }
    fieldIds.set(fieldName, fieldId);
  }
  const fieldSchemas: (ExternalRuleFieldSchema | undefined)[] = [];
  for (const value of expectArray(fields[1], "cursor rule fields")) {
    const row = expectArray(value, "cursor rule field row");
    const ruleId = expectNumber(row[0], "cursor field rule id");
    const entries: (readonly [string, ExternalFieldConfig])[] = [];
    const byName = Object.create(null) as Record<string, ExternalFieldConfig>;
    for (const fieldValue of expectArray(row[1], `rule ${ruleId} fields`)) {
      const field = expectArray(fieldValue, `rule ${ruleId} field`);
      const fieldId = expectNumber(field[0], `rule ${ruleId} field id`);
      const name = fieldNames[fieldId];
      if (name === undefined) {
        throw new Error(
          `Rule ${ruleId} references unknown cursor field id ${fieldId}.`,
        );
      }
      const config = {
        array: expectBoolean(field[1], `cursor field '${name}' array flag`),
        nullable: expectBoolean(
          field[2],
          `cursor field '${name}' nullable flag`,
        ),
        valueArray: expectBoolean(
          field[3],
          `cursor field '${name}' value-array flag`,
        ),
      };
      entries.push([name, config]);
      byName[name] = config;
    }
    fieldSchemas[ruleId] = { entries, byName };
  }

  const parserStateCount = readCoreI32(
    planBytes,
    EXTERNAL_CORE_HEADER_PARSER_STATE_COUNT,
  );
  const expected = externalExpectedRowsFromCorePlan(
    planBytes,
    parserStateCount,
    terminalDisplays,
  );
  return {
    defaultPreserveTrivia,
    eofTerminal,
    parserStateCount,
    conflictProfile,
    specs,
    namedById,
    literalById,
    terminalByNamedTokenId,
    terminalByLiteralId,
    acceptCandidatesByState,
    terminalDisplays,
    expected,
    ruleNames,
    fieldIds,
    fieldNames,
    fieldSchemas,
  };
}

function decodeExternalCompactRuntimeMetadata(
  compactBytes: Uint8Array,
): Record<string, unknown> {
  const reader = new ExternalCompactReader(compactBytes);
  for (const byte of EXTERNAL_COMPACT_PLAN_MAGIC) {
    if (reader.u8() !== byte) {
      throw new Error("Invalid compact plan magic.");
    }
  }
  const version = reader.u16();
  if (version !== EXTERNAL_COMPACT_PLAN_VERSION) {
    throw new Error(`Unsupported compact plan version ${version}.`);
  }
  const stringCount = reader.varUint();
  const strings: string[] = [];
  const decoder = new TextDecoder();
  for (let index = 0; index < stringCount; index++) {
    const length = reader.varUint();
    strings.push(decoder.decode(reader.bytes(length)));
  }
  reader.strings = strings;
  const payloadLength = reader.varUint();
  const payloadEnd = reader.offset + payloadLength;
  const value = readExternalCompactValue(reader);
  if (reader.offset !== payloadEnd) {
    throw new Error("Compact plan payload has trailing bytes.");
  }
  if (reader.offset !== compactBytes.length) {
    throw new Error("Compact plan file has trailing bytes.");
  }
  return expectRecord(value, "compact runtime metadata");
}

class ExternalCompactReader {
  offset = 0;
  strings: readonly string[] = [];

  constructor(private readonly bytesValue: Uint8Array) {}

  u8(): number {
    if (this.offset >= this.bytesValue.length) {
      throw new Error("Compact plan is truncated.");
    }
    const value = this.bytesValue[this.offset];
    this.offset++;
    return value;
  }

  u16(): number {
    const low = this.u8();
    const high = this.u8();
    return low | (high << 8);
  }

  bytes(length: number): Uint8Array {
    if (length < 0 || this.offset + length > this.bytesValue.length) {
      throw new Error("Compact plan is truncated.");
    }
    const value = this.bytesValue.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  varUint(): number {
    let value = 0;
    let shift = 0;
    while (true) {
      const byte = this.u8();
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        return value;
      }
      shift += 7;
      if (shift > 35) {
        throw new Error("Compact plan varuint is too large.");
      }
    }
  }

  string(id: number): string {
    const value = this.strings[id];
    if (value === undefined) {
      throw new Error(`Invalid string id ${id}.`);
    }
    return value;
  }
}

function readExternalCompactValue(reader: ExternalCompactReader): unknown {
  const tag = reader.u8();
  if (tag === 0) return null;
  if (tag === 1) return false;
  if (tag === 2) return true;
  if (tag === 3) {
    const value = reader.varUint();
    return (value >>> 1) ^ -(value & 1);
  }
  if (tag === 4) return reader.string(reader.varUint());
  if (tag === 5) {
    const length = reader.varUint();
    const values: unknown[] = [];
    for (let index = 0; index < length; index++) {
      values.push(readExternalCompactValue(reader));
    }
    return values;
  }
  if (tag === 6) {
    const length = reader.varUint();
    const value: Record<string, unknown> = {};
    for (let index = 0; index < length; index++) {
      const key = reader.string(reader.varUint());
      value[key] = readExternalCompactValue(reader);
    }
    return value;
  }
  throw new Error(`Unknown compact plan value tag ${tag}.`);
}

function externalExpectedRowsFromCorePlan(
  planBytes: Uint8Array,
  stateCount: number,
  terminalDisplays: readonly string[],
): readonly (readonly string[])[] {
  const actionRows = decodeExternalCoreSectionOffset(
    readCoreI32(planBytes, EXTERNAL_CORE_HEADER_ACTION_ROWS),
  );
  const actionPairs = decodeExternalCoreSectionOffset(
    readCoreI32(planBytes, EXTERNAL_CORE_HEADER_ACTION_PAIRS),
  );
  const expectedRows: string[][] = [];
  const expectedSeen: Set<string>[] = [];
  for (let state = 0; state < stateCount; state++) {
    expectedRows.push([]);
    expectedSeen.push(new Set());
  }
  for (let state = 0; state < stateCount; state++) {
    const start = readExternalCoreSectionValue(planBytes, actionRows, state);
    const end = readExternalCoreSectionValue(planBytes, actionRows, state + 1);
    const row = expectedRows[state];
    const seen = expectedSeen[state];
    if (row === undefined || seen === undefined) {
      throw new Error(`Wasm parser expected-token state ${state} is missing.`);
    }
    for (let index = start; index < end; index++) {
      const terminal = readExternalCorePairKey(planBytes, actionPairs, index);
      const display = terminalDisplays[terminal];
      if (display === undefined) {
        throw new Error(
          `Wasm parser action ${index} references terminal ${terminal}.`,
        );
      }
      if (!seen.has(display)) {
        seen.add(display);
        row.push(display);
      }
    }
  }
  return expectedRows.map((row) => row.sort());
}

interface ExternalCoreSectionOffset {
  readonly offset: number;
  readonly cellBytes: 2 | 4;
}

function decodeExternalCoreSectionOffset(
  encoded: number,
): ExternalCoreSectionOffset {
  if (encoded <= -EXTERNAL_CORE_COMPACT_U16_OFFSET_BASE) {
    return {
      offset: -encoded - EXTERNAL_CORE_COMPACT_U16_OFFSET_BASE,
      cellBytes: 2,
    };
  }
  if (encoded < -1) {
    return {
      offset: -encoded - EXTERNAL_CORE_COMPACT_I16_OFFSET_TAG,
      cellBytes: 2,
    };
  }
  return { offset: encoded, cellBytes: 4 };
}

function readExternalCoreSectionValue(
  bytes: Uint8Array,
  section: ExternalCoreSectionOffset,
  index: number,
): number {
  const byteOffset = section.offset + index * section.cellBytes;
  if (section.cellBytes === 2) {
    return readU16AtByteOffset(bytes, byteOffset);
  }
  return readI32AtByteOffset(bytes, byteOffset);
}

function readExternalCorePairKey(
  bytes: Uint8Array,
  section: ExternalCoreSectionOffset,
  index: number,
): number {
  if (section.cellBytes === 2) {
    return readU16AtByteOffset(bytes, section.offset + index * 4);
  }
  return readI32AtByteOffset(bytes, section.offset + index * 8);
}

function readCoreI32(planBytes: Uint8Array, headerIndex: number): number {
  return readI32AtByteOffset(planBytes, headerIndex * WASM_I32_BYTES);
}

function readI32AtByteOffset(bytes: Uint8Array, byteOffset: number): number {
  if (byteOffset + WASM_I32_BYTES > bytes.byteLength) {
    throw new Error("Wasm parser plan is truncated.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getInt32(byteOffset, true);
}

function readU16AtByteOffset(bytes: Uint8Array, byteOffset: number): number {
  if (byteOffset + 2 > bytes.byteLength) {
    throw new Error("Wasm parser plan is truncated.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint16(byteOffset, true);
}

function expectRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function expectArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value;
}

function expectNumber(value: unknown, label: string): number {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer.`);
  }
  return value as number;
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  return value;
}

function expectBoolean(value: unknown, label: string): boolean {
  if (value !== true && value !== false) {
    throw new Error(`${label} must be a boolean.`);
  }
  return value;
}

interface ExternalTokenRecord {
  readonly specIndex: number;
  readonly start: number;
  readonly end: number;
  readonly acceptingState: number;
}

interface ExternalLexDiagnostic {
  readonly code: "LEX_UNEXPECTED_CHARACTER";
  readonly message: string;
  readonly span: { readonly start: number; readonly end: number };
}

type ExternalParseDiagnostic = {
  readonly code:
    | "PARSE_LEXICAL_ERROR"
    | "PARSE_UNEXPECTED_TOKEN"
    | "PARSE_TRAILING_INPUT"
    | "PARSER_TRACE_LIMIT"
    | "PARSER_AMBIGUOUS_PARSE"
    | "PARSER_INTERNAL_ERROR";
  readonly message: string;
  readonly span: { readonly start: number; readonly end: number };
  readonly runtimeCode: number;
  readonly runtimeDetail: number;
  readonly runtimeDetailKind: "none" | "parser-state";
  readonly runtimeDetailKindId: number;
  readonly expected?: readonly string[];
  readonly found?: string;
};

const externalCursorTokenNamed = 1;
const externalCursorTokenLiteral = 2;
const externalCursorTokenEof = 3;
const externalCursorTokenError = 4;
const externalParseTraceStatusOk = 0;
const externalParseTraceStatusUnexpected = 1;
const _externalParseTraceStatusInternal = 2;
const externalParseCursorStatusCapacity = 3;
const externalParseTraceStatusTraceLimit = 4;
const externalParseTraceStatusAmbiguous = 5;
const externalCursorValueNull = 0;
const externalCursorValueRef = 1;
const externalCursorValueArray = 2;
const hostLittleEndian = detectHostLittleEndian();

interface ExternalCursorTokenData {
  readonly type: number;
  readonly id: number;
  readonly terminal: number;
  readonly start: number;
  readonly end: number;
  readonly tokenIndex: number;
}

type ExternalTokenTapeEntry =
  | { readonly kind: "record"; readonly record: ExternalTokenRecord }
  | { readonly kind: "eof"; readonly offset: number };

class ExternalTokenTape implements TokenTape {
  private readonly cache: (Token | undefined)[];

  constructor(
    private readonly metadata: ExternalRuntimeMetadata,
    private readonly source: string,
    private readonly entries: readonly ExternalTokenTapeEntry[],
  ) {
    this.cache = new Array(entries.length);
  }

  get length(): number {
    return this.entries.length;
  }

  token(index: number): Token | undefined {
    if (!Number.isInteger(index)) {
      return undefined;
    }
    if (index < 0 || index >= this.entries.length) {
      return undefined;
    }
    const cached = this.cache[index];
    if (cached !== undefined) {
      return cached;
    }
    const entry = this.entries[index];
    if (entry === undefined) {
      throw new Error("Token tape entry is missing.");
    }
    let token: Token;
    if (entry.kind === "eof") {
      token = externalEofToken(entry.offset);
    } else {
      token = materializeExternalTokenRecordValue(
        this.metadata,
        this.source,
        entry.record,
      );
    }
    this.cache[index] = token;
    return token;
  }
}

function lexExternalWasmTape(
  metadata: ExternalRuntimeMetadata,
  wasm: ExternalParserWasmExports,
  planByteLength: number,
  source: string,
  options: LexOptions = {},
): LexTapeResult {
  let preserveTrivia = metadata.defaultPreserveTrivia;
  if (options.preserveTrivia !== undefined) {
    preserveTrivia = options.preserveTrivia;
  }
  const records = lexExternalRecords(wasm, planByteLength, source);
  const entries: ExternalTokenTapeEntry[] = [];
  const diagnostics: ExternalLexDiagnostic[] = [];
  for (const record of records) {
    if (record.specIndex < 0) {
      entries.push({ kind: "record", record });
      diagnostics.push(
        externalUnexpectedCharacterSpan(source, record.start, record.end),
      );
      continue;
    }
    const spec = metadata.specs[record.specIndex];
    if (spec === undefined) {
      throw new Error("Wasm lexer emitted an unknown token spec.");
    }
    if (spec.type === "named") {
      const named = metadata.namedById.get(spec.tokenId);
      if (named === undefined) {
        throw new Error("Wasm lexer emitted an unknown named token spec.");
      }
      if (named.channel === "trivia" && !preserveTrivia) {
        continue;
      }
    }
    entries.push({ kind: "record", record });
  }
  entries.push({ kind: "eof", offset: source.length });
  const tokenTape = new ExternalTokenTape(metadata, source, entries);
  return {
    source,
    tokenTape,
    diagnostics,
  };
}

function parseExternalWasm<Root extends RuleCursor>(
  metadata: ExternalRuntimeMetadata,
  wasm: ExternalParserWasmExports,
  planByteLength: number,
  source: string,
  options?: ParseOptions,
): CursorParseResult<Root> {
  return parseExternalCursorDefault(
    metadata,
    wasm,
    planByteLength,
    source,
    options,
  ) as CursorParseResult<Root>;
}

function parseExternalCursorDefault(
  metadata: ExternalRuntimeMetadata,
  wasm: ExternalParserWasmExports,
  planByteLength: number,
  source: string,
  options: ParseOptions | undefined,
): CursorParseResult<RuleCursor> {
  if (metadata.conflictProfile !== "deterministic") {
    return externalUnsupportedBranchingCursorResult(source);
  }
  return parseExternalCursorWithWasm(
    metadata,
    wasm,
    planByteLength,
    source,
    options,
  );
}

function lexExternalRecords(
  wasm: ExternalParserWasmExports,
  planByteLength: number,
  source: string,
): readonly ExternalTokenRecord[] {
  let maxRecords = source.length;
  if (maxRecords < 1) {
    maxRecords = 1;
  }
  const sourcePtr = align(planByteLength, 8);
  const sourceByteLength = source.length * WASM_UTF16_UNIT_BYTES;
  const tokenPtr = align(sourcePtr + sourceByteLength, WASM_I32_BYTES);
  const recordBytes = WASM_TOKEN_RECORD_I32_COUNT * WASM_I32_BYTES;
  ensureExternalWasmCapacity(
    wasm.memory,
    tokenPtr + maxRecords * recordBytes,
  );
  const view = new DataView(wasm.memory.buffer);
  for (let index = 0; index < source.length; index++) {
    view.setUint16(
      sourcePtr + index * WASM_UTF16_UNIT_BYTES,
      source.charCodeAt(index),
      true,
    );
  }
  const count = wasm.lex_all(sourcePtr, source.length, 0, tokenPtr);
  if (count < 0 || count > maxRecords) {
    throw new Error("Wasm lexer returned an invalid token count.");
  }
  const records: ExternalTokenRecord[] = [];
  for (let index = 0; index < count; index++) {
    const offset = tokenPtr + index * recordBytes;
    records.push({
      specIndex: view.getInt32(offset, true),
      start: view.getInt32(offset + WASM_I32_BYTES, true),
      end: view.getInt32(offset + WASM_I32_BYTES * 2, true),
      acceptingState: view.getInt32(offset + WASM_I32_BYTES * 3, true),
    });
  }
  return records;
}

function validateExternalWasmTrace(
  metadata: ExternalRuntimeMetadata,
  wasm: ExternalParserWasmExports,
  planByteLength: number,
  source: string,
  options: ParseOptions | undefined,
): ValidateParseResult {
  if (metadata.conflictProfile !== "deterministic") {
    return {
      ok: false,
      source,
      diagnostics: [
        externalParseDiagnostic(
          "PARSER_AMBIGUOUS_PARSE",
          "Wasm parser validation requires deterministic parser actions.",
          { start: source.length, end: source.length },
        ),
      ],
    };
  }
  let preserveTrivia = metadata.defaultPreserveTrivia;
  if (options !== undefined && options.preserveTrivia !== undefined) {
    preserveTrivia = options.preserveTrivia;
  }
  const maxTraceActions = externalPositiveLimit(
    options,
    "maxTraceActions",
    1_000_000,
  );
  let tokenCapacity = source.length;
  if (tokenCapacity < 1) {
    tokenCapacity = 1;
  }
  const sourcePtr = align(planByteLength, 8);
  const sourceByteLength = source.length * WASM_UTF16_UNIT_BYTES;
  const tokenPtr = align(sourcePtr + sourceByteLength, WASM_I32_BYTES);
  const tokenRecordBytes = WASM_TOKEN_RECORD_I32_COUNT * WASM_I32_BYTES;
  const tracePtr = align(
    tokenPtr + tokenCapacity * tokenRecordBytes,
    WASM_I32_BYTES,
  );
  const traceCapacity = maxTraceActions;
  const traceByteLength = traceCapacity * WASM_I32_BYTES;
  const stackPtr = align(tracePtr + traceByteLength, WASM_I32_BYTES);
  const stackCapacity = tokenCapacity + 2;
  const stackByteLength = stackCapacity * WASM_I32_BYTES;
  const resultPtr = align(stackPtr + stackByteLength, WASM_I32_BYTES);
  const resultByteLength = WASM_PARSE_TRACE_RESULT_I32_COUNT * WASM_I32_BYTES;
  ensureExternalWasmCapacity(
    wasm.memory,
    resultPtr + resultByteLength,
  );
  let view = new DataView(wasm.memory.buffer);
  for (let index = 0; index < source.length; index++) {
    view.setUint16(
      sourcePtr + index * WASM_UTF16_UNIT_BYTES,
      source.charCodeAt(index),
      true,
    );
  }
  let preserveTriviaFlag = 0;
  if (preserveTrivia) {
    preserveTriviaFlag = 1;
  }
  const status = wasm.parse_trace(
    sourcePtr,
    source.length,
    tokenPtr,
    tokenCapacity,
    tracePtr,
    traceCapacity,
    resultPtr,
    stackPtr,
    stackCapacity,
    preserveTriviaFlag,
    maxTraceActions,
  );
  view = new DataView(wasm.memory.buffer);
  if (status === externalParseTraceStatusOk) {
    return { ok: true, source, diagnostics: [] };
  }
  const errorOffset = view.getInt32(resultPtr + WASM_I32_BYTES * 2, true);
  const errorState = view.getInt32(resultPtr + WASM_I32_BYTES * 3, true);
  const tokenRead = view.getInt32(resultPtr + WASM_I32_BYTES * 4, true);
  return {
    ok: false,
    source,
    diagnostics: [
      externalCursorStatusDiagnostic(
        metadata,
        source,
        view,
        tokenPtr,
        tokenCapacity,
        status,
        errorOffset,
        errorState,
        tokenRead,
      ),
    ],
  };
}

function parseExternalCursorWithWasm(
  metadata: ExternalRuntimeMetadata,
  wasm: ExternalParserWasmExports,
  planByteLength: number,
  source: string,
  options: ParseOptions | undefined,
): CursorParseResult<RuleCursor> {
  let preserveTrivia = metadata.defaultPreserveTrivia;
  if (options !== undefined && options.preserveTrivia !== undefined) {
    preserveTrivia = options.preserveTrivia;
  }
  const maxTraceActions = externalPositiveLimit(
    options,
    "maxTraceActions",
    1_000_000,
  );
  let tokenCapacity = source.length + 1;
  if (tokenCapacity < 1) {
    tokenCapacity = 1;
  }
  let structuralCapacity = (source.length + 2) * 32;
  if (structuralCapacity < 64) {
    structuralCapacity = 64;
  }
  if (structuralCapacity < 1) {
    structuralCapacity = 1;
  }

  while (true) {
    const ruleCapacity = structuralCapacity;
    const childCapacity = structuralCapacity * 4;
    const fieldCapacity = structuralCapacity * 4;
    const valueCapacity = structuralCapacity * 8;
    const valueItemCapacity = structuralCapacity * 8;
    const fragmentCapacity = structuralCapacity;

    const sourcePtr = align(planByteLength, 8);
    const sourceByteLength = source.length * WASM_UTF16_UNIT_BYTES;
    const tokenPtr = align(sourcePtr + sourceByteLength, WASM_I32_BYTES);
    const tokenRecordBytes = WASM_TOKEN_RECORD_I32_COUNT * WASM_I32_BYTES;
    const rulePtr = align(
      tokenPtr + tokenCapacity * tokenRecordBytes,
      WASM_I32_BYTES,
    );
    const ruleRecordBytes = WASM_CURSOR_RULE_RECORD_I32_COUNT *
      WASM_I32_BYTES;
    const childPtr = align(
      rulePtr + ruleCapacity * ruleRecordBytes,
      WASM_I32_BYTES,
    );
    const fieldPtr = align(
      childPtr + childCapacity * WASM_I32_BYTES,
      WASM_I32_BYTES,
    );
    const fieldRecordBytes = WASM_CURSOR_FIELD_RECORD_I32_COUNT *
      WASM_I32_BYTES;
    const valuePtr = align(
      fieldPtr + fieldCapacity * fieldRecordBytes,
      WASM_I32_BYTES,
    );
    const valueRecordBytes = WASM_CURSOR_VALUE_RECORD_I32_COUNT *
      WASM_I32_BYTES;
    const valueItemPtr = align(
      valuePtr + valueCapacity * valueRecordBytes,
      WASM_I32_BYTES,
    );
    const resultPtr = align(
      valueItemPtr + valueItemCapacity * WASM_I32_BYTES,
      WASM_I32_BYTES,
    );
    const resultByteLength = WASM_PARSE_CURSOR_RESULT_I32_COUNT *
      WASM_I32_BYTES;
    const stackPtr = align(resultPtr + resultByteLength, WASM_I32_BYTES);
    const fragmentPtr = align(
      stackPtr + fragmentCapacity * WASM_I32_BYTES,
      WASM_I32_BYTES,
    );
    const fragmentRecordBytes = 9 * WASM_I32_BYTES;
    ensureExternalWasmCapacity(
      wasm.memory,
      fragmentPtr + fragmentCapacity * fragmentRecordBytes,
    );

    let view = new DataView(wasm.memory.buffer);
    for (let index = 0; index < source.length; index++) {
      view.setUint16(
        sourcePtr + index * WASM_UTF16_UNIT_BYTES,
        source.charCodeAt(index),
        true,
      );
    }
    let preserveTriviaFlag = 0;
    if (preserveTrivia) {
      preserveTriviaFlag = 1;
    }
    const status = wasm.parse_cursor(
      sourcePtr,
      source.length,
      tokenPtr,
      tokenCapacity,
      rulePtr,
      ruleCapacity,
      childPtr,
      childCapacity,
      fieldPtr,
      fieldCapacity,
      valuePtr,
      valueCapacity,
      valueItemPtr,
      valueItemCapacity,
      resultPtr,
      stackPtr,
      fragmentPtr,
      fragmentCapacity,
      preserveTriviaFlag,
      maxTraceActions,
    );
    view = new DataView(wasm.memory.buffer);
    const tokenCount = view.getInt32(resultPtr, true);
    const ruleCount = view.getInt32(resultPtr + WASM_I32_BYTES, true);
    const childCount = view.getInt32(resultPtr + WASM_I32_BYTES * 2, true);
    const fieldCount = view.getInt32(resultPtr + WASM_I32_BYTES * 3, true);
    const valueCount = view.getInt32(resultPtr + WASM_I32_BYTES * 4, true);
    const valueItemCount = view.getInt32(resultPtr + WASM_I32_BYTES * 5, true);
    const rootRef = view.getInt32(resultPtr + WASM_I32_BYTES * 6, true);
    const errorOffset = view.getInt32(resultPtr + WASM_I32_BYTES * 7, true);
    const errorState = view.getInt32(resultPtr + WASM_I32_BYTES * 8, true);
    const tokenRead = view.getInt32(resultPtr + WASM_I32_BYTES * 9, true);
    if (status === externalParseCursorStatusCapacity) {
      const nextCapacity = structuralCapacity * 2;
      if (
        nextCapacity <= structuralCapacity ||
        !Number.isSafeInteger(nextCapacity)
      ) {
        return externalFailedCursorParseResult(source, [
          externalParseDiagnostic(
            "PARSER_INTERNAL_ERROR",
            "Wasm cursor parser exceeded host cursor buffer capacity.",
            externalClampSpan(
              { start: errorOffset, end: errorOffset },
              source.length,
            ),
          ),
        ]);
      }
      structuralCapacity = nextCapacity;
      continue;
    }
    if (status !== externalParseTraceStatusOk) {
      return externalFailedCursorParseResult(source, [
        externalCursorStatusDiagnostic(
          metadata,
          source,
          view,
          tokenPtr,
          tokenCapacity,
          status,
          errorOffset,
          errorState,
          tokenRead,
        ),
      ]);
    }
    if (tokenCount < 0 || tokenCount > tokenCapacity) {
      return externalInvalidCursorTapeResult(source);
    }
    if (ruleCount < 0 || ruleCount > ruleCapacity) {
      return externalInvalidCursorTapeResult(source);
    }
    if (childCount < 0 || childCount > childCapacity) {
      return externalInvalidCursorTapeResult(source);
    }
    if (fieldCount < 0 || fieldCount > fieldCapacity) {
      return externalInvalidCursorTapeResult(source);
    }
    if (valueCount < 0 || valueCount > valueCapacity) {
      return externalInvalidCursorTapeResult(source);
    }
    if (valueItemCount < 0 || valueItemCount > valueItemCapacity) {
      return externalInvalidCursorTapeResult(source);
    }
    if (rootRef < 0 || externalCursorRefIsToken(rootRef)) {
      return externalInvalidCursorTapeResult(source);
    }
    const tape = new ExternalCursorTapeView(
      metadata,
      source,
      copyI32Tape(view, tokenPtr, tokenCount * WASM_TOKEN_RECORD_I32_COUNT),
      copyI32Tape(
        view,
        rulePtr,
        ruleCount * WASM_CURSOR_RULE_RECORD_I32_COUNT,
      ),
      copyI32Tape(view, childPtr, childCount),
      copyI32Tape(
        view,
        fieldPtr,
        fieldCount * WASM_CURSOR_FIELD_RECORD_I32_COUNT,
      ),
      copyI32Tape(
        view,
        valuePtr,
        valueCount * WASM_CURSOR_VALUE_RECORD_I32_COUNT,
      ),
      copyI32Tape(view, valueItemPtr, valueItemCount),
    );
    try {
      return {
        ok: true,
        source,
        cursor: tape.cursorForRuleRef(rootRef),
        diagnostics: [],
      };
    } catch (error) {
      return externalFailedCursorParseResult(source, [
        externalInternalParserDiagnostic(error, {
          start: source.length,
          end: source.length,
        }),
      ]);
    }
  }
}

function externalCursorStatusDiagnostic(
  metadata: ExternalRuntimeMetadata,
  source: string,
  view: DataView,
  tokenPtr: number,
  tokenCapacity: number,
  status: number,
  errorOffset: number,
  errorState: number,
  tokenRead: number,
): ExternalParseDiagnostic {
  if (status === externalParseTraceStatusTraceLimit) {
    return externalParseDiagnostic(
      "PARSER_TRACE_LIMIT",
      "Parser exceeded the trace action limit.",
      externalClampSpan(
        { start: errorOffset, end: errorOffset },
        source.length,
      ),
    );
  }
  if (status === externalParseTraceStatusAmbiguous) {
    return externalParseDiagnostic(
      "PARSER_AMBIGUOUS_PARSE",
      "Wasm cursor parser found multiple viable parser actions.",
      externalClampSpan(
        { start: errorOffset, end: errorOffset },
        source.length,
      ),
    );
  }
  if (status === externalParseTraceStatusUnexpected) {
    return externalUnexpectedWasmCursorDiagnostic(
      metadata,
      source,
      view,
      tokenPtr,
      tokenCapacity,
      errorOffset,
      errorState,
      tokenRead,
    );
  }
  return externalParseDiagnostic(
    "PARSER_INTERNAL_ERROR",
    "Wasm cursor parser reported an internal failure.",
    externalClampSpan({ start: errorOffset, end: errorOffset }, source.length),
  );
}

function externalUnexpectedWasmCursorDiagnostic(
  metadata: ExternalRuntimeMetadata,
  source: string,
  view: DataView,
  tokenPtr: number,
  tokenCapacity: number,
  errorOffset: number,
  errorState: number,
  tokenRead: number,
): ExternalParseDiagnostic {
  if (errorOffset >= source.length) {
    return externalCursorUnexpectedTokenDiagnostic(
      metadata,
      source,
      {
        type: externalCursorTokenEof,
        id: -1,
        terminal: metadata.eofTerminal,
        start: source.length,
        end: source.length,
        tokenIndex: tokenRead,
      },
      errorState,
    );
  }
  const record = externalTokenRecordFromWasmBuffer(
    view,
    tokenPtr,
    tokenCapacity,
    tokenRead,
  );
  if (record !== null && record.specIndex < 0) {
    const diagnostic = externalUnexpectedCharacterSpan(
      source,
      record.start,
      record.end,
    );
    return {
      ...externalParseDiagnostic(
        "PARSE_LEXICAL_ERROR",
        diagnostic.message,
        diagnostic.span,
      ),
      found: JSON.stringify(source.slice(record.start, record.end)),
    };
  }
  let token: ExternalCursorTokenData;
  if (record === null) {
    token = {
      type: externalCursorTokenEof,
      id: -1,
      terminal: metadata.eofTerminal,
      start: source.length,
      end: source.length,
      tokenIndex: tokenRead,
    };
  } else {
    token = externalCursorTokenDataFromSpec(
      metadata,
      record.specIndex,
      record.start,
      record.end,
      tokenRead,
    );
    if (token.type === externalCursorTokenError) {
      token = externalCursorErrorToken(
        errorOffset,
        Math.min(errorOffset + 1, source.length),
        tokenRead,
      );
    }
  }
  return externalCursorUnexpectedTokenDiagnostic(
    metadata,
    source,
    token,
    errorState,
  );
}

function externalTokenRecordFromWasmBuffer(
  view: DataView,
  tokenPtr: number,
  tokenCapacity: number,
  index: number,
): ExternalTokenRecord | null {
  if (!Number.isInteger(index) || index < 0 || index >= tokenCapacity) {
    return null;
  }
  const recordBytes = WASM_TOKEN_RECORD_I32_COUNT * WASM_I32_BYTES;
  const offset = tokenPtr + index * recordBytes;
  if (offset < 0 || offset + recordBytes > view.byteLength) {
    return null;
  }
  return {
    specIndex: view.getInt32(offset, true),
    start: view.getInt32(offset + WASM_I32_BYTES, true),
    end: view.getInt32(offset + WASM_I32_BYTES * 2, true),
    acceptingState: view.getInt32(offset + WASM_I32_BYTES * 3, true),
  };
}

function externalInvalidCursorTapeResult(
  source: string,
): CursorParseResult<RuleCursor> {
  return externalFailedCursorParseResult(source, [
    externalParseDiagnostic(
      "PARSER_INTERNAL_ERROR",
      "Wasm cursor parser returned invalid cursor tape bounds.",
      { start: source.length, end: source.length },
    ),
  ]);
}

function externalUnsupportedBranchingCursorResult(
  source: string,
): CursorParseResult<RuleCursor> {
  return externalFailedCursorParseResult(source, [
    externalParseDiagnostic(
      "PARSER_AMBIGUOUS_PARSE",
      "Wasm cursor parser requires deterministic parser actions.",
      { start: source.length, end: source.length },
    ),
  ]);
}

function copyI32Tape(
  view: DataView,
  ptr: number,
  count: number,
): Int32Array {
  if (hostLittleEndian) {
    return new Int32Array(view.buffer, ptr, count).slice();
  }
  const output = new Int32Array(count);
  for (let index = 0; index < count; index++) {
    output[index] = view.getInt32(ptr + index * WASM_I32_BYTES, true);
  }
  return output;
}

function detectHostLittleEndian(): boolean {
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, 1, true);
  const words = new Int32Array(bytes.buffer);
  return words[0] === 1;
}

function externalCursorTokenDataFromSpec(
  metadata: ExternalRuntimeMetadata,
  specIndex: number,
  start: number,
  end: number,
  tokenIndex: number,
): ExternalCursorTokenData {
  const spec = metadata.specs[specIndex];
  if (spec === undefined) {
    return externalCursorErrorToken(start, end, tokenIndex);
  }
  if (spec.type === "literal") {
    const literal = metadata.literalById.get(spec.literalId);
    if (literal === undefined) {
      return externalCursorErrorToken(start, end, tokenIndex);
    }
    return {
      type: externalCursorTokenLiteral,
      id: spec.literalId,
      terminal: externalTerminalForLiteralId(metadata, spec.literalId),
      start,
      end,
      tokenIndex,
    };
  }
  const named = metadata.namedById.get(spec.tokenId);
  if (named === undefined) {
    return externalCursorErrorToken(start, end, tokenIndex);
  }
  let terminal = -1;
  if (named.channel === "main") {
    terminal = externalTerminalForNamedTokenId(metadata, spec.tokenId);
  }
  return {
    type: externalCursorTokenNamed,
    id: spec.tokenId,
    terminal,
    start,
    end,
    tokenIndex,
  };
}

function externalCursorErrorToken(
  start: number,
  end: number,
  tokenIndex: number,
): ExternalCursorTokenData {
  return {
    type: externalCursorTokenError,
    id: -1,
    terminal: -1,
    start,
    end,
    tokenIndex,
  };
}

function materializeExternalTokenRecordValue(
  metadata: ExternalRuntimeMetadata,
  source: string,
  record: ExternalTokenRecord,
): Token {
  if (record.specIndex < 0) {
    return externalErrorToken(source, record.start, record.end);
  }
  const spec = metadata.specs[record.specIndex];
  if (spec === undefined) {
    throw new Error("Wasm lexer emitted an unknown token spec.");
  }
  if (spec.type === "literal") {
    const literal = metadata.literalById.get(spec.literalId);
    if (literal === undefined) {
      throw new Error("Wasm lexer emitted an unknown literal spec.");
    }
    return {
      type: "literal",
      literal: literal.value,
      text: literal.value,
      span: { start: record.start, end: record.end },
      channel: "main",
    };
  }
  const named = metadata.namedById.get(spec.tokenId);
  if (named === undefined) {
    throw new Error("Wasm lexer emitted an unknown named token spec.");
  }
  return externalNamedToken(
    named.name,
    source,
    record.start,
    record.end,
    named.channel,
  );
}

class ExternalCursorTapeView {
  private readonly ruleCache: (RuleCursor | undefined)[] = [];
  private readonly tokenCache: (TokenCursor | undefined)[] = [];

  constructor(
    private readonly metadata: ExternalRuntimeMetadata,
    private readonly source: string,
    private readonly tokenRecords: Int32Array,
    private readonly ruleRecords: Int32Array,
    private readonly childRefs: Int32Array,
    private readonly fieldRecords: Int32Array,
    private readonly valueRecords: Int32Array,
    private readonly valueItems: Int32Array,
  ) {}

  cursorForRuleRef(ref: number): RuleCursor {
    if (externalCursorRefIsToken(ref)) {
      throw new Error("Expected a rule cursor reference.");
    }
    return this.ruleCursor(externalCursorRefIndex(ref));
  }

  private ruleCursor(ruleIndex: number): RuleCursor {
    const cached = this.ruleCache[ruleIndex];
    if (cached !== undefined) return cached;
    const base = ruleIndex * WASM_CURSOR_RULE_RECORD_I32_COUNT;
    if (
      base < 0 ||
      base + WASM_CURSOR_RULE_RECORD_I32_COUNT > this.ruleRecords.length
    ) {
      throw new Error("Cursor references an unknown rule node.");
    }
    const ruleId = this.ruleRecords[base];
    if (ruleId === undefined) {
      throw new Error("Cursor rule record is missing a rule id.");
    }
    const name = this.metadata.ruleNames[ruleId];
    if (name === undefined) {
      throw new Error("Cursor references an unknown rule id.");
    }
    const span = {
      start: this.ruleRecords[base + 1],
      end: this.ruleRecords[base + 2],
    };
    const tokenRange = {
      start: this.ruleRecords[base + 3],
      end: this.ruleRecords[base + 4],
    };
    const childStart = this.ruleRecords[base + 5];
    const childCount = this.ruleRecords[base + 6];
    const fieldStart = this.ruleRecords[base + 7];
    const fieldCount = this.ruleRecords[base + 8];
    if (
      span.start === undefined || span.end === undefined ||
      tokenRange.start === undefined || tokenRange.end === undefined ||
      childStart === undefined || childCount === undefined ||
      fieldStart === undefined || fieldCount === undefined
    ) {
      throw new Error("Cursor rule record is incomplete.");
    }
    let childrenCache: readonly SyntaxCursor[] | undefined;
    const cursor: RuleCursor = {
      type: "rule",
      name,
      span,
      tokenRange,
      childCount,
      child: (index: number): SyntaxCursor | undefined => {
        if (!Number.isInteger(index) || index < 0) return undefined;
        if (index >= childCount) return undefined;
        const ref = this.childRefs[childStart + index];
        if (ref === undefined) {
          throw new Error("Cursor child edge is missing.");
        }
        return this.elementForRef(ref);
      },
      children: (): readonly SyntaxCursor[] => {
        if (childrenCache !== undefined) return childrenCache;
        const children: SyntaxCursor[] = [];
        for (let index = 0; index < childCount; index++) {
          const child = cursor.child(index);
          if (child === undefined) {
            throw new Error("Cursor child edge is missing.");
          }
          children.push(child);
        }
        childrenCache = children;
        return childrenCache;
      },
      field: (name: string): CursorFieldValue | undefined => {
        const schema = this.metadata.fieldSchemas[ruleId];
        if (schema === undefined) return undefined;
        const config = schema.byName[name];
        if (config === undefined) return undefined;
        const expectedFieldId = this.metadata.fieldIds.get(name);
        if (expectedFieldId === undefined) {
          throw new Error(`Unknown field id '${name}'.`);
        }
        if (config.array || config.valueArray) {
          const values: CursorFieldValue[] = [];
          for (let index = 0; index < fieldCount; index++) {
            const fieldRecord = (fieldStart + index) *
              WASM_CURSOR_FIELD_RECORD_I32_COUNT;
            const fieldId = this.fieldRecords[fieldRecord];
            if (fieldId === undefined) {
              throw new Error("Cursor field edge is missing a name.");
            }
            if (fieldId !== expectedFieldId) continue;
            const valueId = this.fieldRecords[fieldRecord + 1];
            if (valueId === undefined) {
              throw new Error("Cursor field edge is missing a value.");
            }
            if (
              config.valueArray &&
              this.valueKind(valueId) === externalCursorValueArray
            ) {
              const start = this.valueRecords[
                valueId * WASM_CURSOR_VALUE_RECORD_I32_COUNT + 2
              ];
              const count = this.valueRecords[
                valueId * WASM_CURSOR_VALUE_RECORD_I32_COUNT + 3
              ];
              if (start === undefined || count === undefined) {
                throw new Error("Cursor field array value is incomplete.");
              }
              for (let item = 0; item < count; item++) {
                const itemId = this.valueItems[start + item];
                if (itemId === undefined) {
                  throw new Error("Cursor field array item is missing.");
                }
                values.push(this.valueForId(itemId));
              }
            } else {
              values.push(this.valueForId(valueId));
            }
          }
          return values;
        }
        for (let index = 0; index < fieldCount; index++) {
          const fieldRecord = (fieldStart + index) *
            WASM_CURSOR_FIELD_RECORD_I32_COUNT;
          const fieldId = this.fieldRecords[fieldRecord];
          if (fieldId === undefined) {
            throw new Error("Cursor field edge is missing a name.");
          }
          if (fieldId !== expectedFieldId) continue;
          const valueId = this.fieldRecords[fieldRecord + 1];
          if (valueId === undefined) {
            throw new Error("Cursor field edge is missing a value.");
          }
          return this.valueForId(valueId);
        }
        if (config.nullable) return null;
        return undefined;
      },
      fieldArray: (name: string): readonly CursorFieldValue[] => {
        const value = cursor.field(name);
        if (Array.isArray(value)) return value;
        if (value === undefined || value === null) return [];
        return [value];
      },
    };
    this.ruleCache[ruleIndex] = cursor;
    return cursor;
  }

  private tokenCursor(tokenIndex: number): TokenCursor {
    const cached = this.tokenCache[tokenIndex];
    if (cached !== undefined) return cached;
    const base = tokenIndex * WASM_TOKEN_RECORD_I32_COUNT;
    if (
      base < 0 || base + WASM_TOKEN_RECORD_I32_COUNT > this.tokenRecords.length
    ) {
      throw new Error("Cursor references an unknown token.");
    }
    const specIndex = this.tokenRecords[base];
    const start = this.tokenRecords[base + 1];
    const end = this.tokenRecords[base + 2];
    if (specIndex === undefined || start === undefined || end === undefined) {
      throw new Error("Cursor token record is incomplete.");
    }
    const spec = this.metadata.specs[specIndex];
    if (spec === undefined) {
      throw new Error("Cursor token references an unknown lexer spec.");
    }
    let tokenType: "named" | "literal";
    let kind: string;
    if (spec.type === "named") {
      const named = this.metadata.namedById.get(spec.tokenId);
      if (named === undefined || named.channel !== "main") {
        throw new Error("Cursor references an unknown named token.");
      }
      tokenType = "named";
      kind = named.name;
    } else {
      const literal = this.metadata.literalById.get(spec.literalId);
      if (literal === undefined) {
        throw new Error("Cursor references an unknown literal token.");
      }
      tokenType = "literal";
      kind = literal.value;
    }
    const span = { start, end };
    const source = this.source;
    const cursor: TokenCursor = {
      type: "token",
      tokenType,
      kind,
      get text() {
        if (tokenType === "literal") return kind;
        return source.slice(start, end);
      },
      span,
      tokenIndex,
    } as unknown as TokenCursor;
    this.tokenCache[tokenIndex] = cursor;
    return cursor;
  }

  private elementForRef(ref: number): SyntaxCursor {
    if (externalCursorRefIsToken(ref)) {
      return this.tokenCursor(externalCursorRefIndex(ref));
    }
    return this.ruleCursor(externalCursorRefIndex(ref));
  }

  private valueKind(valueId: number): number {
    const kind =
      this.valueRecords[valueId * WASM_CURSOR_VALUE_RECORD_I32_COUNT];
    if (kind === undefined) {
      throw new Error("Cursor field value is missing.");
    }
    return kind;
  }

  private valueForId(valueId: number): CursorFieldValue {
    const base = valueId * WASM_CURSOR_VALUE_RECORD_I32_COUNT;
    const kind = this.valueRecords[base];
    if (kind === externalCursorValueNull) return null;
    if (kind === externalCursorValueRef) {
      const ref = this.valueRecords[base + 1];
      if (ref === undefined || ref < 0) {
        throw new Error("Cursor field value is missing a reference.");
      }
      return this.elementForRef(ref);
    }
    if (kind === externalCursorValueArray) {
      const start = this.valueRecords[base + 2];
      const count = this.valueRecords[base + 3];
      if (start === undefined || count === undefined) {
        throw new Error("Cursor field array value is incomplete.");
      }
      const values: CursorFieldValue[] = [];
      for (let index = 0; index < count; index++) {
        const itemId = this.valueItems[start + index];
        if (itemId === undefined) {
          throw new Error("Cursor field array item is missing.");
        }
        values.push(this.valueForId(itemId));
      }
      return values;
    }
    throw new Error("Cursor field value has an unknown kind.");
  }
}

function externalCursorRefIsToken(ref: number): boolean {
  return ref % 2 === 1;
}

function externalCursorRefIndex(ref: number): number {
  return Math.floor(ref / 2);
}

function externalFailedCursorParseResult(
  source: string,
  diagnostics: readonly ExternalParseDiagnostic[],
): CursorParseResult<RuleCursor> {
  return { ok: false, source, cursor: null, diagnostics };
}

function externalCursorUnexpectedTokenDiagnostic(
  metadata: ExternalRuntimeMetadata,
  source: string,
  token: ExternalCursorTokenData,
  state: number,
): ExternalParseDiagnostic {
  let expected: readonly string[] = [];
  const row = metadata.expected[state];
  if (row !== undefined) expected = row;
  const found = externalCursorTokenDisplay(metadata, source, token);
  let code: ExternalParseDiagnostic["code"] = "PARSE_UNEXPECTED_TOKEN";
  if (expected.includes("EOF") && found !== "EOF") {
    code = "PARSE_TRAILING_INPUT";
  }
  return {
    ...externalParseDiagnostic(
      code,
      `Unexpected token ${found}.`,
      externalCursorSpan(token),
      state,
    ),
    expected,
    found,
  };
}

function externalInternalParserDiagnostic(
  error: unknown,
  span: { readonly start: number; readonly end: number },
): ExternalParseDiagnostic {
  let message: string;
  if (error instanceof Error) {
    message = error.message;
  } else {
    message = String(error);
  }
  return externalParseDiagnostic("PARSER_INTERNAL_ERROR", message, span);
}

function externalParseDiagnostic(
  code: ExternalParseDiagnostic["code"],
  message: string,
  span: { readonly start: number; readonly end: number },
  detail = 0,
): ExternalParseDiagnostic {
  const runtimeCode = externalDiagnosticCodeId(code);
  return {
    code,
    message,
    span,
    runtimeCode,
    runtimeDetail: detail,
    runtimeDetailKind: externalDiagnosticDetailKind(runtimeCode),
    runtimeDetailKindId: externalDiagnosticDetailKindId(runtimeCode),
  };
}

function externalDiagnosticCodeId(
  code: ExternalParseDiagnostic["code"],
): number {
  switch (code) {
    case "PARSE_LEXICAL_ERROR":
      return parserDiagnosticCodeParseLexicalError;
    case "PARSE_UNEXPECTED_TOKEN":
      return parserDiagnosticCodeParseUnexpectedToken;
    case "PARSE_TRAILING_INPUT":
      return parserDiagnosticCodeParseTrailingInput;
    case "PARSER_INTERNAL_ERROR":
      return parserDiagnosticCodeInternalError;
    case "PARSER_TRACE_LIMIT":
      return parserDiagnosticCodeTraceLimit;
    case "PARSER_AMBIGUOUS_PARSE":
      return parserDiagnosticCodeAmbiguousParse;
  }
}

function externalDiagnosticDetailKind(
  runtimeCode: number,
): ExternalParseDiagnostic["runtimeDetailKind"] {
  switch (runtimeCode) {
    case parserDiagnosticCodeParseUnexpectedToken:
    case parserDiagnosticCodeParseTrailingInput:
      return "parser-state";
    default:
      return "none";
  }
}

function externalDiagnosticDetailKindId(runtimeCode: number): number {
  switch (runtimeCode) {
    case parserDiagnosticCodeParseUnexpectedToken:
    case parserDiagnosticCodeParseTrailingInput:
      return parserDiagnosticDetailKindParserState;
    default:
      return parserDiagnosticDetailKindNone;
  }
}

function externalUnexpectedCharacterSpan(
  source: string,
  start: number,
  end: number,
): ExternalLexDiagnostic {
  return {
    code: "LEX_UNEXPECTED_CHARACTER",
    message: `Unexpected character ${
      JSON.stringify(source.slice(start, end))
    }.`,
    span: { start, end },
  };
}

function externalTerminalForNamedTokenId(
  metadata: ExternalRuntimeMetadata,
  tokenId: number,
): number {
  const terminal = metadata.terminalByNamedTokenId.get(tokenId);
  if (terminal === undefined) return -1;
  return terminal;
}

function externalTerminalForLiteralId(
  metadata: ExternalRuntimeMetadata,
  literalId: number,
): number {
  const terminal = metadata.terminalByLiteralId.get(literalId);
  if (terminal === undefined) return -1;
  return terminal;
}

function externalCursorTokenDisplay(
  metadata: ExternalRuntimeMetadata,
  source: string,
  token: ExternalCursorTokenData,
): string {
  if (token.type === externalCursorTokenEof) return "EOF";
  if (token.type === externalCursorTokenNamed) {
    const named = metadata.namedById.get(token.id);
    if (named === undefined) {
      throw new Error("Cursor token references an unknown named token.");
    }
    return named.name;
  }
  if (token.type === externalCursorTokenLiteral) {
    const literal = metadata.literalById.get(token.id);
    if (literal === undefined) {
      throw new Error("Cursor token references an unknown literal token.");
    }
    return JSON.stringify(literal.value);
  }
  return JSON.stringify(source.slice(token.start, token.end));
}

function externalNamedToken(
  kind: string,
  source: string,
  start: number,
  end: number,
  channel: "main" | "trivia",
): Token {
  let text: string | undefined;
  return {
    type: "named",
    kind,
    get text() {
      if (text === undefined) {
        text = source.slice(start, end);
      }
      return text;
    },
    span: { start, end },
    channel,
  } as Token;
}

function externalErrorToken(source: string, start: number, end: number): Token {
  return {
    type: "error",
    text: source.slice(start, end),
    span: { start, end },
    channel: "error",
  };
}

function externalEofToken(offset: number): Token {
  return {
    type: "eof",
    text: "",
    span: { start: offset, end: offset },
    channel: "main",
  };
}

function externalCursorSpan(
  token: ExternalCursorTokenData,
): { start: number; end: number } {
  return { start: token.start, end: token.end };
}

function externalClampSpan(
  span: { readonly start: number; readonly end: number },
  sourceLength: number,
): { start: number; end: number } {
  const start = Math.min(Math.max(0, span.start), sourceLength);
  const end = Math.min(Math.max(start, span.end), sourceLength);
  return { start, end };
}

function externalPositiveLimit(
  options: ParseOptions | undefined,
  key: "maxTraceActions",
  fallback: number,
): number {
  if (options === undefined) return fallback;
  const value = options[key];
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  return fallback;
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function externalWasmModule(
  options: ParserInstanceOptions,
): WebAssembly.Module {
  if (options.module !== undefined) {
    return options.module;
  }
  if (options.bytes === undefined) {
    throw new Error("Wasm parser creation requires bytes or module.");
  }
  const copy = new Uint8Array(options.bytes.byteLength);
  copy.set(options.bytes);
  return new WebAssembly.Module(copy);
}

function validateStaticExternalWasmAbi(wasm: ExternalParserWasmExports): void {
  if (wasm.abi_version() !== WASM_ABI_VERSION) {
    throw new Error("Wasm ABI version does not match shared adapter.");
  }
  if (wasm.semantics_version() !== RUNTIME_IMPLEMENTATION_METADATA.version) {
    throw new Error(
      "Wasm runtime semantics version does not match shared adapter.",
    );
  }
  if (wasm.max_pages() !== WASM_MAX_PAGES) {
    throw new Error("Wasm max page count does not match shared adapter.");
  }
  if (wasm.source_encoding() !== WASM_SOURCE_ENCODING_UTF16) {
    throw new Error("Wasm source encoding is not UTF-16.");
  }
  if (wasm.span_unit() !== WASM_SPAN_UNIT_UTF16) {
    throw new Error("Wasm span unit is not UTF-16.");
  }
  if (wasm.lex_result_i32_count() !== WASM_LEX_RESULT_I32_COUNT) {
    throw new Error("Wasm lex result width does not match shared adapter.");
  }
  if (wasm.token_record_i32_count() !== WASM_TOKEN_RECORD_I32_COUNT) {
    throw new Error("Wasm token record width does not match shared adapter.");
  }
  if (wasm.host_ownership_model() !== WASM_HOST_OWNERSHIP_CALLER_MANAGED) {
    throw new Error("Wasm host ownership model does not match shared adapter.");
  }
  if (wasm.result_lifetime_model() !== WASM_RESULT_LIFETIME_CALLER_BUFFER) {
    throw new Error(
      "Wasm result lifetime model does not match shared adapter.",
    );
  }
}

function loadExternalWasmPlan(
  wasm: ExternalParserWasmExports,
  planBytes: Uint8Array,
): number {
  const planPtr = wasm.plan_buffer_base();
  if (!Number.isSafeInteger(planPtr) || planPtr <= 0) {
    throw new Error("Wasm parser plan buffer base is invalid.");
  }
  if (planPtr % WASM_I32_BYTES !== 0) {
    throw new Error("Wasm parser plan buffer base is not i32-aligned.");
  }
  ensureExternalWasmCapacity(wasm.memory, planPtr + planBytes.byteLength);
  new Uint8Array(wasm.memory.buffer, planPtr, planBytes.byteLength).set(
    planBytes,
  );
  const loaded = wasm.load_plan(planPtr, planBytes.byteLength);
  if (loaded !== 1) {
    throw new Error("Wasm parser rejected parser plan bytes.");
  }
  return planPtr;
}

function validateLoadedExternalWasmAbi(
  wasm: ExternalParserWasmExports,
  parserPlanVersionToMatch: number,
  planPtr: number,
  coreByteLength: number,
): number {
  if (wasm.plan_version() !== parserPlanVersionToMatch) {
    throw new Error("Wasm parser plan version does not match shared adapter.");
  }
  const inputBase = wasm.input_base();
  if (inputBase < 0) {
    throw new Error("Wasm input base is invalid.");
  }
  if (inputBase < planPtr + coreByteLength) {
    throw new Error("Wasm input base overlaps the loaded core plan.");
  }
  return inputBase;
}

function ensureExternalWasmCapacity(
  memory: WebAssembly.Memory,
  requiredBytes: number,
): void {
  if (!Number.isSafeInteger(requiredBytes) || requiredBytes < 0) {
    throw new RangeError("requiredBytes must be a non-negative safe integer.");
  }
  if (requiredBytes <= memory.buffer.byteLength) {
    return;
  }
  const requiredPages = Math.ceil(requiredBytes / WASM_PAGE_BYTES);
  if (requiredPages > WASM_MAX_PAGES) {
    throw new RangeError("Wasm parser plan exceeds maximum memory pages.");
  }
  const currentPages = memory.buffer.byteLength / WASM_PAGE_BYTES;
  memory.grow(requiredPages - currentPages);
}
