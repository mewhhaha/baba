import type { Diagnostic, SourceSpan } from "../ast.ts";

export type RuleId = number;
export type TokenId = number;
export type LiteralId = number;
export type ExpressionId = number;

export interface AnalyzedGrammar {
  name: string;
  rootRule: RuleId;
  rules: readonly AnalyzedRule[];
  tokens: readonly AnalyzedToken[];
  literals: readonly AnalyzedLiteral[];
  externals: readonly AnalyzedExternalToken[];
  reachableRules: ReadonlySet<RuleId>;
  reachableTokens: ReadonlySet<TokenId>;
  reachableLiterals: ReadonlySet<LiteralId>;
  reachableExternals: ReadonlySet<string>;
  diagnostics: readonly Diagnostic[];
}

export interface AnalyzedRule {
  id: RuleId;
  name: string;
  expression: AnalyzedExpression;
  span: SourceSpan;
}

export interface AnalyzedToken {
  id: TokenId;
  name: string;
  kind: "token" | "skip";
  pattern: string;
  declarationOrder: number;
  span: SourceSpan;
}

export interface AnalyzedLiteral {
  id: LiteralId;
  value: string;
  sourceOrder: number;
  span: SourceSpan;
}

export interface AnalyzedExternalToken {
  name: string;
}

export type ResolvedReference =
  | { kind: "rule"; ruleId: RuleId }
  | { kind: "token"; tokenId: TokenId }
  | { kind: "skip"; tokenId: TokenId }
  | { kind: "external"; name: string }
  | { kind: "unknown"; name: string };

export type AnalyzedExpression =
  | FieldExpression
  | RefExpression
  | LiteralExpression
  | SequenceExpression
  | ChoiceExpression
  | OptionalExpression
  | RepeatExpression
  | Repeat1Expression
  | SeparatedExpression;

export interface ExpressionBase {
  id: ExpressionId;
  span: SourceSpan;
}

export interface FieldExpression extends ExpressionBase {
  kind: "field";
  name: string;
  expression: AnalyzedExpression;
}

export interface RefExpression extends ExpressionBase {
  kind: "ref";
  name: string;
  reference: ResolvedReference;
}

export interface LiteralExpression extends ExpressionBase {
  kind: "literal";
  value: string;
  literalId: LiteralId;
}

export interface SequenceExpression extends ExpressionBase {
  kind: "sequence";
  items: readonly AnalyzedExpression[];
}

export interface ChoiceExpression extends ExpressionBase {
  kind: "choice";
  options: readonly AnalyzedExpression[];
}

export interface OptionalExpression extends ExpressionBase {
  kind: "optional";
  expression: AnalyzedExpression;
}

export interface RepeatExpression extends ExpressionBase {
  kind: "repeat";
  expression: AnalyzedExpression;
}

export interface Repeat1Expression extends ExpressionBase {
  kind: "repeat1";
  expression: AnalyzedExpression;
}

export interface SeparatedExpression extends ExpressionBase {
  kind: "separated";
  item: AnalyzedExpression;
  separator: AnalyzedExpression;
}
