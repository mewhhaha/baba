import type {
  BabaMetadata,
  ParserConflictDeclarationMetadata,
  ParserConflictResolutionMetadata,
  ParserRuntimeMetadata,
  TreeSitterCaptureQueryEntry,
  TreeSitterCaptureQueryMetadata,
  TreeSitterCaptureSelectorMetadata,
  TreeSitterInjectionMetadata,
  TreeSitterInjectionQueryEntry,
  TreeSitterRainbowsMetadata,
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
    "queries",
    "parser",
  ]);

  const metadata: BabaMetadata = {};
  if (hasKey(object, "version")) {
    const version = expectInteger(object.version, `${path}.version`);
    if (version !== 2) {
      throwMetadataShape(`Unsupported ${path}.version ${version}`);
    }
    metadata.version = 2;
  }
  if (hasKey(object, "queries")) {
    metadata.queries = parseQueriesMetadata(object.queries, `${path}.queries`);
  }
  if (hasKey(object, "parser")) {
    metadata.parser = parseParserRuntimeMetadata(
      object.parser,
      `${path}.parser`,
    );
  }

  return metadata;
}

function parseParserRuntimeMetadata(
  value: unknown,
  path: string,
): ParserRuntimeMetadata {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["conflicts", "resolutions"]);
  const metadata: ParserRuntimeMetadata = {};
  if (hasKey(object, "conflicts")) {
    metadata.conflicts = expectArray(object.conflicts, `${path}.conflicts`)
      .map((conflict, index) =>
        parseParserConflictDeclaration(
          conflict,
          `${path}.conflicts[${index}]`,
        )
      );
  }
  if (hasKey(object, "resolutions")) {
    metadata.resolutions = expectArray(
      object.resolutions,
      `${path}.resolutions`,
    ).map((resolution, index) =>
      parseParserConflictResolution(
        resolution,
        `${path}.resolutions[${index}]`,
      )
    );
  }
  return metadata;
}

function parseParserConflictDeclaration(
  value: unknown,
  path: string,
): ParserConflictDeclarationMetadata {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["conflict"]);
  return { conflict: expectString(object.conflict, `${path}.conflict`) };
}

function parseParserConflictResolution(
  value: unknown,
  path: string,
): ParserConflictResolutionMetadata {
  const object = expectObject(value, path);
  assertKnownKeys(object, path, ["conflict", "prefer", "reduce"]);
  const prefer = expectString(object.prefer, `${path}.prefer`);
  if (prefer !== "shift" && prefer !== "reduce") {
    throwMetadataShape(
      `Invalid ${path}.prefer '${prefer}', expected 'shift' or 'reduce'`,
    );
  }
  const resolution: ParserConflictResolutionMetadata = {
    conflict: expectString(object.conflict, `${path}.conflict`),
    prefer,
  };
  if (hasKey(object, "reduce")) {
    resolution.reduce = expectString(object.reduce, `${path}.reduce`);
  }
  return resolution;
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

function expectInteger(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  throwMetadataShape(`Expected ${path} to be integer`);
}

function expectStringArray(value: unknown, path: string): string[] {
  return expectArray(value, path).map((item, index) =>
    expectString(item, `${path}[${index}]`)
  );
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
