import type { GeneratedFile } from "../ast.ts";
import type { RegexAst } from "../compiler/regex/ast.ts";
import { buildDfa, type Dfa } from "../compiler/regex/dfa.ts";
import { buildLexerDfa } from "../compiler/regex/lexer.ts";
import {
  enforceRegexAstNodeLimit,
  type RegexCompilerLimits,
  RegexResourceLimitError,
} from "../compiler/regex/limits.ts";
import { buildRegexNfa } from "../compiler/regex/nfa.ts";
import type { AnalyzedGrammar, AnalyzedToken } from "../compiler/ir.ts";
import { BabaError } from "../errors.ts";

export interface TreeSitterExternalScanner {
  readonly tokenNames: readonly string[];
  readonly file: GeneratedFile;
}

interface ScannerTokenPlan {
  readonly token: AnalyzedToken;
  readonly consumed: Dfa;
  readonly followedBy: Dfa | undefined;
  readonly followedByEof: boolean;
  readonly notFollowedBy: Dfa | undefined;
  readonly excludedWords: readonly string[];
}

interface EncodedDfas {
  readonly starts: readonly number[];
  readonly accepts: readonly number[];
  readonly transitionRows: readonly number[];
  readonly transitions: readonly EncodedTransition[];
}

interface EncodedTransition {
  readonly start: number;
  readonly end: number;
  readonly target: number;
}

interface EncodedWords {
  readonly tokenRows: readonly number[];
  readonly wordRows: readonly number[];
  readonly codePoints: readonly number[];
}

export function emitTreeSitterExternalScanner(
  analyzed: AnalyzedGrammar,
  regexLimits: RegexCompilerLimits,
): TreeSitterExternalScanner | undefined {
  const guardedTokens = analyzed.tokens.filter((token) =>
    token.kind === "contextual" &&
    token.trailingContext !== undefined &&
    analyzed.reachableTokens.has(token.id)
  );
  if (guardedTokens.length === 0) {
    return undefined;
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(analyzed.name)) {
    throw new BabaError({
      code: "TREE_SITTER_INVALID_SCANNER_NAME",
      severity: "error",
      backend: "tree-sitter",
      message:
        `Tree-sitter external scanner generation requires a C identifier grammar name, got '${analyzed.name}'.`,
    });
  }

  let scannerTokens: ScannerTokenPlan[];
  try {
    scannerTokens = guardedTokens.map((token) =>
      createScannerTokenPlan(token, regexLimits)
    );
    assertScannerCanPreserveGuards(scannerTokens, regexLimits);
  } catch (error) {
    if (error instanceof RegexResourceLimitError) {
      throw new BabaError({
        code: `TREE_SITTER_${error.code}`,
        severity: "error",
        backend: "tree-sitter",
        message:
          `Tree-sitter scanner planning exceeded a resource limit: ${error.message}`,
      });
    }
    throw error;
  }
  return {
    tokenNames: scannerTokens.map((scannerToken) => scannerToken.token.name),
    file: {
      path: "src/scanner.c",
      content: renderScanner(analyzed.name, scannerTokens),
      kind: "source",
      encoding: "utf-8",
    },
  };
}

function createScannerTokenPlan(
  token: AnalyzedToken,
  regexLimits: RegexCompilerLimits,
): ScannerTokenPlan {
  const trailingContext = token.trailingContext;
  if (trailingContext === undefined) {
    throw new Error(
      `Tree-sitter scanner token '${token.name}' is missing its trailing context.`,
    );
  }
  let followedBy: Dfa | undefined;
  if (trailingContext.followedBy !== undefined) {
    followedBy = buildScannerDfa(
      trailingContext.followedBy,
      regexLimits,
    );
  }
  let notFollowedBy: Dfa | undefined;
  if (trailingContext.notFollowedBy !== undefined) {
    notFollowedBy = buildScannerDfa(
      trailingContext.notFollowedBy,
      regexLimits,
    );
  }
  return {
    token,
    consumed: buildScannerDfa(token.pattern, regexLimits),
    followedBy,
    followedByEof: trailingContext.followedByEof,
    notFollowedBy,
    excludedWords: trailingContext.excludedWords,
  };
}

function buildScannerDfa(
  pattern: RegexAst,
  regexLimits: RegexCompilerLimits,
): Dfa {
  enforceRegexAstNodeLimit(pattern, regexLimits);
  return buildDfa(
    buildRegexNfa(pattern, 0, regexLimits),
    undefined,
    regexLimits,
  );
}

function assertScannerCanPreserveGuards(
  scannerTokens: readonly ScannerTokenPlan[],
  regexLimits: RegexCompilerLimits,
): void {
  for (const scannerToken of scannerTokens) {
    if (
      scannerToken.followedBy === undefined &&
      !scannerToken.followedByEof
    ) {
      throwUnsupportedGuard(
        scannerToken.token,
        "a positive lookahead is required before negative guards can be lowered safely",
      );
    }
    if (
      scannerToken.followedBy !== undefined &&
      dfaStateAccepts(
        scannerToken.followedBy,
        scannerToken.followedBy.start,
      )
    ) {
      throwUnsupportedGuard(
        scannerToken.token,
        "nullable positive lookahead cannot preserve longest-match fallback",
      );
    }
  }

  const combined = buildLexerDfa(
    scannerTokens.map((scannerToken) => ({
      ast: scannerToken.token.pattern,
      type: "named",
      priority: scannerToken.token.priority,
      order: scannerToken.token.declarationOrder,
      contextual: true,
    })),
    regexLimits,
  );
  for (const state of combined.states) {
    for (const tokenIndex of state.accepts) {
      const scannerToken = scannerTokens[tokenIndex];
      if (scannerToken === undefined || scannerToken.followedBy === undefined) {
        continue;
      }
      const followedByStart = scannerToken.followedBy.states[
        scannerToken.followedBy.start
      ];
      if (followedByStart === undefined) {
        throw new Error(
          `Tree-sitter scanner token '${scannerToken.token.name}' has no positive guard start state.`,
        );
      }
      if (
        transitionsOverlap(followedByStart.transitions, state.transitions)
      ) {
        throwUnsupportedGuard(
          scannerToken.token,
          "positive lookahead overlaps a longer guarded token match",
        );
      }
    }
  }
}

function transitionsOverlap(
  left: readonly EncodedTransition[],
  right: readonly EncodedTransition[],
): boolean {
  for (const leftTransition of left) {
    for (const rightTransition of right) {
      if (
        leftTransition.start <= rightTransition.end &&
        rightTransition.start <= leftTransition.end
      ) {
        return true;
      }
    }
  }
  return false;
}

function throwUnsupportedGuard(token: AnalyzedToken, reason: string): never {
  throw new BabaError({
    code: "TREE_SITTER_UNSUPPORTED_CONTEXTUAL_GUARD",
    severity: "error",
    backend: "tree-sitter",
    message:
      `Tree-sitter cannot preserve the trailing guard for contextual token '${token.name}': ${reason}.`,
    span: token.span,
  });
}

function dfaStateAccepts(dfa: Dfa, state: number): boolean {
  const candidate = dfa.states[state];
  if (candidate === undefined) {
    throw new Error(`Regex DFA state ${state} is missing.`);
  }
  return candidate.selectedAccept !== null;
}

function renderScanner(
  grammarName: string,
  scannerTokens: readonly ScannerTokenPlan[],
): string {
  const consumed = encodeDfas(
    scannerTokens.map((scannerToken) => scannerToken.consumed),
  );
  const guardDfas: Dfa[] = [];
  const positiveStarts: number[] = [];
  const negativeStarts: number[] = [];
  for (const scannerToken of scannerTokens) {
    positiveStarts.push(appendDfa(guardDfas, scannerToken.followedBy));
    negativeStarts.push(appendDfa(guardDfas, scannerToken.notFollowedBy));
  }
  const guards = encodeDfas(guardDfas);
  const words = encodeWords(scannerTokens);
  let wordStorageCount = words.wordRows.length - 1;
  if (wordStorageCount === 0) {
    wordStorageCount = 1;
  }
  const precedence = scannerTokens
    .map((_scannerToken, index) => index)
    .sort((left, right) =>
      compareScannerTokens(
        scannerTokens[left],
        scannerTokens[right],
      )
    );
  const lines = [
    "// Generated by @mewhhaha/baba. Do not edit by hand.",
    '#include "tree_sitter/parser.h"',
    "",
    "#include <stdbool.h>",
    "#include <stddef.h>",
    "#include <stdint.h>",
    "",
    `#define BABA_TOKEN_COUNT ${scannerTokens.length}`,
    `#define BABA_GUARD_STATE_COUNT ${guards.accepts.length}`,
    `#define BABA_WORD_COUNT ${words.wordRows.length - 1}`,
    `#define BABA_WORD_STORAGE_COUNT ${wordStorageCount}`,
    "",
    "enum TokenType {",
  ];
  for (
    let tokenIndex = 0;
    tokenIndex < scannerTokens.length;
    tokenIndex++
  ) {
    lines.push(`  BABA_EXTERNAL_TOKEN_${tokenIndex},`);
  }
  lines.push(
    "  BABA_ERROR_SENTINEL,",
    "};",
    "",
    "enum GuardStatus {",
    "  BABA_GUARD_PENDING,",
    "  BABA_GUARD_PASSES,",
    "  BABA_GUARD_FAILS,",
    "};",
    "",
    "struct BabaTransition {",
    "  int32_t start;",
    "  int32_t end;",
    "  int32_t target;",
    "};",
    "",
    renderIntegerArray("BABA_TOKEN_STARTS", consumed.starts),
    renderIntegerArray("BABA_TOKEN_ACCEPTS", consumed.accepts),
    renderIntegerArray(
      "BABA_TOKEN_TRANSITION_ROWS",
      consumed.transitionRows,
    ),
    renderTransitionArray("BABA_TOKEN_TRANSITIONS", consumed.transitions),
    renderIntegerArray("BABA_GUARD_ACCEPTS", guards.accepts),
    renderIntegerArray(
      "BABA_GUARD_TRANSITION_ROWS",
      guards.transitionRows,
    ),
    renderTransitionArray("BABA_GUARD_TRANSITIONS", guards.transitions),
    renderIntegerArray("BABA_POSITIVE_STARTS", positiveStarts),
    renderIntegerArray(
      "BABA_POSITIVE_EOF",
      scannerTokens.map((scannerToken) => {
        if (scannerToken.followedByEof) {
          return 1;
        }
        return 0;
      }),
    ),
    renderIntegerArray("BABA_NEGATIVE_STARTS", negativeStarts),
    renderIntegerArray("BABA_TOKEN_WORD_ROWS", words.tokenRows),
    renderIntegerArray("BABA_WORD_ROWS", words.wordRows),
    renderIntegerArray("BABA_WORD_CODE_POINTS", words.codePoints),
    renderIntegerArray("BABA_TOKEN_PRECEDENCE", precedence),
    "",
    ...renderScannerFunctions(grammarName),
  );
  return `${lines.join("\n")}\n`;
}

function appendDfa(dfas: Dfa[], dfa: Dfa | undefined): number {
  if (dfa === undefined) {
    return -1;
  }
  let stateBase = 0;
  for (const existing of dfas) {
    stateBase += existing.states.length;
  }
  dfas.push(dfa);
  return stateBase + dfa.start;
}

function compareScannerTokens(
  left: ScannerTokenPlan | undefined,
  right: ScannerTokenPlan | undefined,
): number {
  if (left === undefined || right === undefined) {
    throw new Error(
      "Tree-sitter scanner precedence references a missing token.",
    );
  }
  const priorityOrder = right.token.priority - left.token.priority;
  if (priorityOrder !== 0) {
    return priorityOrder;
  }
  return left.token.declarationOrder - right.token.declarationOrder;
}

function encodeDfas(dfas: readonly Dfa[]): EncodedDfas {
  const starts: number[] = [];
  const accepts: number[] = [];
  const transitionRows: number[] = [];
  const transitions: EncodedTransition[] = [];
  let stateBase = 0;
  for (const dfa of dfas) {
    starts.push(stateBase + dfa.start);
    for (const state of dfa.states) {
      if (state.selectedAccept === null) {
        accepts.push(0);
      } else {
        accepts.push(1);
      }
      transitionRows.push(transitions.length);
      for (const transition of state.transitions) {
        transitions.push({
          start: transition.start,
          end: transition.end,
          target: stateBase + transition.target,
        });
      }
    }
    stateBase += dfa.states.length;
  }
  transitionRows.push(transitions.length);
  return { starts, accepts, transitionRows, transitions };
}

function encodeWords(
  scannerTokens: readonly ScannerTokenPlan[],
): EncodedWords {
  const tokenRows: number[] = [];
  const wordRows: number[] = [];
  const codePoints: number[] = [];
  for (const scannerToken of scannerTokens) {
    tokenRows.push(wordRows.length);
    for (const word of scannerToken.excludedWords) {
      wordRows.push(codePoints.length);
      for (const character of word) {
        const codePoint = character.codePointAt(0);
        if (codePoint === undefined) {
          throw new Error(
            `Excluded word ${JSON.stringify(word)} contains no code point.`,
          );
        }
        codePoints.push(codePoint);
      }
    }
  }
  tokenRows.push(wordRows.length);
  wordRows.push(codePoints.length);
  return { tokenRows, wordRows, codePoints };
}

function renderIntegerArray(
  name: string,
  values: readonly number[],
): string {
  let rendered = values;
  if (rendered.length === 0) {
    rendered = [0];
  }
  return `static const int32_t ${name}[] = { ${rendered.join(", ")} };`;
}

function renderTransitionArray(
  name: string,
  transitions: readonly EncodedTransition[],
): string {
  if (transitions.length === 0) {
    return `static const struct BabaTransition ${name}[] = { { 0, 0, -1 } };`;
  }
  const rows = transitions.map((transition) =>
    `{ ${transition.start}, ${transition.end}, ${transition.target} }`
  );
  return `static const struct BabaTransition ${name}[] = { ${
    rows.join(", ")
  } };`;
}

function renderScannerFunctions(grammarName: string): string[] {
  const prefix = `tree_sitter_${grammarName}_external_scanner`;
  return [
    "static int32_t baba_transition(",
    "  const int32_t *rows,",
    "  const struct BabaTransition *transitions,",
    "  int32_t state,",
    "  int32_t code_point",
    ") {",
    "  int32_t low = rows[state];",
    "  int32_t high = rows[state + 1];",
    "  while (low < high) {",
    "    int32_t middle = low + (high - low) / 2;",
    "    const struct BabaTransition *transition = &transitions[middle];",
    "    if (code_point < transition->start) {",
    "      high = middle;",
    "      continue;",
    "    }",
    "    if (code_point > transition->end) {",
    "      low = middle + 1;",
    "      continue;",
    "    }",
    "    return transition->target;",
    "  }",
    "  return -1;",
    "}",
    "",
    "static bool baba_word_code_point(int32_t code_point) {",
    "  if (code_point >= 'A' && code_point <= 'Z') {",
    "    return true;",
    "  }",
    "  if (code_point >= 'a' && code_point <= 'z') {",
    "    return true;",
    "  }",
    "  if (code_point >= '0' && code_point <= '9') {",
    "    return true;",
    "  }",
    "  return code_point == '_';",
    "}",
    "",
    "static bool baba_scan_guards(",
    "  TSLexer *lexer,",
    "  const bool *valid_symbols,",
    "  const int32_t *token_states",
    ") {",
    "  bool candidates[BABA_TOKEN_COUNT] = { false };",
    "  int32_t positive_states[BABA_TOKEN_COUNT];",
    "  int32_t negative_states[BABA_TOKEN_COUNT];",
    "  enum GuardStatus positive[BABA_TOKEN_COUNT];",
    "  enum GuardStatus negative[BABA_TOKEN_COUNT];",
    "  enum GuardStatus excluded_words[BABA_TOKEN_COUNT];",
    "  bool word_candidates[BABA_WORD_STORAGE_COUNT] = { false };",
    "  int32_t word_positions[BABA_WORD_STORAGE_COUNT] = { 0 };",
    "",
    "  for (int32_t token = 0; token < BABA_TOKEN_COUNT; token++) {",
    "    int32_t state = token_states[token];",
    "    if (state < 0 || BABA_TOKEN_ACCEPTS[state] == 0) {",
    "      continue;",
    "    }",
    "    if (!valid_symbols[token]) {",
    "      continue;",
    "    }",
    "    candidates[token] = true;",
    "    positive_states[token] = BABA_POSITIVE_STARTS[token];",
    "    negative_states[token] = BABA_NEGATIVE_STARTS[token];",
    "    positive[token] = BABA_GUARD_PENDING;",
    "    if (negative_states[token] < 0) {",
    "      negative[token] = BABA_GUARD_PASSES;",
    "    } else {",
    "      negative[token] = BABA_GUARD_PENDING;",
    "    }",
    "    int32_t word_start = BABA_TOKEN_WORD_ROWS[token];",
    "    int32_t word_end = BABA_TOKEN_WORD_ROWS[token + 1];",
    "    if (word_start == word_end) {",
    "      excluded_words[token] = BABA_GUARD_PASSES;",
    "    } else {",
    "      excluded_words[token] = BABA_GUARD_PENDING;",
    "      for (int32_t word = word_start; word < word_end; word++) {",
    "        word_candidates[word] = true;",
    "      }",
    "    }",
    "  }",
    "",
    "  while (true) {",
    "    bool at_eof = lexer->eof(lexer);",
    "    for (int32_t token = 0; token < BABA_TOKEN_COUNT; token++) {",
    "      if (!candidates[token]) {",
    "        continue;",
    "      }",
    "      if (positive[token] == BABA_GUARD_PENDING) {",
    "        int32_t state = positive_states[token];",
    "        if (state >= 0 && BABA_GUARD_ACCEPTS[state] != 0) {",
    "          positive[token] = BABA_GUARD_PASSES;",
    "        } else if (at_eof && BABA_POSITIVE_EOF[token] != 0) {",
    "          positive[token] = BABA_GUARD_PASSES;",
    "        } else if (at_eof) {",
    "          positive[token] = BABA_GUARD_FAILS;",
    "        }",
    "      }",
    "      if (negative[token] == BABA_GUARD_PENDING) {",
    "        int32_t state = negative_states[token];",
    "        if (BABA_GUARD_ACCEPTS[state] != 0) {",
    "          negative[token] = BABA_GUARD_FAILS;",
    "        } else if (at_eof) {",
    "          negative[token] = BABA_GUARD_PASSES;",
    "        }",
    "      }",
    "      if (excluded_words[token] == BABA_GUARD_PENDING) {",
    "        bool any_word_candidate = false;",
    "        int32_t word_start = BABA_TOKEN_WORD_ROWS[token];",
    "        int32_t word_end = BABA_TOKEN_WORD_ROWS[token + 1];",
    "        for (int32_t word = word_start; word < word_end; word++) {",
    "          if (!word_candidates[word]) {",
    "            continue;",
    "          }",
    "          int32_t position = word_positions[word];",
    "          int32_t length = BABA_WORD_ROWS[word + 1] - BABA_WORD_ROWS[word];",
    "          if (position == length) {",
    "            word_candidates[word] = false;",
    "            if (at_eof || !baba_word_code_point(lexer->lookahead)) {",
    "              excluded_words[token] = BABA_GUARD_FAILS;",
    "              break;",
    "            }",
    "            continue;",
    "          }",
    "          if (at_eof) {",
    "            word_candidates[word] = false;",
    "            continue;",
    "          }",
    "          int32_t expected = BABA_WORD_CODE_POINTS[",
    "            BABA_WORD_ROWS[word] + position",
    "          ];",
    "          if (lexer->lookahead != expected) {",
    "            word_candidates[word] = false;",
    "            continue;",
    "          }",
    "          any_word_candidate = true;",
    "        }",
    "        if (",
    "          excluded_words[token] == BABA_GUARD_PENDING &&",
    "          !any_word_candidate",
    "        ) {",
    "          excluded_words[token] = BABA_GUARD_PASSES;",
    "        }",
    "      }",
    "      if (",
    "        positive[token] == BABA_GUARD_FAILS ||",
    "        negative[token] == BABA_GUARD_FAILS ||",
    "        excluded_words[token] == BABA_GUARD_FAILS",
    "      ) {",
    "        candidates[token] = false;",
    "      }",
    "    }",
    "",
    "    bool has_candidate = false;",
    "    for (int32_t index = 0; index < BABA_TOKEN_COUNT; index++) {",
    "      int32_t token = BABA_TOKEN_PRECEDENCE[index];",
    "      if (!candidates[token]) {",
    "        continue;",
    "      }",
    "      has_candidate = true;",
    "      if (",
    "        positive[token] == BABA_GUARD_PASSES &&",
    "        negative[token] == BABA_GUARD_PASSES &&",
    "        excluded_words[token] == BABA_GUARD_PASSES",
    "      ) {",
    "        lexer->result_symbol = (TSSymbol)token;",
    "        return true;",
    "      }",
    "      break;",
    "    }",
    "    if (!has_candidate || at_eof) {",
    "      return false;",
    "    }",
    "",
    "    int32_t code_point = lexer->lookahead;",
    "    for (int32_t token = 0; token < BABA_TOKEN_COUNT; token++) {",
    "      if (!candidates[token]) {",
    "        continue;",
    "      }",
    "      if (positive[token] == BABA_GUARD_PENDING) {",
    "        int32_t state = positive_states[token];",
    "        if (state < 0) {",
    "          positive[token] = BABA_GUARD_FAILS;",
    "        } else {",
    "          int32_t target = baba_transition(",
    "            BABA_GUARD_TRANSITION_ROWS,",
    "            BABA_GUARD_TRANSITIONS,",
    "            state,",
    "            code_point",
    "          );",
    "          if (target < 0) {",
    "            positive[token] = BABA_GUARD_FAILS;",
    "          } else {",
    "            positive_states[token] = target;",
    "          }",
    "        }",
    "      }",
    "      if (negative[token] == BABA_GUARD_PENDING) {",
    "        int32_t target = baba_transition(",
    "          BABA_GUARD_TRANSITION_ROWS,",
    "          BABA_GUARD_TRANSITIONS,",
    "          negative_states[token],",
    "          code_point",
    "        );",
    "        if (target < 0) {",
    "          negative[token] = BABA_GUARD_PASSES;",
    "        } else {",
    "          negative_states[token] = target;",
    "        }",
    "      }",
    "      if (excluded_words[token] == BABA_GUARD_PENDING) {",
    "        int32_t word_start = BABA_TOKEN_WORD_ROWS[token];",
    "        int32_t word_end = BABA_TOKEN_WORD_ROWS[token + 1];",
    "        for (int32_t word = word_start; word < word_end; word++) {",
    "          if (word_candidates[word]) {",
    "            word_positions[word] += 1;",
    "          }",
    "        }",
    "      }",
    "    }",
    "    lexer->advance(lexer, false);",
    "  }",
    "}",
    "",
    `void *${prefix}_create(void) {`,
    "  return NULL;",
    "}",
    "",
    `void ${prefix}_destroy(void *payload) {`,
    "  (void)payload;",
    "}",
    "",
    `unsigned ${prefix}_serialize(void *payload, char *buffer) {`,
    "  (void)payload;",
    "  (void)buffer;",
    "  return 0;",
    "}",
    "",
    `void ${prefix}_deserialize(`,
    "  void *payload,",
    "  const char *buffer,",
    "  unsigned length",
    ") {",
    "  (void)payload;",
    "  (void)buffer;",
    "  (void)length;",
    "}",
    "",
    `bool ${prefix}_scan(`,
    "  void *payload,",
    "  TSLexer *lexer,",
    "  const bool *valid_symbols",
    ") {",
    "  (void)payload;",
    "  if (valid_symbols[BABA_ERROR_SENTINEL]) {",
    "    return false;",
    "  }",
    "",
    "  int32_t states[BABA_TOKEN_COUNT];",
    "  int32_t targets[BABA_TOKEN_COUNT];",
    "  for (int32_t token = 0; token < BABA_TOKEN_COUNT; token++) {",
    "    if (valid_symbols[token]) {",
    "      states[token] = BABA_TOKEN_STARTS[token];",
    "    } else {",
    "      states[token] = -1;",
    "    }",
    "  }",
    "",
    "  while (!lexer->eof(lexer)) {",
    "    bool any_transition = false;",
    "    for (int32_t token = 0; token < BABA_TOKEN_COUNT; token++) {",
    "      if (states[token] < 0) {",
    "        targets[token] = -1;",
    "        continue;",
    "      }",
    "      targets[token] = baba_transition(",
    "        BABA_TOKEN_TRANSITION_ROWS,",
    "        BABA_TOKEN_TRANSITIONS,",
    "        states[token],",
    "        lexer->lookahead",
    "      );",
    "      if (targets[token] >= 0) {",
    "        any_transition = true;",
    "      }",
    "    }",
    "    if (!any_transition) {",
    "      break;",
    "    }",
    "    lexer->advance(lexer, false);",
    "    for (int32_t token = 0; token < BABA_TOKEN_COUNT; token++) {",
    "      states[token] = targets[token];",
    "    }",
    "  }",
    "",
    "  bool any_candidate = false;",
    "  for (int32_t token = 0; token < BABA_TOKEN_COUNT; token++) {",
    "    int32_t state = states[token];",
    "    if (state >= 0 && BABA_TOKEN_ACCEPTS[state] != 0) {",
    "      any_candidate = true;",
    "      break;",
    "    }",
    "  }",
    "  if (!any_candidate) {",
    "    return false;",
    "  }",
    "  lexer->mark_end(lexer);",
    "  return baba_scan_guards(lexer, valid_symbols, states);",
    "}",
  ];
}
