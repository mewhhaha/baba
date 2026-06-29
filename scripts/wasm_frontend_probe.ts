import {
  babaWasmFrontendRequirements,
  wasmFrontendCandidates,
  wasmFrontendRecommendation,
} from "../src/wasm_frontend/research.ts";

console.log(`target_profile\t${babaWasmFrontendRequirements.targetProfile}`);
console.log(`abi\t${babaWasmFrontendRequirements.abiName}`);
console.log(`abi_version\t${babaWasmFrontendRequirements.abiVersion}`);
console.log(`oracle\t${wasmFrontendRecommendation.keepAsOracle}`);
console.log(
  `packaged_compiler\t${wasmFrontendRecommendation.packagedCompiler}`,
);
console.log(
  `first_ergonomic_spike\t${wasmFrontendRecommendation.firstErgonomicSpike}`,
);
console.log(
  "id\tstatus\tdistribution\tpackage_fit\tcommand\tinstalled\tabi_fit\truntime_fit",
);

for (const candidate of wasmFrontendCandidates) {
  let command = "-";
  let installed = "not-applicable";
  if (candidate.command !== null) {
    command = candidate.command;
    const isAvailable = await commandAvailable(candidate.command);
    if (isAvailable) {
      installed = "available";
    } else {
      installed = "missing";
    }
  }

  console.log(
    [
      candidate.id,
      candidate.status,
      candidate.distribution,
      candidate.packageFit,
      command,
      installed,
      candidate.abiFit,
      candidate.runtimeFit,
    ].join("\t"),
  );
}

async function commandAvailable(command: string): Promise<boolean> {
  const result = await new Deno.Command("sh", {
    args: ["-c", 'command -v "$1" >/dev/null 2>&1', "sh", command],
  }).output();
  return result.success;
}
