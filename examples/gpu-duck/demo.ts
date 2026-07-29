import { createParser } from "./generated/wasm/mod.ts";
import {
  type GpuFrontendResult,
  WebGpuRuntime,
} from "@mewhhaha/baba/runtime/webgpu";

const options = parseArguments(Deno.args);
const source = await Deno.readTextFile(options.sourcePath);
const plan = await Deno.readFile("generated/wasm/parser.plan");

if (options.cpu) {
  const parser = createParser({
    bytes: await Deno.readFile("generated/wasm/parser.wasm"),
    plan,
  });
  try {
    printParserResult(parser.parse(source), "CPU lexer + Wasm parser");
  } finally {
    parser.dispose();
  }
} else {
  const runtime = await WebGpuRuntime.create({
    powerPreference: "high-performance",
    allowFallbackAdapter: options.allowFallbackAdapter,
  });
  try {
    const frontend = await runtime.compileFrontend(plan);
    printGpuFrontendResult(
      await frontend.ingest(source),
      `WebGPU frontend (${runtime.capabilities.description})`,
    );
  } finally {
    runtime.dispose();
  }
}

function printGpuFrontendResult(
  result: GpuFrontendResult,
  backend: string,
): void {
  if (!result.ok) {
    const diagnostics = result.diagnostics.map((diagnostic) =>
      `${diagnostic.code} at ${diagnostic.start}: ${diagnostic.message}`
    ).join("\n");
    throw new Error(`${backend} failed:\n${diagnostics}`);
  }
  const tokenCount = result.program.tokens.length / 4;
  const nodeCount = result.program.nodes.length / 8;
  const edgeCount = result.program.edges.length / 4;
  console.log(
    `${backend} accepted ${tokenCount} tokens into ${nodeCount} nodes and ${edgeCount} edges.`,
  );
}

function printParserResult(
  result: ReturnType<ReturnType<typeof createParser>["parse"]>,
  backend: string,
): void {
  if (!result.ok) {
    const diagnostics = result.diagnostics.map((diagnostic) =>
      `${diagnostic.code} at ${diagnostic.span.start}: ${diagnostic.message}`
    ).join("\n");
    throw new Error(`${backend} failed:\n${diagnostics}`);
  }
  console.log(
    `${backend} accepted a root with ${result.cursor.children().length} children.`,
  );
}

interface DemoOptions {
  readonly sourcePath: string;
  readonly cpu: boolean;
  readonly allowFallbackAdapter: boolean;
}

function parseArguments(arguments_: readonly string[]): DemoOptions {
  let sourcePath: string | undefined;
  let cpu = false;
  let allowFallbackAdapter = false;

  for (const argument of arguments_) {
    if (argument === "--cpu") {
      cpu = true;
      continue;
    }
    if (argument === "--allow-fallback-adapter") {
      allowFallbackAdapter = true;
      continue;
    }
    if (sourcePath !== undefined) {
      throw new Error(
        `Expected one Duck source path; received ${sourcePath} and ${argument}.`,
      );
    }
    sourcePath = argument;
  }

  if (sourcePath === undefined) {
    throw new Error("Expected a Duck source path.");
  }
  return { sourcePath, cpu, allowFallbackAdapter };
}
