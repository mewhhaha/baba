import type { PortableParserPlanMetadata } from "../runtime/portable_plan.ts";
import { generatedSourceBanner } from "../runtime/provenance.ts";
import { RUNTIME_IMPLEMENTATION_METADATA } from "../runtime/implementation.ts";
import {
  RUNTIME_TRACE_STATUS_AMBIGUOUS,
  RUNTIME_TRACE_STATUS_BRANCH_LIMIT,
  RUNTIME_TRACE_STATUS_INTERNAL,
  RUNTIME_TRACE_STATUS_OK,
  RUNTIME_TRACE_STATUS_TRACE_LIMIT,
  RUNTIME_TRACE_STATUS_UNEXPECTED,
} from "../runtime/language_sources.ts";
import {
  WASM_ADAPTER_HANDLE_CAPABILITY_EPOCH,
  WASM_HOST_OWNERSHIP_CALLER_MANAGED,
  WASM_I32_BYTES,
  WASM_LEX_RESULT_I32_COUNT,
  WASM_MAX_BYTES,
  WASM_MAX_PAGES,
  WASM_PAGE_BYTES,
  WASM_RESULT_LIFETIME_CALLER_BUFFER,
  WASM_SOURCE_ENCODING_UTF16,
  WASM_SPAN_UNIT_UTF16,
  WASM_TARGET_KIND,
  WASM_TOKEN_RECORD_I32_COUNT,
  WASM_UTF16_UNIT_BYTES,
} from "../runtime/wasm_abi.ts";
import type { WasmModuleImage } from "./module_emit.ts";

export function emitWasmRuntime(
  image: WasmModuleImage,
  parserTraceBytes: Uint8Array,
  portableMetadata: PortableParserPlanMetadata,
  options: { packaging?: "embedded-typescript" | "external-binary" } = {},
): string {
  const packaging = options.packaging ?? "embedded-typescript";
  return `${
    generatedSourceBanner({
      parserPlanVersion: portableMetadata.version,
      parserPlanSemantics: portableMetadata.semantics,
    })
  }
export const wasmTargetKind = ${JSON.stringify(WASM_TARGET_KIND)} as const;
${wasmBytesSource(image.bytes, packaging)}
const parserTraceRuntimeBytes = new Uint8Array([
${byteLines(parserTraceBytes)}
]);

const INPUT_BASE = ${image.inputBase};
const I32_BYTES = ${WASM_I32_BYTES};
const LEX_RESULT_BYTES = ${WASM_LEX_RESULT_I32_COUNT * WASM_I32_BYTES};
const TOKEN_RECORD_BYTES = ${WASM_TOKEN_RECORD_I32_COUNT * WASM_I32_BYTES};
const UTF16_UNIT_BYTES = ${WASM_UTF16_UNIT_BYTES};
const WASM_PAGE_BYTES = ${WASM_PAGE_BYTES};
const MAX_WASM_BYTES = ${WASM_MAX_BYTES};
const MAX_WASM_PAGES = ${WASM_MAX_PAGES};
const WASM_SOURCE_ENCODING_UTF16 = ${WASM_SOURCE_ENCODING_UTF16};
const WASM_SPAN_UNIT_UTF16 = ${WASM_SPAN_UNIT_UTF16};
const WASM_HOST_OWNERSHIP_CALLER_MANAGED = ${WASM_HOST_OWNERSHIP_CALLER_MANAGED};
const WASM_RESULT_LIFETIME_CALLER_BUFFER = ${WASM_RESULT_LIFETIME_CALLER_BUFFER};
const WASM_ADAPTER_HANDLE_CAPABILITY_EPOCH = ${WASM_ADAPTER_HANDLE_CAPABILITY_EPOCH};
const LEX_RESULT_I32_COUNT = ${WASM_LEX_RESULT_I32_COUNT};
const TOKEN_RECORD_I32_COUNT = ${WASM_TOKEN_RECORD_I32_COUNT};
const TRACE_STATUS_OK = ${RUNTIME_TRACE_STATUS_OK};
const TRACE_STATUS_UNEXPECTED = ${RUNTIME_TRACE_STATUS_UNEXPECTED};
const TRACE_STATUS_INTERNAL = ${RUNTIME_TRACE_STATUS_INTERNAL};
const TRACE_STATUS_BRANCH_LIMIT = ${RUNTIME_TRACE_STATUS_BRANCH_LIMIT};
const TRACE_STATUS_TRACE_LIMIT = ${RUNTIME_TRACE_STATUS_TRACE_LIMIT};
const TRACE_STATUS_AMBIGUOUS = ${RUNTIME_TRACE_STATUS_AMBIGUOUS};
const DEFAULT_MAX_PARSE_BRANCHES = 100_000;
const DEFAULT_MAX_QUEUED_BRANCHES = 100_000;
const DEFAULT_MAX_TRACE_ACTIONS = 1_000_000;

interface ParserWasmExports {
  memory: WebAssembly.Memory;
  lex_one(sourcePtr: number, sourceLength: number, offset: number, resultPtr: number): number;
  lex_all(sourcePtr: number, sourceLength: number, resultPtr: number, tokenPtr: number): number;
  parser_action(state: number, terminal: number): number;
  parser_goto(state: number, nonterminal: number): number;
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

interface ParserTraceRuntimeExports {
  parserTraceSetTerminal(index: number, terminal: number): number;
  parserTrace(
    terminalCount: number,
    maxBranches: number,
    maxTraceActions: number,
    maxQueuedBranches: number,
    ambiguityMode: number,
  ): number;
  parserTraceErrorState(): number;
  parserTraceErrorIndex(): number;
  parserTraceCount(): number;
  parserTraceAction(index: number): number;
  parserTraceStatusKind(status: number): number;
}

let parserTraceRuntimeModule: WebAssembly.Module | null = null;

function instantiateParserTraceRuntime(): ParserTraceRuntimeExports {
  parserTraceRuntimeModule ??= new WebAssembly.Module(parserTraceRuntimeBytes);
  const instance = new WebAssembly.Instance(parserTraceRuntimeModule, {});
  return instance.exports as unknown as ParserTraceRuntimeExports;
}

export const parserPlanFormat = ${
    JSON.stringify(portableMetadata.format)
  } as const;
export const parserPlanSemantics = ${
    JSON.stringify(portableMetadata.semantics)
  } as const;
export const parserPlanHash = ${JSON.stringify(portableMetadata.hash)} as const;
export const runtimeImplementationFormat = ${
    JSON.stringify(RUNTIME_IMPLEMENTATION_METADATA.format)
  } as const;
export const runtimeImplementationVersion = ${RUNTIME_IMPLEMENTATION_METADATA.version};
export const runtimeImplementationSemantics = ${
    JSON.stringify(RUNTIME_IMPLEMENTATION_METADATA.semantics)
  } as const;
export const runtimeImplementationHash = ${
    JSON.stringify(RUNTIME_IMPLEMENTATION_METADATA.hash)
  } as const;

export interface WasmSourceBuffer {
  sourcePtr: number;
  sourceLength: number;
  resultPtr: number;
  tokenPtr: number;
  tokenCapacity: number;
}

export function reset(): void {
  requireActiveParser().reset();
}

export function writeSource(source: string): WasmSourceBuffer {
  return requireActiveParser().writeSource(source);
}

export function lexOne(buffer: WasmSourceBuffer, offset: number): {
  specIndex: number;
  end: number;
} | null {
  return requireActiveParser().lexOne(buffer, offset);
}

export function lexAll(buffer: WasmSourceBuffer): Int32Array {
  return requireActiveParser().lexAll(buffer);
}

export type ParseTraceResult =
  | { ok: true; trace: Int32Array }
  | {
    ok: false;
    state: number;
    index: number;
    statusKind: number;
    failureKind:
      | "unexpected"
      | "internal"
      | "branch-limit"
      | "trace-limit"
      | "ambiguous";
    internal: boolean;
    limit: boolean;
  };

export interface ParseTraceInput {
  terminals: Int32Array;
  terminalCapacity: number;
}

export interface ParseTraceOptions {
  maxBranches?: number;
  maxQueuedBranches?: number;
  maxTraceActions?: number;
  ambiguityMode?: number;
}

export type WasmResourceLimitCode =
  | "INPUT_LIMIT_EXCEEDED"
  | "TOKEN_LIMIT_EXCEEDED"
  | "PARSER_STACK_LIMIT_EXCEEDED"
  | "PARSER_BRANCH_LIMIT_EXCEEDED"
  | "TRACE_LIMIT_EXCEEDED"
  | "CST_NODE_LIMIT_EXCEEDED"
  | "DIAGNOSTIC_LIMIT_EXCEEDED"
  | "MEMORY_LIMIT_EXCEEDED";

export interface ParserInstanceLimits {
  maxInputUnits?: number;
  maxTokens?: number;
  maxParserStack?: number;
  maxTraceActions?: number;
  maxExploredBranches?: number;
  maxQueuedBranches?: number;
  maxBranchCells?: number;
  maxCstNodes?: number;
  maxCstChildren?: number;
  maxDiagnostics?: number;
  maxMemoryPages?: number;
}

export interface WasmParserInstanceOptions {
  limits?: ParserInstanceLimits;
}

export class WasmResourceLimitError extends RangeError {
  readonly code: WasmResourceLimitCode;
  readonly limit: number;
  readonly actual: number;

  constructor(code: WasmResourceLimitCode, limit: number, actual: number) {
    super(code + ": limit " + limit + ", actual " + actual + ".");
    this.name = "WasmResourceLimitError";
    this.code = code;
    this.limit = limit;
    this.actual = actual;
  }
}

export interface WasmParserInstance {
  readonly memory: WebAssembly.Memory;
  reset(): void;
  dispose(): void;
  writeSource(source: string): WasmSourceBuffer;
  lexOne(buffer: WasmSourceBuffer, offset: number): {
    specIndex: number;
    end: number;
  } | null;
  lexAll(buffer: WasmSourceBuffer): Int32Array;
  createParseTraceInput(terminalCapacity: number): ParseTraceInput;
  parseTrace(
    input: ParseTraceInput,
    terminalCount: number,
    options?: ParseTraceOptions,
  ): ParseTraceResult;
}

export function createParseTraceInput(terminalCapacity: number): ParseTraceInput {
  return requireActiveParser().createParseTraceInput(terminalCapacity);
}

export function parseTrace(
  input: ParseTraceInput,
  terminalCount: number,
  options: ParseTraceOptions = {},
): ParseTraceResult {
  return requireActiveParser().parseTrace(input, terminalCount, options);
}

export function getWasmParserInstanceLimits(): ParserInstanceLimits {
  return requireActiveParser().limits;
}

function ensureCapacity(
  memory: WebAssembly.Memory,
  requiredBytes: number,
  maxMemoryPages = MAX_WASM_PAGES,
): void {
  assertNonNegativeInteger("requiredBytes", requiredBytes);
  assertLimitOption("maxMemoryPages", maxMemoryPages);
  if (requiredBytes > MAX_WASM_BYTES) {
    throw new WasmResourceLimitError(
      "MEMORY_LIMIT_EXCEEDED",
      MAX_WASM_BYTES,
      requiredBytes,
    );
  }
  const current = memory.buffer.byteLength;
  if (requiredBytes <= current) return;
  const requiredPages = Math.ceil(requiredBytes / WASM_PAGE_BYTES);
  const currentPages = current / WASM_PAGE_BYTES;
  if (requiredPages > maxMemoryPages || requiredPages > MAX_WASM_PAGES) {
    throw new WasmResourceLimitError(
      "MEMORY_LIMIT_EXCEEDED",
      Math.min(maxMemoryPages, MAX_WASM_PAGES),
      requiredPages,
    );
  }
  memory.grow(requiredPages - currentPages);
}

function align4(value: number): number {
  assertNonNegativeInteger("byte offset", value);
  const remainder = value % I32_BYTES;
  return remainder === 0
    ? value
    : checkedAdd(value, I32_BYTES - remainder, "aligned byte offset");
}

function assertParseTraceInput(input: ParseTraceInput): void {
  assertPositiveInteger("terminalCapacity", input.terminalCapacity);
  if (!(input.terminals instanceof Int32Array)) {
    throw new TypeError("terminals must be an Int32Array.");
  }
  if (input.terminals.length < input.terminalCapacity) {
    throw new RangeError(
      "terminals length must cover parse input terminalCapacity.",
    );
  }
}

function validateWasmAbi(wasm: ParserWasmExports): void {
  if (wasm.input_base() !== INPUT_BASE) {
    throw new Error("Wasm input base does not match generated adapter.");
  }
  if (wasm.max_pages() !== MAX_WASM_PAGES) {
    throw new Error("Wasm max page count does not match generated adapter.");
  }
  if (wasm.source_encoding() !== WASM_SOURCE_ENCODING_UTF16) {
    throw new Error("Wasm source encoding is not UTF-16.");
  }
  if (wasm.span_unit() !== WASM_SPAN_UNIT_UTF16) {
    throw new Error("Wasm span unit is not UTF-16.");
  }
  if (wasm.semantics_version() !== runtimeImplementationVersion) {
    throw new Error("Wasm runtime semantics version does not match generated adapter.");
  }
  if (wasm.lex_result_i32_count() !== LEX_RESULT_I32_COUNT) {
    throw new Error("Wasm lex result width does not match generated adapter.");
  }
  if (wasm.token_record_i32_count() !== TOKEN_RECORD_I32_COUNT) {
    throw new Error("Wasm token record width does not match generated adapter.");
  }
  if (wasm.host_ownership_model() !== WASM_HOST_OWNERSHIP_CALLER_MANAGED) {
    throw new Error("Wasm host ownership model does not match generated adapter.");
  }
  if (wasm.result_lifetime_model() !== WASM_RESULT_LIFETIME_CALLER_BUFFER) {
    throw new Error("Wasm result lifetime model does not match generated adapter.");
  }
}

class WasmParserInstanceImpl implements WasmParserInstance {
  readonly memory: WebAssembly.Memory;
  readonly limits: ParserInstanceLimits;
  #parserTraceRuntime = instantiateParserTraceRuntime();
  #cachedSource: string | null = null;
  #cachedBuffer: WasmSourceBuffer | null = null;
  #sourceBufferEpoch = 0;
  #sourceBufferOwners = new WeakMap<WasmSourceBuffer, number>();
  #parseTraceInputEpoch = 0;
  #parseTraceInputOwners = new WeakMap<ParseTraceInput, number>();
  #disposed = false;

  constructor(
    private readonly wasm: ParserWasmExports,
    options: WasmParserInstanceOptions = {},
  ) {
    validateWasmAbi(wasm);
    this.memory = wasm.memory;
    this.limits = normalizeParserInstanceLimits(options.limits);
  }

  wasmExports(): ParserWasmExports {
    this.#assertLive();
    return this.wasm;
  }

  isDisposed(): boolean {
    return this.#disposed;
  }

  reset(): void {
    this.#assertLive();
    this.wasm.reset();
    this.#parserTraceRuntime = instantiateParserTraceRuntime();
    this.#sourceBufferEpoch++;
    this.#parseTraceInputEpoch++;
    this.#cachedSource = null;
    this.#cachedBuffer = null;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#sourceBufferEpoch++;
    this.#parseTraceInputEpoch++;
    this.#cachedSource = null;
    this.#cachedBuffer = null;
  }

  writeSource(source: string): WasmSourceBuffer {
    this.#assertLive();
    this.#assertLimit("maxInputUnits", source.length, "INPUT_LIMIT_EXCEEDED");
    if (this.#cachedSource === source && this.#cachedBuffer) return this.#cachedBuffer;
    this.#sourceBufferEpoch++;
    const sourcePtr = INPUT_BASE;
    const sourceBytes = checkedMul(
      source.length,
      UTF16_UNIT_BYTES,
      "source byte length",
    );
    const resultPtr = align4(
      checkedAdd(sourcePtr, sourceBytes, "lexer result offset"),
    );
    const tokenPtr = align4(
      checkedAdd(resultPtr, LEX_RESULT_BYTES, "token table offset"),
    );
    const tokenCapacity = source.length;
    this.#assertLimit("maxTokens", tokenCapacity, "TOKEN_LIMIT_EXCEEDED");
    const tokenBytes = checkedMul(
      tokenCapacity,
      TOKEN_RECORD_BYTES,
      "token table byte length",
    );
    ensureCapacity(
      this.memory,
      checkedAdd(tokenPtr, tokenBytes, "token table end offset"),
      this.limits.maxMemoryPages,
    );
    const units = new Uint16Array(this.memory.buffer, sourcePtr, source.length);
    for (let index = 0; index < source.length; index++) {
      units[index] = source.charCodeAt(index);
    }
    const buffer = {
      sourcePtr,
      sourceLength: source.length,
      resultPtr,
      tokenPtr,
      tokenCapacity,
    };
    this.#sourceBufferOwners.set(buffer, this.#sourceBufferEpoch);
    this.#cachedSource = source;
    this.#cachedBuffer = buffer;
    return this.#cachedBuffer;
  }

  lexOne(buffer: WasmSourceBuffer, offset: number): {
    specIndex: number;
    end: number;
  } | null {
    this.#assertLive();
    this.#assertOwnedSourceBuffer(buffer);
    assertNonNegativeInteger("offset", offset);
    if (offset > buffer.sourceLength) {
      throw new RangeError("offset exceeds source buffer length.");
    }
    const matched = this.wasm.lex_one(
      buffer.sourcePtr,
      buffer.sourceLength,
      offset,
      buffer.resultPtr,
    );
    if (matched === 0) return null;
    const view = new DataView(this.memory.buffer);
    return {
      specIndex: view.getInt32(buffer.resultPtr, true),
      end: view.getInt32(buffer.resultPtr + 4, true),
    };
  }

  lexAll(buffer: WasmSourceBuffer): Int32Array {
    this.#assertLive();
    this.#assertOwnedSourceBuffer(buffer);
    const count = this.wasm.lex_all(
      buffer.sourcePtr,
      buffer.sourceLength,
      buffer.resultPtr,
      buffer.tokenPtr,
    );
    this.#assertLimit("maxTokens", count, "TOKEN_LIMIT_EXCEEDED");
    return new Int32Array(this.memory.buffer, buffer.tokenPtr, count * 3);
  }

  createParseTraceInput(terminalCapacity: number): ParseTraceInput {
    this.#assertLive();
    assertPositiveInteger("terminalCapacity", terminalCapacity);
    this.#assertLimit("maxTokens", terminalCapacity, "TOKEN_LIMIT_EXCEEDED");
    const input = {
      terminals: new Int32Array(terminalCapacity),
      terminalCapacity,
    };
    this.#parseTraceInputOwners.set(input, this.#parseTraceInputEpoch);
    return input;
  }

  parseTrace(
    input: ParseTraceInput,
    terminalCount: number,
    options: ParseTraceOptions = {},
  ): ParseTraceResult {
    this.#assertLive();
    this.#assertOwnedParseTraceInput(input);
    assertParseTraceInput(input);
    assertNonNegativeInteger("terminalCount", terminalCount);
    const maxBranches = options.maxBranches ?? DEFAULT_MAX_PARSE_BRANCHES;
    const maxQueuedBranches = options.maxQueuedBranches ?? DEFAULT_MAX_QUEUED_BRANCHES;
    const maxTraceActions = options.maxTraceActions ?? DEFAULT_MAX_TRACE_ACTIONS;
    const ambiguityMode = options.ambiguityMode ?? 0;
    assertPositiveInteger("maxBranches", maxBranches);
    assertPositiveInteger("maxQueuedBranches", maxQueuedBranches);
    assertPositiveInteger("maxTraceActions", maxTraceActions);
    assertAmbiguityMode(ambiguityMode);
    if (terminalCount > input.terminalCapacity) {
      throw new RangeError("terminalCount exceeds parse input terminalCapacity.");
    }
    this.#assertLimit("maxTokens", terminalCount, "TOKEN_LIMIT_EXCEEDED");
    this.#assertLimit(
      "maxParserStack",
      terminalCount,
      "PARSER_STACK_LIMIT_EXCEEDED",
    );
    const effectiveMaxBranches = this.#boundedOption(
      "maxExploredBranches",
      maxBranches,
      "PARSER_BRANCH_LIMIT_EXCEEDED",
    );
    const effectiveMaxQueuedBranches = this.#boundedOption(
      "maxQueuedBranches",
      maxQueuedBranches,
      "PARSER_BRANCH_LIMIT_EXCEEDED",
    );
    const effectiveMaxTraceActions = this.#boundedOption(
      "maxTraceActions",
      maxTraceActions,
      "TRACE_LIMIT_EXCEEDED",
    );
    const branchCells = checkedMul(
      terminalCount,
      effectiveMaxQueuedBranches,
      "branch cell budget",
    );
    this.#assertLimit(
      "maxBranchCells",
      branchCells,
      "PARSER_BRANCH_LIMIT_EXCEEDED",
    );
    try {
      for (let index = 0; index < terminalCount; index++) {
        this.#parserTraceRuntime.parserTraceSetTerminal(index, input.terminals[index]);
      }
      const status = this.#parserTraceRuntime.parserTrace(
        terminalCount,
        effectiveMaxBranches,
        effectiveMaxTraceActions,
        effectiveMaxQueuedBranches,
        ambiguityMode,
      );
      const traceStatus = this.#parserTraceRuntime.parserTraceStatusKind(status);
      if (traceStatus !== TRACE_STATUS_OK) {
        return {
          ok: false,
          state: this.#parserTraceRuntime.parserTraceErrorState(),
          index: this.#parserTraceRuntime.parserTraceErrorIndex(),
          statusKind: traceStatus,
          failureKind: traceStatus === TRACE_STATUS_INTERNAL
            ? "internal"
            : traceStatus === TRACE_STATUS_BRANCH_LIMIT
            ? "branch-limit"
            : traceStatus === TRACE_STATUS_TRACE_LIMIT
            ? "trace-limit"
            : traceStatus === TRACE_STATUS_AMBIGUOUS
            ? "ambiguous"
            : "unexpected",
          internal: traceStatus === TRACE_STATUS_INTERNAL,
          limit: traceStatus === TRACE_STATUS_BRANCH_LIMIT ||
            traceStatus === TRACE_STATUS_TRACE_LIMIT,
        };
      }
      const count = this.#parserTraceRuntime.parserTraceCount();
      const trace = new Int32Array(count);
      for (let index = 0; index < count; index++) {
        trace[index] = this.#parserTraceRuntime.parserTraceAction(index) | 0;
      }
      return {
        ok: true,
        trace,
      };
    } catch {
      return {
        ok: false,
        state: 0,
        index: terminalCount,
        statusKind: TRACE_STATUS_INTERNAL,
        failureKind: "internal",
        internal: true,
        limit: false,
      };
    }
  }

  #assertOwnedSourceBuffer(buffer: WasmSourceBuffer): void {
    const epoch = this.#sourceBufferOwners.get(buffer);
    if (epoch === undefined) {
      throw new TypeError("WasmSourceBuffer is not owned by this adapter.");
    }
    if (epoch !== this.#sourceBufferEpoch) {
      throw new TypeError("WasmSourceBuffer is stale; call writeSource() again.");
    }
  }

  #assertOwnedParseTraceInput(input: ParseTraceInput): void {
    const epoch = this.#parseTraceInputOwners.get(input);
    if (epoch === undefined) {
      throw new TypeError("ParseTraceInput is not owned by this adapter.");
    }
    if (epoch !== this.#parseTraceInputEpoch) {
      throw new TypeError("ParseTraceInput is stale; call createParseTraceInput() again.");
    }
  }

  #assertLive(): void {
    if (this.#disposed) {
      throw new Error("Wasm parser instance is disposed.");
    }
  }

  #assertLimit(
    name: keyof ParserInstanceLimits,
    actual: number,
    code: WasmResourceLimitCode,
  ): void {
    const limit = this.limits[name];
    if (limit === undefined) return;
    if (actual > limit) throw new WasmResourceLimitError(code, limit, actual);
  }

  #boundedOption(
    name: keyof ParserInstanceLimits,
    requested: number,
    code: WasmResourceLimitCode,
  ): number {
    const limit = this.limits[name];
    if (limit === undefined) return requested;
    if (requested > limit) throw new WasmResourceLimitError(code, limit, requested);
    return requested;
  }
}

${wasmInstantiationSource(portableMetadata, packaging)}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(name + " must be a positive integer.");
  }
}

function assertLimitOption(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(name + " must be a positive integer.");
  }
}

function normalizeParserInstanceLimits(
  limits: ParserInstanceLimits = {},
): ParserInstanceLimits {
  for (const [name, value] of Object.entries(limits)) {
    if (value !== undefined) assertLimitOption(name, value);
  }
  return { ...limits };
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(name + " must be a non-negative integer.");
  }
}

function assertAmbiguityMode(value: number): void {
  if (value !== 0 && value !== 1) {
    throw new RangeError("ambiguityMode must be 0 or 1.");
  }
}

function checkedAdd(left: number, right: number, label: string): number {
  assertNonNegativeInteger(label, left);
  assertNonNegativeInteger(label, right);
  const value = left + right;
  if (!Number.isSafeInteger(value) || value > MAX_WASM_BYTES) {
    throw new RangeError(label + " exceeds the 32-bit Wasm address space.");
  }
  return value;
}

function checkedMul(left: number, right: number, label: string): number {
  assertNonNegativeInteger(label, left);
  assertNonNegativeInteger(label, right);
  const value = left * right;
  if (!Number.isSafeInteger(value) || value > MAX_WASM_BYTES) {
    throw new RangeError(label + " exceeds the 32-bit Wasm address space.");
  }
  return value;
}
`;
}

function wasmBytesSource(
  bytes: Uint8Array,
  packaging: "embedded-typescript" | "external-binary",
): string {
  if (packaging === "external-binary") {
    return "";
  }
  return `export const wasmBytes = new Uint8Array([
${byteLines(bytes)}
]);`;
}

function wasmInstantiationSource(
  portableMetadata: PortableParserPlanMetadata,
  packaging: "embedded-typescript" | "external-binary",
): string {
  if (packaging === "embedded-typescript") {
    return `let wasmModule: WebAssembly.Module | null = null;
export let memory = undefined as unknown as WebAssembly.Memory;
export let parserAction: ParserWasmExports["parser_action"] = uninitializedWasmExport;
export let parserGoto: ParserWasmExports["parser_goto"] = uninitializedWasmExport;
export let wasmAbiVersion = 1;
export let wasmSemanticsVersion = runtimeImplementationVersion;
export let wasmInputBase = INPUT_BASE;
export let wasmMaxPages = MAX_WASM_PAGES;
export let wasmSourceEncoding = WASM_SOURCE_ENCODING_UTF16;
export let wasmSpanUnit = WASM_SPAN_UNIT_UTF16;
export let wasmLexResultI32Count = LEX_RESULT_I32_COUNT;
export let wasmTokenRecordI32Count = TOKEN_RECORD_I32_COUNT;
export let wasmHostOwnershipModel = WASM_HOST_OWNERSHIP_CALLER_MANAGED;
export let wasmResultLifetimeModel = WASM_RESULT_LIFETIME_CALLER_BUFFER;
export const wasmAdapterHandleCapabilityModel = WASM_ADAPTER_HANDLE_CAPABILITY_EPOCH;
export const wasmTraceStatusOk = TRACE_STATUS_OK;
export const wasmTraceStatusUnexpected = TRACE_STATUS_UNEXPECTED;
export const wasmTraceStatusInternal = TRACE_STATUS_INTERNAL;
export const wasmTraceStatusBranchLimit = TRACE_STATUS_BRANCH_LIMIT;
export const wasmTraceStatusTraceLimit = TRACE_STATUS_TRACE_LIMIT;
export const wasmTraceStatusAmbiguous = TRACE_STATUS_AMBIGUOUS;
export let parserPlanVersion = ${portableMetadata.version};
let activeParser: WasmParserInstanceImpl | null = null;
let defaultParser: WasmParserInstanceImpl | null = null;

export function createWasmParserInstance(
  options: WasmParserInstanceOptions = {},
): WasmParserInstanceImpl {
  wasmModule ??= new WebAssembly.Module(wasmBytes);
  const instance = new WebAssembly.Instance(wasmModule, {});
  return new WasmParserInstanceImpl(
    instance.exports as unknown as ParserWasmExports,
    options,
  );
}

export function withWasmParserInstance<T>(
  parser: WasmParserInstance,
  callback: () => T,
): T {
  const previous = activeParser;
  setActiveParser(assertWasmParserInstance(parser));
  try {
    return callback();
  } finally {
    if (previous && !previous.isDisposed()) {
      setActiveParser(previous);
    } else if (defaultParser && !defaultParser.isDisposed()) {
      setActiveParser(defaultParser);
    } else {
      activeParser = null;
    }
  }
}

function requireActiveParser(): WasmParserInstanceImpl {
  if (!activeParser) {
    defaultParser = createWasmParserInstance();
    setActiveParser(defaultParser);
  }
  if (!activeParser) {
    throw new Error("Wasm parser runtime is not initialized. Call createParserFromBytes(), createParserFromModule(), or createParserFromUrl() first.");
  }
  return activeParser;
}

function setActiveParser(parser: WasmParserInstanceImpl): void {
  activeParser = parser;
  initializeExportBindings(parser);
}

function assertWasmParserInstance(parser: WasmParserInstance): WasmParserInstanceImpl {
  if (!(parser instanceof WasmParserInstanceImpl)) {
    throw new TypeError("Wasm parser instance is not owned by this adapter.");
  }
  return parser;
}

function initializeExportBindings(parser: WasmParserInstanceImpl): void {
  const wasm = parser.wasmExports();
  memory = wasm.memory;
  parserAction = wasm.parser_action;
  parserGoto = wasm.parser_goto;
  wasmAbiVersion = wasm.abi_version();
  wasmSemanticsVersion = wasm.semantics_version();
  wasmInputBase = wasm.input_base();
  wasmMaxPages = wasm.max_pages();
  wasmSourceEncoding = wasm.source_encoding();
  wasmSpanUnit = wasm.span_unit();
  wasmLexResultI32Count = wasm.lex_result_i32_count();
  wasmTokenRecordI32Count = wasm.token_record_i32_count();
  wasmHostOwnershipModel = wasm.host_ownership_model();
  wasmResultLifetimeModel = wasm.result_lifetime_model();
  parserPlanVersion = wasm.plan_version();
}

function uninitializedWasmExport(): never {
  throw new Error("Wasm parser runtime is not initialized. Call createParserFromBytes(), createParserFromModule(), or createParserFromUrl() first.");
}`;
  }
  return `let wasm: ParserWasmExports | null = null;
export let memory = undefined as unknown as WebAssembly.Memory;
export let parserAction: ParserWasmExports["parser_action"] = uninitializedWasmExport;
export let parserGoto: ParserWasmExports["parser_goto"] = uninitializedWasmExport;
export let wasmAbiVersion = 0;
export let wasmSemanticsVersion = 0;
export let wasmInputBase = 0;
export let wasmMaxPages = 0;
export let wasmSourceEncoding = 0;
export let wasmSpanUnit = 0;
export let wasmLexResultI32Count = 0;
export let wasmTokenRecordI32Count = 0;
export let wasmHostOwnershipModel = 0;
export let wasmResultLifetimeModel = 0;
export const wasmAdapterHandleCapabilityModel = WASM_ADAPTER_HANDLE_CAPABILITY_EPOCH;
export const wasmTraceStatusOk = TRACE_STATUS_OK;
export const wasmTraceStatusUnexpected = TRACE_STATUS_UNEXPECTED;
export const wasmTraceStatusInternal = TRACE_STATUS_INTERNAL;
export const wasmTraceStatusBranchLimit = TRACE_STATUS_BRANCH_LIMIT;
export const wasmTraceStatusTraceLimit = TRACE_STATUS_TRACE_LIMIT;
export const wasmTraceStatusAmbiguous = TRACE_STATUS_AMBIGUOUS;
export let parserPlanVersion = ${portableMetadata.version};
let activeParser: WasmParserInstanceImpl | null = null;

export function createParserFromBytes(
  bytes: Uint8Array,
  options: WasmParserInstanceOptions = {},
): WasmParserInstance {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return createParserFromModule(
    new WebAssembly.Module(copy.buffer as ArrayBuffer),
    options,
  );
}

export function createParserFromModule(
  module: WebAssembly.Module,
  options: WasmParserInstanceOptions = {},
): WasmParserInstance {
  const instance = new WebAssembly.Instance(module, {});
  const parser = new WasmParserInstanceImpl(
    instance.exports as unknown as ParserWasmExports,
    options,
  );
  setActiveParser(parser);
  return parser;
}

export async function createParserFromUrl(
  url: URL,
  options: WasmParserInstanceOptions = {},
): Promise<WasmParserInstance> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load Wasm parser module from " + url.href + ".");
  }
  return createParserFromBytes(new Uint8Array(await response.arrayBuffer()), options);
}

export function withWasmParserInstance<T>(
  parser: WasmParserInstance,
  callback: () => T,
): T {
  const previous = activeParser;
  setActiveParser(assertWasmParserInstance(parser));
  try {
    return callback();
  } finally {
    if (previous && !previous.isDisposed()) {
      setActiveParser(previous);
    } else {
      activeParser = null;
    }
  }
}

function requireActiveParser(): WasmParserInstanceImpl {
  if (!activeParser) {
    throw new Error("Wasm parser runtime is not initialized. Call createParserFromBytes(), createParserFromModule(), or createParserFromUrl() first.");
  }
  return activeParser;
}

function setActiveParser(parser: WasmParserInstanceImpl): void {
  activeParser = parser;
  initializeExportBindings(parser);
}

function assertWasmParserInstance(parser: WasmParserInstance): WasmParserInstanceImpl {
  if (!(parser instanceof WasmParserInstanceImpl)) {
    throw new TypeError("Wasm parser instance is not owned by this adapter.");
  }
  return parser;
}

function initializeExportBindings(parser: WasmParserInstanceImpl): void {
  const nextWasm = parser.wasmExports();
  wasm = nextWasm;
  memory = nextWasm.memory;
  parserAction = nextWasm.parser_action;
  parserGoto = nextWasm.parser_goto;
  wasmAbiVersion = nextWasm.abi_version();
  wasmSemanticsVersion = nextWasm.semantics_version();
  wasmInputBase = nextWasm.input_base();
  wasmMaxPages = nextWasm.max_pages();
  wasmSourceEncoding = nextWasm.source_encoding();
  wasmSpanUnit = nextWasm.span_unit();
  wasmLexResultI32Count = nextWasm.lex_result_i32_count();
  wasmTokenRecordI32Count = nextWasm.token_record_i32_count();
  wasmHostOwnershipModel = nextWasm.host_ownership_model();
  wasmResultLifetimeModel = nextWasm.result_lifetime_model();
  parserPlanVersion = nextWasm.plan_version();
}

function uninitializedWasmExport(): never {
  throw new Error("Wasm parser runtime is not initialized. Call createParserFromBytes(), createParserFromModule(), or createParserFromUrl() first.");
}`;
}

function byteLines(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let index = 0; index < bytes.length; index += 16) {
    lines.push(
      `  ${
        [...bytes.slice(index, index + 16)].map((byte) =>
          `0x${byte.toString(16).padStart(2, "0")}`
        ).join(", ")
      },`,
    );
  }
  return lines.join("\n");
}
