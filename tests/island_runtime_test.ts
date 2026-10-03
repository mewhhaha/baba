import { assert, assertEquals, compile, parseMetadata } from "./helpers.ts";
import { createParser } from "../src/runtime/generated_wasm.ts";

const GRAMMAR = String.raw`
skip WS = /[ \t\r\n]+/ ;
module = chunks:chunk* ;
chunk = values:"x"* ";" ;
`;

const METADATA = parseMetadata(JSON.stringify({
  version: 2,
  gpuFrontend: {
    version: 3,
    throughput: "strict",
    root: "module",
    islands: [
      { rule: "module", boundary: { kind: "root" } },
      { rule: "chunk", boundary: { kind: "terminated", terminal: ";" } },
    ],
    semantics: { rules: {} },
  },
}));

function createIslandParser() {
  const built = compile(GRAMMAR, {
    name: "island_runtime_test",
    rootRule: "module",
    metadata: METADATA,
    targets: ["wasm"],
  });
  assert(
    built.bundle,
    built.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
  );
  const wasmFile = built.bundle.files.find((file) =>
    file.path === "wasm/parser.wasm"
  );
  const planFile = built.bundle.files.find((file) =>
    file.path === "wasm/parser.plan"
  );
  assert(wasmFile);
  assert(wasmFile.encoding === "binary");
  assert(planFile);
  assert(planFile.encoding === "binary");
  return createParser({ bytes: wasmFile.content, plan: planFile.content });
}

Deno.test("production island runtime validates repeated terminated regions", () => {
  const parser = createIslandParser();
  assertEquals(parser.validate("x x ; x ;").ok, true);
  assertEquals(parser.validate("").ok, true);

  const incomplete = parser.validate("x ; x");
  assertEquals(incomplete.ok, false);
  if (incomplete.ok) {
    throw new Error("Expected the unterminated region to fail.");
  }
  assertEquals(incomplete.diagnostics[0].code, "PARSE_UNEXPECTED_TOKEN");
  assert(incomplete.diagnostics[0].expected?.includes('";"'));
});

Deno.test("production island runtime materializes root and region cursors", () => {
  const parser = createIslandParser();
  const parsed = parser.parse("x x ; x ;", { preserveTrivia: false });
  assert(parsed.ok);
  assertEquals(parsed.cursor.name, "module");
  assertEquals(parsed.cursor.childCount, 2);
  const chunks = parsed.cursor.fieldArray("chunks");
  assertEquals(chunks.length, 2);
  const first = parsed.cursor.child(0);
  assert(first !== undefined && first.type === "rule");
  assertEquals(first.name, "chunk");
  assertEquals(first.childCount, 3);
  assertEquals(first.fieldArray("values").length, 2);

  const preserved = parser.parse("x x ; x ;", { preserveTrivia: true });
  assert(preserved.ok);
  const preservedFirst = preserved.cursor.child(0);
  assert(preservedFirst !== undefined && preservedFirst.type === "rule");
  assertEquals(preservedFirst.childCount, 3);
  assertEquals(preservedFirst.fieldArray("values").length, 2);
});

Deno.test("production island cursors retain empty regions, trivia spans, and fields", () => {
  const parser = createIslandParser();
  const source = " \nx x ; \n ; \t x ; \n";
  try {
    const discarded = parser.parse(source, { preserveTrivia: false });
    const preserved = parser.parse(source, { preserveTrivia: true });
    assert(discarded.ok);
    assert(preserved.ok);

    // Exercise later arena writes before reading either returned snapshot.
    assertEquals(parser.parse("x ; ".repeat(512)).ok, true);
    assertEquals(parser.validate(";").ok, true);
    const cases = [
      {
        cursor: discarded.cursor,
        spans: [{ start: 2, end: 7 }, { start: 10, end: 11 }, {
          start: 14,
          end: 17,
        }],
        tokenRanges: [{ start: 0, end: 3 }, { start: 3, end: 4 }, {
          start: 4,
          end: 6,
        }],
      },
      {
        cursor: preserved.cursor,
        spans: [{ start: 0, end: 10 }, { start: 10, end: 14 }, {
          start: 14,
          end: 19,
        }],
        tokenRanges: [{ start: 0, end: 7 }, { start: 7, end: 9 }, {
          start: 9,
          end: 13,
        }],
      },
    ];
    for (const testCase of cases) {
      assertEquals(testCase.cursor.span.start, 0);
      assertEquals(testCase.cursor.span.end, source.length);
      const chunks = testCase.cursor.fieldArray("chunks");
      assertEquals(chunks.length, 3);
      assertEquals(testCase.cursor.childCount, 3);
      const valueCounts = [2, 0, 1];
      const childCounts = [3, 1, 2];
      for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index];
        assert(chunk !== null && "type" in chunk);
        assert(chunk.type === "rule");
        assertEquals(chunk.name, "chunk");
        assertEquals(chunk, testCase.cursor.child(index));
        assertEquals(chunk.span.start, testCase.spans[index].start);
        assertEquals(chunk.span.end, testCase.spans[index].end);
        assertEquals(chunk.tokenRange.start, testCase.tokenRanges[index].start);
        assertEquals(chunk.tokenRange.end, testCase.tokenRanges[index].end);
        assertEquals(chunk.childCount, childCounts[index]);
        const values = chunk.fieldArray("values");
        assertEquals(values.length, valueCounts[index]);
        for (const value of values) {
          assert(value !== null && "type" in value);
          assert(value.type === "token");
          assertEquals(value.text, "x");
        }
      }
    }
  } finally {
    parser.dispose();
  }
});

Deno.test("production island documents preserve incremental API shapes", () => {
  const parser = createIslandParser();
  const document = parser.createDocument("x ;", {
    goal: "parse",
    trivia: "discard",
  });
  assertEquals(document.parse().ok, true);
  const update = document.applyEdits([{
    start: 3,
    oldEnd: 3,
    newText: " x ;",
  }]);
  assertEquals(update.goal, "parse");
  assertEquals(update.parser.reparsedRanges.length, 1);
  const parsed = document.parse();
  assert(parsed.ok);
  assertEquals(parsed.cursor.childCount, 2);

  document.applyEdits([{ start: 6, oldEnd: 7, newText: "" }]);
  assertEquals(document.validate().ok, false);
});
