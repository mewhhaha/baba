import {
  applyBundle,
  compile,
  parseGrammar,
  parseMetadata,
} from "../src/mod.ts";
import {
  hashRuntimeImplementationManifest,
  hashRuntimeImplementationSource,
  RUNTIME_IMPLEMENTATION_METADATA,
} from "../src/targets/runtime/implementation.ts";
import {
  hashRuntimeLanguageCompilerManifest,
  hashRuntimeLanguageCompilerSource,
  RUNTIME_LANGUAGE_COMPILER_METADATA,
} from "../src/targets/runtime/language_manifest.ts";
import {
  computeRuntimeLanguageArtifactMetadata,
  hashRuntimeLanguageArtifactsManifest,
  RUNTIME_LANGUAGE_ARTIFACTS_METADATA,
} from "../src/targets/runtime/language_artifacts.ts";

interface ExampleConfig {
  dir: string;
  name: string;
  rootRule: string;
  metadataPath: string;
  allowedDiagnosticCodes?: readonly string[];
}

const EXAMPLES: readonly ExampleConfig[] = [
  {
    dir: "examples/brainfuck",
    name: "brainfuck",
    rootRule: "module",
    metadataPath: "baba.json",
  },
  {
    dir: "examples/feature-tour",
    name: "feature_tour",
    rootRule: "module",
    metadataPath: "baba.json",
    allowedDiagnosticCodes: [
      "PORTABLE_LEXER_TOKEN_OVERLAP",
      "PORTABLE_SHADOWED_TOKEN_LANGUAGE",
    ],
  },
  {
    dir: "examples/funcfuck",
    name: "funcfuck",
    rootRule: "module",
    metadataPath: "baba.json",
  },
  {
    dir: "examples/thunkwasm",
    name: "thunkwasm",
    rootRule: "module",
    metadataPath: "baba.json",
  },
];

if (import.meta.main) {
  const mode = Deno.args.includes("--write") ? "write" : "check";
  await runBootstrapCheck(mode);
}

export async function runBootstrapCheck(
  mode: "check" | "write" = "check",
): Promise<void> {
  await verifyRuntimeImplementationMetadata();
  await verifyRuntimeLanguageCompilerMetadata();
  verifyRuntimeLanguageArtifactMetadata();
  for (const example of EXAMPLES) {
    if (mode === "write") {
      await writeExample(example);
    } else {
      await checkExample(example);
    }
  }
}

async function verifyRuntimeImplementationMetadata(): Promise<void> {
  const actualSources = [];
  for (const source of RUNTIME_IMPLEMENTATION_METADATA.sources) {
    const content = await Deno.readTextFile(source.path);
    const hash = hashRuntimeImplementationSource(content);
    if (hash !== source.hash) {
      throw new Error(
        [
          `Runtime implementation source hash is stale for ${source.path}.`,
          `expected in manifest: ${source.hash}`,
          `actual: ${hash}`,
        ].join("\n"),
      );
    }
    actualSources.push({ ...source, hash });
  }
  const manifestHash = hashRuntimeImplementationManifest(actualSources);
  if (manifestHash !== RUNTIME_IMPLEMENTATION_METADATA.hash) {
    throw new Error(
      [
        "Runtime implementation manifest hash is stale.",
        `expected in manifest: ${RUNTIME_IMPLEMENTATION_METADATA.hash}`,
        `actual: ${manifestHash}`,
      ].join("\n"),
    );
  }
  console.log("verified runtime implementation manifest");
}

async function verifyRuntimeLanguageCompilerMetadata(): Promise<void> {
  const actualSources = [];
  for (const source of RUNTIME_LANGUAGE_COMPILER_METADATA.sources) {
    const content = await Deno.readTextFile(source.path);
    const hash = hashRuntimeLanguageCompilerSource(content);
    if (hash !== source.hash) {
      throw new Error(
        [
          `Runtime-language compiler source hash is stale for ${source.path}.`,
          `expected in manifest: ${source.hash}`,
          `actual: ${hash}`,
        ].join("\n"),
      );
    }
    actualSources.push({ ...source, hash });
  }
  const manifestHash = hashRuntimeLanguageCompilerManifest(actualSources);
  if (manifestHash !== RUNTIME_LANGUAGE_COMPILER_METADATA.hash) {
    throw new Error(
      [
        "Runtime-language compiler manifest hash is stale.",
        `expected in manifest: ${RUNTIME_LANGUAGE_COMPILER_METADATA.hash}`,
        `actual: ${manifestHash}`,
      ].join("\n"),
    );
  }
  console.log("verified runtime-language compiler manifest");
}

function verifyRuntimeLanguageArtifactMetadata(): void {
  const artifacts = computeRuntimeLanguageArtifactMetadata();
  if (
    JSON.stringify(artifacts) !==
      JSON.stringify(RUNTIME_LANGUAGE_ARTIFACTS_METADATA.artifacts)
  ) {
    throw new Error(
      [
        "Runtime-language artifact metadata is stale.",
        `expected in manifest: ${
          JSON.stringify(RUNTIME_LANGUAGE_ARTIFACTS_METADATA.artifacts)
        }`,
        `actual: ${JSON.stringify(artifacts)}`,
      ].join("\n"),
    );
  }
  const manifestHash = hashRuntimeLanguageArtifactsManifest(artifacts);
  if (manifestHash !== RUNTIME_LANGUAGE_ARTIFACTS_METADATA.hash) {
    throw new Error(
      [
        "Runtime-language artifact manifest hash is stale.",
        `expected in manifest: ${RUNTIME_LANGUAGE_ARTIFACTS_METADATA.hash}`,
        `actual: ${manifestHash}`,
      ].join("\n"),
    );
  }
  console.log("verified runtime-language artifact manifest");
}

async function writeExample(example: ExampleConfig): Promise<void> {
  const bundle = await compileExample(example);
  await applyBundle(bundle, { root: `${example.dir}/generated` });
  console.log(`updated ${example.dir}/generated`);
}

async function checkExample(example: ExampleConfig): Promise<void> {
  const bundle = await compileExample(example);
  const tempDir = await Deno.makeTempDir();
  try {
    const tempGenerated = `${tempDir}/generated`;
    await applyBundle(bundle, { root: tempGenerated });
    await validateGeneratedExample(tempGenerated);
    console.log(`verified regenerated ${example.dir}/generated`);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

async function compileExample(example: ExampleConfig) {
  const source = await Deno.readTextFile(`${example.dir}/grammar.baba`);
  const metadata = parseMetadata(
    await Deno.readTextFile(`${example.dir}/${example.metadataPath}`),
  );
  const result = compile(parseGrammar(source), {
    name: example.name,
    rootRule: example.rootRule,
    metadata,
    targets: ["wasm"],
  });
  const allowedDiagnosticCodes = new Set(example.allowedDiagnosticCodes ?? []);
  const unexpectedDiagnostics = result.diagnostics.filter((diagnostic) =>
    (diagnostic.severity ?? "error") === "error" ||
    !allowedDiagnosticCodes.has(diagnostic.code)
  );
  if (unexpectedDiagnostics.length > 0 || !result.bundle) {
    const messages = unexpectedDiagnostics.map((diagnostic) =>
      `${diagnostic.code}: ${diagnostic.message}`
    );
    throw new Error(
      `Failed to compile ${example.dir}:\n${messages.join("\n")}`,
    );
  }
  return result.bundle;
}

async function validateGeneratedExample(
  root: string,
): Promise<void> {
  const files = await manifestOwnedFiles(root);
  for (
    const required of [
      ".baba-manifest.json",
      "wasm/abi.json",
      "wasm/manifest.json",
      "wasm/mod.ts",
      "wasm/parser.plan",
      "wasm/parser.wasm",
      "wasm/syntax.ts",
    ]
  ) {
    if (!files.includes(required)) {
      throw new Error(`${root} is missing generated file ${required}.`);
    }
  }
  await denoCheck(`${root}/wasm/mod.ts`);
}

async function manifestOwnedFiles(root: string): Promise<string[]> {
  const manifest = JSON.parse(
    await Deno.readTextFile(`${root}/.baba-manifest.json`),
  ) as {
    generator?: unknown;
    manifestVersion?: unknown;
    files?: Record<string, unknown>;
  };
  if (
    manifest.generator !== "@mewhhaha/baba" ||
    manifest.manifestVersion !== 1 ||
    !manifest.files ||
    typeof manifest.files !== "object"
  ) {
    throw new Error(`${root}/.baba-manifest.json is not a baba manifest.`);
  }
  return [".baba-manifest.json", ...Object.keys(manifest.files)].sort();
}

async function denoCheck(path: string): Promise<void> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["check", path],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  if (output.success) return;
  const decoder = new TextDecoder();
  throw new Error(
    [
      `deno check failed for ${path}`,
      decoder.decode(output.stdout),
      decoder.decode(output.stderr),
    ].join("\n"),
  );
}
