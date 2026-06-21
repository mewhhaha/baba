import {
  compileParserKit,
  formatDiagnostic,
  parseWithKit,
  validateParserKit,
} from "../../src/kit.ts";

const grammar = await Deno.readTextFile(
  new URL("./grammar.ebnf", import.meta.url),
);
const result = compileParserKit(grammar, {
  name: "brainfuck",
  rootRule: "module",
});

for (const diagnostic of result.diagnostics) {
  console.error(formatDiagnostic(diagnostic));
}
if (
  !result.kit ||
  result.diagnostics.some((diagnostic) =>
    (diagnostic.severity ?? "error") === "error"
  )
) {
  Deno.exit(1);
}

const schemaIssues = validateParserKit(result.kit);
if (schemaIssues.length > 0) {
  for (const issue of schemaIssues) {
    console.error(`${issue.path}: ${issue.message}`);
  }
  Deno.exit(1);
}

const source = await Deno.readTextFile(
  new URL("./programs/hello.bf", import.meta.url),
);
const parsed = parseWithKit(result.kit, source, { preserveTrivia: false });
if (!parsed.ok || !parsed.root) {
  for (const diagnostic of parsed.diagnostics) {
    console.error(`${diagnostic.code}: ${diagnostic.message}`);
  }
  Deno.exit(1);
}

console.log(`Parsed ${parsed.root.name} with ${parsed.tokens.length} tokens`);
