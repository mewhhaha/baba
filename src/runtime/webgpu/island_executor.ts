import type { GpuFrontendPlan } from "../../compiler/gpu_frontend.ts";
import type { CompactFrontendProgram } from "./frontend.ts";
import { GpuFrontendCapacityError } from "./frontend_capacity.ts";
import { GPU_LEX_STAGE_LABELS, type WebGpuLexer } from "./lexer.ts";

const HEADER_WORDS = 32;
const TOKEN_WORDS = 4;
const NODE_WORDS = 8;
const EDGE_WORDS = 4;
const CANDIDATE_WORDS = 16;
const MAX_CONTRACTION_ROUNDS = 33;
const DISPATCH_PARAM_BYTES = 256;
const MAX_EXECUTION_DISPATCHES = 256;
const PIPELINE_ENTRY_POINTS = [
  "classify",
  "delimiter_flags",
  "structure_tree_leaves",
  "structure_tree_level",
  "match_delimiters",
  "validate_delimiters",
  "structure",
  "regions",
  "contract_regions",
  "validate_root",
  "reachability",
  "scan_level",
  "add_scan_offsets",
  "finalize_offsets",
  "emit",
  "staging",
] as const;

const STATUS_SUCCESS = 0;
const STATUS_LEXICAL = 1;
const STATUS_DELIMITER = 2;
const STATUS_SYNTAX = 3;
const STATUS_TOKEN_CAPACITY = 4;
const STATUS_NODE_CAPACITY = 5;
const STATUS_EDGE_CAPACITY = 6;
const STATUS_DEPTH_CAPACITY = 12;

export interface GpuIslandExecution {
  readonly status: number;
  readonly program: CompactFrontendProgram | null;
  readonly diagnostic: {
    readonly start: number;
    readonly end: number;
    readonly subjectId: number;
    readonly parameter0: number;
    readonly parameter1: number;
  } | null;
  readonly submitAndReadbackMs: number;
  readonly stagesMs: Readonly<Record<string, number>> | null;
}

interface SizedExecutionBuffer {
  readonly buffer: GPUBuffer;
  readonly bytes: number;
}

interface ExecutionSlot {
  arena: SizedExecutionBuffer | null;
  candidates: SizedExecutionBuffer | null;
  candidateTail: SizedExecutionBuffer | null;
  scratch: SizedExecutionBuffer | null;
  deviceStaging: SizedExecutionBuffer | null;
  staging: SizedExecutionBuffer | null;
  params: SizedExecutionBuffer | null;
  readonly querySet: GPUQuerySet | null;
  readonly queryResolve: GPUBuffer | null;
}

interface IslandDispatch {
  readonly entryPoint: typeof PIPELINE_ENTRY_POINTS[number];
  readonly label: string;
  readonly workgroups: number;
  readonly params: readonly number[];
}

interface ScanLevel {
  readonly count: number;
  readonly inputOffset: number;
  readonly outputOffset: number;
  readonly blockSumsOffset: number;
}

interface ScanLayout {
  readonly levels: readonly ScanLevel[];
  readonly firstOutputOffset: number;
  readonly totalOffset: number;
  readonly words: number;
}

interface StructuralLayout {
  readonly scan: ScanLayout;
  readonly treeOffset: number;
  readonly treeLeaves: number;
  readonly words: number;
}

function scanLayout(count: number): ScanLayout {
  const levels: ScanLevel[] = [];
  let words = count;
  const firstOutputOffset = 0;
  let levelCount = count;
  let inputOffset = -1;
  let outputOffset = firstOutputOffset;
  while (true) {
    const blockCount = Math.ceil(levelCount / 256);
    const blockSumsOffset = words;
    words += blockCount;
    levels.push({
      count: levelCount,
      inputOffset,
      outputOffset,
      blockSumsOffset,
    });
    if (blockCount === 1) {
      return {
        levels,
        firstOutputOffset,
        totalOffset: blockSumsOffset,
        words,
      };
    }
    inputOffset = blockSumsOffset;
    levelCount = blockCount;
    outputOffset = words;
    words += levelCount;
  }
}

function structuralLayout(tokenCount: number): StructuralLayout {
  const scan = scanLayout(Math.max(1, tokenCount));
  let treeLeaves = 1;
  while (treeLeaves < Math.max(1, tokenCount)) {
    treeLeaves *= 2;
  }
  const treeOffset = scan.words;
  return {
    scan,
    treeOffset,
    treeLeaves,
    words: treeOffset + treeLeaves * 2,
  };
}

function islandDispatchLabels(
  rounds: number,
  tokenWorkgroups: number,
  regionWorkgroups: number,
  candidateWorkgroups: number,
  allocationScan: ScanLayout,
  structural: StructuralLayout,
  stagingWorkgroups: number,
): readonly IslandDispatch[] {
  const dispatches: IslandDispatch[] = [
    {
      entryPoint: "classify",
      label: "classify",
      workgroups: tokenWorkgroups,
      params: [0],
    },
    {
      entryPoint: "delimiter_flags",
      label: "structure_flags",
      workgroups: tokenWorkgroups,
      params: [0],
    },
  ];
  for (let level = 0; level < structural.scan.levels.length; level += 1) {
    const scanLevel = structural.scan.levels[level];
    let scanMode = 2;
    if (level === 0) {
      scanMode = 3;
    }
    dispatches.push({
      entryPoint: "scan_level",
      label: `structure_scan_${level}`,
      workgroups: Math.max(1, Math.ceil(scanLevel.count / 256)),
      params: [
        0,
        scanLevel.count,
        scanLevel.inputOffset,
        scanLevel.outputOffset,
        scanLevel.blockSumsOffset,
        scanMode,
      ],
    });
  }
  for (
    let level = structural.scan.levels.length - 2;
    level >= 0;
    level -= 1
  ) {
    const scanLevel = structural.scan.levels[level];
    const parent = structural.scan.levels[level + 1];
    dispatches.push({
      entryPoint: "add_scan_offsets",
      label: `structure_add_${level}`,
      workgroups: Math.max(1, Math.ceil(scanLevel.count / 256)),
      params: [
        0,
        scanLevel.count,
        0,
        scanLevel.outputOffset,
        0,
        3,
        parent.outputOffset,
      ],
    });
  }
  dispatches.push({
    entryPoint: "structure_tree_leaves",
    label: "structure_tree_leaves",
    workgroups: Math.max(1, Math.ceil(structural.treeLeaves / 256)),
    params: [
      0,
      structural.scan.levels[0].count,
      structural.scan.firstOutputOffset,
      structural.treeOffset,
      structural.treeLeaves,
    ],
  });
  let childOffset = structural.treeOffset + structural.treeLeaves;
  let parentCount = structural.treeLeaves / 2;
  while (parentCount >= 1) {
    const parentOffset = structural.treeOffset + parentCount;
    dispatches.push({
      entryPoint: "structure_tree_level",
      label: `structure_tree_${parentCount}`,
      workgroups: Math.max(1, Math.ceil(parentCount / 256)),
      params: [0, parentCount, childOffset, parentOffset],
    });
    childOffset = parentOffset;
    if (parentCount === 1) {
      break;
    }
    parentCount /= 2;
  }
  dispatches.push(
    {
      entryPoint: "match_delimiters",
      label: "structure_match",
      workgroups: tokenWorkgroups,
      params: [
        0,
        structural.scan.levels[0].count,
        structural.scan.firstOutputOffset,
        structural.treeOffset,
        structural.treeLeaves,
      ],
    },
    {
      entryPoint: "validate_delimiters",
      label: "structure_validate_pairs",
      workgroups: tokenWorkgroups,
      params: [0],
    },
    {
      entryPoint: "structure",
      label: "structure_validate",
      workgroups: 1,
      params: [0],
    },
  );
  for (let level = 0; level < structural.scan.levels.length; level += 1) {
    const scanLevel = structural.scan.levels[level];
    let scanMode = 2;
    if (level === 0) {
      scanMode = 4;
    }
    dispatches.push({
      entryPoint: "scan_level",
      label: `syntax_scan_${level}`,
      workgroups: Math.max(1, Math.ceil(scanLevel.count / 256)),
      params: [
        0,
        scanLevel.count,
        scanLevel.inputOffset,
        scanLevel.outputOffset,
        scanLevel.blockSumsOffset,
        scanMode,
      ],
    });
  }
  for (
    let level = structural.scan.levels.length - 2;
    level >= 0;
    level -= 1
  ) {
    const scanLevel = structural.scan.levels[level];
    const parent = structural.scan.levels[level + 1];
    dispatches.push({
      entryPoint: "add_scan_offsets",
      label: `syntax_add_${level}`,
      workgroups: Math.max(1, Math.ceil(scanLevel.count / 256)),
      params: [
        0,
        scanLevel.count,
        0,
        scanLevel.outputOffset,
        0,
        4,
        parent.outputOffset,
      ],
    });
  }
  dispatches.push({
    entryPoint: "regions",
    label: "regions",
    workgroups: regionWorkgroups,
    params: [0],
  });
  for (let round = 0; round < rounds; round += 1) {
    dispatches.push({
      entryPoint: "contract_regions",
      label: `contraction_${round}`,
      workgroups: regionWorkgroups,
      params: [round],
    });
  }
  dispatches.push({
    entryPoint: "validate_root",
    label: "validate_root",
    workgroups: 1,
    params: [rounds - 1],
  });
  for (let round = 0; round < rounds; round += 1) {
    dispatches.push({
      entryPoint: "reachability",
      label: `reachability_${round}`,
      workgroups: regionWorkgroups,
      params: [rounds - 1],
    });
  }
  for (const mode of [0, 1]) {
    let subject = "nodes";
    if (mode === 1) {
      subject = "edges";
    }
    for (let level = 0; level < allocationScan.levels.length; level += 1) {
      const scanLevel = allocationScan.levels[level];
      let scanMode = 2;
      if (level === 0) {
        scanMode = mode;
      }
      dispatches.push({
        entryPoint: "scan_level",
        label: `allocation_${subject}_scan_${level}`,
        workgroups: Math.max(1, Math.ceil(scanLevel.count / 256)),
        params: [
          0,
          scanLevel.count,
          scanLevel.inputOffset,
          scanLevel.outputOffset,
          scanLevel.blockSumsOffset,
          scanMode,
        ],
      });
    }
    for (
      let level = allocationScan.levels.length - 2;
      level >= 0;
      level -= 1
    ) {
      const scanLevel = allocationScan.levels[level];
      const parent = allocationScan.levels[level + 1];
      dispatches.push({
        entryPoint: "add_scan_offsets",
        label: `allocation_${subject}_add_${level}`,
        workgroups: Math.max(1, Math.ceil(scanLevel.count / 256)),
        params: [
          0,
          scanLevel.count,
          0,
          scanLevel.outputOffset,
          0,
          mode,
          parent.outputOffset,
        ],
      });
    }
    dispatches.push({
      entryPoint: "finalize_offsets",
      label: `allocation_${subject}_finalize`,
      workgroups: candidateWorkgroups,
      params: [
        0,
        allocationScan.levels[0].count,
        0,
        allocationScan.firstOutputOffset,
        allocationScan.totalOffset,
        mode,
      ],
    });
  }
  dispatches.push(
    {
      entryPoint: "emit",
      label: "emit",
      workgroups: candidateWorkgroups,
      params: [rounds - 1],
    },
    {
      entryPoint: "staging",
      label: "staging",
      workgroups: stagingWorkgroups,
      params: [rounds - 1],
    },
  );
  return dispatches;
}

interface ExecutionLayout {
  readonly tokenCapacity: number;
  readonly nodeCapacity: number;
  readonly edgeCapacity: number;
  readonly tokenOffset: number;
  readonly nodeOffset: number;
  readonly edgeOffset: number;
  readonly delimiterOffset: number;
  readonly delimiterTerminalStackOffset: number;
  readonly delimiterIndexStackOffset: number;
  readonly arenaWords: number;
  readonly stagingWords: number;
}

export class GpuIslandExecutor {
  readonly device: GPUDevice;
  readonly plan: GpuFrontendPlan;
  readonly #pipelines: ReadonlyMap<string, GPUComputePipeline>;
  readonly #planBuffer: GPUBuffer;
  readonly #slots = new Map<WebGpuLexer, ExecutionSlot>();

  private constructor(
    device: GPUDevice,
    plan: GpuFrontendPlan,
    pipelines: ReadonlyMap<string, GPUComputePipeline>,
    planBuffer: GPUBuffer,
  ) {
    this.device = device;
    this.plan = plan;
    this.#pipelines = pipelines;
    this.#planBuffer = planBuffer;
  }

  static async create(
    device: GPUDevice,
    plan: GpuFrontendPlan,
  ): Promise<GpuIslandExecutor> {
    if (device.limits.maxStorageBuffersPerShaderStage < 8) {
      throw new GpuFrontendCapacityError(
        "storageBindings",
        8,
        device.limits.maxStorageBuffersPerShaderStage,
      );
    }
    const module = device.createShaderModule({ code: ISLAND_EXECUTOR_WGSL });
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
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
          buffer: { type: "read-only-storage" },
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
          buffer: {
            type: "uniform",
            hasDynamicOffset: true,
            minBindingSize: 32,
          },
        },
        {
          binding: 8,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
      ],
    });
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });
    const pipelines = new Map<string, GPUComputePipeline>();
    for (const entryPoint of PIPELINE_ENTRY_POINTS) {
      pipelines.set(
        entryPoint,
        await device.createComputePipelineAsync({
          layout: pipelineLayout,
          compute: { module, entryPoint },
        }),
      );
    }
    const packedPlan = packPlan(plan);
    const planLimit = Math.min(
      device.limits.maxBufferSize,
      device.limits.maxStorageBufferBindingSize,
    );
    if (packedPlan.byteLength > planLimit) {
      throw new GpuFrontendCapacityError(
        "islandPlan",
        packedPlan.byteLength,
        planLimit,
      );
    }
    const planBuffer = device.createBuffer({
      label: "baba gpu frontend island plan",
      size: packedPlan.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
      planBuffer,
      0,
      packedPlan.buffer as ArrayBuffer,
      packedPlan.byteOffset,
      packedPlan.byteLength,
    );
    return new GpuIslandExecutor(device, plan, pipelines, planBuffer);
  }

  async execute(
    lexer: WebGpuLexer,
    sourceUnits: Uint16Array,
    maximumTokens: number | undefined,
    maximumNodes: number | undefined,
    maximumEdges: number | undefined,
  ): Promise<GpuIslandExecution> {
    let tokenCapacity = Math.max(1, sourceUnits.length);
    if (maximumTokens !== undefined) {
      if (!Number.isSafeInteger(maximumTokens) || maximumTokens < 1) {
        throw new Error(
          `capacityRecords must be a positive safe integer, got '${maximumTokens}'.`,
        );
      }
      tokenCapacity = Math.max(
        1,
        Math.min(sourceUnits.length, maximumTokens),
      );
    }
    const layout = executionLayout(
      tokenCapacity,
      this.plan,
      maximumNodes,
      maximumEdges,
    );
    const candidateMultiplicity = this.plan.execution.bounds.candidatesPerToken;
    const candidateCount = 1 +
      tokenCapacity * candidateMultiplicity;
    const contractionRounds = this.plan.statistics.contractionRounds;
    if (
      contractionRounds < 1 ||
      contractionRounds > MAX_CONTRACTION_ROUNDS
    ) {
      throw new Error(
        `GPU frontend contraction round bound ${contractionRounds} is outside [1, ${MAX_CONTRACTION_ROUNDS}].`,
      );
    }
    const tokenWorkgroups = Math.max(
      1,
      Math.ceil(tokenCapacity / 256),
    );
    const allocationScan = scanLayout(candidateCount);
    const candidateWorkgroups = Math.max(1, Math.ceil(candidateCount / 256));
    const structural = structuralLayout(tokenCapacity);
    const dispatches = islandDispatchLabels(
      contractionRounds,
      tokenWorkgroups,
      tokenWorkgroups,
      candidateWorkgroups,
      allocationScan,
      structural,
      Math.max(1, Math.ceil(layout.stagingWords / 256)),
    );
    if (
      GPU_LEX_STAGE_LABELS.length + dispatches.length >
        MAX_EXECUTION_DISPATCHES
    ) {
      throw new Error(
        `GPU frontend needs ${
          GPU_LEX_STAGE_LABELS.length + dispatches.length
        } timestamped dispatches, exceeding internal bound ${MAX_EXECUTION_DISPATCHES}.`,
      );
    }
    const queryCount = (GPU_LEX_STAGE_LABELS.length + dispatches.length) * 2;
    const maximumQueryCount = MAX_EXECUTION_DISPATCHES * 2;
    const timestampBytes = queryCount * BigUint64Array.BYTES_PER_ELEMENT;
    const arenaBytes = layout.arenaWords * Uint32Array.BYTES_PER_ELEMENT;
    const candidateSplit = Math.ceil(candidateCount / 2);
    const candidateBytes = candidateSplit * CANDIDATE_WORDS *
      Uint32Array.BYTES_PER_ELEMENT;
    const candidateTailBytes = Math.max(
      Uint32Array.BYTES_PER_ELEMENT,
      (candidateCount - candidateSplit) * CANDIDATE_WORDS *
        Uint32Array.BYTES_PER_ELEMENT,
    );
    const scratchWords = Math.max(allocationScan.words, structural.words);
    const scratchBytes = scratchWords * Uint32Array.BYTES_PER_ELEMENT;
    const deviceStagingBytes = layout.stagingWords *
      Uint32Array.BYTES_PER_ELEMENT;
    const stagingBytes = timestampBytes +
      layout.stagingWords * Uint32Array.BYTES_PER_ELEMENT;
    this.#assertBufferLimit("islandArena", arenaBytes, true);
    this.#assertBufferLimit("islandCandidatesHead", candidateBytes, true);
    this.#assertBufferLimit(
      "islandCandidatesTail",
      candidateTailBytes,
      true,
    );
    this.#assertBufferLimit("islandScan", scratchBytes, true);
    this.#assertBufferLimit("deviceStaging", deviceStagingBytes, true);
    this.#assertBufferLimit("islandStaging", stagingBytes, false);

    let slot = this.#slots.get(lexer);
    if (slot === undefined) {
      let querySet: GPUQuerySet | null = null;
      let queryResolve: GPUBuffer | null = null;
      if (this.device.features.has("timestamp-query")) {
        querySet = this.device.createQuerySet({
          type: "timestamp",
          count: maximumQueryCount,
        });
        queryResolve = this.device.createBuffer({
          label: "baba gpu frontend timestamp resolve",
          size: maximumQueryCount * BigUint64Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        });
      }
      slot = {
        arena: null,
        candidates: null,
        candidateTail: null,
        scratch: null,
        deviceStaging: null,
        staging: null,
        params: null,
        querySet,
        queryResolve,
      };
      this.#slots.set(lexer, slot);
    }
    slot.arena = this.#ensureBuffer(
      slot.arena,
      arenaBytes,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
      "baba gpu frontend island arena",
    );
    slot.candidates = this.#ensureBuffer(
      slot.candidates,
      candidateBytes,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      "baba gpu frontend island candidates",
    );
    slot.candidateTail = this.#ensureBuffer(
      slot.candidateTail,
      candidateTailBytes,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      "baba gpu frontend island candidate tail",
    );
    slot.params = this.#ensureBuffer(
      slot.params,
      MAX_EXECUTION_DISPATCHES * DISPATCH_PARAM_BYTES,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      "baba gpu frontend dispatch params",
    );
    slot.scratch = this.#ensureBuffer(
      slot.scratch,
      scratchBytes,
      GPUBufferUsage.STORAGE,
      "baba gpu frontend scan scratch",
    );
    slot.deviceStaging = this.#ensureBuffer(
      slot.deviceStaging,
      deviceStagingBytes,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      "baba gpu frontend device staging",
    );
    slot.staging = this.#ensureBuffer(
      slot.staging,
      stagingBytes,
      GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      "baba gpu frontend island staging",
    );
    const arenaBuffer = slot.arena.buffer;
    const candidateBuffer = slot.candidates.buffer;
    const candidateTailBuffer = slot.candidateTail.buffer;
    const scratchBuffer = slot.scratch.buffer;
    const deviceStagingBuffer = slot.deviceStaging.buffer;
    const paramsBuffer = slot.params.buffer;
    const stagingBuffer = slot.staging.buffer;
    const integratedLex = lexer.prepareIntegratedLex(sourceUnits, {
      capacityRecords: maximumTokens,
    });

    try {
      if (
        integratedLex.capacityRecords !== tokenCapacity ||
        integratedLex.stageCount !== GPU_LEX_STAGE_LABELS.length
      ) {
        throw new Error(
          `Integrated lexer prepared ${integratedLex.capacityRecords} records and ${integratedLex.stageCount} stages; expected ${tokenCapacity} records and ${GPU_LEX_STAGE_LABELS.length} stages.`,
        );
      }
      const header = new Uint32Array(HEADER_WORDS);
      header[9] = integratedLex.capacityRecords;
      header[10] = layout.tokenCapacity;
      header[11] = layout.nodeCapacity;
      header[12] = layout.edgeCapacity;
      header[13] = layout.tokenOffset;
      header[14] = layout.nodeOffset;
      header[16] = layout.edgeOffset;
      header[17] = layout.delimiterOffset;
      header[18] = layout.delimiterTerminalStackOffset;
      header[19] = layout.delimiterIndexStackOffset;
      header[20] = candidateCount;
      header[21] = contractionRounds;
      header[22] = candidateMultiplicity;
      header[23] = sourceUnits.length;
      header[24] = candidateSplit;
      this.device.queue.writeBuffer(arenaBuffer, 0, header);
      this.device.queue.writeBuffer(
        candidateBuffer,
        0,
        new Uint32Array([0xffffffff]),
      );
      const dispatchParams = new Uint32Array(
        MAX_EXECUTION_DISPATCHES * DISPATCH_PARAM_BYTES /
          Uint32Array.BYTES_PER_ELEMENT,
      );
      for (let index = 0; index < dispatches.length; index += 1) {
        const offset = index * DISPATCH_PARAM_BYTES /
          Uint32Array.BYTES_PER_ELEMENT;
        for (
          let word = 0;
          word < dispatches[index].params.length;
          word += 1
        ) {
          dispatchParams[offset + word] = dispatches[index].params[word] >>> 0;
        }
      }
      this.device.queue.writeBuffer(paramsBuffer, 0, dispatchParams);

      const bindGroup = this.device.createBindGroup({
        layout: this.#islandPipeline("classify").getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: integratedLex.recordsBuffer } },
          { binding: 1, resource: { buffer: integratedLex.sourceBuffer } },
          { binding: 2, resource: { buffer: this.#planBuffer } },
          { binding: 3, resource: { buffer: arenaBuffer } },
          { binding: 4, resource: { buffer: integratedLex.metadataBuffer } },
          { binding: 5, resource: { buffer: candidateBuffer } },
          { binding: 6, resource: { buffer: scratchBuffer } },
          {
            binding: 7,
            resource: { buffer: paramsBuffer, size: 32 },
          },
          { binding: 8, resource: { buffer: candidateTailBuffer } },
        ],
      });
      const stagingBindGroup = this.device.createBindGroup({
        layout: this.#islandPipeline("staging").getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: integratedLex.recordsBuffer } },
          { binding: 1, resource: { buffer: integratedLex.sourceBuffer } },
          { binding: 2, resource: { buffer: this.#planBuffer } },
          { binding: 3, resource: { buffer: arenaBuffer } },
          { binding: 4, resource: { buffer: integratedLex.metadataBuffer } },
          { binding: 5, resource: { buffer: candidateBuffer } },
          { binding: 6, resource: { buffer: scratchBuffer } },
          {
            binding: 7,
            resource: { buffer: paramsBuffer, size: 32 },
          },
          { binding: 8, resource: { buffer: deviceStagingBuffer } },
        ],
      });
      const encoder = this.device.createCommandEncoder();
      integratedLex.encode(encoder, slot.querySet, 0);
      for (let index = 0; index < dispatches.length; index += 1) {
        const dispatch = dispatches[index];
        const descriptor: GPUComputePassDescriptor = {
          label: dispatch.label,
        };
        if (slot.querySet !== null) {
          descriptor.timestampWrites = {
            querySet: slot.querySet,
            beginningOfPassWriteIndex: (integratedLex.stageCount + index) * 2,
            endOfPassWriteIndex: (integratedLex.stageCount + index) * 2 + 1,
          };
        }
        const pass = encoder.beginComputePass(descriptor);
        pass.setPipeline(this.#islandPipeline(dispatch.entryPoint));
        let dispatchBindGroup = bindGroup;
        if (dispatch.entryPoint === "staging") {
          dispatchBindGroup = stagingBindGroup;
        }
        pass.setBindGroup(0, dispatchBindGroup, [
          index * DISPATCH_PARAM_BYTES,
        ]);
        const workgroupsX = Math.min(dispatch.workgroups, 65_535);
        const workgroupsY = Math.ceil(dispatch.workgroups / workgroupsX);
        if (
          workgroupsY > this.device.limits.maxComputeWorkgroupsPerDimension
        ) {
          throw new GpuFrontendCapacityError(
            `${dispatch.label}Workgroups`,
            dispatch.workgroups,
            this.device.limits.maxComputeWorkgroupsPerDimension ** 2,
          );
        }
        pass.dispatchWorkgroups(workgroupsX, workgroupsY);
        pass.end();
      }

      encoder.copyBufferToBuffer(
        deviceStagingBuffer,
        0,
        stagingBuffer,
        timestampBytes,
        deviceStagingBytes,
      );
      if (
        slot.querySet !== null &&
        slot.queryResolve !== null
      ) {
        encoder.resolveQuerySet(
          slot.querySet,
          0,
          queryCount,
          slot.queryResolve,
          0,
        );
        encoder.copyBufferToBuffer(
          slot.queryResolve,
          0,
          stagingBuffer,
          0,
          timestampBytes,
        );
      }

      const started = performance.now();
      this.device.queue.submit([encoder.finish()]);
      await stagingBuffer.mapAsync(GPUMapMode.READ);
      const finished = performance.now();
      const mappedRange = stagingBuffer.getMappedRange(0, stagingBytes);
      let stagesMs: Readonly<Record<string, number>> | null = null;
      if (slot.querySet !== null) {
        stagesMs = decodeStageTimings(
          new BigUint64Array(mappedRange, 0, queryCount),
          dispatches,
        );
      }
      const mapped = new Uint32Array(
        mappedRange,
        timestampBytes,
        layout.stagingWords,
      );
      const result = decodeExecution(
        mapped,
        layout,
        finished - started,
        stagesMs,
      );
      stagingBuffer.unmap();
      return result;
    } finally {
      integratedLex.release();
    }
  }

  destroy(): void {
    for (const slot of this.#slots.values()) {
      if (slot.arena !== null) {
        slot.arena.buffer.destroy();
      }
      if (slot.candidates !== null) {
        slot.candidates.buffer.destroy();
      }
      if (slot.scratch !== null) {
        slot.scratch.buffer.destroy();
      }
      if (slot.candidateTail !== null) {
        slot.candidateTail.buffer.destroy();
      }
      if (slot.deviceStaging !== null) {
        slot.deviceStaging.buffer.destroy();
      }
      if (slot.staging !== null) {
        slot.staging.buffer.destroy();
      }
      if (slot.params !== null) {
        slot.params.buffer.destroy();
      }
      if (slot.queryResolve !== null) {
        slot.queryResolve.destroy();
      }
      if (slot.querySet !== null) {
        slot.querySet.destroy();
      }
    }
    this.#slots.clear();
    this.#planBuffer.destroy();
  }

  #assertBufferLimit(
    name: string,
    bytes: number,
    storageBinding: boolean,
  ): void {
    let limit = this.device.limits.maxBufferSize;
    if (storageBinding) {
      limit = Math.min(limit, this.device.limits.maxStorageBufferBindingSize);
    }
    if (bytes > limit) {
      throw new GpuFrontendCapacityError(name, bytes, limit);
    }
  }

  #ensureBuffer(
    current: SizedExecutionBuffer | null,
    bytes: number,
    usage: GPUBufferUsageFlags,
    label: string,
  ): SizedExecutionBuffer {
    const required = Math.max(16, bytes);
    if (current !== null && current.bytes >= required) {
      return current;
    }
    const replacement = {
      buffer: this.device.createBuffer({ size: required, usage, label }),
      bytes: required,
    };
    if (current !== null) {
      current.buffer.destroy();
    }
    return replacement;
  }

  #islandPipeline(stage: string): GPUComputePipeline {
    const pipeline = this.#pipelines.get(stage);
    if (pipeline === undefined) {
      throw new Error(`GPU frontend has no '${stage}' pipeline.`);
    }
    return pipeline;
  }
}

function decodeStageTimings(
  timestamps: BigUint64Array,
  dispatches: readonly IslandDispatch[],
): Readonly<Record<string, number>> {
  const stages: Record<string, number> = {};
  let lex = 0;
  for (let index = 0; index < GPU_LEX_STAGE_LABELS.length; index += 1) {
    const elapsed = Number(
      timestamps[index * 2 + 1] - timestamps[index * 2],
    ) / 1e6;
    stages[GPU_LEX_STAGE_LABELS[index]] = elapsed;
    lex += elapsed;
  }
  stages.lex = lex;
  const islandIndex = GPU_LEX_STAGE_LABELS.length;
  let contraction = 0;
  let reachability = 0;
  let allocation = 0;
  let structure = 0;
  let gpuTotal = lex;
  for (let index = 0; index < dispatches.length; index += 1) {
    const elapsed = Number(
      timestamps[(islandIndex + index) * 2 + 1] -
        timestamps[(islandIndex + index) * 2],
    ) / 1e6;
    stages[dispatches[index].label] = elapsed;
    gpuTotal += elapsed;
    if (
      dispatches[index].entryPoint === "delimiter_flags" ||
      dispatches[index].entryPoint === "structure_tree_leaves" ||
      dispatches[index].entryPoint === "structure_tree_level" ||
      dispatches[index].entryPoint === "match_delimiters" ||
      dispatches[index].entryPoint === "validate_delimiters" ||
      dispatches[index].entryPoint === "structure" ||
      (
        (
          dispatches[index].entryPoint === "scan_level" ||
          dispatches[index].entryPoint === "add_scan_offsets"
        ) &&
        dispatches[index].label.startsWith("structure_")
      )
    ) {
      structure += elapsed;
    }
    if (dispatches[index].entryPoint === "contract_regions") {
      contraction += elapsed;
    }
    if (dispatches[index].entryPoint === "reachability") {
      reachability += elapsed;
    }
    if (
      dispatches[index].entryPoint === "scan_level" ||
      dispatches[index].entryPoint === "add_scan_offsets" ||
      dispatches[index].entryPoint === "finalize_offsets"
    ) {
      allocation += elapsed;
    }
  }
  stages.contraction = contraction;
  stages.reachability = reachability;
  stages.allocation = allocation;
  stages.structure = structure;
  stages.total_gpu = gpuTotal;
  return stages;
}

function executionLayout(
  tokenCapacity: number,
  plan: GpuFrontendPlan,
  maximumNodes: number | undefined,
  maximumEdges: number | undefined,
): ExecutionLayout {
  let nodeCapacity = tokenCapacity * plan.capacity.nodesPerToken;
  if (maximumNodes !== undefined && maximumNodes < nodeCapacity) {
    nodeCapacity = maximumNodes;
  }
  let edgeCapacity = tokenCapacity * plan.capacity.edgesPerToken;
  if (maximumEdges !== undefined && maximumEdges < edgeCapacity) {
    edgeCapacity = maximumEdges;
  }
  const tokenOffset = HEADER_WORDS;
  const nodeOffset = tokenOffset + tokenCapacity * TOKEN_WORDS;
  const edgeOffset = nodeOffset + nodeCapacity * NODE_WORDS;
  const delimiterOffset = edgeOffset + edgeCapacity * EDGE_WORDS;
  const delimiterTerminalStackOffset = delimiterOffset + tokenCapacity;
  const delimiterIndexStackOffset = delimiterTerminalStackOffset +
    tokenCapacity;
  const arenaWords = delimiterIndexStackOffset + tokenCapacity;
  const stagingWords = HEADER_WORDS +
    tokenCapacity * TOKEN_WORDS +
    nodeCapacity * NODE_WORDS +
    edgeCapacity * EDGE_WORDS;
  return {
    tokenCapacity,
    nodeCapacity,
    edgeCapacity,
    tokenOffset,
    nodeOffset,
    edgeOffset,
    delimiterOffset,
    delimiterTerminalStackOffset,
    delimiterIndexStackOffset,
    arenaWords,
    stagingWords,
  };
}

function packPlan(plan: GpuFrontendPlan): Uint32Array {
  const headerWords = 16;
  const islandWords = 7;
  const stateWords = 3;
  const transitionWords = 4;
  const classificationOffset = headerWords;
  const islandOffset = classificationOffset +
    plan.terminalClassification.length;
  const stateOffset = islandOffset + plan.islands.length * islandWords;
  const transitionOffset = stateOffset +
    plan.statistics.islandStates * stateWords;
  const denseTargetOffset = transitionOffset +
    plan.statistics.islandTransitions * transitionWords;
  const denseFieldOffset = denseTargetOffset +
    plan.execution.denseTransitions.targets.length;
  const denseKindOffset = denseFieldOffset +
    plan.execution.denseTransitions.fields.length;
  const locatorOffset = denseKindOffset +
    plan.execution.denseTransitions.kinds.length;
  const locatorWords = plan.execution.denseTransitions.terminalSymbols *
    plan.execution.bounds.candidatesPerToken;
  const words = new Uint32Array(
    locatorOffset + locatorWords,
  );
  words[0] = plan.terminalClassification.length;
  words[1] = plan.islands.length;
  words[2] = classificationOffset;
  words[3] = islandOffset;
  words[4] = stateOffset;
  words[5] = transitionOffset;
  words[6] = plan.rootIsland;
  words[7] = denseTargetOffset;
  words[8] = denseFieldOffset;
  words[9] = denseKindOffset;
  words[10] = plan.execution.denseTransitions.symbols;
  words[11] = plan.execution.denseTransitions.terminalSymbols;
  words[12] = locatorOffset;
  words[13] = plan.execution.bounds.candidatesPerToken;

  for (
    let index = 0;
    index < plan.terminalClassification.length;
    index += 1
  ) {
    words[classificationOffset + index] = plan.terminalClassification[index] >>>
      0;
  }

  let globalState = 0;
  let globalTransition = 0;
  for (const island of plan.islands) {
    const islandStateOffset = globalState;
    const boundary = plan.boundaries[island.id];
    if (boundary === undefined) {
      throw new Error(`GPU frontend plan has no boundary ${island.id}.`);
    }
    let boundaryKind = 0;
    let openTerminal = 0;
    let closeTerminal = 0;
    if (boundary.kind === "paired") {
      boundaryKind = 1;
      openTerminal = boundary.openTerminal;
      closeTerminal = boundary.closeTerminal;
    }
    if (boundary.kind === "terminated") {
      boundaryKind = 2;
      closeTerminal = boundary.terminal;
    }
    if (boundary.kind === "separated") {
      boundaryKind = 3;
      openTerminal = boundary.openTerminal;
      closeTerminal = boundary.closeTerminal;
    }
    const islandBase = islandOffset + island.id * islandWords;
    words.set(
      [
        island.ruleId,
        globalState + island.startState,
        boundaryKind,
        openTerminal,
        closeTerminal,
        globalState,
        island.states.length,
      ],
      islandBase,
    );
    for (const state of island.states) {
      const stateBase = stateOffset + globalState * stateWords;
      let accepting = 0;
      if (state.accepting) {
        accepting = 1;
      }
      words.set(
        [
          accepting,
          globalTransition,
          state.transitions.length,
        ],
        stateBase,
      );
      for (const transition of state.transitions) {
        const transitionBase = transitionOffset +
          globalTransition * transitionWords;
        let inputKind = 0;
        if (transition.inputKind === "island") {
          inputKind = 1;
        }
        words.set(
          [
            inputKind,
            transition.input,
            islandStateOffset + transition.target,
            transition.emit.field,
          ],
          transitionBase,
        );
        globalTransition += 1;
      }
      globalState += 1;
    }
  }
  let denseRow = 0;
  let denseStateOffset = 0;
  for (const island of plan.islands) {
    for (
      let state = 0;
      state < island.states.length;
      state += 1
    ) {
      for (
        let symbol = 0;
        symbol < plan.execution.denseTransitions.symbols;
        symbol += 1
      ) {
        const index = denseRow * plan.execution.denseTransitions.symbols +
          symbol;
        let target = plan.execution.denseTransitions.targets[index];
        if (target >= 0) {
          target += denseStateOffset;
        }
        words[denseTargetOffset + index] = target >>> 0;
        words[denseFieldOffset + index] =
          plan.execution.denseTransitions.fields[index] >>> 0;
        words[denseKindOffset + index] =
          plan.execution.denseTransitions.kinds[index] >>> 0;
      }
      denseRow += 1;
    }
    denseStateOffset += island.states.length;
  }
  const locatorCounts = new Uint32Array(
    plan.execution.denseTransitions.terminalSymbols,
  );
  for (const locator of plan.execution.locators) {
    for (const terminal of locator.startTerminals) {
      const slot = locatorCounts[terminal];
      if (slot >= plan.execution.bounds.candidatesPerToken) {
        throw new Error(
          `GPU frontend terminal ${terminal} exceeds compiler-proven candidate multiplicity ${plan.execution.bounds.candidatesPerToken}.`,
        );
      }
      const index = locatorOffset +
        terminal * plan.execution.bounds.candidatesPerToken + slot;
      words[index] = locator.island + 1;
      locatorCounts[terminal] = slot + 1;
    }
  }
  return words;
}

function decodeExecution(
  mapped: Uint32Array,
  layout: ExecutionLayout,
  submitAndReadbackMs: number,
  stagesMs: Readonly<Record<string, number>> | null,
): GpuIslandExecution {
  const status = mapped[0];
  const tokenCount = mapped[1];
  const nodeCount = mapped[2];
  const edgeCount = mapped[3];
  if (status !== STATUS_SUCCESS) {
    return {
      status,
      program: null,
      diagnostic: {
        start: mapped[4],
        end: mapped[5],
        subjectId: mapped[6],
        parameter0: mapped[7] | 0,
        parameter1: mapped[8] | 0,
      },
      submitAndReadbackMs,
      stagesMs,
    };
  }
  let offset = HEADER_WORDS;
  const tokens = new Int32Array(
    mapped.slice(offset, offset + tokenCount * TOKEN_WORDS).buffer,
  );
  offset += layout.tokenCapacity * TOKEN_WORDS;
  const nodes = new Int32Array(
    mapped.slice(offset, offset + nodeCount * NODE_WORDS).buffer,
  );
  offset += layout.nodeCapacity * NODE_WORDS;
  const edges = new Int32Array(
    mapped.slice(offset, offset + edgeCount * EDGE_WORDS).buffer,
  );
  return {
    status,
    program: {
      tokens,
      nodes,
      edges,
      symbols: new Int32Array(0),
      types: new Int32Array([0]),
    },
    diagnostic: null,
    submitAndReadbackMs,
    stagesMs,
  };
}

export {
  STATUS_DELIMITER,
  STATUS_DEPTH_CAPACITY,
  STATUS_EDGE_CAPACITY,
  STATUS_LEXICAL,
  STATUS_NODE_CAPACITY,
  STATUS_SYNTAX,
  STATUS_TOKEN_CAPACITY,
};

const ISLAND_EXECUTOR_WGSL = String.raw`
const HEADER_WORDS: u32 = 32u;
const TOKEN_WORDS: u32 = 4u;
const NODE_WORDS: u32 = 8u;
const EDGE_WORDS: u32 = 4u;

@group(0) @binding(0) var<storage, read> compact_records: array<u32>;
@group(0) @binding(1) var<storage, read> source_units: array<u32>;
@group(0) @binding(2) var<storage, read> plan: array<u32>;
@group(0) @binding(3) var<storage, read_write> arena: array<u32>;
@group(0) @binding(4) var<storage, read> lex_metadata: array<u32>;
@group(0) @binding(5) var<storage, read_write> candidates: array<atomic<u32>>;

struct DispatchParams {
  round: u32,
  count: u32,
  input_offset: u32,
  output_offset: u32,
  block_sums_offset: u32,
  mode: u32,
  parent_offset: u32,
  unused: u32,
}

@group(0) @binding(6) var<storage, read_write> scan_scratch: array<u32>;
@group(0) @binding(7) var<uniform> dispatch_params: DispatchParams;
@group(0) @binding(8) var<storage, read_write> candidate_tail: array<atomic<u32>>;
var<workgroup> scan_values: array<u32, 256>;

fn linear_invocation_index(invocation: vec3<u32>) -> u32 {
  return invocation.x + invocation.y * 65535u * 256u;
}

fn linear_workgroup_index(workgroup: vec3<u32>) -> u32 {
  return workgroup.x + workgroup.y * 65535u;
}

fn candidate_word(candidate: u32, word: u32) -> u32 {
  if (candidate < arena[24u]) {
    return atomicLoad(&candidates[candidate * ${CANDIDATE_WORDS}u + word]);
  }
  let tail_candidate = candidate - arena[24u];
  return atomicLoad(
    &candidate_tail[tail_candidate * ${CANDIDATE_WORDS}u + word],
  );
}

fn set_candidate_word(candidate: u32, word: u32, value: u32) {
  if (candidate < arena[24u]) {
    atomicStore(
      &candidates[candidate * ${CANDIDATE_WORDS}u + word],
      value,
    );
    return;
  }
  let tail_candidate = candidate - arena[24u];
  atomicStore(
    &candidate_tail[tail_candidate * ${CANDIDATE_WORDS}u + word],
    value,
  );
}

fn token_word(token: u32, word: u32) -> u32 {
  return arena[arena[13u] + token * TOKEN_WORDS + word];
}

fn terminal(token: u32) -> i32 {
  return bitcast<i32>(token_word(token, 0u));
}

fn source_unit(index: u32) -> u32 {
  let packed = source_units[index >> 1u];
  let shift = (index & 1u) * 16u;
  return (packed >> shift) & 0xffffu;
}

fn next_syntax(initial: u32, limit: u32) -> u32 {
  var cursor = initial;
  loop {
    if (cursor >= limit || terminal(cursor) >= 0) {
      return cursor;
    }
    cursor += 1u;
  }
  return cursor;
}

fn island_word(island: u32, word: u32) -> u32 {
  return plan[plan[3u] + island * 7u + word];
}

fn state_word(state: u32, word: u32) -> u32 {
  return plan[plan[4u] + state * 3u + word];
}

fn transition_word(transition: u32, word: u32) -> u32 {
  return plan[plan[5u] + transition * 4u + word];
}

fn dense_transition_word(state: u32, symbol: u32, table: u32) -> u32 {
  let index = state * plan[10u] + symbol;
  return plan[plan[table] + index];
}

fn fail(code: u32, start: u32, end: u32, subject: u32, p0: u32, p1: u32) {
  arena[0u] = code;
  arena[4u] = start;
  arena[5u] = end;
  arena[6u] = subject;
  arena[7u] = p0;
  arena[8u] = p1;
}

@compute @workgroup_size(256)
fn classify(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let compact_index = linear_invocation_index(invocation);
  let compact_count = lex_metadata[0u];
  if (compact_index >= compact_count) {
    return;
  }
  if (lex_metadata[1u] == 1u) {
    if (compact_index == 0u) {
      fail(4u, 0u, arena[23u], compact_count, compact_count, arena[9u]);
    }
    return;
  }
  let compact_base = compact_index * 2u;
  var source_start = 0u;
  if (compact_index > 0u) {
    source_start = compact_records[compact_base - 2u];
  }
  let source_end = compact_records[compact_base];
  let packed = compact_records[compact_base + 1u];
  let spec_plus_one = packed & 0xffffu;
  let token_base = arena[13u] + compact_index * TOKEN_WORDS;
  arena[token_base + 1u] = source_start;
  arena[token_base + 2u] = source_end;
  arena[arena[17u] + compact_index] = 0xffffffffu;
  if (spec_plus_one == 0u) {
    arena[token_base] = bitcast<u32>(-2i);
    arena[token_base + 3u] = 0xffffffffu;
    atomicMin(&candidates[0u], compact_index * 4u + 1u);
  } else {
    let spec = spec_plus_one - 1u;
    arena[token_base + 3u] = spec;
    if (spec >= plan[0u]) {
      arena[token_base] = bitcast<u32>(-3i);
      atomicMin(&candidates[0u], compact_index * 4u + 2u);
    } else {
      arena[token_base] = plan[plan[2u] + spec];
    }
  }
  if (compact_index == 0u) {
    arena[1u] = compact_count;
  }
}

@compute @workgroup_size(256)
fn delimiter_flags(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let token_index = linear_invocation_index(invocation);
  if (token_index >= arena[1u]) {
    return;
  }
  var expected_close = 0xffffffffu;
  var is_close = 0u;
  let token_terminal = terminal(token_index);
  if (token_terminal >= 0i) {
    var island = 0u;
    loop {
      if (island >= plan[1u]) {
        break;
      }
      let kind = island_word(island, 2u);
      if (kind == 1u || kind == 3u) {
        if (island_word(island, 3u) == u32(token_terminal)) {
          expected_close = island_word(island, 4u);
        }
        if (island_word(island, 4u) == u32(token_terminal)) {
          is_close = 1u;
        }
      }
      island += 1u;
    }
  }
  arena[arena[18u] + token_index] = expected_close;
  arena[arena[19u] + token_index] = is_close;
}

@compute @workgroup_size(256)
fn structure_tree_leaves(
  @builtin(global_invocation_id) invocation: vec3<u32>,
) {
  let index = linear_invocation_index(invocation);
  let tree_leaves = dispatch_params.block_sums_offset;
  if (index >= tree_leaves) {
    return;
  }
  var depth_after = 0xffffffffu;
  if (index < arena[1u]) {
    depth_after = scan_scratch[dispatch_params.input_offset + index];
    if (arena[arena[18u] + index] != 0xffffffffu) {
      depth_after += 1u;
    } else if (arena[arena[19u] + index] == 1u) {
      depth_after -= 1u;
    }
  }
  scan_scratch[
    dispatch_params.output_offset + tree_leaves + index
  ] = depth_after;
}

@compute @workgroup_size(256)
fn structure_tree_level(
  @builtin(global_invocation_id) invocation: vec3<u32>,
) {
  let index = linear_invocation_index(invocation);
  if (index >= dispatch_params.count) {
    return;
  }
  let left = scan_scratch[dispatch_params.input_offset + index * 2u];
  let right = scan_scratch[dispatch_params.input_offset + index * 2u + 1u];
  scan_scratch[dispatch_params.output_offset + index] = min(left, right);
}

fn structure_range_min(begin: u32, end: u32) -> u32 {
  let tree_offset = dispatch_params.output_offset;
  let tree_leaves = dispatch_params.block_sums_offset;
  var left = begin + tree_leaves;
  var right = end + tree_leaves;
  var result = 0xffffffffu;
  loop {
    if (left >= right) {
      return result;
    }
    if ((left & 1u) == 1u) {
      result = min(result, scan_scratch[tree_offset + left]);
      left += 1u;
    }
    if ((right & 1u) == 1u) {
      right -= 1u;
      result = min(result, scan_scratch[tree_offset + right]);
    }
    left /= 2u;
    right /= 2u;
  }
  return result;
}

@compute @workgroup_size(256)
fn match_delimiters(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let open_index = linear_invocation_index(invocation);
  if (open_index >= arena[1u]) {
    return;
  }
  let expected_close = arena[arena[18u] + open_index];
  if (expected_close == 0xffffffffu) {
    return;
  }
  let depth = scan_scratch[dispatch_params.input_offset + open_index];
  if (structure_range_min(open_index + 1u, arena[1u]) > depth) {
    atomicMin(&candidates[0u], open_index * 4u + 3u);
    return;
  }
  var low = open_index + 1u;
  var high = arena[1u];
  loop {
    if (low >= high) {
      break;
    }
    let middle = low + (high - low) / 2u;
    if (structure_range_min(open_index + 1u, middle + 1u) <= depth) {
      high = middle;
    } else {
      low = middle + 1u;
    }
  }
  let close_index = low;
  arena[arena[17u] + open_index] = close_index;
  arena[arena[17u] + close_index] = open_index;
  let actual_close = terminal(close_index);
  if (actual_close < 0i || u32(actual_close) != expected_close) {
    atomicMin(&candidates[0u], close_index * 4u + 3u);
  }
}

@compute @workgroup_size(256)
fn validate_delimiters(
  @builtin(global_invocation_id) invocation: vec3<u32>,
) {
  let token_index = linear_invocation_index(invocation);
  if (token_index >= arena[1u]) {
    return;
  }
  if (
    arena[arena[19u] + token_index] == 1u &&
    arena[arena[17u] + token_index] == 0xffffffffu
  ) {
    atomicMin(&candidates[0u], token_index * 4u + 3u);
  }
}

@compute @workgroup_size(1)
fn structure() {
  if (arena[0u] != 0u) {
    return;
  }
  let packed_error = atomicLoad(&candidates[0u]);
  if (packed_error == 0xffffffffu) {
    return;
  }
  let token_index = packed_error / 4u;
  let kind = packed_error & 3u;
  if (kind == 1u) {
    let start = token_word(token_index, 1u);
    var unit = 0u;
    if ((start >> 1u) < arrayLength(&source_units)) {
      unit = source_unit(start);
    }
    fail(
      1u,
      start,
      token_word(token_index, 2u),
      start,
      unit,
      0u,
    );
    return;
  }
  if (kind == 2u) {
    fail(
      3u,
      token_word(token_index, 1u),
      token_word(token_index, 2u),
      token_index,
      token_word(token_index, 3u),
      plan[0u],
    );
    return;
  }
  var expected = arena[arena[18u] + token_index];
  var actual = 0xffffffffu;
  let matched = arena[arena[17u] + token_index];
  if (arena[arena[19u] + token_index] == 1u) {
    actual = u32(terminal(token_index));
    if (matched != 0xffffffffu) {
      expected = arena[arena[18u] + matched];
    }
  } else if (matched != 0xffffffffu) {
    actual = u32(terminal(matched));
  }
  fail(
    2u,
    token_word(token_index, 1u),
    token_word(token_index, 2u),
    token_index,
    expected,
    actual,
  );
}

struct RegionSummary {
  accepted: u32,
  end: u32,
  events: u32,
  diagnostic_position: u32,
  diagnostic_context: u32,
}

fn summary_base(bank: u32) -> u32 {
  return 5u + bank * 5u;
}

fn diagnostic_value(island: u32, state: u32) -> u32 {
  return (island << 16u) | (state - island_word(island, 1u));
}

fn located_candidate_for_island(
  island: u32,
  initial: u32,
) -> u32 {
  let cursor = next_syntax(initial, arena[1u]);
  if (cursor >= arena[1u]) {
    return 0xffffffffu;
  }
  let token_terminal = terminal(cursor);
  if (token_terminal < 0i || u32(token_terminal) >= plan[11u]) {
    return 0xffffffffu;
  }
  let multiplicity = arena[22u];
  var slot = 0u;
  loop {
    if (slot >= multiplicity) {
      return 0xffffffffu;
    }
    let located = plan[
      plan[12u] + u32(token_terminal) * multiplicity + slot
    ];
    if (located == island + 1u) {
      let candidate = 1u + cursor * multiplicity + slot;
      if (candidate >= arena[20u]) {
        return 0xffffffffu;
      }
      return candidate;
    }
    slot += 1u;
  }
  return 0xffffffffu;
}

fn candidate_for_island(
  island: u32,
  initial: u32,
  bank: u32,
) -> u32 {
  let candidate = located_candidate_for_island(island, initial);
  if (
    candidate != 0xffffffffu &&
    candidate_word(candidate, summary_base(bank)) == 1u
  ) {
    return candidate;
  }
  return 0xffffffffu;
}

fn region_limit(island: u32, start: u32) -> u32 {
  let kind = island_word(island, 2u);
  if (kind == 1u || kind == 3u) {
    if (start >= arena[1u]) {
      return 0xffffffffu;
    }
    if (u32(terminal(start)) != island_word(island, 3u)) {
      return 0xffffffffu;
    }
    let close = arena[arena[17u] + start];
    if (close == 0xffffffffu) {
      return 0xffffffffu;
    }
    return close + 1u;
  }
  return arena[1u];
}

fn summarize_region(candidate: u32, read_bank: u32) -> RegionSummary {
  let island = candidate_word(candidate, 0u);
  var cursor = candidate_word(candidate, 1u);
  let limit = candidate_word(candidate, 15u);
  var state = island_word(island, 1u);
  var events = 0u;
  var farthest = cursor;
  var diagnostic_context = diagnostic_value(island, state);
  loop {
    cursor = next_syntax(cursor, limit);
    if (cursor < limit && cursor >= farthest) {
      farthest = cursor;
      diagnostic_context = diagnostic_value(island, state);
    }
    let transition_start = state_word(state, 1u);
    let transition_count = state_word(state, 2u);
    var transition_index = 0u;
    var child_candidate = 0xffffffffu;
    var child_target = 0xffffffffu;
    loop {
      if (transition_index >= transition_count) {
        break;
      }
      let transition = transition_start + transition_index;
      if (transition_word(transition, 0u) == 1u) {
        let child_island = transition_word(transition, 1u);
        let located = located_candidate_for_island(child_island, cursor);
        if (located != 0xffffffffu) {
          let child_base = summary_base(read_bank);
          let child_end = candidate_word(located, child_base + 1u);
          let child_farthest = candidate_word(located, child_base + 3u);
          if (child_farthest >= farthest) {
            farthest = child_farthest;
            diagnostic_context = candidate_word(located, child_base + 4u);
          }
          if (candidate_word(located, child_base) == 1u) {
            if (child_end > cursor && child_end <= limit) {
              child_candidate = located;
              child_target = transition_word(transition, 2u);
              break;
            }
          }
        }
      }
      transition_index += 1u;
    }
    if (child_candidate != 0xffffffffu) {
      if (candidate == 0u) {
        set_candidate_word(child_candidate, 2u, 1u);
      }
      cursor = candidate_word(
        child_candidate,
        summary_base(read_bank) + 1u,
      );
      state = child_target;
      events += 1u;
      continue;
    }

    if (cursor < limit) {
      let token_terminal = terminal(cursor);
      if (
        token_terminal >= 0i &&
        u32(token_terminal) < plan[11u] &&
        dense_transition_word(state, u32(token_terminal), 9u) == 1u
      ) {
        state = dense_transition_word(state, u32(token_terminal), 7u);
        cursor += 1u;
        events += 1u;
        continue;
      }
    }

    var accepted = state_word(state, 0u);
    let kind = island_word(island, 2u);
    if (
      accepted == 1u &&
      (kind == 1u || kind == 3u) &&
      next_syntax(cursor, limit) != limit
    ) {
      accepted = 0u;
    }
    if (accepted == 1u) {
      return RegionSummary(
        accepted,
        cursor,
        events,
        farthest,
        diagnostic_context,
      );
    }
    return RegionSummary(
      0u,
      cursor,
      events,
      farthest,
      diagnostic_context,
    );
  }
  return RegionSummary(0u, cursor, events, farthest, diagnostic_context);
}

@compute @workgroup_size(256)
fn regions(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let worker = linear_invocation_index(invocation);
  if (worker >= arena[9u]) {
    return;
  }
  let multiplicity = arena[22u];
  var candidate = 1u + worker * multiplicity;
  let candidate_end = candidate + multiplicity;
  if (worker == 0u) {
    candidate = 0u;
  }
  loop {
    var island = 0xffffffffu;
    var start = arena[1u];
    if (candidate == 0u) {
      island = plan[6u];
      start = next_syntax(0u, arena[1u]);
    } else {
      let token_index = (candidate - 1u) / multiplicity;
      let slot = (candidate - 1u) % multiplicity;
      if (token_index < arena[1u]) {
        let token_terminal = terminal(token_index);
        if (
          token_terminal >= 0i &&
          u32(token_terminal) < plan[11u]
        ) {
          let located = plan[
            plan[12u] + u32(token_terminal) * multiplicity + slot
          ];
          if (located > 1u) {
            island = located - 1u;
            start = token_index;
          }
        }
      }
    }
    set_candidate_word(candidate, 0u, island);
    set_candidate_word(candidate, 1u, start);
    set_candidate_word(candidate, 2u, 0u);
    set_candidate_word(candidate, 3u, 0xffffffffu);
    set_candidate_word(candidate, 4u, 0xffffffffu);
    var word = 5u;
    loop {
      if (word >= 15u) {
        break;
      }
      set_candidate_word(candidate, word, 0u);
      word += 1u;
    }
    var limit = 0xffffffffu;
    if (island != 0xffffffffu) {
      limit = region_limit(island, start);
    }
    set_candidate_word(candidate, 15u, limit);
    if (candidate == 0u) {
      candidate = 1u;
    } else {
      candidate += 1u;
    }
    if (candidate >= candidate_end) {
      return;
    }
  }
}

@compute @workgroup_size(256)
fn contract_regions(@builtin(global_invocation_id) invocation: vec3<u32>) {
  if (arena[0u] != 0u) {
    return;
  }
  let worker = linear_invocation_index(invocation);
  if (worker >= arena[9u]) {
    return;
  }
  let multiplicity = arena[22u];
  var candidate = 1u + worker * multiplicity;
  let candidate_end = candidate + multiplicity;
  if (worker == 0u) {
    candidate = 0u;
  }
  let read_bank = dispatch_params.round & 1u;
  let write_bank = 1u - read_bank;
  loop {
    if (
      candidate_word(candidate, 0u) != 0xffffffffu &&
      candidate_word(candidate, 15u) != 0xffffffffu
    ) {
      let read_base = summary_base(read_bank);
      let base = summary_base(write_bank);
      if (candidate_word(candidate, 4u) == 0xfffffffeu) {
        var summary_word = 0u;
        loop {
          if (summary_word >= 5u) {
            break;
          }
          set_candidate_word(
            candidate,
            base + summary_word,
            candidate_word(candidate, read_base + summary_word),
          );
          summary_word += 1u;
        }
      } else {
        let summary = summarize_region(candidate, read_bank);
        set_candidate_word(candidate, base, summary.accepted);
        set_candidate_word(candidate, base + 1u, summary.end);
        set_candidate_word(candidate, base + 2u, summary.events);
        set_candidate_word(candidate, base + 3u, summary.diagnostic_position);
        set_candidate_word(candidate, base + 4u, summary.diagnostic_context);
        if (summary.accepted == 1u) {
          let island = candidate_word(candidate, 0u);
          let boundary_kind = island_word(island, 2u);
          var complete = summary.end == arena[1u];
          if (boundary_kind == 1u || boundary_kind == 3u) {
            complete = true;
          } else if (boundary_kind == 2u && summary.end > 0u) {
            var previous = summary.end - 1u;
            loop {
              if (terminal(previous) >= 0i) {
                break;
              }
              if (previous == 0u) {
                break;
              }
              previous -= 1u;
            }
            complete = u32(terminal(previous)) == island_word(island, 4u);
          }
          if (complete) {
            set_candidate_word(candidate, 4u, 0xfffffffeu);
          }
        }
      }
    }
    if (candidate == 0u) {
      candidate = 1u;
    } else {
      candidate += 1u;
    }
    if (candidate >= candidate_end) {
      return;
    }
  }
}

@compute @workgroup_size(1)
fn validate_root() {
  if (arena[0u] != 0u) {
    return;
  }
  let final_bank = arena[21u] & 1u;
  let base = summary_base(final_bank);
  let accepted = candidate_word(0u, base);
  let end = candidate_word(0u, base + 1u);
  if (accepted == 1u && next_syntax(end, arena[1u]) == arena[1u]) {
    set_candidate_word(0u, 2u, 1u);
    set_candidate_word(0u, 3u, 0xfffffffeu);
    return;
  }
  var start = 0u;
  var finish = 0u;
  let rejected = candidate_word(0u, base + 3u);
  if (rejected < arena[1u]) {
    start = token_word(rejected, 1u);
    finish = token_word(rejected, 2u);
  }
  fail(
    3u,
    start,
    finish,
    scan_scratch[rejected],
    candidate_word(0u, base + 4u) >> 16u,
    candidate_word(0u, base + 4u) & 0xffffu,
  );
}

fn mark_region_children(candidate: u32, bank: u32) {
  let island = candidate_word(candidate, 0u);
  var cursor = candidate_word(candidate, 1u);
  let limit = candidate_word(candidate, 15u);
  var state = island_word(island, 1u);
  loop {
    cursor = next_syntax(cursor, limit);
    let transition_start = state_word(state, 1u);
    let transition_count = state_word(state, 2u);
    var transition_index = 0u;
    var child_candidate = 0xffffffffu;
    var child_target = 0xffffffffu;
    loop {
      if (transition_index >= transition_count) {
        break;
      }
      let transition = transition_start + transition_index;
      if (transition_word(transition, 0u) == 1u) {
        let located = candidate_for_island(
          transition_word(transition, 1u),
          cursor,
          bank,
        );
        if (located != 0xffffffffu) {
          let child_end = candidate_word(
            located,
            summary_base(bank) + 1u,
          );
          if (child_end > cursor && child_end <= limit) {
            child_candidate = located;
            child_target = transition_word(transition, 2u);
            break;
          }
        }
      }
      transition_index += 1u;
    }
    if (child_candidate != 0xffffffffu) {
      set_candidate_word(child_candidate, 2u, 1u);
      cursor = candidate_word(
        child_candidate,
        summary_base(bank) + 1u,
      );
      state = child_target;
      continue;
    }
    if (cursor < limit) {
      let token_terminal = terminal(cursor);
      if (
        token_terminal >= 0i &&
        u32(token_terminal) < plan[11u] &&
        dense_transition_word(state, u32(token_terminal), 9u) == 1u
      ) {
        state = dense_transition_word(state, u32(token_terminal), 7u);
        cursor += 1u;
        continue;
      }
    }
    return;
  }
}

@compute @workgroup_size(256)
fn reachability(@builtin(global_invocation_id) invocation: vec3<u32>) {
  if (arena[0u] != 0u) {
    return;
  }
  let worker = linear_invocation_index(invocation);
  if (worker >= arena[9u]) {
    return;
  }
  let multiplicity = arena[22u];
  var candidate = 1u + worker * multiplicity;
  let candidate_end = candidate + multiplicity;
  if (worker == 0u) {
    candidate = 0u;
  }
  loop {
    if (
      candidate_word(candidate, 2u) == 1u &&
      candidate_word(candidate, 3u) == 0xffffffffu
    ) {
      mark_region_children(candidate, arena[21u] & 1u);
      set_candidate_word(candidate, 3u, 0xfffffffeu);
    }
    if (candidate == 0u) {
      candidate = 1u;
    } else {
      candidate += 1u;
    }
    if (candidate >= candidate_end) {
      return;
    }
  }
}

fn candidate_span_start(candidate: u32) -> u32 {
  let start = candidate_word(candidate, 1u);
  if (start < arena[1u]) {
    return token_word(start, 1u);
  }
  return 0u;
}

fn candidate_span_end(candidate: u32, bank: u32) -> u32 {
  var cursor = candidate_word(candidate, summary_base(bank) + 1u);
  loop {
    if (cursor == 0u) {
      return candidate_span_start(candidate);
    }
    cursor -= 1u;
    if (terminal(cursor) >= 0i) {
      return token_word(cursor, 2u);
    }
  }
  return candidate_span_start(candidate);
}

@compute @workgroup_size(256)
fn scan_level(
  @builtin(local_invocation_index) lane: u32,
  @builtin(workgroup_id) workgroup: vec3<u32>,
) {
  if (arena[0u] != 0u) {
    return;
  }
  let index = linear_workgroup_index(workgroup) * 256u + lane;
  var value = 0u;
  if (index < dispatch_params.count) {
    if (dispatch_params.mode == 0u) {
      value = candidate_word(index, 2u);
    } else if (dispatch_params.mode == 1u) {
      if (candidate_word(index, 2u) == 1u) {
        value = candidate_word(
          index,
          summary_base(arena[21u] & 1u) + 2u,
        );
      }
    } else if (dispatch_params.mode == 2u) {
      value = scan_scratch[dispatch_params.input_offset + index];
    } else if (dispatch_params.mode == 3u && index < arena[1u]) {
      if (arena[arena[18u] + index] != 0xffffffffu) {
        value = 1u;
      } else if (arena[arena[19u] + index] == 1u) {
        value = 0xffffffffu;
      }
    } else if (dispatch_params.mode == 4u && index < arena[1u]) {
      if (terminal(index) >= 0i) {
        value = 1u;
      }
    }
  }
  scan_values[lane] = value;
  workgroupBarrier();

  var stride = 1u;
  loop {
    let position = (lane + 1u) * stride * 2u - 1u;
    if (position < 256u) {
      scan_values[position] += scan_values[position - stride];
    }
    workgroupBarrier();
    if (stride == 128u) {
      break;
    }
    stride *= 2u;
  }
  if (lane == 255u) {
    scan_scratch[
      dispatch_params.block_sums_offset + linear_workgroup_index(workgroup)
    ] = scan_values[255u];
    scan_values[255u] = 0u;
  }
  workgroupBarrier();

  stride = 128u;
  loop {
    let position = (lane + 1u) * stride * 2u - 1u;
    if (position < 256u) {
      let left = scan_values[position - stride];
      scan_values[position - stride] = scan_values[position];
      scan_values[position] += left;
    }
    workgroupBarrier();
    if (stride == 1u) {
      break;
    }
    stride /= 2u;
  }
  if (index < dispatch_params.count) {
    scan_scratch[dispatch_params.output_offset + index] = scan_values[lane];
  }
}

@compute @workgroup_size(256)
fn add_scan_offsets(@builtin(global_invocation_id) invocation: vec3<u32>) {
  if (arena[0u] != 0u) {
    return;
  }
  let index = linear_invocation_index(invocation);
  if (index >= dispatch_params.count) {
    return;
  }
  let block = index / 256u;
  if (block == 0u) {
    return;
  }
  scan_scratch[dispatch_params.output_offset + index] +=
    scan_scratch[dispatch_params.parent_offset + block];
}

@compute @workgroup_size(256)
fn finalize_offsets(@builtin(global_invocation_id) invocation: vec3<u32>) {
  if (arena[0u] != 0u) {
    return;
  }
  let candidate = linear_invocation_index(invocation);
  let total = scan_scratch[dispatch_params.block_sums_offset];
  if (candidate == 0u) {
    var capacity = arena[11u];
    var code = 5u;
    if (dispatch_params.mode == 1u) {
      capacity = arena[12u];
      code = 6u;
    }
    if (total > capacity) {
      fail(
        code,
        candidate_span_start(0u),
        candidate_span_end(0u, arena[21u] & 1u),
        total,
        total,
        capacity,
      );
    }
    if (dispatch_params.mode == 0u) {
      arena[2u] = total;
    } else {
      arena[3u] = total;
    }
  }
  if (
    candidate >= dispatch_params.count ||
    candidate_word(candidate, 2u) == 0u
  ) {
    return;
  }
  let offset = scan_scratch[dispatch_params.output_offset + candidate];
  if (dispatch_params.mode == 0u) {
    set_candidate_word(candidate, 3u, offset);
  } else {
    set_candidate_word(candidate, 4u, offset);
  }
}

fn emit_region(candidate: u32, bank: u32) {
  let node = candidate_word(candidate, 3u);
  let island = candidate_word(candidate, 0u);
  let event_count = candidate_word(candidate, summary_base(bank) + 2u);
  let edge_offset = candidate_word(candidate, 4u);
  let node_base = arena[14u] + node * NODE_WORDS;
  arena[node_base] = island_word(island, 0u);
  arena[node_base + 1u] = 0u;
  arena[node_base + 2u] = candidate_span_start(candidate);
  arena[node_base + 3u] = candidate_span_end(candidate, bank);
  arena[node_base + 4u] = edge_offset;
  arena[node_base + 5u] = event_count;
  arena[node_base + 6u] = 0xffffffffu;
  arena[node_base + 7u] = 0xffffffffu;

  var cursor = candidate_word(candidate, 1u);
  let limit = candidate_word(candidate, 15u);
  var state = island_word(island, 1u);
  var ordinal = 0u;
  loop {
    if (ordinal >= event_count) {
      return;
    }
    cursor = next_syntax(cursor, limit);
    let transition_start = state_word(state, 1u);
    let transition_count = state_word(state, 2u);
    var transition_index = 0u;
    var child_candidate = 0xffffffffu;
    var child_target = 0xffffffffu;
    var child_field = 0xffffffffu;
    loop {
      if (transition_index >= transition_count) {
        break;
      }
      let transition = transition_start + transition_index;
      if (transition_word(transition, 0u) == 1u) {
        let located = candidate_for_island(
          transition_word(transition, 1u),
          cursor,
          bank,
        );
        if (located != 0xffffffffu) {
          let child_end = candidate_word(
            located,
            summary_base(bank) + 1u,
          );
          if (child_end > cursor && child_end <= limit) {
            child_candidate = located;
            child_target = transition_word(transition, 2u);
            child_field = transition_word(transition, 3u);
            break;
          }
        }
      }
      transition_index += 1u;
    }
    let edge_base = arena[16u] + (edge_offset + ordinal) * EDGE_WORDS;
    if (child_candidate != 0xffffffffu) {
      arena[edge_base] = child_field;
      arena[edge_base + 1u] = ordinal;
      arena[edge_base + 2u] = 1u;
      arena[edge_base + 3u] = candidate_word(child_candidate, 3u);
      cursor = candidate_word(
        child_candidate,
        summary_base(bank) + 1u,
      );
      state = child_target;
    } else {
      let token_terminal = u32(terminal(cursor));
      arena[edge_base] = dense_transition_word(
        state,
        token_terminal,
        8u,
      );
      arena[edge_base + 1u] = ordinal;
      arena[edge_base + 2u] = 0u;
      arena[edge_base + 3u] = cursor;
      state = dense_transition_word(state, token_terminal, 7u);
      cursor += 1u;
    }
    ordinal += 1u;
  }
}

@compute @workgroup_size(256)
fn emit(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let candidate = linear_invocation_index(invocation);
  if (
    arena[0u] != 0u ||
    candidate >= arena[20u] ||
    candidate_word(candidate, 2u) == 0u
  ) {
    return;
  }
  emit_region(candidate, arena[21u] & 1u);
}

@compute @workgroup_size(256)
fn staging(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let output = linear_invocation_index(invocation);
  if (output < HEADER_WORDS) {
    atomicStore(&candidate_tail[output], arena[output]);
    return;
  }
  var relative = output - HEADER_WORDS;
  let token_words = arena[10u] * TOKEN_WORDS;
  if (relative < token_words) {
    atomicStore(&candidate_tail[output], arena[arena[13u] + relative]);
    return;
  }
  relative -= token_words;
  let node_words = arena[11u] * NODE_WORDS;
  if (relative < node_words) {
    atomicStore(&candidate_tail[output], arena[arena[14u] + relative]);
    return;
  }
  relative -= node_words;
  let edge_words = arena[12u] * EDGE_WORDS;
  if (relative < edge_words) {
    atomicStore(&candidate_tail[output], arena[arena[16u] + relative]);
  }
}
`;
