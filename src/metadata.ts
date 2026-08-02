import type {
  BabaMetadata,
  GpuFrontendBoundaryMetadata,
  GpuFrontendIslandMetadata,
  GpuFrontendLimitMetadata,
  GpuFrontendMetadata,
  GpuFrontendRuleSemanticMetadata,
  GpuFrontendSemanticMetadata,
  TreeSitterCaptureQueryEntry,
  TreeSitterCaptureQueryMetadata,
  TreeSitterCaptureSelectorMetadata,
  TreeSitterExtra,
  TreeSitterInjectionMetadata,
  TreeSitterInjectionQueryEntry,
  TreeSitterPathMetadata,
  TreeSitterRainbowsMetadata,
  TreeSitterRuleMetadata,
  TreeSitterRuleToken,
  TreeSitterRuleWrap,
} from "./ast.ts";
import { BabaError } from "./errors.ts";

/** Parses and validates Baba metadata JSON. */
export function parseMetadata(source: string): BabaMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BabaError(
      {
        code: "METADATA_JSON_ERROR",
        message: `Invalid Baba metadata JSON: ${message}`,
        path: "metadata",
      },
      { cause: error },
    );
  }
  return parseMetadataObject(parsed, "metadata");
}

type UnknownRecord = Record<string, unknown>;

function parseMetadataObject(
  value: unknown,
  path: string,
): BabaMetadata {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, [
    "version",
    "extras",
    "word",
    "supertypes",
    "conflicts",
    "inline",
    "queries",
    "rules",
    "gpuFrontend",
  ]);

  const metadata: BabaMetadata = {};
  if (hasKey(object, "version")) {
    const version = expectInteger(object.version, `${path}.version`);
    if (version !== 2) {
      throwMetadataShape(`Unsupported ${path}.version ${version}`);
    }
    metadata.version = 2;
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
  if (hasKey(object, "gpuFrontend")) {
    metadata.gpuFrontend = parseGpuFrontendMetadata(
      object.gpuFrontend,
      `${path}.gpuFrontend`,
    );
  }

  return metadata;
}

function parseGpuFrontendMetadata(
  value: unknown,
  path: string,
): GpuFrontendMetadata {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, [
    "version",
    "throughput",
    "root",
    "islands",
    "semantics",
    "limits",
  ]);
  const version = expectInteger(object.version, `${path}.version`);
  if (version !== 3) {
    throwMetadataShape(`Unsupported ${path}.version ${version}`);
  }
  const metadata: GpuFrontendMetadata = {
    version: 3,
    root: expectString(object.root, `${path}.root`),
    islands: expectArray(object.islands, `${path}.islands`).map((
      island,
      index,
    ) => parseGpuFrontendIsland(island, `${path}.islands[${index}]`)),
    semantics: parseGpuFrontendSemantics(
      object.semantics,
      `${path}.semantics`,
    ),
  };
  if (hasKey(object, "throughput")) {
    const throughput = expectString(
      object.throughput,
      `${path}.throughput`,
    );
    if (throughput !== "strict") {
      throwMetadataShape(
        `Invalid ${path}.throughput '${throughput}', expected 'strict'`,
      );
    }
    metadata.throughput = throughput;
  }
  if (hasKey(object, "limits")) {
    metadata.limits = parseGpuFrontendLimits(
      object.limits,
      `${path}.limits`,
    );
  }
  return metadata;
}

function parseGpuFrontendIsland(
  value: unknown,
  path: string,
): GpuFrontendIslandMetadata {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["rule", "boundary"]);
  return {
    rule: expectString(object.rule, `${path}.rule`),
    boundary: parseGpuFrontendBoundary(object.boundary, `${path}.boundary`),
  };
}

function parseGpuFrontendBoundary(
  value: unknown,
  path: string,
): GpuFrontendBoundaryMetadata {
  const object = expectObject(value, path);
  const kind = expectString(object.kind, `${path}.kind`);
  if (kind === "root") {
    assertKnownKeys(object, path, ["kind"]);
    return { kind };
  }
  if (kind === "paired") {
    assertKnownKeys(object, path, ["kind", "open", "close"]);
    return {
      kind,
      open: expectString(object.open, `${path}.open`),
      close: expectString(object.close, `${path}.close`),
    };
  }
  if (kind === "terminated") {
    assertKnownKeys(object, path, ["kind", "terminal"]);
    return {
      kind,
      terminal: expectString(object.terminal, `${path}.terminal`),
    };
  }
  if (kind === "separated") {
    assertKnownKeys(object, path, ["kind", "open", "close", "separator"]);
    return {
      kind,
      open: expectString(object.open, `${path}.open`),
      close: expectString(object.close, `${path}.close`),
      separator: expectString(object.separator, `${path}.separator`),
    };
  }
  throwMetadataShape(
    `Invalid ${path}.kind '${kind}', expected 'root', 'paired', 'terminated', or 'separated'`,
  );
}

function parseGpuFrontendSemantics(
  value: unknown,
  path: string,
): GpuFrontendSemanticMetadata {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, [
    "rules",
    "primitives",
    "operators",
    "scopes",
    "namespaces",
    "binders",
    "references",
    "patterns",
    "typeEntries",
  ]);
  const rulesObject = expectObject(object.rules, `${path}.rules`);
  const rules: Record<string, GpuFrontendRuleSemanticMetadata> = {};
  for (const [ruleName, ruleValue] of Object.entries(rulesObject)) {
    const rulePath = `${path}.rules.${ruleName}`;
    const ruleObject = expectObject(ruleValue, rulePath);
    assertKnownKeys(ruleObject, rulePath, ["opcode", "fields"]);
    const rule: GpuFrontendRuleSemanticMetadata = {
      opcode: expectString(ruleObject.opcode, `${rulePath}.opcode`),
    };
    if (hasKey(ruleObject, "fields")) {
      rule.fields = parseStringRecord(
        ruleObject.fields,
        `${rulePath}.fields`,
      );
    }
    rules[ruleName] = rule;
  }
  const semantics: GpuFrontendSemanticMetadata = { rules };
  if (hasKey(object, "primitives")) {
    semantics.primitives = parseStringRecord(
      object.primitives,
      `${path}.primitives`,
    );
  }
  if (hasKey(object, "operators")) {
    semantics.operators = parseStringRecord(
      object.operators,
      `${path}.operators`,
    );
  }
  for (
    const key of [
      "scopes",
      "namespaces",
      "binders",
      "references",
      "patterns",
      "typeEntries",
    ] as const
  ) {
    if (hasKey(object, key)) {
      semantics[key] = expectStringArray(object[key], `${path}.${key}`);
    }
  }
  return semantics;
}

function parseStringRecord(
  value: unknown,
  path: string,
): Record<string, string> {
  const object = expectObject(value, path);
  const record: Record<string, string> = {};
  for (const [key, entry] of Object.entries(object)) {
    record[key] = expectString(entry, `${path}.${key}`);
  }
  return record;
}

function parseGpuFrontendLimits(
  value: unknown,
  path: string,
): GpuFrontendLimitMetadata {
  const object = expectObject(value, path);
  const keys = [
    "maxLexerStates",
    "maxIslandStates",
    "maxIslandTransitions",
    "maxSemanticOpcodes",
    "maxPlanBytes",
    "maxContractionRounds",
    "maxNodesPerToken",
    "maxEdgesPerToken",
    "maxConstraintsPerNode",
  ] as const;
  assertKnownKeys(object, path, [...keys]);
  const limits: GpuFrontendLimitMetadata = {};
  for (const key of keys) {
    if (!hasKey(object, key)) {
      continue;
    }
    const limit = expectInteger(object[key], `${path}.${key}`);
    if (limit < 1) {
      throwMetadataShape(`${path}.${key} must be a positive integer`);
    }
    limits[key] = limit;
  }
  return limits;
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

function parseQueriesMetadata(
  value: unknown,
  path: string,
): BabaMetadata["queries"] {
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

  const queries: NonNullable<BabaMetadata["queries"]> = {};
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
    assertKnownKeys(defaults, `${path}.defaults`, [
      "mode",
      "suppress",
      "ignore",
    ]);
    metadata.defaults = {};
    if (hasKey(defaults, "mode")) {
      const mode = expectString(defaults.mode, `${path}.defaults.mode`);
      if (mode !== "rich" && mode !== "minimal") {
        throwMetadataShape(
          `Expected ${path}.defaults.mode to be "rich" or "minimal"`,
        );
      }
      metadata.defaults.mode = mode;
    }
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
          "field",
        ]);
        const selector = parseCaptureSelectorMetadata(
          {
            ...(hasKey(ignoreObject, "node")
              ? { node: ignoreObject.node }
              : { literal: ignoreObject.literal }),
            parent: ignoreObject.parent,
            ...(hasKey(ignoreObject, "field")
              ? { field: ignoreObject.field }
              : {}),
          },
          `${path}.defaults.ignore[${index}]`,
        );
        return {
          ...selector,
          parent: selector.parent ??
            expectString(
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
  assertKnownKeys(object, path, [
    "node",
    "literal",
    "capture",
    "pattern",
    "parent",
    "field",
  ]);

  if (hasKey(object, "pattern")) {
    if (
      hasKey(object, "node") || hasKey(object, "literal") ||
      hasKey(object, "capture") || hasKey(object, "parent") ||
      hasKey(object, "field")
    ) {
      throwMetadataShape(
        `Expected ${path} raw pattern to omit node, literal, capture, parent, and field`,
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
  const context = parseSelectorContext(object, path);
  return hasNode
    ? {
      ...context,
      node: expectString(object.node, `${path}.node`),
      capture,
    }
    : {
      ...context,
      literal: expectString(object.literal, `${path}.literal`),
      capture,
    };
}

function parseCaptureSelectorMetadata(
  value: unknown,
  path: string,
): TreeSitterCaptureSelectorMetadata {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["node", "literal", "parent", "field"]);
  const hasNode = hasKey(object, "node");
  const hasLiteral = hasKey(object, "literal");
  if (hasNode === hasLiteral) {
    throwMetadataShape(
      `Expected ${path} to specify exactly one of node or literal`,
    );
  }
  const context = parseSelectorContext(object, path);
  return hasNode
    ? { ...context, node: expectString(object.node, `${path}.node`) }
    : { ...context, literal: expectString(object.literal, `${path}.literal`) };
}

function parseSelectorContext(
  object: Record<string, unknown>,
  path: string,
): Pick<TreeSitterCaptureSelectorMetadata, "parent" | "field"> {
  const parent = hasKey(object, "parent")
    ? expectString(object.parent, `${path}.parent`)
    : undefined;
  const field = hasKey(object, "field")
    ? expectString(object.field, `${path}.field`)
    : undefined;
  if (field !== undefined && parent === undefined) {
    throwMetadataShape(`Expected ${path}.field to also specify parent`);
  }
  return {
    ...(parent !== undefined ? { parent } : {}),
    ...(field !== undefined ? { field } : {}),
  };
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

function parseRuleMetadataShape(
  value: unknown,
  path: string,
): TreeSitterRuleMetadata {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["token", "wrap", "paths"]);

  const metadata: TreeSitterRuleMetadata = {};
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
  if (kind === "token" || kind === "token.immediate") {
    return { kind };
  }
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
    if (!hasKey(object, "value")) {
      return { kind };
    }
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

function parseRegexPattern(value: unknown, path: string): string {
  const pattern = expectString(value, path);
  if (pattern.includes("\n") || pattern.includes("\r")) {
    throwMetadataShape(`Expected ${path} to stay on one line`);
  }
  try {
    new RegExp(pattern);
  } catch (error) {
    let message = String(error);
    if (error instanceof Error) {
      message = error.message;
    }
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
