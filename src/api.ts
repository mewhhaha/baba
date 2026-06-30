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
  PortabilityMode,
  ValidateOptions,
} from "./ast.ts";
import { parseMetadata as parseBabaMetadata } from "./metadata.ts";
import { BabaError, formatDiagnostic, toBabaError } from "./errors.ts";
import { parseEbnf } from "./parser.ts";
import { generatedBundle } from "./bundle.ts";
import { analyzeGrammar } from "./compiler/analyze.ts";
import { DEFAULT_REGEX_NESTING_LIMIT } from "./compiler/regex/limits.ts";
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
import { emitTreeSitterQueryFiles } from "./targets/tree_sitter/queries.ts";
export { applyBundle } from "./output.ts";

/** Parses EBNF source into a grammar AST. */
export function parseGrammar(source: string): EbnfGrammar {
  try {
    return parseEbnf(source);
  } catch (error) {
    throw toBabaError(error, "EBNF_PARSE_ERROR");
  }
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
  grammar: EbnfGrammar,
  options: ValidateOptions = {},
): Diagnostic[] {
  let targets: GenerateTarget[];
  try {
    targets = normalizeTargets(options.targets);
  } catch (error) {
    return [toBabaError(error, "VALIDATION_ERROR").toDiagnostic()];
  }

  const portability = normalizePortability(options.portability, targets);
  const runtimeOptions = sharedRuntimePlanningOptions(targets, options);
  const analyzed = analyzeGrammar(grammar, {
    name: "grammar",
    rootRule: options.rootRule,
    metadata: options.metadata,
    regexLimits: {
      sourceLengthLimit: runtimeOptions.regexSourceLengthLimit,
      nestingLimit: regexNestingLimit(runtimeOptions),
    },
    grammarExpressionDepthLimit: runtimeOptions.grammarExpressionDepthLimit,
  });
  const diagnostics = [...analyzed.diagnostics];
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
  sourceOrGrammar: string | EbnfGrammar,
  options: CompileOptions = {},
): CompileResult {
  let grammar: EbnfGrammar;
  try {
    if (typeof sourceOrGrammar === "string") {
      grammar = parseEbnf(sourceOrGrammar);
    } else {
      grammar = sourceOrGrammar;
    }
  } catch (error) {
    return {
      diagnostics: [toBabaError(error, "EBNF_PARSE_ERROR").toDiagnostic()],
    };
  }

  let targets: GenerateTarget[];
  try {
    targets = normalizeTargets(options.targets);
  } catch (error) {
    return {
      diagnostics: [toBabaError(error, "GENERATION_ERROR").toDiagnostic()],
    };
  }

  const rootRuleName = selectedRootRuleName(grammar, options.rootRule);
  const metadata = metadataOrEmpty(options.metadata);
  const portability = normalizePortability(options.portability, targets);
  const runtimeOptions = sharedRuntimePlanningOptions(targets, options);
  const analyzed = analyzeGrammar(grammar, {
    name: grammarName(options.name),
    rootRule: rootRuleName,
    metadata,
    regexLimits: {
      sourceLengthLimit: runtimeOptions.regexSourceLengthLimit,
      nestingLimit: regexNestingLimit(runtimeOptions),
    },
    grammarExpressionDepthLimit: runtimeOptions.grammarExpressionDepthLimit,
  });
  const diagnostics: Diagnostic[] = [...analyzed.diagnostics];
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

/** Generates a deterministic Wasm lexer/parser bundle from EBNF source or a parsed grammar. */
export function generate(
  sourceOrGrammar: string | EbnfGrammar,
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

function selectedRootRuleName(
  grammar: EbnfGrammar,
  rootRule: string | undefined,
): string {
  if (rootRule !== undefined) return rootRule;
  const firstRule = grammar.rules[0];
  if (firstRule !== undefined) return firstRule.name;
  return "module";
}

function grammarName(name: string | undefined): string {
  if (name !== undefined) return name;
  return "grammar";
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
