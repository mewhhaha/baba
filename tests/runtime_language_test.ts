import {
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
import { UTF16_CODE_POINT_WIDTH_PROGRAM } from "../src/targets/runtime/language_sources.ts";
import { assertEquals } from "./helpers.ts";

Deno.test("runtime language TypeScript and Wasm backends agree", async () => {
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
