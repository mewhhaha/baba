/**
 * Command-line entrypoint for compiling explicit EBNF to Tree-sitter outputs.
 *
 * @module
 */

import type { Diagnostic } from "./ast.ts";
import {
  applyBundle,
  BabaError,
  formatDiagnostic,
  generate,
  parseMetadata,
} from "./mod.ts";

interface Options {
  input?: string;
  outDir?: string;
  metadataPath?: string;
  name: string;
  listFiles: boolean;
  diagnosticFormat: "text" | "json";
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
  });
  emitDiagnostics(bundle.diagnostics ?? [], options.diagnosticFormat);

  if (options.listFiles) {
    console.log(bundle.files.map((file) => file.path).join("\n"));
    return;
  }
  if (!options.outDir) {
    console.log(bundle.files.map((file) => file.path).join("\n"));
    return;
  }
  await applyBundle(bundle, { root: options.outDir });
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    name: "grammar",
    listFiles: false,
    diagnosticFormat: "text",
    help: false,
  };

  let i = args[0] === "generate" ? 1 : 0;
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
            message: "Expected grammar name after --name",
          });
        }
        options.name = name;
        break;
      }
      case "--metadata":
      case "--meta":
      case "--ts-meta": {
        const metadataPath = args[++i];
        if (!metadataPath) {
          throw new BabaError({
            code: "CLI_BAD_ARGS",
            message: `Expected metadata path after ${arg}`,
          });
        }
        options.metadataPath = metadataPath;
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
      case "init":
      case "--preset":
      case "--backend":
      case "--ts-out":
        throw new BabaError({
          code: "REMOVED_CLI_OPTION",
          message:
            `'${arg}' was removed in baba 1.0. Baba now compiles explicit EBNF to Tree-sitter artifacts only.`,
        });
      default:
        if (arg.startsWith("-")) {
          throw new BabaError({
            code: "CLI_BAD_ARGS",
            message: `Unknown option '${arg}'`,
          });
        }
        if (options.input) {
          throw new BabaError({
            code: "CLI_BAD_ARGS",
            message: `Unexpected extra input '${arg}'`,
          });
        }
        options.input = arg;
    }
  }
  return options;
}

function helpText(): string {
  return `baba - compile explicit EBNF to Tree-sitter artifacts

Usage:
  baba <grammar.ebnf> --out generated
  baba generate <grammar.ebnf> --out generated

Options:
  --name        Tree-sitter grammar name. Defaults to grammar
  --metadata    JSON metadata for Tree-sitter shaping and query generation
  --meta        Alias for --metadata
  --ts-meta     Deprecated alias for --metadata
  --diagnostic-format  Diagnostic output format: text or json. Defaults to text
  --list-files  Print generated file paths without writing output files`;
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
