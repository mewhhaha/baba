import type { GpuFrontendPlan } from "../compiler/gpu_frontend.ts";
import { decodeGpuFrontendPlan } from "./webgpu/frontend.ts";
import { islandParserWasmBytes } from "./island_parser_wasm_bytes.ts";

const SIMD_LANES = 16;
const MAX_SIMD_STATES = 7;
let compiledIslandParserModule: Promise<WebAssembly.Module> | undefined;
let synchronousIslandParserModule: WebAssembly.Module | undefined;

export interface IslandSimdProgram {
  readonly island: number;
  readonly terminalCount: number;
  readonly stateCount: number;
  readonly startState: number;
  readonly acceptingMask: number;
  readonly transitions: Uint8Array;
  readonly transitionFields: Int32Array;
}

export interface StrictIslandParserProgram {
  readonly validation: IslandSimdProgram;
  readonly terminalBySpec: Int32Array;
  readonly rootIsland: number;
  readonly rootRuleId: number;
  readonly rootRuleName: string;
  readonly rootAcceptsEmpty: boolean;
  readonly regionIsland: number;
  readonly regionRuleId: number;
  readonly regionRuleName: string;
  readonly boundaryTerminal: number;
  readonly rootField: number;
}

interface IslandSimdExports extends WebAssembly.Exports {
  readonly memory: WebAssembly.Memory;
  readonly buffer_base: () => number;
  readonly validate_island_scalar: (
    tokens: number,
    tokenCount: number,
    transitions: number,
    terminalCount: number,
    stateCount: number,
    startState: number,
    acceptingMask: number,
  ) => number;
  readonly validate_island_simd: (
    tokens: number,
    tokenCount: number,
    transitions: number,
    terminalCount: number,
    stateCount: number,
    startState: number,
    acceptingMask: number,
  ) => number;
}

export function compileIslandSimdProgram(
  planBytes: Uint8Array,
  islandId: number,
): IslandSimdProgram {
  const plan = decodeGpuFrontendPlan(planBytes);
  return compileIslandProgram(plan, islandId);
}

export function compileStrictIslandParserProgram(
  planBytes: Uint8Array,
): StrictIslandParserProgram {
  const plan = decodeGpuFrontendPlan(planBytes);
  if (plan.throughput !== "strict") {
    throw new Error(
      `Production island parsing requires throughput 'strict', received '${plan.throughput}'.`,
    );
  }
  const rootLoop = plan.execution.rootLoop;
  if (rootLoop === null) {
    throw new Error(
      "Production island parsing requires one compiler-proven repeated root island.",
    );
  }
  const root = plan.islands[plan.rootIsland];
  if (root === undefined) {
    throw new Error(
      `GPU frontend root island ${plan.rootIsland} does not exist.`,
    );
  }
  const region = plan.islands[rootLoop.island];
  if (region === undefined) {
    throw new Error(
      `GPU frontend root loop island ${rootLoop.island} does not exist.`,
    );
  }
  const boundary = plan.boundaries[rootLoop.island];
  if (boundary === undefined || boundary.kind !== "terminated") {
    let boundaryKind = "missing";
    if (boundary !== undefined) {
      boundaryKind = boundary.kind;
    }
    throw new Error(
      `Production island parsing requires a terminated region boundary, received '${boundaryKind}' for island ${rootLoop.island}.`,
    );
  }
  const rootState = root.states[rootLoop.state];
  if (rootState === undefined) {
    throw new Error(
      `GPU frontend root island ${root.id} has no loop state ${rootLoop.state}.`,
    );
  }
  const rootTransition = rootState.transitions.find((transition) =>
    transition.inputKind === "island" && transition.input === region.id
  );
  if (rootTransition === undefined) {
    throw new Error(
      `GPU frontend root loop state ${rootLoop.state} has no transition for island ${region.id}.`,
    );
  }
  if (rootTransition.emit.kind !== "placeholder") {
    throw new Error(
      `GPU frontend root loop transition for island ${region.id} emits '${rootTransition.emit.kind}', expected 'placeholder'.`,
    );
  }
  let rootField = rootTransition.emit.field;
  for (const state of root.states) {
    for (const transition of state.transitions) {
      if (
        transition.inputKind !== "island" || transition.input !== region.id ||
        transition.emit.kind !== "placeholder" || transition.emit.field < 0
      ) {
        continue;
      }
      if (rootField >= 0 && rootField !== transition.emit.field) {
        throw new Error(
          `GPU frontend root island ${root.id} emits repeated island ${region.id} into fields ${rootField} and ${transition.emit.field}.`,
        );
      }
      rootField = transition.emit.field;
    }
  }
  const rootStartState = root.states[root.startState];
  if (rootStartState === undefined) {
    throw new Error(
      `GPU frontend root island ${root.id} has no start state ${root.startState}.`,
    );
  }

  return {
    validation: compileIslandProgram(plan, region.id),
    terminalBySpec: Int32Array.from(plan.terminalClassification),
    rootIsland: root.id,
    rootRuleId: root.ruleId,
    rootRuleName: root.ruleName,
    rootAcceptsEmpty: rootStartState.accepting,
    regionIsland: region.id,
    regionRuleId: region.ruleId,
    regionRuleName: region.ruleName,
    boundaryTerminal: boundary.terminal,
    rootField,
  };
}

function compileIslandProgram(
  plan: GpuFrontendPlan,
  islandId: number,
): IslandSimdProgram {
  const island = plan.islands[islandId];
  if (island === undefined) {
    throw new Error(`GPU frontend island ${islandId} does not exist.`);
  }
  const longRegion = plan.execution.longRegions.find((region) =>
    region.island === islandId
  );
  if (longRegion === undefined) {
    throw new Error(
      `GPU frontend island ${islandId} is not a terminal-only long region.`,
    );
  }
  const stateCount = island.states.length;
  if (stateCount !== longRegion.stateCount) {
    throw new Error(
      `GPU frontend island ${islandId} has ${stateCount} states, but its long-region entry declares ${longRegion.stateCount}.`,
    );
  }
  if (stateCount === 0 || stateCount > MAX_SIMD_STATES) {
    throw new Error(
      `GPU frontend island ${islandId} has ${stateCount} states; the SIMD parser supports 1..${MAX_SIMD_STATES}.`,
    );
  }
  if (island.startState < 0 || island.startState >= stateCount) {
    throw new Error(
      `GPU frontend island ${islandId} has invalid start state ${island.startState}.`,
    );
  }
  if (island.startState !== 0) {
    throw new Error(
      `GPU frontend island ${islandId} starts at state ${island.startState}; the SIMD parser requires state 0.`,
    );
  }

  const terminalCount = plan.execution.denseTransitions.terminalSymbols;
  if (terminalCount <= 0 || terminalCount > 0xffff) {
    throw new Error(
      `GPU frontend plan has ${terminalCount} terminal symbols; the SIMD parser supports 1..65535.`,
    );
  }
  const transitions = new Uint8Array(terminalCount * SIMD_LANES);
  transitions.fill(stateCount);
  const transitionFields = new Int32Array(terminalCount * SIMD_LANES);
  transitionFields.fill(-1);
  const occupied = new Uint8Array(terminalCount * stateCount);
  let acceptingMask = 0;

  for (let stateIndex = 0; stateIndex < stateCount; stateIndex += 1) {
    const state = island.states[stateIndex];
    if (state.id !== stateIndex) {
      throw new Error(
        `GPU frontend island ${islandId} state ${stateIndex} has non-dense id ${state.id}.`,
      );
    }
    if (state.accepting) {
      acceptingMask |= 1 << state.id;
    }
    for (const transition of state.transitions) {
      if (transition.inputKind !== "terminal") {
        throw new Error(
          `GPU frontend island ${islandId} state ${state.id} contains an island placeholder transition.`,
        );
      }
      if (transition.input < 0 || transition.input >= terminalCount) {
        throw new Error(
          `GPU frontend island ${islandId} state ${state.id} uses invalid terminal ${transition.input}.`,
        );
      }
      if (transition.target < 0 || transition.target >= stateCount) {
        throw new Error(
          `GPU frontend island ${islandId} state ${state.id} targets invalid state ${transition.target}.`,
        );
      }
      const occupiedIndex = transition.input * stateCount + state.id;
      if (occupied[occupiedIndex] !== 0) {
        throw new Error(
          `GPU frontend island ${islandId} state ${state.id} has duplicate terminal ${transition.input}.`,
        );
      }
      occupied[occupiedIndex] = 1;
      const transitionIndex = transition.input * SIMD_LANES + state.id;
      transitions[transitionIndex] = transition.target;
      transitionFields[transitionIndex] = transition.emit.field;
    }
  }

  return {
    island: islandId,
    terminalCount,
    stateCount,
    startState: island.startState,
    acceptingMask,
    transitions,
    transitionFields,
  };
}

export class IslandValidationSession {
  readonly #program: IslandSimdProgram;
  readonly #exports: IslandSimdExports;
  readonly #transitionsAddress: number;
  readonly #tokensAddress: number;
  readonly #tokenCount: number;

  private constructor(
    program: IslandSimdProgram,
    exports: IslandSimdExports,
    transitionsAddress: number,
    tokensAddress: number,
    tokenCount: number,
  ) {
    this.#program = program;
    this.#exports = exports;
    this.#transitionsAddress = transitionsAddress;
    this.#tokensAddress = tokensAddress;
    this.#tokenCount = tokenCount;
  }

  static async create(
    program: IslandSimdProgram,
    tokens: Uint16Array,
  ): Promise<IslandValidationSession> {
    if (compiledIslandParserModule === undefined) {
      const wasmBytes = islandParserWasmBytes();
      compiledIslandParserModule = WebAssembly.compile(
        wasmBytes.buffer as ArrayBuffer,
      );
    }
    const module = await compiledIslandParserModule;
    return IslandValidationSession.#createWithModule(program, tokens, module);
  }

  static createSync(
    program: IslandSimdProgram,
    tokens: Uint16Array,
  ): IslandValidationSession {
    if (synchronousIslandParserModule === undefined) {
      const wasmBytes = islandParserWasmBytes();
      synchronousIslandParserModule = new WebAssembly.Module(
        wasmBytes.buffer as ArrayBuffer,
      );
    }
    return IslandValidationSession.#createWithModule(
      program,
      tokens,
      synchronousIslandParserModule,
    );
  }

  static #createWithModule(
    program: IslandSimdProgram,
    tokens: Uint16Array,
    module: WebAssembly.Module,
  ): IslandValidationSession {
    const instance = new WebAssembly.Instance(module);
    const exports = instance.exports as IslandSimdExports;
    const transitionsAddress = Math.ceil(
      exports.buffer_base() / SIMD_LANES,
    ) * SIMD_LANES;
    const tokensAddress = Math.ceil(
      (transitionsAddress + program.transitions.byteLength) /
        Uint16Array.BYTES_PER_ELEMENT,
    ) * Uint16Array.BYTES_PER_ELEMENT;
    const requiredBytes = tokensAddress + tokens.byteLength;
    if (requiredBytes > exports.memory.buffer.byteLength) {
      const missingBytes = requiredBytes - exports.memory.buffer.byteLength;
      exports.memory.grow(Math.ceil(missingBytes / 65_536));
    }
    const memory = new Uint8Array(exports.memory.buffer);
    memory.set(program.transitions, transitionsAddress);
    memory.set(
      new Uint8Array(tokens.buffer, tokens.byteOffset, tokens.byteLength),
      tokensAddress,
    );
    return new IslandValidationSession(
      program,
      exports,
      transitionsAddress,
      tokensAddress,
      tokens.length,
    );
  }

  validateScalar(): boolean {
    return this.#validate(this.#exports.validate_island_scalar);
  }

  validateSimd(): boolean {
    return this.#validate(this.#exports.validate_island_simd);
  }

  validateScalarRange(start: number, count: number): boolean {
    return this.#validateRange(
      this.#exports.validate_island_scalar,
      start,
      count,
    );
  }

  validateSimdRange(start: number, count: number): boolean {
    return this.#validateRange(
      this.#exports.validate_island_simd,
      start,
      count,
    );
  }

  #validate(validate: IslandSimdExports["validate_island_scalar"]): boolean {
    return this.#validateRange(validate, 0, this.#tokenCount);
  }

  #validateRange(
    validate: IslandSimdExports["validate_island_scalar"],
    start: number,
    count: number,
  ): boolean {
    if (!Number.isSafeInteger(start) || start < 0) {
      throw new Error(`Island validation start ${start} must be non-negative.`);
    }
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Island validation count ${count} must be non-negative.`);
    }
    if (start + count > this.#tokenCount) {
      throw new Error(
        `Island validation range [${start}, ${
          start + count
        }) exceeds ${this.#tokenCount} tokens.`,
      );
    }
    const result = validate(
      this.#tokensAddress + start * Uint16Array.BYTES_PER_ELEMENT,
      count,
      this.#transitionsAddress,
      this.#program.terminalCount,
      this.#program.stateCount,
      this.#program.startState,
      this.#program.acceptingMask,
    );
    if (result < 0) {
      throw new Error(`Rust island validator failed with status ${result}.`);
    }
    return result === 1;
  }
}
