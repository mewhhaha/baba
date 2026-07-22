import { assert, assertEquals, assertThrowsIncludes } from "./helpers.ts";
import { buildDfa } from "../src/compiler/regex/dfa.ts";
import { dfaIntersectionWitness } from "../src/compiler/regex/intersect.ts";
import { buildRegexNfa } from "../src/compiler/regex/nfa.ts";
import { regexCanMatchEmpty } from "../src/compiler/regex/nullable.ts";
import { parseContextualRegex } from "../src/compiler/regex/contextual.ts";
import { parsePortableRegex } from "../src/compiler/regex/parser.ts";

Deno.test("portable regex parser rejects nonportable constructs", () => {
  for (const pattern of ["a(?=b)", "a+?", "\\s+", "(?:a)", "^a"]) {
    assertThrowsIncludes(
      () => parsePortableRegex(pattern),
      "outside Baba's portable regex subset",
    );
  }
});

Deno.test("contextual regex parser separates terminal lookahead guards", () => {
  const contextual = parseContextualRegex(
    "[ \\t]+(?=$|[\\r\\n;}])(?!(if|in)\\b)",
  );

  assertEquals(contextual.patternSource, "[ \\t]+");
  assertEquals(contextual.trailingContext?.followedByEof, true);
  assert(contextual.trailingContext?.followedBy);
  assertEquals(contextual.trailingContext.excludedWords.join(","), "if,in");
  assertEquals(contextual.trailingContext.notFollowedBy, undefined);
});

Deno.test("contextual regex parser rejects lookahead inside consumed text", () => {
  assertThrowsIncludes(
    () => parseContextualRegex("a(?=b)c"),
    "Only terminal lookahead assertions",
  );
});

Deno.test("regex nullable analysis uses the shared AST", () => {
  assertEquals(regexCanMatchEmpty(parsePortableRegex("a?")), true);
  assertEquals(regexCanMatchEmpty(parsePortableRegex("(a|)")), true);
  assertEquals(regexCanMatchEmpty(parsePortableRegex("a+")), false);
});

Deno.test("portable regex parser supports Unicode letter and number properties", () => {
  const identifier = buildDfa(
    buildRegexNfa(parsePortableRegex("[_\\p{L}][_\\p{L}\\p{N}]*")),
  );
  const greekName = buildDfa(buildRegexNfa(parsePortableRegex("λ2")));
  const greekWitness = dfaIntersectionWitness(identifier, greekName);
  assert(greekWitness);
  assertEquals(greekWitness.text, "λ2");

  const nonNumber = buildDfa(buildRegexNfa(parsePortableRegex("\\P{N}+")));
  const digits = buildDfa(buildRegexNfa(parsePortableRegex("[0-9]+")));
  assertEquals(dfaIntersectionWitness(nonNumber, digits), null);
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
