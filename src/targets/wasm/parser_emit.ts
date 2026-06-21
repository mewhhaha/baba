import type { AnalyzedGrammar } from "../../compiler/ir.ts";
import type { BnfGrammar } from "../typescript/bnf.ts";
import type { LrTable } from "../typescript/lr1.ts";
import { emitParser } from "../typescript/parser_emit.ts";

export function emitWasmParser(
  analyzed: AnalyzedGrammar,
  bnf: BnfGrammar,
  lr: LrTable,
): string {
  return emitParser(analyzed, bnf, lr, { mode: "wasm" });
}
