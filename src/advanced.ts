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
  EbnfExpression,
  EbnfGrammar,
  EbnfRule,
  EbnfTokenDeclaration,
  GeneratedBundle,
  GeneratedFile,
  GenerateOptions,
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
} from "./ast.ts";
export {
  collectGrammarDiagnostics,
  collectReachabilityDiagnostics,
  collectTerminals,
  collectTreeSitterHighlightDiagnostics,
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
