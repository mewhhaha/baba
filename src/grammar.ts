import type { Diagnostic, GrammarParseResult, SourceSpan } from "./ast.ts";
import { grammarParserWasmBytes } from "./grammar_parser_wasm_bytes.ts";

interface GrammarParserExports {
  readonly memory: WebAssembly.Memory;
  readonly grammar_parser_alloc: (len: number) => number;
  readonly grammar_parser_dealloc: (ptr: number, len: number) => void;
  readonly grammar_parser_parse: (ptr: number, len: number) => bigint;
  readonly grammar_parser_free_result: (ptr: number, len: number) => void;
}

let parserExports: GrammarParserExports | undefined;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function parseGrammarSource(source: string): GrammarParseResult {
  const parser = grammarParser();
  const sourceBytes = encoder.encode(source);
  const sourcePtr = parser.grammar_parser_alloc(sourceBytes.length);
  try {
    new Uint8Array(
      parser.memory.buffer,
      sourcePtr,
      sourceBytes.length,
    ).set(sourceBytes);
    const packed = parser.grammar_parser_parse(sourcePtr, sourceBytes.length);
    const resultPtr = Number(packed >> 32n);
    const resultLen = Number(packed & 0xffff_ffffn);
    try {
      const resultBytes = new Uint8Array(
        parser.memory.buffer,
        resultPtr,
        resultLen,
      );
      const result = JSON.parse(
        decoder.decode(resultBytes),
      ) as GrammarParseResult;
      return attachDiagnosticSourceLines(source, result);
    } finally {
      parser.grammar_parser_free_result(resultPtr, resultLen);
    }
  } finally {
    parser.grammar_parser_dealloc(sourcePtr, sourceBytes.length);
  }
}

function attachDiagnosticSourceLines(
  source: string,
  result: GrammarParseResult,
): GrammarParseResult {
  const diagnostics: Diagnostic[] = [];
  for (const diagnostic of result.diagnostics) {
    if (diagnostic.span === undefined || diagnostic.sourceLine !== undefined) {
      diagnostics.push(diagnostic);
      continue;
    }
    diagnostics.push({
      ...diagnostic,
      sourceLine: sourceLineAt(source, diagnostic.span),
    });
  }
  return {
    ...result,
    diagnostics,
  };
}

function sourceLineAt(source: string, span: SourceSpan): string {
  let start = span.start;
  while (start > 0 && source.charCodeAt(start - 1) !== 10) {
    start--;
  }

  let end = span.start;
  while (end < source.length) {
    const code = source.charCodeAt(end);
    if (code === 10 || code === 13) {
      break;
    }
    end++;
  }
  return source.slice(start, end);
}

function grammarParser(): GrammarParserExports {
  if (parserExports !== undefined) {
    return parserExports;
  }
  const bytes = grammarParserWasmBytes();
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const module = new WebAssembly.Module(buffer);
  const instance = new WebAssembly.Instance(module, {});
  parserExports = instance.exports as unknown as GrammarParserExports;
  return parserExports;
}
