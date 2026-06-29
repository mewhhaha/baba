import type {
  BabaMetadata,
  Diagnostic,
  GeneratedFile,
  KitTargetOptions,
  PortabilityMode,
} from "../../ast.ts";
import type { AnalyzedGrammar } from "../../compiler/ir.ts";
import type { LookaheadBitset, LrAction } from "../typescript/lr1.ts";
import { collectRuleFieldSchemas } from "../runtime/field_schema.ts";
import {
  planRuntimeParserTarget,
  type RuntimeParserPlan,
  type RuntimeParserPlanningOptions,
} from "../runtime/plan.ts";
import { RUNTIME_IMPLEMENTATION_METADATA } from "../runtime/implementation.ts";
import { encodeCompactPlanBinary } from "../../runtime/compact_plan_binary.ts";
import type {
  ParserKit,
  ParserKitActionEntry,
  ParserKitGotoEntry,
  ParserKitLexerSpec,
  ParserKitLrAction,
  ParserKitProfile,
} from "./schema.ts";

export interface KitPlan {
  analyzed: AnalyzedGrammar;
  runtime: RuntimeParserPlan;
  portable: RuntimeParserPlan["portable"];
  kit: ParserKit;
  directory: string;
  diagnostics: readonly Diagnostic[];
}

export function planKitTarget(
  analyzed: AnalyzedGrammar,
  options: KitTargetOptions = {},
  metadata: BabaMetadata = {},
  portability: PortabilityMode = "warn",
  runtimePlanInput?: RuntimeParserPlan | { diagnostics: readonly Diagnostic[] },
): KitPlan | { diagnostics: readonly Diagnostic[] } {
  const diagnostics = [...kitOptionsDiagnostics(options)];
  const runtimePlan = runtimePlanInput ?? planRuntimeParserTarget(
    analyzed,
    runtimePlanningOptions(options),
    metadata,
    portability,
    { backend: "kit", codePrefix: "KIT", label: "kit" },
  );
  if (!runtimePlanInput) diagnostics.push(...runtimePlan.diagnostics);
  if (hasErrors(diagnostics) || !isRuntimePlan(runtimePlan)) {
    return { diagnostics };
  }
  const kit = createParserKit(
    analyzed,
    runtimePlan,
    options.preserveTrivia ?? true,
    options.profile ?? "full",
  );
  return {
    analyzed,
    runtime: runtimePlan,
    portable: runtimePlan.portable,
    kit,
    directory: options.directory ?? "kit",
    diagnostics,
  };
}

export function emitKitTarget(plan: KitPlan): GeneratedFile[] {
  const content = plan.kit.profile === "runtime"
    ? `${JSON.stringify(plan.kit)}\n`
    : `${JSON.stringify(plan.kit, null, 2)}\n`;
  return [
    {
      path: `${plan.directory}/parser-kit.json`,
      content,
      kind: "config",
      encoding: "utf-8",
    },
    {
      path: `${plan.directory}/parser-plan.bin`,
      content: encodeCompactPlanBinary(plan.kit),
      kind: "binary",
      encoding: "binary",
    },
  ];
}

export function createParserKit(
  analyzed: AnalyzedGrammar,
  runtime: RuntimeParserPlan,
  preserveTrivia: boolean,
  profile: ParserKitProfile,
): ParserKit {
  const fieldSchemas = collectRuleFieldSchemas(analyzed);
  const rootFieldSchema = fieldSchemas.find((schema) =>
    schema.ruleId === analyzed.rootRule
  );
  const includeDebugDetails = profile === "full";
  return {
    schemaVersion: 1,
    generator: "@mewhhaha/baba",
    profile,
    portablePlan: { ...runtime.portableMetadata },
    runtimeImplementation: {
      format: RUNTIME_IMPLEMENTATION_METADATA.format,
      version: RUNTIME_IMPLEMENTATION_METADATA.version,
      semantics: RUNTIME_IMPLEMENTATION_METADATA.semantics,
      hash: RUNTIME_IMPLEMENTATION_METADATA.hash,
    },
    grammar: {
      name: analyzed.name,
      rootRule: analyzed.rules[analyzed.rootRule]?.name ?? "module",
      rootRuleId: analyzed.rootRule,
      rootNodeType: rootFieldSchema?.nodeType ?? "RuleNode",
      rules: analyzed.rules.map((rule) => ({
        id: rule.id,
        name: rule.name,
        reachable: analyzed.reachableRules.has(rule.id),
        nodeType: fieldSchemas.find((schema) => schema.ruleId === rule.id)
          ?.nodeType,
        span: rule.span,
      })),
    },
    tokens: {
      named: analyzed.tokens.map((token) => ({
        id: token.id,
        name: token.name,
        kind: token.kind,
        channel: token.kind === "skip" ? "trivia" : "main",
        pattern: token.patternSource,
        priority: token.priority,
        declarationOrder: token.declarationOrder,
        reachable: token.kind === "skip" ||
          analyzed.reachableTokens.has(token.id),
        span: token.span,
      })),
      literals: analyzed.literals.map((literal) => ({
        id: literal.id,
        value: literal.value,
        sourceOrder: literal.sourceOrder,
        reachable: analyzed.reachableLiterals.has(literal.id),
        span: literal.span,
      })),
    },
    lexer: {
      defaultPreserveTrivia: preserveTrivia,
      specs: lexerSpecs(analyzed),
      dfa: {
        start: runtime.dfa.start,
        transitions: runtime.dfa.states.map((state) =>
          state.transitions.map((transition) => ({
            start: transition.start,
            end: transition.end,
            target: transition.target,
          }))
        ),
        accepts: runtime.dfa.states.map((state) => state.selectedAccept ?? -1),
        acceptCandidates: runtime.portable.lexer.states.map((state) =>
          orderAcceptCandidates(
            runtime.portable.lexer.specifications,
            state.accepts,
          )
        ),
      },
    },
    bnf: {
      startNonterminal: runtime.bnf.startNonterminal,
      rootRuleNonterminal: runtime.bnf.rootRuleNonterminal,
      eofTerminal: runtime.bnf.eofTerminal,
      terminals: runtime.bnf.terminals.map((terminal) => ({ ...terminal })),
      nonterminals: runtime.bnf.nonterminals.map((nonterminal) => ({
        ...nonterminal,
      })),
      productions: runtime.bnf.productions.map((production) => ({
        id: production.id,
        lhs: production.lhs,
        rhs: production.rhs.map((symbol) => ({ ...symbol })),
        reducer: { ...production.reducer },
        ...(includeDebugDetails && production.span
          ? { span: production.span }
          : {}),
        ...(includeDebugDetails && production.origin
          ? { origin: production.origin }
          : {}),
      })),
    },
    lr: {
      conflictProfile: hasBranchingActions(runtime.lr.actions)
        ? "branching"
        : "deterministic",
      states: runtime.lr.states.map((state) => ({
        id: state.id,
        items: includeDebugDetails
          ? state.items.map((item) => ({
            production: item.production,
            dot: item.dot,
            lookaheads: lookaheadValues(item.lookaheads),
          }))
          : [],
      })),
      actions: actionEntries(runtime.lr.actions),
      gotos: gotoEntries(runtime.lr.gotos),
      stats: includeDebugDetails ? runtime.lr.stats : {
        ...runtime.lr.stats,
        coreItems: 0,
        items: 0,
      },
    },
    fields: {
      rootNodeType: rootFieldSchema?.nodeType ?? "RuleNode",
      rules: fieldSchemas.map((schema) => ({
        ruleId: schema.ruleId,
        ruleName: schema.ruleName,
        nodeType: schema.nodeType,
        fields: schema.fields.map((field) => ({ ...field })),
      })),
    },
    displayNames: {
      terminals: runtime.bnf.terminals.map((terminal) => ({
        id: terminal.id,
        display: terminal.display,
      })),
      rules: analyzed.rules.map((rule) => ({
        id: rule.id,
        display: rule.name,
      })),
    },
  };
}

function orderAcceptCandidates(
  specs: RuntimeParserPlan["portable"]["lexer"]["specifications"],
  accepts: readonly number[],
): readonly number[] {
  return [...accepts].sort((left, right) => {
    const leftSpec = specs[left];
    const rightSpec = specs[right];
    if (!leftSpec || !rightSpec) return left - right;
    return rightSpec.priority - leftSpec.priority ||
      (leftSpec.literal === rightSpec.literal
        ? 0
        : leftSpec.literal
        ? -1
        : 1) ||
      leftSpec.order - rightSpec.order ||
      left - right;
  });
}

function lexerSpecs(analyzed: AnalyzedGrammar): ParserKitLexerSpec[] {
  return [
    ...analyzed.tokens
      .filter((token) =>
        token.kind === "skip" ||
        (token.kind === "token" && analyzed.reachableTokens.has(token.id))
      )
      .map((token) => ({
        type: "named" as const,
        tokenId: token.id,
      })),
    ...analyzed.literals
      .filter((literal) => analyzed.reachableLiterals.has(literal.id))
      .map((literal) => ({
        type: "literal" as const,
        literalId: literal.id,
      })),
  ];
}

function actionEntries(
  table: RuntimeParserPlan["lr"]["actions"],
): ParserKitActionEntry[] {
  const entries: ParserKitActionEntry[] = [];
  for (
    const [state, row] of [...table.entries()].sort(([left], [right]) =>
      left - right
    )
  ) {
    for (
      const [terminal, actions] of [...row.entries()].sort((
        [left],
        [right],
      ) => left - right)
    ) {
      entries.push({
        state,
        terminal,
        actions: actions.map(actionEntry).sort(compareActions),
      });
    }
  }
  return entries;
}

function hasBranchingActions(
  table: RuntimeParserPlan["lr"]["actions"],
): boolean {
  for (const row of table.values()) {
    for (const actions of row.values()) {
      if (actions.length > 1) return true;
    }
  }
  return false;
}

function actionEntry(action: LrAction): ParserKitLrAction {
  if (action.kind === "shift") return { kind: "shift", state: action.state };
  if (action.kind === "reduce") {
    return { kind: "reduce", production: action.production };
  }
  return { kind: "accept" };
}

function gotoEntries(
  table: RuntimeParserPlan["lr"]["gotos"],
): ParserKitGotoEntry[] {
  const entries: ParserKitGotoEntry[] = [];
  for (
    const [state, row] of [...table.entries()].sort(([left], [right]) =>
      left - right
    )
  ) {
    for (
      const [nonterminal, target] of [...row.entries()].sort((
        [left],
        [right],
      ) => left - right)
    ) {
      entries.push({ state, nonterminal, target });
    }
  }
  return entries;
}

function lookaheadValues(bitset: LookaheadBitset): number[] {
  const values: number[] = [];
  for (let wordIndex = 0; wordIndex < bitset.words.length; wordIndex++) {
    const word = bitset.words[wordIndex] ?? 0;
    for (let bit = 0; bit < 32; bit++) {
      if ((word & (1 << bit)) !== 0) values.push(wordIndex * 32 + bit);
    }
  }
  return values;
}

function compareActions(
  left: ParserKitLrAction,
  right: ParserKitLrAction,
): number {
  const leftRank = actionRank(left);
  const rightRank = actionRank(right);
  if (leftRank !== rightRank) return leftRank - rightRank;
  if (left.kind === "shift" && right.kind === "shift") {
    return left.state - right.state;
  }
  if (left.kind === "reduce" && right.kind === "reduce") {
    return left.production - right.production;
  }
  return 0;
}

function actionRank(action: ParserKitLrAction): number {
  if (action.kind === "shift") return 0;
  if (action.kind === "reduce") return 1;
  return 2;
}

function kitOptionsDiagnostics(options: KitTargetOptions): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const directory = options.directory ?? "kit";
  if (!isSafeRelativeDirectory(directory)) {
    diagnostics.push({
      code: "KIT_GENERATION_ERROR",
      severity: "error",
      backend: "kit",
      message:
        `Invalid kit output directory '${directory}'. Use a relative directory without '.', '..', empty components, absolute paths, drive prefixes, or backslashes.`,
    });
  }
  if (
    options.profile !== undefined &&
    options.profile !== "full" &&
    options.profile !== "runtime"
  ) {
    diagnostics.push({
      code: "KIT_GENERATION_ERROR",
      severity: "error",
      backend: "kit",
      message: `Invalid kit profile '${
        String(options.profile)
      }'. Use 'full' or 'runtime'.`,
    });
  }
  return diagnostics;
}

function runtimePlanningOptions(
  options: KitTargetOptions,
): RuntimeParserPlanningOptions {
  return {
    lexerStateLimit: options.lexerStateLimit,
    regexSourceLengthLimit: options.regexSourceLengthLimit,
    regexNestingLimit: options.regexNestingLimit,
    regexAstNodeLimit: options.regexAstNodeLimit,
    regexBoundedRepeatLimit: options.regexBoundedRepeatLimit,
    regexNfaStateLimit: options.regexNfaStateLimit,
    regexDfaStateLimit: options.regexDfaStateLimit,
    regexOverlapStateLimit: options.regexOverlapStateLimit,
    regexOverlapPairLimit: options.regexOverlapPairLimit,
    grammarExpressionDepthLimit: options.grammarExpressionDepthLimit,
    parserStateLimit: options.parserStateLimit,
    parserItemLimit: options.parserItemLimit,
    lrClosureWorkLimit: options.lrClosureWorkLimit,
    parserTableEntryLimit: options.parserTableEntryLimit,
    diagnosticLimit: options.diagnosticLimit,
  };
}

export { runtimePlanningOptions as kitRuntimePlanningOptions };

function isSafeRelativeDirectory(directory: string): boolean {
  if (
    directory.length === 0 ||
    directory.includes("\0") ||
    directory.includes("\\") ||
    directory.startsWith("/") ||
    /^[A-Za-z]:/.test(directory)
  ) {
    return false;
  }
  return directory.split("/").every((component) =>
    component !== "" && component !== "." && component !== ".."
  );
}

function isRuntimePlan(
  value: RuntimeParserPlan | { diagnostics: readonly Diagnostic[] },
): value is RuntimeParserPlan {
  return "bnf" in value;
}

function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) =>
    (diagnostic.severity ?? "error") === "error"
  );
}
