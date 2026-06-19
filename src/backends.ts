import type { GeneratedBundle } from "./ast.ts";
import { generatedBundle } from "./bundle.ts";
import type { GenerationContext } from "./context.ts";
import {
  generateLexicalManifest,
  generateParserSource,
  generateTokenizerSource,
  generateTreeSitterConfigSource,
  generateTreeSitterGrammar,
  generateWorkbenchQueries,
} from "./generate.ts";

const treeSitterQueryPaths = [
  "queries/highlights.scm",
  "queries/locals.scm",
  "queries/folds.scm",
  "queries/indents.scm",
  "queries/tags.scm",
  "queries/textobjects.scm",
  "queries/rainbows.scm",
  "queries/injections.scm",
];

const treeSitterOutputPaths = [
  "grammar.js",
  "tree-sitter.json",
  ...treeSitterQueryPaths,
];

const typescriptLl1OutputPaths = [
  "lexical.json",
  "parser.ts",
  "tokenizer.ts",
];

/** Builds the core preset bundle from independently selected backends. */
export function generateCoreBundle(
  context: GenerationContext,
): GeneratedBundle {
  const files: Array<readonly [string, string]> = [];
  const cleanupPaths: string[] = [];

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
    files.push([
      "tree-sitter.json",
      generateTreeSitterConfigSource(context.name, context.metadata),
    ]);
    const queries = generateWorkbenchQueries(context.grammar, {
      rootRule: context.rootRuleName,
      metadata: context.metadata,
      skipValidation: true,
    });
    for (const path of treeSitterQueryPaths) {
      const name = path.slice("queries/".length);
      files.push([path, queries[name]]);
    }
  } else {
    cleanupPaths.push(...treeSitterOutputPaths);
  }

  if (context.backends.includes("typescript-ll1")) {
    files.push([
      "lexical.json",
      generateLexicalManifest(context.grammar, { spec: context.lexicalSpec }),
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
        metadata: context.metadata,
        skipValidation: true,
      }),
    ]);
  } else {
    cleanupPaths.push(...typescriptLl1OutputPaths);
  }

  const bundle = generatedBundle("core", files, cleanupPaths);
  return {
    ...bundle,
    backends: context.backends,
  };
}
