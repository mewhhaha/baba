import type {
  GeneratedBundle,
  GeneratedFile,
  TextGeneratedFileKind,
} from "./ast.ts";

type BundleInput = GeneratedFile | readonly [path: string, content: string];

/** Creates one generated file with centralized kind classification. */
export function generatedFile(path: string, content: string): GeneratedFile {
  return {
    path,
    content,
    kind: classifyGeneratedTextFile(path),
    encoding: "utf-8",
  };
}

/** Creates one generated binary file. */
export function generatedBinaryFile(
  path: string,
  content: Uint8Array,
): GeneratedFile {
  return { path, content, kind: "binary", encoding: "binary" };
}

/** Creates a deterministic generated bundle. */
export function generatedBundle(
  files: Iterable<BundleInput>,
  cleanupPaths: string[] = [],
): GeneratedBundle {
  const normalized: GeneratedFile[] = [...files].map((file) =>
    isPathContentPair(file) ? generatedFile(file[0], file[1]) : file
  );
  normalized.sort((left, right) => left.path.localeCompare(right.path));
  const sortedCleanupPaths = [...new Set(cleanupPaths)].sort();
  return sortedCleanupPaths.length === 0
    ? { files: normalized }
    : { files: normalized, cleanupPaths: sortedCleanupPaths };
}

function isPathContentPair(
  file: BundleInput,
): file is readonly [path: string, content: string] {
  return Array.isArray(file);
}

/** Classifies a generated output path. */
export function classifyGeneratedFile(path: string): GeneratedFile["kind"] {
  if (path.endsWith(".wasm")) return "binary";
  return classifyGeneratedTextFile(path);
}

/** Classifies a generated text output path. */
export function classifyGeneratedTextFile(path: string): TextGeneratedFileKind {
  if (path.endsWith(".scm") || path.startsWith("queries/")) return "query";
  if (
    path.endsWith(".json") ||
    path.endsWith(".toml") ||
    path.includes("/vscode/")
  ) return "config";
  if (path.startsWith("tests/")) return "test";
  if (path.endsWith(".md")) return "docs";
  return "source";
}

/** Converts a bundle to a path/content map for tests or renderers. */
export function generatedFileMap(
  bundle: GeneratedBundle,
): Record<string, string | Uint8Array> {
  return Object.fromEntries(
    bundle.files.map((file) => [file.path, file.content]),
  );
}

/** Returns the generated tree-sitter grammar file, if present. */
export function treeSitterGrammarFile(
  bundle: GeneratedBundle,
): GeneratedFile | undefined {
  return bundle.files.find((file) => file.path === "grammar.js");
}

/** Returns generated tree-sitter query files in bundle order. */
export function treeSitterQueryFiles(bundle: GeneratedBundle): GeneratedFile[] {
  return bundle.files.filter((file) =>
    file.kind === "query" &&
    (file.path.endsWith(".scm") || file.path.startsWith("queries/"))
  );
}

/** Maps a bundle query path to a tree-sitter grammar `queries/` filename. */
export function treeSitterQueryOutputName(file: GeneratedFile): string {
  return file.path.startsWith("queries/")
    ? file.path.slice("queries/".length)
    : file.path;
}
