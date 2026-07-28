import { createParser } from "./generated/wasm/mod.ts";
import { WebGpuRuntime } from "@mewhhaha/baba/runtime/webgpu";

const options = parseArguments(Deno.args);
const source = await Deno.readTextFile(options.sourcePath);
const plan = await Deno.readFile("generated/wasm/parser.plan");
const parser = createParser({
  bytes: await Deno.readFile("generated/wasm/parser.wasm"),
  plan,
});

try {
  if (options.cpu) {
    printResult(parser.parse(source), "CPU lexer + Wasm parser");
  } else {
    const runtime = await WebGpuRuntime.create({
      powerPreference: "high-performance",
      allowFallbackAdapter: options.allowFallbackAdapter,
    });
    try {
      const lexer = await runtime.compileLexer(plan);
      try {
        const lexed = await lexer.lex(utf16Units(source));
        if (lexed.overflow) {
          throw new Error(
            `GPU lexer output overflowed at ${lexed.tokenCount} tokens.`,
          );
        }
        printResult(
          parser.parseRecords(source, lexed.records),
          `WebGPU lexer + Wasm parser (${runtime.capabilities.description})`,
        );
      } finally {
        lexer.dispose();
      }
    } finally {
      runtime.dispose();
    }
  }
} finally {
  parser.dispose();
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

function utf16Units(source: string): Uint16Array {
  const units = new Uint16Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    units[index] = source.charCodeAt(index);
  }
  return units;
}

function printResult(
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
