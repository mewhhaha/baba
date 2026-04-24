/**
 * EBNF parser and generator tools for building language scaffolding.
 *
 * @module
 */

export type {
  EbnfExpression,
  EbnfGrammar,
  EbnfRule,
  EbnfTokenDeclaration,
  LexicalSpec,
  LexicalTokenSpec,
  SourceSpan,
  TreeSitterCaptureMetadata,
  TreeSitterExtra,
  TreeSitterInjectionMetadata,
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
  parseTreeSitterMetadata,
  validateEbnfGrammar,
} from "./generate.ts";
export { EbnfError, formatEbnfError, parseEbnf } from "./parser.ts";
