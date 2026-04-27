import type { Diagnostic, SourceSpan } from "./ast.ts";

/** Structured baba error used by the stable public API and CLI. */
export class BabaError extends Error {
  readonly code: string;
  readonly span?: SourceSpan;
  readonly path?: string;
  readonly sourceLine?: string;
  override readonly cause?: unknown;

  constructor(diagnostic: Diagnostic, options: { cause?: unknown } = {}) {
    super(diagnostic.message);
    this.name = "BabaError";
    this.code = diagnostic.code;
    this.span = diagnostic.span;
    this.path = diagnostic.path;
    this.sourceLine = diagnostic.sourceLine;
    this.cause = options.cause;
  }

  /** Converts this error to a serializable diagnostic. */
  toDiagnostic(): Diagnostic {
    return {
      code: this.code,
      message: this.message,
      span: this.span,
      path: this.path,
      sourceLine: this.sourceLine,
    };
  }
}

/** Formats a diagnostic or BabaError for CLI output. */
export function formatDiagnostic(
  errorOrDiagnostic: BabaError | Diagnostic,
): string {
  const diagnostic = errorOrDiagnostic instanceof BabaError
    ? errorOrDiagnostic.toDiagnostic()
    : errorOrDiagnostic;
  const suffix = diagnostic.path ? ` (${diagnostic.path})` : "";
  if (!diagnostic.span || !diagnostic.sourceLine) {
    return `${diagnostic.code}: ${diagnostic.message}${suffix}`;
  }

  const markerWidth = Math.max(1, diagnostic.span.end - diagnostic.span.start);
  const marker = `${" ".repeat(Math.max(0, diagnostic.span.column - 1))}${
    "^".repeat(markerWidth)
  }`;
  return `${diagnostic.code}: ${diagnostic.message}${suffix}\n${diagnostic.sourceLine}\n${marker}`;
}

/** Converts unknown thrown values into a BabaError. */
export function toBabaError(error: unknown, code = "BABA_ERROR"): BabaError {
  if (error instanceof BabaError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const maybeEbnf = error as {
    span?: SourceSpan;
    sourceLine?: string;
    name?: string;
  };
  return new BabaError(
    {
      code: maybeEbnf.name === "EbnfError" ? "EBNF_PARSE_ERROR" : code,
      message,
      span: maybeEbnf.span,
      sourceLine: maybeEbnf.sourceLine,
    },
    { cause: error },
  );
}
