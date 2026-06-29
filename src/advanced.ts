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
  GrammarV2Declaration,
  GrammarV2Document,
  GrammarV2Expression,
  GrammarV2ExpressionOperator,
  GrammarV2ExtensionDeclaration,
  GrammarV2LayoutDeclaration,
  GrammarV2ModeDeclaration,
  GrammarV2ModeTransition,
  GrammarV2ParseResult,
  GrammarV2Rule,
  GrammarV2RuleAnnotation,
  GrammarV2TerminalPattern,
  GrammarV2TokenDeclaration,
  PortabilityMode,
  PortableRuntimePlanningOptions,
  SourceSpan,
  TreeSitterCaptureMetadata,
  TreeSitterExtra,
  TreeSitterInjectionMetadata,
  TreeSitterInjectionQueryEntry,
  TreeSitterPathMetadata,
  TreeSitterQueriesMetadata,
  TreeSitterRainbowsMetadata,
  TreeSitterRuleMetadata,
  TreeSitterRuleToken,
  TreeSitterRuleWrap,
  ValidateOptions,
  WasmTargetOptions,
} from "./ast.ts";
export { analyzeGrammar } from "./compiler/analyze.ts";
export { analyzeGrammarV2 } from "./compiler/grammar_v2_analysis.ts";
export {
  buildGrammarV2LexerPlan,
  lexGrammarV2,
} from "./compiler/grammar_v2_lexer.ts";
export {
  buildGrammarV2ParserCorePlan,
  lowerGrammarV2ToBnf,
  recoverGrammarV2Parse,
  validateGrammarV2Parse,
} from "./compiler/grammar_v2_parser_core.ts";
export type {
  AnalyzedGrammarV2,
  AnalyzedGrammarV2Constructor,
  AnalyzedGrammarV2Expression,
  AnalyzedGrammarV2ExpressionIsland,
  AnalyzedGrammarV2Field,
  AnalyzedGrammarV2Literal,
  AnalyzedGrammarV2Mode,
  AnalyzedGrammarV2Rule,
  AnalyzedGrammarV2Token,
  GrammarV2ResolvedReference,
} from "./compiler/grammar_v2_ir.ts";
export type {
  GrammarV2AstConstructorSchema,
  GrammarV2AstFieldCardinality,
  GrammarV2AstFieldSchema,
  GrammarV2AstMaterializeResult,
  GrammarV2AstNode,
  GrammarV2AstSchema,
  GrammarV2AstToken,
  GrammarV2AstValue,
  GrammarV2InvalidAstNode,
} from "./compiler/grammar_v2_ast.ts";
export type {
  GrammarV2ByteSpan,
  GrammarV2CstBuildResult,
  GrammarV2CstKind,
  GrammarV2CstSchema,
  GrammarV2CstStats,
  GrammarV2GreenElement,
  GrammarV2GreenNode,
  GrammarV2GreenToken,
} from "./compiler/grammar_v2_cst.ts";
export type {
  GrammarV2LayoutOptions,
  GrammarV2LexCandidate,
  GrammarV2LexCandidateSite,
  GrammarV2LexerCheckpoint,
  GrammarV2LexerModePlan,
  GrammarV2LexerPlan,
  GrammarV2LexerSpec,
  GrammarV2LexerTransition,
  GrammarV2LexOptions,
  GrammarV2LexResult,
  GrammarV2LexToken,
  GrammarV2TokenStreamValidationOptions,
} from "./compiler/grammar_v2_lexer.ts";
export type {
  GrammarV2ChangedRange,
  GrammarV2IncrementalParseOptions,
  GrammarV2IncrementalParser,
  GrammarV2IncrementalResult,
  GrammarV2IncrementalState,
  GrammarV2TextEdit,
} from "./compiler/grammar_v2_incremental.ts";
export type {
  GrammarV2ModuleCompositionResult,
  GrammarV2ModuleDiagnostic,
} from "./compiler/grammar_v2_modules.ts";
export type {
  GrammarV2ParserCoreOptions,
  GrammarV2ParserCorePlan,
  GrammarV2ParseRecoveryDiagnostic,
  GrammarV2ParseRecoveryResult,
  GrammarV2ParseValidationResult,
} from "./compiler/grammar_v2_parser_core.ts";
export type {
  GrammarV2PrattIslandPlan,
  GrammarV2PrattNode,
  GrammarV2PrattOperatorPlan,
  GrammarV2PrattParseOptions,
  GrammarV2PrattParseResult,
  GrammarV2PrattPlan,
} from "./compiler/grammar_v2_pratt.ts";
export type {
  GrammarV2PortablePlan,
  GrammarV2PortablePlanBuildOptions,
  GrammarV2PortablePlanBuildResult,
  GrammarV2PortablePlanMetadata,
  GrammarV2PortablePlanStatistics,
} from "./compiler/grammar_v2_portable_plan.ts";
export type {
  GrammarV2Runtime,
  GrammarV2RuntimeOptions,
  GrammarV2RuntimeParseOptions,
  GrammarV2RuntimeParseResult,
  GrammarV2RuntimeParseTokensResult,
  GrammarV2SourceMapping,
} from "./runtime/grammar_v2.ts";
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
export {
  buildGrammarV2AstSchema,
  emitGrammarV2AstTypes,
  materializeGrammarV2Ast,
} from "./compiler/grammar_v2_ast.ts";
export {
  buildGrammarV2CstSchema,
  buildGrammarV2TokenCst,
  collectGrammarV2CstStats,
  debugGrammarV2Cst,
  grammarV2CstText,
  missingGrammarV2CstNode,
} from "./compiler/grammar_v2_cst.ts";
export { planPortableRuntime } from "./targets/runtime/plan.ts";
export type {
  RuntimeParserPlan,
  RuntimeParserPlanningOptions,
} from "./targets/runtime/plan.ts";
export { buildPortableParserPlan } from "./compiler/portable_plan/build.ts";
export {
  parsePortableParserPlanJson,
  serializePortableParserPlanJson,
} from "./compiler/portable_plan/serialize_json.ts";
export { validateGrammarV2TokenStream } from "./compiler/grammar_v2_lexer.ts";
export {
  applyGrammarV2TextEdits,
  createGrammarV2IncrementalParser,
} from "./compiler/grammar_v2_incremental.ts";
export { composeGrammarV2Modules } from "./compiler/grammar_v2_modules.ts";
export {
  buildGrammarV2PrattPlan,
  parseGrammarV2PrattExpression,
} from "./compiler/grammar_v2_pratt.ts";
export {
  buildGrammarV2PortablePlan,
  grammarV2PortablePlanMetadata,
  grammarV2PortablePlanToAnalyzed,
  parseGrammarV2PortablePlanJson,
  portablePlanV2Statistics,
  serializeGrammarV2PortablePlanJson,
  validateGrammarV2PortablePlan,
} from "./compiler/grammar_v2_portable_plan.ts";
export { createGrammarV2Runtime } from "./runtime/grammar_v2.ts";
export { portablePlanStatistics } from "./compiler/portable_plan/statistics.ts";
export { validatePortableParserPlan } from "./compiler/portable_plan/validate.ts";
export type {
  PortableDiagnosticPlan,
  PortableParserPlan,
  PortablePlanStatistics,
  PortableReducerPlan,
} from "./compiler/portable_plan/plan.ts";
export { EbnfError, formatEbnfError, parseEbnf } from "./parser.ts";
export { parseGrammarV2 } from "./grammar_v2.ts";
