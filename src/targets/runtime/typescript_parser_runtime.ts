import type { AnalyzedGrammar } from "../../compiler/ir.ts";
import type { BnfGrammar, ReducerSpec } from "../typescript/bnf.ts";
import type { LrAction, LrActionSet, LrTable } from "../typescript/lr1.ts";
import {
  PARSER_DIAGNOSTIC_CODE_BRANCH_LIMIT,
  PARSER_DIAGNOSTIC_CODE_INTERNAL_ERROR,
  PARSER_DIAGNOSTIC_CODE_PARSE_INVALID_TOKEN_STREAM,
  PARSER_DIAGNOSTIC_CODE_PARSE_LEXICAL_ERROR,
  PARSER_DIAGNOSTIC_CODE_PARSE_TRAILING_INPUT,
  PARSER_DIAGNOSTIC_CODE_PARSE_UNEXPECTED_TOKEN,
  PARSER_DIAGNOSTIC_DETAIL_NONE,
  PARSER_DIAGNOSTIC_DETAIL_PARSER_STATE,
} from "./diagnostic_codes.ts";
import { collectRuleFieldSchemas } from "./field_schema.ts";
import {
  emitRuntimeLanguageTypeScriptFunction,
  type RuntimeLanguageProgram,
} from "./language.ts";
import {
  createLexerSpecRuntimeProgram,
  createParserActionRuntimeProgram,
  createParserConflictTraceRuntimeProgram,
  createParserExpectedRuntimeProgram,
  createParserFieldRuntimeProgram,
  createParserObjectRuntimeProgram,
  createParserProductionRuntimeProgram,
  createParserReducerRuntimeProgram,
  createParserTraceRuntimeProgram,
  RUNTIME_ACTION_ACCEPT,
  RUNTIME_ACTION_NONE,
  RUNTIME_ACTION_PAYLOAD_MASK,
  RUNTIME_ACTION_REDUCE,
  RUNTIME_ACTION_SHIFT,
  RUNTIME_FIELD_ARRAY,
  RUNTIME_FIELD_CAPTURE_ARRAY,
  RUNTIME_FIELD_CAPTURE_SCALAR,
  RUNTIME_FIELD_CAPTURE_TOO_MANY,
  RUNTIME_FIELD_FINAL_REQUIRED_MISSING,
  RUNTIME_FIELD_FINAL_TOO_MANY,
  RUNTIME_FIELD_NULLABLE,
  RUNTIME_FIELD_VALUE_ARRAY,
  RUNTIME_FIELD_VALUE_NULLABLE,
  RUNTIME_LEXER_SPEC_LITERAL,
  RUNTIME_LEXER_SPEC_STATUS_NOT_LITERAL,
  RUNTIME_LEXER_SPEC_STATUS_NOT_MAIN,
  RUNTIME_LEXER_SPEC_STATUS_NOT_TRIVIA,
  RUNTIME_LEXER_SPEC_STATUS_OK,
  RUNTIME_LEXER_SPEC_TRIVIA,
  RUNTIME_LEXICAL_TOKEN_STATUS_OK,
  RUNTIME_NO_FIELD,
  RUNTIME_NO_GOTO,
  RUNTIME_NO_PRODUCTION,
  RUNTIME_NO_REDUCER_PAYLOAD,
  RUNTIME_NO_TERMINAL,
  RUNTIME_PUBLIC_TOKEN_EOF,
  RUNTIME_PUBLIC_TOKEN_ERROR,
  RUNTIME_PUBLIC_TOKEN_LITERAL,
  RUNTIME_PUBLIC_TOKEN_MAIN,
  RUNTIME_PUBLIC_TOKEN_TRIVIA,
  RUNTIME_REDUCER_CHILD_FRAGMENT,
  RUNTIME_REDUCER_CHILD_RAW,
  RUNTIME_REDUCER_CHILD_RULE_NODE,
  RUNTIME_REDUCER_CHILD_SHIFTED_TOKEN,
  RUNTIME_REDUCER_FIELD,
  RUNTIME_REDUCER_IDENTITY,
  RUNTIME_REDUCER_OPERATION_APPEND,
  RUNTIME_REDUCER_OPERATION_EMPTY_ARRAY,
  RUNTIME_REDUCER_OPERATION_EMPTY_NULL,
  RUNTIME_REDUCER_OPERATION_FIELD,
  RUNTIME_REDUCER_OPERATION_FIRST_ARRAY,
  RUNTIME_REDUCER_OPERATION_IDENTITY,
  RUNTIME_REDUCER_OPERATION_RULE,
  RUNTIME_REDUCER_OPERATION_RULE_REF,
  RUNTIME_REDUCER_OPERATION_SEPARATED_APPEND,
  RUNTIME_REDUCER_OPERATION_SEQUENCE,
  RUNTIME_REDUCER_OPERATION_START,
  RUNTIME_REDUCER_OPERATION_TERMINAL,
  RUNTIME_REDUCER_OPERATION_UNKNOWN,
  RUNTIME_REDUCER_OPTIONAL_EMPTY,
  RUNTIME_REDUCER_OPTIONAL_SOME,
  RUNTIME_REDUCER_PAYLOAD_STATUS_FIELD_MISSING,
  RUNTIME_REDUCER_PAYLOAD_STATUS_RULE_MISSING,
  RUNTIME_REDUCER_REPEAT1_APPEND,
  RUNTIME_REDUCER_REPEAT1_FIRST,
  RUNTIME_REDUCER_REPEAT_APPEND,
  RUNTIME_REDUCER_REPEAT_EMPTY,
  RUNTIME_REDUCER_RESULT_APPEND_FRAGMENT,
  RUNTIME_REDUCER_RESULT_CHILD_FRAGMENT,
  RUNTIME_REDUCER_RESULT_EMPTY_ARRAY_FRAGMENT,
  RUNTIME_REDUCER_RESULT_EMPTY_NULL_FRAGMENT,
  RUNTIME_REDUCER_RESULT_FIELD_FRAGMENT,
  RUNTIME_REDUCER_RESULT_FIRST_ARRAY_FRAGMENT,
  RUNTIME_REDUCER_RESULT_RAW_CHILD,
  RUNTIME_REDUCER_RESULT_RULE_NODE,
  RUNTIME_REDUCER_RESULT_SEPARATED_APPEND_FRAGMENT,
  RUNTIME_REDUCER_RESULT_SEQUENCE_FRAGMENT,
  RUNTIME_REDUCER_RULE,
  RUNTIME_REDUCER_RULE_REF,
  RUNTIME_REDUCER_SEPARATED_APPEND,
  RUNTIME_REDUCER_SEPARATED_FIRST,
  RUNTIME_REDUCER_SEQUENCE,
  RUNTIME_REDUCER_START,
  RUNTIME_REDUCER_TERMINAL,
  RUNTIME_REPLAY_ACTION_STATUS_ACCEPT,
  RUNTIME_REPLAY_ACTION_STATUS_REDUCE,
  RUNTIME_REPLAY_ACTION_STATUS_SHIFT,
  RUNTIME_REPLAY_REDUCTION_STATUS_FIELD_PAYLOAD_MISSING,
  RUNTIME_REPLAY_REDUCTION_STATUS_OK,
  RUNTIME_REPLAY_REDUCTION_STATUS_RULE_PAYLOAD_MISSING,
  RUNTIME_REPLAY_REDUCTION_STATUS_STACK_UNDERFLOW,
  RUNTIME_REPLAY_REDUCTION_STATUS_UNKNOWN_PRODUCTION,
  RUNTIME_TOKEN_STREAM_STATUS_GAP,
  RUNTIME_TOKEN_STREAM_STATUS_INVALID_EOF,
  RUNTIME_TOKEN_STREAM_STATUS_INVALID_SPAN,
  RUNTIME_TOKEN_STREAM_STATUS_OK,
  RUNTIME_TOKEN_STREAM_STATUS_OVERLAP,
  RUNTIME_TOKEN_STREAM_STATUS_ZERO_WIDTH,
  RUNTIME_TRACE_STATUS_BRANCH_LIMIT,
  RUNTIME_TRACE_STATUS_OK,
  RUNTIME_TRACE_STATUS_UNEXPECTED,
} from "./language_sources.ts";
import { emitPublicDiagnosticMaterializer } from "./public_diagnostic_materializer.ts";
import { emitPublicFieldMaterializer } from "./public_field_materializer.ts";
import { emitPublicParseResultMaterializer } from "./public_parse_result_materializer.ts";
import { emitPublicRuleNodeMaterializer } from "./public_rule_node_materializer.ts";
import { emitPublicSourceTextBoundary } from "./public_source_text.ts";
import { emitPublicEofTokenMaterializer } from "./public_token_materializer.ts";

export type ParserEmitMode = "typescript" | "wasm";

export interface ParserEmitOptions {
  mode?: ParserEmitMode;
}

type EncodedAction =
  | readonly [terminal: number, kind: 1, state: number]
  | readonly [terminal: number, kind: 2, production: number]
  | readonly [terminal: number, kind: 3];

type GotoEntry = readonly [nonterminal: number, state: number];

export function emitParser(
  analyzed: AnalyzedGrammar,
  bnf: BnfGrammar,
  lr: LrTable,
  options: ParserEmitOptions = {},
): string {
  const mode = options.mode ?? "typescript";
  const emitTypeScriptTables = mode === "typescript";
  const emitBranchRuntime = mode === "typescript" &&
    hasMultiActionEntries(lr.actions);
  const actionRows = bnfActionTableRows(lr.actions);
  const gotoRows = bnfTableRows(lr.gotos, (nonterminal, target) => [
    nonterminal,
    target,
  ]);
  const runtimeProductions = bnf.productions.map((production) =>
    [production.lhs, production.rhs.length] as const
  );
  const tableRuntimeProgram = emitTypeScriptTables
    ? emitBranchRuntime
      ? createParserConflictTraceRuntimeProgram({
        actionRows: parserRuntimeActionRows(actionRows),
        gotoRows,
        productions: runtimeProductions,
      })
      : createParserTraceRuntimeProgram({
        actionRows: parserRuntimeActionRows(actionRows),
        gotoRows,
        productions: runtimeProductions,
      })
    : null;
  const productionRuntimeProgram = createParserProductionRuntimeProgram({
    productions: runtimeProductions,
  });
  const actionRuntimeProgram = createParserActionRuntimeProgram();
  const fieldSchemaModels = collectRuleFieldSchemas(analyzed);
  const fieldNames = [
    ...new Set([
      ...fieldSchemaModels.flatMap((schema) =>
        schema.fields.map((field) => field.name)
      ),
      ...bnf.productions.flatMap((production) =>
        production.reducer.kind === "field" ? [production.reducer.name] : []
      ),
    ]),
  ].sort((left, right) => left.localeCompare(right));
  const fieldIds = new Map(fieldNames.map((name, index) => [name, index]));
  const reducerRuntimeProgram = createParserReducerRuntimeProgram({
    reducers: bnf.productions.map((production) =>
      parserRuntimeReducerEntry(production.reducer, fieldIds)
    ),
  });
  const fieldRows: Array<Array<readonly [fieldId: number, flags: number]>> =
    Array.from({ length: analyzed.rules.length }, () => []);
  for (const schema of fieldSchemaModels) {
    fieldRows[schema.ruleId] = schema.fields.map((field) =>
      [
        fieldIds.get(field.name)!,
        (field.array ? RUNTIME_FIELD_ARRAY : 0) |
        (field.nullable ? RUNTIME_FIELD_NULLABLE : 0),
      ] as const
    );
  }
  const fieldRuntimeProgram = createParserFieldRuntimeProgram({ fieldRows });
  const parserObjectRuntimeProgram = createParserObjectRuntimeProgram({
    includeArena: tableRuntimeProgram === null,
  });
  const expectedRows = expectedTerminalRows(bnf, lr);
  const expectedRuntimeProgram = createParserExpectedRuntimeProgram({
    rowLengths: expectedRows.map((row) => row.length),
    rowHasEof: expectedRows.map((row) => row.includes("EOF")),
  });
  const namedTerminalIds = new Map<number, number>();
  const literalTerminalIds = new Map<number, number>();
  for (const terminal of bnf.terminals) {
    if (terminal.kind === "named") {
      namedTerminalIds.set(terminal.tokenId!, terminal.id);
    }
    if (terminal.kind === "literal") {
      literalTerminalIds.set(terminal.literalId!, terminal.id);
    }
  }
  const namedTokens = analyzed.tokens
    .filter((token) =>
      token.kind === "skip" ||
      (token.kind === "token" && analyzed.reachableTokens.has(token.id))
    );
  const literalSpecs = analyzed.literals
    .filter((literal) => analyzed.reachableLiterals.has(literal.id));
  const literalSpecOffset = namedTokens.length;
  const namedSpecIndices = namedTokens.map((token, index) =>
    [token.name, index] as const
  );
  const literalSpecIndices = literalSpecs.map((literal, index) =>
    [literal.value, literalSpecOffset + index] as const
  );
  const lexerSpecRuntimeProgram = createLexerSpecRuntimeProgram({
    specs: [
      ...namedTokens.map((token, payload) =>
        [
          token.kind === "skip" ? RUNTIME_LEXER_SPEC_TRIVIA : 0,
          payload,
          token.kind === "skip" ? -1 : namedTerminalIds.get(token.id) ?? -1,
        ] as const
      ),
      ...literalSpecs.map((literal, payload) =>
        [
          RUNTIME_LEXER_SPEC_LITERAL,
          payload,
          literalTerminalIds.get(literal.id) ?? -1,
        ] as const
      ),
    ],
  });
  const ruleNames = analyzed.rules.map((rule) => rule.name);
  const runtimeProgram = mergeRuntimePrograms(
    tableRuntimeProgram
      ? mergeRuntimePrograms(tableRuntimeProgram, expectedRuntimeProgram)
      : mergeRuntimePrograms(
        mergeRuntimePrograms(productionRuntimeProgram, actionRuntimeProgram),
        expectedRuntimeProgram,
      ),
    reducerRuntimeProgram,
  );
  const runtimeWithFields = mergeRuntimePrograms(
    mergeRuntimePrograms(
      runtimeProgram,
      lexerSpecRuntimeProgram,
    ),
    mergeRuntimePrograms(fieldRuntimeProgram, parserObjectRuntimeProgram),
  );

  return `// Generated by @mewhhaha/baba. Do not edit by hand.
${importSource(mode)}

${commonTypes()}
${
    commonConstants({
      bnf,
      expectedRows,
      namedSpecIndices,
      literalSpecIndices,
      ruleNames,
      fieldNames,
    })
  }

${parserTableRuntime(runtimeWithFields)}
${emitPublicSourceTextBoundary()}
${emitPublicEofTokenMaterializer()}
${emitPublicDiagnosticMaterializer()}
${emitPublicFieldMaterializer()}
${emitPublicRuleNodeMaterializer()}
${emitPublicParseResultMaterializer()}

${parseEntryPoints(mode)}

${mode === "wasm" ? wasmParseRuntime() : deterministicParseRuntime()}

${reductionRuntime()}
`;
}

function importSource(mode: ParserEmitMode): string {
  const lexerImport = mode === "wasm"
    ? `import { lex, lexForParse, type WasmParseStream } from "./lexer.ts";
import { createParseTraceInput, parseTrace, type ParseTraceInput } from "./wasm.ts";`
    : `import { lex } from "./lexer.ts";`;
  return `${lexerImport}
import type {
  AnyRuleNode,
  LexDiagnostic,
  LiteralToken,
  MainNamedToken,
  ParseDiagnostic,
  ParseOptions,
  ParseResult,
  RootNode,
  Span,
  SyntaxElement,
  Token,
} from "./syntax.ts";`;
}

function commonTypes(): string {
  return `interface Fragment {
  runtimeHandle: number;
  value: unknown;
  span: Span | null;
  tokenRange: TokenRange | null;
}

interface TokenRange {
  start: number;
  end: number;
}

interface ShiftedToken {
  token: Token;
  tokenIndex: number;
}

`;
}

function commonConstants(values: {
  bnf: BnfGrammar;
  expectedRows: readonly (readonly string[])[];
  namedSpecIndices: Array<readonly [string, number]>;
  literalSpecIndices: Array<readonly [string, number]>;
  ruleNames: string[];
  fieldNames: string[];
}): string {
  const expectedTerminals = values.expectedRows.flat();
  return `const EOF_TERMINAL = ${values.bnf.eofTerminal};
const EXPECTED_TERMINALS: readonly string[] = ${
    JSON.stringify(expectedTerminals)
  };
const NAMED_SPEC_INDICES = new Map<string, number>(${
    JSON.stringify(values.namedSpecIndices)
  });
const LITERAL_SPEC_INDICES = new Map<string, number>(${
    JSON.stringify(values.literalSpecIndices)
  });
const RULE_NAMES: readonly string[] = ${JSON.stringify(values.ruleNames)};
const FIELD_NAMES: readonly string[] = ${JSON.stringify(values.fieldNames)};
const EMPTY_PARSE_DIAGNOSTICS = [] as const;`;
}

function parserTableRuntime(program: RuntimeLanguageProgram): string {
  return `const ACTION_NONE = ${RUNTIME_ACTION_NONE};
const ACTION_SHIFT = ${RUNTIME_ACTION_SHIFT};
const ACTION_REDUCE = ${RUNTIME_ACTION_REDUCE};
const ACTION_ACCEPT = ${RUNTIME_ACTION_ACCEPT};
const TRACE_STATUS_OK = ${RUNTIME_TRACE_STATUS_OK};
const TRACE_STATUS_UNEXPECTED = ${RUNTIME_TRACE_STATUS_UNEXPECTED};
const TRACE_STATUS_BRANCH_LIMIT = ${RUNTIME_TRACE_STATUS_BRANCH_LIMIT};
const REPLAY_ACTION_SHIFT = ${RUNTIME_REPLAY_ACTION_STATUS_SHIFT};
const REPLAY_ACTION_REDUCE = ${RUNTIME_REPLAY_ACTION_STATUS_REDUCE};
const REPLAY_ACTION_ACCEPT = ${RUNTIME_REPLAY_ACTION_STATUS_ACCEPT};
const NO_GOTO = ${RUNTIME_NO_GOTO};
const NO_TERMINAL = ${RUNTIME_NO_TERMINAL};
const NO_PRODUCTION = ${RUNTIME_NO_PRODUCTION};
const REDUCER_OPERATION_UNKNOWN = ${RUNTIME_REDUCER_OPERATION_UNKNOWN};
const REDUCER_OPERATION_START = ${RUNTIME_REDUCER_OPERATION_START};
const REDUCER_OPERATION_RULE = ${RUNTIME_REDUCER_OPERATION_RULE};
const REDUCER_OPERATION_TERMINAL = ${RUNTIME_REDUCER_OPERATION_TERMINAL};
const REDUCER_OPERATION_RULE_REF = ${RUNTIME_REDUCER_OPERATION_RULE_REF};
const REDUCER_OPERATION_IDENTITY = ${RUNTIME_REDUCER_OPERATION_IDENTITY};
const REDUCER_OPERATION_SEQUENCE = ${RUNTIME_REDUCER_OPERATION_SEQUENCE};
const REDUCER_OPERATION_EMPTY_NULL = ${RUNTIME_REDUCER_OPERATION_EMPTY_NULL};
const REDUCER_OPERATION_EMPTY_ARRAY = ${RUNTIME_REDUCER_OPERATION_EMPTY_ARRAY};
const REDUCER_OPERATION_APPEND = ${RUNTIME_REDUCER_OPERATION_APPEND};
const REDUCER_OPERATION_FIRST_ARRAY = ${RUNTIME_REDUCER_OPERATION_FIRST_ARRAY};
const REDUCER_OPERATION_SEPARATED_APPEND = ${RUNTIME_REDUCER_OPERATION_SEPARATED_APPEND};
const REDUCER_OPERATION_FIELD = ${RUNTIME_REDUCER_OPERATION_FIELD};
const REDUCER_PAYLOAD_RULE_MISSING = ${RUNTIME_REDUCER_PAYLOAD_STATUS_RULE_MISSING};
const REDUCER_PAYLOAD_FIELD_MISSING = ${RUNTIME_REDUCER_PAYLOAD_STATUS_FIELD_MISSING};
const REDUCER_CHILD_RAW = ${RUNTIME_REDUCER_CHILD_RAW};
const REDUCER_CHILD_FRAGMENT = ${RUNTIME_REDUCER_CHILD_FRAGMENT};
const REDUCER_CHILD_SHIFTED_TOKEN = ${RUNTIME_REDUCER_CHILD_SHIFTED_TOKEN};
const REDUCER_CHILD_RULE_NODE = ${RUNTIME_REDUCER_CHILD_RULE_NODE};
const REDUCER_RESULT_RAW_CHILD = ${RUNTIME_REDUCER_RESULT_RAW_CHILD};
const REDUCER_RESULT_RULE_NODE = ${RUNTIME_REDUCER_RESULT_RULE_NODE};
const REDUCER_RESULT_CHILD_FRAGMENT = ${RUNTIME_REDUCER_RESULT_CHILD_FRAGMENT};
const REDUCER_RESULT_SEQUENCE_FRAGMENT = ${RUNTIME_REDUCER_RESULT_SEQUENCE_FRAGMENT};
const REDUCER_RESULT_EMPTY_NULL_FRAGMENT = ${RUNTIME_REDUCER_RESULT_EMPTY_NULL_FRAGMENT};
const REDUCER_RESULT_EMPTY_ARRAY_FRAGMENT = ${RUNTIME_REDUCER_RESULT_EMPTY_ARRAY_FRAGMENT};
const REDUCER_RESULT_APPEND_FRAGMENT = ${RUNTIME_REDUCER_RESULT_APPEND_FRAGMENT};
const REDUCER_RESULT_FIRST_ARRAY_FRAGMENT = ${RUNTIME_REDUCER_RESULT_FIRST_ARRAY_FRAGMENT};
const REDUCER_RESULT_SEPARATED_APPEND_FRAGMENT = ${RUNTIME_REDUCER_RESULT_SEPARATED_APPEND_FRAGMENT};
const REDUCER_RESULT_FIELD_FRAGMENT = ${RUNTIME_REDUCER_RESULT_FIELD_FRAGMENT};
const REPLAY_REDUCTION_OK = ${RUNTIME_REPLAY_REDUCTION_STATUS_OK};
const REPLAY_REDUCTION_UNKNOWN_PRODUCTION = ${RUNTIME_REPLAY_REDUCTION_STATUS_UNKNOWN_PRODUCTION};
const REPLAY_REDUCTION_RULE_PAYLOAD_MISSING = ${RUNTIME_REPLAY_REDUCTION_STATUS_RULE_PAYLOAD_MISSING};
const REPLAY_REDUCTION_FIELD_PAYLOAD_MISSING = ${RUNTIME_REPLAY_REDUCTION_STATUS_FIELD_PAYLOAD_MISSING};
const REPLAY_REDUCTION_STACK_UNDERFLOW = ${RUNTIME_REPLAY_REDUCTION_STATUS_STACK_UNDERFLOW};
const NO_FIELD = ${RUNTIME_NO_FIELD};
const FIELD_VALUE_ARRAY = ${RUNTIME_FIELD_VALUE_ARRAY};
const FIELD_VALUE_NULLABLE = ${RUNTIME_FIELD_VALUE_NULLABLE};
const FIELD_CAPTURE_ARRAY = ${RUNTIME_FIELD_CAPTURE_ARRAY};
const FIELD_CAPTURE_SCALAR = ${RUNTIME_FIELD_CAPTURE_SCALAR};
const FIELD_CAPTURE_TOO_MANY = ${RUNTIME_FIELD_CAPTURE_TOO_MANY};
const FIELD_FINAL_REQUIRED_MISSING = ${RUNTIME_FIELD_FINAL_REQUIRED_MISSING};
const FIELD_FINAL_TOO_MANY = ${RUNTIME_FIELD_FINAL_TOO_MANY};
const PUBLIC_TOKEN_LITERAL = ${RUNTIME_PUBLIC_TOKEN_LITERAL};
const PUBLIC_TOKEN_MAIN = ${RUNTIME_PUBLIC_TOKEN_MAIN};
const PUBLIC_TOKEN_TRIVIA = ${RUNTIME_PUBLIC_TOKEN_TRIVIA};
const PUBLIC_TOKEN_ERROR = ${RUNTIME_PUBLIC_TOKEN_ERROR};
const PUBLIC_TOKEN_EOF = ${RUNTIME_PUBLIC_TOKEN_EOF};
const SPEC_STATUS_OK = ${RUNTIME_LEXER_SPEC_STATUS_OK};
const SPEC_STATUS_NOT_LITERAL = ${RUNTIME_LEXER_SPEC_STATUS_NOT_LITERAL};
const SPEC_STATUS_NOT_MAIN = ${RUNTIME_LEXER_SPEC_STATUS_NOT_MAIN};
const SPEC_STATUS_NOT_TRIVIA = ${RUNTIME_LEXER_SPEC_STATUS_NOT_TRIVIA};
const LEXICAL_TOKEN_OK = ${RUNTIME_LEXICAL_TOKEN_STATUS_OK};
const TOKEN_STREAM_INVALID_SPAN = ${RUNTIME_TOKEN_STREAM_STATUS_INVALID_SPAN};
const TOKEN_STREAM_OK = ${RUNTIME_TOKEN_STREAM_STATUS_OK};
const TOKEN_STREAM_GAP = ${RUNTIME_TOKEN_STREAM_STATUS_GAP};
const TOKEN_STREAM_OVERLAP = ${RUNTIME_TOKEN_STREAM_STATUS_OVERLAP};
const TOKEN_STREAM_ZERO_WIDTH = ${RUNTIME_TOKEN_STREAM_STATUS_ZERO_WIDTH};
const TOKEN_STREAM_INVALID_EOF = ${RUNTIME_TOKEN_STREAM_STATUS_INVALID_EOF};
const DIAGNOSTIC_PARSE_LEXICAL_ERROR = ${PARSER_DIAGNOSTIC_CODE_PARSE_LEXICAL_ERROR};
const DIAGNOSTIC_PARSE_UNEXPECTED_TOKEN = ${PARSER_DIAGNOSTIC_CODE_PARSE_UNEXPECTED_TOKEN};
const DIAGNOSTIC_PARSE_TRAILING_INPUT = ${PARSER_DIAGNOSTIC_CODE_PARSE_TRAILING_INPUT};
const DIAGNOSTIC_PARSE_INVALID_TOKEN_STREAM = ${PARSER_DIAGNOSTIC_CODE_PARSE_INVALID_TOKEN_STREAM};
const DIAGNOSTIC_PARSER_INTERNAL_ERROR = ${PARSER_DIAGNOSTIC_CODE_INTERNAL_ERROR};
const DIAGNOSTIC_PARSER_BRANCH_LIMIT = ${PARSER_DIAGNOSTIC_CODE_BRANCH_LIMIT};
const DIAGNOSTIC_DETAIL_NONE = ${PARSER_DIAGNOSTIC_DETAIL_NONE};
const DIAGNOSTIC_DETAIL_PARSER_STATE = ${PARSER_DIAGNOSTIC_DETAIL_PARSER_STATE};
export const parserDiagnosticCodeParseLexicalError = DIAGNOSTIC_PARSE_LEXICAL_ERROR;
export const parserDiagnosticCodeParseUnexpectedToken = DIAGNOSTIC_PARSE_UNEXPECTED_TOKEN;
export const parserDiagnosticCodeParseTrailingInput = DIAGNOSTIC_PARSE_TRAILING_INPUT;
export const parserDiagnosticCodeParseInvalidTokenStream = DIAGNOSTIC_PARSE_INVALID_TOKEN_STREAM;
export const parserDiagnosticCodeInternalError = DIAGNOSTIC_PARSER_INTERNAL_ERROR;
export const parserDiagnosticCodeBranchLimit = DIAGNOSTIC_PARSER_BRANCH_LIMIT;
export const parserDiagnosticDetailKindNone = DIAGNOSTIC_DETAIL_NONE;
export const parserDiagnosticDetailKindParserState = DIAGNOSTIC_DETAIL_PARSER_STATE;

${emitRuntimeLanguageTypeScriptFunction(program).trimEnd()}`;
}

function mergeRuntimePrograms(
  base: RuntimeLanguageProgram,
  extension: RuntimeLanguageProgram,
): RuntimeLanguageProgram {
  return {
    name: `${base.name}_with_${extension.name}`,
    entry: base.entry,
    scratchMemoryWords: base.scratchMemoryWords ?? extension.scratchMemoryWords,
    tables: [
      ...(base.tables ?? []),
      ...(extension.tables ?? []),
    ],
    functions: [
      ...base.functions,
      ...extension.functions,
    ],
  };
}

function parseEntryPoints(mode: ParserEmitMode): string {
  const parseBody = mode === "wasm"
    ? `  const lexed = lexForParse(source, options);
  return parseTokenList(
    sourceText,
    lexed.tokens,
    lexicalDiagnostics(lexed.diagnostics),
    lexed.parseStream,
    true,
  );`
    : `  const lexed = lex(source, options);
  return parseTokenList(
    sourceText,
    lexed.tokens,
    lexicalDiagnostics(lexed.diagnostics),
    undefined,
    true,
  );`;
  return `export function parse(
  source: string,
  options: ParseOptions = {},
): ParseResult<RootNode> {
  runtimeArenaReset();
  const sourceText = createSourceTextBoundary(source);
${parseBody}
}

export function parseTokens(
  source: string,
  tokens: readonly Token[],
): ParseResult<RootNode> {
  runtimeArenaReset();
  const sourceText = createSourceTextBoundary(source);
  const streamDiagnostics = validateTokenStream(sourceText, tokens);
  const tokenDiagnostics = lexicalTokenDiagnostics(tokens);
  return parseTokenList(
    sourceText,
    tokens,
    combineDiagnostics(streamDiagnostics, tokenDiagnostics),
    undefined,
    false,
  );
}

export function parseTokensUnchecked(
  source: string,
  tokens: readonly Token[],
): ParseResult<RootNode> {
  runtimeArenaReset();
  const sourceText = createSourceTextBoundary(source);
  return parseTokenList(
    sourceText,
    tokens,
    lexicalTokenDiagnostics(tokens),
    undefined,
    false,
  );
}`;
}

function deterministicParseRuntime(): string {
  return `function parseTokenList(
  sourceText: SourceTextBoundary,
  tokens: readonly Token[],
  lexicalDiagnostics: readonly ParseDiagnostic[],
  _parseStream: undefined = undefined,
  trustRuntimeTerminals = false,
): ParseResult<RootNode> {
  if (lexicalDiagnostics.length > 0) {
    return failedParseResult(sourceText.source, tokens, lexicalDiagnostics);
  }

  const stream = compactTraceTokenStream(sourceText, tokens, trustRuntimeTerminals);
  let status = 0;
  try {
    for (let index = 0; index < stream.terminalCount; index++) {
      parserTraceSetTerminal(index, stream.terminals[index]);
    }
    status = parserTrace(stream.terminalCount);
  } catch (error) {
    return failedParseResult(
      sourceText.source,
      tokens,
      [internalParserDiagnostic(error, {
        start: sourceText.length,
        end: sourceText.length,
      })],
    );
  }

  const traceStatus = parserTraceStatusKind(status);
  if (traceStatus !== TRACE_STATUS_OK) {
    const errorIndex = parserTraceErrorIndex();
    const token = stream.tokens[errorIndex] ?? materializeSourceEofToken(sourceText);
    if (traceStatus === TRACE_STATUS_UNEXPECTED) {
      return failedParseResult(
        sourceText.source,
        tokens,
        [unexpectedTokenDiagnostic(
          token,
          parserTraceErrorState(),
        )],
      );
    }
    if (traceStatus === TRACE_STATUS_BRANCH_LIMIT) {
      return failedParseResult(
        sourceText.source,
        tokens,
        [branchLimitDiagnostic(sourceText.length)],
      );
    }
    return failedParseResult(
      sourceText.source,
      tokens,
      [parserInternalMessageDiagnostic(
        "Runtime-language parser trace failed.",
        currentSpan(token),
      )],
    );
  }

  const traceCount = parserTraceCount();
  const trace = new Int32Array(traceCount);
  for (let index = 0; index < traceCount; index++) {
    trace[index] = parserTraceAction(index) | 0;
  }

  return replayTrace(
    sourceText,
    tokens,
    stream.tokens,
    stream.tokenIndices,
    trace,
  );
}

interface CompactTraceTokenStream {
  tokens: readonly Token[];
  tokenIndices: readonly number[];
  terminals: Int32Array;
  terminalCount: number;
}

function compactTraceTokenStream(
  sourceText: SourceTextBoundary,
  tokens: readonly Token[],
  trustRuntimeTerminals: boolean,
): CompactTraceTokenStream {
  const streamTokens: Token[] = new Array(tokens.length + 1);
  const streamTokenIndices: number[] = new Array(tokens.length + 1);
  const terminals = new Int32Array(tokens.length + 1);
  let streamTokenCount = 0;
  let terminalCount = 0;
  let index = 0;
  while (true) {
    index = skipTrivia(tokens, index);
    const token = tokens[index] ?? materializeSourceEofToken(sourceText);
    streamTokens[streamTokenCount] = token;
    streamTokenIndices[streamTokenCount] = index < tokens.length ? index : tokens.length;
    streamTokenCount++;
    terminals[terminalCount] = tokenToTerminal(token, trustRuntimeTerminals);
    terminalCount++;
    if (token.type === "eof" || index >= tokens.length) break;
    index++;
  }
  streamTokens.length = streamTokenCount;
  streamTokenIndices.length = streamTokenCount;
  return { tokens: streamTokens, tokenIndices: streamTokenIndices, terminals, terminalCount };
}

${replayTraceRuntime("Runtime-language")}`;
}

function wasmParseRuntime(): string {
  return `function parseTokenList(
  sourceText: SourceTextBoundary,
  tokens: readonly Token[],
  lexicalDiagnostics: readonly ParseDiagnostic[],
  parseStream?: WasmParseStream,
  trustRuntimeTerminals = false,
): ParseResult<RootNode> {
  if (lexicalDiagnostics.length > 0) {
    return failedParseResult(sourceText.source, tokens, lexicalDiagnostics);
  }

  const stream = parseStream ??
    compactTokenStream(sourceText, tokens, trustRuntimeTerminals);
  const traced = parseTrace(stream.input, stream.terminalCount);
  if (!traced.ok) {
    const token = stream.tokens[traced.index] ?? materializeSourceEofToken(sourceText);
    if (traced.limit) {
      return failedParseResult(
        sourceText.source,
        tokens,
        [branchLimitDiagnostic(sourceText.length)],
      );
    }
    if (traced.internal) {
      return failedParseResult(
        sourceText.source,
        tokens,
        [parserInternalMessageDiagnostic(
          "Wasm parser trace failed.",
          currentSpan(token),
        )],
      );
    }
    return failedParseResult(
      sourceText.source,
      tokens,
      [unexpectedTokenDiagnostic(token, traced.state)],
    );
  }

  return replayTrace(
    sourceText,
    tokens,
    stream.tokens,
    stream.tokenIndices,
    traced.trace,
  );
}

interface CompactTokenStream {
  tokens: readonly Token[];
  tokenIndices: readonly number[];
  input: ParseTraceInput;
  terminalCount: number;
}

function compactTokenStream(
  sourceText: SourceTextBoundary,
  tokens: readonly Token[],
  trustRuntimeTerminals: boolean,
): CompactTokenStream {
  const streamTokens: Token[] = new Array(tokens.length + 1);
  const streamTokenIndices: number[] = new Array(tokens.length + 1);
  const terminalIds = new Int32Array(tokens.length + 1);
  let streamTokenCount = 0;
  let terminalCount = 0;
  let index = 0;
  while (true) {
    index = skipTrivia(tokens, index);
    const token = tokens[index] ?? materializeSourceEofToken(sourceText);
    streamTokens[streamTokenCount] = token;
    streamTokenIndices[streamTokenCount] = index < tokens.length ? index : tokens.length;
    streamTokenCount++;
    terminalIds[terminalCount] = tokenToTerminal(token, trustRuntimeTerminals);
    terminalCount++;
    if (token.type === "eof" || index >= tokens.length) break;
    index++;
  }
  streamTokens.length = streamTokenCount;
  streamTokenIndices.length = streamTokenCount;
  const input = createParseTraceInput(terminalCount);
  input.terminals.set(terminalIds.subarray(0, terminalCount));
  return { tokens: streamTokens, tokenIndices: streamTokenIndices, input, terminalCount };
}

${replayTraceRuntime("Wasm")}`;
}

function replayTraceRuntime(label: string): string {
  const replayPrelude = label === "Wasm"
    ? "  runtimeArenaReset();\n  RUNTIME_FRAGMENT_VALUES.clear();\n  resetPublicSyntaxMaterialization();\n"
    : "  RUNTIME_FRAGMENT_VALUES.clear();\n  resetPublicSyntaxMaterialization();\n";
  return `function replayTrace(
  sourceText: SourceTextBoundary,
  tokens: readonly Token[],
  streamTokens: readonly Token[],
  streamTokenIndices: readonly number[],
  trace: Int32Array,
): ParseResult<RootNode> {
${replayPrelude}  const values: unknown[] = [null];
  let index = 0;

  for (let traceIndex = 0; traceIndex < trace.length; traceIndex++) {
    const encoded = trace[traceIndex];
    const kind = parserActionKind(encoded);
    const payload = parserActionPayload(encoded);
    const actionStatus = parserReplayActionStatus(kind);

    if (actionStatus === REPLAY_ACTION_SHIFT) {
      values.push(shiftedToken(
        streamTokens[index] ?? materializeSourceEofToken(sourceText),
        streamTokenIndices[index] ?? tokens.length,
      ));
      index++;
      continue;
    }

    if (actionStatus === REPLAY_ACTION_ACCEPT) {
      return acceptedParseResult(sourceText, tokens, values[values.length - 1]);
    }

    const token = streamTokens[index] ?? materializeSourceEofToken(sourceText);
    if (actionStatus !== REPLAY_ACTION_REDUCE) {
      return failedParseResult(
        sourceText.source,
        tokens,
        [parserInternalMessageDiagnostic(
          "${label} parser trace contained an unknown action kind.",
          currentSpan(token),
        )],
      );
    }

    const rhsLength = parserProductionRhsLength(payload);
    const reducerOperation = parserReducerOperation(payload);
    const reducerPayload = parserReducerPayload(payload);
    const reducerPayloadStatus = parserReducerPayloadStatus(payload);
    const replayReductionStatus = parserReplayReductionStatus(
      rhsLength,
      reducerOperation,
      reducerPayloadStatus,
      values.length - 1,
    );
    if (replayReductionStatus === REPLAY_REDUCTION_UNKNOWN_PRODUCTION) {
      return failedParseResult(
        sourceText.source,
        tokens,
        [parserInternalMessageDiagnostic(
          "${label} parser trace referenced an unknown production.",
          currentSpan(token),
        )],
      );
    }
    if (
      replayReductionStatus === REPLAY_REDUCTION_RULE_PAYLOAD_MISSING ||
      replayReductionStatus === REPLAY_REDUCTION_FIELD_PAYLOAD_MISSING
    ) {
      return failedParseResult(
        sourceText.source,
        tokens,
        [parserInternalMessageDiagnostic(
          replayReductionStatus === REPLAY_REDUCTION_RULE_PAYLOAD_MISSING
            ? "Rule reducer is missing its rule id payload."
            : "Field reducer is missing its field id payload.",
          currentSpan(token),
        )],
      );
    }
    if (replayReductionStatus === REPLAY_REDUCTION_STACK_UNDERFLOW) {
      return failedParseResult(
        sourceText.source,
        tokens,
        [parserInternalMessageDiagnostic(
          "${label} parser trace underflowed the replay stack.",
          currentSpan(token),
        )],
      );
    }
    if (replayReductionStatus !== REPLAY_REDUCTION_OK) {
      return failedParseResult(
        sourceText.source,
        tokens,
        [parserInternalMessageDiagnostic(
          "${label} parser trace reduction validation failed.",
          currentSpan(token),
        )],
      );
    }
    const rhsValues = rhsLength === 0
      ? []
      : values.splice(values.length - rhsLength, rhsLength);
    let reduced: unknown;
    try {
      reduced = reduceProduction(
        reducerOperation,
        reducerPayload,
        rhsValues,
        token.span.start,
        streamTokenIndices[index] ?? tokens.length,
      );
    } catch (error) {
      return failedParseResult(
        sourceText.source,
        tokens,
        [internalParserDiagnostic(error, token.span)],
      );
    }
    values.push(reduced);
  }

  return failedParseResult(
    sourceText.source,
    tokens,
    [parserInternalMessageDiagnostic(
      "${label} parser trace ended without accepting.",
      { start: sourceText.length, end: sourceText.length },
    )],
  );
}`;
}

function reductionRuntime(): string {
  return `const RUNTIME_FRAGMENT_VALUES = new Map<number, unknown>();

function reduceProduction(
  reducerOperation: number,
  reducerPayload: number,
  rhs: readonly unknown[],
  offset: number,
  tokenIndex: number,
): unknown {
  const reducerResultKind = parserReducerResultKind(reducerOperation);
  switch (reducerResultKind) {
    case REDUCER_RESULT_RAW_CHILD:
      return reducerChild(reducerOperation, rhs, 0);
    case REDUCER_RESULT_RULE_NODE: {
      const fragment = reducerFragmentChild(reducerOperation, rhs, 0);
      const runtimeHandle = parserRuleNodeFromFragment(
        reducerPayload,
        fragment.runtimeHandle,
      );
      return materializeRuleNode(runtimeHandle);
    }
    case REDUCER_RESULT_CHILD_FRAGMENT:
      return reducerChild(reducerOperation, rhs, 0);
    case REDUCER_RESULT_SEQUENCE_FRAGMENT:
      return sequenceFragment(reducerOperation, rhs, offset, tokenIndex);
    case REDUCER_RESULT_EMPTY_NULL_FRAGMENT:
      return emptyFragment(null, offset, tokenIndex);
    case REDUCER_RESULT_EMPTY_ARRAY_FRAGMENT:
      return emptyFragment([], offset, tokenIndex);
    case REDUCER_RESULT_APPEND_FRAGMENT:
      return appendFragment(
        reducerFragmentChild(reducerOperation, rhs, 0),
        reducerFragmentChild(reducerOperation, rhs, 1),
      );
    case REDUCER_RESULT_FIRST_ARRAY_FRAGMENT: {
      const item = reducerFragmentChild(reducerOperation, rhs, 0);
      parserFragmentWrapValueVector(item.runtimeHandle);
      item.value = [item.value];
      rememberFragmentValue(item.runtimeHandle, item.value);
      item.span = fragmentSpan(item.runtimeHandle);
      item.tokenRange = fragmentTokenRange(item.runtimeHandle);
      return item;
    }
    case REDUCER_RESULT_SEPARATED_APPEND_FRAGMENT:
      return appendSeparatedFragment(
        reducerFragmentChild(reducerOperation, rhs, 0),
        reducerFragmentChild(reducerOperation, rhs, 1),
        reducerFragmentChild(reducerOperation, rhs, 2),
      );
    case REDUCER_RESULT_FIELD_FRAGMENT: {
      const fragment = reducerFragmentChild(reducerOperation, rhs, 0);
      const captureHandle = parserFieldCaptureNew(
        reducerPayload,
        fragment.runtimeHandle,
      );
      parserFragmentAppendField(fragment.runtimeHandle, captureHandle);
      return fragment;
    }
    default:
      throw new Error("Unknown parser reducer kind.");
  }
}

function tokenFragment(shifted: ShiftedToken): Fragment {
  const token = shifted.token;
  if (!isMainSyntaxToken(token)) {
    throw new Error("Expected shifted main syntax token.");
  }
  const tokenHandle = parserTokenNew(
    publicTokenClass(token),
    tokenSpecIndex(token),
    tokenToTerminal(token),
    token.span.start,
    token.span.end,
  );
  rememberSyntaxValue(tokenHandle, token);
  const runtimeHandle = parserFragmentFromToken(
    tokenHandle,
    shifted.tokenIndex,
  );
  rememberFragmentValue(runtimeHandle, token);
  return {
    runtimeHandle,
    value: token,
    span: token.span,
    tokenRange: { start: shifted.tokenIndex, end: shifted.tokenIndex + 1 },
  };
}

function ruleFragment(node: AnyRuleNode): Fragment {
  const runtimeHandle = runtimeRuleNodeFragmentHandle(node);
  rememberFragmentValue(runtimeHandle, node);
  return {
    runtimeHandle,
    value: node,
    span: fragmentSpan(runtimeHandle),
    tokenRange: fragmentTokenRange(runtimeHandle),
  };
}

function runtimeRuleNodeFragmentHandle(node: AnyRuleNode): number {
  const existing = hostRuleNodeRuntimeHandle(node);
  if (existing !== undefined) {
    const fragment = parserFragmentNew(
      existing,
      parserRuleNodeSpanStart(existing),
      parserRuleNodeSpanEnd(existing),
      parserRuleNodeTokenStart(existing),
      parserRuleNodeTokenEnd(existing),
    );
    parserFragmentAppendChild(fragment, existing);
    return fragment;
  }
  const fragment = parserFragmentNew(
    0,
    node.span.start,
    node.span.end,
    node.tokenRange.start,
    node.tokenRange.end,
  );
  return fragment;
}

function reducerChild(
  reducerOperation: number,
  values: readonly unknown[],
  slot: number,
): unknown {
  const role = parserReducerChildRole(reducerOperation, slot);
  const value = values[slot];
  if (role === REDUCER_CHILD_RAW) {
    return value;
  }
  if (role === REDUCER_CHILD_FRAGMENT) {
    return toFragment(value);
  }
  if (role === REDUCER_CHILD_SHIFTED_TOKEN) {
    return tokenFragment(value as ShiftedToken);
  }
  if (role === REDUCER_CHILD_RULE_NODE) {
    return ruleFragment(value as AnyRuleNode);
  }
  throw new Error("Unexpected parser reducer child role.");
}

function reducerFragmentChild(
  reducerOperation: number,
  values: readonly unknown[],
  slot: number,
): Fragment {
  const child = reducerChild(reducerOperation, values, slot);
  if (isFragment(child)) return child;
  throw new Error("Expected parser reducer child to produce a fragment.");
}

function sequenceFragment(
  reducerOperation: number,
  values: readonly unknown[],
  offset: number,
  tokenIndex: number,
): Fragment {
  const runtimeHandle = parserFragmentSequenceNew(offset, tokenIndex);
  const fragmentValues: unknown[] = [];
  for (let index = 0; index < values.length; index++) {
    const part = reducerFragmentChild(reducerOperation, values, index);
    parserFragmentSequenceAppend(runtimeHandle, part.runtimeHandle);
    fragmentValues.push(part.value);
  }
  rememberFragmentValue(runtimeHandle, fragmentValues);
  return {
    runtimeHandle,
    value: fragmentValues,
    span: fragmentSpan(runtimeHandle),
    tokenRange: fragmentTokenRange(runtimeHandle),
  };
}

function emptyFragment(
  value: unknown,
  offset: number,
  tokenIndex: number,
): Fragment {
  const runtimeHandle = Array.isArray(value)
    ? parserFragmentSequenceNew(offset, tokenIndex)
    : parserFragmentEmpty(0, offset, tokenIndex);
  rememberFragmentValue(runtimeHandle, value);
  return {
    runtimeHandle,
    value,
    span: fragmentSpan(runtimeHandle),
    tokenRange: fragmentTokenRange(runtimeHandle),
  };
}

function appendFragment(list: Fragment, item: Fragment): Fragment {
  parserFragmentAppendValue(list.runtimeHandle, item.runtimeHandle);
  const values = asMutableArray(list.value);
  values.push(item.value);
  rememberFragmentValue(list.runtimeHandle, values);
  return {
    runtimeHandle: list.runtimeHandle,
    value: values,
    span: fragmentSpan(list.runtimeHandle),
    tokenRange: fragmentTokenRange(list.runtimeHandle),
  };
}

function appendSeparatedFragment(
  list: Fragment,
  separator: Fragment,
  item: Fragment,
): Fragment {
  parserFragmentAppendSeparatedValue(
    list.runtimeHandle,
    separator.runtimeHandle,
    item.runtimeHandle,
  );
  const values = asMutableArray(list.value);
  values.push(item.value);
  rememberFragmentValue(list.runtimeHandle, values);
  return {
    runtimeHandle: list.runtimeHandle,
    value: values,
    span: fragmentSpan(list.runtimeHandle),
    tokenRange: fragmentTokenRange(list.runtimeHandle),
  };
}

function toFragment(value: unknown): Fragment {
  if (isFragment(value)) return value;
  if (isRuleNode(value)) return ruleFragment(value);
  if (isShiftedToken(value)) return tokenFragment(value);
  throw new Error("Expected parser reduction fragment, rule node, or token.");
}

function asMutableArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  throw new Error("Expected parser reduction array.");
}

function rememberFragmentValue(handle: number, value: unknown): void {
  RUNTIME_FRAGMENT_VALUES.set(handle, value);
}

function hostFragmentValue(handle: number): unknown {
  if (!RUNTIME_FRAGMENT_VALUES.has(handle)) {
    throw new Error("Runtime fragment is missing its host value.");
  }
  return RUNTIME_FRAGMENT_VALUES.get(handle);
}

function fragmentSpan(handle: number): Span {
  return {
    start: parserFragmentSpanStart(handle),
    end: parserFragmentSpanEnd(handle),
  };
}

function fragmentTokenRange(handle: number): TokenRange {
  return {
    start: parserFragmentTokenStart(handle),
    end: parserFragmentTokenEnd(handle),
  };
}

function buildFields(
  ruleId: number,
  ruleNodeHandle: number,
): Record<string, unknown> {
  const start = parserFieldStart(ruleId);
  const end = parserFieldEnd(ruleId);
  const captureCount = parserRuleNodeFieldCount(ruleNodeHandle);
  if (end <= start) {
    if (captureCount > 0) {
      throw new Error("Rule has field captures but no field schema.");
    }
    return createPublicFieldObject();
  }
  const counts = runtimeArrayNew(end - start);
  const fieldValues = runtimeRecordNew(ruleId, end - start);
  for (let entry = start; entry < end; entry++) {
    const valueClass = parserFieldValueClass(entry);
    if (valueClass === FIELD_VALUE_ARRAY) {
      runtimeRecordStore(fieldValues, entry - start, runtimeVectorNew(0));
    }
  }
  const captures = parserRuleNodeFields(ruleNodeHandle);
  for (let index = 0; index < captureCount; index++) {
    const capture = runtimeVectorLoad(captures, index);
    const fieldId = parserFieldCaptureFieldId(capture);
    const value = parserFieldCaptureValue(capture);
    const entry = parserFieldIndex(ruleId, fieldId);
    if (entry === NO_FIELD) {
      throw new Error(\`Unknown field capture '\${fieldName(fieldId)}'.\`);
    }
    const name = fieldName(fieldId);
    const countIndex = entry - start;
    const count = runtimeArrayLoad(counts, countIndex) + 1;
    runtimeArrayStore(counts, countIndex, count);
    const status = parserFieldCaptureStatus(
      entry,
      count,
    );
    if (status === FIELD_CAPTURE_ARRAY) {
      const values = runtimeRecordLoad(fieldValues, countIndex);
      if (values === 0) {
        throw new Error(\`Array field '\${name}' was not initialized as a runtime vector.\`);
      }
      runtimeVectorAppend(values, value);
    } else if (status === FIELD_CAPTURE_SCALAR) {
      runtimeRecordStore(fieldValues, countIndex, value);
    } else if (status === FIELD_CAPTURE_TOO_MANY) {
      throw new Error(\`Scalar field '\${name}' was captured more than once.\`);
    } else {
      throw new Error(\`Unknown field capture '\${fieldName(fieldId)}'.\`);
    }
  }
  const fields = createPublicFieldObject();
  for (let entry = start; entry < end; entry++) {
    const fieldId = parserFieldId(entry);
    const name = fieldName(fieldId);
    const valueIndex = entry - start;
    const count = runtimeArrayLoad(counts, valueIndex);
    const valueClass = parserFieldValueClass(entry);
    if (valueClass === FIELD_VALUE_ARRAY) {
      storePublicField(fields, name, materializeFieldArray(
        name,
        runtimeRecordLoad(fieldValues, valueIndex),
      ));
      continue;
    }
    const status = parserFieldFinalStatus(entry, count);
    if (status === FIELD_FINAL_REQUIRED_MISSING) {
      throw new Error(\`Required field '\${name}' was captured \${count} times.\`);
    }
    if (status === FIELD_FINAL_TOO_MANY) {
      throw new Error(\`Nullable field '\${name}' was captured more than once.\`);
    }
    storePublicField(
      fields,
      name,
      materializeFieldScalar(
        count,
        runtimeRecordLoad(fieldValues, valueIndex),
      ),
    );
  }
  return fields;
}

function fieldName(fieldId: number): string {
  return FIELD_NAMES[fieldId] ?? \`#\${fieldId}\`;
}

function acceptedParseResult(
  sourceText: SourceTextBoundary,
  tokens: readonly Token[],
  accepted: unknown,
): ParseResult<RootNode> {
  const root = isRuleNode(accepted)
    ? accepted as RootNode
    : isFragment(accepted) && isRuleNode(accepted.value)
    ? accepted.value as RootNode
    : null;
  if (root) {
    return successfulParseResult(sourceText.source, tokens, root);
  }
  return failedParseResult(
    sourceText.source,
    tokens,
    [parserInternalMessageDiagnostic(
      "Parser accepted without producing a root node.",
      { start: sourceText.length, end: sourceText.length },
    )],
  );
}

function tokenToTerminal(token: Token, trustRuntimeTerminal = false): number {
  if (token.type === "eof") return EOF_TERMINAL;
  if (trustRuntimeTerminal) {
    const terminal = runtimeTokenTerminal(token);
    if (terminal >= 0) return terminal;
  }
  const specIndex = tokenSpecIndex(token);
  if (specIndex < 0) return -1;
  const terminal = lexerSpecTerminal(specIndex);
  return terminal === NO_TERMINAL ? -1 : terminal;
}

function tokenSpecIndex(token: Token): number {
  if (token.type === "named") {
    return NAMED_SPEC_INDICES.get(token.kind) ?? -1;
  }
  if (token.type === "literal") {
    return LITERAL_SPEC_INDICES.get(token.literal) ?? -1;
  }
  return -1;
}

function publicTokenClass(token: Token): number {
  if (token.type === "error") return PUBLIC_TOKEN_ERROR;
  if (token.type === "literal") return PUBLIC_TOKEN_LITERAL;
  if (token.type === "named" && token.channel === "trivia") {
    return PUBLIC_TOKEN_TRIVIA;
  }
  return PUBLIC_TOKEN_MAIN;
}

function runtimeTokenTerminal(token: Token): number {
  const terminal = (token as { __babaTerminal?: unknown }).__babaTerminal;
  return typeof terminal === "number" && Number.isInteger(terminal) &&
      terminal >= 0
    ? terminal
    : -1;
}

function isTriviaToken(token: Token): boolean {
  return token.type === "named" && token.channel === "trivia";
}

function shiftedToken(token: Token, tokenIndex: number): ShiftedToken {
  return { token, tokenIndex };
}

function isRuleNode(value: unknown): value is AnyRuleNode {
  return !!value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "rule";
}

function isShiftedToken(value: unknown): value is ShiftedToken {
  return !!value &&
    typeof value === "object" &&
    "token" in value &&
    "tokenIndex" in value;
}

function isFragment(value: unknown): value is Fragment {
  return !!value &&
    typeof value === "object" &&
    "runtimeHandle" in value &&
    "value" in value &&
    "tokenRange" in value;
}

function isMainSyntaxToken(
  value: unknown,
): value is MainNamedToken | LiteralToken {
  return !!value &&
    typeof value === "object" &&
    (
      (value as { type?: unknown }).type === "literal" ||
      ((value as { type?: unknown; channel?: unknown }).type === "named" &&
        (value as { channel?: unknown }).channel === "main")
    );
}

function validateTokenStream(
  sourceText: SourceTextBoundary,
  tokens: readonly Token[],
): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  const canonical = lex(sourceText.source, { preserveTrivia: true });
  const canonicalTokens = canonical.tokens;
  let canonicalIndex = 0;
  let previousEnd = 0;
  let eofIndex = -1;

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const span = token.span;
    if (
      !Number.isInteger(span.start) ||
      !Number.isInteger(span.end) ||
      span.start < 0 ||
      span.end < 0
    ) {
      diagnostics.push(invalidTokenStream(
        \`Token at index \${index} has an invalid span.\`,
        clampSpan(span, sourceText.length),
      ));
      continue;
    }

    const boundsStatus = parserTokenStreamSpanBoundsStatus(
      span.start,
      span.end,
      sourceText.length,
    );
    if (boundsStatus === TOKEN_STREAM_INVALID_SPAN) {
      diagnostics.push(invalidTokenStream(
        \`Token at index \${index} has an invalid span.\`,
        clampSpan(span, sourceText.length),
      ));
      continue;
    }

    const positionStatus = parserTokenStreamSpanPositionStatus(
      span.start,
      previousEnd,
    );
    if (positionStatus === TOKEN_STREAM_GAP) {
      const gapDiagnostic = validateSourceGap(
        canonicalTokens,
        previousEnd,
        span.start,
      );
      if (gapDiagnostic) diagnostics.push(gapDiagnostic);
    }

    if (positionStatus === TOKEN_STREAM_OVERLAP) {
      diagnostics.push(invalidTokenStream(
        \`Token at index \${index} overlaps a previous token.\`,
        span,
      ));
    }
    previousEnd = Math.max(previousEnd, span.end);

    if (token.type === "eof") {
      const matched = matchCanonicalToken(
        canonicalTokens,
        canonicalIndex,
        token,
      );
      if (matched < 0) {
        diagnostics.push(invalidTokenStream(
          \`Token at index \${index} does not match canonical lexer output.\`,
          span,
        ));
      } else {
        canonicalIndex = matched + 1;
      }
      if (eofIndex !== -1) {
        diagnostics.push(invalidTokenStream(
          "Token stream contains more than one EOF token.",
          span,
        ));
      }
      eofIndex = index;
      const eofStatus = parserTokenStreamEofStatus(
        typeof token.text === "string" ? token.text.length : 0xffffffff,
        token.channel === "main" ? 1 : 0,
        span.start,
        span.end,
        sourceText.length,
      );
      if (eofStatus === TOKEN_STREAM_INVALID_EOF) {
        diagnostics.push(invalidTokenStream(
          "EOF token must have empty text, main channel, and an empty span at the end of the source.",
          span,
        ));
      }
      continue;
    }

    if (eofIndex !== -1) {
      diagnostics.push(invalidTokenStream(
        "Token stream contains tokens after EOF.",
        span,
      ));
    }

    if (
      parserTokenStreamWidthStatus(span.start, span.end) ===
        TOKEN_STREAM_ZERO_WIDTH
    ) {
      diagnostics.push(invalidTokenStream(
        \`Token at index \${index} has zero width.\`,
        span,
      ));
    }

    if (!sourceTextMatches(sourceText, span, token.text)) {
      diagnostics.push(invalidTokenStream(
        \`Token at index \${index} text does not match the source slice.\`,
        span,
      ));
    }
    if (token.type === "literal") {
      if (token.channel !== "main" || token.text !== token.literal) {
        diagnostics.push(invalidTokenStream(
          "Literal tokens must use the main channel and text equal to the literal.",
          span,
        ));
      }
      const specIndex = tokenSpecIndex(token);
      if (specIndex < 0) {
        diagnostics.push(invalidTokenStream(
          \`Literal token \${JSON.stringify(token.literal)} is not part of this parser's terminal set.\`,
          span,
        ));
      } else {
        const status = lexerSpecPublicTokenStatus(
          specIndex,
          PUBLIC_TOKEN_LITERAL,
        );
        if (status === SPEC_STATUS_NOT_LITERAL) {
          diagnostics.push(invalidTokenStream(
            \`Literal token \${JSON.stringify(token.literal)} is not a literal token kind.\`,
            span,
          ));
        } else if (status !== SPEC_STATUS_OK) {
          diagnostics.push(invalidTokenStream(
            \`Literal token \${JSON.stringify(token.literal)} is not part of this parser's terminal set.\`,
            span,
          ));
        }
      }
    } else if (token.type === "named") {
      if (token.channel !== "main" && token.channel !== "trivia") {
        diagnostics.push(invalidTokenStream(
          "Named tokens must use the main or trivia channel.",
          span,
        ));
      } else {
        const specIndex = tokenSpecIndex(token);
        if (specIndex < 0) {
          diagnostics.push(invalidTokenStream(
            \`Named token kind '\${token.kind}' is not part of this parser's lexer spec set.\`,
            span,
          ));
        } else {
          const status = lexerSpecPublicTokenStatus(
            specIndex,
            token.channel === "trivia"
              ? PUBLIC_TOKEN_TRIVIA
              : PUBLIC_TOKEN_MAIN,
          );
          if (status === SPEC_STATUS_NOT_MAIN) {
            diagnostics.push(invalidTokenStream(
              \`Named token kind '\${token.kind}' is not a main token kind.\`,
              span,
            ));
          } else if (status === SPEC_STATUS_NOT_TRIVIA) {
            diagnostics.push(invalidTokenStream(
              \`Named token kind '\${token.kind}' is not a trivia token kind.\`,
              span,
            ));
          } else if (status !== SPEC_STATUS_OK) {
            diagnostics.push(invalidTokenStream(
              \`Named token kind '\${token.kind}' is not part of this parser's lexer spec set.\`,
              span,
            ));
          }
        }
      }
    } else if (token.type === "error") {
      if (token.channel !== "error") {
        diagnostics.push(invalidTokenStream(
          "Error tokens must use the error channel.",
          span,
        ));
      }
    } else {
      diagnostics.push(invalidTokenStream("Token has an unknown type.", span));
    }
    const matched = matchCanonicalToken(
      canonicalTokens,
      canonicalIndex,
      token,
    );
    if (matched < 0) {
      diagnostics.push(invalidTokenStream(
        \`Token at index \${index} does not match canonical lexer output.\`,
        span,
      ));
    } else {
      canonicalIndex = matched + 1;
    }
  }

  if (eofIndex !== -1 && eofIndex !== tokens.length - 1) {
    diagnostics.push(invalidTokenStream(
      "EOF must be the final token in the stream.",
      tokens[eofIndex]?.span ?? {
        start: sourceText.length,
        end: sourceText.length,
      },
    ));
  }
  if (previousEnd < sourceText.length && eofIndex === -1) {
    const gapDiagnostic = validateSourceGap(
      canonicalTokens,
      previousEnd,
      sourceText.length,
    );
    if (gapDiagnostic) diagnostics.push(gapDiagnostic);
  }
  return diagnostics;
}

function validateSourceGap(
  canonicalTokens: readonly Token[],
  start: number,
  end: number,
): ParseDiagnostic | null {
  if (start === end) return null;
  for (const token of canonicalTokens) {
    if (token.type === "eof") continue;
    if (token.span.end <= start) continue;
    if (token.span.start >= end) break;
    const status = parserTokenStreamGapTokenStatus(
      publicTokenClass(token),
      token.span.start,
      token.span.end,
      start,
      end,
    );
    if (status !== TOKEN_STREAM_OK) {
      return invalidTokenStream(
        "Token stream omits nontrivia source text.",
        { start, end },
      );
    }
  }
  return null;
}

function matchCanonicalToken(
  canonicalTokens: readonly Token[],
  startIndex: number,
  token: Token,
): number {
  for (let index = startIndex; index < canonicalTokens.length; index++) {
    const canonical = canonicalTokens[index];
    if (canonical.type !== "eof" && isTriviaToken(canonical)) {
      if (sameToken(canonical, token)) return index;
      if (canonical.span.end <= token.span.start) continue;
    }
    return sameToken(canonical, token) ? index : -1;
  }
  return -1;
}

function sameToken(left: Token, right: Token): boolean {
  if (
    left.type !== right.type ||
    left.text !== right.text ||
    left.channel !== right.channel ||
    left.span.start !== right.span.start ||
    left.span.end !== right.span.end
  ) {
    return false;
  }
  if (left.type === "named" && right.type === "named") {
    return left.kind === right.kind;
  }
  if (left.type === "literal" && right.type === "literal") {
    return left.literal === right.literal;
  }
  return true;
}

function clampSpan(span: Span, sourceLength: number): Span {
  const start = Math.min(Math.max(0, span.start), sourceLength);
  const end = Math.min(Math.max(start, span.end), sourceLength);
  return { start, end };
}

function skipTrivia(tokens: readonly Token[], start: number): number {
  let index = start;
  while (tokens[index]?.type === "named" && tokens[index].channel === "trivia") {
    index++;
  }
  return index;
}`;
}

function bnfTableRows<T>(
  table: ReadonlyMap<number, ReadonlyMap<number, T>>,
  encode: (key: number, value: T) => GotoEntry,
): GotoEntry[][] {
  const maxState = Math.max(-1, ...table.keys());
  const rows: GotoEntry[][] = [];
  for (let state = 0; state <= maxState; state++) {
    const entries = [...(table.get(state)?.entries() ?? [])]
      .sort(([left], [right]) => left - right)
      .map(([key, value]) => encode(key, value));
    rows.push(entries);
  }
  return rows;
}

function bnfActionTableRows(
  table: ReadonlyMap<number, ReadonlyMap<number, LrActionSet>>,
): EncodedAction[][] {
  const maxState = Math.max(-1, ...table.keys());
  const rows: EncodedAction[][] = [];
  for (let state = 0; state <= maxState; state++) {
    const entries = [...(table.get(state)?.entries() ?? [])]
      .sort(([left], [right]) => left - right)
      .flatMap(([terminal, actions]) =>
        actions.map((action) => actionEntry(terminal, action))
      );
    rows.push(entries);
  }
  return rows;
}

function actionEntry(terminal: number, action: LrAction): EncodedAction {
  if (action.kind === "shift") return [terminal, 1, action.state];
  if (action.kind === "reduce") return [terminal, 2, action.production];
  return [terminal, 3];
}

function parserRuntimeActionRows(
  rows: readonly (readonly EncodedAction[])[],
): readonly (readonly (readonly [key: number, value: number])[])[] {
  return rows.map((row) =>
    row.map((entry) => [entry[0], encodeParserRuntimeAction(entry)] as const)
  );
}

function encodeParserRuntimeAction(action: EncodedAction): number {
  if (action[1] === 1) {
    assertParserRuntimePayload(action[2]);
    return RUNTIME_ACTION_SHIFT + action[2];
  }
  if (action[1] === 2) {
    assertParserRuntimePayload(action[2]);
    return RUNTIME_ACTION_REDUCE + action[2];
  }
  return RUNTIME_ACTION_ACCEPT;
}

function assertParserRuntimePayload(payload: number): void {
  if (payload < 0 || payload > RUNTIME_ACTION_PAYLOAD_MASK) {
    throw new Error(
      `Parser runtime action payload ${payload} exceeds the encoded action limit.`,
    );
  }
}

function parserRuntimeReducerEntry(
  reducer: ReducerSpec,
  fieldIds: ReadonlyMap<string, number>,
): readonly [kind: number, payload: number] {
  switch (reducer.kind) {
    case "start":
      return [RUNTIME_REDUCER_START, RUNTIME_NO_REDUCER_PAYLOAD];
    case "rule":
      return [RUNTIME_REDUCER_RULE, reducer.ruleId];
    case "terminal":
      return [RUNTIME_REDUCER_TERMINAL, RUNTIME_NO_REDUCER_PAYLOAD];
    case "ruleRef":
      return [RUNTIME_REDUCER_RULE_REF, RUNTIME_NO_REDUCER_PAYLOAD];
    case "identity":
      return [RUNTIME_REDUCER_IDENTITY, RUNTIME_NO_REDUCER_PAYLOAD];
    case "sequence":
      return [RUNTIME_REDUCER_SEQUENCE, RUNTIME_NO_REDUCER_PAYLOAD];
    case "optionalEmpty":
      return [RUNTIME_REDUCER_OPTIONAL_EMPTY, RUNTIME_NO_REDUCER_PAYLOAD];
    case "optionalSome":
      return [RUNTIME_REDUCER_OPTIONAL_SOME, RUNTIME_NO_REDUCER_PAYLOAD];
    case "repeatEmpty":
      return [RUNTIME_REDUCER_REPEAT_EMPTY, RUNTIME_NO_REDUCER_PAYLOAD];
    case "repeatAppend":
      return [RUNTIME_REDUCER_REPEAT_APPEND, RUNTIME_NO_REDUCER_PAYLOAD];
    case "repeat1First":
      return [RUNTIME_REDUCER_REPEAT1_FIRST, RUNTIME_NO_REDUCER_PAYLOAD];
    case "repeat1Append":
      return [RUNTIME_REDUCER_REPEAT1_APPEND, RUNTIME_NO_REDUCER_PAYLOAD];
    case "separatedFirst":
      return [RUNTIME_REDUCER_SEPARATED_FIRST, RUNTIME_NO_REDUCER_PAYLOAD];
    case "separatedAppend":
      return [RUNTIME_REDUCER_SEPARATED_APPEND, RUNTIME_NO_REDUCER_PAYLOAD];
    case "field": {
      const fieldId = fieldIds.get(reducer.name);
      if (fieldId === undefined) {
        throw new Error(
          `Field reducer '${reducer.name}' was not assigned a runtime field id.`,
        );
      }
      return [RUNTIME_REDUCER_FIELD, fieldId];
    }
  }
}

function expectedTerminalRows(
  bnf: BnfGrammar,
  lr: LrTable,
): readonly (readonly string[])[] {
  return lr.states.map((state) => {
    const row = lr.actions.get(state.id);
    return [
      ...new Set(
        [...(row?.keys() ?? [])].map((terminal) =>
          bnf.terminals[terminal]?.display ?? `#${terminal}`
        ),
      ),
    ].sort();
  });
}

function hasMultiActionEntries(
  table: ReadonlyMap<number, ReadonlyMap<number, LrActionSet>>,
): boolean {
  for (const row of table.values()) {
    for (const actions of row.values()) {
      if (actions.length > 1) return true;
    }
  }
  return false;
}
