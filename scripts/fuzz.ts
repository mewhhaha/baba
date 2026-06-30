import { analyzeGrammar } from "../src/compiler/grammar_analysis.ts";
import {
  buildGrammarLexerPlan,
  lexGrammar,
} from "../src/compiler/grammar_lexer.ts";
import {
  buildGrammarParserCorePlan,
  recoverGrammarParse,
  validateGrammarParse,
} from "../src/compiler/grammar_parser_core.ts";
import {
  buildGrammarPortablePlan,
  validateGrammarPortablePlan,
} from "../src/compiler/grammar_portable_plan.ts";
import { buildDfa } from "../src/compiler/regex/dfa.ts";
import { buildRegexNfa } from "../src/compiler/regex/nfa.ts";
import { parsePortableRegex } from "../src/compiler/regex/parser.ts";
import { parseGrammarSource } from "../src/grammar.ts";

interface FuzzOptions {
  readonly seed: number;
  readonly maxTimeMs: number;
  readonly artifacts: string;
}

interface FuzzStats {
  readonly seed: number;
  readonly iterations: number;
  readonly elapsedMs: number;
  readonly artifacts: string;
}

if (import.meta.main) {
  const options = parseArgs(Deno.args);
  const started = performance.now();
  let iterations = 0;
  try {
    const random = seededRandom(options.seed);
    while (performance.now() - started < options.maxTimeMs) {
      const index = iterations;
      fuzzRegex(random, index);
      fuzzGrammarParser(random, index);
      fuzzLexerParserRecovery(random, index);
      fuzzPortablePlan(random, index);
      iterations++;
    }
  } catch (error) {
    await Deno.mkdir(options.artifacts, { recursive: true });
    const path = `${options.artifacts}/failure-${Date.now()}.txt`;
    let message = String(error);
    if (error instanceof Error) {
      message = error.stack || error.message;
    }
    await Deno.writeTextFile(path, message);
    console.error(`fuzz failure artifact: ${path}`);
    throw error;
  } finally {
    const stats: FuzzStats = {
      seed: options.seed,
      iterations,
      elapsedMs: Math.round(performance.now() - started),
      artifacts: options.artifacts,
    };
    console.log(JSON.stringify(stats, null, 2));
  }
}

function fuzzRegex(random: () => number, index: number): void {
  const pattern = randomRegex(random, 0);
  withContext("regex", index, pattern, () => {
    const ast = parsePortableRegex(pattern);
    const dfa = buildDfa(buildRegexNfa(ast));
    if (dfa.states.length === 0) {
      throw new Error("regex DFA has no states.");
    }
  });
}

function fuzzGrammarParser(random: () => number, index: number): void {
  const grammar = randomGrammar(random, `Generated${index}`);
  withContext("grammar", index, grammar, () => {
    const parsed = parseGrammarSource(grammar);
    if (parsed.diagnostics.length > 0) {
      throw new Error(
        parsed.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
      );
    }
    if (!parsed.grammar) {
      throw new Error("parser returned no grammar.");
    }
    const analyzed = analyzeGrammar(parsed.grammar);
    if (analyzed.rules.length === 0) {
      throw new Error("analyzer returned no rules.");
    }
  });
}

function fuzzLexerParserRecovery(random: () => number, index: number): void {
  const source = randomSource(random);
  const grammar = randomGrammar(random, `Runtime${index}`);
  withContext("lexer-parser-recovery", index, source, () => {
    const parsed = parseGrammarSource(grammar);
    if (!parsed.grammar) {
      throw new Error("parser returned no grammar.");
    }
    const analyzed = analyzeGrammar(parsed.grammar);
    const lexer = buildGrammarLexerPlan(analyzed);
    const lexed = lexGrammar(lexer, source, { preserveTrivia: false });
    for (const token of lexed.tokens) {
      if (token.kind !== "eof" && token.span.end <= token.span.start) {
        throw new Error("lexer failed to advance.");
      }
    }
    const parser = buildGrammarParserCorePlan(analyzed);
    validateGrammarParse(parser, source);
    recoverGrammarParse(parser, source, 8);
  });
}

function fuzzPortablePlan(random: () => number, index: number): void {
  const parsed = parseGrammarSource(randomGrammar(random, `Portable${index}`));
  if (!parsed.grammar) {
    throw new Error("parser returned no grammar.");
  }
  const analyzed = analyzeGrammar(parsed.grammar);
  const built = buildGrammarPortablePlan(analyzed);
  if (!built.plan) {
    throw new Error(
      built.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
    );
  }
  const copy = structuredClone(built.plan) as {
    parser: { startState: number };
  };
  copy.parser.startState = 999999;
  const diagnostics = validateGrammarPortablePlan(copy);
  if (diagnostics.length === 0) {
    throw new Error("mutated portable plan passed validation.");
  }
}

function parseArgs(args: readonly string[]): FuzzOptions {
  let seed = 0xBABA;
  let maxTimeMs = 1000;
  let artifacts = "tmp/fuzz-artifacts";
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--seed") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Expected value after --seed.");
      }
      seed = Number(value);
      index++;
    } else if (arg === "--max-time-ms") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Expected value after --max-time-ms.");
      }
      maxTimeMs = Number(value);
      index++;
    } else if (arg === "--artifacts") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Expected value after --artifacts.");
      }
      artifacts = value;
      index++;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: deno task test:fuzz -- --seed 12345 --max-time-ms 30000 --artifacts tmp/fuzz-artifacts",
      );
      Deno.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(seed) || !Number.isInteger(seed)) {
    throw new Error("--seed must be an integer.");
  }
  if (!Number.isFinite(maxTimeMs) || maxTimeMs <= 0) {
    throw new Error("--max-time-ms must be positive.");
  }
  return { seed, maxTimeMs, artifacts };
}

function randomGrammar(random: () => number, name: string): string {
  const sequence: string[] = [];
  const choices = ["A", "B", "C"];
  for (const choice of choices) {
    sequence.push(choice);
    if (randomInt(random, 2) === 0) {
      sequence.push(choice);
    }
  }
  return `
    grammar ${name}
    token A = "a" ;
    token B = "b" ;
    token C = "c" ;
    skip Space channel trivia = /[ ]+/ ;
    module = ${sequence.join(" ")} ;
  `;
}

function randomRegex(random: () => number, depth: number): string {
  if (depth > 2) {
    return randomRegexAtom(random);
  }
  const choice = randomInt(random, 6);
  if (choice === 0) {
    return randomRegexAtom(random);
  }
  if (choice === 1) {
    return `${randomRegexAtom(random)}?`;
  }
  if (choice === 2) {
    return `${randomRegexAtom(random)}*`;
  }
  if (choice === 3) {
    return `${randomRegexAtom(random)}+`;
  }
  if (choice === 4) {
    return `${randomRegex(random, depth + 1)}${randomRegex(random, depth + 1)}`;
  }
  return `(${randomRegex(random, depth + 1)}|${
    randomRegex(random, depth + 1)
  })`;
}

function randomRegexAtom(random: () => number): string {
  const atoms = ["a", "b", "c", "[a-c]"];
  return atoms[randomInt(random, atoms.length)];
}

function randomSource(random: () => number): string {
  const alphabet = ["a", "b", "c", " "];
  let source = "";
  const length = 1 + randomInt(random, 24);
  for (let index = 0; index < length; index++) {
    source += alphabet[randomInt(random, alphabet.length)];
  }
  return source;
}

function withContext(
  layer: string,
  index: number,
  input: string,
  action: () => void,
): void {
  try {
    action();
  } catch (error) {
    let message = String(error);
    if (error instanceof Error) {
      message = error.message;
    }
    throw new Error(
      [
        `Fuzz failure in ${layer}.`,
        `case index: ${index}`,
        `input: ${JSON.stringify(input)}`,
        "Persist this case under fixtures/parser/ before changing semantics.",
        message,
      ].join("\n"),
    );
  }
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
