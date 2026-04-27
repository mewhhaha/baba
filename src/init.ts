import type { GeneratedBundle, GenerateInitOptions } from "./ast.ts";
import { generatedBundle } from "./bundle.ts";
import { parseTreeSitterMetadata } from "./metadata.ts";
import { parseEbnf } from "./parser.ts";

/** Generates a small starter baba language project without touching disk. */
export function generateInitBundle(
  options: GenerateInitOptions = {},
): GeneratedBundle {
  const name = sanitizePackageName(
    options.name ?? options.dirName ?? "language",
  );
  const grammar = `token ident = /[A-Za-z_][A-Za-z0-9_]*/ ;
token int = /[0-9]+/ ;
skip whitespace = /[ \\t\\r\\n]+/ ;

module = function+ ;
function = "fn" ident "(" ")" block ;
block = "{" statement* "}" ;
statement = "let" ident "=" int ";" ;
`;
  const metadata = `${
    JSON.stringify(
      {
        language: {
          scope: `source.${name}`,
          fileTypes: [name],
          comment: "//",
        },
        queries: {
          highlights: [
            { literal: "fn", capture: "keyword.function" },
            { literal: "let", capture: "keyword" },
            { node: "function", capture: "function" },
          ],
          folds: [{ node: "block", capture: "fold" }],
          tags: [{ node: "function", capture: "tag.definition" }],
        },
        formatter: {
          blocks: ["block"],
          spacing: { "(": "tight" },
        },
        lsp: {
          documentSymbols: ["function"],
          diagnostics: ["module"],
        },
      },
      null,
      2,
    )
  }\n`;
  const readme = `# ${name}

Generated with baba.

\`\`\`sh
deno run --allow-read --allow-write jsr:@mewhhaha/baba/cli grammar.ebnf \\
  --out generated \\
  --name ${name} \\
  --ts-meta baba.json \\
  --preset workbench
\`\`\`
`;

  parseEbnf(grammar);
  parseTreeSitterMetadata(metadata);

  return generatedBundle("workbench", [
    ["README.md", readme],
    ["baba.json", metadata],
    ["grammar.ebnf", grammar],
    [`samples/main.${name}`, `fn main() { let answer = 42; }\n`],
  ]);
}

function sanitizePackageName(name: string): string {
  const normalized = name.replaceAll("\\", "/").replace(/\/+$/, "");
  const leaf = normalized.slice(normalized.lastIndexOf("/") + 1) ||
    "language";
  return leaf.replaceAll(/[^A-Za-z0-9_+-]/g, "_");
}
