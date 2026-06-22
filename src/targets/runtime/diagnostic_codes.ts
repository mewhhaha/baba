export const PARSER_DIAGNOSTIC_CODE_PARSE_LEXICAL_ERROR = 1;
export const PARSER_DIAGNOSTIC_CODE_PARSE_UNEXPECTED_TOKEN = 2;
export const PARSER_DIAGNOSTIC_CODE_PARSE_TRAILING_INPUT = 3;
export const PARSER_DIAGNOSTIC_CODE_PARSE_INVALID_TOKEN_STREAM = 4;
export const PARSER_DIAGNOSTIC_CODE_INTERNAL_ERROR = 5;
export const PARSER_DIAGNOSTIC_CODE_BRANCH_LIMIT = 6;

export const PARSER_DIAGNOSTIC_CODES = {
  parseLexicalError: PARSER_DIAGNOSTIC_CODE_PARSE_LEXICAL_ERROR,
  parseUnexpectedToken: PARSER_DIAGNOSTIC_CODE_PARSE_UNEXPECTED_TOKEN,
  parseTrailingInput: PARSER_DIAGNOSTIC_CODE_PARSE_TRAILING_INPUT,
  parseInvalidTokenStream: PARSER_DIAGNOSTIC_CODE_PARSE_INVALID_TOKEN_STREAM,
  internalError: PARSER_DIAGNOSTIC_CODE_INTERNAL_ERROR,
  branchLimit: PARSER_DIAGNOSTIC_CODE_BRANCH_LIMIT,
} as const;

export const PARSER_DIAGNOSTIC_DETAIL_NONE = 0;
export const PARSER_DIAGNOSTIC_DETAIL_PARSER_STATE = 1;

export const PARSER_DIAGNOSTIC_DETAIL_KINDS = {
  none: PARSER_DIAGNOSTIC_DETAIL_NONE,
  parserState: PARSER_DIAGNOSTIC_DETAIL_PARSER_STATE,
} as const;

export const PARSER_DIAGNOSTIC_SCHEMAS = [
  {
    name: "parseLexicalError",
    publicCode: "PARSE_LEXICAL_ERROR",
    runtimeCode: PARSER_DIAGNOSTIC_CODE_PARSE_LEXICAL_ERROR,
    detailKind: "none",
    detailKindId: PARSER_DIAGNOSTIC_DETAIL_NONE,
    payloadFields: ["found"],
  },
  {
    name: "parseUnexpectedToken",
    publicCode: "PARSE_UNEXPECTED_TOKEN",
    runtimeCode: PARSER_DIAGNOSTIC_CODE_PARSE_UNEXPECTED_TOKEN,
    detailKind: "parser-state",
    detailKindId: PARSER_DIAGNOSTIC_DETAIL_PARSER_STATE,
    payloadFields: ["expected", "found"],
  },
  {
    name: "parseTrailingInput",
    publicCode: "PARSE_TRAILING_INPUT",
    runtimeCode: PARSER_DIAGNOSTIC_CODE_PARSE_TRAILING_INPUT,
    detailKind: "parser-state",
    detailKindId: PARSER_DIAGNOSTIC_DETAIL_PARSER_STATE,
    payloadFields: ["expected", "found"],
  },
  {
    name: "parseInvalidTokenStream",
    publicCode: "PARSE_INVALID_TOKEN_STREAM",
    runtimeCode: PARSER_DIAGNOSTIC_CODE_PARSE_INVALID_TOKEN_STREAM,
    detailKind: "none",
    detailKindId: PARSER_DIAGNOSTIC_DETAIL_NONE,
    payloadFields: [],
  },
  {
    name: "internalError",
    publicCode: "PARSER_INTERNAL_ERROR",
    runtimeCode: PARSER_DIAGNOSTIC_CODE_INTERNAL_ERROR,
    detailKind: "none",
    detailKindId: PARSER_DIAGNOSTIC_DETAIL_NONE,
    payloadFields: [],
  },
  {
    name: "branchLimit",
    publicCode: "PARSER_BRANCH_LIMIT",
    runtimeCode: PARSER_DIAGNOSTIC_CODE_BRANCH_LIMIT,
    detailKind: "none",
    detailKindId: PARSER_DIAGNOSTIC_DETAIL_NONE,
    payloadFields: [],
  },
] as const;
