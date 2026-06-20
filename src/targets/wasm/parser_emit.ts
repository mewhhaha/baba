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
    `import { lex } from "./lexer.ts";
import { parserAction, parserGoto } from "./wasm.ts";`,
  );
  source = replaceTableConstants(source, expectedTerminals(bnf, lr));
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

function replaceLookupFunctions(source: string): string {
  const start = source.indexOf("function findAction(");
  const end = source.indexOf("function tokenToTerminal(", start);
  if (start === -1 || end === -1) {
    throw new Error("Could not locate generated parser lookup functions.");
  }
  return `${
    source.slice(0, start)
  }function findAction(state: number, terminal: number): RuntimeAction | null {
  const encoded = parserAction(state, terminal);
  if (encoded === 0) return null;
  const kind = encoded >>> 24;
  const payload = encoded & 0x00ffffff;
  if (kind === 1) return { kind: "shift", state: payload };
  if (kind === 2) return { kind: "reduce", production: payload };
  if (kind === 3) return { kind: "accept" };
  return null;
}

function findGoto(state: number, nonterminal: number): number | undefined {
  const target = parserGoto(state, nonterminal);
  return target < 0 ? undefined : target;
}

function expectedTerminals(state: number): readonly string[] {
  return EXPECTED_TERMINALS[state] ?? [];
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
