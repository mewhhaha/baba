import type {
  BabaMetadata,
  Diagnostic,
  EbnfGrammar,
  GeneratedBundle,
  GenerateOptions,
} from "./ast.ts";
import { generateCoreBundle } from "./backends.ts";
import { createGenerationContext } from "./context.ts";
import {
  collectGrammarDiagnostics,
  collectReachabilityDiagnostics,
  collectTreeSitterHighlightDiagnostics,
} from "./generate.ts";
import { parseTreeSitterMetadata } from "./metadata.ts";
import { BabaError, formatDiagnostic, toBabaError } from "./errors.ts";
import { parseEbnf } from "./parser.ts";
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
  options: { rootRule?: string; metadata?: BabaMetadata } = {},
): Diagnostic[] {
  return collectGrammarDiagnostics(grammar, {
    rootRule: options.rootRule,
    externals: options.metadata?.externals,
  });
}

/** Generates a deterministic bundle from EBNF source or a parsed grammar. */
export function generate(
  sourceOrGrammar: string | EbnfGrammar,
  options: GenerateOptions = {},
): GeneratedBundle {
  try {
    const context = createGenerationContext(sourceOrGrammar, options);
    const diagnostics = [
      ...collectReachabilityDiagnostics(context.grammar, context.rootRuleName),
      ...collectTreeSitterHighlightDiagnostics(context.grammar, {
        rootRule: context.rootRuleName,
        metadata: context.metadata,
        skipValidation: true,
      }),
    ];
    const bundle = generateCoreBundle(context);
    return {
      ...bundle,
      diagnostics: diagnostics.length ? diagnostics : undefined,
    };
  } catch (error) {
    throw toBabaError(error, "GENERATION_ERROR");
  }
}

export { BabaError, formatDiagnostic };
