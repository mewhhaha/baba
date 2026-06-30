/**
 * Async parser-engine facade for the future shared generic Wasm executor.
 *
 * The current implementation prepares one process-local generic runtime slot and
 * delegates execution to the shared parser-plan adapter. Keeping this boundary
 * explicit lets generated adapters and callers opt into async Wasm/auto parser
 * lifecycles without reintroducing per-grammar Wasm payloads.
 *
 * @module
 */

import {
  createParser as createPlanParser,
  type CreateParserOptions,
  inflateCompactRuntimePlan,
  type ParseOptions,
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
  type ParseResult,
  type RuleNode,
  type RuntimeParser,
  type RuntimeParserPlan,
  type Token,
  type ValidateParseResult,
} from "./mod.ts";
import {
  decodeCombinedWasmParserPlan,
  validateCombinedWasmParserPlan,
} from "./wasm_plan.ts";
import {
  createSharedGenericWasmExecutor,
  type SharedGenericWasmExecutor,
  type SharedGenericWasmExecutorInstance,
} from "./wasm_executor.ts";
import { RUNTIME_IMPLEMENTATION_METADATA } from "../targets/runtime/implementation.ts";
import {
  WASM_ABI_VERSION,
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
} from "../targets/runtime/wasm_abi.ts";

export type RuntimeEnginePolicy = "shared" | "wasm" | "auto";
export type RuntimeEngine = "shared" | "wasm";
export type RuntimeBackend = "shared" | "generic-wasm" | "wasm+shared";
export type RuntimeTimingPhase =
  | "load runtime"
  | "prepare runtime"
  | "create instance"
  | "select engine"
  | "lex"
  | "parse trace"
  | "build result";

export interface RuntimeTimingEvent {
  readonly phase: RuntimeTimingPhase;
  readonly engine: RuntimeEngine;
  readonly backend: RuntimeBackend;
  readonly elapsedMs: number;
}

export interface SharedWasmRuntimeStats {
  readonly prepared: boolean;
  readonly prepareCount: number;
  readonly wasmBytes: number;
}

export interface WasmParserOptions extends CreateParserOptions {
  readonly timing?: (event: RuntimeTimingEvent) => void;
}

export interface AutoParserOptions extends WasmParserOptions {
  readonly smallInputThreshold?: number;
}

export interface AutoRuntimeParser<Root extends RuleNode = RuleNode>
  extends RuntimeParser<Root> {
  readonly engines: {
    readonly shared: RuntimeParser<Root>;
    readonly wasm: RuntimeParser<Root>;
  };
  readonly root?: Root;
}

export interface ParserInstanceOptions extends CreateParserOptions {
  readonly bytes?: Uint8Array;
  readonly module?: WebAssembly.Module;
  readonly plan?: Uint8Array;
}

export interface AsyncParserInstanceOptions extends ParserInstanceOptions {
  readonly url?: URL;
  readonly planUrl?: URL;
}

export interface ParserInstance<Root extends RuleNode = RuleNode>
  extends RuntimeParser<Root> {
  reset(): void;
  dispose(): void;
}

interface ExternalParserWasmExports {
  memory: WebAssembly.Memory;
  lex_all(
    sourcePtr: number,
    sourceLength: number,
    resultPtr: number,
    tokenPtr: number,
  ): number;
  parser_action(state: number, terminal: number): number;
  parser_actions(
    state: number,
    terminal: number,
    actionPtr: number,
    actionCapacity: number,
  ): number;
  parser_goto(state: number, nonterminal: number): number;
  load_plan(planPtr: number, planLength: number): number;
  abi_version(): number;
  plan_version(): number;
  semantics_version(): number;
  reset(): void;
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
  parserDiagnosticCodeBranchLimit,
  parserDiagnosticCodeInternalError,
  parserDiagnosticCodeParseInvalidTokenStream,
  parserDiagnosticCodeParseLexicalError,
  parserDiagnosticCodeParseTrailingInput,
  parserDiagnosticCodeParseUnexpectedToken,
  parserDiagnosticCodeTraceLimit,
  parserDiagnosticDetailKindNone,
  parserDiagnosticDetailKindParserState,
} from "./mod.ts";

let preparedGenericRuntime = false;
let genericRuntimePrepareCount = 0;
let sharedGenericExecutor: SharedGenericWasmExecutor | undefined;

export function createParser<Root extends RuleNode = RuleNode>(
  options: ParserInstanceOptions = {},
): ParserInstance<Root> {
  if (options.plan === undefined) {
    throw new Error("Wasm parser creation requires parser plan bytes.");
  }
  const planBytes = new Uint8Array(options.plan);
  const validated = validateCombinedWasmParserPlan(planBytes);
  const module = externalWasmModule(options);
  const instance = new WebAssembly.Instance(module, {});
  const wasm = instance.exports as unknown as ExternalParserWasmExports;
  validateStaticExternalWasmAbi(wasm);
  loadExternalWasmPlan(wasm, planBytes);
  validateLoadedExternalWasmAbi(wasm, validated.parserPlanVersion);
  return new ExternalWasmParserInstance(
    planBytes,
    validated.parserPlanVersion,
    wasm,
  );
}

export async function createParserAsync<Root extends RuleNode = RuleNode>(
  options: AsyncParserInstanceOptions = {},
): Promise<ParserInstance<Root>> {
  if (options.url === undefined) {
    return createParser<Root>(options);
  }
  let plan = options.plan;
  if (plan === undefined) {
    if (options.planUrl === undefined) {
      throw new Error(
        "Wasm parser async creation requires plan bytes or planUrl.",
      );
    }
    const planResponse = await fetch(options.planUrl);
    if (!planResponse.ok) {
      throw new Error(
        "Failed to load Wasm parser plan from " + options.planUrl.href + ".",
      );
    }
    plan = new Uint8Array(await planResponse.arrayBuffer());
  }
  const response = await fetch(options.url);
  if (!response.ok) {
    throw new Error(
      "Failed to load Wasm parser module from " + options.url.href + ".",
    );
  }
  return createParser<Root>({
    bytes: new Uint8Array(await response.arrayBuffer()),
    plan,
    validate: options.validate,
  });
}

class ExternalWasmParserInstance<Root extends RuleNode = RuleNode>
  implements ParserInstance<Root> {
  #disposed = false;
  #runtimePlan: RuntimeParserPlan | undefined;
  #metadata: ExternalRuntimeMetadata | undefined;

  readonly parse: ParserInstance<Root>["parse"];
  readonly parseTokens: ParserInstance<Root>["parseTokens"];
  readonly parseTokensUnchecked: ParserInstance<Root>["parseTokensUnchecked"];

  constructor(
    private readonly planBytes: Uint8Array,
    private readonly parserPlanVersionToMatch: number,
    private readonly wasm: ExternalParserWasmExports,
  ) {
    this.parse = ((source: string, options?: ParseOptions) => {
      this.#assertLive();
      return parseExternalWasm<Root>(
        this.#loadMetadata(),
        this.wasm,
        this.planBytes.byteLength,
        source,
        options,
      );
    }) as ParserInstance<Root>["parse"];
    this.parseTokens = ((
      source: string,
      tokens: readonly Token[],
      options?: ParseOptions,
    ) => {
      this.#assertLive();
      return parseExternalWasmTokens<Root>(
        this.#loadMetadata(),
        this.wasm,
        this.planBytes.byteLength,
        source,
        tokens,
        options,
        true,
      );
    }) as ParserInstance<Root>["parseTokens"];
    this.parseTokensUnchecked = ((
      source: string,
      tokens: readonly Token[],
      options?: ParseOptions,
    ) => {
      this.#assertLive();
      return parseExternalWasmTokens<Root>(
        this.#loadMetadata(),
        this.wasm,
        this.planBytes.byteLength,
        source,
        tokens,
        options,
        false,
      );
    }) as ParserInstance<Root>["parseTokensUnchecked"];
  }

  get plan(): RuntimeParserPlan {
    return this.#loadRuntimePlan();
  }

  lex(source: string, options?: Parameters<RuntimeParser["lex"]>[1]) {
    this.#assertLive();
    return lexExternalWasm(
      this.#loadMetadata(),
      this.wasm,
      this.planBytes.byteLength,
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

  #loadRuntimePlan(): RuntimeParserPlan {
    if (this.#runtimePlan !== undefined) {
      return this.#runtimePlan;
    }
    const decoded = decodeCombinedWasmParserPlan(this.planBytes);
    if (decoded.parserPlanVersion !== this.parserPlanVersionToMatch) {
      throw new Error("Wasm parser plan version changed after load.");
    }
    const runtimePlan = inflateCompactRuntimePlan(decoded.compactRuntimePlan);
    if (runtimePlan.portablePlan.version !== decoded.parserPlanVersion) {
      throw new Error("Wasm parser plan version does not match runtime plan.");
    }
    this.#runtimePlan = runtimePlan;
    return runtimePlan;
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
  readonly namedTokenIds: ReadonlyMap<string, number>;
  readonly literalIds: ReadonlyMap<string, number>;
  readonly mainTokenKinds: ReadonlySet<string>;
  readonly triviaTokenKinds: ReadonlySet<string>;
  readonly acceptCandidatesByState: readonly (readonly number[])[];
  readonly productions: readonly ExternalProduction[];
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

interface ExternalProduction {
  readonly id: number;
  readonly lhs: number;
  readonly rhsLength: number;
  readonly reducer: ExternalReducer;
}

type ExternalReducer =
  | { readonly kind: "start" }
  | { readonly kind: "rule"; readonly ruleId: number }
  | { readonly kind: "terminal" }
  | { readonly kind: "ruleRef" }
  | { readonly kind: "identity" }
  | { readonly kind: "sequence" }
  | { readonly kind: "optionalEmpty" }
  | { readonly kind: "optionalSome" }
  | { readonly kind: "repeatEmpty" }
  | { readonly kind: "repeatAppend" }
  | { readonly kind: "repeat1First" }
  | { readonly kind: "repeat1Append" }
  | { readonly kind: "separatedFirst" }
  | { readonly kind: "separatedAppend" }
  | { readonly kind: "field"; readonly name: string };

interface ExternalRuleFieldSchema {
  readonly entries: readonly (readonly [string, ExternalFieldConfig])[];
  readonly byName: Record<string, ExternalFieldConfig>;
}

interface ExternalFieldConfig {
  readonly array: boolean;
  readonly nullable: boolean;
}

const EXTERNAL_CORE_HEADER_PARSER_STATE_COUNT = 4;
const EXTERNAL_CORE_HEADER_ACTION_ROWS = 9;
const EXTERNAL_CORE_HEADER_ACTION_PAIRS = 10;
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
  const meta = expectArray(compact.m, "runtime metadata header");
  const parserPlanVersion = expectNumber(meta[1], "parser plan version");
  if (parserPlanVersion !== validated.parserPlanVersion) {
    throw new Error(
      "Wasm parser plan version does not match runtime metadata.",
    );
  }

  const grammar = expectArray(compact.g, "grammar metadata");
  const tokenSection = expectArray(compact.t, "token metadata");
  const lexer = expectArray(compact.l, "lexer metadata");
  const bnf = expectArray(compact.b, "BNF metadata");
  const lr = expectArray(compact.r, "LR metadata");
  const fields = expectArray(compact.f, "field metadata");

  const ruleNames = decodeExternalRuleNames(grammar);
  const tokenMetadata = decodeExternalTokenMetadata(tokenSection);
  const lexerMetadata = decodeExternalLexerMetadata(lexer);
  const bnfMetadata = decodeExternalBnfMetadata(
    bnf,
    tokenMetadata.namedById,
    tokenMetadata.literalById,
  );
  const fieldMetadata = decodeExternalFieldMetadata(fields);
  const parserStateCount = readCoreI32(
    planBytes,
    EXTERNAL_CORE_HEADER_PARSER_STATE_COUNT,
  );
  const expected = externalExpectedRowsFromCorePlan(
    planBytes,
    parserStateCount,
    bnfMetadata.terminalDisplays,
  );
  const conflictProfileValue = expectNumber(lr[0], "LR conflict profile");
  let conflictProfile: "deterministic" | "branching" = "deterministic";
  if (conflictProfileValue === 1) {
    conflictProfile = "branching";
  } else if (conflictProfileValue !== 0) {
    throw new Error("Unsupported LR conflict profile in Wasm parser plan.");
  }
  const lrStateCount = expectNumber(lr[1], "LR state count");
  if (lrStateCount !== parserStateCount) {
    throw new Error("Wasm parser plan state count does not match metadata.");
  }

  return {
    defaultPreserveTrivia: lexerMetadata.defaultPreserveTrivia,
    eofTerminal: bnfMetadata.eofTerminal,
    parserStateCount,
    conflictProfile,
    specs: lexerMetadata.specs,
    namedById: tokenMetadata.namedById,
    literalById: tokenMetadata.literalById,
    terminalByNamedTokenId: bnfMetadata.terminalByNamedTokenId,
    terminalByLiteralId: bnfMetadata.terminalByLiteralId,
    namedTokenIds: tokenMetadata.namedTokenIds,
    literalIds: tokenMetadata.literalIds,
    mainTokenKinds: tokenMetadata.mainTokenKinds,
    triviaTokenKinds: tokenMetadata.triviaTokenKinds,
    acceptCandidatesByState: lexerMetadata.acceptCandidatesByState,
    productions: bnfMetadata.productions,
    terminalDisplays: bnfMetadata.terminalDisplays,
    expected,
    ruleNames,
    fieldIds: fieldMetadata.fieldIds,
    fieldNames: fieldMetadata.fieldNames,
    fieldSchemas: fieldMetadata.fieldSchemas,
  };
}

function decodeExternalCompactRuntimeMetadata(
  compactBytes: Uint8Array,
): Record<string, unknown> {
  const reader = new ExternalCompactReader(compactBytes);
  for (const byte of EXTERNAL_COMPACT_PLAN_MAGIC) {
    if (reader.u8() !== byte) throw new Error("Invalid compact plan magic.");
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
  const root = readExternalCompactRuntimeRoot(reader);
  if (reader.offset !== payloadEnd) {
    throw new Error("Compact plan payload has trailing bytes.");
  }
  if (reader.offset !== compactBytes.length) {
    throw new Error("Compact plan file has trailing bytes.");
  }
  return root;
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
      if ((byte & 0x80) === 0) return value;
      shift += 7;
      if (shift > 35) throw new Error("Compact plan varuint is too large.");
    }
  }

  string(id: number): string {
    const value = this.strings[id];
    if (value === undefined) throw new Error(`Invalid string id ${id}.`);
    return value;
  }
}

function readExternalCompactRuntimeRoot(
  reader: ExternalCompactReader,
): Record<string, unknown> {
  const tag = reader.u8();
  if (tag !== 6) {
    throw new Error("Compact runtime metadata root must be an object.");
  }
  const length = reader.varUint();
  const root: Record<string, unknown> = {};
  for (let index = 0; index < length; index++) {
    const key = reader.string(reader.varUint());
    if (key === "m") {
      root.m = readExternalCompactValue(reader);
    } else if (key === "g") {
      root.g = readExternalCompactValue(reader);
    } else if (key === "t") {
      root.t = readExternalCompactValue(reader);
    } else if (key === "l") {
      root.l = readExternalCompactLexerSection(reader);
    } else if (key === "b") {
      root.b = readExternalCompactValue(reader);
    } else if (key === "r") {
      root.r = readExternalCompactLrSection(reader);
    } else if (key === "f") {
      root.f = readExternalCompactValue(reader);
    } else {
      skipExternalCompactValue(reader);
    }
  }
  for (const key of ["m", "g", "t", "l", "b", "r", "f"]) {
    if (!(key in root)) {
      throw new Error(`Compact runtime metadata is missing '${key}'.`);
    }
  }
  return root;
}

function readExternalCompactLexerSection(
  reader: ExternalCompactReader,
): readonly unknown[] {
  const length = beginExternalCompactArray(reader, "lexer metadata");
  if (length !== 6) {
    throw new Error("Lexer metadata has an unsupported shape.");
  }
  const defaultPreserveTrivia = readExternalCompactValue(reader);
  const specs = readExternalCompactValue(reader);
  skipExternalCompactValue(reader);
  skipExternalCompactValue(reader);
  skipExternalCompactValue(reader);
  const acceptCandidates = readExternalCompactValue(reader);
  return [
    defaultPreserveTrivia,
    specs,
    null,
    null,
    null,
    acceptCandidates,
  ];
}

function readExternalCompactLrSection(
  reader: ExternalCompactReader,
): readonly unknown[] {
  const length = beginExternalCompactArray(reader, "LR metadata");
  if (length !== 5) {
    throw new Error("LR metadata has an unsupported shape.");
  }
  const conflictProfile = readExternalCompactValue(reader);
  const stateCount = readExternalCompactValue(reader);
  skipExternalCompactValue(reader);
  skipExternalCompactValue(reader);
  skipExternalCompactValue(reader);
  return [conflictProfile, stateCount];
}

function readExternalCompactValue(
  reader: ExternalCompactReader,
): unknown {
  const tag = reader.u8();
  if (tag === 0) return null;
  if (tag === 1) return false;
  if (tag === 2) return true;
  if (tag === 3) return readExternalCompactZigZag(reader);
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

function skipExternalCompactValue(reader: ExternalCompactReader): void {
  const tag = reader.u8();
  if (tag === 0 || tag === 1 || tag === 2) return;
  if (tag === 3) {
    skipExternalCompactVarUint(reader);
    return;
  }
  if (tag === 4) {
    reader.varUint();
    return;
  }
  if (tag === 5) {
    const length = reader.varUint();
    for (let index = 0; index < length; index++) {
      skipExternalCompactValue(reader);
    }
    return;
  }
  if (tag === 6) {
    const length = reader.varUint();
    for (let index = 0; index < length; index++) {
      reader.varUint();
      skipExternalCompactValue(reader);
    }
    return;
  }
  throw new Error(`Unknown compact plan value tag ${tag}.`);
}

function beginExternalCompactArray(
  reader: ExternalCompactReader,
  label: string,
): number {
  const tag = reader.u8();
  if (tag !== 5) {
    throw new Error(`${label} must be an array.`);
  }
  return reader.varUint();
}

function readExternalCompactZigZag(reader: ExternalCompactReader): number {
  const value = reader.varUint();
  return (value >>> 1) ^ -(value & 1);
}

function skipExternalCompactVarUint(reader: ExternalCompactReader): void {
  while (true) {
    const byte = reader.u8();
    if ((byte & 0x80) === 0) return;
  }
}

function decodeExternalRuleNames(
  grammar: readonly unknown[],
): readonly string[] {
  const rules = expectArray(grammar[4], "grammar rules");
  const ruleNames: string[] = [];
  for (const entry of rules) {
    const row = expectArray(entry, "grammar rule");
    const id = expectNumber(row[0], "grammar rule id");
    const name = expectString(row[1], "grammar rule name");
    ruleNames[id] = name;
  }
  return ruleNames;
}

function decodeExternalTokenMetadata(tokenSection: readonly unknown[]): {
  readonly namedById: ReadonlyMap<number, ExternalNamedToken>;
  readonly literalById: ReadonlyMap<number, ExternalLiteralToken>;
  readonly namedTokenIds: ReadonlyMap<string, number>;
  readonly literalIds: ReadonlyMap<string, number>;
  readonly mainTokenKinds: ReadonlySet<string>;
  readonly triviaTokenKinds: ReadonlySet<string>;
} {
  const namedTokens = expectArray(tokenSection[0], "named token metadata");
  const literalTokens = expectArray(tokenSection[1], "literal token metadata");
  const namedById = new Map<number, ExternalNamedToken>();
  const literalById = new Map<number, ExternalLiteralToken>();
  const namedTokenIds = new Map<string, number>();
  const literalIds = new Map<string, number>();
  const mainTokenKinds = new Set<string>();
  const triviaTokenKinds = new Set<string>();
  for (const entry of namedTokens) {
    const row = expectArray(entry, "named token metadata row");
    const id = expectNumber(row[0], "named token id");
    const name = expectString(row[1], "named token name");
    const kind = expectNumber(row[2], "named token kind");
    let channel: "main" | "trivia";
    if (kind === 0) {
      channel = "main";
      mainTokenKinds.add(name);
    } else if (kind === 1) {
      channel = "trivia";
      triviaTokenKinds.add(name);
    } else {
      throw new Error("Unsupported named token kind in Wasm parser plan.");
    }
    namedById.set(id, { id, name, channel });
    namedTokenIds.set(name, id);
  }
  for (const entry of literalTokens) {
    const row = expectArray(entry, "literal token metadata row");
    const id = expectNumber(row[0], "literal token id");
    const value = expectString(row[1], "literal token value");
    literalById.set(id, { id, value });
    literalIds.set(value, id);
  }
  return {
    namedById,
    literalById,
    namedTokenIds,
    literalIds,
    mainTokenKinds,
    triviaTokenKinds,
  };
}

function decodeExternalLexerMetadata(lexer: readonly unknown[]): {
  readonly defaultPreserveTrivia: boolean;
  readonly specs: readonly ExternalLexerSpec[];
  readonly acceptCandidatesByState: readonly (readonly number[])[];
} {
  const defaultPreserveTrivia = expectBoolean(
    lexer[0],
    "lexer preserveTrivia default",
  );
  const specRows = expectArray(lexer[1], "lexer specs");
  const specs: ExternalLexerSpec[] = [];
  for (const entry of specRows) {
    const row = expectArray(entry, "lexer spec");
    const kind = expectNumber(row[0], "lexer spec kind");
    const id = expectNumber(row[1], "lexer spec id");
    if (kind === 0) {
      specs.push({ type: "named", tokenId: id });
    } else if (kind === 1) {
      specs.push({ type: "literal", literalId: id });
    } else {
      throw new Error("Unsupported lexer spec kind in Wasm parser plan.");
    }
  }

  const acceptCandidatesByState: number[][] = [];
  if (Array.isArray(lexer[5])) {
    const rows = expectArray(lexer[5], "lexer accept candidates");
    for (const entry of rows) {
      const row = expectArray(entry, "lexer accept candidate row");
      acceptCandidatesByState.push(
        row.map((value) => expectNumber(value, "lexer accept candidate")),
      );
    }
  }

  return { defaultPreserveTrivia, specs, acceptCandidatesByState };
}

function decodeExternalBnfMetadata(
  bnf: readonly unknown[],
  namedById: ReadonlyMap<number, ExternalNamedToken>,
  literalById: ReadonlyMap<number, ExternalLiteralToken>,
): {
  readonly eofTerminal: number;
  readonly productions: readonly ExternalProduction[];
  readonly terminalDisplays: readonly string[];
  readonly terminalByNamedTokenId: ReadonlyMap<number, number>;
  readonly terminalByLiteralId: ReadonlyMap<number, number>;
} {
  const eofTerminal = expectNumber(bnf[2], "EOF terminal id");
  const terminalRows = expectArray(bnf[3], "BNF terminals");
  const productionRows = expectArray(bnf[5], "BNF productions");
  const terminalDisplays: string[] = [];
  const terminalByNamedTokenId = new Map<number, number>();
  const terminalByLiteralId = new Map<number, number>();
  for (const entry of terminalRows) {
    const row = expectArray(entry, "BNF terminal");
    const id = expectNumber(row[0], "BNF terminal id");
    const kind = expectNumber(row[1], "BNF terminal kind");
    const display = expectString(row[3], "BNF terminal display");
    terminalDisplays[id] = display;
    if (kind === 1) {
      const tokenId = expectNumber(row[4], "BNF named terminal token id");
      if (!namedById.has(tokenId)) {
        throw new Error("BNF terminal references unknown named token.");
      }
      terminalByNamedTokenId.set(tokenId, id);
    } else if (kind === 2) {
      const literalId = expectNumber(row[4], "BNF literal terminal id");
      if (!literalById.has(literalId)) {
        throw new Error("BNF terminal references unknown literal token.");
      }
      terminalByLiteralId.set(literalId, id);
    } else if (kind !== 0) {
      throw new Error("Unsupported BNF terminal kind in Wasm parser plan.");
    }
  }

  const productions: ExternalProduction[] = [];
  for (const entry of productionRows) {
    const row = expectArray(entry, "BNF production");
    const id = expectNumber(row[0], "BNF production id");
    const lhs = expectNumber(row[1], "BNF production lhs");
    const rhs = expectArray(row[2], "BNF production rhs");
    const reducer = decodeExternalReducer(row[3]);
    productions[id] = { id, lhs, rhsLength: rhs.length, reducer };
  }
  return {
    eofTerminal,
    productions,
    terminalDisplays,
    terminalByNamedTokenId,
    terminalByLiteralId,
  };
}

function decodeExternalReducer(value: unknown): ExternalReducer {
  const row = expectArray(value, "BNF reducer");
  const kind = expectNumber(row[0], "BNF reducer kind");
  if (kind === 0) return { kind: "start" };
  if (kind === 1) {
    return { kind: "rule", ruleId: expectNumber(row[1], "rule reducer id") };
  }
  if (kind === 2) return { kind: "terminal" };
  if (kind === 3) return { kind: "ruleRef" };
  if (kind === 4) return { kind: "identity" };
  if (kind === 5) return { kind: "sequence" };
  if (kind === 6) return { kind: "optionalEmpty" };
  if (kind === 7) return { kind: "optionalSome" };
  if (kind === 8) return { kind: "repeatEmpty" };
  if (kind === 9) return { kind: "repeatAppend" };
  if (kind === 10) return { kind: "repeat1First" };
  if (kind === 11) return { kind: "repeat1Append" };
  if (kind === 12) return { kind: "separatedFirst" };
  if (kind === 13) return { kind: "separatedAppend" };
  if (kind === 14) {
    return { kind: "field", name: expectString(row[1], "field reducer name") };
  }
  throw new Error("Unsupported reducer kind in Wasm parser plan.");
}

function decodeExternalFieldMetadata(fields: readonly unknown[]): {
  readonly fieldIds: ReadonlyMap<string, number>;
  readonly fieldNames: readonly string[];
  readonly fieldSchemas: readonly (ExternalRuleFieldSchema | undefined)[];
} {
  const ruleRows = expectArray(fields[1], "field rule metadata");
  const fieldIds = new Map<string, number>();
  const fieldNames: string[] = [];
  const fieldSchemas: (ExternalRuleFieldSchema | undefined)[] = [];
  for (const entry of ruleRows) {
    const row = expectArray(entry, "field rule metadata row");
    const ruleId = expectNumber(row[0], "field rule id");
    const fieldRows = expectArray(row[3], "field rows");
    const entries: (readonly [string, ExternalFieldConfig])[] = [];
    const byName = Object.create(null) as Record<string, ExternalFieldConfig>;
    for (const fieldEntry of fieldRows) {
      const field = expectArray(fieldEntry, "field metadata row");
      const name = expectString(field[0], "field name");
      const config = {
        array: expectBoolean(field[2], "field array flag"),
        nullable: expectBoolean(field[3], "field nullable flag"),
      };
      entries.push([name, config]);
      byName[name] = config;
      if (!fieldIds.has(name)) {
        fieldIds.set(name, fieldIds.size);
        fieldNames.push(name);
      }
    }
    fieldSchemas[ruleId] = { entries, byName };
  }
  return { fieldIds, fieldNames, fieldSchemas };
}

function externalExpectedRowsFromCorePlan(
  planBytes: Uint8Array,
  stateCount: number,
  terminalDisplays: readonly string[],
): readonly (readonly string[])[] {
  const actionRowsOffset = readCoreI32(
    planBytes,
    EXTERNAL_CORE_HEADER_ACTION_ROWS,
  );
  const actionPairsOffset = readCoreI32(
    planBytes,
    EXTERNAL_CORE_HEADER_ACTION_PAIRS,
  );
  const expectedRows: string[][] = [];
  const expectedSeen: Set<string>[] = [];
  for (let state = 0; state < stateCount; state++) {
    expectedRows.push([]);
    expectedSeen.push(new Set());
  }
  for (let state = 0; state < stateCount; state++) {
    const start = readI32AtByteOffset(planBytes, actionRowsOffset + state * 4);
    const end = readI32AtByteOffset(
      planBytes,
      actionRowsOffset + (state + 1) * 4,
    );
    const row = expectedRows[state];
    const seen = expectedSeen[state];
    if (row === undefined || seen === undefined) {
      throw new Error("Wasm parser expected-token row is out of bounds.");
    }
    for (let index = start; index < end; index++) {
      const terminal = readI32AtByteOffset(
        planBytes,
        actionPairsOffset + index * 8,
      );
      const display = terminalDisplays[terminal];
      if (display === undefined) {
        throw new Error("Wasm parser action references unknown terminal.");
      }
      if (!seen.has(display)) {
        seen.add(display);
        row.push(display);
      }
    }
  }
  return expectedRows.map((row) => row.sort());
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

interface ExternalLexCandidate {
  readonly token: Token;
  readonly terminal: number;
}

interface ExternalLexCandidateSite {
  readonly tokenIndex: number;
  readonly candidates: readonly ExternalLexCandidate[];
}

interface ExternalLexForParseResult {
  readonly source: string;
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly ExternalLexDiagnostic[];
  readonly sites: readonly ExternalLexCandidateSite[];
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
    | "PARSE_INVALID_TOKEN_STREAM"
    | "PARSER_BRANCH_LIMIT"
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

type ExternalInternalParseResult<Root extends RuleNode = RuleNode> =
  | {
    readonly ok: true;
    readonly root: Root;
    readonly source: string;
    readonly tokens: readonly Token[];
    readonly diagnostics: readonly [];
  }
  | {
    readonly ok: true;
    readonly source: string;
    readonly events: readonly ExternalParseEvent[];
    readonly diagnostics: readonly [];
  }
  | {
    readonly ok: true;
    readonly source: string;
    readonly diagnostics: readonly [];
  }
  | {
    readonly ok: false;
    readonly root: null;
    readonly source: string;
    readonly tokens: readonly Token[];
    readonly diagnostics: readonly ExternalParseDiagnostic[];
  }
  | {
    readonly ok: false;
    readonly source: string;
    readonly events: readonly [];
    readonly diagnostics: readonly ExternalParseDiagnostic[];
  }
  | {
    readonly ok: false;
    readonly source: string;
    readonly diagnostics: readonly ExternalParseDiagnostic[];
  };

type ExternalParseEvent =
  | {
    readonly kind: "token";
    readonly tokenId: number;
    readonly terminalId: number;
    readonly start: number;
    readonly end: number;
  }
  | { readonly kind: "enter"; readonly ruleId: number; readonly start: number }
  | { readonly kind: "exit"; readonly ruleId: number; readonly end: number }
  | { readonly kind: "field"; readonly fieldId: number };

type ExternalParseExecutionMode = "cst" | "validate" | "events";

interface ExternalParseBranch {
  states: number[];
  values: unknown[];
  index: number;
  tokenOverrides: Map<number, Token>;
}

type ExternalBranchAdvanceResult<Root extends RuleNode = RuleNode> =
  | { readonly kind: "continue" }
  | { readonly kind: "forked" }
  | {
    readonly kind: "success";
    readonly result: ExternalInternalParseResult<Root>;
  }
  | { readonly kind: "failure"; readonly failure: ExternalParseFailure };

interface ExternalParseFailure {
  readonly offset: number;
  readonly diagnostic: ExternalParseDiagnostic;
}

interface ExternalContextualStatsState {
  ambiguousLexicalSites: number;
  contextualCandidateChecks: number;
  attemptedTokenSelections: number;
  reductionsBeforeTokenSelection: number;
}

interface ExternalShiftedToken {
  readonly token: Token;
  readonly tokenIndex: number;
}

interface ExternalFragment {
  value: unknown;
  children: unknown[];
  fields: ExternalFieldCapture[];
  span: { start: number; end: number } | null;
  tokenRange: { start: number; end: number } | null;
}

interface ExternalEventFragment {
  events: ExternalParseEvent[];
  span: { start: number; end: number } | null;
  tokenRange: { start: number; end: number } | null;
}

interface ExternalFieldCapture {
  readonly name: string;
  readonly value: unknown;
}

interface ExternalLazyRuleDraft {
  readonly ruleId: number;
  readonly start: number;
  end: number;
  tokenRange: { start: number; end: number } | null;
  children: unknown[];
  fields: ExternalFieldCapture[];
  captureNames: string[];
}

function lexExternalWasm(
  metadata: ExternalRuntimeMetadata,
  wasm: ExternalParserWasmExports,
  planByteLength: number,
  source: string,
  options: Parameters<RuntimeParser["lex"]>[1] = {},
) {
  let preserveTrivia = metadata.defaultPreserveTrivia;
  if (options.preserveTrivia !== undefined) {
    preserveTrivia = options.preserveTrivia;
  }
  const records = lexExternalRecords(wasm, planByteLength, source);
  const tokens: Token[] = [];
  const diagnostics: ExternalLexDiagnostic[] = [];
  for (const record of records) {
    materializeExternalTokenRecord(
      metadata,
      source,
      record,
      preserveTrivia,
      tokens,
      diagnostics,
    );
  }
  tokens.push(externalEofToken(source.length));
  return { source, tokens, diagnostics };
}

function parseExternalWasm<Root extends RuleNode>(
  metadata: ExternalRuntimeMetadata,
  wasm: ExternalParserWasmExports,
  planByteLength: number,
  source: string,
  options?: ParseOptions,
): ParseResult<Root> {
  if (options !== undefined && options.mode === "tokens") {
    return lexExternalWasm(metadata, wasm, planByteLength, source, options);
  }
  if (options !== undefined && options.mode === "cst-lazy") {
    const lexed = lexExternalForParse(
      metadata,
      wasm,
      planByteLength,
      source,
      options,
    );
    const parsed = parseExternalTokenList<Root>(
      metadata,
      wasm,
      planByteLength,
      source,
      lexed.tokens,
      externalLexicalDiagnostics(lexed.diagnostics),
      lexed.sites,
      options,
      "events",
    );
    return externalLazyResultFromEvents<Root>(
      metadata,
      source,
      lexed.tokens,
      parsed,
    );
  }
  const lexed = lexExternalForParse(
    metadata,
    wasm,
    planByteLength,
    source,
    options,
  );
  const mode = externalParseMode(options);
  return parseExternalTokenList<Root>(
    metadata,
    wasm,
    planByteLength,
    source,
    lexed.tokens,
    externalLexicalDiagnostics(lexed.diagnostics),
    lexed.sites,
    options,
    mode,
  ) as ParseResult<Root>;
}

function parseExternalWasmTokens<Root extends RuleNode>(
  metadata: ExternalRuntimeMetadata,
  wasm: ExternalParserWasmExports,
  planByteLength: number,
  source: string,
  tokens: readonly Token[],
  options: ParseOptions | undefined,
  checked: boolean,
): ParseResult<Root> {
  if (options !== undefined && options.mode === "tokens") {
    return { source, tokens, diagnostics: [] };
  }
  const tokenDiagnostics = externalLexicalTokenDiagnostics(metadata, tokens);
  let diagnostics: readonly ExternalParseDiagnostic[] = tokenDiagnostics;
  if (checked) {
    diagnostics = externalCombineDiagnostics(
      validateExternalTokenStream(
        metadata,
        wasm,
        planByteLength,
        source,
        tokens,
      ),
      tokenDiagnostics,
    );
  }
  if (options !== undefined && options.mode === "cst-lazy") {
    const parsed = parseExternalTokenList<Root>(
      metadata,
      wasm,
      planByteLength,
      source,
      tokens,
      diagnostics,
      [],
      options,
      "events",
    );
    return externalLazyResultFromEvents<Root>(metadata, source, tokens, parsed);
  }
  const mode = externalParseMode(options);
  return parseExternalTokenList<Root>(
    metadata,
    wasm,
    planByteLength,
    source,
    tokens,
    diagnostics,
    [],
    options,
    mode,
  ) as ParseResult<Root>;
}

function externalParseMode(
  options: ParseOptions | undefined,
): ExternalParseExecutionMode {
  if (options !== undefined && options.mode === "validate") return "validate";
  if (options !== undefined && options.mode === "events") return "events";
  return "cst";
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

function lexExternalForParse(
  metadata: ExternalRuntimeMetadata,
  wasm: ExternalParserWasmExports,
  planByteLength: number,
  source: string,
  options: ParseOptions | undefined,
): ExternalLexForParseResult {
  let preserveTrivia = metadata.defaultPreserveTrivia;
  if (options !== undefined && options.preserveTrivia !== undefined) {
    preserveTrivia = options.preserveTrivia;
  }
  const records = lexExternalRecords(wasm, planByteLength, source);
  const tokens: Token[] = [];
  const diagnostics: ExternalLexDiagnostic[] = [];
  const sites: ExternalLexCandidateSite[] = [];
  for (const record of records) {
    if (record.specIndex < 0) {
      const token = externalErrorToken(source, record.start, record.end);
      tokens.push(token);
      diagnostics.push(externalUnexpectedCharacter(token));
      continue;
    }
    const candidates = externalCandidateSpecIndices(metadata, record).map(
      (specIndex) =>
        materializeExternalSpecCandidate(
          metadata,
          source,
          specIndex,
          record.start,
          record.end,
        ),
    );
    let trivia: ExternalLexCandidate | undefined;
    const mainCandidates: ExternalLexCandidate[] = [];
    for (const candidate of candidates) {
      if (isExternalTriviaToken(candidate.token)) {
        if (trivia === undefined) {
          trivia = candidate;
        }
      } else if (candidate.terminal >= 0) {
        mainCandidates.push(candidate);
      }
    }
    if (trivia !== undefined && mainCandidates.length === 0) {
      if (preserveTrivia) {
        tokens.push(trivia.token);
      }
      continue;
    }
    if (mainCandidates.length === 0) {
      const token = externalErrorToken(source, record.start, record.end);
      tokens.push(token);
      diagnostics.push(externalUnexpectedCharacter(token));
      continue;
    }
    const tokenIndex = tokens.length;
    tokens.push(mainCandidates[0].token);
    sites.push({ tokenIndex, candidates: mainCandidates });
  }
  const eof = externalEofToken(source.length);
  const eofIndex = tokens.length;
  tokens.push(eof);
  sites.push({
    tokenIndex: eofIndex,
    candidates: [{ token: eof, terminal: metadata.eofTerminal }],
  });
  return { source, tokens, diagnostics, sites };
}

function materializeExternalTokenRecord(
  metadata: ExternalRuntimeMetadata,
  source: string,
  record: ExternalTokenRecord,
  preserveTrivia: boolean,
  tokens: Token[],
  diagnostics: ExternalLexDiagnostic[],
): void {
  if (record.specIndex < 0) {
    const token = externalErrorToken(source, record.start, record.end);
    tokens.push(token);
    diagnostics.push(externalUnexpectedCharacter(token));
    return;
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
    tokens.push({
      type: "literal",
      literal: literal.value,
      text: literal.value,
      span: { start: record.start, end: record.end },
      channel: "main",
    });
    return;
  }
  const named = metadata.namedById.get(spec.tokenId);
  if (named === undefined) {
    throw new Error("Wasm lexer emitted an unknown named token spec.");
  }
  if (named.channel === "trivia") {
    if (preserveTrivia) {
      tokens.push(externalNamedToken(
        named.name,
        source,
        record.start,
        record.end,
        "trivia",
      ));
    }
    return;
  }
  tokens.push(externalNamedToken(
    named.name,
    source,
    record.start,
    record.end,
    "main",
  ));
}

function externalCandidateSpecIndices(
  metadata: ExternalRuntimeMetadata,
  record: ExternalTokenRecord,
): readonly number[] {
  const row = metadata.acceptCandidatesByState[record.acceptingState];
  if (row !== undefined && row.length > 0) {
    return row.filter((candidate) => candidate >= 0);
  }
  if (record.specIndex >= 0) {
    return [record.specIndex];
  }
  return [];
}

function materializeExternalSpecCandidate(
  metadata: ExternalRuntimeMetadata,
  source: string,
  specIndex: number,
  start: number,
  end: number,
): ExternalLexCandidate {
  const spec = metadata.specs[specIndex];
  if (spec === undefined) {
    return {
      token: externalErrorToken(source, start, end),
      terminal: -1,
    };
  }
  if (spec.type === "literal") {
    const literal = metadata.literalById.get(spec.literalId);
    if (literal === undefined) {
      return {
        token: externalErrorToken(source, start, end),
        terminal: -1,
      };
    }
    return {
      token: {
        type: "literal",
        literal: literal.value,
        text: literal.value,
        span: { start, end },
        channel: "main",
      },
      terminal: externalTerminalForLiteralId(metadata, spec.literalId),
    };
  }
  const named = metadata.namedById.get(spec.tokenId);
  if (named === undefined) {
    return {
      token: externalErrorToken(source, start, end),
      terminal: -1,
    };
  }
  return {
    token: externalNamedToken(named.name, source, start, end, named.channel),
    terminal: externalTerminalForNamedTokenId(metadata, spec.tokenId),
  };
}

function parseExternalTokenList<Root extends RuleNode>(
  metadata: ExternalRuntimeMetadata,
  wasm: ExternalParserWasmExports,
  planByteLength: number,
  source: string,
  tokens: readonly Token[],
  lexicalDiagnostics: readonly ExternalParseDiagnostic[],
  candidateSites: readonly ExternalLexCandidateSite[],
  options: ParseOptions | undefined,
  mode: ExternalParseExecutionMode,
): ExternalInternalParseResult<Root> {
  if (lexicalDiagnostics.length > 0) {
    return externalFailedParseResult(mode, source, tokens, lexicalDiagnostics);
  }
  const actionBuffer: ExternalActionBuffer = {
    ptr: align(planByteLength, WASM_I32_BYTES),
    capacity: 4,
  };
  const pending: ExternalParseBranch[] = [{
    states: [0],
    values: externalInitialValues(mode),
    index: 0,
    tokenOverrides: new Map(),
  }];
  let bestFailure: ExternalParseFailure | null = null;
  let firstSuccess: ExternalInternalParseResult<Root> | null = null;
  let exploredBranches = 0;
  let traceActions = 0;
  const maxExploredBranches = externalPositiveLimit(
    options,
    "maxExploredBranches",
    1_000,
  );
  const maxTraceActions = externalPositiveLimit(
    options,
    "maxTraceActions",
    1_000_000,
  );
  let ambiguityMode: "first-success" | "reject-ambiguous-success" =
    "first-success";
  if (options !== undefined && options.ambiguityMode !== undefined) {
    ambiguityMode = options.ambiguityMode;
  }
  const sitesByToken = new Map<number, readonly ExternalLexCandidate[]>();
  let ambiguousLexicalSites = 0;
  for (const site of candidateSites) {
    sitesByToken.set(site.tokenIndex, site.candidates);
    if (site.candidates.length > 1) {
      ambiguousLexicalSites++;
    }
  }
  const stats: ExternalContextualStatsState = {
    ambiguousLexicalSites,
    contextualCandidateChecks: 0,
    attemptedTokenSelections: 0,
    reductionsBeforeTokenSelection: 0,
  };

  while (pending.length > 0) {
    const branch = pending.pop();
    if (branch === undefined) {
      throw new Error("Parser branch stack underflow.");
    }
    exploredBranches++;
    if (exploredBranches > maxExploredBranches + 1) {
      externalEmitContextualStats(options, stats);
      if (bestFailure !== null) {
        return externalFailedParseResult(mode, source, tokens, [
          bestFailure.diagnostic,
        ]);
      }
      return externalFailedParseResult(mode, source, tokens, [
        externalParseDiagnostic(
          "PARSER_BRANCH_LIMIT",
          "Parser exceeded the branch exploration limit.",
          { start: source.length, end: source.length },
        ),
      ]);
    }

    while (true) {
      const advanced = advanceExternalBranch<Root>(
        metadata,
        wasm,
        actionBuffer,
        source,
        tokens,
        branch,
        pending,
        sitesByToken,
        stats,
        maxExploredBranches,
        () => {
          traceActions++;
          return traceActions;
        },
        mode,
      );
      if (traceActions > maxTraceActions) {
        externalEmitContextualStats(options, stats);
        return externalFailedParseResult(mode, source, tokens, [
          externalParseDiagnostic(
            "PARSER_TRACE_LIMIT",
            "Parser exceeded the trace action limit.",
            { start: source.length, end: source.length },
          ),
        ]);
      }
      if (advanced.kind === "continue") continue;
      if (advanced.kind === "forked") break;
      if (advanced.kind === "success") {
        if (ambiguityMode === "reject-ambiguous-success") {
          if (firstSuccess !== null) {
            externalEmitContextualStats(options, stats);
            return externalFailedParseResult(mode, source, tokens, [
              externalParseDiagnostic(
                "PARSER_AMBIGUOUS_PARSE",
                "Parser found multiple successful conflict branches.",
                { start: source.length, end: source.length },
              ),
            ]);
          }
          firstSuccess = advanced.result;
          break;
        }
        externalEmitContextualStats(options, stats);
        return advanced.result;
      }
      bestFailure = externalBetterFailure(bestFailure, advanced.failure);
      break;
    }
  }

  externalEmitContextualStats(options, stats);
  if (firstSuccess !== null) return firstSuccess;
  if (bestFailure !== null) {
    return externalFailedParseResult(mode, source, tokens, [
      bestFailure.diagnostic,
    ]);
  }
  return externalFailedParseResult(mode, source, tokens, [
    externalParseDiagnostic(
      "PARSER_INTERNAL_ERROR",
      "Parser exhausted all branches without a diagnostic.",
      { start: source.length, end: source.length },
    ),
  ]);
}

function externalInitialValues(mode: ExternalParseExecutionMode): unknown[] {
  if (mode === "validate") return [];
  return [null];
}

function advanceExternalBranch<Root extends RuleNode>(
  metadata: ExternalRuntimeMetadata,
  wasm: ExternalParserWasmExports,
  actionBuffer: ExternalActionBuffer,
  source: string,
  tokens: readonly Token[],
  branch: ExternalParseBranch,
  pending: ExternalParseBranch[],
  candidateSites: ReadonlyMap<number, readonly ExternalLexCandidate[]>,
  stats: ExternalContextualStatsState,
  maxExploredBranches: number,
  nextTraceAction: () => number,
  mode: ExternalParseExecutionMode,
): ExternalBranchAdvanceResult<Root> {
  branch.index = externalSkipTrivia(tokens, branch.index);
  const token = tokens[branch.index];
  let currentToken: Token;
  if (token === undefined) {
    currentToken = externalEofToken(source.length);
  } else {
    currentToken = token;
  }
  const state = branch.states[branch.states.length - 1];
  if (state === undefined) {
    return externalInternalFailure(
      currentToken,
      "Parser state stack is empty.",
    );
  }
  const choices: { token: Token; action: ExternalAction }[] = [];
  let candidates = candidateSites.get(branch.index);
  if (candidates === undefined) {
    candidates = [{
      token: currentToken,
      terminal: externalTerminalForToken(metadata, currentToken),
    }];
  }
  if (candidates.length > 1) {
    stats.attemptedTokenSelections += candidates.length;
  }
  for (const candidate of candidates) {
    stats.contextualCandidateChecks++;
    if (candidate.terminal < 0) continue;
    const actions = externalParserActions(
      wasm,
      state,
      candidate.terminal,
      actionBuffer,
    );
    for (const action of actions) {
      choices.push({ token: candidate.token, action });
    }
  }

  if (choices.length === 0) {
    return {
      kind: "failure",
      failure: {
        offset: currentToken.span.start,
        diagnostic: externalUnexpectedTokenDiagnostic(
          metadata,
          currentToken,
          state,
        ),
      },
    };
  }

  if (choices.length > 1) {
    if (choices.length > maxExploredBranches) {
      return {
        kind: "failure",
        failure: {
          offset: currentToken.span.start,
          diagnostic: externalParseDiagnostic(
            "PARSER_BRANCH_LIMIT",
            "Parser exceeded the branch exploration limit.",
            currentToken.span,
          ),
        },
      };
    }
    for (let index = choices.length - 1; index >= 0; index--) {
      const fork = cloneExternalBranch(branch);
      const choice = choices[index];
      if (choice === undefined) {
        throw new Error("Parser choice disappeared during branch cloning.");
      }
      const advanced = applyExternalAction<Root>(
        metadata,
        wasm,
        source,
        tokens,
        fork,
        choice.token,
        choice.action,
        candidateSites,
        stats,
        nextTraceAction,
        mode,
      );
      if (advanced.kind === "success" || advanced.kind === "failure") {
        return advanced;
      }
      pending.push(fork);
    }
    return { kind: "forked" };
  }

  const onlyChoice = choices[0];
  if (onlyChoice === undefined) {
    throw new Error("Parser choice list is unexpectedly empty.");
  }
  return applyExternalAction<Root>(
    metadata,
    wasm,
    source,
    tokens,
    branch,
    onlyChoice.token,
    onlyChoice.action,
    candidateSites,
    stats,
    nextTraceAction,
    mode,
  );
}

type ExternalAction =
  | { readonly kind: "shift"; readonly state: number }
  | { readonly kind: "reduce"; readonly production: number }
  | { readonly kind: "accept" };

interface ExternalActionBuffer {
  ptr: number;
  capacity: number;
}

function externalParserActions(
  wasm: ExternalParserWasmExports,
  state: number,
  terminal: number,
  buffer: ExternalActionBuffer,
): readonly ExternalAction[] {
  ensureExternalWasmCapacity(
    wasm.memory,
    buffer.ptr + buffer.capacity * WASM_I32_BYTES,
  );
  let count = wasm.parser_actions(state, terminal, buffer.ptr, buffer.capacity);
  if (count < 0) return [];
  if (count > buffer.capacity) {
    buffer.capacity = count;
    ensureExternalWasmCapacity(
      wasm.memory,
      buffer.ptr + buffer.capacity * WASM_I32_BYTES,
    );
    const retried = wasm.parser_actions(
      state,
      terminal,
      buffer.ptr,
      buffer.capacity,
    );
    if (retried !== count) {
      throw new Error("Wasm parser action set changed during lookup.");
    }
    count = retried;
  }
  const view = new DataView(wasm.memory.buffer);
  const actions: ExternalAction[] = [];
  for (let index = 0; index < count; index++) {
    const encoded = view.getInt32(
      buffer.ptr + index * WASM_I32_BYTES,
      true,
    );
    const action = externalDecodeParserAction(encoded);
    if (action === null) {
      throw new Error("Wasm parser returned an invalid encoded action.");
    }
    actions.push(action);
  }
  return actions;
}

function externalDecodeParserAction(encoded: number): ExternalAction | null {
  if (encoded === 0) return null;
  const kind = encoded & WASM_ACTION_KIND_MASK;
  const payload = encoded & WASM_ACTION_PAYLOAD_MASK;
  if (kind === WASM_ACTION_SHIFT) return { kind: "shift", state: payload };
  if (kind === WASM_ACTION_REDUCE) {
    return { kind: "reduce", production: payload };
  }
  if (kind === WASM_ACTION_ACCEPT) return { kind: "accept" };
  return null;
}

function applyExternalAction<Root extends RuleNode>(
  metadata: ExternalRuntimeMetadata,
  wasm: ExternalParserWasmExports,
  source: string,
  tokens: readonly Token[],
  branch: ExternalParseBranch,
  token: Token,
  action: ExternalAction,
  candidateSites: ReadonlyMap<number, readonly ExternalLexCandidate[]>,
  stats: ExternalContextualStatsState,
  nextTraceAction: () => number,
  mode: ExternalParseExecutionMode,
): ExternalBranchAdvanceResult<Root> {
  nextTraceAction();
  if (action.kind === "shift") {
    branch.states.push(action.state);
    if (mode !== "validate") {
      if (mode === "events") {
        branch.values.push(
          externalEventTokenFragment(metadata, token, branch.index),
        );
      } else {
        branch.values.push({ token, tokenIndex: branch.index });
      }
    }
    if (token !== tokens[branch.index]) {
      branch.tokenOverrides.set(branch.index, token);
    }
    branch.index++;
    return { kind: "continue" };
  }

  if (action.kind === "accept") {
    if (mode === "validate") {
      return {
        kind: "success",
        result: { ok: true, source, diagnostics: [] },
      };
    }
    if (mode === "events") {
      return {
        kind: "success",
        result: externalAcceptedEventResult(
          source,
          branch.values[branch.values.length - 1],
        ),
      };
    }
    return {
      kind: "success",
      result: externalAcceptedParseResult<Root>(
        source,
        tokens,
        branch.values[branch.values.length - 1],
        branch.tokenOverrides,
      ),
    };
  }

  const activeCandidates = candidateSites.get(branch.index);
  if (activeCandidates !== undefined && activeCandidates.length > 1) {
    stats.reductionsBeforeTokenSelection++;
  }

  const production = metadata.productions[action.production];
  if (production === undefined) {
    return externalInternalFailure(
      token,
      "Parser table references an unknown production.",
    );
  }
  let rhsValues: readonly unknown[] = [];
  if (mode !== "validate") {
    if (production.rhsLength > 0) {
      rhsValues = branch.values.splice(
        branch.values.length - production.rhsLength,
        production.rhsLength,
      );
    }
  }
  branch.states.splice(
    branch.states.length - production.rhsLength,
    production.rhsLength,
  );
  let reduced: unknown = null;
  try {
    if (mode === "events") {
      reduced = reduceExternalEventProduction(
        metadata,
        production.reducer,
        rhsValues,
        token.span.start,
        branch.index,
      );
    } else if (mode !== "validate") {
      reduced = reduceExternalProduction(
        metadata,
        production.reducer,
        rhsValues,
        token.span.start,
        branch.index,
      );
    }
  } catch (error) {
    return {
      kind: "failure",
      failure: {
        offset: token.span.start,
        diagnostic: externalInternalParserDiagnostic(error, token.span),
      },
    };
  }
  const gotoSourceState = branch.states[branch.states.length - 1];
  if (gotoSourceState === undefined) {
    return externalInternalFailure(
      token,
      "Parser state stack is empty.",
    );
  }
  const gotoState = wasm.parser_goto(gotoSourceState, production.lhs);
  if (gotoState < 0) {
    return externalInternalFailure(
      token,
      "Parser table is missing a goto entry.",
    );
  }
  branch.states.push(gotoState);
  if (mode !== "validate") {
    branch.values.push(reduced);
  }
  return { kind: "continue" };
}

function reduceExternalProduction(
  metadata: ExternalRuntimeMetadata,
  reducer: ExternalReducer,
  rhs: readonly unknown[],
  offset: number,
  tokenIndex: number,
): unknown {
  switch (reducer.kind) {
    case "start":
      return rhs[0];
    case "rule": {
      const fragment = toExternalFragment(rhs[0]);
      let span = fragment.span;
      if (span === null) {
        span = externalSpanFromChildren(fragment.children);
      }
      if (span === null) {
        span = { start: 0, end: 0 };
      }
      let tokenRange = fragment.tokenRange;
      if (tokenRange === null) {
        tokenRange = externalTokenRangeFromChildren(fragment.children);
      }
      if (tokenRange === null) {
        tokenRange = { start: tokenIndex, end: tokenIndex };
      }
      const name = metadata.ruleNames[reducer.ruleId];
      if (name === undefined) {
        throw new Error("Rule reducer references an unknown rule.");
      }
      return {
        type: "rule",
        name,
        span,
        tokenRange,
        children: fragment.children,
        fields: buildExternalFields(metadata, reducer.ruleId, fragment.fields),
      };
    }
    case "terminal":
      return externalTokenFragment(rhs[0] as ExternalShiftedToken);
    case "ruleRef":
      return externalRuleFragment(rhs[0] as RuleNode);
    case "identity":
    case "optionalSome":
      return toExternalFragment(rhs[0]);
    case "sequence":
      return externalSequenceFragment(rhs, offset, tokenIndex);
    case "optionalEmpty":
      return externalEmptyFragment(null, offset, tokenIndex);
    case "repeatEmpty":
      return externalEmptyFragment([], offset, tokenIndex);
    case "repeatAppend":
    case "repeat1Append":
      return appendExternalFragment(
        toExternalFragment(rhs[0]),
        toExternalFragment(rhs[1]),
      );
    case "repeat1First": {
      const item = toExternalFragment(rhs[0]);
      item.value = [item.value];
      return item;
    }
    case "separatedFirst": {
      const item = toExternalFragment(rhs[0]);
      item.value = [item.value];
      return item;
    }
    case "separatedAppend":
      return appendExternalSeparatedFragment(
        toExternalFragment(rhs[0]),
        toExternalFragment(rhs[1]),
        toExternalFragment(rhs[2]),
      );
    case "field": {
      const fragment = toExternalFragment(rhs[0]);
      return {
        value: fragment.value,
        children: fragment.children,
        fields: [{ name: reducer.name, value: fragment.value }],
        span: fragment.span,
        tokenRange: fragment.tokenRange,
      };
    }
  }
}

function reduceExternalEventProduction(
  metadata: ExternalRuntimeMetadata,
  reducer: ExternalReducer,
  rhs: readonly unknown[],
  offset: number,
  tokenIndex: number,
): ExternalEventFragment {
  switch (reducer.kind) {
    case "start":
      return toExternalEventFragment(rhs[0]);
    case "rule": {
      const fragment = toExternalEventFragment(rhs[0]);
      let span = fragment.span;
      if (span === null) {
        span = { start: offset, end: offset };
      }
      let tokenRange = fragment.tokenRange;
      if (tokenRange === null) {
        tokenRange = { start: tokenIndex, end: tokenIndex };
      }
      return {
        events: [
          { kind: "enter", ruleId: reducer.ruleId, start: span.start },
          ...fragment.events,
          { kind: "exit", ruleId: reducer.ruleId, end: span.end },
        ],
        span,
        tokenRange,
      };
    }
    case "terminal":
    case "ruleRef":
    case "identity":
    case "optionalSome":
      return toExternalEventFragment(rhs[0]);
    case "sequence":
      return externalSequenceEventFragment(rhs, offset, tokenIndex);
    case "optionalEmpty":
    case "repeatEmpty":
      return externalEmptyEventFragment(offset, tokenIndex);
    case "repeatAppend":
    case "repeat1Append":
      return appendExternalEventFragment(
        toExternalEventFragment(rhs[0]),
        toExternalEventFragment(rhs[1]),
      );
    case "repeat1First":
    case "separatedFirst":
      return toExternalEventFragment(rhs[0]);
    case "separatedAppend":
      return appendExternalEventFragment(
        appendExternalEventFragment(
          toExternalEventFragment(rhs[0]),
          toExternalEventFragment(rhs[1]),
        ),
        toExternalEventFragment(rhs[2]),
      );
    case "field": {
      const fragment = toExternalEventFragment(rhs[0]);
      const fieldId = metadata.fieldIds.get(reducer.name);
      let resolvedFieldId = -1;
      if (fieldId !== undefined) {
        resolvedFieldId = fieldId;
      }
      return {
        events: [
          { kind: "field", fieldId: resolvedFieldId },
          ...fragment.events,
        ],
        span: fragment.span,
        tokenRange: fragment.tokenRange,
      };
    }
  }
}

function externalEventTokenFragment(
  metadata: ExternalRuntimeMetadata,
  token: Token,
  tokenIndex: number,
): ExternalEventFragment {
  const events: ExternalParseEvent[] = [];
  if (isExternalMainSyntaxToken(token)) {
    events.push({
      kind: "token",
      tokenId: externalSyntaxTokenId(metadata, token),
      terminalId: externalTerminalForToken(metadata, token),
      start: token.span.start,
      end: token.span.end,
    });
  }
  return {
    events,
    span: token.span,
    tokenRange: { start: tokenIndex, end: tokenIndex + 1 },
  };
}

function externalSequenceEventFragment(
  values: readonly unknown[],
  offset: number,
  tokenIndex: number,
): ExternalEventFragment {
  let combined = externalEmptyEventFragment(offset, tokenIndex);
  for (const value of values) {
    combined = appendExternalEventFragment(
      combined,
      toExternalEventFragment(value),
    );
  }
  return combined;
}

function externalEmptyEventFragment(
  offset: number,
  tokenIndex: number,
): ExternalEventFragment {
  return {
    events: [],
    span: { start: offset, end: offset },
    tokenRange: { start: tokenIndex, end: tokenIndex },
  };
}

function appendExternalEventFragment(
  left: ExternalEventFragment,
  right: ExternalEventFragment,
): ExternalEventFragment {
  return {
    events: [...left.events, ...right.events],
    span: externalCombineSpans(left.span, right.span),
    tokenRange: externalCombineTokenRanges(left.tokenRange, right.tokenRange),
  };
}

function toExternalEventFragment(value: unknown): ExternalEventFragment {
  if (isExternalEventFragment(value)) return value;
  throw new Error("Expected parser reduction event fragment.");
}

function isExternalEventFragment(
  value: unknown,
): value is ExternalEventFragment {
  if (!value || typeof value !== "object") return false;
  if (!("events" in value)) return false;
  return Array.isArray((value as { events?: unknown }).events);
}

function externalSyntaxTokenId(
  metadata: ExternalRuntimeMetadata,
  token: Token,
): number {
  if (token.type === "named") {
    const id = metadata.namedTokenIds.get(token.kind);
    if (id !== undefined) return id;
    return -1;
  }
  if (token.type === "literal") {
    const id = metadata.literalIds.get(token.literal);
    if (id !== undefined) return id;
    return -1;
  }
  return -1;
}

function externalTokenFragment(
  shifted: ExternalShiftedToken,
): ExternalFragment {
  const token = shifted.token;
  if (!isExternalMainSyntaxToken(token)) {
    throw new Error("Expected shifted main syntax token.");
  }
  return {
    value: token,
    children: [token],
    fields: [],
    span: token.span,
    tokenRange: { start: shifted.tokenIndex, end: shifted.tokenIndex + 1 },
  };
}

function externalRuleFragment(node: RuleNode): ExternalFragment {
  return {
    value: node,
    children: [node],
    fields: [],
    span: node.span,
    tokenRange: node.tokenRange,
  };
}

function externalSequenceFragment(
  values: readonly unknown[],
  offset: number,
  tokenIndex: number,
): ExternalFragment {
  const fragmentValues: unknown[] = [];
  const children: unknown[] = [];
  const fields: ExternalFieldCapture[] = [];
  let span: { start: number; end: number } | null = null;
  let tokenRange: { start: number; end: number } | null = null;
  for (const value of values) {
    const part = toExternalFragment(value);
    fragmentValues.push(part.value);
    appendExternalAll(children, part.children);
    appendExternalAll(fields, part.fields);
    span = externalCombineSpans(span, part.span);
    tokenRange = externalCombineTokenRanges(tokenRange, part.tokenRange);
  }
  if (span === null) {
    span = { start: offset, end: offset };
  }
  if (tokenRange === null) {
    tokenRange = { start: tokenIndex, end: tokenIndex };
  }
  return {
    value: fragmentValues,
    children,
    fields,
    span,
    tokenRange,
  };
}

function externalEmptyFragment(
  value: unknown,
  offset: number,
  tokenIndex: number,
): ExternalFragment {
  return {
    value,
    children: [],
    fields: [],
    span: { start: offset, end: offset },
    tokenRange: { start: tokenIndex, end: tokenIndex },
  };
}

function appendExternalFragment(
  list: ExternalFragment,
  item: ExternalFragment,
): ExternalFragment {
  const values = externalMutableArray(list.value);
  values.push(item.value);
  appendExternalAll(list.children, item.children);
  appendExternalAll(list.fields, item.fields);
  return {
    value: values,
    children: list.children,
    fields: list.fields,
    span: externalCombineSpans(list.span, item.span),
    tokenRange: externalCombineTokenRanges(list.tokenRange, item.tokenRange),
  };
}

function appendExternalSeparatedFragment(
  list: ExternalFragment,
  separator: ExternalFragment,
  item: ExternalFragment,
): ExternalFragment {
  const values = externalMutableArray(list.value);
  values.push(item.value);
  appendExternalAll(list.children, separator.children);
  appendExternalAll(list.children, item.children);
  appendExternalAll(list.fields, separator.fields);
  appendExternalAll(list.fields, item.fields);
  return {
    value: values,
    children: list.children,
    fields: list.fields,
    span: externalCombineSpans(
      externalCombineSpans(list.span, separator.span),
      item.span,
    ),
    tokenRange: externalCombineTokenRanges(
      externalCombineTokenRanges(list.tokenRange, separator.tokenRange),
      item.tokenRange,
    ),
  };
}

function toExternalFragment(value: unknown): ExternalFragment {
  if (isExternalFragment(value)) return value;
  if (isExternalRuleNode(value)) return externalRuleFragment(value);
  if (isExternalShiftedToken(value)) return externalTokenFragment(value);
  throw new Error("Expected parser reduction fragment, rule node, or token.");
}

function buildExternalFields(
  metadata: ExternalRuntimeMetadata,
  ruleId: number,
  captures: readonly ExternalFieldCapture[],
): Record<string, unknown> {
  const schema = metadata.fieldSchemas[ruleId];
  if (schema === undefined || schema.entries.length === 0) {
    if (captures.length > 0) {
      throw new Error("Rule has field captures but no field schema.");
    }
    return Object.create(null) as Record<string, unknown>;
  }
  const fields = Object.create(null) as Record<string, unknown>;
  const counts = Object.create(null) as Record<string, number>;
  for (const [name, config] of schema.entries) {
    if (config.array) {
      fields[name] = [];
    } else if (config.nullable) {
      fields[name] = null;
    } else {
      fields[name] = undefined;
    }
    counts[name] = 0;
  }
  for (const capture of captures) {
    const config = schema.byName[capture.name];
    if (config === undefined) {
      throw new Error(`Unknown field capture '${capture.name}'.`);
    }
    let count = counts[capture.name];
    if (count === undefined) count = 0;
    count++;
    counts[capture.name] = count;
    if (config.array) {
      const values = fields[capture.name];
      if (!Array.isArray(values)) {
        throw new Error(
          `Array field '${capture.name}' was not initialized as an array.`,
        );
      }
      values.push(capture.value);
    } else {
      if (count > 1) {
        throw new Error(
          `Scalar field '${capture.name}' was captured more than once.`,
        );
      }
      fields[capture.name] = capture.value;
    }
  }
  for (const [name, config] of schema.entries) {
    let count = counts[name];
    if (count === undefined) count = 0;
    if (config.array) {
      if (!Array.isArray(fields[name])) {
        throw new Error(
          `Array field '${name}' was not initialized as an array.`,
        );
      }
      continue;
    }
    if (!config.nullable && count !== 1) {
      throw new Error(`Required field '${name}' was captured ${count} times.`);
    }
    if (config.nullable && count > 1) {
      throw new Error(`Nullable field '${name}' was captured more than once.`);
    }
  }
  return fields;
}

function externalAcceptedParseResult<Root extends RuleNode>(
  source: string,
  tokens: readonly Token[],
  accepted: unknown,
  tokenOverrides: ReadonlyMap<number, Token>,
): ExternalInternalParseResult<Root> {
  let resultTokens: readonly Token[] = tokens;
  if (tokenOverrides.size > 0) {
    resultTokens = tokens.map((token, index) => {
      const override = tokenOverrides.get(index);
      if (override !== undefined) return override;
      return token;
    });
  }
  let root: RuleNode | null = null;
  if (isExternalRuleNode(accepted)) {
    root = accepted;
  } else if (
    isExternalFragment(accepted) && isExternalRuleNode(accepted.value)
  ) {
    root = accepted.value;
  }
  if (root !== null) {
    return {
      ok: true,
      root: root as Root,
      source,
      tokens: resultTokens,
      diagnostics: [],
    };
  }
  return {
    ok: false,
    root: null,
    source,
    tokens: resultTokens,
    diagnostics: [
      externalParseDiagnostic(
        "PARSER_INTERNAL_ERROR",
        "Parser accepted without producing a root node.",
        { start: source.length, end: source.length },
      ),
    ],
  };
}

function externalAcceptedEventResult(
  source: string,
  accepted: unknown,
): ExternalInternalParseResult {
  if (isExternalEventFragment(accepted)) {
    return {
      ok: true,
      source,
      events: accepted.events,
      diagnostics: [],
    };
  }
  return {
    ok: false,
    source,
    events: [],
    diagnostics: [
      externalParseDiagnostic(
        "PARSER_INTERNAL_ERROR",
        "Parser accepted without producing an event stream.",
        { start: source.length, end: source.length },
      ),
    ],
  };
}

function externalLazyResultFromEvents<Root extends RuleNode>(
  metadata: ExternalRuntimeMetadata,
  source: string,
  tokens: readonly Token[],
  result: ExternalInternalParseResult<Root>,
): ParseResult<Root> {
  if (!result.ok) {
    return {
      ok: false,
      root: null,
      source,
      tokens,
      diagnostics: result.diagnostics,
    };
  }
  if (!("events" in result)) {
    return externalAcceptedParseResult<Root>(
      source,
      tokens,
      null,
      new Map(),
    ) as ParseResult<Root>;
  }
  try {
    const root = externalLazyRootFromEvents(metadata, tokens, result.events);
    if (root !== null) {
      return { ok: true, root: root as Root, source, tokens, diagnostics: [] };
    }
    return externalAcceptedParseResult<Root>(
      source,
      tokens,
      null,
      new Map(),
    ) as ParseResult<Root>;
  } catch (error) {
    return {
      ok: false,
      root: null,
      source,
      tokens,
      diagnostics: [
        externalInternalParserDiagnostic(error, {
          start: source.length,
          end: source.length,
        }),
      ],
    };
  }
}

function externalLazyRootFromEvents(
  metadata: ExternalRuntimeMetadata,
  tokens: readonly Token[],
  events: readonly ExternalParseEvent[],
): RuleNode | null {
  const stack: ExternalLazyRuleDraft[] = [];
  const pendingFields: string[] = [];
  let root: RuleNode | null = null;
  let tokenCursor = 0;
  for (const event of events) {
    switch (event.kind) {
      case "field": {
        const name = metadata.fieldNames[event.fieldId];
        if (name === undefined) {
          pendingFields.push(`#${event.fieldId}`);
        } else {
          pendingFields.push(name);
        }
        break;
      }
      case "enter":
        stack.push({
          ruleId: event.ruleId,
          start: event.start,
          end: event.start,
          tokenRange: null,
          children: [],
          fields: [],
          captureNames: pendingFields.splice(0),
        });
        break;
      case "token": {
        const tokenMatch = findExternalEventToken(tokens, tokenCursor, event);
        tokenCursor = tokenMatch.index + 1;
        attachExternalLazyElement(
          stack,
          tokenMatch.token,
          { start: tokenMatch.index, end: tokenMatch.index + 1 },
          pendingFields.splice(0),
        );
        break;
      }
      case "exit": {
        const draft = stack.pop();
        if (draft === undefined || draft.ruleId !== event.ruleId) {
          throw new Error("Parse event stream has unbalanced rule events.");
        }
        draft.end = event.end;
        const node = createExternalLazyRuleNode(metadata, draft);
        if (stack.length === 0) {
          root = node;
        } else {
          attachExternalLazyElement(
            stack,
            node,
            node.tokenRange,
            draft.captureNames,
          );
        }
        break;
      }
    }
  }
  if (stack.length > 0) {
    throw new Error("Parse event stream ended before all rules exited.");
  }
  return root;
}

function attachExternalLazyElement(
  stack: ExternalLazyRuleDraft[],
  element: unknown,
  tokenRange: { start: number; end: number },
  captureNames: readonly string[],
): void {
  const parent = stack[stack.length - 1];
  if (parent === undefined) {
    throw new Error("Parse event stream emitted syntax outside a rule.");
  }
  parent.children.push(element);
  parent.tokenRange = externalCombineTokenRanges(parent.tokenRange, tokenRange);
  for (const name of captureNames) {
    parent.fields.push({ name, value: element });
  }
}

function createExternalLazyRuleNode(
  metadata: ExternalRuntimeMetadata,
  draft: ExternalLazyRuleDraft,
): RuleNode {
  let childrenCache: readonly unknown[] | undefined;
  let fieldsCache: Record<string, unknown> | undefined;
  const name = metadata.ruleNames[draft.ruleId];
  if (name === undefined) {
    throw new Error("Parse event stream references an unknown rule.");
  }
  const node = {
    type: "rule",
    name,
    span: { start: draft.start, end: draft.end },
    tokenRange: { start: 0, end: 0 },
  } as RuleNode;
  if (draft.tokenRange !== null) {
    node.tokenRange = draft.tokenRange;
  }
  Object.defineProperties(node, {
    children: {
      enumerable: true,
      get() {
        if (childrenCache === undefined) {
          childrenCache = draft.children;
        }
        return childrenCache;
      },
    },
    fields: {
      enumerable: true,
      get() {
        if (fieldsCache === undefined) {
          fieldsCache = buildExternalFields(
            metadata,
            draft.ruleId,
            draft.fields,
          );
        }
        return fieldsCache;
      },
    },
  });
  return node;
}

function findExternalEventToken(
  tokens: readonly Token[],
  startIndex: number,
  event: Extract<ExternalParseEvent, { kind: "token" }>,
): { token: Token; index: number } {
  for (let index = startIndex; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === undefined) continue;
    if (!isExternalMainSyntaxToken(token)) continue;
    if (token.span.start === event.start && token.span.end === event.end) {
      return { token, index };
    }
  }
  throw new Error("Parse event stream referenced an unknown token.");
}

function validateExternalTokenStream(
  metadata: ExternalRuntimeMetadata,
  wasm: ExternalParserWasmExports,
  planByteLength: number,
  source: string,
  tokens: readonly Token[],
): readonly ExternalParseDiagnostic[] {
  const diagnostics: ExternalParseDiagnostic[] = [];
  const canonical = lexExternalWasm(metadata, wasm, planByteLength, source, {
    preserveTrivia: true,
  });
  const canonicalTokens = canonical.tokens;
  let canonicalIndex = 0;
  let previousEnd = 0;
  let eofIndex = -1;

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === undefined) {
      throw new Error("Token stream entry disappeared during validation.");
    }
    const span = token.span;
    if (
      !Number.isInteger(span.start) ||
      !Number.isInteger(span.end) ||
      span.start < 0 ||
      span.end < span.start ||
      span.end > source.length
    ) {
      diagnostics.push(externalInvalidTokenStream(
        `Token at index ${index} has an invalid span.`,
        externalClampSpan(span, source.length),
      ));
      continue;
    }

    if (span.start > previousEnd) {
      const gapDiagnostic = validateExternalSourceGap(
        canonicalTokens,
        previousEnd,
        span.start,
      );
      if (gapDiagnostic !== null) diagnostics.push(gapDiagnostic);
    }
    if (span.start < previousEnd) {
      diagnostics.push(externalInvalidTokenStream(
        `Token at index ${index} overlaps a previous token.`,
        span,
      ));
    }
    previousEnd = Math.max(previousEnd, span.end);

    if (token.type === "eof") {
      const matched = matchExternalCanonicalToken(
        canonicalTokens,
        canonicalIndex,
        token,
      );
      if (matched < 0) {
        diagnostics.push(externalInvalidTokenStream(
          `Token at index ${index} does not match canonical lexer output.`,
          span,
        ));
      } else {
        canonicalIndex = matched + 1;
      }
      if (eofIndex !== -1) {
        diagnostics.push(externalInvalidTokenStream(
          "Token stream contains more than one EOF token.",
          span,
        ));
      }
      eofIndex = index;
      if (
        token.text !== "" ||
        token.channel !== "main" ||
        span.start !== span.end ||
        span.start !== source.length
      ) {
        diagnostics.push(externalInvalidTokenStream(
          "EOF token must have empty text, main channel, and an empty span at the end of the source.",
          span,
        ));
      }
      continue;
    }

    if (eofIndex !== -1) {
      diagnostics.push(externalInvalidTokenStream(
        "Token stream contains tokens after EOF.",
        span,
      ));
    }
    if (span.start === span.end) {
      diagnostics.push(externalInvalidTokenStream(
        `Token at index ${index} has zero width.`,
        span,
      ));
    }
    const sourceText = source.slice(span.start, span.end);
    if (token.text !== sourceText) {
      diagnostics.push(externalInvalidTokenStream(
        `Token at index ${index} text does not match the source slice.`,
        span,
      ));
    }
    validateExternalTokenShape(metadata, token, span, diagnostics);
    const matched = matchExternalCanonicalToken(
      canonicalTokens,
      canonicalIndex,
      token,
    );
    if (matched < 0) {
      diagnostics.push(externalInvalidTokenStream(
        `Token at index ${index} does not match canonical lexer output.`,
        span,
      ));
    } else {
      canonicalIndex = matched + 1;
    }
  }

  if (eofIndex !== -1 && eofIndex !== tokens.length - 1) {
    const eof = tokens[eofIndex];
    let span = { start: source.length, end: source.length };
    if (eof !== undefined) {
      span = eof.span;
    }
    diagnostics.push(externalInvalidTokenStream(
      "EOF must be the final token in the stream.",
      span,
    ));
  }
  if (previousEnd < source.length && eofIndex === -1) {
    const gapDiagnostic = validateExternalSourceGap(
      canonicalTokens,
      previousEnd,
      source.length,
    );
    if (gapDiagnostic !== null) diagnostics.push(gapDiagnostic);
  }
  return diagnostics;
}

function validateExternalTokenShape(
  metadata: ExternalRuntimeMetadata,
  token: Token,
  span: { readonly start: number; readonly end: number },
  diagnostics: ExternalParseDiagnostic[],
): void {
  if (token.type === "literal") {
    if (token.channel !== "main" || token.text !== token.literal) {
      diagnostics.push(externalInvalidTokenStream(
        "Literal tokens must use the main channel and text equal to the literal.",
        span,
      ));
    }
    return;
  }
  if (token.type === "named") {
    if (token.channel !== "main" && token.channel !== "trivia") {
      diagnostics.push(externalInvalidTokenStream(
        "Named tokens must use the main or trivia channel.",
        span,
      ));
    } else if (token.channel === "main") {
      if (!metadata.mainTokenKinds.has(token.kind)) {
        diagnostics.push(externalInvalidTokenStream(
          `Named token kind '${token.kind}' is not a main token kind.`,
          span,
        ));
      }
    } else if (!metadata.triviaTokenKinds.has(token.kind)) {
      diagnostics.push(externalInvalidTokenStream(
        `Named token kind '${token.kind}' is not a trivia token kind.`,
        span,
      ));
    }
    return;
  }
  if (token.type === "error") {
    if (token.channel !== "error") {
      diagnostics.push(externalInvalidTokenStream(
        "Error tokens must use the error channel.",
        span,
      ));
    }
    return;
  }
  diagnostics.push(
    externalInvalidTokenStream("Token has an unknown type.", span),
  );
}

function validateExternalSourceGap(
  canonicalTokens: readonly Token[],
  start: number,
  end: number,
): ExternalParseDiagnostic | null {
  if (start === end) return null;
  for (const token of canonicalTokens) {
    if (token.type === "eof") continue;
    if (token.span.end <= start) continue;
    if (token.span.start >= end) break;
    if (
      token.type !== "named" ||
      token.channel !== "trivia" ||
      token.span.start < start ||
      token.span.end > end
    ) {
      return externalInvalidTokenStream(
        "Token stream omits nontrivia source text.",
        { start, end },
      );
    }
  }
  return null;
}

function matchExternalCanonicalToken(
  canonicalTokens: readonly Token[],
  startIndex: number,
  token: Token,
): number {
  for (let index = startIndex; index < canonicalTokens.length; index++) {
    const canonical = canonicalTokens[index];
    if (canonical === undefined) continue;
    if (canonical.type !== "eof" && isExternalTriviaToken(canonical)) {
      if (sameExternalToken(canonical, token)) return index;
      if (canonical.span.end <= token.span.start) continue;
    }
    if (sameExternalToken(canonical, token)) return index;
    return -1;
  }
  return -1;
}

function sameExternalToken(left: Token, right: Token): boolean {
  if (
    left.type !== right.type ||
    left.text !== right.text ||
    left.channel !== right.channel ||
    left.span.start !== right.span.start ||
    left.span.end !== right.span.end
  ) {
    return false;
  }
  if (left.type === "named" && right.type === "named") {
    return left.kind === right.kind;
  }
  if (left.type === "literal" && right.type === "literal") {
    return left.literal === right.literal;
  }
  return true;
}

function externalLexicalDiagnostics(
  diagnostics: readonly ExternalLexDiagnostic[],
): readonly ExternalParseDiagnostic[] {
  if (diagnostics.length === 0) return [];
  return diagnostics.map((diagnostic) =>
    externalParseDiagnostic(
      "PARSE_LEXICAL_ERROR",
      diagnostic.message,
      diagnostic.span,
    )
  );
}

function externalLexicalTokenDiagnostics(
  metadata: ExternalRuntimeMetadata,
  tokens: readonly Token[],
): readonly ExternalParseDiagnostic[] {
  const diagnostics: ExternalParseDiagnostic[] = [];
  for (const token of tokens) {
    if (token.type !== "error") {
      if (isExternalTriviaToken(token)) continue;
      if (externalTerminalForToken(metadata, token) >= 0) continue;
    }
    diagnostics.push(externalLexicalTokenDiagnostic(metadata, token));
  }
  return diagnostics;
}

function externalLexicalTokenDiagnostic(
  metadata: ExternalRuntimeMetadata,
  token: Token,
): ExternalParseDiagnostic {
  void metadata;
  if (token.type === "error") {
    return {
      ...externalParseDiagnostic(
        "PARSE_LEXICAL_ERROR",
        `Unexpected character ${JSON.stringify(token.text)}.`,
        token.span,
      ),
      found: JSON.stringify(token.text),
    };
  }
  return {
    ...externalParseDiagnostic(
      "PARSE_LEXICAL_ERROR",
      `Token ${
        externalTokenDisplay(token)
      } is not part of this parser's terminal set.`,
      token.span,
    ),
    found: externalTokenDisplay(token),
  };
}

function externalCombineDiagnostics(
  left: readonly ExternalParseDiagnostic[],
  right: readonly ExternalParseDiagnostic[],
): readonly ExternalParseDiagnostic[] {
  if (left.length === 0) return right;
  if (right.length === 0) return left;
  return [...left, ...right];
}

function externalFailedParseResult(
  mode: ExternalParseExecutionMode,
  source: string,
  tokens: readonly Token[],
  diagnostics: readonly ExternalParseDiagnostic[],
): ExternalInternalParseResult {
  if (mode === "validate") return { ok: false, source, diagnostics };
  if (mode === "events") {
    return { ok: false, source, events: [], diagnostics };
  }
  return { ok: false, root: null, source, tokens, diagnostics };
}

function externalUnexpectedTokenDiagnostic(
  metadata: ExternalRuntimeMetadata,
  token: Token,
  state: number,
): ExternalParseDiagnostic {
  let expected: readonly string[] = [];
  const row = metadata.expected[state];
  if (row !== undefined) expected = row;
  const found = externalTokenDisplay(token);
  let code: ExternalParseDiagnostic["code"] = "PARSE_UNEXPECTED_TOKEN";
  if (expected.includes("EOF") && found !== "EOF") {
    code = "PARSE_TRAILING_INPUT";
  }
  return {
    ...externalParseDiagnostic(
      code,
      `Unexpected token ${found}.`,
      token.span,
      state,
    ),
    expected,
    found,
  };
}

function externalInternalFailure<Root extends RuleNode>(
  token: Token,
  message: string,
): ExternalBranchAdvanceResult<Root> {
  return {
    kind: "failure",
    failure: {
      offset: token.span.start,
      diagnostic: externalParseDiagnostic(
        "PARSER_INTERNAL_ERROR",
        message,
        token.span,
      ),
    },
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

function externalInvalidTokenStream(
  message: string,
  span: { readonly start: number; readonly end: number },
): ExternalParseDiagnostic {
  return externalParseDiagnostic("PARSE_INVALID_TOKEN_STREAM", message, span);
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
    case "PARSE_INVALID_TOKEN_STREAM":
      return parserDiagnosticCodeParseInvalidTokenStream;
    case "PARSER_INTERNAL_ERROR":
      return parserDiagnosticCodeInternalError;
    case "PARSER_BRANCH_LIMIT":
      return parserDiagnosticCodeBranchLimit;
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

function externalUnexpectedCharacter(token: Token): ExternalLexDiagnostic {
  return {
    code: "LEX_UNEXPECTED_CHARACTER",
    message: `Unexpected character ${JSON.stringify(token.text)}.`,
    span: token.span,
  };
}

function externalTerminalForToken(
  metadata: ExternalRuntimeMetadata,
  token: Token,
): number {
  if (token.type === "eof") return metadata.eofTerminal;
  if (token.type === "named") {
    if (token.channel !== "main") return -1;
    const tokenId = metadata.namedTokenIds.get(token.kind);
    if (tokenId === undefined) return -1;
    return externalTerminalForNamedTokenId(metadata, tokenId);
  }
  if (token.type === "literal") {
    const literalId = metadata.literalIds.get(token.literal);
    if (literalId === undefined) return -1;
    return externalTerminalForLiteralId(metadata, literalId);
  }
  return -1;
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

function externalTokenDisplay(token: Token): string {
  if (token.type === "eof") return "EOF";
  if (token.type === "named") return token.kind;
  if (token.type === "literal") return JSON.stringify(token.literal);
  return JSON.stringify(token.text);
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

function isExternalTriviaToken(token: Token): boolean {
  return token.type === "named" && token.channel === "trivia";
}

function isExternalMainSyntaxToken(token: unknown): token is Token {
  if (!token || typeof token !== "object") return false;
  const value = token as { type?: unknown; channel?: unknown };
  if (value.type === "literal") return true;
  return value.type === "named" && value.channel === "main";
}

function cloneExternalBranch(branch: ExternalParseBranch): ExternalParseBranch {
  return {
    states: [...branch.states],
    values: branch.values.map(cloneExternalBranchValue),
    index: branch.index,
    tokenOverrides: new Map(branch.tokenOverrides),
  };
}

function cloneExternalBranchValue(value: unknown): unknown {
  if (isExternalFragment(value)) {
    let fragmentValue = value.value;
    if (Array.isArray(value.value)) {
      fragmentValue = [...value.value];
    }
    const fields = value.fields.map((field) => {
      let fieldValue = field.value;
      if (Array.isArray(field.value)) {
        fieldValue = [...field.value];
      }
      return { name: field.name, value: fieldValue };
    });
    let span = value.span;
    if (value.span !== null) {
      span = { ...value.span };
    }
    let tokenRange = value.tokenRange;
    if (value.tokenRange !== null) {
      tokenRange = { ...value.tokenRange };
    }
    return {
      value: fragmentValue,
      children: [...value.children],
      fields,
      span,
      tokenRange,
    };
  }
  if (isExternalEventFragment(value)) {
    let span = value.span;
    if (value.span !== null) {
      span = { ...value.span };
    }
    let tokenRange = value.tokenRange;
    if (value.tokenRange !== null) {
      tokenRange = { ...value.tokenRange };
    }
    return {
      events: [...value.events],
      span,
      tokenRange,
    };
  }
  return value;
}

function externalBetterFailure(
  current: ExternalParseFailure | null,
  candidate: ExternalParseFailure,
): ExternalParseFailure {
  if (current === null) return candidate;
  if (candidate.offset > current.offset) return candidate;
  if (candidate.offset < current.offset) return current;
  let currentExpected = 0;
  if (current.diagnostic.expected !== undefined) {
    currentExpected = current.diagnostic.expected.length;
  }
  let candidateExpected = 0;
  if (candidate.diagnostic.expected !== undefined) {
    candidateExpected = candidate.diagnostic.expected.length;
  }
  if (candidateExpected > currentExpected) return candidate;
  return current;
}

function externalSkipTrivia(tokens: readonly Token[], start: number): number {
  let index = start;
  while (true) {
    const token = tokens[index];
    if (token === undefined) return index;
    if (token.type !== "named" || token.channel !== "trivia") return index;
    index++;
  }
}

function externalSpanFromChildren(
  children: readonly unknown[],
): { start: number; end: number } | null {
  let span: { start: number; end: number } | null = null;
  for (const child of children) {
    if (!child || typeof child !== "object") continue;
    const childSpan = (child as { span?: unknown }).span;
    if (!isExternalSpan(childSpan)) continue;
    span = externalCombineSpans(span, childSpan);
  }
  return span;
}

function externalTokenRangeFromChildren(
  children: readonly unknown[],
): { start: number; end: number } | null {
  let range: { start: number; end: number } | null = null;
  for (const child of children) {
    if (!isExternalRuleNode(child)) continue;
    range = externalCombineTokenRanges(range, child.tokenRange);
  }
  return range;
}

function externalCombineSpans(
  left: { start: number; end: number } | null,
  right: { start: number; end: number } | null,
): { start: number; end: number } | null {
  if (left === null) return right;
  if (right === null) return left;
  return {
    start: Math.min(left.start, right.start),
    end: Math.max(left.end, right.end),
  };
}

function externalCombineTokenRanges(
  left: { start: number; end: number } | null,
  right: { start: number; end: number } | null,
): { start: number; end: number } | null {
  if (left === null) return right;
  if (right === null) return left;
  return {
    start: Math.min(left.start, right.start),
    end: Math.max(left.end, right.end),
  };
}

function externalMutableArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  throw new Error("Expected parser reduction array.");
}

function appendExternalAll<T>(target: T[], values: readonly T[]): T[] {
  for (const value of values) target.push(value);
  return target;
}

function isExternalRuleNode(value: unknown): value is RuleNode {
  if (!value || typeof value !== "object") return false;
  return (value as { type?: unknown }).type === "rule";
}

function isExternalFragment(value: unknown): value is ExternalFragment {
  if (!value || typeof value !== "object") return false;
  return "value" in value &&
    "children" in value &&
    "fields" in value &&
    "tokenRange" in value;
}

function isExternalShiftedToken(
  value: unknown,
): value is ExternalShiftedToken {
  if (!value || typeof value !== "object") return false;
  return "token" in value && "tokenIndex" in value;
}

function isExternalSpan(
  value: unknown,
): value is { start: number; end: number } {
  if (!value || typeof value !== "object") return false;
  const span = value as { start?: unknown; end?: unknown };
  return typeof span.start === "number" && typeof span.end === "number";
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
  key: "maxExploredBranches" | "maxTraceActions",
  fallback: number,
): number {
  if (options === undefined) return fallback;
  const value = options[key];
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  return fallback;
}

function externalEmitContextualStats(
  options: ParseOptions | undefined,
  stats: ExternalContextualStatsState,
): void {
  if (options === undefined) return;
  if (options.contextualLexingStats === undefined) return;
  if (stats.ambiguousLexicalSites === 0) return;
  options.contextualLexingStats({ ...stats });
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
): void {
  ensureExternalWasmCapacity(wasm.memory, planBytes.byteLength);
  new Uint8Array(wasm.memory.buffer, 0, planBytes.byteLength).set(planBytes);
  const loaded = wasm.load_plan(0, planBytes.byteLength);
  if (loaded !== 1) {
    throw new Error("Wasm parser rejected parser plan bytes.");
  }
}

function validateLoadedExternalWasmAbi(
  wasm: ExternalParserWasmExports,
  parserPlanVersionToMatch: number,
): void {
  if (wasm.plan_version() !== parserPlanVersionToMatch) {
    throw new Error("Wasm parser plan version does not match shared adapter.");
  }
  if (wasm.input_base() < 0) {
    throw new Error("Wasm input base is invalid.");
  }
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

export function getSharedWasmRuntimeStats(): SharedWasmRuntimeStats {
  return {
    prepared: preparedGenericRuntime,
    prepareCount: genericRuntimePrepareCount,
    wasmBytes: sharedGenericExecutor?.bytes.byteLength ?? 0,
  };
}

export async function prepareSharedWasmRuntime(
  timing?: (event: RuntimeTimingEvent) => void,
): Promise<SharedGenericWasmExecutor> {
  await prepareSharedGenericWasmRuntime(timing);
  return sharedGenericExecutor!;
}

export async function createWasmParser(
  plan: RuntimeParserPlan,
  options: WasmParserOptions = {},
): Promise<RuntimeParser> {
  await prepareSharedGenericWasmRuntime(options.timing);
  return timed(
    "create instance",
    "wasm",
    options.timing,
    () => createWasmRuntimeParser(plan, options),
  );
}

export async function createAutoParser(
  plan: RuntimeParserPlan,
  options: AutoParserOptions = {},
): Promise<AutoRuntimeParser> {
  const shared = createPlanParser(plan, options);
  const wasm = await createWasmParser(plan, options);
  const threshold = options.smallInputThreshold ?? 16_384;
  const select = (source: string): RuntimeParser => {
    const engine = source.length < threshold ? "shared" : "wasm";
    emitTiming(options.timing, {
      phase: "select engine",
      engine,
      backend: engine === "wasm" ? "wasm+shared" : "shared",
      elapsedMs: 0,
    });
    return engine === "wasm" ? wasm : shared;
  };
  const parse: RuntimeParser["parse"] = ((
    source: string,
    parseOptions?: ParseOptions,
  ) => select(source).parse(source, parseOptions)) as RuntimeParser["parse"];
  const parseTokens: RuntimeParser["parseTokens"] = ((
    source: string,
    tokens: readonly Token[],
    parseOptions?: ParseOptions,
  ) =>
    select(source).parseTokens(
      source,
      tokens,
      parseOptions,
    )) as RuntimeParser["parseTokens"];
  const parseTokensUnchecked: RuntimeParser["parseTokensUnchecked"] = ((
    source: string,
    tokens: readonly Token[],
    parseOptions?: ParseOptions,
  ) =>
    select(source).parseTokensUnchecked(
      source,
      tokens,
      parseOptions,
    )) as RuntimeParser["parseTokensUnchecked"];
  return {
    plan,
    engines: { shared, wasm },
    lex(source, lexOptions) {
      return select(source).lex(source, lexOptions);
    },
    parse,
    parseTokens,
    parseTokensUnchecked,
  };
}

async function prepareSharedGenericWasmRuntime(
  timing: ((event: RuntimeTimingEvent) => void) | undefined,
): Promise<void> {
  if (preparedGenericRuntime) return;
  await timedAsync("load runtime", "wasm", timing, () => {
    sharedGenericExecutor = createSharedGenericWasmExecutor();
    return Promise.resolve();
  });
  await timedAsync("prepare runtime", "wasm", timing, () => {
    sharedGenericExecutor!.createInstance();
    preparedGenericRuntime = true;
    genericRuntimePrepareCount++;
    return Promise.resolve();
  });
}

function timed<T>(
  phase: RuntimeTimingPhase,
  engine: RuntimeEngine,
  timing: ((event: RuntimeTimingEvent) => void) | undefined,
  callback: () => T,
): T {
  const start = performance.now();
  try {
    return callback();
  } finally {
    emitTiming(timing, {
      phase,
      engine,
      backend: engine === "wasm" ? "wasm+shared" : "shared",
      elapsedMs: performance.now() - start,
    });
  }
}

async function timedAsync<T>(
  phase: RuntimeTimingPhase,
  engine: RuntimeEngine,
  timing: ((event: RuntimeTimingEvent) => void) | undefined,
  callback: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    return await callback();
  } finally {
    emitTiming(timing, {
      phase,
      engine,
      backend: engine === "wasm" ? "generic-wasm" : "shared",
      elapsedMs: performance.now() - start,
    });
  }
}

function emitTiming(
  timing: ((event: RuntimeTimingEvent) => void) | undefined,
  event: RuntimeTimingEvent,
): void {
  if (timing) timing(event);
}

function createWasmRuntimeParser(
  plan: RuntimeParserPlan,
  options: WasmParserOptions,
): RuntimeParser {
  const fallback = createPlanParser(plan, options);
  const state = createWasmPlanState(plan);
  const parser = {
    plan,
    lex: fallback.lex,
    parse(source: string, parseOptions?: ParseOptions): ParseResult {
      if (parseOptions?.mode !== "validate") {
        return fallback.parse(source, parseOptions);
      }
      return validateSourceWithWasm(
        state,
        fallback,
        source,
        parseOptions,
        options,
      );
    },
    parseTokens(
      source: string,
      tokens: readonly Token[],
      parseOptions?: ParseOptions,
    ): ParseResult {
      if (parseOptions?.mode !== "validate") {
        return fallback.parseTokens(source, tokens, parseOptions);
      }
      return fallback.parseTokens(source, tokens, parseOptions);
    },
    parseTokensUnchecked(
      source: string,
      tokens: readonly Token[],
      parseOptions?: ParseOptions,
    ): ParseResult {
      if (parseOptions?.mode !== "validate") {
        return fallback.parseTokensUnchecked(source, tokens, parseOptions);
      }
      return validateTokensWithWasm(
        state,
        fallback,
        source,
        tokens,
        parseOptions,
        options,
        true,
      );
    },
  };
  return parser as RuntimeParser;
}

interface WasmPlanState {
  readonly plan: RuntimeParserPlan;
  readonly instance: SharedGenericWasmExecutorInstance;
  readonly actionRowsPtr: number;
  readonly actionPairsPtr: number;
  readonly gotoRowsPtr: number;
  readonly gotoPairsPtr: number;
  readonly transitionRowsPtr: number;
  readonly transitionRangesPtr: number;
  readonly accepts: readonly number[];
  readonly terminalBySpec: readonly number[];
  readonly triviaSpecs: ReadonlySet<number>;
  readonly usesContextualLexing: boolean;
  readonly terminalByToken: ReadonlyMap<string, number>;
  readonly terminalByLiteral: ReadonlyMap<string, number>;
}

const WASM_ACTION_SHIFT = 1 << 24;
const WASM_ACTION_REDUCE = 2 << 24;
const WASM_ACTION_ACCEPT = 3 << 24;
const WASM_ACTION_KIND_MASK = 0xff000000;
const WASM_ACTION_PAYLOAD_MASK = 0x00ffffff;

function createWasmPlanState(plan: RuntimeParserPlan): WasmPlanState | null {
  if (plan.lr.conflictProfile === "branching") return null;
  const instance = sharedGenericExecutor!.createInstance();
  const actions = [...plan.lr.actions].sort((left, right) =>
    left.state - right.state || left.terminal - right.terminal
  );
  const gotos = [...plan.lr.gotos].sort((left, right) =>
    left.state - right.state || left.nonterminal - right.nonterminal
  );
  const actionRows = rowStarts(
    plan.lr.states.length,
    actions,
    (entry) => entry.state,
  );
  const actionPairs = actions.flatMap((entry) => {
    const action = entry.actions[0];
    return action ? [entry.terminal, encodeWasmAction(action)] : [];
  });
  const gotoRows = rowStarts(
    plan.lr.states.length,
    gotos,
    (entry) => entry.state,
  );
  const gotoPairs = gotos.flatMap((entry) => [
    entry.nonterminal,
    entry.target,
  ]);
  const transitionRows = rowStartsForRows(plan.lexer.dfa.transitions);
  const transitionRanges = plan.lexer.dfa.transitions.flatMap((row) =>
    row.flatMap((transition) => [
      transition.start,
      transition.end,
      transition.target,
    ])
  );
  const terminalBySpec = plan.lexer.specs.map((spec) =>
    spec.type === "named"
      ? terminalIdForNamedSpec(plan, spec.tokenId)
      : terminalIdForLiteralSpec(plan, spec.literalId)
  );
  const triviaSpecs = new Set(
    plan.lexer.specs
      .map((spec, index) => ({ spec, index }))
      .filter(({ spec }) =>
        spec.type === "named" &&
        plan.tokens.named.find((token) => token.id === spec.tokenId)
            ?.channel === "trivia"
      )
      .map(({ index }) => index),
  );
  return {
    plan,
    instance,
    actionRowsPtr: instance.writeI32Table(actionRows),
    actionPairsPtr: instance.writeI32Table(actionPairs),
    gotoRowsPtr: instance.writeI32Table(gotoRows),
    gotoPairsPtr: instance.writeI32Table(gotoPairs),
    transitionRowsPtr: instance.writeI32Table(transitionRows),
    transitionRangesPtr: instance.writeI32Table(transitionRanges),
    accepts: plan.lexer.dfa.accepts,
    terminalBySpec,
    triviaSpecs,
    usesContextualLexing: (plan.lexer.dfa.acceptCandidates ?? []).some((row) =>
      row.length > 1
    ),
    terminalByToken: new Map(
      plan.bnf.terminals
        .filter((terminal) => terminal.kind === "named")
        .map((terminal) => [String(terminal.tokenId), terminal.id]),
    ),
    terminalByLiteral: new Map(
      plan.bnf.terminals
        .filter((terminal) => terminal.kind === "literal")
        .map((terminal) => [String(terminal.literalId), terminal.id]),
    ),
  };
}

function validateSourceWithWasm(
  state: WasmPlanState | null,
  fallback: RuntimeParser,
  source: string,
  parseOptions: ParseOptions,
  options: WasmParserOptions,
): ValidateParseResult {
  if (!state) {
    return fallback.parse(source, parseOptions) as ValidateParseResult;
  }
  const terminals = timed(
    "lex",
    "wasm",
    options.timing,
    () => lexTerminalsWithWasm(state, source),
  );
  if (!terminals) {
    return fallback.parse(source, parseOptions) as ValidateParseResult;
  }
  const ok = timed(
    "parse trace",
    "wasm",
    options.timing,
    () => validateTerminalTraceWithWasm(state, terminals, parseOptions),
  );
  return timed(
    "build result",
    "wasm",
    options.timing,
    () =>
      ok
        ? { ok: true, source, diagnostics: [] }
        : fallback.parse(source, parseOptions) as ValidateParseResult,
  );
}

function validateTokensWithWasm(
  state: WasmPlanState | null,
  fallback: RuntimeParser,
  source: string,
  tokens: readonly Token[],
  parseOptions: ParseOptions,
  options: WasmParserOptions,
  unchecked: boolean,
): ValidateParseResult {
  if (!state) {
    return (unchecked ? fallback.parseTokensUnchecked : fallback.parseTokens)(
      source,
      tokens,
      parseOptions,
    ) as ValidateParseResult;
  }
  const ok = timed(
    "parse trace",
    "wasm",
    options.timing,
    () => validateTokenTraceWithWasm(state, tokens, parseOptions),
  );
  return timed(
    "build result",
    "wasm",
    options.timing,
    () =>
      ok
        ? { ok: true, source, diagnostics: [] }
        : (unchecked ? fallback.parseTokensUnchecked : fallback.parseTokens)(
          source,
          tokens,
          parseOptions,
        ) as ValidateParseResult,
  );
}

function validateTokenTraceWithWasm(
  state: WasmPlanState,
  tokens: readonly Token[],
  options: ParseOptions,
): boolean {
  const states = [0];
  let index = skipTrivia(tokens, 0);
  let steps = 0;
  const maxTraceActions = positiveLimit(options.maxTraceActions, 1_000_000);
  while (steps++ < maxTraceActions) {
    const token = tokens[index] ?? eofToken(state.plan, tokens);
    const terminal = terminalForToken(state, token);
    if (terminal < 0) return false;
    const currentState = states[states.length - 1];
    const action = state.instance.exports.find_pair(
      state.actionRowsPtr,
      state.plan.lr.states.length,
      state.actionPairsPtr,
      currentState,
      terminal,
    );
    if (action < 0) return false;
    const kind = action & WASM_ACTION_KIND_MASK;
    const payload = action & WASM_ACTION_PAYLOAD_MASK;
    if (kind === WASM_ACTION_ACCEPT) return true;
    if (kind === WASM_ACTION_SHIFT) {
      states.push(payload);
      index = skipTrivia(tokens, index + 1);
      continue;
    }
    if (kind !== WASM_ACTION_REDUCE) return false;
    const production = state.plan.bnf.productions[payload];
    if (!production) return false;
    states.splice(states.length - production.rhs.length, production.rhs.length);
    const gotoState = state.instance.exports.find_pair(
      state.gotoRowsPtr,
      state.plan.lr.states.length,
      state.gotoPairsPtr,
      states[states.length - 1],
      production.lhs,
    );
    if (gotoState < 0) return false;
    states.push(gotoState);
  }
  return false;
}

function lexTerminalsWithWasm(
  state: WasmPlanState,
  source: string,
): readonly number[] | null {
  if (state.usesContextualLexing) return null;
  const terminals: number[] = [];
  let offset = 0;
  while (offset < source.length) {
    let dfaState = state.plan.lexer.dfa.start;
    let cursor = offset;
    let acceptedSpec = -1;
    let acceptedEnd = offset;
    while (cursor < source.length) {
      const codePoint = source.codePointAt(cursor);
      if (codePoint === undefined) break;
      const target = state.instance.exports.find_range(
        state.transitionRowsPtr,
        state.plan.lexer.dfa.transitions.length,
        state.transitionRangesPtr,
        dfaState,
        codePoint,
      );
      if (target < 0) break;
      dfaState = target;
      cursor += codePoint > 0xffff ? 2 : 1;
      const accept = state.accepts[dfaState] ?? -1;
      if (accept >= 0) {
        acceptedSpec = accept;
        acceptedEnd = cursor;
      }
    }
    if (acceptedSpec < 0 || acceptedEnd <= offset) return null;
    if (!state.triviaSpecs.has(acceptedSpec)) {
      const terminal = state.terminalBySpec[acceptedSpec] ?? -1;
      if (terminal < 0) return null;
      terminals.push(terminal);
    }
    offset = acceptedEnd;
  }
  terminals.push(state.plan.bnf.eofTerminal);
  return terminals;
}

function validateTerminalTraceWithWasm(
  state: WasmPlanState,
  terminals: readonly number[],
  options: ParseOptions,
): boolean {
  const states = [0];
  let index = 0;
  let steps = 0;
  const maxTraceActions = positiveLimit(options.maxTraceActions, 1_000_000);
  while (steps++ < maxTraceActions) {
    const terminal = terminals[index] ?? state.plan.bnf.eofTerminal;
    const currentState = states[states.length - 1];
    const action = state.instance.exports.find_pair(
      state.actionRowsPtr,
      state.plan.lr.states.length,
      state.actionPairsPtr,
      currentState,
      terminal,
    );
    if (action < 0) return false;
    const kind = action & WASM_ACTION_KIND_MASK;
    const payload = action & WASM_ACTION_PAYLOAD_MASK;
    if (kind === WASM_ACTION_ACCEPT) return true;
    if (kind === WASM_ACTION_SHIFT) {
      states.push(payload);
      index++;
      continue;
    }
    if (kind !== WASM_ACTION_REDUCE) return false;
    const production = state.plan.bnf.productions[payload];
    if (!production) return false;
    states.splice(states.length - production.rhs.length, production.rhs.length);
    const gotoState = state.instance.exports.find_pair(
      state.gotoRowsPtr,
      state.plan.lr.states.length,
      state.gotoPairsPtr,
      states[states.length - 1],
      production.lhs,
    );
    if (gotoState < 0) return false;
    states.push(gotoState);
  }
  return false;
}

function rowStarts<T>(
  stateCount: number,
  entries: readonly T[],
  stateOf: (entry: T) => number,
): number[] {
  const counts = Array.from({ length: stateCount }, () => 0);
  for (const entry of entries) counts[stateOf(entry)]++;
  const starts = [0];
  for (const count of counts) starts.push(starts[starts.length - 1] + count);
  return starts;
}

function rowStartsForRows<T>(rows: readonly (readonly T[])[]): number[] {
  const starts = [0];
  for (const row of rows) starts.push(starts[starts.length - 1] + row.length);
  return starts;
}

function terminalIdForNamedSpec(
  plan: RuntimeParserPlan,
  tokenId: number,
): number {
  return plan.bnf.terminals.find((terminal) =>
    terminal.kind === "named" && terminal.tokenId === tokenId
  )?.id ?? -1;
}

function terminalIdForLiteralSpec(
  plan: RuntimeParserPlan,
  literalId: number,
): number {
  return plan.bnf.terminals.find((terminal) =>
    terminal.kind === "literal" && terminal.literalId === literalId
  )?.id ?? -1;
}

function encodeWasmAction(
  action: RuntimeParserPlan["lr"]["actions"][number]["actions"][number],
): number {
  if (action.kind === "shift") return WASM_ACTION_SHIFT | action.state;
  if (action.kind === "reduce") return WASM_ACTION_REDUCE | action.production;
  return WASM_ACTION_ACCEPT;
}

function terminalForToken(state: WasmPlanState, token: Token): number {
  if (token.type === "eof") return state.plan.bnf.eofTerminal;
  if (token.type === "named") {
    return state.terminalByToken.get(String(tokenId(state.plan, token.kind))) ??
      -1;
  }
  if (token.type === "literal") {
    return state.terminalByLiteral.get(
      String(literalId(state.plan, token.literal)),
    ) ?? -1;
  }
  return -1;
}

function tokenId(plan: RuntimeParserPlan, kind: string): number {
  return plan.tokens.named.find((token) => token.name === kind)?.id ?? -1;
}

function literalId(plan: RuntimeParserPlan, literal: string): number {
  return plan.tokens.literals.find((entry) => entry.value === literal)?.id ??
    -1;
}

function skipTrivia(tokens: readonly Token[], start: number): number {
  let index = start;
  while (
    tokens[index]?.type === "named" && tokens[index].channel === "trivia"
  ) {
    index++;
  }
  return index;
}

function eofToken(plan: RuntimeParserPlan, tokens: readonly Token[]): Token {
  const offset = tokens.at(-1)?.span.end ?? 0;
  void plan;
  return {
    type: "eof",
    text: "",
    span: { start: offset, end: offset },
    channel: "main",
  };
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}
