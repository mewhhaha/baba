/**
 * Advanced baba APIs for callers that need individual generation phases.
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
  GeneratePreset,
  LexicalSpec,
  LexicalTokenSpec,
  SourceSpan,
  TreeSitterCaptureMetadata,
  TreeSitterExtra,
  TreeSitterInjectionMetadata,
  /** @deprecated Use `BabaMetadata`. */
  TreeSitterMetadata,
  TreeSitterPathMetadata,
  TreeSitterQueriesMetadata,
  TreeSitterRainbowsMetadata,
  TreeSitterRuleMetadata,
  TreeSitterRuleToken,
  TreeSitterRuleWrap,
  WorkbenchAstMetadata,
  WorkbenchAstNodeMetadata,
  WorkbenchFormatterMetadata,
  WorkbenchLanguageMetadata,
  WorkbenchLspMetadata,
} from "./ast.ts";
export {
  collectTerminals,
  createLexicalSpec,
  generateAstTypesSource,
  generateAstVisitorSource,
  generateFormatterScaffoldSource,
  generateLexicalManifest,
  generateLspScaffoldSource,
  generateTokenizerSource,
  generateTreeSitterFoldsQuery,
  generateTreeSitterGrammar,
  generateTreeSitterHighlightsQuery,
  generateTreeSitterIndentsQuery,
  generateTreeSitterInjectionsQuery,
  generateTreeSitterLocalsQuery,
  generateTreeSitterRainbowsQuery,
  generateTreeSitterTagsQuery,
  generateWorkbenchBundle,
  generateWorkbenchQueries,
  validateEbnfGrammar,
  validateGenerationMetadataSemantics,
} from "./generate.ts";
export { parseTreeSitterMetadata } from "./metadata.ts";
export { EbnfError, formatEbnfError, parseEbnf } from "./parser.ts";
