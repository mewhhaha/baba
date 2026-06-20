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
  ValidateOptions,
} from "./ast.ts";
import { createGenerationContext } from "./context.ts";
import {
  collectReachabilityDiagnostics,
  collectTreeSitterHighlightDiagnostics,
  validateTreeSitterBackendCapabilities,
  validateTreeSitterGenerationMetadataSemantics,
} from "./generate.ts";
import { parseTreeSitterMetadata } from "./metadata.ts";
import { BabaError, formatDiagnostic, toBabaError } from "./errors.ts";
import { parseEbnf } from "./parser.ts";
import { generatedBundle } from "./bundle.ts";
import { analyzeGrammar } from "./compiler/analyze.ts";
import { emitTreeSitterTarget } from "./targets/tree_sitter/plan.ts";
import {
  emitTypeScriptTarget,
  planTypeScriptTarget,
  type TypeScriptPlan,
} from "./targets/typescript/plan.ts";
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
    return parseTreeSitterMetadata(source);
  } catch (error) {
    throw toBabaError(error, "METADATA_ERROR");
  }
}

/** Validates a grammar and returns diagnostics instead of throwing. */
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
  const analyzed = analyzeGrammar(grammar, {
    name: "grammar",
    rootRule: options.rootRule,
    metadata: options.metadata,
  });
  const diagnostics = [...analyzed.diagnostics];
  if (hasErrors(diagnostics)) return diagnostics;
  if (targets.includes("tree-sitter")) {
    diagnostics.push(...treeSitterValidationDiagnostics(
      grammar,
      options.rootRule ?? grammar.rules[0]?.name ?? "module",
      options.metadata ?? {},
    ));
  }
  if (targets.includes("typescript")) {
    try {
      diagnostics.push(
        ...planTypeScriptTarget(
          analyzed,
          options.typescript,
          options.metadata,
        ).diagnostics,
      );
    } catch (error) {
      diagnostics.push(
        toBabaError(error, "TYPESCRIPT_TARGET_INTERNAL_ERROR").toDiagnostic(),
      );
    }
  }
  return diagnostics;
}

/** Compiles a grammar into a bundle, returning diagnostics without throwing. */
export function compile(
  sourceOrGrammar: string | EbnfGrammar,
  options: CompileOptions = {},
): CompileResult {
  let grammar: EbnfGrammar;
  try {
    grammar = typeof sourceOrGrammar === "string"
      ? parseEbnf(sourceOrGrammar)
      : sourceOrGrammar;
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
  const rootRuleName = options.rootRule ?? grammar.rules[0]?.name ?? "module";
  const metadata = options.metadata ?? {};
  const analyzed = analyzeGrammar(grammar, {
    name: options.name ?? "grammar",
    rootRule: rootRuleName,
    metadata,
  });
  const diagnostics: Diagnostic[] = [...analyzed.diagnostics];
  let typeScriptPlan:
    | TypeScriptPlan
    | { diagnostics: readonly Diagnostic[] }
    | undefined;
  if (targets.includes("typescript") && !hasErrors(diagnostics)) {
    try {
      typeScriptPlan = planTypeScriptTarget(
        analyzed,
        options.typescript,
        metadata,
      );
    } catch (error) {
      diagnostics.push({
        ...toBabaError(error, "TYPESCRIPT_TARGET_INTERNAL_ERROR")
          .toDiagnostic(),
        backend: "typescript",
      });
    }
  }

  if (!hasErrors(diagnostics) && targets.includes("tree-sitter")) {
    diagnostics.push(
      ...treeSitterValidationDiagnostics(grammar, rootRuleName, metadata),
    );
  }
  if (typeScriptPlan) diagnostics.push(...typeScriptPlan.diagnostics);
  if (hasErrors(diagnostics)) return { diagnostics };

  try {
    const files: GeneratedFile[] = [];
    const context = createGenerationContext(grammar, {
      ...options,
      targets,
      rootRule: rootRuleName,
      metadata,
    });
    if (targets.includes("tree-sitter")) {
      files.push(...emitTreeSitterTarget(context));
      diagnostics.push(
        ...collectReachabilityDiagnostics(
          context.grammar,
          context.rootRuleName,
        ),
        ...collectTreeSitterHighlightDiagnostics(context.grammar, {
          rootRule: context.rootRuleName,
          metadata: context.metadata,
          skipValidation: true,
        }),
      );
    }
    if (isTypeScriptPlan(typeScriptPlan)) {
      files.push(...emitTypeScriptTarget(typeScriptPlan, options.typescript));
    }

    diagnostics.push(...collectBundlePathDiagnostics(files));
    if (hasErrors(diagnostics)) return { diagnostics };

    const bundle = generatedBundle(files);
    return {
      diagnostics,
      bundle: diagnostics.length ? { ...bundle, diagnostics } : bundle,
    };
  } catch (error) {
    return {
      diagnostics: [
        ...diagnostics,
        toBabaError(error, "GENERATION_ERROR").toDiagnostic(),
      ],
    };
  }
}

/** Generates a deterministic bundle from EBNF source or a parsed grammar. */
export function generate(
  sourceOrGrammar: string | EbnfGrammar,
  options: GenerateOptions = {},
): GeneratedBundle {
  const result = compile(sourceOrGrammar, options);
  const error = result.diagnostics.find((diagnostic) =>
    (diagnostic.severity ?? "error") === "error"
  );
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

function treeSitterValidationDiagnostics(
  grammar: EbnfGrammar,
  rootRuleName: string,
  metadata: BabaMetadata,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  try {
    validateTreeSitterGenerationMetadataSemantics(
      grammar,
      rootRuleName,
      metadata,
    );
  } catch (error) {
    const diagnostic = toBabaError(error, "METADATA_SEMANTIC_ERROR")
      .toDiagnostic();
    diagnostics.push({
      ...diagnostic,
      backend: diagnostic.backend ?? "tree-sitter",
    });
  }
  try {
    validateTreeSitterBackendCapabilities(grammar);
  } catch (error) {
    const diagnostic = toBabaError(error, "BACKEND_CAPABILITY_ERROR")
      .toDiagnostic();
    diagnostics.push({
      ...diagnostic,
      backend: diagnostic.backend ?? "tree-sitter",
    });
  }
  return diagnostics;
}

function normalizeTargets(
  targets: readonly GenerateTarget[] | undefined,
): GenerateTarget[] {
  if (!targets || targets.length === 0) return ["tree-sitter"];
  const result: GenerateTarget[] = [];
  for (const target of targets) {
    if (target !== "tree-sitter" && target !== "typescript") {
      throw new BabaError({
        code: "UNKNOWN_TARGET",
        message: `Unknown generation target '${String(target)}'.`,
      });
    }
    if (!result.includes(target)) result.push(target);
  }
  return result;
}

function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) =>
    (diagnostic.severity ?? "error") === "error"
  );
}

function isTypeScriptPlan(
  value:
    | TypeScriptPlan
    | { diagnostics: readonly Diagnostic[] }
    | false
    | undefined,
): value is TypeScriptPlan {
  return !!value && "bnf" in value;
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
  for (let index = 0; index < paths.length; index++) {
    const path = paths[index];
    for (let next = index + 1; next < paths.length; next++) {
      const other = paths[next];
      if (!other.startsWith(`${path}/`)) break;
      diagnostics.push({
        code: "OUTPUT_PATH_COLLISION",
        severity: "error",
        message:
          `Generated output path '${path}' collides with nested path '${other}'.`,
      });
    }
  }
  return diagnostics;
}
