import type {
  RuntimeExpression,
  RuntimeLanguageFunction,
  RuntimeLanguageProgram,
  RuntimeLanguageTable,
  RuntimeStatement,
} from "./language.ts";
import {
  PARSER_DIAGNOSTIC_CODE_PARSE_TRAILING_INPUT,
  PARSER_DIAGNOSTIC_CODE_PARSE_UNEXPECTED_TOKEN,
  PARSER_DIAGNOSTIC_DETAIL_NONE,
  PARSER_DIAGNOSTIC_DETAIL_PARSER_STATE,
} from "./diagnostic_codes.ts";

export const RUNTIME_NO_TRANSITION = 0xffff_ffff;
export const RUNTIME_NO_ACCEPT = RUNTIME_NO_TRANSITION;
export const RUNTIME_NO_LEXER_SPEC = 0xffff_ffff;
export const RUNTIME_NO_TERMINAL = 0xffff_ffff;
export const RUNTIME_NO_SPAN = 0xffff_ffff;
export const RUNTIME_LEXER_SPEC_LITERAL = 1;
export const RUNTIME_LEXER_SPEC_TRIVIA = 2;
export const RUNTIME_LEXER_TOKEN_UNKNOWN = 0;
export const RUNTIME_LEXER_TOKEN_LITERAL = 1;
export const RUNTIME_LEXER_TOKEN_TRIVIA = 2;
export const RUNTIME_LEXER_TOKEN_MAIN = 3;
export const RUNTIME_PUBLIC_TOKEN_LITERAL = 1;
export const RUNTIME_PUBLIC_TOKEN_MAIN = 2;
export const RUNTIME_PUBLIC_TOKEN_TRIVIA = 3;
export const RUNTIME_PUBLIC_TOKEN_ERROR = 4;
export const RUNTIME_PUBLIC_TOKEN_EOF = 5;
export const RUNTIME_PUBLIC_TOKEN_TYPE_UNKNOWN = 0;
export const RUNTIME_PUBLIC_TOKEN_TYPE_LITERAL = 1;
export const RUNTIME_PUBLIC_TOKEN_TYPE_NAMED = 2;
export const RUNTIME_PUBLIC_TOKEN_TYPE_ERROR = 3;
export const RUNTIME_PUBLIC_TOKEN_TYPE_EOF = 4;
export const RUNTIME_PUBLIC_TOKEN_CHANNEL_UNKNOWN = 0;
export const RUNTIME_PUBLIC_TOKEN_CHANNEL_MAIN = 1;
export const RUNTIME_PUBLIC_TOKEN_CHANNEL_TRIVIA = 2;
export const RUNTIME_PUBLIC_TOKEN_CHANNEL_ERROR = 3;
export const RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_OK = 0;
export const RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_INVALID_LITERAL = 1;
export const RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_INVALID_NAMED = 2;
export const RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_INVALID_ERROR = 3;
export const RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_UNKNOWN_TYPE = 4;
export const RUNTIME_LEXER_SPEC_STATUS_OK = 0;
export const RUNTIME_LEXER_SPEC_STATUS_UNKNOWN = 1;
export const RUNTIME_LEXER_SPEC_STATUS_NOT_LITERAL = 2;
export const RUNTIME_LEXER_SPEC_STATUS_NOT_MAIN = 3;
export const RUNTIME_LEXER_SPEC_STATUS_NOT_TRIVIA = 4;
export const RUNTIME_LEXICAL_TOKEN_STATUS_OK = 0;
export const RUNTIME_LEXICAL_TOKEN_STATUS_ERROR_TOKEN = 1;
export const RUNTIME_LEXICAL_TOKEN_STATUS_NOT_TERMINAL = 2;
export const RUNTIME_TOKEN_STREAM_STATUS_OK = 0;
export const RUNTIME_TOKEN_STREAM_STATUS_INVALID_SPAN = 1;
export const RUNTIME_TOKEN_STREAM_STATUS_GAP = 2;
export const RUNTIME_TOKEN_STREAM_STATUS_OVERLAP = 3;
export const RUNTIME_TOKEN_STREAM_STATUS_ZERO_WIDTH = 4;
export const RUNTIME_TOKEN_STREAM_STATUS_INVALID_EOF = 5;
export const RUNTIME_TOKEN_STREAM_STATUS_NONTRIVIA_GAP = 6;
export const RUNTIME_TOKEN_STREAM_STATUS_TOKEN_MISMATCH = 7;
export const RUNTIME_TOKEN_STREAM_CANONICAL_MATCH = 0;
export const RUNTIME_TOKEN_STREAM_CANONICAL_SKIP = 1;
export const RUNTIME_TOKEN_STREAM_CANONICAL_MISMATCH = 2;
export const RUNTIME_TRACE_TOKEN_STREAM_EMIT = 0;
export const RUNTIME_TRACE_TOKEN_STREAM_SKIP = 1;
export const RUNTIME_TRACE_TOKEN_STREAM_STOP = 2;
export const RUNTIME_SHIFTED_TOKEN_STATUS_OK = 0;
export const RUNTIME_SHIFTED_TOKEN_STATUS_INVALID = 1;
export const RUNTIME_RULE_NODE_CHILD_LIST_EMPTY = 0;
export const RUNTIME_RULE_NODE_CHILD_LIST_PRESENT = 1;
export const RUNTIME_ACTION_NONE = 0;
export const RUNTIME_ACTION_SHIFT = 0x01_00_00_00;
export const RUNTIME_ACTION_REDUCE = 0x02_00_00_00;
export const RUNTIME_ACTION_ACCEPT = 0x03_00_00_00;
export const RUNTIME_ACTION_KIND_MASK = 0xff_00_00_00;
export const RUNTIME_ACTION_PAYLOAD_MASK = 0x00_ff_ff_ff;
export const RUNTIME_TRACE_STATUS_OK = 0;
export const RUNTIME_TRACE_STATUS_UNEXPECTED = 1;
export const RUNTIME_TRACE_STATUS_INTERNAL = 2;
export const RUNTIME_TRACE_STATUS_BRANCH_LIMIT = 3;
export const RUNTIME_REPLAY_ACTION_STATUS_UNKNOWN = 0;
export const RUNTIME_REPLAY_ACTION_STATUS_SHIFT = 1;
export const RUNTIME_REPLAY_ACTION_STATUS_REDUCE = 2;
export const RUNTIME_REPLAY_ACTION_STATUS_ACCEPT = 3;
export const RUNTIME_NO_GOTO = 0xffff_ffff;
export const RUNTIME_NO_PRODUCTION = 0xffff_ffff;
export const RUNTIME_REDUCER_UNKNOWN = 0;
export const RUNTIME_REDUCER_START = 1;
export const RUNTIME_REDUCER_RULE = 2;
export const RUNTIME_REDUCER_TERMINAL = 3;
export const RUNTIME_REDUCER_RULE_REF = 4;
export const RUNTIME_REDUCER_IDENTITY = 5;
export const RUNTIME_REDUCER_SEQUENCE = 6;
export const RUNTIME_REDUCER_OPTIONAL_EMPTY = 7;
export const RUNTIME_REDUCER_OPTIONAL_SOME = 8;
export const RUNTIME_REDUCER_REPEAT_EMPTY = 9;
export const RUNTIME_REDUCER_REPEAT_APPEND = 10;
export const RUNTIME_REDUCER_REPEAT1_FIRST = 11;
export const RUNTIME_REDUCER_REPEAT1_APPEND = 12;
export const RUNTIME_REDUCER_SEPARATED_FIRST = 13;
export const RUNTIME_REDUCER_SEPARATED_APPEND = 14;
export const RUNTIME_REDUCER_FIELD = 15;
export const RUNTIME_NO_REDUCER_PAYLOAD = 0xffff_ffff;
export const RUNTIME_REDUCER_OPERATION_UNKNOWN = 0;
export const RUNTIME_REDUCER_OPERATION_START = 1;
export const RUNTIME_REDUCER_OPERATION_RULE = 2;
export const RUNTIME_REDUCER_OPERATION_TERMINAL = 3;
export const RUNTIME_REDUCER_OPERATION_RULE_REF = 4;
export const RUNTIME_REDUCER_OPERATION_IDENTITY = 5;
export const RUNTIME_REDUCER_OPERATION_SEQUENCE = 6;
export const RUNTIME_REDUCER_OPERATION_EMPTY_NULL = 7;
export const RUNTIME_REDUCER_OPERATION_EMPTY_ARRAY = 8;
export const RUNTIME_REDUCER_OPERATION_APPEND = 9;
export const RUNTIME_REDUCER_OPERATION_FIRST_ARRAY = 10;
export const RUNTIME_REDUCER_OPERATION_SEPARATED_APPEND = 11;
export const RUNTIME_REDUCER_OPERATION_FIELD = 12;
export const RUNTIME_REDUCER_PAYLOAD_STATUS_OK = 0;
export const RUNTIME_REDUCER_PAYLOAD_STATUS_UNKNOWN = 1;
export const RUNTIME_REDUCER_PAYLOAD_STATUS_RULE_MISSING = 2;
export const RUNTIME_REDUCER_PAYLOAD_STATUS_FIELD_MISSING = 3;
export const RUNTIME_REDUCER_CHILD_UNKNOWN = 0;
export const RUNTIME_REDUCER_CHILD_RAW = 1;
export const RUNTIME_REDUCER_CHILD_FRAGMENT = 2;
export const RUNTIME_REDUCER_CHILD_SHIFTED_TOKEN = 3;
export const RUNTIME_REDUCER_CHILD_RULE_NODE = 4;
export const RUNTIME_REDUCER_RESULT_UNKNOWN = 0;
export const RUNTIME_REDUCER_RESULT_RAW_CHILD = 1;
export const RUNTIME_REDUCER_RESULT_RULE_NODE = 2;
export const RUNTIME_REDUCER_RESULT_CHILD_FRAGMENT = 3;
export const RUNTIME_REDUCER_RESULT_SEQUENCE_FRAGMENT = 4;
export const RUNTIME_REDUCER_RESULT_EMPTY_NULL_FRAGMENT = 5;
export const RUNTIME_REDUCER_RESULT_EMPTY_ARRAY_FRAGMENT = 6;
export const RUNTIME_REDUCER_RESULT_APPEND_FRAGMENT = 7;
export const RUNTIME_REDUCER_RESULT_FIRST_ARRAY_FRAGMENT = 8;
export const RUNTIME_REDUCER_RESULT_SEPARATED_APPEND_FRAGMENT = 9;
export const RUNTIME_REDUCER_RESULT_FIELD_FRAGMENT = 10;
export const RUNTIME_REPLAY_REDUCTION_STATUS_OK = 0;
export const RUNTIME_REPLAY_REDUCTION_STATUS_UNKNOWN_PRODUCTION = 1;
export const RUNTIME_REPLAY_REDUCTION_STATUS_RULE_PAYLOAD_MISSING = 2;
export const RUNTIME_REPLAY_REDUCTION_STATUS_FIELD_PAYLOAD_MISSING = 3;
export const RUNTIME_REPLAY_REDUCTION_STATUS_STACK_UNDERFLOW = 4;
export const RUNTIME_NO_FIELD = 0xffff_ffff;
export const RUNTIME_FIELD_ARRAY = 1;
export const RUNTIME_FIELD_NULLABLE = 2;
export const RUNTIME_FIELD_VALUE_REQUIRED = 1;
export const RUNTIME_FIELD_VALUE_NULLABLE = 2;
export const RUNTIME_FIELD_VALUE_ARRAY = 3;
export const RUNTIME_FIELD_CAPTURE_UNKNOWN = 0;
export const RUNTIME_FIELD_CAPTURE_SCALAR = 1;
export const RUNTIME_FIELD_CAPTURE_ARRAY = 2;
export const RUNTIME_FIELD_CAPTURE_TOO_MANY = 3;
export const RUNTIME_FIELD_SCHEMA_STATUS_OK = 0;
export const RUNTIME_FIELD_SCHEMA_STATUS_CAPTURE_WITHOUT_SCHEMA = 1;
export const RUNTIME_FIELD_BUILD_EMPTY = 0;
export const RUNTIME_FIELD_BUILD_PRESENT = 1;
export const RUNTIME_FIELD_BUILD_CAPTURE_WITHOUT_SCHEMA = 2;
export const RUNTIME_FIELD_ENTRY_PRESENT = 0;
export const RUNTIME_FIELD_ENTRY_MISSING = 1;
export const RUNTIME_FIELD_STORAGE_SCALAR = 0;
export const RUNTIME_FIELD_STORAGE_ARRAY = 1;
export const RUNTIME_FIELD_ARRAY_VALUE_OK = 0;
export const RUNTIME_FIELD_ARRAY_VALUE_MISSING = 1;
export const RUNTIME_FIELD_SCALAR_VALUE_NULL = 0;
export const RUNTIME_FIELD_SCALAR_VALUE_FRAGMENT = 1;
export const RUNTIME_FIELD_FINAL_OK = 0;
export const RUNTIME_FIELD_FINAL_REQUIRED_MISSING = 1;
export const RUNTIME_FIELD_FINAL_TOO_MANY = 2;

const TRACE_STATUS = 1;
const TRACE_ERROR_STATE = 2;
const TRACE_ERROR_INDEX = 3;
const TRACE_COUNT = 4;
const TRACE_BASE = 5;
const TRACE_TERMINALS_BASE = 8;
const TRACE_STATUS_OK = RUNTIME_TRACE_STATUS_OK;
const TRACE_STATUS_UNEXPECTED = RUNTIME_TRACE_STATUS_UNEXPECTED;
const TRACE_STATUS_INTERNAL = RUNTIME_TRACE_STATUS_INTERNAL;
const TRACE_STATUS_BRANCH_LIMIT = RUNTIME_TRACE_STATUS_BRANCH_LIMIT;
const TRACE_BRANCH_LIMIT = 100_000;

const LEXER_SCAN_STATE = 0;
const LEXER_SCAN_LENGTH = 1;
const LEXER_SCAN_BEST_SPEC = 2;
const LEXER_SCAN_BEST_END = 3;
const LEXER_SCAN_DONE = 4;
const RUNTIME_ARENA_NEXT_WORD = 0;
const RUNTIME_ARENA_FIRST_WORD = 1;
const RUNTIME_OBJECT_ARRAY = 1;
const RUNTIME_OBJECT_RECORD = 2;
const RUNTIME_OBJECT_VECTOR = 3;
const RUNTIME_OBJECT_PARSER_FRAGMENT = 4;
const RUNTIME_OBJECT_PARSER_FIELD_CAPTURE = 5;
const RUNTIME_OBJECT_PARSER_RULE_NODE = 6;
const RUNTIME_OBJECT_PARSER_TOKEN = 7;
const RUNTIME_OBJECT_PARSER_DIAGNOSTIC = 8;
const RUNTIME_ARRAY_LENGTH_WORD_OFFSET = 1;
const RUNTIME_ARRAY_DATA_WORD_OFFSET = 2;
const RUNTIME_RECORD_TAG_WORD_OFFSET = 1;
const RUNTIME_RECORD_FIELD_COUNT_WORD_OFFSET = 2;
const RUNTIME_RECORD_DATA_WORD_OFFSET = 3;
const RUNTIME_VECTOR_LENGTH_WORD_OFFSET = 1;
const RUNTIME_VECTOR_CAPACITY_WORD_OFFSET = 2;
const RUNTIME_VECTOR_DATA_WORD_OFFSET = 3;
const RUNTIME_VECTOR_HEADER_WORDS = 4;
const RUNTIME_PARSER_FRAGMENT_VALUE_WORD_OFFSET = 1;
const RUNTIME_PARSER_FRAGMENT_SPAN_START_WORD_OFFSET = 2;
const RUNTIME_PARSER_FRAGMENT_SPAN_END_WORD_OFFSET = 3;
const RUNTIME_PARSER_FRAGMENT_TOKEN_START_WORD_OFFSET = 4;
const RUNTIME_PARSER_FRAGMENT_TOKEN_END_WORD_OFFSET = 5;
const RUNTIME_PARSER_FRAGMENT_CHILDREN_WORD_OFFSET = 6;
const RUNTIME_PARSER_FRAGMENT_FIELDS_WORD_OFFSET = 7;
const RUNTIME_PARSER_FRAGMENT_HEADER_WORDS = 8;
const RUNTIME_PARSER_FIELD_CAPTURE_FIELD_ID_WORD_OFFSET = 1;
const RUNTIME_PARSER_FIELD_CAPTURE_VALUE_WORD_OFFSET = 2;
const RUNTIME_PARSER_FIELD_CAPTURE_HEADER_WORDS = 3;
const RUNTIME_PARSER_RULE_NODE_RULE_ID_WORD_OFFSET = 1;
const RUNTIME_PARSER_RULE_NODE_SPAN_START_WORD_OFFSET = 2;
const RUNTIME_PARSER_RULE_NODE_SPAN_END_WORD_OFFSET = 3;
const RUNTIME_PARSER_RULE_NODE_TOKEN_START_WORD_OFFSET = 4;
const RUNTIME_PARSER_RULE_NODE_TOKEN_END_WORD_OFFSET = 5;
const RUNTIME_PARSER_RULE_NODE_CHILDREN_WORD_OFFSET = 6;
const RUNTIME_PARSER_RULE_NODE_FIELDS_WORD_OFFSET = 7;
const RUNTIME_PARSER_RULE_NODE_HEADER_WORDS = 8;
const RUNTIME_PARSER_TOKEN_CLASS_WORD_OFFSET = 1;
const RUNTIME_PARSER_TOKEN_PAYLOAD_WORD_OFFSET = 2;
const RUNTIME_PARSER_TOKEN_TERMINAL_WORD_OFFSET = 3;
const RUNTIME_PARSER_TOKEN_SPAN_START_WORD_OFFSET = 4;
const RUNTIME_PARSER_TOKEN_SPAN_END_WORD_OFFSET = 5;
const RUNTIME_PARSER_TOKEN_HEADER_WORDS = 6;
const RUNTIME_PARSER_DIAGNOSTIC_CODE_WORD_OFFSET = 1;
const RUNTIME_PARSER_DIAGNOSTIC_SPAN_START_WORD_OFFSET = 2;
const RUNTIME_PARSER_DIAGNOSTIC_SPAN_END_WORD_OFFSET = 3;
const RUNTIME_PARSER_DIAGNOSTIC_DETAIL_WORD_OFFSET = 4;
const RUNTIME_PARSER_DIAGNOSTIC_HEADER_WORDS = 5;

export type LexerRuntimeTransition = readonly [
  start: number,
  end: number,
  target: number,
];
export type LexerRuntimeSpecEntry = readonly [
  flags: number,
  payload: number,
  terminal: number,
];

export interface LexerRuntimeProgramInput {
  readonly transitions: readonly (readonly LexerRuntimeTransition[])[];
  readonly asciiTransitions: readonly (readonly number[])[] | null;
  readonly accepts?: readonly number[];
  readonly specs?: readonly LexerRuntimeSpecEntry[];
  readonly includeTokenRecords?: boolean;
}

export interface LexerSpecRuntimeProgramInput {
  readonly specs: readonly LexerRuntimeSpecEntry[];
}

export type ParserRuntimeLookupEntry = readonly [key: number, value: number];
export type ParserRuntimeProductionEntry = readonly [
  lhs: number,
  rhsLength: number,
];
export type ParserRuntimeReducerEntry = readonly [
  kind: number,
  payload: number,
];
export type ParserRuntimeFieldEntry = readonly [
  fieldId: number,
  flags: number,
];

export interface ParserTableRuntimeProgramInput {
  readonly actionRows: readonly (readonly ParserRuntimeLookupEntry[])[];
  readonly gotoRows: readonly (readonly ParserRuntimeLookupEntry[])[];
}

export interface ParserProductionRuntimeProgramInput {
  readonly productions: readonly ParserRuntimeProductionEntry[];
}

export interface ParserReducerRuntimeProgramInput {
  readonly reducers: readonly ParserRuntimeReducerEntry[];
}

export interface ParserFieldRuntimeProgramInput {
  readonly fieldRows: readonly (readonly ParserRuntimeFieldEntry[])[];
}

export interface ParserTraceRuntimeProgramInput
  extends ParserTableRuntimeProgramInput, ParserProductionRuntimeProgramInput {}

export interface ParserConflictTableRuntimeProgramInput
  extends ParserTableRuntimeProgramInput, ParserProductionRuntimeProgramInput {}

export interface ParserConflictTraceRuntimeProgramInput
  extends ParserTableRuntimeProgramInput, ParserProductionRuntimeProgramInput {}

export interface ParserGotoRuntimeProgramInput {
  readonly gotoRows: readonly (readonly ParserRuntimeLookupEntry[])[];
}

export interface ParserExpectedRuntimeProgramInput {
  readonly rowLengths: readonly number[];
  readonly rowHasEof?: readonly boolean[];
}

const UTF16_CODE_POINT_WIDTH_FUNCTION: RuntimeLanguageFunction = {
  name: "utf16CodePointWidth",
  parameters: [{ name: "codePoint", type: "u32" }],
  result: "u32",
  body: [{
    kind: "if",
    condition: lt(local("codePoint"), u32(0x1_00_00)),
    consequent: [{ kind: "return", expression: u32(1) }],
    alternate: [{ kind: "return", expression: u32(2) }],
  }],
};

const UTF16_CODE_POINT_FROM_UNITS_FUNCTION: RuntimeLanguageFunction = {
  name: "utf16CodePointFromUnits",
  parameters: [
    { name: "leadUnit", type: "u32" },
    { name: "trailUnit", type: "u32" },
    { name: "hasTrail", type: "u32" },
  ],
  result: "u32",
  body: [
    {
      kind: "if",
      condition: eq(local("hasTrail"), u32(0)),
      consequent: [{ kind: "return", expression: local("leadUnit") }],
    },
    {
      kind: "if",
      condition: lt(local("leadUnit"), u32(0xd800)),
      consequent: [{ kind: "return", expression: local("leadUnit") }],
    },
    {
      kind: "if",
      condition: lt(u32(0xdbff), local("leadUnit")),
      consequent: [{ kind: "return", expression: local("leadUnit") }],
    },
    {
      kind: "if",
      condition: lt(local("trailUnit"), u32(0xdc00)),
      consequent: [{ kind: "return", expression: local("leadUnit") }],
    },
    {
      kind: "if",
      condition: lt(u32(0xdfff), local("trailUnit")),
      consequent: [{ kind: "return", expression: local("leadUnit") }],
    },
    {
      kind: "return",
      expression: add(
        u32(0x1_00_00),
        add(
          mul(sub(local("leadUnit"), u32(0xd800)), u32(0x400)),
          sub(local("trailUnit"), u32(0xdc00)),
        ),
      ),
    },
  ],
};

export const UTF16_CODE_POINT_WIDTH_PROGRAM: RuntimeLanguageProgram = {
  name: "utf16_code_point_width",
  entry: "utf16CodePointWidth",
  functions: [
    UTF16_CODE_POINT_WIDTH_FUNCTION,
    UTF16_CODE_POINT_FROM_UNITS_FUNCTION,
  ],
};

export const RUNTIME_ARENA_PROGRAM: RuntimeLanguageProgram = {
  name: "runtime_arena",
  entry: "runtimeArenaReset",
  scratchMemoryWords: RUNTIME_ARENA_FIRST_WORD,
  functions: runtimeArenaFunctions(),
};

export function createParserObjectRuntimeProgram(
  options: { includeArena?: boolean } = {},
): RuntimeLanguageProgram {
  const includeArena = options.includeArena ?? true;
  return {
    name: "parser_object_runtime",
    entry: "parserFragmentNew",
    scratchMemoryWords: RUNTIME_ARENA_FIRST_WORD,
    functions: includeArena
      ? [
        ...runtimeArenaFunctions(),
        ...parserObjectFunctions(),
      ]
      : parserObjectFunctions(),
  };
}

export function createParserTokenRecordRuntimeProgram(): RuntimeLanguageProgram {
  return {
    name: "parser_token_record_runtime",
    entry: "parserTokenNew",
    scratchMemoryWords: RUNTIME_ARENA_FIRST_WORD,
    functions: parserTokenRecordFunctions(),
  };
}

export function createLexerRuntimeProgram(
  input: LexerRuntimeProgramInput,
): RuntimeLanguageProgram {
  const transitionRows: number[] = [];
  const transitionValues: number[] = [];
  for (const ranges of input.transitions) {
    transitionRows.push(transitionValues.length / 3);
    for (const [start, end, target] of ranges) {
      transitionValues.push(start, end, target);
    }
  }
  transitionRows.push(transitionValues.length / 3);

  const tables: RuntimeLanguageTable[] = [
    {
      name: "dfaTransitionRows",
      type: "u32" as const,
      values: transitionRows,
    },
    {
      name: "dfaTransitionValues",
      type: "u32" as const,
      values: transitionValues,
    },
  ];

  if (input.asciiTransitions) {
    const asciiValues = input.asciiTransitions.flatMap((row) =>
      row.map((target) => target < 0 ? RUNTIME_NO_TRANSITION : target)
    );
    tables.push({
      name: "dfaAsciiTransitions",
      type: "u32" as const,
      values: asciiValues,
    });
  }

  if (input.accepts) {
    tables.push({
      name: "dfaAccepts",
      type: "u32" as const,
      values: input.accepts.map((accept) =>
        accept < 0 ? RUNTIME_NO_ACCEPT : accept
      ),
    });
  }

  if (input.specs) {
    tables.push(lexerSpecTable(input.specs));
  }

  return {
    name: "lexer_runtime",
    entry: "dfaTransition",
    scratchMemoryWords: input.includeTokenRecords
      ? Math.max(input.accepts ? 5 : 0, RUNTIME_ARENA_FIRST_WORD)
      : input.accepts
      ? 5
      : undefined,
    tables,
    functions: [
      UTF16_CODE_POINT_WIDTH_FUNCTION,
      UTF16_CODE_POINT_FROM_UNITS_FUNCTION,
      dfaTransitionFunction(input.asciiTransitions !== null),
      ...(input.accepts
        ? [
          lexerScanResetFunction(),
          lexerScanAdvanceFunction(),
          lexerScanBestSpecFunction(),
          lexerScanBestEndFunction(),
        ]
        : []),
      ...(input.specs ? lexerSpecFunctions(input.specs.length) : []),
      ...(input.includeTokenRecords ? parserTokenRecordFunctions() : []),
    ],
  };
}

export function createLexerSpecRuntimeProgram(
  input: LexerSpecRuntimeProgramInput,
): RuntimeLanguageProgram {
  return {
    name: "lexer_spec_runtime",
    entry: "lexerSpecTerminal",
    tables: [lexerSpecTable(input.specs)],
    functions: lexerSpecFunctions(input.specs.length, {
      includePublicTokenStatus: true,
    }),
  };
}

export function createParserTableRuntimeProgram(
  input: ParserTableRuntimeProgramInput,
): RuntimeLanguageProgram {
  const actionTable = flattenLookupTable("parserAction", input.actionRows);
  const gotoTable = flattenLookupTable("parserGoto", input.gotoRows);
  return {
    name: "parser_table_runtime",
    entry: "parserAction",
    tables: [
      ...actionTable.tables,
      ...gotoTable.tables,
    ],
    functions: [
      tableLookupFunction(
        "parserAction",
        actionTable.rowsTable,
        actionTable.entriesTable,
        RUNTIME_ACTION_NONE,
      ),
      tableLookupFunction(
        "parserGoto",
        gotoTable.rowsTable,
        gotoTable.entriesTable,
        RUNTIME_NO_GOTO,
      ),
    ],
  };
}

export function createParserActionRuntimeProgram(): RuntimeLanguageProgram {
  return {
    name: "parser_action_runtime",
    entry: "parserActionKind",
    functions: parserActionFunctions(),
  };
}

export function createParserTraceRuntimeProgram(
  input: ParserTraceRuntimeProgramInput,
): RuntimeLanguageProgram {
  const actionTable = flattenLookupTable("parserAction", input.actionRows);
  const gotoTable = flattenLookupTable("parserGoto", input.gotoRows);
  return {
    name: "parser_trace_runtime",
    entry: "parserTrace",
    scratchMemoryWords: 0,
    tables: [
      ...actionTable.tables,
      ...gotoTable.tables,
      parserProductionsTable(input.productions),
    ],
    functions: [
      tableLookupFunction(
        "parserAction",
        actionTable.rowsTable,
        actionTable.entriesTable,
        RUNTIME_ACTION_NONE,
      ),
      tableLookupFunction(
        "parserGoto",
        gotoTable.rowsTable,
        gotoTable.entriesTable,
        RUNTIME_NO_GOTO,
      ),
      ...parserActionFunctions(),
      ...parserProductionFunctions(input.productions.length),
      ...runtimeArenaFunctions(),
      parserTraceSetTerminalFunction(),
      parserTraceFunction(input.productions.length),
      parserTraceErrorStateFunction(),
      parserTraceErrorIndexFunction(),
      parserTraceCountFunction(),
      parserTraceActionFunction("vector"),
      parserTraceStatusKindFunction(),
    ],
  };
}

export function createParserConflictTableRuntimeProgram(
  input: ParserConflictTableRuntimeProgramInput,
): RuntimeLanguageProgram {
  const actionTable = flattenLookupTable("parserAction", input.actionRows);
  const gotoTable = flattenLookupTable("parserGoto", input.gotoRows);
  return {
    name: "parser_conflict_table_runtime",
    entry: "parserActionAt",
    tables: [
      ...actionTable.tables,
      ...gotoTable.tables,
      parserProductionsTable(input.productions),
    ],
    functions: [
      tableLookupAtFunction(
        "parserActionAt",
        actionTable.rowsTable,
        actionTable.entriesTable,
        RUNTIME_ACTION_NONE,
      ),
      parserActionCountFunction(),
      tableLookupFunction(
        "parserGoto",
        gotoTable.rowsTable,
        gotoTable.entriesTable,
        RUNTIME_NO_GOTO,
      ),
      ...parserActionFunctions(),
      ...parserProductionFunctions(input.productions.length),
    ],
  };
}

export function createParserConflictTraceRuntimeProgram(
  input: ParserConflictTraceRuntimeProgramInput,
): RuntimeLanguageProgram {
  const actionTable = flattenLookupTable("parserAction", input.actionRows);
  const gotoTable = flattenLookupTable("parserGoto", input.gotoRows);
  return {
    name: "parser_conflict_trace_runtime",
    entry: "parserTrace",
    scratchMemoryWords: 0,
    tables: [
      ...actionTable.tables,
      ...gotoTable.tables,
      parserProductionsTable(input.productions),
    ],
    functions: [
      tableLookupAtFunction(
        "parserActionAt",
        actionTable.rowsTable,
        actionTable.entriesTable,
        RUNTIME_ACTION_NONE,
      ),
      parserActionCountFunction(),
      tableLookupFunction(
        "parserGoto",
        gotoTable.rowsTable,
        gotoTable.entriesTable,
        RUNTIME_NO_GOTO,
      ),
      ...parserActionFunctions(),
      ...parserProductionFunctions(input.productions.length),
      ...runtimeArenaFunctions(),
      parserTraceSetTerminalFunction(),
      parserConflictTraceFunction(input.productions.length),
      parserTraceErrorStateFunction(),
      parserTraceErrorIndexFunction(),
      parserTraceCountFunction(),
      parserTraceActionFunction("vector"),
      parserTraceStatusKindFunction(),
    ],
  };
}

export function createParserProductionRuntimeProgram(
  input: ParserProductionRuntimeProgramInput,
): RuntimeLanguageProgram {
  return {
    name: "parser_production_runtime",
    entry: "parserProductionLhs",
    tables: [
      parserProductionsTable(input.productions),
    ],
    functions: parserProductionFunctions(input.productions.length),
  };
}

export function createParserReducerRuntimeProgram(
  input: ParserReducerRuntimeProgramInput,
): RuntimeLanguageProgram {
  return {
    name: "parser_reducer_runtime",
    entry: "parserReducerKind",
    tables: [
      parserReducersTable(input.reducers),
    ],
    functions: parserReducerFunctions(input.reducers.length),
  };
}

export function createParserFieldRuntimeProgram(
  input: ParserFieldRuntimeProgramInput,
): RuntimeLanguageProgram {
  const rows: number[] = [];
  const values: number[] = [];
  for (const entries of input.fieldRows) {
    rows.push(values.length / 2);
    for (const [fieldId, flags] of entries) values.push(fieldId, flags);
  }
  rows.push(values.length / 2);
  return {
    name: "parser_field_runtime",
    entry: "parserFieldStart",
    tables: [
      {
        name: "parserFieldRows",
        type: "u32",
        values: rows,
      },
      {
        name: "parserFieldEntries",
        type: "u32",
        values,
      },
    ],
    functions: parserFieldFunctions(input.fieldRows.length, values.length / 2),
  };
}

export function createParserGotoRuntimeProgram(
  input: ParserGotoRuntimeProgramInput,
): RuntimeLanguageProgram {
  const gotoTable = flattenLookupTable("parserGoto", input.gotoRows);
  return {
    name: "parser_goto_runtime",
    entry: "parserGoto",
    tables: gotoTable.tables,
    functions: [
      tableLookupFunction(
        "parserGoto",
        gotoTable.rowsTable,
        gotoTable.entriesTable,
        RUNTIME_NO_GOTO,
      ),
    ],
  };
}

export function createParserExpectedRuntimeProgram(
  input: ParserExpectedRuntimeProgramInput,
): RuntimeLanguageProgram {
  const rows: number[] = [];
  let cursor = 0;
  for (const length of input.rowLengths) {
    rows.push(cursor);
    cursor += length;
  }
  rows.push(cursor);
  return {
    name: "parser_expected_runtime",
    entry: "parserExpectedStart",
    tables: [
      {
        name: "parserExpectedRows",
        type: "u32",
        values: rows,
      },
      {
        name: "parserExpectedFlags",
        type: "u32",
        values: input.rowLengths.map((_, index) =>
          input.rowHasEof?.[index] ? 1 : 0
        ),
      },
    ],
    functions: [
      parserExpectedStartFunction(input.rowLengths.length),
      parserExpectedEndFunction(input.rowLengths.length),
      parserExpectedHasEofFunction(input.rowLengths.length),
      parserUnexpectedDiagnosticCodeFunction(),
    ],
  };
}

export function createParserRangeRuntimeProgram(): RuntimeLanguageProgram {
  return {
    name: "parser_range_runtime",
    entry: "parserMergeStart",
    functions: [
      parserMergeStartFunction(),
      parserMergeEndFunction(),
    ],
  };
}

function runtimeArenaFunctions(): RuntimeLanguageFunction[] {
  return [
    runtimeArenaResetFunction(),
    runtimeArenaResetToFunction(),
    runtimeArenaUsedFunction(),
    runtimeArenaAllocFunction(),
    runtimeObjectKindFunction(),
    runtimeExpectObjectKindFunction(),
    runtimeArrayNewFunction(),
    runtimeArrayLengthFunction(),
    runtimeArrayElementOffsetFunction(),
    runtimeArrayLoadFunction(),
    runtimeArrayStoreFunction(),
    runtimeRecordNewFunction(),
    runtimeRecordTagFunction(),
    runtimeRecordFieldCountFunction(),
    runtimeRecordFieldOffsetFunction(),
    runtimeRecordLoadFunction(),
    runtimeRecordStoreFunction(),
    runtimeVectorNewFunction(),
    runtimeVectorLengthFunction(),
    runtimeVectorCapacityFunction(),
    runtimeVectorDataFunction(),
    runtimeVectorLoadFunction(),
    runtimeVectorStoreFunction(),
    runtimeVectorTruncateFunction(),
    runtimeVectorCloneFunction(),
    runtimeVectorAppendFunction(),
    runtimeVectorAppendAllFunction(),
  ];
}

function runtimeArenaResetFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeArenaReset",
    result: "u32",
    body: [
      {
        kind: "return",
        expression: call("runtimeArenaResetTo", [
          u32(RUNTIME_ARENA_FIRST_WORD),
        ]),
      },
    ],
  };
}

function runtimeArenaResetToFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeArenaResetTo",
    parameters: [
      { name: "firstWord", type: "u32" },
    ],
    locals: [
      { name: "capacity", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(local("firstWord"), u32(0)),
        consequent: [{ kind: "trap" }],
      },
      setLocal("capacity", ensureScratch(local("firstWord"))),
      storeScratch(
        u32(RUNTIME_ARENA_NEXT_WORD),
        local("firstWord"),
      ),
      { kind: "return", expression: local("firstWord") },
    ],
  };
}

function runtimeArenaUsedFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeArenaUsed",
    result: "u32",
    body: [
      { kind: "return", expression: loadScratch(u32(RUNTIME_ARENA_NEXT_WORD)) },
    ],
  };
}

function runtimeArenaAllocFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeArenaAlloc",
    parameters: [
      { name: "words", type: "u32" },
    ],
    locals: [
      { name: "base", type: "u32" },
      { name: "next", type: "u32" },
      { name: "capacity", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal("base", loadScratch(u32(RUNTIME_ARENA_NEXT_WORD))),
      {
        kind: "if",
        condition: eq(local("base"), u32(0)),
        consequent: [
          setLocal("base", u32(RUNTIME_ARENA_FIRST_WORD)),
          storeScratch(u32(RUNTIME_ARENA_NEXT_WORD), local("base")),
        ],
      },
      setLocal("next", add(local("base"), local("words"))),
      {
        kind: "if",
        condition: ltu(local("next"), local("base")),
        consequent: [{ kind: "trap" }],
      },
      setLocal("capacity", ensureScratch(local("next"))),
      storeScratch(u32(RUNTIME_ARENA_NEXT_WORD), local("next")),
      { kind: "return", expression: local("base") },
    ],
  };
}

function runtimeObjectKindFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeObjectKind",
    parameters: [
      { name: "handle", type: "u32" },
    ],
    locals: [
      { name: "used", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(local("handle"), u32(0)),
        consequent: [{ kind: "trap" }],
      },
      setLocal("used", loadScratch(u32(RUNTIME_ARENA_NEXT_WORD))),
      {
        kind: "if",
        condition: ltu(local("handle"), local("used")),
        consequent: [],
        alternate: [{ kind: "trap" }],
      },
      { kind: "return", expression: loadScratch(local("handle")) },
    ],
  };
}

function runtimeExpectObjectKindFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeExpectObjectKind",
    parameters: [
      { name: "handle", type: "u32" },
      { name: "expectedKind", type: "u32" },
    ],
    locals: [
      { name: "actualKind", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal("actualKind", call("runtimeObjectKind", [local("handle")])),
      {
        kind: "if",
        condition: eq(local("actualKind"), local("expectedKind")),
        consequent: [],
        alternate: [{ kind: "trap" }],
      },
      { kind: "return", expression: local("handle") },
    ],
  };
}

function runtimeArrayNewFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeArrayNew",
    parameters: [
      { name: "length", type: "u32" },
    ],
    locals: [
      { name: "handle", type: "u32" },
      { name: "total", type: "u32" },
      { name: "index", type: "u32" },
      { name: "offset", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal(
        "total",
        add(local("length"), u32(RUNTIME_ARRAY_DATA_WORD_OFFSET)),
      ),
      {
        kind: "if",
        condition: ltu(local("total"), local("length")),
        consequent: [{ kind: "trap" }],
      },
      setLocal("handle", call("runtimeArenaAlloc", [local("total")])),
      storeScratch(local("handle"), u32(RUNTIME_OBJECT_ARRAY)),
      storeScratch(
        add(local("handle"), u32(RUNTIME_ARRAY_LENGTH_WORD_OFFSET)),
        local("length"),
      ),
      setLocal("index", u32(0)),
      {
        kind: "while",
        condition: ltu(local("index"), local("length")),
        body: [
          setLocal(
            "offset",
            add(
              add(local("handle"), u32(RUNTIME_ARRAY_DATA_WORD_OFFSET)),
              local("index"),
            ),
          ),
          storeScratch(local("offset"), u32(0)),
          setLocal("index", add(local("index"), u32(1))),
        ],
      },
      { kind: "return", expression: local("handle") },
    ],
  };
}

function runtimeArrayLengthFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeArrayLength",
    parameters: [
      { name: "handle", type: "u32" },
    ],
    locals: [
      { name: "discard", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal(
        "discard",
        call("runtimeExpectObjectKind", [
          local("handle"),
          u32(RUNTIME_OBJECT_ARRAY),
        ]),
      ),
      {
        kind: "return",
        expression: loadScratch(
          add(local("handle"), u32(RUNTIME_ARRAY_LENGTH_WORD_OFFSET)),
        ),
      },
    ],
  };
}

function runtimeArrayElementOffsetFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeArrayElementOffset",
    parameters: [
      { name: "handle", type: "u32" },
      { name: "index", type: "u32" },
    ],
    locals: [
      { name: "length", type: "u32" },
      { name: "offset", type: "u32" },
      { name: "next", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal("length", call("runtimeArrayLength", [local("handle")])),
      {
        kind: "if",
        condition: ltu(local("index"), local("length")),
        consequent: [],
        alternate: [{ kind: "trap" }],
      },
      setLocal(
        "offset",
        add(
          add(local("handle"), u32(RUNTIME_ARRAY_DATA_WORD_OFFSET)),
          local("index"),
        ),
      ),
      {
        kind: "if",
        condition: ltu(local("offset"), local("handle")),
        consequent: [{ kind: "trap" }],
      },
      setLocal("next", add(local("offset"), u32(1))),
      {
        kind: "if",
        condition: ltu(local("next"), local("offset")),
        consequent: [{ kind: "trap" }],
      },
      {
        kind: "if",
        condition: ltu(
          loadScratch(u32(RUNTIME_ARENA_NEXT_WORD)),
          local("next"),
        ),
        consequent: [{ kind: "trap" }],
      },
      { kind: "return", expression: local("offset") },
    ],
  };
}

function runtimeArrayLoadFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeArrayLoad",
    parameters: [
      { name: "handle", type: "u32" },
      { name: "index", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "return",
        expression: loadScratch(
          call("runtimeArrayElementOffset", [
            local("handle"),
            local("index"),
          ]),
        ),
      },
    ],
  };
}

function runtimeArrayStoreFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeArrayStore",
    parameters: [
      { name: "handle", type: "u32" },
      { name: "index", type: "u32" },
      { name: "value", type: "u32" },
    ],
    locals: [
      { name: "offset", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal(
        "offset",
        call("runtimeArrayElementOffset", [
          local("handle"),
          local("index"),
        ]),
      ),
      storeScratch(local("offset"), local("value")),
      { kind: "return", expression: local("value") },
    ],
  };
}

function runtimeRecordNewFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeRecordNew",
    parameters: [
      { name: "tag", type: "u32" },
      { name: "fieldCount", type: "u32" },
    ],
    locals: [
      { name: "handle", type: "u32" },
      { name: "total", type: "u32" },
      { name: "index", type: "u32" },
      { name: "offset", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal(
        "total",
        add(local("fieldCount"), u32(RUNTIME_RECORD_DATA_WORD_OFFSET)),
      ),
      {
        kind: "if",
        condition: ltu(local("total"), local("fieldCount")),
        consequent: [{ kind: "trap" }],
      },
      setLocal("handle", call("runtimeArenaAlloc", [local("total")])),
      storeScratch(local("handle"), u32(RUNTIME_OBJECT_RECORD)),
      storeScratch(
        add(local("handle"), u32(RUNTIME_RECORD_TAG_WORD_OFFSET)),
        local("tag"),
      ),
      storeScratch(
        add(local("handle"), u32(RUNTIME_RECORD_FIELD_COUNT_WORD_OFFSET)),
        local("fieldCount"),
      ),
      setLocal("index", u32(0)),
      {
        kind: "while",
        condition: ltu(local("index"), local("fieldCount")),
        body: [
          setLocal(
            "offset",
            add(
              add(local("handle"), u32(RUNTIME_RECORD_DATA_WORD_OFFSET)),
              local("index"),
            ),
          ),
          storeScratch(local("offset"), u32(0)),
          setLocal("index", add(local("index"), u32(1))),
        ],
      },
      { kind: "return", expression: local("handle") },
    ],
  };
}

function runtimeRecordTagFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeRecordTag",
    parameters: [
      { name: "handle", type: "u32" },
    ],
    locals: [
      { name: "discard", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal(
        "discard",
        call("runtimeExpectObjectKind", [
          local("handle"),
          u32(RUNTIME_OBJECT_RECORD),
        ]),
      ),
      {
        kind: "return",
        expression: loadScratch(
          add(local("handle"), u32(RUNTIME_RECORD_TAG_WORD_OFFSET)),
        ),
      },
    ],
  };
}

function runtimeRecordFieldCountFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeRecordFieldCount",
    parameters: [
      { name: "handle", type: "u32" },
    ],
    locals: [
      { name: "discard", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal(
        "discard",
        call("runtimeExpectObjectKind", [
          local("handle"),
          u32(RUNTIME_OBJECT_RECORD),
        ]),
      ),
      {
        kind: "return",
        expression: loadScratch(
          add(local("handle"), u32(RUNTIME_RECORD_FIELD_COUNT_WORD_OFFSET)),
        ),
      },
    ],
  };
}

function runtimeRecordFieldOffsetFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeRecordFieldOffset",
    parameters: [
      { name: "handle", type: "u32" },
      { name: "field", type: "u32" },
    ],
    locals: [
      { name: "fieldCount", type: "u32" },
      { name: "offset", type: "u32" },
      { name: "next", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal(
        "fieldCount",
        call("runtimeRecordFieldCount", [local("handle")]),
      ),
      {
        kind: "if",
        condition: ltu(local("field"), local("fieldCount")),
        consequent: [],
        alternate: [{ kind: "trap" }],
      },
      setLocal(
        "offset",
        add(
          add(local("handle"), u32(RUNTIME_RECORD_DATA_WORD_OFFSET)),
          local("field"),
        ),
      ),
      {
        kind: "if",
        condition: ltu(local("offset"), local("handle")),
        consequent: [{ kind: "trap" }],
      },
      setLocal("next", add(local("offset"), u32(1))),
      {
        kind: "if",
        condition: ltu(local("next"), local("offset")),
        consequent: [{ kind: "trap" }],
      },
      {
        kind: "if",
        condition: ltu(
          loadScratch(u32(RUNTIME_ARENA_NEXT_WORD)),
          local("next"),
        ),
        consequent: [{ kind: "trap" }],
      },
      { kind: "return", expression: local("offset") },
    ],
  };
}

function runtimeRecordLoadFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeRecordLoad",
    parameters: [
      { name: "handle", type: "u32" },
      { name: "field", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "return",
        expression: loadScratch(
          call("runtimeRecordFieldOffset", [
            local("handle"),
            local("field"),
          ]),
        ),
      },
    ],
  };
}

function runtimeRecordStoreFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeRecordStore",
    parameters: [
      { name: "handle", type: "u32" },
      { name: "field", type: "u32" },
      { name: "value", type: "u32" },
    ],
    locals: [
      { name: "offset", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal(
        "offset",
        call("runtimeRecordFieldOffset", [
          local("handle"),
          local("field"),
        ]),
      ),
      storeScratch(local("offset"), local("value")),
      { kind: "return", expression: local("value") },
    ],
  };
}

function runtimeVectorNewFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeVectorNew",
    parameters: [
      { name: "capacity", type: "u32" },
    ],
    locals: [
      { name: "handle", type: "u32" },
      { name: "data", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal("data", call("runtimeArrayNew", [local("capacity")])),
      setLocal(
        "handle",
        call("runtimeArenaAlloc", [u32(RUNTIME_VECTOR_HEADER_WORDS)]),
      ),
      storeScratch(local("handle"), u32(RUNTIME_OBJECT_VECTOR)),
      storeScratch(
        add(local("handle"), u32(RUNTIME_VECTOR_LENGTH_WORD_OFFSET)),
        u32(0),
      ),
      storeScratch(
        add(local("handle"), u32(RUNTIME_VECTOR_CAPACITY_WORD_OFFSET)),
        local("capacity"),
      ),
      storeScratch(
        add(local("handle"), u32(RUNTIME_VECTOR_DATA_WORD_OFFSET)),
        local("data"),
      ),
      { kind: "return", expression: local("handle") },
    ],
  };
}

function runtimeVectorLengthFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeVectorLength",
    parameters: [
      { name: "handle", type: "u32" },
    ],
    locals: [
      { name: "discard", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal(
        "discard",
        call("runtimeExpectObjectKind", [
          local("handle"),
          u32(RUNTIME_OBJECT_VECTOR),
        ]),
      ),
      {
        kind: "return",
        expression: loadScratch(
          add(local("handle"), u32(RUNTIME_VECTOR_LENGTH_WORD_OFFSET)),
        ),
      },
    ],
  };
}

function runtimeVectorCapacityFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeVectorCapacity",
    parameters: [
      { name: "handle", type: "u32" },
    ],
    locals: [
      { name: "length", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal("length", call("runtimeVectorLength", [local("handle")])),
      {
        kind: "return",
        expression: loadScratch(
          add(local("handle"), u32(RUNTIME_VECTOR_CAPACITY_WORD_OFFSET)),
        ),
      },
    ],
  };
}

function runtimeVectorDataFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeVectorData",
    parameters: [
      { name: "handle", type: "u32" },
    ],
    locals: [
      { name: "length", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal("length", call("runtimeVectorLength", [local("handle")])),
      {
        kind: "return",
        expression: loadScratch(
          add(local("handle"), u32(RUNTIME_VECTOR_DATA_WORD_OFFSET)),
        ),
      },
    ],
  };
}

function runtimeVectorLoadFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeVectorLoad",
    parameters: [
      { name: "handle", type: "u32" },
      { name: "index", type: "u32" },
    ],
    locals: [
      { name: "length", type: "u32" },
      { name: "data", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal("length", call("runtimeVectorLength", [local("handle")])),
      {
        kind: "if",
        condition: ltu(local("index"), local("length")),
        consequent: [],
        alternate: [{ kind: "trap" }],
      },
      setLocal("data", call("runtimeVectorData", [local("handle")])),
      {
        kind: "return",
        expression: call("runtimeArrayLoad", [
          local("data"),
          local("index"),
        ]),
      },
    ],
  };
}

function runtimeVectorStoreFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeVectorStore",
    parameters: [
      { name: "handle", type: "u32" },
      { name: "index", type: "u32" },
      { name: "value", type: "u32" },
    ],
    locals: [
      { name: "length", type: "u32" },
      { name: "data", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal("length", call("runtimeVectorLength", [local("handle")])),
      {
        kind: "if",
        condition: ltu(local("index"), local("length")),
        consequent: [],
        alternate: [{ kind: "trap" }],
      },
      setLocal("data", call("runtimeVectorData", [local("handle")])),
      {
        kind: "return",
        expression: call("runtimeArrayStore", [
          local("data"),
          local("index"),
          local("value"),
        ]),
      },
    ],
  };
}

function runtimeVectorTruncateFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeVectorTruncate",
    parameters: [
      { name: "handle", type: "u32" },
      { name: "length", type: "u32" },
    ],
    locals: [
      { name: "oldLength", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal("oldLength", call("runtimeVectorLength", [local("handle")])),
      {
        kind: "if",
        condition: ltu(local("oldLength"), local("length")),
        consequent: [{ kind: "trap" }],
      },
      storeScratch(
        add(local("handle"), u32(RUNTIME_VECTOR_LENGTH_WORD_OFFSET)),
        local("length"),
      ),
      { kind: "return", expression: local("length") },
    ],
  };
}

function runtimeVectorCloneFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeVectorClone",
    parameters: [
      { name: "handle", type: "u32" },
    ],
    locals: [
      { name: "length", type: "u32" },
      { name: "clone", type: "u32" },
      { name: "index", type: "u32" },
      { name: "value", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal("length", call("runtimeVectorLength", [local("handle")])),
      setLocal("clone", call("runtimeVectorNew", [local("length")])),
      setLocal("index", u32(0)),
      {
        kind: "while",
        condition: ltu(local("index"), local("length")),
        body: [
          setLocal(
            "value",
            call("runtimeVectorLoad", [local("handle"), local("index")]),
          ),
          setLocal(
            "value",
            call("runtimeVectorAppend", [local("clone"), local("value")]),
          ),
          setLocal("index", add(local("index"), u32(1))),
        ],
      },
      { kind: "return", expression: local("clone") },
    ],
  };
}

function runtimeVectorAppendFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeVectorAppend",
    parameters: [
      { name: "handle", type: "u32" },
      { name: "value", type: "u32" },
    ],
    locals: [
      { name: "length", type: "u32" },
      { name: "capacity", type: "u32" },
      { name: "newCapacity", type: "u32" },
      { name: "oldData", type: "u32" },
      { name: "newData", type: "u32" },
      { name: "index", type: "u32" },
      { name: "copied", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal("length", call("runtimeVectorLength", [local("handle")])),
      setLocal("capacity", call("runtimeVectorCapacity", [local("handle")])),
      setLocal("oldData", call("runtimeVectorData", [local("handle")])),
      {
        kind: "if",
        condition: ltu(local("length"), local("capacity")),
        consequent: [],
        alternate: [
          {
            kind: "if",
            condition: eq(local("capacity"), u32(0)),
            consequent: [
              setLocal("newCapacity", u32(1)),
            ],
            alternate: [
              setLocal(
                "newCapacity",
                add(local("capacity"), local("capacity")),
              ),
              {
                kind: "if",
                condition: ltu(local("newCapacity"), local("capacity")),
                consequent: [{ kind: "trap" }],
              },
            ],
          },
          setLocal("newData", call("runtimeArrayNew", [local("newCapacity")])),
          setLocal("index", u32(0)),
          {
            kind: "while",
            condition: ltu(local("index"), local("length")),
            body: [
              setLocal(
                "copied",
                call("runtimeArrayLoad", [local("oldData"), local("index")]),
              ),
              setLocal(
                "copied",
                call("runtimeArrayStore", [
                  local("newData"),
                  local("index"),
                  local("copied"),
                ]),
              ),
              setLocal("index", add(local("index"), u32(1))),
            ],
          },
          storeScratch(
            add(local("handle"), u32(RUNTIME_VECTOR_CAPACITY_WORD_OFFSET)),
            local("newCapacity"),
          ),
          storeScratch(
            add(local("handle"), u32(RUNTIME_VECTOR_DATA_WORD_OFFSET)),
            local("newData"),
          ),
          setLocal("capacity", local("newCapacity")),
          setLocal("oldData", local("newData")),
        ],
      },
      setLocal(
        "copied",
        call("runtimeArrayStore", [
          local("oldData"),
          local("length"),
          local("value"),
        ]),
      ),
      storeScratch(
        add(local("handle"), u32(RUNTIME_VECTOR_LENGTH_WORD_OFFSET)),
        add(local("length"), u32(1)),
      ),
      { kind: "return", expression: local("value") },
    ],
  };
}

function runtimeVectorAppendAllFunction(): RuntimeLanguageFunction {
  return {
    name: "runtimeVectorAppendAll",
    parameters: [
      { name: "target", type: "u32" },
      { name: "source", type: "u32" },
    ],
    locals: [
      { name: "length", type: "u32" },
      { name: "index", type: "u32" },
      { name: "value", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal("length", call("runtimeVectorLength", [local("source")])),
      setLocal("index", u32(0)),
      {
        kind: "while",
        condition: ltu(local("index"), local("length")),
        body: [
          setLocal(
            "value",
            call("runtimeVectorLoad", [local("source"), local("index")]),
          ),
          setLocal(
            "value",
            call("runtimeVectorAppend", [local("target"), local("value")]),
          ),
          setLocal("index", add(local("index"), u32(1))),
        ],
      },
      { kind: "return", expression: local("target") },
    ],
  };
}

function parserObjectFunctions(): RuntimeLanguageFunction[] {
  return [
    parserFragmentNewFunction(),
    parserFragmentValueFunction(),
    parserFragmentSpanStartFunction(),
    parserFragmentSpanEndFunction(),
    parserFragmentTokenStartFunction(),
    parserFragmentTokenEndFunction(),
    parserFragmentChildrenFunction(),
    parserFragmentFieldsFunction(),
    parserFragmentChildCountFunction(),
    parserFragmentChildAtFunction(),
    parserFragmentAppendChildFunction(),
    parserFragmentFieldCountFunction(),
    parserFragmentFieldAtFunction(),
    parserFragmentAppendFieldFunction(),
    parserFragmentSetValueFunction(),
    parserFragmentMergeFromFunction(),
    parserFragmentEmptyFunction(),
    parserFragmentSequenceNewFunction(),
    parserFragmentSequenceAppendFunction(),
    parserFragmentWrapValueVectorFunction(),
    parserFragmentAppendValueFunction(),
    parserFragmentAppendSeparatedValueFunction(),
    parserFieldCaptureNewFunction(),
    parserFieldCaptureFieldIdFunction(),
    parserFieldCaptureValueFunction(),
    parserTokenNewFunction(),
    parserTokenClassFunction(),
    parserTokenPayloadFunction(),
    parserTokenTerminalFunction(),
    parserTokenSpanStartFunction(),
    parserTokenSpanEndFunction(),
    parserFragmentFromTokenFunction(),
    parserDiagnosticNewFunction(),
    parserDiagnosticCodeFunction(),
    parserDiagnosticSpanStartFunction(),
    parserDiagnosticSpanEndFunction(),
    parserDiagnosticDetailFunction(),
    parserDiagnosticDetailKindIdFunction(),
    parserTokenStreamSpanBoundsStatusFunction(),
    parserTokenStreamSpanPositionStatusFunction(),
    parserTokenStreamWidthStatusFunction(),
    parserTokenStreamEofStatusFunction(),
    parserTokenStreamGapTokenStatusFunction(),
    parserTokenStreamTokenMatchStatusFunction(),
    parserTokenStreamCanonicalMatchStatusFunction(),
    parserTokenStreamFinalStatusFunction(),
    parserTokenStreamPublicTokenStatusFunction(),
    parserTraceTokenStreamStatusFunction(),
    parserTraceTerminalFunction(),
    parserShiftedTokenStatusFunction(),
    parserRuleNodeFromFragmentFunction(),
    parserRuleNodeRuleIdFunction(),
    parserRuleNodeSpanStartFunction(),
    parserRuleNodeSpanEndFunction(),
    parserRuleNodeTokenStartFunction(),
    parserRuleNodeTokenEndFunction(),
    parserRuleNodeChildrenFunction(),
    parserRuleNodeFieldsFunction(),
    parserRuleNodeChildCountFunction(),
    parserRuleNodeChildListStatusFunction(),
    parserRuleNodeFieldCountFunction(),
  ];
}

function parserTokenRecordFunctions(): RuntimeLanguageFunction[] {
  return [
    runtimeArenaResetFunction(),
    runtimeArenaResetToFunction(),
    runtimeArenaAllocFunction(),
    runtimeObjectKindFunction(),
    runtimeExpectObjectKindFunction(),
    parserTokenNewFunction(),
    parserTokenClassFunction(),
    parserTokenPayloadFunction(),
    parserTokenTerminalFunction(),
    parserTokenSpanStartFunction(),
    parserTokenSpanEndFunction(),
  ];
}

function parserFragmentNewFunction(): RuntimeLanguageFunction {
  return {
    name: "parserFragmentNew",
    parameters: [
      { name: "value", type: "u32" },
      { name: "spanStart", type: "u32" },
      { name: "spanEnd", type: "u32" },
      { name: "tokenStart", type: "u32" },
      { name: "tokenEnd", type: "u32" },
    ],
    locals: [
      { name: "handle", type: "u32" },
      { name: "children", type: "u32" },
      { name: "fields", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal("children", call("runtimeVectorNew", [u32(0)])),
      setLocal("fields", call("runtimeVectorNew", [u32(0)])),
      setLocal(
        "handle",
        call("runtimeArenaAlloc", [u32(RUNTIME_PARSER_FRAGMENT_HEADER_WORDS)]),
      ),
      storeScratch(local("handle"), u32(RUNTIME_OBJECT_PARSER_FRAGMENT)),
      storeScratch(
        add(local("handle"), u32(RUNTIME_PARSER_FRAGMENT_VALUE_WORD_OFFSET)),
        local("value"),
      ),
      storeScratch(
        add(
          local("handle"),
          u32(RUNTIME_PARSER_FRAGMENT_SPAN_START_WORD_OFFSET),
        ),
        local("spanStart"),
      ),
      storeScratch(
        add(local("handle"), u32(RUNTIME_PARSER_FRAGMENT_SPAN_END_WORD_OFFSET)),
        local("spanEnd"),
      ),
      storeScratch(
        add(
          local("handle"),
          u32(RUNTIME_PARSER_FRAGMENT_TOKEN_START_WORD_OFFSET),
        ),
        local("tokenStart"),
      ),
      storeScratch(
        add(
          local("handle"),
          u32(RUNTIME_PARSER_FRAGMENT_TOKEN_END_WORD_OFFSET),
        ),
        local("tokenEnd"),
      ),
      storeScratch(
        add(local("handle"), u32(RUNTIME_PARSER_FRAGMENT_CHILDREN_WORD_OFFSET)),
        local("children"),
      ),
      storeScratch(
        add(local("handle"), u32(RUNTIME_PARSER_FRAGMENT_FIELDS_WORD_OFFSET)),
        local("fields"),
      ),
      { kind: "return", expression: local("handle") },
    ],
  };
}

function parserFieldCaptureNewFunction(): RuntimeLanguageFunction {
  return {
    name: "parserFieldCaptureNew",
    parameters: [
      { name: "fieldId", type: "u32" },
      { name: "value", type: "u32" },
    ],
    locals: [
      { name: "handle", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal(
        "handle",
        call("runtimeArenaAlloc", [
          u32(RUNTIME_PARSER_FIELD_CAPTURE_HEADER_WORDS),
        ]),
      ),
      storeScratch(local("handle"), u32(RUNTIME_OBJECT_PARSER_FIELD_CAPTURE)),
      storeScratch(
        add(
          local("handle"),
          u32(RUNTIME_PARSER_FIELD_CAPTURE_FIELD_ID_WORD_OFFSET),
        ),
        local("fieldId"),
      ),
      storeScratch(
        add(
          local("handle"),
          u32(RUNTIME_PARSER_FIELD_CAPTURE_VALUE_WORD_OFFSET),
        ),
        local("value"),
      ),
      { kind: "return", expression: local("handle") },
    ],
  };
}

function parserRuleNodeFromFragmentFunction(): RuntimeLanguageFunction {
  return {
    name: "parserRuleNodeFromFragment",
    parameters: [
      { name: "ruleId", type: "u32" },
      { name: "fragment", type: "u32" },
    ],
    locals: [
      { name: "handle", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal(
        "handle",
        call("runtimeArenaAlloc", [u32(RUNTIME_PARSER_RULE_NODE_HEADER_WORDS)]),
      ),
      storeScratch(local("handle"), u32(RUNTIME_OBJECT_PARSER_RULE_NODE)),
      storeScratch(
        add(local("handle"), u32(RUNTIME_PARSER_RULE_NODE_RULE_ID_WORD_OFFSET)),
        local("ruleId"),
      ),
      storeScratch(
        add(
          local("handle"),
          u32(RUNTIME_PARSER_RULE_NODE_SPAN_START_WORD_OFFSET),
        ),
        call("parserFragmentSpanStart", [local("fragment")]),
      ),
      storeScratch(
        add(
          local("handle"),
          u32(RUNTIME_PARSER_RULE_NODE_SPAN_END_WORD_OFFSET),
        ),
        call("parserFragmentSpanEnd", [local("fragment")]),
      ),
      storeScratch(
        add(
          local("handle"),
          u32(RUNTIME_PARSER_RULE_NODE_TOKEN_START_WORD_OFFSET),
        ),
        call("parserFragmentTokenStart", [local("fragment")]),
      ),
      storeScratch(
        add(
          local("handle"),
          u32(RUNTIME_PARSER_RULE_NODE_TOKEN_END_WORD_OFFSET),
        ),
        call("parserFragmentTokenEnd", [local("fragment")]),
      ),
      storeScratch(
        add(
          local("handle"),
          u32(RUNTIME_PARSER_RULE_NODE_CHILDREN_WORD_OFFSET),
        ),
        call("parserFragmentChildren", [local("fragment")]),
      ),
      storeScratch(
        add(local("handle"), u32(RUNTIME_PARSER_RULE_NODE_FIELDS_WORD_OFFSET)),
        call("parserFragmentFields", [local("fragment")]),
      ),
      { kind: "return", expression: local("handle") },
    ],
  };
}

function parserTokenNewFunction(): RuntimeLanguageFunction {
  return {
    name: "parserTokenNew",
    parameters: [
      { name: "tokenClass", type: "u32" },
      { name: "payload", type: "u32" },
      { name: "terminal", type: "u32" },
      { name: "spanStart", type: "u32" },
      { name: "spanEnd", type: "u32" },
    ],
    locals: [
      { name: "handle", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal(
        "handle",
        call("runtimeArenaAlloc", [u32(RUNTIME_PARSER_TOKEN_HEADER_WORDS)]),
      ),
      storeScratch(local("handle"), u32(RUNTIME_OBJECT_PARSER_TOKEN)),
      storeScratch(
        add(local("handle"), u32(RUNTIME_PARSER_TOKEN_CLASS_WORD_OFFSET)),
        local("tokenClass"),
      ),
      storeScratch(
        add(local("handle"), u32(RUNTIME_PARSER_TOKEN_PAYLOAD_WORD_OFFSET)),
        local("payload"),
      ),
      storeScratch(
        add(local("handle"), u32(RUNTIME_PARSER_TOKEN_TERMINAL_WORD_OFFSET)),
        local("terminal"),
      ),
      storeScratch(
        add(local("handle"), u32(RUNTIME_PARSER_TOKEN_SPAN_START_WORD_OFFSET)),
        local("spanStart"),
      ),
      storeScratch(
        add(local("handle"), u32(RUNTIME_PARSER_TOKEN_SPAN_END_WORD_OFFSET)),
        local("spanEnd"),
      ),
      { kind: "return", expression: local("handle") },
    ],
  };
}

function parserFragmentFromTokenFunction(): RuntimeLanguageFunction {
  return {
    name: "parserFragmentFromToken",
    parameters: [
      { name: "token", type: "u32" },
      { name: "tokenIndex", type: "u32" },
    ],
    locals: [
      { name: "fragment", type: "u32" },
      { name: "discard", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal(
        "fragment",
        call("parserFragmentNew", [
          local("token"),
          call("parserTokenSpanStart", [local("token")]),
          call("parserTokenSpanEnd", [local("token")]),
          local("tokenIndex"),
          add(local("tokenIndex"), u32(1)),
        ]),
      ),
      setLocal(
        "discard",
        call("parserFragmentAppendChild", [
          local("fragment"),
          local("token"),
        ]),
      ),
      { kind: "return", expression: local("fragment") },
    ],
  };
}

function parserDiagnosticNewFunction(): RuntimeLanguageFunction {
  return {
    name: "parserDiagnosticNew",
    parameters: [
      { name: "code", type: "u32" },
      { name: "spanStart", type: "u32" },
      { name: "spanEnd", type: "u32" },
      { name: "detail", type: "u32" },
    ],
    locals: [
      { name: "handle", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal(
        "handle",
        call("runtimeArenaAlloc", [
          u32(RUNTIME_PARSER_DIAGNOSTIC_HEADER_WORDS),
        ]),
      ),
      storeScratch(local("handle"), u32(RUNTIME_OBJECT_PARSER_DIAGNOSTIC)),
      storeScratch(
        add(local("handle"), u32(RUNTIME_PARSER_DIAGNOSTIC_CODE_WORD_OFFSET)),
        local("code"),
      ),
      storeScratch(
        add(
          local("handle"),
          u32(RUNTIME_PARSER_DIAGNOSTIC_SPAN_START_WORD_OFFSET),
        ),
        local("spanStart"),
      ),
      storeScratch(
        add(
          local("handle"),
          u32(RUNTIME_PARSER_DIAGNOSTIC_SPAN_END_WORD_OFFSET),
        ),
        local("spanEnd"),
      ),
      storeScratch(
        add(local("handle"), u32(RUNTIME_PARSER_DIAGNOSTIC_DETAIL_WORD_OFFSET)),
        local("detail"),
      ),
      { kind: "return", expression: local("handle") },
    ],
  };
}

function parserFragmentValueFunction(): RuntimeLanguageFunction {
  return parserObjectLoadFunction(
    "parserFragmentValue",
    RUNTIME_OBJECT_PARSER_FRAGMENT,
    RUNTIME_PARSER_FRAGMENT_VALUE_WORD_OFFSET,
  );
}

function parserFragmentSpanStartFunction(): RuntimeLanguageFunction {
  return parserObjectLoadFunction(
    "parserFragmentSpanStart",
    RUNTIME_OBJECT_PARSER_FRAGMENT,
    RUNTIME_PARSER_FRAGMENT_SPAN_START_WORD_OFFSET,
  );
}

function parserFragmentSpanEndFunction(): RuntimeLanguageFunction {
  return parserObjectLoadFunction(
    "parserFragmentSpanEnd",
    RUNTIME_OBJECT_PARSER_FRAGMENT,
    RUNTIME_PARSER_FRAGMENT_SPAN_END_WORD_OFFSET,
  );
}

function parserFragmentTokenStartFunction(): RuntimeLanguageFunction {
  return parserObjectLoadFunction(
    "parserFragmentTokenStart",
    RUNTIME_OBJECT_PARSER_FRAGMENT,
    RUNTIME_PARSER_FRAGMENT_TOKEN_START_WORD_OFFSET,
  );
}

function parserFragmentTokenEndFunction(): RuntimeLanguageFunction {
  return parserObjectLoadFunction(
    "parserFragmentTokenEnd",
    RUNTIME_OBJECT_PARSER_FRAGMENT,
    RUNTIME_PARSER_FRAGMENT_TOKEN_END_WORD_OFFSET,
  );
}

function parserFragmentChildrenFunction(): RuntimeLanguageFunction {
  return parserObjectLoadFunction(
    "parserFragmentChildren",
    RUNTIME_OBJECT_PARSER_FRAGMENT,
    RUNTIME_PARSER_FRAGMENT_CHILDREN_WORD_OFFSET,
  );
}

function parserFragmentFieldsFunction(): RuntimeLanguageFunction {
  return parserObjectLoadFunction(
    "parserFragmentFields",
    RUNTIME_OBJECT_PARSER_FRAGMENT,
    RUNTIME_PARSER_FRAGMENT_FIELDS_WORD_OFFSET,
  );
}

function parserFragmentChildCountFunction(): RuntimeLanguageFunction {
  return parserVectorCountFunction(
    "parserFragmentChildCount",
    "parserFragmentChildren",
  );
}

function parserFragmentFieldCountFunction(): RuntimeLanguageFunction {
  return parserVectorCountFunction(
    "parserFragmentFieldCount",
    "parserFragmentFields",
  );
}

function parserFragmentChildAtFunction(): RuntimeLanguageFunction {
  return parserVectorLoadFunction(
    "parserFragmentChildAt",
    "parserFragmentChildren",
  );
}

function parserFragmentFieldAtFunction(): RuntimeLanguageFunction {
  return parserVectorLoadFunction(
    "parserFragmentFieldAt",
    "parserFragmentFields",
  );
}

function parserFragmentAppendChildFunction(): RuntimeLanguageFunction {
  return parserVectorAppendHandleFunction(
    "parserFragmentAppendChild",
    "parserFragmentChildren",
  );
}

function parserFragmentAppendFieldFunction(): RuntimeLanguageFunction {
  return {
    name: "parserFragmentAppendField",
    parameters: [
      { name: "fragment", type: "u32" },
      { name: "capture", type: "u32" },
    ],
    locals: [
      { name: "discard", type: "u32" },
      { name: "fields", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal(
        "discard",
        call("runtimeExpectObjectKind", [
          local("capture"),
          u32(RUNTIME_OBJECT_PARSER_FIELD_CAPTURE),
        ]),
      ),
      setLocal("fields", call("parserFragmentFields", [local("fragment")])),
      setLocal(
        "discard",
        call("runtimeVectorAppend", [local("fields"), local("capture")]),
      ),
      { kind: "return", expression: local("capture") },
    ],
  };
}

function parserFragmentSetValueFunction(): RuntimeLanguageFunction {
  return {
    name: "parserFragmentSetValue",
    parameters: [
      { name: "fragment", type: "u32" },
      { name: "value", type: "u32" },
    ],
    locals: [
      { name: "discard", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal("discard", call("parserFragmentValue", [local("fragment")])),
      storeScratch(
        add(local("fragment"), u32(RUNTIME_PARSER_FRAGMENT_VALUE_WORD_OFFSET)),
        local("value"),
      ),
      { kind: "return", expression: local("value") },
    ],
  };
}

function parserFragmentMergeFromFunction(): RuntimeLanguageFunction {
  return {
    name: "parserFragmentMergeFrom",
    parameters: [
      { name: "target", type: "u32" },
      { name: "part", type: "u32" },
    ],
    locals: [
      { name: "targetStart", type: "u32" },
      { name: "targetEnd", type: "u32" },
      { name: "targetTokenStart", type: "u32" },
      { name: "targetTokenEnd", type: "u32" },
      { name: "partStart", type: "u32" },
      { name: "partEnd", type: "u32" },
      { name: "partTokenStart", type: "u32" },
      { name: "partTokenEnd", type: "u32" },
      { name: "discard", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal(
        "targetStart",
        call("parserFragmentSpanStart", [
          local("target"),
        ]),
      ),
      setLocal(
        "targetEnd",
        call("parserFragmentSpanEnd", [
          local("target"),
        ]),
      ),
      setLocal(
        "targetTokenStart",
        call("parserFragmentTokenStart", [
          local("target"),
        ]),
      ),
      setLocal(
        "targetTokenEnd",
        call("parserFragmentTokenEnd", [
          local("target"),
        ]),
      ),
      setLocal("partStart", call("parserFragmentSpanStart", [local("part")])),
      setLocal("partEnd", call("parserFragmentSpanEnd", [local("part")])),
      setLocal(
        "partTokenStart",
        call("parserFragmentTokenStart", [
          local("part"),
        ]),
      ),
      setLocal(
        "partTokenEnd",
        call("parserFragmentTokenEnd", [
          local("part"),
        ]),
      ),
      {
        kind: "if",
        condition: ltu(local("partStart"), local("targetStart")),
        consequent: [
          storeScratch(
            add(
              local("target"),
              u32(RUNTIME_PARSER_FRAGMENT_SPAN_START_WORD_OFFSET),
            ),
            local("partStart"),
          ),
        ],
      },
      {
        kind: "if",
        condition: ltu(local("targetEnd"), local("partEnd")),
        consequent: [
          storeScratch(
            add(
              local("target"),
              u32(RUNTIME_PARSER_FRAGMENT_SPAN_END_WORD_OFFSET),
            ),
            local("partEnd"),
          ),
        ],
      },
      {
        kind: "if",
        condition: ltu(local("partTokenStart"), local("targetTokenStart")),
        consequent: [
          storeScratch(
            add(
              local("target"),
              u32(RUNTIME_PARSER_FRAGMENT_TOKEN_START_WORD_OFFSET),
            ),
            local("partTokenStart"),
          ),
        ],
      },
      {
        kind: "if",
        condition: ltu(local("targetTokenEnd"), local("partTokenEnd")),
        consequent: [
          storeScratch(
            add(
              local("target"),
              u32(RUNTIME_PARSER_FRAGMENT_TOKEN_END_WORD_OFFSET),
            ),
            local("partTokenEnd"),
          ),
        ],
      },
      setLocal(
        "discard",
        call("runtimeVectorAppendAll", [
          call("parserFragmentChildren", [local("target")]),
          call("parserFragmentChildren", [local("part")]),
        ]),
      ),
      setLocal(
        "discard",
        call("runtimeVectorAppendAll", [
          call("parserFragmentFields", [local("target")]),
          call("parserFragmentFields", [local("part")]),
        ]),
      ),
      { kind: "return", expression: local("target") },
    ],
  };
}

function parserFragmentEmptyFunction(): RuntimeLanguageFunction {
  return {
    name: "parserFragmentEmpty",
    parameters: [
      { name: "value", type: "u32" },
      { name: "offset", type: "u32" },
      { name: "tokenIndex", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "return",
        expression: call("parserFragmentNew", [
          local("value"),
          local("offset"),
          local("offset"),
          local("tokenIndex"),
          local("tokenIndex"),
        ]),
      },
    ],
  };
}

function parserFragmentSequenceNewFunction(): RuntimeLanguageFunction {
  return {
    name: "parserFragmentSequenceNew",
    parameters: [
      { name: "offset", type: "u32" },
      { name: "tokenIndex", type: "u32" },
    ],
    locals: [
      { name: "values", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal("values", call("runtimeVectorNew", [u32(0)])),
      {
        kind: "return",
        expression: call("parserFragmentNew", [
          local("values"),
          local("offset"),
          local("offset"),
          local("tokenIndex"),
          local("tokenIndex"),
        ]),
      },
    ],
  };
}

function parserFragmentSequenceAppendFunction(): RuntimeLanguageFunction {
  return {
    name: "parserFragmentSequenceAppend",
    parameters: [
      { name: "sequence", type: "u32" },
      { name: "part", type: "u32" },
    ],
    locals: [
      { name: "values", type: "u32" },
      { name: "length", type: "u32" },
      { name: "discard", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal("values", call("parserFragmentValue", [local("sequence")])),
      setLocal("length", call("runtimeVectorLength", [local("values")])),
      setLocal(
        "discard",
        call("runtimeVectorAppend", [
          local("values"),
          call("parserFragmentValue", [local("part")]),
        ]),
      ),
      {
        kind: "if",
        condition: eq(local("length"), u32(0)),
        consequent: [
          storeScratch(
            add(
              local("sequence"),
              u32(RUNTIME_PARSER_FRAGMENT_SPAN_START_WORD_OFFSET),
            ),
            call("parserFragmentSpanStart", [local("part")]),
          ),
          storeScratch(
            add(
              local("sequence"),
              u32(RUNTIME_PARSER_FRAGMENT_SPAN_END_WORD_OFFSET),
            ),
            call("parserFragmentSpanEnd", [local("part")]),
          ),
          storeScratch(
            add(
              local("sequence"),
              u32(RUNTIME_PARSER_FRAGMENT_TOKEN_START_WORD_OFFSET),
            ),
            call("parserFragmentTokenStart", [local("part")]),
          ),
          storeScratch(
            add(
              local("sequence"),
              u32(RUNTIME_PARSER_FRAGMENT_TOKEN_END_WORD_OFFSET),
            ),
            call("parserFragmentTokenEnd", [local("part")]),
          ),
        ],
      },
      setLocal(
        "discard",
        call("parserFragmentMergeFrom", [local("sequence"), local("part")]),
      ),
      { kind: "return", expression: local("sequence") },
    ],
  };
}

function parserFragmentWrapValueVectorFunction(): RuntimeLanguageFunction {
  return {
    name: "parserFragmentWrapValueVector",
    parameters: [
      { name: "fragment", type: "u32" },
    ],
    locals: [
      { name: "oldValue", type: "u32" },
      { name: "values", type: "u32" },
      { name: "discard", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal("oldValue", call("parserFragmentValue", [local("fragment")])),
      setLocal("values", call("runtimeVectorNew", [u32(1)])),
      setLocal(
        "discard",
        call("runtimeVectorAppend", [local("values"), local("oldValue")]),
      ),
      setLocal(
        "discard",
        call("parserFragmentSetValue", [local("fragment"), local("values")]),
      ),
      { kind: "return", expression: local("fragment") },
    ],
  };
}

function parserFragmentAppendValueFunction(): RuntimeLanguageFunction {
  return parserFragmentAppendValueFunctionNamed("parserFragmentAppendValue");
}

function parserFragmentAppendValueFunctionNamed(
  name: string,
): RuntimeLanguageFunction {
  return {
    name,
    parameters: [
      { name: "list", type: "u32" },
      { name: "item", type: "u32" },
    ],
    locals: [
      { name: "discard", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal(
        "discard",
        call("runtimeVectorAppend", [
          call("parserFragmentValue", [local("list")]),
          call("parserFragmentValue", [local("item")]),
        ]),
      ),
      setLocal(
        "discard",
        call("parserFragmentMergeFrom", [local("list"), local("item")]),
      ),
      { kind: "return", expression: local("list") },
    ],
  };
}

function parserFragmentAppendSeparatedValueFunction(): RuntimeLanguageFunction {
  return {
    name: "parserFragmentAppendSeparatedValue",
    parameters: [
      { name: "list", type: "u32" },
      { name: "separator", type: "u32" },
      { name: "item", type: "u32" },
    ],
    locals: [
      { name: "discard", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal(
        "discard",
        call("runtimeVectorAppend", [
          call("parserFragmentValue", [local("list")]),
          call("parserFragmentValue", [local("item")]),
        ]),
      ),
      setLocal(
        "discard",
        call("parserFragmentMergeFrom", [local("list"), local("separator")]),
      ),
      setLocal(
        "discard",
        call("parserFragmentMergeFrom", [local("list"), local("item")]),
      ),
      { kind: "return", expression: local("list") },
    ],
  };
}

function parserFieldCaptureFieldIdFunction(): RuntimeLanguageFunction {
  return parserObjectLoadFunction(
    "parserFieldCaptureFieldId",
    RUNTIME_OBJECT_PARSER_FIELD_CAPTURE,
    RUNTIME_PARSER_FIELD_CAPTURE_FIELD_ID_WORD_OFFSET,
  );
}

function parserFieldCaptureValueFunction(): RuntimeLanguageFunction {
  return parserObjectLoadFunction(
    "parserFieldCaptureValue",
    RUNTIME_OBJECT_PARSER_FIELD_CAPTURE,
    RUNTIME_PARSER_FIELD_CAPTURE_VALUE_WORD_OFFSET,
  );
}

function parserTokenClassFunction(): RuntimeLanguageFunction {
  return parserObjectLoadFunction(
    "parserTokenClass",
    RUNTIME_OBJECT_PARSER_TOKEN,
    RUNTIME_PARSER_TOKEN_CLASS_WORD_OFFSET,
  );
}

function parserTokenPayloadFunction(): RuntimeLanguageFunction {
  return parserObjectLoadFunction(
    "parserTokenPayload",
    RUNTIME_OBJECT_PARSER_TOKEN,
    RUNTIME_PARSER_TOKEN_PAYLOAD_WORD_OFFSET,
  );
}

function parserTokenTerminalFunction(): RuntimeLanguageFunction {
  return parserObjectLoadFunction(
    "parserTokenTerminal",
    RUNTIME_OBJECT_PARSER_TOKEN,
    RUNTIME_PARSER_TOKEN_TERMINAL_WORD_OFFSET,
  );
}

function parserTokenSpanStartFunction(): RuntimeLanguageFunction {
  return parserObjectLoadFunction(
    "parserTokenSpanStart",
    RUNTIME_OBJECT_PARSER_TOKEN,
    RUNTIME_PARSER_TOKEN_SPAN_START_WORD_OFFSET,
  );
}

function parserTokenSpanEndFunction(): RuntimeLanguageFunction {
  return parserObjectLoadFunction(
    "parserTokenSpanEnd",
    RUNTIME_OBJECT_PARSER_TOKEN,
    RUNTIME_PARSER_TOKEN_SPAN_END_WORD_OFFSET,
  );
}

function parserDiagnosticCodeFunction(): RuntimeLanguageFunction {
  return parserObjectLoadFunction(
    "parserDiagnosticCode",
    RUNTIME_OBJECT_PARSER_DIAGNOSTIC,
    RUNTIME_PARSER_DIAGNOSTIC_CODE_WORD_OFFSET,
  );
}

function parserDiagnosticSpanStartFunction(): RuntimeLanguageFunction {
  return parserObjectLoadFunction(
    "parserDiagnosticSpanStart",
    RUNTIME_OBJECT_PARSER_DIAGNOSTIC,
    RUNTIME_PARSER_DIAGNOSTIC_SPAN_START_WORD_OFFSET,
  );
}

function parserDiagnosticSpanEndFunction(): RuntimeLanguageFunction {
  return parserObjectLoadFunction(
    "parserDiagnosticSpanEnd",
    RUNTIME_OBJECT_PARSER_DIAGNOSTIC,
    RUNTIME_PARSER_DIAGNOSTIC_SPAN_END_WORD_OFFSET,
  );
}

function parserDiagnosticDetailFunction(): RuntimeLanguageFunction {
  return parserObjectLoadFunction(
    "parserDiagnosticDetail",
    RUNTIME_OBJECT_PARSER_DIAGNOSTIC,
    RUNTIME_PARSER_DIAGNOSTIC_DETAIL_WORD_OFFSET,
  );
}

function parserDiagnosticDetailKindIdFunction(): RuntimeLanguageFunction {
  return {
    name: "parserDiagnosticDetailKindId",
    parameters: [{ name: "code", type: "u32" }],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(
          local("code"),
          u32(PARSER_DIAGNOSTIC_CODE_PARSE_UNEXPECTED_TOKEN),
        ),
        consequent: [{
          kind: "return",
          expression: u32(PARSER_DIAGNOSTIC_DETAIL_PARSER_STATE),
        }],
      },
      {
        kind: "if",
        condition: eq(
          local("code"),
          u32(PARSER_DIAGNOSTIC_CODE_PARSE_TRAILING_INPUT),
        ),
        consequent: [{
          kind: "return",
          expression: u32(PARSER_DIAGNOSTIC_DETAIL_PARSER_STATE),
        }],
      },
      {
        kind: "return",
        expression: u32(PARSER_DIAGNOSTIC_DETAIL_NONE),
      },
    ],
  };
}

function parserTokenStreamSpanBoundsStatusFunction(): RuntimeLanguageFunction {
  return {
    name: "parserTokenStreamSpanBoundsStatus",
    parameters: [
      { name: "start", type: "u32" },
      { name: "end", type: "u32" },
      { name: "sourceLength", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: ltu(local("sourceLength"), local("end")),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_TOKEN_STREAM_STATUS_INVALID_SPAN),
        }],
      },
      {
        kind: "if",
        condition: ltu(local("end"), local("start")),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_TOKEN_STREAM_STATUS_INVALID_SPAN),
        }],
      },
      {
        kind: "return",
        expression: u32(RUNTIME_TOKEN_STREAM_STATUS_OK),
      },
    ],
  };
}

function parserTokenStreamSpanPositionStatusFunction(): RuntimeLanguageFunction {
  return {
    name: "parserTokenStreamSpanPositionStatus",
    parameters: [
      { name: "start", type: "u32" },
      { name: "previousEnd", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: ltu(local("previousEnd"), local("start")),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_TOKEN_STREAM_STATUS_GAP),
        }],
      },
      {
        kind: "if",
        condition: ltu(local("start"), local("previousEnd")),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_TOKEN_STREAM_STATUS_OVERLAP),
        }],
      },
      {
        kind: "return",
        expression: u32(RUNTIME_TOKEN_STREAM_STATUS_OK),
      },
    ],
  };
}

function parserTokenStreamWidthStatusFunction(): RuntimeLanguageFunction {
  return {
    name: "parserTokenStreamWidthStatus",
    parameters: [
      { name: "start", type: "u32" },
      { name: "end", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(local("start"), local("end")),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_TOKEN_STREAM_STATUS_ZERO_WIDTH),
        }],
      },
      {
        kind: "return",
        expression: u32(RUNTIME_TOKEN_STREAM_STATUS_OK),
      },
    ],
  };
}

function parserTokenStreamEofStatusFunction(): RuntimeLanguageFunction {
  return {
    name: "parserTokenStreamEofStatus",
    parameters: [
      { name: "textLength", type: "u32" },
      { name: "isMainChannel", type: "u32" },
      { name: "start", type: "u32" },
      { name: "end", type: "u32" },
      { name: "sourceLength", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(local("textLength"), u32(0)),
        consequent: [],
        alternate: [{
          kind: "return",
          expression: u32(RUNTIME_TOKEN_STREAM_STATUS_INVALID_EOF),
        }],
      },
      {
        kind: "if",
        condition: eq(local("isMainChannel"), u32(1)),
        consequent: [],
        alternate: [{
          kind: "return",
          expression: u32(RUNTIME_TOKEN_STREAM_STATUS_INVALID_EOF),
        }],
      },
      {
        kind: "if",
        condition: eq(local("start"), local("end")),
        consequent: [],
        alternate: [{
          kind: "return",
          expression: u32(RUNTIME_TOKEN_STREAM_STATUS_INVALID_EOF),
        }],
      },
      {
        kind: "if",
        condition: eq(local("start"), local("sourceLength")),
        consequent: [],
        alternate: [{
          kind: "return",
          expression: u32(RUNTIME_TOKEN_STREAM_STATUS_INVALID_EOF),
        }],
      },
      {
        kind: "return",
        expression: u32(RUNTIME_TOKEN_STREAM_STATUS_OK),
      },
    ],
  };
}

function parserTokenStreamGapTokenStatusFunction(): RuntimeLanguageFunction {
  return {
    name: "parserTokenStreamGapTokenStatus",
    parameters: [
      { name: "tokenClass", type: "u32" },
      { name: "tokenStart", type: "u32" },
      { name: "tokenEnd", type: "u32" },
      { name: "gapStart", type: "u32" },
      { name: "gapEnd", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(local("tokenClass"), u32(RUNTIME_PUBLIC_TOKEN_TRIVIA)),
        consequent: [],
        alternate: [{
          kind: "return",
          expression: u32(RUNTIME_TOKEN_STREAM_STATUS_NONTRIVIA_GAP),
        }],
      },
      {
        kind: "if",
        condition: ltu(local("tokenStart"), local("gapStart")),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_TOKEN_STREAM_STATUS_NONTRIVIA_GAP),
        }],
      },
      {
        kind: "if",
        condition: ltu(local("gapEnd"), local("tokenEnd")),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_TOKEN_STREAM_STATUS_NONTRIVIA_GAP),
        }],
      },
      {
        kind: "return",
        expression: u32(RUNTIME_TOKEN_STREAM_STATUS_OK),
      },
    ],
  };
}

function parserTokenStreamTokenMatchStatusFunction(): RuntimeLanguageFunction {
  return {
    name: "parserTokenStreamTokenMatchStatus",
    parameters: [
      { name: "leftClass", type: "u32" },
      { name: "rightClass", type: "u32" },
      { name: "leftSpecIndex", type: "u32" },
      { name: "rightSpecIndex", type: "u32" },
      { name: "leftTerminal", type: "u32" },
      { name: "rightTerminal", type: "u32" },
      { name: "leftStart", type: "u32" },
      { name: "leftEnd", type: "u32" },
      { name: "rightStart", type: "u32" },
      { name: "rightEnd", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(local("leftClass"), local("rightClass")),
        consequent: [],
        alternate: [{
          kind: "return",
          expression: u32(RUNTIME_TOKEN_STREAM_STATUS_TOKEN_MISMATCH),
        }],
      },
      {
        kind: "if",
        condition: eq(local("leftSpecIndex"), local("rightSpecIndex")),
        consequent: [],
        alternate: [{
          kind: "return",
          expression: u32(RUNTIME_TOKEN_STREAM_STATUS_TOKEN_MISMATCH),
        }],
      },
      {
        kind: "if",
        condition: eq(local("leftTerminal"), local("rightTerminal")),
        consequent: [],
        alternate: [{
          kind: "return",
          expression: u32(RUNTIME_TOKEN_STREAM_STATUS_TOKEN_MISMATCH),
        }],
      },
      {
        kind: "if",
        condition: eq(local("leftStart"), local("rightStart")),
        consequent: [],
        alternate: [{
          kind: "return",
          expression: u32(RUNTIME_TOKEN_STREAM_STATUS_TOKEN_MISMATCH),
        }],
      },
      {
        kind: "if",
        condition: eq(local("leftEnd"), local("rightEnd")),
        consequent: [],
        alternate: [{
          kind: "return",
          expression: u32(RUNTIME_TOKEN_STREAM_STATUS_TOKEN_MISMATCH),
        }],
      },
      {
        kind: "return",
        expression: u32(RUNTIME_TOKEN_STREAM_STATUS_OK),
      },
    ],
  };
}

function parserTokenStreamCanonicalMatchStatusFunction(): RuntimeLanguageFunction {
  return {
    name: "parserTokenStreamCanonicalMatchStatus",
    parameters: [
      { name: "canonicalClass", type: "u32" },
      { name: "tokenMatchStatus", type: "u32" },
      { name: "canonicalEnd", type: "u32" },
      { name: "suppliedStart", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(
          local("tokenMatchStatus"),
          u32(RUNTIME_TOKEN_STREAM_STATUS_OK),
        ),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_TOKEN_STREAM_CANONICAL_MATCH),
        }],
      },
      {
        kind: "if",
        condition: eq(
          call("parserTraceTokenStreamStatus", [local("canonicalClass")]),
          u32(RUNTIME_TRACE_TOKEN_STREAM_SKIP),
        ),
        consequent: [
          {
            kind: "if",
            condition: ltu(local("suppliedStart"), local("canonicalEnd")),
            consequent: [{
              kind: "return",
              expression: u32(RUNTIME_TOKEN_STREAM_CANONICAL_MISMATCH),
            }],
          },
          {
            kind: "return",
            expression: u32(RUNTIME_TOKEN_STREAM_CANONICAL_SKIP),
          },
        ],
      },
      {
        kind: "return",
        expression: u32(RUNTIME_TOKEN_STREAM_CANONICAL_MISMATCH),
      },
    ],
  };
}

function parserTokenStreamFinalStatusFunction(): RuntimeLanguageFunction {
  return {
    name: "parserTokenStreamFinalStatus",
    parameters: [
      { name: "hasEof", type: "u32" },
      { name: "eofIndex", type: "u32" },
      { name: "tokenCount", type: "u32" },
      { name: "previousEnd", type: "u32" },
      { name: "sourceLength", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(local("hasEof"), u32(1)),
        consequent: [
          {
            kind: "if",
            condition: eq(add(local("eofIndex"), u32(1)), local("tokenCount")),
            consequent: [{
              kind: "return",
              expression: u32(RUNTIME_TOKEN_STREAM_STATUS_OK),
            }],
            alternate: [{
              kind: "return",
              expression: u32(RUNTIME_TOKEN_STREAM_STATUS_INVALID_EOF),
            }],
          },
        ],
      },
      {
        kind: "if",
        condition: ltu(local("previousEnd"), local("sourceLength")),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_TOKEN_STREAM_STATUS_GAP),
        }],
      },
      {
        kind: "return",
        expression: u32(RUNTIME_TOKEN_STREAM_STATUS_OK),
      },
    ],
  };
}

function parserTokenStreamPublicTokenStatusFunction(): RuntimeLanguageFunction {
  return {
    name: "parserTokenStreamPublicTokenStatus",
    parameters: [
      { name: "tokenType", type: "u32" },
      { name: "channel", type: "u32" },
      { name: "literalTextMatches", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(
          local("tokenType"),
          u32(RUNTIME_PUBLIC_TOKEN_TYPE_LITERAL),
        ),
        consequent: [
          {
            kind: "if",
            condition: eq(
              local("channel"),
              u32(RUNTIME_PUBLIC_TOKEN_CHANNEL_MAIN),
            ),
            consequent: [],
            alternate: [{
              kind: "return",
              expression: u32(
                RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_INVALID_LITERAL,
              ),
            }],
          },
          {
            kind: "if",
            condition: eq(local("literalTextMatches"), u32(1)),
            consequent: [{
              kind: "return",
              expression: u32(RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_OK),
            }],
            alternate: [{
              kind: "return",
              expression: u32(
                RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_INVALID_LITERAL,
              ),
            }],
          },
        ],
      },
      {
        kind: "if",
        condition: eq(
          local("tokenType"),
          u32(RUNTIME_PUBLIC_TOKEN_TYPE_NAMED),
        ),
        consequent: [
          {
            kind: "if",
            condition: eq(
              local("channel"),
              u32(RUNTIME_PUBLIC_TOKEN_CHANNEL_MAIN),
            ),
            consequent: [{
              kind: "return",
              expression: u32(RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_OK),
            }],
          },
          {
            kind: "if",
            condition: eq(
              local("channel"),
              u32(RUNTIME_PUBLIC_TOKEN_CHANNEL_TRIVIA),
            ),
            consequent: [{
              kind: "return",
              expression: u32(RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_OK),
            }],
            alternate: [{
              kind: "return",
              expression: u32(
                RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_INVALID_NAMED,
              ),
            }],
          },
        ],
      },
      {
        kind: "if",
        condition: eq(
          local("tokenType"),
          u32(RUNTIME_PUBLIC_TOKEN_TYPE_ERROR),
        ),
        consequent: [
          {
            kind: "if",
            condition: eq(
              local("channel"),
              u32(RUNTIME_PUBLIC_TOKEN_CHANNEL_ERROR),
            ),
            consequent: [{
              kind: "return",
              expression: u32(RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_OK),
            }],
            alternate: [{
              kind: "return",
              expression: u32(
                RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_INVALID_ERROR,
              ),
            }],
          },
        ],
      },
      {
        kind: "if",
        condition: eq(
          local("tokenType"),
          u32(RUNTIME_PUBLIC_TOKEN_TYPE_EOF),
        ),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_OK),
        }],
      },
      {
        kind: "return",
        expression: u32(RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_UNKNOWN_TYPE),
      },
    ],
  };
}

function parserTraceTokenStreamStatusFunction(): RuntimeLanguageFunction {
  return {
    name: "parserTraceTokenStreamStatus",
    parameters: [
      { name: "publicClass", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(
          local("publicClass"),
          u32(RUNTIME_PUBLIC_TOKEN_TRIVIA),
        ),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_TRACE_TOKEN_STREAM_SKIP),
        }],
      },
      {
        kind: "if",
        condition: eq(
          local("publicClass"),
          u32(RUNTIME_PUBLIC_TOKEN_EOF),
        ),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_TRACE_TOKEN_STREAM_STOP),
        }],
      },
      {
        kind: "return",
        expression: u32(RUNTIME_TRACE_TOKEN_STREAM_EMIT),
      },
    ],
  };
}

function parserTraceTerminalFunction(): RuntimeLanguageFunction {
  return {
    name: "parserTraceTerminal",
    parameters: [
      { name: "publicClass", type: "u32" },
      { name: "trustedTerminal", type: "u32" },
      { name: "specTerminal", type: "u32" },
      { name: "eofTerminal", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(
          local("publicClass"),
          u32(RUNTIME_PUBLIC_TOKEN_EOF),
        ),
        consequent: [{
          kind: "return",
          expression: local("eofTerminal"),
        }],
      },
      {
        kind: "if",
        condition: eq(
          local("trustedTerminal"),
          u32(RUNTIME_NO_TERMINAL),
        ),
        consequent: [],
        alternate: [{
          kind: "return",
          expression: local("trustedTerminal"),
        }],
      },
      {
        kind: "return",
        expression: local("specTerminal"),
      },
    ],
  };
}

function parserShiftedTokenStatusFunction(): RuntimeLanguageFunction {
  return {
    name: "parserShiftedTokenStatus",
    parameters: [
      { name: "publicClass", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(
          local("publicClass"),
          u32(RUNTIME_PUBLIC_TOKEN_LITERAL),
        ),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_SHIFTED_TOKEN_STATUS_OK),
        }],
      },
      {
        kind: "if",
        condition: eq(
          local("publicClass"),
          u32(RUNTIME_PUBLIC_TOKEN_MAIN),
        ),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_SHIFTED_TOKEN_STATUS_OK),
        }],
      },
      {
        kind: "return",
        expression: u32(RUNTIME_SHIFTED_TOKEN_STATUS_INVALID),
      },
    ],
  };
}

function parserRuleNodeRuleIdFunction(): RuntimeLanguageFunction {
  return parserObjectLoadFunction(
    "parserRuleNodeRuleId",
    RUNTIME_OBJECT_PARSER_RULE_NODE,
    RUNTIME_PARSER_RULE_NODE_RULE_ID_WORD_OFFSET,
  );
}

function parserRuleNodeSpanStartFunction(): RuntimeLanguageFunction {
  return parserObjectLoadFunction(
    "parserRuleNodeSpanStart",
    RUNTIME_OBJECT_PARSER_RULE_NODE,
    RUNTIME_PARSER_RULE_NODE_SPAN_START_WORD_OFFSET,
  );
}

function parserRuleNodeSpanEndFunction(): RuntimeLanguageFunction {
  return parserObjectLoadFunction(
    "parserRuleNodeSpanEnd",
    RUNTIME_OBJECT_PARSER_RULE_NODE,
    RUNTIME_PARSER_RULE_NODE_SPAN_END_WORD_OFFSET,
  );
}

function parserRuleNodeTokenStartFunction(): RuntimeLanguageFunction {
  return parserObjectLoadFunction(
    "parserRuleNodeTokenStart",
    RUNTIME_OBJECT_PARSER_RULE_NODE,
    RUNTIME_PARSER_RULE_NODE_TOKEN_START_WORD_OFFSET,
  );
}

function parserRuleNodeTokenEndFunction(): RuntimeLanguageFunction {
  return parserObjectLoadFunction(
    "parserRuleNodeTokenEnd",
    RUNTIME_OBJECT_PARSER_RULE_NODE,
    RUNTIME_PARSER_RULE_NODE_TOKEN_END_WORD_OFFSET,
  );
}

function parserRuleNodeChildrenFunction(): RuntimeLanguageFunction {
  return parserObjectLoadFunction(
    "parserRuleNodeChildren",
    RUNTIME_OBJECT_PARSER_RULE_NODE,
    RUNTIME_PARSER_RULE_NODE_CHILDREN_WORD_OFFSET,
  );
}

function parserRuleNodeFieldsFunction(): RuntimeLanguageFunction {
  return parserObjectLoadFunction(
    "parserRuleNodeFields",
    RUNTIME_OBJECT_PARSER_RULE_NODE,
    RUNTIME_PARSER_RULE_NODE_FIELDS_WORD_OFFSET,
  );
}

function parserRuleNodeChildCountFunction(): RuntimeLanguageFunction {
  return parserVectorCountFunction(
    "parserRuleNodeChildCount",
    "parserRuleNodeChildren",
  );
}

function parserRuleNodeChildListStatusFunction(): RuntimeLanguageFunction {
  return {
    name: "parserRuleNodeChildListStatus",
    parameters: [
      { name: "count", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(local("count"), u32(0)),
        consequent: [
          {
            kind: "return",
            expression: u32(RUNTIME_RULE_NODE_CHILD_LIST_EMPTY),
          },
        ],
      },
      { kind: "return", expression: u32(RUNTIME_RULE_NODE_CHILD_LIST_PRESENT) },
    ],
  };
}

function parserRuleNodeFieldCountFunction(): RuntimeLanguageFunction {
  return parserVectorCountFunction(
    "parserRuleNodeFieldCount",
    "parserRuleNodeFields",
  );
}

function parserObjectLoadFunction(
  name: string,
  expectedKind: number,
  wordOffset: number,
): RuntimeLanguageFunction {
  return {
    name,
    parameters: [
      { name: "handle", type: "u32" },
    ],
    locals: [
      { name: "discard", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal(
        "discard",
        call("runtimeExpectObjectKind", [
          local("handle"),
          u32(expectedKind),
        ]),
      ),
      {
        kind: "return",
        expression: loadScratch(add(local("handle"), u32(wordOffset))),
      },
    ],
  };
}

function parserVectorCountFunction(
  name: string,
  vectorAccessor: string,
): RuntimeLanguageFunction {
  return {
    name,
    parameters: [
      { name: "handle", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "return",
        expression: call("runtimeVectorLength", [
          call(vectorAccessor, [local("handle")]),
        ]),
      },
    ],
  };
}

function parserVectorLoadFunction(
  name: string,
  vectorAccessor: string,
): RuntimeLanguageFunction {
  return {
    name,
    parameters: [
      { name: "handle", type: "u32" },
      { name: "index", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "return",
        expression: call("runtimeVectorLoad", [
          call(vectorAccessor, [local("handle")]),
          local("index"),
        ]),
      },
    ],
  };
}

function parserVectorAppendHandleFunction(
  name: string,
  vectorAccessor: string,
): RuntimeLanguageFunction {
  return {
    name,
    parameters: [
      { name: "handle", type: "u32" },
      { name: "value", type: "u32" },
    ],
    locals: [
      { name: "vector", type: "u32" },
      { name: "discard", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal("vector", call(vectorAccessor, [local("handle")])),
      setLocal(
        "discard",
        call("runtimeVectorAppend", [local("vector"), local("value")]),
      ),
      { kind: "return", expression: local("value") },
    ],
  };
}

function dfaTransitionFunction(
  hasAsciiTable: boolean,
): RuntimeLanguageFunction {
  return {
    name: "dfaTransition",
    parameters: [
      { name: "state", type: "u32" },
      { name: "codePoint", type: "u32" },
    ],
    locals: [
      { name: "index", type: "u32" },
      { name: "low", type: "u32" },
      { name: "high", type: "u32" },
      { name: "midpoint", type: "u32" },
      { name: "start", type: "u32" },
      { name: "end", type: "u32" },
    ],
    result: "u32",
    body: [
      ...(hasAsciiTable ? asciiFastPath() : []),
      setLocal("index", local("state")),
      setLocal("low", load("dfaTransitionRows", local("index"))),
      setLocal("index", add(local("state"), u32(1))),
      setLocal("high", load("dfaTransitionRows", local("index"))),
      {
        kind: "while",
        condition: lt(local("low"), local("high")),
        body: [
          setLocal("midpoint", shr(add(local("low"), local("high")), u32(1))),
          setLocal("index", mul(local("midpoint"), u32(3))),
          setLocal("start", load("dfaTransitionValues", local("index"))),
          {
            kind: "if",
            condition: lt(local("codePoint"), local("start")),
            consequent: [
              setLocal("high", local("midpoint")),
            ],
            alternate: [
              setLocal("index", add(local("index"), u32(1))),
              setLocal("end", load("dfaTransitionValues", local("index"))),
              {
                kind: "if",
                condition: lt(local("end"), local("codePoint")),
                consequent: [
                  setLocal("low", add(local("midpoint"), u32(1))),
                ],
                alternate: [
                  setLocal("index", add(local("index"), u32(1))),
                  {
                    kind: "return",
                    expression: load("dfaTransitionValues", local("index")),
                  },
                ],
              },
            ],
          },
        ],
      },
      { kind: "return", expression: u32(RUNTIME_NO_TRANSITION) },
    ],
  };
}

function asciiFastPath(): readonly RuntimeStatement[] {
  return [{
    kind: "if",
    condition: lt(local("codePoint"), u32(128)),
    consequent: [
      setLocal("index", add(mul(local("state"), u32(128)), local("codePoint"))),
      {
        kind: "return",
        expression: load("dfaAsciiTransitions", local("index")),
      },
    ],
  }];
}

function lexerScanResetFunction(): RuntimeLanguageFunction {
  return {
    name: "lexerScanReset",
    result: "u32",
    body: [
      storeScratch(u32(LEXER_SCAN_STATE), u32(0)),
      storeScratch(u32(LEXER_SCAN_LENGTH), u32(0)),
      storeScratch(u32(LEXER_SCAN_BEST_SPEC), u32(RUNTIME_NO_ACCEPT)),
      storeScratch(u32(LEXER_SCAN_BEST_END), u32(0)),
      storeScratch(u32(LEXER_SCAN_DONE), u32(0)),
      { kind: "return", expression: u32(0) },
    ],
  };
}

function lexerScanAdvanceFunction(): RuntimeLanguageFunction {
  return {
    name: "lexerScanAdvance",
    parameters: [
      { name: "codePoint", type: "u32" },
    ],
    locals: [
      { name: "state", type: "u32" },
      { name: "target", type: "u32" },
      { name: "length", type: "u32" },
      { name: "accept", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(loadScratch(u32(LEXER_SCAN_DONE)), u32(0)),
        consequent: [],
        alternate: [{ kind: "return", expression: u32(0) }],
      },
      setLocal("state", loadScratch(u32(LEXER_SCAN_STATE))),
      setLocal(
        "target",
        call("dfaTransition", [local("state"), local("codePoint")]),
      ),
      {
        kind: "if",
        condition: eq(local("target"), u32(RUNTIME_NO_TRANSITION)),
        consequent: [
          storeScratch(u32(LEXER_SCAN_DONE), u32(1)),
          { kind: "return", expression: u32(0) },
        ],
      },
      storeScratch(u32(LEXER_SCAN_STATE), local("target")),
      setLocal(
        "length",
        add(
          loadScratch(u32(LEXER_SCAN_LENGTH)),
          call("utf16CodePointWidth", [local("codePoint")]),
        ),
      ),
      storeScratch(u32(LEXER_SCAN_LENGTH), local("length")),
      setLocal("accept", load("dfaAccepts", local("target"))),
      {
        kind: "if",
        condition: eq(local("accept"), u32(RUNTIME_NO_ACCEPT)),
        consequent: [],
        alternate: [
          storeScratch(u32(LEXER_SCAN_BEST_SPEC), local("accept")),
          storeScratch(u32(LEXER_SCAN_BEST_END), local("length")),
        ],
      },
      { kind: "return", expression: u32(1) },
    ],
  };
}

function lexerScanBestSpecFunction(): RuntimeLanguageFunction {
  return {
    name: "lexerScanBestSpec",
    result: "u32",
    body: [
      {
        kind: "return",
        expression: loadScratch(u32(LEXER_SCAN_BEST_SPEC)),
      },
    ],
  };
}

function lexerScanBestEndFunction(): RuntimeLanguageFunction {
  return {
    name: "lexerScanBestEnd",
    result: "u32",
    body: [
      {
        kind: "return",
        expression: loadScratch(u32(LEXER_SCAN_BEST_END)),
      },
    ],
  };
}

function lexerSpecFunctions(
  specCount: number,
  options: { includePublicTokenStatus?: boolean } = {},
): RuntimeLanguageFunction[] {
  const functions = [
    lexerSpecLoadFunction("lexerSpecFlags", specCount, 0, 0),
    lexerSpecTokenClassFunction(specCount),
    lexerSpecLoadFunction(
      "lexerSpecPayload",
      specCount,
      1,
      RUNTIME_NO_LEXER_SPEC,
    ),
    lexerSpecLoadFunction(
      "lexerSpecTerminal",
      specCount,
      2,
      RUNTIME_NO_TERMINAL,
    ),
  ];
  if (options.includePublicTokenStatus) {
    functions.push(lexerSpecPublicTokenStatusFunction(specCount));
    functions.push(lexerTokenDiagnosticStatusFunction());
  }
  return functions;
}

function lexerSpecTable(
  specs: readonly LexerRuntimeSpecEntry[],
): RuntimeLanguageTable {
  return {
    name: "lexerSpecs",
    type: "u32" as const,
    values: specs.flatMap(([flags, payload, terminal]) => [
      flags,
      payload < 0 ? RUNTIME_NO_LEXER_SPEC : payload,
      terminal < 0 ? RUNTIME_NO_TERMINAL : terminal,
    ]),
  };
}

function lexerSpecTokenClassFunction(
  specCount: number,
): RuntimeLanguageFunction {
  return {
    name: "lexerSpecTokenClass",
    parameters: [
      { name: "specIndex", type: "u32" },
    ],
    locals: [
      { name: "flags", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: lt(local("specIndex"), u32(specCount)),
        consequent: [
          setLocal("flags", call("lexerSpecFlags", [local("specIndex")])),
          {
            kind: "if",
            condition: eq(
              and(local("flags"), u32(RUNTIME_LEXER_SPEC_LITERAL)),
              u32(0),
            ),
            consequent: [{
              kind: "if",
              condition: eq(
                and(local("flags"), u32(RUNTIME_LEXER_SPEC_TRIVIA)),
                u32(0),
              ),
              consequent: [{
                kind: "return",
                expression: u32(RUNTIME_LEXER_TOKEN_MAIN),
              }],
              alternate: [{
                kind: "return",
                expression: u32(RUNTIME_LEXER_TOKEN_TRIVIA),
              }],
            }],
            alternate: [{
              kind: "return",
              expression: u32(RUNTIME_LEXER_TOKEN_LITERAL),
            }],
          },
        ],
      },
      { kind: "return", expression: u32(RUNTIME_LEXER_TOKEN_UNKNOWN) },
    ],
  };
}

function lexerSpecPublicTokenStatusFunction(
  specCount: number,
): RuntimeLanguageFunction {
  return {
    name: "lexerSpecPublicTokenStatus",
    parameters: [
      { name: "specIndex", type: "u32" },
      { name: "publicClass", type: "u32" },
    ],
    locals: [
      { name: "specClass", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: lt(local("specIndex"), u32(specCount)),
        consequent: [],
        alternate: [
          {
            kind: "return",
            expression: u32(RUNTIME_LEXER_SPEC_STATUS_UNKNOWN),
          },
        ],
      },
      setLocal("specClass", call("lexerSpecTokenClass", [local("specIndex")])),
      {
        kind: "if",
        condition: eq(
          local("specClass"),
          u32(RUNTIME_LEXER_TOKEN_UNKNOWN),
        ),
        consequent: [
          {
            kind: "return",
            expression: u32(RUNTIME_LEXER_SPEC_STATUS_UNKNOWN),
          },
        ],
      },
      {
        kind: "if",
        condition: eq(
          local("publicClass"),
          u32(RUNTIME_PUBLIC_TOKEN_LITERAL),
        ),
        consequent: [{
          kind: "if",
          condition: eq(
            local("specClass"),
            u32(RUNTIME_LEXER_TOKEN_LITERAL),
          ),
          consequent: [{
            kind: "return",
            expression: u32(RUNTIME_LEXER_SPEC_STATUS_OK),
          }],
          alternate: [{
            kind: "return",
            expression: u32(RUNTIME_LEXER_SPEC_STATUS_NOT_LITERAL),
          }],
        }],
      },
      {
        kind: "if",
        condition: eq(
          local("publicClass"),
          u32(RUNTIME_PUBLIC_TOKEN_MAIN),
        ),
        consequent: [{
          kind: "if",
          condition: eq(
            local("specClass"),
            u32(RUNTIME_LEXER_TOKEN_MAIN),
          ),
          consequent: [{
            kind: "return",
            expression: u32(RUNTIME_LEXER_SPEC_STATUS_OK),
          }],
          alternate: [{
            kind: "return",
            expression: u32(RUNTIME_LEXER_SPEC_STATUS_NOT_MAIN),
          }],
        }],
      },
      {
        kind: "if",
        condition: eq(
          local("publicClass"),
          u32(RUNTIME_PUBLIC_TOKEN_TRIVIA),
        ),
        consequent: [{
          kind: "if",
          condition: eq(
            local("specClass"),
            u32(RUNTIME_LEXER_TOKEN_TRIVIA),
          ),
          consequent: [{
            kind: "return",
            expression: u32(RUNTIME_LEXER_SPEC_STATUS_OK),
          }],
          alternate: [{
            kind: "return",
            expression: u32(RUNTIME_LEXER_SPEC_STATUS_NOT_TRIVIA),
          }],
        }],
      },
      { kind: "return", expression: u32(RUNTIME_LEXER_SPEC_STATUS_UNKNOWN) },
    ],
  };
}

function lexerTokenDiagnosticStatusFunction(): RuntimeLanguageFunction {
  return {
    name: "lexerTokenDiagnosticStatus",
    parameters: [
      { name: "publicClass", type: "u32" },
      { name: "terminal", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(
          local("publicClass"),
          u32(RUNTIME_PUBLIC_TOKEN_ERROR),
        ),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_LEXICAL_TOKEN_STATUS_ERROR_TOKEN),
        }],
      },
      {
        kind: "if",
        condition: eq(
          local("publicClass"),
          u32(RUNTIME_PUBLIC_TOKEN_TRIVIA),
        ),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_LEXICAL_TOKEN_STATUS_OK),
        }],
      },
      {
        kind: "if",
        condition: eq(
          local("publicClass"),
          u32(RUNTIME_PUBLIC_TOKEN_EOF),
        ),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_LEXICAL_TOKEN_STATUS_OK),
        }],
      },
      {
        kind: "if",
        condition: eq(
          local("publicClass"),
          u32(RUNTIME_PUBLIC_TOKEN_LITERAL),
        ),
        consequent: [
          {
            kind: "if",
            condition: eq(local("terminal"), u32(RUNTIME_NO_TERMINAL)),
            consequent: [{
              kind: "return",
              expression: u32(RUNTIME_LEXICAL_TOKEN_STATUS_NOT_TERMINAL),
            }],
            alternate: [{
              kind: "return",
              expression: u32(RUNTIME_LEXICAL_TOKEN_STATUS_OK),
            }],
          },
        ],
      },
      {
        kind: "if",
        condition: eq(
          local("publicClass"),
          u32(RUNTIME_PUBLIC_TOKEN_MAIN),
        ),
        consequent: [
          {
            kind: "if",
            condition: eq(local("terminal"), u32(RUNTIME_NO_TERMINAL)),
            consequent: [{
              kind: "return",
              expression: u32(RUNTIME_LEXICAL_TOKEN_STATUS_NOT_TERMINAL),
            }],
            alternate: [{
              kind: "return",
              expression: u32(RUNTIME_LEXICAL_TOKEN_STATUS_OK),
            }],
          },
        ],
      },
      {
        kind: "return",
        expression: u32(RUNTIME_LEXICAL_TOKEN_STATUS_NOT_TERMINAL),
      },
    ],
  };
}

function lexerSpecLoadFunction(
  name: string,
  specCount: number,
  fieldOffset: number,
  missing: number,
): RuntimeLanguageFunction {
  return {
    name,
    parameters: [
      { name: "specIndex", type: "u32" },
    ],
    locals: [
      { name: "offset", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: lt(local("specIndex"), u32(specCount)),
        consequent: [
          setLocal(
            "offset",
            add(mul(local("specIndex"), u32(3)), u32(fieldOffset)),
          ),
          {
            kind: "return",
            expression: load("lexerSpecs", local("offset")),
          },
        ],
      },
      { kind: "return", expression: u32(missing) },
    ],
  };
}

function parserProductionsTable(
  productions: readonly ParserRuntimeProductionEntry[],
): RuntimeLanguageTable {
  return {
    name: "parserProductions",
    type: "u32",
    values: productions.flatMap(([lhs, rhsLength]) => [lhs, rhsLength]),
  };
}

function parserProductionFunctions(
  productionCount: number,
): RuntimeLanguageFunction[] {
  return [
    parserProductionLoadFunction("parserProductionLhs", productionCount, 0),
    parserProductionLoadFunction(
      "parserProductionRhsLength",
      productionCount,
      1,
    ),
  ];
}

function parserProductionLoadFunction(
  name: string,
  productionCount: number,
  fieldOffset: number,
): RuntimeLanguageFunction {
  return {
    name,
    parameters: [
      { name: "production", type: "u32" },
    ],
    locals: [
      { name: "offset", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: lt(local("production"), u32(productionCount)),
        consequent: [
          setLocal(
            "offset",
            add(mul(local("production"), u32(2)), u32(fieldOffset)),
          ),
          {
            kind: "return",
            expression: load("parserProductions", local("offset")),
          },
        ],
      },
      { kind: "return", expression: u32(RUNTIME_NO_PRODUCTION) },
    ],
  };
}

function parserReducersTable(
  reducers: readonly ParserRuntimeReducerEntry[],
): RuntimeLanguageTable {
  return {
    name: "parserReducers",
    type: "u32",
    values: reducers.flatMap(([kind, payload]) => [kind, payload]),
  };
}

function parserReducerFunctions(
  reducerCount: number,
): RuntimeLanguageFunction[] {
  return [
    parserReducerLoadFunction(
      "parserReducerKind",
      reducerCount,
      0,
      RUNTIME_REDUCER_UNKNOWN,
    ),
    parserReducerLoadFunction(
      "parserReducerPayload",
      reducerCount,
      1,
      RUNTIME_NO_REDUCER_PAYLOAD,
    ),
    parserReducerOperationFunction(reducerCount),
    parserReducerPayloadStatusFunction(reducerCount),
    parserReducerChildRoleFunction(),
    parserReducerResultKindFunction(),
    parserReplayReductionStatusFunction(),
    parserReplayStackDepthFunction(),
    parserReplayRhsStartFunction(),
  ];
}

function parserReducerOperationFunction(
  reducerCount: number,
): RuntimeLanguageFunction {
  const kindIs = (
    kind: number,
    operation: number,
  ): RuntimeStatement => ({
    kind: "if",
    condition: eq(local("kindValue"), u32(kind)),
    consequent: [{
      kind: "return",
      expression: u32(operation),
    }],
  });
  return {
    name: "parserReducerOperation",
    parameters: [
      { name: "production", type: "u32" },
    ],
    locals: [
      { name: "kindValue", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: lt(local("production"), u32(reducerCount)),
        consequent: [],
        alternate: [{
          kind: "return",
          expression: u32(RUNTIME_REDUCER_OPERATION_UNKNOWN),
        }],
      },
      setLocal("kindValue", call("parserReducerKind", [local("production")])),
      kindIs(RUNTIME_REDUCER_START, RUNTIME_REDUCER_OPERATION_START),
      kindIs(RUNTIME_REDUCER_RULE, RUNTIME_REDUCER_OPERATION_RULE),
      kindIs(RUNTIME_REDUCER_TERMINAL, RUNTIME_REDUCER_OPERATION_TERMINAL),
      kindIs(RUNTIME_REDUCER_RULE_REF, RUNTIME_REDUCER_OPERATION_RULE_REF),
      kindIs(RUNTIME_REDUCER_IDENTITY, RUNTIME_REDUCER_OPERATION_IDENTITY),
      kindIs(RUNTIME_REDUCER_OPTIONAL_SOME, RUNTIME_REDUCER_OPERATION_IDENTITY),
      kindIs(RUNTIME_REDUCER_SEQUENCE, RUNTIME_REDUCER_OPERATION_SEQUENCE),
      kindIs(
        RUNTIME_REDUCER_OPTIONAL_EMPTY,
        RUNTIME_REDUCER_OPERATION_EMPTY_NULL,
      ),
      kindIs(
        RUNTIME_REDUCER_REPEAT_EMPTY,
        RUNTIME_REDUCER_OPERATION_EMPTY_ARRAY,
      ),
      kindIs(RUNTIME_REDUCER_REPEAT_APPEND, RUNTIME_REDUCER_OPERATION_APPEND),
      kindIs(RUNTIME_REDUCER_REPEAT1_APPEND, RUNTIME_REDUCER_OPERATION_APPEND),
      kindIs(
        RUNTIME_REDUCER_REPEAT1_FIRST,
        RUNTIME_REDUCER_OPERATION_FIRST_ARRAY,
      ),
      kindIs(
        RUNTIME_REDUCER_SEPARATED_FIRST,
        RUNTIME_REDUCER_OPERATION_FIRST_ARRAY,
      ),
      kindIs(
        RUNTIME_REDUCER_SEPARATED_APPEND,
        RUNTIME_REDUCER_OPERATION_SEPARATED_APPEND,
      ),
      kindIs(RUNTIME_REDUCER_FIELD, RUNTIME_REDUCER_OPERATION_FIELD),
      {
        kind: "return",
        expression: u32(RUNTIME_REDUCER_OPERATION_UNKNOWN),
      },
    ],
  };
}

function parserReducerLoadFunction(
  name: string,
  reducerCount: number,
  fieldOffset: number,
  missing: number,
): RuntimeLanguageFunction {
  return {
    name,
    parameters: [
      { name: "production", type: "u32" },
    ],
    locals: [
      { name: "offset", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: lt(local("production"), u32(reducerCount)),
        consequent: [
          setLocal(
            "offset",
            add(mul(local("production"), u32(2)), u32(fieldOffset)),
          ),
          {
            kind: "return",
            expression: load("parserReducers", local("offset")),
          },
        ],
      },
      { kind: "return", expression: u32(missing) },
    ],
  };
}

function parserReducerPayloadStatusFunction(
  reducerCount: number,
): RuntimeLanguageFunction {
  return {
    name: "parserReducerPayloadStatus",
    parameters: [
      { name: "production", type: "u32" },
    ],
    locals: [
      { name: "payload", type: "u32" },
      { name: "operation", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: lt(local("production"), u32(reducerCount)),
        consequent: [],
        alternate: [{
          kind: "return",
          expression: u32(RUNTIME_REDUCER_PAYLOAD_STATUS_UNKNOWN),
        }],
      },
      setLocal("payload", call("parserReducerPayload", [local("production")])),
      {
        kind: "if",
        condition: eq(local("payload"), u32(RUNTIME_NO_REDUCER_PAYLOAD)),
        consequent: [
          setLocal(
            "operation",
            call("parserReducerOperation", [local("production")]),
          ),
          {
            kind: "if",
            condition: eq(
              local("operation"),
              u32(RUNTIME_REDUCER_OPERATION_RULE),
            ),
            consequent: [{
              kind: "return",
              expression: u32(RUNTIME_REDUCER_PAYLOAD_STATUS_RULE_MISSING),
            }],
          },
          {
            kind: "if",
            condition: eq(
              local("operation"),
              u32(RUNTIME_REDUCER_OPERATION_FIELD),
            ),
            consequent: [{
              kind: "return",
              expression: u32(RUNTIME_REDUCER_PAYLOAD_STATUS_FIELD_MISSING),
            }],
          },
        ],
      },
      {
        kind: "return",
        expression: u32(RUNTIME_REDUCER_PAYLOAD_STATUS_OK),
      },
    ],
  };
}

function parserReducerChildRoleFunction(): RuntimeLanguageFunction {
  const operationSlotIs = (
    operation: number,
    slot: number,
    role: number,
  ): RuntimeStatement => ({
    kind: "if",
    condition: eq(local("operation"), u32(operation)),
    consequent: [{
      kind: "if",
      condition: eq(local("slot"), u32(slot)),
      consequent: [{
        kind: "return",
        expression: u32(role),
      }],
    }],
  });
  const operationAllSlots = (
    operation: number,
    role: number,
  ): RuntimeStatement => ({
    kind: "if",
    condition: eq(local("operation"), u32(operation)),
    consequent: [{
      kind: "return",
      expression: u32(role),
    }],
  });
  return {
    name: "parserReducerChildRole",
    parameters: [
      { name: "operation", type: "u32" },
      { name: "slot", type: "u32" },
    ],
    result: "u32",
    body: [
      operationSlotIs(
        RUNTIME_REDUCER_OPERATION_START,
        0,
        RUNTIME_REDUCER_CHILD_RAW,
      ),
      operationSlotIs(
        RUNTIME_REDUCER_OPERATION_RULE,
        0,
        RUNTIME_REDUCER_CHILD_FRAGMENT,
      ),
      operationSlotIs(
        RUNTIME_REDUCER_OPERATION_TERMINAL,
        0,
        RUNTIME_REDUCER_CHILD_SHIFTED_TOKEN,
      ),
      operationSlotIs(
        RUNTIME_REDUCER_OPERATION_RULE_REF,
        0,
        RUNTIME_REDUCER_CHILD_RULE_NODE,
      ),
      operationSlotIs(
        RUNTIME_REDUCER_OPERATION_IDENTITY,
        0,
        RUNTIME_REDUCER_CHILD_FRAGMENT,
      ),
      operationAllSlots(
        RUNTIME_REDUCER_OPERATION_SEQUENCE,
        RUNTIME_REDUCER_CHILD_FRAGMENT,
      ),
      operationSlotIs(
        RUNTIME_REDUCER_OPERATION_APPEND,
        0,
        RUNTIME_REDUCER_CHILD_FRAGMENT,
      ),
      operationSlotIs(
        RUNTIME_REDUCER_OPERATION_APPEND,
        1,
        RUNTIME_REDUCER_CHILD_FRAGMENT,
      ),
      operationSlotIs(
        RUNTIME_REDUCER_OPERATION_FIRST_ARRAY,
        0,
        RUNTIME_REDUCER_CHILD_FRAGMENT,
      ),
      operationSlotIs(
        RUNTIME_REDUCER_OPERATION_SEPARATED_APPEND,
        0,
        RUNTIME_REDUCER_CHILD_FRAGMENT,
      ),
      operationSlotIs(
        RUNTIME_REDUCER_OPERATION_SEPARATED_APPEND,
        1,
        RUNTIME_REDUCER_CHILD_FRAGMENT,
      ),
      operationSlotIs(
        RUNTIME_REDUCER_OPERATION_SEPARATED_APPEND,
        2,
        RUNTIME_REDUCER_CHILD_FRAGMENT,
      ),
      operationSlotIs(
        RUNTIME_REDUCER_OPERATION_FIELD,
        0,
        RUNTIME_REDUCER_CHILD_FRAGMENT,
      ),
      {
        kind: "return",
        expression: u32(RUNTIME_REDUCER_CHILD_UNKNOWN),
      },
    ],
  };
}

function parserReducerResultKindFunction(): RuntimeLanguageFunction {
  const operationIs = (
    operation: number,
    resultKind: number,
  ): RuntimeStatement => ({
    kind: "if",
    condition: eq(local("operation"), u32(operation)),
    consequent: [{
      kind: "return",
      expression: u32(resultKind),
    }],
  });
  return {
    name: "parserReducerResultKind",
    parameters: [
      { name: "operation", type: "u32" },
    ],
    result: "u32",
    body: [
      operationIs(
        RUNTIME_REDUCER_OPERATION_START,
        RUNTIME_REDUCER_RESULT_RAW_CHILD,
      ),
      operationIs(
        RUNTIME_REDUCER_OPERATION_RULE,
        RUNTIME_REDUCER_RESULT_RULE_NODE,
      ),
      operationIs(
        RUNTIME_REDUCER_OPERATION_TERMINAL,
        RUNTIME_REDUCER_RESULT_CHILD_FRAGMENT,
      ),
      operationIs(
        RUNTIME_REDUCER_OPERATION_RULE_REF,
        RUNTIME_REDUCER_RESULT_CHILD_FRAGMENT,
      ),
      operationIs(
        RUNTIME_REDUCER_OPERATION_IDENTITY,
        RUNTIME_REDUCER_RESULT_CHILD_FRAGMENT,
      ),
      operationIs(
        RUNTIME_REDUCER_OPERATION_SEQUENCE,
        RUNTIME_REDUCER_RESULT_SEQUENCE_FRAGMENT,
      ),
      operationIs(
        RUNTIME_REDUCER_OPERATION_EMPTY_NULL,
        RUNTIME_REDUCER_RESULT_EMPTY_NULL_FRAGMENT,
      ),
      operationIs(
        RUNTIME_REDUCER_OPERATION_EMPTY_ARRAY,
        RUNTIME_REDUCER_RESULT_EMPTY_ARRAY_FRAGMENT,
      ),
      operationIs(
        RUNTIME_REDUCER_OPERATION_APPEND,
        RUNTIME_REDUCER_RESULT_APPEND_FRAGMENT,
      ),
      operationIs(
        RUNTIME_REDUCER_OPERATION_FIRST_ARRAY,
        RUNTIME_REDUCER_RESULT_FIRST_ARRAY_FRAGMENT,
      ),
      operationIs(
        RUNTIME_REDUCER_OPERATION_SEPARATED_APPEND,
        RUNTIME_REDUCER_RESULT_SEPARATED_APPEND_FRAGMENT,
      ),
      operationIs(
        RUNTIME_REDUCER_OPERATION_FIELD,
        RUNTIME_REDUCER_RESULT_FIELD_FRAGMENT,
      ),
      {
        kind: "return",
        expression: u32(RUNTIME_REDUCER_RESULT_UNKNOWN),
      },
    ],
  };
}

function parserReplayReductionStatusFunction(): RuntimeLanguageFunction {
  return {
    name: "parserReplayReductionStatus",
    parameters: [
      { name: "rhsLength", type: "u32" },
      { name: "operation", type: "u32" },
      { name: "payloadStatus", type: "u32" },
      { name: "valueDepth", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(local("rhsLength"), u32(RUNTIME_NO_PRODUCTION)),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_REPLAY_REDUCTION_STATUS_UNKNOWN_PRODUCTION),
        }],
      },
      {
        kind: "if",
        condition: eq(
          local("operation"),
          u32(RUNTIME_REDUCER_OPERATION_UNKNOWN),
        ),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_REPLAY_REDUCTION_STATUS_UNKNOWN_PRODUCTION),
        }],
      },
      {
        kind: "if",
        condition: eq(
          local("payloadStatus"),
          u32(RUNTIME_REDUCER_PAYLOAD_STATUS_UNKNOWN),
        ),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_REPLAY_REDUCTION_STATUS_UNKNOWN_PRODUCTION),
        }],
      },
      {
        kind: "if",
        condition: eq(
          local("payloadStatus"),
          u32(RUNTIME_REDUCER_PAYLOAD_STATUS_RULE_MISSING),
        ),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_REPLAY_REDUCTION_STATUS_RULE_PAYLOAD_MISSING),
        }],
      },
      {
        kind: "if",
        condition: eq(
          local("payloadStatus"),
          u32(RUNTIME_REDUCER_PAYLOAD_STATUS_FIELD_MISSING),
        ),
        consequent: [{
          kind: "return",
          expression: u32(
            RUNTIME_REPLAY_REDUCTION_STATUS_FIELD_PAYLOAD_MISSING,
          ),
        }],
      },
      {
        kind: "if",
        condition: lt(local("valueDepth"), local("rhsLength")),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_REPLAY_REDUCTION_STATUS_STACK_UNDERFLOW),
        }],
      },
      {
        kind: "return",
        expression: u32(RUNTIME_REPLAY_REDUCTION_STATUS_OK),
      },
    ],
  };
}

function parserFieldFunctions(
  ruleCount: number,
  fieldEntryCount: number,
): RuntimeLanguageFunction[] {
  return [
    parserFieldRowFunction("parserFieldStart", ruleCount, 0),
    parserFieldRowFunction("parserFieldEnd", ruleCount, 1),
    parserFieldEntryFunction(
      "parserFieldId",
      fieldEntryCount,
      0,
      RUNTIME_NO_FIELD,
    ),
    parserFieldEntryFunction("parserFieldFlags", fieldEntryCount, 1, 0),
    parserFieldIndexFunction(ruleCount),
    parserFieldEntryStatusFunction(),
    parserFieldValueClassFunction(fieldEntryCount),
    parserFieldStorageStatusFunction(),
    parserFieldSchemaStatusFunction(),
    parserFieldBuildStatusFunction(),
    parserFieldArrayValueStatusFunction(),
    parserFieldScalarValueStatusFunction(),
    parserFieldCaptureStatusFunction(fieldEntryCount),
    parserFieldFinalStatusFunction(fieldEntryCount),
  ];
}

function parserFieldRowFunction(
  name: string,
  ruleCount: number,
  rowOffset: number,
): RuntimeLanguageFunction {
  return {
    name,
    parameters: [
      { name: "ruleId", type: "u32" },
    ],
    locals: [
      { name: "index", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: lt(local("ruleId"), u32(ruleCount)),
        consequent: [
          setLocal("index", add(local("ruleId"), u32(rowOffset))),
          {
            kind: "return",
            expression: load("parserFieldRows", local("index")),
          },
        ],
      },
      { kind: "return", expression: u32(0) },
    ],
  };
}

function parserFieldEntryFunction(
  name: string,
  fieldEntryCount: number,
  fieldOffset: number,
  missing: number,
): RuntimeLanguageFunction {
  return {
    name,
    parameters: [
      { name: "entry", type: "u32" },
    ],
    locals: [
      { name: "index", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: lt(local("entry"), u32(fieldEntryCount)),
        consequent: [
          setLocal("index", add(mul(local("entry"), u32(2)), u32(fieldOffset))),
          {
            kind: "return",
            expression: load("parserFieldEntries", local("index")),
          },
        ],
      },
      { kind: "return", expression: u32(missing) },
    ],
  };
}

function parserFieldIndexFunction(
  ruleCount: number,
): RuntimeLanguageFunction {
  return {
    name: "parserFieldIndex",
    parameters: [
      { name: "ruleId", type: "u32" },
      { name: "fieldId", type: "u32" },
    ],
    locals: [
      { name: "entry", type: "u32" },
      { name: "end", type: "u32" },
      { name: "entryOffset", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: lt(local("ruleId"), u32(ruleCount)),
        consequent: [],
        alternate: [
          { kind: "return", expression: u32(RUNTIME_NO_FIELD) },
        ],
      },
      setLocal("entry", call("parserFieldStart", [local("ruleId")])),
      setLocal("end", call("parserFieldEnd", [local("ruleId")])),
      {
        kind: "while",
        condition: lt(local("entry"), local("end")),
        body: [
          setLocal("entryOffset", mul(local("entry"), u32(2))),
          {
            kind: "if",
            condition: eq(
              load("parserFieldEntries", local("entryOffset")),
              local("fieldId"),
            ),
            consequent: [
              { kind: "return", expression: local("entry") },
            ],
          },
          setLocal("entry", add(local("entry"), u32(1))),
        ],
      },
      { kind: "return", expression: u32(RUNTIME_NO_FIELD) },
    ],
  };
}

function parserFieldEntryStatusFunction(): RuntimeLanguageFunction {
  return {
    name: "parserFieldEntryStatus",
    parameters: [
      { name: "entry", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(local("entry"), u32(RUNTIME_NO_FIELD)),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_FIELD_ENTRY_MISSING),
        }],
      },
      { kind: "return", expression: u32(RUNTIME_FIELD_ENTRY_PRESENT) },
    ],
  };
}

function parserFieldValueClassFunction(
  fieldEntryCount: number,
): RuntimeLanguageFunction {
  return {
    name: "parserFieldValueClass",
    parameters: [
      { name: "entry", type: "u32" },
    ],
    locals: [
      { name: "flags", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: lt(local("entry"), u32(fieldEntryCount)),
        consequent: [
          setLocal("flags", call("parserFieldFlags", [local("entry")])),
          {
            kind: "if",
            condition: eq(
              and(local("flags"), u32(RUNTIME_FIELD_ARRAY)),
              u32(0),
            ),
            consequent: [{
              kind: "if",
              condition: eq(
                and(local("flags"), u32(RUNTIME_FIELD_NULLABLE)),
                u32(0),
              ),
              consequent: [{
                kind: "return",
                expression: u32(RUNTIME_FIELD_VALUE_REQUIRED),
              }],
              alternate: [{
                kind: "return",
                expression: u32(RUNTIME_FIELD_VALUE_NULLABLE),
              }],
            }],
            alternate: [{
              kind: "return",
              expression: u32(RUNTIME_FIELD_VALUE_ARRAY),
            }],
          },
        ],
      },
      { kind: "return", expression: u32(RUNTIME_FIELD_VALUE_REQUIRED) },
    ],
  };
}

function parserFieldStorageStatusFunction(): RuntimeLanguageFunction {
  return {
    name: "parserFieldStorageStatus",
    parameters: [
      { name: "entry", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(
          call("parserFieldValueClass", [local("entry")]),
          u32(RUNTIME_FIELD_VALUE_ARRAY),
        ),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_FIELD_STORAGE_ARRAY),
        }],
      },
      { kind: "return", expression: u32(RUNTIME_FIELD_STORAGE_SCALAR) },
    ],
  };
}

function parserFieldSchemaStatusFunction(): RuntimeLanguageFunction {
  return {
    name: "parserFieldSchemaStatus",
    parameters: [
      { name: "start", type: "u32" },
      { name: "end", type: "u32" },
      { name: "captureCount", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: lt(local("start"), local("end")),
        consequent: [
          { kind: "return", expression: u32(RUNTIME_FIELD_SCHEMA_STATUS_OK) },
        ],
      },
      {
        kind: "if",
        condition: eq(local("captureCount"), u32(0)),
        consequent: [
          { kind: "return", expression: u32(RUNTIME_FIELD_SCHEMA_STATUS_OK) },
        ],
      },
      {
        kind: "return",
        expression: u32(RUNTIME_FIELD_SCHEMA_STATUS_CAPTURE_WITHOUT_SCHEMA),
      },
    ],
  };
}

function parserFieldBuildStatusFunction(): RuntimeLanguageFunction {
  return {
    name: "parserFieldBuildStatus",
    parameters: [
      { name: "start", type: "u32" },
      { name: "end", type: "u32" },
      { name: "schemaStatus", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(
          local("schemaStatus"),
          u32(RUNTIME_FIELD_SCHEMA_STATUS_CAPTURE_WITHOUT_SCHEMA),
        ),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_FIELD_BUILD_CAPTURE_WITHOUT_SCHEMA),
        }],
      },
      {
        kind: "if",
        condition: lt(local("start"), local("end")),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_FIELD_BUILD_PRESENT),
        }],
      },
      {
        kind: "return",
        expression: u32(RUNTIME_FIELD_BUILD_EMPTY),
      },
    ],
  };
}

function parserFieldArrayValueStatusFunction(): RuntimeLanguageFunction {
  return {
    name: "parserFieldArrayValueStatus",
    parameters: [
      { name: "vectorHandle", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(local("vectorHandle"), u32(0)),
        consequent: [
          {
            kind: "return",
            expression: u32(RUNTIME_FIELD_ARRAY_VALUE_MISSING),
          },
        ],
      },
      { kind: "return", expression: u32(RUNTIME_FIELD_ARRAY_VALUE_OK) },
    ],
  };
}

function parserFieldScalarValueStatusFunction(): RuntimeLanguageFunction {
  return {
    name: "parserFieldScalarValueStatus",
    parameters: [
      { name: "count", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(local("count"), u32(0)),
        consequent: [
          { kind: "return", expression: u32(RUNTIME_FIELD_SCALAR_VALUE_NULL) },
        ],
      },
      {
        kind: "return",
        expression: u32(RUNTIME_FIELD_SCALAR_VALUE_FRAGMENT),
      },
    ],
  };
}

function parserFieldCaptureStatusFunction(
  fieldEntryCount: number,
): RuntimeLanguageFunction {
  return {
    name: "parserFieldCaptureStatus",
    parameters: [
      { name: "entry", type: "u32" },
      { name: "count", type: "u32" },
    ],
    locals: [
      { name: "valueClass", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: lt(local("entry"), u32(fieldEntryCount)),
        consequent: [],
        alternate: [
          { kind: "return", expression: u32(RUNTIME_FIELD_CAPTURE_UNKNOWN) },
        ],
      },
      setLocal("valueClass", call("parserFieldValueClass", [local("entry")])),
      {
        kind: "if",
        condition: eq(
          local("valueClass"),
          u32(RUNTIME_FIELD_VALUE_ARRAY),
        ),
        consequent: [
          { kind: "return", expression: u32(RUNTIME_FIELD_CAPTURE_ARRAY) },
        ],
      },
      {
        kind: "if",
        condition: lt(u32(1), local("count")),
        consequent: [
          { kind: "return", expression: u32(RUNTIME_FIELD_CAPTURE_TOO_MANY) },
        ],
      },
      { kind: "return", expression: u32(RUNTIME_FIELD_CAPTURE_SCALAR) },
    ],
  };
}

function parserFieldFinalStatusFunction(
  fieldEntryCount: number,
): RuntimeLanguageFunction {
  return {
    name: "parserFieldFinalStatus",
    parameters: [
      { name: "entry", type: "u32" },
      { name: "count", type: "u32" },
    ],
    locals: [
      { name: "valueClass", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: lt(local("entry"), u32(fieldEntryCount)),
        consequent: [],
        alternate: [
          { kind: "return", expression: u32(RUNTIME_FIELD_FINAL_OK) },
        ],
      },
      setLocal("valueClass", call("parserFieldValueClass", [local("entry")])),
      {
        kind: "if",
        condition: eq(
          local("valueClass"),
          u32(RUNTIME_FIELD_VALUE_ARRAY),
        ),
        consequent: [
          { kind: "return", expression: u32(RUNTIME_FIELD_FINAL_OK) },
        ],
      },
      {
        kind: "if",
        condition: eq(
          local("valueClass"),
          u32(RUNTIME_FIELD_VALUE_NULLABLE),
        ),
        consequent: [{
          kind: "if",
          condition: lt(u32(1), local("count")),
          consequent: [{
            kind: "return",
            expression: u32(RUNTIME_FIELD_FINAL_TOO_MANY),
          }],
          alternate: [{
            kind: "return",
            expression: u32(RUNTIME_FIELD_FINAL_OK),
          }],
        }],
      },
      {
        kind: "if",
        condition: eq(local("count"), u32(1)),
        consequent: [
          { kind: "return", expression: u32(RUNTIME_FIELD_FINAL_OK) },
        ],
      },
      {
        kind: "return",
        expression: u32(RUNTIME_FIELD_FINAL_REQUIRED_MISSING),
      },
    ],
  };
}

function parserReplayRhsStartFunction(): RuntimeLanguageFunction {
  return {
    name: "parserReplayRhsStart",
    parameters: [
      { name: "valueCount", type: "u32" },
      { name: "rhsLength", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "return",
        expression: sub(local("valueCount"), local("rhsLength")),
      },
    ],
  };
}

function parserReplayStackDepthFunction(): RuntimeLanguageFunction {
  return {
    name: "parserReplayStackDepth",
    parameters: [
      { name: "valueCount", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(local("valueCount"), u32(0)),
        consequent: [{ kind: "return", expression: u32(0) }],
      },
      {
        kind: "return",
        expression: sub(local("valueCount"), u32(1)),
      },
    ],
  };
}

function parserActionFunctions(): RuntimeLanguageFunction[] {
  return [
    parserActionKindFunction(),
    parserActionPayloadFunction(),
    parserReplayActionStatusFunction(),
  ];
}

function parserActionKindFunction(): RuntimeLanguageFunction {
  return {
    name: "parserActionKind",
    parameters: [
      { name: "action", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "return",
        expression: and(local("action"), u32(RUNTIME_ACTION_KIND_MASK)),
      },
    ],
  };
}

function parserActionPayloadFunction(): RuntimeLanguageFunction {
  return {
    name: "parserActionPayload",
    parameters: [
      { name: "action", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "return",
        expression: and(local("action"), u32(RUNTIME_ACTION_PAYLOAD_MASK)),
      },
    ],
  };
}

function parserReplayActionStatusFunction(): RuntimeLanguageFunction {
  return {
    name: "parserReplayActionStatus",
    parameters: [
      { name: "actionKind", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(local("actionKind"), u32(RUNTIME_ACTION_SHIFT)),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_REPLAY_ACTION_STATUS_SHIFT),
        }],
      },
      {
        kind: "if",
        condition: eq(local("actionKind"), u32(RUNTIME_ACTION_REDUCE)),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_REPLAY_ACTION_STATUS_REDUCE),
        }],
      },
      {
        kind: "if",
        condition: eq(local("actionKind"), u32(RUNTIME_ACTION_ACCEPT)),
        consequent: [{
          kind: "return",
          expression: u32(RUNTIME_REPLAY_ACTION_STATUS_ACCEPT),
        }],
      },
      {
        kind: "return",
        expression: u32(RUNTIME_REPLAY_ACTION_STATUS_UNKNOWN),
      },
    ],
  };
}

function parserActionCountFunction(): RuntimeLanguageFunction {
  return {
    name: "parserActionCount",
    parameters: [
      { name: "state", type: "u32" },
      { name: "terminal", type: "u32" },
    ],
    locals: [
      { name: "count", type: "u32" },
      { name: "action", type: "u32" },
      { name: "loop", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal("count", u32(0)),
      setLocal("loop", u32(1)),
      {
        kind: "while",
        condition: local("loop"),
        body: [
          setLocal(
            "action",
            call("parserActionAt", [
              local("state"),
              local("terminal"),
              local("count"),
            ]),
          ),
          {
            kind: "if",
            condition: eq(local("action"), u32(RUNTIME_ACTION_NONE)),
            consequent: [
              { kind: "return", expression: local("count") },
            ],
          },
          setLocal("count", add(local("count"), u32(1))),
        ],
      },
      { kind: "return", expression: local("count") },
    ],
  };
}

function flattenLookupTable(
  prefix: string,
  rows: readonly (readonly ParserRuntimeLookupEntry[])[],
): {
  readonly rowsTable: string;
  readonly entriesTable: string;
  readonly tables: readonly RuntimeLanguageTable[];
} {
  const rowValues: number[] = [];
  const entryValues: number[] = [];
  for (const entries of rows) {
    rowValues.push(entryValues.length / 2);
    for (const [key, value] of entries) entryValues.push(key, value);
  }
  rowValues.push(entryValues.length / 2);
  const rowsTable = `${prefix}Rows`;
  const entriesTable = `${prefix}Entries`;
  return {
    rowsTable,
    entriesTable,
    tables: [
      {
        name: rowsTable,
        type: "u32" as const,
        values: rowValues,
      },
      {
        name: entriesTable,
        type: "u32" as const,
        values: entryValues,
      },
    ],
  };
}

function tableLookupFunction(
  name: string,
  rowsTable: string,
  entriesTable: string,
  missingValue: number,
): RuntimeLanguageFunction {
  return {
    name,
    parameters: [
      { name: "state", type: "u32" },
      { name: "key", type: "u32" },
    ],
    locals: [
      { name: "index", type: "u32" },
      { name: "low", type: "u32" },
      { name: "high", type: "u32" },
      { name: "midpoint", type: "u32" },
      { name: "entryKey", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal("index", local("state")),
      setLocal("low", load(rowsTable, local("index"))),
      setLocal("index", add(local("state"), u32(1))),
      setLocal("high", load(rowsTable, local("index"))),
      {
        kind: "while",
        condition: lt(local("low"), local("high")),
        body: [
          setLocal("midpoint", shr(add(local("low"), local("high")), u32(1))),
          setLocal("index", mul(local("midpoint"), u32(2))),
          setLocal("entryKey", load(entriesTable, local("index"))),
          {
            kind: "if",
            condition: lt(local("key"), local("entryKey")),
            consequent: [
              setLocal("high", local("midpoint")),
            ],
            alternate: [
              {
                kind: "if",
                condition: lt(local("entryKey"), local("key")),
                consequent: [
                  setLocal("low", add(local("midpoint"), u32(1))),
                ],
                alternate: [
                  setLocal("index", add(local("index"), u32(1))),
                  {
                    kind: "return",
                    expression: load(entriesTable, local("index")),
                  },
                ],
              },
            ],
          },
        ],
      },
      { kind: "return", expression: u32(missingValue) },
    ],
  };
}

function tableLookupAtFunction(
  name: string,
  rowsTable: string,
  entriesTable: string,
  missingValue: number,
): RuntimeLanguageFunction {
  return {
    name,
    parameters: [
      { name: "state", type: "u32" },
      { name: "key", type: "u32" },
      { name: "ordinal", type: "u32" },
    ],
    locals: [
      { name: "index", type: "u32" },
      { name: "rowEnd", type: "u32" },
      { name: "low", type: "u32" },
      { name: "high", type: "u32" },
      { name: "midpoint", type: "u32" },
      { name: "entryKey", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal("index", local("state")),
      setLocal("low", load(rowsTable, local("index"))),
      setLocal("index", add(local("state"), u32(1))),
      setLocal("rowEnd", load(rowsTable, local("index"))),
      setLocal("high", local("rowEnd")),
      {
        kind: "while",
        condition: lt(local("low"), local("high")),
        body: [
          setLocal("midpoint", shr(add(local("low"), local("high")), u32(1))),
          setLocal("index", mul(local("midpoint"), u32(2))),
          setLocal("entryKey", load(entriesTable, local("index"))),
          {
            kind: "if",
            condition: lt(local("entryKey"), local("key")),
            consequent: [
              setLocal("low", add(local("midpoint"), u32(1))),
            ],
            alternate: [
              setLocal("high", local("midpoint")),
            ],
          },
        ],
      },
      setLocal("index", add(local("low"), local("ordinal"))),
      {
        kind: "if",
        condition: lt(local("index"), local("rowEnd")),
        consequent: [
          setLocal("index", mul(local("index"), u32(2))),
          setLocal("entryKey", load(entriesTable, local("index"))),
          {
            kind: "if",
            condition: lt(local("key"), local("entryKey")),
            consequent: [
              { kind: "return", expression: u32(missingValue) },
            ],
            alternate: [
              {
                kind: "if",
                condition: lt(local("entryKey"), local("key")),
                consequent: [
                  { kind: "return", expression: u32(missingValue) },
                ],
                alternate: [
                  setLocal("index", add(local("index"), u32(1))),
                  {
                    kind: "return",
                    expression: load(entriesTable, local("index")),
                  },
                ],
              },
            ],
          },
        ],
      },
      { kind: "return", expression: u32(missingValue) },
    ],
  };
}

function parserTraceSetTerminalFunction(): RuntimeLanguageFunction {
  return {
    name: "parserTraceSetTerminal",
    parameters: [
      { name: "index", type: "u32" },
      { name: "terminal", type: "u32" },
    ],
    locals: [
      { name: "capacity", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal("index", add(u32(TRACE_TERMINALS_BASE), local("index"))),
      setLocal("capacity", ensureScratch(add(local("index"), u32(1)))),
      storeScratch(local("index"), local("terminal")),
      { kind: "return", expression: u32(0) },
    ],
  };
}

function parserTraceStatusKindFunction(): RuntimeLanguageFunction {
  const statusIs = (status: number): RuntimeStatement => ({
    kind: "if",
    condition: eq(local("status"), u32(status)),
    consequent: [{
      kind: "return",
      expression: u32(status),
    }],
  });
  return {
    name: "parserTraceStatusKind",
    parameters: [
      { name: "status", type: "u32" },
    ],
    result: "u32",
    body: [
      statusIs(TRACE_STATUS_OK),
      statusIs(TRACE_STATUS_UNEXPECTED),
      statusIs(TRACE_STATUS_INTERNAL),
      statusIs(TRACE_STATUS_BRANCH_LIMIT),
      {
        kind: "return",
        expression: u32(TRACE_STATUS_INTERNAL),
      },
    ],
  };
}

function parserTraceFunction(
  productionCount: number,
): RuntimeLanguageFunction {
  return {
    name: "parserTrace",
    parameters: [
      { name: "terminalCount", type: "u32" },
    ],
    locals: [
      { name: "capacity", type: "u32" },
      { name: "stackHandle", type: "u32" },
      { name: "stackCapacity", type: "u32" },
      { name: "traceHandle", type: "u32" },
      { name: "depth", type: "u32" },
      { name: "streamIndex", type: "u32" },
      { name: "traceCount", type: "u32" },
      { name: "loop", type: "u32" },
      { name: "state", type: "u32" },
      { name: "terminal", type: "u32" },
      { name: "action", type: "u32" },
      { name: "actionKind", type: "u32" },
      { name: "actionPayload", type: "u32" },
      { name: "productionIndex", type: "u32" },
      { name: "lhs", type: "u32" },
      { name: "rhsLength", type: "u32" },
      { name: "gotoState", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal(
        "capacity",
        ensureScratch(add(u32(TRACE_TERMINALS_BASE), local("terminalCount"))),
      ),
      setLocal(
        "capacity",
        call("runtimeArenaResetTo", [
          add(u32(TRACE_TERMINALS_BASE), local("terminalCount")),
        ]),
      ),
      setLocal(
        "stackCapacity",
        add(add(local("terminalCount"), u32(productionCount)), u32(16)),
      ),
      setLocal(
        "stackHandle",
        call("runtimeVectorNew", [
          local("stackCapacity"),
        ]),
      ),
      setLocal(
        "traceHandle",
        call("runtimeVectorNew", [
          local("stackCapacity"),
        ]),
      ),
      setLocal(
        "capacity",
        call("runtimeVectorAppend", [
          local("stackHandle"),
          u32(0),
        ]),
      ),
      storeScratch(u32(TRACE_STATUS), u32(TRACE_STATUS_OK)),
      storeScratch(u32(TRACE_ERROR_STATE), u32(0)),
      storeScratch(u32(TRACE_ERROR_INDEX), u32(0)),
      storeScratch(u32(TRACE_COUNT), u32(0)),
      storeScratch(u32(TRACE_BASE), local("traceHandle")),
      setLocal("depth", u32(1)),
      setLocal("streamIndex", u32(0)),
      setLocal("loop", u32(1)),
      {
        kind: "while",
        condition: local("loop"),
        body: [
          {
            kind: "if",
            condition: lt(local("streamIndex"), local("terminalCount")),
            consequent: [],
            alternate: traceReturnStatements(TRACE_STATUS_INTERNAL),
          },
          setLocal(
            "state",
            call("runtimeVectorLoad", [
              local("stackHandle"),
              sub(local("depth"), u32(1)),
            ]),
          ),
          setLocal(
            "terminal",
            loadScratch(add(u32(TRACE_TERMINALS_BASE), local("streamIndex"))),
          ),
          setLocal(
            "action",
            call("parserAction", [local("state"), local("terminal")]),
          ),
          setLocal(
            "actionKind",
            call("parserActionKind", [local("action")]),
          ),
          setLocal(
            "actionPayload",
            call("parserActionPayload", [local("action")]),
          ),
          {
            kind: "if",
            condition: eq(local("actionKind"), u32(RUNTIME_ACTION_NONE)),
            consequent: traceReturnStatements(TRACE_STATUS_UNEXPECTED),
          },
          {
            kind: "if",
            condition: eq(local("actionKind"), u32(RUNTIME_ACTION_SHIFT)),
            consequent: [
              ...traceStoreActionStatements(),
              {
                kind: "if",
                condition: lt(local("depth"), local("stackCapacity")),
                consequent: [],
                alternate: traceReturnStatements(TRACE_STATUS_INTERNAL),
              },
              setLocal(
                "capacity",
                call("runtimeVectorAppend", [
                  local("stackHandle"),
                  local("actionPayload"),
                ]),
              ),
              setLocal("depth", add(local("depth"), u32(1))),
              setLocal("streamIndex", add(local("streamIndex"), u32(1))),
            ],
            alternate: [{
              kind: "if",
              condition: eq(local("actionKind"), u32(RUNTIME_ACTION_REDUCE)),
              consequent: [
                setLocal("productionIndex", local("actionPayload")),
                setLocal(
                  "lhs",
                  call("parserProductionLhs", [local("productionIndex")]),
                ),
                setLocal(
                  "rhsLength",
                  call("parserProductionRhsLength", [local("productionIndex")]),
                ),
                {
                  kind: "if",
                  condition: eq(local("rhsLength"), u32(RUNTIME_NO_PRODUCTION)),
                  consequent: traceReturnStatements(TRACE_STATUS_INTERNAL),
                },
                {
                  kind: "if",
                  condition: lt(
                    local("depth"),
                    add(local("rhsLength"), u32(1)),
                  ),
                  consequent: traceReturnStatements(TRACE_STATUS_INTERNAL),
                },
                setLocal("depth", sub(local("depth"), local("rhsLength"))),
                setLocal(
                  "capacity",
                  call("runtimeVectorTruncate", [
                    local("stackHandle"),
                    local("depth"),
                  ]),
                ),
                setLocal(
                  "state",
                  call("runtimeVectorLoad", [
                    local("stackHandle"),
                    sub(local("depth"), u32(1)),
                  ]),
                ),
                setLocal(
                  "gotoState",
                  call("parserGoto", [local("state"), local("lhs")]),
                ),
                {
                  kind: "if",
                  condition: eq(local("gotoState"), u32(RUNTIME_NO_GOTO)),
                  consequent: traceReturnStatements(TRACE_STATUS_INTERNAL),
                  alternate: [
                    ...traceStoreActionStatements(),
                    {
                      kind: "if",
                      condition: lt(local("depth"), local("stackCapacity")),
                      consequent: [],
                      alternate: traceReturnStatements(TRACE_STATUS_INTERNAL),
                    },
                    setLocal(
                      "capacity",
                      call("runtimeVectorAppend", [
                        local("stackHandle"),
                        local("gotoState"),
                      ]),
                    ),
                    setLocal("depth", add(local("depth"), u32(1))),
                  ],
                },
              ],
              alternate: [{
                kind: "if",
                condition: eq(local("actionKind"), u32(RUNTIME_ACTION_ACCEPT)),
                consequent: [
                  ...traceStoreActionStatements(),
                  ...traceReturnStatements(TRACE_STATUS_OK),
                ],
                alternate: traceReturnStatements(TRACE_STATUS_INTERNAL),
              }],
            }],
          },
        ],
      },
      ...traceReturnStatements(TRACE_STATUS_INTERNAL),
    ],
  };
}

function parserConflictTraceFunction(
  productionCount: number,
): RuntimeLanguageFunction {
  return {
    name: "parserTrace",
    parameters: [
      { name: "terminalCount", type: "u32" },
    ],
    locals: [
      { name: "capacity", type: "u32" },
      { name: "stackHandle", type: "u32" },
      { name: "stateCapacity", type: "u32" },
      { name: "traceHandle", type: "u32" },
      { name: "traceCapacity", type: "u32" },
      { name: "branchActionHandle", type: "u32" },
      { name: "branchDepthHandle", type: "u32" },
      { name: "branchStreamIndexHandle", type: "u32" },
      { name: "branchTraceCountHandle", type: "u32" },
      { name: "branchStackHandle", type: "u32" },
      { name: "branchTraceHandle", type: "u32" },
      { name: "branchCount", type: "u32" },
      { name: "exploredBranches", type: "u32" },
      { name: "depth", type: "u32" },
      { name: "streamIndex", type: "u32" },
      { name: "traceCount", type: "u32" },
      { name: "loop", type: "u32" },
      { name: "hasPendingAction", type: "u32" },
      { name: "actionReady", type: "u32" },
      { name: "state", type: "u32" },
      { name: "terminal", type: "u32" },
      { name: "actionCount", type: "u32" },
      { name: "ordinal", type: "u32" },
      { name: "action", type: "u32" },
      { name: "pendingAction", type: "u32" },
      { name: "actionKind", type: "u32" },
      { name: "actionPayload", type: "u32" },
      { name: "productionIndex", type: "u32" },
      { name: "lhs", type: "u32" },
      { name: "rhsLength", type: "u32" },
      { name: "gotoState", type: "u32" },
      { name: "bestState", type: "u32" },
      { name: "bestIndex", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal(
        "capacity",
        ensureScratch(add(u32(TRACE_TERMINALS_BASE), local("terminalCount"))),
      ),
      setLocal(
        "capacity",
        call("runtimeArenaResetTo", [
          add(u32(TRACE_TERMINALS_BASE), local("terminalCount")),
        ]),
      ),
      setLocal(
        "stateCapacity",
        add(add(local("terminalCount"), u32(productionCount)), u32(16)),
      ),
      setLocal(
        "traceCapacity",
        add(
          mul(local("terminalCount"), u32(productionCount + 1)),
          add(u32(productionCount), u32(16)),
        ),
      ),
      setLocal(
        "stackHandle",
        call("runtimeVectorNew", [local("stateCapacity")]),
      ),
      setLocal(
        "traceHandle",
        call("runtimeVectorNew", [local("traceCapacity")]),
      ),
      setLocal("branchActionHandle", call("runtimeVectorNew", [u32(0)])),
      setLocal("branchDepthHandle", call("runtimeVectorNew", [u32(0)])),
      setLocal("branchStreamIndexHandle", call("runtimeVectorNew", [u32(0)])),
      setLocal("branchTraceCountHandle", call("runtimeVectorNew", [u32(0)])),
      setLocal("branchStackHandle", call("runtimeVectorNew", [u32(0)])),
      setLocal("branchTraceHandle", call("runtimeVectorNew", [u32(0)])),
      setLocal(
        "capacity",
        call("runtimeVectorAppend", [
          local("stackHandle"),
          u32(0),
        ]),
      ),
      storeScratch(u32(TRACE_STATUS), u32(TRACE_STATUS_OK)),
      storeScratch(u32(TRACE_ERROR_STATE), u32(0)),
      storeScratch(u32(TRACE_ERROR_INDEX), u32(0)),
      storeScratch(u32(TRACE_COUNT), u32(0)),
      storeScratch(u32(TRACE_BASE), local("traceHandle")),
      setLocal("depth", u32(1)),
      setLocal("streamIndex", u32(0)),
      setLocal("traceCount", u32(0)),
      setLocal("branchCount", u32(0)),
      setLocal("exploredBranches", u32(1)),
      setLocal("hasPendingAction", u32(0)),
      setLocal("bestState", u32(0)),
      setLocal("bestIndex", u32(0xffff_ffff)),
      setLocal("loop", u32(1)),
      {
        kind: "while",
        condition: local("loop"),
        body: [
          setLocal("actionReady", u32(0)),
          setLocal(
            "state",
            call("runtimeVectorLoad", [
              local("stackHandle"),
              sub(local("depth"), u32(1)),
            ]),
          ),
          {
            kind: "if",
            condition: local("hasPendingAction"),
            consequent: [
              setLocal("action", local("pendingAction")),
              setLocal("hasPendingAction", u32(0)),
              setLocal("actionReady", u32(1)),
            ],
            alternate: [
              {
                kind: "if",
                condition: lt(local("streamIndex"), local("terminalCount")),
                consequent: [
                  setLocal(
                    "terminal",
                    loadScratch(
                      add(u32(TRACE_TERMINALS_BASE), local("streamIndex")),
                    ),
                  ),
                  setLocal(
                    "actionCount",
                    call("parserActionCount", [
                      local("state"),
                      local("terminal"),
                    ]),
                  ),
                  {
                    kind: "if",
                    condition: eq(local("actionCount"), u32(0)),
                    consequent: conflictRestoreBranchOrReturnUnexpected(),
                    alternate: [
                      setLocal("ordinal", sub(local("actionCount"), u32(1))),
                      {
                        kind: "while",
                        condition: lt(u32(0), local("ordinal")),
                        body: [
                          setLocal(
                            "pendingAction",
                            call("parserActionAt", [
                              local("state"),
                              local("terminal"),
                              local("ordinal"),
                            ]),
                          ),
                          ...conflictSaveBranchFrame(),
                          setLocal("ordinal", sub(local("ordinal"), u32(1))),
                        ],
                      },
                      setLocal(
                        "action",
                        call("parserActionAt", [
                          local("state"),
                          local("terminal"),
                          u32(0),
                        ]),
                      ),
                      setLocal("actionReady", u32(1)),
                    ],
                  },
                ],
                alternate: conflictRestoreBranchOrReturnUnexpected(),
              },
            ],
          },
          {
            kind: "if",
            condition: local("actionReady"),
            consequent: [
              setLocal(
                "actionKind",
                call("parserActionKind", [local("action")]),
              ),
              setLocal(
                "actionPayload",
                call("parserActionPayload", [local("action")]),
              ),
              {
                kind: "if",
                condition: eq(local("actionKind"), u32(RUNTIME_ACTION_SHIFT)),
                consequent: [
                  ...conflictTraceStoreAction(),
                  {
                    kind: "if",
                    condition: lt(local("depth"), local("stateCapacity")),
                    consequent: [
                      setLocal(
                        "capacity",
                        call("runtimeVectorAppend", [
                          local("stackHandle"),
                          local("actionPayload"),
                        ]),
                      ),
                      setLocal("depth", add(local("depth"), u32(1))),
                      setLocal(
                        "streamIndex",
                        add(local("streamIndex"), u32(1)),
                      ),
                    ],
                    alternate: traceReturnStatements(TRACE_STATUS_INTERNAL),
                  },
                ],
                alternate: [{
                  kind: "if",
                  condition: eq(
                    local("actionKind"),
                    u32(RUNTIME_ACTION_REDUCE),
                  ),
                  consequent: [
                    setLocal("productionIndex", local("actionPayload")),
                    setLocal(
                      "lhs",
                      call("parserProductionLhs", [local("productionIndex")]),
                    ),
                    setLocal(
                      "rhsLength",
                      call("parserProductionRhsLength", [
                        local("productionIndex"),
                      ]),
                    ),
                    {
                      kind: "if",
                      condition: eq(
                        local("rhsLength"),
                        u32(RUNTIME_NO_PRODUCTION),
                      ),
                      consequent: traceReturnStatements(TRACE_STATUS_INTERNAL),
                      alternate: [
                        {
                          kind: "if",
                          condition: lt(
                            local("depth"),
                            add(local("rhsLength"), u32(1)),
                          ),
                          consequent: traceReturnStatements(
                            TRACE_STATUS_INTERNAL,
                          ),
                          alternate: [
                            setLocal(
                              "depth",
                              sub(local("depth"), local("rhsLength")),
                            ),
                            setLocal(
                              "capacity",
                              call("runtimeVectorTruncate", [
                                local("stackHandle"),
                                local("depth"),
                              ]),
                            ),
                            setLocal(
                              "state",
                              call("runtimeVectorLoad", [
                                local("stackHandle"),
                                sub(local("depth"), u32(1)),
                              ]),
                            ),
                            setLocal(
                              "gotoState",
                              call("parserGoto", [
                                local("state"),
                                local("lhs"),
                              ]),
                            ),
                            {
                              kind: "if",
                              condition: eq(
                                local("gotoState"),
                                u32(RUNTIME_NO_GOTO),
                              ),
                              consequent:
                                conflictRestoreBranchOrReturnUnexpected(),
                              alternate: [
                                ...conflictTraceStoreAction(),
                                {
                                  kind: "if",
                                  condition: lt(
                                    local("depth"),
                                    local("stateCapacity"),
                                  ),
                                  consequent: [
                                    setLocal(
                                      "capacity",
                                      call("runtimeVectorAppend", [
                                        local("stackHandle"),
                                        local("gotoState"),
                                      ]),
                                    ),
                                    setLocal(
                                      "depth",
                                      add(local("depth"), u32(1)),
                                    ),
                                  ],
                                  alternate: traceReturnStatements(
                                    TRACE_STATUS_INTERNAL,
                                  ),
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                  alternate: [{
                    kind: "if",
                    condition: eq(
                      local("actionKind"),
                      u32(RUNTIME_ACTION_ACCEPT),
                    ),
                    consequent: [
                      ...conflictTraceStoreAction(),
                      ...traceReturnStatements(TRACE_STATUS_OK),
                    ],
                    alternate: traceReturnStatements(TRACE_STATUS_INTERNAL),
                  }],
                }],
              },
            ],
          },
        ],
      },
      ...traceReturnStatements(TRACE_STATUS_INTERNAL),
    ],
  };
}

function parserTraceErrorStateFunction(): RuntimeLanguageFunction {
  return traceHeaderLoadFunction("parserTraceErrorState", TRACE_ERROR_STATE);
}

function parserTraceErrorIndexFunction(): RuntimeLanguageFunction {
  return traceHeaderLoadFunction("parserTraceErrorIndex", TRACE_ERROR_INDEX);
}

function parserTraceCountFunction(): RuntimeLanguageFunction {
  return traceHeaderLoadFunction("parserTraceCount", TRACE_COUNT);
}

function parserTraceActionFunction(
  storage: "scratch" | "vector",
): RuntimeLanguageFunction {
  const traceLocal = storage === "vector" ? "traceHandle" : "traceBase";
  return {
    name: "parserTraceAction",
    parameters: [
      { name: "index", type: "u32" },
    ],
    locals: [
      { name: traceLocal, type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal(traceLocal, loadScratch(u32(TRACE_BASE))),
      {
        kind: "return",
        expression: storage === "vector"
          ? call("runtimeVectorLoad", [local(traceLocal), local("index")])
          : loadScratch(add(local(traceLocal), local("index"))),
      },
    ],
  };
}

function parserExpectedStartFunction(
  rowCount: number,
): RuntimeLanguageFunction {
  return {
    name: "parserExpectedStart",
    parameters: [
      { name: "state", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: lt(local("state"), u32(rowCount)),
        consequent: [{
          kind: "return",
          expression: load("parserExpectedRows", local("state")),
        }],
      },
      { kind: "return", expression: u32(0) },
    ],
  };
}

function parserExpectedEndFunction(
  rowCount: number,
): RuntimeLanguageFunction {
  return {
    name: "parserExpectedEnd",
    parameters: [
      { name: "state", type: "u32" },
    ],
    locals: [
      { name: "index", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: lt(local("state"), u32(rowCount)),
        consequent: [
          setLocal("index", add(local("state"), u32(1))),
          {
            kind: "return",
            expression: load("parserExpectedRows", local("index")),
          },
        ],
      },
      { kind: "return", expression: u32(0) },
    ],
  };
}

function parserExpectedHasEofFunction(
  rowCount: number,
): RuntimeLanguageFunction {
  return {
    name: "parserExpectedHasEof",
    parameters: [
      { name: "state", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: lt(local("state"), u32(rowCount)),
        consequent: [{
          kind: "return",
          expression: load("parserExpectedFlags", local("state")),
        }],
      },
      { kind: "return", expression: u32(0) },
    ],
  };
}

function parserUnexpectedDiagnosticCodeFunction(): RuntimeLanguageFunction {
  return {
    name: "parserUnexpectedDiagnosticCode",
    parameters: [
      { name: "state", type: "u32" },
      { name: "isEof", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: and(
          call("parserExpectedHasEof", [local("state")]),
          eq(local("isEof"), u32(0)),
        ),
        consequent: [{
          kind: "return",
          expression: u32(PARSER_DIAGNOSTIC_CODE_PARSE_TRAILING_INPUT),
        }],
      },
      {
        kind: "return",
        expression: u32(PARSER_DIAGNOSTIC_CODE_PARSE_UNEXPECTED_TOKEN),
      },
    ],
  };
}

function parserMergeStartFunction(): RuntimeLanguageFunction {
  return {
    name: "parserMergeStart",
    parameters: [
      { name: "leftStart", type: "u32" },
      { name: "leftEnd", type: "u32" },
      { name: "rightStart", type: "u32" },
      { name: "rightEnd", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(local("leftStart"), u32(RUNTIME_NO_SPAN)),
        consequent: [
          { kind: "return", expression: local("rightStart") },
        ],
      },
      {
        kind: "if",
        condition: eq(local("rightStart"), u32(RUNTIME_NO_SPAN)),
        consequent: [
          { kind: "return", expression: local("leftStart") },
        ],
      },
      {
        kind: "if",
        condition: lt(local("leftStart"), local("rightStart")),
        consequent: [
          { kind: "return", expression: local("leftStart") },
        ],
      },
      { kind: "return", expression: local("rightStart") },
    ],
  };
}

function parserMergeEndFunction(): RuntimeLanguageFunction {
  return {
    name: "parserMergeEnd",
    parameters: [
      { name: "leftStart", type: "u32" },
      { name: "leftEnd", type: "u32" },
      { name: "rightStart", type: "u32" },
      { name: "rightEnd", type: "u32" },
    ],
    result: "u32",
    body: [
      {
        kind: "if",
        condition: eq(local("leftStart"), u32(RUNTIME_NO_SPAN)),
        consequent: [
          { kind: "return", expression: local("rightEnd") },
        ],
      },
      {
        kind: "if",
        condition: eq(local("rightStart"), u32(RUNTIME_NO_SPAN)),
        consequent: [
          { kind: "return", expression: local("leftEnd") },
        ],
      },
      {
        kind: "if",
        condition: lt(local("leftEnd"), local("rightEnd")),
        consequent: [
          { kind: "return", expression: local("rightEnd") },
        ],
      },
      { kind: "return", expression: local("leftEnd") },
    ],
  };
}

function traceHeaderLoadFunction(
  name: string,
  index: number,
): RuntimeLanguageFunction {
  return {
    name,
    result: "u32",
    body: [
      { kind: "return", expression: loadScratch(u32(index)) },
    ],
  };
}

function traceStoreActionStatements(): RuntimeStatement[] {
  return [
    setLocal(
      "capacity",
      call("runtimeVectorAppend", [
        local("traceHandle"),
        local("action"),
      ]),
    ),
    setLocal("traceCount", add(local("traceCount"), u32(1))),
  ];
}

function traceReturnStatements(status: number): RuntimeStatement[] {
  return [
    storeScratch(u32(TRACE_STATUS), u32(status)),
    storeScratch(u32(TRACE_ERROR_STATE), local("state")),
    storeScratch(u32(TRACE_ERROR_INDEX), local("streamIndex")),
    storeScratch(u32(TRACE_COUNT), local("traceCount")),
    { kind: "return", expression: u32(status) },
  ];
}

function conflictTraceStoreAction(): RuntimeStatement[] {
  return [{
    kind: "if",
    condition: lt(local("traceCount"), local("traceCapacity")),
    consequent: [
      setLocal(
        "capacity",
        call("runtimeVectorAppend", [
          local("traceHandle"),
          local("action"),
        ]),
      ),
      setLocal("traceCount", add(local("traceCount"), u32(1))),
    ],
    alternate: traceReturnStatements(TRACE_STATUS_INTERNAL),
  }];
}

function conflictSaveBranchFrame(): RuntimeStatement[] {
  return [
    {
      kind: "if",
      condition: lt(local("branchCount"), u32(TRACE_BRANCH_LIMIT)),
      consequent: [],
      alternate: traceReturnStatements(TRACE_STATUS_BRANCH_LIMIT),
    },
    setLocal(
      "capacity",
      call("runtimeVectorAppend", [
        local("branchActionHandle"),
        local("pendingAction"),
      ]),
    ),
    setLocal(
      "capacity",
      call("runtimeVectorAppend", [
        local("branchDepthHandle"),
        local("depth"),
      ]),
    ),
    setLocal(
      "capacity",
      call("runtimeVectorAppend", [
        local("branchStreamIndexHandle"),
        local("streamIndex"),
      ]),
    ),
    setLocal(
      "capacity",
      call("runtimeVectorAppend", [
        local("branchTraceCountHandle"),
        local("traceCount"),
      ]),
    ),
    setLocal(
      "capacity",
      call("runtimeVectorAppend", [
        local("branchStackHandle"),
        call("runtimeVectorClone", [local("stackHandle")]),
      ]),
    ),
    setLocal(
      "capacity",
      call("runtimeVectorAppend", [
        local("branchTraceHandle"),
        call("runtimeVectorClone", [local("traceHandle")]),
      ]),
    ),
    setLocal("branchCount", add(local("branchCount"), u32(1))),
  ];
}

function conflictRestoreBranchOrReturnUnexpected(): RuntimeStatement[] {
  return [
    ...conflictRecordBestFailure(),
    setLocal("actionReady", u32(0)),
    {
      kind: "if",
      condition: eq(local("branchCount"), u32(0)),
      consequent: [
        setLocal("state", local("bestState")),
        setLocal("streamIndex", local("bestIndex")),
        ...traceReturnStatements(TRACE_STATUS_UNEXPECTED),
      ],
      alternate: [
        setLocal("branchCount", sub(local("branchCount"), u32(1))),
        setLocal(
          "pendingAction",
          call("runtimeVectorLoad", [
            local("branchActionHandle"),
            local("branchCount"),
          ]),
        ),
        setLocal(
          "depth",
          call("runtimeVectorLoad", [
            local("branchDepthHandle"),
            local("branchCount"),
          ]),
        ),
        setLocal(
          "streamIndex",
          call("runtimeVectorLoad", [
            local("branchStreamIndexHandle"),
            local("branchCount"),
          ]),
        ),
        setLocal(
          "traceCount",
          call("runtimeVectorLoad", [
            local("branchTraceCountHandle"),
            local("branchCount"),
          ]),
        ),
        setLocal(
          "stackHandle",
          call("runtimeVectorLoad", [
            local("branchStackHandle"),
            local("branchCount"),
          ]),
        ),
        setLocal(
          "traceHandle",
          call("runtimeVectorLoad", [
            local("branchTraceHandle"),
            local("branchCount"),
          ]),
        ),
        storeScratch(u32(TRACE_BASE), local("traceHandle")),
        ...truncateBranchSnapshotVectors(),
        setLocal("exploredBranches", add(local("exploredBranches"), u32(1))),
        {
          kind: "if",
          condition: lt(u32(TRACE_BRANCH_LIMIT), local("exploredBranches")),
          consequent: [
            setLocal("state", local("bestState")),
            setLocal("streamIndex", local("bestIndex")),
            ...traceReturnStatements(TRACE_STATUS_BRANCH_LIMIT),
          ],
        },
        setLocal("hasPendingAction", u32(1)),
      ],
    },
  ];
}

function truncateBranchSnapshotVectors(): RuntimeStatement[] {
  return [
    setLocal(
      "capacity",
      call("runtimeVectorTruncate", [
        local("branchActionHandle"),
        local("branchCount"),
      ]),
    ),
    setLocal(
      "capacity",
      call("runtimeVectorTruncate", [
        local("branchDepthHandle"),
        local("branchCount"),
      ]),
    ),
    setLocal(
      "capacity",
      call("runtimeVectorTruncate", [
        local("branchStreamIndexHandle"),
        local("branchCount"),
      ]),
    ),
    setLocal(
      "capacity",
      call("runtimeVectorTruncate", [
        local("branchTraceCountHandle"),
        local("branchCount"),
      ]),
    ),
    setLocal(
      "capacity",
      call("runtimeVectorTruncate", [
        local("branchStackHandle"),
        local("branchCount"),
      ]),
    ),
    setLocal(
      "capacity",
      call("runtimeVectorTruncate", [
        local("branchTraceHandle"),
        local("branchCount"),
      ]),
    ),
  ];
}

function conflictRecordBestFailure(): RuntimeStatement[] {
  const update = [
    setLocal("bestIndex", local("streamIndex")),
    setLocal("bestState", local("state")),
  ];
  return [{
    kind: "if",
    condition: eq(local("bestIndex"), u32(0xffff_ffff)),
    consequent: update,
    alternate: [{
      kind: "if",
      condition: lt(local("bestIndex"), local("streamIndex")),
      consequent: update,
    }],
  }];
}

function setLocal(
  name: string,
  expression: RuntimeExpression,
): RuntimeStatement {
  return { kind: "setLocal", name, expression };
}

function u32(value: number): RuntimeExpression {
  return { kind: "u32", value };
}

function local(name: string): RuntimeExpression {
  return { kind: "local", name };
}

function load(table: string, index: RuntimeExpression): RuntimeExpression {
  return { kind: "loadTableU32", table, index };
}

function loadScratch(index: RuntimeExpression): RuntimeExpression {
  return { kind: "loadScratchU32", index };
}

function storeScratch(
  index: RuntimeExpression,
  value: RuntimeExpression,
): RuntimeStatement {
  return { kind: "storeScratchU32", index, value };
}

function ensureScratch(words: RuntimeExpression): RuntimeExpression {
  return { kind: "ensureScratchWords", words };
}

function call(
  functionName: string,
  args: readonly RuntimeExpression[],
): RuntimeExpression {
  return { kind: "call", function: functionName, args };
}

function add(
  left: RuntimeExpression,
  right: RuntimeExpression,
): RuntimeExpression {
  return { kind: "addU32", left, right };
}

function sub(
  left: RuntimeExpression,
  right: RuntimeExpression,
): RuntimeExpression {
  return { kind: "subU32", left, right };
}

function mul(
  left: RuntimeExpression,
  right: RuntimeExpression,
): RuntimeExpression {
  return { kind: "mulU32", left, right };
}

function and(
  left: RuntimeExpression,
  right: RuntimeExpression,
): RuntimeExpression {
  return { kind: "andU32", left, right };
}

function shr(
  left: RuntimeExpression,
  right: RuntimeExpression,
): RuntimeExpression {
  return { kind: "shrU32", left, right };
}

function lt(
  left: RuntimeExpression,
  right: RuntimeExpression,
): RuntimeExpression {
  return { kind: "ltS32", left, right };
}

function ltu(
  left: RuntimeExpression,
  right: RuntimeExpression,
): RuntimeExpression {
  return { kind: "ltU32", left, right };
}

function eq(
  left: RuntimeExpression,
  right: RuntimeExpression,
): RuntimeExpression {
  return { kind: "eqU32", left, right };
}
