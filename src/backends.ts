import type { GeneratedBundle } from "./ast.ts";
import { generatedBundle } from "./bundle.ts";
import type { GenerationContext } from "./context.ts";
import {
  generateTreeSitterGrammar,
  generateTreeSitterQueries,
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

/** Builds the Tree-sitter compiler output bundle. */
export function generateCoreBundle(
  context: GenerationContext,
): GeneratedBundle {
  const files: Array<readonly [string, string]> = [[
    "grammar.js",
    generateTreeSitterGrammar(context.grammar, {
      name: context.name,
      rootRule: context.rootRuleName,
      metadata: context.metadata,
      skipValidation: true,
    }),
  ]];
  const queries = generateTreeSitterQueries(context.grammar, {
    rootRule: context.rootRuleName,
    metadata: context.metadata,
    skipValidation: true,
  });
  for (const path of treeSitterQueryPaths) {
    const name = path.slice("queries/".length);
    files.push([path, queries[name]]);
  }
  return generatedBundle(files);
}
