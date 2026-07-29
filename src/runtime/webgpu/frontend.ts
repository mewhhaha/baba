import {
  GPU_FRONTEND_FORMAT,
  GPU_FRONTEND_PLAN_VERSION,
  GPU_FRONTEND_SEMANTICS,
  type GpuFrontendPlan,
} from "../../compiler/gpu_frontend.ts";
import { decodeCombinedWasmParserPlan } from "../wasm_plan.ts";
import type { WebGpuLexerContext, WebGpuRuntime } from "./context.ts";
import {
  type GpuIslandExecution,
  GpuIslandExecutor,
} from "./island_executor.ts";
export { GpuFrontendCapacityError } from "./frontend_capacity.ts";
import { GpuFrontendCapacityError } from "./frontend_capacity.ts";
import {
  GPU_FRONTEND_CANDIDATE_WORDS as CANDIDATE_WORDS,
  GPU_FRONTEND_DIAGNOSTIC_DELIMITER as DIAGNOSTIC_DELIMITER,
  GPU_FRONTEND_DIAGNOSTIC_DEPTH_CAPACITY as DIAGNOSTIC_DEPTH_CAPACITY,
  GPU_FRONTEND_DIAGNOSTIC_DUPLICATE_BINDING as DIAGNOSTIC_DUPLICATE_BINDING,
  GPU_FRONTEND_DIAGNOSTIC_EDGE_CAPACITY as DIAGNOSTIC_EDGE_CAPACITY,
  GPU_FRONTEND_DIAGNOSTIC_INTEGER_BOUNDS as DIAGNOSTIC_INTEGER_BOUNDS,
  GPU_FRONTEND_DIAGNOSTIC_LEXICAL as DIAGNOSTIC_LEXICAL,
  GPU_FRONTEND_DIAGNOSTIC_NODE_CAPACITY as DIAGNOSTIC_NODE_CAPACITY,
  GPU_FRONTEND_DIAGNOSTIC_REFERENCE_CYCLE as DIAGNOSTIC_REFERENCE_CYCLE,
  GPU_FRONTEND_DIAGNOSTIC_REPEAT_LIMIT as DIAGNOSTIC_REPEAT_LIMIT,
  GPU_FRONTEND_DIAGNOSTIC_SYNTAX as DIAGNOSTIC_SYNTAX,
  GPU_FRONTEND_DIAGNOSTIC_TOKEN_CAPACITY as DIAGNOSTIC_TOKEN_CAPACITY,
  GPU_FRONTEND_DIAGNOSTIC_UNKNOWN_REFERENCE as DIAGNOSTIC_UNKNOWN_REFERENCE,
  GPU_FRONTEND_DIAGNOSTIC_WORDS as DIAGNOSTIC_WORDS,
  GPU_FRONTEND_EDGE_WORDS as EDGE_WORDS,
  GPU_FRONTEND_NODE_WORDS as NODE_WORDS,
  GPU_FRONTEND_TOKEN_WORDS as TOKEN_WORDS,
  type GpuFrontendDiagnosticRecord as RawDiagnostic,
} from "./frontend_contract.ts";

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

export interface GpuResidentFrontendLayout {
  readonly byteLength: number;
  readonly headerWords: number;
  readonly statusWord: 0;
  readonly tokenCountWord: 1;
  readonly nodeCountWord: 2;
  readonly edgeCountWord: 3;
  readonly tokenCapacity: number;
  readonly nodeCapacity: number;
  readonly edgeCapacity: number;
  readonly tokenOffsetWords: number;
  readonly nodeOffsetWords: number;
  readonly edgeOffsetWords: number;
}

export interface GpuResidentFrontendTimings {
  readonly uploadMs: number;
  /** CPU time spent submitting; this does not wait for device completion. */
  readonly submitMs: number;
  readonly totalMs: number;
}

/**
 * Device-resident syntax IR. Counts and status remain in the buffer header.
 * Submit consumers to the same queue before disposal; queue ordering makes the
 * result visible without waiting for device completion on the host.
 */
export interface GpuResidentFrontendResult {
  readonly buffer: GPUBuffer;
  readonly layout: GpuResidentFrontendLayout;
  readonly timings: GpuResidentFrontendTimings;
  dispose(): void;
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

export interface FrontendAllocationLimits {
  readonly maxNodes?: number;
  readonly maxEdges?: number;
}

export interface WebGpuFrontendOptions extends FrontendAllocationLimits {
  readonly lexerCapacityRecords?: number;
  /** Collect per-dispatch GPU timestamps instead of batching dependent stages. */
  readonly stageTimings?: "collect";
}

export interface GpuResidentFrontendOptions extends FrontendAllocationLimits {
  readonly lexerCapacityRecords?: number;
}

export interface GpuFrontendPlanInspection {
  readonly version: typeof GPU_FRONTEND_PLAN_VERSION;
  readonly throughput: "general" | "strict";
  readonly rootLoopIsland: number | null;
  readonly parallelLongRegionIslands: number;
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
  #activeJobs = 0;
  #residentResults = 0;
  #disposed = false;

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
    const frontend = new WebGpuFrontend(plan, runtime, lexer, islands);
    try {
      runtime.registerFrontend(frontend);
    } catch (error) {
      islands.destroy();
      throw error;
    }
    return frontend;
  }

  async ingest(
    source: string,
    options: WebGpuFrontendOptions = {},
  ): Promise<GpuFrontendResult> {
    this.#startJob();
    try {
      return await this.#ingest(source, options);
    } finally {
      this.#activeJobs -= 1;
    }
  }

  async #ingest(
    source: string,
    options: WebGpuFrontendOptions,
  ): Promise<GpuFrontendResult> {
    if (
      options.lexerCapacityRecords !== undefined &&
      (
        !Number.isSafeInteger(options.lexerCapacityRecords) ||
        options.lexerCapacityRecords < 1
      )
    ) {
      throw new TypeError(
        `lexerCapacityRecords must be a positive safe integer; received ${options.lexerCapacityRecords}.`,
      );
    }
    assertFrontendAllocationLimits(options);
    if (
      options.stageTimings !== undefined &&
      options.stageTimings !== "collect"
    ) {
      throw new TypeError(
        `stageTimings must be 'collect' when provided, got '${options.stageTimings}'.`,
      );
    }
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
    try {
      this.#islands.assertExecutionSlotAvailable(lexerLease.lexer);
    } catch (error) {
      lexerLease.release();
      throw error;
    }
    const runtimeLease = await this.runtime.acquireLease();
    let execution: GpuIslandExecution;
    try {
      execution = await this.#islands.execute(
        lexerLease.lexer,
        units,
        options.lexerCapacityRecords,
        options.maxNodes,
        options.maxEdges,
        options.stageTimings,
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
      const symbols = executeCompactSemanticRecipes(
        gpuProgram,
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

  async ingestResident(
    source: string | Uint16Array,
    options: GpuResidentFrontendOptions = {},
  ): Promise<GpuResidentFrontendResult> {
    this.#startJob();
    try {
      return await this.#ingestResident(source, options);
    } finally {
      this.#activeJobs -= 1;
    }
  }

  async #ingestResident(
    source: string | Uint16Array,
    options: GpuResidentFrontendOptions,
  ): Promise<GpuResidentFrontendResult> {
    if (
      options.lexerCapacityRecords !== undefined &&
      (
        !Number.isSafeInteger(options.lexerCapacityRecords) ||
        options.lexerCapacityRecords < 1
      )
    ) {
      throw new TypeError(
        `lexerCapacityRecords must be a positive safe integer; received ${options.lexerCapacityRecords}.`,
      );
    }
    assertFrontendAllocationLimits(options);
    const started = performance.now();
    assertDeviceCapacity(source.length, this.plan, this.runtime);
    let units: Uint16Array;
    if (typeof source === "string") {
      units = new Uint16Array(source.length);
      for (let index = 0; index < source.length; index += 1) {
        units[index] = source.charCodeAt(index);
      }
    } else {
      units = source;
    }
    const afterUpload = performance.now();
    const lexerLease = await this.#lexer.acquireIntegratedLexer();
    try {
      this.#islands.assertExecutionSlotAvailable(lexerLease.lexer);
    } catch (error) {
      lexerLease.release();
      throw error;
    }
    const runtimeLease = await this.runtime.acquireLease();
    let execution;
    try {
      execution = await this.#islands.executeResident(
        lexerLease.lexer,
        units,
        options.lexerCapacityRecords,
        options.maxNodes,
        options.maxEdges,
      );
    } catch (error) {
      runtimeLease.release();
      lexerLease.release();
      throw error;
    }
    const finished = performance.now();
    this.#residentResults += 1;
    let disposed = false;
    return {
      buffer: execution.buffer,
      layout: {
        byteLength: execution.byteLength,
        headerWords: execution.headerWords,
        statusWord: 0,
        tokenCountWord: 1,
        nodeCountWord: 2,
        edgeCountWord: 3,
        tokenCapacity: execution.tokenCapacity,
        nodeCapacity: execution.nodeCapacity,
        edgeCapacity: execution.edgeCapacity,
        tokenOffsetWords: execution.tokenOffsetWords,
        nodeOffsetWords: execution.nodeOffsetWords,
        edgeOffsetWords: execution.edgeOffsetWords,
      },
      timings: {
        uploadMs: afterUpload - started,
        submitMs: execution.submitMs,
        totalMs: finished - started,
      },
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        execution.release();
        lexerLease.release();
        runtimeLease.release();
        this.#residentResults -= 1;
      },
    };
  }

  get isDisposed(): boolean {
    return this.#disposed;
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.assertDisposable();
    this.#disposed = true;
    this.#islands.destroy();
    this.runtime.releaseFrontend(this);
  }

  assertDisposable(): void {
    if (this.#activeJobs > 0 || this.#residentResults > 0) {
      throw new Error(
        `Cannot dispose WebGpuFrontend while ${this.#activeJobs} ingestion job(s) and ${this.#residentResults} resident result(s) are active.`,
      );
    }
  }

  #startJob(): void {
    if (this.#disposed) {
      throw new Error("WebGpuFrontend has been disposed.");
    }
    if (this.#residentResults >= this.runtime.maxInFlight) {
      throw new Error(
        "GPU frontend resident result must be disposed before reusing its execution slot.",
      );
    }
    this.#activeJobs += 1;
  }
}

export function assertFrontendAllocationLimits(
  limits: FrontendAllocationLimits,
): void {
  for (
    const [name, value] of [
      ["maxNodes", limits.maxNodes],
      ["maxEdges", limits.maxEdges],
    ] as const
  ) {
    if (
      value !== undefined &&
      (!Number.isSafeInteger(value) || value < 0)
    ) {
      throw new TypeError(
        `${name} must be a non-negative safe integer; received ${value}.`,
      );
    }
  }
}

function executionStatusDiagnostic(status: number): number {
  if (
    status === DIAGNOSTIC_LEXICAL ||
    status === DIAGNOSTIC_DELIMITER ||
    status === DIAGNOSTIC_SYNTAX ||
    status === DIAGNOSTIC_TOKEN_CAPACITY ||
    status === DIAGNOSTIC_NODE_CAPACITY ||
    status === DIAGNOSTIC_EDGE_CAPACITY ||
    status === DIAGNOSTIC_DEPTH_CAPACITY
  ) {
    return status;
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
  const throughput = plan.throughput;
  if (throughput !== "general" && throughput !== "strict") {
    throw new Error(
      `gpuFrontend runtime section has invalid throughput profile '${throughput}'.`,
    );
  }
  if (plan.format !== GPU_FRONTEND_FORMAT) {
    throw new Error(
      `Unsupported GPU frontend format '${String(plan.format)}'.`,
    );
  }
  if (plan.version !== GPU_FRONTEND_PLAN_VERSION) {
    throw new Error(
      `Unsupported GPU frontend plan version ${String(plan.version)}.`,
    );
  }
  if (plan.semantics !== GPU_FRONTEND_SEMANTICS) {
    throw new Error(
      `Unsupported GPU frontend semantics '${String(plan.semantics)}'.`,
    );
  }
  expectArray(plan.terminalClassification, "terminal classification");
  expectArray(plan.boundaries, "island boundaries");
  expectArray(plan.islands, "island transducers");
  const execution = expectRecord(plan.execution, "GPU frontend execution");
  const locators = expectArray(
    execution.locators,
    "GPU frontend boundary locators",
  );
  expectArray(execution.rootAnchors, "GPU frontend root segment anchors");
  if (execution.rootLoop !== null) {
    expectRecord(execution.rootLoop, "GPU frontend root loop");
  }
  expectArray(execution.longRegions, "GPU frontend long regions");
  const denseTransitions = expectRecord(
    execution.denseTransitions,
    "GPU frontend dense transitions",
  );
  const denseTargets = expectArray(
    denseTransitions.targets,
    "GPU frontend dense targets",
  );
  const denseFields = expectArray(
    denseTransitions.fields,
    "GPU frontend dense fields",
  );
  const denseKinds = expectArray(
    denseTransitions.kinds,
    "GPU frontend dense kinds",
  );
  const denseRows = expectPositiveSafeInteger(
    denseTransitions.rows,
    "GPU frontend dense transition rows",
  );
  const denseSymbols = expectPositiveSafeInteger(
    denseTransitions.symbols,
    "GPU frontend dense transition symbols",
  );
  const denseEntries = denseRows * denseSymbols;
  if (
    !Number.isSafeInteger(denseEntries) ||
    denseTargets.length !== denseEntries ||
    denseFields.length !== denseEntries ||
    denseKinds.length !== denseEntries
  ) {
    throw new Error(
      `GPU frontend dense transition table declares ${denseRows} rows and ${denseSymbols} symbols, but its target, field, and kind lengths are ${denseTargets.length}, ${denseFields.length}, and ${denseKinds.length}.`,
    );
  }
  expectArray(execution.contractions, "GPU frontend contractions");
  const bounds = expectRecord(
    execution.bounds,
    "GPU frontend execution bounds",
  );
  for (
    const key of [
      "regionsPerToken",
      "candidatesPerToken",
      "summariesPerCandidate",
      "nodesPerToken",
      "edgesPerToken",
      "diagnosticsPerToken",
    ]
  ) {
    expectPositiveSafeInteger(
      bounds[key],
      `GPU frontend execution bound ${key}`,
    );
  }
  if (
    typeof bounds.candidatesPerToken === "number" &&
    bounds.candidatesPerToken > locators.length
  ) {
    throw new Error(
      `GPU frontend candidate multiplicity ${bounds.candidatesPerToken} exceeds its ${locators.length} boundary locators.`,
    );
  }
  const capacity = expectRecord(plan.capacity, "GPU frontend capacity");
  for (
    const key of [
      "nodesPerToken",
      "edgesPerToken",
      "constraintsPerNode",
    ]
  ) {
    expectPositiveSafeInteger(
      capacity[key],
      `GPU frontend capacity ${key}`,
    );
  }
  const statistics = expectRecord(
    plan.statistics,
    "GPU frontend statistics",
  );
  expectPositiveSafeInteger(
    statistics.contractionRounds,
    "GPU frontend contraction rounds",
  );
  const islands = plan.islands as unknown[];
  let islandStates = 0;
  let islandTransitions = 0;
  for (let islandIndex = 0; islandIndex < islands.length; islandIndex += 1) {
    const island = expectRecord(
      islands[islandIndex],
      `GPU frontend island ${islandIndex}`,
    );
    const states = expectArray(
      island.states,
      `GPU frontend island ${islandIndex} states`,
    );
    islandStates += states.length;
    for (let stateIndex = 0; stateIndex < states.length; stateIndex += 1) {
      const state = expectRecord(
        states[stateIndex],
        `GPU frontend island ${islandIndex} state ${stateIndex}`,
      );
      islandTransitions += expectArray(
        state.transitions,
        `GPU frontend island ${islandIndex} state ${stateIndex} transitions`,
      ).length;
    }
  }
  if (
    statistics.islandStates !== islandStates ||
    statistics.islandTransitions !== islandTransitions
  ) {
    throw new Error(
      `GPU frontend statistics declare ${
        String(statistics.islandStates)
      } states and ${
        String(statistics.islandTransitions)
      } transitions, but the island tables contain ${islandStates} states and ${islandTransitions} transitions.`,
    );
  }
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
  let rootLoopIsland: number | null = null;
  if (plan.execution.rootLoop !== null) {
    rootLoopIsland = plan.execution.rootLoop.island;
  }
  return {
    version: plan.version,
    throughput: plan.throughput,
    rootLoopIsland,
    parallelLongRegionIslands: plan.execution.longRegions.length,
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

export function materializeDiagnostic(
  raw: RawDiagnostic,
): FrontendDiagnostic {
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

interface SemanticDefinition {
  readonly start: number;
  readonly end: number;
  readonly nodeId: number;
  readonly symbol: number;
}

export function executeCompactSemanticRecipes(
  program: CompactFrontendProgram,
  plan: GpuFrontendPlan,
  source: string,
  diagnostics: RawDiagnostic[],
): Int32Array {
  const recipeByRule = new Map(
    plan.semanticRecipes.map((recipe) => [recipe.ruleId, recipe]),
  );
  const definitions: SemanticDefinition[] = [];
  const definitionByName = new Map<string, number>();
  const symbolWords: number[] = [];
  const nodeCount = program.nodes.length / NODE_WORDS;
  for (let nodeId = 0; nodeId < nodeCount; nodeId += 1) {
    const nodeOffset = nodeId * NODE_WORDS;
    const recipe = recipeByRule.get(program.nodes[nodeOffset]);
    if (recipe?.opcode !== "define") {
      continue;
    }
    const nameField = recipe.fields.find((field) =>
      field.target === "binder" || field.target === "name"
    );
    if (nameField === undefined) {
      continue;
    }
    const tokenIndex = compactTokenForField(
      program,
      nodeId,
      nameField.field,
    );
    if (tokenIndex === undefined) {
      continue;
    }
    const tokenOffset = tokenIndex * TOKEN_WORDS;
    const tokenStart = program.tokens[tokenOffset + 1];
    const tokenEnd = program.tokens[tokenOffset + 2];
    const name = source.slice(tokenStart, tokenEnd);
    const previous = definitionByName.get(name);
    if (previous !== undefined) {
      diagnostics.push({
        code: DIAGNOSTIC_DUPLICATE_BINDING,
        start: tokenStart,
        end: tokenEnd,
        subjectId: nodeId,
        parameter0: previous,
        parameter1: 0,
      });
      continue;
    }
    const symbol = definitions.length;
    definitionByName.set(name, symbol);
    definitions.push({
      start: program.nodes[nodeOffset + 2],
      end: program.nodes[nodeOffset + 3],
      nodeId,
      symbol,
    });
    symbolWords.push(0, 0, tokenIndex, -1, -1, nodeId);
  }

  const primitiveNames = new Set(
    plan.primitives.map((primitive) => primitive.source),
  );
  const referencesByDefinition = new Map<number, number[]>();
  for (let nodeId = 0; nodeId < nodeCount; nodeId += 1) {
    const nodeOffset = nodeId * NODE_WORDS;
    const recipe = recipeByRule.get(program.nodes[nodeOffset]);
    if (recipe?.opcode !== "reference") {
      continue;
    }
    const nameField = recipe.fields.find((field) =>
      field.target === "name" || field.target === "reference"
    );
    if (nameField === undefined) {
      continue;
    }
    const tokenIndex = compactTokenForField(
      program,
      nodeId,
      nameField.field,
    );
    if (tokenIndex === undefined) {
      continue;
    }
    const tokenOffset = tokenIndex * TOKEN_WORDS;
    const tokenStart = program.tokens[tokenOffset + 1];
    const tokenEnd = program.tokens[tokenOffset + 2];
    const name = source.slice(tokenStart, tokenEnd);
    const target = definitionByName.get(name);
    if (target === undefined) {
      if (!primitiveNames.has(name)) {
        diagnostics.push({
          code: DIAGNOSTIC_UNKNOWN_REFERENCE,
          start: tokenStart,
          end: tokenEnd,
          subjectId: nodeId,
          parameter0: 0,
          parameter1: 0,
        });
      }
      continue;
    }
    const nodeStart = program.nodes[nodeOffset + 2];
    const nodeEnd = program.nodes[nodeOffset + 3];
    const owner = definitions.find((definition) =>
      nodeStart >= definition.start && nodeEnd <= definition.end
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

  const tokenCount = program.tokens.length / TOKEN_WORDS;
  for (let tokenIndex = 0; tokenIndex < tokenCount; tokenIndex += 1) {
    const tokenOffset = tokenIndex * TOKEN_WORDS;
    const tokenStart = program.tokens[tokenOffset + 1];
    const tokenEnd = program.tokens[tokenOffset + 2];
    if (!isDecimalIntegerSpan(source, tokenStart, tokenEnd)) {
      continue;
    }
    const integer = BigInt(source.slice(tokenStart, tokenEnd));
    const isI32MinimumMagnitude = integer === 2147483648n &&
      tokenStart > 0 &&
      source[tokenStart - 1] === "-";
    if (
      integer < -2147483648n ||
      (integer > 2147483647n && !isI32MinimumMagnitude)
    ) {
      diagnostics.push({
        code: DIAGNOSTIC_INTEGER_BOUNDS,
        start: tokenStart,
        end: tokenEnd,
        subjectId: tokenIndex,
        parameter0: 0,
        parameter1: 0,
      });
    }
  }

  for (let nodeId = 0; nodeId < nodeCount; nodeId += 1) {
    const nodeOffset = nodeId * NODE_WORDS;
    const recipe = recipeByRule.get(program.nodes[nodeOffset]);
    if (recipe?.opcode !== "repeat-limit") {
      continue;
    }
    const countField = recipe.fields.find((field) => field.target === "count");
    if (countField === undefined) {
      continue;
    }
    const tokenIndex = compactTokenForField(
      program,
      nodeId,
      countField.field,
    );
    if (tokenIndex === undefined) {
      continue;
    }
    const tokenOffset = tokenIndex * TOKEN_WORDS;
    const tokenStart = program.tokens[tokenOffset + 1];
    const tokenEnd = program.tokens[tokenOffset + 2];
    const count = BigInt(source.slice(tokenStart, tokenEnd));
    if (count < 0n || count > 1_000_000n) {
      diagnostics.push({
        code: DIAGNOSTIC_REPEAT_LIMIT,
        start: tokenStart,
        end: tokenEnd,
        subjectId: nodeId,
        parameter0: 1_000_000,
        parameter1: 0,
      });
    }
  }
  return new Int32Array(symbolWords);
}

function compactTokenForField(
  program: CompactFrontendProgram,
  nodeId: number,
  field: number,
): number | undefined {
  const nodeOffset = nodeId * NODE_WORDS;
  const edgeStart = program.nodes[nodeOffset + 4];
  const edgeCount = program.nodes[nodeOffset + 5];
  for (let ordinal = 0; ordinal < edgeCount; ordinal += 1) {
    const edgeOffset = (edgeStart + ordinal) * EDGE_WORDS;
    if (
      program.edges[edgeOffset] === field &&
      program.edges[edgeOffset + 2] === 0
    ) {
      return program.edges[edgeOffset + 3];
    }
  }
  return undefined;
}

function isDecimalIntegerSpan(
  source: string,
  start: number,
  end: number,
): boolean {
  if (start >= end) {
    return false;
  }
  let cursor = start;
  if (source.charCodeAt(cursor) === 45) {
    cursor += 1;
  }
  if (cursor >= end) {
    return false;
  }
  while (cursor < end) {
    const code = source.charCodeAt(cursor);
    if (code < 48 || code > 57) {
      return false;
    }
    cursor += 1;
  }
  return true;
}

function reportReferenceCycles(
  definitions: readonly SemanticDefinition[],
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
          start: definition.start,
          end: definition.end,
          subjectId: definition.nodeId,
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
    {
      name: "islandCandidatesHead",
      bytes: Math.ceil(
        (1 + sourceLength * plan.execution.bounds.candidatesPerToken) / 2,
      ) * CANDIDATE_WORDS * Int32Array.BYTES_PER_ELEMENT,
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

function expectPositiveSafeInteger(value: unknown, subject: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1
  ) {
    throw new Error(
      `${subject} must be a positive safe integer, got '${String(value)}'.`,
    );
  }
  return value;
}
