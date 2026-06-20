import {
  applyBundle,
  assert,
  assertEquals,
  compile,
  denoCheck,
  parseGrammar,
} from "./helpers.ts";
import { buildDfa } from "../src/compiler/regex/dfa.ts";
import { buildRegexNfa } from "../src/compiler/regex/nfa.ts";
import { parsePortableRegex } from "../src/compiler/regex/parser.ts";

Deno.test("fuzz: generated EBNF sources parse and compile deterministically", () => {
  const random = seededRandom(0xBABA);
  for (let index = 0; index < 50; index++) {
    const terminals = ["A", "B", "C"].slice(0, 1 + randomInt(random, 3));
    const body = randomSequence(random, terminals);
    const source = [
      "token A = /a+/ ;",
      "token B = /b+/ ;",
      "token C = /c+/ ;",
      `module = ${body} ;`,
    ].join("\n");
    parseGrammar(source);
    const first = compile(source, { targets: ["typescript"] });
    const second = compile(source, { targets: ["typescript"] });
    assert(first.bundle, first.diagnostics.map((d) => d.message).join("\n"));
    assert(second.bundle);
    assertEquals(
      first.bundle.files.map((file) => file.content).join("\n"),
      second.bundle.files.map((file) => file.content).join("\n"),
    );
  }
});

Deno.test("fuzz: portable regexes parse and compile to DFAs", () => {
  const random = seededRandom(0xC0FFEE);
  for (let index = 0; index < 100; index++) {
    const pattern = randomRegex(random, 0);
    const ast = parsePortableRegex(pattern);
    const dfa = buildDfa(buildRegexNfa(ast));
    assert(dfa.states.length > 0);
  }
});

Deno.test("fuzz: generated lexer advances and parse agrees with parseTokens", async () => {
  const source = `
    token A = /a+/ ;
    token B = /b+/ ;
    skip WS = / +/ ;
    module = (A | B)* ;
  `;
  const result = compile(source, { targets: ["typescript"] });
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const dir = await Deno.makeTempDir();
  try {
    await applyBundle(result.bundle, { root: dir });
    await denoCheck(`${dir}/typescript/mod.ts`);
    const mod = await import(`file://${dir}/typescript/mod.ts`);
    const random = seededRandom(0x1234);
    for (let index = 0; index < 100; index++) {
      const sample = randomSource(random);
      const lexed = mod.lex(sample);
      assertEquals(lexed.diagnostics.length, 0);
      let previousEnd = 0;
      for (const token of lexed.tokens) {
        assert(token.span.start >= previousEnd);
        assert(token.type === "eof" || token.span.end > token.span.start);
        previousEnd = token.span.end;
      }
      assertEquals(previousEnd, sample.length);
      const parsed = mod.parse(sample);
      const parsedTokens = mod.parseTokens(lexed.source, lexed.tokens);
      assertEquals(parsed.ok, parsedTokens.ok);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

function randomSequence(random: () => number, terminals: readonly string[]) {
  const length = 1 + randomInt(random, 4);
  const items: string[] = [];
  for (let index = 0; index < length; index++) {
    items.push(terminals[randomInt(random, terminals.length)]);
  }
  return items.join(" ");
}

function randomRegex(random: () => number, depth: number): string {
  if (depth > 2) return randomRegexAtom(random, depth);
  const choice = randomInt(random, 6);
  if (choice === 0) return randomRegexAtom(random, depth);
  if (choice === 1) return `${randomRegexAtom(random, depth)}?`;
  if (choice === 2) return `${randomRegexAtom(random, depth)}*`;
  if (choice === 3) return `${randomRegexAtom(random, depth)}+`;
  if (choice === 4) {
    return `${randomRegex(random, depth + 1)}${randomRegex(random, depth + 1)}`;
  }
  return `(${randomRegex(random, depth + 1)}|${
    randomRegex(random, depth + 1)
  })`;
}

function randomRegexAtom(random: () => number, depth: number): string {
  const atoms = ["a", "b", "[a-c]", "[^x-z]"];
  if (depth > 2 || randomInt(random, 3) !== 0) {
    return atoms[randomInt(random, atoms.length)];
  }
  return `(${randomRegex(random, depth + 1)})`;
}

function randomSource(random: () => number): string {
  let source = "";
  for (let index = 0; index < 50; index++) {
    const kind = randomInt(random, 3);
    const length = 1 + randomInt(random, 8);
    source += kind === 0
      ? "a".repeat(length)
      : kind === 1
      ? "b".repeat(length)
      : " ".repeat(length);
  }
  return source;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomInt(random: () => number, upperExclusive: number): number {
  return Math.floor(random() * upperExclusive);
}
