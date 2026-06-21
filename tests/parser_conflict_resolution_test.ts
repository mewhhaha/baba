import {
  applyBundle,
  assert,
  assertEquals,
  assertIncludes,
  assertNotIncludes,
  compile,
  denoCheck,
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
    "TS_PARSER_SHIFT_REDUCE_CONFLICT",
  );
  assertIncludes(
    unresolved.diagnostics[0].message,
    "metadata.parser.resolutions",
  );
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

  const metadata = parseMetadata(JSON.stringify({
    version: 1,
    parser: {
      resolutions: [
        {
          rules: ["generic", "identifier"],
          on: "[",
          prefer: "shift",
        },
      ],
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
    "TS_PARSER_REDUCE_REDUCE_CONFLICT",
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
  const parserSource =
    result.bundle.files.find((file) => file.path === "typescript/parser.ts")
      ?.content ?? "";
  assertIncludes(parserSource, "function findAction(");
  assertIncludes(parserSource, "function parserAction(");
  assertIncludes(parserSource, "function parserGoto(");
  assertNotIncludes(parserSource, "const ACTIONS");
  assertNotIncludes(parserSource, "const GOTOS");
  assertNotIncludes(parserSource, "MAX_PARSE_BRANCHES");
  assertNotIncludes(parserSource, "interface ParseBranch");
  assertNotIncludes(parserSource, "function findActions(");
  assertNotIncludes(parserSource, "TERMINAL_NAMES");
  assertNotIncludes(parserSource, "function asFragment(");
  assertNotIncludes(parserSource, "spanFromFragments");

  const syntaxSource =
    result.bundle.files.find((file) => file.path === "typescript/syntax.ts")
      ?.content ?? "";
  assertIncludes(syntaxSource, "export type EmptyFields");
  assertIncludes(syntaxSource, "fields: EmptyFields;");
  assertNotIncludes(syntaxSource, "fields: {\n  };");
});

Deno.test("TypeScript parser branches through declared local grammar conflicts", async () => {
  const unresolved = compile(parenthesizedTypeGrammar, {
    targets: ["typescript"],
  });
  assertEquals(unresolved.bundle, undefined);
  assertEquals(
    unresolved.diagnostics[0].code,
    "TS_PARSER_SHIFT_REDUCE_CONFLICT",
  );

  const metadata = parseMetadata(JSON.stringify({
    version: 1,
    parser: {
      conflicts: [
        ["tuple", "atom"],
        ["group", "atom"],
      ],
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
    assertIncludes(parserSource, "MAX_PARSE_BRANCHES");
    assertIncludes(parserSource, "interface ParseBranch");
    assertIncludes(parserSource, "function findActions(");
    assertIncludes(parserSource, "function parserActionAt(");
    assertIncludes(parserSource, "function parserGoto(");
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

Deno.test("Wasm parser target traces declared conflict branches", async () => {
  const metadata = parseMetadata(JSON.stringify({
    version: 1,
    parser: {
      conflicts: [
        ["tuple", "atom"],
        ["group", "atom"],
      ],
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
    const parserSource = await Deno.readTextFile(`${dir}/wasm/parser.ts`);
    assertIncludes(parserSource, "parseTrace");
    assertIncludes(parserSource, "function replayTrace(");
    assertNotIncludes(parserSource, "const ACTIONS");
    assertNotIncludes(parserSource, "const GOTOS");
    assertNotIncludes(parserSource, "function findActions(");
    assertNotIncludes(parserSource, "TERMINAL_NAMES");
    await denoCheck(`${dir}/wasm/mod.ts`);
    const mod = await import(`file://${dir}/wasm/mod.ts`);
    for (const source of ["(a)", "(a, b)", "((a))"]) {
      assertEquals(mod.parse(source).ok, true);
    }
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
    "WASM_PARSER_SHIFT_REDUCE_CONFLICT",
  );
  assertIncludes(
    unresolved.diagnostics[0].message,
    'Conflict witness prefix: "a" "b"',
  );

  const metadata = parseMetadata(JSON.stringify({
    version: 1,
    parser: {
      conflicts: [["short", "long"]],
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
    const invalid = mod.parse("a c");
    assertEquals(invalid.ok, false);
    assertEquals(invalid.diagnostics[0].code, "PARSE_UNEXPECTED_TOKEN");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm parser grows branch arena for high fan-out reduce conflicts", async () => {
  const rules = Array.from({ length: 20 }, (_, index) => `r${index}`);
  const grammar = `
    module = ${rules.join(" | ")} ;
    ${rules.map((rule) => `${rule} = "a" ;`).join("\n")}
  `;
  const metadata = parseMetadata(JSON.stringify({
    version: 1,
    parser: {
      conflicts: rules.slice(1).map((rule) => ["r0", rule]),
    },
  }));
  const result = compile(grammar, {
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
    assertEquals(mod.parse("a").ok, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
