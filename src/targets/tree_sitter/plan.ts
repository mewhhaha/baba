import type { GeneratedFile } from "../../ast.ts";
import type { GenerationContext } from "../../context.ts";
import {
  generateTreeSitterGrammar,
  generateTreeSitterQueries,
} from "../../generate.ts";

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

/** Emits the existing Tree-sitter target files without changing their content. */
export function emitTreeSitterTarget(
  context: GenerationContext,
): GeneratedFile[] {
  const files: GeneratedFile[] = [{
    path: "grammar.js",
    content: generateTreeSitterGrammar(context.grammar, {
      name: context.name,
      rootRule: context.rootRuleName,
      metadata: context.metadata,
      skipValidation: true,
    }),
    kind: "source",
  }];
  const queries = generateTreeSitterQueries(context.grammar, {
    rootRule: context.rootRuleName,
    metadata: context.metadata,
    skipValidation: true,
  });
  for (const [path, name] of treeSitterQueryOutputs) {
    const content = queries[name];
    if (content.length > 0) files.push({ path, content, kind: "query" });
  }
  return files;
}
