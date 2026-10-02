import { assert, assertEquals, assertThrowsIncludes } from "./helpers.ts";
import {
  buildDfa,
  computeDfaAlphabet,
  minimizeDfa,
} from "../src/compiler/regex/dfa.ts";
import { dfaIntersectionWitness } from "../src/compiler/regex/intersect.ts";
import { buildRegexNfa } from "../src/compiler/regex/nfa.ts";
import { RegexResourceLimitError } from "../src/compiler/regex/limits.ts";
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

Deno.test("DFA intersection keeps shortest witness order across fragmented rows", () => {
  const left = buildDfa(
    buildRegexNfa(parsePortableRegex("(a[de]|c[fg]|😀[h-j])")),
  );
  const right = buildDfa(
    buildRegexNfa(parsePortableRegex("(a[cd]|c[g-j]|😀[g-i])")),
  );
  const witness = dfaIntersectionWitness(left, right);
  assert(witness);
  assertEquals(witness.text, "ad");
  const unorderedLeft = {
    ...left,
    states: left.states.map((state) => ({
      ...state,
      transitions: [...state.transitions].reverse(),
    })),
  };
  assertEquals(
    JSON.stringify(dfaIntersectionWitness(unorderedLeft, right)),
    JSON.stringify(witness),
  );
  try {
    dfaIntersectionWitness(left, right, { overlapProductStateLimit: 1 });
    throw new Error(
      "Expected DFA intersection to reach its product-state limit.",
    );
  } catch (error) {
    assert(error instanceof RegexResourceLimitError);
    assertEquals(error.code, "REGEX_OVERLAP_WORK_LIMIT");
    assertEquals(error.limit, 1);
    assertEquals(
      error.message,
      "Regex overlap product-state limit exceeded (1).",
    );
  }
});

Deno.test("DFA intersection retains target tie order for overlapping rows", () => {
  const leftStates = [
    {
      id: 0,
      nfaStates: [],
      accepts: [],
      selectedAccept: null,
      transitions: [
        { start: 98, end: 99, target: 1 },
        { start: 97, end: 100, target: 2 },
      ],
    },
    { id: 1, nfaStates: [], accepts: [0], selectedAccept: 0, transitions: [] },
    { id: 2, nfaStates: [], accepts: [0], selectedAccept: 0, transitions: [] },
  ];
  const rightStates = [
    {
      id: 0,
      nfaStates: [],
      accepts: [],
      selectedAccept: null,
      transitions: [
        { start: 97, end: 98, target: 1 },
        { start: 98, end: 100, target: 2 },
      ],
    },
    { id: 1, nfaStates: [], accepts: [0], selectedAccept: 0, transitions: [] },
    { id: 2, nfaStates: [], accepts: [0], selectedAccept: 0, transitions: [] },
  ];
  assertEquals(
    JSON.stringify(dfaIntersectionWitness(
      {
        start: 0,
        states: leftStates,
        alphabet: computeDfaAlphabet(leftStates),
      },
      {
        start: 0,
        states: rightStates,
        alphabet: computeDfaAlphabet(rightStates),
      },
    )),
    JSON.stringify({ text: "a", leftState: 2, rightState: 1 }),
  );
});

Deno.test("DFA construction preserves sparse overlapping ranges and candidate sets", () => {
  const nfa = {
    start: 0,
    states: [
      { epsilon: [1, 2], transitions: [], accepts: [] },
      {
        epsilon: [],
        transitions: [{
          ranges: [
            { start: 97, end: 99 },
            { start: 0x1f600, end: 0x1f602 },
          ],
          target: 3,
        }],
        accepts: [],
      },
      {
        epsilon: [],
        transitions: [{
          ranges: [
            { start: 98, end: 100 },
            { start: 0x1f601, end: 0x1f603 },
          ],
          target: 4,
        }],
        accepts: [],
      },
      { epsilon: [1], transitions: [], accepts: [2] },
      { epsilon: [2], transitions: [], accepts: [1] },
    ],
  };
  const dfa = buildDfa(nfa);
  const overlappingTransitions = [
    { start: 97, end: 97, target: 1 },
    { start: 98, end: 99, target: 2 },
    { start: 100, end: 100, target: 3 },
    { start: 0x1f600, end: 0x1f600, target: 1 },
    { start: 0x1f601, end: 0x1f602, target: 2 },
    { start: 0x1f603, end: 0x1f603, target: 3 },
  ];
  assertEquals(dfa.start, 0);
  assertEquals(
    JSON.stringify(dfa.states),
    JSON.stringify([
      {
        id: 0,
        nfaStates: [0, 1, 2],
        accepts: [],
        selectedAccept: null,
        transitions: overlappingTransitions,
      },
      {
        id: 1,
        nfaStates: [1, 3],
        accepts: [2],
        selectedAccept: 2,
        transitions: [
          { start: 97, end: 99, target: 1 },
          { start: 0x1f600, end: 0x1f602, target: 1 },
        ],
      },
      {
        id: 2,
        nfaStates: [1, 2, 3, 4],
        accepts: [1, 2],
        selectedAccept: 1,
        transitions: overlappingTransitions,
      },
      {
        id: 3,
        nfaStates: [2, 4],
        accepts: [1],
        selectedAccept: 1,
        transitions: [
          { start: 98, end: 100, target: 3 },
          { start: 0x1f601, end: 0x1f603, target: 3 },
        ],
      },
    ]),
  );
  const asciiClasses = new Array(128).fill(0);
  asciiClasses[97] = 1;
  asciiClasses[98] = 2;
  asciiClasses[99] = 2;
  asciiClasses[100] = 3;
  assertEquals(
    JSON.stringify(dfa.alphabet),
    JSON.stringify({
      classCount: 4,
      asciiClasses,
      aboveAsciiRanges: [
        { start: 128, end: 0x1f5ff, classId: 0 },
        { start: 0x1f600, end: 0x1f600, classId: 1 },
        { start: 0x1f601, end: 0x1f602, classId: 2 },
        { start: 0x1f603, end: 0x1f603, classId: 3 },
        { start: 0x1f604, end: 0x10ffff, classId: 0 },
      ],
    }),
  );
  try {
    buildDfa(nfa, undefined, { dfaStateLimit: 3 });
    throw new Error("Expected DFA construction to reach its state limit.");
  } catch (error) {
    assert(error instanceof RegexResourceLimitError);
    assertEquals(error.code, "REGEX_DFA_STATE_LIMIT");
    assertEquals(error.limit, 3);
    assertEquals(error.message, "Regex DFA state limit exceeded (3).");
  }
});

Deno.test("DFA minimization preserves complete accepting candidates", () => {
  const states = [
    {
      id: 0,
      nfaStates: [0],
      accepts: [],
      selectedAccept: null,
      transitions: [
        { start: 97, end: 97, target: 1 },
        { start: 98, end: 98, target: 2 },
      ],
    },
    {
      id: 1,
      nfaStates: [1],
      accepts: [2, 4],
      selectedAccept: 2,
      transitions: [],
    },
    {
      id: 2,
      nfaStates: [2],
      accepts: [2, 4],
      selectedAccept: 2,
      transitions: [],
    },
  ];
  const minimized = minimizeDfa({
    start: 0,
    states,
    alphabet: computeDfaAlphabet(states),
  });

  assertEquals(minimized.states.length, 2);
  assertEquals(minimized.states[1].accepts.join(","), "2,4");
  assertEquals(
    JSON.stringify(minimized.states[0].transitions),
    JSON.stringify([{ start: 97, end: 98, target: 1 }]),
  );
});

Deno.test("DFA alphabet keeps first-match semantics for unordered overlapping rows", () => {
  const alphabet = computeDfaAlphabet([{
    id: 0,
    nfaStates: [],
    accepts: [],
    selectedAccept: null,
    transitions: [
      { start: 20, end: 30, target: 1 },
      { start: 10, end: 25, target: 2 },
    ],
  }]);
  const asciiClasses = new Array(128).fill(0);
  asciiClasses.fill(1, 10, 20);
  asciiClasses.fill(2, 20, 31);
  assertEquals(
    JSON.stringify(alphabet),
    JSON.stringify({
      classCount: 3,
      asciiClasses,
      aboveAsciiRanges: [{ start: 128, end: 0x10ffff, classId: 0 }],
    }),
  );
});
