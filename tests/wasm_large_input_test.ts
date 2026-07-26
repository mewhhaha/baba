import {
  applyBundle,
  assert,
  assertEquals,
  assertIncludes,
  compile,
} from "./helpers.ts";

// A repetition-heavy grammar: a top-level `statement*` repetition, a separated
// `INT % ","` list, and a repeated field. Every one of those lowers to the
// cursor reducers that used to materialize their accumulator by copying the
// whole list on each element.
const LIST_GRAMMAR = `
  token IDENT = /[a-z][a-z0-9_]*/ ;
  token INT = /[0-9]+/ ;
  skip WS = /[ \\t\\r\\n]+/ ;

  module = statements:statement* ;
  statement = "let" name:IDENT "=" values:(INT % ",") ";" ;
`;

// One token per source character, so this grammar reaches the WebAssembly
// address-space ceiling at the smallest source size of any shape.
const DENSE_GRAMMAR = `
  token DIGIT = /[0-9]/ ;

  module = digits:DIGIT+ ;
`;

interface CursorTokenLike {
  readonly type: "token";
  readonly kind: string;
  readonly text: string;
  readonly span: { readonly start: number; readonly end: number };
}

interface CursorRuleLike {
  readonly type: "rule";
  readonly name: string;
  readonly span: { readonly start: number; readonly end: number };
  readonly childCount: number;
  child(index: number): CursorRuleLike | CursorTokenLike | undefined;
  children(): readonly (CursorRuleLike | CursorTokenLike)[];
  field(name: string): CursorFieldValueLike | undefined;
}

type CursorFieldValueLike =
  | CursorRuleLike
  | CursorTokenLike
  | readonly CursorFieldValueLike[]
  | null;

interface DiagnosticLike {
  readonly code: string;
  readonly message: string;
  readonly span?: { readonly start: number; readonly end: number };
}

type CursorParseResultLike =
  | {
    readonly ok: true;
    readonly cursor: CursorRuleLike;
    readonly diagnostics: readonly DiagnosticLike[];
  }
  | {
    readonly ok: false;
    readonly cursor: null;
    readonly diagnostics: readonly DiagnosticLike[];
  };

interface ValidateResultLike {
  readonly ok: boolean;
  readonly diagnostics: readonly DiagnosticLike[];
}

interface GeneratedParser {
  parse(
    source: string,
    options?: Record<string, unknown>,
  ): CursorParseResultLike;
  validate(
    source: string,
    options?: Record<string, unknown>,
  ): ValidateResultLike;
  dispose(): void;
}

interface GeneratedWasmModule {
  createParser(options: unknown): GeneratedParser;
}

Deno.test("Wasm cursor parser materializes long repetitions far above the old memory ceiling", async () => {
  const { dir, parser } = await materialize(LIST_GRAMMAR);
  try {
    const statementCount = 40_000;
    const lines: string[] = [];
    for (let index = 0; index < statementCount; index++) {
      lines.push(`let v${index} = ${index},${index + 1},${index + 2};`);
    }
    const source = lines.join("\n");
    assert(
      source.length > 768 * 1024,
      `Expected a source above the old 768 KiB ceiling, got ${source.length}.`,
    );

    const result = parser.parse(source, { maxTraceActions: 100_000_000 });
    assertEquals(
      result.diagnostics.map((diagnostic) => diagnostic.code).join(","),
      "",
    );
    assertEquals(result.ok, true);
    assert(result.cursor);
    assertEquals(result.cursor.name, "module");
    assertEquals(result.cursor.span.start, 0);
    assertEquals(result.cursor.span.end, source.length);
    assertEquals(result.cursor.childCount, statementCount);

    // Every child edge must still be in source order. A cons-list accumulator
    // that flattens backwards would pass a shape check but fail this.
    let previousEnd = -1;
    for (let index = 0; index < statementCount; index++) {
      const child = result.cursor.child(index);
      assert(child, `Expected child ${index}.`);
      assert(child.type === "rule", `Expected rule child ${index}.`);
      assertEquals(child.name, "statement");
      assert(
        child.span.start > previousEnd,
        `Child ${index} is out of source order.`,
      );
      previousEnd = child.span.end;
      const name = child.field("name");
      assertCursorToken(name, "IDENT");
      assertEquals(name.text, `v${index}`);
    }

    const statements = result.cursor.field("statements");
    assert(Array.isArray(statements), "Expected a repeated field array.");
    assertEquals(statements.length, statementCount);

    // Separated-list field values keep their order too.
    const middle = result.cursor.child(statementCount - 1);
    assert(middle && middle.type === "rule");
    const values = middle.field("values");
    assert(Array.isArray(values), "Expected a separated list field array.");
    assertEquals(
      values.map((value) => {
        assertCursorToken(value, "INT");
        return value.text;
      }).join(","),
      `${statementCount - 1},${statementCount},${statementCount + 1}`,
    );
  } finally {
    parser.dispose();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm cursor parser reports an oversized input instead of throwing", async () => {
  const { dir, parser } = await materialize(DENSE_GRAMMAR);
  try {
    const source = "1".repeat(24 * 1024 * 1024);
    let result: CursorParseResultLike;
    try {
      result = parser.parse(source);
    } catch (error) {
      throw new Error(
        `Expected a structured diagnostic, got a thrown ${String(error)}.`,
      );
    }
    assertEquals(result.ok, false);
    assertEquals(result.cursor, null);
    assertEquals(result.diagnostics.length, 1);
    const diagnostic = result.diagnostics[0];
    assertEquals(diagnostic.code, "PARSER_INPUT_TOO_LARGE");
    assertIncludes(diagnostic.message, String(source.length));
    assertIncludes(diagnostic.message, "4294901760");
    assertIncludes(diagnostic.message, "65535 pages");
    assertEquals(diagnostic.span?.start, source.length);
    assertEquals(diagnostic.span?.end, source.length);
  } finally {
    parser.dispose();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm cursor children stay reachable in reverse and random order", async () => {
  const { dir, parser } = await materialize(LIST_GRAMMAR);
  try {
    const statementCount = 40_000;
    const lines: string[] = [];
    for (let index = 0; index < statementCount; index++) {
      lines.push(`let v${index} = ${index},${index + 1},${index + 2};`);
    }
    const source = lines.join("\n");

    const result = parser.parse(source, { maxTraceActions: 100_000_000 });
    assertEquals(result.ok, true);
    assert(result.cursor);
    const root = result.cursor;
    assertEquals(root.childCount, statementCount);

    // Child edges are a linked node list in the Wasm arena. These three passes
    // share one cursor on purpose: the forward pass leaves the walk cursor at
    // the tail, so the reverse pass starts with the worst possible backward
    // step. Each loop only records a span so the timing measures the child
    // lookup and not the assertions.
    const forwardStarts = new Int32Array(statementCount);
    const forwardBegan = performance.now();
    for (let index = 0; index < statementCount; index++) {
      const child = root.child(index);
      if (child === undefined) throw new Error(`Missing child ${index}.`);
      forwardStarts[index] = child.span.start;
    }
    const forwardMs = performance.now() - forwardBegan;

    const reverseStarts = new Int32Array(statementCount);
    const reverseBegan = performance.now();
    for (let index = statementCount - 1; index >= 0; index--) {
      const child = root.child(index);
      if (child === undefined) throw new Error(`Missing child ${index}.`);
      reverseStarts[index] = child.span.start;
    }
    const reverseMs = performance.now() - reverseBegan;

    // 7919 is prime and does not divide 40000, so this visits every index
    // exactly once in a deterministic non-monotonic order.
    const shuffledStarts = new Int32Array(statementCount);
    const shuffledBegan = performance.now();
    for (let step = 0; step < statementCount; step++) {
      const index = (step * 7919) % statementCount;
      const child = root.child(index);
      if (child === undefined) throw new Error(`Missing child ${index}.`);
      shuffledStarts[index] = child.span.start;
    }
    const shuffledMs = performance.now() - shuffledBegan;

    assertEquals(reverseStarts.join(","), forwardStarts.join(","));
    assertEquals(shuffledStarts.join(","), forwardStarts.join(","));

    // A forward-only walk that restarts at the head on every backward step is
    // quadratic: reverse traversal of a 40,000-child list measured 2106 ms
    // against 13 ms forward before the node index was added, and 8 ms after.
    // The budget is far above the fixed cost and far below the quadratic one.
    const budgetMs = 500;
    assert(
      reverseMs < budgetMs,
      `Reverse child traversal of ${statementCount} children took ${
        reverseMs.toFixed(1)
      } ms (forward ${
        forwardMs.toFixed(1)
      } ms); child(index) is no longer better than a walk from the head.`,
    );
    assert(
      shuffledMs < budgetMs,
      `Out-of-order child traversal of ${statementCount} children took ${
        shuffledMs.toFixed(1)
      } ms (forward ${
        forwardMs.toFixed(1)
      } ms); child(index) is no longer better than a walk from the head.`,
    );
  } finally {
    parser.dispose();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("Wasm validate blames maxTraceActions when the trace arena is what cannot fit", async () => {
  const { dir, parser } = await materialize(LIST_GRAMMAR);
  try {
    const source = "let a = 1;";
    assertEquals(parser.validate(source).ok, true);

    // The trace arena is sized purely by `maxTraceActions`, so a ten-character
    // source can exceed the address space. Advising a split would be wrong.
    const result = parser.validate(source, {
      maxTraceActions: 1_500_000_000,
    });
    assertEquals(result.ok, false);
    assertEquals(result.diagnostics.length, 1);
    const diagnostic = result.diagnostics[0];
    assertEquals(diagnostic.code, "PARSER_INPUT_TOO_LARGE");
    assertIncludes(diagnostic.message, "maxTraceActions is 1500000000");
    assertIncludes(diagnostic.message, "Lower maxTraceActions");
  } finally {
    parser.dispose();
    await Deno.remove(dir, { recursive: true });
  }
});

function assertCursorToken(
  value: CursorFieldValueLike | undefined,
  kind: string,
): asserts value is CursorTokenLike {
  assert(value !== undefined && value !== null, "Expected a cursor token.");
  assert(!Array.isArray(value), "Expected a cursor token, found an array.");
  const element = value as CursorRuleLike | CursorTokenLike;
  assert(element.type === "token", "Expected a cursor token.");
  assertEquals(element.kind, kind);
}

async function materialize(
  grammar: string,
): Promise<{ dir: string; parser: GeneratedParser }> {
  const result = compile(grammar, { targets: ["wasm"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle, "Expected a generated Wasm bundle.");
  const dir = await Deno.makeTempDir();
  await applyBundle(result.bundle, { root: dir });
  const mod = await import(`file://${dir}/wasm/mod.ts`) as GeneratedWasmModule;
  const parser = mod.createParser({
    bytes: await Deno.readFile(`${dir}/wasm/parser.wasm`),
    plan: await Deno.readFile(`${dir}/wasm/parser.plan`),
  });
  return { dir, parser };
}
