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
  createParserActionRuntimeProgram,
  createParserConflictTableRuntimeProgram,
  createParserConflictTraceRuntimeProgram,
  createParserExpectedRuntimeProgram,
  createParserFieldRuntimeProgram,
  createParserGotoRuntimeProgram,
  createParserObjectRuntimeProgram,
  createParserProductionRuntimeProgram,
  createParserRangeRuntimeProgram,
  createParserReducerRuntimeProgram,
  createParserTableRuntimeProgram,
  createParserTraceRuntimeProgram,
  RUNTIME_ACTION_ACCEPT,
  RUNTIME_ACTION_REDUCE,
  RUNTIME_ACTION_SHIFT,
  RUNTIME_ARENA_PROGRAM,
  RUNTIME_FIELD_ARRAY,
  RUNTIME_FIELD_NULLABLE,
  RUNTIME_LEXER_SPEC_LITERAL,
  RUNTIME_LEXER_SPEC_TRIVIA,
  RUNTIME_NO_REDUCER_PAYLOAD,
  RUNTIME_REDUCER_FIELD,
  RUNTIME_REDUCER_RULE,
  RUNTIME_REDUCER_SEQUENCE,
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
      name: "runtime_arena",
      program: RUNTIME_ARENA_PROGRAM,
    },
    {
      name: "parser_object_runtime",
      program: createParserObjectRuntimeProgram(),
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
        specs: [
          [0, 0, 4],
          [RUNTIME_LEXER_SPEC_TRIVIA, 1, -1],
          [RUNTIME_LEXER_SPEC_LITERAL, 2, 8],
        ],
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
      name: "parser_action_runtime",
      program: createParserActionRuntimeProgram(),
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
        productions: [
          [0, 1],
          [2, 0],
          [1, 3],
        ],
      }),
    },
    {
      name: "parser_conflict_trace_runtime",
      program: createParserConflictTraceRuntimeProgram({
        actionRows: [
          [[1, RUNTIME_ACTION_SHIFT + 1]],
          [[2, RUNTIME_ACTION_SHIFT + 3], [2, RUNTIME_ACTION_REDUCE + 2]],
          [[2, RUNTIME_ACTION_SHIFT + 5]],
          [[3, RUNTIME_ACTION_REDUCE + 3]],
          [[3, RUNTIME_ACTION_SHIFT + 7]],
          [[0, RUNTIME_ACTION_REDUCE]],
          [[0, RUNTIME_ACTION_ACCEPT]],
          [[0, RUNTIME_ACTION_REDUCE + 1]],
        ],
        gotoRows: [
          [
            [1, 6],
            [2, 2],
            [3, 4],
          ],
          [],
          [],
          [],
          [],
          [],
          [],
          [],
        ],
        productions: [
          [1, 2],
          [1, 2],
          [2, 1],
          [3, 2],
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
      name: "parser_expected_runtime",
      program: createParserExpectedRuntimeProgram({
        rowLengths: [2, 0, 3],
        rowHasEof: [true, false, true],
      }),
    },
    {
      name: "parser_range_runtime",
      program: createParserRangeRuntimeProgram(),
    },
    {
      name: "parser_field_runtime",
      program: createParserFieldRuntimeProgram({
        fieldRows: [
          [[2, RUNTIME_FIELD_ARRAY], [5, RUNTIME_FIELD_NULLABLE]],
          [],
          [[7, 0]],
        ],
      }),
    },
    {
      name: "parser_production_runtime",
      program: createParserProductionRuntimeProgram({
        productions: [
          [4, 0],
          [7, 2],
        ],
      }),
    },
    {
      name: "parser_reducer_runtime",
      program: createParserReducerRuntimeProgram({
        reducers: [
          [RUNTIME_REDUCER_RULE, 4],
          [RUNTIME_REDUCER_FIELD, 2],
          [RUNTIME_REDUCER_SEQUENCE, RUNTIME_NO_REDUCER_PAYLOAD],
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
      sourceHash: "fnv1a64:548fa4450115643e",
      typescriptHash: "fnv1a64:0b4948b0d6309f2d",
      wasmHash: "fnv1a64:edd2bbbaaa8c1909",
    },
    {
      name: "runtime_arena",
      entry: "runtimeArenaReset",
      sourceHash: "fnv1a64:bdcb55d043072b51",
      typescriptHash: "fnv1a64:dd1cd7ad04e8894a",
      wasmHash: "fnv1a64:9595df47c8d1f00b",
    },
    {
      name: "parser_object_runtime",
      entry: "parserFragmentNew",
      sourceHash: "fnv1a64:79e0dff2b1f05e3c",
      typescriptHash: "fnv1a64:2f27a8ec77d4eb44",
      wasmHash: "fnv1a64:6e106424770a7d89",
    },
    {
      name: "lexer_runtime",
      entry: "dfaTransition",
      sourceHash: "fnv1a64:2a3a958e670e7eac",
      typescriptHash: "fnv1a64:c93894a473cfeb7d",
      wasmHash: "fnv1a64:9099efd234030f23",
    },
    {
      name: "parser_table_runtime",
      entry: "parserAction",
      sourceHash: "fnv1a64:8ad13c0c0f868c5b",
      typescriptHash: "fnv1a64:cf32520f070862a7",
      wasmHash: "fnv1a64:7d0a115a6f5fc5e7",
    },
    {
      name: "parser_action_runtime",
      entry: "parserActionKind",
      sourceHash: "fnv1a64:c3590a618fbe6390",
      typescriptHash: "fnv1a64:ab38c31215552c95",
      wasmHash: "fnv1a64:dac92129f380b4f5",
    },
    {
      name: "parser_conflict_table_runtime",
      entry: "parserActionAt",
      sourceHash: "fnv1a64:df132d9e08eff346",
      typescriptHash: "fnv1a64:18863286a6aa2f91",
      wasmHash: "fnv1a64:214546c44beff2ff",
    },
    {
      name: "parser_conflict_trace_runtime",
      entry: "parserTrace",
      sourceHash: "fnv1a64:3570d1b46716936e",
      typescriptHash: "fnv1a64:8df910a904b0799d",
      wasmHash: "fnv1a64:28eb0378700eb661",
    },
    {
      name: "parser_goto_runtime",
      entry: "parserGoto",
      sourceHash: "fnv1a64:03418d9f8d0c5c19",
      typescriptHash: "fnv1a64:dbb0658dcd044762",
      wasmHash: "fnv1a64:be349707b45efa01",
    },
    {
      name: "parser_expected_runtime",
      entry: "parserExpectedStart",
      sourceHash: "fnv1a64:c52cde3bb27d0ce5",
      typescriptHash: "fnv1a64:8be2da8393428d93",
      wasmHash: "fnv1a64:d5dd585a1203ec35",
    },
    {
      name: "parser_range_runtime",
      entry: "parserMergeStart",
      sourceHash: "fnv1a64:a402cac99d019a05",
      typescriptHash: "fnv1a64:4553ca1ea00e245b",
      wasmHash: "fnv1a64:3bd543ac19af6f40",
    },
    {
      name: "parser_field_runtime",
      entry: "parserFieldStart",
      sourceHash: "fnv1a64:7b4ca92ccfd6027c",
      typescriptHash: "fnv1a64:7db56f562c3921ae",
      wasmHash: "fnv1a64:948390c7f05deab2",
    },
    {
      name: "parser_production_runtime",
      entry: "parserProductionLhs",
      sourceHash: "fnv1a64:d1d307c12ba4f27d",
      typescriptHash: "fnv1a64:b4d1d0d6b276032a",
      wasmHash: "fnv1a64:721ca386078cc4b8",
    },
    {
      name: "parser_reducer_runtime",
      entry: "parserReducerKind",
      sourceHash: "fnv1a64:17a5e0d403915d06",
      typescriptHash: "fnv1a64:df239cc8bbec80a1",
      wasmHash: "fnv1a64:e6ecb5dba25db367",
    },
    {
      name: "parser_trace_runtime",
      entry: "parserTrace",
      sourceHash: "fnv1a64:cf55a26fc053f81c",
      typescriptHash: "fnv1a64:b8f09fdbcb6f3bda",
      wasmHash: "fnv1a64:357db0a7c4a1d434",
    },
  ] as const;

export const RUNTIME_LANGUAGE_ARTIFACTS_HASH =
  "fnv1a64:bac0c035eaade6e4" as const;

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
