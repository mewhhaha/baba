/**
 * baba compiles explicit EBNF grammars into Tree-sitter artifacts.
 *
 * ```ts
 * import { applyBundle, generate, parseGrammar, parseMetadata } from "jsr:@mewhhaha/baba";
 *
 * const grammar = parseGrammar(await Deno.readTextFile("grammar.ebnf"));
 * const metadata = parseMetadata(await Deno.readTextFile("baba.json"));
 * const bundle = generate(grammar, { name: "tiny", metadata });
 * await applyBundle(bundle, { root: "generated" });
 * ```
 *
 * @module
 */

export type {
  BabaMetadata,
  CompileOptions,
  CompileResult,
  Diagnostic,
  EbnfExpression,
  EbnfGrammar,
  EbnfRule,
  EbnfTokenDeclaration,
  GeneratedBundle,
  GeneratedFile,
  GenerateOptions,
  GenerateTarget,
  SourceSpan,
  TypeScriptTargetOptions,
  ValidateOptions,
} from "./ast.ts";
export {
  applyBundle,
  BabaError,
  compile,
  formatDiagnostic,
  generate,
  parseGrammar,
  parseMetadata,
  validateGrammar,
} from "./api.ts";
