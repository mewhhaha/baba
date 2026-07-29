export {
  applyBundle,
  BabaError,
  compile,
  formatDiagnostic,
  generate,
  parseGrammar as parsePublicGrammar,
  parseMetadata,
  validateGrammar,
} from "../src/mod.ts";
export type { Diagnostic, GrammarDocument } from "../src/ast.ts";
export { analyzeGrammar } from "../src/compiler/grammar_analysis.ts";
export {
  buildGrammarAstSchema,
  emitGrammarAstTypes,
  materializeGrammarAst,
} from "../src/compiler/grammar_ast.ts";
export type {
  GrammarAstConstructorSchema,
  GrammarAstFieldCardinality,
  GrammarAstFieldSchema,
  GrammarAstMaterializeResult,
  GrammarAstNode,
  GrammarAstSchema,
  GrammarAstToken,
  GrammarAstValue,
  GrammarInvalidAstNode,
} from "../src/compiler/grammar_ast.ts";
export {
  buildGrammarCstSchema,
  buildGrammarTokenCst,
  collectGrammarCstStats,
  debugGrammarCst,
  grammarCstText,
  missingGrammarCstNode,
} from "../src/compiler/grammar_cst.ts";
export type {
  GrammarByteSpan,
  GrammarCstBuildResult,
  GrammarCstKind,
  GrammarCstSchema,
  GrammarCstStats,
  GrammarGreenElement,
  GrammarGreenNode,
  GrammarGreenToken,
} from "../src/compiler/grammar_cst.ts";
export {
  buildGrammarLexerPlan,
  lexGrammar,
  validateGrammarTokenStream,
} from "../src/compiler/grammar_lexer.ts";
export type {
  GrammarLayoutOptions,
  GrammarLexCandidate,
  GrammarLexCandidateSite,
  GrammarLexerCheckpoint,
  GrammarLexerModePlan,
  GrammarLexerPlan,
  GrammarLexerSpec,
  GrammarLexerTransition,
  GrammarLexOptions,
  GrammarLexResult,
  GrammarLexToken,
  GrammarTokenStreamValidationOptions,
} from "../src/compiler/grammar_lexer.ts";
export { composeGrammarModules } from "../src/compiler/grammar_modules.ts";
export type {
  GrammarModuleCompositionResult,
  GrammarModuleDiagnostic,
} from "../src/compiler/grammar_modules.ts";
export {
  buildGrammarParserCorePlan,
  lowerGrammarToBnf,
  recoverGrammarParse,
  validateGrammarParse,
} from "../src/compiler/grammar_parser_core.ts";
export type {
  GrammarParserCoreOptions,
  GrammarParserCorePlan,
  GrammarParseRecoveryDiagnostic,
  GrammarParseRecoveryResult,
  GrammarParseValidationResult,
} from "../src/compiler/grammar_parser_core.ts";
export {
  buildGrammarPortablePlan,
  parseGrammarPortablePlanJson,
  serializeGrammarPortablePlanJson,
  validateGrammarPortablePlan,
} from "../src/compiler/grammar_portable_plan.ts";
export type {
  GrammarPortablePlan,
  GrammarPortablePlanBuildOptions,
  GrammarPortablePlanBuildResult,
} from "../src/compiler/grammar_portable_plan.ts";
export {
  buildGrammarPrattPlan,
  parseGrammarPrattExpression,
} from "../src/compiler/grammar_pratt.ts";
export type {
  GrammarPrattIslandPlan,
  GrammarPrattNode,
  GrammarPrattOperatorPlan,
  GrammarPrattParseOptions,
  GrammarPrattParseResult,
  GrammarPrattPlan,
} from "../src/compiler/grammar_pratt.ts";
export type {
  AnalyzedGrammar,
  AnalyzedGrammarConstructor,
  AnalyzedGrammarExpression,
  AnalyzedGrammarExpressionIsland,
  AnalyzedGrammarField,
  AnalyzedGrammarLiteral,
  AnalyzedGrammarMode,
  AnalyzedGrammarRule,
  AnalyzedGrammarToken,
  GrammarResolvedReference,
} from "../src/compiler/grammar_ir.ts";
export { parseGrammarSource as parseGrammar } from "../src/grammar.ts";
export { createGrammarRuntime } from "../src/runtime/grammar.ts";

export function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

export function assertEquals<T>(
  actual: T,
  expected: T,
  message?: string,
): void {
  if (actual !== expected) {
    throw new Error(
      message ??
        `Expected ${JSON.stringify(actual)} to equal ${
          JSON.stringify(expected)
        }`,
    );
  }
}

export function assertIncludes(actual: string, expected: string): void {
  assert(
    actual.includes(expected),
    `Expected ${JSON.stringify(actual)} to include ${expected}`,
  );
}

export function assertNotIncludes(actual: string, expected: string): void {
  assert(
    !actual.includes(expected),
    `Expected ${JSON.stringify(actual)} not to include ${expected}`,
  );
}

export function assertThrowsIncludes(
  action: () => unknown,
  expected: string,
): void {
  let message = "";
  try {
    action();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertIncludes(message, expected);
}

export async function denoCheck(path: string): Promise<void> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["check", path],
  });
  const output = await command.output();
  if (!output.success) {
    const decoder = new TextDecoder();
    throw new Error(
      `${decoder.decode(output.stdout)}${decoder.decode(output.stderr)}`,
    );
  }
}
