/**
 * Generic parser-kit APIs for compiler and tooling consumers.
 *
 * The kit target exposes Baba's analyzed syntax data without generating a
 * language-specific compiler ABI.
 *
 * @module
 */

export type {
  CompileParserKitOptions,
  CompileParserKitResult,
  Diagnostic,
  KitTargetOptions,
} from "./ast.ts";
export { BabaError, compileParserKit, formatDiagnostic } from "./api.ts";
export {
  assertParserKit,
  lexWithKit,
  literalKinds,
  mainTokenKinds,
  PARSER_KIT_SCHEMA_VERSION,
  parseTokensUncheckedWithKit,
  parseTokensWithKit,
  parseWithKit,
  terminalMappings,
  tokenToTerminal,
  triviaTokenKinds,
  validateParserKit,
} from "./targets/kit/schema.ts";
export type {
  KitEofToken,
  KitErrorToken,
  KitLexDiagnostic,
  KitLexOptions,
  KitLexResult,
  KitLiteralToken,
  KitMainNamedToken,
  KitParseDiagnostic,
  KitParseOptions,
  KitParseResult,
  KitRuleNode,
  KitSpan,
  KitSyntaxElement,
  KitToken,
  KitTriviaToken,
  ParserKit,
  ParserKitActionEntry,
  ParserKitBnf,
  ParserKitDisplayNames,
  ParserKitFieldInfo,
  ParserKitFieldMetadata,
  ParserKitGrammarInfo,
  ParserKitLexer,
  ParserKitLexerDfa,
  ParserKitLexerSpec,
  ParserKitLexerTransition,
  ParserKitLiteralSpec,
  ParserKitLr,
  ParserKitLrAction,
  ParserKitLrItem,
  ParserKitLrState,
  ParserKitLrStats,
  ParserKitNamedTokenSpec,
  ParserKitNonterminal,
  ParserKitProduction,
  ParserKitProductionOrigin,
  ParserKitReducerSpec,
  ParserKitRuleFieldSchema,
  ParserKitRuleInfo,
  ParserKitSourceSpan,
  ParserKitSymbol,
  ParserKitTerminal,
  ParserKitTokenMetadata,
  ParserKitValidationIssue,
} from "./targets/kit/schema.ts";
