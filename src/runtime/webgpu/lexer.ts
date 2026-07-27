/**
 * WebGPU execution backend for `lex_all`.
 *
 * Consumes an existing `parser.plan`. Produces the identical 4 x i32 token
 * records in the identical order. One `queue.submit()` and one `mapAsync()` per
 * lex - Deno's WebGPU pays a fixed ~11 ms per host<->device synchronization, so
 * anything with a CPU in the loop is pointless.
 */

import { decodeLexerPlanTables, type LexerPlanTables } from "./plan_tables.ts";
import { type AlphabetTables, buildAlphabetTables } from "./alphabet.ts";
import {
  AUX_HEADER_U32,
  buildKernelSource,
  chooseChunkLog2,
  MAX_WORKGROUP_INVOCATIONS,
  type PackedTables,
  packTables,
  PASS_Z_WORKGROUP,
  passXWorkgroup,
  SCAN_WORKGROUP,
  SEG_SIZE,
  SEG_SUMMARY_U32_PER_STATE,
  STORAGE_BINDING_COUNT,
} from "./kernel_wgsl.ts";

interface KernelStage {
  /** Reporting name; the key used in `GpuLexTimings.stagesMs`. */
  readonly label: string;
  /** WGSL entry point in the generated kernel source. */
  readonly entryPoint: string;
}

/**
 * The dispatch order, one entry per `@compute` entry point.
 *
 * The entry point is written out rather than derived from the label by a regex.
 * A regex that fails to match returns the subject unchanged, so a renamed label
 * would silently ask the device for a pipeline named after the label and surface
 * as a pipeline-creation failure instead of a wrong-table error here.
 */
const STAGES: readonly KernelStage[] = [
  { label: "pass_x_sweep", entryPoint: "pass_x" },
  { label: "pass_y_segscan", entryPoint: "pass_y" },
  { label: "pass_z_finalize", entryPoint: "pass_z" },
  { label: "pass_b_double", entryPoint: "pass_b" },
  { label: "pass_c_entries", entryPoint: "pass_c" },
  { label: "pass_d_counts", entryPoint: "pass_d" },
  { label: "pass_e1_blockscan", entryPoint: "pass_e1" },
  { label: "pass_e2_blockoffsets", entryPoint: "pass_e2" },
  { label: "pass_f_emit", entryPoint: "pass_f" },
];

const TIMESTAMP_COUNT = STAGES.length * 2;
const STAGING_META_BYTES = 16;
const STAGING_TIMESTAMP_BYTES = TIMESTAMP_COUNT * 8;
const STAGING_RECORDS_OFFSET = STAGING_META_BYTES + STAGING_TIMESTAMP_BYTES;

export interface GpuLexTimings {
  /** Wall time for uploading the UTF-16 source and the uniform params. */
  readonly uploadMs: number;
  /** Wall time for encoding all dispatches. */
  readonly encodeMs: number;
  /** Wall time from submit() to the mapAsync() promise resolving. */
  readonly submitAndSyncMs: number;
  /**
   * Wall time inside `getMappedRange` for the record region. In Deno this is a
   * real memcpy out of write-combined host-visible memory into a JS
   * ArrayBuffer, measured at ~1.4 GiB/s. It is an implementation cost of Deno's
   * WebGPU, not of the algorithm.
   */
  readonly mapRangeMs: number;
  /** Wall time for the extra copy into an owned Int32Array (0 when borrowing). */
  readonly copyOutMs: number;
  /** mapRangeMs + copyOutMs + header decode. */
  readonly readbackMs: number;
  readonly totalMs: number;
  /** Per-stage GPU time in ms from timestamp queries, or null when unavailable. */
  readonly stagesMs: Readonly<Record<string, number>> | null;
  /** Sum of the per-stage GPU times, or null. */
  readonly gpuStagesTotalMs: number | null;
}

export interface GpuLexResult {
  readonly records: Int32Array;
  readonly tokenCount: number;
  readonly overflow: boolean;
  readonly timings: GpuLexTimings;
}

/**
 * One-time cost of standing the backend up, in ms. Reported because it is real:
 * on the measured stack it is ~200 ms, dominated by `requestAdapter` /
 * `requestDevice`, against ~0.5 ms for the Wasm engine's equivalent. Any
 * cost/benefit claim has to amortize it.
 */
export interface GpuSetupTimings {
  readonly decodePlanMs: number;
  readonly buildAlphabetMs: number;
  readonly packTablesMs: number;
  readonly requestAdapterMs: number;
  readonly requestDeviceMs: number;
  readonly buildKernelSourceMs: number;
  readonly createShaderModuleMs: number;
  readonly createPipelinesMs: number;
  readonly createBuffersMs: number;
  readonly totalMs: number;
}

/** The device limits this backend actually depends on. */
export interface GpuLexerLimits {
  readonly maxStorageBufferBindingSize: number;
  readonly maxBufferSize: number;
  readonly maxComputeWorkgroupsPerDimension: number;
  readonly maxComputeWorkgroupStorageSize: number;
  readonly maxComputeInvocationsPerWorkgroup: number;
  readonly maxStorageBuffersPerShaderStage: number;
}

export interface WebGpuLexerCreateOptions {
  /** Software fallback adapters are rejected unless explicitly enabled. */
  readonly allowFallbackAdapter?: boolean;
  /**
   * Test hook: pretend `maxComputeWorkgroupStorageSize` is this small. The
   * WebGPU-guaranteed floor is 16384 B, which is half of what a 4096-unit
   * `pass_b` chunk needs, so `chooseChunkLog2` must fall back to a smaller
   * chunk. wgpu does not validate workgroup storage at pipeline creation - it
   * happily accepted a 256 KiB array on a 16 KiB device - so that fallback is
   * unreachable on this stack without this hook, and would ship untested.
   */
  readonly simulateWorkgroupStorageLimit?: number;
}

/** Thrown when an input, or the device, cannot support a correct single-submit lex. */
export class GpuLexerCapacityError extends Error {
  readonly limitName: string;
  readonly required: number;
  readonly available: number;

  constructor(
    limitName: string,
    required: number,
    available: number,
    detail: string,
  ) {
    super(
      `${detail} (needs ${required}, device ${limitName} is ${available})`,
    );
    this.name = "GpuLexerCapacityError";
    this.limitName = limitName;
    this.required = required;
    this.available = available;
  }
}

export interface GpuLexerOptions {
  /**
   * Records the output buffer is sized for. The worst case is one token per
   * UTF-16 code unit; anything smaller trades a guaranteed single pass for a
   * smaller readback. Overflow is always detected and reported, never silent.
   */
  readonly capacityRecords?: number;
  /**
   * Return the records as a view straight into the mapped staging range instead
   * of copying them into an owned Int32Array. The view stays valid until the
   * next `lex()` call or `destroy()`. This is what a real backend integration
   * would do; the copying default is the safe one and is what the parity gate
   * in `tests/webgpu_lexer_parity_test.ts` uses.
   */
  readonly borrowRecords?: boolean;
  /**
   * Test hook: pretend `maxComputeWorkgroupsPerDimension` is this small. Every
   * pass is a grid-stride loop so that a real over-limit input can never produce
   * an invalid dispatch, but on a device that reports 65535 no realistic input
   * reaches that grid size, so the stride path would otherwise never execute.
   * The parity gate uses this to run the whole corpus through it.
   */
  readonly debugMaxWorkgroupsPerDimension?: number;
}

interface SizedBuffer {
  buffer: GPUBuffer;
  size: number;
}

interface DeviceLostBox {
  reason: string | null;
}

export class WebGpuLexer {
  readonly device: GPUDevice;
  readonly plan: LexerPlanTables;
  readonly alphabet: AlphabetTables;
  readonly packed: PackedTables;
  readonly hasTimestamps: boolean;
  readonly limits: GpuLexerLimits;
  /** Chunk size chosen for this device from its workgroup-storage limit. */
  readonly chunkSize: number;
  readonly setupTimings: GpuSetupTimings;

  readonly #pipelines: Map<string, GPUComputePipeline>;
  readonly #layout: GPUBindGroupLayout;
  readonly #tablesBuffer: GPUBuffer;
  readonly #paramsBuffer: GPUBuffer;
  readonly #querySet: GPUQuerySet | null;
  readonly #resolveBuffer: GPUBuffer | null;
  readonly #deviceLost: DeviceLostBox;

  #src: SizedBuffer | null = null;
  #nextPos: SizedBuffer | null = null;
  #packedRec: SizedBuffer | null = null;
  #exitPos: SizedBuffer | null = null;
  #aux: SizedBuffer | null = null;
  #records: SizedBuffer | null = null;
  #staging: SizedBuffer | null = null;
  #bindGroup: GPUBindGroup | null = null;
  #bindGroupKey = "";
  /**
   * Bumped whenever any bound buffer object is replaced. The bind-group cache
   * key includes it, so a cached bind group can never outlive the buffers it
   * points at (sizes alone are not enough: `destroy()` followed by a re-lex of
   * the same input reproduces identical sizes).
   */
  #bufferGeneration = 0;
  #pendingUnmap = false;
  #lexInFlight = false;
  #destroyed = false;

  private constructor(
    device: GPUDevice,
    plan: LexerPlanTables,
    alphabet: AlphabetTables,
    packed: PackedTables,
    pipelines: Map<string, GPUComputePipeline>,
    layout: GPUBindGroupLayout,
    tablesBuffer: GPUBuffer,
    paramsBuffer: GPUBuffer,
    querySet: GPUQuerySet | null,
    resolveBuffer: GPUBuffer | null,
    limits: GpuLexerLimits,
    chunkSize: number,
    setupTimings: GpuSetupTimings,
    deviceLost: DeviceLostBox,
  ) {
    this.device = device;
    this.plan = plan;
    this.alphabet = alphabet;
    this.packed = packed;
    this.#pipelines = pipelines;
    this.#layout = layout;
    this.#tablesBuffer = tablesBuffer;
    this.#paramsBuffer = paramsBuffer;
    this.#querySet = querySet;
    this.#resolveBuffer = resolveBuffer;
    this.hasTimestamps = querySet !== null;
    this.limits = limits;
    this.chunkSize = chunkSize;
    this.setupTimings = setupTimings;
    this.#deviceLost = deviceLost;
  }

  static async create(
    planBytes: Uint8Array,
    options: WebGpuLexerCreateOptions = {},
  ): Promise<WebGpuLexer> {
    const setupStart = performance.now();
    const decodeStart = performance.now();
    const plan = decodeLexerPlanTables(planBytes);
    const decodeEnd = performance.now();
    if (!plan.guardFree) {
      throw new Error(
        `This kernel only supports guard-free grammars. Plan reports: ${
          plan.guardDiagnostics.join("; ")
        }`,
      );
    }
    const alphabet = buildAlphabetTables(plan);
    const alphabetEnd = performance.now();
    const packed = packTables(plan, alphabet);
    const packEnd = performance.now();

    // `navigator.gpu` is absent entirely on hosts without WebGPU (a Deno without
    // --unstable-webgpu, an older runtime, a browser that does not implement
    // it). Reading `.requestAdapter` off `undefined` would be a bare TypeError,
    // which tells a caller nothing about what to do next.
    if (navigator.gpu === undefined) {
      throw new Error(
        "This host exposes no WebGPU implementation (navigator.gpu is undefined). " +
          "Deno needs --unstable-webgpu.",
      );
    }
    const adapterStart = performance.now();
    const adapter = await navigator.gpu.requestAdapter();
    const adapterEnd = performance.now();
    if (adapter === null) {
      throw new Error("No WebGPU adapter is available.");
    }
    const adapterInfo = adapter.info;
    if (
      adapterInfo.isFallbackAdapter === true &&
      options.allowFallbackAdapter !== true
    ) {
      throw new Error(
        `WebGPU selected the software fallback adapter "${adapterInfo.description}" ` +
          `(vendor ${adapterInfo.vendor}). Set allowFallbackAdapter=true to opt in explicitly.`,
      );
    }
    const wantsTimestamps = adapter.features.has("timestamp-query");
    const requiredFeatures: GPUFeatureName[] = [];
    if (wantsTimestamps) {
      requiredFeatures.push("timestamp-query");
    }
    const deviceStart = performance.now();
    const device = await adapter.requestDevice({
      requiredFeatures,
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
        maxComputeWorkgroupStorageSize:
          adapter.limits.maxComputeWorkgroupStorageSize,
      },
    });
    const deviceEnd = performance.now();
    const deviceLost: DeviceLostBox = { reason: null };
    device.lost.then((info) => {
      deviceLost.reason = `${info.reason}: ${info.message}`;
    });
    device.addEventListener("uncapturederror", (event) => {
      console.error(
        "WebGPU uncaptured error:",
        (event as GPUUncapturedErrorEvent).error,
      );
    });

    // Limits are read off the DEVICE, not the adapter: requestDevice grants at
    // most what was asked for, and asking for the adapter maximum tells you
    // nothing about whether the adapter offered more than the spec floor.
    let workgroupStorage = device.limits.maxComputeWorkgroupStorageSize;
    if (options.simulateWorkgroupStorageLimit !== undefined) {
      workgroupStorage = Math.min(
        workgroupStorage,
        options.simulateWorkgroupStorageLimit,
      );
    }
    const limits: GpuLexerLimits = {
      maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
      maxBufferSize: device.limits.maxBufferSize,
      maxComputeWorkgroupsPerDimension:
        device.limits.maxComputeWorkgroupsPerDimension,
      maxComputeWorkgroupStorageSize: workgroupStorage,
      maxComputeInvocationsPerWorkgroup:
        device.limits.maxComputeInvocationsPerWorkgroup,
      maxStorageBuffersPerShaderStage:
        device.limits.maxStorageBuffersPerShaderStage,
    };
    if (limits.maxStorageBuffersPerShaderStage < STORAGE_BINDING_COUNT) {
      throw new GpuLexerCapacityError(
        "maxStorageBuffersPerShaderStage",
        STORAGE_BINDING_COUNT,
        limits.maxStorageBuffersPerShaderStage,
        "The single bind group declares 2 read-only-storage and 5 storage buffers",
      );
    }
    // pass_x/pass_y declare one invocation per DFA state (rounded up to 32 and
    // capped at MAX_WORKGROUP_INVOCATIONS), so the required invocation count is
    // grammar-dependent and has to be recomputed rather than assumed to be 256.
    const passXInvocations = passXWorkgroup(plan.stateCount);
    const requiredInvocations = Math.max(
      MAX_WORKGROUP_INVOCATIONS,
      passXInvocations,
    );
    if (limits.maxComputeInvocationsPerWorkgroup < requiredInvocations) {
      throw new GpuLexerCapacityError(
        "maxComputeInvocationsPerWorkgroup",
        requiredInvocations,
        limits.maxComputeInvocationsPerWorkgroup,
        `pass_b/pass_d/pass_e1/pass_f declare @workgroup_size(${MAX_WORKGROUP_INVOCATIONS}) ` +
          `and pass_x/pass_y declare @workgroup_size(${passXInvocations}) for ${plan.stateCount} DFA states`,
      );
    }
    // wgpu does NOT validate workgroup storage at createComputePipeline (a
    // 256 KiB array is accepted on a 16 KiB device), so the chunk size is chosen
    // against the reported limit here rather than discovered at pipeline
    // creation. Dawn does enforce it, and on the WebGPU-guaranteed floor of
    // 16384 B the previously hard-coded 4096-unit chunk was 2x over.
    const chunkLog2 = chooseChunkLog2(limits.maxComputeWorkgroupStorageSize);
    const chunkSize = 1 << chunkLog2;

    const buildStart = performance.now();
    const source = buildKernelSource(
      packed,
      chunkLog2,
      limits.maxComputeWorkgroupStorageSize,
    );
    const buildEnd = performance.now();
    device.pushErrorScope("validation");
    const module = device.createShaderModule({
      code: source,
      label: "baba-lexer",
    });
    const compilationInfo = await module.getCompilationInfo();
    const errors = compilationInfo.messages.filter((m) => m.type === "error");
    if (errors.length > 0) {
      const detail = errors
        .map((m) => `line ${m.lineNum}:${m.linePos}: ${m.message}`)
        .join("\n");
      throw new Error(`WGSL compilation failed:\n${detail}`);
    }
    const scopeError = await device.popErrorScope();
    if (scopeError !== null) {
      throw new Error(`WGSL module creation failed: ${scopeError.message}`);
    }
    const shaderEnd = performance.now();

    const entries: GPUBindGroupLayoutEntry[] = [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "uniform" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
      {
        binding: 4,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
      {
        binding: 5,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
      {
        binding: 6,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
      {
        binding: 7,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" },
      },
    ];
    device.pushErrorScope("validation");
    const layout = device.createBindGroupLayout({ entries });
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [layout],
    });

    const pipelines = new Map<string, GPUComputePipeline>();
    for (const stage of STAGES) {
      pipelines.set(
        stage.label,
        device.createComputePipeline({
          layout: pipelineLayout,
          compute: { module, entryPoint: stage.entryPoint },
          label: stage.label,
        }),
      );
    }
    const pipelineError = await device.popErrorScope();
    if (pipelineError !== null) {
      throw new Error(
        `Compute pipeline creation failed: ${pipelineError.message}`,
      );
    }
    const pipelinesEnd = performance.now();

    device.pushErrorScope("validation");
    device.pushErrorScope("out-of-memory");
    const tablesBuffer = device.createBuffer({
      size: Math.max(4, packed.words.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: "tables",
    });
    device.queue.writeBuffer(
      tablesBuffer,
      0,
      packed.words.buffer as ArrayBuffer,
      packed.words.byteOffset,
      packed.words.byteLength,
    );

    // 13 u32 of Params, rounded up to the 16-byte struct alignment.
    const paramsBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: "params",
    });

    let querySet: GPUQuerySet | null = null;
    let resolveBuffer: GPUBuffer | null = null;
    if (wantsTimestamps) {
      querySet = device.createQuerySet({
        type: "timestamp",
        count: TIMESTAMP_COUNT,
      });
      resolveBuffer = device.createBuffer({
        size: STAGING_TIMESTAMP_BYTES,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        label: "timestamps",
      });
    }
    const setupOom = await device.popErrorScope();
    if (setupOom !== null) {
      throw new Error(`Setup allocation failed: ${setupOom.message}`);
    }
    const setupValidation = await device.popErrorScope();
    if (setupValidation !== null) {
      throw new Error(`Setup validation failed: ${setupValidation.message}`);
    }
    const buffersEnd = performance.now();

    const setupTimings: GpuSetupTimings = {
      decodePlanMs: decodeEnd - decodeStart,
      buildAlphabetMs: alphabetEnd - decodeEnd,
      packTablesMs: packEnd - alphabetEnd,
      requestAdapterMs: adapterEnd - adapterStart,
      requestDeviceMs: deviceEnd - deviceStart,
      buildKernelSourceMs: buildEnd - buildStart,
      createShaderModuleMs: shaderEnd - buildEnd,
      createPipelinesMs: pipelinesEnd - shaderEnd,
      createBuffersMs: buffersEnd - pipelinesEnd,
      totalMs: buffersEnd - setupStart,
    };

    return new WebGpuLexer(
      device,
      plan,
      alphabet,
      packed,
      pipelines,
      layout,
      tablesBuffer,
      paramsBuffer,
      querySet,
      resolveBuffer,
      limits,
      chunkSize,
      setupTimings,
      deviceLost,
    );
  }

  #ensure(
    current: SizedBuffer | null,
    size: number,
    usage: GPUBufferUsageFlags,
    label: string,
  ): SizedBuffer {
    const wanted = Math.max(16, size);
    if (current !== null && current.size >= wanted) {
      return current;
    }
    if (current !== null) {
      current.buffer.destroy();
    }
    this.#bufferGeneration += 1;
    return {
      buffer: this.device.createBuffer({ size: wanted, usage, label }),
      size: wanted,
    };
  }

  /**
   * Largest input, in UTF-16 code units, this device can lex in one submit at a
   * given output capacity ratio. The binding wall is the records buffer, which
   * is 16 B per record.
   */
  maxInputUnits(recordsPerUnit = 1): number {
    const perUnitBindingBytes = 4; // nextPos / packedRec / exitPos are u32 each
    const byPositionArrays = Math.floor(
      this.limits.maxStorageBufferBindingSize / perUnitBindingBytes,
    );
    const byRecords = Math.floor(
      this.limits.maxStorageBufferBindingSize / (16 * recordsPerUnit),
    );
    const byStaging = Math.floor(
      (this.limits.maxBufferSize - STAGING_RECORDS_OFFSET) /
        (16 * recordsPerUnit),
    );
    const byChunkDispatch = this.limits.maxComputeWorkgroupsPerDimension *
      SCAN_WORKGROUP * this.chunkSize;
    // `aux` carries the per-segment summaries: numSeg * stateCount * 3 u32, i.e.
    // stateCount * 12 / SEG_SIZE bytes per input unit. Far from the first wall
    // at any realistic state count, but it is a real function of n.
    const segSummaryBytesPerUnit =
      (this.plan.stateCount * SEG_SUMMARY_U32_PER_STATE * 4) / SEG_SIZE;
    const bySegSummary = Math.floor(
      this.limits.maxStorageBufferBindingSize / segSummaryBytesPerUnit,
    );
    return Math.max(
      0,
      Math.min(
        byPositionArrays,
        byRecords,
        byStaging,
        byChunkDispatch,
        bySegSummary,
      ),
    );
  }

  /**
   * Every device limit this submit would have to satisfy. Checked BEFORE any
   * buffer is created: an over-limit createBuffer/createBindGroup/dispatch is
   * not an exception in WebGPU, it is an uncaptured error plus a dropped command
   * buffer, which reads back as a stale or zeroed result.
   */
  #checkLimits(
    n: number,
    capacityRecords: number,
    sizes: {
      srcBytes: number;
      posBytes: number;
      auxBytes: number;
      recordBytes: number;
      stagingBytes: number;
    },
    dispatches: {
      passX: number;
      passZ: number;
      passB: number;
      passDf: number;
      passE1: number;
    },
  ): void {
    const binding = this.limits.maxStorageBufferBindingSize;
    const bindings: readonly [string, number][] = [
      ["src", sizes.srcBytes],
      ["nextPos/packedRec/exitPos", sizes.posBytes],
      ["aux", sizes.auxBytes],
      ["records", sizes.recordBytes],
    ];
    for (const [name, bytes] of bindings) {
      if (bytes > binding) {
        throw new GpuLexerCapacityError(
          "maxStorageBufferBindingSize",
          bytes,
          binding,
          `Input of ${n} UTF-16 units at capacity ${capacityRecords} records needs a ${bytes} B "${name}" storage binding`,
        );
      }
    }
    const buffers: readonly [string, number][] = [
      ["src", sizes.srcBytes],
      ["nextPos/packedRec/exitPos", sizes.posBytes],
      ["aux", sizes.auxBytes],
      ["records", sizes.recordBytes],
      ["staging", sizes.stagingBytes],
    ];
    for (const [name, bytes] of buffers) {
      if (bytes > this.limits.maxBufferSize) {
        throw new GpuLexerCapacityError(
          "maxBufferSize",
          bytes,
          this.limits.maxBufferSize,
          `Input of ${n} UTF-16 units at capacity ${capacityRecords} records needs a ${bytes} B "${name}" buffer`,
        );
      }
    }
    // pass_x/pass_z/pass_b/pass_d/pass_f are grid-strided and clamped by the
    // caller, so only pass_e1 can actually exceed the limit. It is one workgroup
    // per 256 chunks, so it only binds on inputs far past the storage-binding
    // wall. The clamped grids are still checked: a clamping bug would otherwise
    // surface as a dropped command buffer rather than an error.
    const perDimension = this.limits.maxComputeWorkgroupsPerDimension;
    const grids: readonly [string, number][] = [
      ["pass_x", dispatches.passX],
      ["pass_z", dispatches.passZ],
      ["pass_b", dispatches.passB],
      ["pass_d/pass_f", dispatches.passDf],
      ["pass_e1", dispatches.passE1],
    ];
    for (const [name, workgroups] of grids) {
      if (workgroups > perDimension) {
        throw new GpuLexerCapacityError(
          "maxComputeWorkgroupsPerDimension",
          workgroups,
          perDimension,
          `Input of ${n} UTF-16 units needs a ${workgroups}-workgroup ${name} dispatch`,
        );
      }
    }
  }

  async lex(
    units: Uint16Array,
    options: GpuLexerOptions = {},
  ): Promise<GpuLexResult> {
    if (this.#destroyed) {
      throw new Error("This WebGpuLexer has been destroyed.");
    }
    if (this.#deviceLost.reason !== null) {
      throw new Error(`WebGPU device was lost: ${this.#deviceLost.reason}`);
    }
    if (this.#lexInFlight) {
      throw new Error(
        "WebGpuLexer.lex() does not support concurrent calls; await the previous lex() call.",
      );
    }
    this.#lexInFlight = true;
    try {
      return await this.#lexInternal(units, options);
    } finally {
      this.#lexInFlight = false;
    }
  }

  async #lexInternal(
    units: Uint16Array,
    options: GpuLexerOptions = {},
  ): Promise<GpuLexResult> {
    const totalStart = performance.now();
    if (this.#pendingUnmap && this.#staging !== null) {
      this.#staging.buffer.unmap();
      this.#pendingUnmap = false;
    }
    const n = units.length;
    const chunkSize = this.chunkSize;
    const numChunks = Math.ceil(n / chunkSize);
    const numBlocks = Math.ceil(numChunks / SCAN_WORKGROUP);
    const numChunksAlloc = Math.max(1, numChunks);
    const numBlocksAlloc = Math.max(1, numBlocks);
    // pass_x segments are independent of pass_b chunks: their size is fixed by
    // SEG_LOG2 rather than by the device's workgroup-storage limit.
    const numSeg = Math.ceil(n / SEG_SIZE);
    const numSegAlloc = Math.max(1, numSeg);

    let capacityRecords = n;
    if (options.capacityRecords !== undefined) {
      capacityRecords = Math.min(n, Math.max(1, options.capacityRecords));
    }
    capacityRecords = Math.max(1, capacityRecords);

    const srcBytes = Math.max(4, Math.ceil(n / 2) * 4);
    const posBytes = Math.max(4, n * 4);
    // aux layout: header | entry[numChunks] | counts[numChunks] |
    //             blockSums[numBlocks] | blockOffsets[numBlocks] |
    //             segSummaries[numSeg * stateCount * 3]
    // The segment summaries live here rather than in a buffer of their own so
    // the bind group stays at STORAGE_BINDING_COUNT bindings.
    const segSumOff = AUX_HEADER_U32 + 2 * numChunksAlloc + 2 * numBlocksAlloc;
    const auxU32 = segSumOff +
      numSegAlloc * this.plan.stateCount * SEG_SUMMARY_U32_PER_STATE;
    const recordBytes = capacityRecords * 16;
    const stagingBytes = STAGING_RECORDS_OFFSET + recordBytes;

    let perDimension = this.limits.maxComputeWorkgroupsPerDimension;
    if (options.debugMaxWorkgroupsPerDimension !== undefined) {
      perDimension = Math.max(
        1,
        Math.min(perDimension, options.debugMaxWorkgroupsPerDimension),
      );
    }
    const passXWorkgroups = Math.min(perDimension, Math.max(1, numSeg));
    const passZWorkgroups = Math.min(
      perDimension,
      Math.max(1, Math.ceil(n / PASS_Z_WORKGROUP)),
    );
    const passBWorkgroups = Math.min(perDimension, Math.max(1, numChunks));
    const passDfWorkgroups = Math.min(
      perDimension,
      Math.max(1, Math.ceil(numChunks / SCAN_WORKGROUP)),
    );
    const passE1Workgroups = Math.max(1, numBlocks);

    this.#checkLimits(
      n,
      capacityRecords,
      { srcBytes, posBytes, auxBytes: auxU32 * 4, recordBytes, stagingBytes },
      {
        passX: passXWorkgroups,
        passZ: passZWorkgroups,
        passB: passBWorkgroups,
        passDf: passDfWorkgroups,
        passE1: passE1Workgroups,
      },
    );

    // Everything from here on is guarded: a validation or OOM fault would
    // otherwise drop the whole command buffer and leave the host reading the
    // PREVIOUS submit's staging contents with overflow === false.
    this.device.pushErrorScope("validation");
    this.device.pushErrorScope("out-of-memory");

    this.#src = this.#ensure(
      this.#src,
      srcBytes,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      "src",
    );
    this.#nextPos = this.#ensure(
      this.#nextPos,
      posBytes,
      GPUBufferUsage.STORAGE,
      "nextPos",
    );
    this.#packedRec = this.#ensure(
      this.#packedRec,
      posBytes,
      GPUBufferUsage.STORAGE,
      "packedRec",
    );
    this.#exitPos = this.#ensure(
      this.#exitPos,
      posBytes,
      GPUBufferUsage.STORAGE,
      "exitPos",
    );
    this.#aux = this.#ensure(
      this.#aux,
      auxU32 * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      "aux",
    );
    this.#records = this.#ensure(
      this.#records,
      recordBytes,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      "records",
    );
    this.#staging = this.#ensure(
      this.#staging,
      stagingBytes,
      GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      "staging",
    );

    const key = [
      this.#bufferGeneration,
      this.#src.size,
      this.#nextPos.size,
      this.#packedRec.size,
      this.#exitPos.size,
      this.#aux.size,
      this.#records.size,
    ].join(":");
    if (this.#bindGroup === null || this.#bindGroupKey !== key) {
      this.#bindGroup = this.device.createBindGroup({
        layout: this.#layout,
        entries: [
          { binding: 0, resource: { buffer: this.#paramsBuffer } },
          { binding: 1, resource: { buffer: this.#src.buffer } },
          { binding: 2, resource: { buffer: this.#tablesBuffer } },
          { binding: 3, resource: { buffer: this.#nextPos.buffer } },
          { binding: 4, resource: { buffer: this.#packedRec.buffer } },
          { binding: 5, resource: { buffer: this.#exitPos.buffer } },
          { binding: 6, resource: { buffer: this.#aux.buffer } },
          { binding: 7, resource: { buffer: this.#records.buffer } },
        ],
      });
      this.#bindGroupKey = key;
    }

    // --- upload -------------------------------------------------------------
    const uploadStart = performance.now();
    const wholeWords = n >> 1;
    if (wholeWords > 0) {
      this.device.queue.writeBuffer(
        this.#src.buffer,
        0,
        units.buffer as ArrayBuffer,
        units.byteOffset,
        wholeWords * 4,
      );
    }
    if ((n & 1) === 1) {
      this.device.queue.writeBuffer(
        this.#src.buffer,
        wholeWords * 4,
        new Uint32Array([units[n - 1]]),
      );
    }

    const params = new Uint32Array([
      n,
      numChunks,
      numBlocks,
      capacityRecords,
      AUX_HEADER_U32,
      AUX_HEADER_U32 + numChunksAlloc,
      AUX_HEADER_U32 + 2 * numChunksAlloc,
      numSeg,
      segSumOff,
      passXWorkgroups,
      passZWorkgroups * PASS_Z_WORKGROUP,
      passBWorkgroups,
      passDfWorkgroups * SCAN_WORKGROUP,
    ]);
    this.device.queue.writeBuffer(this.#paramsBuffer, 0, params);
    const uploadEnd = performance.now();

    // --- encode -------------------------------------------------------------
    const encodeStart = performance.now();
    const encoder = this.device.createCommandEncoder();
    const dispatches: readonly [string, number][] = [
      ["pass_x_sweep", passXWorkgroups],
      ["pass_y_segscan", 1],
      ["pass_z_finalize", passZWorkgroups],
      ["pass_b_double", passBWorkgroups],
      ["pass_c_entries", 1],
      ["pass_d_counts", passDfWorkgroups],
      ["pass_e1_blockscan", passE1Workgroups],
      ["pass_e2_blockoffsets", 1],
      ["pass_f_emit", passDfWorkgroups],
    ];
    for (let index = 0; index < dispatches.length; index += 1) {
      const [stage, workgroups] = dispatches[index];
      const pipeline = this.#pipelines.get(stage);
      if (pipeline === undefined) {
        throw new Error(`Missing compute pipeline for stage ${stage}.`);
      }
      const descriptor: GPUComputePassDescriptor = { label: stage };
      if (this.#querySet !== null) {
        descriptor.timestampWrites = {
          querySet: this.#querySet,
          beginningOfPassWriteIndex: index * 2,
          endOfPassWriteIndex: index * 2 + 1,
        };
      }
      const pass = encoder.beginComputePass(descriptor);
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, this.#bindGroup);
      pass.dispatchWorkgroups(workgroups);
      pass.end();
    }

    encoder.copyBufferToBuffer(
      this.#aux.buffer,
      0,
      this.#staging.buffer,
      0,
      16,
    );
    if (this.#querySet !== null && this.#resolveBuffer !== null) {
      encoder.resolveQuerySet(
        this.#querySet,
        0,
        TIMESTAMP_COUNT,
        this.#resolveBuffer,
        0,
      );
      encoder.copyBufferToBuffer(
        this.#resolveBuffer,
        0,
        this.#staging.buffer,
        STAGING_META_BYTES,
        STAGING_TIMESTAMP_BYTES,
      );
    }
    encoder.copyBufferToBuffer(
      this.#records.buffer,
      0,
      this.#staging.buffer,
      STAGING_RECORDS_OFFSET,
      recordBytes,
    );
    const commands = encoder.finish();
    const encodeEnd = performance.now();

    // --- one submit, one sync ----------------------------------------------
    const submitStart = performance.now();
    this.device.queue.submit([commands]);
    await this.#staging.buffer.mapAsync(GPUMapMode.READ, 0, stagingBytes);
    const submitEnd = performance.now();

    // The scopes are popped AFTER the sync, so they cost no extra round trip -
    // every enclosed operation has already completed.
    const oomError = await this.device.popErrorScope();
    const validationError = await this.device.popErrorScope();
    if (oomError !== null || validationError !== null) {
      this.#staging.buffer.unmap();
      // A faulted submit leaves stale bytes in the staging buffer; the cached
      // bind group may also be invalid. Force a rebuild rather than reusing it.
      this.#bindGroupKey = "";
      this.#bindGroup = null;
      const parts: string[] = [];
      if (validationError !== null) {
        parts.push(`validation: ${validationError.message}`);
      }
      if (oomError !== null) {
        parts.push(`out-of-memory: ${oomError.message}`);
      }
      throw new Error(
        `GPU lex of ${n} UTF-16 units failed; the result would have been stale. ${
          parts.join("; ")
        }`,
      );
    }
    if (this.#deviceLost.reason !== null) {
      this.#staging.buffer.unmap();
      throw new Error(
        `WebGPU device was lost during lex: ${this.#deviceLost.reason}`,
      );
    }

    // --- readback -----------------------------------------------------------
    const readbackStart = performance.now();
    // Only the header is mapped first: the record region is mapped afterwards at
    // exactly the emitted size, so an over-sized output buffer costs nothing on
    // the readback path.
    const header = this.#staging.buffer.getMappedRange(
      0,
      STAGING_RECORDS_OFFSET,
    );
    const meta = new Uint32Array(header, 0, 4);
    const tokenCount = meta[0];
    const overflow = meta[1] === 1;
    if (tokenCount > n && n > 0) {
      this.#staging.buffer.unmap();
      throw new Error(
        `GPU reported ${tokenCount} tokens for ${n} UTF-16 units, which is impossible (every token consumes at least one unit).`,
      );
    }

    let stagesMs: Record<string, number> | null = null;
    let gpuStagesTotalMs: number | null = null;
    if (this.#querySet !== null) {
      const stamps = new BigUint64Array(
        header,
        STAGING_META_BYTES,
        TIMESTAMP_COUNT,
      );
      stagesMs = {};
      let sum = 0;
      for (let index = 0; index < STAGES.length; index += 1) {
        const delta = Number(stamps[index * 2 + 1] - stamps[index * 2]) / 1e6;
        stagesMs[STAGES[index].label] = delta;
        sum += delta;
      }
      gpuStagesTotalMs = sum;
    }

    const emitted = Math.min(tokenCount, capacityRecords);
    const borrow = options.borrowRecords === true;
    let records = new Int32Array(0);
    let mapRangeMs = 0;
    let copyOutMs = 0;
    if (emitted > 0) {
      const mapStart = performance.now();
      const region = this.#staging.buffer.getMappedRange(
        STAGING_RECORDS_OFFSET,
        emitted * 16,
      );
      const mapEnd = performance.now();
      mapRangeMs = mapEnd - mapStart;
      const view = new Int32Array(region, 0, emitted * 4);
      if (borrow) {
        records = view;
      } else {
        records = new Int32Array(emitted * 4);
        records.set(view);
      }
      copyOutMs = performance.now() - mapEnd;
    }
    if (borrow) {
      this.#pendingUnmap = true;
    } else {
      this.#staging.buffer.unmap();
    }
    const readbackEnd = performance.now();

    return {
      records,
      tokenCount,
      overflow,
      timings: {
        uploadMs: uploadEnd - uploadStart,
        encodeMs: encodeEnd - encodeStart,
        submitAndSyncMs: submitEnd - submitStart,
        mapRangeMs,
        copyOutMs,
        readbackMs: readbackEnd - readbackStart,
        totalMs: readbackEnd - totalStart,
        stagesMs,
        gpuStagesTotalMs,
      },
    };
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    if (this.#lexInFlight) {
      throw new Error("Cannot destroy WebGpuLexer while lex() is in flight.");
    }
    if (this.#pendingUnmap && this.#staging !== null) {
      this.#staging.buffer.unmap();
      this.#pendingUnmap = false;
    }
    for (
      const sized of [
        this.#src,
        this.#nextPos,
        this.#packedRec,
        this.#exitPos,
        this.#aux,
        this.#records,
        this.#staging,
      ]
    ) {
      if (sized !== null) {
        sized.buffer.destroy();
      }
    }
    this.#src = null;
    this.#nextPos = null;
    this.#packedRec = null;
    this.#exitPos = null;
    this.#aux = null;
    this.#records = null;
    this.#staging = null;
    // The bind group points at the buffers just destroyed. Sizes alone are not a
    // safe cache key here: re-lexing the same input reproduces identical sizes,
    // which would match a stale key and reuse a bind group over dead buffers.
    this.#bindGroup = null;
    this.#bindGroupKey = "";
    this.#bufferGeneration += 1;
    this.#destroyed = true;
  }
}
