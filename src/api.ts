import type {
  BabaMetadata,
  CompileOptions,
  CompileResult,
  Diagnostic,
  EbnfGrammar,
  GeneratedBundle,
  GeneratedFile,
  GenerateOptions,
  GenerateTarget,
  GrammarDocument,
  PortabilityMode,
  ValidateOptions,
} from "./ast.ts";
import { parseMetadata as parseBabaMetadata } from "./metadata.ts";
import { BabaError, formatDiagnostic, toBabaError } from "./errors.ts";
import { parseGrammarSource } from "./grammar.ts";
import { generatedBundle } from "./bundle.ts";
import { analyzeGrammar } from "./compiler/analyze.ts";
import { analyzeGrammarDocumentForWasm } from "./compiler/grammar_wasm_analysis.ts";
import type { AnalyzedGrammar } from "./compiler/ir.ts";
import {
  DEFAULT_REGEX_NESTING_LIMIT,
  type RegexCompilerLimits,
} from "./compiler/regex/limits.ts";
import {
  emitWasmTarget,
  planWasmTarget,
  type WasmPlan,
  wasmRuntimePlanningOptions,
} from "./targets/wasm/plan.ts";
import {
  planPortableRuntime,
  type RuntimeParserPlanningOptions,
} from "./targets/runtime/plan.ts";
import { emitTreeSitterQueryFiles } from "./targets/tree_sitter_queries.ts";
export { applyBundle } from "./output.ts";

type GrammarObject = EbnfGrammar | GrammarDocument;

interface PreparedGrammar {
  readonly grammar?: GrammarObject;
  readonly diagnostics: readonly Diagnostic[];
  readonly name?: string;
}

/** Parses grammar source into a syntax document. */
export function parseGrammar(source: string): GrammarDocument {
  const result = parseGrammarSource(source);
  const diagnostics = publicGrammarDiagnostics(result.diagnostics);
  const error = diagnostics.find((diagnostic) => isError(diagnostic));
  if (error) {
    throw new BabaError(error);
  }
  if (result.grammar === undefined) {
    throw new BabaError(missingGrammarDocumentDiagnostic());
  }
  return result.grammar;
}

/** Parses baba metadata JSON. */
export function parseMetadata(source: string): BabaMetadata {
  try {
    return parseBabaMetadata(source);
  } catch (error) {
    throw toBabaError(error, "METADATA_ERROR");
  }
}

/** Validates a grammar for the Wasm lexer/parser target. */
export function validateGrammar(
  grammar: GrammarObject,
  options: ValidateOptions = {},
): Diagnostic[] {
  const prepared = prepareGrammarObject(grammar);
  const diagnostics: Diagnostic[] = [...prepared.diagnostics];
  if (hasErrors(diagnostics)) return diagnostics;
  if (prepared.grammar === undefined) {
    diagnostics.push(missingGrammarDocumentDiagnostic());
    return diagnostics;
  }

  let targets: GenerateTarget[];
  try {
    targets = normalizeTargets(options.targets);
  } catch (error) {
    return [toBabaError(error, "VALIDATION_ERROR").toDiagnostic()];
  }

  const portability = normalizePortability(options.portability, targets);
  const runtimeOptions = sharedRuntimePlanningOptions(targets, options);
  const analyzed = analyzePreparedGrammar(prepared.grammar, {
    name: selectedGrammarName(undefined, prepared.name),
    rootRule: options.rootRule,
    metadata: options.metadata,
    regexLimits: {
      sourceLengthLimit: runtimeOptions.regexSourceLengthLimit,
      nestingLimit: regexNestingLimit(runtimeOptions),
    },
    grammarExpressionDepthLimit: runtimeOptions.grammarExpressionDepthLimit,
  });
  diagnostics.push(...analyzed.diagnostics);
  if (hasErrors(diagnostics)) return diagnostics;

  const metadata = metadataOrEmpty(options.metadata);
  const runtimePlan = planPortableRuntime(
    analyzed,
    runtimeOptions,
    metadata,
    portability,
  );
  diagnostics.push(...runtimePlan.diagnostics);
  try {
    diagnostics.push(
      ...planWasmTarget(
        analyzed,
        options.wasm,
        metadata,
        portability,
        runtimePlan,
      ).diagnostics,
    );
  } catch (error) {
    diagnostics.push(
      toBabaError(error, "WASM_TARGET_INTERNAL_ERROR").toDiagnostic(),
    );
  }
  return diagnostics;
}

/** Compiles a grammar into a Wasm lexer/parser bundle, returning diagnostics without throwing. */
export function compile(
  sourceOrGrammar: string | GrammarObject,
  options: CompileOptions = {},
): CompileResult {
  const prepared = prepareGrammarInput(sourceOrGrammar);
  const diagnostics: Diagnostic[] = [...prepared.diagnostics];
  if (hasErrors(diagnostics)) {
    return { diagnostics };
  }
  if (prepared.grammar === undefined) {
    diagnostics.push(missingGrammarDocumentDiagnostic());
    return { diagnostics };
  }

  let targets: GenerateTarget[];
  try {
    targets = normalizeTargets(options.targets);
  } catch (error) {
    return {
      diagnostics: [toBabaError(error, "GENERATION_ERROR").toDiagnostic()],
    };
  }

  const grammar = prepared.grammar;
  const metadata = metadataOrEmpty(options.metadata);
  const portability = normalizePortability(options.portability, targets);
  const runtimeOptions = sharedRuntimePlanningOptions(targets, options);
  const analyzed = analyzePreparedGrammar(grammar, {
    name: selectedGrammarName(options.name, prepared.name),
    rootRule: options.rootRule,
    metadata,
    regexLimits: {
      sourceLengthLimit: runtimeOptions.regexSourceLengthLimit,
      nestingLimit: regexNestingLimit(runtimeOptions),
    },
    grammarExpressionDepthLimit: runtimeOptions.grammarExpressionDepthLimit,
  });
  diagnostics.push(...analyzed.diagnostics);
  let wasmPlan: WasmPlan | { diagnostics: readonly Diagnostic[] } | undefined;
  const runtimePlan = planPortableRuntime(
    analyzed,
    runtimeOptions,
    metadata,
    portability,
  );
  diagnostics.push(...runtimePlan.diagnostics);

  if (!hasErrors(diagnostics)) {
    try {
      wasmPlan = planWasmTarget(
        analyzed,
        options.wasm,
        metadata,
        portability,
        runtimePlan,
      );
    } catch (error) {
      diagnostics.push({
        ...toBabaError(error, "WASM_TARGET_INTERNAL_ERROR").toDiagnostic(),
        backend: "wasm",
      });
    }
  }

  if (wasmPlan !== undefined) diagnostics.push(...wasmPlan.diagnostics);
  if (hasErrors(diagnostics)) return { diagnostics };

  try {
    const files: GeneratedFile[] = [];
    if (isWasmPlan(wasmPlan)) {
      files.push(...emitWasmTarget(wasmPlan, options.wasm));
    }
    files.push(...emitTreeSitterQueryFiles(analyzed, metadata));

    diagnostics.push(...collectBundlePathDiagnostics(files));
    if (hasErrors(diagnostics)) return { diagnostics };

    const bundle = generatedBundle(files);
    if (diagnostics.length > 0) {
      return {
        diagnostics,
        bundle: { ...bundle, diagnostics },
      };
    }
    return { diagnostics, bundle };
  } catch (error) {
    return {
      diagnostics: [
        ...diagnostics,
        toBabaError(error, "GENERATION_ERROR").toDiagnostic(),
      ],
    };
  }
}

/** Generates a deterministic Wasm lexer/parser bundle from grammar source or a parsed grammar. */
export function generate(
  sourceOrGrammar: string | GrammarObject,
  options: GenerateOptions = {},
): GeneratedBundle {
  const result = compile(sourceOrGrammar, options);
  const error = result.diagnostics.find((diagnostic) => isError(diagnostic));
  if (error) throw new BabaError(error);
  if (!result.bundle) {
    throw new BabaError({
      code: "GENERATION_ERROR",
      message: "Generation did not produce a bundle.",
    });
  }
  return result.bundle;
}

export { BabaError, formatDiagnostic };

function sharedRuntimePlanningOptions(
  targets: readonly GenerateTarget[],
  options: CompileOptions | ValidateOptions,
): RuntimeParserPlanningOptions {
  if (!targets.includes("wasm")) {
    throw new BabaError({
      code: "UNKNOWN_TARGET",
      message: "Baba now generates Wasm parser/lexer artifacts only.",
    });
  }
  if (options.wasm !== undefined) {
    return wasmRuntimePlanningOptions(options.wasm);
  }
  return wasmRuntimePlanningOptions({});
}

function prepareGrammarInput(
  sourceOrGrammar: string | GrammarObject,
): PreparedGrammar {
  if (typeof sourceOrGrammar === "string") {
    const parsed = parseGrammarSource(sourceOrGrammar);
    const diagnostics: Diagnostic[] = [
      ...publicGrammarDiagnostics(parsed.diagnostics),
    ];
    if (hasErrors(diagnostics)) {
      return { diagnostics };
    }
    if (parsed.grammar === undefined) {
      diagnostics.push(missingGrammarDocumentDiagnostic());
      return { diagnostics };
    }
    return {
      grammar: parsed.grammar,
      diagnostics,
      name: parsed.grammar.name,
    };
  }

  return prepareGrammarObject(sourceOrGrammar);
}

function prepareGrammarObject(grammar: GrammarObject): PreparedGrammar {
  if (isGrammarDocument(grammar)) {
    return {
      grammar,
      diagnostics: [],
      name: grammar.name,
    };
  }

  return {
    grammar,
    diagnostics: [],
  };
}

function normalizeTargets(
  targets: readonly GenerateTarget[] | undefined,
): GenerateTarget[] {
  if (!targets || targets.length === 0) return ["wasm"];
  const result: GenerateTarget[] = [];
  for (const target of targets) {
    if (target !== "wasm") {
      throw new BabaError({
        code: "UNKNOWN_TARGET",
        message: `Unsupported generation target '${
          String(target)
        }'. Baba now generates Wasm parser/lexer artifacts only.`,
      });
    }
    if (!result.includes(target)) result.push(target);
  }
  return result;
}

function normalizePortability(
  portability: PortabilityMode | undefined,
  targets: readonly GenerateTarget[],
): PortabilityMode {
  if (
    portability === "strict" || portability === "warn" || portability === "off"
  ) {
    return portability;
  }
  if (targets.length > 1) return "strict";
  return "warn";
}

function metadataOrEmpty(metadata: BabaMetadata | undefined): BabaMetadata {
  if (metadata !== undefined) return metadata;
  return {};
}

function selectedGrammarName(
  name: string | undefined,
  parsedName: string | undefined,
): string {
  if (name !== undefined) return name;
  if (parsedName !== undefined) return parsedName;
  return "grammar";
}

function analyzePreparedGrammar(
  grammar: GrammarObject,
  options: {
    readonly name?: string;
    readonly rootRule?: string;
    readonly metadata?: BabaMetadata;
    readonly regexLimits?: RegexCompilerLimits;
    readonly grammarExpressionDepthLimit?: number;
  },
): AnalyzedGrammar {
  if (isGrammarDocument(grammar)) {
    return analyzeGrammarDocumentForWasm(grammar, options);
  }
  return analyzeGrammar(grammar, options);
}

function regexNestingLimit(
  options: RuntimeParserPlanningOptions,
): number {
  if (options.regexNestingLimit !== undefined) {
    return options.regexNestingLimit;
  }
  return DEFAULT_REGEX_NESTING_LIMIT;
}

function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => isError(diagnostic));
}

function isError(diagnostic: Diagnostic): boolean {
  if (diagnostic.severity === undefined) return true;
  return diagnostic.severity === "error";
}

function isWasmPlan(
  value:
    | WasmPlan
    | { diagnostics: readonly Diagnostic[] }
    | false
    | undefined,
): value is WasmPlan {
  return !!value && "wasm" in value;
}

function isGrammarDocument(
  value: GrammarObject,
): value is GrammarDocument {
  return "declarations" in value;
}

function publicGrammarDiagnostics(
  diagnostics: readonly Diagnostic[],
): Diagnostic[] {
  return [...diagnostics];
}

function missingGrammarDocumentDiagnostic(): Diagnostic {
  return {
    code: "GRAMMAR_PARSE_ERROR",
    severity: "error",
    message: "Grammar parser did not produce a document.",
  };
}

function collectBundlePathDiagnostics(
  files: readonly GeneratedFile[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const paths = files.map((file) => file.path).sort();
  const seen = new Set<string>();
  for (const path of paths) {
    if (seen.has(path)) {
      diagnostics.push({
        code: "OUTPUT_PATH_COLLISION",
        severity: "error",
        message: `Generated output path '${path}' is produced more than once.`,
      });
    }
    seen.add(path);
  }
  for (const path of paths) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index++) {
      const ancestor = parts.slice(0, index).join("/");
      if (seen.has(ancestor)) {
        diagnostics.push({
          code: "OUTPUT_PATH_COLLISION",
          severity: "error",
          message:
            `Generated output path '${ancestor}' collides with nested path '${path}'.`,
        });
      }
    }
  }
  return diagnostics;
}
