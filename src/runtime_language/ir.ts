import type { SourceSpan } from "../ast.ts";
import type { BrlDiagnostic } from "./diagnostics.ts";

export type BrlIrScalarType = "bool" | "u8" | "u16" | "u32" | "i32";

export type BrlIrType =
  | { readonly kind: "scalar"; readonly name: BrlIrScalarType }
  | { readonly kind: "record"; readonly id: number; readonly name: string }
  | {
    readonly kind: "array";
    readonly element: BrlIrType;
    readonly length: number;
  }
  | { readonly kind: "span"; readonly element: BrlIrType }
  | { readonly kind: "vec"; readonly element: BrlIrType };

export interface BrlIrRecord {
  readonly id: number;
  readonly name: string;
  readonly fields: readonly BrlIrField[];
  readonly span: SourceSpan;
}

export interface BrlIrField {
  readonly id: number;
  readonly name: string;
  readonly type: BrlIrType;
  readonly span: SourceSpan;
}

export interface BrlIrProgram {
  readonly records: readonly BrlIrRecord[];
  readonly functions: readonly BrlIrFunction[];
  readonly diagnostics: readonly BrlDiagnostic[];
}

export interface BrlIrFunction {
  readonly id: number;
  readonly name: string;
  readonly params: readonly BrlIrLocal[];
  readonly result: BrlIrType | null;
  readonly locals: readonly BrlIrLocal[];
  readonly blocks: readonly BrlIrBlock[];
  readonly span: SourceSpan;
}

export interface BrlIrLocal {
  readonly id: number;
  readonly name: string;
  readonly type: BrlIrType;
  readonly initialized: boolean;
  readonly span: SourceSpan;
}

export interface BrlIrBlock {
  readonly id: number;
  readonly instructions: readonly BrlIrInstruction[];
  readonly terminator: BrlIrTerminator | null;
  readonly span: SourceSpan;
}

export type BrlIrInstruction =
  | {
    readonly kind: "assign";
    readonly local: number;
    readonly value: BrlIrExpression;
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "evaluate";
    readonly value: BrlIrExpression;
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "trap";
    readonly message: string;
    readonly span: SourceSpan;
  };

export type BrlIrTerminator =
  | {
    readonly kind: "return";
    readonly value: BrlIrExpression | null;
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "jump";
    readonly target: number;
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "branch";
    readonly condition: BrlIrExpression;
    readonly consequent: number;
    readonly alternate: number;
    readonly span: SourceSpan;
  };

export type BrlIrExpression =
  | {
    readonly kind: "literal";
    readonly type: BrlIrType;
    readonly value: number | boolean;
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "local";
    readonly type: BrlIrType;
    readonly local: number;
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "record";
    readonly type: BrlIrType;
    readonly fields: readonly BrlIrRecordLiteralField[];
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "binary";
    readonly type: BrlIrType;
    readonly operator: string;
    readonly left: BrlIrExpression;
    readonly right: BrlIrExpression;
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "unary";
    readonly type: BrlIrType;
    readonly operator: string;
    readonly operand: BrlIrExpression;
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "call";
    readonly type: BrlIrType;
    readonly functionId: number;
    readonly args: readonly BrlIrExpression[];
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "field";
    readonly type: BrlIrType;
    readonly receiver: BrlIrExpression;
    readonly fieldId: number;
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "index";
    readonly type: BrlIrType;
    readonly receiver: BrlIrExpression;
    readonly index: BrlIrExpression;
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "cast";
    readonly type: BrlIrType;
    readonly expression: BrlIrExpression;
    readonly span: SourceSpan;
  };

export interface BrlIrRecordLiteralField {
  readonly fieldId: number;
  readonly value: BrlIrExpression;
  readonly span: SourceSpan;
}

export const BRL_BOOL: BrlIrType = { kind: "scalar", name: "bool" };
export const BRL_U32: BrlIrType = { kind: "scalar", name: "u32" };

export function sameBrlIrType(
  left: BrlIrType | null,
  right: BrlIrType | null,
): boolean {
  if (left === null || right === null) return left === right;
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "scalar":
      return right.kind === "scalar" && left.name === right.name;
    case "record":
      return right.kind === "record" && left.id === right.id;
    case "array":
      return right.kind === "array" && left.length === right.length &&
        sameBrlIrType(left.element, right.element);
    case "span":
    case "vec":
      return right.kind === left.kind &&
        sameBrlIrType(left.element, right.element);
  }
}

export function formatBrlIrType(type: BrlIrType | null): string {
  if (!type) return "void";
  switch (type.kind) {
    case "scalar":
      return type.name;
    case "record":
      return type.name;
    case "array":
      return `[${formatBrlIrType(type.element)}; ${type.length}]`;
    case "span":
      return `span<${formatBrlIrType(type.element)}>`;
    case "vec":
      return `vec<${formatBrlIrType(type.element)}>`;
  }
}

export function isIntegerBrlIrType(type: BrlIrType | null): boolean {
  return type?.kind === "scalar" && type.name !== "bool";
}
