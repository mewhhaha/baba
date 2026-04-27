/**
 * baba turns a compact EBNF grammar into language tooling.
 *
 * The stable API is intentionally small:
 *
 * ```ts
 * import { generate, parseGrammar, parseMetadata } from "jsr:@mewhhaha/baba";
 *
 * const grammar = parseGrammar(await Deno.readTextFile("grammar.ebnf"));
 * const metadata = parseMetadata(await Deno.readTextFile("baba.json"));
 * const bundle = generate(grammar, {
 *   name: "tiny",
 *   metadata,
 *   preset: "workbench",
 * });
 * ```
 *
 * Use `jsr:@mewhhaha/baba/advanced` for lower-level generator entrypoints.
 *
 * @module
 */

export type {
  BabaMetadata,
  Diagnostic,
  EbnfExpression,
  EbnfGrammar,
  EbnfRule,
  EbnfTokenDeclaration,
  GeneratedBundle,
  GeneratedFile,
  GenerateInitOptions,
  GenerateOptions,
  GeneratePreset,
  SourceSpan,
} from "./ast.ts";
export {
  BabaError,
  formatDiagnostic,
  generate,
  generateInitBundle,
  parseGrammar,
  parseMetadata,
  validateGrammar,
} from "./api.ts";
