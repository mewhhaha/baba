/**
 * Shared ownership for experimental WebGPU lexer work.
 *
 * A WebGPU device is expensive to acquire and device loss affects every
 * command submitted through it. This module makes that ownership explicit:
 * one runtime owns one device, compiled plans are cached by their exact bytes,
 * and every submission holds a bounded runtime lease.
 */

import { type AlphabetTables, buildAlphabetTables } from "./alphabet.ts";
import {
  chooseChunkLog2,
  type PackedTables,
  packTables,
} from "./kernel_wgsl.ts";
import { decodeLexerPlanTables, type LexerPlanTables } from "./plan_tables.ts";
import type {
  GpuCompactLexResult,
  GpuLexerOptions,
  GpuLexResult,
  WebGpuLexer,
  WebGpuLexerCreateOptions,
} from "./lexer.ts";

export interface WebGpuIntegratedLexerLease {
  readonly lexer: WebGpuLexer;
  release(): void;
}

/** Limits fixed when the runtime acquires its device. */
export interface WebGpuRuntimeLimits {
  readonly maxStorageBufferBindingSize: number;
  readonly maxBufferSize: number;
  readonly maxComputeWorkgroupsPerDimension: number;
  readonly maxComputeWorkgroupStorageSize: number;
  readonly maxComputeInvocationsPerWorkgroup: number;
  readonly maxStorageBuffersPerShaderStage: number;
}

/** Immutable facts about the adapter selected for this runtime. */
export interface WebGpuRuntimeCapabilities {
  readonly isFallbackAdapter: boolean;
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
  readonly hasTimestampQueries: boolean;
  readonly limits: WebGpuRuntimeLimits;
}

export interface WebGpuRuntimeCreateOptions {
  /** Prefer an adapter suited to sustained compute work. */
  readonly powerPreference?: GPUPowerPreference;
  /** Software fallback adapters are rejected unless explicitly enabled. */
  readonly allowFallbackAdapter?: boolean;
  /** Maximum command submissions in flight across every compiled plan. */
  readonly maxInFlight?: number;
  /** Maximum live compiled plans; dispose a context before compiling another. */
  readonly maxCompiledPlans?: number;
}

export interface WebGpuLexerContextOptions {
  /** See `WebGpuLexerCreateOptions.simulateWorkgroupStorageLimit`. */
  readonly simulateWorkgroupStorageLimit?: number;
}

/** A lease reserves one of the runtime's bounded concurrent submissions. */
export interface WebGpuRuntimeLease {
  readonly device: GPUDevice;
  release(): void;
}

interface RuntimeWaiter {
  resolve: (lease: WebGpuRuntimeLease) => void;
  reject: (reason: Error) => void;
}

interface WorkerWaiter {
  resolve: (worker: WebGpuLexer) => void;
  reject: (reason: Error) => void;
}

interface RuntimeFrontend {
  readonly isDisposed: boolean;
  assertDisposable(): void;
  dispose(): void;
}

/**
 * A single, explicitly-owned WebGPU device shared by one or more lexer plans.
 *
 * `dispose()` must be called after all contexts are disposed. It intentionally
 * refuses to tear down a device while work is running: destroying a buffer or
 * device underneath a mapped result turns an ordinary caller mistake into a
 * backend-dependent GPU fault.
 */
export class WebGpuRuntime {
  readonly device: GPUDevice;
  readonly capabilities: WebGpuRuntimeCapabilities;
  readonly maxInFlight: number;
  readonly maxCompiledPlans: number;

  #deviceLostReason: string | null = null;
  #disposed = false;
  #activeLeases = 0;
  #waiters: RuntimeWaiter[] = [];
  #compiledByPlan = new Map<string, Promise<WebGpuLexerContext>>();
  #contexts = new Set<WebGpuLexerContext>();
  #contextKeys = new Map<WebGpuLexerContext, string>();
  #frontends = new Set<RuntimeFrontend>();
  #compilingPlans = 0;

  private constructor(
    device: GPUDevice,
    capabilities: WebGpuRuntimeCapabilities,
    maxInFlight: number,
    maxCompiledPlans: number,
  ) {
    this.device = device;
    this.capabilities = capabilities;
    this.maxInFlight = maxInFlight;
    this.maxCompiledPlans = maxCompiledPlans;
    device.lost.then((info) => {
      this.#deviceLostReason = `${info.reason}: ${info.message}`;
      this.#rejectWaiters(
        new Error(`WebGPU device was lost: ${this.#deviceLostReason}`),
      );
    });
  }

  static async create(
    options: WebGpuRuntimeCreateOptions = {},
  ): Promise<WebGpuRuntime> {
    let maxInFlight = 1;
    if (options.maxInFlight !== undefined) {
      maxInFlight = options.maxInFlight;
    }
    if (!Number.isSafeInteger(maxInFlight) || maxInFlight < 1) {
      throw new Error(
        `WebGpuRuntime maxInFlight must be a positive safe integer; received ${maxInFlight}.`,
      );
    }

    let maxCompiledPlans = 8;
    if (options.maxCompiledPlans !== undefined) {
      maxCompiledPlans = options.maxCompiledPlans;
    }
    if (!Number.isSafeInteger(maxCompiledPlans) || maxCompiledPlans < 1) {
      throw new Error(
        `WebGpuRuntime maxCompiledPlans must be a positive safe integer; received ${maxCompiledPlans}.`,
      );
    }
    if (
      options.powerPreference !== undefined &&
      options.powerPreference !== "low-power" &&
      options.powerPreference !== "high-performance"
    ) {
      throw new Error(
        `WebGpuRuntime powerPreference must be "low-power" or "high-performance"; received ${options.powerPreference}.`,
      );
    }

    if (typeof navigator === "undefined" || navigator.gpu === undefined) {
      throw new Error(
        "This host exposes no WebGPU implementation (navigator.gpu is undefined). " +
          "Deno needs --unstable-webgpu.",
      );
    }

    const adapterOptions: GPURequestAdapterOptions = {};
    if (options.powerPreference !== undefined) {
      adapterOptions.powerPreference = options.powerPreference;
    }
    const adapter = await navigator.gpu.requestAdapter(adapterOptions);
    if (adapter === null) {
      throw new Error("No WebGPU adapter is available.");
    }

    const adapterInfo = adapter.info;
    let isFallbackAdapter = false;
    let vendor = "unavailable";
    let architecture = "unavailable";
    let adapterDevice = "unavailable";
    let description = "unavailable";
    if (adapterInfo === undefined) {
      if (options.allowFallbackAdapter !== true) {
        throw new Error(
          "WebGPU did not expose adapter fallback metadata. Set allowFallbackAdapter=true to opt in to an adapter whose hardware status cannot be verified.",
        );
      }
    } else {
      isFallbackAdapter = adapterInfo.isFallbackAdapter === true;
      vendor = adapterInfo.vendor;
      architecture = adapterInfo.architecture;
      adapterDevice = adapterInfo.device;
      description = adapterInfo.description;
      if (isFallbackAdapter && options.allowFallbackAdapter !== true) {
        throw new Error(
          `WebGPU selected the software fallback adapter "${description}" ` +
            `(vendor ${vendor}). Set allowFallbackAdapter=true to opt in explicitly.`,
        );
      }
    }

    const requiredFeatures: GPUFeatureName[] = [];
    const hasTimestampQueries = adapter.features.has("timestamp-query");
    if (hasTimestampQueries) {
      requiredFeatures.push("timestamp-query");
    }
    const device = await adapter.requestDevice({
      requiredFeatures,
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
        maxComputeWorkgroupStorageSize:
          adapter.limits.maxComputeWorkgroupStorageSize,
      },
    });
    const limits: WebGpuRuntimeLimits = {
      maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
      maxBufferSize: device.limits.maxBufferSize,
      maxComputeWorkgroupsPerDimension:
        device.limits.maxComputeWorkgroupsPerDimension,
      maxComputeWorkgroupStorageSize:
        device.limits.maxComputeWorkgroupStorageSize,
      maxComputeInvocationsPerWorkgroup:
        device.limits.maxComputeInvocationsPerWorkgroup,
      maxStorageBuffersPerShaderStage:
        device.limits.maxStorageBuffersPerShaderStage,
    };
    return new WebGpuRuntime(
      device,
      {
        isFallbackAdapter,
        vendor,
        architecture,
        device: adapterDevice,
        description,
        hasTimestampQueries,
        limits,
      },
      maxInFlight,
      maxCompiledPlans,
    );
  }

  /** The terminal device-loss reason, if this runtime can no longer run work. */
  get deviceLostReason(): string | null {
    return this.#deviceLostReason;
  }

  /** Compile and cache immutable plan data. Equivalent plan bytes share one context. */
  async compileLexer(
    planBytes: Uint8Array,
    options: WebGpuLexerContextOptions = {},
  ): Promise<WebGpuLexerContext> {
    this.#assertUsable();
    const planKey = this.#planKey(planBytes, options);
    const cached = this.#compiledByPlan.get(planKey);
    if (cached !== undefined) {
      const context = await cached;
      if (!context.isDisposed) {
        return context;
      }
      this.#compiledByPlan.delete(planKey);
      this.#contexts.delete(context);
      this.#contextKeys.delete(context);
    }

    if (
      this.#contexts.size + this.#compilingPlans >= this.maxCompiledPlans
    ) {
      throw new Error(
        `WebGpuRuntime retains ${this.maxCompiledPlans} compiled plans; dispose a context before compiling another plan.`,
      );
    }
    this.#compilingPlans += 1;
    const compilation = WebGpuLexerContext.create(this, planBytes, options);
    this.#compiledByPlan.set(planKey, compilation);
    try {
      const context = await compilation;
      this.#contexts.add(context);
      this.#contextKeys.set(context, planKey);
      return context;
    } catch (error) {
      this.#compiledByPlan.delete(planKey);
      throw error;
    } finally {
      this.#compilingPlans -= 1;
    }
  }

  /** Compile a device-resident frontend session from an opt-in parser plan. */
  async compileFrontend(
    planBytes: Uint8Array,
  ): Promise<import("./frontend.ts").WebGpuFrontend> {
    this.#assertUsable();
    const module = await import("./frontend.ts");
    return await module.WebGpuFrontend.create(this, planBytes);
  }

  /**
   * Acquire one execution slot. Contexts use this before touching mutable GPU
   * buffers, so a runtime bounds work even when callers submit in parallel.
   */
  async acquireLease(): Promise<WebGpuRuntimeLease> {
    this.#assertUsable();
    if (this.#activeLeases < this.maxInFlight) {
      this.#activeLeases += 1;
      return this.#newLease();
    }
    return await new Promise<WebGpuRuntimeLease>((resolve, reject) => {
      this.#waiters.push({ resolve, reject });
    });
  }

  /** Throw when callers hold a lexer or context after runtime shutdown. */
  assertUsable(): void {
    this.#assertUsable();
  }

  releaseContext(context: WebGpuLexerContext): void {
    const planKey = this.#contextKeys.get(context);
    this.#contexts.delete(context);
    this.#contextKeys.delete(context);
    if (planKey !== undefined) {
      this.#compiledByPlan.delete(planKey);
    }
  }

  releaseFrontend(frontend: RuntimeFrontend): void {
    this.#frontends.delete(frontend);
  }

  registerFrontend(frontend: RuntimeFrontend): void {
    this.#assertUsable();
    this.#frontends.add(frontend);
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    if (this.#activeLeases > 0) {
      throw new Error(
        `Cannot dispose WebGpuRuntime while ${this.#activeLeases} lex job(s) are in flight.`,
      );
    }
    for (const frontend of this.#frontends) {
      frontend.assertDisposable();
    }
    this.#disposed = true;
    this.#rejectWaiters(new Error("WebGpuRuntime has been disposed."));
    for (const frontend of [...this.#frontends]) {
      frontend.dispose();
    }
    this.#frontends.clear();
    for (const context of [...this.#contexts]) {
      context.dispose();
    }
    this.#contexts.clear();
    this.#contextKeys.clear();
    this.#compiledByPlan.clear();
    this.device.destroy();
  }

  #assertUsable(): void {
    if (this.#disposed) {
      throw new Error("WebGpuRuntime has been disposed.");
    }
    if (this.#deviceLostReason !== null) {
      throw new Error(`WebGPU device was lost: ${this.#deviceLostReason}`);
    }
  }

  #newLease(): WebGpuRuntimeLease {
    let released = false;
    return {
      device: this.device,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this.#releaseLease();
      },
    };
  }

  #releaseLease(): void {
    const waiter = this.#waiters.shift();
    if (waiter !== undefined) {
      if (this.#disposed) {
        waiter.reject(new Error("WebGpuRuntime has been disposed."));
        this.#releaseLease();
        return;
      }
      if (this.#deviceLostReason !== null) {
        waiter.reject(
          new Error(`WebGPU device was lost: ${this.#deviceLostReason}`),
        );
        this.#releaseLease();
        return;
      }
      waiter.resolve(this.#newLease());
      return;
    }
    this.#activeLeases -= 1;
  }

  #rejectWaiters(reason: Error): void {
    const waiters = this.#waiters;
    this.#waiters = [];
    for (const waiter of waiters) {
      waiter.reject(reason);
    }
  }

  #planKey(
    planBytes: Uint8Array,
    options: WebGpuLexerContextOptions,
  ): string {
    let key = "";
    for (let start = 0; start < planBytes.length; start += 8192) {
      const end = Math.min(start + 8192, planBytes.length);
      let part = "";
      for (let index = start; index < end; index += 1) {
        part += String.fromCharCode(planBytes[index]);
      }
      key += part;
    }
    if (options.simulateWorkgroupStorageLimit !== undefined) {
      return `${options.simulateWorkgroupStorageLimit}:${key}`;
    }
    return `device:${key}`;
  }
}

/**
 * Cached immutable plan data plus a pool of independently-buffered lexer jobs.
 *
 * The context only returns owned records. A borrowed mapped range is tied to a
 * particular staging buffer, so accepting `borrowRecords` here would require a
 * caller-visible release protocol before that worker could be safely reused.
 */
export class WebGpuLexerContext {
  readonly runtime: WebGpuRuntime;
  readonly planBytes: Uint8Array;
  readonly plan: LexerPlanTables;
  readonly alphabet: AlphabetTables;
  readonly packed: PackedTables;
  readonly chunkSize: number;

  #workers: WebGpuLexer[] = [];
  #idleWorkers: WebGpuLexer[] = [];
  #workerWaiters: WorkerWaiter[] = [];
  #activeJobs = 0;
  #creatingWorkers = 0;
  #disposed = false;
  #createOptions: WebGpuLexerCreateOptions;

  private constructor(
    runtime: WebGpuRuntime,
    planBytes: Uint8Array,
    plan: LexerPlanTables,
    alphabet: AlphabetTables,
    packed: PackedTables,
    chunkSize: number,
    createOptions: WebGpuLexerCreateOptions,
  ) {
    this.runtime = runtime;
    this.planBytes = planBytes.slice();
    this.plan = plan;
    this.alphabet = alphabet;
    this.packed = packed;
    this.chunkSize = chunkSize;
    this.#createOptions = createOptions;
  }

  static async create(
    runtime: WebGpuRuntime,
    planBytes: Uint8Array,
    options: WebGpuLexerContextOptions,
  ): Promise<WebGpuLexerContext> {
    const plan = decodeLexerPlanTables(planBytes);
    if (!plan.guardFree) {
      throw new Error(
        `This kernel only supports guard-free grammars. Plan reports: ${
          plan.guardDiagnostics.join("; ")
        }`,
      );
    }
    const alphabet = buildAlphabetTables(plan);
    const packed = packTables(plan, alphabet);
    let workgroupStorage = runtime.capabilities.limits
      .maxComputeWorkgroupStorageSize;
    if (options.simulateWorkgroupStorageLimit !== undefined) {
      const simulated = options.simulateWorkgroupStorageLimit;
      if (!Number.isSafeInteger(simulated) || simulated < 1) {
        throw new Error(
          `simulateWorkgroupStorageLimit must be a positive safe integer; received ${simulated}.`,
        );
      }
      workgroupStorage = Math.min(workgroupStorage, simulated);
    }
    const chunkSize = 1 << chooseChunkLog2(workgroupStorage);
    const context = new WebGpuLexerContext(
      runtime,
      planBytes,
      plan,
      alphabet,
      packed,
      chunkSize,
      {
        simulateWorkgroupStorageLimit: options.simulateWorkgroupStorageLimit,
      },
    );
    const worker = await context.#createWorker();
    context.#idleWorkers.push(worker);
    return context;
  }

  get isDisposed(): boolean {
    return this.#disposed;
  }

  /**
   * Execute with an independent dynamic-buffer worker. Parallel calls share the
   * immutable plan but never a staging buffer, and are bounded by the runtime.
   */
  async lex(
    units: Uint16Array,
    options: GpuLexerOptions = {},
  ): Promise<GpuLexResult> {
    if (this.#disposed) {
      throw new Error("WebGpuLexerContext has been disposed.");
    }
    if (options.borrowRecords === true) {
      throw new Error(
        "WebGpuLexerContext.lex() returns owned records and does not support borrowRecords. " +
          "Use an explicit WebGpuLexer when a mapped view is required.",
      );
    }
    let worker: WebGpuLexer | undefined;
    this.#activeJobs += 1;
    try {
      worker = await this.#takeWorker();
      return await worker.lex(units, options);
    } finally {
      this.#activeJobs -= 1;
      if (worker !== undefined) {
        this.#returnWorker(worker);
      }
    }
  }

  /** Execute with owned compact GPU pairs for an integrated frontend session. */
  async lexCompact(
    units: Uint16Array,
    options: GpuLexerOptions = {},
  ): Promise<GpuCompactLexResult> {
    if (this.#disposed) {
      throw new Error("WebGpuLexerContext has been disposed.");
    }
    if (options.borrowRecords === true) {
      throw new Error(
        "WebGpuLexerContext.lexCompact() returns owned records and does not support borrowRecords.",
      );
    }
    let worker: WebGpuLexer | undefined;
    this.#activeJobs += 1;
    try {
      worker = await this.#takeWorker();
      return await worker.lexCompact(units, options);
    } finally {
      this.#activeJobs -= 1;
      if (worker !== undefined) {
        this.#returnWorker(worker);
      }
    }
  }

  async acquireIntegratedLexer(): Promise<WebGpuIntegratedLexerLease> {
    if (this.#disposed) {
      throw new Error("WebGpuLexerContext has been disposed.");
    }
    this.#activeJobs += 1;
    let lexer: WebGpuLexer;
    try {
      lexer = await this.#takeWorker();
    } catch (error) {
      this.#activeJobs -= 1;
      throw error;
    }
    let released = false;
    return {
      lexer,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this.#activeJobs -= 1;
        this.#returnWorker(lexer);
      },
    };
  }

  async #takeWorker(): Promise<WebGpuLexer> {
    const worker = this.#idleWorkers.pop();
    if (worker !== undefined) {
      return worker;
    }
    if (
      this.#workers.length + this.#creatingWorkers < this.runtime.maxInFlight
    ) {
      this.#creatingWorkers += 1;
      try {
        return await this.#createWorker();
      } catch (error) {
        let reason: Error;
        if (error instanceof Error) {
          reason = error;
        } else {
          reason = new Error(
            `Unable to create a WebGPU lexer worker: ${String(error)}`,
          );
        }
        const waiters = this.#workerWaiters;
        this.#workerWaiters = [];
        for (const waiter of waiters) {
          waiter.reject(reason);
        }
        throw reason;
      } finally {
        this.#creatingWorkers -= 1;
      }
    }
    return await new Promise<WebGpuLexer>((resolve, reject) => {
      this.#workerWaiters.push({ resolve, reject });
    });
  }

  #returnWorker(worker: WebGpuLexer): void {
    const waiter = this.#workerWaiters.shift();
    if (waiter !== undefined) {
      waiter.resolve(worker);
      return;
    }
    this.#idleWorkers.push(worker);
  }

  async #createWorker(): Promise<WebGpuLexer> {
    const module = await import("./lexer.ts");
    const worker = await module.WebGpuLexer.create(this.planBytes, {
      ...this.#createOptions,
      runtime: this.runtime,
    });
    this.#workers.push(worker);
    return worker;
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    if (this.#activeJobs > 0) {
      throw new Error(
        `Cannot dispose WebGpuLexerContext while ${this.#activeJobs} lex job(s) are active or waiting.`,
      );
    }
    this.#disposed = true;
    for (const worker of this.#workers) {
      worker.destroy();
    }
    this.#workers = [];
    this.#idleWorkers = [];
    this.runtime.releaseContext(this);
  }
}
