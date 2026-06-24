import type { Diagnostic, SourceSpan } from "../ast.ts";

export type BrlDiagnosticCode =
  | "BRL_PARSE_EXPECTED"
  | "BRL_PARSE_UNEXPECTED_TOKEN"
  | "BRL_PARSE_UNTERMINATED"
  | "BRL_RESOLVE_DUPLICATE_DECLARATION"
  | "BRL_RESOLVE_DUPLICATE_FIELD"
  | "BRL_RESOLVE_DUPLICATE_LOCAL"
  | "BRL_RESOLVE_INVALID_IMPORT"
  | "BRL_RESOLVE_RECURSIVE_TYPE"
  | "BRL_RESOLVE_SHADOWING"
  | "BRL_RESOLVE_UNKNOWN_NAME"
  | "BRL_TYPE_ASSIGNMENT"
  | "BRL_TYPE_CALL_TARGET"
  | "BRL_TYPE_CAST"
  | "BRL_TYPE_CONDITION"
  | "BRL_TYPE_FIELD"
  | "BRL_TYPE_INDEX"
  | "BRL_TYPE_INTRINSIC"
  | "BRL_TYPE_LOOP_CONTROL"
  | "BRL_TYPE_MISSING_RETURN"
  | "BRL_TYPE_RETURN"
  | "BRL_TYPE_UNSUPPORTED"
  | "BRL_UNREACHABLE_CODE"
  | "BRL_IR_INVALID_BRANCH"
  | "BRL_IR_INVALID_CAST"
  | "BRL_IR_INVALID_FIELD"
  | "BRL_IR_INVALID_INTRINSIC"
  | "BRL_IR_INVALID_LOCAL"
  | "BRL_IR_INVALID_OPERAND"
  | "BRL_IR_MISSING_ENTRYPOINT"
  | "BRL_IR_MISSING_TERMINATOR"
  | "BRL_IR_RETURN_TYPE"
  | "BRL_IR_USE_BEFORE_DEFINITION";

export interface BrlDiagnostic extends Diagnostic {
  readonly code: BrlDiagnosticCode;
  readonly span?: SourceSpan;
}

export function brlDiagnostic(
  code: BrlDiagnosticCode,
  message: string,
  span?: SourceSpan,
): BrlDiagnostic {
  return {
    code,
    severity: "error",
    message,
    ...(span ? { span } : {}),
  };
}
