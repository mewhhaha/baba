import {
  compileRuntimeLanguageIr,
  compileRuntimeLanguageWasm,
  emitRuntimeLanguageTypeScript,
  emitRuntimeLanguageTypeScriptFunction,
  type RuntimeExpression,
  RuntimeLanguageProgram,
} from "../src/targets/runtime/language.ts";
import {
  computeRuntimeLanguageArtifactMetadata,
  hashRuntimeLanguageArtifactsManifest,
  RUNTIME_LANGUAGE_ARTIFACTS_METADATA,
} from "../src/targets/runtime/language_artifacts.ts";
import {
  hashRuntimeLanguageCompilerManifest,
  hashRuntimeLanguageCompilerSource,
  RUNTIME_LANGUAGE_COMPILER_METADATA,
} from "../src/targets/runtime/language_manifest.ts";
import {
  createLexerRuntimeProgram,
  createLexerSpecRuntimeProgram,
  createParserActionRuntimeProgram,
  createParserConflictTableRuntimeProgram,
  createParserConflictTraceRuntimeProgram,
  createParserExpectedRuntimeProgram,
  createParserFieldRuntimeProgram,
  createParserGotoRuntimeProgram,
  createParserObjectRuntimeProgram,
  createParserProductionRuntimeProgram,
  createParserReducerRuntimeProgram,
  createParserReplayRuntimeProgram,
  createParserTableRuntimeProgram,
  createParserTraceRuntimeProgram,
  createSourceTextRuntimeProgram,
  RUNTIME_ACCEPTED_ROOT_STATUS_DIRECT,
  RUNTIME_ACCEPTED_ROOT_STATUS_FRAGMENT_VALUE,
  RUNTIME_ACCEPTED_ROOT_STATUS_MISSING,
  RUNTIME_ACTION_ACCEPT,
  RUNTIME_ACTION_REDUCE,
  RUNTIME_ACTION_SHIFT,
  RUNTIME_ARENA_PROGRAM,
  RUNTIME_DIAGNOSTIC_CODE_STATUS_MISMATCH,
  RUNTIME_DIAGNOSTIC_CODE_STATUS_OK,
  RUNTIME_DIAGNOSTIC_MERGE_BOTH,
  RUNTIME_DIAGNOSTIC_MERGE_EMPTY,
  RUNTIME_DIAGNOSTIC_MERGE_LEFT,
  RUNTIME_DIAGNOSTIC_MERGE_RIGHT,
  RUNTIME_FIELD_ARRAY,
  RUNTIME_FIELD_ARRAY_VALUE_MISSING,
  RUNTIME_FIELD_ARRAY_VALUE_OK,
  RUNTIME_FIELD_BUILD_CAPTURE_WITHOUT_SCHEMA,
  RUNTIME_FIELD_BUILD_EMPTY,
  RUNTIME_FIELD_BUILD_PRESENT,
  RUNTIME_FIELD_CAPTURE_ARRAY,
  RUNTIME_FIELD_CAPTURE_SCALAR,
  RUNTIME_FIELD_CAPTURE_TOO_MANY,
  RUNTIME_FIELD_ENTRY_MISSING,
  RUNTIME_FIELD_ENTRY_PRESENT,
  RUNTIME_FIELD_FINAL_BUILD_ARRAY,
  RUNTIME_FIELD_FINAL_BUILD_REQUIRED_MISSING,
  RUNTIME_FIELD_FINAL_BUILD_SCALAR,
  RUNTIME_FIELD_FINAL_BUILD_TOO_MANY,
  RUNTIME_FIELD_FINAL_OK,
  RUNTIME_FIELD_FINAL_REQUIRED_MISSING,
  RUNTIME_FIELD_FINAL_TOO_MANY,
  RUNTIME_FIELD_NULLABLE,
  RUNTIME_FIELD_SCALAR_VALUE_FRAGMENT,
  RUNTIME_FIELD_SCALAR_VALUE_NULL,
  RUNTIME_FIELD_SCHEMA_STATUS_CAPTURE_WITHOUT_SCHEMA,
  RUNTIME_FIELD_SCHEMA_STATUS_OK,
  RUNTIME_FIELD_STORAGE_ARRAY,
  RUNTIME_FIELD_STORAGE_SCALAR,
  RUNTIME_FIELD_VALUE_ARRAY,
  RUNTIME_FIELD_VALUE_NULLABLE,
  RUNTIME_FIELD_VALUE_REQUIRED,
  RUNTIME_LEXER_DRIVER_EVENT_ERROR,
  RUNTIME_LEXER_DRIVER_EVENT_NEED_CODE_POINT,
  RUNTIME_LEXER_DRIVER_EVENT_TOKEN,
  RUNTIME_LEXER_SPEC_LITERAL,
  RUNTIME_LEXER_SPEC_STATUS_NOT_LITERAL,
  RUNTIME_LEXER_SPEC_STATUS_NOT_MAIN,
  RUNTIME_LEXER_SPEC_STATUS_NOT_TRIVIA,
  RUNTIME_LEXER_SPEC_STATUS_OK,
  RUNTIME_LEXER_SPEC_STATUS_UNKNOWN,
  RUNTIME_LEXER_SPEC_TRIVIA,
  RUNTIME_LEXER_TOKEN_EMIT_SKIP,
  RUNTIME_LEXER_TOKEN_EMIT_TOKEN,
  RUNTIME_LEXER_TOKEN_LITERAL,
  RUNTIME_LEXER_TOKEN_MAIN,
  RUNTIME_LEXER_TOKEN_TRIVIA,
  RUNTIME_LEXICAL_TOKEN_STATUS_ERROR_TOKEN,
  RUNTIME_LEXICAL_TOKEN_STATUS_NOT_TERMINAL,
  RUNTIME_LEXICAL_TOKEN_STATUS_OK,
  RUNTIME_NO_FIELD,
  RUNTIME_NO_GOTO,
  RUNTIME_NO_PRODUCTION,
  RUNTIME_NO_REDUCER_PAYLOAD,
  RUNTIME_NO_TERMINAL,
  RUNTIME_NO_TRANSITION,
  RUNTIME_PUBLIC_TOKEN_CHANNEL_ERROR,
  RUNTIME_PUBLIC_TOKEN_CHANNEL_MAIN,
  RUNTIME_PUBLIC_TOKEN_CHANNEL_TRIVIA,
  RUNTIME_PUBLIC_TOKEN_CHANNEL_UNKNOWN,
  RUNTIME_PUBLIC_TOKEN_EOF,
  RUNTIME_PUBLIC_TOKEN_ERROR,
  RUNTIME_PUBLIC_TOKEN_LITERAL,
  RUNTIME_PUBLIC_TOKEN_MAIN,
  RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_INVALID_ERROR,
  RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_INVALID_LITERAL,
  RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_INVALID_NAMED,
  RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_OK,
  RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_UNKNOWN_TYPE,
  RUNTIME_PUBLIC_TOKEN_TRIVIA,
  RUNTIME_PUBLIC_TOKEN_TYPE_ERROR,
  RUNTIME_PUBLIC_TOKEN_TYPE_LITERAL,
  RUNTIME_PUBLIC_TOKEN_TYPE_NAMED,
  RUNTIME_PUBLIC_TOKEN_TYPE_UNKNOWN,
  RUNTIME_REDUCER_CHILD_FRAGMENT,
  RUNTIME_REDUCER_CHILD_RAW,
  RUNTIME_REDUCER_CHILD_RULE_NODE,
  RUNTIME_REDUCER_CHILD_SHIFTED_TOKEN,
  RUNTIME_REDUCER_CHILD_UNKNOWN,
  RUNTIME_REDUCER_FIELD,
  RUNTIME_REDUCER_OPERATION_FIELD,
  RUNTIME_REDUCER_OPERATION_RULE,
  RUNTIME_REDUCER_OPERATION_RULE_REF,
  RUNTIME_REDUCER_OPERATION_SEPARATED_APPEND,
  RUNTIME_REDUCER_OPERATION_SEQUENCE,
  RUNTIME_REDUCER_OPERATION_START,
  RUNTIME_REDUCER_OPERATION_TERMINAL,
  RUNTIME_REDUCER_OPERATION_UNKNOWN,
  RUNTIME_REDUCER_PAYLOAD_STATUS_FIELD_MISSING,
  RUNTIME_REDUCER_PAYLOAD_STATUS_OK,
  RUNTIME_REDUCER_PAYLOAD_STATUS_RULE_MISSING,
  RUNTIME_REDUCER_PAYLOAD_STATUS_UNKNOWN,
  RUNTIME_REDUCER_RESULT_CHILD_FRAGMENT,
  RUNTIME_REDUCER_RESULT_RAW_CHILD,
  RUNTIME_REDUCER_RESULT_RULE_NODE,
  RUNTIME_REDUCER_RESULT_SEPARATED_APPEND_FRAGMENT,
  RUNTIME_REDUCER_RESULT_SEQUENCE_FRAGMENT,
  RUNTIME_REDUCER_RESULT_UNKNOWN,
  RUNTIME_REDUCER_RULE,
  RUNTIME_REDUCER_SEQUENCE,
  RUNTIME_REDUCER_START,
  RUNTIME_REDUCER_UNKNOWN,
  RUNTIME_REPLAY_ACTION_STATUS_ACCEPT,
  RUNTIME_REPLAY_ACTION_STATUS_REDUCE,
  RUNTIME_REPLAY_ACTION_STATUS_SHIFT,
  RUNTIME_REPLAY_ACTION_STATUS_UNKNOWN,
  RUNTIME_REPLAY_REDUCTION_STATUS_FIELD_PAYLOAD_MISSING,
  RUNTIME_REPLAY_REDUCTION_STATUS_OK,
  RUNTIME_REPLAY_REDUCTION_STATUS_RULE_PAYLOAD_MISSING,
  RUNTIME_REPLAY_REDUCTION_STATUS_STACK_UNDERFLOW,
  RUNTIME_REPLAY_REDUCTION_STATUS_UNKNOWN_PRODUCTION,
  RUNTIME_RULE_NODE_CHILD_LIST_EMPTY,
  RUNTIME_RULE_NODE_CHILD_LIST_PRESENT,
  RUNTIME_SHIFTED_TOKEN_STATUS_INVALID,
  RUNTIME_SHIFTED_TOKEN_STATUS_OK,
  RUNTIME_SOURCE_TEXT_OFFSET_STATUS_OK,
  RUNTIME_SOURCE_TEXT_OFFSET_STATUS_OUT_OF_BOUNDS,
  RUNTIME_SOURCE_TEXT_SPAN_STATUS_END_BEFORE_START,
  RUNTIME_SOURCE_TEXT_SPAN_STATUS_OK,
  RUNTIME_SOURCE_TEXT_SPAN_STATUS_OUT_OF_BOUNDS,
  RUNTIME_TOKEN_STREAM_CANONICAL_MATCH,
  RUNTIME_TOKEN_STREAM_CANONICAL_MISMATCH,
  RUNTIME_TOKEN_STREAM_CANONICAL_SKIP,
  RUNTIME_TOKEN_STREAM_STATUS_GAP,
  RUNTIME_TOKEN_STREAM_STATUS_INVALID_EOF,
  RUNTIME_TOKEN_STREAM_STATUS_INVALID_SPAN,
  RUNTIME_TOKEN_STREAM_STATUS_NONTRIVIA_GAP,
  RUNTIME_TOKEN_STREAM_STATUS_OK,
  RUNTIME_TOKEN_STREAM_STATUS_OVERLAP,
  RUNTIME_TOKEN_STREAM_STATUS_TOKEN_MISMATCH,
  RUNTIME_TOKEN_STREAM_STATUS_ZERO_WIDTH,
  RUNTIME_TRACE_STATUS_BRANCH_LIMIT,
  RUNTIME_TRACE_STATUS_INTERNAL,
  RUNTIME_TRACE_STATUS_UNEXPECTED,
  RUNTIME_TRACE_TOKEN_STREAM_EMIT,
  RUNTIME_TRACE_TOKEN_STREAM_SKIP,
  RUNTIME_TRACE_TOKEN_STREAM_STOP,
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
  const lexerSpecBaseProgram = createLexerSpecRuntimeProgram({
    specs: [
      [0, 0, 4],
      [RUNTIME_LEXER_SPEC_TRIVIA, 1, -1],
      [RUNTIME_LEXER_SPEC_LITERAL, 2, 8],
    ],
  });
  const lexerSpecRuntimeProgram: RuntimeLanguageProgram = {
    ...lexerSpecBaseProgram,
    name: "lexer_spec_terminal_conformance",
    entry: "main",
    functions: [
      ...lexerSpecBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(call("lexerSpecTerminal", [u32(0)]), u32(100_000_000)),
            add(
              mul(call("lexerSpecTokenClass", [u32(0)]), u32(10_000_000)),
              add(
                mul(call("lexerSpecTokenClass", [u32(1)]), u32(1_000_000)),
                add(
                  mul(call("lexerSpecPayload", [u32(2)]), u32(100_000)),
                  add(
                    mul(call("lexerSpecTokenClass", [u32(2)]), u32(10_000)),
                    add(
                      mul(
                        eq(
                          call("lexerSpecTerminal", [u32(1)]),
                          u32(RUNTIME_NO_TERMINAL),
                        ),
                        u32(1_000),
                      ),
                      add(
                        call("lexerSpecPublicTokenStatus", [
                          u32(2),
                          u32(RUNTIME_PUBLIC_TOKEN_LITERAL),
                        ]),
                        add(
                          call("lexerSpecPublicTokenStatus", [
                            u32(99),
                            u32(RUNTIME_PUBLIC_TOKEN_MAIN),
                          ]),
                          add(
                            call("lexerSpecPublicTokenStatus", [
                              u32(0),
                              u32(RUNTIME_PUBLIC_TOKEN_LITERAL),
                            ]),
                            add(
                              call("lexerSpecPublicTokenStatus", [
                                u32(1),
                                u32(RUNTIME_PUBLIC_TOKEN_MAIN),
                              ]),
                              call("lexerSpecPublicTokenStatus", [
                                u32(0),
                                u32(RUNTIME_PUBLIC_TOKEN_TRIVIA),
                              ]),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        }],
      },
    ],
  };
  const lexerDriverBaseProgram = createLexerRuntimeProgram({
    transitions: [
      [
        [0x20, 0x20, 2],
        [0x41, 0x41, 1],
      ],
      [],
      [],
    ],
    asciiTransitions: [
      asciiRow([[0x20, 2], [0x41, 1]]),
      asciiRow([]),
      asciiRow([]),
    ],
    accepts: [-1, 0, 1],
    specs: [
      [0, 0, 4],
      [RUNTIME_LEXER_SPEC_TRIVIA, 1, -1],
    ],
  });
  const lexerDriverRuntimeProgram: RuntimeLanguageProgram = {
    ...lexerDriverBaseProgram,
    name: "lexer_driver_conformance",
    entry: "main",
    functions: [
      ...lexerDriverBaseProgram.functions,
      {
        name: "main",
        locals: [
          { name: "discard", type: "u32" },
          { name: "tokenEvent", type: "u32" },
          { name: "tokenClass", type: "u32" },
          { name: "tokenTerminal", type: "u32" },
          { name: "tokenEnd", type: "u32" },
          { name: "skipReadOffset", type: "u32" },
          { name: "errorEvent", type: "u32" },
          { name: "errorStart", type: "u32" },
          { name: "errorEnd", type: "u32" },
        ],
        result: "u32",
        body: [
          setLocal("discard", call("lexerDriverStart", [u32(3), u32(0)])),
          setLocal("discard", call("lexerDriverAdvance", [u32(0x41)])),
          setLocal("discard", call("lexerDriverAdvance", [u32(0x20)])),
          setLocal("tokenEvent", call("lexerDriverEvent", [])),
          setLocal("tokenClass", call("lexerDriverTokenClass", [])),
          setLocal("tokenTerminal", call("lexerDriverTokenTerminal", [])),
          setLocal("tokenEnd", call("lexerDriverTokenEnd", [])),
          setLocal("discard", call("lexerDriverConsume", [])),
          setLocal("discard", call("lexerDriverAdvance", [u32(0x20)])),
          setLocal("discard", call("lexerDriverAdvance", [u32(0x3f)])),
          setLocal("skipReadOffset", call("lexerDriverReadOffset", [])),
          setLocal("discard", call("lexerDriverAdvance", [u32(0x3f)])),
          setLocal("errorEvent", call("lexerDriverEvent", [])),
          setLocal("errorStart", call("lexerDriverTokenStart", [])),
          setLocal("errorEnd", call("lexerDriverTokenEnd", [])),
          {
            kind: "return",
            expression: add(
              mul(local("tokenEvent"), u32(100_000_000)),
              add(
                mul(local("tokenEnd"), u32(10_000_000)),
                add(
                  mul(local("tokenClass"), u32(1_000_000)),
                  add(
                    mul(local("tokenTerminal"), u32(100_000)),
                    add(
                      mul(local("skipReadOffset"), u32(10_000)),
                      add(
                        mul(local("errorEvent"), u32(1_000)),
                        add(
                          mul(local("errorStart"), u32(100)),
                          local("errorEnd"),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          },
        ],
      },
    ],
  };
  const lexerDriverPreserveTriviaRuntimeProgram: RuntimeLanguageProgram = {
    ...lexerDriverBaseProgram,
    name: "lexer_driver_preserve_trivia_conformance",
    entry: "main",
    functions: [
      ...lexerDriverBaseProgram.functions,
      {
        name: "main",
        locals: [{ name: "discard", type: "u32" }],
        result: "u32",
        body: [
          setLocal("discard", call("lexerDriverStart", [u32(1), u32(1)])),
          setLocal("discard", call("lexerDriverAdvance", [u32(0x20)])),
          {
            kind: "return",
            expression: add(
              mul(call("lexerDriverEvent", []), u32(1_000)),
              add(
                mul(call("lexerDriverTokenClass", []), u32(100)),
                add(
                  mul(call("lexerDriverTokenPayload", []), u32(10)),
                  eq(
                    call("lexerDriverTokenTerminal", []),
                    u32(RUNTIME_NO_TERMINAL),
                  ),
                ),
              ),
            ),
          },
        ],
      },
    ],
  };
  const lexerTokenDiagnosticRuntimeProgram: RuntimeLanguageProgram = {
    ...lexerSpecBaseProgram,
    name: "lexer_token_diagnostic_status_conformance",
    entry: "main",
    functions: [
      ...lexerSpecBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(
              call("lexerTokenDiagnosticStatus", [
                u32(RUNTIME_PUBLIC_TOKEN_ERROR),
                u32(RUNTIME_NO_TERMINAL),
              ]),
              u32(100_000),
            ),
            add(
              mul(
                eq(
                  call("lexerTokenDiagnosticStatus", [
                    u32(RUNTIME_PUBLIC_TOKEN_TRIVIA),
                    u32(RUNTIME_NO_TERMINAL),
                  ]),
                  u32(RUNTIME_LEXICAL_TOKEN_STATUS_OK),
                ),
                u32(10_000),
              ),
              add(
                mul(
                  eq(
                    call("lexerTokenDiagnosticStatus", [
                      u32(RUNTIME_PUBLIC_TOKEN_EOF),
                      u32(RUNTIME_NO_TERMINAL),
                    ]),
                    u32(RUNTIME_LEXICAL_TOKEN_STATUS_OK),
                  ),
                  u32(1_000),
                ),
                add(
                  mul(
                    eq(
                      call("lexerTokenDiagnosticStatus", [
                        u32(RUNTIME_PUBLIC_TOKEN_MAIN),
                        u32(4),
                      ]),
                      u32(RUNTIME_LEXICAL_TOKEN_STATUS_OK),
                    ),
                    u32(100),
                  ),
                  add(
                    mul(
                      call("lexerTokenDiagnosticStatus", [
                        u32(RUNTIME_PUBLIC_TOKEN_LITERAL),
                        u32(RUNTIME_NO_TERMINAL),
                      ]),
                      u32(10),
                    ),
                    call("lexerTokenDiagnosticStatus", [
                      u32(99),
                      u32(4),
                    ]),
                  ),
                ),
              ),
            ),
          ),
        }],
      },
    ],
  };
  const lexerPublicTokenRuntimeProgram: RuntimeLanguageProgram = {
    ...lexerSpecBaseProgram,
    name: "lexer_public_token_status_conformance",
    entry: "main",
    functions: [
      ...lexerSpecBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(
              call("lexerPublicTokenClass", [
                u32(RUNTIME_LEXER_TOKEN_LITERAL),
              ]),
              u32(100_000),
            ),
            add(
              mul(
                call("lexerPublicTokenClass", [
                  u32(RUNTIME_LEXER_TOKEN_TRIVIA),
                ]),
                u32(10_000),
              ),
              add(
                mul(
                  call("lexerPublicTokenClass", [
                    u32(RUNTIME_LEXER_TOKEN_MAIN),
                  ]),
                  u32(1_000),
                ),
                add(
                  mul(
                    call("lexerTokenEmitStatus", [
                      u32(RUNTIME_LEXER_TOKEN_TRIVIA),
                      u32(0),
                    ]),
                    u32(100),
                  ),
                  add(
                    mul(
                      call("lexerTokenEmitStatus", [
                        u32(RUNTIME_LEXER_TOKEN_TRIVIA),
                        u32(1),
                      ]),
                      u32(10),
                    ),
                    call("lexerTokenEmitStatus", [
                      u32(RUNTIME_LEXER_TOKEN_MAIN),
                      u32(0),
                    ]),
                  ),
                ),
              ),
            ),
          ),
        }],
      },
    ],
  };
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
  const lexerScanBoundaryRuntimeProgram: RuntimeLanguageProgram = {
    ...lexerScanBaseProgram,
    name: "lexer_scan_boundary_conformance",
    entry: "main",
    functions: [
      ...lexerScanBaseProgram.functions,
      {
        name: "main",
        locals: [{ name: "discard", type: "u32" }],
        result: "u32",
        body: [
          setLocal("discard", call("lexerScanReset", [])),
          setLocal("discard", call("lexerScanAdvance", [u32(0x41)])),
          {
            kind: "return",
            expression: add(
              mul(
                call("lexerScanNextOffset", [u32(7), u32(0x1f600)]),
                u32(100),
              ),
              call("lexerScanCandidateEnd", [u32(7)]),
            ),
          },
        ],
      },
    ],
  };
  const sourceTextBaseProgram = createSourceTextRuntimeProgram();
  const sourceTextStatusRuntimeProgram: RuntimeLanguageProgram = {
    ...sourceTextBaseProgram,
    name: "source_text_status_conformance",
    entry: "main",
    functions: [
      ...sourceTextBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            call("sourceTextTrailOffset", [u32(4)]),
            add(
              mul(
                call("sourceTextOffsetStatus", [u32(0), u32(1)]),
                u32(1),
              ),
              add(
                mul(
                  call("sourceTextOffsetStatus", [u32(1), u32(1)]),
                  u32(10),
                ),
                add(
                  mul(
                    call("sourceTextSpanStatus", [u32(2), u32(1), u32(3)]),
                    u32(100),
                  ),
                  add(
                    mul(
                      call("sourceTextSpanStatus", [u32(0), u32(4), u32(3)]),
                      u32(1_000),
                    ),
                    add(
                      mul(
                        call("sourceTextSpanStatus", [
                          u32(1),
                          u32(3),
                          u32(3),
                        ]),
                        u32(10_000),
                      ),
                      add(
                        mul(
                          call("sourceTextHasTrailUnit", [u32(0), u32(2)]),
                          u32(100_000),
                        ),
                        add(
                          mul(
                            call("sourceTextHasTrailUnit", [
                              u32(1),
                              u32(2),
                            ]),
                            u32(1_000_000),
                          ),
                          mul(
                            call("sourceTextHasTrailUnit", [
                              u32(0),
                              u32(1),
                            ]),
                            u32(10_000_000),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        }],
      },
    ],
  };
  const sourceTextCodePointRuntimeProgram: RuntimeLanguageProgram = {
    ...sourceTextBaseProgram,
    name: "source_text_code_point_conformance",
    entry: "main",
    functions: [
      ...sourceTextBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(
              call("sourceTextNextOffset", [u32(7), u32(0x1f600)]),
              u32(1_000_000),
            ),
            add(
              mul(
                call("sourceTextNextOffset", [u32(7), u32(0xd83d)]),
                u32(100_000),
              ),
              add(
                mul(
                  call("sourceTextNextOffset", [u32(7), u32(0x2028)]),
                  u32(10_000),
                ),
                add(
                  mul(
                    call("sourceTextNextOffset", [u32(7), u32(0)]),
                    u32(1_000),
                  ),
                  add(
                    call("sourceTextCodePointFromUnits", [
                      u32(0xd83d),
                      u32(0xde00),
                      u32(1),
                    ]),
                    add(
                      call("sourceTextCodePointFromUnits", [
                        u32(0xd83d),
                        u32(0),
                        u32(0),
                      ]),
                      add(
                        call("sourceTextCodePointFromUnits", [
                          u32(0x2028),
                          u32(0),
                          u32(0),
                        ]),
                        add(
                          mul(
                            call("sourceTextCodePointFromUnits", [
                              u32(0x0d),
                              u32(0x0a),
                              u32(1),
                            ]),
                            u32(1_000),
                          ),
                          add(
                            mul(
                              call("sourceTextCodePointFromUnits", [
                                u32(0x0a),
                                u32(0),
                                u32(0),
                              ]),
                              u32(100),
                            ),
                            call("sourceTextCodePointFromUnits", [
                              u32(0),
                              u32(0),
                              u32(0),
                            ]),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        }],
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
  const parserActionBaseProgram = createParserActionRuntimeProgram();
  const parserActionRuntimeProgram: RuntimeLanguageProgram = {
    ...parserActionBaseProgram,
    name: "parser_action_conformance",
    entry: "main",
    functions: [
      ...parserActionBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            call("parserActionKind", [u32(RUNTIME_ACTION_REDUCE + 42)]),
            call("parserActionPayload", [u32(RUNTIME_ACTION_REDUCE + 42)]),
          ),
        }],
      },
    ],
  };
  const parserReplayActionStatusProgram: RuntimeLanguageProgram = {
    ...parserActionBaseProgram,
    name: "parser_replay_action_status_conformance",
    entry: "main",
    functions: [
      ...parserActionBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(
              call("parserReplayActionStatus", [u32(RUNTIME_ACTION_SHIFT)]),
              u32(1_000),
            ),
            add(
              mul(
                call("parserReplayActionStatus", [
                  u32(RUNTIME_ACTION_REDUCE),
                ]),
                u32(100),
              ),
              add(
                mul(
                  call("parserReplayActionStatus", [
                    u32(RUNTIME_ACTION_ACCEPT),
                  ]),
                  u32(10),
                ),
                call("parserReplayActionStatus", [u32(99)]),
              ),
            ),
          ),
        }],
      },
    ],
  };
  const parserGotoRuntimeProgram = createParserGotoRuntimeProgram({
    gotoRows: [
      [
        [8, 13],
      ],
      [],
    ],
  });
  const parserExpectedBaseProgram = createParserExpectedRuntimeProgram({
    rowLengths: [2, 0, 3],
    rowHasEof: [true, false, true],
  });
  const parserExpectedRuntimeProgram: RuntimeLanguageProgram = {
    ...parserExpectedBaseProgram,
    name: "parser_expected_conformance",
    entry: "main",
    functions: [
      ...parserExpectedBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(
              add(
                mul(call("parserExpectedHasEof", [u32(0)]), u32(10000)),
                add(
                  mul(call("parserExpectedEnd", [u32(0)]), u32(1000)),
                  add(
                    mul(call("parserExpectedHasEof", [u32(1)]), u32(100)),
                    add(
                      mul(call("parserExpectedStart", [u32(2)]), u32(10)),
                      add(
                        call("parserExpectedEnd", [u32(2)]),
                        call("parserExpectedHasEof", [u32(2)]),
                      ),
                    ),
                  ),
                ),
              ),
              u32(1000),
            ),
            add(
              mul(
                call("parserUnexpectedDiagnosticCode", [u32(0), u32(0)]),
                u32(100),
              ),
              add(
                mul(
                  call("parserUnexpectedDiagnosticCode", [u32(0), u32(1)]),
                  u32(10),
                ),
                call("parserUnexpectedDiagnosticCode", [u32(1), u32(0)]),
              ),
            ),
          ),
        }],
      },
    ],
  };
  const parserFieldBaseProgram = createParserFieldRuntimeProgram({
    fieldRows: [
      [[2, RUNTIME_FIELD_ARRAY], [5, RUNTIME_FIELD_NULLABLE]],
      [],
      [[7, 0]],
    ],
  });
  const parserFieldRuntimeProgram: RuntimeLanguageProgram = {
    ...parserFieldBaseProgram,
    name: "parser_field_conformance",
    entry: "main",
    functions: [
      ...parserFieldBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(call("parserFieldEnd", [u32(0)]), u32(1_000_000_000)),
            add(
              mul(call("parserFieldId", [u32(1)]), u32(100_000_000)),
              add(
                mul(call("parserFieldFlags", [u32(1)]), u32(10_000_000)),
                add(
                  mul(
                    call("parserFieldValueClass", [u32(0)]),
                    u32(1_000_000),
                  ),
                  add(
                    mul(
                      call("parserFieldValueClass", [u32(1)]),
                      u32(100_000),
                    ),
                    add(
                      mul(
                        call("parserFieldValueClass", [u32(2)]),
                        u32(10_000),
                      ),
                      add(
                        mul(
                          call("parserFieldCaptureStatus", [u32(0), u32(2)]),
                          u32(1_000),
                        ),
                        add(
                          mul(
                            call("parserFieldCaptureStatus", [
                              u32(2),
                              u32(1),
                            ]),
                            u32(100),
                          ),
                          add(
                            mul(
                              call("parserFieldCaptureStatus", [
                                u32(2),
                                u32(2),
                              ]),
                              u32(10),
                            ),
                            add(
                              call("parserFieldFinalStatus", [u32(2), u32(0)]),
                              add(
                                call("parserFieldFinalStatus", [
                                  u32(1),
                                  u32(2),
                                ]),
                                call("parserFieldFinalStatus", [
                                  u32(1),
                                  u32(1),
                                ]),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        }],
      },
    ],
  };
  const parserFieldSchemaStatusProgram: RuntimeLanguageProgram = {
    ...parserFieldBaseProgram,
    name: "parser_field_schema_status_conformance",
    entry: "main",
    functions: [
      ...parserFieldBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(
              call("parserFieldSchemaStatus", [u32(0), u32(2), u32(0)]),
              u32(1_000),
            ),
            add(
              mul(
                call("parserFieldSchemaStatus", [u32(2), u32(2), u32(0)]),
                u32(100),
              ),
              add(
                mul(
                  call("parserFieldSchemaStatus", [u32(2), u32(2), u32(1)]),
                  u32(10),
                ),
                call("parserFieldSchemaStatus", [u32(3), u32(2), u32(1)]),
              ),
            ),
          ),
        }],
      },
    ],
  };
  const parserFieldBuildStatusProgram: RuntimeLanguageProgram = {
    ...parserFieldBaseProgram,
    name: "parser_field_build_status_conformance",
    entry: "main",
    functions: [
      ...parserFieldBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(
              call("parserFieldBuildStatus", [
                u32(0),
                u32(2),
                u32(RUNTIME_FIELD_SCHEMA_STATUS_OK),
              ]),
              u32(100),
            ),
            add(
              mul(
                call("parserFieldBuildStatus", [
                  u32(2),
                  u32(2),
                  u32(RUNTIME_FIELD_SCHEMA_STATUS_OK),
                ]),
                u32(10),
              ),
              call("parserFieldBuildStatus", [
                u32(2),
                u32(2),
                u32(RUNTIME_FIELD_SCHEMA_STATUS_CAPTURE_WITHOUT_SCHEMA),
              ]),
            ),
          ),
        }],
      },
    ],
  };
  const parserFieldStorageStatusProgram: RuntimeLanguageProgram = {
    ...parserFieldBaseProgram,
    name: "parser_field_storage_status_conformance",
    entry: "main",
    functions: [
      ...parserFieldBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(call("parserFieldStorageStatus", [u32(0)]), u32(100)),
            add(
              mul(call("parserFieldStorageStatus", [u32(1)]), u32(10)),
              call("parserFieldStorageStatus", [u32(999)]),
            ),
          ),
        }],
      },
    ],
  };
  const parserFieldEntryStatusProgram: RuntimeLanguageProgram = {
    ...parserFieldBaseProgram,
    name: "parser_field_entry_status_conformance",
    entry: "main",
    functions: [
      ...parserFieldBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(call("parserFieldEntryStatus", [u32(0)]), u32(10)),
            call("parserFieldEntryStatus", [u32(RUNTIME_NO_FIELD)]),
          ),
        }],
      },
    ],
  };
  const parserFieldFinalBuildStatusProgram: RuntimeLanguageProgram = {
    ...parserFieldBaseProgram,
    name: "parser_field_final_build_status_conformance",
    entry: "main",
    functions: [
      ...parserFieldBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(
              call("parserFieldFinalBuildStatus", [u32(0), u32(0)]),
              u32(10_000),
            ),
            add(
              mul(
                call("parserFieldFinalBuildStatus", [u32(1), u32(2)]),
                u32(1_000),
              ),
              add(
                mul(
                  call("parserFieldFinalBuildStatus", [u32(1), u32(1)]),
                  u32(100),
                ),
                add(
                  mul(
                    call("parserFieldFinalBuildStatus", [u32(2), u32(0)]),
                    u32(10),
                  ),
                  call("parserFieldFinalBuildStatus", [u32(2), u32(1)]),
                ),
              ),
            ),
          ),
        }],
      },
    ],
  };
  const parserFieldScalarValueStatusProgram: RuntimeLanguageProgram = {
    ...parserFieldBaseProgram,
    name: "parser_field_scalar_value_status_conformance",
    entry: "main",
    functions: [
      ...parserFieldBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(call("parserFieldScalarValueStatus", [u32(0)]), u32(10)),
            call("parserFieldScalarValueStatus", [u32(2)]),
          ),
        }],
      },
    ],
  };
  const parserFieldArrayValueStatusProgram: RuntimeLanguageProgram = {
    ...parserFieldBaseProgram,
    name: "parser_field_array_value_status_conformance",
    entry: "main",
    functions: [
      ...parserFieldBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(call("parserFieldArrayValueStatus", [u32(0)]), u32(10)),
            call("parserFieldArrayValueStatus", [u32(9)]),
          ),
        }],
      },
    ],
  };
  const parserProductionBaseProgram = createParserProductionRuntimeProgram({
    productions: [
      [4, 0],
      [7, 2],
    ],
  });
  const parserProductionRuntimeProgram: RuntimeLanguageProgram = {
    ...parserProductionBaseProgram,
    name: "parser_production_conformance",
    entry: "main",
    functions: [
      ...parserProductionBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(call("parserProductionLhs", [u32(0)]), u32(1000)),
            add(
              mul(call("parserProductionRhsLength", [u32(0)]), u32(100)),
              add(
                mul(call("parserProductionLhs", [u32(1)]), u32(10)),
                add(
                  call("parserProductionRhsLength", [u32(1)]),
                  eq(
                    call("parserProductionLhs", [u32(99)]),
                    u32(RUNTIME_NO_PRODUCTION),
                  ),
                ),
              ),
            ),
          ),
        }],
      },
    ],
  };
  const parserReducerBaseProgram = createParserReducerRuntimeProgram({
    reducers: [
      [RUNTIME_REDUCER_RULE, 4],
      [RUNTIME_REDUCER_FIELD, 2],
      [RUNTIME_REDUCER_SEQUENCE, RUNTIME_NO_REDUCER_PAYLOAD],
      [RUNTIME_REDUCER_RULE, RUNTIME_NO_REDUCER_PAYLOAD],
      [RUNTIME_REDUCER_FIELD, RUNTIME_NO_REDUCER_PAYLOAD],
    ],
  });
  const parserReducerRuntimeProgram: RuntimeLanguageProgram = {
    ...parserReducerBaseProgram,
    name: "parser_reducer_conformance",
    entry: "main",
    functions: [
      ...parserReducerBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(call("parserReducerKind", [u32(0)]), u32(100_000_000)),
            add(
              mul(call("parserReducerPayload", [u32(0)]), u32(10_000_000)),
              add(
                mul(
                  call("parserReducerOperation", [u32(0)]),
                  u32(1_000_000),
                ),
                add(
                  mul(call("parserReducerKind", [u32(1)]), u32(100_000)),
                  add(
                    mul(call("parserReducerPayload", [u32(1)]), u32(10_000)),
                    add(
                      mul(
                        call("parserReducerOperation", [u32(1)]),
                        u32(1_000),
                      ),
                      add(
                        mul(
                          call("parserReducerOperation", [u32(2)]),
                          u32(100),
                        ),
                        add(
                          mul(
                            eq(
                              call("parserReducerKind", [u32(99)]),
                              u32(RUNTIME_REDUCER_UNKNOWN),
                            ),
                            u32(10),
                          ),
                          add(
                            call("parserReducerOperation", [u32(99)]),
                            add(
                              call("parserReducerPayloadStatus", [u32(0)]),
                              add(
                                mul(
                                  call("parserReducerPayloadStatus", [u32(3)]),
                                  u32(100),
                                ),
                                add(
                                  mul(
                                    call("parserReducerPayloadStatus", [
                                      u32(4),
                                    ]),
                                    u32(10),
                                  ),
                                  add(
                                    call("parserReducerPayloadStatus", [
                                      u32(99),
                                    ]),
                                    add(
                                      mul(
                                        call("parserReducerChildRole", [
                                          u32(RUNTIME_REDUCER_OPERATION_START),
                                          u32(0),
                                        ]),
                                        u32(1_000_000_000),
                                      ),
                                      add(
                                        mul(
                                          call("parserReducerChildRole", [
                                            u32(
                                              RUNTIME_REDUCER_OPERATION_TERMINAL,
                                            ),
                                            u32(0),
                                          ]),
                                          u32(100_000_000),
                                        ),
                                        add(
                                          mul(
                                            call("parserReducerChildRole", [
                                              u32(
                                                RUNTIME_REDUCER_OPERATION_RULE_REF,
                                              ),
                                              u32(0),
                                            ]),
                                            u32(10_000_000),
                                          ),
                                          add(
                                            mul(
                                              call("parserReducerChildRole", [
                                                u32(
                                                  RUNTIME_REDUCER_OPERATION_SEQUENCE,
                                                ),
                                                u32(7),
                                              ]),
                                              u32(1_000_000),
                                            ),
                                            add(
                                              mul(
                                                call("parserReducerChildRole", [
                                                  u32(
                                                    RUNTIME_REDUCER_OPERATION_SEPARATED_APPEND,
                                                  ),
                                                  u32(2),
                                                ]),
                                                u32(100_000),
                                              ),
                                              add(
                                                call("parserReducerChildRole", [
                                                  u32(
                                                    RUNTIME_REDUCER_OPERATION_FIELD,
                                                  ),
                                                  u32(1),
                                                ]),
                                                add(
                                                  call(
                                                    "parserReducerResultKind",
                                                    [
                                                      u32(
                                                        RUNTIME_REDUCER_OPERATION_START,
                                                      ),
                                                    ],
                                                  ),
                                                  add(
                                                    call(
                                                      "parserReducerResultKind",
                                                      [
                                                        u32(
                                                          RUNTIME_REDUCER_OPERATION_RULE,
                                                        ),
                                                      ],
                                                    ),
                                                    add(
                                                      call(
                                                        "parserReducerResultKind",
                                                        [
                                                          u32(
                                                            RUNTIME_REDUCER_OPERATION_TERMINAL,
                                                          ),
                                                        ],
                                                      ),
                                                      add(
                                                        call(
                                                          "parserReducerResultKind",
                                                          [
                                                            u32(
                                                              RUNTIME_REDUCER_OPERATION_SEPARATED_APPEND,
                                                            ),
                                                          ],
                                                        ),
                                                        add(
                                                          call(
                                                            "parserReducerResultKind",
                                                            [
                                                              u32(99),
                                                            ],
                                                          ),
                                                          call(
                                                            "parserReducerResultKind",
                                                            [
                                                              u32(
                                                                RUNTIME_REDUCER_OPERATION_SEQUENCE,
                                                              ),
                                                            ],
                                                          ),
                                                        ),
                                                      ),
                                                    ),
                                                  ),
                                                ),
                                              ),
                                            ),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        }],
      },
    ],
  };
  const parserReplayReductionStatusProgram: RuntimeLanguageProgram = {
    ...parserReducerBaseProgram,
    name: "parser_replay_reduction_status_conformance",
    entry: "main",
    functions: [
      ...parserReducerBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(
              eq(
                call("parserReplayReductionStatus", [
                  u32(1),
                  u32(RUNTIME_REDUCER_OPERATION_RULE),
                  u32(RUNTIME_REDUCER_PAYLOAD_STATUS_OK),
                  u32(1),
                ]),
                u32(RUNTIME_REPLAY_REDUCTION_STATUS_OK),
              ),
              u32(10_000),
            ),
            add(
              mul(
                call("parserReplayReductionStatus", [
                  u32(RUNTIME_NO_PRODUCTION),
                  u32(RUNTIME_REDUCER_OPERATION_UNKNOWN),
                  u32(RUNTIME_REDUCER_PAYLOAD_STATUS_UNKNOWN),
                  u32(0),
                ]),
                u32(1_000),
              ),
              add(
                mul(
                  call("parserReplayReductionStatus", [
                    u32(1),
                    u32(RUNTIME_REDUCER_OPERATION_RULE),
                    u32(RUNTIME_REDUCER_PAYLOAD_STATUS_RULE_MISSING),
                    u32(1),
                  ]),
                  u32(100),
                ),
                add(
                  mul(
                    call("parserReplayReductionStatus", [
                      u32(1),
                      u32(RUNTIME_REDUCER_OPERATION_FIELD),
                      u32(RUNTIME_REDUCER_PAYLOAD_STATUS_FIELD_MISSING),
                      u32(1),
                    ]),
                    u32(10),
                  ),
                  call("parserReplayReductionStatus", [
                    u32(2),
                    u32(RUNTIME_REDUCER_OPERATION_SEQUENCE),
                    u32(RUNTIME_REDUCER_PAYLOAD_STATUS_OK),
                    u32(1),
                  ]),
                ),
              ),
            ),
          ),
        }],
      },
    ],
  };
  const parserReplayRhsStartProgram: RuntimeLanguageProgram = {
    ...parserReducerBaseProgram,
    name: "parser_replay_rhs_start_conformance",
    entry: "main",
    functions: [
      ...parserReducerBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(call("parserReplayRhsStart", [u32(5), u32(0)]), u32(100)),
            add(
              mul(call("parserReplayRhsStart", [u32(5), u32(2)]), u32(10)),
              call("parserReplayRhsStart", [u32(1), u32(1)]),
            ),
          ),
        }],
      },
    ],
  };
  const parserReplayStackDepthProgram: RuntimeLanguageProgram = {
    ...parserReducerBaseProgram,
    name: "parser_replay_stack_depth_conformance",
    entry: "main",
    functions: [
      ...parserReducerBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(call("parserReplayStackDepth", [u32(5)]), u32(100)),
            add(
              mul(call("parserReplayStackDepth", [u32(1)]), u32(10)),
              call("parserReplayStackDepth", [u32(0)]),
            ),
          ),
        }],
      },
    ],
  };
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
      productions: [
        [0, 1],
        [2, 0],
        [1, 3],
      ],
    });
  const parserConflictActionCountRuntimeProgram: RuntimeLanguageProgram = {
    ...parserConflictTableRuntimeProgram,
    name: "parser_conflict_action_count_conformance",
    entry: "main",
    functions: [
      ...parserConflictTableRuntimeProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(call("parserActionCount", [u32(0), u32(1)]), u32(100)),
            add(
              mul(call("parserActionCount", [u32(0), u32(5)]), u32(10)),
              call("parserActionCount", [u32(0), u32(3)]),
            ),
          ),
        }],
      },
    ],
  };
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
          setLocal(
            "result",
            add(
              local("result"),
              call("parserTraceStatusKind", [
                u32(RUNTIME_TRACE_STATUS_UNEXPECTED),
              ]),
            ),
          ),
          setLocal(
            "result",
            add(
              local("result"),
              mul(
                call("parserTraceStatusKind", [
                  u32(RUNTIME_TRACE_STATUS_BRANCH_LIMIT),
                ]),
                u32(10),
              ),
            ),
          ),
          setLocal(
            "result",
            add(
              local("result"),
              mul(
                call("parserTraceStatusKind", [u32(99)]),
                u32(100),
              ),
            ),
          ),
          { kind: "return", expression: local("result") },
        ],
      },
    ],
  };
  const parserConflictTraceBaseProgram =
    createParserConflictTraceRuntimeProgram({
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
    });
  const parserConflictTraceRuntimeProgram: RuntimeLanguageProgram = {
    ...parserConflictTraceBaseProgram,
    name: "parser_conflict_trace_conformance",
    entry: "main",
    functions: [
      ...parserConflictTraceBaseProgram.functions,
      {
        name: "main",
        locals: [
          { name: "result", type: "u32" },
        ],
        result: "u32",
        body: [
          setLocal(
            "result",
            call("parserTraceSetTerminal", [u32(0), u32(1)]),
          ),
          setLocal(
            "result",
            call("parserTraceSetTerminal", [u32(1), u32(2)]),
          ),
          setLocal(
            "result",
            call("parserTraceSetTerminal", [u32(2), u32(0)]),
          ),
          setLocal("result", call("parserTrace", [u32(3)])),
          {
            kind: "if",
            condition: local("result"),
            consequent: [
              { kind: "return", expression: local("result") },
            ],
          },
          setLocal("result", call("parserTraceCount", [])),
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
              u32(RUNTIME_ACTION_REDUCE + 2),
            ),
            consequent: [
              setLocal("result", add(local("result"), u32(100))),
            ],
          },
          {
            kind: "if",
            condition: eq(
              call("parserTraceAction", [u32(2)]),
              u32(RUNTIME_ACTION_SHIFT + 5),
            ),
            consequent: [
              setLocal("result", add(local("result"), u32(1000))),
            ],
          },
          {
            kind: "if",
            condition: eq(
              call("parserTraceAction", [u32(3)]),
              u32(RUNTIME_ACTION_REDUCE),
            ),
            consequent: [
              setLocal("result", add(local("result"), u32(10000))),
            ],
          },
          {
            kind: "if",
            condition: eq(
              call("parserTraceAction", [u32(4)]),
              u32(RUNTIME_ACTION_ACCEPT),
            ),
            consequent: [
              setLocal("result", add(local("result"), u32(100000))),
            ],
          },
          setLocal(
            "result",
            add(
              local("result"),
              call("parserTraceStatusKind", [
                u32(RUNTIME_TRACE_STATUS_UNEXPECTED),
              ]),
            ),
          ),
          setLocal(
            "result",
            add(
              local("result"),
              mul(
                call("parserTraceStatusKind", [
                  u32(RUNTIME_TRACE_STATUS_BRANCH_LIMIT),
                ]),
                u32(10),
              ),
            ),
          ),
          setLocal(
            "result",
            add(
              local("result"),
              mul(
                call("parserTraceStatusKind", [u32(99)]),
                u32(100),
              ),
            ),
          ),
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
  const arenaArrayProgram: RuntimeLanguageProgram = {
    ...RUNTIME_ARENA_PROGRAM,
    name: "arena_array_conformance",
    entry: "main",
    functions: [
      ...RUNTIME_ARENA_PROGRAM.functions,
      {
        name: "main",
        locals: [
          { name: "discard", type: "u32" },
          { name: "handle", type: "u32" },
        ],
        result: "u32",
        body: [
          setLocal("discard", call("runtimeArenaReset", [])),
          setLocal("handle", call("runtimeArrayNew", [u32(3)])),
          setLocal(
            "discard",
            call("runtimeArrayStore", [local("handle"), u32(0), u32(7)]),
          ),
          setLocal(
            "discard",
            call("runtimeArrayStore", [local("handle"), u32(2), u32(11)]),
          ),
          {
            kind: "return",
            expression: add(
              mul(call("runtimeArenaUsed", []), u32(1_000)),
              add(
                mul(
                  call("runtimeArrayLength", [local("handle")]),
                  u32(100),
                ),
                add(
                  mul(
                    call("runtimeArrayLoad", [local("handle"), u32(0)]),
                    u32(10),
                  ),
                  call("runtimeArrayLoad", [local("handle"), u32(2)]),
                ),
              ),
            ),
          },
        ],
      },
    ],
  };
  const arenaRecordProgram: RuntimeLanguageProgram = {
    ...RUNTIME_ARENA_PROGRAM,
    name: "arena_record_conformance",
    entry: "main",
    functions: [
      ...RUNTIME_ARENA_PROGRAM.functions,
      {
        name: "main",
        locals: [
          { name: "discard", type: "u32" },
          { name: "handle", type: "u32" },
        ],
        result: "u32",
        body: [
          setLocal("discard", call("runtimeArenaReset", [])),
          setLocal("handle", call("runtimeRecordNew", [u32(42), u32(2)])),
          setLocal(
            "discard",
            call("runtimeRecordStore", [local("handle"), u32(0), u32(7)]),
          ),
          setLocal(
            "discard",
            call("runtimeRecordStore", [local("handle"), u32(1), u32(11)]),
          ),
          {
            kind: "return",
            expression: add(
              mul(call("runtimeArenaUsed", []), u32(1_000_000)),
              add(
                mul(call("runtimeObjectKind", [local("handle")]), u32(100_000)),
                add(
                  mul(call("runtimeRecordTag", [local("handle")]), u32(1_000)),
                  add(
                    mul(
                      call("runtimeRecordFieldCount", [local("handle")]),
                      u32(100),
                    ),
                    add(
                      mul(
                        call("runtimeRecordLoad", [local("handle"), u32(0)]),
                        u32(10),
                      ),
                      call("runtimeRecordLoad", [local("handle"), u32(1)]),
                    ),
                  ),
                ),
              ),
            ),
          },
        ],
      },
    ],
  };
  const arenaVectorProgram: RuntimeLanguageProgram = {
    ...RUNTIME_ARENA_PROGRAM,
    name: "arena_vector_conformance",
    entry: "main",
    functions: [
      ...RUNTIME_ARENA_PROGRAM.functions,
      {
        name: "main",
        locals: [
          { name: "discard", type: "u32" },
          { name: "handle", type: "u32" },
          { name: "clone", type: "u32" },
        ],
        result: "u32",
        body: [
          setLocal("discard", call("runtimeArenaReset", [])),
          setLocal("handle", call("runtimeVectorNew", [u32(1)])),
          setLocal(
            "discard",
            call("runtimeVectorAppend", [local("handle"), u32(5)]),
          ),
          setLocal(
            "discard",
            call("runtimeVectorAppend", [local("handle"), u32(7)]),
          ),
          setLocal(
            "discard",
            call("runtimeVectorAppend", [local("handle"), u32(11)]),
          ),
          setLocal(
            "discard",
            call("runtimeVectorStore", [local("handle"), u32(1), u32(9)]),
          ),
          setLocal(
            "discard",
            call("runtimeVectorTruncate", [local("handle"), u32(2)]),
          ),
          setLocal(
            "discard",
            call("runtimeVectorAppend", [local("handle"), u32(13)]),
          ),
          setLocal("clone", call("runtimeVectorClone", [local("handle")])),
          setLocal(
            "discard",
            call("runtimeVectorStore", [local("handle"), u32(0), u32(4)]),
          ),
          {
            kind: "return",
            expression: add(
              mul(call("runtimeArenaUsed", []), u32(1_000_000)),
              add(
                mul(
                  call("runtimeVectorLength", [local("handle")]),
                  u32(100_000),
                ),
                add(
                  mul(
                    call("runtimeVectorCapacity", [local("handle")]),
                    u32(10_000),
                  ),
                  add(
                    mul(
                      call("runtimeVectorLoad", [local("handle"), u32(0)]),
                      u32(1000),
                    ),
                    add(
                      mul(
                        call("runtimeVectorLoad", [local("handle"), u32(1)]),
                        u32(100),
                      ),
                      add(
                        mul(
                          call("runtimeVectorLoad", [local("handle"), u32(2)]),
                          u32(10),
                        ),
                        call("runtimeVectorLoad", [local("clone"), u32(0)]),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          },
        ],
      },
    ],
  };
  const arenaResetProgram: RuntimeLanguageProgram = {
    ...RUNTIME_ARENA_PROGRAM,
    name: "arena_reset_conformance",
    entry: "main",
    functions: [
      ...RUNTIME_ARENA_PROGRAM.functions,
      {
        name: "main",
        locals: [
          { name: "discard", type: "u32" },
          { name: "handle", type: "u32" },
        ],
        result: "u32",
        body: [
          setLocal("discard", call("runtimeArenaReset", [])),
          setLocal("handle", call("runtimeArrayNew", [u32(2)])),
          setLocal(
            "discard",
            call("runtimeArrayStore", [local("handle"), u32(1), u32(99)]),
          ),
          setLocal("discard", call("runtimeArenaReset", [])),
          setLocal("handle", call("runtimeArrayNew", [u32(1)])),
          {
            kind: "return",
            expression: add(
              mul(call("runtimeArenaUsed", []), u32(10)),
              call("runtimeArrayLoad", [local("handle"), u32(0)]),
            ),
          },
        ],
      },
    ],
  };
  const arenaArrayBoundsProgram: RuntimeLanguageProgram = {
    ...RUNTIME_ARENA_PROGRAM,
    name: "arena_array_bounds",
    entry: "main",
    functions: [
      ...RUNTIME_ARENA_PROGRAM.functions,
      {
        name: "main",
        locals: [
          { name: "discard", type: "u32" },
          { name: "handle", type: "u32" },
        ],
        result: "u32",
        body: [
          setLocal("discard", call("runtimeArenaReset", [])),
          setLocal("handle", call("runtimeArrayNew", [u32(1)])),
          {
            kind: "return",
            expression: call("runtimeArrayLoad", [local("handle"), u32(1)]),
          },
        ],
      },
    ],
  };
  const arenaRecordBoundsProgram: RuntimeLanguageProgram = {
    ...RUNTIME_ARENA_PROGRAM,
    name: "arena_record_bounds",
    entry: "main",
    functions: [
      ...RUNTIME_ARENA_PROGRAM.functions,
      {
        name: "main",
        locals: [
          { name: "discard", type: "u32" },
          { name: "handle", type: "u32" },
        ],
        result: "u32",
        body: [
          setLocal("discard", call("runtimeArenaReset", [])),
          setLocal("handle", call("runtimeRecordNew", [u32(7), u32(1)])),
          {
            kind: "return",
            expression: call("runtimeRecordLoad", [local("handle"), u32(1)]),
          },
        ],
      },
    ],
  };
  const arenaVectorBoundsProgram: RuntimeLanguageProgram = {
    ...RUNTIME_ARENA_PROGRAM,
    name: "arena_vector_bounds",
    entry: "main",
    functions: [
      ...RUNTIME_ARENA_PROGRAM.functions,
      {
        name: "main",
        locals: [
          { name: "discard", type: "u32" },
          { name: "handle", type: "u32" },
        ],
        result: "u32",
        body: [
          setLocal("discard", call("runtimeArenaReset", [])),
          setLocal("handle", call("runtimeVectorNew", [u32(0)])),
          {
            kind: "return",
            expression: call("runtimeVectorLoad", [local("handle"), u32(0)]),
          },
        ],
      },
    ],
  };
  const arenaVectorTruncateGrowProgram: RuntimeLanguageProgram = {
    ...RUNTIME_ARENA_PROGRAM,
    name: "arena_vector_truncate_grow",
    entry: "main",
    functions: [
      ...RUNTIME_ARENA_PROGRAM.functions,
      {
        name: "main",
        locals: [
          { name: "discard", type: "u32" },
          { name: "handle", type: "u32" },
        ],
        result: "u32",
        body: [
          setLocal("discard", call("runtimeArenaReset", [])),
          setLocal("handle", call("runtimeVectorNew", [u32(2)])),
          {
            kind: "return",
            expression: call("runtimeVectorTruncate", [
              local("handle"),
              u32(1),
            ]),
          },
        ],
      },
    ],
  };
  const arenaWrongKindProgram: RuntimeLanguageProgram = {
    ...RUNTIME_ARENA_PROGRAM,
    name: "arena_wrong_kind",
    entry: "main",
    functions: [
      ...RUNTIME_ARENA_PROGRAM.functions,
      {
        name: "main",
        locals: [
          { name: "discard", type: "u32" },
          { name: "handle", type: "u32" },
        ],
        result: "u32",
        body: [
          setLocal("discard", call("runtimeArenaReset", [])),
          setLocal("handle", call("runtimeArrayNew", [u32(1)])),
          {
            kind: "return",
            expression: call("runtimeRecordTag", [local("handle")]),
          },
        ],
      },
    ],
  };
  const arenaVectorWrongKindProgram: RuntimeLanguageProgram = {
    ...RUNTIME_ARENA_PROGRAM,
    name: "arena_vector_wrong_kind",
    entry: "main",
    functions: [
      ...RUNTIME_ARENA_PROGRAM.functions,
      {
        name: "main",
        locals: [
          { name: "discard", type: "u32" },
          { name: "handle", type: "u32" },
        ],
        result: "u32",
        body: [
          setLocal("discard", call("runtimeArenaReset", [])),
          setLocal("handle", call("runtimeArrayNew", [u32(1)])),
          {
            kind: "return",
            expression: call("runtimeVectorLength", [local("handle")]),
          },
        ],
      },
    ],
  };
  const parserObjectBaseProgram = createParserObjectRuntimeProgram();
  const parserReplayProductionProgram = createParserProductionRuntimeProgram({
    productions: [
      [0, 1],
      [7, 1],
    ],
  });
  const parserReplayReducerProgram = createParserReducerRuntimeProgram({
    reducers: [
      [RUNTIME_REDUCER_START, RUNTIME_NO_REDUCER_PAYLOAD],
      [RUNTIME_REDUCER_RULE, 7],
    ],
  });
  const parserReplayRuntimeProgram = createParserReplayRuntimeProgram();
  const parserReplayActionProgram = createParserActionRuntimeProgram();
  const parserReplayVmProgram: RuntimeLanguageProgram = {
    name: "parser_replay_vm_conformance",
    entry: "main",
    scratchMemoryWords: parserObjectBaseProgram.scratchMemoryWords,
    tables: [
      ...(parserObjectBaseProgram.tables ?? []),
      ...(parserReplayProductionProgram.tables ?? []),
      ...(parserReplayReducerProgram.tables ?? []),
      ...(parserReplayActionProgram.tables ?? []),
      ...(parserReplayRuntimeProgram.tables ?? []),
    ],
    functions: [
      ...parserObjectBaseProgram.functions,
      ...parserReplayProductionProgram.functions,
      ...parserReplayReducerProgram.functions,
      ...parserReplayActionProgram.functions,
      ...parserReplayRuntimeProgram.functions,
      {
        name: "main",
        locals: [
          { name: "trace", type: "u32" },
          { name: "tokens", type: "u32" },
          { name: "indices", type: "u32" },
          { name: "token", type: "u32" },
          { name: "eof", type: "u32" },
          { name: "result", type: "u32" },
          { name: "status", type: "u32" },
          { name: "root", type: "u32" },
          { name: "discard", type: "u32" },
        ],
        result: "u32",
        body: [
          setLocal("discard", call("runtimeArenaReset", [])),
          setLocal("trace", call("runtimeVectorNew", [u32(4)])),
          setLocal(
            "discard",
            call("runtimeVectorAppend", [
              local("trace"),
              u32(RUNTIME_ACTION_SHIFT),
            ]),
          ),
          setLocal(
            "discard",
            call("runtimeVectorAppend", [
              local("trace"),
              u32(RUNTIME_ACTION_REDUCE + 1),
            ]),
          ),
          setLocal(
            "discard",
            call("runtimeVectorAppend", [
              local("trace"),
              u32(RUNTIME_ACTION_REDUCE),
            ]),
          ),
          setLocal(
            "discard",
            call("runtimeVectorAppend", [
              local("trace"),
              u32(RUNTIME_ACTION_ACCEPT),
            ]),
          ),
          setLocal("tokens", call("runtimeVectorNew", [u32(2)])),
          setLocal("indices", call("runtimeVectorNew", [u32(2)])),
          setLocal(
            "token",
            call("parserTokenNew", [
              u32(RUNTIME_PUBLIC_TOKEN_LITERAL),
              u32(0),
              u32(1),
              u32(0),
              u32(1),
            ]),
          ),
          setLocal(
            "discard",
            call("runtimeVectorAppend", [local("tokens"), local("token")]),
          ),
          setLocal(
            "discard",
            call("runtimeVectorAppend", [local("indices"), u32(0)]),
          ),
          setLocal(
            "eof",
            call("parserTokenNew", [
              u32(RUNTIME_PUBLIC_TOKEN_EOF),
              u32(0),
              u32(0),
              u32(1),
              u32(1),
            ]),
          ),
          setLocal(
            "discard",
            call("runtimeVectorAppend", [local("tokens"), local("eof")]),
          ),
          setLocal(
            "discard",
            call("runtimeVectorAppend", [local("indices"), u32(1)]),
          ),
          setLocal(
            "result",
            call("parserReplayVm", [
              local("trace"),
              local("tokens"),
              local("indices"),
            ]),
          ),
          setLocal(
            "status",
            call("parserReplayResultStatus", [local("result")]),
          ),
          {
            kind: "if",
            condition: eq(local("status"), u32(0)),
            consequent: [],
            alternate: [{
              kind: "return",
              expression: mul(local("status"), u32(10_000)),
            }],
          },
          setLocal("root", call("parserReplayResultRoot", [local("result")])),
          {
            kind: "return",
            expression: add(
              mul(local("status"), u32(10_000)),
              add(
                mul(call("parserRuleNodeRuleId", [local("root")]), u32(100)),
                add(
                  mul(
                    call("parserRuleNodeChildCount", [local("root")]),
                    u32(10),
                  ),
                  call("parserRuleNodeTokenEnd", [local("root")]),
                ),
              ),
            ),
          },
        ],
      },
    ],
  };
  const parserObjectProgram: RuntimeLanguageProgram = {
    ...parserObjectBaseProgram,
    name: "parser_object_conformance",
    entry: "main",
    functions: [
      ...parserObjectBaseProgram.functions,
      {
        name: "main",
        locals: [
          { name: "discard", type: "u32" },
          { name: "fragment", type: "u32" },
          { name: "child", type: "u32" },
          { name: "capture", type: "u32" },
          { name: "token", type: "u32" },
          { name: "tokenFragment", type: "u32" },
          { name: "diagnostic", type: "u32" },
          { name: "rule", type: "u32" },
        ],
        result: "u32",
        body: [
          setLocal("discard", call("runtimeArenaReset", [])),
          setLocal(
            "fragment",
            call("parserFragmentNew", [
              u32(77),
              u32(2),
              u32(5),
              u32(1),
              u32(3),
            ]),
          ),
          setLocal(
            "child",
            call("parserFragmentNew", [
              u32(88),
              u32(3),
              u32(4),
              u32(2),
              u32(3),
            ]),
          ),
          setLocal(
            "capture",
            call("parserFieldCaptureNew", [u32(9), local("child")]),
          ),
          setLocal(
            "token",
            call("parserTokenNew", [u32(2), u32(33), u32(44), u32(7), u32(11)]),
          ),
          setLocal(
            "tokenFragment",
            call("parserFragmentFromToken", [local("token"), u32(5)]),
          ),
          setLocal(
            "diagnostic",
            call("parserDiagnosticNew", [u32(6), u32(7), u32(11), u32(99)]),
          ),
          setLocal(
            "discard",
            call("parserFragmentAppendChild", [
              local("fragment"),
              local("child"),
            ]),
          ),
          setLocal(
            "discard",
            call("parserFragmentAppendField", [
              local("fragment"),
              local("capture"),
            ]),
          ),
          {
            kind: "if",
            condition: eq(
              call("parserFragmentChildAt", [local("fragment"), u32(0)]),
              local("child"),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(0) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserFieldCaptureValue", [
                call("parserFragmentFieldAt", [local("fragment"), u32(0)]),
              ]),
              local("child"),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(0) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserTokenClass", [local("token")]),
              u32(2),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(0) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserTokenPayload", [local("token")]),
              u32(33),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(0) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserTokenTerminal", [local("token")]),
              u32(44),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(0) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserFragmentSpanStart", [local("tokenFragment")]),
              u32(7),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(0) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserFragmentSpanEnd", [local("tokenFragment")]),
              u32(11),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(0) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserFragmentTokenStart", [local("tokenFragment")]),
              u32(5),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(0) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserFragmentTokenEnd", [local("tokenFragment")]),
              u32(6),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(0) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserFragmentChildAt", [local("tokenFragment"), u32(0)]),
              local("token"),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(0) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserDiagnosticCode", [local("diagnostic")]),
              u32(6),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(0) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserDiagnosticSpanStart", [local("diagnostic")]),
              u32(7),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(0) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserDiagnosticSpanEnd", [local("diagnostic")]),
              u32(11),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(0) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserDiagnosticDetail", [local("diagnostic")]),
              u32(99),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(0) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserDiagnosticDetailKindId", [u32(2)]),
              u32(1),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(0) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserDiagnosticDetailKindId", [u32(3)]),
              u32(1),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(0) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserDiagnosticDetailKindId", [u32(1)]),
              u32(0),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(0) }],
          },
          setLocal(
            "rule",
            call("parserRuleNodeFromFragment", [u32(4), local("fragment")]),
          ),
          {
            kind: "return",
            expression: add(
              mul(
                call("runtimeObjectKind", [local("fragment")]),
                u32(100_000_000),
              ),
              add(
                mul(
                  call("parserRuleNodeChildCount", [local("rule")]),
                  u32(10_000_000),
                ),
                add(
                  mul(
                    call("parserRuleNodeFieldCount", [local("rule")]),
                    u32(1_000_000),
                  ),
                  add(
                    mul(
                      call("parserRuleNodeRuleId", [local("rule")]),
                      u32(100_000),
                    ),
                    add(
                      mul(
                        call("parserRuleNodeSpanStart", [local("rule")]),
                        u32(10_000),
                      ),
                      add(
                        mul(
                          call("parserRuleNodeSpanEnd", [local("rule")]),
                          u32(1_000),
                        ),
                        add(
                          mul(
                            call("parserRuleNodeTokenStart", [local("rule")]),
                            u32(100),
                          ),
                          add(
                            mul(
                              call("parserRuleNodeTokenEnd", [local("rule")]),
                              u32(10),
                            ),
                            call("parserFieldCaptureFieldId", [
                              local("capture"),
                            ]),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          },
        ],
      },
    ],
  };
  const parserDiagnosticMergeStatusProgram: RuntimeLanguageProgram = {
    ...parserObjectBaseProgram,
    name: "parser_diagnostic_merge_status",
    entry: "main",
    functions: [
      ...parserObjectBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(
              call("parserDiagnosticMergeStatus", [u32(0), u32(0)]),
              u32(1_000),
            ),
            add(
              mul(
                call("parserDiagnosticMergeStatus", [u32(2), u32(0)]),
                u32(100),
              ),
              add(
                mul(
                  call("parserDiagnosticMergeStatus", [u32(0), u32(3)]),
                  u32(10),
                ),
                call("parserDiagnosticMergeStatus", [u32(2), u32(3)]),
              ),
            ),
          ),
        }],
      },
    ],
  };
  const parserDiagnosticCodeStatusProgram: RuntimeLanguageProgram = {
    ...parserObjectBaseProgram,
    name: "parser_diagnostic_code_status",
    entry: "main",
    functions: [
      ...parserObjectBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(
              call("parserDiagnosticCodeStatus", [u32(7), u32(7)]),
              u32(10),
            ),
            call("parserDiagnosticCodeStatus", [u32(7), u32(8)]),
          ),
        }],
      },
    ],
  };
  const parserTraceTokenStreamPublicIndexProgram: RuntimeLanguageProgram = {
    ...parserObjectBaseProgram,
    name: "parser_trace_token_stream_public_index",
    entry: "main",
    functions: [
      ...parserObjectBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(
              call("parserTraceTokenStreamPublicIndex", [u32(2), u32(5)]),
              u32(10),
            ),
            call("parserTraceTokenStreamPublicIndex", [u32(5), u32(5)]),
          ),
        }],
      },
    ],
  };
  const parserAcceptedRootStatusProgram: RuntimeLanguageProgram = {
    ...parserObjectBaseProgram,
    name: "parser_accepted_root_status",
    entry: "main",
    functions: [
      ...parserObjectBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(
              call("parserAcceptedRootStatus", [u32(1), u32(0), u32(0)]),
              u32(100),
            ),
            add(
              mul(
                call("parserAcceptedRootStatus", [u32(0), u32(1), u32(1)]),
                u32(10),
              ),
              call("parserAcceptedRootStatus", [u32(0), u32(1), u32(0)]),
            ),
          ),
        }],
      },
    ],
  };
  const parserRuleNodeChildListStatusProgram: RuntimeLanguageProgram = {
    ...parserObjectBaseProgram,
    name: "parser_rule_node_child_list_status_conformance",
    entry: "main",
    functions: [
      ...parserObjectBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(call("parserRuleNodeChildListStatus", [u32(0)]), u32(10)),
            call("parserRuleNodeChildListStatus", [u32(2)]),
          ),
        }],
      },
    ],
  };
  const parserTokenStreamValidationProgram: RuntimeLanguageProgram = {
    ...parserObjectBaseProgram,
    name: "parser_token_stream_validation",
    entry: "main",
    functions: [
      ...parserObjectBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(
              add(
                mul(
                  call("parserTokenStreamSpanBoundsStatus", [
                    u32(3),
                    u32(2),
                    u32(5),
                  ]),
                  u32(1_000_000),
                ),
                add(
                  mul(
                    call("parserTokenStreamSpanBoundsStatus", [
                      u32(1),
                      u32(6),
                      u32(5),
                    ]),
                    u32(100_000),
                  ),
                  add(
                    mul(
                      call("parserTokenStreamSpanPositionStatus", [
                        u32(3),
                        u32(0),
                      ]),
                      u32(10_000),
                    ),
                    add(
                      mul(
                        call("parserTokenStreamSpanPositionStatus", [
                          u32(1),
                          u32(3),
                        ]),
                        u32(1_000),
                      ),
                      add(
                        mul(
                          call("parserTokenStreamWidthStatus", [
                            u32(4),
                            u32(4),
                          ]),
                          u32(100),
                        ),
                        call("parserTokenStreamEofStatus", [
                          u32(1),
                          u32(1),
                          u32(5),
                          u32(5),
                          u32(5),
                        ]),
                      ),
                    ),
                  ),
                ),
              ),
              u32(100),
            ),
            add(
              mul(
                call("parserTokenStreamGapTokenStatus", [
                  u32(RUNTIME_PUBLIC_TOKEN_TRIVIA),
                  u32(2),
                  u32(3),
                  u32(1),
                  u32(4),
                ]),
                u32(10),
              ),
              call("parserTokenStreamGapTokenStatus", [
                u32(RUNTIME_PUBLIC_TOKEN_MAIN),
                u32(2),
                u32(3),
                u32(1),
                u32(4),
              ]),
            ),
          ),
        }],
      },
    ],
  };
  const parserTokenStreamTokenMatchProgram: RuntimeLanguageProgram = {
    ...parserObjectBaseProgram,
    name: "parser_token_stream_token_match",
    entry: "main",
    functions: [
      ...parserObjectBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(
              call("parserTokenStreamTokenMatchStatus", [
                u32(RUNTIME_PUBLIC_TOKEN_MAIN),
                u32(RUNTIME_PUBLIC_TOKEN_MAIN),
                u32(1),
                u32(1),
                u32(3),
                u32(3),
                u32(2),
                u32(4),
                u32(2),
                u32(4),
              ]),
              u32(100_000),
            ),
            add(
              mul(
                call("parserTokenStreamTokenMatchStatus", [
                  u32(RUNTIME_PUBLIC_TOKEN_MAIN),
                  u32(RUNTIME_PUBLIC_TOKEN_TRIVIA),
                  u32(1),
                  u32(1),
                  u32(3),
                  u32(3),
                  u32(2),
                  u32(4),
                  u32(2),
                  u32(4),
                ]),
                u32(10_000),
              ),
              add(
                mul(
                  call("parserTokenStreamTokenMatchStatus", [
                    u32(RUNTIME_PUBLIC_TOKEN_MAIN),
                    u32(RUNTIME_PUBLIC_TOKEN_MAIN),
                    u32(1),
                    u32(2),
                    u32(3),
                    u32(3),
                    u32(2),
                    u32(4),
                    u32(2),
                    u32(4),
                  ]),
                  u32(1_000),
                ),
                add(
                  mul(
                    call("parserTokenStreamTokenMatchStatus", [
                      u32(RUNTIME_PUBLIC_TOKEN_MAIN),
                      u32(RUNTIME_PUBLIC_TOKEN_MAIN),
                      u32(1),
                      u32(1),
                      u32(3),
                      u32(4),
                      u32(2),
                      u32(4),
                      u32(2),
                      u32(4),
                    ]),
                    u32(100),
                  ),
                  add(
                    mul(
                      call("parserTokenStreamTokenMatchStatus", [
                        u32(RUNTIME_PUBLIC_TOKEN_MAIN),
                        u32(RUNTIME_PUBLIC_TOKEN_MAIN),
                        u32(1),
                        u32(1),
                        u32(3),
                        u32(3),
                        u32(2),
                        u32(4),
                        u32(3),
                        u32(4),
                      ]),
                      u32(10),
                    ),
                    call("parserTokenStreamTokenMatchStatus", [
                      u32(RUNTIME_PUBLIC_TOKEN_MAIN),
                      u32(RUNTIME_PUBLIC_TOKEN_MAIN),
                      u32(1),
                      u32(1),
                      u32(3),
                      u32(3),
                      u32(2),
                      u32(4),
                      u32(2),
                      u32(5),
                    ]),
                  ),
                ),
              ),
            ),
          ),
        }],
      },
    ],
  };
  const parserTokenStreamCanonicalMatchProgram: RuntimeLanguageProgram = {
    ...parserObjectBaseProgram,
    name: "parser_token_stream_canonical_match",
    entry: "main",
    functions: [
      ...parserObjectBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(
              call("parserTokenStreamCanonicalMatchStatus", [
                u32(RUNTIME_PUBLIC_TOKEN_MAIN),
                u32(RUNTIME_TOKEN_STREAM_STATUS_OK),
                u32(5),
                u32(3),
              ]),
              u32(1_000),
            ),
            add(
              mul(
                call("parserTokenStreamCanonicalMatchStatus", [
                  u32(RUNTIME_PUBLIC_TOKEN_TRIVIA),
                  u32(RUNTIME_TOKEN_STREAM_STATUS_TOKEN_MISMATCH),
                  u32(5),
                  u32(5),
                ]),
                u32(100),
              ),
              add(
                mul(
                  call("parserTokenStreamCanonicalMatchStatus", [
                    u32(RUNTIME_PUBLIC_TOKEN_TRIVIA),
                    u32(RUNTIME_TOKEN_STREAM_STATUS_TOKEN_MISMATCH),
                    u32(5),
                    u32(4),
                  ]),
                  u32(10),
                ),
                call("parserTokenStreamCanonicalMatchStatus", [
                  u32(RUNTIME_PUBLIC_TOKEN_MAIN),
                  u32(RUNTIME_TOKEN_STREAM_STATUS_TOKEN_MISMATCH),
                  u32(5),
                  u32(5),
                ]),
              ),
            ),
          ),
        }],
      },
    ],
  };
  const parserTokenStreamFinalStatusProgram: RuntimeLanguageProgram = {
    ...parserObjectBaseProgram,
    name: "parser_token_stream_final_status",
    entry: "main",
    functions: [
      ...parserObjectBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(
              call("parserTokenStreamFinalStatus", [
                u32(1),
                u32(2),
                u32(3),
                u32(5),
                u32(5),
              ]),
              u32(100),
            ),
            add(
              mul(
                call("parserTokenStreamFinalStatus", [
                  u32(1),
                  u32(1),
                  u32(3),
                  u32(5),
                  u32(5),
                ]),
                u32(10),
              ),
              call("parserTokenStreamFinalStatus", [
                u32(0),
                u32(0),
                u32(2),
                u32(4),
                u32(5),
              ]),
            ),
          ),
        }],
      },
    ],
  };
  const parserTokenStreamPublicTokenStatusProgram: RuntimeLanguageProgram = {
    ...parserObjectBaseProgram,
    name: "parser_token_stream_public_token_status",
    entry: "main",
    functions: [
      ...parserObjectBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(
              call("parserTokenStreamPublicTokenStatus", [
                u32(RUNTIME_PUBLIC_TOKEN_TYPE_LITERAL),
                u32(RUNTIME_PUBLIC_TOKEN_CHANNEL_MAIN),
                u32(1),
              ]),
              u32(100_000),
            ),
            add(
              mul(
                call("parserTokenStreamPublicTokenStatus", [
                  u32(RUNTIME_PUBLIC_TOKEN_TYPE_LITERAL),
                  u32(RUNTIME_PUBLIC_TOKEN_CHANNEL_MAIN),
                  u32(0),
                ]),
                u32(10_000),
              ),
              add(
                mul(
                  call("parserTokenStreamPublicTokenStatus", [
                    u32(RUNTIME_PUBLIC_TOKEN_TYPE_NAMED),
                    u32(RUNTIME_PUBLIC_TOKEN_CHANNEL_UNKNOWN),
                    u32(0),
                  ]),
                  u32(1_000),
                ),
                add(
                  mul(
                    call("parserTokenStreamPublicTokenStatus", [
                      u32(RUNTIME_PUBLIC_TOKEN_TYPE_NAMED),
                      u32(RUNTIME_PUBLIC_TOKEN_CHANNEL_TRIVIA),
                      u32(0),
                    ]),
                    u32(100),
                  ),
                  add(
                    mul(
                      call("parserTokenStreamPublicTokenStatus", [
                        u32(RUNTIME_PUBLIC_TOKEN_TYPE_ERROR),
                        u32(RUNTIME_PUBLIC_TOKEN_CHANNEL_MAIN),
                        u32(0),
                      ]),
                      u32(10),
                    ),
                    call("parserTokenStreamPublicTokenStatus", [
                      u32(RUNTIME_PUBLIC_TOKEN_TYPE_UNKNOWN),
                      u32(RUNTIME_PUBLIC_TOKEN_CHANNEL_UNKNOWN),
                      u32(0),
                    ]),
                  ),
                ),
              ),
            ),
          ),
        }],
      },
    ],
  };
  const parserTraceTokenStreamStatusProgram: RuntimeLanguageProgram = {
    ...parserObjectBaseProgram,
    name: "parser_trace_token_stream_status",
    entry: "main",
    functions: [
      ...parserObjectBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(
              call("parserTraceTokenStreamStatus", [
                u32(RUNTIME_PUBLIC_TOKEN_MAIN),
              ]),
              u32(10_000),
            ),
            add(
              mul(
                call("parserTraceTokenStreamStatus", [
                  u32(RUNTIME_PUBLIC_TOKEN_LITERAL),
                ]),
                u32(1_000),
              ),
              add(
                mul(
                  call("parserTraceTokenStreamStatus", [
                    u32(RUNTIME_PUBLIC_TOKEN_ERROR),
                  ]),
                  u32(100),
                ),
                add(
                  mul(
                    call("parserTraceTokenStreamStatus", [
                      u32(RUNTIME_PUBLIC_TOKEN_TRIVIA),
                    ]),
                    u32(10),
                  ),
                  call("parserTraceTokenStreamStatus", [
                    u32(RUNTIME_PUBLIC_TOKEN_EOF),
                  ]),
                ),
              ),
            ),
          ),
        }],
      },
    ],
  };
  const parserTraceTerminalProgram: RuntimeLanguageProgram = {
    ...parserObjectBaseProgram,
    name: "parser_trace_terminal",
    entry: "main",
    functions: [
      ...parserObjectBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(
              eq(
                call("parserTraceTerminal", [
                  u32(RUNTIME_PUBLIC_TOKEN_EOF),
                  u32(RUNTIME_NO_TERMINAL),
                  u32(8),
                  u32(9),
                ]),
                u32(9),
              ),
              u32(1_000),
            ),
            add(
              mul(
                eq(
                  call("parserTraceTerminal", [
                    u32(RUNTIME_PUBLIC_TOKEN_MAIN),
                    u32(7),
                    u32(8),
                    u32(9),
                  ]),
                  u32(7),
                ),
                u32(100),
              ),
              add(
                mul(
                  eq(
                    call("parserTraceTerminal", [
                      u32(RUNTIME_PUBLIC_TOKEN_MAIN),
                      u32(RUNTIME_NO_TERMINAL),
                      u32(8),
                      u32(9),
                    ]),
                    u32(8),
                  ),
                  u32(10),
                ),
                eq(
                  call("parserTraceTerminal", [
                    u32(RUNTIME_PUBLIC_TOKEN_MAIN),
                    u32(RUNTIME_NO_TERMINAL),
                    u32(RUNTIME_NO_TERMINAL),
                    u32(9),
                  ]),
                  u32(RUNTIME_NO_TERMINAL),
                ),
              ),
            ),
          ),
        }],
      },
    ],
  };
  const parserTraceTokenStreamStepProgram: RuntimeLanguageProgram = {
    ...parserObjectBaseProgram,
    name: "parser_trace_token_stream_step",
    entry: "main",
    functions: [
      ...parserObjectBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(
              eq(
                call("parserTraceTokenStreamStepStatus", [
                  call("parserTraceTokenStreamStep", [
                    u32(RUNTIME_PUBLIC_TOKEN_MAIN),
                    u32(7),
                    u32(8),
                    u32(9),
                  ]),
                ]),
                u32(RUNTIME_TRACE_TOKEN_STREAM_EMIT),
              ),
              u32(100_000),
            ),
            add(
              mul(
                eq(
                  call("parserTraceTokenStreamStepTerminal", [
                    call("parserTraceTokenStreamStep", [
                      u32(RUNTIME_PUBLIC_TOKEN_MAIN),
                      u32(7),
                      u32(8),
                      u32(9),
                    ]),
                  ]),
                  u32(7),
                ),
                u32(10_000),
              ),
              add(
                mul(
                  eq(
                    call("parserTraceTokenStreamStepStatus", [
                      call("parserTraceTokenStreamStep", [
                        u32(RUNTIME_PUBLIC_TOKEN_TRIVIA),
                        u32(RUNTIME_NO_TERMINAL),
                        u32(8),
                        u32(9),
                      ]),
                    ]),
                    u32(RUNTIME_TRACE_TOKEN_STREAM_SKIP),
                  ),
                  u32(1_000),
                ),
                add(
                  mul(
                    eq(
                      call("parserTraceTokenStreamStepStatus", [
                        call("parserTraceTokenStreamStep", [
                          u32(RUNTIME_PUBLIC_TOKEN_EOF),
                          u32(RUNTIME_NO_TERMINAL),
                          u32(8),
                          u32(9),
                        ]),
                      ]),
                      u32(RUNTIME_TRACE_TOKEN_STREAM_STOP),
                    ),
                    u32(100),
                  ),
                  add(
                    mul(
                      eq(
                        call("parserTraceTokenStreamStepTerminal", [
                          call("parserTraceTokenStreamStep", [
                            u32(RUNTIME_PUBLIC_TOKEN_EOF),
                            u32(RUNTIME_NO_TERMINAL),
                            u32(8),
                            u32(9),
                          ]),
                        ]),
                        u32(9),
                      ),
                      u32(10),
                    ),
                    eq(
                      call("parserTraceTokenStreamStepTerminal", [
                        call("parserTraceTokenStreamStep", [
                          u32(RUNTIME_PUBLIC_TOKEN_MAIN),
                          u32(RUNTIME_NO_TERMINAL),
                          u32(RUNTIME_NO_TERMINAL),
                          u32(9),
                        ]),
                      ]),
                      u32(RUNTIME_NO_TERMINAL),
                    ),
                  ),
                ),
              ),
            ),
          ),
        }],
      },
    ],
  };
  const parserShiftedTokenStatusProgram: RuntimeLanguageProgram = {
    ...parserObjectBaseProgram,
    name: "parser_shifted_token_status",
    entry: "main",
    functions: [
      ...parserObjectBaseProgram.functions,
      {
        name: "main",
        result: "u32",
        body: [{
          kind: "return",
          expression: add(
            mul(
              call("parserShiftedTokenStatus", [
                u32(RUNTIME_PUBLIC_TOKEN_LITERAL),
              ]),
              u32(10_000),
            ),
            add(
              mul(
                call("parserShiftedTokenStatus", [
                  u32(RUNTIME_PUBLIC_TOKEN_MAIN),
                ]),
                u32(1_000),
              ),
              add(
                mul(
                  call("parserShiftedTokenStatus", [
                    u32(RUNTIME_PUBLIC_TOKEN_TRIVIA),
                  ]),
                  u32(100),
                ),
                add(
                  mul(
                    call("parserShiftedTokenStatus", [
                      u32(RUNTIME_PUBLIC_TOKEN_ERROR),
                    ]),
                    u32(10),
                  ),
                  call("parserShiftedTokenStatus", [
                    u32(RUNTIME_PUBLIC_TOKEN_EOF),
                  ]),
                ),
              ),
            ),
          ),
        }],
      },
    ],
  };
  const parserObjectWrongKindProgram: RuntimeLanguageProgram = {
    ...parserObjectBaseProgram,
    name: "parser_object_wrong_kind",
    entry: "main",
    functions: [
      ...parserObjectBaseProgram.functions,
      {
        name: "main",
        locals: [
          { name: "discard", type: "u32" },
          { name: "handle", type: "u32" },
        ],
        result: "u32",
        body: [
          setLocal("discard", call("runtimeArenaReset", [])),
          setLocal("handle", call("runtimeArrayNew", [u32(1)])),
          {
            kind: "return",
            expression: call("parserFragmentValue", [local("handle")]),
          },
        ],
      },
    ],
  };
  const parserTokenWrongKindProgram: RuntimeLanguageProgram = {
    ...parserObjectBaseProgram,
    name: "parser_token_wrong_kind",
    entry: "main",
    functions: [
      ...parserObjectBaseProgram.functions,
      {
        name: "main",
        locals: [
          { name: "discard", type: "u32" },
          { name: "fragment", type: "u32" },
        ],
        result: "u32",
        body: [
          setLocal("discard", call("runtimeArenaReset", [])),
          setLocal(
            "fragment",
            call("parserFragmentNew", [u32(1), u32(0), u32(0), u32(0), u32(0)]),
          ),
          {
            kind: "return",
            expression: call("parserTokenClass", [local("fragment")]),
          },
        ],
      },
    ],
  };
  const parserDiagnosticWrongKindProgram: RuntimeLanguageProgram = {
    ...parserObjectBaseProgram,
    name: "parser_diagnostic_wrong_kind",
    entry: "main",
    functions: [
      ...parserObjectBaseProgram.functions,
      {
        name: "main",
        locals: [
          { name: "discard", type: "u32" },
          { name: "token", type: "u32" },
        ],
        result: "u32",
        body: [
          setLocal("discard", call("runtimeArenaReset", [])),
          setLocal(
            "token",
            call("parserTokenNew", [u32(1), u32(2), u32(3), u32(4), u32(5)]),
          ),
          {
            kind: "return",
            expression: call("parserDiagnosticCode", [local("token")]),
          },
        ],
      },
    ],
  };
  const parserObjectWrongFieldProgram: RuntimeLanguageProgram = {
    ...parserObjectBaseProgram,
    name: "parser_object_wrong_field",
    entry: "main",
    functions: [
      ...parserObjectBaseProgram.functions,
      {
        name: "main",
        locals: [
          { name: "discard", type: "u32" },
          { name: "fragment", type: "u32" },
          { name: "child", type: "u32" },
        ],
        result: "u32",
        body: [
          setLocal("discard", call("runtimeArenaReset", [])),
          setLocal(
            "fragment",
            call("parserFragmentNew", [u32(1), u32(0), u32(0), u32(0), u32(0)]),
          ),
          setLocal(
            "child",
            call("parserFragmentNew", [u32(2), u32(0), u32(0), u32(0), u32(0)]),
          ),
          {
            kind: "return",
            expression: call("parserFragmentAppendField", [
              local("fragment"),
              local("child"),
            ]),
          },
        ],
      },
    ],
  };
  const parserFragmentAssemblyProgram: RuntimeLanguageProgram = {
    ...parserObjectBaseProgram,
    name: "parser_fragment_assembly",
    entry: "main",
    functions: [
      ...parserObjectBaseProgram.functions,
      {
        name: "main",
        locals: [
          { name: "discard", type: "u32" },
          { name: "tokenA", type: "u32" },
          { name: "tokenB", type: "u32" },
          { name: "tokenC", type: "u32" },
          { name: "separatorToken", type: "u32" },
          { name: "partA", type: "u32" },
          { name: "partB", type: "u32" },
          { name: "partC", type: "u32" },
          { name: "separator", type: "u32" },
          { name: "sequence", type: "u32" },
          { name: "empty", type: "u32" },
          { name: "capture", type: "u32" },
        ],
        result: "u32",
        body: [
          setLocal("discard", call("runtimeArenaReset", [])),
          setLocal(
            "tokenA",
            call("parserTokenNew", [u32(1), u32(10), u32(20), u32(3), u32(4)]),
          ),
          setLocal(
            "tokenB",
            call("parserTokenNew", [u32(1), u32(11), u32(21), u32(5), u32(7)]),
          ),
          setLocal(
            "partA",
            call("parserFragmentFromToken", [local("tokenA"), u32(1)]),
          ),
          setLocal(
            "partB",
            call("parserFragmentFromToken", [local("tokenB"), u32(2)]),
          ),
          setLocal(
            "capture",
            call("parserFieldCaptureNew", [u32(4), local("tokenB")]),
          ),
          setLocal(
            "discard",
            call("parserFragmentAppendField", [
              local("partB"),
              local("capture"),
            ]),
          ),
          setLocal(
            "sequence",
            call("parserFragmentSequenceNew", [u32(9), u32(6)]),
          ),
          setLocal(
            "discard",
            call("parserFragmentSequenceAppend", [
              local("sequence"),
              local("partA"),
            ]),
          ),
          setLocal(
            "discard",
            call("parserFragmentSequenceAppend", [
              local("sequence"),
              local("partB"),
            ]),
          ),
          {
            kind: "if",
            condition: eq(
              call("runtimeVectorLength", [
                call("parserFragmentValue", [local("sequence")]),
              ]),
              u32(2),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(1) }],
          },
          {
            kind: "if",
            condition: eq(
              call("runtimeVectorLoad", [
                call("parserFragmentValue", [local("sequence")]),
                u32(0),
              ]),
              local("tokenA"),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(2) }],
          },
          {
            kind: "if",
            condition: eq(
              call("runtimeVectorLoad", [
                call("parserFragmentValue", [local("sequence")]),
                u32(1),
              ]),
              local("tokenB"),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(3) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserFragmentChildCount", [local("sequence")]),
              u32(2),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(4) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserFragmentFieldCount", [local("sequence")]),
              u32(1),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(5) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserFieldCaptureFieldId", [
                call("parserFragmentFieldAt", [local("sequence"), u32(0)]),
              ]),
              u32(4),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(6) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserFragmentSpanStart", [local("sequence")]),
              u32(3),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(7) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserFragmentSpanEnd", [local("sequence")]),
              u32(7),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(8) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserFragmentTokenStart", [local("sequence")]),
              u32(1),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(9) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserFragmentTokenEnd", [local("sequence")]),
              u32(3),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(10) }],
          },
          setLocal(
            "empty",
            call("parserFragmentEmpty", [u32(123), u32(10), u32(5)]),
          ),
          {
            kind: "if",
            condition: eq(
              call("parserFragmentSpanStart", [local("empty")]),
              u32(10),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(11) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserFragmentTokenEnd", [local("empty")]),
              u32(5),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(12) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserFragmentChildCount", [local("empty")]),
              u32(0),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(13) }],
          },
          setLocal(
            "tokenC",
            call("parserTokenNew", [u32(1), u32(12), u32(22), u32(8), u32(9)]),
          ),
          setLocal(
            "separatorToken",
            call("parserTokenNew", [u32(2), u32(13), u32(23), u32(9), u32(10)]),
          ),
          setLocal(
            "tokenB",
            call("parserTokenNew", [
              u32(1),
              u32(14),
              u32(24),
              u32(10),
              u32(12),
            ]),
          ),
          setLocal(
            "partC",
            call("parserFragmentFromToken", [local("tokenC"), u32(4)]),
          ),
          setLocal(
            "separator",
            call("parserFragmentFromToken", [local("separatorToken"), u32(5)]),
          ),
          setLocal(
            "partB",
            call("parserFragmentFromToken", [local("tokenB"), u32(6)]),
          ),
          setLocal(
            "discard",
            call("parserFragmentWrapValueVector", [local("partC")]),
          ),
          setLocal(
            "discard",
            call("parserFragmentAppendSeparatedValue", [
              local("partC"),
              local("separator"),
              local("partB"),
            ]),
          ),
          {
            kind: "if",
            condition: eq(
              call("runtimeVectorLength", [
                call("parserFragmentValue", [local("partC")]),
              ]),
              u32(2),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(14) }],
          },
          {
            kind: "if",
            condition: eq(
              call("runtimeVectorLoad", [
                call("parserFragmentValue", [local("partC")]),
                u32(1),
              ]),
              local("tokenB"),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(15) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserFragmentChildCount", [local("partC")]),
              u32(3),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(16) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserFragmentSpanStart", [local("partC")]),
              u32(8),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(17) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserFragmentSpanEnd", [local("partC")]),
              u32(12),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(18) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserFragmentTokenStart", [local("partC")]),
              u32(4),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(19) }],
          },
          {
            kind: "if",
            condition: eq(
              call("parserFragmentTokenEnd", [local("partC")]),
              u32(7),
            ),
            consequent: [],
            alternate: [{ kind: "return", expression: u32(20) }],
          },
          { kind: "return", expression: u32(1) },
        ],
      },
    ],
  };
  const arenaStaleHandleProgram: RuntimeLanguageProgram = {
    ...RUNTIME_ARENA_PROGRAM,
    name: "arena_stale_handle",
    entry: "main",
    functions: [
      ...RUNTIME_ARENA_PROGRAM.functions,
      {
        name: "main",
        locals: [
          { name: "discard", type: "u32" },
          { name: "handle", type: "u32" },
        ],
        result: "u32",
        body: [
          setLocal("discard", call("runtimeArenaReset", [])),
          setLocal("handle", call("runtimeArrayNew", [u32(1)])),
          setLocal("discard", call("runtimeArenaReset", [])),
          {
            kind: "return",
            expression: call("runtimeArrayLength", [local("handle")]),
          },
        ],
      },
    ],
  };
  const arenaOverflowProgram: RuntimeLanguageProgram = {
    ...RUNTIME_ARENA_PROGRAM,
    name: "arena_overflow",
    entry: "main",
    functions: [
      ...RUNTIME_ARENA_PROGRAM.functions,
      {
        name: "main",
        locals: [
          { name: "discard", type: "u32" },
        ],
        result: "u32",
        body: [
          setLocal("discard", call("runtimeArenaReset", [])),
          {
            kind: "return",
            expression: call("runtimeArenaAlloc", [u32(0xffff_ffff)]),
          },
        ],
      },
    ],
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
      name: "unsigned comparison uses u32 interpretation",
      program: returning("unsigned_less_than", {
        kind: "addU32",
        left: {
          kind: "mulU32",
          left: {
            kind: "ltU32",
            left: u32(0),
            right: u32(0xffff_ffff),
          },
          right: u32(10),
        },
        right: {
          kind: "ltU32",
          left: u32(0xffff_ffff),
          right: u32(0),
        },
      }),
      expected: { kind: "value", value: 10 },
    },
    {
      name: "bitwise and masks u32 bits",
      program: returning("u32_and", {
        kind: "andU32",
        left: u32(0xf0f0),
        right: u32(0x0ff0),
      }),
      expected: { kind: "value", value: 0x00f0 },
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
      name: "runtime arena allocates and reads u32 arrays",
      program: arenaArrayProgram,
      expected: { kind: "value", value: 6381 },
    },
    {
      name: "runtime arena allocates tagged records",
      program: arenaRecordProgram,
      expected: { kind: "value", value: 6_242_281 },
    },
    {
      name: "runtime arena vectors append, grow, and preserve values",
      program: arenaVectorProgram,
      expected: { kind: "value", value: 27_345_035 },
    },
    {
      name: "runtime arena reset reuses allocation lifetime",
      program: arenaResetProgram,
      expected: { kind: "value", value: 40 },
    },
    {
      name: "runtime array access traps out of bounds",
      program: arenaArrayBoundsProgram,
      expected: { kind: "trap" },
    },
    {
      name: "runtime record access traps out of bounds",
      program: arenaRecordBoundsProgram,
      expected: { kind: "trap" },
    },
    {
      name: "runtime vector access traps out of bounds",
      program: arenaVectorBoundsProgram,
      expected: { kind: "trap" },
    },
    {
      name: "runtime vector truncate traps when asked to grow",
      program: arenaVectorTruncateGrowProgram,
      expected: { kind: "trap" },
    },
    {
      name: "runtime object helpers trap on wrong handle kind",
      program: arenaWrongKindProgram,
      expected: { kind: "trap" },
    },
    {
      name: "runtime vector helpers trap on wrong handle kind",
      program: arenaVectorWrongKindProgram,
      expected: { kind: "trap" },
    },
    {
      name: "runtime parser object layout stores fragments fields and rules",
      program: parserObjectProgram,
      expected: { kind: "value", value: 411_425_139 },
    },
    {
      name: "runtime parser replay VM builds accepted rule-node handles",
      program: parserReplayVmProgram,
      expected: { kind: "value", value: 711 },
    },
    {
      name: "runtime parser rule-node child list status classifies empty lists",
      program: parserRuleNodeChildListStatusProgram,
      expected: {
        kind: "value",
        value: RUNTIME_RULE_NODE_CHILD_LIST_EMPTY * 10 +
          RUNTIME_RULE_NODE_CHILD_LIST_PRESENT,
      },
    },
    {
      name: "runtime token-stream validation helpers classify spans and EOF",
      program: parserTokenStreamValidationProgram,
      expected: {
        kind: "value",
        value: (RUNTIME_TOKEN_STREAM_STATUS_INVALID_SPAN * 1_000_000 +
              RUNTIME_TOKEN_STREAM_STATUS_INVALID_SPAN * 100_000 +
              RUNTIME_TOKEN_STREAM_STATUS_GAP * 10_000 +
              RUNTIME_TOKEN_STREAM_STATUS_OVERLAP * 1_000 +
              RUNTIME_TOKEN_STREAM_STATUS_ZERO_WIDTH * 100 +
              RUNTIME_TOKEN_STREAM_STATUS_INVALID_EOF) * 100 +
          RUNTIME_TOKEN_STREAM_STATUS_OK * 10 +
          RUNTIME_TOKEN_STREAM_STATUS_NONTRIVIA_GAP,
      },
    },
    {
      name:
        "runtime token-stream token match helper compares portable identity",
      program: parserTokenStreamTokenMatchProgram,
      expected: {
        kind: "value",
        value: RUNTIME_TOKEN_STREAM_STATUS_OK * 100_000 +
          RUNTIME_TOKEN_STREAM_STATUS_TOKEN_MISMATCH * 10_000 +
          RUNTIME_TOKEN_STREAM_STATUS_TOKEN_MISMATCH * 1_000 +
          RUNTIME_TOKEN_STREAM_STATUS_TOKEN_MISMATCH * 100 +
          RUNTIME_TOKEN_STREAM_STATUS_TOKEN_MISMATCH * 10 +
          RUNTIME_TOKEN_STREAM_STATUS_TOKEN_MISMATCH,
      },
    },
    {
      name:
        "runtime token-stream canonical match helper classifies trivia skips",
      program: parserTokenStreamCanonicalMatchProgram,
      expected: {
        kind: "value",
        value: RUNTIME_TOKEN_STREAM_CANONICAL_MATCH * 1_000 +
          RUNTIME_TOKEN_STREAM_CANONICAL_SKIP * 100 +
          RUNTIME_TOKEN_STREAM_CANONICAL_MISMATCH * 10 +
          RUNTIME_TOKEN_STREAM_CANONICAL_MISMATCH,
      },
    },
    {
      name: "runtime token-stream final status classifies EOF and gaps",
      program: parserTokenStreamFinalStatusProgram,
      expected: {
        kind: "value",
        value: RUNTIME_TOKEN_STREAM_STATUS_OK * 100 +
          RUNTIME_TOKEN_STREAM_STATUS_INVALID_EOF * 10 +
          RUNTIME_TOKEN_STREAM_STATUS_GAP,
      },
    },
    {
      name: "runtime token-stream public token status classifies API shape",
      program: parserTokenStreamPublicTokenStatusProgram,
      expected: {
        kind: "value",
        value: RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_OK * 100_000 +
          RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_INVALID_LITERAL * 10_000 +
          RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_INVALID_NAMED * 1_000 +
          RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_OK * 100 +
          RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_INVALID_ERROR * 10 +
          RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_UNKNOWN_TYPE,
      },
    },
    {
      name: "runtime diagnostic merge helper classifies empty sides",
      program: parserDiagnosticMergeStatusProgram,
      expected: {
        kind: "value",
        value: RUNTIME_DIAGNOSTIC_MERGE_EMPTY * 1_000 +
          RUNTIME_DIAGNOSTIC_MERGE_LEFT * 100 +
          RUNTIME_DIAGNOSTIC_MERGE_RIGHT * 10 +
          RUNTIME_DIAGNOSTIC_MERGE_BOTH,
      },
    },
    {
      name: "runtime diagnostic code helper validates record payloads",
      program: parserDiagnosticCodeStatusProgram,
      expected: {
        kind: "value",
        value: RUNTIME_DIAGNOSTIC_CODE_STATUS_OK * 10 +
          RUNTIME_DIAGNOSTIC_CODE_STATUS_MISMATCH,
      },
    },
    {
      name: "runtime trace token-stream helper clamps public token indexes",
      program: parserTraceTokenStreamPublicIndexProgram,
      expected: { kind: "value", value: 25 },
    },
    {
      name: "runtime trace token-stream helper classifies parser input tokens",
      program: parserTraceTokenStreamStatusProgram,
      expected: {
        kind: "value",
        value: RUNTIME_TRACE_TOKEN_STREAM_EMIT * 10_000 +
          RUNTIME_TRACE_TOKEN_STREAM_EMIT * 1_000 +
          RUNTIME_TRACE_TOKEN_STREAM_EMIT * 100 +
          RUNTIME_TRACE_TOKEN_STREAM_SKIP * 10 +
          RUNTIME_TRACE_TOKEN_STREAM_STOP,
      },
    },
    {
      name: "runtime accepted-root helper classifies replay values",
      program: parserAcceptedRootStatusProgram,
      expected: {
        kind: "value",
        value: RUNTIME_ACCEPTED_ROOT_STATUS_DIRECT * 100 +
          RUNTIME_ACCEPTED_ROOT_STATUS_FRAGMENT_VALUE * 10 +
          RUNTIME_ACCEPTED_ROOT_STATUS_MISSING,
      },
    },
    {
      name: "runtime trace terminal helper selects parser terminals",
      program: parserTraceTerminalProgram,
      expected: { kind: "value", value: 1_111 },
    },
    {
      name: "runtime trace token-stream step packs status and terminal",
      program: parserTraceTokenStreamStepProgram,
      expected: { kind: "value", value: 111_111 },
    },
    {
      name: "runtime shifted-token helper classifies syntax tokens",
      program: parserShiftedTokenStatusProgram,
      expected: {
        kind: "value",
        value: RUNTIME_SHIFTED_TOKEN_STATUS_OK * 10_000 +
          RUNTIME_SHIFTED_TOKEN_STATUS_OK * 1_000 +
          RUNTIME_SHIFTED_TOKEN_STATUS_INVALID * 100 +
          RUNTIME_SHIFTED_TOKEN_STATUS_INVALID * 10 +
          RUNTIME_SHIFTED_TOKEN_STATUS_INVALID,
      },
    },
    {
      name: "runtime parser object access traps on wrong handle kind",
      program: parserObjectWrongKindProgram,
      expected: { kind: "trap" },
    },
    {
      name: "runtime parser token access traps on wrong handle kind",
      program: parserTokenWrongKindProgram,
      expected: { kind: "trap" },
    },
    {
      name: "runtime parser diagnostic access traps on wrong handle kind",
      program: parserDiagnosticWrongKindProgram,
      expected: { kind: "trap" },
    },
    {
      name: "runtime parser field append traps on wrong capture kind",
      program: parserObjectWrongFieldProgram,
      expected: { kind: "trap" },
    },
    {
      name: "runtime parser fragment assembly stores reduction-shaped data",
      program: parserFragmentAssemblyProgram,
      expected: { kind: "value", value: 1 },
    },
    {
      name: "runtime object helpers trap on stale handles after reset",
      program: arenaStaleHandleProgram,
      expected: { kind: "trap" },
    },
    {
      name: "runtime arena allocation traps on u32 overflow",
      program: arenaOverflowProgram,
      expected: { kind: "trap" },
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
      name: "immutable text values expose UTF-16 length and code units",
      program: {
        name: "text_values",
        entry: "main",
        texts: [{
          name: "source",
          value: "A😀\u0000\u2028",
        }],
        functions: [
          {
            name: "measure",
            parameters: [{ name: "input", type: "text" }],
            result: "u32",
            body: [{
              kind: "return",
              expression: add(
                textLength(local("input")),
                textCodeUnitAt(local("input"), u32(0)),
              ),
            }],
          },
          {
            name: "main",
            locals: [{ name: "value", type: "text" }],
            result: "u32",
            body: [
              setLocal("value", text("source")),
              {
                kind: "return",
                expression: add(
                  call("measure", [local("value")]),
                  textCodeUnitAt(local("value"), u32(4)),
                ),
              },
            ],
          },
        ],
      },
      expected: { kind: "value", value: 8302 },
    },
    {
      name: "immutable text code-unit access traps out of bounds",
      program: {
        name: "text_oob",
        entry: "main",
        texts: [{
          name: "source",
          value: "ok",
        }],
        functions: [{
          name: "main",
          result: "u32",
          body: [{
            kind: "return",
            expression: textCodeUnitAt(text("source"), u32(2)),
          }],
        }],
      },
      expected: { kind: "trap" },
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
      name: "UTF-16 helper returns one code unit for NUL",
      program: UTF16_CODE_POINT_WIDTH_PROGRAM,
      args: [0],
      expected: { kind: "value", value: 1 },
    },
    {
      name: "UTF-16 helper returns one code unit for Unicode line separators",
      program: UTF16_CODE_POINT_WIDTH_PROGRAM,
      args: [0x2028],
      expected: { kind: "value", value: 1 },
    },
    {
      name: "UTF-16 helper returns one code unit for isolated surrogates",
      program: UTF16_CODE_POINT_WIDTH_PROGRAM,
      args: [0xd800],
      expected: { kind: "value", value: 1 },
    },
    {
      name: "UTF-16 helper returns two code units for astral code points",
      program: UTF16_CODE_POINT_WIDTH_PROGRAM,
      args: [0x1f600],
      expected: { kind: "value", value: 2 },
    },
    {
      name: "UTF-16 helper decodes surrogate pairs from code units",
      program: {
        ...UTF16_CODE_POINT_WIDTH_PROGRAM,
        name: "utf16_code_point_decode",
        entry: "main",
        functions: [
          ...UTF16_CODE_POINT_WIDTH_PROGRAM.functions,
          {
            name: "main",
            result: "u32",
            body: [{
              kind: "return",
              expression: add(
                call("utf16CodePointFromUnits", [
                  u32(0xd83d),
                  u32(0xde00),
                  u32(1),
                ]),
                add(
                  call("utf16CodePointFromUnits", [
                    u32(0xd83d),
                    u32(0),
                    u32(0),
                  ]),
                  add(
                    call("utf16CodePointFromUnits", [
                      u32(0x41),
                      u32(0xde00),
                      u32(1),
                    ]),
                    add(
                      mul(
                        call("utf16HasCodeUnit", [u32(0), u32(1)]),
                        u32(10),
                      ),
                      call("utf16HasCodeUnit", [u32(1), u32(1)]),
                    ),
                  ),
                ),
              ),
            }],
          },
        ],
      },
      expected: { kind: "value", value: 183_944 },
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
      name: "lexer spec helper maps accepted spec metadata",
      program: lexerSpecRuntimeProgram,
      expected: {
        kind: "value",
        value: 4 * 100_000_000 +
          RUNTIME_LEXER_TOKEN_MAIN * 10_000_000 +
          RUNTIME_LEXER_TOKEN_TRIVIA * 1_000_000 + 2 * 100_000 +
          RUNTIME_LEXER_TOKEN_LITERAL * 10_000 + 1_000 +
          RUNTIME_LEXER_SPEC_STATUS_OK +
          RUNTIME_LEXER_SPEC_STATUS_UNKNOWN +
          RUNTIME_LEXER_SPEC_STATUS_NOT_LITERAL +
          RUNTIME_LEXER_SPEC_STATUS_NOT_MAIN +
          RUNTIME_LEXER_SPEC_STATUS_NOT_TRIVIA,
      },
    },
    {
      name: "lexer token diagnostic helper classifies public tokens",
      program: lexerTokenDiagnosticRuntimeProgram,
      expected: {
        kind: "value",
        value: RUNTIME_LEXICAL_TOKEN_STATUS_ERROR_TOKEN * 100_000 +
          10_000 + 1_000 + 100 +
          RUNTIME_LEXICAL_TOKEN_STATUS_NOT_TERMINAL * 10 +
          RUNTIME_LEXICAL_TOKEN_STATUS_NOT_TERMINAL,
      },
    },
    {
      name: "lexer public token helpers classify emitted token records",
      program: lexerPublicTokenRuntimeProgram,
      expected: {
        kind: "value",
        value: RUNTIME_PUBLIC_TOKEN_LITERAL * 100_000 +
          RUNTIME_PUBLIC_TOKEN_TRIVIA * 10_000 +
          RUNTIME_PUBLIC_TOKEN_MAIN * 1_000 +
          RUNTIME_LEXER_TOKEN_EMIT_SKIP * 100 +
          RUNTIME_LEXER_TOKEN_EMIT_TOKEN * 10 +
          RUNTIME_LEXER_TOKEN_EMIT_TOKEN,
      },
    },
    {
      name: "lexer scan boundary helpers compute source offsets",
      program: lexerScanBoundaryRuntimeProgram,
      expected: { kind: "value", value: 908 },
    },
    {
      name: "lexer driver emits tokens, skips trivia, and advances errors",
      program: lexerDriverRuntimeProgram,
      expected: {
        kind: "value",
        value: RUNTIME_LEXER_DRIVER_EVENT_TOKEN * 100_000_000 +
          1 * 10_000_000 +
          RUNTIME_PUBLIC_TOKEN_MAIN * 1_000_000 +
          4 * 100_000 +
          2 * 10_000 +
          RUNTIME_LEXER_DRIVER_EVENT_ERROR * 1_000 +
          2 * 100 +
          3,
      },
    },
    {
      name: "lexer driver owns preserve-trivia token emission",
      program: lexerDriverPreserveTriviaRuntimeProgram,
      expected: {
        kind: "value",
        value: RUNTIME_LEXER_DRIVER_EVENT_TOKEN * 1_000 +
          RUNTIME_PUBLIC_TOKEN_TRIVIA * 100 +
          1 * 10 +
          1,
      },
    },
    {
      name: "source text helpers classify spans and trail-unit availability",
      program: sourceTextStatusRuntimeProgram,
      expected: {
        kind: "value",
        value: 5 +
          RUNTIME_SOURCE_TEXT_OFFSET_STATUS_OK +
          RUNTIME_SOURCE_TEXT_OFFSET_STATUS_OUT_OF_BOUNDS * 10 +
          RUNTIME_SOURCE_TEXT_SPAN_STATUS_END_BEFORE_START * 100 +
          RUNTIME_SOURCE_TEXT_SPAN_STATUS_OUT_OF_BOUNDS * 1_000 +
          RUNTIME_SOURCE_TEXT_SPAN_STATUS_OK * 10_000 +
          100_000,
      },
    },
    {
      name: "source text helpers decode UTF-16 code points and next offsets",
      program: sourceTextCodePointRuntimeProgram,
      expected: { kind: "value", value: 10_094_101 },
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
      name: "parser action lookup splits kind and payload",
      program: parserActionRuntimeProgram,
      expected: { kind: "value", value: RUNTIME_ACTION_REDUCE + 42 },
    },
    {
      name: "parser replay action helper classifies trace action kinds",
      program: parserReplayActionStatusProgram,
      expected: {
        kind: "value",
        value: RUNTIME_REPLAY_ACTION_STATUS_SHIFT * 1_000 +
          RUNTIME_REPLAY_ACTION_STATUS_REDUCE * 100 +
          RUNTIME_REPLAY_ACTION_STATUS_ACCEPT * 10 +
          RUNTIME_REPLAY_ACTION_STATUS_UNKNOWN,
      },
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
      name: "parser conflict action count reports fan-out",
      program: parserConflictActionCountRuntimeProgram,
      expected: { kind: "value", value: 210 },
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
      name: "parser expected lookup returns row ranges and EOF flags",
      program: parserExpectedRuntimeProgram,
      expected: { kind: "value", value: 12_026_322 },
    },
    {
      name: "parser field lookup returns row and config metadata",
      program: parserFieldRuntimeProgram,
      expected: {
        kind: "value",
        value: 2 * 1_000_000_000 + 5 * 100_000_000 +
          RUNTIME_FIELD_NULLABLE * 10_000_000 +
          RUNTIME_FIELD_VALUE_ARRAY * 1_000_000 +
          RUNTIME_FIELD_VALUE_NULLABLE * 100_000 +
          RUNTIME_FIELD_VALUE_REQUIRED * 10_000 +
          RUNTIME_FIELD_CAPTURE_ARRAY * 1_000 +
          RUNTIME_FIELD_CAPTURE_SCALAR * 100 +
          RUNTIME_FIELD_CAPTURE_TOO_MANY * 10 +
          RUNTIME_FIELD_FINAL_REQUIRED_MISSING +
          RUNTIME_FIELD_FINAL_TOO_MANY +
          RUNTIME_FIELD_FINAL_OK,
      },
    },
    {
      name: "parser field schema status validates captures without schema",
      program: parserFieldSchemaStatusProgram,
      expected: {
        kind: "value",
        value: RUNTIME_FIELD_SCHEMA_STATUS_OK * 1_000 +
          RUNTIME_FIELD_SCHEMA_STATUS_OK * 100 +
          RUNTIME_FIELD_SCHEMA_STATUS_CAPTURE_WITHOUT_SCHEMA * 10 +
          RUNTIME_FIELD_SCHEMA_STATUS_CAPTURE_WITHOUT_SCHEMA,
      },
    },
    {
      name: "parser field build status classifies empty field objects",
      program: parserFieldBuildStatusProgram,
      expected: {
        kind: "value",
        value: RUNTIME_FIELD_BUILD_PRESENT * 100 +
          RUNTIME_FIELD_BUILD_EMPTY * 10 +
          RUNTIME_FIELD_BUILD_CAPTURE_WITHOUT_SCHEMA,
      },
    },
    {
      name: "parser field storage status classifies array-backed fields",
      program: parserFieldStorageStatusProgram,
      expected: {
        kind: "value",
        value: RUNTIME_FIELD_STORAGE_ARRAY * 100 +
          RUNTIME_FIELD_STORAGE_SCALAR * 10 +
          RUNTIME_FIELD_STORAGE_SCALAR,
      },
    },
    {
      name: "parser field entry status classifies missing schema entries",
      program: parserFieldEntryStatusProgram,
      expected: {
        kind: "value",
        value: RUNTIME_FIELD_ENTRY_PRESENT * 10 +
          RUNTIME_FIELD_ENTRY_MISSING,
      },
    },
    {
      name:
        "parser field final build status classifies materialization actions",
      program: parserFieldFinalBuildStatusProgram,
      expected: {
        kind: "value",
        value: RUNTIME_FIELD_FINAL_BUILD_ARRAY * 10_000 +
          RUNTIME_FIELD_FINAL_BUILD_TOO_MANY * 1_000 +
          RUNTIME_FIELD_FINAL_BUILD_SCALAR * 100 +
          RUNTIME_FIELD_FINAL_BUILD_REQUIRED_MISSING * 10 +
          RUNTIME_FIELD_FINAL_BUILD_SCALAR,
      },
    },
    {
      name: "parser field scalar value status classifies missing captures",
      program: parserFieldScalarValueStatusProgram,
      expected: {
        kind: "value",
        value: RUNTIME_FIELD_SCALAR_VALUE_NULL * 10 +
          RUNTIME_FIELD_SCALAR_VALUE_FRAGMENT,
      },
    },
    {
      name: "parser field array value status classifies missing vectors",
      program: parserFieldArrayValueStatusProgram,
      expected: {
        kind: "value",
        value: RUNTIME_FIELD_ARRAY_VALUE_MISSING * 10 +
          RUNTIME_FIELD_ARRAY_VALUE_OK,
      },
    },
    {
      name: "parser production lookup returns row fields",
      program: parserProductionRuntimeProgram,
      expected: { kind: "value", value: 4073 },
    },
    {
      name: "parser reducer lookup returns kind and payload fields",
      program: parserReducerRuntimeProgram,
      expected: {
        kind: "value",
        value: RUNTIME_REDUCER_RULE * 100_000_000 + 4 * 10_000_000 +
          RUNTIME_REDUCER_OPERATION_RULE * 1_000_000 +
          RUNTIME_REDUCER_FIELD * 100_000 + 2 * 10_000 +
          RUNTIME_REDUCER_OPERATION_FIELD * 1_000 +
          RUNTIME_REDUCER_OPERATION_SEQUENCE * 100 + 10 +
          RUNTIME_REDUCER_OPERATION_UNKNOWN +
          RUNTIME_REDUCER_PAYLOAD_STATUS_OK +
          RUNTIME_REDUCER_PAYLOAD_STATUS_RULE_MISSING * 100 +
          RUNTIME_REDUCER_PAYLOAD_STATUS_FIELD_MISSING * 10 +
          RUNTIME_REDUCER_PAYLOAD_STATUS_UNKNOWN +
          RUNTIME_REDUCER_CHILD_RAW * 1_000_000_000 +
          RUNTIME_REDUCER_CHILD_SHIFTED_TOKEN * 100_000_000 +
          RUNTIME_REDUCER_CHILD_RULE_NODE * 10_000_000 +
          RUNTIME_REDUCER_CHILD_FRAGMENT * 1_000_000 +
          RUNTIME_REDUCER_CHILD_FRAGMENT * 100_000 +
          RUNTIME_REDUCER_CHILD_UNKNOWN +
          RUNTIME_REDUCER_RESULT_RAW_CHILD +
          RUNTIME_REDUCER_RESULT_RULE_NODE +
          RUNTIME_REDUCER_RESULT_CHILD_FRAGMENT +
          RUNTIME_REDUCER_RESULT_SEPARATED_APPEND_FRAGMENT +
          RUNTIME_REDUCER_RESULT_UNKNOWN +
          RUNTIME_REDUCER_RESULT_SEQUENCE_FRAGMENT,
      },
    },
    {
      name: "parser replay reduction status classifies trace validity",
      program: parserReplayReductionStatusProgram,
      expected: {
        kind: "value",
        value: 10_000 +
          RUNTIME_REPLAY_REDUCTION_STATUS_UNKNOWN_PRODUCTION * 1_000 +
          RUNTIME_REPLAY_REDUCTION_STATUS_RULE_PAYLOAD_MISSING * 100 +
          RUNTIME_REPLAY_REDUCTION_STATUS_FIELD_PAYLOAD_MISSING * 10 +
          RUNTIME_REPLAY_REDUCTION_STATUS_STACK_UNDERFLOW,
      },
    },
    {
      name: "parser replay RHS start helper computes reduction stack slice",
      program: parserReplayRhsStartProgram,
      expected: { kind: "value", value: 530 },
    },
    {
      name: "parser replay stack depth helper accounts for sentinel value",
      program: parserReplayStackDepthProgram,
      expected: { kind: "value", value: 400 },
    },
    {
      name: "parser trace runtime emits deterministic action traces",
      program: parserTraceRuntimeProgram,
      expected: {
        kind: "value",
        value: 11114 + RUNTIME_TRACE_STATUS_UNEXPECTED +
          RUNTIME_TRACE_STATUS_BRANCH_LIMIT * 10 +
          RUNTIME_TRACE_STATUS_INTERNAL * 100,
      },
    },
    {
      name: "parser conflict trace runtime restores saved branches",
      program: parserConflictTraceRuntimeProgram,
      expected: {
        kind: "value",
        value: 111115 + RUNTIME_TRACE_STATUS_UNEXPECTED +
          RUNTIME_TRACE_STATUS_BRANCH_LIMIT * 10 +
          RUNTIME_TRACE_STATUS_INTERNAL * 100,
      },
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
      `${testCase.name} TypeScript result: expected ${
        JSON.stringify(testCase.expected)
      }, got ${JSON.stringify(typescript)}`,
    );
    assertEquals(
      JSON.stringify(wasm),
      JSON.stringify(testCase.expected),
      `${testCase.name} Wasm result: expected ${
        JSON.stringify(testCase.expected)
      }, got ${JSON.stringify(wasm)}`,
    );
  }
});

Deno.test("runtime language can emit standalone TypeScript helper functions", () => {
  const source = emitRuntimeLanguageTypeScriptFunction(
    UTF16_CODE_POINT_WIDTH_PROGRAM,
  );
  assertEquals(source.includes("function utf16CodePointWidth"), true);
  assertEquals(source.includes("runtimeLanguageVersion"), false);

  const arenaSource = emitRuntimeLanguageTypeScriptFunction(
    RUNTIME_ARENA_PROGRAM,
  );
  assertEquals(arenaSource.includes("function runtimeExpectObjectKind"), true);
  assertEquals(
    arenaSource.includes("runtimeExpectObjectKind(handle, 1)"),
    true,
  );
  assertEquals(
    arenaSource.includes("runtimeExpectObjectKind(handle, 2)"),
    true,
  );
  assertEquals(
    arenaSource.includes("runtimeExpectObjectKind(handle, 3)"),
    true,
  );
});

Deno.test("runtime language Wasm can export selected program functions", async () => {
  const program: RuntimeLanguageProgram = {
    name: "wasm_exports",
    entry: "main",
    functions: [
      {
        name: "double",
        parameters: [{ name: "value", type: "u32" }],
        result: "u32",
        body: [{ kind: "return", expression: mul(local("value"), u32(2)) }],
      },
      {
        name: "main",
        parameters: [{ name: "value", type: "u32" }],
        result: "u32",
        body: [{
          kind: "return",
          expression: add(call("double", [local("value")]), u32(1)),
        }],
      },
    ],
  };
  const bytes = compileRuntimeLanguageWasm(program, {
    exports: ["main", "double"],
  });
  const instantiated = await WebAssembly.instantiate(bytes, {}) as
    | WebAssembly.Instance
    | WebAssembly.WebAssemblyInstantiatedSource;
  const instance = "instance" in instantiated
    ? instantiated.instance
    : instantiated;
  const main = instance.exports.main as (value: number) => number;
  const double = instance.exports.double as (value: number) => number;

  assertEquals(main(20), 41);
  assertEquals(double(21), 42);
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
    texts: [{
      name: "label",
      value: "hi",
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
  assertEquals(ir.texts.length, 1);
  assertEquals(ir.textMap.get("label")?.value, "hi");
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

Deno.test("runtime language artifact manifest is current", () => {
  assertEquals(
    RUNTIME_LANGUAGE_ARTIFACTS_METADATA.format,
    "baba-runtime-language-artifacts",
  );
  assertEquals(RUNTIME_LANGUAGE_ARTIFACTS_METADATA.version, 1);
  assertEquals(
    RUNTIME_LANGUAGE_ARTIFACTS_METADATA.compilerHash,
    RUNTIME_LANGUAGE_COMPILER_METADATA.hash,
  );

  const artifacts = computeRuntimeLanguageArtifactMetadata();
  assertEquals(
    JSON.stringify(artifacts),
    JSON.stringify(RUNTIME_LANGUAGE_ARTIFACTS_METADATA.artifacts),
  );
  assertEquals(
    hashRuntimeLanguageArtifactsManifest(artifacts),
    RUNTIME_LANGUAGE_ARTIFACTS_METADATA.hash,
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

function text(name: string) {
  return { kind: "text" as const, name };
}

function textLength(value: RuntimeExpression) {
  return { kind: "textLength" as const, text: value };
}

function textCodeUnitAt(value: RuntimeExpression, index: RuntimeExpression) {
  return { kind: "textCodeUnitAt" as const, text: value, index };
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
