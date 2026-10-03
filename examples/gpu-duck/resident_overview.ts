import type {
  GpuResidentFrontendLayout,
  GpuResidentFrontendResult,
} from "../../src/runtime/webgpu/frontend.ts";

const SUMMARY_BYTES = 48;
const PARAMETER_BYTES = 64;
const INVALID_COUNTS_STATUS = 0xffff_ffff;

export interface ResidentOverviewOptions {
  readonly width: number;
  readonly height: number;
  readonly sourceLength: number;
  /** Number of rule IDs used to arrange the lower span lanes. */
  readonly ruleCount: number;
  /** Number of lexer specifications used to group token colors. */
  readonly specCount: number;
}

export interface ResidentOverviewExecution {
  /**
   * First four u32: status, token count, node count, edge count. The remaining
   * words contain two drawIndirect argument structs. Syntax failures suppress
   * both draws; impossible success counts report status 0xffffffff.
   */
  readonly summaryBuffer: GPUBuffer;
  readonly summaryByteLength: 48;
  readonly tokenDrawOffsetBytes: 16;
  readonly nodeDrawOffsetBytes: 32;
  /** Destroy per-call resources after the submitted consumer has completed. */
  dispose(): void;
}

/**
 * A syntax overview, with token spans above lanes of rule spans. Colors identify
 * numeric categories; this consumer performs no semantic validation.
 *
 * Pipelines are immutable. Every encode allocates independent parameters and
 * draw arguments, so calls may be submitted together without sharing scratch.
 * The caller owns the target texture and resident IR, submits to this device's
 * queue, and keeps both alive until consumer completion. Guard encode, finish
 * and submit with GPU error scopes; completion alone does not report validation
 * failures. Reading the 16-byte summary is optional and never reads back the IR.
 */
export class ResidentSyntaxOverviewRenderer {
  readonly #device: GPUDevice;
  readonly #computeLayout: GPUBindGroupLayout;
  readonly #renderLayout: GPUBindGroupLayout;
  readonly #preparePipeline: GPUComputePipeline;
  readonly #tokenPipeline: GPURenderPipeline;
  readonly #nodePipeline: GPURenderPipeline;

  private constructor(
    device: GPUDevice,
    computeLayout: GPUBindGroupLayout,
    renderLayout: GPUBindGroupLayout,
    preparePipeline: GPUComputePipeline,
    tokenPipeline: GPURenderPipeline,
    nodePipeline: GPURenderPipeline,
  ) {
    this.#device = device;
    this.#computeLayout = computeLayout;
    this.#renderLayout = renderLayout;
    this.#preparePipeline = preparePipeline;
    this.#tokenPipeline = tokenPipeline;
    this.#nodePipeline = nodePipeline;
  }

  static async create(
    device: GPUDevice,
    format: GPUTextureFormat = "rgba8unorm",
  ): Promise<ResidentSyntaxOverviewRenderer> {
    device.pushErrorScope("validation");
    device.pushErrorScope("out-of-memory");
    let renderer: ResidentSyntaxOverviewRenderer | undefined;
    let setupFailure: { readonly cause: unknown } | undefined;
    let oomResult: Promise<GPUError | null>;
    let validationResult: Promise<GPUError | null>;
    try {
      const module = device.createShaderModule({
        code: OVERVIEW_SHADER,
        label: "Baba resident syntax overview",
      });
      const renderEntries: GPUBindGroupLayoutEntry[] = [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX,
          buffer: { type: "uniform", minBindingSize: PARAMETER_BYTES },
        },
      ];
      const renderLayout = device.createBindGroupLayout({
        entries: renderEntries,
      });
      // Keep the indirect buffer out of the render bind group. Its writable
      // compute binding must not conflict with indirect use in a render pass.
      const computeLayout = device.createBindGroupLayout({
        entries: [
          ...renderEntries,
          {
            binding: 2,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "storage", minBindingSize: SUMMARY_BYTES },
          },
        ],
      });
      const preparePipeline = device.createComputePipeline({
        layout: device.createPipelineLayout({
          bindGroupLayouts: [computeLayout],
        }),
        compute: { module, entryPoint: "prepare_draws" },
        label: "Baba resident overview draw counts",
      });
      const renderPipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [renderLayout],
      });
      const tokenPipeline = device.createRenderPipeline({
        layout: renderPipelineLayout,
        vertex: { module, entryPoint: "token_vertex" },
        fragment: {
          module,
          entryPoint: "span_fragment",
          targets: [{ format }],
        },
        primitive: { topology: "triangle-list" },
        label: "Baba resident token spans",
      });
      const nodePipeline = device.createRenderPipeline({
        layout: renderPipelineLayout,
        vertex: { module, entryPoint: "node_vertex" },
        fragment: {
          module,
          entryPoint: "span_fragment",
          targets: [{ format }],
        },
        primitive: { topology: "triangle-list" },
        label: "Baba resident rule spans",
      });
      renderer = new ResidentSyntaxOverviewRenderer(
        device,
        computeLayout,
        renderLayout,
        preparePipeline,
        tokenPipeline,
        nodePipeline,
      );
    } catch (cause) {
      setupFailure = { cause };
    } finally {
      // Device scopes form a shared stack; close it before awaiting setup.
      oomResult = device.popErrorScope();
      validationResult = device.popErrorScope();
    }
    const scopeResults = await Promise.allSettled([
      oomResult,
      validationResult,
    ]);
    if (setupFailure !== undefined) {
      throw setupFailure.cause;
    }
    for (const result of scopeResults) {
      if (result.status === "rejected") {
        throw result.reason;
      }
      if (result.value !== null) {
        throw new Error(
          `Resident overview setup failed: ${result.value.message}`,
        );
      }
    }
    expect(renderer, "Successful overview setup must create its pipelines.");
    return renderer;
  }

  encode(
    encoder: GPUCommandEncoder,
    resident: Pick<GpuResidentFrontendResult, "buffer" | "layout">,
    targetView: GPUTextureView,
    options: ResidentOverviewOptions,
  ): ResidentOverviewExecution {
    const { layout } = resident;
    assertLayout(resident.buffer, layout);
    for (const key of ["width", "height", "ruleCount", "specCount"] as const) {
      assertU32(options[key], key, 1);
    }
    assertU32(options.sourceLength, "sourceLength", 0);
    if (
      options.width > this.#device.limits.maxTextureDimension2D ||
      options.height > this.#device.limits.maxTextureDimension2D
    ) {
      throw new RangeError("Overview dimensions exceed maxTextureDimension2D.");
    }
    let parameters: GPUBuffer | undefined;
    let summaryBuffer: GPUBuffer | undefined;
    try {
      parameters = this.#device.createBuffer({
        size: PARAMETER_BYTES,
        usage: GPUBufferUsage.UNIFORM,
        mappedAtCreation: true,
        label: "Baba resident overview parameters",
      });
      new Uint32Array(parameters.getMappedRange()).set([
        layout.statusWord,
        layout.tokenCountWord,
        layout.nodeCountWord,
        layout.edgeCountWord,
        layout.tokenOffsetWords,
        layout.nodeOffsetWords,
        layout.tokenCapacity,
        layout.nodeCapacity,
        layout.edgeCapacity,
        options.sourceLength,
        options.ruleCount,
        options.specCount,
        options.width,
        options.height,
        0,
        0,
      ]);
      parameters.unmap();
      summaryBuffer = this.#device.createBuffer({
        size: SUMMARY_BYTES,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT |
          GPUBufferUsage.COPY_SRC,
        label: "Baba resident overview summary and draws",
      });
      const renderEntries: GPUBindGroupEntry[] = [
        {
          binding: 0,
          resource: { buffer: resident.buffer, size: layout.byteLength },
        },
        { binding: 1, resource: { buffer: parameters } },
      ];
      const computeGroup = this.#device.createBindGroup({
        layout: this.#computeLayout,
        entries: [
          ...renderEntries,
          { binding: 2, resource: { buffer: summaryBuffer } },
        ],
      });
      const renderGroup = this.#device.createBindGroup({
        layout: this.#renderLayout,
        entries: renderEntries,
      });
      const prepare = encoder.beginComputePass({
        label: "Baba resident overview prepare",
      });
      prepare.setPipeline(this.#preparePipeline);
      prepare.setBindGroup(0, computeGroup);
      prepare.dispatchWorkgroups(1);
      prepare.end();
      const render = encoder.beginRenderPass({
        label: "Baba resident syntax overview",
        colorAttachments: [{
          view: targetView,
          clearValue: { r: 0.025, g: 0.035, b: 0.055, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      render.setViewport(0, 0, options.width, options.height, 0, 1);
      render.setScissorRect(0, 0, options.width, options.height);
      render.setBindGroup(0, renderGroup);
      render.setPipeline(this.#tokenPipeline);
      render.drawIndirect(summaryBuffer, 16);
      render.setPipeline(this.#nodePipeline);
      render.drawIndirect(summaryBuffer, 32);
      render.end();
    } catch (error) {
      if (parameters !== undefined) {
        parameters.destroy();
      }
      if (summaryBuffer !== undefined) {
        summaryBuffer.destroy();
      }
      throw error;
    }
    const ownedParameters = parameters;
    const ownedSummary = summaryBuffer;
    let disposed = false;
    return {
      summaryBuffer: ownedSummary,
      summaryByteLength: SUMMARY_BYTES,
      tokenDrawOffsetBytes: 16,
      nodeDrawOffsetBytes: 32,
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        ownedParameters.destroy();
        ownedSummary.destroy();
      },
    };
  }
}

function expect(value: unknown, message: string): asserts value {
  if (!value) {
    throw new Error(message);
  }
}

function assertU32(value: number, name: string, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > 0xffff_ffff) {
    throw new RangeError(
      `${name} must be an integer in [${minimum}, 4294967295].`,
    );
  }
}

function assertLayout(
  buffer: GPUBuffer,
  layout: GpuResidentFrontendLayout,
): void {
  if ((buffer.usage & GPUBufferUsage.STORAGE) === 0) {
    throw new Error("Resident overview requires a storage buffer.");
  }
  assertU32(layout.byteLength, "layout.byteLength", 16);
  assertU32(layout.headerWords, "layout.headerWords", 4);
  if (layout.byteLength % 4 !== 0 || layout.byteLength > buffer.size) {
    throw new RangeError("Resident overview layout exceeds its buffer.");
  }
  for (
    const key of [
      "statusWord",
      "tokenCountWord",
      "nodeCountWord",
      "edgeCountWord",
    ] as const
  ) {
    assertU32(layout[key], `layout.${key}`, 0);
    if (layout[key] >= layout.headerWords) {
      throw new RangeError(
        `layout.${key} lies outside the status/count header.`,
      );
    }
  }
  for (
    const key of [
      "tokenOffsetWords",
      "nodeOffsetWords",
      "edgeOffsetWords",
      "tokenCapacity",
      "nodeCapacity",
      "edgeCapacity",
    ] as const
  ) {
    assertU32(layout[key], `layout.${key}`, 0);
  }
  if (
    layout.tokenOffsetWords < layout.headerWords ||
    layout.nodeOffsetWords <
      layout.tokenOffsetWords + layout.tokenCapacity * 4 ||
    layout.edgeOffsetWords < layout.nodeOffsetWords + layout.nodeCapacity * 8 ||
    (layout.edgeOffsetWords + layout.edgeCapacity * 4) * 4 > layout.byteLength
  ) {
    throw new RangeError(
      "Resident overview sections overlap or exceed the layout.",
    );
  }
}

const OVERVIEW_SHADER = /* wgsl */ `
struct Parameters {
  status_word: u32,
  token_count_word: u32,
  node_count_word: u32,
  edge_count_word: u32,
  token_offset: u32,
  node_offset: u32,
  token_capacity: u32,
  node_capacity: u32,
  edge_capacity: u32,
  source_length: u32,
  rule_count: u32,
  spec_count: u32,
  width: u32,
  height: u32,
  padding_0: u32,
  padding_1: u32,
}

@group(0) @binding(0) var<storage, read> ir: array<u32>;
@group(0) @binding(1) var<uniform> params: Parameters;
@group(0) @binding(2) var<storage, read_write> summary: array<u32>;

@compute @workgroup_size(1)
fn prepare_draws() {
  var status = ir[params.status_word];
  let token_count = ir[params.token_count_word];
  let node_count = ir[params.node_count_word];
  let edge_count = ir[params.edge_count_word];
  var token_instances = 0u;
  var node_instances = 0u;
  if (status == 0u) {
    if (token_count > params.token_capacity ||
        node_count > params.node_capacity ||
        edge_count > params.edge_capacity) {
      status = ${INVALID_COUNTS_STATUS}u;
    } else {
      token_instances = token_count;
      node_instances = node_count;
    }
  }
  summary[0u] = status;
  summary[1u] = token_count;
  summary[2u] = node_count;
  summary[3u] = edge_count;
  summary[4u] = 6u;
  summary[5u] = token_instances;
  summary[6u] = 0u;
  summary[7u] = 0u;
  summary[8u] = 6u;
  summary[9u] = node_instances;
  summary[10u] = 0u;
  summary[11u] = 0u;
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
}

fn category_color(category: u32) -> vec4<f32> {
  let bits = category * 1664525u + 1013904223u;
  return vec4<f32>(
    0.30 + 0.65 * f32(bits & 255u) / 255.0,
    0.30 + 0.65 * f32((bits >> 8u) & 255u) / 255.0,
    0.30 + 0.65 * f32((bits >> 16u) & 255u) / 255.0,
    1.0,
  );
}

fn span_vertex(vertex: u32, start: u32, end: u32,
               top: f32, bottom: f32, color: vec4<f32>) -> VertexOutput {
  let bounded_start = min(start, params.source_length);
  let bounded_end = min(end, params.source_length);
  let denominator = f32(max(params.source_length, 1u));
  let left = f32(bounded_start) / denominator;
  var right = left;
  if (bounded_end > bounded_start) {
    right = min(1.0, max(f32(bounded_end) / denominator,
                         left + 1.0 / f32(params.width)));
  }
  var corner = vec2<f32>(0.0, 0.0);
  switch vertex {
    case 1u, 4u: { corner = vec2<f32>(1.0, 0.0); }
    case 2u, 3u: { corner = vec2<f32>(0.0, 1.0); }
    case 5u: { corner = vec2<f32>(1.0, 1.0); }
    default: {}
  }
  let x = mix(left, right, corner.x);
  let y = mix(top, bottom, corner.y);
  var output: VertexOutput;
  output.position = vec4<f32>(2.0 * x - 1.0, 1.0 - 2.0 * y, 0.0, 1.0);
  output.color = color;
  return output;
}

@vertex
fn token_vertex(@builtin(vertex_index) vertex: u32,
                @builtin(instance_index) instance: u32) -> VertexOutput {
  let base = params.token_offset + instance * 4u;
  let spec = ir[base + 3u] % params.spec_count;
  return span_vertex(vertex, ir[base + 1u], ir[base + 2u],
                     0.04, 0.24, category_color(spec));
}

@vertex
fn node_vertex(@builtin(vertex_index) vertex: u32,
               @builtin(instance_index) instance: u32) -> VertexOutput {
  let base = params.node_offset + instance * 8u;
  let rule = ir[base] % params.rule_count;
  let lane_height = 0.60 / f32(params.rule_count);
  let top = 0.34 + f32(rule) * lane_height;
  let gap = min(lane_height * 0.2, 1.0 / f32(params.height));
  return span_vertex(vertex, ir[base + 2u], ir[base + 3u],
                     top, top + lane_height - gap, category_color(rule + 97u));
}

@fragment
fn span_fragment(input: VertexOutput) -> @location(0) vec4<f32> {
  return input.color;
}
`;
