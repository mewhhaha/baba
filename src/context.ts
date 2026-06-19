import type { BabaMetadata, EbnfGrammar, GenerateOptions } from "./ast.ts";
import { BabaError, toBabaError } from "./errors.ts";
import {
  collectGrammarDiagnostics,
  validateTreeSitterBackendCapabilities,
  validateTreeSitterGenerationMetadataSemantics,
} from "./generate.ts";
import { parseEbnf } from "./parser.ts";

/** Shared derived state for one generation run. */
export interface GenerationContext {
  readonly grammar: EbnfGrammar;
  readonly name: string;
  readonly rootRuleName: string;
  readonly metadata: BabaMetadata;
}

/** Parses, validates, and derives generation state once. */
export function createGenerationContext(
  sourceOrGrammar: string | EbnfGrammar,
  options: GenerateOptions = {},
): GenerationContext {
  assertRemovedOptions(options);
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  const rootRuleName = options.rootRule ?? grammar.rules[0]?.name ?? "module";
  const metadata = options.metadata ?? {};
  const targets = options.targets ?? ["tree-sitter"];
  const grammarDiagnostics = collectGrammarDiagnostics(grammar, {
    rootRule: rootRuleName,
    externals: metadata.externals,
  });
  const grammarError = grammarDiagnostics.find((diagnostic) =>
    diagnostic.severity === "error"
  );
  if (grammarError) {
    throw new BabaError(grammarError);
  }
  if (targets.includes("tree-sitter")) {
    try {
      validateTreeSitterGenerationMetadataSemantics(
        grammar,
        rootRuleName,
        metadata,
      );
    } catch (error) {
      throw toBabaError(error, "METADATA_SEMANTIC_ERROR");
    }
    try {
      validateTreeSitterBackendCapabilities(grammar);
    } catch (error) {
      throw toBabaError(error, "BACKEND_CAPABILITY_ERROR");
    }
  }

  return {
    grammar,
    name: options.name ?? "grammar",
    rootRuleName,
    metadata,
  };
}

function assertRemovedOptions(options: GenerateOptions): void {
  const legacy = options as GenerateOptions & {
    preset?: unknown;
    backends?: unknown;
  };
  if (legacy.preset !== undefined) {
    throw new BabaError({
      code: "REMOVED_OPTION",
      message: "The workbench preset was removed in baba 1.0.",
    });
  }
  if (legacy.backends !== undefined) {
    throw new BabaError({
      code: "REMOVED_OPTION",
      message:
        "Backend selection was removed in baba 1.0; baba now emits Tree-sitter artifacts only.",
    });
  }
}
