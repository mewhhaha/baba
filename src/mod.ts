/**
 * Baba compiles explicit grammar sources plus metadata into usable Wasm
 * lexer/parser bundles.
 *
 * ```ts
 * import { applyBundle, generate, parseGrammar, parseMetadata } from "jsr:@mewhhaha/baba";
 *
 * const grammar = parseGrammar(await Deno.readTextFile("grammar.baba"));
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
  GeneratedBundle,
  GeneratedFile,
  GenerateOptions,
  GenerateTarget,
  GrammarDeclaration,
  GrammarDocument,
  GrammarExportDeclaration,
  GrammarExpression,
  GrammarExpressionOperator,
  GrammarExtensionDeclaration,
  GrammarImportDeclaration,
  GrammarLayoutDeclaration,
  GrammarModeDeclaration,
  GrammarModeTransition,
  GrammarModuleDeclaration,
  GrammarParseResult,
  GrammarRule,
  GrammarRuleAnnotation,
  GrammarTerminalPattern,
  GrammarTokenDeclaration,
  ParserConflictDeclarationMetadata,
  ParserConflictResolutionMetadata,
  ParserRuntimeMetadata,
  PortableRuntimePlanningOptions,
  SourceSpan,
  TreeSitterExtra,
  TreeSitterPathMetadata,
  TreeSitterRuleMetadata,
  TreeSitterRuleToken,
  TreeSitterRuleWrap,
  ValidateOptions,
  WasmTargetOptions,
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
