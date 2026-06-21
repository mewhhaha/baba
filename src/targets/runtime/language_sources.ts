import type { RuntimeLanguageProgram } from "./language.ts";

export const UTF16_CODE_POINT_WIDTH_PROGRAM: RuntimeLanguageProgram = {
  name: "utf16_code_point_width",
  entry: "utf16CodePointWidth",
  functions: [{
    name: "utf16CodePointWidth",
    parameters: [{ name: "codePoint", type: "u32" }],
    result: "u32",
    body: [{
      kind: "if",
      condition: {
        kind: "ltS32",
        left: { kind: "local", name: "codePoint" },
        right: { kind: "u32", value: 0x1_00_00 },
      },
      consequent: [{ kind: "return", expression: { kind: "u32", value: 1 } }],
      alternate: [{ kind: "return", expression: { kind: "u32", value: 2 } }],
    }],
  }],
};
