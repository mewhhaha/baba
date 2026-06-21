import type { AnalyzedGrammar } from "../../compiler/ir.ts";
import type { BnfGrammar } from "../typescript/bnf.ts";
import type { LrTable } from "../typescript/lr1.ts";
import { emitParser } from "../typescript/parser_emit.ts";

export function emitWasmParser(
  analyzed: AnalyzedGrammar,
  bnf: BnfGrammar,
  lr: LrTable,
): string {
  let source = emitParser(analyzed, bnf, lr);
  source = source.replace(
    `import { lex } from "./lexer.ts";`,
    `import { lex, lexForParse, type WasmParseStream } from "./lexer.ts";
import { createParseTraceInput, parseTrace, type ParseTraceInput } from "./wasm.ts";`,
  );
  source = replaceParseFunction(source);
  source = replaceTableConstants(source, expectedTerminals(bnf, lr));
  source = replaceParseTokenList(source);
  source = replaceLookupFunctions(source);
  return source;
}

function replaceTableConstants(
  source: string,
  expected: readonly (readonly string[])[],
): string {
  const start = source.indexOf("const ACTIONS:");
  const end = source.indexOf("const PRODUCTIONS:", start);
  if (start === -1 || end === -1) {
    throw new Error("Could not locate generated parser table constants.");
  }
  return `${
    source.slice(0, start)
  }const EXPECTED_TERMINALS: readonly (readonly string[])[] = ${
    JSON.stringify(expected)
  };
${source.slice(end)}`;
}

function replaceParseFunction(source: string): string {
  const oldSource = `  const lexed = lex(source, options);
  return parseTokenList(
    source,
    lexed.tokens,
    lexicalDiagnostics(lexed.diagnostics),
  );`;
  const newSource = `  const lexed = lexForParse(source, options);
  return parseTokenList(
    source,
    lexed.tokens,
    lexicalDiagnostics(lexed.diagnostics),
    lexed.parseStream,
  );`;
  if (!source.includes(oldSource)) {
    throw new Error("Could not locate generated parse function body.");
  }
  return source.replace(oldSource, newSource);
}

function replaceLookupFunctions(source: string): string {
  const start = source.indexOf("function findActions(");
  const end = source.indexOf("function tokenToTerminal(", start);
  if (start === -1 || end === -1) {
    throw new Error("Could not locate generated parser lookup functions.");
  }
  return `${
    source.slice(0, start)
  }function expectedTerminals(state: number): readonly string[] {
  return EXPECTED_TERMINALS[state] ?? [];
}

${source.slice(end)}`;
}

function replaceParseTokenList(source: string): string {
  const start = source.indexOf("function parseTokenList(");
  const end = source.indexOf("function reduceProduction(", start);
  if (start === -1 || end === -1) {
    throw new Error("Could not locate generated parser loop.");
  }
  return `${source.slice(0, start)}function parseTokenList(
  source: string,
  tokens: readonly Token[],
  lexicalDiagnostics: readonly ParseDiagnostic[],
  parseStream?: WasmParseStream,
): ParseResult<RootNode> {
  if (lexicalDiagnostics.length > 0) {
    return {
      ok: false,
      root: null,
      source,
      tokens,
      diagnostics: lexicalDiagnostics,
    };
  }

  const stream = parseStream ?? compactTokenStream(source, tokens);
  const traced = parseTrace(stream.input, stream.terminalCount);
  if (!traced.ok) {
    const token = stream.tokens[traced.index] ?? eofToken(source.length);
    if (traced.internal) {
      return {
        ok: false,
        root: null,
        source,
        tokens,
        diagnostics: [{
          code: "PARSER_INTERNAL_ERROR",
          message: "Wasm parser trace failed.",
          span: currentSpan(token),
        }],
      };
    }
    const expected = expectedTerminals(traced.state);
    const found = tokenDisplay(token);
    const code = expected.includes("EOF") && found !== "EOF"
      ? "PARSE_TRAILING_INPUT"
      : "PARSE_UNEXPECTED_TOKEN";
    return {
      ok: false,
      root: null,
      source,
      tokens,
      diagnostics: [{
        code,
        message: \`Unexpected token \${found}.\`,
        span: token.span,
        expected,
        found,
      }],
    };
  }

  return replayTrace(source, tokens, stream.tokens, traced.trace);
}

interface CompactTokenStream {
  tokens: readonly Token[];
  input: ParseTraceInput;
  terminalCount: number;
}

function compactTokenStream(
  source: string,
  tokens: readonly Token[],
): CompactTokenStream {
  const streamTokens: Token[] = new Array(tokens.length + 1);
  const terminalIds = new Int32Array(tokens.length + 1);
  let streamTokenCount = 0;
  let terminalCount = 0;
  let index = 0;
  while (true) {
    index = skipTrivia(tokens, index);
    const token = tokens[index] ?? eofToken(source.length);
    streamTokens[streamTokenCount] = token;
    streamTokenCount++;
    terminalIds[terminalCount] = tokenToTerminal(token);
    terminalCount++;
    if (token.type === "eof" || index >= tokens.length) break;
    index++;
  }
  streamTokens.length = streamTokenCount;
  const input = createParseTraceInput(terminalCount);
  input.terminals.set(terminalIds.subarray(0, terminalCount));
  return { tokens: streamTokens, input, terminalCount };
}

function replayTrace(
  source: string,
  tokens: readonly Token[],
  streamTokens: readonly Token[],
  trace: Int32Array,
): ParseResult<RootNode> {
  const values: unknown[] = [null];
  let index = 0;

  for (let traceIndex = 0; traceIndex < trace.length; traceIndex++) {
    const encoded = trace[traceIndex];
    const kind = encoded >>> 24;
    const payload = encoded & 0x00ffffff;

    if (kind === 1) {
      values.push(streamTokens[index] ?? eofToken(source.length));
      index++;
      continue;
    }

    if (kind === 3) {
      const accepted = values[values.length - 1];
      const root = isRuleNode(accepted)
        ? accepted as RootNode
        : isFragment(accepted) && isRuleNode(accepted.value)
        ? accepted.value as RootNode
        : null;
      if (root) {
        return {
          ok: true,
          root,
          source,
          tokens,
          diagnostics: [],
        };
      }
      return {
        ok: false,
        root: null,
        source,
        tokens,
        diagnostics: [{
          code: "PARSER_INTERNAL_ERROR",
          message: "Parser accepted without producing a root node.",
          span: { start: source.length, end: source.length },
        }],
      };
    }

    const token = streamTokens[index] ?? eofToken(source.length);
    if (kind !== 2) {
      return {
        ok: false,
        root: null,
        source,
        tokens,
        diagnostics: [{
          code: "PARSER_INTERNAL_ERROR",
          message: "Wasm parser trace contained an unknown action kind.",
          span: currentSpan(token),
        }],
      };
    }

    const production = PRODUCTIONS[payload];
    if (!production) {
      return {
        ok: false,
        root: null,
        source,
        tokens,
        diagnostics: [{
          code: "PARSER_INTERNAL_ERROR",
          message: "Wasm parser trace referenced an unknown production.",
          span: currentSpan(token),
        }],
      };
    }
    if (production.rhsLength > values.length - 1) {
      return {
        ok: false,
        root: null,
        source,
        tokens,
        diagnostics: [{
          code: "PARSER_INTERNAL_ERROR",
          message: "Wasm parser trace underflowed the replay stack.",
          span: currentSpan(token),
        }],
      };
    }
    const rhsValues = production.rhsLength === 0
      ? []
      : values.splice(values.length - production.rhsLength, production.rhsLength);
    let reduced: unknown;
    try {
      reduced = reduceProduction(
        production.reducer,
        rhsValues,
        token.span.start,
      );
    } catch (error) {
      return {
        ok: false,
        root: null,
        source,
        tokens,
        diagnostics: [internalParserDiagnostic(error, token.span)],
      };
    }
    values.push(reduced);
  }

  return {
    ok: false,
    root: null,
    source,
    tokens,
    diagnostics: [{
      code: "PARSER_INTERNAL_ERROR",
      message: "Wasm parser trace ended without accepting.",
      span: { start: source.length, end: source.length },
    }],
  };
}

${source.slice(end)}`;
}

function expectedTerminals(
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
