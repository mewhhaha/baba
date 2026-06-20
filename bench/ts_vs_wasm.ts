import { applyBundle, compile } from "../src/mod.ts";

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

const samples = numericArg("--samples", 5);

const cases: readonly BenchCase[] = [
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
    source: expressionSource(700),
    iterations: 700,
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
    source: jsonSource(180),
    iterations: 500,
  },
  {
    name: "long-token",
    grammar: `
      token WORD = /[a-z]+/ ;
      skip WS = /[ \\t\\r\\n]+/ ;
      module = WORD ;
    `,
    source: "a".repeat(80_000),
    iterations: 300,
  },
];

let sink = 0;

for (const preserveTrivia of [true, false]) {
  console.log(`preserveTrivia=${preserveTrivia}`);
  for (const benchCase of cases) {
    const root = await Deno.makeTempDir();
    try {
      const result = compile(benchCase.grammar, {
        targets: ["typescript", "wasm"],
        typescript: { directory: "ts", preserveTrivia },
        wasm: { directory: "wasm", preserveTrivia },
      });
      const errors = result.diagnostics.filter((diagnostic) =>
        diagnostic.severity === "error"
      );
      if (!result.bundle || errors.length > 0) {
        throw new Error(JSON.stringify(result.diagnostics, null, 2));
      }

      await applyBundle(result.bundle, { root });
      const ts = await import(
        `${toFileUrl(`${root}/ts/mod.ts`)}?${crypto.randomUUID()}`
      ) as Runtime;
      const wasm = await import(
        `${toFileUrl(`${root}/wasm/mod.ts`)}?${crypto.randomUUID()}`
      ) as Runtime;
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

      for (const row of rows) {
        console.log(
          `${benchCase.name.padEnd(12)} ${row.name.padEnd(20)} ` +
            `ts=${row.ts.toFixed(3)}ms wasm=${row.wasm.toFixed(3)}ms ` +
            `ratio=${row.ratio.toFixed(2)}`,
        );
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  }
}

console.log(`sink=${sink}`);

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
