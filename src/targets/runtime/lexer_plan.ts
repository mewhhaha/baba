import type { AnalyzedGrammar } from "../../compiler/ir.ts";
import type { Dfa } from "../../compiler/regex/dfa.ts";
import type { BnfGrammar } from "../../compiler/runtime_plan/bnf.ts";

const RUNTIME_UNICODE_SEMANTICS = "unicode-code-point-v1";

export interface LexerPlan {
  readonly unicodeSemantics: "unicode-code-point-v1";
  readonly startState: number;
  readonly specifications: readonly LexerSpecificationPlan[];
  readonly states: readonly LexerStatePlan[];
}

export type LexerSpecificationPlan =
  | {
    readonly id: number;
    readonly type: "named";
    readonly tokenId: number;
    readonly terminalId: number | null;
    readonly channel: "main" | "trivia";
    readonly priority: number;
    readonly order: number;
    readonly literal: false;
    readonly contextual: boolean;
    readonly trailingContext: ContextualTrailingContextPlan | undefined;
  }
  | {
    readonly id: number;
    readonly type: "literal";
    readonly literalId: number;
    readonly terminalId: number;
    readonly channel: "main";
    readonly priority: number;
    readonly order: number;
    readonly literal: true;
    readonly contextual: false;
    readonly trailingContext: undefined;
  };

export interface ContextualTrailingContextPlan {
  readonly followedBy: Dfa | undefined;
  readonly followedByEof: boolean;
  readonly notFollowedBy: Dfa | undefined;
  readonly excludedWords: readonly string[];
}

export interface LexerStatePlan {
  readonly id: number;
  readonly transitions: readonly LexerTransitionPlan[];
  readonly accepts: readonly number[];
  readonly selectedAccept: number | null;
}

export interface LexerTransitionPlan {
  readonly start: number;
  readonly end: number;
  readonly target: number;
}

export function createRuntimeLexerPlan(
  analyzed: AnalyzedGrammar,
  bnf: BnfGrammar,
  dfa: Dfa,
  trailingContextByTokenId: ReadonlyMap<
    number,
    ContextualTrailingContextPlan
  > = new Map(),
): LexerPlan {
  return {
    unicodeSemantics: RUNTIME_UNICODE_SEMANTICS,
    startState: dfa.start,
    specifications: lexerSpecifications(
      analyzed,
      bnf,
      trailingContextByTokenId,
    ),
    states: dfa.states.map((state) => ({
      id: state.id,
      transitions: state.transitions.map((transition) => ({
        start: transition.start,
        end: transition.end,
        target: transition.target,
      })),
      accepts: [...state.accepts],
      selectedAccept: state.selectedAccept,
    })),
  };
}

function lexerSpecifications(
  analyzed: AnalyzedGrammar,
  bnf: BnfGrammar,
  trailingContextByTokenId: ReadonlyMap<
    number,
    ContextualTrailingContextPlan
  >,
): LexerSpecificationPlan[] {
  const specifications: LexerSpecificationPlan[] = [];
  for (const token of analyzed.tokens) {
    if (
      token.kind !== "skip" &&
      !analyzed.reachableTokens.has(token.id)
    ) {
      continue;
    }
    let trailingContext: ContextualTrailingContextPlan | undefined;
    if (token.trailingContext !== undefined) {
      trailingContext = trailingContextByTokenId.get(token.id);
      if (trailingContext === undefined) {
        throw new Error(
          `Missing compiled trailing context for token '${token.name}' (${token.id}).`,
        );
      }
    }
    let terminalId: number | null = null;
    let channel: "main" | "trivia" = "trivia";
    if (token.kind !== "skip") {
      terminalId = terminalIdForToken(bnf, token.id);
      channel = "main";
    }
    specifications.push({
      id: specifications.length,
      type: "named",
      tokenId: token.id,
      terminalId,
      channel,
      priority: token.priority,
      order: token.declarationOrder,
      literal: false,
      contextual: token.kind === "contextual",
      trailingContext,
    });
  }
  for (const literal of analyzed.literals) {
    if (!analyzed.reachableLiterals.has(literal.id)) continue;
    specifications.push({
      id: specifications.length,
      type: "literal",
      literalId: literal.id,
      terminalId: terminalIdForLiteral(bnf, literal.id),
      channel: "main",
      priority: 0,
      order: literal.sourceOrder,
      literal: true,
      contextual: false,
      trailingContext: undefined,
    });
  }
  return specifications;
}

function terminalIdForToken(
  bnf: BnfGrammar,
  tokenId: number,
): number | null {
  const terminal = bnf.terminals.find((candidate) =>
    candidate.kind === "named" && candidate.tokenId === tokenId
  );
  if (terminal === undefined) return null;
  return terminal.id;
}

function terminalIdForLiteral(bnf: BnfGrammar, literalId: number): number {
  const terminal = bnf.terminals.find((candidate) =>
    candidate.kind === "literal" && candidate.literalId === literalId
  );
  if (terminal === undefined) {
    throw new Error(`No terminal found for literal ${literalId}.`);
  }
  return terminal.id;
}
