/**
 * Command-line entrypoint for generating baba outputs.
 *
 * @module
 */

import type {
  Diagnostic,
  GenerateBackend,
  GeneratedBundle,
  GeneratedFile,
  GeneratePreset,
} from "./ast.ts";
import {
  treeSitterGrammarFile,
  treeSitterQueryFiles,
  treeSitterQueryOutputName,
} from "./bundle.ts";
import {
  BabaError,
  formatDiagnostic,
  generate,
  generateInitBundle,
  parseMetadata,
} from "./mod.ts";

interface Options {
  command: "generate" | "init";
  input?: string;
  initDir?: string;
  outDir?: string;
  metadataPath?: string;
  treeSitterOut?: string;
  name: string;
  preset: GeneratePreset;
  backends?: GenerateBackend[];
  listFiles: boolean;
  diagnosticFormat: "text" | "json";
  help: boolean;
}

interface OutputManifest {
  generator: string;
  manifestVersion: 1;
  files: Record<string, { hash: string; ownership: "generated" }>;
}

if (import.meta.main) {
  try {
    await main(Deno.args);
  } catch (error) {
    if (error instanceof BabaError) {
      console.error(formatDiagnostic(error));
      Deno.exit(1);
    }
    throw error;
  }
}

/** Runs the baba CLI with explicit argv-style arguments. */
export async function main(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.help) {
    console.log(helpText());
    return;
  }

  if (options.command === "init") {
    await initProject(options);
    return;
  }

  if (!options.input) {
    throw new BabaError({
      code: "CLI_MISSING_INPUT",
      message: "Missing grammar input. Run with --help for usage.",
    });
  }

  const source = await Deno.readTextFile(options.input);
  const metadata = options.metadataPath
    ? parseMetadata(await Deno.readTextFile(options.metadataPath))
    : undefined;
  const bundle = generate(source, {
    name: options.name,
    metadata,
    preset: options.preset,
    backends: options.backends ??
      (options.treeSitterOut && !options.outDir && options.preset === "core"
        ? ["tree-sitter"]
        : undefined),
  });
  assertDistinctOutputRoots(options);
  emitDiagnostics(bundle.diagnostics ?? [], options.diagnosticFormat);

  if (options.listFiles) {
    console.log(bundle.files.map((file) => file.path).join("\n"));
    return;
  }

  if (!options.outDir) {
    const lexical = bundle.files.find((file) => file.path === "lexical.json");
    if (lexical) console.log(lexical.content.trimEnd());
  }

  if (options.outDir) {
    await writeBundle(options.outDir, bundle);
  }

  if (options.treeSitterOut) {
    await writeTreeSitterOutput(options.treeSitterOut, bundle);
  }
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    command: "generate",
    name: "grammar",
    preset: "core",
    listFiles: false,
    diagnosticFormat: "text",
    help: false,
  };

  let i = 0;
  if (args[0] === "generate" || args[0] === "init") {
    options.command = args[0];
    i = 1;
  }

  for (; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "--out": {
        const outDir = args[++i];
        if (!outDir) {
          throw new BabaError({
            code: "CLI_BAD_ARGS",
            message: "Expected directory after --out",
          });
        }
        options.outDir = outDir;
        break;
      }
      case "--name": {
        const name = args[++i];
        if (!name) {
          throw new BabaError({
            code: "CLI_BAD_ARGS",
            message: "Expected language name after --name",
          });
        }
        options.name = name;
        break;
      }
      case "--ts-meta": {
        const metadataPath = args[++i];
        if (!metadataPath) {
          throw new BabaError({
            code: "CLI_BAD_ARGS",
            message: "Expected metadata path after --ts-meta",
          });
        }
        options.metadataPath = metadataPath;
        break;
      }
      case "--ts-out": {
        const treeSitterOut = args[++i];
        if (!treeSitterOut) {
          throw new BabaError({
            code: "CLI_BAD_ARGS",
            message: "Expected path after --ts-out",
          });
        }
        options.treeSitterOut = treeSitterOut;
        break;
      }
      case "--preset": {
        const preset = args[++i];
        if (!preset) {
          throw new BabaError({
            code: "CLI_BAD_ARGS",
            message: "Expected preset after --preset",
          });
        }
        if (preset !== "core" && preset !== "workbench") {
          throw new BabaError({
            code: "INVALID_PRESET",
            message: `Unknown preset '${preset}'`,
          });
        }
        options.preset = preset;
        break;
      }
      case "--backend": {
        const backend = args[++i];
        if (!backend) {
          throw new BabaError({
            code: "CLI_BAD_ARGS",
            message: "Expected backend after --backend",
          });
        }
        options.backends = [
          ...(options.backends ?? []),
          ...parseBackendList(backend),
        ];
        break;
      }
      case "--list-files":
        options.listFiles = true;
        break;
      case "--diagnostic-format": {
        const format = args[++i];
        if (!format) {
          throw new BabaError({
            code: "CLI_BAD_ARGS",
            message: "Expected format after --diagnostic-format",
          });
        }
        if (format !== "text" && format !== "json") {
          throw new BabaError({
            code: "CLI_BAD_ARGS",
            message: `Unknown diagnostic format '${format}'`,
          });
        }
        options.diagnosticFormat = format;
        break;
      }
      default:
        if (arg.startsWith("-")) {
          throw new BabaError({
            code: "CLI_BAD_ARGS",
            message: `Unknown option '${arg}'`,
          });
        }
        if (options.command === "init") {
          if (options.initDir) {
            throw new BabaError({
              code: "CLI_BAD_ARGS",
              message: `Unexpected extra input '${arg}'`,
            });
          }
          options.initDir = arg;
        } else {
          if (options.input) {
            throw new BabaError({
              code: "CLI_BAD_ARGS",
              message: `Unexpected extra input '${arg}'`,
            });
          }
          options.input = arg;
        }
    }
  }

  return options;
}

function helpText(): string {
  return `baba - generate language scaffolding from EBNF

Usage:
  baba <grammar.ebnf> --out generated
  baba generate <grammar.ebnf> --out generated
  baba init <dir>

Options:
  --preset      Generation preset: core or workbench. Defaults to core
  --backend     Core backend: tree-sitter, typescript-ll1, or all
  --ts-meta     JSON metadata for tree-sitter/editor/AST/formatter/LSP generation
  --ts-out      Additional output path for tree-sitter grammar and queries
  --diagnostic-format  Diagnostic output format: text or json. Defaults to text
  --list-files  Print generated file paths without writing output files`;
}

function parseBackendList(value: string): GenerateBackend[] {
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  const backends: GenerateBackend[] = [];
  for (const part of parts) {
    if (part === "all") {
      backends.push("tree-sitter", "typescript-ll1");
    } else if (part === "tree-sitter" || part === "typescript-ll1") {
      backends.push(part);
    } else {
      throw new BabaError({
        code: "INVALID_BACKEND",
        message: `Unknown backend '${part}'`,
      });
    }
  }
  return backends;
}

function emitDiagnostics(
  diagnostics: readonly Diagnostic[],
  format: Options["diagnosticFormat"],
): void {
  if (diagnostics.length === 0) return;
  if (format === "json") {
    console.error(JSON.stringify(diagnostics, null, 2));
    return;
  }
  for (const diagnostic of diagnostics) {
    console.error(formatDiagnostic(diagnostic));
  }
}

function assertDistinctOutputRoots(options: Options): void {
  if (!options.outDir || !options.treeSitterOut) return;
  const outRoot = normalizeFsPath(options.outDir);
  const treeSitterRoot = normalizeFsPath(
    parentDir(options.treeSitterOut) ?? ".",
  );
  if (outRoot !== treeSitterRoot) return;
  throw new BabaError({
    code: "CLI_OUTPUT_CONFLICT",
    message:
      "--out and --ts-out cannot target the same output directory because each output root has its own ownership manifest.",
  });
}

async function initProject(options: Options): Promise<void> {
  const dir = options.initDir;
  if (!dir) {
    throw new BabaError({
      code: "CLI_MISSING_INPUT",
      message: "Missing init directory. Run with --help for usage.",
    });
  }
  const bundle = generateInitBundle({
    name: options.name === "grammar" ? undefined : options.name,
    dirName: dir,
  });
  if (options.listFiles) {
    console.log(bundle.files.map((file) => file.path).join("\n"));
    return;
  }
  await writeBundle(dir, bundle);
}

async function writeBundle(
  outDir: string,
  bundle: GeneratedBundle,
): Promise<void> {
  await writeGeneratedFiles(outDir, bundle.files, bundle.cleanupPaths ?? []);
}

async function writeTreeSitterOutput(
  treeSitterOut: string,
  bundle: GeneratedBundle,
): Promise<void> {
  const grammar = treeSitterGrammarFile(bundle);
  if (!grammar) return;

  const parent = parentDir(treeSitterOut);
  const root = parent ?? ".";
  const files: GeneratedFile[] = [{
    ...grammar,
    path: baseName(treeSitterOut),
  }];
  const treeSitterConfig = bundle.files.find((file) =>
    file.path === "tree-sitter.json"
  );
  if (treeSitterConfig) files.push(treeSitterConfig);
  const cleanupPaths: string[] = [];
  const queries = treeSitterQueryFiles(bundle);
  for (const file of queries) {
    const name = treeSitterQueryOutputName(file);
    const path = `queries/${name}`;
    files.push({ ...file, path });
  }
  for (const cleanupPath of bundle.cleanupPaths ?? []) {
    if (!cleanupPath.endsWith(".scm")) continue;
    cleanupPaths.push(`queries/${cleanupPath}`);
  }
  await writeGeneratedFiles(root, files, cleanupPaths);
}

async function writeGeneratedFiles(
  rootDir: string,
  files: GeneratedFile[],
  cleanupPaths: string[],
): Promise<void> {
  await Deno.mkdir(rootDir, { recursive: true });
  const previous = await readManifest(rootDir);
  const nextPaths = new Set(files.map((file) => file.path));
  const stalePaths = previous
    ? Object.keys(previous.files).filter((path) => !nextPaths.has(path))
    : [];
  const removePaths = [...new Set([...cleanupPaths, ...stalePaths])];

  for (const file of files) {
    await assertCanOverwrite(
      `${rootDir}/${file.path}`,
      file.path,
      previous,
    );
  }
  for (const cleanupPath of removePaths) {
    await assertCanRemove(`${rootDir}/${cleanupPath}`, cleanupPath, previous);
  }

  const stagedWrites: Array<{ finalPath: string; tempPath: string }> = [];
  let manifestTempPath: string | null = null;
  try {
    for (const file of files) {
      const path = `${rootDir}/${file.path}`;
      const parent = parentDir(path);
      if (parent) await Deno.mkdir(parent, { recursive: true });
      const tempPath = temporarySiblingPath(path);
      await Deno.writeTextFile(tempPath, file.content);
      stagedWrites.push({ finalPath: path, tempPath });
    }

    const manifestFiles: OutputManifest["files"] = {};
    for (const file of files) {
      manifestFiles[file.path] = {
        hash: await hashText(file.content),
        ownership: "generated",
      };
    }
    const manifest: OutputManifest = {
      generator: "@mewhhaha/baba",
      manifestVersion: 1,
      files: manifestFiles,
    };
    manifestTempPath = temporarySiblingPath(manifestPath(rootDir));
    await Deno.writeTextFile(
      manifestTempPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    for (const staged of stagedWrites) {
      await Deno.rename(staged.tempPath, staged.finalPath);
    }
    for (const cleanupPath of removePaths) {
      await removeIfExists(`${rootDir}/${cleanupPath}`);
    }
    await Deno.rename(manifestTempPath, manifestPath(rootDir));
    manifestTempPath = null;
  } catch (error) {
    for (const staged of stagedWrites) {
      await removeIfExists(staged.tempPath);
    }
    if (manifestTempPath) await removeIfExists(manifestTempPath);
    throw error;
  }
}

async function assertCanOverwrite(
  path: string,
  relativePath: string,
  manifest: OutputManifest | null,
): Promise<void> {
  let current: string;
  try {
    current = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }

  const manifestEntry = manifest?.files[relativePath];
  if (!manifestEntry) {
    throw new BabaError({
      code: "CLI_OVERWRITE_REFUSED",
      message:
        `Refusing to overwrite modified or unowned file '${relativePath}'. Move it aside or delete it before regenerating.`,
    });
  }
  const currentHash = await hashText(current);
  if (manifestEntry.hash === currentHash) return;
  throw new BabaError({
    code: "CLI_OVERWRITE_REFUSED",
    message:
      `Refusing to overwrite modified or unowned file '${relativePath}'. Move it aside or delete it before regenerating.`,
  });
}

async function assertCanRemove(
  path: string,
  relativePath: string,
  manifest: OutputManifest | null,
): Promise<void> {
  let current: string;
  try {
    current = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }

  const manifestEntry = manifest?.files[relativePath];
  if (!manifestEntry) {
    throw new BabaError({
      code: "CLI_OVERWRITE_REFUSED",
      message:
        `Refusing to remove modified or unowned file '${relativePath}'. Move it aside or delete it before regenerating.`,
    });
  }
  const currentHash = await hashText(current);
  if (manifestEntry.hash === currentHash) return;
  throw new BabaError({
    code: "CLI_OVERWRITE_REFUSED",
    message:
      `Refusing to remove modified or unowned file '${relativePath}'. Move it aside or delete it before regenerating.`,
  });
}

async function readManifest(rootDir: string): Promise<OutputManifest | null> {
  try {
    const parsed = JSON.parse(await Deno.readTextFile(manifestPath(rootDir)));
    if (
      parsed?.generator !== "@mewhhaha/baba" ||
      parsed?.manifestVersion !== 1 ||
      typeof parsed?.files !== "object" ||
      parsed.files === null
    ) {
      return null;
    }
    return parsed as OutputManifest;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

function manifestPath(rootDir: string): string {
  return `${rootDir}/.baba-manifest.json`;
}

async function hashText(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parentDir(path: string): string | null {
  const normalized = path.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  if (slash === -1) return null;
  return normalized.slice(0, slash) || ".";
}

function baseName(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  return slash === -1 ? normalized : normalized.slice(slash + 1);
}

function normalizeFsPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const absolute = normalized.startsWith("/")
    ? normalized
    : `${Deno.cwd().replaceAll("\\", "/")}/${normalized}`;
  const parts: string[] = [];
  for (const part of absolute.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function temporarySiblingPath(path: string): string {
  return `${path}.tmp-${crypto.randomUUID()}`;
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
}
