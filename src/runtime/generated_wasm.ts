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
  WASM_ABI_VERSION,
  WASM_ACTION_ACCEPT,
  WASM_ACTION_PAYLOAD_MASK,
  WASM_ACTION_REDUCE,
  WASM_ACTION_SHIFT,
  WASM_CURSOR_CHILD_RECORD_I32_COUNT,
  WASM_CURSOR_FIELD_RECORD_I32_COUNT,
  WASM_CURSOR_FRAGMENT_RECORD_I32_COUNT,
  WASM_CURSOR_RULE_RECORD_I32_COUNT,
  WASM_CURSOR_VALUE_ITEM_RECORD_I32_COUNT,
  WASM_CURSOR_VALUE_RECORD_I32_COUNT,
  WASM_HOST_OWNERSHIP_CALLER_MANAGED,
  WASM_I32_BYTES,
  WASM_INCREMENTAL_TOKEN_RECORD_I32_COUNT,
  WASM_LEX_RESULT_I32_COUNT,
  WASM_MAX_PAGES,
  WASM_PAGE_BYTES,
  WASM_PARSE_CURSOR_RESULT_I32_COUNT,
  WASM_PARSE_STATUS_MEMO_REQUIRED,
  WASM_RESULT_LIFETIME_CALLER_BUFFER,
  WASM_SOURCE_ENCODING_UTF16,
  WASM_SPAN_UNIT_UTF16,
  WASM_TARGET_KIND,
  WASM_TOKEN_RECORD_I32_COUNT,
  WASM_UTF16_UNIT_BYTES,
  WASM_VALIDATE_RESULT_I32_COUNT,
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
  incremental_token_record_i32_count(): number;
  parser_action(state: number, terminal: number): number;
  parser_goto(state: number, nonterminal: number): number;
  parser_select_incremental(
    state: number,
    acceptingState: number,
    fallbackSpec: number,
    sourcePtr: number,
    sourceLength: number,
    endOffset: number,
    resultPtr: number,
  ): number;
  validate(
    sourcePtr: number,
    sourceLength: number,
    resultPtr: number,
    stackPtr: number,
    stackCapacity: number,
    memoPtr: number,
    memoCapacity: number,
    maxParserActions: number,
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
    memoPtr: number,
    memoCapacity: number,
    preserveTrivia: number,
    maxParserActions: number,
  ): number;
  parse_cursor_records(
    sourcePtr: number,
    sourceLength: number,
    tokenPtr: number,
    rawTokenCount: number,
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
    maxParserActions: number,
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
  validate_result_i32_count(): number;
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

  readonly parse: ParserInstance<Root>["parse"];

  constructor(
    private readonly planBytes: Uint8Array,
    private readonly validatedPlan: ValidatedWasmParserPlan,
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
    return validateExternalWasm(
      this.#loadMetadata(),
      this.wasm,
      this.inputBase,
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
      this.wasm,
      this.inputBase,
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
    return parseExternalCursorWithWasm(
      metadata,
      this.wasm,
      this.inputBase,
      source,
      options,
      records.slice(),
    ) as CursorParseResult<Root>;
  }

  reset(): void {
    this.#assertLive();
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
  readonly eofTerminal: number;
  readonly parserStateCount: number;
  readonly productions: readonly ExternalProduction[];
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
  readonly expected: readonly (readonly string[])[];
  readonly ruleNames: readonly string[];
  readonly fieldIds: ReadonlyMap<string, number>;
  readonly fieldNames: readonly string[];
  readonly fieldSchemas: readonly (ExternalRuleFieldSchema | undefined)[];
}

interface ExternalProduction {
  readonly lhs: number;
  readonly rhsLength: number;
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
const EXTERNAL_CORE_HEADER_PRODUCTION_COUNT = 19;
const EXTERNAL_CORE_HEADER_PRODUCTIONS = 20;
const EXTERNAL_CORE_COMPACT_I16_OFFSET_TAG = 2;
const EXTERNAL_CORE_COMPACT_U16_OFFSET_BASE = 0x4000_0000;
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

  const parserStateCount = readCoreI32(
    planBytes,
    EXTERNAL_CORE_HEADER_PARSER_STATE_COUNT,
  );
  const productionCount = readCoreI32(
    planBytes,
    EXTERNAL_CORE_HEADER_PRODUCTION_COUNT,
  );
  const productionOffset = readCoreI32(
    planBytes,
    EXTERNAL_CORE_HEADER_PRODUCTIONS,
  );
  const productions: ExternalProduction[] = [];
  for (let production = 0; production < productionCount; production++) {
    const base = productionOffset + production * WASM_I32_BYTES * 4;
    productions.push({
      lhs: readI32AtByteOffset(planBytes, base),
      rhsLength: readI32AtByteOffset(
        planBytes,
        base + WASM_I32_BYTES,
      ),
    });
  }
  const expected = externalExpectedRowsFromCorePlan(
    planBytes,
    parserStateCount,
    terminalDisplays,
  );
  return {
    defaultPreserveTrivia,
    eofTerminal,
    parserStateCount,
    productions,
    specs,
    specIsTrivia,
    hasTriviaSpecs,
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
const externalParseStatusOk = 0;
const externalParseStatusUnexpected = 1;
const externalParseCursorStatusCapacity = 3;
const externalParseStatusActionLimit = 4;
const externalParseStatusAmbiguous = 5;
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
  previous: ExternalIncrementalLexState,
  oldSourceLength: number,
  source: string,
  edits: readonly TextEdit[],
  searchFloorOffset: number,
  searchFloorToken: number,
): ExternalIncrementalRelexResult {
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
      source,
      cursor,
      minimumEnd,
    );
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

class ExternalParserStackNode {
  readonly children = new Map<number, ExternalParserStackNode>();

  constructor(
    readonly state: number,
    readonly parent: ExternalParserStackNode | undefined,
    readonly depth: number,
  ) {}
}

class ExternalParserStackPool {
  readonly root = new ExternalParserStackNode(0, undefined, 1);
  private creationCount = 1;
  private lastPrunedCreationCount = 0;

  push(
    parent: ExternalParserStackNode,
    state: number,
  ): ExternalParserStackNode {
    const existing = parent.children.get(state);
    if (existing !== undefined) {
      return existing;
    }
    const node = new ExternalParserStackNode(
      state,
      parent,
      parent.depth + 1,
    );
    parent.children.set(state, node);
    this.creationCount++;
    return node;
  }

  pop(
    node: ExternalParserStackNode,
    count: number,
  ): ExternalParserStackNode | undefined {
    let current: ExternalParserStackNode | undefined = node;
    for (let index = 0; index < count; index++) {
      if (current === undefined) {
        return undefined;
      }
      current = current.parent;
    }
    return current;
  }

  prune(checkpoints: readonly ExternalParserStackNode[]): void {
    const retained = new Set<ExternalParserStackNode>();
    for (const checkpoint of checkpoints) {
      let node: ExternalParserStackNode | undefined = checkpoint;
      while (node !== undefined && !retained.has(node)) {
        retained.add(node);
        node = node.parent;
      }
    }
    for (const node of retained) {
      for (const [state, child] of node.children) {
        if (!retained.has(child)) {
          node.children.delete(state);
        }
      }
    }
    this.lastPrunedCreationCount = this.creationCount;
  }

  pruneAfterUpdate(checkpoints: readonly ExternalParserStackNode[]): void {
    // Pruning scans every checkpoint, so amortize it while bounding unpruned
    // stack growth to fewer than 1,024 newly interned nodes.
    if (this.creationCount - this.lastPrunedCreationCount < 1_024) {
      return;
    }
    this.prune(checkpoints);
  }
}

interface ExternalValidationState {
  readonly checkpoints: readonly ExternalParserStackNode[];
  readonly actionCounts: readonly number[];
  readonly result: ValidateParseResult;
  readonly totalActionCount: number;
  readonly stoppedTokenIndex: number;
}

interface ExternalValidationRun {
  readonly state: ExternalValidationState;
  readonly work: IncrementalParserWork;
}

function externalRunIncrementalValidation(
  metadata: ExternalRuntimeMetadata,
  wasm: ExternalParserWasmExports,
  planByteLength: number,
  source: string,
  lexState: ExternalIncrementalLexState,
  maxParserActions: number,
  stackPool: ExternalParserStackPool,
  previous: ExternalValidationState | undefined,
  relexed: ExternalIncrementalRelexResult | undefined,
): ExternalValidationRun {
  const sourcePtr = align(planByteLength, 8);
  const sourceByteLength = source.length * WASM_UTF16_UNIT_BYTES;
  const selectionPtr = align(sourcePtr + sourceByteLength, WASM_I32_BYTES);
  ensureExternalWasmCapacity(
    wasm.memory,
    selectionPtr + WASM_I32_BYTES * 4,
  );

  let tokenIndex = 0;
  let stack = stackPool.root;
  let logicalActionCount = 0;
  let parserActions = 0;
  let checkpoints: ExternalParserStackNode[] = [stack];
  let actionCounts: number[] = [0];
  if (previous !== undefined && relexed !== undefined) {
    tokenIndex = Math.min(
      relexed.oldPrefixTokenCount,
      previous.checkpoints.length - 1,
    );
    const previousStack = previous.checkpoints[tokenIndex];
    const previousActionCount = previous.actionCounts[tokenIndex];
    if (previousStack === undefined || previousActionCount === undefined) {
      throw new Error(
        `Incremental validation checkpoint ${tokenIndex} is missing.`,
      );
    }
    stack = previousStack;
    logicalActionCount = previousActionCount;
    checkpoints = previous.checkpoints.slice(0, tokenIndex + 1);
    actionCounts = previous.actionCounts.slice(0, tokenIndex + 1);
  }
  const reparseTokenStart = tokenIndex;

  const reparsedStart = externalIncrementalTokenStart(
    lexState,
    tokenIndex,
    source.length,
  );
  let reparsedEnd = reparsedStart;
  let reuseChecks = 0;
  while (true) {
    if (
      previous !== undefined && relexed !== undefined &&
      tokenIndex >= relexed.newSuffixTokenStart
    ) {
      reuseChecks++;
      const oldTokenIndex = relexed.oldSuffixTokenStart +
        (tokenIndex - relexed.newSuffixTokenStart);
      const oldStack = previous.checkpoints[oldTokenIndex];
      const oldActionCount = previous.actionCounts[oldTokenIndex];
      if (
        previous.result.ok && oldStack === stack &&
        oldActionCount !== undefined
      ) {
        const projectedActionCount = logicalActionCount +
          (previous.totalActionCount - oldActionCount);
        if (projectedActionCount <= maxParserActions) {
          const actionDelta = logicalActionCount - oldActionCount;
          checkpoints = checkpoints.concat(
            previous.checkpoints.slice(oldTokenIndex + 1),
          );
          const suffixActionCounts = previous.actionCounts.slice(
            oldTokenIndex + 1,
          );
          if (actionDelta !== 0) {
            for (let index = 0; index < suffixActionCounts.length; index++) {
              const previousCount = suffixActionCounts[index];
              if (previousCount === undefined) {
                throw new Error(
                  `Incremental validation suffix action count ${index} is missing.`,
                );
              }
              suffixActionCounts[index] = previousCount + actionDelta;
            }
          }
          actionCounts = actionCounts.concat(suffixActionCounts);
          return {
            state: {
              checkpoints,
              actionCounts,
              result: { ok: true, source, diagnostics: [] },
              totalActionCount: projectedActionCount,
              stoppedTokenIndex: lexState.count,
            },
            work: {
              reparsedRanges: externalNonEmptyRanges(
                reparsedStart,
                reparsedEnd,
              ),
              parserActions,
              reuseChecks,
              reusedCheckpoints: reparseTokenStart +
                previous.checkpoints.length - oldTokenIndex - 1,
              createdCheckpoints: tokenIndex - reparseTokenStart,
            },
          };
        }
      }
    }

    const state = stack.state;
    let action: number;
    let selectedSpec = -2;
    let tokenStart = source.length;
    let tokenEnd = source.length;
    if (tokenIndex < lexState.count) {
      const base = tokenIndex * WASM_INCREMENTAL_TOKEN_RECORD_I32_COUNT;
      const fallbackSpec = lexState.records[base];
      tokenStart = lexState.records[base + 1];
      tokenEnd = lexState.records[base + 2];
      const acceptingState = lexState.records[base + 3];
      if (
        fallbackSpec === undefined || tokenStart === undefined ||
        tokenEnd === undefined || acceptingState === undefined
      ) {
        throw new Error(
          `Incremental token record ${tokenIndex} is incomplete.`,
        );
      }
      if (fallbackSpec < 0) {
        const diagnostic = externalValidateStatusDiagnostic(
          metadata,
          source,
          externalParseStatusUnexpected,
          state,
          fallbackSpec,
          tokenStart,
          tokenEnd,
        );
        return externalFailedValidationRun(
          source,
          diagnostic,
          checkpoints,
          actionCounts,
          logicalActionCount,
          tokenIndex,
          parserActions,
          reuseChecks,
          reparsedStart,
          tokenEnd,
          reparseTokenStart,
        );
      }
      const selectionStatus = wasm.parser_select_incremental(
        state,
        acceptingState,
        fallbackSpec,
        sourcePtr,
        source.length,
        tokenEnd,
        selectionPtr,
      );
      const selectionView = new DataView(wasm.memory.buffer);
      selectedSpec = selectionView.getInt32(
        selectionPtr + WASM_I32_BYTES,
        true,
      );
      if (selectionStatus === 2) {
        tokenIndex++;
        reparsedEnd = tokenEnd;
        checkpoints.push(stack);
        actionCounts.push(logicalActionCount);
        continue;
      }
      if (selectionStatus !== 1) {
        const diagnostic = externalValidateStatusDiagnostic(
          metadata,
          source,
          externalParseStatusUnexpected,
          state,
          fallbackSpec,
          tokenStart,
          tokenEnd,
        );
        return externalFailedValidationRun(
          source,
          diagnostic,
          checkpoints,
          actionCounts,
          logicalActionCount,
          tokenIndex,
          parserActions,
          reuseChecks,
          reparsedStart,
          tokenEnd,
          reparseTokenStart,
        );
      }
      action = selectionView.getInt32(
        selectionPtr + WASM_I32_BYTES * 3,
        true,
      );
    } else {
      action = wasm.parser_action(state, metadata.eofTerminal);
      if (action <= 0) {
        const diagnostic = externalValidateStatusDiagnostic(
          metadata,
          source,
          externalParseStatusUnexpected,
          state,
          -2,
          source.length,
          source.length,
        );
        return externalFailedValidationRun(
          source,
          diagnostic,
          checkpoints,
          actionCounts,
          logicalActionCount,
          tokenIndex,
          parserActions,
          reuseChecks,
          reparsedStart,
          source.length,
          reparseTokenStart,
        );
      }
    }

    if (logicalActionCount >= maxParserActions) {
      const diagnostic = externalValidateStatusDiagnostic(
        metadata,
        source,
        externalParseStatusActionLimit,
        state,
        selectedSpec,
        tokenStart,
        tokenEnd,
      );
      return externalFailedValidationRun(
        source,
        diagnostic,
        checkpoints,
        actionCounts,
        logicalActionCount,
        tokenIndex,
        parserActions,
        reuseChecks,
        reparsedStart,
        tokenEnd,
        reparseTokenStart,
      );
    }
    logicalActionCount++;
    parserActions++;
    const kind = action & 0xff_00_00_00;
    const payload = action & WASM_ACTION_PAYLOAD_MASK;
    if (kind === WASM_ACTION_SHIFT) {
      stack = stackPool.push(stack, payload);
      tokenIndex++;
      reparsedEnd = tokenEnd;
      checkpoints.push(stack);
      actionCounts.push(logicalActionCount);
      continue;
    }
    if (kind === WASM_ACTION_REDUCE) {
      const production = metadata.productions[payload];
      if (production === undefined) {
        return externalInternalValidationRun(
          source,
          `Incremental parser references unknown production ${payload}.`,
          checkpoints,
          actionCounts,
          logicalActionCount,
          tokenIndex,
          parserActions,
          reuseChecks,
          reparsedStart,
          tokenEnd,
          reparseTokenStart,
        );
      }
      const gotoSource = stackPool.pop(stack, production.rhsLength);
      if (gotoSource === undefined) {
        return externalInternalValidationRun(
          source,
          `Incremental parser production ${payload} pops ${production.rhsLength} states from stack depth ${stack.depth}.`,
          checkpoints,
          actionCounts,
          logicalActionCount,
          tokenIndex,
          parserActions,
          reuseChecks,
          reparsedStart,
          tokenEnd,
          reparseTokenStart,
        );
      }
      const gotoState = wasm.parser_goto(gotoSource.state, production.lhs);
      if (gotoState < 0) {
        return externalInternalValidationRun(
          source,
          `Incremental parser has no goto from state ${gotoSource.state} on nonterminal ${production.lhs}.`,
          checkpoints,
          actionCounts,
          logicalActionCount,
          tokenIndex,
          parserActions,
          reuseChecks,
          reparsedStart,
          tokenEnd,
          reparseTokenStart,
        );
      }
      stack = stackPool.push(gotoSource, gotoState);
      continue;
    }
    if (kind === WASM_ACTION_ACCEPT) {
      return {
        state: {
          checkpoints,
          actionCounts,
          result: { ok: true, source, diagnostics: [] },
          totalActionCount: logicalActionCount,
          stoppedTokenIndex: tokenIndex,
        },
        work: {
          reparsedRanges: externalNonEmptyRanges(
            reparsedStart,
            reparsedEnd,
          ),
          parserActions,
          reuseChecks,
          reusedCheckpoints: reparseTokenStart,
          createdCheckpoints: tokenIndex - reparseTokenStart,
        },
      };
    }
    return externalInternalValidationRun(
      source,
      `Incremental parser received unknown action ${action}.`,
      checkpoints,
      actionCounts,
      logicalActionCount,
      tokenIndex,
      parserActions,
      reuseChecks,
      reparsedStart,
      tokenEnd,
      reparseTokenStart,
    );
  }
}

function externalIncrementalTokenStart(
  state: ExternalIncrementalLexState,
  tokenIndex: number,
  sourceLength: number,
): number {
  if (tokenIndex >= state.count) {
    return sourceLength;
  }
  const start = state.records[
    tokenIndex * WASM_INCREMENTAL_TOKEN_RECORD_I32_COUNT + 1
  ];
  if (start === undefined) {
    throw new Error(`Incremental token record ${tokenIndex} has no start.`);
  }
  return start;
}

function externalNonEmptyRanges(
  start: number,
  end: number,
): readonly Span[] {
  if (end <= start) {
    return [];
  }
  return [{ start, end }];
}

function externalFailedValidationRun(
  source: string,
  diagnostic: ExternalParseDiagnostic,
  checkpoints: readonly ExternalParserStackNode[],
  actionCounts: readonly number[],
  totalActionCount: number,
  stoppedTokenIndex: number,
  parserActions: number,
  reuseChecks: number,
  reparsedStart: number,
  reparsedEnd: number,
  reparseTokenStart: number,
): ExternalValidationRun {
  const createdCheckpoints = stoppedTokenIndex - reparseTokenStart;
  return {
    state: {
      checkpoints,
      actionCounts,
      result: { ok: false, source, diagnostics: [diagnostic] },
      totalActionCount,
      stoppedTokenIndex,
    },
    work: {
      reparsedRanges: externalNonEmptyRanges(reparsedStart, reparsedEnd),
      parserActions,
      reuseChecks,
      reusedCheckpoints: reparseTokenStart,
      createdCheckpoints,
    },
  };
}

function externalInternalValidationRun(
  source: string,
  message: string,
  checkpoints: readonly ExternalParserStackNode[],
  actionCounts: readonly number[],
  totalActionCount: number,
  stoppedTokenIndex: number,
  parserActions: number,
  reuseChecks: number,
  reparsedStart: number,
  reparsedEnd: number,
  reparseTokenStart: number,
): ExternalValidationRun {
  return externalFailedValidationRun(
    source,
    externalParseDiagnostic(
      "PARSER_INTERNAL_ERROR",
      message,
      { start: reparsedEnd, end: reparsedEnd },
    ),
    checkpoints,
    actionCounts,
    totalActionCount,
    stoppedTokenIndex,
    parserActions,
    reuseChecks,
    reparsedStart,
    reparsedEnd,
    reparseTokenStart,
  );
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
  #validationState: ExternalValidationState | undefined;
  #parseResult: IncrementalParseResult<Root> | undefined;
  readonly #stackPool = new ExternalParserStackPool();
  readonly #preserveTrivia: boolean;
  readonly #maxParserActions: number;

  readonly goal: "lex" | "validate" | "parse";

  constructor(
    private readonly metadata: ExternalRuntimeMetadata,
    private readonly wasm: ExternalParserWasmExports,
    private readonly planByteLength: number,
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
      previousLexState,
      previousSnapshot.length,
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
      const validation = externalRunIncrementalValidation(
        this.metadata,
        this.wasm,
        this.planByteLength,
        this.#source,
        this.#lexState,
        this.#maxParserActions,
        this.#stackPool,
        this.#validationState,
        relexed,
      );
      this.#validationState = validation.state;
      this.#stackPool.pruneAfterUpdate(validation.state.checkpoints);
      this.#validateResult = externalIncrementalValidateResult(
        this.#snapshot,
        validation.state.result,
      );
      parserWork = validation.work;
      if (this.goal === "parse") {
        const parsed = this.#parseCurrentRecords(firstEdit.start);
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
    if (this.#validationState === undefined) {
      throw new Error(
        `Incremental document goal '${this.goal}' has no validation state.`,
      );
    }
    const parser: IncrementalParserWork = {
      reparsedRanges: [],
      parserActions: 0,
      reuseChecks: 0,
      reusedCheckpoints: this.#validationState.checkpoints.length - 1,
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
    const validation = externalRunIncrementalValidation(
      this.metadata,
      this.wasm,
      this.planByteLength,
      this.#source,
      this.#lexState,
      this.#maxParserActions,
      this.#stackPool,
      undefined,
      undefined,
    );
    this.#validationState = validation.state;
    this.#stackPool.prune(validation.state.checkpoints);
    this.#validateResult = externalIncrementalValidateResult(
      this.#snapshot,
      validation.state.result,
    );
    if (this.goal === "parse") {
      this.#parseResult = externalIncrementalParseResult(
        this.#snapshot,
        this.#parseCurrentRecords(),
      );
    }
  }

  #parseCurrentRecords(
    unchangedPrefixEnd = -1,
  ): CursorParseResult<Root> {
    let reuse: ExternalCursorTapeReuse | undefined;
    if (this.#parseResult !== undefined && this.#parseResult.ok) {
      const previousTape = externalCursorTapeByRoot.get(
        this.#parseResult.cursor,
      );
      if (previousTape !== undefined) {
        reuse = { tape: previousTape, unchangedPrefixEnd };
      }
    }
    return parseExternalCursorWithWasm(
      this.metadata,
      this.wasm,
      this.planByteLength,
      this.#source,
      {
        preserveTrivia: this.#preserveTrivia,
        maxParserActions: this.#maxParserActions,
      },
      externalIncrementalRawRecords(this.#lexState),
      reuse,
    ) as CursorParseResult<Root>;
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
  const lexed = lexExternalRecords(wasm, planByteLength, source);
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
  return parseExternalCursorWithWasm(
    metadata,
    wasm,
    planByteLength,
    source,
    options,
    undefined,
  );
}

function lexExternalRecords(
  wasm: ExternalParserWasmExports,
  planByteLength: number,
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
  let view = new DataView(wasm.memory.buffer);
  for (let index = 0; index < source.length; index++) {
    view.setUint16(
      sourcePtr + index * WASM_UTF16_UNIT_BYTES,
      source.charCodeAt(index),
      true,
    );
  }
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
  let view = new DataView(wasm.memory.buffer);
  for (let index = 0; index < source.length; index++) {
    view.setUint16(
      sourcePtr + index * WASM_UTF16_UNIT_BYTES,
      source.charCodeAt(index),
      true,
    );
  }
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

function validateExternalWasm(
  metadata: ExternalRuntimeMetadata,
  wasm: ExternalParserWasmExports,
  planByteLength: number,
  source: string,
  options: ParseOptions | undefined,
): ValidateParseResult {
  const maxParserActions = externalPositiveLimit(
    options,
    "maxParserActions",
    1_000_000,
  );
  const sourcePtr = align(planByteLength, 8);
  const sourceByteLength = source.length * WASM_UTF16_UNIT_BYTES;
  const stackPtr = align(sourcePtr + sourceByteLength, WASM_I32_BYTES);
  const stackCapacity = source.length + metadata.parserStateCount + 1;
  const stackByteLength = stackCapacity * WASM_I32_BYTES;
  const resultPtr = align(stackPtr + stackByteLength, WASM_I32_BYTES);
  const resultByteLength = WASM_VALIDATE_RESULT_I32_COUNT * WASM_I32_BYTES;
  const memoPtr = align(resultPtr + resultByteLength, WASM_I32_BYTES);
  let memoCapacity = 0;
  let requiredBytes = memoPtr;
  if (!externalWasmCapacityFits(requiredBytes)) {
    return {
      ok: false,
      source,
      diagnostics: [
        externalOversizedInputDiagnostic(
          source,
          requiredBytes,
          externalOversizedSplitRemedy,
        ),
      ],
    };
  }
  ensureExternalWasmCapacity(wasm.memory, requiredBytes);
  let view = new DataView(wasm.memory.buffer);
  for (let index = 0; index < source.length; index++) {
    view.setUint16(
      sourcePtr + index * WASM_UTF16_UNIT_BYTES,
      source.charCodeAt(index),
      true,
    );
  }
  let status = wasm.validate(
    sourcePtr,
    source.length,
    resultPtr,
    stackPtr,
    stackCapacity,
    memoPtr,
    memoCapacity,
    maxParserActions,
  );
  if (status === WASM_PARSE_STATUS_MEMO_REQUIRED) {
    memoCapacity = externalLexMemoCapacity(wasm, source.length);
    requiredBytes = memoPtr + memoCapacity * WASM_I32_BYTES;
    if (!externalWasmCapacityFits(requiredBytes)) {
      return {
        ok: false,
        source,
        diagnostics: [
          externalOversizedInputDiagnostic(
            source,
            requiredBytes,
            externalOversizedSplitRemedy,
          ),
        ],
      };
    }
    ensureExternalWasmCapacity(wasm.memory, requiredBytes);
    status = wasm.validate(
      sourcePtr,
      source.length,
      resultPtr,
      stackPtr,
      stackCapacity,
      memoPtr,
      memoCapacity,
      maxParserActions,
    );
  }
  view = new DataView(wasm.memory.buffer);
  if (status === externalParseStatusOk) {
    return { ok: true, source, diagnostics: [] };
  }
  const errorState = view.getInt32(resultPtr + WASM_I32_BYTES, true);
  const errorSpec = view.getInt32(resultPtr + WASM_I32_BYTES * 2, true);
  const errorStart = view.getInt32(resultPtr + WASM_I32_BYTES * 3, true);
  const errorEnd = view.getInt32(resultPtr + WASM_I32_BYTES * 4, true);
  return {
    ok: false,
    source,
    diagnostics: [
      externalValidateStatusDiagnostic(
        metadata,
        source,
        status,
        errorState,
        errorSpec,
        errorStart,
        errorEnd,
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
  externalRecords: Int32Array | undefined,
  reuse?: ExternalCursorTapeReuse,
): CursorParseResult<RuleCursor> {
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
  const maxParserActions = externalPositiveLimit(
    options,
    "maxParserActions",
    1_000_000,
  );
  const sourcePtr = align(planByteLength, 8);
  const sourceByteLength = source.length * WASM_UTF16_UNIT_BYTES;
  const tokenPtr = align(sourcePtr + sourceByteLength, WASM_I32_BYTES);
  const tokenRecordBytes = WASM_TOKEN_RECORD_I32_COUNT * WASM_I32_BYTES;
  let maximumRawTokenCount = source.length;
  if (maximumRawTokenCount < 1) {
    maximumRawTokenCount = 1;
  }
  const lexerRequiredBytes = tokenPtr +
    maximumRawTokenCount * tokenRecordBytes;
  if (!externalWasmCapacityFits(lexerRequiredBytes)) {
    return externalFailedCursorParseResult(source, [
      externalOversizedInputDiagnostic(
        source,
        lexerRequiredBytes,
        externalOversizedSplitRemedy,
      ),
    ]);
  }
  ensureExternalWasmCapacity(wasm.memory, lexerRequiredBytes);
  const sourceView = new DataView(wasm.memory.buffer);
  for (let index = 0; index < source.length; index++) {
    sourceView.setUint16(
      sourcePtr + index * WASM_UTF16_UNIT_BYTES,
      source.charCodeAt(index),
      true,
    );
  }

  let rawTokenCount = -1;
  let structuralCapacity = 0;

  while (true) {
    if (externalRecords === undefined) {
      rawTokenCount = wasm.lex_all(
        sourcePtr,
        source.length,
        0,
        tokenPtr,
        maximumRawTokenCount,
        0,
        0,
      );
      if (rawTokenCount === -2) {
        const memoPtr = align(lexerRequiredBytes, WASM_I32_BYTES);
        const memoCapacity = externalLexMemoCapacity(wasm, source.length);
        const memoRequiredBytes = memoPtr + memoCapacity * WASM_I32_BYTES;
        if (!externalWasmCapacityFits(memoRequiredBytes)) {
          return externalFailedCursorParseResult(source, [
            externalOversizedInputDiagnostic(
              source,
              memoRequiredBytes,
              externalOversizedSplitRemedy,
            ),
          ]);
        }
        ensureExternalWasmCapacity(wasm.memory, memoRequiredBytes);
        rawTokenCount = wasm.lex_all(
          sourcePtr,
          source.length,
          0,
          tokenPtr,
          maximumRawTokenCount,
          memoPtr,
          memoCapacity,
        );
      }
      if (rawTokenCount < 0 || rawTokenCount > maximumRawTokenCount) {
        return externalInvalidCursorTapeResult(source);
      }
    } else {
      rawTokenCount = externalRecords.length / WASM_TOKEN_RECORD_I32_COUNT;
    }
    let tokenCapacity = rawTokenCount;
    if (tokenCapacity < 1) {
      tokenCapacity = 1;
    }
    if (structuralCapacity === 0) {
      structuralCapacity = tokenCapacity + 32;
    }

    // The cursor arenas are consumed per token, not per source character. A
    // capacity retry returns to the top and re-lexes because cursor parsing
    // compacts the raw records in place.
    const ruleCapacity = structuralCapacity * 4;
    const childCapacity = structuralCapacity * 6;
    const fieldCapacity = structuralCapacity * 4;
    const valueCapacity = structuralCapacity * 16;
    const valueItemCapacity = structuralCapacity * 6;
    const fragmentCapacity = structuralCapacity * 2;

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
    const childRecordBytes = WASM_CURSOR_CHILD_RECORD_I32_COUNT *
      WASM_I32_BYTES;
    const fieldPtr = align(
      childPtr + childCapacity * childRecordBytes,
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
    const valueItemRecordBytes = WASM_CURSOR_VALUE_ITEM_RECORD_I32_COUNT *
      WASM_I32_BYTES;
    const resultPtr = align(
      valueItemPtr + valueItemCapacity * valueItemRecordBytes,
      WASM_I32_BYTES,
    );
    const resultByteLength = WASM_PARSE_CURSOR_RESULT_I32_COUNT *
      WASM_I32_BYTES;
    const stackPtr = align(resultPtr + resultByteLength, WASM_I32_BYTES);
    const fragmentPtr = align(
      stackPtr + fragmentCapacity * WASM_I32_BYTES,
      WASM_I32_BYTES,
    );
    const fragmentRecordBytes = WASM_CURSOR_FRAGMENT_RECORD_I32_COUNT *
      WASM_I32_BYTES;
    const requiredBytes = align(
      fragmentPtr + fragmentCapacity * fragmentRecordBytes,
      WASM_I32_BYTES,
    );
    if (!externalWasmCapacityFits(requiredBytes)) {
      return externalFailedCursorParseResult(source, [
        externalOversizedInputDiagnostic(
          source,
          requiredBytes,
          externalOversizedSplitRemedy,
        ),
      ]);
    }
    ensureExternalWasmCapacity(wasm.memory, requiredBytes);

    let view = new DataView(wasm.memory.buffer);
    if (externalRecords !== undefined) {
      new Int32Array(
        wasm.memory.buffer,
        tokenPtr,
        externalRecords.length,
      ).set(externalRecords);
    }
    let preserveTriviaFlag = 0;
    if (preserveTrivia) {
      preserveTriviaFlag = 1;
    }
    const status = wasm.parse_cursor_records(
      sourcePtr,
      source.length,
      tokenPtr,
      rawTokenCount,
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
      maxParserActions,
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
    if (status !== externalParseStatusOk) {
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
      copyI32Tape(
        view,
        valueItemPtr,
        valueItemCount * WASM_CURSOR_VALUE_ITEM_RECORD_I32_COUNT,
      ),
      reuse,
    );
    try {
      const cursor = tape.cursorForRuleRef(rootRef);
      externalCursorTapeByRoot.set(cursor, tape);
      return {
        ok: true,
        source,
        cursor,
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

function externalValidateStatusDiagnostic(
  metadata: ExternalRuntimeMetadata,
  source: string,
  status: number,
  errorState: number,
  errorSpec: number,
  errorStart: number,
  errorEnd: number,
): ExternalParseDiagnostic {
  const span = externalClampSpan(
    { start: errorStart, end: errorEnd },
    source.length,
  );
  if (status === externalParseStatusActionLimit) {
    return externalParseDiagnostic(
      "PARSER_TRACE_LIMIT",
      "Parser exceeded the parser action limit.",
      span,
    );
  }
  if (status === externalParseStatusAmbiguous) {
    return externalParseDiagnostic(
      "PARSER_AMBIGUOUS_PARSE",
      "Wasm parser validation found multiple viable parser actions.",
      span,
    );
  }
  if (status !== externalParseStatusUnexpected) {
    return externalParseDiagnostic(
      "PARSER_INTERNAL_ERROR",
      "Wasm parser validation reported an internal failure.",
      span,
    );
  }
  if (errorSpec === -2) {
    return externalCursorUnexpectedTokenDiagnostic(
      metadata,
      source,
      {
        type: externalCursorTokenEof,
        id: -1,
        terminal: metadata.eofTerminal,
        start: source.length,
        end: source.length,
        tokenIndex: 0,
      },
      errorState,
    );
  }
  if (errorSpec < 0) {
    const diagnostic = externalUnexpectedCharacterSpan(
      source,
      span.start,
      span.end,
    );
    return {
      ...externalParseDiagnostic(
        "PARSE_LEXICAL_ERROR",
        diagnostic.message,
        diagnostic.span,
      ),
      found: JSON.stringify(source.slice(span.start, span.end)),
    };
  }
  const token = externalCursorTokenDataFromSpec(
    metadata,
    errorSpec,
    span.start,
    span.end,
    0,
  );
  return externalCursorUnexpectedTokenDiagnostic(
    metadata,
    source,
    token,
    errorState,
  );
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
  if (status === externalParseStatusActionLimit) {
    return externalParseDiagnostic(
      "PARSER_TRACE_LIMIT",
      "Parser exceeded the trace action limit.",
      externalClampSpan(
        { start: errorOffset, end: errorOffset },
        source.length,
      ),
    );
  }
  if (status === externalParseStatusAmbiguous) {
    return externalParseDiagnostic(
      "PARSER_AMBIGUOUS_PARSE",
      "Wasm cursor parser found multiple viable parser actions.",
      externalClampSpan(
        { start: errorOffset, end: errorOffset },
        source.length,
      ),
    );
  }
  if (status === externalParseStatusUnexpected) {
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
  if (typeof wasm.parse_cursor_records !== "function") {
    throw new Error(
      "Wasm ABI is missing the parse_cursor_records export.",
    );
  }
  if (typeof wasm.validate !== "function") {
    throw new Error("Wasm ABI is missing the validate export.");
  }
  if (typeof wasm.lex_incremental !== "function") {
    throw new Error("Wasm ABI is missing the lex_incremental export.");
  }
  if (typeof wasm.parser_select_incremental !== "function") {
    throw new Error(
      "Wasm ABI is missing the parser_select_incremental export.",
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
  if (wasm.validate_result_i32_count() !== WASM_VALIDATE_RESULT_I32_COUNT) {
    throw new Error(
      "Wasm validation result width does not match shared adapter.",
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
