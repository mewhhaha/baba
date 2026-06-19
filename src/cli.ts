/**
 * Command-line entrypoint for compiling explicit EBNF to Tree-sitter outputs.
 *
 * @module
 */

import type { Diagnostic, GenerateTarget } from "./ast.ts";
import {
  applyBundle,
  BabaError,
  compile,
  formatDiagnostic,
  parseGrammar,
  parseMetadata,
} from "./mod.ts";

interface Options {
  command: "check" | "generate";
  input?: string;
  outDir?: string;
  metadataPath?: string;
  name: string;
  rootRule?: string;
  targets: GenerateTarget[];
  listFiles: boolean;
  diagnosticFormat: "text" | "json";
  help: boolean;
}

class CliDiagnosticsError extends Error {
  constructor(
    readonly diagnostics: readonly Diagnostic[],
    readonly diagnosticFormat: Options["diagnosticFormat"],
  ) {
    super("CLI diagnostics contain errors");
    this.name = "CliDiagnosticsError";
  }
}

if (import.meta.main) {
  try {
    await main(Deno.args);
  } catch (error) {
    if (error instanceof CliDiagnosticsError) {
      emitDiagnostics(error.diagnostics, error.diagnosticFormat);
      Deno.exit(1);
    }
    if (error instanceof BabaError) {
      emitDiagnostics(
        [error.toDiagnostic()],
        diagnosticFormatFromArgs(Deno.args),
      );
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
  const grammar = parseGrammar(source);
  const result = compile(grammar, {
    name: options.name,
    rootRule: options.rootRule,
    metadata,
    targets: options.targets.length ? options.targets : undefined,
  });
  if (hasErrors(result.diagnostics)) {
    throw new CliDiagnosticsError(result.diagnostics, options.diagnosticFormat);
  }
  emitDiagnostics(result.diagnostics, options.diagnosticFormat);
  const bundle = result.bundle;
  if (!bundle) return;

  if (options.listFiles) {
    console.log(bundle.files.map((file) => file.path).join("\n"));
    return;
  }
  if (options.command === "check") return;
  if (!options.outDir) {
    console.log(bundle.files.map((file) => file.path).join("\n"));
    return;
  }
  await applyBundle(bundle, { root: options.outDir });
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    command: "generate",
    name: "grammar",
    targets: [],
    listFiles: false,
    diagnosticFormat: "text",
    help: false,
  };

  let i = 0;
  if (args[0] === "generate" || args[0] === "check") {
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
            message: "Expected grammar name after --name",
          });
        }
        options.name = name;
        break;
      }
      case "--root": {
        const rootRule = args[++i];
        if (!rootRule) {
          throw new BabaError({
            code: "CLI_BAD_ARGS",
            message: "Expected rule name after --root",
          });
        }
        options.rootRule = rootRule;
        break;
      }
      case "--target": {
        const target = args[++i];
        if (!target) {
          throw new BabaError({
            code: "CLI_BAD_ARGS",
            message: "Expected target after --target",
          });
        }
        addTarget(options, target);
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
            `'${arg}' was removed in baba 1.0. Use --target tree-sitter, --target typescript, or --target all.`,
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
  return `baba - compile explicit EBNF to syntax infrastructure

Usage:
  baba <grammar.ebnf> --out generated
  baba check <grammar.ebnf>
  baba generate <grammar.ebnf> --out generated

Options:
  --name        Grammar/target name. Defaults to grammar
  --root        Root grammar rule. Defaults to the first grammar rule
  --target      Output target: tree-sitter, typescript, or all. May repeat
  --metadata    JSON metadata for Tree-sitter shaping and query generation
  --meta        Alias for --metadata
  --ts-meta     Deprecated alias for --metadata
  --diagnostic-format  Diagnostic output format: text or json. Defaults to text
  --list-files  Print generated file paths without writing output files`;
}

function diagnosticFormatFromArgs(
  args: readonly string[],
): Options["diagnosticFormat"] {
  const index = args.indexOf("--diagnostic-format");
  if (index === -1) return "text";
  return args[index + 1] === "json" ? "json" : "text";
}

function addTarget(options: Options, target: string): void {
  const targets: GenerateTarget[] = target === "all"
    ? ["tree-sitter", "typescript"]
    : target === "tree-sitter" || target === "typescript"
    ? [target]
    : [];
  if (targets.length === 0) {
    throw new BabaError({
      code: "CLI_BAD_ARGS",
      message: `Unknown target '${target}'`,
    });
  }
  for (const value of targets) {
    if (!options.targets.includes(value)) options.targets.push(value);
  }
}

function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) =>
    (diagnostic.severity ?? "error") === "error"
  );
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
