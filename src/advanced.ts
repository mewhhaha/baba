/**
 * Advanced baba APIs for callers that need individual Tree-sitter compiler
 * phases.
 *
 * Most users should import from `@mewhhaha/baba` and call `generate()`.
 *
 * @module
 */

export type {
  BabaMetadata,
  CompileOptions,
  CompileResult,
  EbnfExpression,
  EbnfGrammar,
  EbnfRule,
  EbnfTokenDeclaration,
  GeneratedBundle,
  GeneratedFile,
  GenerateOptions,
  GenerateTarget,
  PortabilityMode,
  SourceSpan,
  TreeSitterCaptureMetadata,
  TreeSitterExtra,
  TreeSitterInjectionMetadata,
  TreeSitterInjectionQueryEntry,
  /** @deprecated Use `BabaMetadata`. */
  TreeSitterMetadata,
  TreeSitterPathMetadata,
  TreeSitterQueriesMetadata,
  TreeSitterRainbowsMetadata,
  TreeSitterRuleMetadata,
  TreeSitterRuleToken,
  TreeSitterRuleWrap,
  TypeScriptTargetOptions,
  ValidateOptions,
} from "./ast.ts";
export { analyzeGrammar } from "./compiler/analyze.ts";
export type {
  AnalyzedExpression,
  AnalyzedGrammar,
  AnalyzedLiteral,
  AnalyzedRule,
  AnalyzedToken,
  LiteralId,
  ResolvedReference,
  RuleId,
  TokenId,
} from "./compiler/ir.ts";
export {
  collectAnalyzedTreeSitterHighlightDiagnostics,
  collectGrammarDiagnostics,
  collectReachabilityDiagnostics,
  collectTerminals,
  collectTreeSitterHighlightDiagnostics,
  generateAnalyzedTreeSitterGrammar,
  generateAnalyzedTreeSitterQueries,
  generateTreeSitterFoldsQuery,
  generateTreeSitterGrammar,
  generateTreeSitterHighlightsQuery,
  generateTreeSitterIndentsQuery,
  generateTreeSitterInjectionsQuery,
  generateTreeSitterLocalsQuery,
  generateTreeSitterQueries,
  generateTreeSitterRainbowsQuery,
  generateTreeSitterTagsQuery,
  generateTreeSitterTextobjectsQuery,
  validateEbnfGrammar,
  validateGenerationMetadataSemantics,
  validateTreeSitterBackendCapabilities,
  validateTreeSitterGenerationMetadataSemantics,
} from "./generate.ts";
export { parseTreeSitterMetadata } from "./metadata.ts";
export { EbnfError, formatEbnfError, parseEbnf } from "./parser.ts";
