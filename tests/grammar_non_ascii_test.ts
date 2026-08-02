import { assert, assertEquals, compile } from "./helpers.ts";
import { parseGrammarSource } from "../src/grammar.ts";
import { parsePortableRegex } from "../src/compiler/regex/parser.ts";
import { createParser } from "../src/runtime/generated_wasm.ts";

/**
 * Regression coverage for non-ASCII text inside grammar source.
 *
 * The grammar scanner navigates by byte offset, which is correct for the ASCII
 * delimiters it looks for. Token *text* used to be accumulated with
 * `byte as char`, which widens each UTF-8 byte to the code point of its own
 * numeric value: `À` (U+00C0, encoded `C3 80`) became the two code points
 * U+00C3 and U+0080. The regex compiler then built its alphabet from those
 * byte values, so a class written `[À-ɏ]` cut at 0xC3..0xC9 instead of
 * U+00C0..U+024F and rejected most of the characters it names.
 */

const NON_ASCII_GRAMMAR = [
  "grammar NonAscii",
  "",
  "token MARK = /[À-ɏ]+/ ;",
  "token WORD = /[A-Za-z]+/ ;",
  'token ARROW = "→" ;',
  "skip WS = /[ ]+/ ;",
  "",
  "module = (MARK | WORD | ARROW)* ;",
  "",
].join("\n");

function compiledParser(source: string) {
  const result = compile(source, {
    name: "NonAscii",
    rootRule: "module",
    targets: ["wasm"],
  });
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  assertEquals(
    errors.length,
    0,
    `unexpected errors: ${JSON.stringify(errors)}`,
  );

  const bundle = result.bundle;
  if (bundle === undefined) {
    throw new Error("compile succeeded but produced no bundle");
  }
  const planFile = bundle.files.find((f) => f.path.endsWith("parser.plan"));
  const wasmFile = bundle.files.find((f) => f.path.endsWith("parser.wasm"));
  if (planFile === undefined) {
    throw new Error("compile did not emit wasm/parser.plan");
  }
  if (wasmFile === undefined) {
    throw new Error("compile did not emit wasm/parser.wasm");
  }
  return createParser({
    bytes: wasmFile.content as Uint8Array,
    plan: planFile.content as Uint8Array,
  });
}

Deno.test("grammar scanner preserves non-ASCII regex text as whole code points", () => {
  const parsed = parseGrammarSource(NON_ASCII_GRAMMAR);
  assertEquals(parsed.diagnostics.length, 0);

  const serialized = JSON.stringify(parsed);
  assert(
    serialized.includes("[\\u00c0-\\u024f]+") ||
      serialized.includes("[À-ɏ]+"),
    "regex literal text should round-trip as code points, not UTF-8 bytes",
  );
  assert(
    !serialized.includes("Ã"),
    "regex literal text must not contain UTF-8 lead bytes widened to chars",
  );
});

Deno.test("non-ASCII character class compiles to the code point range it names", () => {
  // The standalone regex parser was always correct; this pins the compile path
  // to agree with it.
  assertEquals(
    JSON.stringify(parsePortableRegex("[À-ɏ]")),
    JSON.stringify({
      kind: "class",
      ranges: [{ start: 0xc0, end: 0x24f }],
      negated: false,
    }),
  );

  const parser = compiledParser(NON_ASCII_GRAMMAR);

  // Every one of these is inside U+00C0..U+024F and must lex without a
  // diagnostic. "é" is the case from the original report.
  for (const inside of ["À", "é", "ɏ", "Ā", "Ç", "Éé"]) {
    const result = parser.lex(inside);
    assertEquals(
      result.diagnostics.length,
      0,
      `${inside} (U+${
        inside.codePointAt(0)!.toString(16).toUpperCase()
      }) should match MARK`,
    );
  }

  // Negative control: outside the named range it must still be rejected, so
  // the test cannot pass by accepting everything above ASCII.
  for (const outside of ["€", "≈", "中"]) {
    const result = parser.lex(outside);
    assert(
      result.diagnostics.length > 0,
      `${outside} (U+${
        outside.codePointAt(0)!.toString(16).toUpperCase()
      }) is outside the class and must not match MARK`,
    );
  }
});

Deno.test("non-ASCII string literal terminals match the characters they name", () => {
  const parser = compiledParser(NON_ASCII_GRAMMAR);

  // `read_string` had the same byte-widening defect as the regex scanner.
  const result = parser.lex("→");
  assertEquals(
    result.diagnostics.length,
    0,
    "a non-ASCII literal terminal should match its own text",
  );
  assertEquals(result.tokenTape.token(0)?.text, "→");
});

Deno.test("non-ASCII and ASCII token classes coexist without a spurious overlap diagnostic", () => {
  const source = [
    "grammar TwoClasses",
    "",
    "token MARK = /[À-ɏ]+/ ;",
    "token ARROWS = /[←-↿]+/ ;",
    "skip WS = /[ ]+/ ;",
    "",
    "module = (MARK | ARROWS)* ;",
    "",
  ].join("\n");

  const result = compile(source, {
    name: "TwoClasses",
    rootRule: "module",
    targets: ["wasm"],
  });
  const overlaps = result.diagnostics.filter((d) =>
    d.code === "PORTABLE_LEXER_TOKEN_OVERLAP" ||
    d.code === "LEXER_TOKEN_OVERLAP"
  );
  assertEquals(
    overlaps.length,
    0,
    `disjoint non-ASCII classes must not report an overlap: ${
      JSON.stringify(overlaps)
    }`,
  );

  const parser = compiledParser(source);
  assertEquals(parser.lex("é").diagnostics.length, 0);
  assertEquals(parser.lex("↿").diagnostics.length, 0);
});
