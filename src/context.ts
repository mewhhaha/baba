import type {
  BabaMetadata,
  EbnfGrammar,
  GenerateBackend,
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
  validateParserGrammar,
  validateTreeSitterBackendCapabilities,
} from "./generate.ts";
import { parseEbnf } from "./parser.ts";

/** Shared derived state for one generation run. */
export interface GenerationContext {
  readonly grammar: EbnfGrammar;
  readonly name: string;
  readonly rootRuleName: string;
  readonly preset: GeneratePreset;
  readonly backends: GenerateBackend[];
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
  const backends = normalizeBackends(options.backends);
  if (preset === "workbench" && options.backends !== undefined) {
    throw new BabaError({
      code: "INVALID_BACKENDS",
      message: "Backend selection is only supported by the core preset",
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
  try {
    if (preset === "workbench" || backends.includes("tree-sitter")) {
      validateTreeSitterBackendCapabilities(grammar);
    }
    if (preset === "workbench" || backends.includes("typescript-ll1")) {
      validateParserGrammar(grammar, rootRuleName);
    }
  } catch (error) {
    throw toBabaError(error, "BACKEND_CAPABILITY_ERROR");
  }

  return {
    grammar,
    name: options.name ?? "grammar",
    rootRuleName,
    preset,
    backends,
    metadata,
    lexicalSpec: createLexicalSpec(grammar, { skipValidation: true }),
    terminals: collectTerminals(grammar),
  };
}

function normalizeBackends(
  requested: readonly GenerateBackend[] | undefined,
): GenerateBackend[] {
  const backends = requested ?? ["tree-sitter", "typescript-ll1"];
  const seen = new Set<GenerateBackend>();
  for (const backend of backends) {
    if (backend !== "tree-sitter" && backend !== "typescript-ll1") {
      throw new BabaError({
        code: "INVALID_BACKEND",
        message: `Unknown backend '${backend}'`,
      });
    }
    seen.add(backend);
  }
  if (seen.size === 0) {
    throw new BabaError({
      code: "INVALID_BACKENDS",
      message: "Expected at least one backend",
    });
  }
  return [...seen];
}
