/**
 * Command-line entrypoint for compiling explicit EBNF to Tree-sitter outputs.
 *
 * @module
 */

import type {
  Diagnostic,
  GenerateTarget,
  KitTargetOptions,
  PortabilityMode,
  TypeScriptTargetOptions,
  WasmTargetOptions,
} from "./ast.ts";
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
  portability?: PortabilityMode;
  typescript: TypeScriptTargetOptions;
  wasm: WasmTargetOptions;
  kit: KitTargetOptions;
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
    portability: options.portability,
    typescript: hasTypeScriptOptions(options.typescript)
      ? options.typescript
      : undefined,
    wasm: hasWasmOptions(options.wasm) ? options.wasm : undefined,
    kit: hasKitOptions(options.kit) ? options.kit : undefined,
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
    typescript: {},
    wasm: {},
    kit: {},
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
      case "--typescript-dir":
      case "--ts-out": {
        const directory = args[++i];
        if (!directory) {
          throw new BabaError({
            code: "CLI_BAD_ARGS",
            message: `Expected directory after ${arg}`,
          });
        }
        options.typescript.directory = directory;
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
      case "--kit-dir": {
        const directory = args[++i];
        if (!directory) {
          throw new BabaError({
            code: "CLI_BAD_ARGS",
            message: `Expected directory after ${arg}`,
          });
        }
        options.kit.directory = directory;
        break;
      }
      case "--kit-profile":
      case "--kit-mode": {
        const profile = args[++i];
        if (!profile) {
          throw new BabaError({
            code: "CLI_BAD_ARGS",
            message: `Expected profile after ${arg}`,
          });
        }
        if (profile !== "full" && profile !== "runtime") {
          throw new BabaError({
            code: "CLI_BAD_ARGS",
            message: "Expected kit profile full or runtime",
          });
        }
        options.kit.profile = profile;
        break;
      }
      case "--preserve-trivia":
        options.typescript.preserveTrivia = true;
        options.wasm.preserveTrivia = true;
        options.kit.preserveTrivia = true;
        break;
      case "--discard-trivia":
        options.typescript.preserveTrivia = false;
        options.wasm.preserveTrivia = false;
        options.kit.preserveTrivia = false;
        break;
      case "--lexer-state-limit":
        options.typescript.lexerStateLimit = parsePositiveIntegerArg(
          args[++i],
          arg,
        );
        options.wasm.lexerStateLimit = options.typescript.lexerStateLimit;
        options.kit.lexerStateLimit = options.typescript.lexerStateLimit;
        break;
      case "--regex-ast-node-limit":
        options.typescript.regexAstNodeLimit = parsePositiveIntegerArg(
          args[++i],
          arg,
        );
        options.wasm.regexAstNodeLimit = options.typescript.regexAstNodeLimit;
        options.kit.regexAstNodeLimit = options.typescript.regexAstNodeLimit;
        break;
      case "--regex-bounded-repeat-limit":
        options.typescript.regexBoundedRepeatLimit = parsePositiveIntegerArg(
          args[++i],
          arg,
        );
        options.wasm.regexBoundedRepeatLimit =
          options.typescript.regexBoundedRepeatLimit;
        options.kit.regexBoundedRepeatLimit =
          options.typescript.regexBoundedRepeatLimit;
        break;
      case "--regex-nfa-state-limit":
        options.typescript.regexNfaStateLimit = parsePositiveIntegerArg(
          args[++i],
          arg,
        );
        options.wasm.regexNfaStateLimit = options.typescript.regexNfaStateLimit;
        options.kit.regexNfaStateLimit = options.typescript.regexNfaStateLimit;
        break;
      case "--regex-dfa-state-limit":
        options.typescript.regexDfaStateLimit = parsePositiveIntegerArg(
          args[++i],
          arg,
        );
        options.wasm.regexDfaStateLimit = options.typescript.regexDfaStateLimit;
        options.kit.regexDfaStateLimit = options.typescript.regexDfaStateLimit;
        break;
      case "--regex-overlap-state-limit":
        options.typescript.regexOverlapStateLimit = parsePositiveIntegerArg(
          args[++i],
          arg,
        );
        options.wasm.regexOverlapStateLimit =
          options.typescript.regexOverlapStateLimit;
        options.kit.regexOverlapStateLimit =
          options.typescript.regexOverlapStateLimit;
        break;
      case "--parser-state-limit":
        options.typescript.parserStateLimit = parsePositiveIntegerArg(
          args[++i],
          arg,
        );
        options.wasm.parserStateLimit = options.typescript.parserStateLimit;
        options.kit.parserStateLimit = options.typescript.parserStateLimit;
        break;
      case "--parser-item-limit":
        options.typescript.parserItemLimit = parsePositiveIntegerArg(
          args[++i],
          arg,
        );
        options.wasm.parserItemLimit = options.typescript.parserItemLimit;
        options.kit.parserItemLimit = options.typescript.parserItemLimit;
        break;
      case "--parser-table-entry-limit":
        options.typescript.parserTableEntryLimit = parsePositiveIntegerArg(
          args[++i],
          arg,
        );
        options.wasm.parserTableEntryLimit =
          options.typescript.parserTableEntryLimit;
        options.kit.parserTableEntryLimit =
          options.typescript.parserTableEntryLimit;
        break;
      case "--generated-byte-limit":
        options.typescript.generatedByteLimit = parsePositiveIntegerArg(
          args[++i],
          arg,
        );
        break;
      case "--parser-stats":
        options.typescript.reportParserStats = true;
        break;
      case "--verbose":
        options.typescript.reportParserStats = true;
        break;
      case "--portability": {
        const portability = args[++i];
        if (
          portability !== "strict" &&
          portability !== "warn" &&
          portability !== "off"
        ) {
          throw new BabaError({
            code: "CLI_BAD_ARGS",
            message: "Expected portability mode strict, warn, or off",
          });
        }
        options.portability = portability;
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
      case "init":
      case "--preset":
      case "--backend":
        throw new BabaError({
          code: "REMOVED_CLI_OPTION",
          message:
            `'${arg}' was removed in baba 1.0. Use --target tree-sitter, --target typescript, --target wasm, --target kit, or --target all.`,
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
  --target      Output target: tree-sitter, typescript, wasm, kit, or all. May repeat
  --typescript-dir  TypeScript target output directory. Defaults to typescript
  --ts-out      Alias for --typescript-dir
  --wasm-dir    Wasm target output directory. Defaults to wasm
  --kit-dir     Parser-kit target output directory. Defaults to kit
  --kit-profile Parser-kit detail profile: full or runtime. Defaults to full
  --preserve-trivia  Preserve skip matches as trivia tokens
  --discard-trivia   Omit skip matches from generated lexer output
  --lexer-state-limit  Maximum TypeScript lexer DFA state count
  --regex-ast-node-limit       Maximum parsed regex AST node count
  --regex-bounded-repeat-limit  Maximum regex bounded-repeat expansion
  --regex-nfa-state-limit       Maximum regex NFA state count
  --regex-dfa-state-limit       Maximum regex DFA state count
  --regex-overlap-state-limit   Maximum overlap-analysis product states
  --parser-state-limit  Maximum TypeScript LR state count
  --parser-item-limit   Maximum total TypeScript LR item count
  --parser-table-entry-limit  Maximum TypeScript ACTION/GOTO entry count
  --generated-byte-limit  Maximum generated TypeScript source bytes
  --parser-stats  Emit TypeScript parser planning statistics
  --verbose      Alias for --parser-stats
  --portability  Cross-target portability mode: strict, warn, or off
  --metadata    JSON metadata for Tree-sitter shaping and query generation
  --meta        Alias for --metadata
  --ts-meta     Deprecated alias for --metadata
  --diagnostic-format  Diagnostic output format: text or json. Defaults to text
  --explain-targets  Print target support and portability diagnostics
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

function hasTypeScriptOptions(options: TypeScriptTargetOptions): boolean {
  return Object.keys(options).length > 0;
}

function hasWasmOptions(options: WasmTargetOptions): boolean {
  return Object.keys(options).length > 0;
}

function hasKitOptions(options: KitTargetOptions): boolean {
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
  if (
    reports
      .filter((report) => report.target !== "tree-sitter")
      .every((report) => !hasErrors(report.diagnostics))
  ) {
    console.log(
      "  ✓ TypeScript, Wasm, and kit share portable parser plan v1 and identical Baba regex/DFA semantics",
    );
  }
  if (
    !hasErrors(reports.find((report) => report.target === "kit")!.diagnostics)
  ) {
    console.log("  ✓ parser-kit schema v1 is available");
  }
  console.log(
    "  - Tree-sitter regex output is lowered from the same Baba regex AST; unsupported backend constructs are reported per target",
  );
  console.log(
    "  - External tokens are not supported by portable runtime targets; reachable externals are reported per target",
  );
  console.log(
    "  - Contextual token overlap status is reported through target capability diagnostics",
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
    ["tree-sitter", "Tree-sitter"],
    ["typescript", "TypeScript"],
    ["wasm", "Wasm"],
    ["kit", "Kit"],
  ];
  return targets.map(([target, label]) => {
    const result = compile(grammar, {
      name: options.name,
      rootRule: options.rootRule,
      metadata,
      targets: [target],
      portability: options.portability,
      typescript: hasTypeScriptOptions(options.typescript)
        ? options.typescript
        : undefined,
      wasm: hasWasmOptions(options.wasm) ? options.wasm : undefined,
      kit: hasKitOptions(options.kit) ? options.kit : undefined,
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
  const targets: GenerateTarget[] = target === "all"
    ? ["tree-sitter", "typescript", "wasm"]
    : target === "tree-sitter" || target === "typescript" ||
        target === "wasm" || target === "kit"
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
