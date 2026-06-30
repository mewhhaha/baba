import type {
  Diagnostic,
  GrammarExpressionOperator,
  GrammarModeTransition,
  GrammarTerminalPattern,
  SourceSpan,
} from "../ast.ts";

export type GrammarTokenId = number;
export type GrammarModeId = number;
export type GrammarRuleId = number;
export type GrammarLiteralId = number;
export type GrammarExpressionIslandId = number;
export type GrammarConstructorId = number;
export type GrammarFieldId = number;
export type GrammarModuleId = number;
export type GrammarExportId = number;
export type GrammarExpressionId = number;

export interface AnalyzedGrammar {
  readonly name: string;
  readonly rootRule: GrammarRuleId | undefined;
  readonly tokens: readonly AnalyzedGrammarToken[];
  readonly modes: readonly AnalyzedGrammarMode[];
  readonly rules: readonly AnalyzedGrammarRule[];
  readonly literals: readonly AnalyzedGrammarLiteral[];
  readonly expressionIslands: readonly AnalyzedGrammarExpressionIsland[];
  readonly constructors: readonly AnalyzedGrammarConstructor[];
  readonly fields: readonly AnalyzedGrammarField[];
  readonly modules: readonly AnalyzedGrammarModule[];
  readonly exports: readonly AnalyzedGrammarExport[];
  readonly extensions: readonly AnalyzedGrammarExtension[];
  readonly reachableRules: ReadonlySet<GrammarRuleId>;
  readonly reachableTokens: ReadonlySet<GrammarTokenId>;
  readonly reachableLiterals: ReadonlySet<GrammarLiteralId>;
  readonly diagnostics: readonly Diagnostic[];
}

export interface AnalyzedGrammarToken {
  readonly id: GrammarTokenId;
  readonly name: string;
  readonly kind: "token" | "skip" | "contextual";
  readonly pattern: GrammarTerminalPattern;
  readonly priority: number;
  readonly modeId: GrammarModeId;
  readonly channel: string | undefined;
  readonly transition: GrammarModeTransition | undefined;
  readonly span: SourceSpan;
}

export interface AnalyzedGrammarMode {
  readonly id: GrammarModeId;
  readonly name: string;
  readonly span: SourceSpan;
}

export interface AnalyzedGrammarRule {
  readonly id: GrammarRuleId;
  readonly name: string;
  readonly expression: AnalyzedGrammarExpression;
  readonly sync: AnalyzedGrammarExpression | undefined;
  readonly nullable: boolean;
  readonly productive: boolean;
  readonly span: SourceSpan;
}

export interface AnalyzedGrammarLiteral {
  readonly id: GrammarLiteralId;
  readonly value: string;
  readonly sourceOrder: number;
  readonly span: SourceSpan;
}

export interface AnalyzedGrammarExpressionIsland {
  readonly id: GrammarExpressionIslandId;
  readonly ruleId: GrammarRuleId;
  readonly atom: AnalyzedGrammarExpression;
  readonly operators: readonly GrammarExpressionOperator[];
  readonly span: SourceSpan;
}

export interface AnalyzedGrammarConstructor {
  readonly id: GrammarConstructorId;
  readonly name: string;
  readonly fields: readonly string[];
  readonly span: SourceSpan;
}

export interface AnalyzedGrammarField {
  readonly id: GrammarFieldId;
  readonly name: string;
  readonly span: SourceSpan;
}

export interface AnalyzedGrammarModule {
  readonly id: GrammarModuleId;
  readonly name: string;
  readonly span: SourceSpan;
}

export interface AnalyzedGrammarExport {
  readonly id: GrammarExportId;
  readonly name: string;
  readonly span: SourceSpan;
}

export interface AnalyzedGrammarExtension {
  readonly target: string;
  readonly expression: AnalyzedGrammarExpression;
  readonly span: SourceSpan;
}

export type GrammarResolvedReference =
  | { readonly kind: "rule"; readonly ruleId: GrammarRuleId }
  | { readonly kind: "token"; readonly tokenId: GrammarTokenId }
  | { readonly kind: "skip"; readonly tokenId: GrammarTokenId }
  | { readonly kind: "literal"; readonly literalId: GrammarLiteralId }
  | { readonly kind: "unknown"; readonly name: string };

export type AnalyzedGrammarExpression =
  | {
    readonly id: GrammarExpressionId;
    readonly kind: "field";
    readonly name: string;
    readonly expression: AnalyzedGrammarExpression;
    readonly span: SourceSpan;
  }
  | {
    readonly id: GrammarExpressionId;
    readonly kind: "ref";
    readonly name: string;
    readonly reference: GrammarResolvedReference;
    readonly span: SourceSpan;
  }
  | {
    readonly id: GrammarExpressionId;
    readonly kind: "literal";
    readonly value: string;
    readonly literalId: GrammarLiteralId;
    readonly span: SourceSpan;
  }
  | {
    readonly id: GrammarExpressionId;
    readonly kind: "sequence";
    readonly items: readonly AnalyzedGrammarExpression[];
    readonly span: SourceSpan;
  }
  | {
    readonly id: GrammarExpressionId;
    readonly kind: "choice";
    readonly options: readonly AnalyzedGrammarExpression[];
    readonly span: SourceSpan;
  }
  | {
    readonly id: GrammarExpressionId;
    readonly kind: "optional";
    readonly expression: AnalyzedGrammarExpression;
    readonly span: SourceSpan;
  }
  | {
    readonly id: GrammarExpressionId;
    readonly kind: "repeat";
    readonly expression: AnalyzedGrammarExpression;
    readonly span: SourceSpan;
  }
  | {
    readonly id: GrammarExpressionId;
    readonly kind: "repeat1";
    readonly expression: AnalyzedGrammarExpression;
    readonly span: SourceSpan;
  }
  | {
    readonly id: GrammarExpressionId;
    readonly kind: "separated";
    readonly item: AnalyzedGrammarExpression;
    readonly separator: AnalyzedGrammarExpression;
    readonly span: SourceSpan;
  }
  | {
    readonly id: GrammarExpressionId;
    readonly kind: "constructor";
    readonly expression: AnalyzedGrammarExpression;
    readonly constructorId: GrammarConstructorId;
    readonly span: SourceSpan;
  }
  | {
    readonly id: GrammarExpressionId;
    readonly kind: "expressionIsland";
    readonly islandId: GrammarExpressionIslandId;
    readonly atom: AnalyzedGrammarExpression;
    readonly span: SourceSpan;
  };
