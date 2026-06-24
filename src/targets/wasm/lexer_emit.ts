import type { AnalyzedGrammar } from "../../compiler/ir.ts";
import type { Dfa } from "../../compiler/regex/dfa.ts";
import { emitRuntimeLanguageTypeScriptFunction } from "../runtime/language.ts";
import {
  createLexerSpecRuntimeProgram,
  createParserTokenRecordRuntimeProgram,
  createSourceTextRuntimeProgram,
  RUNTIME_LEXER_SPEC_LITERAL,
  RUNTIME_LEXER_SPEC_TRIVIA,
  RUNTIME_LEXER_TOKEN_EMIT_TOKEN,
  RUNTIME_NO_LEXER_SPEC,
  RUNTIME_NO_TERMINAL,
  RUNTIME_PUBLIC_TOKEN_EOF,
  RUNTIME_PUBLIC_TOKEN_ERROR,
  RUNTIME_PUBLIC_TOKEN_LITERAL,
  RUNTIME_PUBLIC_TOKEN_MAIN,
  RUNTIME_PUBLIC_TOKEN_TRIVIA,
} from "../runtime/language_sources.ts";
import { emitPublicLexDiagnosticMaterializer } from "../runtime/public_lex_diagnostic_materializer.ts";
import { emitPublicLexResultMaterializer } from "../runtime/public_lex_result_materializer.ts";
import { emitPublicSourceTextBoundary } from "../runtime/public_source_text.ts";
import { emitPublicTokenMaterializer } from "../runtime/public_token_materializer.ts";
import {
  type PortableParserPlanV1,
  portablePlanToDfa,
} from "../runtime/portable_plan.ts";
import type { BnfGrammar } from "../typescript/bnf.ts";

interface WasmNamedLexerSpec {
  readonly kind: string;
  readonly channel: "main" | "trivia";
  readonly terminal: number;
}

interface WasmLiteralLexerSpec {
  readonly literal: string;
  readonly terminal: number;
}

interface WasmContextualLexerPlan {
  readonly transitions: readonly (readonly (readonly [
    start: number,
    end: number,
    target: number,
  ])[])[];
  readonly asciiTransitions: readonly (readonly number[])[] | null;
  readonly acceptCandidates: readonly (readonly number[])[];
}

export function emitWasmLexer(
  analyzed: AnalyzedGrammar,
  bnf: BnfGrammar,
  preserveTrivia: boolean,
): string {
  const namedTerminals = new Map(
    bnf.terminals
      .filter((terminal) => terminal.kind === "named")
      .map((terminal) => [terminal.tokenId, terminal.id]),
  );
  const literalTerminals = new Map(
    bnf.terminals
      .filter((terminal) => terminal.kind === "literal")
      .map((terminal) => [terminal.literalId, terminal.id]),
  );
  const namedSpecs = analyzed.tokens
    .filter((token) =>
      token.kind === "skip" ||
      (token.kind === "token" && analyzed.reachableTokens.has(token.id))
    )
    .map((token): WasmNamedLexerSpec => ({
      kind: token.name,
      channel: token.kind === "skip" ? "trivia" : "main",
      terminal: token.kind === "skip" ? -1 : namedTerminals.get(token.id) ?? -1,
    }));
  const literalSpecs = analyzed.literals
    .filter((literal) => analyzed.reachableLiterals.has(literal.id))
    .map((literal): WasmLiteralLexerSpec => ({
      literal: literal.value,
      terminal: literalTerminals.get(literal.id) ?? -1,
    }));
  return emitWasmLexerSource(namedSpecs, literalSpecs, preserveTrivia, null);
}

export function emitWasmLexerFromPortablePlan(
  plan: PortableParserPlanV1,
  preserveTrivia: boolean,
): string {
  const namedSpecs = plan.lexer.specifications
    .filter((spec) => spec.type === "named")
    .map((spec): WasmNamedLexerSpec => {
      const token = plan.symbols.tokens[spec.tokenId];
      return {
        kind: token?.name ?? `token_${spec.tokenId}`,
        channel: spec.channel,
        terminal: spec.terminalId ?? -1,
      };
    });
  const literalSpecs = plan.lexer.specifications
    .filter((spec) => spec.type === "literal")
    .map((spec): WasmLiteralLexerSpec => {
      const literal = plan.symbols.literals[spec.literalId];
      return {
        literal: literal?.value ?? "",
        terminal: spec.terminalId,
      };
    });
  const dfa = portablePlanToDfa(plan);
  const lexerSpecs = plan.lexer.specifications.map((spec) => ({
    type: spec.literal ? "literal" as const : "named" as const,
    priority: spec.priority,
    order: spec.order,
  }));
  const contextual: WasmContextualLexerPlan = {
    transitions: dfa.states.map((state) =>
      state.transitions.map((transition) =>
        [transition.start, transition.end, transition.target] as const
      )
    ),
    asciiTransitions: buildAsciiTransitionRows(dfa),
    acceptCandidates: dfa.states.map((state) =>
      orderAcceptCandidates(lexerSpecs, state.accepts)
    ),
  };
  return emitWasmLexerSource(
    namedSpecs,
    literalSpecs,
    preserveTrivia,
    contextual,
  );
}

function emitWasmLexerSource(
  namedSpecs: readonly WasmNamedLexerSpec[],
  literalSpecs: readonly WasmLiteralLexerSpec[],
  preserveTrivia: boolean,
  contextual: WasmContextualLexerPlan | null,
): string {
  const tokenRecordRuntimeProgram = createParserTokenRecordRuntimeProgram();
  const lexerSpecRuntimeProgram = createLexerSpecRuntimeProgram({
    specs: [
      ...namedSpecs.map((spec, payload) =>
        [
          spec.channel === "trivia" ? RUNTIME_LEXER_SPEC_TRIVIA : 0,
          payload,
          spec.terminal,
        ] as const
      ),
      ...literalSpecs.map((spec, payload) =>
        [
          RUNTIME_LEXER_SPEC_LITERAL,
          payload,
          spec.terminal,
        ] as const
      ),
    ],
  });
  const sourceTextRuntimeProgram = createSourceTextRuntimeProgram();
  const runtimeProgram = {
    name: "wasm_lexer_adapter_runtime",
    entry: tokenRecordRuntimeProgram.entry,
    scratchMemoryWords: tokenRecordRuntimeProgram.scratchMemoryWords,
    tables: [
      ...(tokenRecordRuntimeProgram.tables ?? []),
      ...(lexerSpecRuntimeProgram.tables ?? []),
      ...(sourceTextRuntimeProgram.tables ?? []),
    ],
    functions: [
      ...tokenRecordRuntimeProgram.functions,
      ...lexerSpecRuntimeProgram.functions,
      ...sourceTextRuntimeProgram.functions,
    ],
  };

  return `// Generated by @mewhhaha/baba. Do not edit by hand.
import type {
  LexDiagnostic,
  LexOptions,
  LexResult,
  NamedTokenKind,
  Span,
  Token,
} from "./syntax.ts";
import {
  createParseTraceInput,
  lexAll,
  writeSource,
  type ParseTraceInput,
} from "./wasm.ts";

const DEFAULT_PRESERVE_TRIVIA = ${JSON.stringify(preserveTrivia)};
const DFA_START_STATE = 0;
const DFA_TRANSITIONS: readonly (readonly (readonly [number, number, number])[])[] = ${
    JSON.stringify(contextual?.transitions ?? [])
  };
const DFA_ASCII_TRANSITIONS: readonly (readonly number[])[] | null = ${
    JSON.stringify(contextual?.asciiTransitions ?? null)
  };
const DFA_ACCEPT_CANDIDATES: readonly (readonly number[])[] = ${
    JSON.stringify(contextual?.acceptCandidates ?? [])
  };
const NO_LEXER_SPEC = ${RUNTIME_NO_LEXER_SPEC};
const NO_TERMINAL = ${RUNTIME_NO_TERMINAL};
const PUBLIC_TOKEN_LITERAL = ${RUNTIME_PUBLIC_TOKEN_LITERAL};
const PUBLIC_TOKEN_MAIN = ${RUNTIME_PUBLIC_TOKEN_MAIN};
const PUBLIC_TOKEN_TRIVIA = ${RUNTIME_PUBLIC_TOKEN_TRIVIA};
const PUBLIC_TOKEN_ERROR = ${RUNTIME_PUBLIC_TOKEN_ERROR};
const PUBLIC_TOKEN_EOF = ${RUNTIME_PUBLIC_TOKEN_EOF};
const LEXER_TOKEN_EMIT_TOKEN = ${RUNTIME_LEXER_TOKEN_EMIT_TOKEN};

const NAMED_SPECS: readonly {
  kind: NamedTokenKind;
  channel: "main" | "trivia";
  terminal: number;
}[] = ${JSON.stringify(namedSpecs, null, 2)} as const;

const LITERAL_SPECS: readonly {
  literal: string;
  terminal: number;
}[] = ${JSON.stringify(literalSpecs, null, 2)} as const;

${emitRuntimeLanguageTypeScriptFunction(runtimeProgram).trimEnd()}
${emitPublicSourceTextBoundary({ includeCodePoint: true })}
${emitPublicTokenMaterializer({ label: "Wasm lexer" })}
${emitPublicLexDiagnosticMaterializer()}
${emitPublicLexResultMaterializer()}

export function lex(source: string, options: LexOptions = {}): LexResult {
  return lexInternal(source, options, false);
}

export interface WasmParseStream {
  publicTokens: readonly Token[];
  tokens: readonly Token[];
  tokenIndices: readonly number[];
  input: ParseTraceInput;
  terminalCount: number;
  sites: readonly WasmParseCandidateSite[];
}

export interface WasmParseCandidate {
  readonly token: Token;
  readonly terminal: number;
}

export interface WasmParseCandidateSite {
  readonly tokenIndex: number;
  readonly candidates: readonly WasmParseCandidate[];
}

export function lexForParse(
  source: string,
  options: LexOptions = {},
): LexResult & { parseStream: WasmParseStream } {
  return lexInternal(source, options, true) as LexResult & {
    parseStream: WasmParseStream;
  };
}

function lexInternal(
  source: string,
  options: LexOptions,
  includeParseStream: boolean,
): LexResult & { parseStream?: WasmParseStream } {
  runtimeArenaReset();
  const sourceText = createSourceTextBoundary(source);
  const preserveTrivia = options.preserveTrivia ?? DEFAULT_PRESERVE_TRIVIA;
  if (includeParseStream && DFA_ACCEPT_CANDIDATES.length > 0) {
    return lexContextualForParse(sourceText, preserveTrivia);
  }
  const sourceBuffer = writeSource(sourceText.source);
  const records = lexAll(sourceBuffer);
  const tokens: Token[] = new Array(records.length / 3 + 1);
  let tokenCount = 0;
  const diagnostics: LexDiagnostic[] = [];
  const streamTokens: Token[] = includeParseStream && !preserveTrivia
    ? tokens
    : includeParseStream
    ? new Array(records.length / 3 + 1)
    : [];
  const streamTokenIndices: number[] = includeParseStream
    ? new Array(records.length / 3 + 1)
    : [];
  const duplicateStreamTokens = streamTokens !== tokens;
  let streamTokenCount = 0;
  const parseTerminals = includeParseStream
    ? new Int32Array(records.length / 3 + 1)
    : null;
  let terminalCount = 0;

  for (let index = 0; index < records.length; index += 3) {
    const specIndex = records[index];
    const start = records[index + 1];
    const end = records[index + 2];
    if (specIndex >= 0) {
      const runtimeTokenClass = lexerSpecTokenClass(specIndex);
      const tokenClass = lexerPublicTokenClass(runtimeTokenClass);
      const payload = lexerSpecPayload(specIndex);
      const terminal = lexerSpecTerminal(specIndex);
      if (payload !== NO_LEXER_SPEC) {
        if (
          lexerTokenEmitStatus(runtimeTokenClass, preserveTrivia ? 1 : 0) ===
            LEXER_TOKEN_EMIT_TOKEN
        ) {
          const handle = parserTokenNew(
            tokenClass,
            payload,
            terminal < 0 ? NO_TERMINAL : terminal,
            start,
            end,
          );
          const token = materializeToken(sourceText, handle);
          tokens[tokenCount] = token;
          if (tokenClass !== PUBLIC_TOKEN_TRIVIA) {
            if (includeParseStream) streamTokenIndices[terminalCount] = tokenCount;
            if (includeParseStream) {
              if (duplicateStreamTokens) {
                streamTokens[streamTokenCount] = token;
                streamTokenCount++;
              }
              parseTerminals![terminalCount] = terminal;
              terminalCount++;
            }
          }
          tokenCount++;
        }
        continue;
      }
    }

    const handle = parserTokenNew(
      PUBLIC_TOKEN_ERROR,
      0,
      NO_TERMINAL,
      start,
      end,
    );
    const token = materializeToken(sourceText, handle);
    tokens[tokenCount] = token;
    tokenCount++;
    diagnostics.push(lexUnexpectedCharacterDiagnostic(token));
  }

  const eofHandle = parserTokenNew(
    PUBLIC_TOKEN_EOF,
    0,
    NO_TERMINAL,
    sourceText.length,
    sourceText.length,
  );
  const eofToken = materializeToken(sourceText, eofHandle);
  tokens[tokenCount] = eofToken;
  if (includeParseStream) streamTokenIndices[terminalCount] = tokenCount;
  tokenCount++;
  tokens.length = tokenCount;
  if (includeParseStream) {
    if (duplicateStreamTokens) {
      streamTokens[streamTokenCount] = eofToken;
      streamTokenCount++;
      streamTokens.length = streamTokenCount;
    }
    parseTerminals![terminalCount] = 0;
    terminalCount++;
    streamTokenIndices.length = terminalCount;
    const parseInput = createParseTraceInput(terminalCount);
    parseInput.terminals.set(parseTerminals!.subarray(0, terminalCount));
    return {
      source: sourceText.source,
      tokens,
      diagnostics,
      parseStream: {
        publicTokens: tokens,
        tokens: streamTokens,
        tokenIndices: streamTokenIndices,
        input: parseInput,
        terminalCount,
        sites: [],
      },
    };
  }
  return lexResult(sourceText.source, tokens, diagnostics);
}

function lexContextualForParse(
  sourceText: SourceTextBoundary,
  preserveTrivia: boolean,
): LexResult & { parseStream: WasmParseStream } {
  writeSource(sourceText.source);
  const tokens: Token[] = [];
  const streamTokens: Token[] = [];
  const streamTokenIndices: number[] = [];
  const diagnostics: LexDiagnostic[] = [];
  const terminals: number[] = [];
  const sites: WasmParseCandidateSite[] = [];
  let offset = 0;
  while (offset < sourceText.length) {
    const scanned = scanAcceptCandidates(sourceText, offset);
    if (!scanned) {
      const end = offset + sourceTextCodePointWidthAt(sourceText, offset);
      const handle = parserTokenNew(
        PUBLIC_TOKEN_ERROR,
        0,
        NO_TERMINAL,
        offset,
        end,
      );
      const token = materializeToken(sourceText, handle);
      tokens.push(token);
      diagnostics.push(lexUnexpectedCharacterDiagnostic(token));
      offset = end;
      continue;
    }
    const tokenCandidates = scanned.candidates.map((specIndex) =>
      materializeSpecToken(sourceText, specIndex, offset, scanned.end)
    );
    const trivia = tokenCandidates.find((candidate) =>
      candidate.token.channel === "trivia"
    );
    const mainCandidates = tokenCandidates.filter((candidate) =>
      candidate.token.channel !== "trivia" && candidate.terminal >= 0
    );
    if (trivia && mainCandidates.length === 0) {
      if (preserveTrivia) tokens.push(trivia.token);
      offset = scanned.end;
      continue;
    }
    if (mainCandidates.length === 0) {
      const handle = parserTokenNew(
        PUBLIC_TOKEN_ERROR,
        0,
        NO_TERMINAL,
        offset,
        scanned.end,
      );
      const token = materializeToken(sourceText, handle);
      tokens.push(token);
      diagnostics.push(lexUnexpectedCharacterDiagnostic(token));
      offset = scanned.end;
      continue;
    }
    const tokenIndex = tokens.length;
    tokens.push(mainCandidates[0].token);
    streamTokens.push(mainCandidates[0].token);
    streamTokenIndices.push(tokenIndex);
    terminals.push(mainCandidates[0].terminal);
    sites.push({ tokenIndex, candidates: mainCandidates });
    offset = scanned.end;
  }
  const eofHandle = parserTokenNew(
    PUBLIC_TOKEN_EOF,
    0,
    NO_TERMINAL,
    sourceText.length,
    sourceText.length,
  );
  const eofToken = materializeToken(sourceText, eofHandle);
  const eofIndex = tokens.length;
  tokens.push(eofToken);
  streamTokens.push(eofToken);
  streamTokenIndices.push(eofIndex);
  terminals.push(0);
  sites.push({ tokenIndex: eofIndex, candidates: [{ token: eofToken, terminal: 0 }] });
  const input = createParseTraceInput(terminals.length);
  input.terminals.set(Int32Array.from(terminals));
  return {
    source: sourceText.source,
    tokens,
    diagnostics,
    parseStream: {
      publicTokens: tokens,
      tokens: streamTokens,
      tokenIndices: streamTokenIndices,
      input,
      terminalCount: terminals.length,
      sites,
    },
  };
}

function materializeSpecToken(
  sourceText: SourceTextBoundary,
  specIndex: number,
  start: number,
  end: number,
): WasmParseCandidate {
  if (specIndex < NAMED_SPECS.length) {
    const spec = NAMED_SPECS[specIndex];
    const tokenClass = spec.channel === "trivia"
      ? PUBLIC_TOKEN_TRIVIA
      : PUBLIC_TOKEN_MAIN;
    const handle = parserTokenNew(
      tokenClass,
      specIndex,
      spec.terminal < 0 ? NO_TERMINAL : spec.terminal,
      start,
      end,
    );
    return { token: materializeToken(sourceText, handle), terminal: spec.terminal };
  }
  const literalIndex = specIndex - NAMED_SPECS.length;
  const spec = LITERAL_SPECS[literalIndex];
  const handle = parserTokenNew(
    PUBLIC_TOKEN_LITERAL,
    literalIndex,
    spec.terminal,
    start,
    end,
  );
  return { token: materializeToken(sourceText, handle), terminal: spec.terminal };
}

function scanAcceptCandidates(
  sourceText: SourceTextBoundary,
  offset: number,
): { readonly end: number; readonly candidates: readonly number[] } | null {
  let state = DFA_START_STATE;
  let cursor = offset;
  let acceptedEnd = -1;
  let acceptedCandidates: readonly number[] = [];
  while (cursor < sourceText.length) {
    const codePoint = sourceTextCodePointAt(sourceText, cursor);
    const next = contextualDfaTransition(state, codePoint);
    if (next < 0) break;
    state = next;
    cursor += codePoint > 0xffff ? 2 : 1;
    const candidates = DFA_ACCEPT_CANDIDATES[state] ?? [];
    if (candidates.length > 0) {
      acceptedEnd = cursor;
      acceptedCandidates = candidates;
    }
  }
  return acceptedEnd < 0
    ? null
    : { end: acceptedEnd, candidates: acceptedCandidates };
}

function contextualDfaTransition(state: number, codePoint: number): number {
  if (codePoint < 128 && DFA_ASCII_TRANSITIONS) {
    return DFA_ASCII_TRANSITIONS[state]?.[codePoint] ?? -1;
  }
  for (const [start, end, target] of DFA_TRANSITIONS[state] ?? []) {
    if (start <= codePoint && codePoint <= end) return target;
  }
  return -1;
}

function sourceTextCodePointWidthAt(
  sourceText: SourceTextBoundary,
  offset: number,
): number {
  return sourceTextCodePointAt(sourceText, offset) > 0xffff ? 2 : 1;
}
`;
}

function buildAsciiTransitionRows(dfa: Dfa): number[][] | null {
  const cellCount = dfa.states.length * 128;
  if (cellCount > 65_536) return null;
  return dfa.states.map((state) => {
    const row = new Array(128).fill(-1);
    for (const transition of state.transitions) {
      const start = Math.max(0, transition.start);
      const end = Math.min(127, transition.end);
      for (let codePoint = start; codePoint <= end; codePoint++) {
        row[codePoint] = transition.target;
      }
    }
    return row;
  });
}

function orderAcceptCandidates(
  specs: readonly {
    readonly type: "named" | "literal";
    readonly priority: number;
    readonly order: number;
  }[],
  accepts: readonly number[],
): readonly number[] {
  return [...accepts].sort((left, right) => {
    const leftSpec = specs[left];
    const rightSpec = specs[right];
    if (!leftSpec || !rightSpec) return left - right;
    return rightSpec.priority - leftSpec.priority ||
      (leftSpec.type === rightSpec.type
        ? 0
        : leftSpec.type === "literal"
        ? -1
        : 1) ||
      leftSpec.order - rightSpec.order ||
      left - right;
  });
}
