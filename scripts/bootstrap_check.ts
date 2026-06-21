import {
  applyBundle,
  compile,
  parseGrammar,
  parseMetadata,
} from "../src/mod.ts";

interface ExampleConfig {
  dir: string;
  name: string;
  rootRule: string;
  metadataPath: string;
  typescriptDir: string;
}

const EXAMPLES: readonly ExampleConfig[] = [
  {
    dir: "examples/brainfuck",
    name: "brainfuck",
    rootRule: "module",
    metadataPath: "baba.json",
    typescriptDir: "ts",
  },
  {
    dir: "examples/funcfuck",
    name: "funcfuck",
    rootRule: "module",
    metadataPath: "baba.json",
    typescriptDir: "ts",
  },
  {
    dir: "examples/thunkwasm",
    name: "thunkwasm",
    rootRule: "module",
    metadataPath: "baba.json",
    typescriptDir: "ts",
  },
];

if (import.meta.main) {
  const mode = Deno.args.includes("--write") ? "write" : "check";
  await runBootstrapCheck(mode);
}

export async function runBootstrapCheck(
  mode: "check" | "write" = "check",
): Promise<void> {
  for (const example of EXAMPLES) {
    if (mode === "write") {
      await writeExample(example);
    } else {
      await checkExample(example);
    }
  }
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
    await assertDirectoriesEqual(
      `${example.dir}/generated`,
      tempGenerated,
      `${example.dir}/generated`,
    );
    console.log(`verified ${example.dir}/generated`);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

async function compileExample(example: ExampleConfig) {
  const source = await Deno.readTextFile(`${example.dir}/grammar.ebnf`);
  const metadata = parseMetadata(
    await Deno.readTextFile(`${example.dir}/${example.metadataPath}`),
  );
  const result = compile(parseGrammar(source), {
    name: example.name,
    rootRule: example.rootRule,
    metadata,
    targets: ["tree-sitter", "typescript", "wasm"],
    typescript: { directory: example.typescriptDir },
  });
  if (result.diagnostics.length > 0 || !result.bundle) {
    const messages = result.diagnostics.map((diagnostic) =>
      `${diagnostic.code}: ${diagnostic.message}`
    );
    throw new Error(
      `Failed to compile ${example.dir}:\n${messages.join("\n")}`,
    );
  }
  return result.bundle;
}

async function assertDirectoriesEqual(
  expectedRoot: string,
  actualRoot: string,
  label: string,
): Promise<void> {
  const [expectedFiles, actualFiles] = await Promise.all([
    manifestOwnedFiles(expectedRoot),
    manifestOwnedFiles(actualRoot),
  ]);
  const expectedSet = new Set(expectedFiles);
  const actualSet = new Set(actualFiles);
  const missing = expectedFiles.filter((file) => !actualSet.has(file));
  const extra = actualFiles.filter((file) => !expectedSet.has(file));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      [
        `${label} differs from regenerated output.`,
        ...missing.map((file) => `missing regenerated file: ${file}`),
        ...extra.map((file) => `unexpected regenerated file: ${file}`),
      ].join("\n"),
    );
  }

  for (const file of expectedFiles) {
    const [expected, actual] = await Promise.all([
      Deno.readFile(`${expectedRoot}/${file}`),
      Deno.readFile(`${actualRoot}/${file}`),
    ]);
    if (!bytesEqual(expected, actual)) {
      throw new Error(`${label}/${file} differs from regenerated output.`);
    }
  }
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

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
