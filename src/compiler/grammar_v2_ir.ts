import type {
  Diagnostic,
  GrammarV2ExpressionOperator,
  GrammarV2ModeTransition,
  GrammarV2TerminalPattern,
  SourceSpan,
} from "../ast.ts";

export type GrammarV2TokenId = number;
export type GrammarV2ModeId = number;
export type GrammarV2RuleId = number;
export type GrammarV2LiteralId = number;
export type GrammarV2ExpressionIslandId = number;
export type GrammarV2ConstructorId = number;
export type GrammarV2FieldId = number;
export type GrammarV2ModuleId = number;
export type GrammarV2ExportId = number;
export type GrammarV2ExpressionId = number;

export interface AnalyzedGrammarV2 {
  readonly name: string;
  readonly rootRule: GrammarV2RuleId | undefined;
  readonly tokens: readonly AnalyzedGrammarV2Token[];
  readonly modes: readonly AnalyzedGrammarV2Mode[];
  readonly rules: readonly AnalyzedGrammarV2Rule[];
  readonly literals: readonly AnalyzedGrammarV2Literal[];
  readonly expressionIslands: readonly AnalyzedGrammarV2ExpressionIsland[];
  readonly constructors: readonly AnalyzedGrammarV2Constructor[];
  readonly fields: readonly AnalyzedGrammarV2Field[];
  readonly modules: readonly AnalyzedGrammarV2Module[];
  readonly exports: readonly AnalyzedGrammarV2Export[];
  readonly extensions: readonly AnalyzedGrammarV2Extension[];
  readonly reachableRules: ReadonlySet<GrammarV2RuleId>;
  readonly reachableTokens: ReadonlySet<GrammarV2TokenId>;
  readonly reachableLiterals: ReadonlySet<GrammarV2LiteralId>;
  readonly diagnostics: readonly Diagnostic[];
}

export interface AnalyzedGrammarV2Token {
  readonly id: GrammarV2TokenId;
  readonly name: string;
  readonly kind: "token" | "skip" | "contextual";
  readonly pattern: GrammarV2TerminalPattern;
  readonly modeId: GrammarV2ModeId;
  readonly channel: string | undefined;
  readonly transition: GrammarV2ModeTransition | undefined;
  readonly span: SourceSpan;
}

export interface AnalyzedGrammarV2Mode {
  readonly id: GrammarV2ModeId;
  readonly name: string;
  readonly span: SourceSpan;
}

export interface AnalyzedGrammarV2Rule {
  readonly id: GrammarV2RuleId;
  readonly name: string;
  readonly expression: AnalyzedGrammarV2Expression;
  readonly sync: AnalyzedGrammarV2Expression | undefined;
  readonly nullable: boolean;
  readonly productive: boolean;
  readonly span: SourceSpan;
}

export interface AnalyzedGrammarV2Literal {
  readonly id: GrammarV2LiteralId;
  readonly value: string;
  readonly sourceOrder: number;
  readonly span: SourceSpan;
}

export interface AnalyzedGrammarV2ExpressionIsland {
  readonly id: GrammarV2ExpressionIslandId;
  readonly ruleId: GrammarV2RuleId;
  readonly atom: AnalyzedGrammarV2Expression;
  readonly operators: readonly GrammarV2ExpressionOperator[];
  readonly span: SourceSpan;
}

export interface AnalyzedGrammarV2Constructor {
  readonly id: GrammarV2ConstructorId;
  readonly name: string;
  readonly fields: readonly string[];
  readonly span: SourceSpan;
}

export interface AnalyzedGrammarV2Field {
  readonly id: GrammarV2FieldId;
  readonly name: string;
  readonly span: SourceSpan;
}

export interface AnalyzedGrammarV2Module {
  readonly id: GrammarV2ModuleId;
  readonly name: string;
  readonly span: SourceSpan;
}

export interface AnalyzedGrammarV2Export {
  readonly id: GrammarV2ExportId;
  readonly name: string;
  readonly span: SourceSpan;
}

export interface AnalyzedGrammarV2Extension {
  readonly target: string;
  readonly expression: AnalyzedGrammarV2Expression;
  readonly span: SourceSpan;
}

export type GrammarV2ResolvedReference =
  | { readonly kind: "rule"; readonly ruleId: GrammarV2RuleId }
  | { readonly kind: "token"; readonly tokenId: GrammarV2TokenId }
  | { readonly kind: "skip"; readonly tokenId: GrammarV2TokenId }
  | { readonly kind: "literal"; readonly literalId: GrammarV2LiteralId }
  | { readonly kind: "unknown"; readonly name: string };

export type AnalyzedGrammarV2Expression =
  | {
    readonly id: GrammarV2ExpressionId;
    readonly kind: "field";
    readonly name: string;
    readonly expression: AnalyzedGrammarV2Expression;
    readonly span: SourceSpan;
  }
  | {
    readonly id: GrammarV2ExpressionId;
    readonly kind: "ref";
    readonly name: string;
    readonly reference: GrammarV2ResolvedReference;
    readonly span: SourceSpan;
  }
  | {
    readonly id: GrammarV2ExpressionId;
    readonly kind: "literal";
    readonly value: string;
    readonly literalId: GrammarV2LiteralId;
    readonly span: SourceSpan;
  }
  | {
    readonly id: GrammarV2ExpressionId;
    readonly kind: "sequence";
    readonly items: readonly AnalyzedGrammarV2Expression[];
    readonly span: SourceSpan;
  }
  | {
    readonly id: GrammarV2ExpressionId;
    readonly kind: "choice";
    readonly options: readonly AnalyzedGrammarV2Expression[];
    readonly span: SourceSpan;
  }
  | {
    readonly id: GrammarV2ExpressionId;
    readonly kind: "optional";
    readonly expression: AnalyzedGrammarV2Expression;
    readonly span: SourceSpan;
  }
  | {
    readonly id: GrammarV2ExpressionId;
    readonly kind: "repeat";
    readonly expression: AnalyzedGrammarV2Expression;
    readonly span: SourceSpan;
  }
  | {
    readonly id: GrammarV2ExpressionId;
    readonly kind: "repeat1";
    readonly expression: AnalyzedGrammarV2Expression;
    readonly span: SourceSpan;
  }
  | {
    readonly id: GrammarV2ExpressionId;
    readonly kind: "separated";
    readonly item: AnalyzedGrammarV2Expression;
    readonly separator: AnalyzedGrammarV2Expression;
    readonly span: SourceSpan;
  }
  | {
    readonly id: GrammarV2ExpressionId;
    readonly kind: "constructor";
    readonly expression: AnalyzedGrammarV2Expression;
    readonly constructorId: GrammarV2ConstructorId;
    readonly span: SourceSpan;
  }
  | {
    readonly id: GrammarV2ExpressionId;
    readonly kind: "expressionIsland";
    readonly islandId: GrammarV2ExpressionIslandId;
    readonly atom: AnalyzedGrammarV2Expression;
    readonly span: SourceSpan;
  };
