import type {
  TreeSitterCaptureMetadata,
  TreeSitterCaptureQueryEntry,
  TreeSitterCaptureQueryMetadata,
  TreeSitterCaptureSelectorMetadata,
  TreeSitterExtra,
  TreeSitterInjectionMetadata,
  TreeSitterInjectionQueryEntry,
  TreeSitterMetadata,
  TreeSitterPathMetadata,
  TreeSitterRainbowsMetadata,
  TreeSitterRuleMetadata,
  TreeSitterRuleToken,
  TreeSitterRuleWrap,
  WorkbenchAstMetadata,
  WorkbenchAstNodeMetadata,
  WorkbenchFormatterMetadata,
  WorkbenchLanguageMetadata,
  WorkbenchLspMetadata,
} from "./ast.ts";
import { BabaError } from "./errors.ts";

/** Parses and validates tree-sitter metadata JSON. */
export function parseTreeSitterMetadata(source: string): TreeSitterMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BabaError(
      {
        code: "METADATA_JSON_ERROR",
        message: `Invalid tree-sitter metadata JSON: ${message}`,
        path: "metadata",
      },
      { cause: error },
    );
  }
  return parseTreeSitterMetadataObject(parsed, "metadata");
}

type UnknownRecord = Record<string, unknown>;

function parseTreeSitterMetadataObject(
  value: unknown,
  path: string,
): TreeSitterMetadata {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, [
    "language",
    "extras",
    "word",
    "supertypes",
    "conflicts",
    "inline",
    "queries",
    "ast",
    "formatter",
    "lsp",
    "rules",
  ]);

  const metadata: TreeSitterMetadata = {};
  if (hasKey(object, "language")) {
    metadata.language = parseLanguageMetadata(
      object.language,
      `${path}.language`,
    );
  }
  if (hasKey(object, "extras")) {
    metadata.extras = expectArray(object.extras, `${path}.extras`).map((
      extra,
      index,
    ) => parseTreeSitterExtra(extra, `${path}.extras[${index}]`));
  }
  if (hasKey(object, "word")) {
    metadata.word = expectString(object.word, `${path}.word`);
  }
  if (hasKey(object, "supertypes")) {
    metadata.supertypes = expectStringArray(
      object.supertypes,
      `${path}.supertypes`,
    );
  }
  if (hasKey(object, "conflicts")) {
    metadata.conflicts = expectArray(object.conflicts, `${path}.conflicts`).map(
      (conflict, index) =>
        expectStringArray(conflict, `${path}.conflicts[${index}]`),
    );
  }
  if (hasKey(object, "inline")) {
    metadata.inline = expectStringArray(object.inline, `${path}.inline`);
  }
  if (hasKey(object, "queries")) {
    metadata.queries = parseQueriesMetadata(object.queries, `${path}.queries`);
  }
  if (hasKey(object, "ast")) {
    metadata.ast = parseAstMetadata(object.ast, `${path}.ast`);
  }
  if (hasKey(object, "formatter")) {
    metadata.formatter = parseFormatterMetadata(
      object.formatter,
      `${path}.formatter`,
    );
  }
  if (hasKey(object, "lsp")) {
    metadata.lsp = parseLspMetadata(object.lsp, `${path}.lsp`);
  }
  if (hasKey(object, "rules")) {
    const rulesObject = expectObject(object.rules, `${path}.rules`);
    const rules: Record<string, TreeSitterRuleMetadata> = {};
    for (const [ruleName, ruleValue] of Object.entries(rulesObject)) {
      rules[ruleName] = parseRuleMetadataShape(
        ruleValue,
        `${path}.rules.${ruleName}`,
      );
    }
    metadata.rules = rules;
  }

  return metadata;
}

function parseTreeSitterExtra(value: unknown, path: string): TreeSitterExtra {
  const object = expectObject(value, path);
  const kind = expectString(object.kind, `${path}.kind`);
  if (kind === "regex") {
    assertKnownKeys(object, path, ["kind", "value"]);
    return { kind, value: parseRegexPattern(object.value, `${path}.value`) };
  }
  if (kind === "rule") {
    assertKnownKeys(object, path, ["kind", "name"]);
    return { kind, name: expectString(object.name, `${path}.name`) };
  }
  throwMetadataShape(`Invalid ${path}.kind '${kind}'`);
}

function parseLanguageMetadata(
  value: unknown,
  path: string,
): WorkbenchLanguageMetadata {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["scope", "fileTypes", "comment"]);

  const metadata: WorkbenchLanguageMetadata = {};
  if (hasKey(object, "scope")) {
    metadata.scope = expectString(object.scope, `${path}.scope`);
  }
  if (hasKey(object, "fileTypes")) {
    metadata.fileTypes = expectStringArray(
      object.fileTypes,
      `${path}.fileTypes`,
    );
  }
  if (hasKey(object, "comment")) {
    metadata.comment = expectString(object.comment, `${path}.comment`);
  }
  return metadata;
}

function parseQueriesMetadata(
  value: unknown,
  path: string,
): TreeSitterMetadata["queries"] {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, [
    "highlights",
    "locals",
    "folds",
    "indents",
    "tags",
    "textobjects",
    "rainbows",
    "injections",
  ]);

  const queries: NonNullable<TreeSitterMetadata["queries"]> = {};
  if (hasKey(object, "highlights")) {
    queries.highlights = parseHighlightCaptureQuery(
      object.highlights,
      `${path}.highlights`,
    );
  }
  if (hasKey(object, "locals")) {
    queries.locals = parseCaptureQueryEntries(object.locals, `${path}.locals`);
  }
  if (hasKey(object, "folds")) {
    queries.folds = parseCaptureQueryEntries(object.folds, `${path}.folds`);
  }
  if (hasKey(object, "indents")) {
    queries.indents = parseCaptureQueryEntries(
      object.indents,
      `${path}.indents`,
    );
  }
  if (hasKey(object, "tags")) {
    queries.tags = parseCaptureQueryEntries(object.tags, `${path}.tags`);
  }
  if (hasKey(object, "textobjects")) {
    queries.textobjects = parseCaptureQueryEntries(
      object.textobjects,
      `${path}.textobjects`,
    );
  }
  if (hasKey(object, "rainbows")) {
    queries.rainbows = parseRainbowsMetadata(
      object.rainbows,
      `${path}.rainbows`,
    );
  }
  if (hasKey(object, "injections")) {
    queries.injections = parseInjectionQueryEntries(
      object.injections,
      `${path}.injections`,
    );
  }
  return queries;
}

function parseHighlightCaptureQuery(
  value: unknown,
  path: string,
): TreeSitterCaptureQueryMetadata {
  if (Array.isArray(value)) {
    return { entries: parseCaptureQueryArray(value, path) };
  }
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["patterns", "entries", "defaults"]);
  const metadata: TreeSitterCaptureQueryMetadata = { entries: [] };
  if (hasKey(object, "patterns")) {
    metadata.entries.push(
      ...expectStringArray(object.patterns, `${path}.patterns`).map((
        pattern,
      ) => ({ pattern })),
    );
  }
  if (hasKey(object, "entries")) {
    metadata.entries.push(
      ...parseCaptureQueryEntries(object.entries, `${path}.entries`),
    );
  }
  if (hasKey(object, "defaults")) {
    const defaults = expectObject(object.defaults, `${path}.defaults`);
    assertKnownKeys(defaults, `${path}.defaults`, ["suppress", "ignore"]);
    metadata.defaults = {};
    if (hasKey(defaults, "suppress")) {
      metadata.defaults.suppress = expectArray(
        defaults.suppress,
        `${path}.defaults.suppress`,
      ).map((selector, index) =>
        parseCaptureSelectorMetadata(
          selector,
          `${path}.defaults.suppress[${index}]`,
        )
      );
    }
    if (hasKey(defaults, "ignore")) {
      metadata.defaults.ignore = expectArray(
        defaults.ignore,
        `${path}.defaults.ignore`,
      ).map((ignore, index) => {
        const ignoreObject = expectObject(
          ignore,
          `${path}.defaults.ignore[${index}]`,
        );
        assertKnownKeys(ignoreObject, `${path}.defaults.ignore[${index}]`, [
          "node",
          "literal",
          "parent",
        ]);
        const selector = parseCaptureSelectorMetadata(
          hasKey(ignoreObject, "node")
            ? { node: ignoreObject.node }
            : { literal: ignoreObject.literal },
          `${path}.defaults.ignore[${index}]`,
        );
        return {
          ...selector,
          parent: expectString(
            ignoreObject.parent,
            `${path}.defaults.ignore[${index}].parent`,
          ),
        };
      });
    }
  }
  return metadata;
}

function parseCaptureQueryEntries(
  value: unknown,
  path: string,
): TreeSitterCaptureQueryEntry[] {
  if (Array.isArray(value)) return parseCaptureQueryArray(value, path);
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["patterns", "entries"]);
  const entries: TreeSitterCaptureQueryEntry[] = [];
  if (hasKey(object, "patterns")) {
    entries.push(
      ...expectStringArray(object.patterns, `${path}.patterns`).map((
        pattern,
      ) => ({ pattern })),
    );
  }
  if (hasKey(object, "entries")) {
    entries.push(
      ...parseCaptureQueryEntries(object.entries, `${path}.entries`),
    );
  }
  return entries;
}

function parseCaptureQueryArray(
  value: unknown[],
  path: string,
): TreeSitterCaptureQueryEntry[] {
  return value.map((capture, index) =>
    parseCaptureMetadata(capture, `${path}[${index}]`)
  );
}

function parseCaptureMetadata(
  value: unknown,
  path: string,
): TreeSitterCaptureQueryEntry {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["node", "literal", "capture", "pattern"]);

  if (hasKey(object, "pattern")) {
    if (
      hasKey(object, "node") || hasKey(object, "literal") ||
      hasKey(object, "capture")
    ) {
      throwMetadataShape(
        `Expected ${path} raw pattern to omit node, literal, and capture`,
      );
    }
    return { pattern: expectString(object.pattern, `${path}.pattern`) };
  }

  const hasNode = hasKey(object, "node");
  const hasLiteral = hasKey(object, "literal");
  if (hasNode === hasLiteral) {
    throwMetadataShape(
      `Expected ${path} to specify exactly one of node or literal`,
    );
  }

  const capture = normalizeCaptureName(
    expectString(object.capture, `${path}.capture`),
    `${path}.capture`,
  );
  return hasNode
    ? { node: expectString(object.node, `${path}.node`), capture }
    : { literal: expectString(object.literal, `${path}.literal`), capture };
}

function parseCaptureSelectorMetadata(
  value: unknown,
  path: string,
): TreeSitterCaptureSelectorMetadata {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["node", "literal"]);
  const hasNode = hasKey(object, "node");
  const hasLiteral = hasKey(object, "literal");
  if (hasNode === hasLiteral) {
    throwMetadataShape(
      `Expected ${path} to specify exactly one of node or literal`,
    );
  }
  return hasNode
    ? { node: expectString(object.node, `${path}.node`) }
    : { literal: expectString(object.literal, `${path}.literal`) };
}

function parseRainbowsMetadata(
  value: unknown,
  path: string,
): TreeSitterRainbowsMetadata {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["scopes", "brackets", "patterns"]);

  const rainbows: TreeSitterRainbowsMetadata = {};
  if (hasKey(object, "scopes")) {
    rainbows.scopes = expectStringArray(object.scopes, `${path}.scopes`);
  }
  if (hasKey(object, "brackets")) {
    rainbows.brackets = expectStringArray(object.brackets, `${path}.brackets`);
  }
  if (hasKey(object, "patterns")) {
    rainbows.patterns = expectStringArray(object.patterns, `${path}.patterns`);
  }
  return rainbows;
}

function parseInjectionQueryEntries(
  value: unknown,
  path: string,
): TreeSitterInjectionQueryEntry[] {
  return expectArray(value, path).map((injection, index) => {
    const entryPath = `${path}[${index}]`;
    const object = expectObject(injection, entryPath);
    if (hasKey(object, "pattern")) {
      assertKnownKeys(object, entryPath, ["pattern"]);
      return { pattern: expectString(object.pattern, `${entryPath}.pattern`) };
    }
    return parseInjectionMetadata(injection, entryPath);
  });
}

function parseInjectionMetadata(
  value: unknown,
  path: string,
): TreeSitterInjectionMetadata {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["node", "language"]);
  return {
    node: expectString(object.node, `${path}.node`),
    language: expectString(object.language, `${path}.language`),
  };
}

function parseAstMetadata(
  value: unknown,
  path: string,
): WorkbenchAstMetadata {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["nodes"]);

  const metadata: WorkbenchAstMetadata = {};
  if (hasKey(object, "nodes")) {
    const nodesObject = expectObject(object.nodes, `${path}.nodes`);
    const nodes: Record<string, WorkbenchAstNodeMetadata> = {};
    for (const [nodeName, nodeValue] of Object.entries(nodesObject)) {
      nodes[nodeName] = parseAstNodeMetadata(
        nodeValue,
        `${path}.nodes.${nodeName}`,
      );
    }
    metadata.nodes = nodes;
  }
  return metadata;
}

function parseAstNodeMetadata(
  value: unknown,
  path: string,
): WorkbenchAstNodeMetadata {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["kind", "fields"]);

  const metadata: WorkbenchAstNodeMetadata = {};
  if (hasKey(object, "kind")) {
    metadata.kind = expectString(object.kind, `${path}.kind`);
  }
  if (hasKey(object, "fields")) {
    metadata.fields = expectStringRecord(object.fields, `${path}.fields`);
  }
  return metadata;
}

function parseFormatterMetadata(
  value: unknown,
  path: string,
): WorkbenchFormatterMetadata {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["blocks", "lists", "spacing"]);

  const metadata: WorkbenchFormatterMetadata = {};
  if (hasKey(object, "blocks")) {
    metadata.blocks = expectStringArray(object.blocks, `${path}.blocks`);
  }
  if (hasKey(object, "lists")) {
    metadata.lists = expectStringArray(object.lists, `${path}.lists`);
  }
  if (hasKey(object, "spacing")) {
    metadata.spacing = parseSpacingRecord(object.spacing, `${path}.spacing`);
  }
  return metadata;
}

function parseSpacingRecord(
  value: unknown,
  path: string,
): Record<string, "tight" | "space" | "newline"> {
  const object = expectObject(value, path);
  const record: Record<string, "tight" | "space" | "newline"> = {};
  for (const [key, item] of Object.entries(object)) {
    const spacing = expectString(item, `${path}.${key}`);
    if (spacing !== "tight" && spacing !== "space" && spacing !== "newline") {
      throwMetadataShape(`Invalid ${path}.${key} '${spacing}'`);
    }
    record[key] = spacing;
  }
  return record;
}

function parseLspMetadata(value: unknown, path: string): WorkbenchLspMetadata {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["documentSymbols", "diagnostics"]);

  const metadata: WorkbenchLspMetadata = {};
  if (hasKey(object, "documentSymbols")) {
    metadata.documentSymbols = expectStringArray(
      object.documentSymbols,
      `${path}.documentSymbols`,
    );
  }
  if (hasKey(object, "diagnostics")) {
    metadata.diagnostics = expectStringArray(
      object.diagnostics,
      `${path}.diagnostics`,
    );
  }
  return metadata;
}

function parseRuleMetadataShape(
  value: unknown,
  path: string,
): TreeSitterRuleMetadata {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["fields", "token", "wrap", "paths"]);

  const metadata: TreeSitterRuleMetadata = {};
  if (hasKey(object, "fields")) {
    metadata.fields = expectStringRecord(object.fields, `${path}.fields`);
  }
  if (hasKey(object, "token")) {
    metadata.token = parseRuleToken(object.token, `${path}.token`);
  }
  if (hasKey(object, "wrap")) {
    metadata.wrap = parseRuleWrap(object.wrap, `${path}.wrap`);
  }
  if (hasKey(object, "paths")) {
    const pathsObject = expectObject(object.paths, `${path}.paths`);
    const paths: Record<string, TreeSitterPathMetadata> = {};
    for (const [pathKey, pathValue] of Object.entries(pathsObject)) {
      paths[pathKey] = parsePathMetadataShape(
        pathValue,
        `${path}.paths.${pathKey}`,
      );
    }
    metadata.paths = paths;
  }
  return metadata;
}

function parseRuleToken(value: unknown, path: string): TreeSitterRuleToken {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["kind"]);
  const kind = expectString(object.kind, `${path}.kind`);
  if (kind === "token" || kind === "token.immediate") return { kind };
  throwMetadataShape(`Invalid ${path}.kind '${kind}'`);
}

function parseRuleWrap(value: unknown, path: string): TreeSitterRuleWrap {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["kind", "value"]);
  const kind = expectString(object.kind, `${path}.kind`);
  if (kind === "prec") {
    return { kind, value: expectInteger(object.value, `${path}.value`) };
  }
  if (kind === "prec.left" || kind === "prec.right") {
    if (!hasKey(object, "value")) return { kind };
    return { kind, value: expectInteger(object.value, `${path}.value`) };
  }
  throwMetadataShape(`Invalid ${path}.kind '${kind}'`);
}

function parsePathMetadataShape(
  value: unknown,
  path: string,
): TreeSitterPathMetadata {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, [
    "field",
    "wrap",
    "alias_ref",
    "alias_node",
    "inline_path",
    "hidden_path",
  ]);

  const metadata: TreeSitterPathMetadata = {};
  if (hasKey(object, "field")) {
    metadata.field = expectString(object.field, `${path}.field`);
  }
  if (hasKey(object, "wrap")) {
    metadata.wrap = parseRuleWrap(object.wrap, `${path}.wrap`);
  }
  if (hasKey(object, "alias_ref")) {
    metadata.alias_ref = expectString(object.alias_ref, `${path}.alias_ref`);
  }
  if (hasKey(object, "alias_node")) {
    metadata.alias_node = expectString(object.alias_node, `${path}.alias_node`);
  }
  if (hasKey(object, "inline_path")) {
    metadata.inline_path = expectBoolean(
      object.inline_path,
      `${path}.inline_path`,
    );
  }
  if (hasKey(object, "hidden_path")) {
    metadata.hidden_path = expectBoolean(
      object.hidden_path,
      `${path}.hidden_path`,
    );
  }
  return metadata;
}

function expectObject(value: unknown, path: string): UnknownRecord {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as UnknownRecord;
  }
  throwMetadataShape(`Expected ${path} to be object`);
}

function expectArray(value: unknown, path: string): unknown[] {
  if (Array.isArray(value)) return value;
  throwMetadataShape(`Expected ${path} to be array`);
}

function expectString(value: unknown, path: string): string {
  if (typeof value === "string") return value;
  throwMetadataShape(`Expected ${path} to be string`);
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value === "boolean") return value;
  throwMetadataShape(`Expected ${path} to be boolean`);
}

function expectInteger(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  throwMetadataShape(`Expected ${path} to be integer`);
}

function expectStringArray(value: unknown, path: string): string[] {
  return expectArray(value, path).map((item, index) =>
    expectString(item, `${path}[${index}]`)
  );
}

function expectStringRecord(
  value: unknown,
  path: string,
): Record<string, string> {
  const object = expectObject(value, path);
  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(object)) {
    record[key] = expectString(item, `${path}.${key}`);
  }
  return record;
}

function parseRegexPattern(value: unknown, path: string): string {
  const pattern = expectString(value, path);
  if (pattern.includes("\n") || pattern.includes("\r")) {
    throwMetadataShape(`Expected ${path} to stay on one line`);
  }
  try {
    new RegExp(pattern);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throwMetadataShape(`Invalid ${path}: ${message}`);
  }
  return pattern;
}

function normalizeCaptureName(value: string, path: string): string {
  const capture = value.startsWith("@") ? value.slice(1) : value;
  if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(capture)) {
    throwMetadataShape(`Invalid ${path} '${value}'`);
  }
  return capture;
}

function assertKnownKeys(
  object: UnknownRecord,
  path: string,
  keys: string[],
): void {
  const known = new Set(keys);
  for (const key of Object.keys(object)) {
    if (!known.has(key)) throwMetadataShape(`Unknown ${path} key '${key}'`);
  }
}

function hasKey(object: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

const metadataPathPattern = /metadata(?:\.[A-Za-z0-9_$-]+|\[[0-9]+\])*/;

function throwMetadataShape(message: string): never {
  throw new BabaError({
    code: "METADATA_SHAPE_ERROR",
    message,
    path: message.match(metadataPathPattern)?.[0] ?? "metadata",
  });
}
