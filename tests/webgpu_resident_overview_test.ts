import { assert, assertEquals, compile, parseMetadata } from "./helpers.ts";
import {
  type CompactFrontendProgram,
  CpuFrontend,
  type GpuResidentFrontendLayout,
  type GpuResidentFrontendResult,
  WebGpuRuntime,
} from "../src/runtime/webgpu/mod.ts";
import { ResidentSyntaxOverviewRenderer } from "../examples/gpu-duck/resident_overview.ts";

function overviewPlan(): Uint8Array {
  const built = compile(
    String.raw`
      skip WS = /[ \t\r\n]+/ ;
      module = items:item* ;
      item = "x" ";" ;
    `,
    {
      name: "resident_overview_test",
      rootRule: "module",
      metadata: parseMetadata(JSON.stringify({
        version: 2,
        gpuFrontend: {
          version: 3,
          throughput: "strict",
          root: "module",
          islands: [
            { rule: "module", boundary: { kind: "root" } },
            {
              rule: "item",
              boundary: { kind: "terminated", terminal: ";" },
            },
          ],
          semantics: { rules: {} },
        },
      })),
      targets: ["wasm"],
    },
  );
  assert(
    built.bundle,
    built.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
  );
  const plan = built.bundle.files.find((file) =>
    file.path === "wasm/parser.plan"
  );
  assert(plan, "Expected parser.plan for the resident overview test.");
  assertEquals(plan.encoding, "binary");
  return plan.content as Uint8Array;
}

function uploadProgram(
  device: GPUDevice,
  program: CompactFrontendProgram,
  layout: GpuResidentFrontendLayout,
): GpuResidentFrontendResult {
  const words = new Int32Array(
    layout.byteLength / Int32Array.BYTES_PER_ELEMENT,
  );
  // Unpopulated records deliberately differ from the reused frontend buffer.
  words.fill(-1);
  words[layout.statusWord] = 0;
  words[layout.tokenCountWord] = program.tokens.length / 4;
  words[layout.nodeCountWord] = program.nodes.length / 8;
  words[layout.edgeCountWord] = program.edges.length / 4;
  words.set(program.tokens, layout.tokenOffsetWords);
  words.set(program.nodes, layout.nodeOffsetWords);
  words.set(program.edges, layout.edgeOffsetWords);
  const buffer = device.createBuffer({
    label: "CPU syntax IR uploaded for resident overview parity",
    size: layout.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, words);
  return {
    buffer,
    layout,
    timings: { uploadMs: 0, submitMs: 0, totalMs: 0 },
    dispose: () => buffer.destroy(),
  };
}

async function renderReadback(
  device: GPUDevice,
  overview: ResidentSyntaxOverviewRenderer,
  resident: GpuResidentFrontendResult,
  sourceLength: number,
  specCount: number,
): Promise<{ readonly pixels: Uint8Array; readonly summary: Uint32Array }> {
  const width = 128;
  const height = 64;
  const bytesPerRow = width * 4;
  const texture = device.createTexture({
    label: "Resident syntax overview parity target",
    size: { width, height },
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const imageReadback = device.createBuffer({
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const summaryReadback = device.createBuffer({
    size: 48,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  let encoded: ReturnType<ResidentSyntaxOverviewRenderer["encode"]> | undefined;
  let imageMapped = false;
  let summaryMapped = false;
  try {
    device.pushErrorScope("validation");
    device.pushErrorScope("out-of-memory");
    let oomResult: Promise<GPUError | null>;
    let validationResult: Promise<GPUError | null>;
    try {
      const encoder = device.createCommandEncoder();
      encoded = overview.encode(encoder, resident, texture.createView(), {
        width,
        height,
        sourceLength,
        ruleCount: 2,
        specCount,
      });
      encoder.copyTextureToBuffer(
        { texture },
        { buffer: imageReadback, bytesPerRow, rowsPerImage: height },
        { width, height },
      );
      encoder.copyBufferToBuffer(
        encoded.summaryBuffer,
        0,
        summaryReadback,
        0,
        48,
      );
      device.queue.submit([encoder.finish()]);
    } finally {
      oomResult = device.popErrorScope();
      validationResult = device.popErrorScope();
    }
    const scopes = Promise.all([oomResult, validationResult]);
    await Promise.all([
      imageReadback.mapAsync(GPUMapMode.READ).then(() => {
        imageMapped = true;
      }),
      summaryReadback.mapAsync(GPUMapMode.READ).then(() => {
        summaryMapped = true;
      }),
    ]);
    const [oom, validation] = await scopes;
    assertEquals(oom, null, "Resident overview exceeded device memory.");
    assertEquals(
      validation,
      null,
      "Resident overview produced a validation error.",
    );
    return {
      pixels: new Uint8Array(imageReadback.getMappedRange()).slice(),
      summary: new Uint32Array(summaryReadback.getMappedRange()).slice(),
    };
  } finally {
    if (imageMapped) {
      imageReadback.unmap();
    }
    if (summaryMapped) {
      summaryReadback.unmap();
    }
    if (encoded !== undefined) {
      encoded.dispose();
    }
    imageReadback.destroy();
    summaryReadback.destroy();
    texture.destroy();
  }
}

Deno.test({
  name:
    "resident syntax overview matches uploaded CPU IR and suppresses failed syntax after reuse",
  fn: async () => {
    if (
      typeof navigator === "undefined" ||
      navigator.gpu === undefined ||
      await navigator.gpu.requestAdapter() === null
    ) {
      return;
    }
    const plan = overviewPlan();
    const cpu = CpuFrontend.create(plan);
    const runtime = await WebGpuRuntime.create({ allowFallbackAdapter: true });
    try {
      const frontend = await runtime.compileFrontend(plan);
      const overview = await ResidentSyntaxOverviewRenderer.create(
        runtime.device,
      );
      const largeSource = "x;\n".repeat(300);
      let populatedPixels: Uint8Array | undefined;
      for (
        const source of [largeSource, "x;", "", " ".repeat(largeSource.length)]
      ) {
        const expected = cpu.ingest(source);
        assert(expected.ok);
        const resident = await frontend.ingestResident(source);
        try {
          const rendered = await renderReadback(
            runtime.device,
            overview,
            resident,
            source.length,
            frontend.plan.terminalClassification.length,
          );
          assertEquals(rendered.summary[0], 0);
          assertEquals(rendered.summary[1], expected.program.tokens.length / 4);
          assertEquals(rendered.summary[2], expected.program.nodes.length / 8);
          assertEquals(rendered.summary[3], expected.program.edges.length / 4);
          assertEquals(
            rendered.summary.subarray(4, 8).join(","),
            [6, expected.program.tokens.length / 4, 0, 0].join(","),
          );
          assertEquals(
            rendered.summary.subarray(8, 12).join(","),
            [6, expected.program.nodes.length / 8, 0, 0].join(","),
          );
          const uploaded = uploadProgram(
            runtime.device,
            expected.program,
            resident.layout,
          );
          try {
            const uploadedRender = await renderReadback(
              runtime.device,
              overview,
              uploaded,
              source.length,
              frontend.plan.terminalClassification.length,
            );
            assertEquals(
              rendered.summary.join(","),
              uploadedRender.summary.join(","),
            );
            assertEquals(
              rendered.pixels.join(","),
              uploadedRender.pixels.join(","),
            );
          } finally {
            uploaded.dispose();
          }
          if (source === largeSource) {
            populatedPixels = rendered.pixels;
            const colors = new Set<number>();
            for (let offset = 0; offset < rendered.pixels.length; offset += 4) {
              colors.add(
                rendered.pixels[offset] |
                  rendered.pixels[offset + 1] << 8 |
                  rendered.pixels[offset + 2] << 16,
              );
            }
            assert(
              colors.size > 1,
              "Populated syntax must draw visible geometry.",
            );
          }
        } finally {
          resident.dispose();
        }
      }
      assert(populatedPixels);
      for (
        const [source, options, expectedStatus] of [
          ["x", {}, 3],
          ["x;x;", { lexerCapacityRecords: 1 }, 4],
        ] as const
      ) {
        const resident = await frontend.ingestResident(source, options);
        try {
          const rendered = await renderReadback(
            runtime.device,
            overview,
            resident,
            source.length,
            frontend.plan.terminalClassification.length,
          );
          assertEquals(rendered.summary[0], expectedStatus);
          assertEquals(rendered.summary.subarray(4, 8).join(","), "6,0,0,0");
          assertEquals(rendered.summary.subarray(8, 12).join(","), "6,0,0,0");
          assert(
            rendered.pixels.join(",") !== populatedPixels.join(","),
            "A failed ingestion must not redraw the previous resident program.",
          );
          for (let offset = 4; offset < rendered.pixels.length; offset += 1) {
            assertEquals(
              rendered.pixels[offset],
              rendered.pixels[offset % 4],
              "Failed syntax must leave the overview background clear.",
            );
          }
        } finally {
          resident.dispose();
        }
      }

      const valid = cpu.ingest("x;");
      assert(valid.ok);
      const resident = await frontend.ingestResident("x;");
      try {
        const uploaded = uploadProgram(
          runtime.device,
          valid.program,
          resident.layout,
        );
        try {
          const width = 128;
          const height = 64;
          const bytesPerRow = width * 4;
          const sourceLengths = [2, 20];
          const expectedImages: Uint8Array[] = [];
          for (const sourceLength of sourceLengths) {
            const expectedImage = await renderReadback(
              runtime.device,
              overview,
              uploaded,
              sourceLength,
              frontend.plan.terminalClassification.length,
            );
            expectedImages.push(expectedImage.pixels);
          }
          assert(
            expectedImages[0].join(",") !== expectedImages[1].join(","),
            "Different source lengths must produce distinct overview geometry.",
          );
          const textures = sourceLengths.map(() =>
            runtime.device.createTexture({
              size: { width, height },
              format: "rgba8unorm",
              usage: GPUTextureUsage.RENDER_ATTACHMENT |
                GPUTextureUsage.COPY_SRC,
            })
          );
          const readbacks = sourceLengths.map(() =>
            runtime.device.createBuffer({
              size: bytesPerRow * height,
              usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            })
          );
          const executions: ReturnType<
            ResidentSyntaxOverviewRenderer["encode"]
          >[] = [];
          const mapped = [false, false];
          try {
            runtime.device.pushErrorScope("validation");
            runtime.device.pushErrorScope("out-of-memory");
            let oomResult: Promise<GPUError | null>;
            let validationResult: Promise<GPUError | null>;
            try {
              const encoder = runtime.device.createCommandEncoder();
              for (let index = 0; index < sourceLengths.length; index += 1) {
                executions.push(overview.encode(
                  encoder,
                  uploaded,
                  textures[index].createView(),
                  {
                    width,
                    height,
                    sourceLength: sourceLengths[index],
                    ruleCount: 2,
                    specCount: frontend.plan.terminalClassification.length,
                  },
                ));
                encoder.copyTextureToBuffer(
                  { texture: textures[index] },
                  {
                    buffer: readbacks[index],
                    bytesPerRow,
                    rowsPerImage: height,
                  },
                  { width, height },
                );
              }
              runtime.device.queue.submit([encoder.finish()]);
            } finally {
              oomResult = runtime.device.popErrorScope();
              validationResult = runtime.device.popErrorScope();
            }
            const scopes = Promise.all([oomResult, validationResult]);
            await Promise.all(readbacks.map(async (buffer, index) => {
              await buffer.mapAsync(GPUMapMode.READ);
              mapped[index] = true;
            }));
            const [oom, validation] = await scopes;
            assertEquals(oom, null);
            assertEquals(validation, null);
            for (let index = 0; index < readbacks.length; index += 1) {
              const actual = new Uint8Array(readbacks[index].getMappedRange());
              assertEquals(
                actual.join(","),
                expectedImages[index].join(","),
                "Encodes in one command buffer must retain independent parameters.",
              );
            }
          } finally {
            for (let index = 0; index < readbacks.length; index += 1) {
              if (mapped[index]) {
                readbacks[index].unmap();
              }
              readbacks[index].destroy();
              textures[index].destroy();
            }
            for (const execution of executions) {
              execution.dispose();
            }
          }

          runtime.device.queue.writeBuffer(
            uploaded.buffer,
            uploaded.layout.tokenCountWord * Uint32Array.BYTES_PER_ELEMENT,
            new Uint32Array([uploaded.layout.tokenCapacity + 1]),
          );
          const invalidCounts = await renderReadback(
            runtime.device,
            overview,
            uploaded,
            2,
            frontend.plan.terminalClassification.length,
          );
          assertEquals(invalidCounts.summary[0], 0xFFFF_FFFF);
          assertEquals(
            invalidCounts.summary.subarray(4, 8).join(","),
            "6,0,0,0",
          );
          assertEquals(
            invalidCounts.summary.subarray(8, 12).join(","),
            "6,0,0,0",
          );
          for (
            let offset = 4;
            offset < invalidCounts.pixels.length;
            offset += 1
          ) {
            assertEquals(
              invalidCounts.pixels[offset],
              invalidCounts.pixels[offset % 4],
              "Invalid counts must leave the overview background clear.",
            );
          }
        } finally {
          uploaded.dispose();
        }
      } finally {
        resident.dispose();
      }
      frontend.dispose();
    } finally {
      runtime.dispose();
    }
  },
});
