import {
  assert,
  assertEquals,
  assertThrowsIncludes,
  compile,
  parseMetadata,
} from "./helpers.ts";
import {
  compileIslandSimdProgram,
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

function compileExperimentPlan(): Uint8Array {
  const built = compile(GRAMMAR, {
    name: "island_simd_experiment_test",
    rootRule: "module",
    metadata: METADATA,
    targets: ["wasm"],
  });
  assert(
    built.bundle,
    built.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
  );
  const planFile = built.bundle.files.find((file) =>
    file.path === "wasm/parser.plan"
  );
  assert(planFile);
  assert(planFile.encoding === "binary");
  return planFile.content;
}

Deno.test("Rust SIMD island validation matches the scalar transducer", async () => {
  const program = compileIslandSimdProgram(compileExperimentPlan(), 1);
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
      `Expected repeat and terminating transitions, found ${repeated} and ${terminating}.`,
    );
  }
  const tokens = new Uint16Array(32_769);
  tokens.fill(repeated, 0, tokens.length - 1);
  tokens[tokens.length - 1] = terminating;

  const accepted = await IslandSimdRunner.create(program, tokens);
  assertEquals(accepted.validateLr(), true);
  assertEquals(accepted.validateScalar(), true);
  assertEquals(accepted.validateSimd(), true);

  const incomplete = await IslandSimdRunner.create(
    program,
    new Uint16Array([repeated]),
  );
  assertEquals(incomplete.validateLr(), false);
  assertEquals(incomplete.validateScalar(), false);
  assertEquals(incomplete.validateSimd(), false);

  const invalidTerminal = await IslandSimdRunner.create(
    program,
    new Uint16Array([program.terminalCount]),
  );
  assertThrowsIncludes(
    () => invalidTerminal.validateScalar(),
    "status -2",
  );
  assertThrowsIncludes(
    () => invalidTerminal.validateSimd(),
    "status -2",
  );
});

Deno.test("Rust SIMD island compilation rejects the recursive root island", () => {
  assertThrowsIncludes(
    () => compileIslandSimdProgram(compileExperimentPlan(), 0),
    "not a terminal-only long region",
  );
});
