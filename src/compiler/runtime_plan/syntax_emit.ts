import type { AnalyzedGrammar } from "../ir.ts";
import { collectRuleFieldSchemas } from "../../targets/runtime/field_schema.ts";
import { generatedSourceBanner } from "../../targets/runtime/provenance.ts";
import type { PortableParserPlan } from "../../targets/runtime/portable_plan.ts";

export function emitSyntax(analyzed: AnalyzedGrammar): string {
  const namedTokens = analyzed.tokens.filter((token) =>
    token.kind === "skip" ||
    analyzed.reachableTokens.has(token.id)
  );
  const mainTokens = namedTokens.filter((token) => token.kind !== "skip");
  const triviaTokens = namedTokens.filter((token) => token.kind === "skip");
  const literals = analyzed.literals.filter((literal) =>
    analyzed.reachableLiterals.has(literal.id)
  );
  const rules = analyzed.rules.filter((rule) =>
    analyzed.reachableRules.has(rule.id)
  );
  const fieldSchemas = collectRuleFieldSchemas(analyzed);
  const rootSchema = fieldSchemas.find((schema) =>
    schema.ruleId === analyzed.rootRule
  );
  if (rootSchema === undefined) {
    throw new Error(
      `Could not find a generated field schema for root rule ${analyzed.rootRule}.`,
    );
  }
  return emitSyntaxModel({
    mainTokenKinds: mainTokens.map((token) => token.name),
    triviaTokenKinds: triviaTokens.map((token) => token.name),
    literalKinds: literals.map((literal) => literal.value),
    ruleNames: rules.map((rule) => rule.name),
    fieldSchemas: fieldSchemas.map((schema) => ({
      ruleName: schema.ruleName,
      nodeType: schema.nodeType,
      fields: schema.fields.map((field) => {
        let cardinality: "required" | "nullable" | "array" = "required";
        if (field.array) {
          cardinality = "array";
        } else if (field.nullable) {
          cardinality = "nullable";
        }
        return {
          name: field.name,
          type: field.type,
          cardinality,
        };
      }),
    })),
    rootNodeType: rootSchema.nodeType,
    parserPlanVersion: undefined,
    parserPlanSemantics: undefined,
  });
}

export function emitSyntaxFromPortablePlan(
  plan: PortableParserPlan,
): string {
  const namedTokens = plan.symbols.tokens.filter((token) => token.reachable);
  const mainTokens = namedTokens.filter((token) => token.kind !== "skip");
  const triviaTokens = namedTokens.filter((token) => token.kind === "skip");
  const literals = plan.symbols.literals.filter((literal) => literal.reachable);
  return emitSyntaxModel({
    mainTokenKinds: mainTokens.map((token) => token.name),
    triviaTokenKinds: triviaTokens.map((token) => token.name),
    literalKinds: literals.map((literal) => literal.value),
    ruleNames: plan.cst.rules.map((rule) => rule.ruleName),
    fieldSchemas: plan.cst.rules,
    rootNodeType: plan.cst.rootNodeType,
    parserPlanVersion: plan.version,
    parserPlanSemantics: plan.semantics,
  });
}

function emitSyntaxModel(model: {
  mainTokenKinds: readonly string[];
  triviaTokenKinds: readonly string[];
  literalKinds: readonly string[];
  ruleNames: readonly string[];
  fieldSchemas: readonly {
    readonly ruleName: string;
    readonly nodeType: string;
    readonly fields: readonly {
      readonly name: string;
      readonly type: string;
      readonly cardinality: "required" | "nullable" | "array";
    }[];
  }[];
  rootNodeType: string;
  parserPlanVersion: number | undefined;
  parserPlanSemantics: string | undefined;
}): string {
  const cursorTypeByNodeType = new Map<string, string>();
  for (const schema of model.fieldSchemas) {
    cursorTypeByNodeType.set(schema.nodeType, cursorTypeName(schema.nodeType));
  }
  const cursorSchemas = model.fieldSchemas.map((schema) => ({
    ...schema,
    cursorType: cursorTypeForNodeType(cursorTypeByNodeType, schema.nodeType),
    fields: schema.fields.map((field) => ({
      ...field,
      cursorType: cursorFieldType(field.type, cursorTypeByNodeType),
      array: field.cardinality === "array",
    })),
  }));
  const rootCursorTypeValue = cursorTypeByNodeType.get(model.rootNodeType);
  if (rootCursorTypeValue === undefined) {
    throw new Error(
      `Could not find a generated cursor type for root node ${model.rootNodeType}.`,
    );
  }
  const rootCursorType = rootCursorTypeValue;

  const lines: string[] = [
    generatedSourceBanner({
      parserPlanVersion: model.parserPlanVersion,
      parserPlanSemantics: model.parserPlanSemantics,
    }),
    "",
    "export interface Span {",
    "  start: number;",
    "  end: number;",
    "}",
    "",
    "export interface Position {",
    "  line: number;",
    "  column: number;",
    "}",
    "",
    "export interface SourceMap {",
    "  readonly source: string;",
    "  positionAt(offset: number): Position;",
    "}",
    "",
    "export function createSourceMap(source: string): SourceMap {",
    "  let lineStarts: readonly number[] | null = null;",
    "  const starts = (): readonly number[] => {",
    "    if (lineStarts) return lineStarts;",
    "    const values = [0];",
    "    for (let index = 0; index < source.length; index++) {",
    "      const code = source.charCodeAt(index);",
    "      if (code === 13) {",
    "        if (source.charCodeAt(index + 1) === 10) index++;",
    "        values.push(index + 1);",
    "      } else if (code === 10) {",
    "        values.push(index + 1);",
    "      }",
    "    }",
    "    lineStarts = values;",
    "    return values;",
    "  };",
    "  return {",
    "    source,",
    "    positionAt(offset: number): Position {",
    "      const clamped = Math.min(Math.max(0, offset), source.length);",
    "      const values = starts();",
    "      let low = 0;",
    "      let high = values.length - 1;",
    "      while (low <= high) {",
    "        const mid = Math.floor((low + high) / 2);",
    "        if (values[mid] <= clamped) low = mid + 1;",
    "        else high = mid - 1;",
    "      }",
    "      const lineIndex = Math.max(0, low - 1);",
    "      return {",
    "        line: lineIndex + 1,",
    "        column: clamped - values[lineIndex] + 1,",
    "      };",
    "    },",
    "  };",
    "}",
    "",
    "export function positionAt(source: string, offset: number): Position {",
    "  return createSourceMap(source).positionAt(offset);",
    "}",
    "",
    "export interface LexDiagnostic {",
    "  code:",
    '    | "LEX_UNEXPECTED_CHARACTER"',
    '    | "PARSER_INPUT_TOO_LARGE";',
    "  message: string;",
    "  span: Span;",
    "}",
    "",
    "export interface ParseDiagnostic {",
    "  code:",
    '    | "PARSE_LEXICAL_ERROR"',
    '    | "PARSE_UNEXPECTED_TOKEN"',
    '    | "PARSE_TRAILING_INPUT"',
    '    | "PARSER_TRACE_LIMIT"',
    '    | "PARSER_AMBIGUOUS_PARSE"',
    '    | "PARSER_INTERNAL_ERROR"',
    '    | "PARSER_INPUT_TOO_LARGE";',
    "  message: string;",
    "  span: Span;",
    "  runtimeCode: number;",
    "  runtimeDetail: number;",
    '  runtimeDetailKind: "none" | "parser-state";',
    "  runtimeDetailKindId: number;",
    "  expected?: readonly string[];",
    "  found?: string;",
    "}",
    "",
    "export type MainTokenKind =",
    ...unionLines(model.mainTokenKinds),
    "",
    "export type TriviaTokenKind =",
    ...unionLines(model.triviaTokenKinds),
    "",
    "export type NamedTokenKind = MainTokenKind | TriviaTokenKind;",
    "",
    "export type AnyMainTokenKind = MainTokenKind extends never",
    "  ? string",
    "  : MainTokenKind;",
    "",
    "export type AnyTriviaTokenKind = TriviaTokenKind extends never",
    "  ? string",
    "  : TriviaTokenKind;",
    "",
    "export type AnyNamedTokenKind = NamedTokenKind extends never",
    "  ? string",
    "  : NamedTokenKind;",
    "",
    "export type LiteralKind =",
    ...unionLines(model.literalKinds),
    "",
    "export type AnyLiteralKind = LiteralKind extends never",
    "  ? string",
    "  : LiteralKind;",
    "",
    "export interface MainNamedToken<K extends string = AnyMainTokenKind> {",
    '  type: "named";',
    "  kind: K;",
    "  text: string;",
    "  span: Span;",
    '  channel: "main";',
    "}",
    "",
    "export interface TriviaToken<K extends string = AnyTriviaTokenKind> {",
    '  type: "named";',
    "  kind: K;",
    "  text: string;",
    "  span: Span;",
    '  channel: "trivia";',
    "}",
    "",
    "export type NamedToken<K extends NamedTokenKind = NamedTokenKind> =",
    "  K extends MainTokenKind",
    "    ? MainNamedToken<K>",
    "    : K extends TriviaTokenKind",
    "    ? TriviaToken<K>",
    "    : never;",
    "",
    "export interface LiteralToken<L extends string = AnyLiteralKind> {",
    '  type: "literal";',
    "  literal: L;",
    "  text: L;",
    "  span: Span;",
    '  channel: "main";',
    "}",
    "",
    "export interface ErrorToken {",
    '  type: "error";',
    "  text: string;",
    "  span: Span;",
    '  channel: "error";',
    "}",
    "",
    "export interface EofToken {",
    '  type: "eof";',
    '  text: "";',
    "  span: Span;",
    '  channel: "main";',
    "}",
    "",
    "export type Token =",
    "  | MainNamedToken",
    "  | TriviaToken",
    "  | LiteralToken",
    "  | ErrorToken",
    "  | EofToken;",
    "",
    "export type RuleName =",
    ...unionLines(model.ruleNames),
    "",
  ];

  lines.push(
    "export interface TokenCursor<",
    '  TokenType extends "named" | "literal" = "named" | "literal",',
    "  K extends string = AnyMainTokenKind | AnyLiteralKind,",
    "> {",
    '  readonly type: "token";',
    "  readonly tokenType: TokenType;",
    "  readonly kind: K;",
    "  readonly text: string;",
    "  readonly span: Span;",
    "  readonly tokenIndex: number;",
    "}",
    "",
    "export type CursorFieldValue =",
    "  | SyntaxCursor",
    "  | readonly CursorFieldValue[]",
    "  | null;",
    "",
    "export type SyntaxCursor = AnyRuleCursor | TokenCursor;",
    "",
    "export interface RuleCursorBase<N extends RuleName = RuleName> {",
    '  readonly type: "rule";',
    "  readonly name: N;",
    "  readonly span: Span;",
    "  readonly tokenRange: { start: number; end: number };",
    "  readonly childCount: number;",
    "  child(index: number): SyntaxCursor | undefined;",
    "  children(): readonly SyntaxCursor[];",
    "  field(name: string): CursorFieldValue | undefined;",
    "  fieldArray(name: string): readonly CursorFieldValue[];",
    "}",
    "",
  );

  for (const schema of cursorSchemas) {
    lines.push(
      `export interface ${schema.cursorType} extends RuleCursorBase<${
        quote(schema.ruleName)
      }> {`,
    );
    for (const field of schema.fields) {
      lines.push(
        `  field(name: ${quote(field.name)}): ${field.cursorType};`,
      );
    }
    if (schema.fields.length > 0) {
      lines.push("  field(name: string): CursorFieldValue | undefined;");
    }
    for (const field of schema.fields) {
      if (!field.array) {
        continue;
      }
      lines.push(
        `  fieldArray(name: ${quote(field.name)}): ${field.cursorType};`,
      );
    }
    if (schema.fields.length > 0) {
      lines.push("  fieldArray(name: string): readonly CursorFieldValue[];");
    }
    lines.push("}", "");
  }

  lines.push(
    "export type AnyRuleCursor =",
    ...unionLines(cursorSchemas.map((schema) => schema.cursorType), false),
    "",
    "export type RuleCursor<N extends RuleName = RuleName> = Extract<",
    "  AnyRuleCursor,",
    "  { readonly name: N }",
    ">;",
    "",
    `export type RootCursor = ${rootCursorType};`,
    "",
    "export interface LexOptions {",
    "  preserveTrivia?: boolean;",
    "}",
    "",
    "export interface TokenTape {",
    "  readonly length: number;",
    "  token(index: number): Token | undefined;",
    "}",
    "",
    "export interface LexTapeResult {",
    "  source: string;",
    "  tokenTape: TokenTape;",
    "  diagnostics: readonly LexDiagnostic[];",
    "}",
    "",
    "export interface ParseOptions {",
    "  preserveTrivia?: boolean;",
    "  maxParserActions?: number;",
    "}",
    "",
    "export type CursorParseResult<Root extends RuleCursor = RootCursor> =",
    "  | {",
    "    ok: true;",
    "    cursor: Root;",
    "    source: string;",
    "    diagnostics: readonly [];",
    "  }",
    "  | {",
    "    ok: false;",
    "    cursor: null;",
    "    source: string;",
    "    diagnostics: readonly ParseDiagnostic[];",
    "  };",
    "",
    "export type ValidateParseResult =",
    "  | {",
    "    ok: true;",
    "    source: string;",
    "    diagnostics: readonly [];",
    "  }",
    "  | {",
    "    ok: false;",
    "    source: string;",
    "    diagnostics: readonly ParseDiagnostic[];",
    "  };",
    "",
  );

  return `${lines.join("\n")}\n`;
}

function unionLines(values: readonly string[], quoteValues = true): string[] {
  if (values.length === 0) return ["  never;"];
  const sorted = [...values];
  return sorted.map((value, index) =>
    `  | ${quoteValues ? quote(value) : value}${
      index === sorted.length - 1 ? ";" : ""
    }`
  );
}

function cursorTypeName(nodeType: string): string {
  if (nodeType.endsWith("Node")) {
    return `${nodeType.slice(0, -4)}Cursor`;
  }
  return `${nodeType}Cursor`;
}

function cursorTypeForNodeType(
  cursorTypeByNodeType: ReadonlyMap<string, string>,
  nodeType: string,
): string {
  const cursorType = cursorTypeByNodeType.get(nodeType);
  if (cursorType === undefined) {
    throw new Error(`Could not find cursor type for node type ${nodeType}.`);
  }
  return cursorType;
}

function cursorFieldType(
  type: string,
  cursorTypeByNodeType: ReadonlyMap<string, string>,
): string {
  let result = type.replace(
    /NamedToken<([^>]+)>/g,
    'TokenCursor<"named", $1>',
  );
  result = result.replace(
    /LiteralToken<([^>]+)>/g,
    'TokenCursor<"literal", $1>',
  );
  const entries = [...cursorTypeByNodeType.entries()].sort(
    (left, right) => right[0].length - left[0].length,
  );
  for (const [nodeType, cursorType] of entries) {
    const pattern = new RegExp(`\\b${escapeRegExp(nodeType)}\\b`, "g");
    result = result.replace(pattern, cursorType);
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function quote(value: string): string {
  return JSON.stringify(value);
}
