/**
 * Command-line entrypoint for generating baba outputs.
 *
 * @module
 */

import type { GeneratedBundle, GeneratePreset } from "./ast.ts";
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
  listFiles: boolean;
  help: boolean;
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
  });

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
      case "--list-files":
        options.listFiles = true;
        break;
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
  --ts-meta     JSON metadata for tree-sitter/editor/AST/formatter/LSP generation
  --ts-out      Additional output path for tree-sitter grammar and queries
  --list-files  Print generated file paths without writing output files`;
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
  await Deno.mkdir(outDir, { recursive: true });
  for (const file of bundle.files) {
    const path = `${outDir}/${file.path}`;
    const parent = parentDir(path);
    if (parent) await Deno.mkdir(parent, { recursive: true });
    await Deno.writeTextFile(path, file.content);
  }
  for (const cleanupPath of bundle.cleanupPaths ?? []) {
    await removeIfExists(`${outDir}/${cleanupPath}`);
  }
}

async function writeTreeSitterOutput(
  treeSitterOut: string,
  bundle: GeneratedBundle,
): Promise<void> {
  const grammar = treeSitterGrammarFile(bundle);
  if (!grammar) return;

  const parent = parentDir(treeSitterOut);
  if (parent) await Deno.mkdir(parent, { recursive: true });
  await Deno.writeTextFile(treeSitterOut, grammar.content);
  if (!parent) return;

  const queries = treeSitterQueryFiles(bundle);
  const queryDir = `${parent}/queries`;
  if (bundle.preset === "workbench" || queries.some((file) => file.content)) {
    await Deno.mkdir(queryDir, { recursive: true });
  }
  for (const file of queries) {
    const name = treeSitterQueryOutputName(file);
    const path = `${queryDir}/${name}`;
    if (bundle.preset === "workbench") {
      await Deno.writeTextFile(path, file.content);
    } else if (file.content) {
      await Deno.writeTextFile(path, file.content);
    } else {
      await removeIfExists(path);
    }
  }
  for (const cleanupPath of bundle.cleanupPaths ?? []) {
    if (!cleanupPath.endsWith(".scm")) continue;
    await removeIfExists(`${queryDir}/${cleanupPath}`);
  }
}

function parentDir(path: string): string | null {
  const normalized = path.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  if (slash === -1) return null;
  return normalized.slice(0, slash) || ".";
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
}
