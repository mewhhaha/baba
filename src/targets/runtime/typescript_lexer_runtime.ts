import { emitRuntimeLanguageTypeScriptFunction } from "./language.ts";
import {
  createLexerRuntimeProgram,
  RUNTIME_LEXER_DRIVER_EVENT_DONE,
  RUNTIME_LEXER_DRIVER_EVENT_ERROR,
  RUNTIME_LEXER_DRIVER_EVENT_NEED_CODE_POINT,
  RUNTIME_LEXER_DRIVER_EVENT_TOKEN,
  RUNTIME_LEXER_DRIVER_SCRATCH_WORDS,
  RUNTIME_LEXER_SPEC_LITERAL,
  RUNTIME_LEXER_SPEC_TRIVIA,
  RUNTIME_NO_TERMINAL,
  RUNTIME_PUBLIC_TOKEN_EOF,
  RUNTIME_PUBLIC_TOKEN_ERROR,
  RUNTIME_PUBLIC_TOKEN_LITERAL,
  RUNTIME_PUBLIC_TOKEN_MAIN,
  RUNTIME_PUBLIC_TOKEN_TRIVIA,
} from "./language_sources.ts";
import { emitPublicLexDiagnosticMaterializer } from "./public_lex_diagnostic_materializer.ts";
import { emitPublicLexResultMaterializer } from "./public_lex_result_materializer.ts";
import { emitPublicSourceTextBoundary } from "./public_source_text.ts";
import { emitPublicTokenMaterializer } from "./public_token_materializer.ts";
import { generatedSourceBanner } from "./provenance.ts";

export interface TypeScriptLexerNamedSpec {
  readonly kind: string;
  readonly pattern: string;
  readonly channel: "main" | "trivia";
  readonly terminal: number;
  readonly priority: number;
  readonly order: number;
}

export interface TypeScriptLexerLiteralSpec {
  readonly literal: string;
  readonly terminal: number;
  readonly priority: number;
  readonly order: number;
}

export interface TypeScriptLexerRuntimePlan {
  readonly preserveTrivia: boolean;
  readonly namedSpecs: readonly TypeScriptLexerNamedSpec[];
  readonly literalSpecs: readonly TypeScriptLexerLiteralSpec[];
  readonly transitions: readonly (readonly (readonly [
    start: number,
    end: number,
    target: number,
  ])[])[];
  readonly asciiTransitions: readonly (readonly number[])[] | null;
  readonly accepts: readonly number[];
  readonly acceptCandidates: readonly (readonly number[])[];
  readonly parserPlanVersion?: number;
  readonly parserPlanSemantics?: string;
}

export function emitTypeScriptLexerRuntime(
  plan: TypeScriptLexerRuntimePlan,
): string {
  const runtimeProgram = createLexerRuntimeProgram({
    transitions: plan.transitions,
    asciiTransitions: plan.asciiTransitions,
    accepts: plan.accepts,
    acceptCandidates: plan.acceptCandidates,
    specs: [
      ...plan.namedSpecs.map((spec, payload) =>
        [
          spec.channel === "trivia" ? RUNTIME_LEXER_SPEC_TRIVIA : 0,
          payload,
          spec.terminal,
        ] as const
      ),
      ...plan.literalSpecs.map((spec, payload) =>
        [
          RUNTIME_LEXER_SPEC_LITERAL,
          payload,
          spec.terminal,
        ] as const
      ),
    ],
    includeTokenRecords: true,
  });
  return `${
    generatedSourceBanner({
      parserPlanVersion: plan.parserPlanVersion,
      parserPlanSemantics: plan.parserPlanSemantics,
    })
  }
import type {
  LexDiagnostic,
  LexOptions,
  LexResult,
  NamedTokenKind,
  Span,
  Token,
} from "./syntax.ts";

const DEFAULT_PRESERVE_TRIVIA = ${JSON.stringify(plan.preserveTrivia)};
const NO_ACCEPT = ${RUNTIME_NO_TERMINAL};

const NAMED_SPECS: readonly {
  kind: NamedTokenKind;
  pattern: string;
  channel: "main" | "trivia";
  terminal: number;
  priority: number;
  order: number;
}[] = ${JSON.stringify(plan.namedSpecs, null, 2)} as const;

const LITERAL_SPECS: readonly {
  literal: string;
  terminal: number;
  priority: number;
  order: number;
}[] = ${JSON.stringify(plan.literalSpecs, null, 2)} as const;

const NO_TERMINAL = ${RUNTIME_NO_TERMINAL};
const PUBLIC_TOKEN_LITERAL = ${RUNTIME_PUBLIC_TOKEN_LITERAL};
const PUBLIC_TOKEN_MAIN = ${RUNTIME_PUBLIC_TOKEN_MAIN};
const PUBLIC_TOKEN_TRIVIA = ${RUNTIME_PUBLIC_TOKEN_TRIVIA};
const PUBLIC_TOKEN_ERROR = ${RUNTIME_PUBLIC_TOKEN_ERROR};
const PUBLIC_TOKEN_EOF = ${RUNTIME_PUBLIC_TOKEN_EOF};
const LEXER_DRIVER_DONE = ${RUNTIME_LEXER_DRIVER_EVENT_DONE};
const LEXER_DRIVER_NEED_CODE_POINT = ${RUNTIME_LEXER_DRIVER_EVENT_NEED_CODE_POINT};
const LEXER_DRIVER_TOKEN = ${RUNTIME_LEXER_DRIVER_EVENT_TOKEN};
const LEXER_DRIVER_ERROR = ${RUNTIME_LEXER_DRIVER_EVENT_ERROR};
const LEXER_DRIVER_SCRATCH_WORDS = ${RUNTIME_LEXER_DRIVER_SCRATCH_WORDS};

${
    emitRuntimeLanguageTypeScriptFunction(runtimeProgram)
      .trimEnd()
  }
${emitPublicSourceTextBoundary({ includeCodePoint: true })}
${emitPublicTokenMaterializer({ label: "Lexer" })}
${emitPublicLexDiagnosticMaterializer()}
${emitPublicLexResultMaterializer()}

export interface ParseLexCandidate {
  readonly token: Token;
  readonly terminal: number;
}

export interface ParseLexCandidateSite {
  readonly tokenIndex: number;
  readonly candidates: readonly ParseLexCandidate[];
}

export interface ParseLexCandidateStream {
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly LexDiagnostic[];
  readonly sites: readonly ParseLexCandidateSite[];
}

export function lex(source: string, options: LexOptions = {}): LexResult {
  runtimeArenaReset();
  const sourceText = createSourceTextBoundary(source);
  const preserveTrivia = options.preserveTrivia ?? DEFAULT_PRESERVE_TRIVIA;
  const tokens: Token[] = [];
  const diagnostics: LexDiagnostic[] = [];

  lexerDriverStart(sourceText.length, preserveTrivia ? 1 : 0);
  while (lexerDriverEvent() !== LEXER_DRIVER_DONE) {
    while (lexerDriverEvent() === LEXER_DRIVER_NEED_CODE_POINT) {
      const codePoint = sourceTextCodePointAt(
        sourceText,
        lexerDriverReadOffset(),
      );
      lexerDriverAdvance(codePoint);
    }

    const event = lexerDriverEvent();
    if (event === LEXER_DRIVER_DONE) break;
    runtimeArenaResetTo(LEXER_DRIVER_SCRATCH_WORDS);
    const handle = parserTokenNew(
      lexerDriverTokenClass(),
      lexerDriverTokenPayload(),
      lexerDriverTokenTerminal(),
      lexerDriverTokenStart(),
      lexerDriverTokenEnd(),
    );
    const token = materializeToken(sourceText, handle);
    if (event === LEXER_DRIVER_TOKEN) {
      tokens.push(token);
      lexerDriverConsume();
      continue;
    }
    if (event === LEXER_DRIVER_ERROR) {
      tokens.push(token);
      diagnostics.push(lexUnexpectedCharacterDiagnostic(token));
      lexerDriverConsume();
      continue;
    }
    throw new Error("Lexer driver produced an unknown event.");
  }

  runtimeArenaResetTo(LEXER_DRIVER_SCRATCH_WORDS);
  const eofHandle = parserTokenNew(
    PUBLIC_TOKEN_EOF,
    0,
    NO_TERMINAL,
    sourceText.length,
    sourceText.length,
  );
  tokens.push(materializeToken(sourceText, eofHandle));
  return lexResult(sourceText.source, tokens, diagnostics);
}

export function lexForParse(
  source: string,
  options: LexOptions = {},
): LexResult & { parseStream: ParseLexCandidateStream } {
  runtimeArenaReset();
  const sourceText = createSourceTextBoundary(source);
  const preserveTrivia = options.preserveTrivia ?? DEFAULT_PRESERVE_TRIVIA;
  const tokens: Token[] = [];
  const diagnostics: LexDiagnostic[] = [];
  const sites: ParseLexCandidateSite[] = [];
  let offset = 0;
  while (offset < sourceText.length) {
    const scanned = scanAcceptCandidates(sourceText, offset);
    if (!scanned) {
      const codePoint = sourceTextCodePointAt(sourceText, offset);
      const end = sourceTextNextOffset(offset, codePoint);
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
  sites.push({
    tokenIndex: eofIndex,
    candidates: [{ token: eofToken, terminal: 0 }],
  });
  return {
    source: sourceText.source,
    tokens,
    diagnostics,
    parseStream: { tokens, diagnostics, sites },
  };
}

function materializeSpecToken(
  sourceText: SourceTextBoundary,
  specIndex: number,
  start: number,
  end: number,
): ParseLexCandidate {
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
  lexerScanReset();
  let cursor = offset;
  while (cursor < sourceText.length) {
    const codePoint = sourceTextCodePointAt(sourceText, cursor);
    if (lexerScanAdvance(codePoint) === 0) break;
    cursor = sourceTextNextOffset(cursor, codePoint);
  }
  const end = lexerScanCandidateEnd(offset);
  const state = lexerScanBestState();
  if (state === NO_ACCEPT) return null;
  const candidates: number[] = [];
  const count = lexerAcceptCandidateCount(state);
  for (let index = 0; index < count; index++) {
    const spec = lexerAcceptCandidateSpec(state, index);
    if (spec !== NO_ACCEPT) candidates.push(spec);
  }
  return candidates.length === 0 ? null : { end, candidates };
}
`;
}
