import type { Diagnostic, SourceSpan } from "../ast.ts";
import type { AnalyzedGrammarV2 } from "./grammar_v2_ir.ts";
import {
  type GrammarV2LexerPlan,
  type GrammarV2LexOptions,
  type GrammarV2LexToken,
  lexGrammarV2,
} from "./grammar_v2_lexer.ts";

export interface GrammarV2CstSchema {
  readonly nodeKinds: readonly GrammarV2CstKind[];
  readonly tokenKinds: readonly GrammarV2CstKind[];
}

export interface GrammarV2CstKind {
  readonly id: number;
  readonly name: string;
}

export interface GrammarV2CstBuildResult {
  readonly root: GrammarV2GreenNode;
  readonly diagnostics: readonly Diagnostic[];
  readonly tokens: readonly GrammarV2LexToken[];
  readonly stats: GrammarV2CstStats;
}

export interface GrammarV2CstStats {
  readonly nodes: number;
  readonly tokens: number;
  readonly trivia: number;
  readonly invalid: number;
  readonly missing: number;
  readonly textBytes: number;
}

export interface GrammarV2ByteSpan {
  readonly start: number;
  readonly end: number;
}

export type GrammarV2GreenElement = GrammarV2GreenNode | GrammarV2GreenToken;

export interface GrammarV2GreenNode {
  readonly kind: "node";
  readonly kindId: number;
  readonly name: string;
  readonly children: readonly GrammarV2GreenElement[];
  readonly span: SourceSpan;
  readonly byteSpan: GrammarV2ByteSpan;
  readonly field: string | undefined;
  readonly missing: boolean;
  readonly invalid: boolean;
}

export interface GrammarV2GreenToken {
  readonly kind: "token" | "trivia" | "missing" | "invalid";
  readonly kindId: number;
  readonly name: string;
  readonly text: string;
  readonly span: SourceSpan;
  readonly byteSpan: GrammarV2ByteSpan;
  readonly field: string | undefined;
}

export function buildGrammarV2CstSchema(
  analyzed: AnalyzedGrammarV2,
): GrammarV2CstSchema {
  const nodeKinds: GrammarV2CstKind[] = [
    { id: 0, name: "Root" },
    { id: 1, name: "Invalid" },
    { id: 2, name: "Missing" },
  ];
  for (const rule of analyzed.rules) {
    nodeKinds.push({ id: nodeKinds.length, name: rule.name });
  }
  const tokenKinds: GrammarV2CstKind[] = [
    { id: 0, name: "EOF" },
    { id: 1, name: "ERROR" },
  ];
  for (const token of analyzed.tokens) {
    tokenKinds.push({ id: tokenKinds.length, name: token.name });
  }
  return { nodeKinds, tokenKinds };
}

export function buildGrammarV2TokenCst(
  schema: GrammarV2CstSchema,
  lexer: GrammarV2LexerPlan,
  source: string,
  options: GrammarV2LexOptions = {},
): GrammarV2CstBuildResult {
  const lexed = lexGrammarV2(lexer, source, {
    preserveTrivia: true,
    checkpoint: options.checkpoint,
    layout: options.layout,
  });
  const children: GrammarV2GreenElement[] = [];
  for (const token of lexed.tokens) {
    children.push(greenToken(schema, source, token));
  }
  const span = rootSpan(source, children);
  const root: GrammarV2GreenNode = {
    kind: "node",
    kindId: nodeKindId(schema, "Root"),
    name: "Root",
    children,
    span,
    byteSpan: byteSpanFor(source, span),
    field: undefined,
    missing: false,
    invalid: children.some((child) => child.kind === "invalid"),
  };
  return {
    root,
    diagnostics: lexed.diagnostics,
    tokens: lexed.tokens,
    stats: collectGrammarV2CstStats(root),
  };
}

export function missingGrammarV2CstNode(
  schema: GrammarV2CstSchema,
  name: string,
  span: SourceSpan,
  field: string | undefined,
): GrammarV2GreenNode {
  return {
    kind: "node",
    kindId: nodeKindId(schema, "Missing"),
    name,
    children: [],
    span,
    byteSpan: { start: span.start, end: span.start },
    field,
    missing: true,
    invalid: false,
  };
}

export function grammarV2CstText(root: GrammarV2GreenElement): string {
  if (root.kind !== "node") {
    return root.text;
  }
  let text = "";
  for (const child of root.children) {
    text = `${text}${grammarV2CstText(child)}`;
  }
  return text;
}

export function debugGrammarV2Cst(root: GrammarV2GreenElement): string {
  const lines: string[] = [];
  appendDebug(root, "", lines);
  return lines.join("\n");
}

export function collectGrammarV2CstStats(
  root: GrammarV2GreenElement,
): GrammarV2CstStats {
  const stats = {
    nodes: 0,
    tokens: 0,
    trivia: 0,
    invalid: 0,
    missing: 0,
    textBytes: 0,
  };
  collectStats(root, stats);
  return stats;
}

function greenToken(
  schema: GrammarV2CstSchema,
  source: string,
  token: GrammarV2LexToken,
): GrammarV2GreenToken {
  let kind: GrammarV2GreenToken["kind"] = "token";
  if (token.kind === "trivia") {
    kind = "trivia";
  } else if (token.kind === "error") {
    kind = "invalid";
  }
  return {
    kind,
    kindId: tokenKindId(schema, token.name),
    name: token.name,
    text: token.text,
    span: token.span,
    byteSpan: byteSpanFor(source, token.span),
    field: undefined,
  };
}

function appendDebug(
  element: GrammarV2GreenElement,
  indent: string,
  lines: string[],
): void {
  let field = "";
  if (element.field !== undefined) {
    field = `${element.field}: `;
  }
  if (element.kind === "node") {
    let suffix = "";
    if (element.missing) {
      suffix = " missing";
    } else if (element.invalid) {
      suffix = " invalid";
    }
    lines.push(
      `${indent}${field}${element.name}@${element.span.start}..${element.span.end}${suffix}`,
    );
    for (const child of element.children) {
      appendDebug(child, `${indent}  `, lines);
    }
    return;
  }
  lines.push(
    `${indent}${field}${element.name} ${
      JSON.stringify(element.text)
    }@${element.span.start}..${element.span.end}`,
  );
}

function collectStats(
  element: GrammarV2GreenElement,
  stats: {
    nodes: number;
    tokens: number;
    trivia: number;
    invalid: number;
    missing: number;
    textBytes: number;
  },
): void {
  if (element.kind === "node") {
    stats.nodes++;
    if (element.invalid) {
      stats.invalid++;
    }
    if (element.missing) {
      stats.missing++;
    }
    for (const child of element.children) {
      collectStats(child, stats);
    }
    return;
  }
  stats.textBytes += element.byteSpan.end - element.byteSpan.start;
  if (element.kind === "trivia") {
    stats.trivia++;
  } else if (element.kind === "invalid") {
    stats.invalid++;
    stats.tokens++;
  } else if (element.kind === "missing") {
    stats.missing++;
  } else {
    stats.tokens++;
  }
}

function rootSpan(
  source: string,
  children: readonly GrammarV2GreenElement[],
): SourceSpan {
  if (children.length > 0) {
    const first = children[0];
    const last = children[children.length - 1];
    return {
      start: first.span.start,
      end: last.span.end,
      line: first.span.line,
      column: first.span.column,
    };
  }
  return { start: 0, end: source.length, line: 1, column: 1 };
}

function nodeKindId(schema: GrammarV2CstSchema, name: string): number {
  const kind = schema.nodeKinds.find((candidate) => candidate.name === name);
  if (kind === undefined) {
    throw new Error(`Missing CST node kind '${name}'.`);
  }
  return kind.id;
}

function tokenKindId(schema: GrammarV2CstSchema, name: string): number {
  const kind = schema.tokenKinds.find((candidate) => candidate.name === name);
  if (kind === undefined) {
    return tokenKindId(schema, "ERROR");
  }
  return kind.id;
}

function byteSpanFor(source: string, span: SourceSpan): GrammarV2ByteSpan {
  return {
    start: utf8ByteLength(source.slice(0, span.start)),
    end: utf8ByteLength(source.slice(0, span.end)),
  };
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
