import type { ParserKit } from "./targets/kit/schema.ts";

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
  /** Explicit lexical priority. Higher values win equal-length matches. */
  priority?: number;
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
  | {
    kind: "field";
    name: string;
    expression: EbnfExpression;
    span: SourceSpan;
  }
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

/** Optional metadata for generation, query emission, and parser conflict policy. */
export interface BabaMetadata {
  /** Metadata schema version. Omit for legacy callers; when present, must be 1. */
  version?: 1;
  /** External token names supplied by a user-owned Tree-sitter scanner. */
  externals?: string[];
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
  /** Standalone parser runtime conflict policy. */
  parser?: ParserRuntimeMetadata;
}

/** @deprecated Use `BabaMetadata`. */
export type TreeSitterMetadata = BabaMetadata;

/** A structured baba diagnostic. */
export interface Diagnostic {
  /** Stable machine-readable diagnostic code. */
  code: string;
  /** Human-readable diagnostic message. */
  message: string;
  /** Diagnostic severity. Defaults to error for thrown diagnostics. */
  severity?: "error" | "warning" | "information";
  /** Backend that produced the diagnostic, when backend-specific. */
  backend?: "tree-sitter" | string;
  /** Optional EBNF source span. */
  span?: SourceSpan;
  /** Optional metadata object path. */
  path?: string;
  /** Optional source line for span diagnostics. */
  sourceLine?: string;
  /** Related source locations that help explain the diagnostic. */
  related?: readonly {
    message: string;
    span: SourceSpan;
  }[];
}

/** Output target selected for a generation run. */
export type GenerateTarget = "tree-sitter" | "typescript" | "wasm" | "kit";

/** Cross-target portability diagnostic policy. */
export type PortabilityMode = "strict" | "warn" | "off";

/** Shared options for targets backed by the portable standalone runtime. */
export interface PortableRuntimePlanningOptions {
  /** Preserve skip-token matches as trivia tokens. Defaults to true. */
  preserveTrivia?: boolean;
  /** Maximum generated lexer DFA state count. Defaults to 50,000. */
  lexerStateLimit?: number;
  /** Maximum regex source length in UTF-16 code units per token pattern. Defaults to unlimited. */
  regexSourceLengthLimit?: number;
  /** Maximum nested regex group depth per token pattern. Defaults to unlimited. */
  regexNestingLimit?: number;
  /** Maximum regex AST node count per token pattern. Defaults to 100,000. */
  regexAstNodeLimit?: number;
  /** Maximum regex bounded-repeat expansion count. Defaults to 10,000. */
  regexBoundedRepeatLimit?: number;
  /** Maximum regex NFA state count per planning operation. Defaults to 100,000. */
  regexNfaStateLimit?: number;
  /** Maximum regex DFA state count per planning operation. Defaults to 50,000. */
  regexDfaStateLimit?: number;
  /** Maximum DFA product states explored during overlap analysis. Defaults to 250,000. */
  regexOverlapStateLimit?: number;
  /** Maximum token/literal pairs compared during overlap analysis. Defaults to unlimited. */
  regexOverlapPairLimit?: number;
  /** Maximum canonical LR(1) state count. Defaults to 20,000. */
  parserStateLimit?: number;
  /** Maximum total LR(1) item count across all states. Defaults to unlimited. */
  parserItemLimit?: number;
  /** Maximum total ACTION and GOTO table entries. Defaults to unlimited. */
  parserTableEntryLimit?: number;
  /** Maximum runtime-planning diagnostics returned before a summary is appended. Defaults to unlimited. */
  diagnosticLimit?: number;
}

/** Options for the standalone TypeScript lexer/parser target. */
export interface TypeScriptTargetOptions
  extends PortableRuntimePlanningOptions {
  /** Relative directory inside the generated bundle. Defaults to `typescript`. */
  directory?: string;
  /** Maximum generated TypeScript source bytes. Defaults to unlimited. */
  generatedByteLimit?: number;
  /** Emit an informational parser planning statistics diagnostic. */
  reportParserStats?: boolean;
}

/** Options for the standalone Wasm lexer/parser target. */
export interface WasmTargetOptions extends PortableRuntimePlanningOptions {
  /** Relative directory inside the generated bundle. Defaults to `wasm`. */
  directory?: string;
  /** Maximum generated Wasm adapter/source bytes. Defaults to unlimited. */
  generatedByteLimit?: number;
  /** Emit an informational parser planning statistics diagnostic. */
  reportParserStats?: boolean;
  /** Wasm packaging mode. Currently defaults to the JavaScript-embedded module. */
  packaging?: "external-binary" | "embedded-typescript";
}

/** Options for the generic parser-kit target. */
export interface KitTargetOptions {
  /** Relative directory inside the generated bundle. Defaults to `kit`. */
  directory?: string;
  /** Parser-kit detail profile. Defaults to `full`; use `runtime` for compact helper-only artifacts. */
  profile?: "full" | "runtime";
  /** Preserve skip-token matches in reference helper lexing. Defaults to true. */
  preserveTrivia?: boolean;
  /** Maximum generated lexer DFA state count. Defaults to 50,000. */
  lexerStateLimit?: number;
  /** Maximum regex source length in UTF-16 code units per token pattern. Defaults to unlimited. */
  regexSourceLengthLimit?: number;
  /** Maximum nested regex group depth per token pattern. Defaults to unlimited. */
  regexNestingLimit?: number;
  /** Maximum regex AST node count per token pattern. Defaults to 100,000. */
  regexAstNodeLimit?: number;
  /** Maximum regex bounded-repeat expansion count. Defaults to 10,000. */
  regexBoundedRepeatLimit?: number;
  /** Maximum regex NFA state count per planning operation. Defaults to 100,000. */
  regexNfaStateLimit?: number;
  /** Maximum regex DFA state count per planning operation. Defaults to 50,000. */
  regexDfaStateLimit?: number;
  /** Maximum DFA product states explored during overlap analysis. Defaults to 250,000. */
  regexOverlapStateLimit?: number;
  /** Maximum token/literal pairs compared during overlap analysis. Defaults to unlimited. */
  regexOverlapPairLimit?: number;
  /** Maximum canonical LR(1) state count. Defaults to 20,000. */
  parserStateLimit?: number;
  /** Maximum total LR(1) item count across all states. Defaults to unlimited. */
  parserItemLimit?: number;
  /** Maximum total ACTION and GOTO table entries. Defaults to unlimited. */
  parserTableEntryLimit?: number;
  /** Maximum runtime-planning diagnostics returned before a summary is appended. Defaults to unlimited. */
  diagnosticLimit?: number;
}

/** Conflict policy for standalone parser runtimes. */
export interface ParserRuntimeMetadata {
  /** Conflict groups that may be explored by the TypeScript parser runtime. */
  conflicts?: string[][];
  /** Deterministic conflict resolutions applied while building LR tables. */
  resolutions?: ParserConflictResolutionMetadata[];
}

/** One deterministic LR parser conflict resolution. */
export interface ParserConflictResolutionMetadata {
  /** Stable conflict ID reported by parser conflict diagnostics. */
  conflict?: string;
  /** Rule names or expression descriptions that must be involved. */
  rules?: string[];
  /** Terminal display or literal text that must trigger the conflict. */
  on?: string;
  /** Which LR action kind should win. */
  prefer: "shift" | "reduce";
  /** Rule name or expression text to select when more than one reduce action exists. */
  reduce?: string;
}

/** Options for the stable high-level `generate` API. */
export interface GenerateOptions {
  /** Language/tree-sitter grammar name. */
  name?: string;
  /** Root grammar rule. Defaults to the first rule. */
  rootRule?: string;
  /** Optional generation metadata. */
  metadata?: BabaMetadata;
  /** Output targets. Defaults to ["tree-sitter"]. */
  targets?: readonly GenerateTarget[];
  /** Cross-target portability policy. Defaults to strict for Tree-sitter plus another target, warn otherwise. */
  portability?: PortabilityMode;
  /** Standalone TypeScript target options. */
  typescript?: TypeScriptTargetOptions;
  /** Standalone Wasm target options. */
  wasm?: WasmTargetOptions;
  /** Generic parser-kit target options. */
  kit?: KitTargetOptions;
}

/** Options for the nonthrowing compiler API. */
export interface CompileOptions extends GenerateOptions {}

/** Nonthrowing compiler result. */
export interface CompileResult {
  /** All diagnostics collected while analyzing and planning targets. */
  diagnostics: readonly Diagnostic[];
  /** Present only when no error diagnostics were produced. */
  bundle?: GeneratedBundle;
}

/** Options for compiling only a generic parser-kit artifact. */
export interface CompileParserKitOptions {
  /** Language/grammar name. */
  name?: string;
  /** Root grammar rule. Defaults to the first rule. */
  rootRule?: string;
  /** Optional generation metadata. */
  metadata?: BabaMetadata;
  /** Cross-target portability policy. Defaults to warn. */
  portability?: PortabilityMode;
  /** Parser-kit target options. */
  kit?: KitTargetOptions;
}

/** Nonthrowing parser-kit compiler result. */
export interface CompileParserKitResult {
  /** All diagnostics collected while analyzing and planning the kit. */
  diagnostics: readonly Diagnostic[];
  /** Present only when no error diagnostics were produced. */
  kit?: ParserKit;
}

/** Options for grammar and target validation without output generation. */
export interface ValidateOptions {
  /** Root grammar rule. Defaults to the first rule. */
  rootRule?: string;
  /** Optional generation metadata. */
  metadata?: BabaMetadata;
  /** Output targets to validate. Defaults to ["tree-sitter"]. */
  targets?: readonly GenerateTarget[];
  /** Cross-target portability policy. Defaults to strict for Tree-sitter plus another target, warn otherwise. */
  portability?: PortabilityMode;
  /** Standalone TypeScript target options. */
  typescript?: TypeScriptTargetOptions;
  /** Standalone Wasm target options. */
  wasm?: WasmTargetOptions;
  /** Generic parser-kit target options. */
  kit?: KitTargetOptions;
}

export type TextGeneratedFileKind =
  | "source"
  | "query"
  | "config"
  | "test"
  | "docs";

/** One generated file. */
export type GeneratedFile =
  | {
    /** POSIX-style relative output path. */
    readonly path: string;
    /** File category. */
    readonly kind: TextGeneratedFileKind;
    /** Text encoding. */
    readonly encoding: "utf-8";
    /** File contents. */
    readonly content: string;
  }
  | {
    /** POSIX-style relative output path. */
    readonly path: string;
    /** File category. */
    readonly kind: "binary";
    /** Binary encoding. */
    readonly encoding: "binary";
    /** File contents. */
    readonly content: Uint8Array;
  };

/** Generated file bundle. */
export interface GeneratedBundle {
  /** Deterministically sorted generated files. */
  files: GeneratedFile[];
  /** Relative paths the writer should remove when absent from this bundle. */
  cleanupPaths?: string[];
  /** Non-fatal diagnostics produced while generating the bundle. */
  diagnostics?: Diagnostic[];
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
  /** Default highlight inference mode. Defaults to rich. */
  mode?: "rich" | "minimal";
  suppress?: TreeSitterCaptureSelectorMetadata[];
  ignore?: TreeSitterHighlightCoverageIgnoreMetadata[];
}

export interface TreeSitterRawQueryMetadata {
  /** Raw tree-sitter query pattern emitted verbatim. */
  pattern: string;
}

export interface TreeSitterCaptureSelectorMetadata {
  /** Parent syntax node that must contain the selected child. */
  parent?: string;
  /** Parent field name that must contain the selected child. Requires `parent`. */
  field?: string;
  /** Node name to select. Mutually exclusive with `literal`. */
  node?: string;
  /** Literal terminal to select. Mutually exclusive with `node`. */
  literal?: string;
}

export interface TreeSitterHighlightCoverageIgnoreMetadata
  extends TreeSitterCaptureSelectorMetadata {
  /** Parent syntax node where the uncovered suppressed node is intentional. */
  parent: string;
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
  /** @deprecated Use named EBNF fields instead. */
  fields?: Record<string, string>;
  /** Token wrapper for the rendered rule. */
  token?: TreeSitterRuleToken;
  /** Precedence wrapper for the rendered rule. */
  wrap?: TreeSitterRuleWrap;
  /** Root, named-field, or unversioned legacy numeric path rewrites. */
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
