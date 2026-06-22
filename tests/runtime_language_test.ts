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
  createParserProductionRuntimeProgram,
  createParserReducerRuntimeProgram,
  createParserTableRuntimeProgram,
  createParserTraceRuntimeProgram,
  RUNTIME_ACTION_ACCEPT,
  RUNTIME_ACTION_REDUCE,
  RUNTIME_ACTION_SHIFT,
  RUNTIME_ARENA_PROGRAM,
  RUNTIME_FIELD_ARRAY,
  RUNTIME_FIELD_CAPTURE_ARRAY,
  RUNTIME_FIELD_CAPTURE_SCALAR,
  RUNTIME_FIELD_CAPTURE_TOO_MANY,
  RUNTIME_FIELD_FINAL_OK,
  RUNTIME_FIELD_FINAL_REQUIRED_MISSING,
  RUNTIME_FIELD_FINAL_TOO_MANY,
  RUNTIME_FIELD_NULLABLE,
  RUNTIME_FIELD_VALUE_ARRAY,
  RUNTIME_FIELD_VALUE_NULLABLE,
  RUNTIME_FIELD_VALUE_REQUIRED,
  RUNTIME_LEXER_SPEC_LITERAL,
  RUNTIME_LEXER_SPEC_STATUS_NOT_LITERAL,
  RUNTIME_LEXER_SPEC_STATUS_NOT_MAIN,
  RUNTIME_LEXER_SPEC_STATUS_NOT_TRIVIA,
  RUNTIME_LEXER_SPEC_STATUS_OK,
  RUNTIME_LEXER_SPEC_STATUS_UNKNOWN,
  RUNTIME_LEXER_SPEC_TRIVIA,
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
  RUNTIME_PUBLIC_TOKEN_ERROR,
  RUNTIME_PUBLIC_TOKEN_LITERAL,
  RUNTIME_PUBLIC_TOKEN_MAIN,
  RUNTIME_PUBLIC_TOKEN_TRIVIA,
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
  RUNTIME_TRACE_STATUS_BRANCH_LIMIT,
  RUNTIME_TRACE_STATUS_INTERNAL,
  RUNTIME_TRACE_STATUS_UNEXPECTED,
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
              u32(10_000),
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
      name: "runtime object helpers trap on wrong handle kind",
      program: arenaWrongKindProgram,
      expected: { kind: "trap" },
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
        value: RUNTIME_LEXICAL_TOKEN_STATUS_ERROR_TOKEN * 10_000 +
          1_000 + 100 +
          RUNTIME_LEXICAL_TOKEN_STATUS_NOT_TERMINAL * 10 +
          RUNTIME_LEXICAL_TOKEN_STATUS_NOT_TERMINAL,
      },
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
      expected: { kind: "value", value: 12026 },
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
