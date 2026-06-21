import type {
  Diagnostic,
  EbnfExpression,
  EbnfGrammar,
  SourceSpan,
  TreeSitterCaptureMetadata,
  TreeSitterCaptureQueryEntry,
  TreeSitterCaptureSelectorMetadata,
  TreeSitterExtra,
  TreeSitterInjectionQueryEntry,
  TreeSitterMetadata,
  TreeSitterPathMetadata,
  TreeSitterRainbowsMetadata,
  TreeSitterRuleMetadata,
  TreeSitterRuleToken,
  TreeSitterRuleWrap,
} from "./ast.ts";
import { analyzeGrammar } from "./compiler/analyze.ts";
import { validateEbnfGrammar } from "./compiler/diagnostics.ts";
import type { AnalyzedExpression, AnalyzedGrammar } from "./compiler/ir.ts";
import { parsePortableRegex } from "./compiler/regex/parser.ts";
import { emitPortableRegexSource } from "./compiler/regex/emit.ts";
import { BabaError } from "./errors.ts";
import { parseEbnf } from "./parser.ts";

export {
  collectGrammarDiagnostics,
  collectReachabilityDiagnostics,
  validateEbnfGrammar,
} from "./compiler/diagnostics.ts";

function treeSitterDiagnosticError(
  code: string,
  message: string,
  options: { path?: string; span?: SourceSpan } = {},
): never {
  throw new BabaError({
    code,
    severity: "error",
    backend: "tree-sitter",
    message,
    path: options.path,
    span: options.span,
  });
}

type TreeSitterExpression = EbnfExpression | AnalyzedExpression;

interface TreeSitterPlan {
  readonly name: string;
  readonly rootRuleName: string;
  readonly rootRuleSpan: SourceSpan;
  readonly rules: readonly TreeSitterRulePlan[];
  readonly tokens: readonly TreeSitterTokenPlan[];
  readonly reachableRules: ReadonlySet<string>;
  readonly reachableTokens: ReadonlySet<string>;
  readonly reachableLiterals: ReadonlySet<string>;
  readonly externals: readonly string[];
}

interface TreeSitterRulePlan {
  readonly name: string;
  readonly expression: TreeSitterExpression;
  readonly span: SourceSpan;
}

interface TreeSitterTokenPlan {
  readonly name: string;
  readonly kind: "token" | "skip";
  readonly pattern: string;
  readonly priority: number;
  readonly span: SourceSpan;
}

/** Collects literal terminal strings referenced by grammar rules. */
export function collectTerminals(grammar: EbnfGrammar): string[] {
  const terminals = new Set<string>();
  for (const rule of grammar.rules) visit(rule.expression, terminals);
  return [...terminals].sort();
}

function createAnalyzedTreeSitterPlan(
  analyzed: AnalyzedGrammar,
): TreeSitterPlan {
  const rootRule = analyzed.rules[analyzed.rootRule];
  return {
    name: analyzed.name,
    rootRuleName: rootRule?.name ?? "module",
    rootRuleSpan: rootRule?.span ?? { start: 0, end: 0, line: 1, column: 1 },
    rules: analyzed.rules.map((rule) => ({
      name: rule.name,
      expression: rule.expression,
      span: rule.span,
    })),
    tokens: analyzed.tokens.map((token) => ({
      name: token.name,
      kind: token.kind,
      pattern: emitPortableRegexSource(token.pattern),
      priority: token.priority,
      span: token.span,
    })),
    reachableRules: new Set(
      [...analyzed.reachableRules].map((ruleId) => analyzed.rules[ruleId].name),
    ),
    reachableTokens: new Set(
      [...analyzed.reachableTokens].map((tokenId) =>
        analyzed.tokens[tokenId].name
      ),
    ),
    reachableLiterals: new Set(
      [...analyzed.reachableLiterals].map((literalId) =>
        analyzed.literals[literalId].value
      ),
    ),
    externals: [...analyzed.externals.map((external) => external.name)],
  };
}

function createGrammarTreeSitterPlan(
  grammar: EbnfGrammar,
  rootRuleName: string,
  metadata: TreeSitterMetadata = {},
): TreeSitterPlan {
  const rootRule = grammar.rules.find((rule) => rule.name === rootRuleName);
  if (!rootRule) {
    treeSitterDiagnosticError(
      "TREE_SITTER_UNKNOWN_ROOT_RULE",
      `Unknown root rule '${rootRuleName}'`,
    );
  }
  const reachableRules = collectReachableRuleNames(grammar, rootRuleName);
  const reachableRefs = collectReachableRefs(grammar, reachableRules);
  const reachableLiterals = new Set(
    collectReachableTerminals(grammar, reachableRules),
  );
  return {
    name: "grammar",
    rootRuleName,
    rootRuleSpan: rootRule.span,
    rules: grammar.rules.map((rule) => ({
      name: rule.name,
      expression: rule.expression,
      span: rule.span,
    })),
    tokens: grammar.tokens.map((token) => ({
      name: token.name,
      kind: token.kind,
      pattern: token.pattern,
      priority: token.priority ?? 0,
      span: token.span,
    })),
    reachableRules,
    reachableTokens: new Set(
      grammar.tokens
        .filter((token) =>
          token.kind === "token" && reachableRefs.has(token.name)
        )
        .map((token) => token.name),
    ),
    reachableLiterals,
    externals: [...(metadata.externals ?? [])],
  };
}

/** Validates capability limits specific to the tree-sitter backend. */
export function validateTreeSitterBackendCapabilities(
  grammar: EbnfGrammar,
): void {
  for (const token of grammar.tokens) {
    try {
      parsePortableRegex(token.pattern);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      treeSitterDiagnosticError(
        "TREE_SITTER_UNSUPPORTED_REGEX",
        `${
          token.kind === "skip" ? "Skip" : "Token"
        } '${token.name}' uses regex outside Baba's portable subset: ${message}`,
        { span: token.span },
      );
    }
  }
}

/** Validates Tree-sitter backend limits that require shared analysis. */
export function validateAnalyzedTreeSitterBackendCapabilities(
  analyzed: AnalyzedGrammar,
): void {
  void analyzed;
}

export { parseTreeSitterMetadata } from "./metadata.ts";

/** Generates an ESM tree-sitter grammar source file. */
export function generateTreeSitterGrammar(
  sourceOrGrammar: string | EbnfGrammar,
  options: {
    name?: string;
    rootRule?: string;
    metadata?: TreeSitterMetadata;
    skipValidation?: boolean;
  } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  const name = options.name ?? "waesm";
  const rootRuleName = options.rootRule ?? grammar.rules[0]?.name ?? "module";
  if (!options.skipValidation) {
    validateEbnfGrammar(grammar, {
      rootRule: rootRuleName,
      externals: options.metadata?.externals,
    });
  }
  const analyzed = analyzeGrammar(grammar, {
    name,
    rootRule: rootRuleName,
    metadata: options.metadata,
  });
  if (options.skipValidation) {
    validateTreeSitterBackendCapabilities(grammar);
  } else {
    validateAnalyzedTreeSitterBackendCapabilities(analyzed);
  }
  const rootRule = grammar.rules.find((rule) => rule.name === rootRuleName);
  if (!rootRule) {
    treeSitterDiagnosticError(
      "TREE_SITTER_UNKNOWN_ROOT_RULE",
      `Unknown root rule '${rootRuleName}'`,
    );
  }

  if (!options.skipValidation) {
    validateTreeSitterMetadataSemantics(
      grammar,
      rootRuleName,
      options.metadata,
    );
  }

  return generateAnalyzedTreeSitterGrammar(
    analyzed,
    { name, metadata: options.metadata },
  );
}

/** Generates an ESM tree-sitter grammar source file from shared analysis. */
export function generateAnalyzedTreeSitterGrammar(
  analyzed: AnalyzedGrammar,
  options: {
    name?: string;
    metadata?: TreeSitterMetadata;
  } = {},
): string {
  const metadata = options.metadata ?? {};
  const plan = createAnalyzedTreeSitterPlan(analyzed);
  const context = createRenderContext(
    plan.rules,
    sourceFileExpression(plan),
    metadata,
  );
  const rootRefExpression = sourceFileExpression(plan);
  const ruleLines = [
    `    source_file: $ => ${
      renderRuleExpression(
        "source_file",
        rootRefExpression,
        metadata.rules?.source_file,
        context,
      )
    },`,
    ...plan.rules
      .filter((rule) => plan.reachableRules.has(rule.name))
      .map((rule) => {
        const rendered = renderRuleExpression(
          rule.name,
          rule.expression,
          metadata.rules?.[rule.name],
          context,
        );
        return `    ${formatRuleKey(rule.name)}: $ => ${rendered},`;
      }),
    ...plan.tokens.filter((token) =>
      token.kind === "skip" || plan.reachableTokens.has(token.name)
    ).map((token) => {
      const rendered = renderTokenDeclaration(token);
      return `    ${formatRuleKey(token.name)}: $ => ${rendered},`;
    }),
    ...[...context.helperRules.entries()].map(([name, rendered]) =>
      `    ${formatRuleKey(name)}: $ => ${rendered},`
    ),
  ];

  const headerLines = [
    `// Generated by @mewhhaha/baba. Do not edit by hand.`,
    "export default grammar({",
    `  name: ${JSON.stringify(options.name ?? plan.name)},`,
    "",
  ];

  const extras = [
    ...(metadata.extras ?? []),
    ...plan.tokens
      .filter((token) => token.kind === "skip")
      .map((token): TreeSitterExtra => ({ kind: "rule", name: token.name })),
  ];
  headerLines.push("  extras: $ => [");
  for (const extra of extras) {
    headerLines.push(`    ${renderExtra(extra)},`);
  }
  headerLines.push("  ],", "");

  if (metadata.word) {
    headerLines.push(`  word: $ => $.${metadata.word},`, "");
  }

  if (metadata.externals?.length) {
    headerLines.push(
      `  externals: $ => ${renderRuleRefArray(metadata.externals)},`,
      "",
    );
  }

  if (metadata.supertypes?.length) {
    headerLines.push(
      `  supertypes: $ => ${renderRuleRefArray(metadata.supertypes)},`,
      "",
    );
  }

  if (metadata.conflicts?.length) {
    headerLines.push("  conflicts: $ => [");
    for (const conflict of metadata.conflicts) {
      headerLines.push(`    ${renderRuleRefArray(conflict)},`);
    }
    headerLines.push("  ],", "");
  }

  const inlineRules = collectInlineRules(metadata);
  if (inlineRules.length) {
    headerLines.push(`  inline: $ => ${renderRuleRefArray(inlineRules)},`, "");
  }

  return `${headerLines.join("\n")}  rules: {\n${
    ruleLines.join("\n")
  }\n  },\n});\n`;
}

/** Generates an optional tree-sitter rainbow-bracket query. */
export function generateTreeSitterRainbowsQuery(
  sourceOrGrammar: string | EbnfGrammar,
  options: {
    rootRule?: string;
    metadata?: TreeSitterMetadata;
    skipValidation?: boolean;
  } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  const rootRuleName = options.rootRule ?? grammar.rules[0]?.name ?? "module";
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateEbnfGrammar(grammar, {
      rootRule: rootRuleName,
      externals: metadata.externals,
    });
  }
  if (!options.skipValidation) {
    validateTreeSitterQueryMetadata(grammar, metadata, rootRuleName);
  }

  return generateTreeSitterRainbowsQueryFromPlan(
    createGrammarTreeSitterPlan(grammar, rootRuleName, metadata),
    metadata,
  );
}

function generateTreeSitterRainbowsQueryFromPlan(
  plan: TreeSitterPlan,
  metadata: TreeSitterMetadata,
): string {
  const rainbow = metadata.queries?.rainbows;
  const patterns = rainbow?.patterns ?? [];
  const scopes = rainbow?.scopes ?? [];
  const brackets = rainbow?.brackets ??
    collectDefaultRainbowBrackets(plan);
  const lines: string[] = [...patterns];
  if (patterns.length > 0 && (scopes.length > 0 || brackets.length > 0)) {
    lines.push("");
  }

  if (scopes.length > 0) {
    lines.push("[");
    for (const scope of scopes) lines.push(`  (${scope})`);
    lines.push("] @rainbow.scope", "");
  }

  if (brackets.length > 0) {
    lines.push("[");
    for (const bracket of brackets) lines.push(`  ${JSON.stringify(bracket)}`);
    lines.push("] @rainbow.bracket", "");
  }

  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

/** Generates an optional tree-sitter injection query. */
export function generateTreeSitterInjectionsQuery(
  sourceOrGrammar: string | EbnfGrammar,
  options: {
    rootRule?: string;
    metadata?: TreeSitterMetadata;
    skipValidation?: boolean;
  } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  const rootRuleName = options.rootRule ?? grammar.rules[0]?.name ?? "module";
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateEbnfGrammar(grammar, {
      rootRule: rootRuleName,
      externals: metadata.externals,
    });
  }
  if (!options.skipValidation) {
    validateTreeSitterQueryMetadata(grammar, metadata, rootRuleName);
  }

  return generateTreeSitterInjectionsQueryFromMetadata(metadata);
}

function generateTreeSitterInjectionsQueryFromMetadata(
  metadata: TreeSitterMetadata,
): string {
  const injections = metadata.queries?.injections ?? [];
  if (injections.length === 0) return "";

  const blocks: string[] = [];
  for (const injection of injections) {
    if (isRawQueryEntry(injection)) {
      blocks.push(injection.pattern, "");
      continue;
    }
    blocks.push(
      `((${injection.node}) @injection.content`,
      `  (#set! injection.language ${JSON.stringify(injection.language)}))`,
      "",
    );
  }
  return `${blocks.join("\n").trimEnd()}\n`;
}

/** Generates a tree-sitter highlight query. */
export function generateTreeSitterHighlightsQuery(
  sourceOrGrammar: string | EbnfGrammar,
  options: {
    rootRule?: string;
    metadata?: TreeSitterMetadata;
    skipValidation?: boolean;
  } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  const rootRuleName = options.rootRule ?? grammar.rules[0]?.name ?? "module";
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateEbnfGrammar(grammar, {
      rootRule: rootRuleName,
      externals: metadata.externals,
    });
  }
  if (!options.skipValidation) {
    validateTreeSitterQueryMetadata(grammar, metadata, rootRuleName);
  }

  return generateTreeSitterHighlightsQueryFromPlan(
    createGrammarTreeSitterPlan(grammar, rootRuleName, metadata),
    metadata,
  );
}

function generateTreeSitterHighlightsQueryFromPlan(
  plan: TreeSitterPlan,
  metadata: TreeSitterMetadata,
): string {
  const explicit = resolveHighlightCaptureSelectors(
    metadata.queries?.highlights?.entries ?? [],
    plan,
  );
  const explicitSelectors = new Set(
    explicit.filter(isCaptureMetadata).map(captureSelectorKey),
  );
  for (
    const suppress of metadata.queries?.highlights?.defaults?.suppress ?? []
  ) {
    explicitSelectors.add(captureSelectorKey(suppress));
  }
  const lines = [
    ...renderCaptureQueryEntries(explicit),
    ...defaultHighlightQueryEntries(
      plan,
      explicitSelectors,
    ),
  ];
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

/** Collects non-fatal diagnostics for generated tree-sitter highlight queries. */
export function collectTreeSitterHighlightDiagnostics(
  sourceOrGrammar: string | EbnfGrammar,
  options: {
    rootRule?: string;
    metadata?: TreeSitterMetadata;
    skipValidation?: boolean;
  } = {},
): Diagnostic[] {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  const rootRuleName = options.rootRule ?? grammar.rules[0]?.name ?? "module";
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateEbnfGrammar(grammar, {
      rootRule: rootRuleName,
      externals: metadata.externals,
    });
  }
  if (!options.skipValidation) {
    validateTreeSitterQueryMetadata(grammar, metadata, rootRuleName);
  }
  return uncoveredSuppressedHighlightDiagnostics(
    createGrammarTreeSitterPlan(grammar, rootRuleName, metadata),
    metadata,
  );
}

/** Collects highlight-query diagnostics from shared compiler analysis. */
export function collectAnalyzedTreeSitterHighlightDiagnostics(
  analyzed: AnalyzedGrammar,
  options: {
    metadata?: TreeSitterMetadata;
  } = {},
): Diagnostic[] {
  return uncoveredSuppressedHighlightDiagnostics(
    createAnalyzedTreeSitterPlan(analyzed),
    options.metadata ?? {},
  );
}

/** Generates a metadata-driven tree-sitter locals query. */
export function generateTreeSitterLocalsQuery(
  sourceOrGrammar: string | EbnfGrammar,
  options: {
    rootRule?: string;
    metadata?: TreeSitterMetadata;
    skipValidation?: boolean;
  } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  const rootRuleName = options.rootRule ?? grammar.rules[0]?.name ?? "module";
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateEbnfGrammar(grammar, {
      rootRule: rootRuleName,
      externals: metadata.externals,
    });
  }
  if (!options.skipValidation) {
    validateTreeSitterQueryMetadata(grammar, metadata, rootRuleName);
  }
  return renderCaptureQuery(metadata.queries?.locals ?? []);
}

/** Generates a metadata-driven tree-sitter folds query. */
export function generateTreeSitterFoldsQuery(
  sourceOrGrammar: string | EbnfGrammar,
  options: {
    rootRule?: string;
    metadata?: TreeSitterMetadata;
    skipValidation?: boolean;
  } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  const rootRuleName = options.rootRule ?? grammar.rules[0]?.name ?? "module";
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateEbnfGrammar(grammar, {
      rootRule: rootRuleName,
      externals: metadata.externals,
    });
  }
  if (!options.skipValidation) {
    validateTreeSitterQueryMetadata(grammar, metadata, rootRuleName);
  }
  return renderCaptureQuery(metadata.queries?.folds ?? []);
}

/** Generates a metadata-driven tree-sitter indentation query. */
export function generateTreeSitterIndentsQuery(
  sourceOrGrammar: string | EbnfGrammar,
  options: {
    rootRule?: string;
    metadata?: TreeSitterMetadata;
    skipValidation?: boolean;
  } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  const rootRuleName = options.rootRule ?? grammar.rules[0]?.name ?? "module";
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateEbnfGrammar(grammar, {
      rootRule: rootRuleName,
      externals: metadata.externals,
    });
  }
  if (!options.skipValidation) {
    validateTreeSitterQueryMetadata(grammar, metadata, rootRuleName);
  }
  return renderCaptureQuery(metadata.queries?.indents ?? []);
}

/** Generates a metadata-driven tree-sitter tags query. */
export function generateTreeSitterTagsQuery(
  sourceOrGrammar: string | EbnfGrammar,
  options: {
    rootRule?: string;
    metadata?: TreeSitterMetadata;
    skipValidation?: boolean;
  } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  const rootRuleName = options.rootRule ?? grammar.rules[0]?.name ?? "module";
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateEbnfGrammar(grammar, {
      rootRule: rootRuleName,
      externals: metadata.externals,
    });
  }
  if (!options.skipValidation) {
    validateTreeSitterQueryMetadata(grammar, metadata, rootRuleName);
  }
  return renderCaptureQuery(metadata.queries?.tags ?? []);
}

/** Generates a metadata-driven tree-sitter textobjects query. */
export function generateTreeSitterTextobjectsQuery(
  sourceOrGrammar: string | EbnfGrammar,
  options: {
    rootRule?: string;
    metadata?: TreeSitterMetadata;
    skipValidation?: boolean;
  } = {},
): string {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  const rootRuleName = options.rootRule ?? grammar.rules[0]?.name ?? "module";
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateEbnfGrammar(grammar, {
      rootRule: rootRuleName,
      externals: metadata.externals,
    });
  }
  if (!options.skipValidation) {
    validateTreeSitterQueryMetadata(grammar, metadata, rootRuleName);
  }
  return renderCaptureQuery(metadata.queries?.textobjects ?? []);
}

/** Generates every Tree-sitter query file emitted by baba. */
export function generateTreeSitterQueries(
  sourceOrGrammar: string | EbnfGrammar,
  options: {
    rootRule?: string;
    metadata?: TreeSitterMetadata;
    skipValidation?: boolean;
  } = {},
): Record<string, string> {
  const grammar = typeof sourceOrGrammar === "string"
    ? parseEbnf(sourceOrGrammar)
    : sourceOrGrammar;
  const metadata = options.metadata;
  return {
    "highlights.scm": generateTreeSitterHighlightsQuery(grammar, {
      rootRule: options.rootRule,
      metadata,
      skipValidation: options.skipValidation,
    }),
    "locals.scm": generateTreeSitterLocalsQuery(grammar, {
      rootRule: options.rootRule,
      metadata,
      skipValidation: options.skipValidation,
    }),
    "folds.scm": generateTreeSitterFoldsQuery(grammar, {
      rootRule: options.rootRule,
      metadata,
      skipValidation: options.skipValidation,
    }),
    "indents.scm": generateTreeSitterIndentsQuery(grammar, {
      rootRule: options.rootRule,
      metadata,
      skipValidation: options.skipValidation,
    }),
    "tags.scm": generateTreeSitterTagsQuery(grammar, {
      rootRule: options.rootRule,
      metadata,
      skipValidation: options.skipValidation,
    }),
    "textobjects.scm": generateTreeSitterTextobjectsQuery(grammar, {
      rootRule: options.rootRule,
      metadata,
      skipValidation: options.skipValidation,
    }),
    "rainbows.scm": generateTreeSitterRainbowsQuery(grammar, {
      rootRule: options.rootRule,
      metadata,
      skipValidation: options.skipValidation,
    }),
    "injections.scm": generateTreeSitterInjectionsQuery(grammar, {
      rootRule: options.rootRule,
      metadata,
      skipValidation: options.skipValidation,
    }),
  };
}

/** Generates every Tree-sitter query file from shared compiler analysis. */
export function generateAnalyzedTreeSitterQueries(
  analyzed: AnalyzedGrammar,
  options: {
    metadata?: TreeSitterMetadata;
  } = {},
): Record<string, string> {
  const plan = createAnalyzedTreeSitterPlan(analyzed);
  const metadata = options.metadata ?? {};
  return {
    "highlights.scm": generateTreeSitterHighlightsQueryFromPlan(
      plan,
      metadata,
    ),
    "locals.scm": renderCaptureQuery(metadata.queries?.locals ?? []),
    "folds.scm": renderCaptureQuery(metadata.queries?.folds ?? []),
    "indents.scm": renderCaptureQuery(metadata.queries?.indents ?? []),
    "tags.scm": renderCaptureQuery(metadata.queries?.tags ?? []),
    "textobjects.scm": renderCaptureQuery(metadata.queries?.textobjects ?? []),
    "rainbows.scm": generateTreeSitterRainbowsQueryFromPlan(plan, metadata),
    "injections.scm": generateTreeSitterInjectionsQueryFromMetadata(metadata),
  };
}

function renderCaptureQuery(captures: TreeSitterCaptureQueryEntry[]): string {
  const lines = renderCaptureQueryEntries(captures);
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

function renderCaptureQueryEntries(
  captures: TreeSitterCaptureQueryEntry[],
): string[] {
  return captures.map((capture) => {
    if (isRawQueryEntry(capture)) return capture.pattern;
    if (capture.node) return `(${capture.node}) @${capture.capture}`;
    return `${JSON.stringify(capture.literal)} @${capture.capture}`;
  });
}

function captureSelectorKey(
  capture: TreeSitterCaptureSelectorMetadata,
): string {
  return capture.node ? `node:${capture.node}` : `literal:${capture.literal}`;
}

function resolveHighlightCaptureSelectors(
  captures: TreeSitterCaptureQueryEntry[],
  plan: TreeSitterPlan,
): TreeSitterCaptureQueryEntry[] {
  const anonymousLiterals = collectAnonymousLiteralTerminals(
    plan,
  );
  const singleLiteralRules = collectSingleLiteralRules(plan);
  return captures.map((capture) => {
    if (isRawQueryEntry(capture)) return capture;
    if (!capture.literal || anonymousLiterals.has(capture.literal)) {
      return capture;
    }
    const wrapper = singleLiteralRules.get(capture.literal);
    if (!wrapper) return capture;
    return { node: wrapper, capture: capture.capture };
  });
}

function isRawQueryEntry(
  entry: TreeSitterCaptureQueryEntry | TreeSitterInjectionQueryEntry,
): entry is { pattern: string } {
  return "pattern" in entry;
}

function isCaptureMetadata(
  entry: TreeSitterCaptureQueryEntry,
): entry is TreeSitterCaptureMetadata {
  return !isRawQueryEntry(entry);
}

function defaultHighlightQueryEntries(
  plan: TreeSitterPlan,
  explicitSelectors: Set<string>,
): string[] {
  const lines: string[] = [];
  const terminals = [...plan.reachableLiterals].sort();
  const namedLiteralTerminals = collectNamedLiteralRuleTerminals(plan);
  const pushLiteral = (literal: string, capture: string) => {
    if (explicitSelectors.has(`literal:${literal}`)) return;
    lines.push(`${JSON.stringify(literal)} @${capture}`);
  };

  for (const terminal of terminals) {
    if (namedLiteralTerminals.has(terminal)) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(terminal)) {
      pushLiteral(terminal, "keyword");
    }
  }

  const bracketLiterals = new Set(["(", ")", "[", "]", "{", "}"]);
  const delimiterLiterals = new Set([",", ";", ":", "."]);
  for (const terminal of terminals) {
    if (namedLiteralTerminals.has(terminal)) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(terminal)) continue;
    if (bracketLiterals.has(terminal)) {
      pushLiteral(terminal, "punctuation.bracket");
    } else if (delimiterLiterals.has(terminal)) {
      pushLiteral(terminal, "punctuation.delimiter");
    } else {
      pushLiteral(terminal, "operator");
    }
  }

  return lines;
}

function collectExpressionRefs(expression: TreeSitterExpression): string[] {
  const refs: string[] = [];
  collectExpressionRefsInto(expression, refs);
  return refs;
}

function sourceFileExpression(
  plan: TreeSitterPlan,
): TreeSitterExpression {
  return {
    kind: "ref",
    name: plan.rootRuleName,
    span: plan.rootRuleSpan,
  };
}

function collectReachableRuleNames(
  grammar: EbnfGrammar,
  rootRuleName: string,
): Set<string> {
  const rulesByName = new Map(grammar.rules.map((rule) => [rule.name, rule]));
  const reachable = new Set<string>();
  const queue = [rootRuleName];
  for (let index = 0; index < queue.length; index++) {
    const name = queue[index];
    if (reachable.has(name)) continue;
    const rule = rulesByName.get(name);
    if (!rule) continue;
    reachable.add(name);
    for (const ref of collectExpressionRefs(rule.expression)) {
      if (rulesByName.has(ref) && !reachable.has(ref)) queue.push(ref);
    }
  }
  return reachable;
}

function collectReachableRefs(
  grammar: EbnfGrammar,
  reachableRules: Set<string>,
): Set<string> {
  const refs = new Set<string>();
  for (const rule of grammar.rules) {
    if (!reachableRules.has(rule.name)) continue;
    for (const ref of collectExpressionRefs(rule.expression)) refs.add(ref);
  }
  return refs;
}

function collectExpressionRefsInto(
  expression: TreeSitterExpression,
  refs: string[],
): void {
  switch (expression.kind) {
    case "field":
      collectExpressionRefsInto(expression.expression, refs);
      return;
    case "ref":
      refs.push(expression.name);
      return;
    case "sequence":
      for (const item of expression.items) {
        collectExpressionRefsInto(item, refs);
      }
      return;
    case "choice":
      for (const option of expression.options) {
        collectExpressionRefsInto(option, refs);
      }
      return;
    case "optional":
    case "repeat":
    case "repeat1":
      collectExpressionRefsInto(expression.expression, refs);
      return;
    case "separated":
      collectExpressionRefsInto(expression.item, refs);
      collectExpressionRefsInto(expression.separator, refs);
      return;
    case "literal":
      return;
  }
}

function collectReachableTerminals(
  grammar: EbnfGrammar,
  reachableRules: Set<string>,
): string[] {
  const terminals = new Set<string>();
  for (const rule of grammar.rules) {
    if (!reachableRules.has(rule.name)) continue;
    collectLiteralTerminals(rule.expression, terminals);
  }
  return [...terminals].sort();
}

function collectNamedLiteralRuleTerminals(
  plan: TreeSitterPlan,
): Set<string> {
  const terminals = new Set<string>();
  for (const rule of plan.rules) {
    if (!plan.reachableRules.has(rule.name)) continue;
    collectLiteralOnlyExpressionTerminals(rule.expression, terminals);
  }
  return terminals;
}

function collectLiteralOnlyExpressionTerminals(
  expression: TreeSitterExpression,
  terminals: Set<string>,
): boolean {
  switch (expression.kind) {
    case "field":
      return collectLiteralOnlyExpressionTerminals(
        expression.expression,
        terminals,
      );
    case "literal":
      terminals.add(expression.value);
      return true;
    case "choice": {
      const optionTerminals = new Set<string>();
      for (const option of expression.options) {
        if (!collectLiteralOnlyExpressionTerminals(option, optionTerminals)) {
          return false;
        }
      }
      for (const terminal of optionTerminals) terminals.add(terminal);
      return true;
    }
    default:
      return false;
  }
}

function collectSingleLiteralRules(
  plan: TreeSitterPlan,
): Map<string, string> {
  const rules = new Map<string, string>();
  for (const rule of plan.rules) {
    if (!plan.reachableRules.has(rule.name)) continue;
    if (rule.expression.kind === "literal") {
      rules.set(rule.expression.value, rule.name);
    }
  }
  return rules;
}

function collectAnonymousLiteralTerminals(
  plan: TreeSitterPlan,
): Set<string> {
  const terminals = new Set<string>();
  for (const rule of plan.rules) {
    if (!plan.reachableRules.has(rule.name)) continue;
    if (rule.expression.kind === "literal") continue;
    collectLiteralTerminals(rule.expression, terminals);
  }
  return terminals;
}

function collectLiteralTerminals(
  expression: TreeSitterExpression,
  terminals: Set<string>,
): void {
  switch (expression.kind) {
    case "field":
      collectLiteralTerminals(expression.expression, terminals);
      return;
    case "literal":
      terminals.add(expression.value);
      return;
    case "sequence":
      for (const item of expression.items) {
        collectLiteralTerminals(item, terminals);
      }
      return;
    case "choice":
      for (const option of expression.options) {
        collectLiteralTerminals(option, terminals);
      }
      return;
    case "optional":
    case "repeat":
    case "repeat1":
      collectLiteralTerminals(expression.expression, terminals);
      return;
    case "separated":
      collectLiteralTerminals(expression.item, terminals);
      collectLiteralTerminals(expression.separator, terminals);
      return;
    case "ref":
      return;
  }
}

function validateTreeSitterMetadataSemantics(
  grammar: EbnfGrammar,
  rootRuleName: string,
  metadata?: TreeSitterMetadata,
): void {
  if (!metadata) return;
  const plan = createGrammarTreeSitterPlan(grammar, rootRuleName, metadata);
  const reachableRules = collectReachableRuleNames(grammar, rootRuleName);
  const symbolSets = collectGeneratedSymbolSets(
    grammar,
    metadata,
    rootRuleName,
  );
  const knownRules = collectGeneratedTreeSitterNodeNames(
    grammar,
    {},
    rootRuleName,
  );

  const seenAliasNodes = new Set<string>();
  for (const [ruleName, ruleMeta] of Object.entries(metadata.rules ?? {})) {
    const rulePath = `metadata.rules.${ruleName}`;
    if (ruleName !== "source_file" && !reachableRules.has(ruleName)) {
      treeSitterDiagnosticError(
        "METADATA_UNREACHABLE_RULE",
        `Metadata rule '${ruleName}' is unreachable from root rule '${rootRuleName}'`,
        { path: rulePath },
      );
    }
    for (const [path, pathMeta] of Object.entries(ruleMeta.paths ?? {})) {
      const metadataPath = `${rulePath}.paths.${path}`;
      const aliasName = pathMeta.alias_node;
      if (!aliasName) continue;
      if (
        knownRules.has(aliasName) || metadata.externals?.includes(aliasName)
      ) {
        treeSitterDiagnosticError(
          "METADATA_ALIAS_CONFLICT",
          `Rule '${ruleName}' path '${path}' alias_node '${aliasName}' conflicts with existing rule`,
          { path: metadataPath },
        );
      }
      if (seenAliasNodes.has(aliasName)) {
        treeSitterDiagnosticError(
          "METADATA_DUPLICATE_ALIAS",
          `Duplicate alias_node '${aliasName}' in tree-sitter metadata`,
          { path: metadataPath },
        );
      }
      seenAliasNodes.add(aliasName);
      knownRules.add(aliasName);
    }
  }

  for (const [index, external] of (metadata.externals ?? []).entries()) {
    if (!isValidSymbolName(external)) {
      treeSitterDiagnosticError(
        "METADATA_INVALID_EXTERNAL",
        `Invalid external token name '${external}'`,
        { path: `metadata.externals[${index}]` },
      );
    }
    if (knownRules.has(external)) {
      treeSitterDiagnosticError(
        "METADATA_EXTERNAL_CONFLICT",
        `External token '${external}' conflicts with existing rule`,
        { path: `metadata.externals[${index}]` },
      );
    }
  }

  if (metadata.word) {
    validateRuleRef(
      metadata.word,
      new Set([...symbolSets.tokens, ...symbolSets.externals]),
      "word token",
      "metadata.word",
    );
  }
  for (const [index, extra] of (metadata.extras ?? []).entries()) {
    validateExtra(extra, symbolSets.extraRules, `metadata.extras[${index}]`);
  }
  for (const [index, name] of (metadata.supertypes ?? []).entries()) {
    validateRuleRef(
      name,
      symbolSets.parserRules,
      "supertype",
      `metadata.supertypes[${index}]`,
    );
  }
  for (const [index, name] of (metadata.inline ?? []).entries()) {
    validateRuleRef(
      name,
      symbolSets.parserRules,
      "inline",
      `metadata.inline[${index}]`,
    );
  }
  for (
    const [conflictIndex, conflict] of (metadata.conflicts ?? [])
      .entries()
  ) {
    for (const [nameIndex, name] of conflict.entries()) {
      validateRuleRef(
        name,
        symbolSets.parserRules,
        "conflict",
        `metadata.conflicts[${conflictIndex}][${nameIndex}]`,
      );
    }
  }

  for (const [ruleName, ruleMeta] of Object.entries(metadata.rules ?? {})) {
    const rulePath = `metadata.rules.${ruleName}`;
    if (ruleMeta.wrap) {
      validateWrap(ruleMeta.wrap, ruleName, `${rulePath}.wrap`);
    }
    const expression = ruleName === "source_file"
      ? sourceFileExpression(plan)
      : grammar.rules.find((rule) => rule.name === ruleName)?.expression;
    if (!expression) {
      treeSitterDiagnosticError(
        "METADATA_UNKNOWN_RULE",
        `Missing grammar rule '${ruleName}' for metadata`,
        { path: rulePath },
      );
    }
    validateRuleMetadata(
      ruleMeta,
      expression,
      ruleName,
      metadata.version,
      rulePath,
    );
  }
}

/** Validates Tree-sitter backend metadata semantics against a parsed grammar. */
export function validateTreeSitterGenerationMetadataSemantics(
  grammar: EbnfGrammar,
  rootRuleName: string,
  metadata: TreeSitterMetadata = {},
): void {
  validateTreeSitterMetadataSemantics(grammar, rootRuleName, metadata);
  validateTreeSitterQueryMetadata(grammar, metadata, rootRuleName);
}

/** Validates all generation metadata semantics against a parsed grammar. */
export function validateGenerationMetadataSemantics(
  grammar: EbnfGrammar,
  rootRuleName: string,
  metadata: TreeSitterMetadata = {},
): void {
  validateTreeSitterGenerationMetadataSemantics(
    grammar,
    rootRuleName,
    metadata,
  );
}

function validateTreeSitterQueryMetadata(
  grammar: EbnfGrammar,
  metadata: TreeSitterMetadata,
  rootRuleName: string,
): void {
  const queries = metadata.queries;
  if (!queries) return;

  validateTreeSitterRainbowsMetadata(
    grammar,
    metadata,
    rootRuleName,
    queries.rainbows,
    "metadata.queries.rainbows",
  );
  validateTreeSitterInjectionsMetadata(
    grammar,
    metadata,
    rootRuleName,
    queries.injections,
    "metadata.queries.injections",
  );
  validateCaptureMetadata(
    grammar,
    metadata,
    rootRuleName,
    queries.highlights?.entries,
    "highlight",
    "metadata.queries.highlights.entries",
  );
  validateCaptureSelectorsMetadata(
    grammar,
    metadata,
    rootRuleName,
    queries.highlights?.defaults?.suppress,
    "highlight default suppression",
    "metadata.queries.highlights.defaults.suppress",
  );
  validateHighlightCoverageIgnoreMetadata(grammar, metadata, rootRuleName);
  validateCaptureMetadata(
    grammar,
    metadata,
    rootRuleName,
    queries.locals,
    "locals",
    "metadata.queries.locals",
  );
  validateCaptureMetadata(
    grammar,
    metadata,
    rootRuleName,
    queries.folds,
    "fold",
    "metadata.queries.folds",
  );
  validateCaptureMetadata(
    grammar,
    metadata,
    rootRuleName,
    queries.indents,
    "indent",
    "metadata.queries.indents",
  );
  validateCaptureMetadata(
    grammar,
    metadata,
    rootRuleName,
    queries.tags,
    "tag",
    "metadata.queries.tags",
  );
  validateCaptureMetadata(
    grammar,
    metadata,
    rootRuleName,
    queries.textobjects,
    "textobject",
    "metadata.queries.textobjects",
  );
}

function validateHighlightCoverageIgnoreMetadata(
  grammar: EbnfGrammar,
  metadata: TreeSitterMetadata,
  rootRuleName: string,
): void {
  const ignore = metadata.queries?.highlights?.defaults?.ignore;
  if (!ignore) return;
  validateCaptureSelectorsMetadata(
    grammar,
    metadata,
    rootRuleName,
    ignore,
    "highlight coverage ignore",
    "metadata.queries.highlights.defaults.ignore",
  );
  const knownNodes = collectGeneratedTreeSitterNodeNames(
    grammar,
    metadata,
    rootRuleName,
  );
  for (const [index, entry] of ignore.entries()) {
    if (!knownNodes.has(entry.parent)) {
      treeSitterDiagnosticError(
        "METADATA_UNKNOWN_QUERY_NODE",
        `Unknown highlight coverage ignore parent '${entry.parent}'`,
        {
          path: `metadata.queries.highlights.defaults.ignore[${index}].parent`,
        },
      );
    }
  }
}

function validateCaptureMetadata(
  grammar: EbnfGrammar,
  fullMetadata: TreeSitterMetadata,
  rootRuleName: string,
  metadata: TreeSitterCaptureQueryEntry[] | undefined,
  context: string,
  path: string,
): void {
  if (!metadata) return;

  const knownNodes = collectGeneratedTreeSitterNodeNames(
    grammar,
    fullMetadata,
    rootRuleName,
  );
  const terminals = new Set(
    collectReachableTerminals(
      grammar,
      collectReachableRuleNames(grammar, rootRuleName),
    ),
  );
  for (const [index, capture] of metadata.entries()) {
    const entryPath = `${path}[${index}]`;
    if (isRawQueryEntry(capture)) continue;
    if (capture.node && !knownNodes.has(capture.node)) {
      treeSitterDiagnosticError(
        "METADATA_UNKNOWN_QUERY_NODE",
        `Unknown ${context} capture node '${capture.node}'`,
        { path: `${entryPath}.node` },
      );
    }
    if (capture.literal && !terminals.has(capture.literal)) {
      treeSitterDiagnosticError(
        "METADATA_UNKNOWN_QUERY_LITERAL",
        `Unknown ${context} capture literal '${capture.literal}'`,
        { path: `${entryPath}.literal` },
      );
    }
  }
}

function validateCaptureSelectorsMetadata(
  grammar: EbnfGrammar,
  fullMetadata: TreeSitterMetadata,
  rootRuleName: string,
  metadata: TreeSitterCaptureSelectorMetadata[] | undefined,
  context: string,
  path: string,
): void {
  if (!metadata) return;

  const knownNodes = collectGeneratedTreeSitterNodeNames(
    grammar,
    fullMetadata,
    rootRuleName,
  );
  const terminals = new Set(
    collectReachableTerminals(
      grammar,
      collectReachableRuleNames(grammar, rootRuleName),
    ),
  );
  for (const [index, selector] of metadata.entries()) {
    const entryPath = `${path}[${index}]`;
    if (selector.node && !knownNodes.has(selector.node)) {
      treeSitterDiagnosticError(
        "METADATA_UNKNOWN_QUERY_NODE",
        `Unknown ${context} node '${selector.node}'`,
        { path: `${entryPath}.node` },
      );
    }
    if (selector.literal && !terminals.has(selector.literal)) {
      treeSitterDiagnosticError(
        "METADATA_UNKNOWN_QUERY_LITERAL",
        `Unknown ${context} literal '${selector.literal}'`,
        { path: `${entryPath}.literal` },
      );
    }
  }
}

function uncoveredSuppressedHighlightDiagnostics(
  plan: TreeSitterPlan,
  metadata: TreeSitterMetadata,
): Diagnostic[] {
  const suppress = metadata.queries?.highlights?.defaults?.suppress ?? [];
  if (suppress.length === 0) return [];

  const highlights = metadata.queries?.highlights?.entries ?? [];
  const globalCaptures = new Set<string>();
  for (const entry of highlights) {
    if (!isRawQueryEntry(entry)) {
      globalCaptures.add(captureSelectorKey(entry));
    }
  }

  const ignoredContexts = new Set(
    (metadata.queries?.highlights?.defaults?.ignore ?? []).map((ignore) =>
      `${ignore.parent}:${captureSelectorKey(ignore)}`
    ),
  );

  const diagnostics: Diagnostic[] = [];
  const contexts = collectSuppressedHighlightContexts(
    plan,
    suppress,
  );
  for (const context of contexts) {
    const selectorKey = captureSelectorKey(context.selector);
    if (globalCaptures.has(selectorKey)) continue;
    if (ignoredContexts.has(`${context.parent}:${selectorKey}`)) continue;
    const child = context.selector.node ??
      JSON.stringify(context.selector.literal);
    diagnostics.push({
      code: "QUERY_UNCAPTURED_CONTEXT",
      severity: "warning",
      backend: "tree-sitter",
      message:
        `highlight metadata suppresses ${child}, but ${child} appears under ${context.parent} with no explicit highlight capture.`,
    });
  }
  return diagnostics;
}

function collectSuppressedHighlightContexts(
  plan: TreeSitterPlan,
  suppress: TreeSitterCaptureSelectorMetadata[],
): Array<{ parent: string; selector: TreeSitterCaptureSelectorMetadata }> {
  const suppressedNodes = new Map(
    suppress.filter((selector) => selector.node).map((selector) => [
      selector.node,
      selector,
    ]),
  );
  const suppressedLiterals = new Map(
    suppress.filter((selector) => selector.literal).map((selector) => [
      selector.literal,
      selector,
    ]),
  );
  const contexts: Array<
    { parent: string; selector: TreeSitterCaptureSelectorMetadata }
  > = [];
  const seen = new Set<string>();
  for (const rule of plan.rules) {
    if (!plan.reachableRules.has(rule.name)) continue;
    collectSuppressedHighlightContextsInto(
      rule.expression,
      rule.name,
      suppressedNodes,
      suppressedLiterals,
      contexts,
      seen,
    );
  }
  return contexts.sort((left, right) =>
    left.parent.localeCompare(right.parent) ||
    captureSelectorKey(left.selector).localeCompare(
      captureSelectorKey(right.selector),
    )
  );
}

function collectSuppressedHighlightContextsInto(
  expression: TreeSitterExpression,
  parent: string,
  suppressedNodes: Map<string | undefined, TreeSitterCaptureSelectorMetadata>,
  suppressedLiterals: Map<
    string | undefined,
    TreeSitterCaptureSelectorMetadata
  >,
  contexts: Array<
    { parent: string; selector: TreeSitterCaptureSelectorMetadata }
  >,
  seen: Set<string>,
): void {
  if (expression.kind === "ref") {
    const selector = suppressedNodes.get(expression.name);
    if (selector) {
      pushSuppressedHighlightContext(parent, selector, contexts, seen);
    }
    return;
  }
  if (expression.kind === "literal") {
    const selector = suppressedLiterals.get(expression.value);
    if (selector) {
      pushSuppressedHighlightContext(parent, selector, contexts, seen);
    }
    return;
  }
  for (const child of expressionChildren(expression)) {
    collectSuppressedHighlightContextsInto(
      child,
      parent,
      suppressedNodes,
      suppressedLiterals,
      contexts,
      seen,
    );
  }
}

function pushSuppressedHighlightContext(
  parent: string,
  selector: TreeSitterCaptureSelectorMetadata,
  contexts: Array<
    { parent: string; selector: TreeSitterCaptureSelectorMetadata }
  >,
  seen: Set<string>,
): void {
  const key = `${parent}:${captureSelectorKey(selector)}`;
  if (seen.has(key)) return;
  seen.add(key);
  contexts.push({ parent, selector });
}

function expressionChildren(
  expression: TreeSitterExpression,
): TreeSitterExpression[] {
  switch (expression.kind) {
    case "field":
      return [expression.expression];
    case "sequence":
      return [...expression.items];
    case "choice":
      return [...expression.options];
    case "optional":
    case "repeat":
    case "repeat1":
      return [expression.expression];
    case "separated":
      return [expression.item, expression.separator];
    case "ref":
    case "literal":
      return [];
  }
}

function validateTreeSitterRainbowsMetadata(
  grammar: EbnfGrammar,
  fullMetadata: TreeSitterMetadata,
  rootRuleName: string,
  metadata?: TreeSitterRainbowsMetadata,
  path = "metadata.queries.rainbows",
): void {
  if (!metadata) return;

  const knownNodes = collectGeneratedTreeSitterNodeNames(
    grammar,
    fullMetadata,
    rootRuleName,
  );
  for (const [index, scope] of (metadata.scopes ?? []).entries()) {
    if (!knownNodes.has(scope)) {
      treeSitterDiagnosticError(
        "METADATA_UNKNOWN_QUERY_NODE",
        `Unknown rainbow scope node '${scope}'`,
        { path: `${path}.scopes[${index}]` },
      );
    }
  }

  const terminals = new Set(
    collectReachableTerminals(
      grammar,
      collectReachableRuleNames(grammar, rootRuleName),
    ),
  );
  for (const [index, bracket] of (metadata.brackets ?? []).entries()) {
    if (!terminals.has(bracket)) {
      treeSitterDiagnosticError(
        "METADATA_UNKNOWN_QUERY_LITERAL",
        `Unknown rainbow bracket literal '${bracket}'`,
        { path: `${path}.brackets[${index}]` },
      );
    }
  }
}

function validateTreeSitterInjectionsMetadata(
  grammar: EbnfGrammar,
  fullMetadata: TreeSitterMetadata,
  rootRuleName: string,
  metadata?: TreeSitterInjectionQueryEntry[],
  path = "metadata.queries.injections",
): void {
  if (!metadata) return;

  const knownNodes = collectGeneratedTreeSitterNodeNames(
    grammar,
    fullMetadata,
    rootRuleName,
  );
  for (const [index, injection] of metadata.entries()) {
    const entryPath = `${path}[${index}]`;
    if (isRawQueryEntry(injection)) continue;
    if (!knownNodes.has(injection.node)) {
      treeSitterDiagnosticError(
        "METADATA_UNKNOWN_QUERY_NODE",
        `Unknown injection node '${injection.node}'`,
        { path: `${entryPath}.node` },
      );
    }
    if (!/^[A-Za-z0-9_+-]+$/.test(injection.language)) {
      treeSitterDiagnosticError(
        "METADATA_INVALID_INJECTION_LANGUAGE",
        `Invalid injection language '${injection.language}'`,
        { path: `${entryPath}.language` },
      );
    }
  }
}

function collectGeneratedTreeSitterNodeNames(
  grammar: EbnfGrammar,
  metadata: TreeSitterMetadata,
  rootRuleName: string,
): Set<string> {
  const symbolSets = collectGeneratedSymbolSets(
    grammar,
    metadata,
    rootRuleName,
  );
  const names = new Set<string>([
    "source_file",
    ...symbolSets.parserRules,
    ...symbolSets.tokens,
    ...symbolSets.skips,
    ...symbolSets.externals,
  ]);
  const reachableRules = collectReachableRuleNames(grammar, rootRuleName);
  for (const [ruleName, ruleMeta] of Object.entries(metadata.rules ?? {})) {
    if (ruleName !== "source_file" && !reachableRules.has(ruleName)) {
      continue;
    }
    for (const pathMeta of Object.values(ruleMeta.paths ?? {})) {
      if (pathMeta.alias_node) names.add(pathMeta.alias_node);
      if (pathMeta.alias_ref) names.add(pathMeta.alias_ref);
    }
  }
  return names;
}

function collectGeneratedSymbolSets(
  grammar: EbnfGrammar,
  metadata: TreeSitterMetadata,
  rootRuleName: string,
): {
  parserRules: Set<string>;
  tokens: Set<string>;
  skips: Set<string>;
  externals: Set<string>;
  extraRules: Set<string>;
} {
  const reachableRules = collectReachableRuleNames(grammar, rootRuleName);
  const reachableRefs = collectReachableRefs(grammar, reachableRules);
  const parserRules = new Set(reachableRules);
  const tokens = new Set<string>();
  const skips = new Set<string>();
  const externals = new Set(metadata.externals ?? []);
  for (const token of grammar.tokens) {
    if (token.kind === "skip") {
      skips.add(token.name);
      continue;
    }
    if (reachableRefs.has(token.name)) tokens.add(token.name);
  }
  const extraRules = new Set([
    ...parserRules,
    ...tokens,
    ...skips,
    ...externals,
  ]);
  return { parserRules, tokens, skips, externals, extraRules };
}

function collectDefaultRainbowBrackets(
  plan: TreeSitterPlan,
): string[] {
  const terminals = plan.reachableLiterals;
  return ["(", ")", "[", "]", "{", "}"].filter((token) => terminals.has(token));
}

function validateExtra(
  extra: TreeSitterExtra,
  knownRules: Set<string>,
  path?: string,
): void {
  if (extra.kind === "regex") return;
  validateRuleRef(
    extra.name,
    knownRules,
    "extra",
    path ? `${path}.name` : path,
  );
}

function validateRuleRef(
  name: string,
  knownRules: Set<string>,
  context: string,
  path?: string,
): void {
  if (knownRules.has(name)) return;
  treeSitterDiagnosticError(
    "METADATA_UNKNOWN_REFERENCE",
    `Unknown ${context} rule '${name}'`,
    { path },
  );
}

function validateWrap(
  wrap: TreeSitterRuleWrap,
  ruleName: string,
  path?: string,
): void {
  if (wrap.kind === "prec.left" || wrap.kind === "prec.right") {
    if (wrap.value !== undefined && !Number.isInteger(wrap.value)) {
      treeSitterDiagnosticError(
        "METADATA_INVALID_PRECEDENCE",
        `Expected integer precedence for '${ruleName}'`,
        { path },
      );
    }
    return;
  }
  if (!Number.isInteger(wrap.value)) {
    treeSitterDiagnosticError(
      "METADATA_INVALID_PRECEDENCE",
      `Expected integer precedence for '${ruleName}'`,
      { path },
    );
  }
}

function resolveMetadataPathSelector(
  expression: TreeSitterExpression,
  selector: string,
  ruleName: string,
  metadataVersion?: TreeSitterMetadata["version"],
  metadataPath?: string,
): string {
  if (selector === "") return "";
  if (isLegacyNumericPath(selector)) {
    if (metadataVersion === 1) {
      treeSitterDiagnosticError(
        "METADATA_LEGACY_PATH",
        `Rule '${ruleName}' path '${selector}' uses legacy numeric metadata; use a named EBNF field`,
        { path: metadataPath },
      );
    }
    parsePathSegments(selector, ruleName, metadataPath);
    return selector;
  }

  const namedFieldPaths = collectNamedFieldPaths(expression);
  const matches = namedFieldPaths.get(selector) ?? [];
  if (matches.length === 0) {
    treeSitterDiagnosticError(
      "METADATA_UNKNOWN_FIELD_SELECTOR",
      `Unknown field selector '${selector}' on rule '${ruleName}'`,
      { path: metadataPath },
    );
  }
  if (matches.length > 1) {
    treeSitterDiagnosticError(
      "METADATA_AMBIGUOUS_FIELD_SELECTOR",
      `Field selector '${selector}' is ambiguous on rule '${ruleName}'`,
      { path: metadataPath },
    );
  }
  return matches[0];
}

function collectNamedFieldPaths(
  expression: TreeSitterExpression,
): Map<string, string[]> {
  const paths = new Map<string, string[]>();
  collectNamedFieldPathsInto(expression, [], paths);
  return paths;
}

function collectNamedFieldPathsInto(
  expression: TreeSitterExpression,
  path: number[],
  paths: Map<string, string[]>,
): void {
  switch (expression.kind) {
    case "field": {
      const childPath = [...path, 0];
      const current = paths.get(expression.name) ?? [];
      current.push(pathKey(childPath));
      paths.set(expression.name, current);
      collectNamedFieldPathsInto(expression.expression, childPath, paths);
      return;
    }
    case "sequence":
      expression.items.forEach((item, index) =>
        collectNamedFieldPathsInto(item, [...path, index], paths)
      );
      return;
    case "choice":
      expression.options.forEach((option, index) =>
        collectNamedFieldPathsInto(option, [...path, index], paths)
      );
      return;
    case "optional":
    case "repeat":
    case "repeat1":
      collectNamedFieldPathsInto(expression.expression, [...path, 0], paths);
      return;
    case "separated":
      collectNamedFieldPathsInto(expression.item, [...path, 0], paths);
      collectNamedFieldPathsInto(expression.separator, [...path, 1], paths);
      return;
    case "ref":
    case "literal":
      return;
  }
}

function isLegacyNumericPath(selector: string): boolean {
  return selector.split(".").every((segment) =>
    /^(0|[1-9][0-9]*)$/.test(
      segment,
    )
  );
}

function parsePathSegments(
  path: string,
  ruleName: string,
  metadataPath?: string,
): number[] {
  const segments = path.length === 0 ? [] : path.split(".").map((segment) => {
    const index = Number(segment);
    if (!Number.isInteger(index) || index < 0) {
      treeSitterDiagnosticError(
        "METADATA_INVALID_FIELD_PATH",
        `Invalid field path '${path}' on rule '${ruleName}'`,
        { path: metadataPath },
      );
    }
    return index;
  });
  return segments;
}

function resolveExpressionAtPath(
  expression: TreeSitterExpression,
  path: string,
  ruleName: string,
  metadataPath?: string,
): TreeSitterExpression {
  const segments = parsePathSegments(path, ruleName, metadataPath);
  return walkResolvedPath(expression, segments, path, ruleName, metadataPath);
}

function walkResolvedPath(
  expression: TreeSitterExpression,
  segments: number[],
  path: string,
  ruleName: string,
  metadataPath?: string,
): TreeSitterExpression {
  if (segments.length === 0) return expression;
  const [head, ...rest] = segments;
  switch (expression.kind) {
    case "field":
      if (head !== 0) {
        treeSitterDiagnosticError(
          "METADATA_FIELD_PATH_OUT_OF_BOUNDS",
          `Field path '${path}' is out of bounds on rule '${ruleName}'`,
          { path: metadataPath },
        );
      }
      return walkResolvedPath(
        expression.expression,
        rest,
        path,
        ruleName,
        metadataPath,
      );
    case "sequence":
      if (head >= expression.items.length) {
        treeSitterDiagnosticError(
          "METADATA_FIELD_PATH_OUT_OF_BOUNDS",
          `Field path '${path}' is out of bounds on rule '${ruleName}'`,
          { path: metadataPath },
        );
      }
      return walkResolvedPath(
        expression.items[head],
        rest,
        path,
        ruleName,
        metadataPath,
      );
    case "choice":
      if (head >= expression.options.length) {
        treeSitterDiagnosticError(
          "METADATA_FIELD_PATH_OUT_OF_BOUNDS",
          `Field path '${path}' is out of bounds on rule '${ruleName}'`,
          { path: metadataPath },
        );
      }
      return walkResolvedPath(
        expression.options[head],
        rest,
        path,
        ruleName,
        metadataPath,
      );
    case "optional":
    case "repeat":
    case "repeat1":
      if (head !== 0) {
        treeSitterDiagnosticError(
          "METADATA_FIELD_PATH_OUT_OF_BOUNDS",
          `Field path '${path}' is out of bounds on rule '${ruleName}'`,
          { path: metadataPath },
        );
      }
      return walkResolvedPath(
        expression.expression,
        rest,
        path,
        ruleName,
        metadataPath,
      );
    case "separated":
      if (head === 0) {
        return walkResolvedPath(
          expression.item,
          rest,
          path,
          ruleName,
          metadataPath,
        );
      }
      if (head === 1) {
        return walkResolvedPath(
          expression.separator,
          rest,
          path,
          ruleName,
          metadataPath,
        );
      }
      return treeSitterDiagnosticError(
        "METADATA_FIELD_PATH_OUT_OF_BOUNDS",
        `Field path '${path}' is out of bounds on rule '${ruleName}'`,
        { path: metadataPath },
      );
    case "ref":
    case "literal":
      treeSitterDiagnosticError(
        "METADATA_FIELD_PATH_LEAF",
        `Field path '${path}' descends through a leaf on rule '${ruleName}'`,
        { path: metadataPath },
      );
  }
}

function renderRuleExpression(
  ruleName: string,
  expression: TreeSitterExpression,
  metadata?: TreeSitterRuleMetadata,
  context?: RenderContext,
  inlineStack = new Set<string>(),
): string {
  const normalized = context?.normalizedRules.get(ruleName) ??
    normalizeRuleMetadata(
      metadata,
      expression,
      ruleName,
      context?.metadata.version,
    );
  const renderContext = context ?? {
    metadata: {},
    normalizedRules: new Map([[ruleName, normalized]]),
    ruleExpressions: new Map([[ruleName, expression]]),
    helperRules: new Map(),
  };
  const rendered = renderExpression(
    ruleName,
    expression,
    [],
    normalized,
    renderContext,
    inlineStack,
  );
  return applyToken(rendered, normalized.token);
}

function renderExpression(
  ruleName: string,
  expression: TreeSitterExpression,
  path: number[],
  metadata: NormalizedRuleMetadata,
  context: RenderContext,
  inlineStack: Set<string>,
): string {
  const rendered = renderRawExpression(
    ruleName,
    expression,
    path,
    metadata,
    context,
    inlineStack,
  );
  const pathMeta = metadata.paths.get(pathKey(path));
  if (expression.kind === "ref") {
    if (!pathMeta?.field) return rendered;
    return `field(${JSON.stringify(pathMeta.field)}, ${rendered})`;
  }
  const wrapped = applyWrap(rendered, pathMeta?.wrap);
  const aliased = applyNodeAlias(
    ruleName,
    pathKey(path),
    wrapped,
    pathMeta,
    context,
  );
  if (!pathMeta?.field) return aliased;
  return `field(${JSON.stringify(pathMeta.field)}, ${aliased})`;
}

function renderRawExpression(
  ruleName: string,
  expression: TreeSitterExpression,
  path: number[],
  metadata: NormalizedRuleMetadata,
  context: RenderContext,
  inlineStack: Set<string>,
): string {
  const pathMeta = metadata.paths.get(pathKey(path));
  switch (expression.kind) {
    case "field":
      return `field(${JSON.stringify(expression.name)}, ${
        renderExpression(
          ruleName,
          expression.expression,
          [...path, 0],
          metadata,
          context,
          inlineStack,
        )
      })`;
    case "ref":
      return renderRefExpression(
        ruleName,
        expression,
        pathMeta,
        context,
        inlineStack,
      );
    case "literal":
      return JSON.stringify(expression.value);
    case "sequence":
      if (expression.items.length === 0) return "seq()";
      return `seq(${
        expression.items.map((item, index) =>
          renderExpression(
            ruleName,
            item,
            [...path, index],
            metadata,
            context,
            inlineStack,
          )
        )
          .join(", ")
      })`;
    case "choice":
      return `choice(${
        expression.options.map((option, index) =>
          renderExpression(
            ruleName,
            option,
            [...path, index],
            metadata,
            context,
            inlineStack,
          )
        ).join(", ")
      })`;
    case "optional":
      return `optional(${
        renderExpression(
          ruleName,
          expression.expression,
          [...path, 0],
          metadata,
          context,
          inlineStack,
        )
      })`;
    case "repeat":
      return `repeat(${
        renderExpression(
          ruleName,
          expression.expression,
          [...path, 0],
          metadata,
          context,
          inlineStack,
        )
      })`;
    case "repeat1":
      return `repeat1(${
        renderExpression(
          ruleName,
          expression.expression,
          [...path, 0],
          metadata,
          context,
          inlineStack,
        )
      })`;
    case "separated":
      return `seq(${
        renderExpression(
          ruleName,
          expression.item,
          [...path, 0],
          metadata,
          context,
          inlineStack,
        )
      }, repeat(seq(${
        renderExpression(
          ruleName,
          expression.separator,
          [...path, 1],
          metadata,
          context,
          inlineStack,
        )
      }, ${
        renderExpression(
          ruleName,
          expression.item,
          [...path, 0],
          metadata,
          context,
          inlineStack,
        )
      })))`;
  }
}

function applyWrap(rendered: string, wrap?: TreeSitterRuleWrap): string {
  if (!wrap) return rendered;
  switch (wrap.kind) {
    case "prec":
      return `prec(${wrap.value}, ${rendered})`;
    case "prec.left":
      return wrap.value === undefined
        ? `prec.left(${rendered})`
        : `prec.left(${wrap.value}, ${rendered})`;
    case "prec.right":
      return wrap.value === undefined
        ? `prec.right(${rendered})`
        : `prec.right(${wrap.value}, ${rendered})`;
  }
}

function applyToken(rendered: string, token?: TreeSitterRuleToken): string {
  if (!token) return rendered;
  switch (token.kind) {
    case "token":
      return `token(${rendered})`;
    case "token.immediate":
      return `token.immediate(${rendered})`;
  }
}

function renderRefExpression(
  ruleName: string,
  expression: Extract<TreeSitterExpression, { kind: "ref" }>,
  pathMeta: TreeSitterPathMetadata | undefined,
  context: RenderContext,
  inlineStack: Set<string>,
): string {
  const refName = renderRuleRef(expression.name);

  if (pathMeta?.inline_path || pathMeta?.hidden_path) {
    const target = resolveRenderableRef(expression.name, context);
    if (inlineStack.has(expression.name)) {
      throw new Error(
        `Cannot inline recursive rule '${expression.name}' from '${ruleName}'`,
      );
    }
    const targetMeta = context.metadata.rules?.[expression.name];
    const nextStack = new Set(inlineStack);
    nextStack.add(expression.name);
    const inlined = renderRuleExpression(
      expression.name,
      target,
      targetMeta,
      context,
      nextStack,
    );
    return applyWrap(inlined, pathMeta?.wrap);
  }

  const aliased = pathMeta?.alias_ref
    ? `alias(${refName}, $.${pathMeta.alias_ref})`
    : refName;
  return applyWrap(aliased, pathMeta?.wrap);
}

function resolveRenderableRef(
  name: string,
  context: RenderContext,
): TreeSitterExpression {
  const target = context.ruleExpressions.get(name);
  if (!target) throw new Error(`Cannot inline unknown rule '${name}'`);
  return target;
}

function renderRuleRef(name: string): string {
  return `$.${name}`;
}

function applyNodeAlias(
  _ruleName: string,
  _path: string,
  rendered: string,
  pathMeta: TreeSitterPathMetadata | undefined,
  context: RenderContext,
): string {
  if (!pathMeta?.alias_node) return rendered;
  const helperName = pathMeta.alias_node;
  const existing = context.helperRules.get(helperName);
  if (existing && existing !== rendered) {
    throw new Error(`Conflicting helper rule '${helperName}'`);
  }
  context.helperRules.set(helperName, rendered);
  return `$.${helperName}`;
}

function renderExtra(extra: TreeSitterExtra): string {
  if (extra.kind === "rule") return `$.${extra.name}`;
  return formatRegexLiteral(extra.value);
}

function renderRuleRefArray(names: string[]): string {
  return `[${names.map((name) => `$.${name}`).join(", ")}]`;
}

interface NormalizedRuleMetadata {
  paths: Map<string, TreeSitterPathMetadata>;
  token?: TreeSitterRuleToken;
}

interface RenderContext {
  metadata: TreeSitterMetadata;
  normalizedRules: Map<string, NormalizedRuleMetadata>;
  ruleExpressions: Map<string, TreeSitterExpression>;
  helperRules: Map<string, string>;
}

function normalizeRuleMetadata(
  metadata?: TreeSitterRuleMetadata,
  expression?: TreeSitterExpression,
  ruleName?: string,
  metadataVersion?: TreeSitterMetadata["version"],
  metadataPath?: string,
): NormalizedRuleMetadata {
  const paths = new Map<string, TreeSitterPathMetadata>();
  if (!metadata) return { paths };

  for (const [path, field] of Object.entries(metadata.fields ?? {})) {
    const resolvedPath = expression && ruleName
      ? resolveMetadataPathSelector(
        expression,
        path,
        ruleName,
        metadataVersion,
        `${metadataPath ?? `metadata.rules.${ruleName}`}.fields.${path}`,
      )
      : path;
    mergePathMetadata(
      paths,
      resolvedPath,
      { field },
      ruleName ?? "<unknown>",
      `${metadataPath ?? `metadata.rules.${ruleName}`}.fields.${path}`,
    );
  }
  if (metadata.wrap) {
    mergePathMetadata(
      paths,
      "",
      { wrap: metadata.wrap },
      ruleName ?? "<unknown>",
      `${metadataPath ?? `metadata.rules.${ruleName}`}.wrap`,
    );
  }
  for (const [path, pathMeta] of Object.entries(metadata.paths ?? {})) {
    const resolvedPath = expression && ruleName
      ? resolveMetadataPathSelector(
        expression,
        path,
        ruleName,
        metadataVersion,
        `${metadataPath ?? `metadata.rules.${ruleName}`}.paths.${path}`,
      )
      : path;
    mergePathMetadata(
      paths,
      resolvedPath,
      pathMeta,
      ruleName ?? "<unknown>",
      `${metadataPath ?? `metadata.rules.${ruleName}`}.paths.${path}`,
    );
  }
  return { paths, token: metadata.token };
}

function mergePathMetadata(
  paths: Map<string, TreeSitterPathMetadata>,
  path: string,
  incoming: TreeSitterPathMetadata,
  ruleName: string,
  metadataPath?: string,
): void {
  const existing = paths.get(path) ?? {};
  if (
    existing.field && incoming.field &&
    existing.field !== incoming.field
  ) {
    treeSitterDiagnosticError(
      "METADATA_PATH_CONFLICT",
      `Conflicting field metadata on rule '${ruleName}' path '${path}'`,
      { path: metadataPath },
    );
  }
  paths.set(path, { ...existing, ...incoming });
}

function createRenderContext(
  rules: readonly TreeSitterRulePlan[],
  sourceFile: TreeSitterExpression,
  metadata: TreeSitterMetadata,
): RenderContext {
  const ruleExpressions = new Map<string, TreeSitterExpression>();
  for (const rule of rules) {
    ruleExpressions.set(rule.name, rule.expression);
  }
  ruleExpressions.set("source_file", sourceFile);

  const normalizedRules = new Map<string, NormalizedRuleMetadata>();
  for (const [ruleName, ruleMeta] of Object.entries(metadata.rules ?? {})) {
    const expression = ruleExpressions.get(ruleName);
    normalizedRules.set(
      ruleName,
      normalizeRuleMetadata(
        ruleMeta,
        expression,
        ruleName,
        metadata.version,
      ),
    );
  }
  if (!normalizedRules.has("source_file")) {
    if (metadata.rules?.source_file) {
      normalizedRules.set(
        "source_file",
        normalizeRuleMetadata(
          metadata.rules.source_file,
          ruleExpressions.get("source_file"),
          "source_file",
          metadata.version,
        ),
      );
    }
  }

  return { metadata, normalizedRules, ruleExpressions, helperRules: new Map() };
}

function collectInlineRules(metadata: TreeSitterMetadata): string[] {
  const inline = new Set(metadata.inline ?? []);
  for (const [ruleName, ruleMeta] of Object.entries(metadata.rules ?? {})) {
    if (ruleMeta.paths?.[""]?.hidden_path) inline.add(ruleName);
  }
  return [...inline];
}

function validateRuleMetadata(
  metadata: TreeSitterRuleMetadata,
  expression: TreeSitterExpression,
  ruleName: string,
  metadataVersion?: TreeSitterMetadata["version"],
  metadataPath = `metadata.rules.${ruleName}`,
): void {
  if (
    metadataVersion === 1 &&
    metadata.fields &&
    Object.keys(metadata.fields).length > 0
  ) {
    treeSitterDiagnosticError(
      "METADATA_LEGACY_FIELDS",
      `Rule '${ruleName}' uses legacy fields metadata; use named EBNF fields`,
      { path: `${metadataPath}.fields`, span: expression.span },
    );
  }
  if (metadata.token) {
    if (expression.kind !== "literal") {
      treeSitterDiagnosticError(
        "METADATA_INVALID_TOKEN_RULE",
        `Rule '${ruleName}' token metadata requires a literal rule`,
        { path: `${metadataPath}.token`, span: expression.span },
      );
    }
    if (
      metadata.wrap ||
      metadata.fields?.[""] ||
      Object.prototype.hasOwnProperty.call(metadata.paths ?? {}, "")
    ) {
      treeSitterDiagnosticError(
        "METADATA_TOKEN_PATH_CONFLICT",
        `Rule '${ruleName}' cannot combine token metadata with root path metadata`,
        { path: `${metadataPath}.token`, span: expression.span },
      );
    }
  }
  const normalized = normalizeRuleMetadata(
    metadata,
    expression,
    ruleName,
    metadataVersion,
    metadataPath,
  );
  for (const [path, pathMeta] of normalized.paths) {
    const metadataPathForPath = `${metadataPath}.paths.${path}`;
    const target = resolveExpressionAtPath(
      expression,
      path,
      ruleName,
      metadataPathForPath,
    );
    if (pathMeta.wrap) {
      validateWrap(
        pathMeta.wrap,
        `${ruleName}.${path || "<root>"}`,
        `${metadataPathForPath}.wrap`,
      );
    }
    if (pathMeta.alias_ref && !isValidSymbolName(pathMeta.alias_ref)) {
      treeSitterDiagnosticError(
        "METADATA_INVALID_ALIAS",
        `Invalid alias '${pathMeta.alias_ref}' on rule '${ruleName}'`,
        { path: `${metadataPathForPath}.alias_ref`, span: target.span },
      );
    }
    if (pathMeta.alias_node && !isValidSymbolName(pathMeta.alias_node)) {
      treeSitterDiagnosticError(
        "METADATA_INVALID_ALIAS",
        `Invalid alias '${pathMeta.alias_node}' on rule '${ruleName}'`,
        { path: `${metadataPathForPath}.alias_node`, span: target.span },
      );
    }
    if (pathMeta.alias_ref && pathMeta.alias_node) {
      treeSitterDiagnosticError(
        "METADATA_PATH_CONFLICT",
        `Rule '${ruleName}' path '${path}' cannot use both alias_ref and alias_node`,
        { path: metadataPathForPath, span: target.span },
      );
    }
    if (pathMeta.hidden_path && pathMeta.field) {
      treeSitterDiagnosticError(
        "METADATA_PATH_CONFLICT",
        `Rule '${ruleName}' path '${path}' cannot be both hidden and fielded`,
        { path: metadataPathForPath, span: target.span },
      );
    }
    if (pathMeta.hidden_path && (pathMeta.alias_ref || pathMeta.alias_node)) {
      treeSitterDiagnosticError(
        "METADATA_PATH_CONFLICT",
        `Rule '${ruleName}' path '${path}' cannot be both hidden and aliased`,
        { path: metadataPathForPath, span: target.span },
      );
    }
    if (pathMeta.inline_path && (pathMeta.alias_ref || pathMeta.alias_node)) {
      treeSitterDiagnosticError(
        "METADATA_PATH_CONFLICT",
        `Rule '${ruleName}' path '${path}' cannot inline and alias at same time`,
        { path: metadataPathForPath, span: target.span },
      );
    }
    if ((pathMeta.alias_ref || pathMeta.inline_path) && target.kind !== "ref") {
      treeSitterDiagnosticError(
        "METADATA_PATH_TARGET_MISMATCH",
        `Rule '${ruleName}' path '${path}' must target a ref`,
        { path: metadataPathForPath, span: target.span },
      );
    }
    if (pathMeta.alias_node && target.kind === "ref") {
      treeSitterDiagnosticError(
        "METADATA_PATH_TARGET_MISMATCH",
        `Rule '${ruleName}' path '${path}' must target a non-ref for alias_node`,
        { path: metadataPathForPath, span: target.span },
      );
    }
    if (pathMeta.hidden_path && path !== "" && target.kind !== "ref") {
      treeSitterDiagnosticError(
        "METADATA_PATH_TARGET_MISMATCH",
        `Rule '${ruleName}' path '${path}' must target a ref for hidden_path`,
        { path: metadataPathForPath, span: target.span },
      );
    }
  }
}

function isValidSymbolName(name: string): boolean {
  return /^[_A-Za-z$][_A-Za-z0-9$]*$/.test(name);
}

function formatRuleKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function formatRegexLiteral(pattern: string): string {
  let rendered = "";
  let backslashRun = 0;
  let inCharacterClass = false;
  for (const char of pattern) {
    const escaped = backslashRun % 2 === 1;
    if (char === "/" && !escaped && !inCharacterClass) {
      rendered += "\\/";
    } else {
      rendered += char;
    }

    if (char === "\\" && !escaped) {
      backslashRun++;
      continue;
    }
    if (char === "\\" && escaped) {
      backslashRun++;
      continue;
    }
    if (char === "[" && !escaped) inCharacterClass = true;
    if (char === "]" && !escaped) inCharacterClass = false;
    backslashRun = 0;
  }
  return `/${rendered}/`;
}

function renderTokenDeclaration(token: TreeSitterTokenPlan): string {
  const regex = formatRegexLiteral(token.pattern);
  const priority = token.priority ?? 0;
  const rendered = priority === 0 ? regex : `prec(${priority}, ${regex})`;
  if (token.kind === "token" || priority !== 0) return `token(${rendered})`;
  return rendered;
}

function pathKey(path: number[]): string {
  return path.join(".");
}

function visit(expression: TreeSitterExpression, terminals: Set<string>): void {
  switch (expression.kind) {
    case "field":
      visit(expression.expression, terminals);
      return;
    case "literal":
      terminals.add(expression.value);
      return;
    case "ref":
      return;
    case "sequence":
      for (const item of expression.items) visit(item, terminals);
      return;
    case "choice":
      for (const option of expression.options) visit(option, terminals);
      return;
    case "optional":
    case "repeat":
    case "repeat1":
      visit(expression.expression, terminals);
      return;
    case "separated":
      visit(expression.item, terminals);
      visit(expression.separator, terminals);
      return;
  }
}
