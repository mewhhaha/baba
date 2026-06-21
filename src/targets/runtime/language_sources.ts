import type {
  RuntimeExpression,
  RuntimeLanguageFunction,
  RuntimeLanguageProgram,
  RuntimeLanguageTable,
  RuntimeStatement,
} from "./language.ts";

export const RUNTIME_NO_TRANSITION = 0xffff_ffff;
export const RUNTIME_NO_ACCEPT = RUNTIME_NO_TRANSITION;
export const RUNTIME_ACTION_NONE = 0;
export const RUNTIME_ACTION_SHIFT = 0x01_00_00_00;
export const RUNTIME_ACTION_REDUCE = 0x02_00_00_00;
export const RUNTIME_ACTION_ACCEPT = 0x03_00_00_00;
export const RUNTIME_ACTION_KIND_MASK = 0xff_00_00_00;
export const RUNTIME_ACTION_PAYLOAD_MASK = 0x00_ff_ff_ff;
export const RUNTIME_NO_GOTO = 0xffff_ffff;

const TRACE_STATUS = 0;
const TRACE_ERROR_STATE = 1;
const TRACE_ERROR_INDEX = 2;
const TRACE_COUNT = 3;
const TRACE_BASE = 4;
const TRACE_TERMINALS_BASE = 8;
const TRACE_STATUS_OK = 0;
const TRACE_STATUS_UNEXPECTED = 1;
const TRACE_STATUS_INTERNAL = 2;

const LEXER_SCAN_STATE = 0;
const LEXER_SCAN_LENGTH = 1;
const LEXER_SCAN_BEST_SPEC = 2;
const LEXER_SCAN_BEST_END = 3;
const LEXER_SCAN_DONE = 4;

export type LexerRuntimeTransition = readonly [
  start: number,
  end: number,
  target: number,
];

export interface LexerRuntimeProgramInput {
  readonly transitions: readonly (readonly LexerRuntimeTransition[])[];
  readonly asciiTransitions: readonly (readonly number[])[] | null;
  readonly accepts?: readonly number[];
}

export type ParserRuntimeLookupEntry = readonly [key: number, value: number];
export type ParserRuntimeProductionEntry = readonly [
  lhs: number,
  rhsLength: number,
];

export interface ParserTableRuntimeProgramInput {
  readonly actionRows: readonly (readonly ParserRuntimeLookupEntry[])[];
  readonly gotoRows: readonly (readonly ParserRuntimeLookupEntry[])[];
}

export interface ParserTraceRuntimeProgramInput
  extends ParserTableRuntimeProgramInput {
  readonly productions: readonly ParserRuntimeProductionEntry[];
}

export type ParserConflictTableRuntimeProgramInput =
  ParserTableRuntimeProgramInput;

export interface ParserGotoRuntimeProgramInput {
  readonly gotoRows: readonly (readonly ParserRuntimeLookupEntry[])[];
}

export interface ParserExpectedRuntimeProgramInput {
  readonly rowLengths: readonly number[];
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

export const UTF16_CODE_POINT_WIDTH_PROGRAM: RuntimeLanguageProgram = {
  name: "utf16_code_point_width",
  entry: "utf16CodePointWidth",
  functions: [UTF16_CODE_POINT_WIDTH_FUNCTION],
};

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

  const tables = [
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

  return {
    name: "lexer_runtime",
    entry: "dfaTransition",
    scratchMemoryWords: input.accepts ? 5 : undefined,
    tables,
    functions: [
      UTF16_CODE_POINT_WIDTH_FUNCTION,
      dfaTransitionFunction(input.asciiTransitions !== null),
      ...(input.accepts
        ? [
          lexerScanResetFunction(),
          lexerScanAdvanceFunction(),
          lexerScanBestSpecFunction(),
          lexerScanBestEndFunction(),
        ]
        : []),
    ],
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
      {
        name: "parserProductions",
        type: "u32",
        values: input.productions.flatMap(([lhs, rhsLength]) => [
          lhs,
          rhsLength,
        ]),
      },
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
      parserTraceSetTerminalFunction(),
      parserTraceFunction(input.productions.length),
      parserTraceErrorStateFunction(),
      parserTraceErrorIndexFunction(),
      parserTraceCountFunction(),
      parserTraceActionFunction(),
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
    ],
    functions: [
      tableLookupAtFunction(
        "parserActionAt",
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
    tables: [{
      name: "parserExpectedRows",
      type: "u32",
      values: rows,
    }],
    functions: [
      parserExpectedStartFunction(input.rowLengths.length),
      parserExpectedEndFunction(input.rowLengths.length),
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
      { name: "stackBase", type: "u32" },
      { name: "stackCapacity", type: "u32" },
      { name: "traceBase", type: "u32" },
      { name: "depth", type: "u32" },
      { name: "streamIndex", type: "u32" },
      { name: "traceCount", type: "u32" },
      { name: "loop", type: "u32" },
      { name: "state", type: "u32" },
      { name: "terminal", type: "u32" },
      { name: "action", type: "u32" },
      { name: "productionIndex", type: "u32" },
      { name: "productionOffset", type: "u32" },
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
        "stackBase",
        add(u32(TRACE_TERMINALS_BASE), local("terminalCount")),
      ),
      setLocal(
        "stackCapacity",
        add(add(local("terminalCount"), u32(productionCount)), u32(16)),
      ),
      setLocal("traceBase", add(local("stackBase"), local("stackCapacity"))),
      setLocal("capacity", ensureScratch(add(local("traceBase"), u32(1)))),
      storeScratch(u32(TRACE_STATUS), u32(TRACE_STATUS_OK)),
      storeScratch(u32(TRACE_ERROR_STATE), u32(0)),
      storeScratch(u32(TRACE_ERROR_INDEX), u32(0)),
      storeScratch(u32(TRACE_COUNT), u32(0)),
      storeScratch(u32(TRACE_BASE), local("traceBase")),
      storeScratch(local("stackBase"), u32(0)),
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
            loadScratch(add(local("stackBase"), sub(local("depth"), u32(1)))),
          ),
          setLocal(
            "terminal",
            loadScratch(add(u32(TRACE_TERMINALS_BASE), local("streamIndex"))),
          ),
          setLocal(
            "action",
            call("parserAction", [local("state"), local("terminal")]),
          ),
          {
            kind: "if",
            condition: eq(local("action"), u32(RUNTIME_ACTION_NONE)),
            consequent: traceReturnStatements(TRACE_STATUS_UNEXPECTED),
          },
          {
            kind: "if",
            condition: lt(local("action"), u32(RUNTIME_ACTION_REDUCE)),
            consequent: [
              ...traceStoreActionStatements(),
              setLocal(
                "gotoState",
                sub(local("action"), u32(RUNTIME_ACTION_SHIFT)),
              ),
              {
                kind: "if",
                condition: lt(local("depth"), local("stackCapacity")),
                consequent: [],
                alternate: traceReturnStatements(TRACE_STATUS_INTERNAL),
              },
              setLocal(
                "capacity",
                ensureScratch(
                  add(add(local("stackBase"), local("depth")), u32(1)),
                ),
              ),
              storeScratch(
                add(local("stackBase"), local("depth")),
                local("gotoState"),
              ),
              setLocal("depth", add(local("depth"), u32(1))),
              setLocal("streamIndex", add(local("streamIndex"), u32(1))),
            ],
            alternate: [{
              kind: "if",
              condition: lt(local("action"), u32(RUNTIME_ACTION_ACCEPT)),
              consequent: [
                setLocal(
                  "productionIndex",
                  sub(local("action"), u32(RUNTIME_ACTION_REDUCE)),
                ),
                setLocal(
                  "productionOffset",
                  mul(local("productionIndex"), u32(2)),
                ),
                setLocal(
                  "lhs",
                  load("parserProductions", local("productionOffset")),
                ),
                setLocal(
                  "productionOffset",
                  add(local("productionOffset"), u32(1)),
                ),
                setLocal(
                  "rhsLength",
                  load("parserProductions", local("productionOffset")),
                ),
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
                  "state",
                  loadScratch(
                    add(local("stackBase"), sub(local("depth"), u32(1))),
                  ),
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
                      ensureScratch(
                        add(add(local("stackBase"), local("depth")), u32(1)),
                      ),
                    ),
                    storeScratch(
                      add(local("stackBase"), local("depth")),
                      local("gotoState"),
                    ),
                    setLocal("depth", add(local("depth"), u32(1))),
                  ],
                },
              ],
              alternate: [{
                kind: "if",
                condition: eq(local("action"), u32(RUNTIME_ACTION_ACCEPT)),
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

function parserTraceErrorStateFunction(): RuntimeLanguageFunction {
  return traceHeaderLoadFunction("parserTraceErrorState", TRACE_ERROR_STATE);
}

function parserTraceErrorIndexFunction(): RuntimeLanguageFunction {
  return traceHeaderLoadFunction("parserTraceErrorIndex", TRACE_ERROR_INDEX);
}

function parserTraceCountFunction(): RuntimeLanguageFunction {
  return traceHeaderLoadFunction("parserTraceCount", TRACE_COUNT);
}

function parserTraceActionFunction(): RuntimeLanguageFunction {
  return {
    name: "parserTraceAction",
    parameters: [
      { name: "index", type: "u32" },
    ],
    locals: [
      { name: "traceBase", type: "u32" },
    ],
    result: "u32",
    body: [
      setLocal("traceBase", loadScratch(u32(TRACE_BASE))),
      {
        kind: "return",
        expression: loadScratch(add(local("traceBase"), local("index"))),
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
      ensureScratch(add(add(local("traceBase"), local("traceCount")), u32(1))),
    ),
    storeScratch(
      add(local("traceBase"), local("traceCount")),
      local("action"),
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

function eq(
  left: RuntimeExpression,
  right: RuntimeExpression,
): RuntimeExpression {
  return { kind: "eqU32", left, right };
}
