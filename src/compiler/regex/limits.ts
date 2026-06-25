import { countRegexAstNodes, type RegexAst } from "./ast.ts";

export const DEFAULT_REGEX_NESTING_LIMIT = 256;

export type RegexResourceLimitCode =
  | "REGEX_SOURCE_LIMIT"
  | "REGEX_NESTING_LIMIT"
  | "REGEX_AST_NODE_LIMIT"
  | "REGEX_NFA_STATE_LIMIT"
  | "REGEX_DFA_STATE_LIMIT"
  | "REGEX_OVERLAP_WORK_LIMIT"
  | "REGEX_REPEAT_EXPANSION_LIMIT";

export interface RegexCompilerLimits {
  readonly sourceLengthLimit?: number;
  readonly nestingLimit?: number;
  readonly astNodeLimit?: number;
  readonly boundedRepeatLimit?: number;
  readonly nfaStateLimit?: number;
  readonly dfaStateLimit?: number;
  readonly overlapProductStateLimit?: number;
}

export class RegexResourceLimitError extends Error {
  constructor(
    readonly code: RegexResourceLimitCode,
    message: string,
    readonly limit: number,
  ) {
    super(message);
    this.name = "RegexResourceLimitError";
  }
}

export function enforceRegexAstNodeLimit(
  ast: RegexAst,
  limits: RegexCompilerLimits,
): void {
  const limit = limits.astNodeLimit;
  if (limit === undefined) return;
  const count = countRegexAstNodes(ast);
  if (count > limit) {
    throw new RegexResourceLimitError(
      "REGEX_AST_NODE_LIMIT",
      `regex AST has ${count} nodes, exceeding the configured limit (${limit}).`,
      limit,
    );
  }
}
