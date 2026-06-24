import type { BabaMetadata, GeneratedFile } from "../../ast.ts";
import type { AnalyzedGrammar } from "../../compiler/ir.ts";
import {
  generateAnalyzedTreeSitterGrammar,
  generateAnalyzedTreeSitterQueries,
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
  analyzed: AnalyzedGrammar,
  options: {
    name?: string;
    metadata?: BabaMetadata;
  } = {},
): GeneratedFile[] {
  const metadata = options.metadata ?? {};
  const files: GeneratedFile[] = [{
    path: "grammar.js",
    content: generateAnalyzedTreeSitterGrammar(analyzed, {
      name: options.name ?? analyzed.name,
      metadata,
    }),
    kind: "source",
    encoding: "utf-8",
  }];
  const queries = generateAnalyzedTreeSitterQueries(analyzed, {
    metadata,
  });
  for (const [path, name] of treeSitterQueryOutputs) {
    const content = queries[name];
    if (content.length > 0) {
      files.push({ path, content, kind: "query", encoding: "utf-8" });
    }
  }
  return files;
}
