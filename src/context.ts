import type {
  BabaMetadata,
  EbnfGrammar,
  GenerateOptions,
  GeneratePreset,
  LexicalSpec,
} from "./ast.ts";
import { BabaError, toBabaError } from "./errors.ts";
import {
  collectTerminals,
  createLexicalSpec,
  validateEbnfGrammar,
  validateGenerationMetadataSemantics,
} from "./generate.ts";
import { parseEbnf } from "./parser.ts";

/** Shared derived state for one generation run. */
export interface GenerationContext {
  readonly grammar: EbnfGrammar;
  readonly name: string;
  readonly rootRuleName: string;
  readonly preset: GeneratePreset;
  readonly metadata: BabaMetadata;
  readonly lexicalSpec: LexicalSpec;
  readonly terminals: string[];
}

/** Parses, validates, and derives generation state once. */
export function createGenerationContext(
  sourceOrGrammar: string | EbnfGrammar,
  options: GenerateOptions = {},
): GenerationContext {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  const preset = options.preset ?? "core";
  if (preset !== "core" && preset !== "workbench") {
    throw new BabaError({
      code: "INVALID_PRESET",
      message: `Unknown preset '${preset}'`,
    });
  }

  const rootRuleName = options.rootRule ?? grammar.rules[0]?.name ?? "module";
  const metadata = options.metadata ?? {};
  try {
    validateEbnfGrammar(grammar, { rootRule: rootRuleName });
  } catch (error) {
    throw toBabaError(error, "GRAMMAR_VALIDATION_ERROR");
  }
  try {
    validateGenerationMetadataSemantics(grammar, rootRuleName, metadata);
  } catch (error) {
    throw toBabaError(error, "METADATA_SEMANTIC_ERROR");
  }

  return {
    grammar,
    name: options.name ?? "grammar",
    rootRuleName,
    preset,
    metadata,
    lexicalSpec: createLexicalSpec(grammar, { skipValidation: true }),
    terminals: collectTerminals(grammar),
  };
}
