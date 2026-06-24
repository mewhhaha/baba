/**
 * baba compiles explicit EBNF grammars into syntax artifacts for Tree-sitter,
 * TypeScript, Wasm, and parser-kit consumers.
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
  CompileParserKitOptions,
  CompileParserKitResult,
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
  KitTargetOptions,
  PortabilityMode,
  PortableRuntimePlanningOptions,
  SourceSpan,
  TypeScriptTargetOptions,
  ValidateOptions,
  WasmTargetOptions,
} from "./ast.ts";
export {
  applyBundle,
  BabaError,
  compile,
  compileParserKit,
  formatDiagnostic,
  generate,
  parseGrammar,
  parseMetadata,
  validateGrammar,
} from "./api.ts";
