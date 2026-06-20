import type { Diagnostic, SourceSpan } from "../../ast.ts";
import type { RegexAst } from "./ast.ts";
import { parsePortableRegex } from "./parser.ts";
import { regexCanMatchEmpty } from "./nullable.ts";

export interface RegexDiagnosticOptions {
  pattern: string;
  label: string;
  span?: SourceSpan;
  code: string;
  backend?: Diagnostic["backend"];
}

export interface RegexDiagnosticResult {
  ast?: RegexAst;
  diagnostics: Diagnostic[];
}

export function analyzeRegexPattern(
  options: RegexDiagnosticOptions,
): RegexDiagnosticResult {
  let ast: RegexAst;
  try {
    ast = parsePortableRegex(options.pattern);
  } catch (error) {
    return {
      diagnostics: [{
        code: options.code,
        severity: "error",
        backend: options.backend,
        message: `${options.label}: ${errorMessage(error)}`,
        span: options.span,
      }],
    };
  }

  if (regexCanMatchEmpty(ast)) {
    return {
      ast,
      diagnostics: [{
        code: options.code,
        severity: "error",
        backend: options.backend,
        message: `${options.label}: must not match empty text`,
        span: options.span,
      }],
    };
  }

  return { ast, diagnostics: [] };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
