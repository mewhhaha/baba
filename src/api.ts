import type {
  BabaMetadata,
  Diagnostic,
  EbnfGrammar,
  GeneratedBundle,
  GenerateOptions,
} from "./ast.ts";
import { generatedBundle } from "./bundle.ts";
import { createGenerationContext } from "./context.ts";
import {
  collectTreeSitterHighlightDiagnostics,
  generateParserSource,
  generateTokenizerSource,
  generateTreeSitterGrammar,
  generateTreeSitterInjectionsQuery,
  generateTreeSitterRainbowsQuery,
  generateTreeSitterTextobjectsQuery,
  generateWorkbenchBundle,
  validateEbnfGrammar,
} from "./generate.ts";
import { generateInitBundle } from "./init.ts";
import { parseTreeSitterMetadata } from "./metadata.ts";
import { BabaError, formatDiagnostic, toBabaError } from "./errors.ts";
import { parseEbnf } from "./parser.ts";

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
  options: { rootRule?: string } = {},
): Diagnostic[] {
  try {
    validateEbnfGrammar(grammar, options);
    return [];
  } catch (error) {
    return [toBabaError(error, "GRAMMAR_VALIDATION_ERROR").toDiagnostic()];
  }
}

/** Generates a deterministic bundle from EBNF source or a parsed grammar. */
export function generate(
  sourceOrGrammar: string | EbnfGrammar,
  options: GenerateOptions = {},
): GeneratedBundle {
  try {
    const context = createGenerationContext(sourceOrGrammar, options);
    if (context.preset === "workbench") {
      const bundle = generateWorkbenchBundle(context.grammar, {
        name: context.name,
        rootRule: context.rootRuleName,
        metadata: context.metadata,
        skipValidation: true,
      });
      return {
        ...bundle,
        diagnostics: collectTreeSitterHighlightDiagnostics(context.grammar, {
          rootRule: context.rootRuleName,
          metadata: context.metadata,
          skipValidation: true,
        }),
      };
    }
    const files: Array<readonly [string, string]> = [];
    const cleanupPaths: string[] = [];
    const diagnostics = context.backends.includes("tree-sitter")
      ? collectTreeSitterHighlightDiagnostics(context.grammar, {
        rootRule: context.rootRuleName,
        metadata: context.metadata,
        skipValidation: true,
      })
      : [];
    if (context.backends.includes("tree-sitter")) {
      files.push([
        "grammar.js",
        generateTreeSitterGrammar(context.grammar, {
          name: context.name,
          rootRule: context.rootRuleName,
          metadata: context.metadata,
          skipValidation: true,
        }),
      ]);
      const injections = generateTreeSitterInjectionsQuery(context.grammar, {
        metadata: context.metadata,
        skipValidation: true,
      });
      if (injections) files.push(["injections.scm", injections]);
      else cleanupPaths.push("injections.scm");
      const rainbows = generateTreeSitterRainbowsQuery(context.grammar, {
        metadata: context.metadata,
        skipValidation: true,
      });
      if (rainbows) files.push(["rainbows.scm", rainbows]);
      else cleanupPaths.push("rainbows.scm");
      const textobjects = generateTreeSitterTextobjectsQuery(context.grammar, {
        metadata: context.metadata,
        skipValidation: true,
      });
      if (textobjects) files.push(["textobjects.scm", textobjects]);
      else cleanupPaths.push("textobjects.scm");
    } else {
      cleanupPaths.push(
        "grammar.js",
        "injections.scm",
        "rainbows.scm",
        "textobjects.scm",
      );
    }
    if (context.backends.includes("typescript-ll1")) {
      files.push([
        "lexical.json",
        `${JSON.stringify(context.lexicalSpec, null, 2)}\n`,
      ]);
      files.push([
        "parser.ts",
        generateParserSource(context.grammar, {
          rootRule: context.rootRuleName,
          skipValidation: true,
        }),
      ]);
      files.push([
        "tokenizer.ts",
        generateTokenizerSource(context.grammar, {
          spec: context.lexicalSpec,
          skipValidation: true,
        }),
      ]);
    } else {
      cleanupPaths.push("lexical.json", "parser.ts", "tokenizer.ts");
    }
    const bundle = generatedBundle("core", files, cleanupPaths);
    return {
      ...bundle,
      backends: context.backends,
      diagnostics: diagnostics.length ? diagnostics : undefined,
    };
  } catch (error) {
    throw toBabaError(error, "GENERATION_ERROR");
  }
}

export { BabaError, formatDiagnostic };
export { generateInitBundle };
