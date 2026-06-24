import {
  compileRuntimeLanguageWasm,
  emitRuntimeLanguageTypeScript,
  type RuntimeExpression,
  type RuntimeLanguageProgram,
} from "../src/targets/runtime/language.ts";
import { assertEquals } from "./helpers.ts";

Deno.test("BRL TypeScript and Wasm conformance cases agree", async () => {
  const cases: readonly RuntimeConformanceCase[] = [
    {
      name: "return values and integer wrapping",
      program: returning("integer_wrapping", add(u32(0xffff_ffff), u32(3))),
      expected: { kind: "value", value: 2 },
    },
    {
      name: "function calls evaluate left-to-right",
      program: {
        name: "evaluation_order",
        entry: "main",
        scratchMemoryWords: 3,
        functions: [
          {
            name: "mark",
            parameters: [{ name: "value", type: "u32" }],
            result: "u32",
            body: [
              storeScratch(u32(0), add(loadScratch(u32(0)), u32(1))),
              storeScratch(
                loadScratch(u32(0)),
                local("value"),
              ),
              { kind: "return", expression: local("value") },
            ],
          },
          {
            name: "main",
            result: "u32",
            body: [
              {
                kind: "return",
                expression: add(
                  call("mark", [u32(10)]),
                  add(
                    mul(call("mark", [u32(20)]), u32(10)),
                    add(
                      mul(loadScratch(u32(1)), u32(100)),
                      mul(loadScratch(u32(2)), u32(1000)),
                    ),
                  ),
                ),
              },
            ],
          },
        ],
      },
      expected: { kind: "value", value: 21_210 },
    },
    {
      name: "scratch memory stores and loads are visible",
      program: {
        name: "scratch_memory",
        entry: "main",
        scratchMemoryWords: 4,
        functions: [{
          name: "main",
          result: "u32",
          body: [
            storeScratch(u32(0), u32(13)),
            storeScratch(u32(1), u32(29)),
            {
              kind: "return",
              expression: add(loadScratch(u32(0)), loadScratch(u32(1))),
            },
          ],
        }],
      },
      expected: { kind: "value", value: 42 },
    },
    {
      name: "scratch memory load traps out of bounds",
      program: {
        name: "scratch_oob",
        entry: "main",
        scratchMemoryWords: 1,
        functions: [{
          name: "main",
          result: "u32",
          body: [{ kind: "return", expression: loadScratch(u32(1)) }],
        }],
      },
      expected: { kind: "trap" },
    },
    {
      name: "table loads expose memory-visible array data",
      program: {
        name: "table_memory",
        entry: "main",
        tables: [{ name: "values", type: "u32", values: [5, 8, 13] }],
        functions: [{
          name: "main",
          parameters: [{ name: "index", type: "u32" }],
          result: "u32",
          body: [{
            kind: "return",
            expression: {
              kind: "loadTableU32",
              table: "values",
              index: local("index"),
            },
          }],
        }],
      },
      args: [2],
      expected: { kind: "value", value: 13 },
    },
    {
      name: "table load traps out of bounds",
      program: {
        name: "table_oob_conformance",
        entry: "main",
        tables: [{ name: "values", type: "u32", values: [1] }],
        functions: [{
          name: "main",
          result: "u32",
          body: [{
            kind: "return",
            expression: {
              kind: "loadTableU32",
              table: "values",
              index: u32(1),
            },
          }],
        }],
      },
      expected: { kind: "trap" },
    },
    {
      name: "text records expose UTF-16 length and code units",
      program: {
        name: "text_record",
        entry: "main",
        texts: [{ name: "label", value: "A😀" }],
        functions: [{
          name: "main",
          result: "u32",
          body: [{
            kind: "return",
            expression: add(
              { kind: "textLength", text: text("label") },
              {
                kind: "textCodeUnitAt",
                text: text("label"),
                index: u32(1),
              },
            ),
          }],
        }],
      },
      expected: { kind: "value", value: 55_360 },
    },
    {
      name: "division by zero traps",
      program: returning("division_by_zero_conformance", {
        kind: "divU32",
        left: u32(1),
        right: u32(0),
      }),
      expected: { kind: "trap" },
    },
    {
      name: "early return skips later traps",
      program: {
        name: "early_return_conformance",
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
    assertEquals(
      JSON.stringify(typescript),
      JSON.stringify(wasm),
      `${testCase.name} TypeScript/Wasm parity`,
    );
  }
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
  try {
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
    if (!entry) throw new Error(`Missing entry ${program.entry}.`);
    return { kind: "value", value: entry(...args) >>> 0 };
  } catch {
    return { kind: "trap" };
  }
}

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

function call(functionName: string, args: readonly RuntimeExpression[]) {
  return { kind: "call" as const, function: functionName, args };
}

function add(left: RuntimeExpression, right: RuntimeExpression) {
  return { kind: "addU32" as const, left, right };
}

function mul(left: RuntimeExpression, right: RuntimeExpression) {
  return { kind: "mulU32" as const, left, right };
}

function loadScratch(index: RuntimeExpression) {
  return { kind: "loadScratchU32" as const, index };
}

function storeScratch(index: RuntimeExpression, value: RuntimeExpression) {
  return { kind: "storeScratchU32" as const, index, value };
}

function text(name: string) {
  return { kind: "text" as const, name };
}
