import { assert, assertEquals, assertThrowsIncludes } from "./helpers.ts";
import { buildDfa } from "../src/compiler/regex/dfa.ts";
import { dfaIntersectionWitness } from "../src/compiler/regex/intersect.ts";
import { buildRegexNfa } from "../src/compiler/regex/nfa.ts";
import { regexCanMatchEmpty } from "../src/compiler/regex/nullable.ts";
import { parsePortableRegex } from "../src/compiler/regex/parser.ts";

Deno.test("portable regex parser rejects nonportable constructs", () => {
  for (const pattern of ["a(?=b)", "a+?", "\\s+", "(?:a)", "^a"]) {
    assertThrowsIncludes(
      () => parsePortableRegex(pattern),
      "outside Baba's portable regex subset",
    );
  }
});

Deno.test("regex nullable analysis uses the shared AST", () => {
  assertEquals(regexCanMatchEmpty(parsePortableRegex("a?")), true);
  assertEquals(regexCanMatchEmpty(parsePortableRegex("(a|)")), true);
  assertEquals(regexCanMatchEmpty(parsePortableRegex("a+")), false);
});

Deno.test("DFA intersection produces concrete witnesses", () => {
  const left = buildDfa(buildRegexNfa(parsePortableRegex("[A-Z][A-Za-z]*")));
  const right = buildDfa(buildRegexNfa(parsePortableRegex("[A-Za-z]+")));
  const witness = dfaIntersectionWitness(left, right);
  assert(witness);
  assertEquals(witness.text, "A");

  const disjoint = dfaIntersectionWitness(
    buildDfa(buildRegexNfa(parsePortableRegex("[0-9]+"))),
    buildDfa(buildRegexNfa(parsePortableRegex("[A-Z]+"))),
  );
  assertEquals(disjoint, null);
});
