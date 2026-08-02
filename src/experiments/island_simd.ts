import { decodeGpuFrontendPlan } from "../runtime/webgpu/frontend.ts";
import { islandSimdWasmBytes } from "./island_simd_wasm_bytes.ts";

const SIMD_LANES = 16;
const MAX_SIMD_STATES = 7;

export interface IslandSimdProgram {
  readonly island: number;
  readonly terminalCount: number;
  readonly stateCount: number;
  readonly startState: number;
  readonly acceptingMask: number;
  readonly transitions: Uint8Array;
  readonly parserPlan: Uint8Array;
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
  readonly validate_lr: (
    tokens: number,
    tokenCount: number,
    plan: number,
    planLength: number,
    stack: number,
    stackCapacity: number,
    maxActions: number,
  ) => number;
}

export function compileIslandSimdProgram(
  planBytes: Uint8Array,
  islandId: number,
): IslandSimdProgram {
  const plan = decodeGpuFrontendPlan(planBytes);
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
      `GPU frontend island ${islandId} has ${stateCount} states; the SIMD experiment requires 1..${MAX_SIMD_STATES}.`,
    );
  }
  if (island.startState < 0 || island.startState >= stateCount) {
    throw new Error(
      `GPU frontend island ${islandId} has invalid start state ${island.startState}.`,
    );
  }
  if (island.startState !== 0) {
    throw new Error(
      `GPU frontend island ${islandId} starts at state ${island.startState}; the SIMD experiment requires state 0.`,
    );
  }

  const terminalCount = plan.execution.denseTransitions.terminalSymbols;
  if (terminalCount <= 0 || terminalCount > 0xffff) {
    throw new Error(
      `GPU frontend plan has ${terminalCount} terminal symbols; the SIMD experiment requires 1..65535.`,
    );
  }
  const transitions = new Uint8Array(terminalCount * SIMD_LANES);
  transitions.fill(stateCount);
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
      transitions[transition.input * SIMD_LANES + state.id] = transition.target;
    }
  }

  return {
    island: islandId,
    terminalCount,
    stateCount,
    startState: island.startState,
    acceptingMask,
    transitions,
    parserPlan: planBytes,
  };
}

export class IslandSimdRunner {
  readonly #program: IslandSimdProgram;
  readonly #exports: IslandSimdExports;
  readonly #transitionsAddress: number;
  readonly #parserPlanAddress: number;
  readonly #tokensAddress: number;
  readonly #stackAddress: number;
  readonly #stackCapacity: number;
  readonly #tokenCount: number;

  private constructor(
    program: IslandSimdProgram,
    exports: IslandSimdExports,
    transitionsAddress: number,
    parserPlanAddress: number,
    tokensAddress: number,
    stackAddress: number,
    stackCapacity: number,
    tokenCount: number,
  ) {
    this.#program = program;
    this.#exports = exports;
    this.#transitionsAddress = transitionsAddress;
    this.#parserPlanAddress = parserPlanAddress;
    this.#tokensAddress = tokensAddress;
    this.#stackAddress = stackAddress;
    this.#stackCapacity = stackCapacity;
    this.#tokenCount = tokenCount;
  }

  static async create(
    program: IslandSimdProgram,
    tokens: Uint16Array,
  ): Promise<IslandSimdRunner> {
    const wasmBytes = islandSimdWasmBytes();
    const module = await WebAssembly.compile(wasmBytes.buffer as ArrayBuffer);
    const instance = await WebAssembly.instantiate(module);
    const exports = instance.exports as IslandSimdExports;
    const transitionsAddress = Math.ceil(
      exports.buffer_base() / SIMD_LANES,
    ) * SIMD_LANES;
    const parserPlanAddress = Math.ceil(
      (transitionsAddress + program.transitions.byteLength) /
        Int32Array.BYTES_PER_ELEMENT,
    ) * Int32Array.BYTES_PER_ELEMENT;
    const tokensAddress = Math.ceil(
      (parserPlanAddress + program.parserPlan.byteLength) /
        Uint16Array.BYTES_PER_ELEMENT,
    ) * Uint16Array.BYTES_PER_ELEMENT;
    const stackAddress = Math.ceil(
      (tokensAddress + tokens.byteLength) / Int32Array.BYTES_PER_ELEMENT,
    ) * Int32Array.BYTES_PER_ELEMENT;
    const stackCapacity = tokens.length + 16;
    const requiredBytes = stackAddress +
      stackCapacity * Int32Array.BYTES_PER_ELEMENT;
    if (requiredBytes > exports.memory.buffer.byteLength) {
      const missingBytes = requiredBytes - exports.memory.buffer.byteLength;
      exports.memory.grow(Math.ceil(missingBytes / 65_536));
    }
    const memory = new Uint8Array(exports.memory.buffer);
    memory.set(program.transitions, transitionsAddress);
    memory.set(program.parserPlan, parserPlanAddress);
    memory.set(
      new Uint8Array(tokens.buffer, tokens.byteOffset, tokens.byteLength),
      tokensAddress,
    );
    return new IslandSimdRunner(
      program,
      exports,
      transitionsAddress,
      parserPlanAddress,
      tokensAddress,
      stackAddress,
      stackCapacity,
      tokens.length,
    );
  }

  validateScalar(): boolean {
    return this.#validate(this.#exports.validate_island_scalar);
  }

  validateSimd(): boolean {
    return this.#validate(this.#exports.validate_island_simd);
  }

  validateLr(): boolean {
    const result = this.#exports.validate_lr(
      this.#tokensAddress,
      this.#tokenCount,
      this.#parserPlanAddress,
      this.#program.parserPlan.byteLength,
      this.#stackAddress,
      this.#stackCapacity,
      this.#tokenCount * 8 + 64,
    );
    if (result < 0) {
      throw new Error(`Rust LR validator failed with status ${result}.`);
    }
    return result === 1;
  }

  #validate(validate: IslandSimdExports["validate_island_scalar"]): boolean {
    const result = validate(
      this.#tokensAddress,
      this.#tokenCount,
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
