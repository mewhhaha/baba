import type {
  BabaMetadata,
  GeneratedFile,
  SourceSpan,
  TreeSitterCaptureMetadata,
  TreeSitterCaptureQueryEntry,
  TreeSitterCaptureSelectorMetadata,
  TreeSitterInjectionQueryEntry,
} from "../ast.ts";
import type { AnalyzedExpression, AnalyzedGrammar } from "../compiler/ir.ts";

interface TreeSitterQueryPlan {
  readonly name: string;
  readonly rootRuleName: string;
  readonly rootRuleSpan: SourceSpan;
  readonly rules: readonly TreeSitterQueryRulePlan[];
  readonly tokens: readonly TreeSitterQueryTokenPlan[];
  readonly reachableRules: ReadonlySet<string>;
  readonly reachableTokens: ReadonlySet<string>;
  readonly reachableLiterals: ReadonlySet<string>;
}

interface TreeSitterQueryRulePlan {
  readonly name: string;
  readonly expression: AnalyzedExpression;
  readonly span: SourceSpan;
}

interface TreeSitterQueryTokenPlan {
  readonly name: string;
  readonly kind: "token" | "skip" | "contextual";
  readonly span: SourceSpan;
}

const treeSitterQueryOutputs: Array<
  readonly [outputPath: string, queryName: string]
> = [
  ["queries/generated-highlights.scm", "highlights.scm"],
  ["queries/generated-locals.scm", "locals.scm"],
  ["queries/generated-folds.scm", "folds.scm"],
  ["queries/generated-indents.scm", "indents.scm"],
  ["queries/generated-tags.scm", "tags.scm"],
  ["queries/generated-textobjects.scm", "textobjects.scm"],
  ["queries/generated-rainbows.scm", "rainbows.scm"],
  ["queries/generated-injections.scm", "injections.scm"],
];

export function emitTreeSitterQueryFiles(
  analyzed: AnalyzedGrammar,
  metadata: BabaMetadata,
): GeneratedFile[] {
  const queries = generateAnalyzedTreeSitterQueries(analyzed, metadata);
  const files: GeneratedFile[] = [];
  for (const [path, name] of treeSitterQueryOutputs) {
    const content = queries[name];
    if (content === undefined) {
      throw new Error(`Tree-sitter query output '${name}' is missing.`);
    }
    if (content.length === 0) {
      continue;
    }
    files.push({
      path,
      content,
      kind: "query",
      encoding: "utf-8",
    });
  }
  return files;
}

export function generateAnalyzedTreeSitterQueries(
  analyzed: AnalyzedGrammar,
  metadata: BabaMetadata,
): Record<string, string> {
  const plan = createAnalyzedQueryPlan(analyzed);
  const queries = metadata.queries;
  let locals: readonly TreeSitterCaptureQueryEntry[] = [];
  let folds: readonly TreeSitterCaptureQueryEntry[] = [];
  let indents: readonly TreeSitterCaptureQueryEntry[] = [];
  let tags: readonly TreeSitterCaptureQueryEntry[] = [];
  let textobjects: readonly TreeSitterCaptureQueryEntry[] = [];
  if (queries !== undefined) {
    if (queries.locals !== undefined) {
      locals = queries.locals;
    }
    if (queries.folds !== undefined) {
      folds = queries.folds;
    }
    if (queries.indents !== undefined) {
      indents = queries.indents;
    }
    if (queries.tags !== undefined) {
      tags = queries.tags;
    }
    if (queries.textobjects !== undefined) {
      textobjects = queries.textobjects;
    }
  }
  return {
    "highlights.scm": generateHighlightsQuery(plan, metadata),
    "locals.scm": renderCaptureQuery(locals),
    "folds.scm": renderCaptureQuery(folds),
    "indents.scm": renderCaptureQuery(indents),
    "tags.scm": renderCaptureQuery(tags),
    "textobjects.scm": renderCaptureQuery(textobjects),
    "rainbows.scm": generateRainbowsQuery(plan, metadata),
    "injections.scm": generateInjectionsQuery(metadata),
  };
}

function createAnalyzedQueryPlan(
  analyzed: AnalyzedGrammar,
): TreeSitterQueryPlan {
  const rootRule = analyzed.rules[analyzed.rootRule];
  if (rootRule === undefined) {
    throw new Error("Tree-sitter query generation requires a root rule.");
  }

  const reachableRules = new Set<string>();
  for (const ruleId of analyzed.reachableRules) {
    const rule = analyzed.rules[ruleId];
    if (rule === undefined) {
      throw new Error("Tree-sitter query generation found an unknown rule.");
    }
    reachableRules.add(rule.name);
  }

  const reachableTokens = new Set<string>();
  for (const tokenId of analyzed.reachableTokens) {
    const token = analyzed.tokens[tokenId];
    if (token === undefined) {
      throw new Error("Tree-sitter query generation found an unknown token.");
    }
    reachableTokens.add(token.name);
  }

  const reachableLiterals = new Set<string>();
  for (const literalId of analyzed.reachableLiterals) {
    const literal = analyzed.literals[literalId];
    if (literal === undefined) {
      throw new Error("Tree-sitter query generation found an unknown literal.");
    }
    reachableLiterals.add(literal.value);
  }

  return {
    name: analyzed.name,
    rootRuleName: rootRule.name,
    rootRuleSpan: rootRule.span,
    rules: analyzed.rules.map((rule) => ({
      name: rule.name,
      expression: rule.expression,
      span: rule.span,
    })),
    tokens: analyzed.tokens.map((token) => ({
      name: token.name,
      kind: token.kind,
      span: token.span,
    })),
    reachableRules,
    reachableTokens,
    reachableLiterals,
  };
}

function generateHighlightsQuery(
  plan: TreeSitterQueryPlan,
  metadata: BabaMetadata,
): string {
  const highlightMetadata = metadata.queries?.highlights;
  let explicitEntries: TreeSitterCaptureQueryEntry[] = [];
  let suppress: TreeSitterCaptureSelectorMetadata[] = [];
  let mode: "rich" | "minimal" = "rich";
  if (highlightMetadata !== undefined) {
    explicitEntries = highlightMetadata.entries;
    if (highlightMetadata.defaults !== undefined) {
      if (highlightMetadata.defaults.suppress !== undefined) {
        suppress = highlightMetadata.defaults.suppress;
      }
      if (highlightMetadata.defaults.mode !== undefined) {
        mode = highlightMetadata.defaults.mode;
      }
    }
  }

  const explicit = resolveHighlightCaptureSelectors(explicitEntries, plan);
  const explicitSelectors = new Set<string>();
  for (const entry of explicit) {
    if (isCaptureMetadata(entry)) {
      explicitSelectors.add(captureSelectorKey(entry));
    }
  }

  const lines = [
    ...renderCaptureQueryEntries(explicit),
    ...renderCaptureQueryEntries(
      defaultHighlightQueryEntries(plan, {
        explicitSelectors,
        suppress,
        mode,
      }),
    ),
  ];
  if (lines.length === 0) {
    return "";
  }
  return `${lines.join("\n")}\n`;
}

function generateRainbowsQuery(
  plan: TreeSitterQueryPlan,
  metadata: BabaMetadata,
): string {
  const rainbow = metadata.queries?.rainbows;
  let patterns: readonly string[] = [];
  let scopes: readonly string[] = [];
  let brackets = collectDefaultRainbowBrackets(plan);
  if (rainbow !== undefined) {
    if (rainbow.patterns !== undefined) {
      patterns = rainbow.patterns;
    }
    if (rainbow.scopes !== undefined) {
      scopes = rainbow.scopes;
    }
    if (rainbow.brackets !== undefined) {
      brackets = rainbow.brackets;
    }
  }

  const lines: string[] = [...patterns];
  if (patterns.length > 0 && (scopes.length > 0 || brackets.length > 0)) {
    lines.push("");
  }

  if (scopes.length > 0) {
    lines.push("[");
    for (const scope of scopes) {
      lines.push(`  (${scope})`);
    }
    lines.push("] @rainbow.scope", "");
  }

  if (brackets.length > 0) {
    lines.push("[");
    for (const bracket of brackets) {
      lines.push(`  ${JSON.stringify(bracket)}`);
    }
    lines.push("] @rainbow.bracket", "");
  }

  if (lines.length === 0) {
    return "";
  }
  return `${lines.join("\n")}\n`;
}

function generateInjectionsQuery(metadata: BabaMetadata): string {
  let injections: readonly TreeSitterInjectionQueryEntry[] = [];
  if (
    metadata.queries !== undefined &&
    metadata.queries.injections !== undefined
  ) {
    injections = metadata.queries.injections;
  }
  if (injections.length === 0) {
    return "";
  }

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

function renderCaptureQuery(captures: readonly TreeSitterCaptureQueryEntry[]) {
  const lines = renderCaptureQueryEntries(captures);
  if (lines.length === 0) {
    return "";
  }
  return `${lines.join("\n")}\n`;
}

function renderCaptureQueryEntries(
  captures: readonly TreeSitterCaptureQueryEntry[],
): string[] {
  return captures.map((capture) => {
    if (isRawQueryEntry(capture)) {
      return capture.pattern;
    }
    return renderCaptureMetadata(capture);
  });
}

function renderCaptureMetadata(capture: TreeSitterCaptureMetadata): string {
  let child: string;
  if (capture.node !== undefined) {
    child = `(${capture.node}) @${capture.capture}`;
  } else {
    if (capture.literal === undefined) {
      throw new Error("Tree-sitter capture metadata is missing a literal.");
    }
    child = `${JSON.stringify(capture.literal)} @${capture.capture}`;
  }
  if (capture.parent === undefined) {
    return child;
  }
  let field = "";
  if (capture.field !== undefined) {
    field = `${capture.field}: `;
  }
  return `(${capture.parent} ${field}${child})`;
}

function captureSelectorKey(
  capture: TreeSitterCaptureSelectorMetadata,
): string {
  let child: string;
  if (capture.node !== undefined) {
    child = `node:${capture.node}`;
  } else {
    child = `literal:${capture.literal}`;
  }
  let parent = "parent:*";
  if (capture.parent !== undefined) {
    parent = `parent:${capture.parent}`;
  }
  let field = "field:*";
  if (capture.field !== undefined) {
    field = `field:${capture.field}`;
  }
  return [parent, field, child].join("/");
}

function captureChildSelectorKey(
  capture: TreeSitterCaptureSelectorMetadata,
): string {
  if (capture.node !== undefined) {
    return `node:${capture.node}`;
  }
  return `literal:${capture.literal}`;
}

function matchesCaptureSelector(
  selector: TreeSitterCaptureSelectorMetadata,
  candidate: TreeSitterCaptureSelectorMetadata,
): boolean {
  if (
    captureChildSelectorKey(selector) !== captureChildSelectorKey(candidate)
  ) {
    return false;
  }
  if (selector.parent !== undefined && selector.parent !== candidate.parent) {
    return false;
  }
  if (selector.field !== undefined && selector.field !== candidate.field) {
    return false;
  }
  return true;
}

function resolveHighlightCaptureSelectors(
  captures: readonly TreeSitterCaptureQueryEntry[],
  plan: TreeSitterQueryPlan,
): TreeSitterCaptureQueryEntry[] {
  const anonymousLiterals = collectAnonymousLiteralTerminals(plan);
  const singleLiteralRules = collectSingleLiteralRules(plan);
  return captures.map((capture) => {
    if (isRawQueryEntry(capture)) {
      return capture;
    }
    if (
      capture.literal === undefined || anonymousLiterals.has(capture.literal)
    ) {
      return capture;
    }
    const wrapper = singleLiteralRules.get(capture.literal);
    if (wrapper === undefined) {
      return capture;
    }
    return {
      parent: capture.parent,
      field: capture.field,
      node: wrapper,
      capture: capture.capture,
    };
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
  if (isRawQueryEntry(entry)) {
    return false;
  }
  return true;
}

function defaultHighlightQueryEntries(
  plan: TreeSitterQueryPlan,
  options: {
    explicitSelectors: Set<string>;
    suppress: TreeSitterCaptureSelectorMetadata[];
    mode: "rich" | "minimal";
  },
): TreeSitterCaptureMetadata[] {
  const entries: TreeSitterCaptureMetadata[] = [];
  const seen = new Set<string>();
  const pushEntry = (entry: TreeSitterCaptureMetadata) => {
    if (shouldSkipDefaultHighlightEntry(entry, options)) {
      return;
    }
    const key = captureSelectorKey(entry);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    entries.push(entry);
  };

  if (options.mode === "minimal") {
    pushMinimalDefaultHighlightEntries(plan, pushEntry);
  } else {
    pushRichLiteralDefaultHighlightEntries(plan, pushEntry);
    pushRichDefaultHighlightEntries(plan, pushEntry);
  }
  return entries;
}

function shouldSkipDefaultHighlightEntry(
  entry: TreeSitterCaptureMetadata,
  options: {
    explicitSelectors: Set<string>;
    suppress: TreeSitterCaptureSelectorMetadata[];
  },
): boolean {
  if (options.explicitSelectors.has(captureSelectorKey(entry))) {
    return true;
  }
  return options.suppress.some((selector) =>
    matchesCaptureSelector(selector, entry)
  );
}

function pushMinimalDefaultHighlightEntries(
  plan: TreeSitterQueryPlan,
  push: (entry: TreeSitterCaptureMetadata) => void,
): void {
  const terminals = [...plan.reachableLiterals].sort();
  const namedLiteralTerminals = collectNamedLiteralRuleTerminals(plan);

  for (const terminal of terminals) {
    if (namedLiteralTerminals.has(terminal)) {
      continue;
    }
    const capture = defaultLiteralHighlightCapture(terminal);
    if (capture !== undefined) {
      push({ literal: terminal, capture });
    }
  }
}

function pushRichLiteralDefaultHighlightEntries(
  plan: TreeSitterQueryPlan,
  push: (entry: TreeSitterCaptureMetadata) => void,
): void {
  const namedLiteralTerminals = collectNamedLiteralRuleTerminals(plan);
  for (const terminal of [...plan.reachableLiterals].sort()) {
    if (namedLiteralTerminals.has(terminal)) {
      continue;
    }
    const capture = defaultLiteralHighlightCapture(terminal);
    if (capture === undefined) {
      continue;
    }
    if (isWordLikeLiteral(terminal)) {
      continue;
    }
    push({ literal: terminal, capture });
  }

  for (const entry of inferContextualLiteralHighlightEntries(plan)) {
    if (
      entry.literal !== undefined && namedLiteralTerminals.has(entry.literal)
    ) {
      continue;
    }
    push(entry);
  }
}

function defaultLiteralHighlightCapture(literal: string): string | undefined {
  if (isWordLikeLiteral(literal)) {
    return "keyword";
  }
  const bracketLiterals = new Set(["(", ")", "[", "]", "{", "}"]);
  const delimiterLiterals = new Set([",", ";", ":", "."]);
  if (bracketLiterals.has(literal)) {
    return "punctuation.bracket";
  }
  if (delimiterLiterals.has(literal)) {
    return "punctuation.delimiter";
  }
  return "operator";
}

function isWordLikeLiteral(literal: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(literal);
}

function inferContextualLiteralHighlightEntries(
  plan: TreeSitterQueryPlan,
): TreeSitterCaptureMetadata[] {
  const entries: TreeSitterCaptureMetadata[] = [];
  const seen = new Set<string>();
  const push = (
    parent: string,
    field: string | undefined,
    literal: string,
    capture: string,
  ) => {
    const entry: TreeSitterCaptureMetadata = {
      parent,
      field,
      literal,
      capture,
    };
    const key = captureSelectorKey(entry);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    entries.push(entry);
  };

  for (const rule of plan.rules) {
    if (!plan.reachableRules.has(rule.name)) {
      continue;
    }
    collectContextualLiteralHighlightEntries(
      rule.expression,
      rule.name,
      undefined,
      push,
    );
  }
  return entries.sort((left, right) =>
    captureSelectorKey(left).localeCompare(captureSelectorKey(right))
  );
}

function collectContextualLiteralHighlightEntries(
  expression: AnalyzedExpression,
  parent: string,
  field: string | undefined,
  push: (
    parent: string,
    field: string | undefined,
    literal: string,
    capture: string,
  ) => void,
): void {
  if (expression.kind === "field") {
    collectContextualLiteralHighlightEntries(
      expression.expression,
      parent,
      expression.name,
      push,
    );
    return;
  }
  if (expression.kind === "literal") {
    const capture = defaultLiteralHighlightCapture(expression.value);
    if (capture !== undefined && isWordLikeLiteral(expression.value)) {
      push(parent, field, expression.value, capture);
    }
    return;
  }
  if (expression.kind === "ref") {
    return;
  }
  for (const child of expressionChildren(expression)) {
    collectContextualLiteralHighlightEntries(child, parent, field, push);
  }
}

function pushRichDefaultHighlightEntries(
  plan: TreeSitterQueryPlan,
  push: (entry: TreeSitterCaptureMetadata) => void,
): void {
  for (const entry of inferNamedHighlightEntries(plan)) {
    push(entry);
  }
  for (const entry of inferContextualIdentifierHighlightEntries(plan)) {
    push(entry);
  }
}

function inferNamedHighlightEntries(
  plan: TreeSitterQueryPlan,
): TreeSitterCaptureMetadata[] {
  const entries: TreeSitterCaptureMetadata[] = [];
  const pushNode = (node: string, capture: string) => {
    entries.push({ node, capture });
  };

  for (const rule of plan.rules) {
    if (!plan.reachableRules.has(rule.name)) {
      continue;
    }
    const capture = inferNamedNodeHighlightCapture(rule.name, "rule");
    if (capture !== undefined) {
      pushNode(rule.name, capture);
    }
  }

  for (const token of plan.tokens) {
    let reachable = false;
    if (token.kind === "skip") {
      reachable = true;
    } else if (plan.reachableTokens.has(token.name)) {
      reachable = true;
    }
    if (!reachable) {
      continue;
    }
    const capture = inferNamedNodeHighlightCapture(token.name, token.kind);
    if (capture !== undefined) {
      pushNode(token.name, capture);
    }
  }

  return entries;
}

function inferNamedNodeHighlightCapture(
  name: string,
  kind: "rule" | "token" | "skip" | "contextual",
): string | undefined {
  const parts = nameParts(name);
  if (parts.includes("comment")) {
    return "comment";
  }
  if (kind === "skip") {
    return undefined;
  }
  if (hasAnyPart(parts, ["string", "str", "char", "character", "text"])) {
    return "string";
  }
  if (
    hasAnyPart(parts, [
      "number",
      "numeric",
      "integer",
      "int",
      "float",
      "double",
      "decimal",
      "hex",
      "octal",
      "binary",
    ])
  ) {
    return "number";
  }
  if (
    hasAnyPart(parts, [
      "boolean",
      "bool",
      "true",
      "false",
      "null",
      "nil",
      "none",
      "undefined",
      "constant",
      "const",
    ])
  ) {
    return "constant.builtin";
  }
  if (hasAnyPart(parts, ["intrinsic", "builtin", "builtins"])) {
    return "function.builtin";
  }
  if (parts.includes("label")) {
    return "label";
  }
  if (hasAnyPart(parts, ["field", "member", "property"])) {
    return "variable.other.member";
  }
  if (isTypeLikeName(parts)) {
    return "type";
  }
  return undefined;
}

function inferContextualIdentifierHighlightEntries(
  plan: TreeSitterQueryPlan,
): TreeSitterCaptureMetadata[] {
  const entries: TreeSitterCaptureMetadata[] = [];
  const seen = new Set<string>();
  const push = (
    parent: string,
    field: string | undefined,
    selector: TreeSitterCaptureSelectorMetadata,
    capture: string,
  ) => {
    let entry: TreeSitterCaptureMetadata;
    if (selector.node !== undefined) {
      entry = { parent, field, node: selector.node, capture };
    } else {
      entry = { parent, field, literal: selector.literal, capture };
    }
    const key = captureSelectorKey(entry);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    entries.push(entry);
  };

  for (const rule of plan.rules) {
    if (!plan.reachableRules.has(rule.name)) {
      continue;
    }
    collectContextualIdentifierHighlightEntries(
      rule.expression,
      rule.name,
      undefined,
      push,
    );
  }
  return entries.sort((left, right) =>
    captureSelectorKey(left).localeCompare(captureSelectorKey(right))
  );
}

function collectContextualIdentifierHighlightEntries(
  expression: AnalyzedExpression,
  parent: string,
  field: string | undefined,
  push: (
    parent: string,
    field: string | undefined,
    selector: TreeSitterCaptureSelectorMetadata,
    capture: string,
  ) => void,
): void {
  if (expression.kind === "field") {
    collectContextualIdentifierHighlightEntries(
      expression.expression,
      parent,
      expression.name,
      push,
    );
    return;
  }
  if (expression.kind === "ref") {
    if (field !== undefined && isIdentifierLikeName(expression.name)) {
      const capture = inferContextualIdentifierCapture(parent, field);
      if (capture !== undefined) {
        push(parent, field, { node: expression.name }, capture);
      }
    }
    return;
  }
  if (expression.kind === "literal") {
    return;
  }
  for (const child of expressionChildren(expression)) {
    collectContextualIdentifierHighlightEntries(child, parent, field, push);
  }
}

function inferContextualIdentifierCapture(
  parent: string,
  field: string,
): string | undefined {
  const parentParts = nameParts(parent);
  const fieldParts = nameParts(field);
  if (hasAnyPart(fieldParts, ["callee", "function", "func", "method"])) {
    return "function.call";
  }
  if (hasAnyPart(fieldParts, ["field", "member", "property"])) {
    return "variable.other.member";
  }
  if (fieldParts.includes("label")) {
    return "label";
  }
  if (isTypeLikeName(fieldParts)) {
    return "type";
  }
  if (
    hasAnyPart(fieldParts, [
      "variable",
      "var",
      "binding",
      "bind",
      "target",
      "parameter",
      "param",
    ])
  ) {
    return "variable";
  }
  if (!hasAnyPart(fieldParts, ["name", "identifier", "ident"])) {
    return undefined;
  }
  if (
    hasAnyPart(parentParts, [
      "function",
      "fn",
      "func",
      "method",
      "procedure",
      "proc",
    ])
  ) {
    return "function";
  }
  if (isTypeLikeName(parentParts)) {
    return "type";
  }
  if (hasAnyPart(parentParts, ["field", "member", "property"])) {
    return "variable.other.member";
  }
  if (parentParts.includes("label")) {
    return "label";
  }
  if (
    hasAnyPart(parentParts, [
      "variable",
      "var",
      "binding",
      "bind",
      "let",
      "parameter",
      "param",
    ])
  ) {
    return "variable";
  }
  return undefined;
}

function isIdentifierLikeName(name: string): boolean {
  const parts = nameParts(name);
  return hasAnyPart(parts, ["ident", "identifier", "name", "symbol"]);
}

function isTypeLikeName(parts: string[]): boolean {
  return hasAnyPart(parts, [
    "type",
    "typename",
    "class",
    "struct",
    "enum",
    "interface",
    "trait",
    "record",
  ]);
}

function hasAnyPart(parts: readonly string[], candidates: readonly string[]) {
  return candidates.some((candidate) => parts.includes(candidate));
}

function nameParts(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function collectNamedLiteralRuleTerminals(
  plan: TreeSitterQueryPlan,
): Set<string> {
  const terminals = new Set<string>();
  for (const rule of plan.rules) {
    if (!plan.reachableRules.has(rule.name)) {
      continue;
    }
    collectLiteralOnlyExpressionTerminals(rule.expression, terminals);
  }
  return terminals;
}

function collectLiteralOnlyExpressionTerminals(
  expression: AnalyzedExpression,
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
      for (const terminal of optionTerminals) {
        terminals.add(terminal);
      }
      return true;
    }
    case "ref":
    case "sequence":
    case "optional":
    case "repeat":
    case "repeat1":
    case "separated":
      return false;
  }
}

function collectSingleLiteralRules(
  plan: TreeSitterQueryPlan,
): Map<string, string> {
  const rules = new Map<string, string>();
  for (const rule of plan.rules) {
    if (!plan.reachableRules.has(rule.name)) {
      continue;
    }
    if (rule.expression.kind === "literal") {
      rules.set(rule.expression.value, rule.name);
    }
  }
  return rules;
}

function collectAnonymousLiteralTerminals(
  plan: TreeSitterQueryPlan,
): Set<string> {
  const terminals = new Set<string>();
  for (const rule of plan.rules) {
    if (!plan.reachableRules.has(rule.name)) {
      continue;
    }
    if (rule.expression.kind === "literal") {
      continue;
    }
    collectLiteralTerminals(rule.expression, terminals);
  }
  return terminals;
}

function collectLiteralTerminals(
  expression: AnalyzedExpression,
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

function collectDefaultRainbowBrackets(
  plan: TreeSitterQueryPlan,
): string[] {
  const terminals = plan.reachableLiterals;
  return ["(", ")", "[", "]", "{", "}"].filter((token) => terminals.has(token));
}

function expressionChildren(
  expression: AnalyzedExpression,
): AnalyzedExpression[] {
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
