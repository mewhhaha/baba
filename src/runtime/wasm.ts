/**
 * Compatibility facade for Baba Wasm runtime helpers.
 *
 * Generated bundles import from ./generated_wasm.ts through the public
 * runtime/generated-wasm export. This module keeps the older shared/auto
 * runtime APIs available separately.
 *
 * @module
 */

import {
  createParser as createPlanParser,
  type CreateParserOptions,
  type ParseOptions as SharedParseOptions,
  type ParseResult,
  type RuleNode,
  type RuntimeParser,
  type RuntimeParserPlan,
  type Token,
  type ValidateParseResult,
} from "./mod.ts";
import {
  createSharedGenericWasmExecutor,
  type SharedGenericWasmExecutor,
  type SharedGenericWasmExecutorInstance,
} from "./wasm_executor.ts";

export {
  createParser,
  createParserAsync,
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
} from "./generated_wasm.ts";
export type {
  AsyncParserInstanceOptions,
  LexOptions,
  LexTapeResult,
  ParseOptions,
  ParserInstance,
  ParserInstanceOptions,
  TokenTape,
} from "./generated_wasm.ts";

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

let preparedGenericRuntime = false;
let genericRuntimePrepareCount = 0;
let sharedGenericExecutor: SharedGenericWasmExecutor | undefined;

export function getSharedWasmRuntimeStats(): SharedWasmRuntimeStats {
  let wasmBytes = 0;
  if (sharedGenericExecutor !== undefined) {
    wasmBytes = sharedGenericExecutor.bytes.byteLength;
  }
  return {
    prepared: preparedGenericRuntime,
    prepareCount: genericRuntimePrepareCount,
    wasmBytes,
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
    parseOptions?: SharedParseOptions,
  ) => select(source).parse(source, parseOptions)) as RuntimeParser["parse"];
  const parseTokens: RuntimeParser["parseTokens"] = ((
    source: string,
    tokens: readonly Token[],
    parseOptions?: SharedParseOptions,
  ) =>
    select(source).parseTokens(
      source,
      tokens,
      parseOptions,
    )) as RuntimeParser["parseTokens"];
  const parseTokensUnchecked: RuntimeParser["parseTokensUnchecked"] = ((
    source: string,
    tokens: readonly Token[],
    parseOptions?: SharedParseOptions,
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
    parse(source: string, parseOptions?: SharedParseOptions): ParseResult {
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
      parseOptions?: SharedParseOptions,
    ): ParseResult {
      if (parseOptions?.mode !== "validate") {
        return fallback.parseTokens(source, tokens, parseOptions);
      }
      return fallback.parseTokens(source, tokens, parseOptions);
    },
    parseTokensUnchecked(
      source: string,
      tokens: readonly Token[],
      parseOptions?: SharedParseOptions,
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
  parseOptions: SharedParseOptions,
  options: WasmParserOptions,
): ValidateParseResult {
  if (!state) {
    return fallback.parse(
      source,
      parseOptions,
    ) as unknown as ValidateParseResult;
  }
  const terminals = timed(
    "lex",
    "wasm",
    options.timing,
    () => lexTerminalsWithWasm(state, source),
  );
  if (!terminals) {
    return fallback.parse(
      source,
      parseOptions,
    ) as unknown as ValidateParseResult;
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
      ok ? { ok: true, source, diagnostics: [] } : fallback.parse(
        source,
        parseOptions,
      ) as unknown as ValidateParseResult,
  );
}

function validateTokensWithWasm(
  state: WasmPlanState | null,
  fallback: RuntimeParser,
  source: string,
  tokens: readonly Token[],
  parseOptions: SharedParseOptions,
  options: WasmParserOptions,
  unchecked: boolean,
): ValidateParseResult {
  if (!state) {
    return (unchecked ? fallback.parseTokensUnchecked : fallback.parseTokens)(
      source,
      tokens,
      parseOptions,
    ) as unknown as ValidateParseResult;
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
        ) as unknown as ValidateParseResult,
  );
}

function validateTokenTraceWithWasm(
  state: WasmPlanState,
  tokens: readonly Token[],
  options: SharedParseOptions,
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
  options: SharedParseOptions,
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
