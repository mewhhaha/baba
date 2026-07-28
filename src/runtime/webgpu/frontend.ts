import type {
  GpuFrontendBoundaryPlan,
  GpuFrontendPlan,
  GpuIslandEmitPlan,
  GpuIslandTransducerPlan,
} from "../../compiler/gpu_frontend.ts";
import { decodeCombinedWasmParserPlan } from "../wasm_plan.ts";
import { decodeLexerPlanTables, type LexerPlanTables } from "./plan_tables.ts";
import type { WebGpuLexerContext, WebGpuRuntime } from "./context.ts";
import {
  type GpuIslandExecution,
  GpuIslandExecutor,
  STATUS_DELIMITER,
  STATUS_DEPTH_CAPACITY,
  STATUS_EDGE_CAPACITY,
  STATUS_LEXICAL,
  STATUS_NODE_CAPACITY,
  STATUS_SYNTAX,
  STATUS_TOKEN_CAPACITY,
} from "./island_executor.ts";
export { GpuFrontendCapacityError } from "./frontend_capacity.ts";
import { GpuFrontendCapacityError } from "./frontend_capacity.ts";

const TOKEN_WORDS = 4;
const NODE_WORDS = 8;
const EDGE_WORDS = 4;
const DIAGNOSTIC_WORDS = 8;

const DIAGNOSTIC_LEXICAL = 1;
const DIAGNOSTIC_DELIMITER = 2;
const DIAGNOSTIC_SYNTAX = 3;
const DIAGNOSTIC_TOKEN_CAPACITY = 4;
const DIAGNOSTIC_NODE_CAPACITY = 5;
const DIAGNOSTIC_EDGE_CAPACITY = 6;
const DIAGNOSTIC_DUPLICATE_BINDING = 7;
const DIAGNOSTIC_UNKNOWN_REFERENCE = 8;
const DIAGNOSTIC_REFERENCE_CYCLE = 9;
const DIAGNOSTIC_INTEGER_BOUNDS = 10;
const DIAGNOSTIC_REPEAT_LIMIT = 11;
const DIAGNOSTIC_DEPTH_CAPACITY = 12;

export interface CompactFrontendProgram {
  readonly tokens: Int32Array;
  readonly nodes: Int32Array;
  readonly edges: Int32Array;
  readonly symbols: Int32Array;
  readonly types: Int32Array;
}

export interface FrontendDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly start: number;
  readonly end: number;
  readonly subjectId: number;
  readonly record: Int32Array;
}

export interface GpuFrontendTimings {
  readonly uploadMs: number;
  readonly lexMs: number;
  readonly delimitersMs: number;
  readonly islandsMs: number;
  readonly semanticsMs: number;
  readonly readbackMs: number;
  readonly totalMs: number;
  readonly stagesMs: Readonly<Record<string, number>> | null;
}

export type GpuFrontendResult =
  | {
    readonly ok: true;
    readonly program: CompactFrontendProgram;
    readonly diagnostics: [];
    readonly timings: GpuFrontendTimings;
  }
  | {
    readonly ok: false;
    readonly program: null;
    readonly diagnostics: FrontendDiagnostic[];
    readonly timings: GpuFrontendTimings;
  };

export interface CpuFrontendOptions {
  readonly maxTokens?: number;
  readonly maxNodes?: number;
  readonly maxEdges?: number;
}

export interface WebGpuFrontendOptions extends CpuFrontendOptions {
  readonly lexerCapacityRecords?: number;
}

export interface GpuFrontendPlanInspection {
  readonly version: 3;
  readonly lexerStates: number;
  readonly islandCount: number;
  readonly islandStates: number;
  readonly islandTransitions: number;
  readonly semanticOpcodes: number;
  readonly maxNodesPerToken: number;
  readonly maxEdgesPerToken: number;
  readonly maxConstraintsPerNode: number;
  readonly locatorCount: number;
  readonly denseTransitionBytes: number;
  readonly maxCandidateMultiplicity: number;
  readonly contractionRounds: number;
  readonly scratchExpansionFactors: {
    readonly regions: number;
    readonly candidates: number;
    readonly summaries: number;
    readonly nodes: number;
    readonly edges: number;
    readonly diagnostics: number;
  };
  readonly packedBytes: number;
}

interface Token {
  readonly terminal: number;
  readonly start: number;
  readonly end: number;
  readonly lexicalIdentity: number;
  readonly outputIndex: number;
}

interface PendingEdge {
  readonly emit: GpuIslandEmitPlan;
  readonly token: Token | undefined;
  readonly child: PendingNode | undefined;
  readonly ordinal: number;
}

interface PendingNode {
  readonly island: number;
  readonly start: number;
  readonly end: number;
  readonly sourceOrder: number;
  readonly edges: PendingEdge[];
  id: number;
}

interface IslandMatch {
  readonly node: PendingNode;
  readonly nextToken: number;
}

interface IslandExecutionProgress {
  farthestToken: number;
  island: number;
  state: number;
}

interface RawDiagnostic {
  readonly code: number;
  readonly start: number;
  readonly end: number;
  readonly subjectId: number;
  readonly parameter0: number;
  readonly parameter1: number;
}

/**
 * CPU interpreter for the exact island transducer and compact result contract
 * stored in parser.plan. It is an explicit backend and parity oracle.
 */
export class CpuFrontend {
  readonly plan: GpuFrontendPlan;
  readonly lexer: LexerPlanTables;

  private constructor(plan: GpuFrontendPlan, lexer: LexerPlanTables) {
    this.plan = plan;
    this.lexer = lexer;
  }

  static create(planBytes: Uint8Array): CpuFrontend {
    return new CpuFrontend(
      decodeGpuFrontendPlan(planBytes),
      decodeLexerPlanTables(planBytes),
    );
  }

  ingest(source: string, options: CpuFrontendOptions = {}): GpuFrontendResult {
    const started = performance.now();
    const units = new Uint16Array(source.length);
    for (let index = 0; index < source.length; index += 1) {
      units[index] = source.charCodeAt(index);
    }
    const afterUpload = performance.now();
    const rawDiagnostics: RawDiagnostic[] = [];
    const tokens = lex(
      units,
      this.lexer,
      this.plan,
      rawDiagnostics,
      options.maxTokens,
    );
    const afterLex = performance.now();
    const delimiterMatches = matchDelimiters(
      tokens,
      this.plan.boundaries,
      rawDiagnostics,
    );
    const afterDelimiters = performance.now();
    let root: PendingNode | undefined;
    if (rawDiagnostics.length === 0) {
      root = executeRootIsland(
        tokens,
        delimiterMatches,
        this.plan,
        rawDiagnostics,
      );
    }
    const afterIslands = performance.now();
    let program: CompactFrontendProgram | null = null;
    if (root !== undefined && rawDiagnostics.length === 0) {
      try {
        program = materializeProgram(
          tokens,
          root,
          this.plan,
          options,
          source,
          rawDiagnostics,
        );
      } catch (error) {
        if (!(error instanceof FrontendSourceCapacity)) {
          throw error;
        }
        rawDiagnostics.push(error.diagnostic);
      }
    }
    const afterSemantics = performance.now();
    rawDiagnostics.sort((left, right) =>
      left.start - right.start ||
      left.code - right.code ||
      left.subjectId - right.subjectId
    );
    const diagnostics = rawDiagnostics.map(materializeDiagnostic);
    const finished = performance.now();
    const timings: GpuFrontendTimings = {
      uploadMs: afterUpload - started,
      lexMs: afterLex - afterUpload,
      delimitersMs: afterDelimiters - afterLex,
      islandsMs: afterIslands - afterDelimiters,
      semanticsMs: afterSemantics - afterIslands,
      readbackMs: finished - afterSemantics,
      totalMs: finished - started,
      stagesMs: null,
    };
    if (diagnostics.length > 0 || program === null) {
      return { ok: false, program: null, diagnostics, timings };
    }
    return { ok: true, program, diagnostics: [], timings };
  }
}

/**
 * Device session for an opt-in frontend plan. Lexing, delimiter matching,
 * island execution, and flat token/node/edge allocation execute through WGSL.
 * Semantic recipes currently consume the read-back flat IR on the host.
 */
export class WebGpuFrontend {
  readonly plan: GpuFrontendPlan;
  readonly runtime: WebGpuRuntime;
  readonly #lexer: WebGpuLexerContext;
  readonly #islands: GpuIslandExecutor;

  private constructor(
    plan: GpuFrontendPlan,
    runtime: WebGpuRuntime,
    lexer: WebGpuLexerContext,
    islands: GpuIslandExecutor,
  ) {
    this.plan = plan;
    this.runtime = runtime;
    this.#lexer = lexer;
    this.#islands = islands;
  }

  static async create(
    runtime: WebGpuRuntime,
    planBytes: Uint8Array,
  ): Promise<WebGpuFrontend> {
    const plan = decodeGpuFrontendPlan(planBytes);
    const lexer = await runtime.compileLexer(planBytes);
    const islands = await GpuIslandExecutor.create(runtime.device, plan);
    return new WebGpuFrontend(plan, runtime, lexer, islands);
  }

  async ingest(
    source: string,
    options: WebGpuFrontendOptions = {},
  ): Promise<GpuFrontendResult> {
    const started = performance.now();
    assertDeviceCapacity(source.length, this.plan, this.runtime);
    const units = new Uint16Array(source.length);
    for (let index = 0; index < source.length; index += 1) {
      units[index] = source.charCodeAt(index);
    }
    const afterUpload = performance.now();
    const rawDiagnostics: RawDiagnostic[] = [];
    let gpuProgram: CompactFrontendProgram | null = null;
    let islandExecutionMs = 0;
    let stagesMs: Readonly<Record<string, number>> | null = null;
    const lexerLease = await this.#lexer.acquireIntegratedLexer();
    const runtimeLease = await this.runtime.acquireLease();
    let execution: GpuIslandExecution;
    try {
      execution = await this.#islands.execute(
        lexerLease.lexer,
        units,
        options.lexerCapacityRecords,
        options.maxNodes,
        options.maxEdges,
      );
    } finally {
      runtimeLease.release();
      lexerLease.release();
    }
    islandExecutionMs = execution.submitAndReadbackMs;
    stagesMs = execution.stagesMs;
    if (execution.diagnostic !== null) {
      rawDiagnostics.push({
        code: executionStatusDiagnostic(execution.status),
        ...execution.diagnostic,
      });
    } else {
      gpuProgram = execution.program;
    }
    const afterLex = performance.now();
    const afterIslands = performance.now();
    let program: CompactFrontendProgram | null = null;
    if (gpuProgram !== null && rawDiagnostics.length === 0) {
      const pending = decodePendingProgram(gpuProgram, this.plan);
      const symbols = executeSemanticRecipes(
        pending.nodes,
        pending.tokens,
        this.plan,
        source,
        rawDiagnostics,
      );
      program = { ...gpuProgram, symbols };
    }
    const afterSemantics = performance.now();
    rawDiagnostics.sort((left, right) =>
      left.start - right.start ||
      left.code - right.code ||
      left.subjectId - right.subjectId
    );
    const diagnostics = rawDiagnostics.map(materializeDiagnostic);
    const finished = performance.now();
    const timings: GpuFrontendTimings = {
      uploadMs: afterUpload - started,
      lexMs: afterLex - afterUpload,
      delimitersMs: 0,
      islandsMs: islandExecutionMs,
      semanticsMs: afterSemantics - afterIslands,
      readbackMs: finished - afterSemantics,
      totalMs: finished - started,
      stagesMs,
    };
    if (diagnostics.length > 0 || program === null) {
      return { ok: false, program: null, diagnostics, timings };
    }
    return { ok: true, program, diagnostics: [], timings };
  }
}

function executionStatusDiagnostic(status: number): number {
  if (status === STATUS_LEXICAL) {
    return DIAGNOSTIC_LEXICAL;
  }
  if (status === STATUS_DELIMITER) {
    return DIAGNOSTIC_DELIMITER;
  }
  if (status === STATUS_SYNTAX) {
    return DIAGNOSTIC_SYNTAX;
  }
  if (status === STATUS_TOKEN_CAPACITY) {
    return DIAGNOSTIC_TOKEN_CAPACITY;
  }
  if (status === STATUS_NODE_CAPACITY) {
    return DIAGNOSTIC_NODE_CAPACITY;
  }
  if (status === STATUS_EDGE_CAPACITY) {
    return DIAGNOSTIC_EDGE_CAPACITY;
  }
  if (status === STATUS_DEPTH_CAPACITY) {
    return DIAGNOSTIC_DEPTH_CAPACITY;
  }
  throw new Error(`GPU island executor returned unknown status ${status}.`);
}

export function decodeGpuFrontendPlan(planBytes: Uint8Array): GpuFrontendPlan {
  const decoded = decodeCombinedWasmParserPlan(planBytes).compactRuntimePlan;
  const compact = expectRecord(decoded, "Wasm runtime metadata");
  const section = compact.g;
  if (section === undefined || section === null) {
    throw new Error(
      "parser.plan has no gpuFrontend v3 runtime section. Add gpuFrontend metadata and regenerate it.",
    );
  }
  const plan = expectRecord(section, "gpuFrontend runtime section");
  if (plan.format !== "baba-gpu-frontend") {
    throw new Error(
      `Unsupported GPU frontend format '${String(plan.format)}'.`,
    );
  }
  if (plan.version !== 3) {
    throw new Error(
      `Unsupported GPU frontend plan version ${String(plan.version)}.`,
    );
  }
  if (plan.semantics !== "baba-gpu-frontend-v3") {
    throw new Error(
      `Unsupported GPU frontend semantics '${String(plan.semantics)}'.`,
    );
  }
  expectArray(plan.terminalClassification, "terminal classification");
  expectArray(plan.boundaries, "island boundaries");
  expectArray(plan.islands, "island transducers");
  const execution = expectRecord(plan.execution, "GPU frontend execution");
  expectArray(execution.locators, "GPU frontend boundary locators");
  expectArray(execution.rootAnchors, "GPU frontend root segment anchors");
  const denseTransitions = expectRecord(
    execution.denseTransitions,
    "GPU frontend dense transitions",
  );
  expectArray(denseTransitions.targets, "GPU frontend dense targets");
  expectArray(denseTransitions.fields, "GPU frontend dense fields");
  expectArray(denseTransitions.kinds, "GPU frontend dense kinds");
  expectArray(execution.contractions, "GPU frontend contractions");
  expectRecord(execution.bounds, "GPU frontend execution bounds");
  expectRecord(plan.capacity, "GPU frontend capacity");
  expectRecord(plan.statistics, "GPU frontend statistics");
  return plan as unknown as GpuFrontendPlan;
}

export function inspectGpuFrontendPlan(
  planBytes: Uint8Array,
): GpuFrontendPlanInspection | null {
  const decoded = decodeCombinedWasmParserPlan(planBytes).compactRuntimePlan;
  const compact = expectRecord(decoded, "Wasm runtime metadata");
  if (compact.g === undefined || compact.g === null) {
    return null;
  }
  const plan = decodeGpuFrontendPlan(planBytes);
  return {
    version: plan.version,
    lexerStates: plan.statistics.lexerStates,
    islandCount: plan.islands.length,
    islandStates: plan.statistics.islandStates,
    islandTransitions: plan.statistics.islandTransitions,
    semanticOpcodes: plan.statistics.semanticOpcodes,
    maxNodesPerToken: plan.statistics.maxNodesPerToken,
    maxEdgesPerToken: plan.statistics.maxEdgesPerToken,
    maxConstraintsPerNode: plan.statistics.maxConstraintsPerNode,
    locatorCount: plan.statistics.locatorCount,
    denseTransitionBytes: plan.statistics.denseTransitionBytes,
    maxCandidateMultiplicity: plan.statistics.maxCandidateMultiplicity,
    contractionRounds: plan.statistics.contractionRounds,
    scratchExpansionFactors: {
      regions: plan.statistics.regionScratchPerToken,
      candidates: plan.statistics.candidateScratchPerToken,
      summaries: plan.statistics.summaryScratchPerToken,
      nodes: plan.statistics.nodeScratchPerToken,
      edges: plan.statistics.edgeScratchPerToken,
      diagnostics: plan.statistics.diagnosticScratchPerToken,
    },
    packedBytes: plan.statistics.packedBytes,
  };
}

function lex(
  source: Uint16Array,
  lexer: LexerPlanTables,
  plan: GpuFrontendPlan,
  diagnostics: RawDiagnostic[],
  maxTokens: number | undefined,
): Token[] {
  const tokens: Token[] = [];
  let position = 0;
  while (position < source.length) {
    let state = lexer.startState;
    let cursor = position;
    let acceptedEnd = -1;
    let acceptedState = -1;
    let acceptedSpec = -1;
    while (cursor < source.length) {
      const codePoint = sourceCodePoint(source, cursor);
      const target = transition(lexer, state, codePoint.value);
      if (target < 0) {
        break;
      }
      cursor += codePoint.width;
      state = target;
      const spec = lexer.acceptSpecByState[state];
      if (spec >= 0) {
        acceptedEnd = cursor;
        acceptedState = state;
        acceptedSpec = spec;
      }
    }
    if (acceptedEnd < 0) {
      const width = sourceCodePoint(source, position).width;
      diagnostics.push({
        code: DIAGNOSTIC_LEXICAL,
        start: position,
        end: position + width,
        subjectId: position,
        parameter0: source[position],
        parameter1: 0,
      });
      position += width;
      continue;
    }
    const terminal = plan.terminalClassification[acceptedSpec];
    if (terminal === undefined) {
      throw new Error(
        `GPU frontend terminal classification has no lexer spec ${acceptedSpec}.`,
      );
    }
    const outputIndex = tokens.length;
    tokens.push({
      terminal,
      start: position,
      end: acceptedEnd,
      lexicalIdentity: acceptedSpec,
      outputIndex,
    });
    position = acceptedEnd;
    void acceptedState;
  }
  if (maxTokens !== undefined && tokens.length > maxTokens) {
    diagnostics.push({
      code: DIAGNOSTIC_TOKEN_CAPACITY,
      start: 0,
      end: source.length,
      subjectId: tokens.length,
      parameter0: tokens.length,
      parameter1: maxTokens,
    });
  }
  return tokens;
}

function sourceCodePoint(
  source: Uint16Array,
  position: number,
): { readonly value: number; readonly width: number } {
  const first = source[position];
  if (
    first >= 0xd800 &&
    first <= 0xdbff &&
    position + 1 < source.length
  ) {
    const second = source[position + 1];
    if (second >= 0xdc00 && second <= 0xdfff) {
      return {
        value: 0x10000 + ((first - 0xd800) << 10) + second - 0xdc00,
        width: 2,
      };
    }
  }
  return { value: first, width: 1 };
}

function transition(
  lexer: LexerPlanTables,
  state: number,
  codePoint: number,
): number {
  const start = lexer.transitionRows[state];
  const end = lexer.transitionRows[state + 1];
  for (let index = start; index < end; index += 1) {
    const offset = index * 3;
    if (
      codePoint >= lexer.transitions[offset] &&
      codePoint <= lexer.transitions[offset + 1]
    ) {
      return lexer.transitions[offset + 2];
    }
  }
  return -1;
}

function matchDelimiters(
  tokens: readonly Token[],
  boundaries: readonly GpuFrontendBoundaryPlan[],
  diagnostics: RawDiagnostic[],
): ReadonlyMap<number, number> {
  const closeByOpen = new Map<number, number>();
  for (const boundary of boundaries) {
    if (boundary.kind === "paired" || boundary.kind === "separated") {
      const existing = closeByOpen.get(boundary.openTerminal);
      if (
        existing !== undefined &&
        existing !== boundary.closeTerminal
      ) {
        throw new Error(
          `GPU frontend opener terminal ${boundary.openTerminal} maps to both ${existing} and ${boundary.closeTerminal}.`,
        );
      }
      closeByOpen.set(boundary.openTerminal, boundary.closeTerminal);
    }
  }
  const openByClose = new Map<number, number>();
  for (const [open, close] of closeByOpen) {
    const existing = openByClose.get(close);
    if (existing !== undefined && existing !== open) {
      throw new Error(
        `GPU frontend closer terminal ${close} maps from both ${existing} and ${open}.`,
      );
    }
    openByClose.set(close, open);
  }
  const stack: { readonly terminal: number; readonly index: number }[] = [];
  const matches = new Map<number, number>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.terminal < 0) {
      continue;
    }
    const expectedClose = closeByOpen.get(token.terminal);
    if (expectedClose !== undefined) {
      stack.push({ terminal: expectedClose, index });
      continue;
    }
    if (!openByClose.has(token.terminal)) {
      continue;
    }
    const open = stack.pop();
    if (open === undefined || open.terminal !== token.terminal) {
      let expectedTerminal = -1;
      if (open !== undefined) {
        expectedTerminal = open.terminal;
      }
      diagnostics.push({
        code: DIAGNOSTIC_DELIMITER,
        start: token.start,
        end: token.end,
        subjectId: token.outputIndex,
        parameter0: expectedTerminal,
        parameter1: token.terminal,
      });
      continue;
    }
    matches.set(open.index, index);
  }
  for (const open of stack) {
    const token = tokens[open.index];
    diagnostics.push({
      code: DIAGNOSTIC_DELIMITER,
      start: token.start,
      end: token.end,
      subjectId: token.outputIndex,
      parameter0: open.terminal,
      parameter1: -1,
    });
  }
  return matches;
}

function executeRootIsland(
  tokens: readonly Token[],
  delimiterMatches: ReadonlyMap<number, number>,
  plan: GpuFrontendPlan,
  diagnostics: RawDiagnostic[],
): PendingNode | undefined {
  const syntaxTokens = tokens.filter((token) => token.terminal >= 0);
  const progress: IslandExecutionProgress = {
    farthestToken: 0,
    island: plan.rootIsland,
    state: 0,
  };
  const root = runIsland(
    plan.rootIsland,
    0,
    syntaxTokens.length,
    syntaxTokens,
    delimiterMatchesForSyntax(tokens, syntaxTokens, delimiterMatches),
    plan,
    new Set(),
    progress,
  );
  if (root !== undefined && root.nextToken === syntaxTokens.length) {
    return root.node;
  }
  let start = 0;
  let end = 0;
  if (root !== undefined && root.nextToken < syntaxTokens.length) {
    start = syntaxTokens[root.nextToken].start;
    end = syntaxTokens[root.nextToken].end;
  } else if (
    syntaxTokens.length > 0 &&
    progress.farthestToken < syntaxTokens.length
  ) {
    start = syntaxTokens[progress.farthestToken].start;
    end = syntaxTokens[progress.farthestToken].end;
  }
  let subjectId = progress.farthestToken;
  if (root !== undefined) {
    subjectId = root.nextToken;
  }
  diagnostics.push({
    code: DIAGNOSTIC_SYNTAX,
    start,
    end,
    subjectId,
    parameter0: progress.island,
    parameter1: progress.state,
  });
  return undefined;
}

function delimiterMatchesForSyntax(
  tokens: readonly Token[],
  syntaxTokens: readonly Token[],
  matches: ReadonlyMap<number, number>,
): ReadonlyMap<number, number> {
  const syntaxIndexByOutput = new Map(
    syntaxTokens.map((token, index) => [token.outputIndex, index]),
  );
  const syntaxMatches = new Map<number, number>();
  for (const [open, close] of matches) {
    const syntaxOpen = syntaxIndexByOutput.get(tokens[open].outputIndex);
    const syntaxClose = syntaxIndexByOutput.get(tokens[close].outputIndex);
    if (syntaxOpen !== undefined && syntaxClose !== undefined) {
      syntaxMatches.set(syntaxOpen, syntaxClose);
    }
  }
  return syntaxMatches;
}

function runIsland(
  islandId: number,
  start: number,
  limit: number,
  tokens: readonly Token[],
  delimiterMatches: ReadonlyMap<number, number>,
  plan: GpuFrontendPlan,
  active: ReadonlySet<string>,
  progress: IslandExecutionProgress,
): IslandMatch | undefined {
  const key = `${islandId}:${start}:${limit}`;
  if (active.has(key)) {
    return undefined;
  }
  const island = plan.islands[islandId];
  if (island === undefined) {
    throw new Error(`GPU frontend plan has no island ${islandId}.`);
  }
  const nextActive = new Set(active);
  nextActive.add(key);
  let state = island.startState;
  let cursor = start;
  const edges: PendingEdge[] = [];
  let ordinal = 0;
  while (cursor < limit) {
    if (cursor >= progress.farthestToken) {
      progress.farthestToken = cursor;
      progress.island = islandId;
      progress.state = state;
    }
    const statePlan = island.states[state];
    if (statePlan === undefined) {
      throw new Error(
        `GPU frontend island ${islandId} has no state ${state}.`,
      );
    }
    const token = tokens[cursor];
    const terminalTransition = statePlan.transitions.find((transition) =>
      transition.inputKind === "terminal" &&
      transition.input === token.terminal
    );
    let nestedMatch:
      | {
        readonly transition: typeof statePlan.transitions[number];
        readonly match: IslandMatch;
      }
      | undefined;
    for (
      const transition of statePlan.transitions.filter((candidate) =>
        candidate.inputKind === "island"
      )
    ) {
      const nestedLimit = islandLimit(
        transition.input,
        cursor,
        limit,
        tokens,
        delimiterMatches,
        plan.boundaries,
      );
      if (nestedLimit === undefined) {
        continue;
      }
      const match = runIsland(
        transition.input,
        cursor,
        nestedLimit,
        tokens,
        delimiterMatches,
        plan,
        nextActive,
        progress,
      );
      if (match === undefined) {
        continue;
      }
      const boundary = plan.boundaries[transition.input];
      const requiresExactLimit = boundary.kind === "paired" ||
        boundary.kind === "separated";
      if (requiresExactLimit && match.nextToken !== nestedLimit) {
        continue;
      }
      if (nestedMatch !== undefined) {
        if (nestedMatch.match.nextToken === match.nextToken) {
          return undefined;
        }
        if (nestedMatch.match.nextToken > match.nextToken) {
          continue;
        }
      }
      nestedMatch = { transition, match };
    }
    if (
      terminalTransition !== undefined &&
      (
        nestedMatch === undefined ||
        nestedMatch.match.nextToken <= cursor + 1
      )
    ) {
      if (
        nestedMatch !== undefined &&
        nestedMatch.match.nextToken === cursor + 1
      ) {
        return undefined;
      }
      edges.push({
        emit: terminalTransition.emit,
        token,
        child: undefined,
        ordinal,
      });
      ordinal += 1;
      state = terminalTransition.target;
      cursor += 1;
      continue;
    }
    if (nestedMatch === undefined) {
      break;
    }
    edges.push({
      emit: nestedMatch.transition.emit,
      token: undefined,
      child: nestedMatch.match.node,
      ordinal,
    });
    ordinal += 1;
    state = nestedMatch.transition.target;
    cursor = nestedMatch.match.nextToken;
  }
  const finalState = island.states[state];
  if (finalState === undefined || !finalState.accepting) {
    return undefined;
  }
  const firstToken = tokens[start];
  let end = 0;
  if (firstToken !== undefined) {
    end = firstToken.start;
  }
  let nodeStart = end;
  if (firstToken !== undefined) {
    nodeStart = firstToken.start;
  }
  if (cursor > start) {
    end = tokens[cursor - 1].end;
  }
  return {
    node: {
      island: islandId,
      start: nodeStart,
      end,
      sourceOrder: start,
      edges,
      id: -1,
    },
    nextToken: cursor,
  };
}

function islandLimit(
  island: number,
  start: number,
  outerLimit: number,
  tokens: readonly Token[],
  delimiterMatches: ReadonlyMap<number, number>,
  boundaries: readonly GpuFrontendBoundaryPlan[],
): number | undefined {
  const boundary = boundaries[island];
  if (boundary === undefined) {
    throw new Error(`GPU frontend plan has no boundary for island ${island}.`);
  }
  if (boundary.kind === "root") {
    return outerLimit;
  }
  if (boundary.kind === "paired" || boundary.kind === "separated") {
    if (tokens[start]?.terminal !== boundary.openTerminal) {
      return undefined;
    }
    const close = delimiterMatches.get(start);
    if (close === undefined || close >= outerLimit) {
      return undefined;
    }
    return close + 1;
  }
  return outerLimit;
}

function materializeProgram(
  tokens: readonly Token[],
  root: PendingNode,
  plan: GpuFrontendPlan,
  options: CpuFrontendOptions,
  source: string,
  diagnostics: RawDiagnostic[],
): CompactFrontendProgram {
  const pendingNodes: PendingNode[] = [];
  collectNodes(root, pendingNodes);
  if (
    options.maxNodes !== undefined && pendingNodes.length > options.maxNodes
  ) {
    throw new FrontendSourceCapacity({
      code: DIAGNOSTIC_NODE_CAPACITY,
      start: root.start,
      end: root.end,
      subjectId: pendingNodes.length,
      parameter0: pendingNodes.length,
      parameter1: options.maxNodes,
    });
  }
  for (let index = 0; index < pendingNodes.length; index += 1) {
    pendingNodes[index].id = index;
  }
  const symbols = executeSemanticRecipes(
    pendingNodes,
    tokens,
    plan,
    source,
    diagnostics,
  );
  const edgeCount = pendingNodes.reduce(
    (total, node) => total + node.edges.length,
    0,
  );
  if (options.maxEdges !== undefined && edgeCount > options.maxEdges) {
    throw new FrontendSourceCapacity({
      code: DIAGNOSTIC_EDGE_CAPACITY,
      start: root.start,
      end: root.end,
      subjectId: edgeCount,
      parameter0: edgeCount,
      parameter1: options.maxEdges,
    });
  }
  const tokenRecords = new Int32Array(tokens.length * TOKEN_WORDS);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    tokenRecords.set(
      [token.terminal, token.start, token.end, token.lexicalIdentity],
      index * TOKEN_WORDS,
    );
  }
  const nodeRecords = new Int32Array(pendingNodes.length * NODE_WORDS);
  const edgeRecords = new Int32Array(edgeCount * EDGE_WORDS);
  let edgeOffset = 0;
  for (const node of pendingNodes) {
    const island = plan.islands[node.island];
    nodeRecords.set(
      [
        island.ruleId,
        0,
        node.start,
        node.end,
        edgeOffset,
        node.edges.length,
        -1,
        -1,
      ],
      node.id * NODE_WORDS,
    );
    for (const edge of node.edges) {
      let targetCategory = 0;
      let targetId = edge.token?.outputIndex;
      if (edge.child !== undefined) {
        targetCategory = 1;
        targetId = edge.child.id;
      }
      if (targetId === undefined) {
        throw new Error(
          `GPU frontend node ${node.id} edge ${edge.ordinal} has no target.`,
        );
      }
      edgeRecords.set(
        [edge.emit.field, edge.ordinal, targetCategory, targetId],
        edgeOffset * EDGE_WORDS,
      );
      edgeOffset += 1;
    }
  }
  return {
    tokens: tokenRecords,
    nodes: nodeRecords,
    edges: edgeRecords,
    symbols,
    types: new Int32Array([0]),
  };
}

function decodePendingProgram(
  program: CompactFrontendProgram,
  plan: GpuFrontendPlan,
): { readonly nodes: PendingNode[]; readonly tokens: Token[] } {
  const tokens: Token[] = [];
  for (
    let offset = 0;
    offset < program.tokens.length;
    offset += TOKEN_WORDS
  ) {
    tokens.push({
      terminal: program.tokens[offset],
      start: program.tokens[offset + 1],
      end: program.tokens[offset + 2],
      lexicalIdentity: program.tokens[offset + 3],
      outputIndex: offset / TOKEN_WORDS,
    });
  }
  const islandByRule = new Map<number, number>();
  for (const island of plan.islands) {
    islandByRule.set(island.ruleId, island.id);
  }
  const nodes: PendingNode[] = [];
  for (let offset = 0; offset < program.nodes.length; offset += NODE_WORDS) {
    const ruleId = program.nodes[offset];
    const island = islandByRule.get(ruleId);
    if (island === undefined) {
      throw new Error(
        `GPU island output node ${
          offset / NODE_WORDS
        } has unknown rule ${ruleId}.`,
      );
    }
    nodes.push({
      island,
      start: program.nodes[offset + 2],
      end: program.nodes[offset + 3],
      sourceOrder: offset / NODE_WORDS,
      edges: [],
      id: offset / NODE_WORDS,
    });
  }
  for (let nodeId = 0; nodeId < nodes.length; nodeId += 1) {
    const nodeOffset = nodeId * NODE_WORDS;
    const edgeStart = program.nodes[nodeOffset + 4];
    const edgeCount = program.nodes[nodeOffset + 5];
    for (let ordinal = 0; ordinal < edgeCount; ordinal += 1) {
      const edgeOffset = (edgeStart + ordinal) * EDGE_WORDS;
      const field = program.edges[edgeOffset];
      const targetCategory = program.edges[edgeOffset + 2];
      const targetId = program.edges[edgeOffset + 3];
      let token: Token | undefined;
      let child: PendingNode | undefined;
      let emitKind: "token" | "placeholder" = "token";
      if (targetCategory === 0) {
        token = tokens[targetId];
        if (token === undefined) {
          throw new Error(
            `GPU island output edge ${
              edgeStart + ordinal
            } has unknown token ${targetId}.`,
          );
        }
      } else if (targetCategory === 1) {
        emitKind = "placeholder";
        child = nodes[targetId];
        if (child === undefined) {
          throw new Error(
            `GPU island output edge ${
              edgeStart + ordinal
            } has unknown node ${targetId}; ${nodes.length} nodes were allocated.`,
          );
        }
      } else {
        throw new Error(
          `GPU island output edge ${
            edgeStart + ordinal
          } has target category ${targetCategory}.`,
        );
      }
      nodes[nodeId].edges.push({
        emit: { kind: emitKind, field },
        token,
        child,
        ordinal: program.edges[edgeOffset + 1],
      });
    }
  }
  return { nodes, tokens };
}

function collectNodes(node: PendingNode, nodes: PendingNode[]): void {
  nodes.push(node);
  for (const edge of node.edges) {
    if (edge.child !== undefined) {
      collectNodes(edge.child, nodes);
    }
  }
}

function materializeDiagnostic(raw: RawDiagnostic): FrontendDiagnostic {
  const record = new Int32Array(DIAGNOSTIC_WORDS);
  record.set([
    raw.code,
    raw.start,
    raw.end,
    raw.subjectId,
    raw.parameter0,
    raw.parameter1,
    0,
    0,
  ]);
  if (raw.code === DIAGNOSTIC_LEXICAL) {
    return {
      code: "GPU_FRONTEND_LEXICAL_ERROR",
      message:
        `No token matches source span [${raw.start}, ${raw.end}); first UTF-16 unit is ${raw.parameter0}.`,
      start: raw.start,
      end: raw.end,
      subjectId: raw.subjectId,
      record,
    };
  }
  if (raw.code === DIAGNOSTIC_DELIMITER) {
    return {
      code: "GPU_FRONTEND_MALFORMED_DELIMITER",
      message:
        `Delimiter at span [${raw.start}, ${raw.end}) expected terminal ${raw.parameter0}, received ${raw.parameter1}.`,
      start: raw.start,
      end: raw.end,
      subjectId: raw.subjectId,
      record,
    };
  }
  if (raw.code >= DIAGNOSTIC_TOKEN_CAPACITY) {
    let code = "GPU_FRONTEND_TOKEN_CAPACITY";
    let subject = "tokens";
    if (raw.code === DIAGNOSTIC_NODE_CAPACITY) {
      code = "GPU_FRONTEND_NODE_CAPACITY";
      subject = "nodes";
    }
    if (raw.code === DIAGNOSTIC_EDGE_CAPACITY) {
      code = "GPU_FRONTEND_EDGE_CAPACITY";
      subject = "edges";
    }
    if (raw.code <= DIAGNOSTIC_EDGE_CAPACITY) {
      return {
        code,
        message:
          `GPU frontend produced ${raw.parameter0} ${subject}, exceeding the source budget (${raw.parameter1}).`,
        start: raw.start,
        end: raw.end,
        subjectId: raw.subjectId,
        record,
      };
    }
  }
  if (raw.code === DIAGNOSTIC_DEPTH_CAPACITY) {
    return {
      code: "GPU_FRONTEND_DEPTH_CAPACITY",
      message:
        `GPU frontend nesting depth ${raw.parameter0} exceeds the device parser limit ${raw.parameter1}.`,
      start: raw.start,
      end: raw.end,
      subjectId: raw.subjectId,
      record,
    };
  }
  if (raw.code === DIAGNOSTIC_DUPLICATE_BINDING) {
    return {
      code: "GPU_FRONTEND_DUPLICATE_BINDING",
      message:
        `Binding at span [${raw.start}, ${raw.end}) duplicates symbol ${raw.parameter0}.`,
      start: raw.start,
      end: raw.end,
      subjectId: raw.subjectId,
      record,
    };
  }
  if (raw.code === DIAGNOSTIC_UNKNOWN_REFERENCE) {
    return {
      code: "GPU_FRONTEND_UNKNOWN_REFERENCE",
      message:
        `Reference at span [${raw.start}, ${raw.end}) does not resolve in its namespace.`,
      start: raw.start,
      end: raw.end,
      subjectId: raw.subjectId,
      record,
    };
  }
  if (raw.code === DIAGNOSTIC_REFERENCE_CYCLE) {
    return {
      code: "GPU_FRONTEND_REFERENCE_CYCLE",
      message:
        `Definition at span [${raw.start}, ${raw.end}) participates in a reference cycle.`,
      start: raw.start,
      end: raw.end,
      subjectId: raw.subjectId,
      record,
    };
  }
  if (raw.code === DIAGNOSTIC_INTEGER_BOUNDS) {
    return {
      code: "GPU_FRONTEND_INTEGER_BOUNDS",
      message:
        `Integer at span [${raw.start}, ${raw.end}) is outside the signed I32 domain.`,
      start: raw.start,
      end: raw.end,
      subjectId: raw.subjectId,
      record,
    };
  }
  if (raw.code === DIAGNOSTIC_REPEAT_LIMIT) {
    return {
      code: "GPU_FRONTEND_REPEAT_LIMIT",
      message:
        `Repeat count at span [${raw.start}, ${raw.end}) must be between 0 and ${raw.parameter0}.`,
      start: raw.start,
      end: raw.end,
      subjectId: raw.subjectId,
      record,
    };
  }
  return {
    code: "GPU_FRONTEND_SYNTAX_ERROR",
    message:
      `Island ${raw.parameter0} rejected syntax at span [${raw.start}, ${raw.end}).`,
    start: raw.start,
    end: raw.end,
    subjectId: raw.subjectId,
    record,
  };
}

function executeSemanticRecipes(
  nodes: readonly PendingNode[],
  tokens: readonly Token[],
  plan: GpuFrontendPlan,
  source: string,
  diagnostics: RawDiagnostic[],
): Int32Array {
  const recipeByRule = new Map(
    plan.semanticRecipes.map((recipe) => [recipe.ruleId, recipe]),
  );
  const definitions: {
    readonly node: PendingNode;
    readonly name: string;
    readonly token: Token;
    readonly symbol: number;
  }[] = [];
  const definitionByName = new Map<string, number>();
  const symbolWords: number[] = [];
  for (const node of nodes) {
    const ruleId = plan.islands[node.island].ruleId;
    const recipe = recipeByRule.get(ruleId);
    if (recipe?.opcode !== "define") {
      continue;
    }
    const nameField = recipe.fields.find((field) =>
      field.target === "binder" || field.target === "name"
    );
    if (nameField === undefined) {
      continue;
    }
    const token = node.edges.find((edge) =>
      edge.emit.field === nameField.field && edge.token !== undefined
    )?.token;
    if (token === undefined) {
      continue;
    }
    const name = source.slice(token.start, token.end);
    const previous = definitionByName.get(name);
    if (previous !== undefined) {
      diagnostics.push({
        code: DIAGNOSTIC_DUPLICATE_BINDING,
        start: token.start,
        end: token.end,
        subjectId: node.id,
        parameter0: previous,
        parameter1: 0,
      });
      continue;
    }
    const symbol = definitions.length;
    definitionByName.set(name, symbol);
    definitions.push({ node, name, token, symbol });
    symbolWords.push(0, 0, token.outputIndex, -1, -1, node.id);
  }

  const referenceNodes = nodes.filter((node) => {
    const ruleId = plan.islands[node.island].ruleId;
    return recipeByRule.get(ruleId)?.opcode === "reference";
  });
  const primitiveNames = new Set(
    plan.primitives.map((primitive) => primitive.source),
  );
  const referencesByDefinition = new Map<number, number[]>();
  for (const node of referenceNodes) {
    const ruleId = plan.islands[node.island].ruleId;
    const recipe = recipeByRule.get(ruleId);
    const nameField = recipe?.fields.find((field) =>
      field.target === "name" || field.target === "reference"
    );
    if (nameField === undefined) {
      continue;
    }
    const token = node.edges.find((edge) =>
      edge.emit.field === nameField.field && edge.token !== undefined
    )?.token;
    if (token === undefined) {
      continue;
    }
    const name = source.slice(token.start, token.end);
    const target = definitionByName.get(name);
    if (target === undefined) {
      if (!primitiveNames.has(name)) {
        diagnostics.push({
          code: DIAGNOSTIC_UNKNOWN_REFERENCE,
          start: token.start,
          end: token.end,
          subjectId: node.id,
          parameter0: 0,
          parameter1: 0,
        });
      }
      continue;
    }
    const owner = definitions.find((definition) =>
      node.start >= definition.node.start && node.end <= definition.node.end
    );
    if (owner === undefined) {
      continue;
    }
    const references = referencesByDefinition.get(owner.symbol);
    if (references === undefined) {
      referencesByDefinition.set(owner.symbol, [target]);
    } else {
      references.push(target);
    }
  }
  reportReferenceCycles(
    definitions,
    referencesByDefinition,
    diagnostics,
  );

  for (const token of tokens) {
    const text = source.slice(token.start, token.end);
    if (!/^-?[0-9]+$/.test(text)) {
      continue;
    }
    const integer = BigInt(text);
    const isI32MinimumMagnitude = integer === 2147483648n &&
      token.start > 0 &&
      source[token.start - 1] === "-";
    if (
      integer < -2147483648n ||
      (integer > 2147483647n && !isI32MinimumMagnitude)
    ) {
      diagnostics.push({
        code: DIAGNOSTIC_INTEGER_BOUNDS,
        start: token.start,
        end: token.end,
        subjectId: token.outputIndex,
        parameter0: 0,
        parameter1: 0,
      });
    }
  }
  for (const node of nodes) {
    const ruleId = plan.islands[node.island].ruleId;
    const recipe = recipeByRule.get(ruleId);
    if (recipe?.opcode !== "repeat-limit") {
      continue;
    }
    const countField = recipe.fields.find((field) => field.target === "count");
    const token = node.edges.find((edge) =>
      edge.emit.field === countField?.field && edge.token !== undefined
    )?.token;
    if (token === undefined) {
      continue;
    }
    const count = BigInt(source.slice(token.start, token.end));
    if (count < 0n || count > 1_000_000n) {
      diagnostics.push({
        code: DIAGNOSTIC_REPEAT_LIMIT,
        start: token.start,
        end: token.end,
        subjectId: node.id,
        parameter0: 1_000_000,
        parameter1: 0,
      });
    }
  }
  return new Int32Array(symbolWords);
}

function reportReferenceCycles(
  definitions: readonly {
    readonly node: PendingNode;
    readonly symbol: number;
  }[],
  referencesByDefinition: ReadonlyMap<number, readonly number[]>,
  diagnostics: RawDiagnostic[],
): void {
  const complete = new Set<number>();
  const active = new Set<number>();
  const reported = new Set<number>();
  const visit = (symbol: number): void => {
    if (complete.has(symbol)) {
      return;
    }
    if (active.has(symbol)) {
      if (!reported.has(symbol)) {
        const definition = definitions[symbol];
        diagnostics.push({
          code: DIAGNOSTIC_REFERENCE_CYCLE,
          start: definition.node.start,
          end: definition.node.end,
          subjectId: definition.node.id,
          parameter0: symbol,
          parameter1: 0,
        });
        reported.add(symbol);
      }
      return;
    }
    active.add(symbol);
    const references = referencesByDefinition.get(symbol);
    if (references === undefined) {
      active.delete(symbol);
      complete.add(symbol);
      return;
    }
    for (const target of references) {
      visit(target);
    }
    active.delete(symbol);
    complete.add(symbol);
  };
  for (const definition of definitions) {
    visit(definition.symbol);
  }
}

class FrontendSourceCapacity extends Error {
  readonly diagnostic: RawDiagnostic;

  constructor(diagnostic: RawDiagnostic) {
    super("GPU frontend source capacity was exceeded.");
    this.name = "FrontendSourceCapacity";
    this.diagnostic = diagnostic;
  }
}

function assertDeviceCapacity(
  sourceLength: number,
  plan: GpuFrontendPlan,
  runtime: WebGpuRuntime,
): void {
  const limit = Math.min(
    runtime.capabilities.limits.maxBufferSize,
    runtime.capabilities.limits.maxStorageBufferBindingSize,
  );
  const buffers = [
    {
      name: "tokens",
      bytes: sourceLength * TOKEN_WORDS * Int32Array.BYTES_PER_ELEMENT,
    },
    {
      name: "nodes",
      bytes: sourceLength * plan.capacity.nodesPerToken *
        NODE_WORDS * Int32Array.BYTES_PER_ELEMENT,
    },
    {
      name: "edges",
      bytes: sourceLength * plan.capacity.edgesPerToken *
        EDGE_WORDS * Int32Array.BYTES_PER_ELEMENT,
    },
    {
      name: "islandArena",
      bytes: (
        32 +
        sourceLength * TOKEN_WORDS +
        sourceLength * plan.capacity.nodesPerToken * NODE_WORDS +
        sourceLength * plan.capacity.edgesPerToken * EDGE_WORDS +
        sourceLength * 3
      ) * Int32Array.BYTES_PER_ELEMENT,
    },
  ];
  for (const buffer of buffers) {
    if (!Number.isSafeInteger(buffer.bytes) || buffer.bytes > limit) {
      throw new GpuFrontendCapacityError(buffer.name, buffer.bytes, limit);
    }
  }
}

function expectRecord(
  value: unknown,
  subject: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${subject} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function expectArray(value: unknown, subject: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${subject} must be an array.`);
  }
  return value;
}
