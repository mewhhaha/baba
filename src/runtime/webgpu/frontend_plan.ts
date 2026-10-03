import type { GpuFrontendPlan } from "../../compiler/gpu_frontend.ts";
import { decodeCombinedWasmParserPlan } from "../wasm_plan.ts";
import {
  GPU_FRONTEND_FORMAT,
  GPU_FRONTEND_PLAN_VERSION,
  GPU_FRONTEND_SEMANTICS,
} from "./frontend_contract.ts";

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

export function decodeGpuFrontendPlan(planBytes: Uint8Array): GpuFrontendPlan {
  const decoded = decodeCombinedWasmParserPlan(planBytes).compactRuntimePlan;
  return decodeGpuFrontendPlanMetadata(decoded);
}

export function decodeGpuFrontendPlanMetadata(
  decoded: unknown,
): GpuFrontendPlan {
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
  const plan = decodeGpuFrontendPlanMetadata(compact);
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
