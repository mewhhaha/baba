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

/** Optional metadata for parser, editor, AST, formatter, and LSP generation. */
export interface BabaMetadata {
  /** Language package/editor identity metadata. */
  language?: WorkbenchLanguageMetadata;
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
  /** Typed AST helper generation metadata. */
  ast?: WorkbenchAstMetadata;
  /** Formatter scaffold metadata. */
  formatter?: WorkbenchFormatterMetadata;
  /** LSP scaffold metadata. */
  lsp?: WorkbenchLspMetadata;
  /** Per-rule tree-sitter shaping metadata. */
  rules?: Record<string, TreeSitterRuleMetadata>;
}

/** @deprecated Use `BabaMetadata`. */
export type TreeSitterMetadata = BabaMetadata;

/** A structured baba diagnostic. */
export interface Diagnostic {
  /** Stable machine-readable diagnostic code. */
  code: string;
  /** Human-readable diagnostic message. */
  message: string;
  /** Optional EBNF source span. */
  span?: SourceSpan;
  /** Optional metadata object path. */
  path?: string;
  /** Optional source line for span diagnostics. */
  sourceLine?: string;
}

/** Generation preset. */
export type GeneratePreset = "core" | "workbench";

/** Options for the stable high-level `generate` API. */
export interface GenerateOptions {
  /** Language/tree-sitter grammar name. */
  name?: string;
  /** Root grammar rule. Defaults to the first rule. */
  rootRule?: string;
  /** Generation preset. Defaults to `core`. */
  preset?: GeneratePreset;
  /** Optional generation metadata. */
  metadata?: BabaMetadata;
}

/** One generated file. */
export interface GeneratedFile {
  /** POSIX-style relative output path. */
  path: string;
  /** File contents. */
  content: string;
  /** File category. */
  kind: "source" | "query" | "config" | "test" | "docs";
}

/** Generated file bundle. */
export interface GeneratedBundle {
  /** Generation preset used for this bundle. */
  preset: GeneratePreset;
  /** Deterministically sorted generated files. */
  files: GeneratedFile[];
  /** Relative paths the writer should remove when absent from this bundle. */
  cleanupPaths?: string[];
}

/** Options for generating a starter baba project scaffold. */
export interface GenerateInitOptions {
  /** Language/package name. Defaults to `dirName` or `language`. */
  name?: string;
  /** Directory name used to derive the default language/package name. */
  dirName?: string;
}

/** Language identity metadata used by workbench scaffolds. */
export interface WorkbenchLanguageMetadata {
  /** Tree-sitter/editor scope, default `source.<name>`. */
  scope?: string;
  /** File extensions or names without a leading dot, default `[name]`. */
  fileTypes?: string[];
  /** Line comment token, default `//`. */
  comment?: string;
}

/** Query generation metadata. */
export interface TreeSitterQueriesMetadata {
  /** Highlight capture query entries. */
  highlights?: TreeSitterCaptureQueryMetadata;
  /** Locals capture query entries. */
  locals?: TreeSitterCaptureQueryEntries;
  /** Fold capture query entries. */
  folds?: TreeSitterCaptureQueryEntries;
  /** Indentation capture query entries. */
  indents?: TreeSitterCaptureQueryEntries;
  /** Tag capture query entries. */
  tags?: TreeSitterCaptureQueryEntries;
  /** Textobject capture query entries. */
  textobjects?: TreeSitterCaptureQueryEntries;
  /** Rainbow bracket query settings. */
  rainbows?: TreeSitterRainbowsMetadata;
  /** Injection query settings. */
  injections?: TreeSitterInjectionQueryEntry[];
}

export type TreeSitterCaptureQueryEntries = TreeSitterCaptureQueryEntry[];

export type TreeSitterCaptureQueryEntry =
  | TreeSitterCaptureMetadata
  | TreeSitterRawQueryMetadata;

export interface TreeSitterCaptureQueryMetadata {
  entries: TreeSitterCaptureQueryEntry[];
  defaults?: TreeSitterHighlightDefaultsMetadata;
}

export interface TreeSitterHighlightDefaultsMetadata {
  suppress?: TreeSitterCaptureSelectorMetadata[];
}

export interface TreeSitterRawQueryMetadata {
  /** Raw tree-sitter query pattern emitted verbatim. */
  pattern: string;
}

export interface TreeSitterCaptureSelectorMetadata {
  /** Node name to select. Mutually exclusive with `literal`. */
  node?: string;
  /** Literal terminal to select. Mutually exclusive with `node`. */
  literal?: string;
}

/** A metadata-driven tree-sitter query capture. */
export interface TreeSitterCaptureMetadata
  extends TreeSitterCaptureSelectorMetadata {
  /** Node name to capture. Mutually exclusive with `literal`. */
  node?: string;
  /** Literal terminal to capture. Mutually exclusive with `node`. */
  literal?: string;
  /** Capture name without the leading `@`. */
  capture: string;
}

/** Rainbow bracket query settings. */
export interface TreeSitterRainbowsMetadata {
  /** Node names that should receive the rainbow scope capture. */
  scopes?: string[];
  /** Literal bracket tokens that should receive the rainbow bracket capture. */
  brackets?: string[];
  /** Raw tree-sitter query patterns emitted before generated rainbows. */
  patterns?: string[];
}

export type TreeSitterInjectionQueryEntry =
  | TreeSitterInjectionMetadata
  | TreeSitterRawQueryMetadata;

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

/** Typed AST helper generation metadata. */
export interface WorkbenchAstMetadata {
  /** Rule/node-specific AST metadata keyed by tree-sitter node name. */
  nodes?: Record<string, WorkbenchAstNodeMetadata>;
}

/** Typed AST metadata for one node. */
export interface WorkbenchAstNodeMetadata {
  /** Generated discriminant value, defaulting to the node name. */
  kind?: string;
  /** Generated field names mapped to tree-sitter field names. */
  fields?: Record<string, string>;
}

/** Formatter scaffold metadata. */
export interface WorkbenchFormatterMetadata {
  /** Nodes that should be treated as blocks by the formatter scaffold. */
  blocks?: string[];
  /** Nodes that should be treated as lists by the formatter scaffold. */
  lists?: string[];
  /** Literal spacing hints keyed by terminal text. */
  spacing?: Record<string, "tight" | "space" | "newline">;
}

/** LSP scaffold metadata. */
export interface WorkbenchLspMetadata {
  /** Nodes exposed as document symbols. */
  documentSymbols?: string[];
  /** Nodes that should be considered for parser diagnostics. */
  diagnostics?: string[];
}
