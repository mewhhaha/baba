/** A parsed EBNF grammar with terminal declarations and grammar rules. */
export interface EbnfGrammar {
  /** Explicit token and skip declarations from the grammar header. */
  tokens: EbnfTokenDeclaration[];
  /** Named parser rules in source order. */
  rules: EbnfRule[];
  /** Source span covering the complete grammar. */
  span: SourceSpan;
}

/** A source location range with zero-based offsets and one-based line/column. */
export interface SourceSpan {
  /** Zero-based inclusive source offset. */
  start: number;
  /** Zero-based exclusive source offset. */
  end: number;
  /** One-based source line. */
  line: number;
  /** One-based source column. */
  column: number;
}

/** A top-level terminal declaration. */
export interface EbnfTokenDeclaration {
  /** Whether the declaration emits a token or skips matched input. */
  kind: "token" | "skip";
  /** Token name used by grammar references and generated token kinds. */
  name: string;
  /** JavaScript regular expression source without surrounding slashes. */
  pattern: string;
  /** Source span for the full declaration. */
  span: SourceSpan;
}

/** A named grammar rule. */
export interface EbnfRule {
  /** Rule name. */
  name: string;
  /** Rule expression. */
  expression: EbnfExpression;
  /** Source span for the full rule. */
  span: SourceSpan;
}

/** An EBNF expression node. */
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

/** Lexical terminals discovered from a grammar. */
export interface LexicalSpec {
  /** Literal identifier-like terminals. */
  keywords: string[];
  /** Literal symbolic terminals, sorted longest first for scanning. */
  symbols: string[];
  /** Emitted regular-expression tokens. */
  tokens: LexicalTokenSpec[];
  /** Consumed regular-expression tokens. */
  skips: LexicalTokenSpec[];
}

/** A named regular-expression token used by lexical generation. */
export interface LexicalTokenSpec {
  /** Token name. */
  name: string;
  /** JavaScript regular expression source without surrounding slashes. */
  pattern: string;
}

/** Optional tree-sitter generation metadata. */
export interface TreeSitterMetadata {
  /** Extra tokens or rules allowed between tree-sitter tokens. */
  extras?: TreeSitterExtra[];
  /** Word rule used by tree-sitter. */
  word?: string;
  /** Supertype rule names. */
  supertypes?: string[];
  /** Conflict rule groups. */
  conflicts?: string[][];
  /** Rule names to inline. */
  inline?: string[];
  /** Query generation metadata. */
  queries?: TreeSitterQueriesMetadata;
  /** Per-rule tree-sitter shaping metadata. */
  rules?: Record<string, TreeSitterRuleMetadata>;
}

/** Query generation metadata. */
export interface TreeSitterQueriesMetadata {
  /** Rainbow bracket query settings. */
  rainbows?: TreeSitterRainbowsMetadata;
  /** Injection query settings. */
  injections?: TreeSitterInjectionMetadata[];
}

/** Rainbow bracket query settings. */
export interface TreeSitterRainbowsMetadata {
  /** Node names that should receive the rainbow scope capture. */
  scopes?: string[];
  /** Literal bracket tokens that should receive the rainbow bracket capture. */
  brackets?: string[];
}

/** Injection query settings for one embedded-language node. */
export interface TreeSitterInjectionMetadata {
  /** Node name captured as injection content. */
  node: string;
  /** Tree-sitter injection language name. */
  language: string;
}

/** A tree-sitter extra token or rule. */
export type TreeSitterExtra =
  | { kind: "regex"; value: string }
  | { kind: "rule"; name: string };

/** Per-rule tree-sitter shaping metadata. */
export interface TreeSitterRuleMetadata {
  /** Expression path to field-name mapping. */
  fields?: Record<string, string>;
  /** Token wrapper for the rendered rule. */
  token?: TreeSitterRuleToken;
  /** Precedence wrapper for the rendered rule. */
  wrap?: TreeSitterRuleWrap;
  /** Nested expression path rewrites. */
  paths?: Record<string, TreeSitterPathMetadata>;
}

/** Tree-sitter token wrapper metadata. */
export type TreeSitterRuleToken =
  | { kind: "token" }
  | { kind: "token.immediate" };

/** Tree-sitter precedence wrapper metadata. */
export type TreeSitterRuleWrap =
  | { kind: "prec"; value: number }
  | { kind: "prec.left"; value?: number }
  | { kind: "prec.right"; value?: number };

/** Tree-sitter metadata applied to an expression path. */
export interface TreeSitterPathMetadata {
  /** Field name to apply at this path. */
  field?: string;
  /** Precedence wrapper to apply at this path. */
  wrap?: TreeSitterRuleWrap;
  /** Alias this path as a reference to an existing rule. */
  alias_ref?: string;
  /** Alias this path as a new named node. */
  alias_node?: string;
  /** Render this path inline rather than as a node reference. */
  inline_path?: boolean;
  /** Hide the node produced at this path. */
  hidden_path?: boolean;
}
