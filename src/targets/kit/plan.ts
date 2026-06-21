import type {
  BabaMetadata,
  Diagnostic,
  GeneratedFile,
  KitTargetOptions,
  PortabilityMode,
} from "../../ast.ts";
import type { AnalyzedGrammar } from "../../compiler/ir.ts";
import type { LookaheadBitset, LrAction } from "../typescript/lr1.ts";
import { collectRuleFieldSchemas } from "../typescript/syntax_emit.ts";
import {
  planRuntimeParserTarget,
  type RuntimeParserPlan,
  type RuntimeParserPlanningOptions,
} from "../runtime/plan.ts";
import type {
  ParserKit,
  ParserKitActionEntry,
  ParserKitGotoEntry,
  ParserKitLexerSpec,
  ParserKitLrAction,
} from "./schema.ts";

export interface KitPlan {
  analyzed: AnalyzedGrammar;
  runtime: RuntimeParserPlan;
  kit: ParserKit;
  directory: string;
  diagnostics: readonly Diagnostic[];
}

export function planKitTarget(
  analyzed: AnalyzedGrammar,
  options: KitTargetOptions = {},
  metadata: BabaMetadata = {},
  portability: PortabilityMode = "warn",
): KitPlan | { diagnostics: readonly Diagnostic[] } {
  const diagnostics = [...kitOptionsDiagnostics(options)];
  const runtimePlan = planRuntimeParserTarget(
    analyzed,
    runtimePlanningOptions(options),
    metadata,
    portability,
    { backend: "kit", codePrefix: "KIT", label: "kit" },
  );
  diagnostics.push(...runtimePlan.diagnostics);
  if (hasErrors(diagnostics) || !isRuntimePlan(runtimePlan)) {
    return { diagnostics };
  }
  const kit = createParserKit(
    analyzed,
    runtimePlan,
    options.preserveTrivia ?? true,
  );
  return {
    analyzed,
    runtime: runtimePlan,
    kit,
    directory: options.directory ?? "kit",
    diagnostics,
  };
}

export function emitKitTarget(plan: KitPlan): GeneratedFile[] {
  return [{
    path: `${plan.directory}/parser-kit.json`,
    content: `${JSON.stringify(plan.kit, null, 2)}\n`,
    kind: "config",
  }];
}

function createParserKit(
  analyzed: AnalyzedGrammar,
  runtime: RuntimeParserPlan,
  preserveTrivia: boolean,
): ParserKit {
  const fieldSchemas = collectRuleFieldSchemas(analyzed);
  const rootFieldSchema = fieldSchemas.find((schema) =>
    schema.ruleId === analyzed.rootRule
  );
  return {
    schemaVersion: 1,
    generator: "@mewhhaha/baba",
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
        pattern: token.pattern,
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
        span: production.span,
        origin: production.origin,
      })),
    },
    lr: {
      states: runtime.lr.states.map((state) => ({
        id: state.id,
        items: state.items.map((item) => ({
          production: item.production,
          dot: item.dot,
          lookaheads: lookaheadValues(item.lookaheads),
        })),
      })),
      actions: actionEntries(runtime.lr.actions),
      gotos: gotoEntries(runtime.lr.gotos),
      stats: runtime.lr.stats,
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
  return diagnostics;
}

function runtimePlanningOptions(
  options: KitTargetOptions,
): RuntimeParserPlanningOptions {
  return {
    lexerStateLimit: options.lexerStateLimit,
    parserStateLimit: options.parserStateLimit,
    parserItemLimit: options.parserItemLimit,
    parserTableEntryLimit: options.parserTableEntryLimit,
  };
}

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
