/**
 * Generated Wasm parser loader used by Baba generated bundles.
 *
 * @module
 */

import {
  parserPlanRuntimeMetadataVersion,
  validateCombinedWasmParserPlan,
  type ValidatedWasmParserPlan,
} from "./wasm_plan.ts";
import { decodeCompactPlanBinary } from "./compact_plan_binary.ts";
import {
  PARSER_PLAN_FORMAT,
  PARSER_PLAN_SEMANTICS,
  PARSER_PLAN_VERSION,
} from "../targets/runtime/parser_plan_contract.ts";
import {
  PARSER_DIAGNOSTIC_CODE_AMBIGUOUS_PARSE as parserDiagnosticCodeAmbiguousParse,
  PARSER_DIAGNOSTIC_CODE_INPUT_TOO_LARGE as parserDiagnosticCodeInputTooLarge,
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
  compileStrictIslandParserProgram,
  type StrictIslandParserProgram,
} from "./island_parser.ts";
import {
  WASM_ABI_VERSION,
  WASM_CURSOR_CHILD_RECORD_I32_COUNT,
  WASM_CURSOR_FIELD_RECORD_I32_COUNT,
  WASM_CURSOR_RULE_RECORD_I32_COUNT,
  WASM_CURSOR_VALUE_ITEM_RECORD_I32_COUNT,
  WASM_CURSOR_VALUE_RECORD_I32_COUNT,
  WASM_HOST_OWNERSHIP_CALLER_MANAGED,
  WASM_I32_BYTES,
  WASM_INCREMENTAL_TOKEN_RECORD_I32_COUNT,
  WASM_ISLAND_RESULT_I32_COUNT,
  WASM_ISLAND_STATUS_LEXICAL,
  WASM_ISLAND_STATUS_OK,
  WASM_ISLAND_STATUS_TRACE_LIMIT,
  WASM_ISLAND_STATUS_TRAILING,
  WASM_ISLAND_STATUS_UNEXPECTED,
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
  parseRecords(
    source: string,
    records: Int32Array,
    options?: ParseOptions,
  ): CursorParseResult<Root>;
  validate(source: string, options?: ParseOptions): ValidateParseResult;
  createDocument(
    source: string,
    options: LexDocumentOptions,
  ): IncrementalLexDocument;
  createDocument(
    source: string,
    options: ValidateDocumentOptions,
  ): IncrementalValidateDocument;
  createDocument(
    source: string,
    options: ParseDocumentOptions,
  ): IncrementalParseDocument<Root>;
  reset(): void;
  dispose(): void;
}

export interface TextEdit {
  readonly start: number;
  readonly oldEnd: number;
  readonly newText: string;
}

export interface SourceSnapshot {
  readonly version: number;
  readonly length: number;
  slice(start?: number, end?: number): string;
  text(): string;
}

export interface LexDocumentOptions {
  readonly goal: "lex";
  readonly trivia?: "preserve" | "discard";
}

export interface ValidateDocumentOptions {
  readonly goal: "validate";
  readonly trivia?: "preserve" | "discard";
  readonly maxParserActions?: number;
}

export interface ParseDocumentOptions {
  readonly goal: "parse";
  readonly trivia?: "preserve" | "discard";
  readonly maxParserActions?: number;
}

export interface SourceChange {
  readonly oldRange: Span;
  readonly newRange: Span;
}

export interface IncrementalLexWork {
  readonly relexedRange: Span;
  readonly scannedCodeUnits: number;
  readonly createdTokens: number;
  readonly reusedTokens: number;
}

export interface IncrementalParserWork {
  readonly reparsedRanges: readonly Span[];
  readonly parserActions: number;
  readonly reuseChecks: number;
  readonly reusedCheckpoints: number;
  readonly createdCheckpoints: number;
}

export interface IncrementalLexUpdate {
  readonly goal: "lex";
  readonly version: number;
  readonly changes: readonly SourceChange[];
  readonly lexer: IncrementalLexWork;
}

export interface IncrementalValidateUpdate {
  readonly goal: "validate";
  readonly version: number;
  readonly changes: readonly SourceChange[];
  readonly lexer: IncrementalLexWork;
  readonly parser: IncrementalParserWork;
}

export interface IncrementalParseUpdate {
  readonly goal: "parse";
  readonly version: number;
  readonly changes: readonly SourceChange[];
  readonly lexer: IncrementalLexWork;
  readonly parser: IncrementalParserWork;
}

export interface IncrementalLexResult {
  readonly version: number;
  readonly snapshot: SourceSnapshot;
  readonly tokenTape: TokenTape;
  readonly diagnostics: readonly LexDiagnostic[];
}

export type IncrementalValidateResult =
  | {
    readonly ok: true;
    readonly version: number;
    readonly snapshot: SourceSnapshot;
    readonly diagnostics: readonly [];
  }
  | {
    readonly ok: false;
    readonly version: number;
    readonly snapshot: SourceSnapshot;
    readonly diagnostics: readonly ParseDiagnostic[];
  };

export type IncrementalParseResult<Root extends RuleCursor = RuleCursor> =
  | {
    readonly ok: true;
    readonly version: number;
    readonly snapshot: SourceSnapshot;
    readonly cursor: Root;
    readonly diagnostics: readonly [];
  }
  | {
    readonly ok: false;
    readonly version: number;
    readonly snapshot: SourceSnapshot;
    readonly cursor: null;
    readonly diagnostics: readonly ParseDiagnostic[];
  };

export interface IncrementalLexDocument {
  readonly goal: "lex";
  readonly version: number;
  readonly snapshot: SourceSnapshot;
  lex(): IncrementalLexResult;
  applyEdits(edits: readonly TextEdit[]): IncrementalLexUpdate;
  dispose(): void;
}

export interface IncrementalValidateDocument {
  readonly goal: "validate";
  readonly version: number;
  readonly snapshot: SourceSnapshot;
  lex(): IncrementalLexResult;
  validate(): IncrementalValidateResult;
  applyEdits(edits: readonly TextEdit[]): IncrementalValidateUpdate;
  dispose(): void;
}

export interface IncrementalParseDocument<
  Root extends RuleCursor = RuleCursor,
> {
  readonly goal: "parse";
  readonly version: number;
  readonly snapshot: SourceSnapshot;
  lex(): IncrementalLexResult;
  validate(): IncrementalValidateResult;
  parse(): IncrementalParseResult<Root>;
  applyEdits(edits: readonly TextEdit[]): IncrementalParseUpdate;
  dispose(): void;
}

export interface LexOptions {
  readonly preserveTrivia?: boolean;
}

export interface ParseOptions extends LexOptions {
  readonly maxParserActions?: number;
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
  readonly code: "LEX_UNEXPECTED_CHARACTER" | "PARSER_INPUT_TOO_LARGE";
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
    | "PARSER_INTERNAL_ERROR"
    | "PARSER_INPUT_TOO_LARGE";
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
  lex_incremental(
    sourcePtr: number,
    sourceLength: number,
    start: number,
    minimumEnd: number,
    tokenPtr: number,
    tokenCapacity: number,
    memoPtr: number,
    memoCapacity: number,
  ): number;
  lex_all(
    sourcePtr: number,
    sourceLength: number,
    mode: number,
    tokenPtr: number,
    tokenCapacity: number,
    memoPtr: number,
    memoCapacity: number,
  ): number;
  lex_memo_i32_per_position(): number;
  analyze_island_records(
    tokenPtr: number,
    rawTokenCount: number,
    maxParserActions: number,
    resultPtr: number,
  ): number;
  materialize_island_records(
    sourceLength: number,
    tokenPtr: number,
    rawTokenCount: number,
    preserveTrivia: number,
    rulePtr: number,
    ruleCapacity: number,
    childPtr: number,
    childCapacity: number,
    fieldPtr: number,
    fieldCapacity: number,
    valuePtr: number,
    valueCapacity: number,
    resultPtr: number,
  ): number;
  island_result_i32_count(): number;
  incremental_token_record_i32_count(): number;
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

interface ExternalWasmSourceCache {
  source: string | undefined;
}

interface ExternalWasmSourceUpdate {
  readonly previousSource: string;
  readonly edits: readonly TextEdit[];
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
export const parserPlanFormat = PARSER_PLAN_FORMAT;
export const parserPlanVersion = PARSER_PLAN_VERSION;
export { parserPlanRuntimeMetadataVersion };
export const parserPlanSemantics = PARSER_PLAN_SEMANTICS;
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
    validated,
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
  readonly #documents = new Set<ExternalIncrementalDocument<Root>>();
  #metadata: ExternalRuntimeMetadata | undefined;
  readonly #sourceCache: ExternalWasmSourceCache = { source: undefined };
  readonly #islandProgram: StrictIslandParserProgram | undefined;
  readonly #islandUnavailableReason: string | undefined;

  readonly parse: ParserInstance<Root>["parse"];

  constructor(
    private readonly planBytes: Uint8Array,
    private readonly validatedPlan: ValidatedWasmParserPlan,
    private readonly wasm: ExternalParserWasmExports,
    private readonly inputBase: number,
  ) {
    let islandProgram: StrictIslandParserProgram | undefined;
    let islandUnavailableReason: string | undefined;
    try {
      islandProgram = compileStrictIslandParserProgram(planBytes);
    } catch (error) {
      if (error instanceof Error) {
        islandUnavailableReason = error.message;
      } else {
        islandUnavailableReason = String(error);
      }
    }
    this.#islandProgram = islandProgram;
    this.#islandUnavailableReason = islandUnavailableReason;
    this.parse = ((source: string, options?: ParseOptions) => {
      this.#assertLive();
      return parseExternalIsland<Root>(
        this.#loadMetadata(),
        this.#requireIslandProgram(),
        this.wasm,
        this.inputBase,
        this.#sourceCache,
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
      this.#sourceCache,
      source,
      options,
    );
  }

  validate(source: string, options?: ParseOptions): ValidateParseResult {
    this.#assertLive();
    return validateExternalIsland(
      this.#loadMetadata(),
      this.#requireIslandProgram(),
      this.wasm,
      this.inputBase,
      this.#sourceCache,
      source,
      options,
    );
  }

  createDocument(
    source: string,
    options: LexDocumentOptions,
  ): IncrementalLexDocument;
  createDocument(
    source: string,
    options: ValidateDocumentOptions,
  ): IncrementalValidateDocument;
  createDocument(
    source: string,
    options: ParseDocumentOptions,
  ): IncrementalParseDocument<Root>;
  createDocument(
    source: string,
    options:
      | LexDocumentOptions
      | ValidateDocumentOptions
      | ParseDocumentOptions,
  ):
    | IncrementalLexDocument
    | IncrementalValidateDocument
    | IncrementalParseDocument<Root> {
    this.#assertLive();
    const document = new ExternalIncrementalDocument<Root>(
      this.#loadMetadata(),
      this.#islandProgram,
      this.wasm,
      this.inputBase,
      this.#sourceCache,
      source,
      options,
      () => this.#documents.delete(document),
    );
    this.#documents.add(document);
    if (document.goal === "lex") {
      return document as unknown as IncrementalLexDocument;
    }
    if (document.goal === "validate") {
      return document as unknown as IncrementalValidateDocument;
    }
    return document as unknown as IncrementalParseDocument<Root>;
  }

  parseRecords(
    source: string,
    records: Int32Array,
    options?: ParseOptions,
  ): CursorParseResult<Root> {
    this.#assertLive();
    const metadata = this.#loadMetadata();
    if (!(records instanceof Int32Array)) {
      throw new TypeError(
        "Wasm parser external lexer records must be an Int32Array.",
      );
    }
    if (records.length % WASM_TOKEN_RECORD_I32_COUNT !== 0) {
      throw new Error(
        `Wasm parser external lexer record length ${records.length} is not divisible by ${WASM_TOKEN_RECORD_I32_COUNT}.`,
      );
    }

    let expectedStart = 0;
    const recordCount = records.length / WASM_TOKEN_RECORD_I32_COUNT;
    for (let index = 0; index < recordCount; index++) {
      const base = index * WASM_TOKEN_RECORD_I32_COUNT;
      const specIndex = records[base];
      const start = records[base + 1];
      const end = records[base + 2];
      const acceptingState = records[base + 3];
      if (
        specIndex === undefined || start === undefined || end === undefined ||
        acceptingState === undefined
      ) {
        throw new Error(
          `Wasm parser external lexer record ${index} is incomplete.`,
        );
      }
      if (start !== expectedStart) {
        throw new Error(
          `Wasm parser external lexer record ${index} starts at ${start}, expected ${expectedStart}.`,
        );
      }
      if (end <= start || end > source.length) {
        throw new Error(
          `Wasm parser external lexer record ${index} has span [${start}, ${end}) outside source length ${source.length}.`,
        );
      }
      if (specIndex < -1 || specIndex >= metadata.specs.length) {
        throw new Error(
          `Wasm parser external lexer record ${index} has unknown spec ${specIndex}.`,
        );
      }
      if (specIndex < 0) {
        if (acceptingState !== -1) {
          throw new Error(
            `Wasm parser external lexer error record ${index} has accepting state ${acceptingState}, expected -1.`,
          );
        }
      } else {
        const candidates = metadata.acceptCandidatesByState[acceptingState];
        if (candidates === undefined) {
          throw new Error(
            `Wasm parser external lexer record ${index} has unknown accepting state ${acceptingState}.`,
          );
        }
        if (!candidates.includes(specIndex)) {
          throw new Error(
            `Wasm parser external lexer record ${index} spec ${specIndex} is not accepted by state ${acceptingState}.`,
          );
        }
      }
      expectedStart = end;
    }
    if (expectedStart !== source.length) {
      throw new Error(
        `Wasm parser external lexer records end at ${expectedStart}, expected source length ${source.length}.`,
      );
    }
    return parseExternalIslandRecords(
      metadata,
      this.#requireIslandProgram(),
      this.wasm,
      this.inputBase,
      this.#sourceCache,
      source,
      options,
      records.slice(),
    ) as CursorParseResult<Root>;
  }

  reset(): void {
    this.#assertLive();
    this.#sourceCache.source = undefined;
    this.wasm.reset();
  }

  dispose(): void {
    for (const document of this.#documents) {
      document.dispose();
    }
    this.#documents.clear();
    this.#disposed = true;
  }

  #assertLive(): void {
    if (this.#disposed) {
      throw new Error("Wasm parser instance is disposed.");
    }
  }

  #requireIslandProgram(): StrictIslandParserProgram {
    if (this.#islandProgram !== undefined) {
      return this.#islandProgram;
    }
    let reason = "the plan has no strict GPU frontend metadata";
    if (this.#islandUnavailableReason !== undefined) {
      reason = this.#islandUnavailableReason;
    }
    throw new Error(`Wasm parsing is unavailable: ${reason}`);
  }

  #loadMetadata(): ExternalRuntimeMetadata {
    if (this.#metadata !== undefined) {
      return this.#metadata;
    }
    const metadata = decodeExternalRuntimeMetadata(
      this.planBytes,
      this.validatedPlan,
    );
    this.#metadata = metadata;
    return metadata;
  }
}

interface ExternalRuntimeMetadata {
  readonly defaultPreserveTrivia: boolean;
  readonly specs: readonly ExternalLexerSpec[];
  /** 1 when the lexer spec at that index produces a trivia-channel token. */
  readonly specIsTrivia: Uint8Array;
  readonly hasTriviaSpecs: boolean;
  readonly namedById: ReadonlyMap<number, ExternalNamedToken>;
  readonly literalById: ReadonlyMap<number, ExternalLiteralToken>;
  readonly terminalByNamedTokenId: ReadonlyMap<number, number>;
  readonly terminalByLiteralId: ReadonlyMap<number, number>;
  readonly acceptCandidatesByState: readonly (readonly number[])[];
  readonly terminalDisplays: readonly string[];
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

function decodeExternalRuntimeMetadata(
  planBytes: Uint8Array,
  validated: ValidatedWasmParserPlan,
): ExternalRuntimeMetadata {
  const compact = expectRecord(
    decodeCompactPlanBinary(
      planBytes.subarray(
        validated.runtimeMetadataOffset,
        validated.runtimeMetadataOffset + validated.runtimeMetadataLength,
      ),
    ),
    "compact runtime metadata",
  );
  const identity = expectArray(compact.m, "runtime identity metadata");
  const metadataVersion = expectNumber(
    identity[0],
    "runtime metadata version",
  );
  if (metadataVersion !== parserPlanRuntimeMetadataVersion) {
    throw new Error(
      `Unsupported Wasm parser plan runtime metadata version ${metadataVersion}. Regenerate the parser plan with the current Baba release.`,
    );
  }
  const parserPlanFormat = expectString(identity[1], "parser plan format");
  const parserPlanVersion = expectNumber(identity[2], "parser plan version");
  const parserPlanSemantics = expectString(
    identity[3],
    "parser plan semantics",
  );
  if (
    parserPlanFormat !== PARSER_PLAN_FORMAT ||
    parserPlanVersion !== validated.parserPlanVersion ||
    parserPlanSemantics !== PARSER_PLAN_SEMANTICS
  ) {
    throw new Error(
      `Wasm parser plan identity ${parserPlanFormat}/${parserPlanVersion}/${parserPlanSemantics} does not match ${PARSER_PLAN_FORMAT}/${validated.parserPlanVersion}/${PARSER_PLAN_SEMANTICS}.`,
    );
  }
  const runtimeFormat = expectString(
    identity[4],
    "runtime implementation format",
  );
  const runtimeVersion = expectNumber(
    identity[5],
    "runtime implementation version",
  );
  const runtimeSemantics = expectString(
    identity[6],
    "runtime implementation semantics",
  );
  const runtimeHash = expectString(identity[7], "runtime implementation hash");
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
  const specIsTrivia = new Uint8Array(specs.length);
  let hasTriviaSpecs = false;
  for (let specIndex = 0; specIndex < specs.length; specIndex++) {
    const spec = specs[specIndex];
    if (spec === undefined) {
      throw new Error(`Lexer specification ${specIndex} is missing.`);
    }
    if (spec.type !== "named") {
      continue;
    }
    const named = namedById.get(spec.tokenId);
    if (named === undefined) {
      throw new Error(
        `Lexer specification references named token ${spec.tokenId}.`,
      );
    }
    if (named.channel === "trivia") {
      specIsTrivia[specIndex] = 1;
      hasTriviaSpecs = true;
    }
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

  return {
    defaultPreserveTrivia,
    specs,
    specIsTrivia,
    hasTriviaSpecs,
    namedById,
    literalById,
    terminalByNamedTokenId,
    terminalByLiteralId,
    acceptCandidatesByState,
    terminalDisplays,
    ruleNames,
    fieldIds,
    fieldNames,
    fieldSchemas,
  };
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

/**
 * Raw lexer output: `count` records of `WASM_TOKEN_RECORD_I32_COUNT` i32 each,
 * already copied out of Wasm linear memory.
 */
type ExternalLexRecordTape =
  | {
    readonly ok: true;
    readonly records: Int32Array;
    readonly count: number;
  }
  | {
    readonly ok: false;
    readonly requiredBytes: number;
  };

interface ExternalLexDiagnostic {
  readonly code: "LEX_UNEXPECTED_CHARACTER" | "PARSER_INPUT_TOO_LARGE";
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
    | "PARSER_INTERNAL_ERROR"
    | "PARSER_INPUT_TOO_LARGE";
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

interface SourcePiece {
  readonly source: string;
  readonly start: number;
  readonly end: number;
}

class ExternalSourceSnapshot implements SourceSnapshot {
  #materialized: string | undefined;

  constructor(
    readonly version: number,
    private readonly pieces: readonly SourcePiece[],
    readonly length: number,
  ) {}

  static initial(source: string): ExternalSourceSnapshot {
    const pieces: SourcePiece[] = [];
    if (source.length > 0) {
      pieces.push({ source, start: 0, end: source.length });
    }
    const snapshot = new ExternalSourceSnapshot(0, pieces, source.length);
    snapshot.#materialized = source;
    return snapshot;
  }

  slice(start = 0, end = this.length): string {
    const selectedStart = externalSnapshotOffset(start, this.length, "start");
    const selectedEnd = externalSnapshotOffset(end, this.length, "end");
    if (selectedEnd <= selectedStart) {
      return "";
    }
    const parts: string[] = [];
    let offset = 0;
    for (const piece of this.pieces) {
      const pieceLength = piece.end - piece.start;
      const pieceEnd = offset + pieceLength;
      if (pieceEnd <= selectedStart) {
        offset = pieceEnd;
        continue;
      }
      if (offset >= selectedEnd) {
        break;
      }
      const localStart = Math.max(0, selectedStart - offset);
      const localEnd = Math.min(pieceLength, selectedEnd - offset);
      parts.push(
        piece.source.slice(piece.start + localStart, piece.start + localEnd),
      );
      offset = pieceEnd;
    }
    return parts.join("");
  }

  text(): string {
    if (this.#materialized !== undefined) {
      return this.#materialized;
    }
    this.#materialized = this.slice(0, this.length);
    return this.#materialized;
  }

  apply(
    edits: readonly TextEdit[],
  ): {
    readonly snapshot: ExternalSourceSnapshot;
    readonly changes: SourceChange[];
  } {
    const pieces: SourcePiece[] = [];
    const changes: SourceChange[] = [];
    let oldOffset = 0;
    let lengthDelta = 0;
    for (const edit of edits) {
      this.appendRange(pieces, oldOffset, edit.start);
      if (edit.newText.length > 0) {
        pieces.push({
          source: edit.newText,
          start: 0,
          end: edit.newText.length,
        });
      }
      const newStart = edit.start + lengthDelta;
      const newEnd = newStart + edit.newText.length;
      changes.push({
        oldRange: { start: edit.start, end: edit.oldEnd },
        newRange: { start: newStart, end: newEnd },
      });
      lengthDelta += edit.newText.length - (edit.oldEnd - edit.start);
      oldOffset = edit.oldEnd;
    }
    this.appendRange(pieces, oldOffset, this.length);
    return {
      snapshot: new ExternalSourceSnapshot(
        this.version + 1,
        externalMergeSourcePieces(pieces),
        this.length + lengthDelta,
      ),
      changes,
    };
  }

  private appendRange(
    output: SourcePiece[],
    start: number,
    end: number,
  ): void {
    if (end <= start) {
      return;
    }
    let offset = 0;
    for (const piece of this.pieces) {
      const pieceLength = piece.end - piece.start;
      const pieceEnd = offset + pieceLength;
      if (pieceEnd <= start) {
        offset = pieceEnd;
        continue;
      }
      if (offset >= end) {
        break;
      }
      const localStart = Math.max(0, start - offset);
      const localEnd = Math.min(pieceLength, end - offset);
      output.push({
        source: piece.source,
        start: piece.start + localStart,
        end: piece.start + localEnd,
      });
      offset = pieceEnd;
    }
  }
}

function externalSnapshotOffset(
  value: number,
  length: number,
  name: string,
): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > length) {
    throw new RangeError(
      `Source snapshot ${name} offset ${
        String(value)
      } is outside [0, ${length}].`,
    );
  }
  return value;
}

function externalMergeSourcePieces(
  pieces: readonly SourcePiece[],
): readonly SourcePiece[] {
  const merged: SourcePiece[] = [];
  for (const piece of pieces) {
    if (piece.end <= piece.start) {
      continue;
    }
    const previous = merged[merged.length - 1];
    if (
      previous !== undefined && previous.source === piece.source &&
      previous.end === piece.start
    ) {
      merged[merged.length - 1] = {
        source: previous.source,
        start: previous.start,
        end: piece.end,
      };
      continue;
    }
    merged.push(piece);
  }
  return merged;
}

function externalParseTextEdits(
  edits: readonly TextEdit[],
  sourceLength: number,
): readonly TextEdit[] {
  const parsed: TextEdit[] = [];
  let previousStart = -1;
  let previousEnd = -1;
  const editCount = edits.length;
  for (let index = 0; index < editCount; index++) {
    const edit = edits[index];
    if (edit === undefined || typeof edit !== "object" || edit === null) {
      throw new TypeError(`Text edit ${index} must be an object.`);
    }
    const start = edit.start;
    const oldEnd = edit.oldEnd;
    const newText = edit.newText;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(oldEnd) ||
      start < 0 ||
      oldEnd < start ||
      oldEnd > sourceLength
    ) {
      throw new RangeError(
        `Text edit ${index} range [${String(start)}, ${
          String(oldEnd)
        }) is outside source length ${sourceLength}.`,
      );
    }
    if (typeof newText !== "string") {
      throw new TypeError(
        `Text edit ${index} newText must be a string, got '${typeof newText}'.`,
      );
    }
    if (
      start < previousEnd ||
      (previousStart === previousEnd && start === previousEnd)
    ) {
      throw new RangeError(
        `Text edit ${index} starts at ${start}, which overlaps the previous edit or shares its insertion point.`,
      );
    }
    parsed.push({ start, oldEnd, newText });
    previousStart = start;
    previousEnd = oldEnd;
  }
  return parsed;
}

interface ExternalIncrementalLexState {
  readonly records: Int32Array;
  readonly count: number;
}

class ExternalSnapshotTokenTape implements TokenTape {
  #cache: (Token | undefined)[] | undefined;

  constructor(
    private readonly metadata: ExternalRuntimeMetadata,
    private readonly snapshot: SourceSnapshot,
    private readonly records: Int32Array,
    private readonly keptRecordIndices: Int32Array | null,
    private readonly keptCount: number,
  ) {}

  get length(): number {
    return this.keptCount + 1;
  }

  token(index: number): Token | undefined {
    if (!Number.isInteger(index) || index < 0 || index > this.keptCount) {
      return undefined;
    }
    let cache = this.#cache;
    if (cache === undefined) {
      cache = new Array(this.keptCount + 1);
      this.#cache = cache;
    }
    const cached = cache[index];
    if (cached !== undefined) {
      return cached;
    }
    let token: Token;
    if (index === this.keptCount) {
      token = externalEofToken(this.snapshot.length);
    } else {
      let recordIndex = index;
      if (this.keptRecordIndices !== null) {
        const selected = this.keptRecordIndices[index];
        if (selected === undefined) {
          throw new Error(`Token tape entry ${index} is missing.`);
        }
        recordIndex = selected;
      }
      token = materializeExternalSnapshotToken(
        this.metadata,
        this.snapshot,
        this.records,
        recordIndex,
      );
    }
    cache[index] = token;
    return token;
  }
}

function materializeExternalSnapshotToken(
  metadata: ExternalRuntimeMetadata,
  snapshot: SourceSnapshot,
  records: Int32Array,
  recordIndex: number,
): Token {
  const base = recordIndex * WASM_INCREMENTAL_TOKEN_RECORD_I32_COUNT;
  const specIndex = records[base];
  const start = records[base + 1];
  const end = records[base + 2];
  if (specIndex === undefined || start === undefined || end === undefined) {
    throw new Error(`Incremental token record ${recordIndex} is incomplete.`);
  }
  if (specIndex < 0) {
    return {
      type: "error",
      text: snapshot.slice(start, end),
      span: { start, end },
      channel: "error",
    };
  }
  const spec = metadata.specs[specIndex];
  if (spec === undefined) {
    throw new Error(
      `Incremental token record ${recordIndex} references unknown spec ${specIndex}.`,
    );
  }
  if (spec.type === "literal") {
    const literal = metadata.literalById.get(spec.literalId);
    if (literal === undefined) {
      throw new Error(
        `Incremental token record ${recordIndex} references unknown literal ${spec.literalId}.`,
      );
    }
    return {
      type: "literal",
      literal: literal.value,
      text: literal.value,
      span: { start, end },
      channel: "main",
    };
  }
  const named = metadata.namedById.get(spec.tokenId);
  if (named === undefined) {
    throw new Error(
      `Incremental token record ${recordIndex} references unknown token ${spec.tokenId}.`,
    );
  }
  return {
    type: "named",
    kind: named.name,
    text: snapshot.slice(start, end),
    span: { start, end },
    channel: named.channel,
  };
}

interface ExternalIncrementalRelexResult {
  readonly state: ExternalIncrementalLexState;
  readonly work: IncrementalLexWork;
  readonly oldPrefixTokenCount: number;
  readonly oldSuffixTokenStart: number;
  readonly newSuffixTokenStart: number;
}

function externalIncrementalRelex(
  wasm: ExternalParserWasmExports,
  planByteLength: number,
  sourceCache: ExternalWasmSourceCache,
  previous: ExternalIncrementalLexState,
  previousSource: string,
  source: string,
  edits: readonly TextEdit[],
  searchFloorOffset: number,
  searchFloorToken: number,
): ExternalIncrementalRelexResult {
  const oldSourceLength = previousSource.length;
  let earliestToken = previous.count;
  let firstTokenToCheck = 0;
  const firstEdit = edits[0];
  // Tokens before the prior floor were proven independent of that offset.
  // They remain independent of later offsets because reused prefix records
  // and their dependency ends are unchanged.
  if (
    firstEdit !== undefined &&
    firstEdit.start >= searchFloorOffset
  ) {
    firstTokenToCheck = Math.min(searchFloorToken, previous.count);
  }
  for (
    let tokenIndex = firstTokenToCheck;
    tokenIndex < previous.count;
    tokenIndex++
  ) {
    const base = tokenIndex * WASM_INCREMENTAL_TOKEN_RECORD_I32_COUNT;
    const tokenStart = previous.records[base + 1];
    const dependencyEnd = previous.records[base + 4];
    if (tokenStart === undefined || dependencyEnd === undefined) {
      throw new Error(`Incremental token record ${tokenIndex} is incomplete.`);
    }
    for (const edit of edits) {
      let intersectsDependency = tokenStart < edit.oldEnd &&
        dependencyEnd > edit.start;
      if (edit.start === edit.oldEnd) {
        intersectsDependency = tokenStart <= edit.start &&
          dependencyEnd >= edit.start;
      }
      if (intersectsDependency) {
        earliestToken = tokenIndex;
        break;
      }
    }
    if (earliestToken !== previous.count) {
      break;
    }
  }
  if (earliestToken === previous.count && edits.length > 0) {
    earliestToken = previous.count;
  }

  let relexStart = 0;
  if (earliestToken < previous.count) {
    const selected = previous.records[
      earliestToken * WASM_INCREMENTAL_TOKEN_RECORD_I32_COUNT + 1
    ];
    if (selected === undefined) {
      throw new Error(
        `Incremental token record ${earliestToken} has no start offset.`,
      );
    }
    relexStart = selected;
  } else {
    relexStart = oldSourceLength;
  }

  const finalEdit = edits[edits.length - 1];
  if (finalEdit === undefined) {
    return {
      state: previous,
      work: {
        relexedRange: { start: 0, end: 0 },
        scannedCodeUnits: 0,
        createdTokens: 0,
        reusedTokens: previous.count,
      },
      oldPrefixTokenCount: previous.count,
      oldSuffixTokenStart: previous.count,
      newSuffixTokenStart: previous.count,
    };
  }
  let lengthDelta = 0;
  for (const edit of edits) {
    lengthDelta += edit.newText.length - (edit.oldEnd - edit.start);
  }
  const oldSuffixStart = finalEdit.oldEnd;
  const newSuffixStart = oldSuffixStart + lengthDelta;
  const createdParts: Int32Array[] = [];
  let createdCount = 0;
  let cursor = relexStart;
  let oldSuffixTokenStart = previous.count;
  let sourceUpdate: ExternalWasmSourceUpdate | undefined = {
    previousSource,
    edits,
  };
  while (cursor < source.length) {
    let minimumEnd = newSuffixStart;
    if (minimumEnd <= cursor) {
      minimumEnd = cursor + 1;
    }
    if (minimumEnd > source.length) {
      minimumEnd = source.length;
    }
    const lexed = lexExternalIncrementalRecords(
      wasm,
      planByteLength,
      sourceCache,
      sourceUpdate,
      source,
      cursor,
      minimumEnd,
    );
    sourceUpdate = undefined;
    if (lexed.count === 0) {
      cursor = source.length;
    } else {
      createdParts.push(lexed.records);
      createdCount += lexed.count;
      const lastBase = (lexed.count - 1) *
        WASM_INCREMENTAL_TOKEN_RECORD_I32_COUNT;
      const nextCursor = lexed.records[lastBase + 2];
      if (nextCursor === undefined || nextCursor <= cursor) {
        throw new Error(
          `Incremental lexer did not advance from source offset ${cursor}.`,
        );
      }
      cursor = nextCursor;
    }
    if (cursor < newSuffixStart) {
      continue;
    }
    const mappedOldOffset = cursor - lengthDelta;
    const suffixToken = externalIncrementalTokenAtStart(
      previous,
      oldSourceLength,
      mappedOldOffset,
    );
    if (suffixToken !== undefined) {
      oldSuffixTokenStart = suffixToken;
      break;
    }
  }
  if (cursor === source.length) {
    oldSuffixTokenStart = previous.count;
  }

  const reusedSuffixCount = previous.count - oldSuffixTokenStart;
  const totalCount = earliestToken + createdCount + reusedSuffixCount;
  const records = new Int32Array(
    totalCount * WASM_INCREMENTAL_TOKEN_RECORD_I32_COUNT,
  );
  const prefixWordCount = earliestToken *
    WASM_INCREMENTAL_TOKEN_RECORD_I32_COUNT;
  records.set(previous.records.subarray(0, prefixWordCount), 0);
  let outputWord = prefixWordCount;
  let dependencyEnd = cursor;
  for (const part of createdParts) {
    records.set(part, outputWord);
    for (
      let index = 0;
      index < part.length;
      index += WASM_INCREMENTAL_TOKEN_RECORD_I32_COUNT
    ) {
      const selected = part[index + 4];
      if (selected !== undefined && selected > dependencyEnd) {
        dependencyEnd = selected;
      }
    }
    outputWord += part.length;
  }
  const oldSuffixWordStart = oldSuffixTokenStart *
    WASM_INCREMENTAL_TOKEN_RECORD_I32_COUNT;
  if (lengthDelta === 0) {
    records.set(previous.records.subarray(oldSuffixWordStart), outputWord);
  } else {
    for (
      let tokenIndex = oldSuffixTokenStart;
      tokenIndex < previous.count;
      tokenIndex++
    ) {
      const oldBase = tokenIndex * WASM_INCREMENTAL_TOKEN_RECORD_I32_COUNT;
      for (
        let field = 0;
        field < WASM_INCREMENTAL_TOKEN_RECORD_I32_COUNT;
        field++
      ) {
        const value = previous.records[oldBase + field];
        if (value === undefined) {
          throw new Error(
            `Incremental token record ${tokenIndex} is incomplete.`,
          );
        }
        let shifted = value;
        if (field === 1 || field === 2 || field === 4) {
          shifted += lengthDelta;
        }
        records[outputWord + field] = shifted;
      }
      outputWord += WASM_INCREMENTAL_TOKEN_RECORD_I32_COUNT;
    }
  }

  return {
    state: { records, count: totalCount },
    work: {
      relexedRange: { start: relexStart, end: dependencyEnd },
      scannedCodeUnits: dependencyEnd - relexStart,
      createdTokens: createdCount,
      reusedTokens: earliestToken + reusedSuffixCount,
    },
    oldPrefixTokenCount: earliestToken,
    oldSuffixTokenStart,
    newSuffixTokenStart: earliestToken + createdCount,
  };
}

function externalIncrementalTokenAtStart(
  state: ExternalIncrementalLexState,
  sourceLength: number,
  start: number,
): number | undefined {
  if (start === sourceLength) {
    return state.count;
  }
  // Incremental lexer records advance monotonically through the source.
  let lower = 0;
  let upper = state.count;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const tokenStart = state.records[
      middle * WASM_INCREMENTAL_TOKEN_RECORD_I32_COUNT + 1
    ];
    if (tokenStart === undefined) {
      throw new Error(`Incremental token record ${middle} has no start.`);
    }
    if (tokenStart < start) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }
  if (lower === state.count) {
    return undefined;
  }
  const tokenStart = state.records[
    lower * WASM_INCREMENTAL_TOKEN_RECORD_I32_COUNT + 1
  ];
  if (tokenStart === undefined) {
    throw new Error(`Incremental token record ${lower} has no start.`);
  }
  if (tokenStart !== start) {
    return undefined;
  }
  return lower;
}

function externalIncrementalRawRecords(
  state: ExternalIncrementalLexState,
): Int32Array {
  const records = new Int32Array(
    state.count * WASM_TOKEN_RECORD_I32_COUNT,
  );
  for (let tokenIndex = 0; tokenIndex < state.count; tokenIndex++) {
    const sourceBase = tokenIndex * WASM_INCREMENTAL_TOKEN_RECORD_I32_COUNT;
    const targetBase = tokenIndex * WASM_TOKEN_RECORD_I32_COUNT;
    records[targetBase] = state.records[sourceBase];
    records[targetBase + 1] = state.records[sourceBase + 1];
    records[targetBase + 2] = state.records[sourceBase + 2];
    records[targetBase + 3] = state.records[sourceBase + 3];
  }
  return records;
}

function externalIncrementalLexResult(
  metadata: ExternalRuntimeMetadata,
  snapshot: SourceSnapshot,
  state: ExternalIncrementalLexState,
  preserveTrivia: boolean,
): IncrementalLexResult {
  const diagnostics: LexDiagnostic[] = [];
  let keptRecordIndices: Int32Array | undefined;
  let keptCount = 0;
  for (let tokenIndex = 0; tokenIndex < state.count; tokenIndex++) {
    const base = tokenIndex * WASM_INCREMENTAL_TOKEN_RECORD_I32_COUNT;
    const specIndex = state.records[base];
    const start = state.records[base + 1];
    const end = state.records[base + 2];
    if (specIndex === undefined || start === undefined || end === undefined) {
      throw new Error(`Incremental token record ${tokenIndex} is incomplete.`);
    }
    if (specIndex < 0) {
      diagnostics.push({
        code: "LEX_UNEXPECTED_CHARACTER",
        message: `Unexpected character ${
          JSON.stringify(snapshot.slice(start, end))
        }.`,
        span: { start, end },
      });
      if (keptRecordIndices !== undefined) {
        keptRecordIndices[keptCount] = tokenIndex;
      }
      keptCount++;
      continue;
    }
    if (!preserveTrivia && metadata.specIsTrivia[specIndex] === 1) {
      if (keptRecordIndices === undefined) {
        keptRecordIndices = new Int32Array(state.count);
        for (let keptIndex = 0; keptIndex < keptCount; keptIndex++) {
          keptRecordIndices[keptIndex] = keptIndex;
        }
      }
      continue;
    }
    if (keptRecordIndices !== undefined) {
      keptRecordIndices[keptCount] = tokenIndex;
    }
    keptCount++;
  }
  let indices: Int32Array | null = null;
  if (keptRecordIndices !== undefined) {
    indices = keptRecordIndices;
  }
  return {
    version: snapshot.version,
    snapshot,
    tokenTape: new ExternalSnapshotTokenTape(
      metadata,
      snapshot,
      state.records,
      indices,
      keptCount,
    ),
    diagnostics,
  };
}

class ExternalIncrementalDocument<Root extends RuleCursor> {
  #disposed = false;
  #snapshot: ExternalSourceSnapshot;
  #source: string;
  #lexState: ExternalIncrementalLexState;
  #lexSearchFloorOffset = 0;
  #lexSearchFloorToken = 0;
  #lexResult: IncrementalLexResult;
  #validateResult: IncrementalValidateResult | undefined;
  #parseResult: IncrementalParseResult<Root> | undefined;
  readonly #preserveTrivia: boolean;
  readonly #maxParserActions: number;

  readonly goal: "lex" | "validate" | "parse";

  constructor(
    private readonly metadata: ExternalRuntimeMetadata,
    private readonly islandProgram: StrictIslandParserProgram | undefined,
    private readonly wasm: ExternalParserWasmExports,
    private readonly planByteLength: number,
    private readonly sourceCache: ExternalWasmSourceCache,
    source: string,
    options:
      | LexDocumentOptions
      | ValidateDocumentOptions
      | ParseDocumentOptions,
    private readonly onDispose: () => void,
  ) {
    if (typeof source !== "string") {
      throw new TypeError(
        `Incremental document source must be a string, got '${typeof source}'.`,
      );
    }
    if (options === undefined || options === null) {
      throw new Error(
        "Incremental document creation requires an options object.",
      );
    }
    const goal = (options as { readonly goal?: unknown }).goal;
    if (
      goal !== "lex" && goal !== "validate" &&
      goal !== "parse"
    ) {
      throw new Error(
        `Incremental document goal must be 'lex', 'validate', or 'parse', got '${
          String(goal)
        }'.`,
      );
    }
    this.goal = goal;
    if (goal !== "lex" && islandProgram === undefined) {
      throw new Error(
        `Incremental document goal '${goal}' requires a strict island parser.`,
      );
    }
    const trivia = options.trivia;
    let preserveTrivia = metadata.defaultPreserveTrivia;
    if (trivia === "preserve") {
      preserveTrivia = true;
    } else if (trivia === "discard") {
      preserveTrivia = false;
    } else if (trivia !== undefined) {
      throw new TypeError(
        `Incremental document trivia policy must be 'preserve' or 'discard', got '${
          String(trivia)
        }'.`,
      );
    }
    this.#preserveTrivia = preserveTrivia;
    let maxParserActions = 1_000_000;
    if (goal !== "lex") {
      const selectedLimit = (
        options as { readonly maxParserActions?: unknown }
      ).maxParserActions;
      if (selectedLimit !== undefined) {
        if (
          typeof selectedLimit !== "number" ||
          !Number.isSafeInteger(selectedLimit) ||
          selectedLimit < 1
        ) {
          throw new RangeError(
            `maxParserActions must be a positive safe integer, got '${
              String(selectedLimit)
            }'.`,
          );
        }
        maxParserActions = selectedLimit;
      }
    }
    this.#maxParserActions = maxParserActions;
    this.#snapshot = ExternalSourceSnapshot.initial(source);
    this.#source = source;
    this.#lexState = lexExternalIncrementalRecords(
      wasm,
      planByteLength,
      sourceCache,
      undefined,
      source,
      0,
      source.length,
    );
    this.#lexResult = externalIncrementalLexResult(
      metadata,
      this.#snapshot,
      this.#lexState,
      this.#preserveTrivia,
    );
    this.#refreshParserResults();
  }

  get version(): number {
    this.#assertLive();
    return this.#snapshot.version;
  }

  get snapshot(): SourceSnapshot {
    this.#assertLive();
    return this.#snapshot;
  }

  lex(): IncrementalLexResult {
    this.#assertLive();
    return this.#lexResult;
  }

  validate(): IncrementalValidateResult {
    this.#assertLive();
    if (this.goal === "lex" || this.#validateResult === undefined) {
      throw new Error(
        `Incremental document goal '${this.goal}' does not maintain parser validation state.`,
      );
    }
    return this.#validateResult;
  }

  parse(): IncrementalParseResult<Root> {
    this.#assertLive();
    if (this.goal !== "parse" || this.#parseResult === undefined) {
      throw new Error(
        `Incremental document goal '${this.goal}' does not maintain cursor parse state.`,
      );
    }
    return this.#parseResult;
  }

  applyEdits(
    edits: readonly TextEdit[],
  ): IncrementalLexUpdate | IncrementalValidateUpdate | IncrementalParseUpdate {
    this.#assertLive();
    if (!Array.isArray(edits)) {
      throw new TypeError("Incremental document edits must be an array.");
    }
    const parsedEdits = externalParseTextEdits(
      edits,
      this.#snapshot.length,
    );
    if (parsedEdits.length === 0) {
      return this.#emptyUpdate();
    }
    const firstEdit = parsedEdits[0];
    if (firstEdit === undefined) {
      throw new Error("Incremental update has no first edit.");
    }
    const previousSnapshot = this.#snapshot;
    const previousLexState = this.#lexState;
    const applied = previousSnapshot.apply(parsedEdits);
    const source = applied.snapshot.text();
    const relexed = externalIncrementalRelex(
      this.wasm,
      this.planByteLength,
      this.sourceCache,
      previousLexState,
      this.#source,
      source,
      parsedEdits,
      this.#lexSearchFloorOffset,
      this.#lexSearchFloorToken,
    );
    this.#snapshot = applied.snapshot;
    this.#source = source;
    this.#lexState = relexed.state;
    this.#lexSearchFloorOffset = firstEdit.start;
    this.#lexSearchFloorToken = relexed.oldPrefixTokenCount;
    this.#lexResult = externalIncrementalLexResult(
      this.metadata,
      this.#snapshot,
      this.#lexState,
      this.#preserveTrivia,
    );

    let parserWork: IncrementalParserWork | undefined;
    if (this.goal !== "lex") {
      const validated = this.#validateCurrentRecords();
      this.#validateResult = externalIncrementalValidateResult(
        this.#snapshot,
        validated,
      );
      parserWork = {
        reparsedRanges: [{ start: 0, end: this.#source.length }],
        parserActions: this.#lexState.count,
        reuseChecks: 0,
        reusedCheckpoints: 0,
        createdCheckpoints: 0,
      };
      if (this.goal === "parse") {
        const parsed = this.#parseCurrentRecords();
        this.#parseResult = externalIncrementalParseResult(
          this.#snapshot,
          parsed,
        );
      }
    }

    if (this.goal === "lex") {
      return {
        goal: "lex",
        version: this.#snapshot.version,
        changes: applied.changes,
        lexer: relexed.work,
      };
    }
    if (parserWork === undefined) {
      throw new Error("Incremental parser work was not recorded.");
    }
    if (this.goal === "validate") {
      return {
        goal: "validate",
        version: this.#snapshot.version,
        changes: applied.changes,
        lexer: relexed.work,
        parser: parserWork,
      };
    }
    return {
      goal: "parse",
      version: this.#snapshot.version,
      changes: applied.changes,
      lexer: relexed.work,
      parser: parserWork,
    };
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.onDispose();
  }

  #emptyUpdate():
    | IncrementalLexUpdate
    | IncrementalValidateUpdate
    | IncrementalParseUpdate {
    const lexer: IncrementalLexWork = {
      relexedRange: { start: 0, end: 0 },
      scannedCodeUnits: 0,
      createdTokens: 0,
      reusedTokens: this.#lexState.count,
    };
    if (this.goal === "lex") {
      return {
        goal: "lex",
        version: this.#snapshot.version,
        changes: [],
        lexer,
      };
    }
    const parser: IncrementalParserWork = {
      reparsedRanges: [],
      parserActions: 0,
      reuseChecks: 0,
      reusedCheckpoints: 0,
      createdCheckpoints: 0,
    };
    if (this.goal === "validate") {
      return {
        goal: "validate",
        version: this.#snapshot.version,
        changes: [],
        lexer,
        parser,
      };
    }
    return {
      goal: "parse",
      version: this.#snapshot.version,
      changes: [],
      lexer,
      parser,
    };
  }

  #refreshParserResults(): void {
    if (this.goal === "lex") {
      return;
    }
    this.#validateResult = externalIncrementalValidateResult(
      this.#snapshot,
      this.#validateCurrentRecords(),
    );
    if (this.goal === "parse") {
      this.#parseResult = externalIncrementalParseResult(
        this.#snapshot,
        this.#parseCurrentRecords(),
      );
    }
  }

  #validateCurrentRecords(): ValidateParseResult {
    const islandProgram = this.islandProgram;
    if (islandProgram === undefined) {
      throw new Error("Incremental validation has no strict island parser.");
    }
    return validateExternalIslandRecords(
      this.metadata,
      islandProgram,
      this.wasm,
      this.planByteLength,
      this.sourceCache,
      this.#source,
      {
        preserveTrivia: this.#preserveTrivia,
        maxParserActions: this.#maxParserActions,
      },
      externalIncrementalRawRecords(this.#lexState),
    );
  }

  #parseCurrentRecords(): CursorParseResult<Root> {
    const islandProgram = this.islandProgram;
    if (islandProgram === undefined) {
      throw new Error("Incremental parsing has no strict island parser.");
    }
    return parseExternalIslandRecords(
      this.metadata,
      islandProgram,
      this.wasm,
      this.planByteLength,
      this.sourceCache,
      this.#source,
      {
        preserveTrivia: this.#preserveTrivia,
        maxParserActions: this.#maxParserActions,
      },
      externalIncrementalRawRecords(this.#lexState),
    );
  }

  #assertLive(): void {
    if (this.#disposed) {
      throw new Error("Incremental document is disposed.");
    }
  }
}

function externalIncrementalValidateResult(
  snapshot: SourceSnapshot,
  result: ValidateParseResult,
): IncrementalValidateResult {
  if (result.ok) {
    return {
      ok: true,
      version: snapshot.version,
      snapshot,
      diagnostics: [],
    };
  }
  return {
    ok: false,
    version: snapshot.version,
    snapshot,
    diagnostics: result.diagnostics,
  };
}

function externalIncrementalParseResult<Root extends RuleCursor>(
  snapshot: SourceSnapshot,
  result: CursorParseResult<Root>,
): IncrementalParseResult<Root> {
  if (result.ok) {
    return {
      ok: true,
      version: snapshot.version,
      snapshot,
      cursor: result.cursor,
      diagnostics: [],
    };
  }
  return {
    ok: false,
    version: snapshot.version,
    snapshot,
    cursor: null,
    diagnostics: result.diagnostics,
  };
}

/**
 * Token tape backed by the raw Wasm lexer records.
 *
 * `records` is a detached copy of the Wasm token record buffer, four i32 per
 * record: spec index, start, end, accepting state. `keptRecordIndices` maps
 * tape positions onto record indices when trivia was dropped; it is `null`
 * when every record is kept and the mapping is the identity. The tape holds
 * `keptCount` real tokens followed by a synthetic EOF token.
 */
class ExternalTokenTape implements TokenTape {
  #cache: (Token | undefined)[] | undefined;

  constructor(
    private readonly metadata: ExternalRuntimeMetadata,
    private readonly source: string,
    private readonly records: Int32Array,
    private readonly keptRecordIndices: Int32Array | null,
    private readonly keptCount: number,
  ) {}

  get length(): number {
    return this.keptCount + 1;
  }

  token(index: number): Token | undefined {
    if (!Number.isInteger(index)) {
      return undefined;
    }
    if (index < 0 || index > this.keptCount) {
      return undefined;
    }
    let cache = this.#cache;
    if (cache === undefined) {
      cache = new Array(this.keptCount + 1);
      this.#cache = cache;
    }
    const cached = cache[index];
    if (cached !== undefined) {
      return cached;
    }
    let token: Token;
    if (index === this.keptCount) {
      token = externalEofToken(this.source.length);
    } else {
      let recordIndex = index;
      if (this.keptRecordIndices !== null) {
        const mapped = this.keptRecordIndices[index];
        if (mapped === undefined) {
          throw new Error("Token tape entry is missing.");
        }
        recordIndex = mapped;
      }
      token = materializeExternalTokenRecordValue(
        this.metadata,
        this.source,
        this.records,
        recordIndex,
      );
    }
    cache[index] = token;
    return token;
  }
}

function lexExternalWasmTape(
  metadata: ExternalRuntimeMetadata,
  wasm: ExternalParserWasmExports,
  planByteLength: number,
  sourceCache: ExternalWasmSourceCache,
  source: string,
  options: LexOptions = {},
): LexTapeResult {
  let preserveTrivia = metadata.defaultPreserveTrivia;
  if (options.preserveTrivia !== undefined) {
    if (typeof options.preserveTrivia !== "boolean") {
      throw new TypeError(
        `preserveTrivia must be a boolean, got '${
          String(options.preserveTrivia)
        }'.`,
      );
    }
    preserveTrivia = options.preserveTrivia;
  }
  const lexed = lexExternalRecords(wasm, planByteLength, sourceCache, source);
  if (!lexed.ok) {
    // The token arena for this source cannot fit in the wasm32 address space.
    // `parse` and `validate` report that as a diagnostic, so `lex` does too
    // rather than throwing a `RangeError` past the caller.
    return {
      source,
      tokenTape: new ExternalTokenTape(
        metadata,
        source,
        new Int32Array(0),
        null,
        0,
      ),
      diagnostics: [
        externalOversizedLexInputDiagnostic(source, lexed.requiredBytes),
      ],
    };
  }
  const records = lexed.records;
  const recordCount = lexed.count;
  const specIsTrivia = metadata.specIsTrivia;
  const specCount = metadata.specs.length;
  const diagnostics: ExternalLexDiagnostic[] = [];
  let dropTrivia = false;
  if (!preserveTrivia && metadata.hasTriviaSpecs) {
    dropTrivia = true;
  }
  if (!dropTrivia) {
    // Nothing can be filtered out, so the tape indexes the records directly
    // and only the error records need a diagnostic scan.
    for (let index = 0; index < recordCount; index++) {
      const base = index * WASM_TOKEN_RECORD_I32_COUNT;
      const specIndex = records[base];
      if (specIndex === undefined) {
        throw new Error("Wasm lexer token record is incomplete.");
      }
      if (specIndex >= specCount) {
        throw new Error("Wasm lexer emitted an unknown token spec.");
      }
      if (specIndex >= 0) {
        continue;
      }
      const start = records[base + 1];
      const end = records[base + 2];
      if (start === undefined || end === undefined) {
        throw new Error("Wasm lexer token record is incomplete.");
      }
      diagnostics.push(externalUnexpectedCharacterSpan(source, start, end));
    }
    return {
      source,
      tokenTape: new ExternalTokenTape(
        metadata,
        source,
        records,
        null,
        recordCount,
      ),
      diagnostics,
    };
  }
  const keptRecordIndices = new Int32Array(recordCount);
  let keptCount = 0;
  for (let index = 0; index < recordCount; index++) {
    const base = index * WASM_TOKEN_RECORD_I32_COUNT;
    const specIndex = records[base];
    if (specIndex === undefined) {
      throw new Error("Wasm lexer token record is incomplete.");
    }
    if (specIndex >= specCount) {
      throw new Error("Wasm lexer emitted an unknown token spec.");
    }
    if (specIndex < 0) {
      const start = records[base + 1];
      const end = records[base + 2];
      if (start === undefined || end === undefined) {
        throw new Error("Wasm lexer token record is incomplete.");
      }
      diagnostics.push(externalUnexpectedCharacterSpan(source, start, end));
      keptRecordIndices[keptCount] = index;
      keptCount++;
      continue;
    }
    if (specIsTrivia[specIndex] === 1) {
      continue;
    }
    keptRecordIndices[keptCount] = index;
    keptCount++;
  }
  return {
    source,
    tokenTape: new ExternalTokenTape(
      metadata,
      source,
      records,
      keptRecordIndices,
      keptCount,
    ),
    diagnostics,
  };
}

function lexExternalRecords(
  wasm: ExternalParserWasmExports,
  planByteLength: number,
  sourceCache: ExternalWasmSourceCache,
  source: string,
): ExternalLexRecordTape {
  let maxRecords = source.length;
  if (maxRecords < 1) {
    maxRecords = 1;
  }
  const sourcePtr = align(planByteLength, 8);
  const sourceByteLength = source.length * WASM_UTF16_UNIT_BYTES;
  const tokenPtr = align(sourcePtr + sourceByteLength, WASM_I32_BYTES);
  const recordBytes = WASM_TOKEN_RECORD_I32_COUNT * WASM_I32_BYTES;
  const memoPtr = align(tokenPtr + maxRecords * recordBytes, WASM_I32_BYTES);
  let memoCapacity = 0;
  let requiredBytes = memoPtr;
  if (!externalWasmCapacityFits(requiredBytes)) {
    return { ok: false, requiredBytes };
  }
  ensureExternalWasmCapacity(wasm.memory, requiredBytes);
  let view = writeExternalWasmSource(
    wasm.memory,
    sourcePtr,
    sourceCache,
    source,
  );
  let count = wasm.lex_all(
    sourcePtr,
    source.length,
    0,
    tokenPtr,
    maxRecords,
    memoPtr,
    memoCapacity,
  );
  if (count === -2) {
    memoCapacity = externalLexMemoCapacity(wasm, source.length);
    requiredBytes = memoPtr + memoCapacity * WASM_I32_BYTES;
    if (!externalWasmCapacityFits(requiredBytes)) {
      return { ok: false, requiredBytes };
    }
    ensureExternalWasmCapacity(wasm.memory, requiredBytes);
    count = wasm.lex_all(
      sourcePtr,
      source.length,
      0,
      tokenPtr,
      maxRecords,
      memoPtr,
      memoCapacity,
    );
    view = new DataView(wasm.memory.buffer);
  }
  if (count < 0 || count > maxRecords) {
    throw new Error("Wasm lexer returned an invalid token count.");
  }
  // `copyI32Tape` slices the records out of Wasm linear memory. A zero-copy
  // view must not escape here: the next `lex`/`parse` call reuses this region
  // and `memory.grow` detaches every view onto the old buffer.
  return {
    ok: true,
    records: copyI32Tape(
      view,
      tokenPtr,
      count * WASM_TOKEN_RECORD_I32_COUNT,
    ),
    count,
  };
}

function lexExternalIncrementalRecords(
  wasm: ExternalParserWasmExports,
  planByteLength: number,
  sourceCache: ExternalWasmSourceCache,
  sourceUpdate: ExternalWasmSourceUpdate | undefined,
  source: string,
  start: number,
  minimumEnd: number,
): ExternalIncrementalLexState {
  let maxRecords = source.length - start;
  if (maxRecords < 1) {
    maxRecords = 1;
  }
  const sourcePtr = align(planByteLength, 8);
  const sourceByteLength = source.length * WASM_UTF16_UNIT_BYTES;
  const tokenPtr = align(sourcePtr + sourceByteLength, WASM_I32_BYTES);
  const recordBytes = WASM_INCREMENTAL_TOKEN_RECORD_I32_COUNT * WASM_I32_BYTES;
  const memoPtr = align(tokenPtr + maxRecords * recordBytes, WASM_I32_BYTES);
  let memoCapacity = 0;
  let requiredBytes = memoPtr;
  if (!externalWasmCapacityFits(requiredBytes)) {
    throw new RangeError(
      externalOversizedInputMessage(
        source.length,
        requiredBytes,
        externalOversizedSplitRemedy,
      ),
    );
  }
  ensureExternalWasmCapacity(wasm.memory, requiredBytes);
  let view = writeExternalWasmSource(
    wasm.memory,
    sourcePtr,
    sourceCache,
    source,
    sourceUpdate,
  );
  let count = wasm.lex_incremental(
    sourcePtr,
    source.length,
    start,
    minimumEnd,
    tokenPtr,
    maxRecords,
    memoPtr,
    memoCapacity,
  );
  if (count === -2) {
    memoCapacity = externalLexMemoCapacity(wasm, source.length);
    requiredBytes = memoPtr + memoCapacity * WASM_I32_BYTES;
    if (!externalWasmCapacityFits(requiredBytes)) {
      throw new RangeError(
        externalOversizedInputMessage(
          source.length,
          requiredBytes,
          externalOversizedSplitRemedy,
        ),
      );
    }
    ensureExternalWasmCapacity(wasm.memory, requiredBytes);
    count = wasm.lex_incremental(
      sourcePtr,
      source.length,
      start,
      minimumEnd,
      tokenPtr,
      maxRecords,
      memoPtr,
      memoCapacity,
    );
    view = new DataView(wasm.memory.buffer);
  }
  if (count < 0 || count > maxRecords) {
    throw new Error(
      `Wasm incremental lexer returned token count ${count} for capacity ${maxRecords}.`,
    );
  }
  return {
    records: copyI32Tape(
      view,
      tokenPtr,
      count * WASM_INCREMENTAL_TOKEN_RECORD_I32_COUNT,
    ),
    count,
  };
}

const externalIslandStatusUnexpected = WASM_ISLAND_STATUS_UNEXPECTED;
const externalIslandStatusOk = WASM_ISLAND_STATUS_OK;
const externalIslandStatusLexical = WASM_ISLAND_STATUS_LEXICAL;
const externalIslandStatusTraceLimit = WASM_ISLAND_STATUS_TRACE_LIMIT;
const externalIslandStatusTrailing = WASM_ISLAND_STATUS_TRAILING;

interface ExternalWasmIslandRecords {
  readonly tokenPtr: number;
  readonly rawTokenCount: number;
  readonly nextPtr: number;
}

type ExternalWasmIslandRecordPreparation =
  | {
    readonly ok: true;
    readonly records: ExternalWasmIslandRecords;
  }
  | {
    readonly ok: false;
    readonly requiredBytes: number;
  };

type ExternalRustIslandAnalysis =
  | {
    readonly ok: true;
    readonly records: ExternalWasmIslandRecords;
    readonly resultPtr: number;
    readonly structuralTokenCount: number;
    readonly regionCount: number;
    readonly transitionFieldCount: number;
  }
  | {
    readonly ok: false;
    readonly diagnostics: readonly ExternalParseDiagnostic[];
  };

class ExternalWasmCapacityError extends RangeError {
  constructor(readonly requiredBytes: number) {
    super(`Wasm parser requires ${requiredBytes} bytes.`);
  }
}

function validateExternalIsland(
  metadata: ExternalRuntimeMetadata,
  program: StrictIslandParserProgram,
  wasm: ExternalParserWasmExports,
  planByteLength: number,
  sourceCache: ExternalWasmSourceCache,
  source: string,
  options: ParseOptions | undefined,
): ValidateParseResult {
  const maxParserActions = externalPositiveLimit(
    options,
    "maxParserActions",
    1_000_000,
  );
  const analysis = analyzeExternalIslandInRust(
    metadata,
    program,
    wasm,
    planByteLength,
    sourceCache,
    source,
    maxParserActions,
  );
  if (!analysis.ok) {
    return { ok: false, source, diagnostics: analysis.diagnostics };
  }
  return { ok: true, source, diagnostics: [] };
}

function parseExternalIsland<Root extends RuleCursor>(
  metadata: ExternalRuntimeMetadata,
  program: StrictIslandParserProgram,
  wasm: ExternalParserWasmExports,
  planByteLength: number,
  sourceCache: ExternalWasmSourceCache,
  source: string,
  options: ParseOptions | undefined,
): CursorParseResult<Root> {
  const maxParserActions = externalPositiveLimit(
    options,
    "maxParserActions",
    1_000_000,
  );
  const analysis = analyzeExternalIslandInRust(
    metadata,
    program,
    wasm,
    planByteLength,
    sourceCache,
    source,
    maxParserActions,
  );
  if (!analysis.ok) {
    return {
      ok: false,
      source,
      cursor: null,
      diagnostics: analysis.diagnostics,
    };
  }
  let preserveTrivia = metadata.defaultPreserveTrivia;
  if (options !== undefined && options.preserveTrivia !== undefined) {
    if (typeof options.preserveTrivia !== "boolean") {
      throw new TypeError(
        `preserveTrivia must be a boolean, got '${
          String(options.preserveTrivia)
        }'.`,
      );
    }
    preserveTrivia = options.preserveTrivia;
  }
  try {
    const cursor = materializeExternalIslandCursorInRust(
      metadata,
      program,
      wasm,
      source,
      analysis,
      preserveTrivia,
    );
    return { ok: true, source, cursor: cursor as Root, diagnostics: [] };
  } catch (error) {
    if (error instanceof ExternalWasmCapacityError) {
      return {
        ok: false,
        source,
        cursor: null,
        diagnostics: [externalOversizedInputDiagnostic(
          source,
          error.requiredBytes,
          externalOversizedSplitRemedy,
        )],
      };
    }
    return {
      ok: false,
      source,
      cursor: null,
      diagnostics: [
        externalInternalParserDiagnostic(error, {
          start: source.length,
          end: source.length,
        }),
      ],
    };
  }
}

function parseExternalIslandRecords<Root extends RuleCursor>(
  metadata: ExternalRuntimeMetadata,
  program: StrictIslandParserProgram,
  wasm: ExternalParserWasmExports,
  planByteLength: number,
  sourceCache: ExternalWasmSourceCache,
  source: string,
  options: ParseOptions | undefined,
  records: Int32Array,
): CursorParseResult<Root> {
  const maxParserActions = externalPositiveLimit(
    options,
    "maxParserActions",
    1_000_000,
  );
  const analysis = analyzeExternalIslandInRust(
    metadata,
    program,
    wasm,
    planByteLength,
    sourceCache,
    source,
    maxParserActions,
    records,
  );
  if (!analysis.ok) {
    return {
      ok: false,
      source,
      cursor: null,
      diagnostics: analysis.diagnostics,
    };
  }
  let preserveTrivia = metadata.defaultPreserveTrivia;
  if (options !== undefined && options.preserveTrivia !== undefined) {
    if (typeof options.preserveTrivia !== "boolean") {
      throw new TypeError(
        `preserveTrivia must be a boolean, got '${
          String(options.preserveTrivia)
        }'.`,
      );
    }
    preserveTrivia = options.preserveTrivia;
  }
  try {
    const cursor = materializeExternalIslandCursorInRust(
      metadata,
      program,
      wasm,
      source,
      analysis,
      preserveTrivia,
    );
    return { ok: true, source, cursor: cursor as Root, diagnostics: [] };
  } catch (error) {
    if (error instanceof ExternalWasmCapacityError) {
      return {
        ok: false,
        source,
        cursor: null,
        diagnostics: [externalOversizedInputDiagnostic(
          source,
          error.requiredBytes,
          externalOversizedSplitRemedy,
        )],
      };
    }
    return {
      ok: false,
      source,
      cursor: null,
      diagnostics: [
        externalInternalParserDiagnostic(error, {
          start: source.length,
          end: source.length,
        }),
      ],
    };
  }
}

function validateExternalIslandRecords(
  metadata: ExternalRuntimeMetadata,
  program: StrictIslandParserProgram,
  wasm: ExternalParserWasmExports,
  planByteLength: number,
  sourceCache: ExternalWasmSourceCache,
  source: string,
  options: ParseOptions | undefined,
  records: Int32Array,
): ValidateParseResult {
  const maxParserActions = externalPositiveLimit(
    options,
    "maxParserActions",
    1_000_000,
  );
  const analysis = analyzeExternalIslandInRust(
    metadata,
    program,
    wasm,
    planByteLength,
    sourceCache,
    source,
    maxParserActions,
    records,
  );
  if (!analysis.ok) {
    return { ok: false, source, diagnostics: analysis.diagnostics };
  }
  return { ok: true, source, diagnostics: [] };
}

function analyzeExternalIslandInRust(
  metadata: ExternalRuntimeMetadata,
  program: StrictIslandParserProgram,
  wasm: ExternalParserWasmExports,
  planByteLength: number,
  sourceCache: ExternalWasmSourceCache,
  source: string,
  maxParserActions: number,
  externalRecords?: Int32Array,
): ExternalRustIslandAnalysis {
  const prepared = prepareExternalWasmIslandRecords(
    wasm,
    planByteLength,
    sourceCache,
    source,
    externalRecords,
  );
  if (!prepared.ok) {
    return {
      ok: false,
      diagnostics: [
        externalOversizedInputDiagnostic(
          source,
          prepared.requiredBytes,
          externalOversizedSplitRemedy,
        ),
      ],
    };
  }
  const records = prepared.records;
  const resultPtr = align(records.nextPtr, WASM_I32_BYTES);
  const requiredBytes = resultPtr +
    WASM_ISLAND_RESULT_I32_COUNT * WASM_I32_BYTES;
  if (!externalWasmCapacityFits(requiredBytes)) {
    return {
      ok: false,
      diagnostics: [externalOversizedInputDiagnostic(
        source,
        requiredBytes,
        externalOversizedSplitRemedy,
      )],
    };
  }
  ensureExternalWasmCapacity(wasm.memory, requiredBytes);
  const status = wasm.analyze_island_records(
    records.tokenPtr,
    records.rawTokenCount,
    maxParserActions,
    resultPtr,
  );
  const view = new DataView(wasm.memory.buffer);
  if (status !== externalIslandStatusOk) {
    return {
      ok: false,
      diagnostics: [externalIslandStatusDiagnostic(
        metadata,
        program,
        source,
        view,
        records,
        resultPtr,
        status,
        maxParserActions,
      )],
    };
  }
  const structuralTokenCount = view.getInt32(resultPtr, true);
  const regionCount = view.getInt32(resultPtr + WASM_I32_BYTES, true);
  const transitionFieldCount = view.getInt32(
    resultPtr + WASM_I32_BYTES * 2,
    true,
  );
  if (
    structuralTokenCount < 0 ||
    structuralTokenCount > records.rawTokenCount ||
    regionCount < 0 ||
    regionCount > structuralTokenCount ||
    transitionFieldCount < 0 ||
    transitionFieldCount > structuralTokenCount
  ) {
    throw new Error("Rust island parser returned invalid analysis counts.");
  }
  return {
    ok: true,
    records,
    resultPtr,
    structuralTokenCount,
    regionCount,
    transitionFieldCount,
  };
}

function prepareExternalWasmIslandRecords(
  wasm: ExternalParserWasmExports,
  planByteLength: number,
  sourceCache: ExternalWasmSourceCache,
  source: string,
  externalRecords: Int32Array | undefined,
): ExternalWasmIslandRecordPreparation {
  const sourcePtr = align(planByteLength, 8);
  const sourceByteLength = source.length * WASM_UTF16_UNIT_BYTES;
  const tokenPtr = align(sourcePtr + sourceByteLength, WASM_I32_BYTES);
  let rawTokenCapacity = source.length;
  if (externalRecords !== undefined) {
    rawTokenCapacity = externalRecords.length /
      WASM_TOKEN_RECORD_I32_COUNT;
  }
  if (rawTokenCapacity < 1) {
    rawTokenCapacity = 1;
  }
  const tokenEnd = tokenPtr + rawTokenCapacity *
      WASM_TOKEN_RECORD_I32_COUNT * WASM_I32_BYTES;
  if (!externalWasmCapacityFits(tokenEnd)) {
    return { ok: false, requiredBytes: tokenEnd };
  }
  ensureExternalWasmCapacity(wasm.memory, tokenEnd);
  writeExternalWasmSource(
    wasm.memory,
    sourcePtr,
    sourceCache,
    source,
  );
  if (externalRecords !== undefined) {
    new Int32Array(
      wasm.memory.buffer,
      tokenPtr,
      externalRecords.length,
    ).set(externalRecords);
    return {
      ok: true,
      records: {
        tokenPtr,
        rawTokenCount: externalRecords.length /
          WASM_TOKEN_RECORD_I32_COUNT,
        nextPtr: tokenPtr + externalRecords.length * WASM_I32_BYTES,
      },
    };
  }
  let memoCapacity = 0;
  const memoPtr = align(tokenEnd, WASM_I32_BYTES);
  let rawTokenCount = wasm.lex_all(
    sourcePtr,
    source.length,
    0,
    tokenPtr,
    rawTokenCapacity,
    memoPtr,
    memoCapacity,
  );
  if (rawTokenCount === -2) {
    memoCapacity = externalLexMemoCapacity(wasm, source.length);
    const memoEnd = memoPtr + memoCapacity * WASM_I32_BYTES;
    if (!externalWasmCapacityFits(memoEnd)) {
      return { ok: false, requiredBytes: memoEnd };
    }
    ensureExternalWasmCapacity(wasm.memory, memoEnd);
    rawTokenCount = wasm.lex_all(
      sourcePtr,
      source.length,
      0,
      tokenPtr,
      rawTokenCapacity,
      memoPtr,
      memoCapacity,
    );
  }
  if (rawTokenCount < 0 || rawTokenCount > rawTokenCapacity) {
    throw new Error(
      `Wasm lexer returned token count ${rawTokenCount} for island capacity ${rawTokenCapacity}.`,
    );
  }
  return {
    ok: true,
    records: {
      tokenPtr,
      rawTokenCount,
      nextPtr: tokenPtr + rawTokenCount * WASM_TOKEN_RECORD_I32_COUNT *
          WASM_I32_BYTES,
    },
  };
}

function externalIslandStatusDiagnostic(
  metadata: ExternalRuntimeMetadata,
  program: StrictIslandParserProgram,
  source: string,
  view: DataView,
  records: ExternalWasmIslandRecords,
  resultPtr: number,
  status: number,
  maxParserActions: number,
): ExternalParseDiagnostic {
  const recordIndex = view.getInt32(
    resultPtr + WASM_I32_BYTES * 6,
    true,
  );
  const state = view.getInt32(resultPtr + WASM_I32_BYTES * 7, true);
  if (status === externalIslandStatusLexical) {
    const record = externalWasmTokenRecord(
      view,
      records,
      recordIndex,
    );
    const lexical = externalUnexpectedCharacterSpan(
      source,
      record.start,
      record.end,
    );
    return {
      ...externalParseDiagnostic(
        "PARSE_LEXICAL_ERROR",
        lexical.message,
        lexical.span,
      ),
      found: JSON.stringify(source.slice(record.start, record.end)),
    };
  }
  if (status === externalIslandStatusTraceLimit) {
    const record = externalWasmTokenRecord(
      view,
      records,
      recordIndex,
    );
    return externalParseDiagnostic(
      "PARSER_TRACE_LIMIT",
      `Parser exceeded the ${maxParserActions} transition action limit.`,
      { start: record.start, end: record.start },
    );
  }
  if (
    status !== externalIslandStatusUnexpected &&
    status !== externalIslandStatusTrailing
  ) {
    return externalParseDiagnostic(
      "PARSER_INTERNAL_ERROR",
      `Rust island parser failed with status ${status}.`,
      { start: source.length, end: source.length },
    );
  }
  const expected: string[] = [];
  for (
    let terminal = 0;
    terminal < program.validation.terminalCount;
    terminal += 1
  ) {
    const target = program.validation.transitions[terminal * 16 + state];
    if (target !== undefined && target < program.validation.stateCount) {
      const display = metadata.terminalDisplays[terminal];
      if (display === undefined) {
        throw new Error(`Terminal ${terminal} has no display name.`);
      }
      expected.push(display);
    }
  }

  if (recordIndex >= records.rawTokenCount) {
    return {
      ...externalParseDiagnostic(
        "PARSE_UNEXPECTED_TOKEN",
        "Unexpected token EOF.",
        { start: source.length, end: source.length },
        state,
      ),
      expected,
      found: "EOF",
    };
  }
  const record = externalWasmTokenRecord(
    view,
    records,
    recordIndex,
  );
  const token = externalCursorTokenDataFromSpec(
    metadata,
    record.specIndex,
    record.start,
    record.end,
    recordIndex,
  );
  const found = externalCursorTokenDisplay(metadata, source, token);
  let code: ExternalParseDiagnostic["code"] = "PARSE_UNEXPECTED_TOKEN";
  if (status === externalIslandStatusTrailing) {
    code = "PARSE_TRAILING_INPUT";
  }
  return {
    ...externalParseDiagnostic(
      code,
      `Unexpected token ${found}.`,
      { start: record.start, end: record.end },
      state,
    ),
    expected,
    found,
  };
}

function externalWasmTokenRecord(
  view: DataView,
  records: ExternalWasmIslandRecords,
  recordIndex: number,
): ExternalTokenRecord {
  if (recordIndex < 0 || recordIndex >= records.rawTokenCount) {
    throw new Error(
      `Rust island parser references raw token record ${recordIndex} of ${records.rawTokenCount}.`,
    );
  }
  const address = records.tokenPtr + recordIndex *
      WASM_TOKEN_RECORD_I32_COUNT * WASM_I32_BYTES;
  return {
    specIndex: view.getInt32(address, true),
    start: view.getInt32(address + WASM_I32_BYTES, true),
    end: view.getInt32(address + WASM_I32_BYTES * 2, true),
    acceptingState: view.getInt32(address + WASM_I32_BYTES * 3, true),
  };
}

function materializeExternalIslandCursorInRust(
  metadata: ExternalRuntimeMetadata,
  program: StrictIslandParserProgram,
  wasm: ExternalParserWasmExports,
  source: string,
  analysis: Extract<ExternalRustIslandAnalysis, { readonly ok: true }>,
  preserveTrivia: boolean,
): RuleCursor {
  let rootFieldCount = 0;
  if (program.rootField >= 0) {
    rootFieldCount = analysis.regionCount;
  }
  let tokenCount = analysis.structuralTokenCount;
  if (preserveTrivia) {
    tokenCount = analysis.records.rawTokenCount;
  }
  const ruleCount = analysis.regionCount + 1;
  const childCount = analysis.structuralTokenCount + analysis.regionCount;
  const fieldCount = analysis.transitionFieldCount + rootFieldCount;
  const valueCount = fieldCount;
  let cursor = align(
    analysis.resultPtr + WASM_ISLAND_RESULT_I32_COUNT * WASM_I32_BYTES,
    WASM_I32_BYTES,
  );
  const rulePtr = cursor;
  cursor += ruleCount * WASM_CURSOR_RULE_RECORD_I32_COUNT * WASM_I32_BYTES;
  const childPtr = align(cursor, WASM_I32_BYTES);
  cursor = childPtr + childCount * WASM_CURSOR_CHILD_RECORD_I32_COUNT *
      WASM_I32_BYTES;
  const fieldPtr = align(cursor, WASM_I32_BYTES);
  cursor = fieldPtr + fieldCount * WASM_CURSOR_FIELD_RECORD_I32_COUNT *
      WASM_I32_BYTES;
  const valuePtr = align(cursor, WASM_I32_BYTES);
  cursor = valuePtr + valueCount * WASM_CURSOR_VALUE_RECORD_I32_COUNT *
      WASM_I32_BYTES;
  if (!externalWasmCapacityFits(cursor)) {
    throw new ExternalWasmCapacityError(cursor);
  }
  ensureExternalWasmCapacity(wasm.memory, cursor);
  let preserveTriviaFlag = 0;
  if (preserveTrivia) {
    preserveTriviaFlag = 1;
  }
  const status = wasm.materialize_island_records(
    source.length,
    analysis.records.tokenPtr,
    analysis.records.rawTokenCount,
    preserveTriviaFlag,
    rulePtr,
    ruleCount,
    childPtr,
    childCount,
    fieldPtr,
    fieldCount,
    valuePtr,
    valueCount,
    analysis.resultPtr,
  );
  if (status !== externalIslandStatusOk) {
    throw new Error(
      `Rust island materializer failed with status ${status}.`,
    );
  }
  const view = new DataView(wasm.memory.buffer);
  const returnedTokenCount = view.getInt32(analysis.resultPtr, true);
  const returnedRuleCount = view.getInt32(
    analysis.resultPtr + WASM_I32_BYTES,
    true,
  );
  const returnedChildCount = view.getInt32(
    analysis.resultPtr + WASM_I32_BYTES * 2,
    true,
  );
  const returnedFieldCount = view.getInt32(
    analysis.resultPtr + WASM_I32_BYTES * 3,
    true,
  );
  const returnedValueCount = view.getInt32(
    analysis.resultPtr + WASM_I32_BYTES * 4,
    true,
  );
  const rootRef = view.getInt32(
    analysis.resultPtr + WASM_I32_BYTES * 5,
    true,
  );
  if (
    returnedTokenCount !== tokenCount ||
    returnedRuleCount !== ruleCount ||
    returnedChildCount !== childCount ||
    returnedFieldCount !== fieldCount ||
    returnedValueCount !== valueCount ||
    rootRef !== 0
  ) {
    throw new Error("Rust island materializer returned invalid tape counts.");
  }
  const tape = new ExternalCursorTapeView(
    metadata,
    source,
    copyI32Tape(
      view,
      analysis.records.tokenPtr,
      tokenCount * WASM_TOKEN_RECORD_I32_COUNT,
    ),
    copyI32Tape(
      view,
      rulePtr,
      ruleCount * WASM_CURSOR_RULE_RECORD_I32_COUNT,
    ),
    copyI32Tape(
      view,
      childPtr,
      childCount * WASM_CURSOR_CHILD_RECORD_I32_COUNT,
    ),
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
    new Int32Array(0),
  );
  const root = tape.cursorForRuleRef(rootRef);
  externalCursorTapeByRoot.set(root, tape);
  return root;
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
  records: Int32Array,
  recordIndex: number,
): Token {
  const base = recordIndex * WASM_TOKEN_RECORD_I32_COUNT;
  const specIndex = records[base];
  const start = records[base + 1];
  const end = records[base + 2];
  if (specIndex === undefined || start === undefined || end === undefined) {
    throw new Error("Wasm lexer token record is incomplete.");
  }
  if (specIndex < 0) {
    return externalErrorToken(source, start, end);
  }
  const spec = metadata.specs[specIndex];
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
      span: { start, end },
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
    start,
    end,
    named.channel,
  );
}

interface ExternalCursorTapeReuse {
  readonly tape: ExternalCursorTapeView;
  readonly unchangedPrefixEnd: number;
}

const externalCursorTapeByRoot = new WeakMap<
  RuleCursor,
  ExternalCursorTapeView
>();

class ExternalCursorTapeView {
  private readonly ruleCache: (RuleCursor | undefined)[] = [];
  private readonly tokenCache: (TokenCursor | undefined)[] = [];
  private reuse: ExternalCursorTapeReuse | undefined;

  constructor(
    private readonly metadata: ExternalRuntimeMetadata,
    private readonly source: string,
    private readonly tokenRecords: Int32Array,
    private readonly ruleRecords: Int32Array,
    private readonly childRefs: Int32Array,
    private readonly fieldRecords: Int32Array,
    private readonly valueRecords: Int32Array,
    private readonly valueItems: Int32Array,
    reuse?: ExternalCursorTapeReuse,
  ) {
    this.reuse = reuse;
    if (reuse !== undefined) {
      reuse.tape.reuse = undefined;
    }
  }

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
    if (
      this.reuse !== undefined &&
      span.end <= this.reuse.unchangedPrefixEnd
    ) {
      let recordMatches = true;
      for (
        let field = 0;
        field < WASM_CURSOR_RULE_RECORD_I32_COUNT;
        field++
      ) {
        if (
          this.ruleRecords[base + field] !==
            this.reuse.tape.ruleRecords[base + field]
        ) {
          recordMatches = false;
          break;
        }
      }
      for (
        let tokenIndex = tokenRange.start;
        recordMatches && tokenIndex < tokenRange.end;
        tokenIndex++
      ) {
        const tokenBase = tokenIndex * WASM_TOKEN_RECORD_I32_COUNT;
        for (
          let field = 0;
          field < WASM_TOKEN_RECORD_I32_COUNT;
          field++
        ) {
          if (
            this.tokenRecords[tokenBase + field] !==
              this.reuse.tape.tokenRecords[tokenBase + field]
          ) {
            recordMatches = false;
            break;
          }
        }
      }
      if (recordMatches) {
        const previous = this.reuse.tape.ruleCursor(ruleIndex);
        this.ruleCache[ruleIndex] = previous;
        return previous;
      }
    }
    let childrenCache: readonly SyntaxCursor[] | undefined;
    // Child edges form a singly linked node list in the Wasm arena, so a child
    // index has to be resolved by walking. Sequential access keeps a walk
    // cursor and costs one link step per child. The first non-monotonic access
    // materializes the whole node list once (one i32 per child) and every
    // access after that is a direct index, so reverse and random traversal of
    // a long child list stay linear in total instead of quadratic.
    let childNodes: Int32Array | undefined;
    let walkIndex = 0;
    let walkNode = childStart;
    const cursor: RuleCursor = {
      type: "rule",
      name,
      span,
      tokenRange,
      childCount,
      child: (index: number): SyntaxCursor | undefined => {
        if (!Number.isInteger(index) || index < 0) return undefined;
        if (index >= childCount) return undefined;
        if (childNodes === undefined && index < walkIndex) {
          const nodes = new Int32Array(childCount);
          let node = childStart;
          for (let position = 0; position < childCount; position++) {
            nodes[position] = node;
            if (position + 1 < childCount) {
              node = this.childEdgeNext(node);
            }
          }
          childNodes = nodes;
        }
        let childNode: number;
        if (childNodes !== undefined) {
          const indexed = childNodes[index];
          if (indexed === undefined) {
            throw new Error("Cursor child edge is missing.");
          }
          childNode = indexed;
        } else {
          while (walkIndex < index) {
            walkNode = this.childEdgeNext(walkNode);
            walkIndex++;
          }
          childNode = walkNode;
        }
        const ref =
          this.childRefs[childNode * WASM_CURSOR_CHILD_RECORD_I32_COUNT];
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
              for (const itemId of this.arrayItemIds(start, count)) {
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

  private childEdgeNext(node: number): number {
    const next = this.childRefs[node * WASM_CURSOR_CHILD_RECORD_I32_COUNT + 1];
    if (next === undefined || next < 0) {
      throw new Error("Cursor child edge is missing.");
    }
    return next;
  }

  private arrayItemIds(head: number, count: number): number[] {
    const items: number[] = [];
    let node = head;
    for (let index = 0; index < count; index++) {
      if (node < 0) {
        throw new Error("Cursor field array item is missing.");
      }
      const itemId =
        this.valueItems[node * WASM_CURSOR_VALUE_ITEM_RECORD_I32_COUNT];
      const next =
        this.valueItems[node * WASM_CURSOR_VALUE_ITEM_RECORD_I32_COUNT + 1];
      if (itemId === undefined || next === undefined) {
        throw new Error("Cursor field array item is missing.");
      }
      items.push(itemId);
      node = next;
    }
    return items;
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
      for (const itemId of this.arrayItemIds(start, count)) {
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

const externalOversizedSplitRemedy =
  "Split the input into smaller units and parse them separately.";

function externalOversizedInputMessage(
  sourceLength: number,
  requiredBytes: number,
  remedy: string,
): string {
  const limitBytes = WASM_MAX_PAGES * WASM_PAGE_BYTES;
  return `Parsing ${sourceLength} source units needs ${requiredBytes} bytes ` +
    `of WebAssembly memory, which exceeds the ${limitBytes} byte wasm32 ` +
    `address-space limit (${WASM_MAX_PAGES} pages). ${remedy}`;
}

function externalOversizedInputDiagnostic(
  source: string,
  requiredBytes: number,
  remedy: string,
): ExternalParseDiagnostic {
  return externalParseDiagnostic(
    "PARSER_INPUT_TOO_LARGE",
    externalOversizedInputMessage(source.length, requiredBytes, remedy),
    { start: source.length, end: source.length },
  );
}

function externalOversizedLexInputDiagnostic(
  source: string,
  requiredBytes: number,
): ExternalLexDiagnostic {
  return {
    code: "PARSER_INPUT_TOO_LARGE",
    message: externalOversizedInputMessage(
      source.length,
      requiredBytes,
      "Split the input into smaller units and lex them separately.",
    ),
    span: { start: source.length, end: source.length },
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
    case "PARSER_INPUT_TOO_LARGE":
      return parserDiagnosticCodeInputTooLarge;
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

function externalPositiveLimit(
  options: ParseOptions | undefined,
  key: "maxParserActions",
  fallback: number,
): number {
  if (options === undefined) return fallback;
  const value = options[key];
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(
      `${key} must be a positive safe integer, got '${String(value)}'.`,
    );
  }
  return value;
}

function externalLexMemoCapacity(
  wasm: ExternalParserWasmExports,
  sourceLength: number,
): number {
  const wordsPerPosition = wasm.lex_memo_i32_per_position();
  const capacity = (sourceLength + 1) * wordsPerPosition;
  if (!Number.isSafeInteger(capacity) || capacity < 0) {
    throw new RangeError(
      `Wasm lexer memo capacity is invalid for ${sourceLength} source units and ${wordsPerPosition} words per position.`,
    );
  }
  return capacity;
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
  if (typeof wasm.lex_incremental !== "function") {
    throw new Error("Wasm ABI is missing the lex_incremental export.");
  }
  if (typeof wasm.analyze_island_records !== "function") {
    throw new Error("Wasm ABI is missing the analyze_island_records export.");
  }
  if (typeof wasm.materialize_island_records !== "function") {
    throw new Error(
      "Wasm ABI is missing the materialize_island_records export.",
    );
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
  if (
    wasm.incremental_token_record_i32_count() !==
      WASM_INCREMENTAL_TOKEN_RECORD_I32_COUNT
  ) {
    throw new Error(
      "Wasm incremental token record width does not match shared adapter.",
    );
  }
  if (wasm.island_result_i32_count() !== WASM_ISLAND_RESULT_I32_COUNT) {
    throw new Error(
      "Wasm island result width does not match shared adapter.",
    );
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

function externalWasmCapacityFits(requiredBytes: number): boolean {
  if (!Number.isSafeInteger(requiredBytes) || requiredBytes < 0) {
    return false;
  }
  return Math.ceil(requiredBytes / WASM_PAGE_BYTES) <= WASM_MAX_PAGES;
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

function writeExternalWasmSource(
  memory: WebAssembly.Memory,
  sourcePtr: number,
  cache: ExternalWasmSourceCache,
  source: string,
  update?: ExternalWasmSourceUpdate,
): DataView {
  const view = new DataView(memory.buffer);
  if (cache.source === source) {
    return view;
  }
  if (update === undefined || cache.source !== update.previousSource) {
    for (let index = 0; index < source.length; index++) {
      view.setUint16(
        sourcePtr + index * WASM_UTF16_UNIT_BYTES,
        source.charCodeAt(index),
        true,
      );
    }
    cache.source = source;
    return view;
  }
  const firstEdit = update.edits[0];
  const finalEdit = update.edits[update.edits.length - 1];
  if (firstEdit === undefined || finalEdit === undefined) {
    throw new Error("Incremental Wasm source update has no edits.");
  }
  let preservesLength = true;
  for (const edit of update.edits) {
    if (edit.newText.length !== edit.oldEnd - edit.start) {
      preservesLength = false;
      break;
    }
  }
  if (preservesLength) {
    for (const edit of update.edits) {
      for (let index = 0; index < edit.newText.length; index++) {
        view.setUint16(
          sourcePtr +
            (edit.start + index) * WASM_UTF16_UNIT_BYTES,
          edit.newText.charCodeAt(index),
          true,
        );
      }
    }
    cache.source = source;
    return view;
  }
  const oldSuffixStart = finalEdit.oldEnd;
  const newSuffixStart = oldSuffixStart +
    source.length -
    update.previousSource.length;
  const bytes = new Uint8Array(memory.buffer);
  bytes.copyWithin(
    sourcePtr + newSuffixStart * WASM_UTF16_UNIT_BYTES,
    sourcePtr + oldSuffixStart * WASM_UTF16_UNIT_BYTES,
    sourcePtr + update.previousSource.length * WASM_UTF16_UNIT_BYTES,
  );
  for (let index = firstEdit.start; index < newSuffixStart; index++) {
    view.setUint16(
      sourcePtr + index * WASM_UTF16_UNIT_BYTES,
      source.charCodeAt(index),
      true,
    );
  }
  cache.source = source;
  return view;
}
