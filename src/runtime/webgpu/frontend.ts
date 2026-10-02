import type { GpuFrontendPlan } from "../../compiler/gpu_frontend.ts";
import { decodeGpuFrontendPlan } from "./frontend_plan.ts";
export {
  decodeGpuFrontendPlan,
  inspectGpuFrontendPlan,
} from "./frontend_plan.ts";
export type { GpuFrontendPlanInspection } from "./frontend_plan.ts";
import type { WebGpuLexerContext, WebGpuRuntime } from "./context.ts";
import {
  type GpuIslandExecution,
  GpuIslandExecutor,
} from "./island_executor.ts";
export { GpuFrontendCapacityError } from "./frontend_capacity.ts";
import {
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
  /** Host string-to-UTF-16 encoding before acquiring execution leases. */
  readonly uploadMs: number;
  /** Lease acquisition and the complete GPU round trip, including owned copies. */
  readonly lexMs: number;
  /** Reserved; delimiter work is included in lexMs. */
  readonly delimitersMs: number;
  /** Submit/readback subset of lexMs; these fields are not additive. */
  readonly islandsMs: number;
  readonly semanticsMs: number;
  /** Host diagnostic sorting and materialization after semantic recipes. */
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
    let runtimeLease;
    try {
      this.#islands.assertExecutionSlotAvailable(lexerLease.lexer);
      runtimeLease = await this.runtime.acquireLease();
    } catch (error) {
      lexerLease.release();
      throw error;
    }
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
    let runtimeLease;
    try {
      this.#islands.assertExecutionSlotAvailable(lexerLease.lexer);
      runtimeLease = await this.runtime.acquireLease();
    } catch (error) {
      lexerLease.release();
      throw error;
    }
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
  if (plan.semanticRecipes.some((recipe) => recipe.opcode === "define")) {
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
  }

  const primitiveNames = new Set(
    plan.primitives.map((primitive) => primitive.source),
  );
  const referencesByDefinition = new Map<number, number[]>();
  if (plan.semanticRecipes.some((recipe) => recipe.opcode === "reference")) {
    let orderedDefinitionSpans = true;
    for (let index = 1; index < definitions.length; index += 1) {
      if (definitions[index].start < definitions[index - 1].end) {
        orderedDefinitionSpans = false;
        break;
      }
    }
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
      let owner: SemanticDefinition | undefined;
      if (orderedDefinitionSpans) {
        // The first end covering the reference preserves definition-order
        // ownership, including empty spans at adjoining definition boundaries.
        let low = 0;
        let high = definitions.length;
        while (low < high) {
          const middle = low + Math.floor((high - low) / 2);
          if (definitions[middle].end < nodeEnd) {
            low = middle + 1;
          } else {
            high = middle;
          }
        }
        if (low < definitions.length && definitions[low].start <= nodeStart) {
          owner = definitions[low];
        }
      } else {
        owner = definitions.find((definition) =>
          nodeStart >= definition.start && nodeEnd <= definition.end
        );
      }
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
    // No decimal spelling below ten units can exceed the signed i32 bounds.
    if (tokenEnd - tokenStart < 10) {
      continue;
    }
    if (!isDecimalIntegerSpan(source, tokenStart, tokenEnd)) {
      continue;
    }
    let digits = tokenEnd - tokenStart;
    if (source.charCodeAt(tokenStart) === 45) {
      digits -= 1;
    }
    // Every validated decimal magnitude below ten digits fits in signed i32.
    if (digits < 10) {
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

  if (plan.semanticRecipes.some((recipe) => recipe.opcode === "repeat-limit")) {
    for (let nodeId = 0; nodeId < nodeCount; nodeId += 1) {
      const nodeOffset = nodeId * NODE_WORDS;
      const recipe = recipeByRule.get(program.nodes[nodeOffset]);
      if (recipe?.opcode !== "repeat-limit") {
        continue;
      }
      const countField = recipe.fields.find((field) =>
        field.target === "count"
      );
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
