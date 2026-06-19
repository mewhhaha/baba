import type { GeneratedBundle } from "./ast.ts";
import { generatedBundle } from "./bundle.ts";
import type { GenerationContext } from "./context.ts";
import {
  generateTreeSitterGrammar,
  generateTreeSitterQueries,
} from "./generate.ts";

const treeSitterQueryOutputs: Array<
  readonly [outputPath: string, queryName: string]
> = [
  ["queries/generated-highlights.scm", "highlights.scm"],
  ["queries/generated-locals.scm", "locals.scm"],
  ["queries/generated-folds.scm", "folds.scm"],
  ["queries/generated-indents.scm", "indents.scm"],
  ["queries/generated-tags.scm", "tags.scm"],
  ["queries/generated-textobjects.scm", "textobjects.scm"],
  ["queries/generated-rainbows.scm", "rainbows.scm"],
  ["queries/generated-injections.scm", "injections.scm"],
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
  for (const [path, name] of treeSitterQueryOutputs) {
    const content = queries[name];
    if (content.length > 0) files.push([path, content]);
  }
  return generatedBundle(files);
}
