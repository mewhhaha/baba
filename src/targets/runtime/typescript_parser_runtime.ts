import type { AnalyzedGrammar } from "../../compiler/ir.ts";
import type { BnfGrammar, ReducerSpec } from "../typescript/bnf.ts";
import type { LrAction, LrActionSet, LrTable } from "../typescript/lr1.ts";
import {
  PARSER_DIAGNOSTIC_CODE_AMBIGUOUS_PARSE,
  PARSER_DIAGNOSTIC_CODE_BRANCH_LIMIT,
  PARSER_DIAGNOSTIC_CODE_INTERNAL_ERROR,
  PARSER_DIAGNOSTIC_CODE_PARSE_INVALID_TOKEN_STREAM,
  PARSER_DIAGNOSTIC_CODE_PARSE_LEXICAL_ERROR,
  PARSER_DIAGNOSTIC_CODE_PARSE_TRAILING_INPUT,
  PARSER_DIAGNOSTIC_CODE_PARSE_UNEXPECTED_TOKEN,
  PARSER_DIAGNOSTIC_CODE_TRACE_LIMIT,
  PARSER_DIAGNOSTIC_DETAIL_NONE,
  PARSER_DIAGNOSTIC_DETAIL_PARSER_STATE,
} from "./diagnostic_codes.ts";
import { collectRuleFieldSchemas } from "./field_schema.ts";
import {
  emitRuntimeLanguageTypeScriptFunction,
  type RuntimeLanguageProgram,
} from "./language.ts";
import {
  createLexerSpecRuntimeProgram,
  createParserActionRuntimeProgram,
  createParserConflictTraceRuntimeProgram,
  createParserExpectedRuntimeProgram,
  createParserFieldRuntimeProgram,
  createParserObjectRuntimeProgram,
  createParserProductionRuntimeProgram,
  createParserReducerRuntimeProgram,
  createParserReplayRuntimeProgram,
  createParserTraceRuntimeProgram,
  createSourceTextRuntimeProgram,
  RUNTIME_ACCEPTED_ROOT_STATUS_DIRECT,
  RUNTIME_ACCEPTED_ROOT_STATUS_FRAGMENT_VALUE,
  RUNTIME_ACTION_ACCEPT,
  RUNTIME_ACTION_NONE,
  RUNTIME_ACTION_PAYLOAD_MASK,
  RUNTIME_ACTION_REDUCE,
  RUNTIME_ACTION_SHIFT,
  RUNTIME_DIAGNOSTIC_CODE_STATUS_OK,
  RUNTIME_DIAGNOSTIC_MERGE_BOTH,
  RUNTIME_DIAGNOSTIC_MERGE_EMPTY,
  RUNTIME_DIAGNOSTIC_MERGE_LEFT,
  RUNTIME_DIAGNOSTIC_MERGE_RIGHT,
  RUNTIME_FIELD_ARRAY,
  RUNTIME_FIELD_ARRAY_VALUE_MISSING,
  RUNTIME_FIELD_BUILD_CAPTURE_WITHOUT_SCHEMA,
  RUNTIME_FIELD_BUILD_EMPTY,
  RUNTIME_FIELD_CAPTURE_ARRAY,
  RUNTIME_FIELD_CAPTURE_SCALAR,
  RUNTIME_FIELD_CAPTURE_TOO_MANY,
  RUNTIME_FIELD_ENTRY_MISSING,
  RUNTIME_FIELD_FINAL_BUILD_ARRAY,
  RUNTIME_FIELD_FINAL_BUILD_REQUIRED_MISSING,
  RUNTIME_FIELD_FINAL_BUILD_TOO_MANY,
  RUNTIME_FIELD_NULLABLE,
  RUNTIME_FIELD_SCALAR_VALUE_NULL,
  RUNTIME_FIELD_STORAGE_ARRAY,
  RUNTIME_LEXER_SPEC_LITERAL,
  RUNTIME_LEXER_SPEC_STATUS_NOT_LITERAL,
  RUNTIME_LEXER_SPEC_STATUS_NOT_MAIN,
  RUNTIME_LEXER_SPEC_STATUS_NOT_TRIVIA,
  RUNTIME_LEXER_SPEC_STATUS_OK,
  RUNTIME_LEXER_SPEC_TRIVIA,
  RUNTIME_LEXICAL_TOKEN_STATUS_OK,
  RUNTIME_NO_GOTO,
  RUNTIME_NO_PRODUCTION,
  RUNTIME_NO_REDUCER_PAYLOAD,
  RUNTIME_NO_TERMINAL,
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
  RUNTIME_PUBLIC_TOKEN_TYPE_EOF,
  RUNTIME_PUBLIC_TOKEN_TYPE_ERROR,
  RUNTIME_PUBLIC_TOKEN_TYPE_LITERAL,
  RUNTIME_PUBLIC_TOKEN_TYPE_NAMED,
  RUNTIME_PUBLIC_TOKEN_TYPE_UNKNOWN,
  RUNTIME_REDUCER_CHILD_FRAGMENT,
  RUNTIME_REDUCER_CHILD_RAW,
  RUNTIME_REDUCER_CHILD_RULE_NODE,
  RUNTIME_REDUCER_CHILD_SHIFTED_TOKEN,
  RUNTIME_REDUCER_FIELD,
  RUNTIME_REDUCER_IDENTITY,
  RUNTIME_REDUCER_OPERATION_APPEND,
  RUNTIME_REDUCER_OPERATION_EMPTY_ARRAY,
  RUNTIME_REDUCER_OPERATION_EMPTY_NULL,
  RUNTIME_REDUCER_OPERATION_FIELD,
  RUNTIME_REDUCER_OPERATION_FIRST_ARRAY,
  RUNTIME_REDUCER_OPERATION_IDENTITY,
  RUNTIME_REDUCER_OPERATION_RULE,
  RUNTIME_REDUCER_OPERATION_RULE_REF,
  RUNTIME_REDUCER_OPERATION_SEPARATED_APPEND,
  RUNTIME_REDUCER_OPERATION_SEQUENCE,
  RUNTIME_REDUCER_OPERATION_START,
  RUNTIME_REDUCER_OPERATION_TERMINAL,
  RUNTIME_REDUCER_OPERATION_UNKNOWN,
  RUNTIME_REDUCER_OPTIONAL_EMPTY,
  RUNTIME_REDUCER_OPTIONAL_SOME,
  RUNTIME_REDUCER_PAYLOAD_STATUS_FIELD_MISSING,
  RUNTIME_REDUCER_PAYLOAD_STATUS_RULE_MISSING,
  RUNTIME_REDUCER_REPEAT1_APPEND,
  RUNTIME_REDUCER_REPEAT1_FIRST,
  RUNTIME_REDUCER_REPEAT_APPEND,
  RUNTIME_REDUCER_REPEAT_EMPTY,
  RUNTIME_REDUCER_RESULT_APPEND_FRAGMENT,
  RUNTIME_REDUCER_RESULT_CHILD_FRAGMENT,
  RUNTIME_REDUCER_RESULT_EMPTY_ARRAY_FRAGMENT,
  RUNTIME_REDUCER_RESULT_EMPTY_NULL_FRAGMENT,
  RUNTIME_REDUCER_RESULT_FIELD_FRAGMENT,
  RUNTIME_REDUCER_RESULT_FIRST_ARRAY_FRAGMENT,
  RUNTIME_REDUCER_RESULT_RAW_CHILD,
  RUNTIME_REDUCER_RESULT_RULE_NODE,
  RUNTIME_REDUCER_RESULT_SEPARATED_APPEND_FRAGMENT,
  RUNTIME_REDUCER_RESULT_SEQUENCE_FRAGMENT,
  RUNTIME_REDUCER_RULE,
  RUNTIME_REDUCER_RULE_REF,
  RUNTIME_REDUCER_SEPARATED_APPEND,
  RUNTIME_REDUCER_SEPARATED_FIRST,
  RUNTIME_REDUCER_SEQUENCE,
  RUNTIME_REDUCER_START,
  RUNTIME_REDUCER_TERMINAL,
  RUNTIME_REPLAY_ACTION_STATUS_ACCEPT,
  RUNTIME_REPLAY_ACTION_STATUS_REDUCE,
  RUNTIME_REPLAY_ACTION_STATUS_SHIFT,
  RUNTIME_REPLAY_REDUCTION_STATUS_FIELD_PAYLOAD_MISSING,
  RUNTIME_REPLAY_REDUCTION_STATUS_OK,
  RUNTIME_REPLAY_REDUCTION_STATUS_RULE_PAYLOAD_MISSING,
  RUNTIME_REPLAY_REDUCTION_STATUS_STACK_UNDERFLOW,
  RUNTIME_REPLAY_REDUCTION_STATUS_UNKNOWN_PRODUCTION,
  RUNTIME_REPLAY_VM_STATUS_ENDED_WITHOUT_ACCEPT,
  RUNTIME_REPLAY_VM_STATUS_FIELD_PAYLOAD_MISSING,
  RUNTIME_REPLAY_VM_STATUS_OK,
  RUNTIME_REPLAY_VM_STATUS_REDUCTION_FAILED,
  RUNTIME_REPLAY_VM_STATUS_RULE_PAYLOAD_MISSING,
  RUNTIME_REPLAY_VM_STATUS_STACK_UNDERFLOW,
  RUNTIME_REPLAY_VM_STATUS_STREAM_UNDERFLOW,
  RUNTIME_REPLAY_VM_STATUS_UNKNOWN_ACTION,
  RUNTIME_REPLAY_VM_STATUS_UNKNOWN_PRODUCTION,
  RUNTIME_RULE_NODE_CHILD_LIST_EMPTY,
  RUNTIME_RUNTIME_VALUE_FRAGMENT,
  RUNTIME_RUNTIME_VALUE_RULE_NODE,
  RUNTIME_RUNTIME_VALUE_TOKEN,
  RUNTIME_RUNTIME_VALUE_VECTOR,
  RUNTIME_SHIFTED_TOKEN_STATUS_OK,
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
  RUNTIME_TRACE_STATUS_AMBIGUOUS,
  RUNTIME_TRACE_STATUS_BRANCH_LIMIT,
  RUNTIME_TRACE_STATUS_OK,
  RUNTIME_TRACE_STATUS_TRACE_LIMIT,
  RUNTIME_TRACE_STATUS_UNEXPECTED,
  RUNTIME_TRACE_TOKEN_STREAM_EMIT,
  RUNTIME_TRACE_TOKEN_STREAM_SKIP,
  RUNTIME_TRACE_TOKEN_STREAM_STOP,
} from "./language_sources.ts";
import { emitPublicDiagnosticMaterializer } from "./public_diagnostic_materializer.ts";
import { emitPublicFieldMaterializer } from "./public_field_materializer.ts";
import { emitPublicParseResultMaterializer } from "./public_parse_result_materializer.ts";
import { emitPublicRuleNodeMaterializer } from "./public_rule_node_materializer.ts";
import { emitPublicSourceTextBoundary } from "./public_source_text.ts";
import { emitPublicEofTokenMaterializer } from "./public_token_materializer.ts";
import { generatedSourceBanner } from "./provenance.ts";
import type {
  PortableParserPlan,
  PortableReducerPlan,
} from "./portable_plan.ts";

export type ParserEmitMode = "typescript" | "wasm";

export interface ParserEmitOptions {
  mode?: ParserEmitMode;
  parserPlanVersion?: number;
  parserPlanSemantics?: string;
}

type EncodedAction =
  | readonly [terminal: number, kind: 1, state: number]
  | readonly [terminal: number, kind: 2, production: number]
  | readonly [terminal: number, kind: 3];

type GotoEntry = readonly [nonterminal: number, state: number];

interface ParserRuntimeModel {
  readonly eofTerminal: number;
  readonly hasBranchingActions: boolean;
  readonly actionRows: readonly (readonly EncodedAction[])[];
  readonly gotoRows: readonly (readonly GotoEntry[])[];
  readonly runtimeProductions: readonly (readonly [
    lhs: number,
    length: number,
  ])[];
  readonly reducerEntries:
    readonly (readonly [kind: number, payload: number])[];
  readonly fieldRows: readonly (readonly (readonly [
    fieldId: number,
    flags: number,
  ])[])[];
  readonly expectedRows: readonly (readonly string[])[];
  readonly lexerSpecs: readonly (readonly [
    flags: number,
    payload: number,
    terminal: number,
  ])[];
  readonly namedSpecIndices: readonly (readonly [string, number])[];
  readonly literalSpecIndices: readonly (readonly [string, number])[];
  readonly ruleNames: readonly string[];
  readonly fieldNames: readonly string[];
}

export function emitParser(
  analyzed: AnalyzedGrammar,
  bnf: BnfGrammar,
  lr: LrTable,
  options: ParserEmitOptions = {},
): string {
  return emitParserModel(
    parserRuntimeModelFromCompiler(analyzed, bnf, lr),
    options,
  );
}

export function emitParserFromPortablePlan(
  plan: PortableParserPlan,
  options: ParserEmitOptions = {},
): string {
  return emitParserModel(parserRuntimeModelFromPortablePlan(plan), {
    ...options,
    parserPlanVersion: plan.version,
    parserPlanSemantics: plan.semantics,
  });
}

function emitParserModel(
  model: ParserRuntimeModel,
  options: ParserEmitOptions = {},
): string {
  const mode = options.mode ?? "typescript";
  const emitTypeScriptTables = mode === "typescript";
  const emitBranchRuntime = mode === "typescript" &&
    model.hasBranchingActions;
  const tableRuntimeProgram = emitTypeScriptTables
    ? emitBranchRuntime
      ? createParserConflictTraceRuntimeProgram({
        actionRows: parserRuntimeActionRows(model.actionRows),
        gotoRows: model.gotoRows,
        productions: model.runtimeProductions,
      })
      : createParserTraceRuntimeProgram({
        actionRows: parserRuntimeActionRows(model.actionRows),
        gotoRows: model.gotoRows,
        productions: model.runtimeProductions,
      })
    : null;
  const productionRuntimeProgram = createParserProductionRuntimeProgram({
    productions: model.runtimeProductions,
  });
  const actionRuntimeProgram = createParserActionRuntimeProgram();
  const reducerRuntimeProgram = createParserReducerRuntimeProgram({
    reducers: model.reducerEntries,
  });
  const fieldRuntimeProgram = createParserFieldRuntimeProgram({
    fieldRows: model.fieldRows,
  });
  const parserObjectRuntimeProgram = createParserObjectRuntimeProgram({
    includeArena: tableRuntimeProgram === null,
  });
  const parserReplayRuntimeProgram = createParserReplayRuntimeProgram();
  const expectedRuntimeProgram = createParserExpectedRuntimeProgram({
    rowLengths: model.expectedRows.map((row) => row.length),
    rowHasEof: model.expectedRows.map((row) => row.includes("EOF")),
  });
  const lexerSpecRuntimeProgram = createLexerSpecRuntimeProgram({
    specs: model.lexerSpecs,
  });
  const runtimeProgram = mergeRuntimePrograms(
    tableRuntimeProgram
      ? mergeRuntimePrograms(tableRuntimeProgram, expectedRuntimeProgram)
      : mergeRuntimePrograms(
        mergeRuntimePrograms(productionRuntimeProgram, actionRuntimeProgram),
        expectedRuntimeProgram,
      ),
    reducerRuntimeProgram,
  );
  const runtimeWithFields = mergeRuntimePrograms(
    mergeRuntimePrograms(
      runtimeProgram,
      lexerSpecRuntimeProgram,
    ),
    mergeRuntimePrograms(
      mergeRuntimePrograms(fieldRuntimeProgram, parserObjectRuntimeProgram),
      parserReplayRuntimeProgram,
    ),
  );
  const runtimeWithSourceText = mergeRuntimePrograms(
    runtimeWithFields,
    createSourceTextRuntimeProgram(),
  );

  return `${
    generatedSourceBanner({
      parserPlanVersion: options.parserPlanVersion,
      parserPlanSemantics: options.parserPlanSemantics,
    })
  }
${importSource(mode)}

${commonTypes(mode)}
${
    commonConstants({
      eofTerminal: model.eofTerminal,
      expectedRows: model.expectedRows,
      namedSpecIndices: model.namedSpecIndices,
      literalSpecIndices: model.literalSpecIndices,
      ruleNames: model.ruleNames,
      fieldNames: model.fieldNames,
    })
  }

${parserTableRuntime(runtimeWithSourceText)}
${emitPublicSourceTextBoundary()}
${emitPublicEofTokenMaterializer()}
${emitPublicDiagnosticMaterializer()}
${emitPublicFieldMaterializer()}
${emitPublicRuleNodeMaterializer()}
${emitPublicParseResultMaterializer()}

${parseEntryPoints(mode)}

${mode === "wasm" ? wasmParseRuntime() : deterministicParseRuntime()}

${reductionRuntime().trimEnd()}
`;
}

function parserRuntimeModelFromCompiler(
  analyzed: AnalyzedGrammar,
  bnf: BnfGrammar,
  lr: LrTable,
): ParserRuntimeModel {
  const actionRows = bnfActionTableRows(lr.actions);
  const gotoRows = bnfTableRows(lr.gotos, (nonterminal, target) => [
    nonterminal,
    target,
  ]);
  const runtimeProductions = bnf.productions.map((production) =>
    [production.lhs, production.rhs.length] as const
  );
  const fieldSchemaModels = collectRuleFieldSchemas(analyzed);
  const fieldNames = [
    ...new Set([
      ...fieldSchemaModels.flatMap((schema) =>
        schema.fields.map((field) => field.name)
      ),
      ...bnf.productions.flatMap((production) =>
        production.reducer.kind === "field" ? [production.reducer.name] : []
      ),
    ]),
  ].sort((left, right) => left.localeCompare(right));
  const fieldIds = new Map(fieldNames.map((name, index) => [name, index]));
  const fieldRows: Array<Array<readonly [fieldId: number, flags: number]>> =
    Array.from({ length: analyzed.rules.length }, () => []);
  for (const schema of fieldSchemaModels) {
    fieldRows[schema.ruleId] = schema.fields.map((field) =>
      [
        fieldIds.get(field.name)!,
        (field.array ? RUNTIME_FIELD_ARRAY : 0) |
        (field.nullable ? RUNTIME_FIELD_NULLABLE : 0),
      ] as const
    );
  }
  const namedTerminalIds = new Map<number, number>();
  const literalTerminalIds = new Map<number, number>();
  for (const terminal of bnf.terminals) {
    if (terminal.kind === "named") {
      namedTerminalIds.set(terminal.tokenId!, terminal.id);
    }
    if (terminal.kind === "literal") {
      literalTerminalIds.set(terminal.literalId!, terminal.id);
    }
  }
  const namedTokens = analyzed.tokens
    .filter((token) =>
      token.kind === "skip" ||
      (token.kind === "token" && analyzed.reachableTokens.has(token.id))
    );
  const literalSpecs = analyzed.literals
    .filter((literal) => analyzed.reachableLiterals.has(literal.id));
  const literalSpecOffset = namedTokens.length;
  return {
    eofTerminal: bnf.eofTerminal,
    hasBranchingActions: hasMultiActionEntries(lr.actions),
    actionRows,
    gotoRows,
    runtimeProductions,
    reducerEntries: bnf.productions.map((production) =>
      parserRuntimeReducerEntry(production.reducer, fieldIds)
    ),
    fieldRows,
    expectedRows: expectedTerminalRows(bnf, lr),
    lexerSpecs: [
      ...namedTokens.map((token, payload) =>
        [
          token.kind === "skip" ? RUNTIME_LEXER_SPEC_TRIVIA : 0,
          payload,
          token.kind === "skip" ? -1 : namedTerminalIds.get(token.id) ?? -1,
        ] as const
      ),
      ...literalSpecs.map((literal, payload) =>
        [
          RUNTIME_LEXER_SPEC_LITERAL,
          payload,
          literalTerminalIds.get(literal.id) ?? -1,
        ] as const
      ),
    ],
    namedSpecIndices: namedTokens.map((token, index) =>
      [token.name, index] as const
    ),
    literalSpecIndices: literalSpecs.map((literal, index) =>
      [literal.value, literalSpecOffset + index] as const
    ),
    ruleNames: analyzed.rules.map((rule) => rule.name),
    fieldNames,
  };
}

function parserRuntimeModelFromPortablePlan(
  plan: PortableParserPlan,
): ParserRuntimeModel {
  const fieldNames = [...plan.symbols.fields]
    .sort((left, right) => left.id - right.id)
    .map((field) => field.name);
  const fieldIds = new Map(
    fieldNames.map((name, index) => [name, index] as const),
  );
  const maxRuleId = Math.max(
    -1,
    ...plan.diagnostics.ruleDisplays.map((rule) => rule.id),
    ...plan.cst.rules.map((rule) => rule.ruleId),
  );
  const fieldRows: Array<Array<readonly [fieldId: number, flags: number]>> =
    Array.from({ length: maxRuleId + 1 }, () => []);
  for (const schema of plan.cst.rules) {
    fieldRows[schema.ruleId] = schema.fields.map((field) =>
      [
        fieldIds.get(field.name) ?? -1,
        (field.array ? RUNTIME_FIELD_ARRAY : 0) |
        (field.nullable ? RUNTIME_FIELD_NULLABLE : 0),
      ] as const
    );
  }
  const ruleNames = Array.from(
    { length: maxRuleId + 1 },
    (_, index) =>
      plan.diagnostics.ruleDisplays.find((rule) => rule.id === index)
        ?.display ??
        `rule_${index}`,
  );
  const namedSpecs = plan.lexer.specifications
    .filter((spec) => spec.type === "named");
  const literalSpecs = plan.lexer.specifications
    .filter((spec) => spec.type === "literal");
  const literalSpecOffset = namedSpecs.length;
  const terminalDisplays = new Map(
    plan.diagnostics.terminalDisplays.map((terminal) =>
      [terminal.id, terminal.display] as const
    ),
  );
  return {
    eofTerminal: plan.parser.eofTerminal,
    hasBranchingActions: plan.parser.actions.some((row) =>
      row.entries.some((entry) => entry.actions.length > 1)
    ),
    actionRows: actionRowsFromPortablePlan(plan),
    gotoRows: gotoRowsFromPortablePlan(plan),
    runtimeProductions: plan.parser.productions.map((production) =>
      [production.lhs, production.rhs.length] as const
    ),
    reducerEntries: plan.reducers
      .slice()
      .sort((left, right) => left.id - right.id)
      .map(portableReducerRuntimeEntry),
    fieldRows,
    expectedRows: plan.diagnostics.expectedTerminalsByState.map((row) =>
      row.terminals.map((terminal) =>
        terminalDisplays.get(terminal) ?? `#${terminal}`
      ).sort()
    ),
    lexerSpecs: [
      ...namedSpecs.map((spec, payload) =>
        [
          spec.channel === "trivia" ? RUNTIME_LEXER_SPEC_TRIVIA : 0,
          payload,
          spec.terminalId ?? -1,
        ] as const
      ),
      ...literalSpecs.map((spec, payload) =>
        [
          RUNTIME_LEXER_SPEC_LITERAL,
          payload,
          spec.terminalId,
        ] as const
      ),
    ],
    namedSpecIndices: namedSpecs.map((spec, index) => {
      const token = plan.symbols.tokens[spec.tokenId];
      return [token?.name ?? `token_${spec.tokenId}`, index] as const;
    }),
    literalSpecIndices: literalSpecs.map((spec, index) => {
      const literal = plan.symbols.literals[spec.literalId];
      return [
        literal?.value ?? "",
        literalSpecOffset + index,
      ] as const;
    }),
    ruleNames,
    fieldNames,
  };
}

function actionRowsFromPortablePlan(
  plan: PortableParserPlan,
): EncodedAction[][] {
  const byState = new Map(plan.parser.actions.map((row) => [row.state, row]));
  return plan.parser.states.map((state) =>
    (byState.get(state.id)?.entries ?? []).flatMap((entry) =>
      entry.actions.map((action) => {
        if (action.kind === "shift") {
          return [entry.terminal, 1, action.state] as const;
        }
        if (action.kind === "reduce") {
          return [entry.terminal, 2, action.production] as const;
        }
        return [entry.terminal, 3] as const;
      })
    )
  );
}

function gotoRowsFromPortablePlan(plan: PortableParserPlan): GotoEntry[][] {
  const byState = new Map(plan.parser.gotos.map((row) => [row.state, row]));
  return plan.parser.states.map((state) =>
    (byState.get(state.id)?.entries ?? []).map((entry) =>
      [entry.nonterminal, entry.target] as const
    )
  );
}

function portableReducerRuntimeEntry(
  reducer: PortableReducerPlan,
): readonly [kind: number, payload: number] {
  switch (reducer.op) {
    case "start":
      return [RUNTIME_REDUCER_START, RUNTIME_NO_REDUCER_PAYLOAD];
    case "rule":
      return [RUNTIME_REDUCER_RULE, reducer.ruleId];
    case "terminal":
      return [RUNTIME_REDUCER_TERMINAL, RUNTIME_NO_REDUCER_PAYLOAD];
    case "rule-ref":
      return [RUNTIME_REDUCER_RULE_REF, RUNTIME_NO_REDUCER_PAYLOAD];
    case "identity":
      return [RUNTIME_REDUCER_IDENTITY, RUNTIME_NO_REDUCER_PAYLOAD];
    case "sequence":
      return [RUNTIME_REDUCER_SEQUENCE, RUNTIME_NO_REDUCER_PAYLOAD];
    case "optional-empty":
      return [RUNTIME_REDUCER_OPTIONAL_EMPTY, RUNTIME_NO_REDUCER_PAYLOAD];
    case "optional-some":
      return [RUNTIME_REDUCER_OPTIONAL_SOME, RUNTIME_NO_REDUCER_PAYLOAD];
    case "repeat-empty":
      return [RUNTIME_REDUCER_REPEAT_EMPTY, RUNTIME_NO_REDUCER_PAYLOAD];
    case "repeat-append":
      return [RUNTIME_REDUCER_REPEAT_APPEND, RUNTIME_NO_REDUCER_PAYLOAD];
    case "repeat1-first":
      return [RUNTIME_REDUCER_REPEAT1_FIRST, RUNTIME_NO_REDUCER_PAYLOAD];
    case "repeat1-append":
      return [RUNTIME_REDUCER_REPEAT1_APPEND, RUNTIME_NO_REDUCER_PAYLOAD];
    case "separated-first":
      return [RUNTIME_REDUCER_SEPARATED_FIRST, RUNTIME_NO_REDUCER_PAYLOAD];
    case "separated-append":
      return [RUNTIME_REDUCER_SEPARATED_APPEND, RUNTIME_NO_REDUCER_PAYLOAD];
    case "field":
      return [RUNTIME_REDUCER_FIELD, reducer.fieldId];
  }
}

function importSource(mode: ParserEmitMode): string {
  const lexerImport = mode === "wasm"
    ? `import { lex, lexForParse, type WasmParseStream } from "./lexer.ts";
import { createParseTraceInput, getWasmParserInstanceLimits, parseTrace, WasmResourceLimitError, type ParseTraceInput } from "./wasm.ts";`
    : `import { lex, lexForParse, type ParseLexCandidateStream } from "./lexer.ts";`;
  return `${lexerImport}
import type {
  AnyRuleNode,
  LexDiagnostic,
  ParseDiagnostic,
  ParseOptions,
  ParseResult,
  RootNode,
  Span,
  SyntaxElement,
  Token,
} from "./syntax.ts";`;
}

function commonTypes(mode: ParserEmitMode): string {
  const cstLimitSource = mode === "wasm"
    ? `function currentParserCstResourceLimits(): ParserCstResourceLimits {
  return getWasmParserInstanceLimits();
}

function currentParserDiagnosticLimit(): number | undefined {
  return getWasmParserInstanceLimits().maxDiagnostics;
}

function cstResourceLimitError(limit: number, actual: number): Error {
  return new WasmResourceLimitError(
    "CST_NODE_LIMIT_EXCEEDED",
    limit,
    actual,
  );
}

function diagnosticResourceLimitError(limit: number, actual: number): Error {
  return new WasmResourceLimitError(
    "DIAGNOSTIC_LIMIT_EXCEEDED",
    limit,
    actual,
  );
}`
    : `function currentParserCstResourceLimits(): ParserCstResourceLimits {
  return {};
}

function currentParserDiagnosticLimit(): number | undefined {
  return undefined;
}

function cstResourceLimitError(limit: number, actual: number): Error {
  return new RangeError(
    "CST_NODE_LIMIT_EXCEEDED: limit " + limit + ", actual " + actual + ".",
  );
}

function diagnosticResourceLimitError(limit: number, actual: number): Error {
  return new RangeError(
    "DIAGNOSTIC_LIMIT_EXCEEDED: limit " + limit + ", actual " + actual + ".",
  );
}`;
  return `interface TokenRange {
  start: number;
  end: number;
}

interface ContextualLexingStatsRecord {
  ambiguousLexicalSites: number;
  contextualCandidateChecks: number;
  attemptedTokenSelections: number;
  reductionsBeforeTokenSelection: number;
}

interface ParserRuntimeLimits {
  maxExploredBranches: number;
  maxQueuedBranches: number;
  maxTraceActions: number;
  ambiguityMode: number;
}

interface ParserCstResourceLimits {
  maxCstNodes?: number;
  maxCstChildren?: number;
}

${cstLimitSource}

function reportContextualLexingStats(
  reportStats: ParseOptions["contextualLexingStats"] | undefined,
  stats: ContextualLexingStatsRecord,
): void {
  if (reportStats) reportStats(stats);
}

function normalizeParserRuntimeLimits(options: ParseOptions): ParserRuntimeLimits {
  return {
    maxExploredBranches: normalizePositiveIntegerOption(
      "maxExploredBranches",
      options.maxExploredBranches,
      DEFAULT_MAX_EXPLORED_BRANCHES,
    ),
    maxQueuedBranches: normalizePositiveIntegerOption(
      "maxQueuedBranches",
      options.maxQueuedBranches,
      DEFAULT_MAX_QUEUED_BRANCHES,
    ),
    maxTraceActions: normalizePositiveIntegerOption(
      "maxTraceActions",
      options.maxTraceActions,
      DEFAULT_MAX_TRACE_ACTIONS,
    ),
    ambiguityMode: normalizeAmbiguityMode(options.ambiguityMode),
  };
}

function normalizePositiveIntegerOption(
  name: string,
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(name + " must be a positive integer.");
  }
  return value;
}

function normalizeAmbiguityMode(
  ambiguityMode: ParseOptions["ambiguityMode"] | undefined,
): number {
  if (ambiguityMode === undefined || ambiguityMode === "first-success") return 0;
  if (ambiguityMode === "reject-ambiguous-success") return 1;
  throw new RangeError(
    "ambiguityMode must be 'first-success' or 'reject-ambiguous-success'.",
  );
}

function countTraceReductions(trace: Int32Array): number {
  let reductions = 0;
  for (let index = 0; index < trace.length; index++) {
    if ((trace[index] & ~ACTION_PAYLOAD_MASK) === ACTION_REDUCE) reductions++;
  }
  return reductions;
}

`;
}

function commonConstants(values: {
  eofTerminal: number;
  expectedRows: readonly (readonly string[])[];
  namedSpecIndices: readonly (readonly [string, number])[];
  literalSpecIndices: readonly (readonly [string, number])[];
  ruleNames: readonly string[];
  fieldNames: readonly string[];
}): string {
  const expectedTerminals = values.expectedRows.flat();
  return `const EOF_TERMINAL = ${values.eofTerminal};
const EXPECTED_TERMINALS: readonly string[] = ${
    JSON.stringify(expectedTerminals)
  };
const NAMED_SPEC_INDICES = new Map<string, number>(${
    JSON.stringify(values.namedSpecIndices)
  });
const LITERAL_SPEC_INDICES = new Map<string, number>(${
    JSON.stringify(values.literalSpecIndices)
  });
const RULE_NAMES: readonly string[] = ${JSON.stringify(values.ruleNames)};
const FIELD_NAMES: readonly string[] = ${JSON.stringify(values.fieldNames)};
const EMPTY_PARSE_DIAGNOSTICS = [] as const;
const DEFAULT_MAX_EXPLORED_BRANCHES = 100_000;
const DEFAULT_MAX_QUEUED_BRANCHES = 100_000;
const DEFAULT_MAX_TRACE_ACTIONS = 1_000_000;
const DEFAULT_PARSER_RUNTIME_LIMITS: ParserRuntimeLimits = {
  maxExploredBranches: DEFAULT_MAX_EXPLORED_BRANCHES,
  maxQueuedBranches: DEFAULT_MAX_QUEUED_BRANCHES,
  maxTraceActions: DEFAULT_MAX_TRACE_ACTIONS,
  ambiguityMode: 0,
};`;
}

function parserTableRuntime(program: RuntimeLanguageProgram): string {
  return `const ACTION_NONE = ${RUNTIME_ACTION_NONE};
const ACTION_SHIFT = ${RUNTIME_ACTION_SHIFT};
const ACTION_REDUCE = ${RUNTIME_ACTION_REDUCE};
const ACTION_ACCEPT = ${RUNTIME_ACTION_ACCEPT};
const ACTION_PAYLOAD_MASK = ${RUNTIME_ACTION_PAYLOAD_MASK};
const TRACE_STATUS_OK = ${RUNTIME_TRACE_STATUS_OK};
const TRACE_STATUS_UNEXPECTED = ${RUNTIME_TRACE_STATUS_UNEXPECTED};
const TRACE_STATUS_BRANCH_LIMIT = ${RUNTIME_TRACE_STATUS_BRANCH_LIMIT};
const TRACE_STATUS_TRACE_LIMIT = ${RUNTIME_TRACE_STATUS_TRACE_LIMIT};
const TRACE_STATUS_AMBIGUOUS = ${RUNTIME_TRACE_STATUS_AMBIGUOUS};
const REPLAY_ACTION_SHIFT = ${RUNTIME_REPLAY_ACTION_STATUS_SHIFT};
const REPLAY_ACTION_REDUCE = ${RUNTIME_REPLAY_ACTION_STATUS_REDUCE};
const REPLAY_ACTION_ACCEPT = ${RUNTIME_REPLAY_ACTION_STATUS_ACCEPT};
const ACCEPTED_ROOT_DIRECT = ${RUNTIME_ACCEPTED_ROOT_STATUS_DIRECT};
const ACCEPTED_ROOT_FRAGMENT_VALUE = ${RUNTIME_ACCEPTED_ROOT_STATUS_FRAGMENT_VALUE};
const NO_GOTO = ${RUNTIME_NO_GOTO};
const NO_TERMINAL = ${RUNTIME_NO_TERMINAL};
const NO_PRODUCTION = ${RUNTIME_NO_PRODUCTION};
const REDUCER_OPERATION_UNKNOWN = ${RUNTIME_REDUCER_OPERATION_UNKNOWN};
const REDUCER_OPERATION_START = ${RUNTIME_REDUCER_OPERATION_START};
const REDUCER_OPERATION_RULE = ${RUNTIME_REDUCER_OPERATION_RULE};
const REDUCER_OPERATION_TERMINAL = ${RUNTIME_REDUCER_OPERATION_TERMINAL};
const REDUCER_OPERATION_RULE_REF = ${RUNTIME_REDUCER_OPERATION_RULE_REF};
const REDUCER_OPERATION_IDENTITY = ${RUNTIME_REDUCER_OPERATION_IDENTITY};
const REDUCER_OPERATION_SEQUENCE = ${RUNTIME_REDUCER_OPERATION_SEQUENCE};
const REDUCER_OPERATION_EMPTY_NULL = ${RUNTIME_REDUCER_OPERATION_EMPTY_NULL};
const REDUCER_OPERATION_EMPTY_ARRAY = ${RUNTIME_REDUCER_OPERATION_EMPTY_ARRAY};
const REDUCER_OPERATION_APPEND = ${RUNTIME_REDUCER_OPERATION_APPEND};
const REDUCER_OPERATION_FIRST_ARRAY = ${RUNTIME_REDUCER_OPERATION_FIRST_ARRAY};
const REDUCER_OPERATION_SEPARATED_APPEND = ${RUNTIME_REDUCER_OPERATION_SEPARATED_APPEND};
const REDUCER_OPERATION_FIELD = ${RUNTIME_REDUCER_OPERATION_FIELD};
const REDUCER_PAYLOAD_RULE_MISSING = ${RUNTIME_REDUCER_PAYLOAD_STATUS_RULE_MISSING};
const REDUCER_PAYLOAD_FIELD_MISSING = ${RUNTIME_REDUCER_PAYLOAD_STATUS_FIELD_MISSING};
const REDUCER_CHILD_RAW = ${RUNTIME_REDUCER_CHILD_RAW};
const REDUCER_CHILD_FRAGMENT = ${RUNTIME_REDUCER_CHILD_FRAGMENT};
const REDUCER_CHILD_SHIFTED_TOKEN = ${RUNTIME_REDUCER_CHILD_SHIFTED_TOKEN};
const REDUCER_CHILD_RULE_NODE = ${RUNTIME_REDUCER_CHILD_RULE_NODE};
const REDUCER_RESULT_RAW_CHILD = ${RUNTIME_REDUCER_RESULT_RAW_CHILD};
const REDUCER_RESULT_RULE_NODE = ${RUNTIME_REDUCER_RESULT_RULE_NODE};
const REDUCER_RESULT_CHILD_FRAGMENT = ${RUNTIME_REDUCER_RESULT_CHILD_FRAGMENT};
const REDUCER_RESULT_SEQUENCE_FRAGMENT = ${RUNTIME_REDUCER_RESULT_SEQUENCE_FRAGMENT};
const REDUCER_RESULT_EMPTY_NULL_FRAGMENT = ${RUNTIME_REDUCER_RESULT_EMPTY_NULL_FRAGMENT};
const REDUCER_RESULT_EMPTY_ARRAY_FRAGMENT = ${RUNTIME_REDUCER_RESULT_EMPTY_ARRAY_FRAGMENT};
const REDUCER_RESULT_APPEND_FRAGMENT = ${RUNTIME_REDUCER_RESULT_APPEND_FRAGMENT};
const REDUCER_RESULT_FIRST_ARRAY_FRAGMENT = ${RUNTIME_REDUCER_RESULT_FIRST_ARRAY_FRAGMENT};
const REDUCER_RESULT_SEPARATED_APPEND_FRAGMENT = ${RUNTIME_REDUCER_RESULT_SEPARATED_APPEND_FRAGMENT};
const REDUCER_RESULT_FIELD_FRAGMENT = ${RUNTIME_REDUCER_RESULT_FIELD_FRAGMENT};
const REPLAY_REDUCTION_OK = ${RUNTIME_REPLAY_REDUCTION_STATUS_OK};
const REPLAY_REDUCTION_UNKNOWN_PRODUCTION = ${RUNTIME_REPLAY_REDUCTION_STATUS_UNKNOWN_PRODUCTION};
const REPLAY_REDUCTION_RULE_PAYLOAD_MISSING = ${RUNTIME_REPLAY_REDUCTION_STATUS_RULE_PAYLOAD_MISSING};
const REPLAY_REDUCTION_FIELD_PAYLOAD_MISSING = ${RUNTIME_REPLAY_REDUCTION_STATUS_FIELD_PAYLOAD_MISSING};
const REPLAY_REDUCTION_STACK_UNDERFLOW = ${RUNTIME_REPLAY_REDUCTION_STATUS_STACK_UNDERFLOW};
const REPLAY_VM_OK = ${RUNTIME_REPLAY_VM_STATUS_OK};
const REPLAY_VM_UNKNOWN_ACTION = ${RUNTIME_REPLAY_VM_STATUS_UNKNOWN_ACTION};
const REPLAY_VM_UNKNOWN_PRODUCTION = ${RUNTIME_REPLAY_VM_STATUS_UNKNOWN_PRODUCTION};
const REPLAY_VM_RULE_PAYLOAD_MISSING = ${RUNTIME_REPLAY_VM_STATUS_RULE_PAYLOAD_MISSING};
const REPLAY_VM_FIELD_PAYLOAD_MISSING = ${RUNTIME_REPLAY_VM_STATUS_FIELD_PAYLOAD_MISSING};
const REPLAY_VM_STACK_UNDERFLOW = ${RUNTIME_REPLAY_VM_STATUS_STACK_UNDERFLOW};
const REPLAY_VM_REDUCTION_FAILED = ${RUNTIME_REPLAY_VM_STATUS_REDUCTION_FAILED};
const REPLAY_VM_STREAM_UNDERFLOW = ${RUNTIME_REPLAY_VM_STATUS_STREAM_UNDERFLOW};
const REPLAY_VM_ENDED_WITHOUT_ACCEPT = ${RUNTIME_REPLAY_VM_STATUS_ENDED_WITHOUT_ACCEPT};
const RULE_NODE_CHILD_LIST_EMPTY = ${RUNTIME_RULE_NODE_CHILD_LIST_EMPTY};
const RUNTIME_VALUE_TOKEN = ${RUNTIME_RUNTIME_VALUE_TOKEN};
const RUNTIME_VALUE_RULE_NODE = ${RUNTIME_RUNTIME_VALUE_RULE_NODE};
const RUNTIME_VALUE_VECTOR = ${RUNTIME_RUNTIME_VALUE_VECTOR};
const RUNTIME_VALUE_FRAGMENT = ${RUNTIME_RUNTIME_VALUE_FRAGMENT};
const SHIFTED_TOKEN_OK = ${RUNTIME_SHIFTED_TOKEN_STATUS_OK};
const FIELD_ENTRY_MISSING = ${RUNTIME_FIELD_ENTRY_MISSING};
const FIELD_ARRAY_VALUE_MISSING = ${RUNTIME_FIELD_ARRAY_VALUE_MISSING};
const FIELD_STORAGE_ARRAY = ${RUNTIME_FIELD_STORAGE_ARRAY};
const FIELD_CAPTURE_ARRAY = ${RUNTIME_FIELD_CAPTURE_ARRAY};
const FIELD_CAPTURE_SCALAR = ${RUNTIME_FIELD_CAPTURE_SCALAR};
const FIELD_CAPTURE_TOO_MANY = ${RUNTIME_FIELD_CAPTURE_TOO_MANY};
const FIELD_BUILD_EMPTY = ${RUNTIME_FIELD_BUILD_EMPTY};
const FIELD_BUILD_CAPTURE_WITHOUT_SCHEMA = ${RUNTIME_FIELD_BUILD_CAPTURE_WITHOUT_SCHEMA};
const FIELD_SCALAR_VALUE_NULL = ${RUNTIME_FIELD_SCALAR_VALUE_NULL};
const FIELD_FINAL_BUILD_ARRAY = ${RUNTIME_FIELD_FINAL_BUILD_ARRAY};
const FIELD_FINAL_BUILD_REQUIRED_MISSING = ${RUNTIME_FIELD_FINAL_BUILD_REQUIRED_MISSING};
const FIELD_FINAL_BUILD_TOO_MANY = ${RUNTIME_FIELD_FINAL_BUILD_TOO_MANY};
const DIAGNOSTIC_MERGE_EMPTY = ${RUNTIME_DIAGNOSTIC_MERGE_EMPTY};
const DIAGNOSTIC_MERGE_LEFT = ${RUNTIME_DIAGNOSTIC_MERGE_LEFT};
const DIAGNOSTIC_MERGE_RIGHT = ${RUNTIME_DIAGNOSTIC_MERGE_RIGHT};
const DIAGNOSTIC_MERGE_BOTH = ${RUNTIME_DIAGNOSTIC_MERGE_BOTH};
const DIAGNOSTIC_CODE_OK = ${RUNTIME_DIAGNOSTIC_CODE_STATUS_OK};
const PUBLIC_TOKEN_LITERAL = ${RUNTIME_PUBLIC_TOKEN_LITERAL};
const PUBLIC_TOKEN_MAIN = ${RUNTIME_PUBLIC_TOKEN_MAIN};
const PUBLIC_TOKEN_TRIVIA = ${RUNTIME_PUBLIC_TOKEN_TRIVIA};
const PUBLIC_TOKEN_ERROR = ${RUNTIME_PUBLIC_TOKEN_ERROR};
const PUBLIC_TOKEN_EOF = ${RUNTIME_PUBLIC_TOKEN_EOF};
const PUBLIC_TOKEN_TYPE_UNKNOWN = ${RUNTIME_PUBLIC_TOKEN_TYPE_UNKNOWN};
const PUBLIC_TOKEN_TYPE_LITERAL = ${RUNTIME_PUBLIC_TOKEN_TYPE_LITERAL};
const PUBLIC_TOKEN_TYPE_NAMED = ${RUNTIME_PUBLIC_TOKEN_TYPE_NAMED};
const PUBLIC_TOKEN_TYPE_ERROR = ${RUNTIME_PUBLIC_TOKEN_TYPE_ERROR};
const PUBLIC_TOKEN_TYPE_EOF = ${RUNTIME_PUBLIC_TOKEN_TYPE_EOF};
const PUBLIC_TOKEN_CHANNEL_UNKNOWN = ${RUNTIME_PUBLIC_TOKEN_CHANNEL_UNKNOWN};
const PUBLIC_TOKEN_CHANNEL_MAIN = ${RUNTIME_PUBLIC_TOKEN_CHANNEL_MAIN};
const PUBLIC_TOKEN_CHANNEL_TRIVIA = ${RUNTIME_PUBLIC_TOKEN_CHANNEL_TRIVIA};
const PUBLIC_TOKEN_CHANNEL_ERROR = ${RUNTIME_PUBLIC_TOKEN_CHANNEL_ERROR};
const PUBLIC_TOKEN_SHAPE_OK = ${RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_OK};
const PUBLIC_TOKEN_SHAPE_INVALID_LITERAL = ${RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_INVALID_LITERAL};
const PUBLIC_TOKEN_SHAPE_INVALID_NAMED = ${RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_INVALID_NAMED};
const PUBLIC_TOKEN_SHAPE_INVALID_ERROR = ${RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_INVALID_ERROR};
const PUBLIC_TOKEN_SHAPE_UNKNOWN_TYPE = ${RUNTIME_PUBLIC_TOKEN_SHAPE_STATUS_UNKNOWN_TYPE};
const SPEC_STATUS_OK = ${RUNTIME_LEXER_SPEC_STATUS_OK};
const SPEC_STATUS_NOT_LITERAL = ${RUNTIME_LEXER_SPEC_STATUS_NOT_LITERAL};
const SPEC_STATUS_NOT_MAIN = ${RUNTIME_LEXER_SPEC_STATUS_NOT_MAIN};
const SPEC_STATUS_NOT_TRIVIA = ${RUNTIME_LEXER_SPEC_STATUS_NOT_TRIVIA};
const LEXICAL_TOKEN_OK = ${RUNTIME_LEXICAL_TOKEN_STATUS_OK};
const TOKEN_STREAM_INVALID_SPAN = ${RUNTIME_TOKEN_STREAM_STATUS_INVALID_SPAN};
const TOKEN_STREAM_OK = ${RUNTIME_TOKEN_STREAM_STATUS_OK};
const TOKEN_STREAM_GAP = ${RUNTIME_TOKEN_STREAM_STATUS_GAP};
const TOKEN_STREAM_OVERLAP = ${RUNTIME_TOKEN_STREAM_STATUS_OVERLAP};
const TOKEN_STREAM_ZERO_WIDTH = ${RUNTIME_TOKEN_STREAM_STATUS_ZERO_WIDTH};
const TOKEN_STREAM_INVALID_EOF = ${RUNTIME_TOKEN_STREAM_STATUS_INVALID_EOF};
const TOKEN_STREAM_NONTRIVIA_GAP = ${RUNTIME_TOKEN_STREAM_STATUS_NONTRIVIA_GAP};
const TOKEN_STREAM_TOKEN_MISMATCH = ${RUNTIME_TOKEN_STREAM_STATUS_TOKEN_MISMATCH};
const TOKEN_STREAM_CANONICAL_MATCH = ${RUNTIME_TOKEN_STREAM_CANONICAL_MATCH};
const TOKEN_STREAM_CANONICAL_SKIP = ${RUNTIME_TOKEN_STREAM_CANONICAL_SKIP};
const TOKEN_STREAM_CANONICAL_MISMATCH = ${RUNTIME_TOKEN_STREAM_CANONICAL_MISMATCH};
const TRACE_TOKEN_STREAM_EMIT = ${RUNTIME_TRACE_TOKEN_STREAM_EMIT};
const TRACE_TOKEN_STREAM_SKIP = ${RUNTIME_TRACE_TOKEN_STREAM_SKIP};
const TRACE_TOKEN_STREAM_STOP = ${RUNTIME_TRACE_TOKEN_STREAM_STOP};
const DIAGNOSTIC_PARSE_LEXICAL_ERROR = ${PARSER_DIAGNOSTIC_CODE_PARSE_LEXICAL_ERROR};
const DIAGNOSTIC_PARSER_AMBIGUOUS_PARSE = ${PARSER_DIAGNOSTIC_CODE_AMBIGUOUS_PARSE};
const DIAGNOSTIC_PARSE_UNEXPECTED_TOKEN = ${PARSER_DIAGNOSTIC_CODE_PARSE_UNEXPECTED_TOKEN};
const DIAGNOSTIC_PARSE_TRAILING_INPUT = ${PARSER_DIAGNOSTIC_CODE_PARSE_TRAILING_INPUT};
const DIAGNOSTIC_PARSE_INVALID_TOKEN_STREAM = ${PARSER_DIAGNOSTIC_CODE_PARSE_INVALID_TOKEN_STREAM};
const DIAGNOSTIC_PARSER_INTERNAL_ERROR = ${PARSER_DIAGNOSTIC_CODE_INTERNAL_ERROR};
const DIAGNOSTIC_PARSER_BRANCH_LIMIT = ${PARSER_DIAGNOSTIC_CODE_BRANCH_LIMIT};
const DIAGNOSTIC_PARSER_TRACE_LIMIT = ${PARSER_DIAGNOSTIC_CODE_TRACE_LIMIT};
const DIAGNOSTIC_DETAIL_NONE = ${PARSER_DIAGNOSTIC_DETAIL_NONE};
const DIAGNOSTIC_DETAIL_PARSER_STATE = ${PARSER_DIAGNOSTIC_DETAIL_PARSER_STATE};
export const parserDiagnosticCodeParseLexicalError = DIAGNOSTIC_PARSE_LEXICAL_ERROR;
export const parserDiagnosticCodeAmbiguousParse = DIAGNOSTIC_PARSER_AMBIGUOUS_PARSE;
export const parserDiagnosticCodeParseUnexpectedToken = DIAGNOSTIC_PARSE_UNEXPECTED_TOKEN;
export const parserDiagnosticCodeParseTrailingInput = DIAGNOSTIC_PARSE_TRAILING_INPUT;
export const parserDiagnosticCodeParseInvalidTokenStream = DIAGNOSTIC_PARSE_INVALID_TOKEN_STREAM;
export const parserDiagnosticCodeInternalError = DIAGNOSTIC_PARSER_INTERNAL_ERROR;
export const parserDiagnosticCodeBranchLimit = DIAGNOSTIC_PARSER_BRANCH_LIMIT;
export const parserDiagnosticCodeTraceLimit = DIAGNOSTIC_PARSER_TRACE_LIMIT;
export const parserDiagnosticDetailKindNone = DIAGNOSTIC_DETAIL_NONE;
export const parserDiagnosticDetailKindParserState = DIAGNOSTIC_DETAIL_PARSER_STATE;

${emitRuntimeLanguageTypeScriptFunction(program).trimEnd()}`;
}

function mergeRuntimePrograms(
  base: RuntimeLanguageProgram,
  extension: RuntimeLanguageProgram,
): RuntimeLanguageProgram {
  return {
    name: `${base.name}_with_${extension.name}`,
    entry: base.entry,
    scratchMemoryWords: base.scratchMemoryWords ?? extension.scratchMemoryWords,
    tables: [
      ...(base.tables ?? []),
      ...(extension.tables ?? []),
    ],
    functions: [
      ...base.functions,
      ...extension.functions,
    ],
  };
}

function parseEntryPoints(mode: ParserEmitMode): string {
  const parseBody = mode === "wasm"
    ? `  const runtimeLimits = normalizeParserRuntimeLimits(options);
  const lexed = lexForParse(source, options);
  return parseCandidateTokenLists(
    sourceText,
    lexicalDiagnostics(lexed.diagnostics),
    lexed.parseStream,
    options.contextualLexingStats,
    runtimeLimits,
  );`
    : `  const runtimeLimits = normalizeParserRuntimeLimits(options);
  const lexed = lexForParse(source, options);
  return parseCandidateTokenLists(
    sourceText,
    lexicalDiagnostics(lexed.diagnostics),
    lexed.parseStream,
    options.contextualLexingStats,
    runtimeLimits,
  );`;
  return `export function parse(
  source: string,
  options: ParseOptions = {},
): ParseResult<RootNode> {
  runtimeArenaReset();
  const sourceText = createSourceTextBoundary(source);
${parseBody}
}

export function parseTokens(
  source: string,
  tokens: readonly Token[],
): ParseResult<RootNode> {
  runtimeArenaReset();
  const sourceText = createSourceTextBoundary(source);
  const streamDiagnostics = validateTokenStream(sourceText, tokens);
  const tokenDiagnostics = lexicalTokenDiagnostics(tokens);
  return parseTokenList(
    sourceText,
    tokens,
    combineDiagnostics(streamDiagnostics, tokenDiagnostics),
    undefined,
    false,
  );
}

export function parseTokensUnchecked(
  source: string,
  tokens: readonly Token[],
): ParseResult<RootNode> {
  runtimeArenaReset();
  const sourceText = createSourceTextBoundary(source);
  return parseTokenList(
    sourceText,
    tokens,
    lexicalTokenDiagnostics(tokens),
    undefined,
    false,
  );
}`;
}

function deterministicParseRuntime(): string {
  return `const MAX_CONTEXTUAL_LEXICAL_ALTERNATIVES = 1024;

function parseCandidateTokenLists(
  sourceText: SourceTextBoundary,
  lexicalDiagnostics: readonly ParseDiagnostic[],
  parseStream: ParseLexCandidateStream,
  reportStats?: ParseOptions["contextualLexingStats"],
  runtimeLimits: ParserRuntimeLimits = DEFAULT_PARSER_RUNTIME_LIMITS,
): ParseResult<RootNode> {
  if (lexicalDiagnostics.length > 0) {
    return failedParseResult(sourceText.source, parseStream.tokens, lexicalDiagnostics);
  }

  const sites = parseStream.sites;
  if (sites.every((site) => site.candidates.length === 1)) {
    reportContextualLexingStats(reportStats, {
      ambiguousLexicalSites: 0,
      contextualCandidateChecks: 0,
      attemptedTokenSelections: 0,
      reductionsBeforeTokenSelection: 0,
    });
    return parseTokenList(
      sourceText,
      parseStream.tokens,
      lexicalDiagnostics,
      undefined,
      true,
      runtimeLimits,
    );
  }
  const selectedTokens = new Array<Token>(sites.length);
  const terminals = new Int32Array(sites.length);
  const publicTokens = [...parseStream.tokens];
  let attempts = 0;
  let contextualCandidateChecks = 0;
  let reductionsBeforeTokenSelection = 0;
  const ambiguousLexicalSites = sites.filter((site) => site.candidates.length > 1).length;

  function attempt(siteIndex: number): ParseResult<RootNode> | null {
    if (attempts >= MAX_CONTEXTUAL_LEXICAL_ALTERNATIVES) {
      return failedParseResult(
        sourceText.source,
        selectedTokens.filter((token): token is Token => Boolean(token)),
        [branchLimitDiagnostic(sourceText.length)],
      );
    }
    if (siteIndex === sites.length) {
      attempts++;
      let status = 0;
      try {
        for (let index = 0; index < terminals.length; index++) {
          parserTraceSetTerminal(index, terminals[index]);
        }
        status = parserTrace(
          terminals.length,
          runtimeLimits.maxExploredBranches,
          runtimeLimits.maxTraceActions,
          runtimeLimits.maxQueuedBranches,
          runtimeLimits.ambiguityMode,
        );
      } catch (error) {
        return failedParseResult(
          sourceText.source,
          selectedTokens,
          [internalParserDiagnostic(error, {
            start: sourceText.length,
            end: sourceText.length,
          })],
        );
      }
      if (parserTraceStatusKind(status) !== TRACE_STATUS_OK) return null;
      const traceCount = parserTraceCount();
      const trace = new Int32Array(traceCount);
      for (let index = 0; index < traceCount; index++) {
        trace[index] = parserTraceAction(index) | 0;
      }
      reductionsBeforeTokenSelection = countTraceReductions(trace);
      const tokenIndices = sites.map((site) => site.tokenIndex);
      return replayTrace(
        sourceText,
        publicTokens,
        { tokens: selectedTokens, tokenIndices },
        trace,
      );
    }

    for (const candidate of sites[siteIndex].candidates) {
      contextualCandidateChecks++;
      selectedTokens[siteIndex] = candidate.token;
      publicTokens[sites[siteIndex].tokenIndex] = candidate.token;
      terminals[siteIndex] = candidate.terminal;
      const result = attempt(siteIndex + 1);
      if (result) return result;
    }
    return null;
  }

  const result = attempt(0);
  reportContextualLexingStats(reportStats, {
    ambiguousLexicalSites,
    contextualCandidateChecks,
    attemptedTokenSelections: attempts,
    reductionsBeforeTokenSelection,
  });
  if (result) return result;
  return parseTokenList(
    sourceText,
    parseStream.tokens,
    lexicalDiagnostics,
    undefined,
    true,
    runtimeLimits,
  );
}

function parseTokenList(
  sourceText: SourceTextBoundary,
  tokens: readonly Token[],
  lexicalDiagnostics: readonly ParseDiagnostic[],
  _parseStream: undefined = undefined,
  trustRuntimeTerminals = false,
  runtimeLimits: ParserRuntimeLimits = DEFAULT_PARSER_RUNTIME_LIMITS,
): ParseResult<RootNode> {
  if (lexicalDiagnostics.length > 0) {
    return failedParseResult(sourceText.source, tokens, lexicalDiagnostics);
  }

  const stream = compactTraceTokenStream(sourceText, tokens, trustRuntimeTerminals);
  let status = 0;
  try {
    for (let index = 0; index < stream.terminalCount; index++) {
      parserTraceSetTerminal(index, stream.terminals[index]);
    }
    status = parserTrace(
      stream.terminalCount,
      runtimeLimits.maxExploredBranches,
      runtimeLimits.maxTraceActions,
      runtimeLimits.maxQueuedBranches,
      runtimeLimits.ambiguityMode,
    );
  } catch (error) {
    return failedParseResult(
      sourceText.source,
      tokens,
      [internalParserDiagnostic(error, {
        start: sourceText.length,
        end: sourceText.length,
      })],
    );
  }

  const traceStatus = parserTraceStatusKind(status);
  if (traceStatus !== TRACE_STATUS_OK) {
    const errorIndex = parserTraceErrorIndex();
    const token = stream.tokens[errorIndex] ?? materializeSourceEofToken(sourceText);
    if (traceStatus === TRACE_STATUS_UNEXPECTED) {
      return failedParseResult(
        sourceText.source,
        tokens,
        [unexpectedTokenDiagnostic(
          token,
          parserTraceErrorState(),
        )],
      );
    }
    if (traceStatus === TRACE_STATUS_BRANCH_LIMIT) {
      return failedParseResult(
        sourceText.source,
        tokens,
        [branchLimitDiagnostic(sourceText.length)],
      );
    }
    if (traceStatus === TRACE_STATUS_TRACE_LIMIT) {
      return failedParseResult(
        sourceText.source,
        tokens,
        [traceLimitDiagnostic(sourceText.length)],
      );
    }
    if (traceStatus === TRACE_STATUS_AMBIGUOUS) {
      return failedParseResult(
        sourceText.source,
        tokens,
        [ambiguousParseDiagnostic(sourceText.length)],
      );
    }
    return failedParseResult(
      sourceText.source,
      tokens,
      [parserInternalMessageDiagnostic(
        "Runtime-language parser trace failed.",
        currentSpan(token),
      )],
    );
  }

  const traceCount = parserTraceCount();
  const trace = new Int32Array(traceCount);
  for (let index = 0; index < traceCount; index++) {
    trace[index] = parserTraceAction(index) | 0;
  }

  return replayTrace(
    sourceText,
    tokens,
    stream,
    trace,
  );
}

interface CompactTraceTokenStream {
  tokens: readonly Token[];
  tokenIndices: readonly number[];
  terminals: Int32Array;
  terminalCount: number;
}

function compactTraceTokenStream(
  sourceText: SourceTextBoundary,
  tokens: readonly Token[],
  trustRuntimeTerminals: boolean,
): CompactTraceTokenStream {
  const streamTokens: Token[] = new Array(tokens.length + 1);
  const streamTokenIndices: number[] = new Array(tokens.length + 1);
  const terminals = new Int32Array(tokens.length + 1);
  let streamTokenCount = 0;
  let terminalCount = 0;
  let index = 0;
  while (true) {
    const token = tokens[index] ?? materializeSourceEofToken(sourceText);
    const traceStep = traceTokenStreamStep(token, trustRuntimeTerminals);
    const traceTokenStatus = parserTraceTokenStreamStepStatus(traceStep);
    if (traceTokenStatus === TRACE_TOKEN_STREAM_SKIP) {
      index++;
      continue;
    }
    const publicIndex = parserTraceTokenStreamPublicIndex(
      index,
      tokens.length,
    );
    streamTokens[streamTokenCount] = token;
    streamTokenIndices[streamTokenCount] = publicIndex;
    streamTokenCount++;
    terminals[terminalCount] = traceTokenStreamTerminal(traceStep);
    terminalCount++;
    if (traceTokenStatus === TRACE_TOKEN_STREAM_STOP || index >= tokens.length) break;
    index++;
  }
  streamTokens.length = streamTokenCount;
  streamTokenIndices.length = streamTokenCount;
  return {
    tokens: streamTokens,
    tokenIndices: streamTokenIndices,
    terminals,
    terminalCount,
  };
}

${replayTraceRuntime("Runtime-language")}`;
}

function wasmParseRuntime(): string {
  return `const MAX_CONTEXTUAL_LEXICAL_ALTERNATIVES = 1024;

function parseCandidateTokenLists(
  sourceText: SourceTextBoundary,
  lexicalDiagnostics: readonly ParseDiagnostic[],
  parseStream: WasmParseStream,
  reportStats?: ParseOptions["contextualLexingStats"],
  runtimeLimits: ParserRuntimeLimits = DEFAULT_PARSER_RUNTIME_LIMITS,
): ParseResult<RootNode> {
  if (lexicalDiagnostics.length > 0) {
    return failedParseResult(sourceText.source, parseStream.publicTokens, lexicalDiagnostics);
  }

  const sites = parseStream.sites;
  if (sites.every((site) => site.candidates.length === 1)) {
    reportContextualLexingStats(reportStats, {
      ambiguousLexicalSites: 0,
      contextualCandidateChecks: 0,
      attemptedTokenSelections: 0,
      reductionsBeforeTokenSelection: 0,
    });
    return parseTokenList(
      sourceText,
      parseStream.publicTokens,
      lexicalDiagnostics,
      parseStream,
      true,
      runtimeLimits,
    );
  }
  const selectedTokens = new Array<Token>(sites.length);
  const terminals = new Int32Array(sites.length);
  const publicTokens = [...parseStream.publicTokens];
  let attempts = 0;
  let contextualCandidateChecks = 0;
  let reductionsBeforeTokenSelection = 0;
  const ambiguousLexicalSites = sites.filter((site) => site.candidates.length > 1).length;

  function attempt(siteIndex: number): ParseResult<RootNode> | null {
    if (attempts >= MAX_CONTEXTUAL_LEXICAL_ALTERNATIVES) {
      return failedParseResult(
        sourceText.source,
        publicTokens,
        [branchLimitDiagnostic(sourceText.length)],
      );
    }
    if (siteIndex === sites.length) {
      attempts++;
      const input = createParseTraceInput(terminals.length);
      input.terminals.set(terminals);
      const traced = parseTrace(input, terminals.length, {
        maxBranches: runtimeLimits.maxExploredBranches,
        maxTraceActions: runtimeLimits.maxTraceActions,
        maxQueuedBranches: runtimeLimits.maxQueuedBranches,
        ambiguityMode: runtimeLimits.ambiguityMode,
      });
      if (!traced.ok) return null;
      reductionsBeforeTokenSelection = countTraceReductions(traced.trace);
      return replayTrace(
        sourceText,
        publicTokens,
        {
          tokens: selectedTokens,
          tokenIndices: sites.map((site) => site.tokenIndex),
        },
        traced.trace,
      );
    }

    for (const candidate of sites[siteIndex].candidates) {
      contextualCandidateChecks++;
      selectedTokens[siteIndex] = candidate.token;
      publicTokens[sites[siteIndex].tokenIndex] = candidate.token;
      terminals[siteIndex] = candidate.terminal;
      const result = attempt(siteIndex + 1);
      if (result) return result;
    }
    return null;
  }

  const result = attempt(0);
  reportContextualLexingStats(reportStats, {
    ambiguousLexicalSites,
    contextualCandidateChecks,
    attemptedTokenSelections: attempts,
    reductionsBeforeTokenSelection,
  });
  if (result) return result;
  return parseTokenList(
    sourceText,
    parseStream.publicTokens,
    lexicalDiagnostics,
    parseStream,
    true,
    runtimeLimits,
  );
}

function parseTokenList(
  sourceText: SourceTextBoundary,
  tokens: readonly Token[],
  lexicalDiagnostics: readonly ParseDiagnostic[],
  parseStream?: WasmParseStream,
  trustRuntimeTerminals = false,
  runtimeLimits: ParserRuntimeLimits = DEFAULT_PARSER_RUNTIME_LIMITS,
): ParseResult<RootNode> {
  if (lexicalDiagnostics.length > 0) {
    return failedParseResult(sourceText.source, tokens, lexicalDiagnostics);
  }

  const stream = parseStream ??
    compactTokenStream(sourceText, tokens, trustRuntimeTerminals);
  const traced = parseTrace(stream.input, stream.terminalCount, {
    maxBranches: runtimeLimits.maxExploredBranches,
    maxTraceActions: runtimeLimits.maxTraceActions,
    maxQueuedBranches: runtimeLimits.maxQueuedBranches,
    ambiguityMode: runtimeLimits.ambiguityMode,
  });
  if (!traced.ok) {
    const token = stream.tokens[traced.index] ?? materializeSourceEofToken(sourceText);
    if (traced.failureKind === "ambiguous") {
      return failedParseResult(
        sourceText.source,
        tokens,
        [ambiguousParseDiagnostic(sourceText.length)],
      );
    }
    if (traced.limit) {
      if (traced.failureKind === "trace-limit") {
        return failedParseResult(
          sourceText.source,
          tokens,
          [traceLimitDiagnostic(sourceText.length)],
        );
      }
      return failedParseResult(
        sourceText.source,
        tokens,
        [branchLimitDiagnostic(sourceText.length)],
      );
    }
    if (traced.internal) {
      return failedParseResult(
        sourceText.source,
        tokens,
        [parserInternalMessageDiagnostic(
          "Wasm parser trace failed.",
          currentSpan(token),
        )],
      );
    }
    return failedParseResult(
      sourceText.source,
      tokens,
      [unexpectedTokenDiagnostic(token, traced.state)],
    );
  }

  return replayTrace(
    sourceText,
    tokens,
    stream,
    traced.trace,
  );
}

interface CompactTokenStream {
  tokens: readonly Token[];
  tokenIndices: readonly number[];
  input: ParseTraceInput;
  terminalCount: number;
}

function compactTokenStream(
  sourceText: SourceTextBoundary,
  tokens: readonly Token[],
  trustRuntimeTerminals: boolean,
): CompactTokenStream {
  const streamTokens: Token[] = new Array(tokens.length + 1);
  const streamTokenIndices: number[] = new Array(tokens.length + 1);
  const terminalIds = new Int32Array(tokens.length + 1);
  let streamTokenCount = 0;
  let terminalCount = 0;
  let index = 0;
  while (true) {
    const token = tokens[index] ?? materializeSourceEofToken(sourceText);
    const traceStep = traceTokenStreamStep(token, trustRuntimeTerminals);
    const traceTokenStatus = parserTraceTokenStreamStepStatus(traceStep);
    if (traceTokenStatus === TRACE_TOKEN_STREAM_SKIP) {
      index++;
      continue;
    }
    const publicIndex = parserTraceTokenStreamPublicIndex(
      index,
      tokens.length,
    );
    streamTokens[streamTokenCount] = token;
    streamTokenIndices[streamTokenCount] = publicIndex;
    streamTokenCount++;
    terminalIds[terminalCount] = traceTokenStreamTerminal(traceStep);
    terminalCount++;
    if (traceTokenStatus === TRACE_TOKEN_STREAM_STOP || index >= tokens.length) break;
    index++;
  }
  streamTokens.length = streamTokenCount;
  streamTokenIndices.length = streamTokenCount;
  const input = createParseTraceInput(terminalCount);
  input.terminals.set(terminalIds.subarray(0, terminalCount));
  return {
    tokens: streamTokens,
    tokenIndices: streamTokenIndices,
    input,
    terminalCount,
  };
}

${replayTraceRuntime("Wasm")}`;
}

function replayTraceRuntime(label: string): string {
  return `interface RuntimeReplayTokenStream {
  tokens: readonly Token[];
  tokenIndices: readonly number[];
}

function replayTrace(
  sourceText: SourceTextBoundary,
  tokens: readonly Token[],
  stream: RuntimeReplayTokenStream,
  trace: Int32Array,
): ParseResult<RootNode> {
  RUNTIME_FRAGMENT_VALUES.clear();
  resetPublicSyntaxMaterialization();
  const traceActions = runtimeVectorNew(trace.length);
  for (let traceIndex = 0; traceIndex < trace.length; traceIndex++) {
    runtimeVectorAppend(traceActions, trace[traceIndex]);
  }
  const runtimeTokens = runtimeVectorNew(stream.tokens.length);
  const runtimeTokenIndices = runtimeVectorNew(stream.tokenIndices.length);
  for (let index = 0; index < stream.tokens.length; index++) {
    const token = stream.tokens[index];
    runtimeVectorAppend(
      runtimeTokens,
      runtimeTokenHandle(token, traceTokenStreamStep(token)),
    );
    runtimeVectorAppend(runtimeTokenIndices, stream.tokenIndices[index]);
  }
  const result = parserReplayVm(
    traceActions,
    runtimeTokens,
    runtimeTokenIndices,
  );
  const status = parserReplayResultStatus(result);
  if (status === REPLAY_VM_OK) {
    enforceAcceptedCstResourceLimits(parserReplayResultRoot(result));
    return acceptedRuntimeParseResult(
      sourceText,
      tokens,
      parserReplayResultRoot(result),
    );
  }

  const streamIndex = parserReplayResultStreamIndex(result);
  const token = stream.tokens[streamIndex] ?? materializeSourceEofToken(sourceText);
  return failedParseResult(
    sourceText.source,
    tokens,
    [parserInternalMessageDiagnostic(
      replayVmStatusMessage(status, "${label}"),
      currentSpan(token),
    )],
  );
}

function enforceAcceptedCstResourceLimits(rootHandle: number): void {
  const rootStatus = parserRuntimeValueStatus(rootHandle);
  if (rootStatus === RUNTIME_VALUE_RULE_NODE) {
    enforceCstResourceLimits(rootHandle);
    return;
  }
  if (rootStatus !== RUNTIME_VALUE_FRAGMENT) return;
  const fragmentValue = parserFragmentValue(rootHandle);
  if (parserRuntimeValueStatus(fragmentValue) === RUNTIME_VALUE_RULE_NODE) {
    enforceCstResourceLimits(fragmentValue);
  }
}

function enforceCstResourceLimits(rootHandle: number): void {
  const limits = currentParserCstResourceLimits();
  if (
    limits.maxCstNodes === undefined &&
    limits.maxCstChildren === undefined
  ) {
    return;
  }
  const stack = [rootHandle];
  let nodeCount = 0;
  let childCount = 0;
  while (stack.length > 0) {
    const nodeHandle = stack.pop()!;
    nodeCount++;
    if (
      limits.maxCstNodes !== undefined &&
      nodeCount > limits.maxCstNodes
    ) {
      throw cstResourceLimitError(limits.maxCstNodes, nodeCount);
    }
    const count = parserRuleNodeChildCount(nodeHandle);
    childCount += count;
    if (
      limits.maxCstChildren !== undefined &&
      childCount > limits.maxCstChildren
    ) {
      throw cstResourceLimitError(limits.maxCstChildren, childCount);
    }
    if (count === 0) continue;
    const children = parserRuleNodeChildren(nodeHandle);
    for (let index = count - 1; index >= 0; index--) {
      const child = runtimeVectorLoad(children, index);
      if (parserRuntimeValueStatus(child) === RUNTIME_VALUE_RULE_NODE) {
        stack.push(child);
      }
    }
  }
}

function replayVmStatusMessage(status: number, label: string): string {
  if (status === REPLAY_VM_UNKNOWN_ACTION) {
    return label + " parser trace contained an unknown action kind.";
  }
  if (status === REPLAY_VM_UNKNOWN_PRODUCTION) {
    return label + " parser trace referenced an unknown production.";
  }
  if (status === REPLAY_VM_RULE_PAYLOAD_MISSING) {
    return "Rule reducer is missing its rule id payload.";
  }
  if (status === REPLAY_VM_FIELD_PAYLOAD_MISSING) {
    return "Field reducer is missing its field id payload.";
  }
  if (status === REPLAY_VM_STACK_UNDERFLOW) {
    return label + " parser trace underflowed the replay stack.";
  }
  if (status === REPLAY_VM_STREAM_UNDERFLOW) {
    return label + " parser trace advanced past the compact token stream.";
  }
  if (status === REPLAY_VM_ENDED_WITHOUT_ACCEPT) {
    return label + " parser trace ended without accepting.";
  }
  if (status === REPLAY_VM_REDUCTION_FAILED) {
    return label + " parser trace reduction validation failed.";
  }
  return label + " parser trace failed in the runtime replay VM.";
}`;
}

function reductionRuntime(): string {
  return `const RUNTIME_FRAGMENT_VALUES = new Map<number, unknown>();

function rememberFragmentValue(handle: number, value: unknown): void {
  RUNTIME_FRAGMENT_VALUES.set(handle, value);
}

function hostFragmentValue(
  sourceText: SourceTextBoundary,
  handle: number,
): unknown {
  if (RUNTIME_FRAGMENT_VALUES.has(handle)) {
    return RUNTIME_FRAGMENT_VALUES.get(handle);
  }
  const value = materializeRuntimeValue(
    sourceText,
    parserFragmentValue(handle),
  );
  rememberFragmentValue(handle, value);
  return value;
}

function acceptedRuntimeParseResult(
  sourceText: SourceTextBoundary,
  tokens: readonly Token[],
  rootHandle: number,
): ParseResult<RootNode> {
  const rootStatus = parserRuntimeValueStatus(rootHandle);
  const fragmentValueStatus = rootStatus === RUNTIME_VALUE_FRAGMENT
    ? parserRuntimeValueStatus(parserFragmentValue(rootHandle))
    : 0;
  const status = parserAcceptedRootStatus(
    rootStatus === RUNTIME_VALUE_RULE_NODE ? 1 : 0,
    rootStatus === RUNTIME_VALUE_FRAGMENT ? 1 : 0,
    fragmentValueStatus === RUNTIME_VALUE_RULE_NODE ? 1 : 0,
  );
  if (status === ACCEPTED_ROOT_DIRECT) {
    return successfulParseResult(
      sourceText.source,
      tokens,
      materializeRuleNode(sourceText, rootHandle) as RootNode,
    );
  }
  if (status === ACCEPTED_ROOT_FRAGMENT_VALUE) {
    return successfulParseResult(
      sourceText.source,
      tokens,
      materializeRuleNode(
        sourceText,
        parserFragmentValue(rootHandle),
      ) as RootNode,
    );
  }
  return failedParseResult(
    sourceText.source,
    tokens,
    [parserInternalMessageDiagnostic(
      "Parser accepted without producing a root node.",
      { start: sourceText.length, end: sourceText.length },
    )],
  );
}

function materializeRuntimeValue(
  sourceText: SourceTextBoundary,
  handle: number,
): unknown {
  const status = parserRuntimeValueStatus(handle);
  if (status === RUNTIME_VALUE_TOKEN) {
    return hostSyntaxValue(handle);
  }
  if (status === RUNTIME_VALUE_RULE_NODE) {
    return materializeRuleNode(sourceText, handle);
  }
  if (status === RUNTIME_VALUE_VECTOR) {
    return materializeRuntimeVectorValue(sourceText, handle);
  }
  if (status === RUNTIME_VALUE_FRAGMENT) {
    return hostFragmentValue(sourceText, handle);
  }
  if (handle === 0) return null;
  throw new Error("Runtime replay produced an unsupported value handle.");
}

function materializeRuntimeVectorValue(
  sourceText: SourceTextBoundary,
  vectorHandle: number,
): unknown[] {
  const length = runtimeVectorLength(vectorHandle);
  const values: unknown[] = [];
  for (let index = 0; index < length; index++) {
    values.push(materializeRuntimeValue(
      sourceText,
      runtimeVectorLoad(vectorHandle, index),
    ));
  }
  return values;
}

function tokenToTerminal(token: Token, trustRuntimeTerminal = false): number {
  return traceTokenStreamTerminal(traceTokenStreamStep(token, trustRuntimeTerminal));
}

function runtimeTokenHandle(token: Token, traceStep: number): number {
  const specIndex = tokenSpecIndex(token);
  const handle = parserTokenNew(
    publicTokenClass(token),
    specIndex < 0 ? 0 : specIndex,
    parserTraceTokenStreamStepTerminal(traceStep),
    token.span.start,
    token.span.end,
  );
  const status = parserShiftedTokenStatus(publicTokenClass(token));
  if (status === SHIFTED_TOKEN_OK) {
    rememberSyntaxValue(handle, token as SyntaxElement);
  }
  return handle;
}

function traceTokenStreamStep(
  token: Token,
  trustRuntimeTerminal = false,
): number {
  const trustedTerminal = trustRuntimeTerminal
    ? runtimeTokenTerminal(token)
    : NO_TERMINAL;
  const specIndex = tokenSpecIndex(token);
  const specTerminal = specIndex < 0 ? NO_TERMINAL : lexerSpecTerminal(specIndex);
  return parserTraceTokenStreamStep(
    publicTokenClass(token),
    trustedTerminal,
    specTerminal,
    EOF_TERMINAL,
  );
}

function traceTokenStreamTerminal(traceStep: number): number {
  const terminal = parserTraceTokenStreamStepTerminal(traceStep);
  return terminal === NO_TERMINAL ? -1 : terminal;
}

function tokenSpecIndex(token: Token): number {
  if (token.type === "named") {
    return NAMED_SPEC_INDICES.get(token.kind) ?? -1;
  }
  if (token.type === "literal") {
    return LITERAL_SPEC_INDICES.get(token.literal) ?? -1;
  }
  return -1;
}

function publicTokenClass(token: Token): number {
  if (token.type === "eof") return PUBLIC_TOKEN_EOF;
  if (token.type === "error") return PUBLIC_TOKEN_ERROR;
  if (token.type === "literal") return PUBLIC_TOKEN_LITERAL;
  if (token.type === "named" && token.channel === "trivia") {
    return PUBLIC_TOKEN_TRIVIA;
  }
  return PUBLIC_TOKEN_MAIN;
}

function publicTokenType(token: Token): number {
  if (token.type === "eof") return PUBLIC_TOKEN_TYPE_EOF;
  if (token.type === "error") return PUBLIC_TOKEN_TYPE_ERROR;
  if (token.type === "literal") return PUBLIC_TOKEN_TYPE_LITERAL;
  if (token.type === "named") return PUBLIC_TOKEN_TYPE_NAMED;
  return PUBLIC_TOKEN_TYPE_UNKNOWN;
}

function publicTokenChannel(token: Token): number {
  if (token.channel === "main") return PUBLIC_TOKEN_CHANNEL_MAIN;
  if (token.channel === "trivia") return PUBLIC_TOKEN_CHANNEL_TRIVIA;
  if (token.channel === "error") return PUBLIC_TOKEN_CHANNEL_ERROR;
  return PUBLIC_TOKEN_CHANNEL_UNKNOWN;
}

function runtimeTokenTerminal(token: Token): number {
  const terminal = (token as { __babaTerminal?: unknown }).__babaTerminal;
  return typeof terminal === "number" && Number.isInteger(terminal) &&
      terminal >= 0
    ? terminal
    : -1;
}

function validateTokenStream(
  sourceText: SourceTextBoundary,
  tokens: readonly Token[],
): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  const canonical = lex(sourceText.source, { preserveTrivia: true });
  const canonicalTokens = canonical.tokens;
  let canonicalIndex = 0;
  let previousEnd = 0;
  let eofIndex = -1;

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const span = token.span;
    if (
      !Number.isInteger(span.start) ||
      !Number.isInteger(span.end) ||
      span.start < 0 ||
      span.end < 0
    ) {
      diagnostics.push(invalidTokenStream(
        \`Token at index \${index} has an invalid span.\`,
        clampSpan(span, sourceText.length),
      ));
      continue;
    }

    const boundsStatus = parserTokenStreamSpanBoundsStatus(
      span.start,
      span.end,
      sourceText.length,
    );
    if (boundsStatus === TOKEN_STREAM_INVALID_SPAN) {
      diagnostics.push(invalidTokenStream(
        \`Token at index \${index} has an invalid span.\`,
        clampSpan(span, sourceText.length),
      ));
      continue;
    }

    const positionStatus = parserTokenStreamSpanPositionStatus(
      span.start,
      previousEnd,
    );
    if (positionStatus === TOKEN_STREAM_GAP) {
      const gapDiagnostic = validateSourceGap(
        canonicalTokens,
        previousEnd,
        span.start,
      );
      if (gapDiagnostic) diagnostics.push(gapDiagnostic);
    }

    if (positionStatus === TOKEN_STREAM_OVERLAP) {
      diagnostics.push(invalidTokenStream(
        \`Token at index \${index} overlaps a previous token.\`,
        span,
      ));
    }
    previousEnd = Math.max(previousEnd, span.end);

    if (token.type === "eof") {
      const matched = matchCanonicalToken(
        canonicalTokens,
        canonicalIndex,
        token,
      );
      if (matched < 0) {
        diagnostics.push(invalidTokenStream(
          \`Token at index \${index} does not match canonical lexer output.\`,
          span,
        ));
      } else {
        canonicalIndex = matched + 1;
      }
      const eofSequenceStatus = parserTokenStreamEofSequenceStatus(
        eofIndex === -1 ? 0 : 1,
      );
      if (eofSequenceStatus === TOKEN_STREAM_INVALID_EOF) {
        diagnostics.push(invalidTokenStream(
          "Token stream contains more than one EOF token.",
          span,
        ));
      }
      eofIndex = index;
      const eofStatus = parserTokenStreamEofStatus(
        typeof token.text === "string" ? token.text.length : 0xffffffff,
        token.channel === "main" ? 1 : 0,
        span.start,
        span.end,
        sourceText.length,
      );
      if (eofStatus === TOKEN_STREAM_INVALID_EOF) {
        diagnostics.push(invalidTokenStream(
          "EOF token must have empty text, main channel, and an empty span at the end of the source.",
          span,
        ));
      }
      continue;
    }

    const eofSequenceStatus = parserTokenStreamEofSequenceStatus(
      eofIndex === -1 ? 0 : 1,
    );
    if (eofSequenceStatus === TOKEN_STREAM_INVALID_EOF) {
      diagnostics.push(invalidTokenStream(
        "Token stream contains tokens after EOF.",
        span,
      ));
    }

    if (
      parserTokenStreamWidthStatus(span.start, span.end) ===
        TOKEN_STREAM_ZERO_WIDTH
    ) {
      diagnostics.push(invalidTokenStream(
        \`Token at index \${index} has zero width.\`,
        span,
      ));
    }

    if (!sourceTextMatches(sourceText, span, token.text)) {
      diagnostics.push(invalidTokenStream(
        \`Token at index \${index} text does not match the source slice.\`,
        span,
      ));
    }
    const publicStatus = parserTokenStreamPublicTokenStatus(
      publicTokenType(token),
      publicTokenChannel(token),
      token.type === "literal" && token.text === token.literal ? 1 : 0,
    );
    if (publicStatus === PUBLIC_TOKEN_SHAPE_INVALID_LITERAL) {
      diagnostics.push(invalidTokenStream(
        "Literal tokens must use the main channel and text equal to the literal.",
        span,
      ));
    } else if (publicStatus === PUBLIC_TOKEN_SHAPE_INVALID_NAMED) {
      diagnostics.push(invalidTokenStream(
        "Named tokens must use the main or trivia channel.",
        span,
      ));
    } else if (publicStatus === PUBLIC_TOKEN_SHAPE_INVALID_ERROR) {
      diagnostics.push(invalidTokenStream(
        "Error tokens must use the error channel.",
        span,
      ));
    } else if (publicStatus === PUBLIC_TOKEN_SHAPE_UNKNOWN_TYPE) {
      diagnostics.push(invalidTokenStream("Token has an unknown type.", span));
    }
    if (token.type === "literal") {
      const specIndex = tokenSpecIndex(token);
      if (specIndex < 0) {
        diagnostics.push(invalidTokenStream(
          \`Literal token \${JSON.stringify(token.literal)} is not part of this parser's terminal set.\`,
          span,
        ));
      } else {
        const status = lexerSpecPublicTokenStatus(
          specIndex,
          PUBLIC_TOKEN_LITERAL,
        );
        if (status === SPEC_STATUS_NOT_LITERAL) {
          diagnostics.push(invalidTokenStream(
            \`Literal token \${JSON.stringify(token.literal)} is not a literal token kind.\`,
            span,
          ));
        } else if (status !== SPEC_STATUS_OK) {
          diagnostics.push(invalidTokenStream(
            \`Literal token \${JSON.stringify(token.literal)} is not part of this parser's terminal set.\`,
            span,
          ));
        }
      }
    } else if (token.type === "named") {
      if (publicStatus === PUBLIC_TOKEN_SHAPE_OK) {
        const specIndex = tokenSpecIndex(token);
        if (specIndex < 0) {
          diagnostics.push(invalidTokenStream(
            \`Named token kind '\${token.kind}' is not part of this parser's lexer spec set.\`,
            span,
          ));
        } else {
          const status = lexerSpecPublicTokenStatus(
            specIndex,
            token.channel === "trivia"
              ? PUBLIC_TOKEN_TRIVIA
              : PUBLIC_TOKEN_MAIN,
          );
          if (status === SPEC_STATUS_NOT_MAIN) {
            diagnostics.push(invalidTokenStream(
              \`Named token kind '\${token.kind}' is not a main token kind.\`,
              span,
            ));
          } else if (status === SPEC_STATUS_NOT_TRIVIA) {
            diagnostics.push(invalidTokenStream(
              \`Named token kind '\${token.kind}' is not a trivia token kind.\`,
              span,
            ));
          } else if (status !== SPEC_STATUS_OK) {
            diagnostics.push(invalidTokenStream(
              \`Named token kind '\${token.kind}' is not part of this parser's lexer spec set.\`,
              span,
            ));
          }
        }
      }
    }
    const matched = matchCanonicalToken(
      canonicalTokens,
      canonicalIndex,
      token,
    );
    if (matched < 0) {
      diagnostics.push(invalidTokenStream(
        \`Token at index \${index} does not match canonical lexer output.\`,
        span,
      ));
    } else {
      canonicalIndex = matched + 1;
    }
  }

  const finalStatus = parserTokenStreamFinalStatus(
    eofIndex === -1 ? 0 : 1,
    eofIndex === -1 ? 0 : eofIndex,
    tokens.length,
    previousEnd,
    sourceText.length,
  );
  if (finalStatus === TOKEN_STREAM_INVALID_EOF) {
    diagnostics.push(invalidTokenStream(
      "EOF must be the final token in the stream.",
      tokens[eofIndex]?.span ?? {
        start: sourceText.length,
        end: sourceText.length,
      },
    ));
  }
  if (finalStatus === TOKEN_STREAM_GAP) {
    const gapDiagnostic = validateSourceGap(
      canonicalTokens,
      previousEnd,
      sourceText.length,
    );
    if (gapDiagnostic) diagnostics.push(gapDiagnostic);
  }
  return diagnostics;
}

function validateSourceGap(
  canonicalTokens: readonly Token[],
  start: number,
  end: number,
): ParseDiagnostic | null {
  if (parserTokenStreamGapIsEmpty(start, end) === 1) return null;
  for (const token of canonicalTokens) {
    if (token.type === "eof") continue;
    if (parserTokenStreamCanAdvance(token.span.end, start) === 1) continue;
    if (parserTokenStreamCanAdvance(end, token.span.start) === 1) break;
    const status = parserTokenStreamGapTokenStatus(
      publicTokenClass(token),
      token.span.start,
      token.span.end,
      start,
      end,
    );
    if (status !== TOKEN_STREAM_OK) {
      return invalidTokenStream(
        "Token stream omits nontrivia source text.",
        { start, end },
      );
    }
  }
  return null;
}

function matchCanonicalToken(
  canonicalTokens: readonly Token[],
  startIndex: number,
  token: Token,
): number {
  for (let index = startIndex; index < canonicalTokens.length; index++) {
    const canonical = canonicalTokens[index];
    const status = parserTokenStreamCanonicalMatchStatus(
      publicTokenClass(canonical),
      sameTokenStatus(canonical, token),
      canonical.span.end,
      token.span.start,
    );
    if (status === TOKEN_STREAM_CANONICAL_MATCH) return index;
    if (status === TOKEN_STREAM_CANONICAL_SKIP) {
      continue;
    }
    return -1;
  }
  return -1;
}

function sameToken(left: Token, right: Token): boolean {
  return sameTokenStatus(left, right) === TOKEN_STREAM_OK;
}

function sameTokenStatus(left: Token, right: Token): number {
  if (
    left.text !== right.text ||
    left.channel !== right.channel
  ) {
    return TOKEN_STREAM_TOKEN_MISMATCH;
  }
  return parserTokenStreamTokenMatchStatus(
    publicTokenClass(left),
    publicTokenClass(right),
    tokenSpecIndex(left),
    tokenSpecIndex(right),
    tokenToTerminal(left),
    tokenToTerminal(right),
    left.span.start,
    left.span.end,
    right.span.start,
    right.span.end,
  );
}

function clampSpan(span: Span, sourceLength: number): Span {
  const start = Math.min(Math.max(0, span.start), sourceLength);
  const end = Math.min(Math.max(start, span.end), sourceLength);
  return { start, end };
}

`;
}

function bnfTableRows<T>(
  table: ReadonlyMap<number, ReadonlyMap<number, T>>,
  encode: (key: number, value: T) => GotoEntry,
): GotoEntry[][] {
  const maxState = Math.max(-1, ...table.keys());
  const rows: GotoEntry[][] = [];
  for (let state = 0; state <= maxState; state++) {
    const entries = [...(table.get(state)?.entries() ?? [])]
      .sort(([left], [right]) => left - right)
      .map(([key, value]) => encode(key, value));
    rows.push(entries);
  }
  return rows;
}

function bnfActionTableRows(
  table: ReadonlyMap<number, ReadonlyMap<number, LrActionSet>>,
): EncodedAction[][] {
  const maxState = Math.max(-1, ...table.keys());
  const rows: EncodedAction[][] = [];
  for (let state = 0; state <= maxState; state++) {
    const entries = [...(table.get(state)?.entries() ?? [])]
      .sort(([left], [right]) => left - right)
      .flatMap(([terminal, actions]) =>
        actions.map((action) => actionEntry(terminal, action))
      );
    rows.push(entries);
  }
  return rows;
}

function actionEntry(terminal: number, action: LrAction): EncodedAction {
  if (action.kind === "shift") return [terminal, 1, action.state];
  if (action.kind === "reduce") return [terminal, 2, action.production];
  return [terminal, 3];
}

function parserRuntimeActionRows(
  rows: readonly (readonly EncodedAction[])[],
): readonly (readonly (readonly [key: number, value: number])[])[] {
  return rows.map((row) =>
    row.map((entry) => [entry[0], encodeParserRuntimeAction(entry)] as const)
  );
}

function encodeParserRuntimeAction(action: EncodedAction): number {
  if (action[1] === 1) {
    assertParserRuntimePayload(action[2]);
    return RUNTIME_ACTION_SHIFT + action[2];
  }
  if (action[1] === 2) {
    assertParserRuntimePayload(action[2]);
    return RUNTIME_ACTION_REDUCE + action[2];
  }
  return RUNTIME_ACTION_ACCEPT;
}

function assertParserRuntimePayload(payload: number): void {
  if (payload < 0 || payload > RUNTIME_ACTION_PAYLOAD_MASK) {
    throw new Error(
      `Parser runtime action payload ${payload} exceeds the encoded action limit.`,
    );
  }
}

function parserRuntimeReducerEntry(
  reducer: ReducerSpec,
  fieldIds: ReadonlyMap<string, number>,
): readonly [kind: number, payload: number] {
  switch (reducer.kind) {
    case "start":
      return [RUNTIME_REDUCER_START, RUNTIME_NO_REDUCER_PAYLOAD];
    case "rule":
      return [RUNTIME_REDUCER_RULE, reducer.ruleId];
    case "terminal":
      return [RUNTIME_REDUCER_TERMINAL, RUNTIME_NO_REDUCER_PAYLOAD];
    case "ruleRef":
      return [RUNTIME_REDUCER_RULE_REF, RUNTIME_NO_REDUCER_PAYLOAD];
    case "identity":
      return [RUNTIME_REDUCER_IDENTITY, RUNTIME_NO_REDUCER_PAYLOAD];
    case "sequence":
      return [RUNTIME_REDUCER_SEQUENCE, RUNTIME_NO_REDUCER_PAYLOAD];
    case "optionalEmpty":
      return [RUNTIME_REDUCER_OPTIONAL_EMPTY, RUNTIME_NO_REDUCER_PAYLOAD];
    case "optionalSome":
      return [RUNTIME_REDUCER_OPTIONAL_SOME, RUNTIME_NO_REDUCER_PAYLOAD];
    case "repeatEmpty":
      return [RUNTIME_REDUCER_REPEAT_EMPTY, RUNTIME_NO_REDUCER_PAYLOAD];
    case "repeatAppend":
      return [RUNTIME_REDUCER_REPEAT_APPEND, RUNTIME_NO_REDUCER_PAYLOAD];
    case "repeat1First":
      return [RUNTIME_REDUCER_REPEAT1_FIRST, RUNTIME_NO_REDUCER_PAYLOAD];
    case "repeat1Append":
      return [RUNTIME_REDUCER_REPEAT1_APPEND, RUNTIME_NO_REDUCER_PAYLOAD];
    case "separatedFirst":
      return [RUNTIME_REDUCER_SEPARATED_FIRST, RUNTIME_NO_REDUCER_PAYLOAD];
    case "separatedAppend":
      return [RUNTIME_REDUCER_SEPARATED_APPEND, RUNTIME_NO_REDUCER_PAYLOAD];
    case "field": {
      const fieldId = fieldIds.get(reducer.name);
      if (fieldId === undefined) {
        throw new Error(
          `Field reducer '${reducer.name}' was not assigned a runtime field id.`,
        );
      }
      return [RUNTIME_REDUCER_FIELD, fieldId];
    }
  }
}

function expectedTerminalRows(
  bnf: BnfGrammar,
  lr: LrTable,
): readonly (readonly string[])[] {
  return lr.states.map((state) => {
    const row = lr.actions.get(state.id);
    return [
      ...new Set(
        [...(row?.keys() ?? [])].map((terminal) =>
          bnf.terminals[terminal]?.display ?? `#${terminal}`
        ),
      ),
    ].sort();
  });
}

function hasMultiActionEntries(
  table: ReadonlyMap<number, ReadonlyMap<number, LrActionSet>>,
): boolean {
  for (const row of table.values()) {
    for (const actions of row.values()) {
      if (actions.length > 1) return true;
    }
  }
  return false;
}
