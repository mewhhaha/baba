import {
  compileThunkWasm,
  decodeThunkWasmValue,
  encodeThunkWasmInt,
  type ForceBranchHint,
} from "./aot.ts";

const SOURCE_PATH = "programs/lazy_bench.tw";
const INPUT = 7;
const FORCES_PER_MAIN = 500;
const CALLS_PER_BENCH_ITERATION = 200;
const EXPECTED_RESULT = (INPUT + 1) * FORCES_PER_MAIN;

interface BenchVariant {
  name: string;
  forceBranchHint: ForceBranchHint;
  baseline?: boolean;
}

interface BenchInstance {
  main(arg: number): number;
  reset(): void;
  memory: WebAssembly.Memory;
  wasmBytes: number;
  branchHintBytes: number;
  branchHintSections: number;
}

const source = await Deno.readTextFile(SOURCE_PATH);
const variants: readonly BenchVariant[] = [
  {
    name: "no force branch hint",
    forceBranchHint: "none",
    baseline: true,
  },
  {
    name: "force branch hint",
    forceBranchHint: "metadata",
  },
];

console.log(
  "ThunkWasm lazy benchmark: compares identical force-helper code with and without metadata.code.branch_hint.",
);
console.log(
  `${CALLS_PER_BENCH_ITERATION} main calls per sample, ${FORCES_PER_MAIN} cached forces per call.`,
);

for (const variant of variants) {
  const instance = await instantiateVariant(variant);
  verifyVariant(variant, instance);
  console.log(
    `${variant.name}: ${instance.wasmBytes} wasm bytes, ${instance.branchHintSections} branch-hint section(s), ${instance.branchHintBytes} branch-hint bytes`,
  );

  Deno.bench({
    name: variant.name,
    group: "lazy-force",
    baseline: variant.baseline,
    fn() {
      instance.reset();
      let result = 0;
      const encodedInput = encodeThunkWasmInt(INPUT);
      for (let index = 0; index < CALLS_PER_BENCH_ITERATION; index++) {
        result = instance.main(encodedInput);
      }
      if (decodeThunkWasmValue(result) !== EXPECTED_RESULT) {
        throw new Error(`Unexpected result ${decodeThunkWasmValue(result)}.`);
      }
    },
  });
}

async function instantiateVariant(
  variant: BenchVariant,
): Promise<BenchInstance> {
  const compiled = compileThunkWasm(source, {
    forceBranchHint: variant.forceBranchHint,
  });
  const wasmBuffer = compiled.wasm.buffer.slice(
    compiled.wasm.byteOffset,
    compiled.wasm.byteOffset + compiled.wasm.byteLength,
  ) as ArrayBuffer;
  const module = new WebAssembly.Module(wasmBuffer);
  const branchHintSections = WebAssembly.Module.customSections(
    module,
    "metadata.code.branch_hint",
  );
  const instance = await WebAssembly.instantiate(module, {});
  const main = instance.exports.main;
  const reset = instance.exports.reset;
  const memory = instance.exports.memory;
  if (typeof main !== "function") {
    throw new Error("Generated Wasm module did not export main().");
  }
  if (typeof reset !== "function") {
    throw new Error("Generated Wasm module did not export reset().");
  }
  if (!(memory instanceof WebAssembly.Memory)) {
    throw new Error("Generated Wasm module did not export memory.");
  }
  return {
    main: main as (arg: number) => number,
    reset: reset as () => void,
    memory,
    wasmBytes: compiled.wasm.length,
    branchHintBytes: branchHintSections.reduce(
      (total, section) => total + section.byteLength,
      0,
    ),
    branchHintSections: branchHintSections.length,
  };
}

function verifyVariant(variant: BenchVariant, instance: BenchInstance): void {
  instance.reset();
  const result = decodeThunkWasmValue(
    instance.main(encodeThunkWasmInt(INPUT)),
  );
  if (result !== EXPECTED_RESULT) {
    throw new Error(`${variant.name} returned ${result}.`);
  }

  const view = new DataView(instance.memory.buffer);
  const ticks = view.getInt32(0, true);
  const allocations = view.getInt32(4, true);
  const releases = view.getInt32(8, true);
  if (ticks !== 1 || allocations !== 1 || releases !== 1) {
    throw new Error(
      `${variant.name} counters were ticks=${ticks}, allocations=${allocations}, releases=${releases}.`,
    );
  }
}
