import type { TypeScriptTargetOptions } from "../../ast.ts";
import type { Dfa } from "../../compiler/regex/dfa.ts";
import { emitTypeScriptLexerRuntime } from "../runtime/typescript_lexer_runtime.ts";
import { portablePlanToDfa } from "../runtime/portable_plan.ts";
import type { PortableParserPlanV1 } from "../runtime/portable_plan.ts";

export function emitLexerFromPortablePlan(
  plan: PortableParserPlanV1,
  options: TypeScriptTargetOptions = {},
): string {
  const namedSpecs = plan.lexer.specifications
    .filter((spec) => spec.type === "named")
    .map((spec) => {
      const token = plan.symbols.tokens[spec.tokenId];
      return {
        kind: token?.name ?? `token_${spec.tokenId}`,
        pattern: token?.patternSource ?? "",
        channel: spec.channel,
        terminal: spec.terminalId ?? -1,
        priority: spec.priority,
        order: spec.order,
      };
    });
  const literalSpecs = plan.lexer.specifications
    .filter((spec) => spec.type === "literal")
    .map((spec) => {
      const literal = plan.symbols.literals[spec.literalId];
      return {
        literal: literal?.value ?? "",
        terminal: spec.terminalId,
        priority: spec.priority,
        order: spec.order,
      };
    });
  const dfa = portablePlanToDfa(plan);
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
  const lexerSpecs = plan.lexer.specifications.map((spec) => ({
    type: spec.literal ? "literal" as const : "named" as const,
    priority: spec.priority,
    order: spec.order,
  }));
  const acceptCandidates = dfa.states.map((state) =>
    orderAcceptCandidates(lexerSpecs, state.accepts)
  );
  const preserveTrivia = options.preserveTrivia ?? true;

  return emitTypeScriptLexerRuntime({
    preserveTrivia,
    namedSpecs,
    literalSpecs,
    transitions,
    asciiTransitions,
    accepts,
    acceptCandidates,
    parserPlanVersion: plan.version,
    parserPlanSemantics: plan.semantics,
  });
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

function orderAcceptCandidates(
  specs: readonly {
    readonly type: "named" | "literal";
    readonly priority: number;
    readonly order: number;
  }[],
  accepts: readonly number[],
): readonly number[] {
  return [...accepts].sort((left, right) => {
    const leftSpec = specs[left];
    const rightSpec = specs[right];
    if (!leftSpec || !rightSpec) return left - right;
    return rightSpec.priority - leftSpec.priority ||
      (leftSpec.type === rightSpec.type
        ? 0
        : leftSpec.type === "literal"
        ? -1
        : 1) ||
      leftSpec.order - rightSpec.order ||
      left - right;
  });
}
