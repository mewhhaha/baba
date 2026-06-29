export {
  applyBundle,
  BabaError,
  compile,
  formatDiagnostic,
  generate,
  parseGrammar,
  parseMetadata,
  validateGrammar,
} from "../src/mod.ts";
export type { Diagnostic, GrammarV2Document } from "../src/ast.ts";
export { analyzeGrammarV2 } from "../src/compiler/grammar_v2_analysis.ts";
export {
  buildGrammarV2AstSchema,
  emitGrammarV2AstTypes,
  materializeGrammarV2Ast,
} from "../src/compiler/grammar_v2_ast.ts";
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
} from "../src/compiler/grammar_v2_ast.ts";
export {
  buildGrammarV2CstSchema,
  buildGrammarV2TokenCst,
  collectGrammarV2CstStats,
  debugGrammarV2Cst,
  grammarV2CstText,
  missingGrammarV2CstNode,
} from "../src/compiler/grammar_v2_cst.ts";
export type {
  GrammarV2ByteSpan,
  GrammarV2CstBuildResult,
  GrammarV2CstKind,
  GrammarV2CstSchema,
  GrammarV2CstStats,
  GrammarV2GreenElement,
  GrammarV2GreenNode,
  GrammarV2GreenToken,
} from "../src/compiler/grammar_v2_cst.ts";
export {
  applyGrammarV2TextEdits,
  createGrammarV2IncrementalParser,
} from "../src/compiler/grammar_v2_incremental.ts";
export type {
  GrammarV2ChangedRange,
  GrammarV2IncrementalParseOptions,
  GrammarV2IncrementalParser,
  GrammarV2IncrementalResult,
  GrammarV2IncrementalState,
  GrammarV2TextEdit,
} from "../src/compiler/grammar_v2_incremental.ts";
export {
  buildGrammarV2LexerPlan,
  lexGrammarV2,
  validateGrammarV2TokenStream,
} from "../src/compiler/grammar_v2_lexer.ts";
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
} from "../src/compiler/grammar_v2_lexer.ts";
export { composeGrammarV2Modules } from "../src/compiler/grammar_v2_modules.ts";
export type {
  GrammarV2ModuleCompositionResult,
  GrammarV2ModuleDiagnostic,
} from "../src/compiler/grammar_v2_modules.ts";
export {
  buildGrammarV2ParserCorePlan,
  lowerGrammarV2ToBnf,
  recoverGrammarV2Parse,
  validateGrammarV2Parse,
} from "../src/compiler/grammar_v2_parser_core.ts";
export type {
  GrammarV2ParserCoreOptions,
  GrammarV2ParserCorePlan,
  GrammarV2ParseRecoveryDiagnostic,
  GrammarV2ParseRecoveryResult,
  GrammarV2ParseValidationResult,
} from "../src/compiler/grammar_v2_parser_core.ts";
export {
  buildGrammarV2PortablePlan,
  parseGrammarV2PortablePlanJson,
  serializeGrammarV2PortablePlanJson,
  validateGrammarV2PortablePlan,
} from "../src/compiler/grammar_v2_portable_plan.ts";
export type {
  GrammarV2PortablePlan,
  GrammarV2PortablePlanBuildOptions,
  GrammarV2PortablePlanBuildResult,
} from "../src/compiler/grammar_v2_portable_plan.ts";
export {
  buildGrammarV2PrattPlan,
  parseGrammarV2PrattExpression,
} from "../src/compiler/grammar_v2_pratt.ts";
export type {
  GrammarV2PrattIslandPlan,
  GrammarV2PrattNode,
  GrammarV2PrattOperatorPlan,
  GrammarV2PrattParseOptions,
  GrammarV2PrattParseResult,
  GrammarV2PrattPlan,
} from "../src/compiler/grammar_v2_pratt.ts";
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
} from "../src/compiler/grammar_v2_ir.ts";
export { parseGrammarV2 } from "../src/grammar_v2.ts";
export { createGrammarV2Runtime } from "../src/runtime/grammar_v2.ts";

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
