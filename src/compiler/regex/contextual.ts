import type { RegexAst } from "./ast.ts";
import { type RegexCompilerLimits, RegexResourceLimitError } from "./limits.ts";
import { parsePortableRegex, RegexSyntaxError } from "./parser.ts";

export interface ContextualRegex {
  readonly patternSource: string;
  readonly pattern: RegexAst;
  readonly trailingContext: ContextualTrailingContext | undefined;
}

export interface ContextualTrailingContext {
  readonly followedBy: RegexAst | undefined;
  readonly followedByEof: boolean;
  readonly notFollowedBy: RegexAst | undefined;
  readonly excludedWords: readonly string[];
}

/** Parses terminal lookahead assertions without making them consuming regex nodes. */
export function parseContextualRegex(
  source: string,
  limits: RegexCompilerLimits = {},
): ContextualRegex {
  const sourceLimit = limits.sourceLengthLimit;
  if (sourceLimit !== undefined && source.length > sourceLimit) {
    throw new RegexResourceLimitError(
      "REGEX_SOURCE_LIMIT",
      `regex source has ${source.length} UTF-16 code units, exceeding the configured limit (${sourceLimit}).`,
      sourceLimit,
    );
  }
  const assertionStart = firstTrailingAssertion(source);
  if (assertionStart === -1) {
    return {
      patternSource: source,
      pattern: parsePortableRegex(source, limits),
      trailingContext: undefined,
    };
  }

  const patternSource = source.slice(0, assertionStart);
  const pattern = parsePortableRegex(patternSource, limits);
  let followedBy: RegexAst | undefined;
  let followedByEof = false;
  let notFollowedBy: RegexAst | undefined;
  let excludedWords: readonly string[] = [];
  let offset = assertionStart;

  while (offset < source.length) {
    const positive = source.startsWith("(?=", offset);
    const negative = source.startsWith("(?!", offset);
    if (!positive && !negative) {
      throw new RegexSyntaxError(
        "Only terminal lookahead assertions are supported on contextual tokens",
        offset,
      );
    }
    const assertion = readAssertion(source, offset);
    if (positive) {
      if (followedBy !== undefined || followedByEof) {
        throw new RegexSyntaxError(
          "A contextual token may declare only one positive lookahead",
          offset,
        );
      }
      const alternatives = topLevelAlternatives(assertion.source);
      const regexAlternatives = alternatives.filter((alternative) =>
        alternative !== "$"
      );
      followedByEof = alternatives.length !== regexAlternatives.length;
      if (regexAlternatives.length > 0) {
        followedBy = parsePortableRegex(
          regexAlternatives.join("|"),
          limits,
        );
      }
    } else {
      if (notFollowedBy !== undefined || excludedWords.length > 0) {
        throw new RegexSyntaxError(
          "A contextual token may declare only one negative lookahead",
          offset,
        );
      }
      const words = negativeWordAlternatives(assertion.source);
      if (words !== undefined) {
        excludedWords = words;
      } else {
        if (containsUnescapedEof(assertion.source)) {
          throw new RegexSyntaxError(
            "EOF is supported only in positive contextual lookahead",
            offset,
          );
        }
        notFollowedBy = parsePortableRegex(assertion.source, limits);
      }
    }
    offset = assertion.end;
  }

  return {
    patternSource,
    pattern,
    trailingContext: {
      followedBy,
      followedByEof,
      notFollowedBy,
      excludedWords,
    },
  };
}

function firstTrailingAssertion(source: string): number {
  let inClass = false;
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < source.length - 2; index++) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[") {
      inClass = true;
      continue;
    }
    if (character === "]") {
      inClass = false;
      continue;
    }
    if (inClass) {
      continue;
    }
    if (character === "(" && source[index + 1] === "?") {
      if (depth !== 0) {
        throw new RegexSyntaxError(
          "Lookahead assertions must follow the complete contextual token pattern",
          index,
        );
      }
      return index;
    }
    if (character === "(") {
      depth++;
      continue;
    }
    if (character === ")") {
      depth--;
    }
  }
  return -1;
}

function readAssertion(
  source: string,
  start: number,
): { readonly source: string; readonly end: number } {
  let depth = 1;
  let inClass = false;
  let escaped = false;
  for (let index = start + 3; index < source.length; index++) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[") {
      inClass = true;
      continue;
    }
    if (character === "]") {
      inClass = false;
      continue;
    }
    if (inClass) {
      continue;
    }
    if (character === "(") {
      depth++;
      continue;
    }
    if (character !== ")") {
      continue;
    }
    depth--;
    if (depth === 0) {
      return {
        source: source.slice(start + 3, index),
        end: index + 1,
      };
    }
  }
  throw new RegexSyntaxError("Unterminated contextual lookahead", start);
}

function topLevelAlternatives(source: string): string[] {
  const alternatives: string[] = [];
  let start = 0;
  let depth = 0;
  let inClass = false;
  let escaped = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[") {
      inClass = true;
      continue;
    }
    if (character === "]") {
      inClass = false;
      continue;
    }
    if (inClass) {
      continue;
    }
    if (character === "(") {
      depth++;
      continue;
    }
    if (character === ")") {
      depth--;
      continue;
    }
    if (character === "|" && depth === 0) {
      alternatives.push(source.slice(start, index));
      start = index + 1;
    }
  }
  alternatives.push(source.slice(start));
  return alternatives;
}

function negativeWordAlternatives(
  source: string,
): readonly string[] | undefined {
  if (!source.endsWith("\\b")) {
    return undefined;
  }
  let wordsSource = source.slice(0, -2);
  const grouped = wordsSource.startsWith("(") && wordsSource.endsWith(")");
  if (grouped) {
    wordsSource = wordsSource.slice(1, -1);
  } else if (wordsSource.includes("|")) {
    return undefined;
  }
  const words = wordsSource.split("|");
  if (
    words.length === 0 ||
    words.some((word) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(word))
  ) {
    return undefined;
  }
  return words;
}

function containsUnescapedEof(source: string): boolean {
  let escaped = false;
  let inClass = false;
  for (const character of source) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[") {
      inClass = true;
      continue;
    }
    if (character === "]") {
      inClass = false;
      continue;
    }
    if (character === "$" && !inClass) {
      return true;
    }
  }
  return false;
}
