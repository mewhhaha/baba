import type {
  RuntimeExpression,
  RuntimeLanguageFunction,
  RuntimeLanguageProgram,
  RuntimeLanguageTable,
  RuntimeStatement,
} from "./language.ts";

export const RUNTIME_NO_TRANSITION = 0xffff_ffff;
export const RUNTIME_ACTION_NONE = 0;
export const RUNTIME_ACTION_SHIFT = 0x01_00_00_00;
export const RUNTIME_ACTION_REDUCE = 0x02_00_00_00;
export const RUNTIME_ACTION_ACCEPT = 0x03_00_00_00;
export const RUNTIME_ACTION_KIND_MASK = 0xff_00_00_00;
export const RUNTIME_ACTION_PAYLOAD_MASK = 0x00_ff_ff_ff;
export const RUNTIME_NO_GOTO = 0xffff_ffff;

export type LexerRuntimeTransition = readonly [
  start: number,
  end: number,
  target: number,
];

export interface LexerRuntimeProgramInput {
  readonly transitions: readonly (readonly LexerRuntimeTransition[])[];
  readonly asciiTransitions: readonly (readonly number[])[] | null;
}

export type ParserRuntimeLookupEntry = readonly [key: number, value: number];

export interface ParserTableRuntimeProgramInput {
  readonly actionRows: readonly (readonly ParserRuntimeLookupEntry[])[];
  readonly gotoRows: readonly (readonly ParserRuntimeLookupEntry[])[];
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

  return {
    name: "lexer_runtime",
    entry: "dfaTransition",
    tables,
    functions: [
      UTF16_CODE_POINT_WIDTH_FUNCTION,
      dfaTransitionFunction(input.asciiTransitions !== null),
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

function add(
  left: RuntimeExpression,
  right: RuntimeExpression,
): RuntimeExpression {
  return { kind: "addU32", left, right };
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
