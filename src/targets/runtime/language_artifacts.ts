import {
  compileRuntimeLanguageWasm,
  emitRuntimeLanguageTypeScript,
  RUNTIME_LANGUAGE_SEMANTICS,
  RUNTIME_LANGUAGE_VERSION,
  type RuntimeLanguageProgram,
} from "./language.ts";
import { RUNTIME_LANGUAGE_COMPILER_METADATA } from "./language_manifest.ts";
import {
  createLexerRuntimeProgram,
  createParserConflictTableRuntimeProgram,
  createParserGotoRuntimeProgram,
  createParserTableRuntimeProgram,
  createParserTraceRuntimeProgram,
  RUNTIME_ACTION_ACCEPT,
  RUNTIME_ACTION_REDUCE,
  RUNTIME_ACTION_SHIFT,
  UTF16_CODE_POINT_WIDTH_PROGRAM,
} from "./language_sources.ts";

export interface RuntimeLanguageArtifactMetadata {
  readonly name: string;
  readonly entry: string;
  readonly sourceHash: string;
  readonly typescriptHash: string;
  readonly wasmHash: string;
}

export interface RuntimeLanguageArtifactsMetadata {
  readonly format: "baba-runtime-language-artifacts";
  readonly version: 1;
  readonly languageVersion: typeof RUNTIME_LANGUAGE_VERSION;
  readonly languageSemantics: typeof RUNTIME_LANGUAGE_SEMANTICS;
  readonly compilerHash: string;
  readonly hash: string;
  readonly artifacts: readonly RuntimeLanguageArtifactMetadata[];
}

export interface RuntimeLanguageArtifactFixture {
  readonly name: string;
  readonly program: RuntimeLanguageProgram;
}

export const RUNTIME_LANGUAGE_ARTIFACTS_FORMAT =
  "baba-runtime-language-artifacts" as const;
export const RUNTIME_LANGUAGE_ARTIFACTS_VERSION = 1 as const;

export const RUNTIME_LANGUAGE_ARTIFACT_FIXTURES:
  readonly RuntimeLanguageArtifactFixture[] = [
    {
      name: "utf16_code_point_width",
      program: UTF16_CODE_POINT_WIDTH_PROGRAM,
    },
    {
      name: "lexer_runtime",
      program: createLexerRuntimeProgram({
        transitions: [
          [
            [0x41, 0x5a, 1],
            [0x61, 0x7a, 2],
          ],
          [
            [0x30, 0x39, 1],
          ],
          [],
        ],
        asciiTransitions: [
          asciiRow([[0x41, 1], [0x61, 2]]),
          asciiRow([[0x30, 1]]),
          asciiRow([]),
        ],
        accepts: [-1, 0, 1],
      }),
    },
    {
      name: "parser_table_runtime",
      program: createParserTableRuntimeProgram({
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
      }),
    },
    {
      name: "parser_conflict_table_runtime",
      program: createParserConflictTableRuntimeProgram({
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
      }),
    },
    {
      name: "parser_goto_runtime",
      program: createParserGotoRuntimeProgram({
        gotoRows: [
          [
            [8, 13],
          ],
          [],
        ],
      }),
    },
    {
      name: "parser_trace_runtime",
      program: createParserTraceRuntimeProgram({
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
      }),
    },
  ] as const;

export const RUNTIME_LANGUAGE_ARTIFACTS:
  readonly RuntimeLanguageArtifactMetadata[] = [
    {
      name: "utf16_code_point_width",
      entry: "utf16CodePointWidth",
      sourceHash: "fnv1a64:007be33aff20f70b",
      typescriptHash: "fnv1a64:92995f2385b0ec83",
      wasmHash: "fnv1a64:7bcc39b7fe691598",
    },
    {
      name: "lexer_runtime",
      entry: "dfaTransition",
      sourceHash: "fnv1a64:82f6fd7a717f9948",
      typescriptHash: "fnv1a64:c6116960ad204dbe",
      wasmHash: "fnv1a64:22ce9c2eac89e145",
    },
    {
      name: "parser_table_runtime",
      entry: "parserAction",
      sourceHash: "fnv1a64:8ad13c0c0f868c5b",
      typescriptHash: "fnv1a64:cf32520f070862a7",
      wasmHash: "fnv1a64:7d0a115a6f5fc5e7",
    },
    {
      name: "parser_conflict_table_runtime",
      entry: "parserActionAt",
      sourceHash: "fnv1a64:101a7048132e9b70",
      typescriptHash: "fnv1a64:cc4b7081fe29e9fc",
      wasmHash: "fnv1a64:2962a98b669908a7",
    },
    {
      name: "parser_goto_runtime",
      entry: "parserGoto",
      sourceHash: "fnv1a64:03418d9f8d0c5c19",
      typescriptHash: "fnv1a64:dbb0658dcd044762",
      wasmHash: "fnv1a64:be349707b45efa01",
    },
    {
      name: "parser_trace_runtime",
      entry: "parserTrace",
      sourceHash: "fnv1a64:ecc4d26e2e7e3ead",
      typescriptHash: "fnv1a64:e3ce4d7ef51fc9ad",
      wasmHash: "fnv1a64:2321cc599ba0bc81",
    },
  ] as const;

export const RUNTIME_LANGUAGE_ARTIFACTS_HASH =
  "fnv1a64:f2b68f5e6de472d0" as const;

export const RUNTIME_LANGUAGE_ARTIFACTS_METADATA:
  RuntimeLanguageArtifactsMetadata = {
    format: RUNTIME_LANGUAGE_ARTIFACTS_FORMAT,
    version: RUNTIME_LANGUAGE_ARTIFACTS_VERSION,
    languageVersion: RUNTIME_LANGUAGE_VERSION,
    languageSemantics: RUNTIME_LANGUAGE_SEMANTICS,
    compilerHash: RUNTIME_LANGUAGE_COMPILER_METADATA.hash,
    hash: RUNTIME_LANGUAGE_ARTIFACTS_HASH,
    artifacts: RUNTIME_LANGUAGE_ARTIFACTS,
  };

export function computeRuntimeLanguageArtifactMetadata(): readonly RuntimeLanguageArtifactMetadata[] {
  return RUNTIME_LANGUAGE_ARTIFACT_FIXTURES.map(({ name, program }) => ({
    name,
    entry: program.entry,
    sourceHash: hashRuntimeLanguageProgramSource(program),
    typescriptHash: hashRuntimeLanguageArtifactText(
      emitRuntimeLanguageTypeScript(program),
    ),
    wasmHash: hashRuntimeLanguageArtifactBytes(
      compileRuntimeLanguageWasm(program),
    ),
  }));
}

export function hashRuntimeLanguageArtifactsManifest(
  artifacts: readonly RuntimeLanguageArtifactMetadata[],
): string {
  return hashRuntimeLanguageArtifactText(
    JSON.stringify({
      format: RUNTIME_LANGUAGE_ARTIFACTS_FORMAT,
      version: RUNTIME_LANGUAGE_ARTIFACTS_VERSION,
      languageVersion: RUNTIME_LANGUAGE_VERSION,
      languageSemantics: RUNTIME_LANGUAGE_SEMANTICS,
      compilerHash: RUNTIME_LANGUAGE_COMPILER_METADATA.hash,
      artifacts,
    }),
  );
}

export function hashRuntimeLanguageProgramSource(
  program: RuntimeLanguageProgram,
): string {
  return hashRuntimeLanguageArtifactText(canonicalJson(program));
}

export function hashRuntimeLanguageArtifactText(source: string): string {
  return hashRuntimeLanguageArtifactBytes(new TextEncoder().encode(source));
}

export function hashRuntimeLanguageArtifactBytes(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

function asciiRow(
  entries: readonly (readonly [codePoint: number, target: number])[],
): number[] {
  const row = Array.from({ length: 128 }, () => -1);
  for (const [codePoint, target] of entries) row[codePoint] = target;
  return row;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${
    Object.keys(object).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(object[key])}`
    ).join(",")
  }}`;
}
