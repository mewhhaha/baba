import type { TypeScriptTargetOptions } from "../../ast.ts";
import type { AnalyzedGrammar } from "../../compiler/ir.ts";
import type { Dfa } from "../../compiler/regex/dfa.ts";
import type { RegexAst } from "../../compiler/regex/ast.ts";
import { buildLexerDfa } from "../../compiler/regex/lexer.ts";
import { emitTypeScriptLexerRuntime } from "../runtime/typescript_lexer_runtime.ts";
import type { BnfGrammar } from "./bnf.ts";

export function emitLexer(
  analyzed: AnalyzedGrammar,
  bnf: BnfGrammar,
  options: TypeScriptTargetOptions = {},
  plannedDfa?: Dfa,
): string {
  const namedTerminals = new Map(
    bnf.terminals
      .filter((terminal) => terminal.kind === "named")
      .map((terminal) => [terminal.tokenId, terminal.id]),
  );
  const literalTerminals = new Map(
    bnf.terminals
      .filter((terminal) => terminal.kind === "literal")
      .map((terminal) => [terminal.literalId, terminal.id]),
  );
  const namedTokens = analyzed.tokens
    .filter((token) =>
      token.kind === "skip" ||
      (token.kind === "token" && analyzed.reachableTokens.has(token.id))
    );
  const namedSpecs = namedTokens
    .map((token) => ({
      kind: token.name,
      pattern: token.patternSource,
      channel: token.kind === "skip" ? "trivia" as const : "main" as const,
      terminal: token.kind === "skip" ? -1 : namedTerminals.get(token.id) ?? -1,
      priority: token.priority,
      order: token.declarationOrder,
    }));
  const literalSpecs = analyzed.literals
    .filter((literal) => analyzed.reachableLiterals.has(literal.id))
    .map((literal) => ({
      literal: literal.value,
      terminal: literalTerminals.get(literal.id) ?? -1,
      priority: 0,
      order: literal.sourceOrder,
    }));
  const lexerSpecs = [
    ...namedTokens.map((token) => ({
      ast: token.pattern,
      type: "named" as const,
      priority: token.priority,
      order: token.declarationOrder,
    })),
    ...literalSpecs.map((spec) => ({
      ast: literalAst(spec.literal),
      type: "literal" as const,
      priority: spec.priority,
      order: spec.order,
    })),
  ];
  const dfa = plannedDfa ?? buildLexerDfa(lexerSpecs);
  const transitions = dfa.states.map((state) =>
    state.transitions.map((transition) =>
      [
        transition.start,
        transition.end,
        transition.target,
      ] as const
    )
  );
  const asciiTransitions = buildAsciiTransitionRows(dfa);
  const accepts = dfa.states.map((state) => state.selectedAccept ?? -1);
  const preserveTrivia = options.preserveTrivia ?? true;

  return emitTypeScriptLexerRuntime({
    preserveTrivia,
    namedSpecs,
    literalSpecs,
    transitions,
    asciiTransitions,
    accepts,
  });
}

function literalAst(value: string): RegexAst {
  const items: RegexAst[] = [];
  for (let index = 0; index < value.length;) {
    const codePoint = value.codePointAt(index)!;
    items.push({ kind: "literal", codePoint });
    index += codePoint > 0xffff ? 2 : 1;
  }
  if (items.length === 0) return { kind: "empty" };
  return items.length === 1 ? items[0] : { kind: "sequence", items };
}

function buildAsciiTransitionRows(dfa: Dfa): number[][] | null {
  const cellCount = dfa.states.length * 128;
  if (cellCount > 65_536) return null;
  return dfa.states.map((state) => {
    const row = new Array(128).fill(-1);
    for (const transition of state.transitions) {
      const start = Math.max(0, transition.start);
      const end = Math.min(127, transition.end);
      for (let codePoint = start; codePoint <= end; codePoint++) {
        row[codePoint] = transition.target;
      }
    }
    return row;
  });
}
