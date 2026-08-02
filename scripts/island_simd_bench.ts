import { compile, parseMetadata } from "../src/mod.ts";
import {
  compileIslandSimdProgram,
  type IslandSimdProgram,
  IslandSimdRunner,
} from "../src/experiments/island_simd.ts";

const BENCHMARKS = [
  {
    shape: "one-terminal loop",
    grammar: String.raw`
      skip WS = /[ \t\r\n]+/ ;
      module = chunks:chunk* ;
      chunk = values:"x"* ";" ;
    `,
  },
  {
    shape: "four-terminal cycle",
    grammar: String.raw`
      module = chunks:chunk* ;
      chunk = ("a" "b" "c" "d")* ";" ;
    `,
  },
] as const;

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

function compileBenchmarkProgram(
  grammar: string,
  name: string,
): IslandSimdProgram {
  const built = compile(grammar, {
    name,
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
    throw new Error(
      `Compiled benchmark '${name}' has no binary wasm/parser.plan.`,
    );
  }
  return compileIslandSimdProgram(planFile.content, 1);
}

function findTerminalPath(
  program: IslandSimdProgram,
  startState: number,
  targetState: number,
): number[] | null {
  const pending = [{ state: startState, terminals: [] as number[] }];
  const visited = new Uint8Array(program.stateCount);
  visited[startState] = 1;
  let cursor = 0;
  while (cursor < pending.length) {
    const path = pending[cursor];
    cursor += 1;
    if (path.state === targetState) {
      return path.terminals;
    }
    for (let terminal = 0; terminal < program.terminalCount; terminal += 1) {
      const target = program.transitions[terminal * 16 + path.state];
      if (target >= program.stateCount || visited[target] !== 0) {
        continue;
      }
      visited[target] = 1;
      pending.push({
        state: target,
        terminals: [...path.terminals, terminal],
      });
    }
  }
  return null;
}

function acceptedTokens(
  program: IslandSimdProgram,
  targetTokenCount: number,
): Uint16Array {
  let prefix: number[] | null = null;
  let cycle: number[] | null = null;
  let suffix: number[] | null = null;

  for (let cycleState = 0; cycleState < program.stateCount; cycleState += 1) {
    const candidatePrefix = findTerminalPath(
      program,
      program.startState,
      cycleState,
    );
    if (candidatePrefix === null) {
      continue;
    }
    let candidateCycle: number[] | null = null;
    for (let terminal = 0; terminal < program.terminalCount; terminal += 1) {
      const target = program.transitions[terminal * 16 + cycleState];
      if (target >= program.stateCount) {
        continue;
      }
      if (target === cycleState) {
        candidateCycle = [terminal];
        break;
      }
      const returnPath = findTerminalPath(program, target, cycleState);
      if (returnPath !== null) {
        candidateCycle = [terminal, ...returnPath];
        break;
      }
    }
    if (candidateCycle === null) {
      continue;
    }
    for (
      let acceptingState = 0;
      acceptingState < program.stateCount;
      acceptingState += 1
    ) {
      if ((program.acceptingMask & (1 << acceptingState)) === 0) {
        continue;
      }
      const candidateSuffix = findTerminalPath(
        program,
        cycleState,
        acceptingState,
      );
      if (candidateSuffix !== null) {
        prefix = candidatePrefix;
        cycle = candidateCycle;
        suffix = candidateSuffix;
        break;
      }
    }
    if (suffix !== null) {
      break;
    }
  }

  if (prefix === null || cycle === null || suffix === null) {
    throw new Error(
      `Benchmark island ${program.island} has no reachable cycle with an accepting exit.`,
    );
  }
  const fixedTokenCount = prefix.length + suffix.length;
  let repetitions = Math.floor(
    (targetTokenCount - fixedTokenCount) / cycle.length,
  );
  if (repetitions < 1) {
    repetitions = 1;
  }
  const terminals = new Uint16Array(
    fixedTokenCount + repetitions * cycle.length,
  );
  terminals.set(prefix, 0);
  let offset = prefix.length;
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    terminals.set(cycle, offset);
    offset += cycle.length;
  }
  terminals.set(suffix, offset);
  return terminals;
}

function measure(
  validate: () => boolean,
  iterations: number,
  tokenCount: number,
): { readonly milliseconds: number; readonly millionTokensPerSecond: number } {
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

function medianMeasurement(
  samples: readonly {
    readonly milliseconds: number;
    readonly millionTokensPerSecond: number;
  }[],
): { readonly milliseconds: number; readonly millionTokensPerSecond: number } {
  const ordered = [...samples].sort((left, right) =>
    left.milliseconds - right.milliseconds
  );
  return ordered[Math.floor(ordered.length / 2)];
}

const rows: Array<Record<string, number | string>> = [];
for (
  let benchmarkIndex = 0;
  benchmarkIndex < BENCHMARKS.length;
  benchmarkIndex += 1
) {
  const benchmark = BENCHMARKS[benchmarkIndex];
  const program = compileBenchmarkProgram(
    benchmark.grammar,
    `island_simd_bench_${benchmarkIndex}`,
  );
  for (const targetTokenCount of [64, 4_096, 65_536]) {
    const tokens = acceptedTokens(program, targetTokenCount);
    const tokenCount = tokens.length;
    const runner = await IslandSimdRunner.create(program, tokens);
    let iterations = Math.floor(16_000_000 / tokenCount);
    if (iterations < 250) {
      iterations = 250;
    }
    for (let warmup = 0; warmup < 100; warmup += 1) {
      if (
        !runner.validateLr() ||
        !runner.validateScalar() ||
        !runner.validateSimd()
      ) {
        throw new Error("Benchmark input was rejected during warmup.");
      }
    }

    const lrSamples = [];
    const scalarSamples = [];
    const simdSamples = [];
    for (let sample = 0; sample < 5; sample += 1) {
      if (sample % 2 === 0) {
        scalarSamples.push(measure(
          () => runner.validateScalar(),
          iterations,
          tokenCount,
        ));
        simdSamples.push(measure(
          () => runner.validateSimd(),
          iterations,
          tokenCount,
        ));
        lrSamples.push(measure(
          () => runner.validateLr(),
          iterations,
          tokenCount,
        ));
        continue;
      }
      lrSamples.push(measure(
        () => runner.validateLr(),
        iterations,
        tokenCount,
      ));
      simdSamples.push(measure(
        () => runner.validateSimd(),
        iterations,
        tokenCount,
      ));
      scalarSamples.push(measure(
        () => runner.validateScalar(),
        iterations,
        tokenCount,
      ));
    }
    const lr = medianMeasurement(lrSamples);
    const scalar = medianMeasurement(scalarSamples);
    const simd = medianMeasurement(simdSamples);
    rows.push({
      shape: benchmark.shape,
      states: program.stateCount,
      tokens: tokenCount,
      samples: 5,
      iterations,
      lr_ms: lr.milliseconds.toFixed(2),
      scalar_ms: scalar.milliseconds.toFixed(2),
      simd_ms: simd.milliseconds.toFixed(2),
      lr_mtok_s: lr.millionTokensPerSecond.toFixed(1),
      scalar_mtok_s: scalar.millionTokensPerSecond.toFixed(1),
      simd_mtok_s: simd.millionTokensPerSecond.toFixed(1),
      scalar_to_simd: `${
        (scalar.milliseconds / simd.milliseconds).toFixed(2)
      }x`,
      lr_to_simd: `${(lr.milliseconds / simd.milliseconds).toFixed(2)}x`,
    });
  }
}

console.table(rows);
