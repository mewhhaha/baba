import type { SourceSpan } from "../ast.ts";
import type { BrlDiagnostic } from "./diagnostics.ts";

export interface BrlModule {
  readonly kind: "module";
  readonly items: readonly BrlItem[];
  readonly span: SourceSpan;
  readonly diagnostics: readonly BrlDiagnostic[];
}

export type BrlItem =
  | BrlImportDeclaration
  | BrlRecordDeclaration
  | BrlEnumDeclaration
  | BrlFunctionDeclaration;

export interface BrlIdentifier {
  readonly text: string;
  readonly span: SourceSpan;
}

export interface BrlImportDeclaration {
  readonly kind: "import";
  readonly path: readonly BrlIdentifier[];
  readonly span: SourceSpan;
}

export interface BrlRecordDeclaration {
  readonly kind: "record";
  readonly name: BrlIdentifier;
  readonly fields: readonly BrlFieldDeclaration[];
  readonly span: SourceSpan;
}

export interface BrlFieldDeclaration {
  readonly name: BrlIdentifier;
  readonly type: BrlTypeNode;
  readonly span: SourceSpan;
}

export interface BrlEnumDeclaration {
  readonly kind: "enum";
  readonly name: BrlIdentifier;
  readonly variants: readonly BrlVariantDeclaration[];
  readonly span: SourceSpan;
}

export interface BrlVariantDeclaration {
  readonly name: BrlIdentifier;
  readonly payload: readonly BrlTypeNode[];
  readonly span: SourceSpan;
}

export interface BrlFunctionDeclaration {
  readonly kind: "function";
  readonly name: BrlIdentifier;
  readonly parameters: readonly BrlParameter[];
  readonly result: BrlTypeNode | null;
  readonly body: BrlBlockStatement;
  readonly span: SourceSpan;
}

export interface BrlParameter {
  readonly name: BrlIdentifier;
  readonly type: BrlTypeNode;
  readonly span: SourceSpan;
}

export type BrlTypeNode =
  | {
    readonly kind: "scalar";
    readonly name: BrlScalarTypeName;
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "named";
    readonly name: BrlIdentifier;
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "array";
    readonly element: BrlTypeNode;
    readonly length: number;
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "span";
    readonly element: BrlTypeNode;
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "vec";
    readonly element: BrlTypeNode;
    readonly span: SourceSpan;
  }
  | { readonly kind: "missing"; readonly span: SourceSpan };

export type BrlScalarTypeName = "bool" | "u8" | "u16" | "u32" | "i32";

export type BrlStatement =
  | BrlBlockStatement
  | BrlLetStatement
  | BrlAssignStatement
  | BrlForStatement
  | BrlIfStatement
  | BrlWhileStatement
  | BrlBreakStatement
  | BrlContinueStatement
  | BrlReturnStatement
  | BrlExpressionStatement
  | BrlMissingStatement;

export interface BrlBlockStatement {
  readonly kind: "block";
  readonly statements: readonly BrlStatement[];
  readonly span: SourceSpan;
}

export interface BrlLetStatement {
  readonly kind: "let";
  readonly name: BrlIdentifier;
  readonly type: BrlTypeNode | null;
  readonly expression: BrlExpression;
  readonly span: SourceSpan;
}

export interface BrlAssignStatement {
  readonly kind: "assign";
  readonly target: BrlIdentifier;
  readonly expression: BrlExpression;
  readonly span: SourceSpan;
}

export interface BrlIfStatement {
  readonly kind: "if";
  readonly condition: BrlExpression;
  readonly consequent: BrlBlockStatement;
  readonly alternate: BrlBlockStatement | null;
  readonly span: SourceSpan;
}

export interface BrlWhileStatement {
  readonly kind: "while";
  readonly condition: BrlExpression;
  readonly body: BrlBlockStatement;
  readonly span: SourceSpan;
}

export interface BrlForStatement {
  readonly kind: "for";
  readonly name: BrlIdentifier;
  readonly start: BrlExpression;
  readonly end: BrlExpression;
  readonly body: BrlBlockStatement;
  readonly span: SourceSpan;
}

export interface BrlBreakStatement {
  readonly kind: "break";
  readonly span: SourceSpan;
}

export interface BrlContinueStatement {
  readonly kind: "continue";
  readonly span: SourceSpan;
}

export interface BrlReturnStatement {
  readonly kind: "return";
  readonly expression: BrlExpression | null;
  readonly span: SourceSpan;
}

export interface BrlExpressionStatement {
  readonly kind: "expression";
  readonly expression: BrlExpression;
  readonly span: SourceSpan;
}

export interface BrlMissingStatement {
  readonly kind: "missing";
  readonly span: SourceSpan;
}

export type BrlExpression =
  | {
    readonly kind: "integer";
    readonly value: number;
    readonly raw: string;
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "bool";
    readonly value: boolean;
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "name";
    readonly name: BrlIdentifier;
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "record";
    readonly name: BrlIdentifier;
    readonly fields: readonly BrlRecordLiteralField[];
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "call";
    readonly callee: BrlExpression;
    readonly args: readonly BrlExpression[];
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "field";
    readonly receiver: BrlExpression;
    readonly field: BrlIdentifier;
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "index";
    readonly receiver: BrlExpression;
    readonly index: BrlExpression;
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "cast";
    readonly expression: BrlExpression;
    readonly type: BrlTypeNode;
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "binary";
    readonly operator: string;
    readonly left: BrlExpression;
    readonly right: BrlExpression;
    readonly span: SourceSpan;
  }
  | {
    readonly kind: "unary";
    readonly operator: string;
    readonly operand: BrlExpression;
    readonly span: SourceSpan;
  }
  | { readonly kind: "missing"; readonly span: SourceSpan };

export interface BrlRecordLiteralField {
  readonly name: BrlIdentifier;
  readonly expression: BrlExpression;
  readonly span: SourceSpan;
}
