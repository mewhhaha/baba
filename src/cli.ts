/**
 * Command-line entrypoint for compiling explicit grammar source to Wasm lexer/parser outputs.
 *
 * @module
 */

import type { Diagnostic, GenerateTarget, WasmTargetOptions } from "./ast.ts";
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
  wasm: WasmTargetOptions;
  listFiles: boolean;
  explainTargets: boolean;
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
  if (options.explainTargets) {
    emitTargetExplanation(grammar, metadata, options);
    return;
  }
  const result = compile(grammar, {
    name: options.name,
    rootRule: options.rootRule,
    metadata,
    targets: options.targets.length ? options.targets : undefined,
    wasm: hasWasmOptions(options.wasm) ? options.wasm : undefined,
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
    wasm: {},
    listFiles: false,
    explainTargets: false,
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
      case "--wasm-dir": {
        const directory = args[++i];
        if (!directory) {
          throw new BabaError({
            code: "CLI_BAD_ARGS",
            message: `Expected directory after ${arg}`,
          });
        }
        options.wasm.directory = directory;
        break;
      }
      case "--preserve-trivia":
        options.wasm.preserveTrivia = true;
        break;
      case "--discard-trivia":
        options.wasm.preserveTrivia = false;
        break;
      case "--lexer-state-limit":
        options.wasm.lexerStateLimit = parsePositiveIntegerArg(
          args[++i],
          arg,
        );
        break;
      case "--regex-ast-node-limit":
        options.wasm.regexAstNodeLimit = parsePositiveIntegerArg(
          args[++i],
          arg,
        );
        break;
      case "--regex-bounded-repeat-limit":
        options.wasm.regexBoundedRepeatLimit = parsePositiveIntegerArg(
          args[++i],
          arg,
        );
        break;
      case "--regex-nfa-state-limit":
        options.wasm.regexNfaStateLimit = parsePositiveIntegerArg(
          args[++i],
          arg,
        );
        break;
      case "--regex-dfa-state-limit":
        options.wasm.regexDfaStateLimit = parsePositiveIntegerArg(
          args[++i],
          arg,
        );
        break;
      case "--regex-overlap-state-limit":
        options.wasm.regexOverlapStateLimit = parsePositiveIntegerArg(
          args[++i],
          arg,
        );
        break;
      case "--grammar-expression-depth-limit":
        options.wasm.grammarExpressionDepthLimit = parsePositiveIntegerArg(
          args[++i],
          arg,
        );
        break;
      case "--parser-state-limit":
        options.wasm.parserStateLimit = parsePositiveIntegerArg(
          args[++i],
          arg,
        );
        break;
      case "--parser-item-limit":
        options.wasm.parserItemLimit = parsePositiveIntegerArg(
          args[++i],
          arg,
        );
        break;
      case "--lr-closure-work-limit":
        options.wasm.lrClosureWorkLimit = parsePositiveIntegerArg(
          args[++i],
          arg,
        );
        break;
      case "--parser-table-entry-limit":
        options.wasm.parserTableEntryLimit = parsePositiveIntegerArg(
          args[++i],
          arg,
        );
        break;
      case "--wasm-generated-byte-limit":
        options.wasm.generatedByteLimit = parsePositiveIntegerArg(
          args[++i],
          arg,
        );
        break;
      case "--parser-stats":
        options.wasm.reportParserStats = true;
        break;
      case "--wasm-stats":
        options.wasm.reportParserStats = true;
        break;
      case "--metadata":
      case "--meta": {
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
      case "--explain-targets":
        options.explainTargets = true;
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
  return `baba - compile explicit grammar source to a Wasm lexer/parser

Usage:
  baba <grammar.baba> --out generated
  baba check <grammar.baba>
  baba generate <grammar.baba> --out generated

Options:
  --name        Grammar/target name. Defaults to grammar
  --root        Root grammar rule. Defaults to the first grammar rule
  --target      Output target: wasm. "all" is accepted as an alias for wasm
  --wasm-dir    Wasm target output directory. Defaults to wasm
  --preserve-trivia  Preserve skip matches as trivia tokens
  --discard-trivia   Omit skip matches from generated lexer output
  --lexer-state-limit  Maximum portable runtime lexer DFA state count
  --regex-ast-node-limit       Maximum parsed regex AST node count
  --regex-bounded-repeat-limit  Maximum regex bounded-repeat expansion
  --regex-nfa-state-limit       Maximum regex NFA state count
  --regex-dfa-state-limit       Maximum regex DFA state count
  --regex-overlap-state-limit   Maximum overlap-analysis product states
  --grammar-expression-depth-limit  Maximum nested grammar expression depth
  --parser-state-limit  Maximum portable runtime LR state count
  --parser-item-limit   Maximum total portable runtime LR item count
  --lr-closure-work-limit  Maximum portable runtime LR closure work units
  --parser-table-entry-limit  Maximum portable runtime ACTION/GOTO entry count
  --wasm-generated-byte-limit  Maximum generated Wasm bytes
  --parser-stats  Emit Wasm runtime parser planning statistics
  --wasm-stats   Emit Wasm runtime parser planning statistics
  --metadata    JSON metadata for parser conflict policy and token/runtime options
  --meta        Alias for --metadata
  --diagnostic-format  Diagnostic output format: text or json. Defaults to text
  --explain-targets  Print target support diagnostics
  --list-files  Print generated file paths without writing output files`;
}

function parsePositiveIntegerArg(
  value: string | undefined,
  flag: string,
): number {
  if (!value) {
    throw new BabaError({
      code: "CLI_BAD_ARGS",
      message: `Expected positive integer after ${flag}`,
    });
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new BabaError({
      code: "CLI_BAD_ARGS",
      message: `Expected positive integer after ${flag}`,
    });
  }
  return parsed;
}

function hasWasmOptions(options: WasmTargetOptions): boolean {
  return Object.keys(options).length > 0;
}

interface TargetExplanation {
  target: GenerateTarget;
  label: string;
  diagnostics: readonly Diagnostic[];
}

function emitTargetExplanation(
  grammar: ReturnType<typeof parseGrammar>,
  metadata: ReturnType<typeof parseMetadata> | undefined,
  options: Options,
): void {
  const reports = explainTargets(grammar, metadata, options);
  console.log("Target support:");
  for (const report of reports) {
    const errors = report.diagnostics.filter((diagnostic) =>
      (diagnostic.severity ?? "error") === "error"
    );
    const warnings = report.diagnostics.filter((diagnostic) =>
      (diagnostic.severity ?? "error") === "warning"
    );
    const status = errors.length > 0
      ? "unsupported"
      : warnings.length > 0
      ? "supported with warnings"
      : "supported";
    console.log(`${report.label}: ${status}`);
  }

  const targetDiagnostics = uniqueDiagnostics(
    reports.flatMap((report) =>
      report.diagnostics.map((diagnostic) => ({
        target: report.label,
        diagnostic,
      }))
    ),
  );

  console.log("");
  console.log("Portable guarantees and limitations:");
  if (reports.every((report) => !hasErrors(report.diagnostics))) {
    console.log(
      "  ✓ generated Wasm parser and lexer use portable parser plan v2 and Baba regex/DFA semantics",
    );
  }
  console.log(
    "  - External scanner callbacks are not supported; use portable contextual tokens",
  );
  console.log(
    "  ✓ Contextual token guards and parser-state promotion are encoded in the parser plan",
  );
  if (targetDiagnostics.length === 0) {
    console.log("  ✓ no target capability diagnostics");
    return;
  }
  for (const { target, diagnostic } of targetDiagnostics) {
    const mark = (diagnostic.severity ?? "error") === "error" ? "✗" : "!";
    console.log(
      `  ${mark} ${target}: ${diagnostic.code}: ${diagnostic.message}`,
    );
  }
}

function explainTargets(
  grammar: ReturnType<typeof parseGrammar>,
  metadata: ReturnType<typeof parseMetadata> | undefined,
  options: Options,
): TargetExplanation[] {
  const targets: Array<[GenerateTarget, string]> = [
    ["wasm", "Wasm"],
  ];
  return targets.map(([target, label]) => {
    const result = compile(grammar, {
      name: options.name,
      rootRule: options.rootRule,
      metadata,
      targets: [target],
      wasm: hasWasmOptions(options.wasm) ? options.wasm : undefined,
    });
    return { target, label, diagnostics: result.diagnostics };
  });
}

function uniqueDiagnostics(
  entries: readonly {
    target: string;
    diagnostic: Diagnostic;
  }[],
): Array<{ target: string; diagnostic: Diagnostic }> {
  const seen = new Set<string>();
  const unique: Array<{ target: string; diagnostic: Diagnostic }> = [];
  for (const entry of entries) {
    const key = [
      entry.diagnostic.code,
      entry.diagnostic.message,
      entry.diagnostic.severity ?? "error",
    ].join("\0");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  return unique;
}

function diagnosticFormatFromArgs(
  args: readonly string[],
): Options["diagnosticFormat"] {
  const index = args.indexOf("--diagnostic-format");
  if (index === -1) return "text";
  return args[index + 1] === "json" ? "json" : "text";
}

function addTarget(options: Options, target: string): void {
  let targets: GenerateTarget[] = [];
  if (target === "all" || target === "wasm") {
    targets = ["wasm"];
  }
  if (targets.length === 0) {
    throw new BabaError({
      code: "CLI_BAD_ARGS",
      message:
        `Unknown target '${target}'. Baba generates the wasm target only.`,
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
