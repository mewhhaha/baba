import * as compiler from "../src/mod.ts";
import { createParser } from "../src/runtime/generated_wasm.ts";
import type {
  CursorParseResult,
  LexTapeResult,
  ParserInstance,
  ValidateParseResult,
} from "../src/runtime/generated_wasm.ts";

const warmups = 20;
const samples = 100;
const fixtures = [
  {
    name: "island-statements",
    directory: "fixtures/perf/wasm/island-statements/",
    input: "small.input",
    operations: ["lex", "validate", "parse"],
  },
  {
    name: "funcfuck",
    directory: "examples/funcfuck/",
    input: "programs/pipeline.ff",
    operations: ["lex"],
  },
  {
    name: "gpu-duck",
    directory: "examples/gpu-duck/",
    input: "programs/example.duck",
    operations: ["lex"],
  },
] as const;

interface Target {
  readonly name: string;
  readonly compiler: typeof compiler;
  readonly factory: typeof createParser;
}

interface PreparedTarget {
  readonly name: string;
  readonly factory: typeof createParser;
  readonly module: WebAssembly.Module;
  readonly plan: Uint8Array;
}

interface Timing {
  readonly createMs: number;
  readonly firstCallMs: number;
  readonly totalMs: number;
}

function runOperation(
  parser: ParserInstance,
  operation: string,
  source: string,
): LexTapeResult | ValidateParseResult | CursorParseResult {
  if (operation === "lex") {
    return parser.lex(source);
  }
  if (operation === "validate") {
    return parser.validate(source);
  }
  if (operation === "parse") {
    return parser.parse(source);
  }
  throw new Error(`Unknown Wasm setup operation '${operation}'.`);
}

function measure(
  target: PreparedTarget,
  operation: string,
  source: string,
): Timing {
  const started = performance.now();
  const parser = target.factory({ module: target.module, plan: target.plan });
  const created = performance.now();
  try {
    const result = runOperation(parser, operation, source);
    const finished = performance.now();
    if (
      result.diagnostics.length !== 0 ||
      ("ok" in result && !result.ok)
    ) {
      throw new Error(
        `${target.name} ${operation} failed: ${
          JSON.stringify(result.diagnostics)
        }`,
      );
    }
    if (
      "cursor" in result &&
      (result.cursor === null || result.cursor.span.end !== source.length)
    ) {
      throw new Error(
        `${target.name} ${operation} returned an invalid cursor.`,
      );
    }
    return {
      createMs: created - started,
      firstCallMs: finished - created,
      totalMs: finished - started,
    };
  } finally {
    parser.dispose();
  }
}

function distribution(values: readonly number[]): {
  p25Ms: number;
  medianMs: number;
} {
  if (values.length !== samples) {
    throw new Error(`Expected ${samples} Wasm setup samples.`);
  }
  const sorted = [...values].sort((left, right) => left - right);
  return {
    p25Ms: sorted[Math.floor(samples / 4)],
    medianMs: (sorted[samples / 2 - 1] + sorted[samples / 2]) / 2,
  };
}

const targets: Target[] = [{
  name: "current",
  compiler,
  factory: createParser,
}];
if (Deno.args.length !== 0) {
  if (Deno.args.length !== 2 || Deno.args[0] !== "--before-root") {
    throw new Error("Usage: wasm_setup_bench.ts [--before-root PROJECT]");
  }
  const cwd = new URL("file:///");
  cwd.pathname = `${Deno.cwd()}/`;
  const previousRoot = new URL(`${Deno.args[1]}/`, cwd);
  const previousCompiler = await import(
    new URL("src/mod.ts", previousRoot).href
  ) as typeof compiler;
  const previousRuntime = await import(
    new URL("src/runtime/generated_wasm.ts", previousRoot).href
  ) as typeof import("../src/runtime/generated_wasm.ts");
  targets.unshift({
    name: "before",
    compiler: previousCompiler,
    factory: previousRuntime.createParser,
  });
}

console.log(JSON.stringify({
  deno: Deno.version.deno,
  v8: Deno.version.v8,
  warmups,
  samples,
  moduleCompilation: "excluded; precompiled module reused",
}));

for (const fixture of fixtures) {
  const directory = new URL(`../${fixture.directory}`, import.meta.url);
  const grammar = await Deno.readTextFile(new URL("grammar.baba", directory));
  const metadata = await Deno.readTextFile(new URL("baba.json", directory));
  const source = await Deno.readTextFile(new URL(fixture.input, directory));
  const prepared: PreparedTarget[] = [];
  for (const target of targets) {
    const built = target.compiler.compile(grammar, {
      name: fixture.name,
      rootRule: "module",
      targets: ["wasm"],
      metadata: target.compiler.parseMetadata(metadata),
    });
    if (built.bundle === undefined) {
      throw new Error(JSON.stringify(built.diagnostics));
    }
    const wasm = built.bundle.files.find((file) =>
      file.path === "wasm/parser.wasm"
    );
    const plan = built.bundle.files.find((file) =>
      file.path === "wasm/parser.plan"
    );
    if (
      wasm === undefined || wasm.encoding !== "binary" || plan === undefined ||
      plan.encoding !== "binary"
    ) {
      throw new Error(`Missing ${fixture.name} Wasm artifacts.`);
    }
    prepared.push({
      name: target.name,
      factory: target.factory,
      module: new WebAssembly.Module(new Uint8Array(wasm.content).buffer),
      plan: plan.content,
    });
  }
  for (const operation of fixture.operations) {
    const timings = prepared.map(() => [] as Timing[]);
    for (let round = 0; round < warmups + samples; round++) {
      for (let offset = 0; offset < prepared.length; offset++) {
        const index = (round + offset) % prepared.length;
        const timing = measure(prepared[index], operation, source);
        if (round >= warmups) {
          timings[index].push(timing);
        }
      }
    }
    for (let index = 0; index < prepared.length; index++) {
      const target = prepared[index];
      console.log(JSON.stringify({
        fixture: fixture.name,
        target: target.name,
        operation,
        codeUnits: source.length,
        planBytes: target.plan.byteLength,
        create: distribution(timings[index].map((timing) => timing.createMs)),
        firstCall: distribution(
          timings[index].map((timing) => timing.firstCallMs),
        ),
        total: distribution(timings[index].map((timing) => timing.totalMs)),
      }));
    }
  }
}
