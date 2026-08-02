import { compile, parseMetadata } from "../src/mod.ts";
import {
  compileIslandSimdProgram,
  type IslandSimdProgram,
  IslandSimdRunner,
} from "../src/experiments/island_simd.ts";

const GRAMMAR = String.raw`
skip WS = /[ \t\r\n]+/ ;
module = chunks:chunk* ;
chunk = values:"x"* ";" ;
`;

const METADATA = parseMetadata(JSON.stringify({
  version: 2,
  gpuFrontend: {
    version: 3,
    throughput: "strict",
    root: "module",
    islands: [
      { rule: "module", boundary: { kind: "root" } },
      { rule: "chunk", boundary: { kind: "terminated", terminal: ";" } },
    ],
    semantics: { rules: {} },
  },
}));

function acceptedTokens(
  program: IslandSimdProgram,
  tokenCount: number,
): Uint16Array {
  let repeated = -1;
  let repeatedState = -1;
  let terminating = -1;
  for (let terminal = 0; terminal < program.terminalCount; terminal += 1) {
    const target = program.transitions[terminal * 16 + program.startState];
    if (
      target < program.stateCount &&
      program.transitions[terminal * 16 + target] === target
    ) {
      repeated = terminal;
      repeatedState = target;
    }
  }
  if (repeatedState >= 0) {
    for (let terminal = 0; terminal < program.terminalCount; terminal += 1) {
      const target = program.transitions[terminal * 16 + repeatedState];
      if ((program.acceptingMask & (1 << target)) !== 0) {
        terminating = terminal;
      }
    }
  }
  if (repeated < 0 || terminating < 0) {
    throw new Error(
      `Benchmark island has no repeat/terminator pair: ${repeated}/${terminating}.`,
    );
  }
  const tokens = new Uint16Array(tokenCount);
  tokens.fill(repeated, 0, tokenCount - 1);
  tokens[tokenCount - 1] = terminating;
  return tokens;
}

function measure(
  validate: () => boolean,
  iterations: number,
  tokenCount: number,
): { readonly milliseconds: number; readonly millionTokensPerSecond: number } {
  for (let iteration = 0; iteration < 100; iteration += 1) {
    if (!validate()) {
      throw new Error("Benchmark input was rejected during warmup.");
    }
  }
  const started = performance.now();
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    if (!validate()) {
      throw new Error(
        `Benchmark input was rejected at iteration ${iteration}.`,
      );
    }
  }
  const milliseconds = performance.now() - started;
  return {
    milliseconds,
    millionTokensPerSecond: tokenCount * iterations / milliseconds / 1_000,
  };
}

const built = compile(GRAMMAR, {
  name: "island_simd_bench",
  rootRule: "module",
  metadata: METADATA,
  targets: ["wasm"],
});
if (built.bundle === undefined) {
  throw new Error(
    built.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
  );
}
const planFile = built.bundle.files.find((file) =>
  file.path === "wasm/parser.plan"
);
if (planFile === undefined || planFile.encoding !== "binary") {
  throw new Error("Compiled benchmark bundle has no binary wasm/parser.plan.");
}
const program = compileIslandSimdProgram(planFile.content, 1);
const rows: Array<Record<string, number | string>> = [];
for (const tokenCount of [64, 4_096, 65_536]) {
  const tokens = acceptedTokens(program, tokenCount);
  const runner = await IslandSimdRunner.create(program, tokens);
  let iterations = Math.floor(64_000_000 / tokenCount);
  if (iterations < 1_000) {
    iterations = 1_000;
  }
  const scalar = measure(
    () => runner.validateScalar(),
    iterations,
    tokenCount,
  );
  const simd = measure(
    () => runner.validateSimd(),
    iterations,
    tokenCount,
  );
  const lr = measure(
    () => runner.validateLr(),
    iterations,
    tokenCount,
  );
  rows.push({
    tokens: tokenCount,
    iterations,
    lr_ms: lr.milliseconds.toFixed(2),
    scalar_ms: scalar.milliseconds.toFixed(2),
    simd_ms: simd.milliseconds.toFixed(2),
    lr_mtok_s: lr.millionTokensPerSecond.toFixed(1),
    scalar_mtok_s: scalar.millionTokensPerSecond.toFixed(1),
    simd_mtok_s: simd.millionTokensPerSecond.toFixed(1),
    scalar_to_simd: `${(scalar.milliseconds / simd.milliseconds).toFixed(2)}x`,
    lr_to_simd: `${(lr.milliseconds / simd.milliseconds).toFixed(2)}x`,
  });
}

console.table(rows);
