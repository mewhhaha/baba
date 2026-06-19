import type {
  Diagnostic,
  EbnfExpression,
  EbnfGrammar,
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
import { parseEbnf } from "./parser.ts";

const reservedGrammarRuleNames = new Set(["source_file"]);
const reservedTokenDeclarationNames = new Set(["source_file"]);

/** Validates grammar-level semantics before generation. */
export function validateEbnfGrammar(
  grammar: EbnfGrammar,
  options: { rootRule?: string } = {},
): void {
  const errors = collectGrammarDiagnostics(grammar, options).filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (errors.length > 0) {
    throw new Error(errors[0].message);
  }
}

/** Collects grammar-level semantic diagnostics without stopping at first error. */
export function collectGrammarDiagnostics(
  grammar: EbnfGrammar,
  options: { rootRule?: string } = {},
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (grammar.rules.length === 0) {
    diagnostics.push({
      code: "GRAMMAR_EMPTY",
      severity: "error",
      message: "Expected at least one grammar rule",
      span: grammar.span,
    });
    return diagnostics;
  }

  const declaredNames = new Set<string>();
  const tokenNames = new Set<string>();
  for (const token of grammar.tokens) {
    if (reservedTokenDeclarationNames.has(token.name)) {
      diagnostics.push({
        code: "RESERVED_GENERATED_NAME",
        severity: "error",
        message: `Token '${token.name}' uses reserved generated name`,
        span: token.span,
      });
    }
    if (declaredNames.has(token.name)) {
      diagnostics.push({
        code: "DUPLICATE_DECLARATION",
        severity: "error",
        message: `Duplicate declaration '${token.name}'`,
        span: token.span,
      });
    }
    try {
      const regex = new RegExp(token.pattern);
      if (regex.test("")) {
        throw new Error("must not match empty text");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push({
        code: "INVALID_TOKEN_REGEX",
        severity: "error",
        message: `Invalid regex for token '${token.name}': ${message}`,
        span: token.span,
      });
    }
    declaredNames.add(token.name);
    tokenNames.add(token.name);
  }

  const ruleNames = new Set<string>();
  for (const rule of grammar.rules) {
    if (reservedGrammarRuleNames.has(rule.name)) {
      diagnostics.push({
        code: "RESERVED_GENERATED_NAME",
        severity: "error",
        message: `Rule '${rule.name}' uses reserved generated name`,
        span: rule.span,
      });
    }
    if (ruleNames.has(rule.name)) {
      diagnostics.push({
        code: "DUPLICATE_RULE",
        severity: "error",
        message: `Duplicate rule '${rule.name}'`,
        span: rule.span,
      });
    }
    if (declaredNames.has(rule.name)) {
      diagnostics.push({
        code: "DUPLICATE_DECLARATION",
        severity: "error",
        message: `Duplicate declaration '${rule.name}'`,
        span: rule.span,
      });
    }
    declaredNames.add(rule.name);
    ruleNames.add(rule.name);
  }

  if (options.rootRule && !ruleNames.has(options.rootRule)) {
    diagnostics.push({
      code: "UNKNOWN_ROOT_RULE",
      severity: "error",
      message: `Unknown root rule '${options.rootRule}'`,
    });
    return diagnostics;
  }

  const rootRuleName = options.rootRule ?? grammar.rules[0]?.name;
  const reachableRuleNames = rootRuleName
    ? collectReachableRuleNames(grammar, rootRuleName)
    : new Set<string>();
  for (const rule of grammar.rules) {
    if (!reachableRuleNames.has(rule.name)) continue;
    visitRefExpressions(rule.expression, (ref) => {
      const name = ref.name;
      if (
        ruleNames.has(name) ||
        tokenNames.has(name)
      ) return;
      diagnostics.push({
        code: "UNKNOWN_RULE_REFERENCE",
        severity: "error",
        message: `Unknown rule reference '${name}' in rule '${rule.name}'`,
        span: ref.span,
      });
    });
  }
  return diagnostics;
}

/** Collects warnings for declarations omitted from the selected root graph. */
export function collectReachabilityDiagnostics(
  grammar: EbnfGrammar,
  rootRuleName: string,
): Diagnostic[] {
  const reachable = collectReachableRuleNames(grammar, rootRuleName);
  return grammar.rules
    .filter((rule) => !reachable.has(rule.name))
    .map((rule): Diagnostic => ({
      code: "UNREACHABLE_RULE",
      severity: "warning",
      backend: "tree-sitter",
      message:
        `Rule '${rule.name}' is unreachable from root rule '${rootRuleName}' and was omitted from generated outputs.`,
      span: rule.span,
    }));
}

/** Collects literal terminal strings referenced by grammar rules. */
export function collectTerminals(grammar: EbnfGrammar): string[] {
  const terminals = new Set<string>();
  for (const rule of grammar.rules) visit(rule.expression, terminals);
  return [...terminals].sort();
}

/** Validates capability limits specific to the tree-sitter backend. */
export function validateTreeSitterBackendCapabilities(
  grammar: EbnfGrammar,
): void {
  void grammar;
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
    validateEbnfGrammar(grammar, { rootRule: rootRuleName });
  }
  validateTreeSitterBackendCapabilities(grammar);
  const rootRule = grammar.rules.find((rule) => rule.name === rootRuleName);
  if (!rootRule) throw new Error(`Unknown root rule '${rootRuleName}'`);

  if (!options.skipValidation) {
    validateTreeSitterMetadataSemantics(
      grammar,
      rootRuleName,
      options.metadata,
    );
  }

  const metadata = options.metadata ?? {};
  const context = createRenderContext(grammar, rootRuleName, metadata);
  const sourceFileMeta = metadata.rules?.source_file ??
    metadata.rules?.[rootRuleName];
  const reachableRules = collectReachableRuleNames(grammar, rootRuleName);
  const reachableRefs = collectReachableRefs(grammar, reachableRules);
  const ruleLines = [
    `    source_file: $ => ${
      renderRuleExpression(
        "source_file",
        rootRule.expression,
        sourceFileMeta,
        context,
      )
    },`,
    ...grammar.rules
      .filter((rule) => reachableRules.has(rule.name))
      .map((rule) => {
        const rendered = renderRuleExpression(
          rule.name,
          rule.expression,
          metadata.rules?.[rule.name],
          context,
        );
        return `    ${formatRuleKey(rule.name)}: $ => ${rendered},`;
      }),
    ...grammar.tokens.filter((token) =>
      token.kind === "skip" || reachableRefs.has(token.name)
    ).map((token) => {
      const rendered = token.kind === "token"
        ? `token(${formatRegexLiteral(token.pattern)})`
        : formatRegexLiteral(token.pattern);
      return `    ${formatRuleKey(token.name)}: $ => ${rendered},`;
    }),
    ...[...context.helperRules.entries()].map(([name, rendered]) =>
      `    ${formatRuleKey(name)}: $ => ${rendered},`
    ),
  ];

  const headerLines = [
    `// Generated by @mewhhaha/baba. Do not edit by hand.`,
    "export default grammar({",
    `  name: ${JSON.stringify(name)},`,
    "",
  ];

  const extras = [
    ...(metadata.extras ?? []),
    ...grammar.tokens
      .filter((token) => token.kind === "skip")
      .map((token): TreeSitterExtra => ({ kind: "rule", name: token.name })),
  ];
  if (extras.length) {
    headerLines.push("  extras: $ => [");
    for (const extra of extras) {
      headerLines.push(`    ${renderExtra(extra)},`);
    }
    headerLines.push("  ],", "");
  }

  if (metadata.word) {
    headerLines.push(`  word: $ => $.${metadata.word},`, "");
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
  if (!options.skipValidation) {
    validateEbnfGrammar(grammar, { rootRule: rootRuleName });
  }
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateTreeSitterQueryMetadata(grammar, metadata, rootRuleName);
  }

  const rainbow = metadata.queries?.rainbows;
  const patterns = rainbow?.patterns ?? [];
  const scopes = rainbow?.scopes ?? [];
  const brackets = rainbow?.brackets ??
    collectDefaultRainbowBrackets(grammar, rootRuleName);
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
  if (!options.skipValidation) {
    validateEbnfGrammar(grammar, { rootRule: rootRuleName });
  }
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateTreeSitterQueryMetadata(grammar, metadata, rootRuleName);
  }

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
  if (!options.skipValidation) {
    validateEbnfGrammar(grammar, { rootRule: rootRuleName });
  }
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateTreeSitterQueryMetadata(grammar, metadata, rootRuleName);
  }

  const explicit = resolveHighlightCaptureSelectors(
    metadata.queries?.highlights?.entries ?? [],
    grammar,
    rootRuleName,
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
      grammar,
      metadata,
      explicitSelectors,
      rootRuleName,
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
  if (!options.skipValidation) {
    validateEbnfGrammar(grammar, { rootRule: rootRuleName });
  }
  const metadata = options.metadata ?? {};
  if (!options.skipValidation) {
    validateTreeSitterQueryMetadata(grammar, metadata, rootRuleName);
  }
  return uncoveredSuppressedHighlightDiagnostics(
    grammar,
    metadata,
    rootRuleName,
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
  if (!options.skipValidation) {
    validateEbnfGrammar(grammar, { rootRule: rootRuleName });
  }
  const metadata = options.metadata ?? {};
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
  if (!options.skipValidation) {
    validateEbnfGrammar(grammar, { rootRule: rootRuleName });
  }
  const metadata = options.metadata ?? {};
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
  if (!options.skipValidation) {
    validateEbnfGrammar(grammar, { rootRule: rootRuleName });
  }
  const metadata = options.metadata ?? {};
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
  if (!options.skipValidation) {
    validateEbnfGrammar(grammar, { rootRule: rootRuleName });
  }
  const metadata = options.metadata ?? {};
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
  if (!options.skipValidation) {
    validateEbnfGrammar(grammar, { rootRule: rootRuleName });
  }
  const metadata = options.metadata ?? {};
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
  grammar: EbnfGrammar,
  rootRuleName: string,
): TreeSitterCaptureQueryEntry[] {
  const reachable = collectReachableRuleNames(grammar, rootRuleName);
  const anonymousLiterals = collectAnonymousLiteralTerminals(
    grammar,
    reachable,
  );
  const singleLiteralRules = collectSingleLiteralRules(grammar, reachable);
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
  grammar: EbnfGrammar,
  metadata: TreeSitterMetadata,
  explicitSelectors: Set<string>,
  rootRuleName: string,
): string[] {
  const lines: string[] = [];
  const reachableRules = collectReachableRuleNames(grammar, rootRuleName);
  const terminals = collectReachableTerminals(grammar, reachableRules);
  const namedLiteralTerminals = collectNamedLiteralRuleTerminals(
    grammar,
    reachableRules,
  );
  const exposedNodes = collectExposedTreeSitterNodeNames(
    grammar,
    metadata,
    rootRuleName,
  );
  const pushNode = (node: string, capture: string) => {
    if (!exposedNodes.has(node) || explicitSelectors.has(`node:${node}`)) {
      return;
    }
    lines.push(`(${node}) @${capture}`);
  };
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

  for (const token of grammar.tokens) {
    if (token.kind !== "token") continue;
    const lowerName = token.name.toLowerCase();
    const capture = lowerName.includes("ident")
      ? "variable"
      : lowerName.includes("int") || lowerName.includes("number")
      ? "number"
      : lowerName.includes("string")
      ? "string"
      : lowerName.includes("comment")
      ? "comment"
      : "constant";
    pushNode(token.name, capture);
  }

  return lines;
}

function collectExposedTreeSitterNodeNames(
  grammar: EbnfGrammar,
  metadata: TreeSitterMetadata,
  rootRuleName: string,
): Set<string> {
  const names = new Set<string>(["source_file"]);
  const rulesByName = new Map(grammar.rules.map((rule) => [rule.name, rule]));
  const tokensByName = new Map(
    grammar.tokens.map((token) => [token.name, token]),
  );
  const reachableRules = collectReachableRuleNames(grammar, rootRuleName);
  const queue = [rootRuleName];

  for (let index = 0; index < queue.length; index++) {
    const name = queue[index];
    if (names.has(name)) continue;
    names.add(name);

    const rule = rulesByName.get(name);
    if (rule) {
      for (const ref of collectExpressionRefs(rule.expression)) {
        if (!names.has(ref)) queue.push(ref);
      }
      continue;
    }

    if (tokensByName.has(name)) {
      names.add(name);
    }
  }

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

function collectExpressionRefs(expression: EbnfExpression): string[] {
  const refs: string[] = [];
  collectExpressionRefsInto(expression, refs);
  return refs;
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
  expression: EbnfExpression,
  refs: string[],
): void {
  switch (expression.kind) {
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
  grammar: EbnfGrammar,
  reachableRules?: Set<string>,
): Set<string> {
  const terminals = new Set<string>();
  for (const rule of grammar.rules) {
    if (reachableRules && !reachableRules.has(rule.name)) continue;
    collectLiteralOnlyExpressionTerminals(rule.expression, terminals);
  }
  return terminals;
}

function collectLiteralOnlyExpressionTerminals(
  expression: EbnfExpression,
  terminals: Set<string>,
): boolean {
  switch (expression.kind) {
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
  grammar: EbnfGrammar,
  reachableRules?: Set<string>,
): Map<string, string> {
  const rules = new Map<string, string>();
  for (const rule of grammar.rules) {
    if (reachableRules && !reachableRules.has(rule.name)) continue;
    if (rule.expression.kind === "literal") {
      rules.set(rule.expression.value, rule.name);
    }
  }
  return rules;
}

function collectAnonymousLiteralTerminals(
  grammar: EbnfGrammar,
  reachableRules?: Set<string>,
): Set<string> {
  const terminals = new Set<string>();
  for (const rule of grammar.rules) {
    if (reachableRules && !reachableRules.has(rule.name)) continue;
    if (rule.expression.kind === "literal") continue;
    collectLiteralTerminals(rule.expression, terminals);
  }
  return terminals;
}

function collectLiteralTerminals(
  expression: EbnfExpression,
  terminals: Set<string>,
): void {
  switch (expression.kind) {
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
  const reachableRules = collectReachableRuleNames(grammar, rootRuleName);
  const knownRules = collectGeneratedTreeSitterNodeNames(
    grammar,
    {},
    rootRuleName,
  );

  const seenAliasNodes = new Set<string>();
  for (const [ruleName, ruleMeta] of Object.entries(metadata.rules ?? {})) {
    if (ruleName !== "source_file" && !reachableRules.has(ruleName)) {
      throw new Error(
        `Metadata rule '${ruleName}' is unreachable from root rule '${rootRuleName}'`,
      );
    }
    for (const [path, pathMeta] of Object.entries(ruleMeta.paths ?? {})) {
      const aliasName = pathMeta.alias_node;
      if (!aliasName) continue;
      if (knownRules.has(aliasName)) {
        throw new Error(
          `Rule '${ruleName}' path '${path}' alias_node '${aliasName}' conflicts with existing rule`,
        );
      }
      if (seenAliasNodes.has(aliasName)) {
        throw new Error(
          `Duplicate alias_node '${aliasName}' in tree-sitter metadata`,
        );
      }
      seenAliasNodes.add(aliasName);
      knownRules.add(aliasName);
    }
  }

  if (metadata.word) validateRuleRef(metadata.word, knownRules, "word");
  for (const extra of metadata.extras ?? []) validateExtra(extra, knownRules);
  for (const name of metadata.supertypes ?? []) {
    validateRuleRef(name, knownRules, "supertype");
  }
  for (const name of metadata.inline ?? []) {
    validateRuleRef(name, knownRules, "inline");
  }
  for (const conflict of metadata.conflicts ?? []) {
    for (const name of conflict) validateRuleRef(name, knownRules, "conflict");
  }

  for (const [ruleName, ruleMeta] of Object.entries(metadata.rules ?? {})) {
    if (ruleMeta.wrap) validateWrap(ruleMeta.wrap, ruleName);
    const expression = ruleName === "source_file"
      ? grammar.rules.find((rule) => rule.name === rootRuleName)?.expression
      : grammar.rules.find((rule) => rule.name === ruleName)?.expression;
    if (!expression) {
      throw new Error(`Missing grammar rule '${ruleName}' for metadata`);
    }
    for (const path of collectRulePaths(ruleMeta)) {
      validateFieldPath(expression, path, ruleName);
    }
    validateRuleMetadata(ruleMeta, expression, ruleName);
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
  );
  validateTreeSitterInjectionsMetadata(
    grammar,
    metadata,
    rootRuleName,
    queries.injections,
  );
  validateCaptureMetadata(
    grammar,
    metadata,
    rootRuleName,
    queries.highlights?.entries,
    "highlight",
  );
  validateCaptureSelectorsMetadata(
    grammar,
    metadata,
    rootRuleName,
    queries.highlights?.defaults?.suppress,
    "highlight default suppression",
  );
  validateHighlightCoverageIgnoreMetadata(grammar, metadata, rootRuleName);
  validateCaptureMetadata(
    grammar,
    metadata,
    rootRuleName,
    queries.locals,
    "locals",
  );
  validateCaptureMetadata(
    grammar,
    metadata,
    rootRuleName,
    queries.folds,
    "fold",
  );
  validateCaptureMetadata(
    grammar,
    metadata,
    rootRuleName,
    queries.indents,
    "indent",
  );
  validateCaptureMetadata(
    grammar,
    metadata,
    rootRuleName,
    queries.tags,
    "tag",
  );
  validateCaptureMetadata(
    grammar,
    metadata,
    rootRuleName,
    queries.textobjects,
    "textobject",
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
  );
  const knownNodes = collectGeneratedTreeSitterNodeNames(
    grammar,
    metadata,
    rootRuleName,
  );
  for (const entry of ignore) {
    if (!knownNodes.has(entry.parent)) {
      throw new Error(
        `Unknown highlight coverage ignore parent '${entry.parent}'`,
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
  for (const capture of metadata) {
    if (isRawQueryEntry(capture)) continue;
    if (capture.node && !knownNodes.has(capture.node)) {
      throw new Error(`Unknown ${context} capture node '${capture.node}'`);
    }
    if (capture.literal && !terminals.has(capture.literal)) {
      throw new Error(
        `Unknown ${context} capture literal '${capture.literal}'`,
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
  for (const selector of metadata) {
    if (selector.node && !knownNodes.has(selector.node)) {
      throw new Error(`Unknown ${context} node '${selector.node}'`);
    }
    if (selector.literal && !terminals.has(selector.literal)) {
      throw new Error(`Unknown ${context} literal '${selector.literal}'`);
    }
  }
}

function uncoveredSuppressedHighlightDiagnostics(
  grammar: EbnfGrammar,
  metadata: TreeSitterMetadata,
  rootRuleName: string,
): Diagnostic[] {
  const suppress = metadata.queries?.highlights?.defaults?.suppress ?? [];
  if (suppress.length === 0) return [];

  const highlights = metadata.queries?.highlights?.entries ?? [];
  const globalCaptures = new Set<string>();
  const rawPatterns: string[] = [];
  for (const entry of highlights) {
    if (isRawQueryEntry(entry)) {
      rawPatterns.push(entry.pattern);
    } else {
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
    grammar,
    suppress,
    rootRuleName,
  );
  for (const context of contexts) {
    const selectorKey = captureSelectorKey(context.selector);
    if (globalCaptures.has(selectorKey)) continue;
    if (ignoredContexts.has(`${context.parent}:${selectorKey}`)) continue;
    if (
      rawPatterns.some((pattern) =>
        rawHighlightPatternCapturesContext(
          pattern,
          context.parent,
          context.selector,
        )
      )
    ) {
      continue;
    }
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
  grammar: EbnfGrammar,
  suppress: TreeSitterCaptureSelectorMetadata[],
  rootRuleName: string,
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
  const reachable = collectReachableRuleNames(grammar, rootRuleName);
  for (const rule of grammar.rules) {
    if (!reachable.has(rule.name)) continue;
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
  expression: EbnfExpression,
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

function expressionChildren(expression: EbnfExpression): EbnfExpression[] {
  switch (expression.kind) {
    case "sequence":
      return expression.items;
    case "choice":
      return expression.options;
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

function rawHighlightPatternCapturesContext(
  pattern: string,
  parent: string,
  selector: TreeSitterCaptureSelectorMetadata,
): boolean {
  const child = selector.node
    ? `(${selector.node})`
    : JSON.stringify(selector.literal);
  const parentIndex = pattern.indexOf(`(${parent}`);
  if (parentIndex === -1) return false;
  const childIndex = pattern.indexOf(child, parentIndex);
  if (childIndex === -1) return false;
  return /@\w[\w.-]*/.test(pattern.slice(childIndex + child.length));
}

function validateTreeSitterRainbowsMetadata(
  grammar: EbnfGrammar,
  fullMetadata: TreeSitterMetadata,
  rootRuleName: string,
  metadata?: TreeSitterRainbowsMetadata,
): void {
  if (!metadata) return;

  const knownNodes = collectGeneratedTreeSitterNodeNames(
    grammar,
    fullMetadata,
    rootRuleName,
  );
  for (const scope of metadata.scopes ?? []) {
    if (!knownNodes.has(scope)) {
      throw new Error(`Unknown rainbow scope node '${scope}'`);
    }
  }

  const terminals = new Set(
    collectReachableTerminals(
      grammar,
      collectReachableRuleNames(grammar, rootRuleName),
    ),
  );
  for (const bracket of metadata.brackets ?? []) {
    if (!terminals.has(bracket)) {
      throw new Error(`Unknown rainbow bracket literal '${bracket}'`);
    }
  }
}

function validateTreeSitterInjectionsMetadata(
  grammar: EbnfGrammar,
  fullMetadata: TreeSitterMetadata,
  rootRuleName: string,
  metadata?: TreeSitterInjectionQueryEntry[],
): void {
  if (!metadata) return;

  const knownNodes = collectGeneratedTreeSitterNodeNames(
    grammar,
    fullMetadata,
    rootRuleName,
  );
  for (const injection of metadata) {
    if (isRawQueryEntry(injection)) continue;
    if (!knownNodes.has(injection.node)) {
      throw new Error(`Unknown injection node '${injection.node}'`);
    }
    if (!/^[A-Za-z0-9_+-]+$/.test(injection.language)) {
      throw new Error(`Invalid injection language '${injection.language}'`);
    }
  }
}

function collectGeneratedTreeSitterNodeNames(
  grammar: EbnfGrammar,
  metadata: TreeSitterMetadata,
  rootRuleName: string,
): Set<string> {
  const reachableRules = collectReachableRuleNames(grammar, rootRuleName);
  const reachableRefs = collectReachableRefs(grammar, reachableRules);
  const names = new Set<string>(["source_file"]);

  for (const rule of grammar.rules) {
    if (reachableRules.has(rule.name)) names.add(rule.name);
  }
  for (const token of grammar.tokens) {
    if (token.kind === "skip" || reachableRefs.has(token.name)) {
      names.add(token.name);
    }
  }
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

function collectDefaultRainbowBrackets(
  grammar: EbnfGrammar,
  rootRuleName: string,
): string[] {
  const terminals = new Set(
    collectReachableTerminals(
      grammar,
      collectReachableRuleNames(grammar, rootRuleName),
    ),
  );
  return ["(", ")", "[", "]", "{", "}"].filter((token) => terminals.has(token));
}

function validateExtra(extra: TreeSitterExtra, knownRules: Set<string>): void {
  if (extra.kind === "regex") return;
  validateRuleRef(extra.name, knownRules, "extra");
}

function validateRuleRef(
  name: string,
  knownRules: Set<string>,
  context: string,
): void {
  if (knownRules.has(name)) return;
  throw new Error(`Unknown ${context} rule '${name}'`);
}

function validateWrap(wrap: TreeSitterRuleWrap, ruleName: string): void {
  if (wrap.kind === "prec.left" || wrap.kind === "prec.right") {
    if (wrap.value !== undefined && !Number.isInteger(wrap.value)) {
      throw new Error(`Expected integer precedence for '${ruleName}'`);
    }
    return;
  }
  if (!Number.isInteger(wrap.value)) {
    throw new Error(`Expected integer precedence for '${ruleName}'`);
  }
}

function validateFieldPath(
  expression: EbnfExpression,
  path: string,
  ruleName: string,
): void {
  const segments = path.length === 0 ? [] : path.split(".").map((segment) => {
    const index = Number(segment);
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`Invalid field path '${path}' on rule '${ruleName}'`);
    }
    return index;
  });
  walkFieldPath(expression, segments, path, ruleName);
}

function walkFieldPath(
  expression: EbnfExpression,
  segments: number[],
  path: string,
  ruleName: string,
): void {
  if (segments.length === 0) return;
  const [head, ...rest] = segments;
  switch (expression.kind) {
    case "sequence":
      if (head >= expression.items.length) {
        throw new Error(
          `Field path '${path}' is out of bounds on rule '${ruleName}'`,
        );
      }
      walkFieldPath(expression.items[head], rest, path, ruleName);
      return;
    case "choice":
      if (head >= expression.options.length) {
        throw new Error(
          `Field path '${path}' is out of bounds on rule '${ruleName}'`,
        );
      }
      walkFieldPath(expression.options[head], rest, path, ruleName);
      return;
    case "optional":
    case "repeat":
    case "repeat1":
      if (head !== 0) {
        throw new Error(
          `Field path '${path}' is out of bounds on rule '${ruleName}'`,
        );
      }
      walkFieldPath(expression.expression, rest, path, ruleName);
      return;
    case "separated":
      if (head === 0) {
        walkFieldPath(expression.item, rest, path, ruleName);
        return;
      }
      if (head === 1) {
        walkFieldPath(expression.separator, rest, path, ruleName);
        return;
      }
      throw new Error(
        `Field path '${path}' is out of bounds on rule '${ruleName}'`,
      );
    case "ref":
    case "literal":
      throw new Error(
        `Field path '${path}' descends through a leaf on rule '${ruleName}'`,
      );
  }
}

function resolveExpressionAtPath(
  expression: EbnfExpression,
  path: string,
  ruleName: string,
): EbnfExpression {
  const segments = path.length === 0 ? [] : path.split(".").map((segment) => {
    const index = Number(segment);
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`Invalid field path '${path}' on rule '${ruleName}'`);
    }
    return index;
  });
  return walkResolvedPath(expression, segments, path, ruleName);
}

function walkResolvedPath(
  expression: EbnfExpression,
  segments: number[],
  path: string,
  ruleName: string,
): EbnfExpression {
  if (segments.length === 0) return expression;
  const [head, ...rest] = segments;
  switch (expression.kind) {
    case "sequence":
      if (head >= expression.items.length) {
        throw new Error(
          `Field path '${path}' is out of bounds on rule '${ruleName}'`,
        );
      }
      return walkResolvedPath(expression.items[head], rest, path, ruleName);
    case "choice":
      if (head >= expression.options.length) {
        throw new Error(
          `Field path '${path}' is out of bounds on rule '${ruleName}'`,
        );
      }
      return walkResolvedPath(expression.options[head], rest, path, ruleName);
    case "optional":
    case "repeat":
    case "repeat1":
      if (head !== 0) {
        throw new Error(
          `Field path '${path}' is out of bounds on rule '${ruleName}'`,
        );
      }
      return walkResolvedPath(expression.expression, rest, path, ruleName);
    case "separated":
      if (head === 0) {
        return walkResolvedPath(expression.item, rest, path, ruleName);
      }
      if (head === 1) {
        return walkResolvedPath(expression.separator, rest, path, ruleName);
      }
      throw new Error(
        `Field path '${path}' is out of bounds on rule '${ruleName}'`,
      );
    case "ref":
    case "literal":
      throw new Error(
        `Field path '${path}' descends through a leaf on rule '${ruleName}'`,
      );
  }
}

function renderRuleExpression(
  ruleName: string,
  expression: EbnfExpression,
  metadata?: TreeSitterRuleMetadata,
  context?: RenderContext,
  inlineStack = new Set<string>(),
): string {
  const normalized = context?.normalizedRules.get(ruleName) ??
    normalizeRuleMetadata(metadata);
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
  expression: EbnfExpression,
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
  expression: EbnfExpression,
  path: number[],
  metadata: NormalizedRuleMetadata,
  context: RenderContext,
  inlineStack: Set<string>,
): string {
  const pathMeta = metadata.paths.get(pathKey(path));
  switch (expression.kind) {
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
  expression: Extract<EbnfExpression, { kind: "ref" }>,
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
): EbnfExpression {
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
  ruleExpressions: Map<string, EbnfExpression>;
  helperRules: Map<string, string>;
}

function normalizeRuleMetadata(
  metadata?: TreeSitterRuleMetadata,
): NormalizedRuleMetadata {
  const paths = new Map<string, TreeSitterPathMetadata>();
  if (!metadata) return { paths };

  for (const [path, field] of Object.entries(metadata.fields ?? {})) {
    paths.set(path, { ...(paths.get(path) ?? {}), field });
  }
  if (metadata.wrap) {
    paths.set("", { ...(paths.get("") ?? {}), wrap: metadata.wrap });
  }
  for (const [path, pathMeta] of Object.entries(metadata.paths ?? {})) {
    paths.set(path, { ...(paths.get(path) ?? {}), ...pathMeta });
  }
  return { paths, token: metadata.token };
}

function createRenderContext(
  grammar: EbnfGrammar,
  rootRuleName: string,
  metadata: TreeSitterMetadata,
): RenderContext {
  const ruleExpressions = new Map<string, EbnfExpression>();
  for (const rule of grammar.rules) {
    ruleExpressions.set(rule.name, rule.expression);
  }
  ruleExpressions.set(
    "source_file",
    grammar.rules.find((rule) => rule.name === rootRuleName)!.expression,
  );

  const normalizedRules = new Map<string, NormalizedRuleMetadata>();
  for (const [ruleName, ruleMeta] of Object.entries(metadata.rules ?? {})) {
    normalizedRules.set(ruleName, normalizeRuleMetadata(ruleMeta));
  }
  if (!normalizedRules.has("source_file")) {
    const sourceFileMeta = metadata.rules?.source_file ??
      metadata.rules?.[rootRuleName];
    if (sourceFileMeta) {
      normalizedRules.set("source_file", normalizeRuleMetadata(sourceFileMeta));
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

function collectRulePaths(metadata: TreeSitterRuleMetadata): string[] {
  return [
    ...new Set([
      ...Object.keys(metadata.fields ?? {}),
      ...Object.keys(metadata.paths ?? {}),
    ]),
  ];
}

function validateRuleMetadata(
  metadata: TreeSitterRuleMetadata,
  expression: EbnfExpression,
  ruleName: string,
): void {
  if (metadata.token) {
    if (expression.kind !== "literal") {
      throw new Error(
        `Rule '${ruleName}' token metadata requires a literal rule`,
      );
    }
    if (
      metadata.wrap ||
      metadata.fields?.[""] ||
      Object.prototype.hasOwnProperty.call(metadata.paths ?? {}, "")
    ) {
      throw new Error(
        `Rule '${ruleName}' cannot combine token metadata with root path metadata`,
      );
    }
  }
  const fieldPaths = metadata.fields ?? {};
  for (const [path, pathMeta] of Object.entries(metadata.paths ?? {})) {
    const target = resolveExpressionAtPath(expression, path, ruleName);
    if (pathMeta.wrap) {
      validateWrap(pathMeta.wrap, `${ruleName}.${path || "<root>"}`);
    }
    if (pathMeta.alias_ref && !isValidAliasName(pathMeta.alias_ref)) {
      throw new Error(
        `Invalid alias '${pathMeta.alias_ref}' on rule '${ruleName}'`,
      );
    }
    if (pathMeta.alias_node && !isValidAliasName(pathMeta.alias_node)) {
      throw new Error(
        `Invalid alias '${pathMeta.alias_node}' on rule '${ruleName}'`,
      );
    }
    const fieldName = fieldPaths[path];
    if (fieldName && pathMeta.field && fieldName !== pathMeta.field) {
      throw new Error(
        `Conflicting field metadata on rule '${ruleName}' path '${path}'`,
      );
    }
    const mergedField = pathMeta.field ?? fieldName;
    if (pathMeta.alias_ref && pathMeta.alias_node) {
      throw new Error(
        `Rule '${ruleName}' path '${path}' cannot use both alias_ref and alias_node`,
      );
    }
    if (pathMeta.hidden_path && mergedField) {
      throw new Error(
        `Rule '${ruleName}' path '${path}' cannot be both hidden and fielded`,
      );
    }
    if (pathMeta.hidden_path && (pathMeta.alias_ref || pathMeta.alias_node)) {
      throw new Error(
        `Rule '${ruleName}' path '${path}' cannot be both hidden and aliased`,
      );
    }
    if (pathMeta.inline_path && (pathMeta.alias_ref || pathMeta.alias_node)) {
      throw new Error(
        `Rule '${ruleName}' path '${path}' cannot inline and alias at same time`,
      );
    }
    if ((pathMeta.alias_ref || pathMeta.inline_path) && target.kind !== "ref") {
      throw new Error(`Rule '${ruleName}' path '${path}' must target a ref`);
    }
    if (pathMeta.alias_node && target.kind === "ref") {
      throw new Error(
        `Rule '${ruleName}' path '${path}' must target a non-ref for alias_node`,
      );
    }
    if (pathMeta.hidden_path && path !== "" && target.kind !== "ref") {
      throw new Error(
        `Rule '${ruleName}' path '${path}' must target a ref for hidden_path`,
      );
    }
  }
}

function isValidAliasName(name: string): boolean {
  return /^[_A-Za-z$][_A-Za-z0-9$]*$/.test(name);
}

function formatRuleKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function formatRegexLiteral(pattern: string): string {
  return `/${pattern.replaceAll("/", "\\/")}/`;
}

function pathKey(path: number[]): string {
  return path.join(".");
}

function visit(expression: EbnfExpression, terminals: Set<string>): void {
  switch (expression.kind) {
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

function visitRefExpressions(
  expression: EbnfExpression,
  callback: (ref: Extract<EbnfExpression, { kind: "ref" }>) => void,
): void {
  switch (expression.kind) {
    case "ref":
      callback(expression);
      return;
    case "literal":
      return;
    case "sequence":
      for (const item of expression.items) visitRefExpressions(item, callback);
      return;
    case "choice":
      for (const option of expression.options) {
        visitRefExpressions(option, callback);
      }
      return;
    case "optional":
    case "repeat":
    case "repeat1":
      visitRefExpressions(expression.expression, callback);
      return;
    case "separated":
      visitRefExpressions(expression.item, callback);
      visitRefExpressions(expression.separator, callback);
      return;
  }
}
