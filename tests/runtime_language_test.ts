import {
  compileRuntimeLanguageIr,
  compileRuntimeLanguageWasm,
  emitRuntimeLanguageTypeScript,
  emitRuntimeLanguageTypeScriptFunction,
  type RuntimeExpression,
  RuntimeLanguageProgram,
} from "../src/targets/runtime/language.ts";
import {
  hashRuntimeLanguageCompilerManifest,
  hashRuntimeLanguageCompilerSource,
  RUNTIME_LANGUAGE_COMPILER_METADATA,
} from "../src/targets/runtime/language_manifest.ts";
import {
  createLexerRuntimeProgram,
  createParserConflictTableRuntimeProgram,
  createParserGotoRuntimeProgram,
  createParserTableRuntimeProgram,
  createParserTraceRuntimeProgram,
  RUNTIME_ACTION_ACCEPT,
  RUNTIME_ACTION_REDUCE,
  RUNTIME_ACTION_SHIFT,
  RUNTIME_NO_GOTO,
  RUNTIME_NO_TRANSITION,
  UTF16_CODE_POINT_WIDTH_PROGRAM,
} from "../src/targets/runtime/language_sources.ts";
import { assertEquals } from "./helpers.ts";

Deno.test("runtime language TypeScript and Wasm backends agree", async () => {
  const lexerRuntimeProgram = createLexerRuntimeProgram({
    transitions: [
      [
        [0x80, 0x90, 2],
        [0x1f600, 0x1f600, 3],
      ],
      [],
    ],
    asciiTransitions: [
      asciiRow([[0x41, 1]]),
      asciiRow([]),
    ],
  });
  const rangeOnlyLexerRuntimeProgram = createLexerRuntimeProgram({
    transitions: [
      [
        [0x41, 0x41, 4],
      ],
    ],
    asciiTransitions: null,
  });
  const lexerScanBaseProgram = createLexerRuntimeProgram({
    transitions: [
      [
        [0x41, 0x41, 1],
      ],
      [
        [0x42, 0x42, 2],
      ],
      [],
    ],
    asciiTransitions: null,
    accepts: [-1, 5, 7],
  });
  const lexerScanRuntimeProgram: RuntimeLanguageProgram = {
    ...lexerScanBaseProgram,
    name: "lexer_scan_conformance",
    entry: "main",
    functions: [
      ...lexerScanBaseProgram.functions,
      {
        name: "main",
        locals: [
          { name: "result", type: "u32" },
        ],
        result: "u32",
        body: [
          setLocal("result", call("lexerScanReset", [])),
          setLocal("result", call("lexerScanAdvance", [u32(0x41)])),
          {
            kind: "if",
            condition: eq(local("result"), u32(1)),
            consequent: [
              setLocal("result", u32(10)),
            ],
          },
          setLocal("result", call("lexerScanAdvance", [u32(0x42)])),
          {
            kind: "if",
            condition: eq(local("result"), u32(1)),
            consequent: [
              setLocal("result", add(local("result"), u32(100))),
            ],
          },
          setLocal("result", call("lexerScanAdvance", [u32(0x43)])),
          {
            kind: "if",
            condition: eq(local("result"), u32(0)),
            consequent: [
              setLocal("result", add(local("result"), u32(1000))),
            ],
          },
          {
            kind: "return",
            expression: add(
              local("result"),
              add(
                mul(call("lexerScanBestSpec", []), u32(10)),
                call("lexerScanBestEnd", []),
              ),
            ),
          },
        ],
      },
    ],
  };
  const parserTableRuntimeProgram = createParserTableRuntimeProgram({
    actionRows: [
      [
        [1, RUNTIME_ACTION_SHIFT + 7],
        [3, RUNTIME_ACTION_REDUCE + 2],
        [5, RUNTIME_ACTION_ACCEPT],
      ],
      [],
    ],
    gotoRows: [
      [
        [8, 13],
      ],
      [],
    ],
  });
  const parserGotoRuntimeProgram = createParserGotoRuntimeProgram({
    gotoRows: [
      [
        [8, 13],
      ],
      [],
    ],
  });
  const parserConflictTableRuntimeProgram =
    createParserConflictTableRuntimeProgram({
      actionRows: [
        [
          [1, RUNTIME_ACTION_SHIFT + 7],
          [1, RUNTIME_ACTION_REDUCE + 2],
          [5, RUNTIME_ACTION_ACCEPT],
        ],
        [],
      ],
      gotoRows: [
        [
          [8, 13],
        ],
        [],
      ],
    });
  const parserTraceBaseProgram = createParserTraceRuntimeProgram({
    actionRows: [
      [[1, RUNTIME_ACTION_SHIFT + 1]],
      [[0, RUNTIME_ACTION_REDUCE + 1]],
      [[0, RUNTIME_ACTION_ACCEPT]],
      [[0, RUNTIME_ACTION_REDUCE + 2]],
    ],
    gotoRows: [
      [
        [1, 2],
        [2, 3],
      ],
      [],
      [],
      [],
    ],
    productions: [
      [0, 1],
      [2, 1],
      [1, 1],
    ],
  });
  const parserTraceRuntimeProgram: RuntimeLanguageProgram = {
    ...parserTraceBaseProgram,
    name: "parser_trace_conformance",
    entry: "main",
    functions: [
      ...parserTraceBaseProgram.functions,
      {
        name: "main",
        locals: [
          { name: "result", type: "u32" },
        ],
        result: "u32",
        body: [
          {
            kind: "setLocal",
            name: "result",
            expression: call("parserTraceSetTerminal", [u32(0), u32(1)]),
          },
          {
            kind: "setLocal",
            name: "result",
            expression: call("parserTraceSetTerminal", [u32(1), u32(0)]),
          },
          {
            kind: "setLocal",
            name: "result",
            expression: call("parserTrace", [u32(2)]),
          },
          {
            kind: "if",
            condition: local("result"),
            consequent: [
              { kind: "return", expression: local("result") },
            ],
          },
          {
            kind: "setLocal",
            name: "result",
            expression: call("parserTraceCount", []),
          },
          {
            kind: "if",
            condition: eq(
              call("parserTraceAction", [u32(0)]),
              u32(RUNTIME_ACTION_SHIFT + 1),
            ),
            consequent: [
              setLocal("result", add(local("result"), u32(10))),
            ],
          },
          {
            kind: "if",
            condition: eq(
              call("parserTraceAction", [u32(1)]),
              u32(RUNTIME_ACTION_REDUCE + 1),
            ),
            consequent: [
              setLocal("result", add(local("result"), u32(100))),
            ],
          },
          {
            kind: "if",
            condition: eq(
              call("parserTraceAction", [u32(2)]),
              u32(RUNTIME_ACTION_REDUCE + 2),
            ),
            consequent: [
              setLocal("result", add(local("result"), u32(1000))),
            ],
          },
          {
            kind: "if",
            condition: eq(
              call("parserTraceAction", [u32(3)]),
              u32(RUNTIME_ACTION_ACCEPT),
            ),
            consequent: [
              setLocal("result", add(local("result"), u32(10000))),
            ],
          },
          { kind: "return", expression: local("result") },
        ],
      },
    ],
  };
  const scratchStackProgram: RuntimeLanguageProgram = {
    name: "scratch_stack",
    entry: "main",
    scratchMemoryWords: 4,
    functions: [{
      name: "main",
      locals: [
        { name: "stackTop", type: "u32" },
        { name: "sum", type: "u32" },
      ],
      result: "u32",
      body: [
        storeScratch(local("stackTop"), u32(11)),
        {
          kind: "setLocal",
          name: "stackTop",
          expression: add(local("stackTop"), u32(1)),
        },
        storeScratch(local("stackTop"), u32(31)),
        {
          kind: "setLocal",
          name: "stackTop",
          expression: add(local("stackTop"), u32(1)),
        },
        {
          kind: "setLocal",
          name: "stackTop",
          expression: sub(local("stackTop"), u32(1)),
        },
        {
          kind: "setLocal",
          name: "sum",
          expression: loadScratch(local("stackTop")),
        },
        {
          kind: "setLocal",
          name: "stackTop",
          expression: sub(local("stackTop"), u32(1)),
        },
        {
          kind: "return",
          expression: add(local("sum"), loadScratch(local("stackTop"))),
        },
      ],
    }],
  };
  const scratchBoundsProgram: RuntimeLanguageProgram = {
    name: "scratch_bounds",
    entry: "main",
    scratchMemoryWords: 1,
    functions: [{
      name: "main",
      result: "u32",
      body: [
        storeScratch(u32(1), u32(99)),
        { kind: "return", expression: u32(0) },
      ],
    }],
  };
  const scratchLoadBoundsProgram: RuntimeLanguageProgram = {
    name: "scratch_load_bounds",
    entry: "main",
    scratchMemoryWords: 1,
    functions: [{
      name: "main",
      result: "u32",
      body: [
        { kind: "return", expression: loadScratch(u32(1)) },
      ],
    }],
  };
  const scratchGrowProgram: RuntimeLanguageProgram = {
    name: "scratch_grow",
    entry: "main",
    scratchMemoryWords: 0,
    functions: [{
      name: "main",
      locals: [
        { name: "capacity", type: "u32" },
      ],
      result: "u32",
      body: [
        {
          kind: "setLocal",
          name: "capacity",
          expression: ensureScratch(u32(4)),
        },
        storeScratch(u32(3), u32(55)),
        {
          kind: "return",
          expression: add(local("capacity"), loadScratch(u32(3))),
        },
      ],
    }],
  };
  const cases: readonly RuntimeConformanceCase[] = [
    {
      name: "u32 addition wraps",
      program: returning("u32_add_wraps", {
        kind: "addU32",
        left: u32(0xffff_ffff),
        right: u32(1),
      }),
      expected: { kind: "value", value: 0 },
    },
    {
      name: "u32 multiplication wraps",
      program: returning("u32_mul_wraps", {
        kind: "mulU32",
        left: u32(0x8000_0000),
        right: u32(2),
      }),
      expected: { kind: "value", value: 0 },
    },
    {
      name: "signed comparison uses i32 interpretation",
      program: returning("signed_less_than", {
        kind: "ltS32",
        left: u32(0xffff_ffff),
        right: u32(0),
      }),
      expected: { kind: "value", value: 1 },
    },
    {
      name: "shift counts are masked to five bits",
      program: returning("shift_masking", {
        kind: "shlU32",
        left: u32(1),
        right: u32(32),
      }),
      expected: { kind: "value", value: 1 },
    },
    {
      name: "unsigned right shift stays unsigned",
      program: returning("unsigned_shift", {
        kind: "shrU32",
        left: u32(0x8000_0000),
        right: u32(31),
      }),
      expected: { kind: "value", value: 1 },
    },
    {
      name: "parameters feed expressions",
      program: {
        name: "parameter_add",
        entry: "main",
        functions: [{
          name: "main",
          parameters: [{ name: "value", type: "u32" }],
          result: "u32",
          body: [{
            kind: "return",
            expression: {
              kind: "addU32",
              left: local("value"),
              right: u32(1),
            },
          }],
        }],
      },
      args: [41],
      expected: { kind: "value", value: 42 },
    },
    {
      name: "branches choose the matching block",
      program: {
        name: "branch",
        entry: "main",
        functions: [{
          name: "main",
          parameters: [{ name: "flag", type: "u32" }],
          result: "u32",
          body: [{
            kind: "if",
            condition: local("flag"),
            consequent: [{ kind: "return", expression: u32(11) }],
            alternate: [{ kind: "return", expression: u32(29) }],
          }],
        }],
      },
      args: [0],
      expected: { kind: "value", value: 29 },
    },
    {
      name: "locals mutate through loops",
      program: {
        name: "loop_sum",
        entry: "main",
        functions: [{
          name: "main",
          locals: [
            { name: "index", type: "u32" },
            { name: "sum", type: "u32" },
          ],
          result: "u32",
          body: [
            {
              kind: "while",
              condition: {
                kind: "ltS32",
                left: local("index"),
                right: u32(5),
              },
              body: [
                {
                  kind: "setLocal",
                  name: "sum",
                  expression: {
                    kind: "addU32",
                    left: local("sum"),
                    right: local("index"),
                  },
                },
                {
                  kind: "setLocal",
                  name: "index",
                  expression: {
                    kind: "addU32",
                    left: local("index"),
                    right: u32(1),
                  },
                },
              ],
            },
            { kind: "return", expression: local("sum") },
          ],
        }],
      },
      expected: { kind: "value", value: 10 },
    },
    {
      name: "scratch memory supports stack-like load and store",
      program: scratchStackProgram,
      expected: { kind: "value", value: 42 },
    },
    {
      name: "scratch memory stores trap out of bounds",
      program: scratchBoundsProgram,
      expected: { kind: "trap" },
    },
    {
      name: "scratch memory loads trap out of bounds",
      program: scratchLoadBoundsProgram,
      expected: { kind: "trap" },
    },
    {
      name: "scratch memory grows before stack access",
      program: scratchGrowProgram,
      expected: { kind: "value", value: 59 },
    },
    {
      name: "functions call other functions",
      program: {
        name: "function_calls",
        entry: "main",
        functions: [
          {
            name: "main",
            parameters: [{ name: "value", type: "u32" }],
            result: "u32",
            body: [{
              kind: "return",
              expression: {
                kind: "addU32",
                left: {
                  kind: "call",
                  function: "double",
                  args: [local("value")],
                },
                right: {
                  kind: "call",
                  function: "increment",
                  args: [local("value")],
                },
              },
            }],
          },
          {
            name: "double",
            parameters: [{ name: "input", type: "u32" }],
            result: "u32",
            body: [{
              kind: "return",
              expression: {
                kind: "addU32",
                left: local("input"),
                right: local("input"),
              },
            }],
          },
          {
            name: "increment",
            parameters: [{ name: "input", type: "u32" }],
            result: "u32",
            body: [{
              kind: "return",
              expression: {
                kind: "addU32",
                left: local("input"),
                right: u32(1),
              },
            }],
          },
        ],
      },
      args: [7],
      expected: { kind: "value", value: 22 },
    },
    {
      name: "read-only tables load u32 values",
      program: {
        name: "table_lookup",
        entry: "main",
        tables: [{
          name: "accepts",
          type: "u32",
          values: [3, 5, 8, 13],
        }],
        functions: [{
          name: "main",
          parameters: [{ name: "index", type: "u32" }],
          result: "u32",
          body: [{
            kind: "return",
            expression: {
              kind: "loadTableU32",
              table: "accepts",
              index: local("index"),
            },
          }],
        }],
      },
      args: [2],
      expected: { kind: "value", value: 8 },
    },
    {
      name: "read-only table bounds failures trap",
      program: {
        name: "table_oob",
        entry: "main",
        tables: [{
          name: "accepts",
          type: "u32",
          values: [3, 5],
        }],
        functions: [{
          name: "main",
          result: "u32",
          body: [{
            kind: "return",
            expression: {
              kind: "loadTableU32",
              table: "accepts",
              index: u32(2),
            },
          }],
        }],
      },
      expected: { kind: "trap" },
    },
    {
      name: "UTF-16 helper returns one code unit below the astral plane",
      program: UTF16_CODE_POINT_WIDTH_PROGRAM,
      args: [0xffff],
      expected: { kind: "value", value: 1 },
    },
    {
      name: "UTF-16 helper returns two code units for astral code points",
      program: UTF16_CODE_POINT_WIDTH_PROGRAM,
      args: [0x1f600],
      expected: { kind: "value", value: 2 },
    },
    {
      name: "DFA transition uses ASCII fast table hits",
      program: lexerRuntimeProgram,
      args: [0, 0x41],
      expected: { kind: "value", value: 1 },
    },
    {
      name: "DFA transition reports ASCII fast table misses",
      program: lexerRuntimeProgram,
      args: [0, 0x42],
      expected: { kind: "value", value: RUNTIME_NO_TRANSITION },
    },
    {
      name: "DFA transition finds non-ASCII range hits",
      program: lexerRuntimeProgram,
      args: [0, 0x85],
      expected: { kind: "value", value: 2 },
    },
    {
      name: "DFA transition finds non-BMP range hits",
      program: lexerRuntimeProgram,
      args: [0, 0x1f600],
      expected: { kind: "value", value: 3 },
    },
    {
      name: "DFA transition reports range misses",
      program: lexerRuntimeProgram,
      args: [0, 0x91],
      expected: { kind: "value", value: RUNTIME_NO_TRANSITION },
    },
    {
      name: "DFA transition supports range-only ASCII code points",
      program: rangeOnlyLexerRuntimeProgram,
      args: [0, 0x41],
      expected: { kind: "value", value: 4 },
    },
    {
      name: "lexer scan helper tracks longest accepting candidate",
      program: lexerScanRuntimeProgram,
      expected: { kind: "value", value: 1072 },
    },
    {
      name: "parser table lookup finds shift actions",
      program: parserTableRuntimeProgram,
      args: [0, 1],
      expected: { kind: "value", value: RUNTIME_ACTION_SHIFT + 7 },
    },
    {
      name: "parser table lookup finds reduce actions",
      program: parserTableRuntimeProgram,
      args: [0, 3],
      expected: { kind: "value", value: RUNTIME_ACTION_REDUCE + 2 },
    },
    {
      name: "parser table lookup finds accept actions",
      program: parserTableRuntimeProgram,
      args: [0, 5],
      expected: { kind: "value", value: RUNTIME_ACTION_ACCEPT },
    },
    {
      name: "parser table lookup reports missing actions",
      program: parserTableRuntimeProgram,
      args: [0, 4],
      expected: { kind: "value", value: 0 },
    },
    {
      name: "parser conflict lookup finds first action",
      program: parserConflictTableRuntimeProgram,
      args: [0, 1, 0],
      expected: { kind: "value", value: RUNTIME_ACTION_SHIFT + 7 },
    },
    {
      name: "parser conflict lookup finds second action",
      program: parserConflictTableRuntimeProgram,
      args: [0, 1, 1],
      expected: { kind: "value", value: RUNTIME_ACTION_REDUCE + 2 },
    },
    {
      name: "parser conflict lookup reports exhausted actions",
      program: parserConflictTableRuntimeProgram,
      args: [0, 1, 2],
      expected: { kind: "value", value: 0 },
    },
    {
      name: "parser conflict lookup reports missing terminals",
      program: parserConflictTableRuntimeProgram,
      args: [0, 3, 0],
      expected: { kind: "value", value: 0 },
    },
    {
      name: "parser goto lookup finds target states",
      program: parserGotoRuntimeProgram,
      args: [0, 8],
      expected: { kind: "value", value: 13 },
    },
    {
      name: "parser goto lookup reports missing entries",
      program: parserGotoRuntimeProgram,
      args: [0, 9],
      expected: { kind: "value", value: RUNTIME_NO_GOTO },
    },
    {
      name: "parser trace runtime emits deterministic action traces",
      program: parserTraceRuntimeProgram,
      expected: { kind: "value", value: 11114 },
    },
    {
      name: "early return skips later traps",
      program: {
        name: "early_return",
        entry: "main",
        functions: [{
          name: "main",
          result: "u32",
          body: [
            { kind: "return", expression: u32(7) },
            { kind: "trap" },
          ],
        }],
      },
      expected: { kind: "value", value: 7 },
    },
    {
      name: "division by zero traps",
      program: returning("division_by_zero", {
        kind: "divU32",
        left: u32(1),
        right: u32(0),
      }),
      expected: { kind: "trap" },
    },
  ];

  for (const testCase of cases) {
    const [typescript, wasm] = await Promise.all([
      runTypeScript(testCase.program, testCase.args),
      runWasm(testCase.program, testCase.args),
    ]);
    assertEquals(
      JSON.stringify(typescript),
      JSON.stringify(testCase.expected),
      `${testCase.name} TypeScript result`,
    );
    assertEquals(
      JSON.stringify(wasm),
      JSON.stringify(testCase.expected),
      `${testCase.name} Wasm result`,
    );
  }
});

Deno.test("runtime language can emit standalone TypeScript helper functions", () => {
  const source = emitRuntimeLanguageTypeScriptFunction(
    UTF16_CODE_POINT_WIDTH_PROGRAM,
  );
  assertEquals(source.includes("function utf16CodePointWidth"), true);
  assertEquals(source.includes("runtimeLanguageVersion"), false);
});

Deno.test("runtime language lowers to a resolved IR", () => {
  const program: RuntimeLanguageProgram = {
    name: "ir_fixture",
    entry: "main",
    scratchMemoryWords: 2,
    tables: [{
      name: "values",
      type: "u32",
      values: [1, 2],
    }],
    functions: [{
      name: "main",
      parameters: [{ name: "slot", type: "u32" }],
      result: "u32",
      body: [{
        kind: "return",
        expression: {
          kind: "loadTableU32",
          table: "values",
          index: local("slot"),
        },
      }],
    }],
  };

  const ir = compileRuntimeLanguageIr(program);

  assertEquals(ir.source, program);
  assertEquals(ir.name, "ir_fixture");
  assertEquals(ir.entry, "main");
  assertEquals(ir.entryFunction.name, "main");
  assertEquals(ir.functions.length, 1);
  assertEquals(ir.functionMap.get("main")?.name, "main");
  assertEquals(ir.tables.length, 1);
  assertEquals(ir.tableMap.get("values")?.values[1], 2);
  assertEquals(ir.hasScratchMemory, true);
  assertEquals(ir.scratchMemoryWords, 2);

  const fn = ir.functions[0];
  if (!fn) throw new Error("Expected lowered function.");
  assertEquals(fn.source, program.functions[0]);
  assertEquals(fn.body.length, 1);
  const statement = fn.body[0];
  if (statement?.kind !== "return") {
    throw new Error("Expected lowered return statement.");
  }
  const expression = statement.expression;
  if (expression.kind !== "loadTableU32") {
    throw new Error("Expected lowered table load.");
  }
  assertEquals(expression.tableName, "values");
  assertEquals(expression.tableIndex, 0);
  assertEquals(expression.table.values[1], 2);
  if (expression.index.kind !== "local") {
    throw new Error("Expected lowered local table index.");
  }
  assertEquals(expression.index.variable.name, "slot");
  assertEquals(expression.index.localIndex, 0);
});

Deno.test("runtime language compiler manifest is current", async () => {
  const sources = [];
  for (const source of RUNTIME_LANGUAGE_COMPILER_METADATA.sources) {
    const content = await Deno.readTextFile(source.path);
    sources.push({
      ...source,
      hash: hashRuntimeLanguageCompilerSource(content),
    });
  }

  assertEquals(
    JSON.stringify(sources),
    JSON.stringify(RUNTIME_LANGUAGE_COMPILER_METADATA.sources),
  );
  assertEquals(
    hashRuntimeLanguageCompilerManifest(sources),
    RUNTIME_LANGUAGE_COMPILER_METADATA.hash,
  );
});

interface RuntimeConformanceCase {
  readonly name: string;
  readonly program: RuntimeLanguageProgram;
  readonly args?: readonly number[];
  readonly expected: RuntimeResult;
}

type RuntimeResult =
  | { readonly kind: "value"; readonly value: number }
  | { readonly kind: "trap" };

function returning(
  name: string,
  expression: RuntimeExpression,
): RuntimeLanguageProgram {
  return {
    name,
    entry: "main",
    functions: [{
      name: "main",
      result: "u32",
      body: [{ kind: "return", expression }],
    }],
  };
}

function u32(value: number) {
  return { kind: "u32" as const, value };
}

function local(name: string) {
  return { kind: "local" as const, name };
}

function setLocal(name: string, expression: RuntimeExpression) {
  return { kind: "setLocal" as const, name, expression };
}

function call(functionName: string, args: readonly RuntimeExpression[]) {
  return { kind: "call" as const, function: functionName, args };
}

function loadScratch(index: RuntimeExpression) {
  return { kind: "loadScratchU32" as const, index };
}

function storeScratch(index: RuntimeExpression, value: RuntimeExpression) {
  return { kind: "storeScratchU32" as const, index, value };
}

function ensureScratch(words: RuntimeExpression) {
  return { kind: "ensureScratchWords" as const, words };
}

function add(left: RuntimeExpression, right: RuntimeExpression) {
  return { kind: "addU32" as const, left, right };
}

function mul(left: RuntimeExpression, right: RuntimeExpression) {
  return { kind: "mulU32" as const, left, right };
}

function sub(left: RuntimeExpression, right: RuntimeExpression) {
  return { kind: "subU32" as const, left, right };
}

function eq(left: RuntimeExpression, right: RuntimeExpression) {
  return { kind: "eqU32" as const, left, right };
}

function asciiRow(
  entries: readonly (readonly [codePoint: number, target: number])[],
): number[] {
  const row = Array.from({ length: 128 }, () => -1);
  for (const [codePoint, target] of entries) row[codePoint] = target;
  return row;
}

async function runTypeScript(
  program: RuntimeLanguageProgram,
  args: readonly number[] = [],
): Promise<RuntimeResult> {
  const directory = await Deno.makeTempDir();
  try {
    const path = `${directory}/runtime_language.ts`;
    await Deno.writeTextFile(path, emitRuntimeLanguageTypeScript(program));
    const module = await import(`file://${path}?${crypto.randomUUID()}`) as {
      [key: string]: ((...args: readonly number[]) => number) | unknown;
    };
    const entry = module[program.entry] as
      | ((...args: readonly number[]) => number)
      | undefined;
    if (!entry) throw new Error(`Missing entry ${program.entry}.`);
    return { kind: "value", value: entry(...args) >>> 0 };
  } catch {
    return { kind: "trap" };
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

async function runWasm(
  program: RuntimeLanguageProgram,
  args: readonly number[] = [],
): Promise<RuntimeResult> {
  const bytes = compileRuntimeLanguageWasm(program);
  const instantiated = await WebAssembly.instantiate(bytes, {}) as
    | WebAssembly.Instance
    | WebAssembly.WebAssemblyInstantiatedSource;
  const instance = "instance" in instantiated
    ? instantiated.instance
    : instantiated;
  const entry = instance.exports[program.entry] as
    | ((...args: readonly number[]) => number)
    | undefined;
  try {
    if (!entry) throw new Error(`Missing entry ${program.entry}.`);
    return { kind: "value", value: entry(...args) >>> 0 };
  } catch {
    return { kind: "trap" };
  }
}
