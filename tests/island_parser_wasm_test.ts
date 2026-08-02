import {
  assert,
  assertEquals,
  assertThrowsIncludes,
  compile,
  parseMetadata,
} from "./helpers.ts";
import {
  compileIslandSimdProgram,
  compileStrictIslandParserProgram,
  IslandValidationSession,
} from "../src/runtime/island_parser.ts";

const GRAMMAR = String.raw`
skip WS = /[ \t\r\n]+/ ;
module = chunks:chunk* ;
chunk = values:"x"* ";" ;
`;

const CYCLE_GRAMMAR = String.raw`
module = chunks:chunk* ;
chunk = ("a" "b" "c" "d")* ";" ;
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

function compileExperimentPlan(
  grammar: string,
  fixtureName: string,
): Uint8Array {
  const built = compile(grammar, {
    name: fixtureName,
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
  const planBytes = compileExperimentPlan(
    GRAMMAR,
    "island_parser_wasm_test",
  );
  const program = compileIslandSimdProgram(
    planBytes,
    1,
  );
  planBytes.fill(0);
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

  const accepted = await IslandValidationSession.create(program, tokens);
  assertEquals(accepted.validateScalar(), true);
  assertEquals(accepted.validateSimd(), true);
  const synchronous = IslandValidationSession.createSync(program, tokens);
  assertEquals(synchronous.validateScalarRange(0, tokens.length), true);
  assertEquals(synchronous.validateSimdRange(0, tokens.length), true);

  const incomplete = await IslandValidationSession.create(
    program,
    new Uint16Array([repeated]),
  );
  assertEquals(incomplete.validateScalar(), false);
  assertEquals(incomplete.validateSimd(), false);

  const invalidTerminal = await IslandValidationSession.create(
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

Deno.test("Rust SIMD island validation composes all six cycle states", async () => {
  const program = compileIslandSimdProgram(
    compileExperimentPlan(CYCLE_GRAMMAR, "island_parser_cycle_test"),
    1,
  );
  assertEquals(program.stateCount, 6);
  assertEquals(program.terminalCount, 6);

  const tokens = new Uint16Array(32_769);
  for (let index = 0; index < tokens.length - 1; index += 1) {
    tokens[index] = index % 4 + 1;
  }
  tokens[tokens.length - 1] = 5;
  const session = await IslandValidationSession.create(program, tokens);
  assertEquals(session.validateScalar(), true);
  assertEquals(session.validateSimd(), true);
});

Deno.test("strict island parser contract identifies root regions and emissions", () => {
  const program = compileStrictIslandParserProgram(
    compileExperimentPlan(GRAMMAR, "strict_island_parser_contract_test"),
  );
  assertEquals(program.rootIsland, 0);
  assertEquals(program.rootRuleName, "module");
  assertEquals(program.regionIsland, 1);
  assertEquals(program.regionRuleName, "chunk");
  assert(program.boundaryTerminal >= 0);
  assert(program.rootField >= 0);
  assertEquals(program.validation.transitionFields.length, 3 * 16);
  assertEquals(program.terminalBySpec.length, 3);
});

Deno.test("Rust SIMD island compilation rejects the recursive root island", () => {
  assertThrowsIncludes(
    () =>
      compileIslandSimdProgram(
        compileExperimentPlan(GRAMMAR, "island_parser_subset_test"),
        0,
      ),
    "not a terminal-only long region",
  );
});
