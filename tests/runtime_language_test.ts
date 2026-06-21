import {
  compileRuntimeLanguageWasm,
  emitRuntimeLanguageTypeScript,
  type RuntimeExpression,
  RuntimeLanguageProgram,
} from "../src/targets/runtime/language.ts";
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
      runTypeScript(testCase.program),
      runWasm(testCase.program),
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

interface RuntimeConformanceCase {
  readonly name: string;
  readonly program: RuntimeLanguageProgram;
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

async function runTypeScript(
  program: RuntimeLanguageProgram,
): Promise<RuntimeResult> {
  const directory = await Deno.makeTempDir();
  try {
    const path = `${directory}/runtime_language.ts`;
    await Deno.writeTextFile(path, emitRuntimeLanguageTypeScript(program));
    const module = await import(`file://${path}?${crypto.randomUUID()}`) as {
      main: () => number;
    };
    return { kind: "value", value: module.main() >>> 0 };
  } catch {
    return { kind: "trap" };
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

async function runWasm(
  program: RuntimeLanguageProgram,
): Promise<RuntimeResult> {
  const bytes = compileRuntimeLanguageWasm(program);
  const instantiated = await WebAssembly.instantiate(bytes, {}) as
    | WebAssembly.Instance
    | WebAssembly.WebAssemblyInstantiatedSource;
  const instance = "instance" in instantiated
    ? instantiated.instance
    : instantiated;
  const main = instance.exports.main as () => number;
  try {
    return { kind: "value", value: main() >>> 0 };
  } catch {
    return { kind: "trap" };
  }
}
