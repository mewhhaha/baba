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
  WASM_LEX_RESULT_I32_COUNT,
  WASM_MAX_PAGES,
  WASM_PAGE_BYTES,
  WASM_RESULT_LIFETIME_CALLER_BUFFER,
  WASM_SOURCE_ENCODING_UTF16,
  WASM_SPAN_UNIT_UTF16,
  WASM_TARGET_KIND,
  WASM_TOKEN_RECORD_I32_COUNT,
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
    parserOptionsFromInstanceOptions(options),
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
  #parser: RuntimeParser<Root> | undefined;

  readonly parse: ParserInstance<Root>["parse"];
  readonly parseTokens: ParserInstance<Root>["parseTokens"];
  readonly parseTokensUnchecked: ParserInstance<Root>["parseTokensUnchecked"];

  constructor(
    private readonly planBytes: Uint8Array,
    private readonly parserPlanVersionToMatch: number,
    private readonly parserOptions: CreateParserOptions,
    private readonly wasm: ExternalParserWasmExports,
  ) {
    this.parse = ((source: string, options?: ParseOptions) => {
      this.#assertLive();
      return this.#runtimeParser().parse(source, options);
    }) as ParserInstance<Root>["parse"];
    this.parseTokens = ((
      source: string,
      tokens: readonly Token[],
      options?: ParseOptions,
    ) => {
      this.#assertLive();
      return this.#runtimeParser().parseTokens(source, tokens, options);
    }) as ParserInstance<Root>["parseTokens"];
    this.parseTokensUnchecked = ((
      source: string,
      tokens: readonly Token[],
      options?: ParseOptions,
    ) => {
      this.#assertLive();
      return this.#runtimeParser().parseTokensUnchecked(
        source,
        tokens,
        options,
      );
    }) as ParserInstance<Root>["parseTokensUnchecked"];
  }

  get plan(): RuntimeParserPlan {
    return this.#loadRuntimePlan();
  }

  lex(source: string, options?: Parameters<RuntimeParser["lex"]>[1]) {
    this.#assertLive();
    return this.#runtimeParser().lex(source, options);
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

  #runtimeParser(): RuntimeParser<Root> {
    if (this.#parser !== undefined) {
      return this.#parser;
    }
    const parser = createPlanParser<Root>(
      this.#loadRuntimePlan(),
      this.parserOptions,
    );
    this.#parser = parser;
    return parser;
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
}

function parserOptionsFromInstanceOptions(
  options: ParserInstanceOptions,
): CreateParserOptions {
  if (options.validate !== undefined) {
    return { validate: options.validate };
  }
  return {};
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
