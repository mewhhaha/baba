export interface EbnfGrammar {
  tokens: EbnfTokenDeclaration[];
  rules: EbnfRule[];
  span: SourceSpan;
}

export interface SourceSpan {
  start: number;
  end: number;
  line: number;
  column: number;
}

export interface EbnfTokenDeclaration {
  kind: "token" | "skip";
  name: string;
  pattern: string;
  span: SourceSpan;
}

export interface EbnfRule {
  name: string;
  expression: EbnfExpression;
  span: SourceSpan;
}

export type EbnfExpression =
  | { kind: "ref"; name: string; span: SourceSpan }
  | { kind: "literal"; value: string; span: SourceSpan }
  | { kind: "sequence"; items: EbnfExpression[]; span: SourceSpan }
  | { kind: "choice"; options: EbnfExpression[]; span: SourceSpan }
  | { kind: "optional"; expression: EbnfExpression; span: SourceSpan }
  | { kind: "repeat"; expression: EbnfExpression; span: SourceSpan }
  | { kind: "repeat1"; expression: EbnfExpression; span: SourceSpan }
  | {
    kind: "separated";
    item: EbnfExpression;
    separator: EbnfExpression;
    span: SourceSpan;
  };

export interface LexicalSpec {
  keywords: string[];
  symbols: string[];
  tokens: LexicalTokenSpec[];
  skips: LexicalTokenSpec[];
}

export interface LexicalTokenSpec {
  name: string;
  pattern: string;
}

export interface TreeSitterMetadata {
  extras?: TreeSitterExtra[];
  word?: string;
  supertypes?: string[];
  conflicts?: string[][];
  inline?: string[];
  queries?: TreeSitterQueriesMetadata;
  rules?: Record<string, TreeSitterRuleMetadata>;
}

export interface TreeSitterQueriesMetadata {
  rainbows?: TreeSitterRainbowsMetadata;
  injections?: TreeSitterInjectionMetadata[];
}

export interface TreeSitterRainbowsMetadata {
  scopes?: string[];
  brackets?: string[];
}

export interface TreeSitterInjectionMetadata {
  node: string;
  language: string;
}

export type TreeSitterExtra =
  | { kind: "regex"; value: string }
  | { kind: "rule"; name: string };

export interface TreeSitterRuleMetadata {
  fields?: Record<string, string>;
  token?: TreeSitterRuleToken;
  wrap?: TreeSitterRuleWrap;
  paths?: Record<string, TreeSitterPathMetadata>;
}

export type TreeSitterRuleToken =
  | { kind: "token" }
  | { kind: "token.immediate" };

export type TreeSitterRuleWrap =
  | { kind: "prec"; value: number }
  | { kind: "prec.left"; value?: number }
  | { kind: "prec.right"; value?: number };

export interface TreeSitterPathMetadata {
  field?: string;
  wrap?: TreeSitterRuleWrap;
  alias_ref?: string;
  alias_node?: string;
  inline_path?: boolean;
  hidden_path?: boolean;
}
