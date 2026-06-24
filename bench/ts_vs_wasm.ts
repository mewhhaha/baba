import { applyBundle, compile, type GeneratedFile } from "../src/mod.ts";

type Runtime = {
  lex(source: string): {
    tokens: readonly unknown[];
    diagnostics: readonly unknown[];
  };
  parse(source: string): {
    ok: boolean;
    root: { span: { end: number } } | null;
    tokens: readonly unknown[];
    diagnostics: readonly unknown[];
  };
  parseTokensUnchecked(source: string, tokens: readonly unknown[]): {
    ok: boolean;
    root: { span: { end: number } } | null;
    diagnostics: readonly unknown[];
  };
};

type BenchCase = {
  name: string;
  grammar: string;
  source: string;
  iterations: number;
};

type BenchMetric = {
  operation: string;
  tsMs: number;
  wasmMs: number;
  ratio: number;
};

type BenchCaseResult = {
  name: string;
  preserveTrivia: boolean;
  sourceBytes: number;
  iterations: number;
  compiler: {
    totalGenerationMs: number;
    diagnostics: number;
  };
  artifacts: ArtifactMetrics;
  setup: {
    applyBundleMs: number;
    tsImportMs: number;
    wasmImportMs: number;
  };
  metrics: BenchMetric[];
};

type ArtifactMetrics = {
  totalBytes: number;
  textBytes: number;
  binaryBytes: number;
  typescriptRuntimeBytes: number;
  wasmAdapterBytes: number;
  wasmBinaryBytes: number;
  treeSitterArtifactBytes: number;
  largestFile: { path: string; bytes: number } | null;
};

const samples = numericArg("--samples", 5);
const quick = flagArg("--quick");
const jsonPath = optionalValueArg("--json");

const cases = benchCases(quick);
const results: BenchCaseResult[] = [];

let sink = 0;

for (const preserveTrivia of [true, false]) {
  console.log(`preserveTrivia=${preserveTrivia}`);
  for (const benchCase of cases) {
    const root = await Deno.makeTempDir();
    try {
      const compileStart = performance.now();
      const result = compile(benchCase.grammar, {
        targets: ["typescript", "wasm"],
        typescript: { directory: "ts", preserveTrivia },
        wasm: { directory: "wasm", preserveTrivia },
      });
      const compileMs = performance.now() - compileStart;
      const errors = result.diagnostics.filter((diagnostic) =>
        diagnostic.severity === "error"
      );
      if (!result.bundle || errors.length > 0) {
        throw new Error(JSON.stringify(result.diagnostics, null, 2));
      }

      const applyStart = performance.now();
      await applyBundle(result.bundle, { root });
      const applyBundleMs = performance.now() - applyStart;
      const tsImportStart = performance.now();
      const ts = await import(
        `${toFileUrl(`${root}/ts/mod.ts`)}?${crypto.randomUUID()}`
      ) as Runtime;
      const tsImportMs = performance.now() - tsImportStart;
      const wasmImportStart = performance.now();
      const wasm = await import(
        `${toFileUrl(`${root}/wasm/mod.ts`)}?${crypto.randomUUID()}`
      ) as Runtime;
      const wasmImportMs = performance.now() - wasmImportStart;
      const tsTokens = ts.lex(benchCase.source).tokens;
      const wasmTokens = wasm.lex(benchCase.source).tokens;

      const rows = [
        compare(
          "lex",
          benchCase.iterations,
          () => ts.lex(benchCase.source),
          () => wasm.lex(benchCase.source),
        ),
        compare(
          "parse",
          benchCase.iterations,
          () => ts.parse(benchCase.source),
          () => wasm.parse(benchCase.source),
        ),
        compare(
          "parseTokensUnchecked",
          benchCase.iterations,
          () => ts.parseTokensUnchecked(benchCase.source, tsTokens),
          () => wasm.parseTokensUnchecked(benchCase.source, wasmTokens),
        ),
      ];

      results.push({
        name: benchCase.name,
        preserveTrivia,
        sourceBytes: new TextEncoder().encode(benchCase.source).byteLength,
        iterations: benchCase.iterations,
        compiler: {
          totalGenerationMs: compileMs,
          diagnostics: result.diagnostics.length,
        },
        artifacts: artifactMetrics(result.bundle.files),
        setup: {
          applyBundleMs,
          tsImportMs,
          wasmImportMs,
        },
        metrics: rows.map((row) => ({
          operation: row.name,
          tsMs: row.ts,
          wasmMs: row.wasm,
          ratio: row.ratio,
        })),
      });

      for (const row of rows) {
        console.log(
          `${benchCase.name.padEnd(12)} ${row.name.padEnd(20)} ` +
            `ts=${row.ts.toFixed(3)}ms wasm=${row.wasm.toFixed(3)}ms ` +
            `ratio=${row.ratio.toFixed(2)}`,
        );
      }
      const artifacts = artifactMetrics(result.bundle.files);
      console.log(
        `${benchCase.name.padEnd(12)} compile=${compileMs.toFixed(3)}ms ` +
          `artifacts=${artifacts.totalBytes}B ` +
          `setup=apply:${applyBundleMs.toFixed(3)}ms,` +
          `ts-import:${tsImportMs.toFixed(3)}ms,` +
          `wasm-import:${wasmImportMs.toFixed(3)}ms`,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  }
}

console.log(`sink=${sink}`);

const report = {
  format: "baba-benchmark-results",
  version: 1,
  generatedAt: new Date().toISOString(),
  samples,
  quick,
  sink,
  cases: results,
};
if (jsonPath) {
  await Deno.writeTextFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
}

function benchCases(quickMode: boolean): readonly BenchCase[] {
  return [
    {
      name: "expressions",
      grammar: `
      token INT = /[0-9]+/ ;
      skip WS = /[ \\t\\r\\n]+/ ;

      module = expr ;
      expr = additive ;
      additive = first:multiplicative rest:(("+" | "-") multiplicative)* ;
      multiplicative = first:primary rest:(("*" | "/") primary)* ;
      primary = INT | "(" expr ")" ;
    `,
      source: expressionSource(quickMode ? 20 : 700),
      iterations: quickMode ? 5 : 700,
    },
    {
      name: "json-like",
      grammar: `
      token STRING = /"([^"\\\\]|\\\\.)*"/ ;
      token NUMBER = /-?[0-9]+(\\.[0-9]+)?/ ;
      skip WS = /[ \\t\\r\\n]+/ ;

      module = value ;
      value = object | array | STRING | NUMBER | "true" | "false" | "null" ;
      object = "{" entries:(pair ("," pair)*)? "}" ;
      pair = key:STRING ":" value ;
      array = "[" items:(value ("," value)*)? "]" ;
    `,
      source: jsonSource(quickMode ? 8 : 180),
      iterations: quickMode ? 5 : 500,
    },
    {
      name: "long-token",
      grammar: `
      token WORD = /[a-z]+/ ;
      skip WS = /[ \\t\\r\\n]+/ ;
      module = WORD ;
    `,
      source: "a".repeat(quickMode ? 512 : 80_000),
      iterations: quickMode ? 5 : 300,
    },
  ];
}

function compare(
  name: string,
  iterations: number,
  ts: () => unknown,
  wasm: () => unknown,
): { name: string; ts: number; wasm: number; ratio: number } {
  const tsSamples: number[] = [];
  const wasmSamples: number[] = [];
  for (let sample = 0; sample < samples; sample++) {
    tsSamples.push(measure(ts, iterations));
    wasmSamples.push(measure(wasm, iterations));
  }
  const tsMedian = median(tsSamples);
  const wasmMedian = median(wasmSamples);
  return {
    name,
    ts: tsMedian,
    wasm: wasmMedian,
    ratio: wasmMedian / tsMedian,
  };
}

function measure(action: () => unknown, iterations: number): number {
  for (let index = 0; index < 80; index++) consume(action());
  const start = performance.now();
  for (let index = 0; index < iterations; index++) consume(action());
  return (performance.now() - start) / iterations;
}

function consume(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const candidate = value as {
    ok?: boolean;
    root?: { span?: { end?: number } } | null;
    tokens?: readonly unknown[];
    diagnostics?: readonly unknown[];
  };
  sink += candidate.tokens?.length ?? 0;
  sink += candidate.diagnostics?.length ?? 0;
  sink += candidate.root?.span?.end ?? 0;
  if (candidate.ok === false) sink += 1;
}

function artifactMetrics(files: readonly GeneratedFile[]): ArtifactMetrics {
  let totalBytes = 0;
  let textBytes = 0;
  let binaryBytes = 0;
  let typescriptRuntimeBytes = 0;
  let wasmAdapterBytes = 0;
  let wasmBinaryBytes = 0;
  let treeSitterArtifactBytes = 0;
  let largestFile: { path: string; bytes: number } | null = null;

  for (const file of files) {
    const bytes = generatedFileByteLength(file);
    totalBytes += bytes;
    if (file.encoding === "binary") {
      binaryBytes += bytes;
    } else {
      textBytes += bytes;
    }
    if (file.path.startsWith("ts/")) {
      typescriptRuntimeBytes += bytes;
    }
    if (file.path.startsWith("wasm/") && file.encoding === "utf-8") {
      wasmAdapterBytes += bytes;
    }
    if (file.encoding === "binary" || file.path.endsWith(".wasm")) {
      wasmBinaryBytes += bytes;
    }
    if (
      file.path === "grammar.js" ||
      file.path.startsWith("queries/") ||
      file.path.endsWith(".scm")
    ) {
      treeSitterArtifactBytes += bytes;
    }
    if (!largestFile || bytes > largestFile.bytes) {
      largestFile = { path: file.path, bytes };
    }
  }

  return {
    totalBytes,
    textBytes,
    binaryBytes,
    typescriptRuntimeBytes,
    wasmAdapterBytes,
    wasmBinaryBytes,
    treeSitterArtifactBytes,
    largestFile,
  };
}

function generatedFileByteLength(file: GeneratedFile): number {
  return file.encoding === "binary"
    ? file.content.byteLength
    : new TextEncoder().encode(file.content).byteLength;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function numericArg(name: string, fallback: number): number {
  const index = Deno.args.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(Deno.args[index + 1]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function flagArg(name: string): boolean {
  return Deno.args.includes(name);
}

function optionalValueArg(name: string): string | undefined {
  const index = Deno.args.indexOf(name);
  if (index === -1) return undefined;
  const value = Deno.args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function expressionSource(count: number): string {
  const parts: string[] = [];
  for (let index = 1; index <= count; index++) {
    if (index > 1) parts.push(index % 2 === 0 ? " + " : " - ");
    parts.push(String(index), index % 3 === 0 ? " * 2" : "");
  }
  return parts.join("");
}

function jsonSource(count: number): string {
  const entries: string[] = [];
  for (let index = 0; index < count; index++) {
    const value = index % 5 === 0
      ? `{"nested":[${index},true,false,null]}`
      : index % 2 === 0
      ? `[${index},"v${index}",null]`
      : `"value-${index}"`;
    entries.push(`"key${index}":${value}`);
  }
  return `{${entries.join(",")}}`;
}

function toFileUrl(path: string): string {
  return new URL(`file://${path}`).href;
}
