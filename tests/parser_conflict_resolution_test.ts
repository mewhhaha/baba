import {
  applyBundle,
  assert,
  assertEquals,
  assertIncludes,
  assertNotIncludes,
  assertThrowsIncludes,
  compile,
  denoCheck,
  generatedTextContent,
  parseMetadata,
} from "./helpers.ts";

const genericPostfixGrammar = `
  token ID = /[A-Za-z_][A-Za-z0-9_]*/ ;
  skip WS = /[ \\t\\r\\n]+/ ;

  module = postfix ;
  postfix = primary suffix* ;
  suffix = "[" identifier "]" ;
  primary = generic | identifier ;
  generic = identifier "[" identifier "]" ;
  identifier = ID ;
`;

const parenthesizedTypeGrammar = `
  token ID = /[A-Za-z_][A-Za-z0-9_]*/ ;
  skip WS = /[ \\t\\r\\n]+/ ;

  module = primary ;
  primary = tuple | group | atom ;
  tuple = "(" atom "," atom ")" ;
  group = "(" atom ")" ;
  atom = modifier* term ;
  modifier = "mut" ;
  term = ID | "(" primary ")" ;
`;

const shiftFirstRestoreGrammar = `
  skip WS = /[ \\t\\r\\n]+/ ;

  module = short "b" | long "c" ;
  short = "a" ;
  long = "a" "b" ;
`;

Deno.test("TypeScript parser resolves declared shift/reduce conflicts deterministically", async () => {
  const unresolved = compile(genericPostfixGrammar, {
    targets: ["typescript"],
  });
  assertEquals(unresolved.bundle, undefined);
  assertEquals(
    unresolved.diagnostics[0].code,
    "PORTABLE_PARSER_SHIFT_REDUCE_CONFLICT",
  );
  assertIncludes(
    unresolved.diagnostics[0].message,
    "metadata.parser.resolutions",
  );
  assertIncludes(unresolved.diagnostics[0].message, "Conflict ID: c_");
  assertIncludes(unresolved.diagnostics[0].message, '"conflict": "c_');
  assertIncludes(unresolved.diagnostics[0].message, '"prefer": "shift"');
  assertIncludes(
    unresolved.diagnostics[0].message,
    'Conflict witness prefix: ID "["',
  );
  assertIncludes(
    unresolved.diagnostics[0].message,
    "The final symbol is the conflicting lookahead.",
  );
  assertIncludes(
    unresolved.diagnostics[0].message,
    "metadata.parser.conflicts",
  );
  const conflict = conflictIdFromMessage(unresolved.diagnostics[0].message);

  const metadata = parseMetadata(JSON.stringify({
    version: 2,
    parser: {
      resolutions: [{ conflict, prefer: "shift" }],
    },
  }));
  const resolved = compile(genericPostfixGrammar, {
    targets: ["typescript"],
    metadata,
  });
  assertEquals(resolved.diagnostics.length, 0);
  assert(resolved.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(resolved.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    assertEquals(mod.parse("Maybe").ok, true);
    assertEquals(mod.parse("Maybe[i32]").ok, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("parser conflict IDs are structural and deterministic", () => {
  const left = compile(
    `
    // comments and spacing should not affect conflict identity
    module = postfix ;
    postfix = primary suffix* ;
    suffix = "[" identifier "]" ;
    primary = generic | identifier ;
    generic = identifier "[" identifier "]" ;
    identifier = ID ;
    token ID = /[A-Za-z_][A-Za-z0-9_]*/ ;
    skip WS = /[ \\t\\r\\n]+/ ;
  `,
    { targets: ["typescript"] },
  );
  const right = compile(
    `
    token ID = /[A-Za-z_][A-Za-z0-9_]*/ ;
    skip WS = /[ \\t\\r\\n]+/ ;

    module=postfix;
    postfix=primary suffix*;
    suffix="[" identifier "]";
    primary=generic|identifier;
    generic=identifier "[" identifier "]";
    identifier=ID;
  `,
    { targets: ["typescript"] },
  );
  assertEquals(left.bundle, undefined);
  assertEquals(right.bundle, undefined);
  const leftId = conflictIdFromMessage(left.diagnostics[0].message);
  const rightId = conflictIdFromMessage(right.diagnostics[0].message);
  assertEquals(leftId, rightId);

  const changed = compile(
    `
    token ID = /[A-Za-z_][A-Za-z0-9_]*/ ;
    skip WS = /[ \\t\\r\\n]+/ ;

    module = postfix ;
    postfix = primary suffix* ;
    suffix = "[" identifier "]" ;
    primary = generic | identifier ;
    generic = identifier "[" identifier "," identifier "]" ;
    identifier = ID ;
  `,
    { targets: ["typescript"] },
  );
  assertEquals(changed.bundle, undefined);
  assert(conflictIdFromMessage(changed.diagnostics[0].message) !== leftId);
});

Deno.test("TypeScript parser resolves conflicts by stable conflict ID", () => {
  const unresolved = compile(genericPostfixGrammar, {
    targets: ["typescript"],
  });
  assertEquals(unresolved.bundle, undefined);
  const conflict = conflictIdFromMessage(unresolved.diagnostics[0].message);
  const metadata = parseMetadata(JSON.stringify({
    version: 2,
    parser: {
      resolutions: [{ conflict, prefer: "shift" }],
    },
  }));
  const resolved = compile(genericPostfixGrammar, {
    targets: ["typescript"],
    metadata,
  });
  assertEquals(resolved.diagnostics.length, 0);
  assert(resolved.bundle);
});

Deno.test("parser conflict metadata rejects legacy selector shapes", () => {
  assertThrowsIncludes(
    () =>
      parseMetadata(JSON.stringify({
        version: 2,
        parser: {
          resolutions: [
            { rules: ["generic", "primary"], on: "[", prefer: "shift" },
          ],
        },
      })),
    "Unknown metadata.parser.resolutions[0] key 'rules'",
  );
  assertThrowsIncludes(
    () =>
      parseMetadata(JSON.stringify({
        version: 2,
        parser: {
          conflicts: [["short", "long"]],
        },
      })),
    "Expected metadata.parser.conflicts[0] to be object",
  );
});

Deno.test("TypeScript parser rejects stale stable conflict IDs", () => {
  const noConflictMetadata = parseMetadata(JSON.stringify({
    version: 2,
    parser: {
      resolutions: [{ conflict: "c_deadbeefdeadbeef", prefer: "shift" }],
    },
  }));
  const noConflict = compile(`module = "x" ;`, {
    targets: ["typescript"],
    metadata: noConflictMetadata,
  });
  assertEquals(noConflict.bundle, undefined);
  assertEquals(
    noConflict.diagnostics[0].code,
    "PORTABLE_PARSER_CONFLICT_METADATA",
  );
  assertIncludes(noConflict.diagnostics[0].message, "unknown conflict ID");

  const wrongConflict = compile(genericPostfixGrammar, {
    targets: ["typescript"],
    metadata: noConflictMetadata,
  });
  assertEquals(wrongConflict.bundle, undefined);
  assertEquals(
    wrongConflict.diagnostics[0].code,
    "PORTABLE_PARSER_SHIFT_REDUCE_CONFLICT",
  );
  assertEquals(
    wrongConflict.diagnostics[1].code,
    "PORTABLE_PARSER_CONFLICT_METADATA",
  );
});

Deno.test("TypeScript parser rejects duplicate stable conflict resolutions", () => {
  const unresolved = compile(genericPostfixGrammar, {
    targets: ["typescript"],
  });
  assertEquals(unresolved.bundle, undefined);
  const conflict = conflictIdFromMessage(unresolved.diagnostics[0].message);

  const duplicateMetadata = parseMetadata(JSON.stringify({
    version: 2,
    parser: {
      resolutions: [
        { conflict, prefer: "shift" },
        { conflict, prefer: "shift" },
      ],
    },
  }));
  const duplicate = compile(genericPostfixGrammar, {
    targets: ["typescript"],
    metadata: duplicateMetadata,
  });
  assertEquals(duplicate.bundle, undefined);
  assertEquals(
    duplicate.diagnostics[0].code,
    "PORTABLE_PARSER_CONFLICT_METADATA",
  );
  assertIncludes(duplicate.diagnostics[0].message, "duplicates");

  const contradictoryMetadata = parseMetadata(JSON.stringify({
    version: 2,
    parser: {
      resolutions: [
        { conflict, prefer: "shift" },
        { conflict, prefer: "reduce" },
      ],
    },
  }));
  const contradictory = compile(genericPostfixGrammar, {
    targets: ["typescript"],
    metadata: contradictoryMetadata,
  });
  assertEquals(contradictory.bundle, undefined);
  assertEquals(
    contradictory.diagnostics[0].code,
    "PORTABLE_PARSER_CONFLICT_METADATA",
  );
  assertIncludes(contradictory.diagnostics[0].message, "contradictory");
});

Deno.test("TypeScript parser reduce/reduce diagnostics suggest reduce candidates", () => {
  const result = compile(
    `
    module = left | right ;
    left = "x" ;
    right = "x" ;
  `,
    {
      targets: ["typescript"],
    },
  );
  assertEquals(result.bundle, undefined);
  assertEquals(
    result.diagnostics[0].code,
    "PORTABLE_PARSER_REDUCE_REDUCE_CONFLICT",
  );
  assertIncludes(result.diagnostics[0].message, "metadata.parser.resolutions");
  assertIncludes(result.diagnostics[0].message, '"prefer": "reduce"');
  assertIncludes(result.diagnostics[0].message, '"reduce": "left = \\"x\\""');
  assertIncludes(
    result.diagnostics[0].message,
    'Conflict witness prefix: "x" EOF',
  );
  assertIncludes(
    result.diagnostics[0].message,
    'Candidate reduce values: "left = \\"x\\"", "right = \\"x\\""',
  );
});

Deno.test("generated deterministic parser omits branch-only helpers", () => {
  const result = compile(`module = "a" ;`, {
    targets: ["typescript"],
  });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);
  const parserSource = generatedTextContent(
    result.bundle,
    "typescript/parser.ts",
  );
  assertNotIncludes(parserSource, "function parserTrace(");
  assertNotIncludes(parserSource, "function parserTraceSetTerminal(");
  assertNotIncludes(parserSource, "function replayTrace(");
  assertNotIncludes(parserSource, "function parserAction(");
  assertNotIncludes(parserSource, "function parserGoto(");
  assertNotIncludes(parserSource, "function parserExpectedStart(");
  assertNotIncludes(parserSource, "function parserExpectedEnd(");
  assertNotIncludes(parserSource, "function parserProductionLhs(");
  assertNotIncludes(parserSource, "function parserProductionRhsLength(");
  assertNotIncludes(parserSource, "function parserActionKind(");
  assertNotIncludes(parserSource, "function parserActionPayload(");
  assertNotIncludes(parserSource, "function parserActionCount(");
  assertNotIncludes(parserSource, "const ACTIONS");
  assertNotIncludes(parserSource, "const GOTOS");
  assertNotIncludes(parserSource, "MAX_PARSE_BRANCHES");
  assertNotIncludes(parserSource, "interface ParseBranch");
  assertNotIncludes(parserSource, "function findAction(");
  assertNotIncludes(parserSource, "function findActions(");
  assertNotIncludes(parserSource, "TERMINAL_NAMES");
  assertNotIncludes(parserSource, "function asFragment(");
  assertNotIncludes(parserSource, "spanFromFragments");

  const syntaxSource = generatedTextContent(
    result.bundle,
    "typescript/syntax.ts",
  );
  assertIncludes(syntaxSource, 'export * from "./types.ts";');
  assertNotIncludes(syntaxSource, "fields: {\n  };");
});

Deno.test("TypeScript parser branches through declared local grammar conflicts", async () => {
  const unresolved = compile(parenthesizedTypeGrammar, {
    targets: ["typescript"],
  });
  assertEquals(unresolved.bundle, undefined);
  assertEquals(
    unresolved.diagnostics[0].code,
    "PORTABLE_PARSER_SHIFT_REDUCE_CONFLICT",
  );
  const conflict = conflictIdFromMessage(unresolved.diagnostics[0].message);

  const metadata = parseMetadata(JSON.stringify({
    version: 2,
    parser: {
      conflicts: [{ conflict }],
    },
  }));
  const resolved = compile(parenthesizedTypeGrammar, {
    targets: ["typescript"],
    metadata,
  });
  assertEquals(resolved.diagnostics.length, 0);
  assert(resolved.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(resolved.bundle, { root: dir });
    const parserSource = await Deno.readTextFile(`${dir}/typescript/parser.ts`);
    assertNotIncludes(parserSource, "function parserTrace(");
    assertNotIncludes(parserSource, "function parserTraceSetTerminal(");
    assertNotIncludes(parserSource, "function parserActionAt(");
    assertNotIncludes(parserSource, "function parserActionCount(");
    assertNotIncludes(parserSource, "function parserGoto(");
    assertNotIncludes(parserSource, "MAX_PARSE_BRANCHES");
    assertNotIncludes(parserSource, "interface ParseBranch");
    assertNotIncludes(parserSource, "function findActions(");
    assertNotIncludes(parserSource, "function applyAction(");
    assertNotIncludes(parserSource, "const ACTIONS");
    assertNotIncludes(parserSource, "const GOTOS");
    await denoCheck(`${dir}/typescript/mod.ts`);
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    for (const source of ["(a)", "(a, b)", "((a))"]) {
      assertEquals(mod.parse(source).ok, true);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("parser branches through stable declared conflict IDs", async () => {
  const unresolved = compile(shiftFirstRestoreGrammar, {
    targets: ["typescript"],
  });
  assertEquals(unresolved.bundle, undefined);
  const conflict = conflictIdFromMessage(unresolved.diagnostics[0].message);
  const metadata = parseMetadata(JSON.stringify({
    version: 2,
    parser: {
      conflicts: [{ conflict }],
    },
  }));
  const result = compile(shiftFirstRestoreGrammar, {
    targets: ["typescript", "wasm"],
    metadata,
  });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    await denoCheck(`${dir}/wasm/mod.ts`);
    const ts = await import(`file://${dir}/typescript/mod.ts`);
    const wasm = await import(`file://${dir}/wasm/mod.ts`);
    for (const mod of [ts, wasm]) {
      assertEquals(mod.parse("a b").ok, true);
      assertEquals(mod.parse("a b c").ok, true);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("TypeScript parser rejects stale declared branch conflicts", () => {
  const metadata = parseMetadata(JSON.stringify({
    version: 2,
    parser: {
      conflicts: [{ conflict: "c_deadbeefdeadbeef" }],
    },
  }));
  const deterministic = compile(`module = "x" ;`, {
    targets: ["typescript"],
    metadata,
  });
  assertEquals(deterministic.bundle, undefined);
  assertEquals(
    deterministic.diagnostics[0].code,
    "PORTABLE_PARSER_CONFLICT_METADATA",
  );
  assertIncludes(deterministic.diagnostics[0].message, "did not match");

  const unresolved = compile(shiftFirstRestoreGrammar, {
    targets: ["typescript"],
  });
  assertEquals(unresolved.bundle, undefined);
  const conflict = conflictIdFromMessage(unresolved.diagnostics[0].message);
  const mixedMetadata = parseMetadata(JSON.stringify({
    version: 2,
    parser: {
      conflicts: [
        { conflict },
        { conflict: "c_deadbeefdeadbeef" },
      ],
    },
  }));
  const mixed = compile(shiftFirstRestoreGrammar, {
    targets: ["typescript"],
    metadata: mixedMetadata,
  });
  assertEquals(mixed.bundle, undefined);
  assertEquals(
    mixed.diagnostics[0].code,
    "PORTABLE_PARSER_CONFLICT_METADATA",
  );
  assertIncludes(mixed.diagnostics[0].message, "metadata.parser.conflicts[1]");
});

Deno.test("TypeScript parser restores saved reduce branch after shifted branch fails", async () => {
  const unresolved = compile(shiftFirstRestoreGrammar, {
    targets: ["typescript"],
  });
  assertEquals(unresolved.bundle, undefined);
  assertEquals(
    unresolved.diagnostics[0].code,
    "PORTABLE_PARSER_SHIFT_REDUCE_CONFLICT",
  );
  const conflict = conflictIdFromMessage(unresolved.diagnostics[0].message);

  const metadata = parseMetadata(JSON.stringify({
    version: 2,
    parser: {
      conflicts: [{ conflict }],
    },
  }));
  const result = compile(shiftFirstRestoreGrammar, {
    targets: ["typescript"],
    metadata,
  });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    assertEquals(mod.parse("a b").ok, true);
    assertEquals(mod.parse("a b c").ok, true);
    assertEquals(mod.parse("a b", { maxExploredBranches: 2 }).ok, true);
    const limited = mod.parse("a b", { maxExploredBranches: 1 });
    assertEquals(limited.ok, false);
    assertEquals(limited.diagnostics[0].code, "PARSER_BRANCH_LIMIT");
    const traceLimited = mod.parse("a b", { maxTraceActions: 1 });
    assertEquals(traceLimited.ok, false);
    assertEquals(traceLimited.diagnostics[0].code, "PARSER_TRACE_LIMIT");
    const invalid = mod.parse("a c");
    assertEquals(invalid.ok, false);
    assertEquals(invalid.diagnostics[0].code, "PARSE_UNEXPECTED_TOKEN");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm parser target traces declared conflict branches", async () => {
  const unresolved = compile(parenthesizedTypeGrammar, {
    targets: ["wasm"],
  });
  assertEquals(unresolved.bundle, undefined);
  const conflict = conflictIdFromMessage(unresolved.diagnostics[0].message);
  const metadata = parseMetadata(JSON.stringify({
    version: 2,
    parser: {
      conflicts: [{ conflict }],
    },
  }));
  const result = compile(parenthesizedTypeGrammar, {
    targets: ["wasm"],
    metadata,
  });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    const paths = result.bundle.files.map((file) => file.path).join(",");
    assertNotIncludes(paths, "wasm/parser.ts");
    assertIncludes(paths, "wasm/parser.plan");
    await denoCheck(`${dir}/wasm/mod.ts`);
    const mod = await import(`file://${dir}/wasm/mod.ts`);
    const parser = mod.createParser({
      bytes: await Deno.readFile(`${dir}/wasm/parser.wasm`),
      plan: await Deno.readFile(`${dir}/wasm/parser.plan`),
    });
    for (const source of ["(a)", "(a, b)", "((a))"]) {
      assertEquals(parser.parse(source).ok, true);
    }
    parser.dispose();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm parser restores saved reduce branch after shifted branch fails", async () => {
  const unresolved = compile(shiftFirstRestoreGrammar, {
    targets: ["wasm"],
  });
  assertEquals(unresolved.bundle, undefined);
  assertEquals(
    unresolved.diagnostics[0].code,
    "PORTABLE_PARSER_SHIFT_REDUCE_CONFLICT",
  );
  assertIncludes(
    unresolved.diagnostics[0].message,
    'Conflict witness prefix: "a" "b"',
  );
  const conflict = conflictIdFromMessage(unresolved.diagnostics[0].message);

  const metadata = parseMetadata(JSON.stringify({
    version: 2,
    parser: {
      conflicts: [{ conflict }],
    },
  }));
  const result = compile(shiftFirstRestoreGrammar, {
    targets: ["wasm"],
    metadata,
  });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/wasm/mod.ts`);
    const mod = await import(`file://${dir}/wasm/mod.ts`);
    assertEquals(mod.parse("a b").ok, true);
    assertEquals(mod.parse("a b c").ok, true);
    assertEquals(mod.parse("a b", { maxExploredBranches: 2 }).ok, true);
    const limited = mod.parse("a b", { maxExploredBranches: 1 });
    assertEquals(limited.ok, false);
    assertEquals(limited.diagnostics[0].code, "PARSER_BRANCH_LIMIT");
    const traceLimited = mod.parse("a b", { maxTraceActions: 1 });
    assertEquals(traceLimited.ok, false);
    assertEquals(traceLimited.diagnostics[0].code, "PARSER_TRACE_LIMIT");
    const invalid = mod.parse("a c");
    assertEquals(invalid.ok, false);
    assertEquals(invalid.diagnostics[0].code, "PARSE_UNEXPECTED_TOKEN");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("parser reports declared reduce ambiguity", async () => {
  const grammar = `
    module = left | right ;
    left = "a" ;
    right = "a" ;
  `;
  const unresolved = compile(grammar, { targets: ["typescript", "wasm"] });
  assertEquals(unresolved.bundle, undefined);
  const conflict = conflictIdFromMessage(unresolved.diagnostics[0].message);
  const metadata = parseMetadata(JSON.stringify({
    version: 2,
    parser: {
      conflicts: [{ conflict }],
    },
  }));
  const result = compile(grammar, {
    targets: ["typescript", "wasm"],
    metadata,
  });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    await denoCheck(`${dir}/wasm/mod.ts`);
    const ts = await import(`file://${dir}/typescript/mod.ts`);
    const wasm = await import(`file://${dir}/wasm/mod.ts`);
    for (const mod of [ts, wasm]) {
      assertEquals(mod.parse("a").ok, true);
      assertEquals(
        mod.parse("a", { ambiguityMode: "first-success" }).ok,
        true,
      );
      const ambiguous = mod.parse("a", {
        ambiguityMode: "reject-ambiguous-success",
      });
      assertEquals(ambiguous.ok, false);
      assertEquals(ambiguous.diagnostics[0].code, "PARSER_AMBIGUOUS_PARSE");
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

function conflictIdFromMessage(message: string): string {
  const match = message.match(/Conflict ID: (c_[0-9a-f]+)/);
  assert(match);
  return match[1];
}
