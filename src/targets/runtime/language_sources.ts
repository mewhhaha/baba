import type {
  RuntimeExpression,
  RuntimeLanguageFunction,
  RuntimeLanguageProgram,
  RuntimeStatement,
} from "./language.ts";

export const RUNTIME_NO_TRANSITION = 0xffff_ffff;

export type LexerRuntimeTransition = readonly [
  start: number,
  end: number,
  target: number,
];

export interface LexerRuntimeProgramInput {
  readonly transitions: readonly (readonly LexerRuntimeTransition[])[];
  readonly asciiTransitions: readonly (readonly number[])[] | null;
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
