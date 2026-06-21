import type { SourceSpan } from "../../ast.ts";
import type { AnalyzedGrammar } from "../../compiler/ir.ts";
import type { Dfa } from "../../compiler/regex/dfa.ts";
import type {
  BnfGrammar,
  BnfProduction,
  BnfSymbol,
  ReducerSpec,
} from "../typescript/bnf.ts";
import type { LrAction, LrTable } from "../typescript/lr1.ts";
import { collectRuleFieldSchemas } from "./field_schema.ts";

export interface PortableParserPlanV1 {
  readonly format: "baba-parser-plan";
  readonly version: 1;
  readonly semantics: "baba-portable-v1";
  readonly symbols: SymbolPlan;
  readonly lexer: LexerPlan;
  readonly parser: LrParserPlan;
  readonly cst: CstPlan;
}

export interface PortableParserPlanMetadata {
  readonly format: PortableParserPlanV1["format"];
  readonly version: PortableParserPlanV1["version"];
  readonly semantics: PortableParserPlanV1["semantics"];
  readonly hash: string;
}

export interface SymbolPlan {
  readonly grammarName: string;
  readonly rootRule: number;
  readonly rootRuleName: string;
  readonly tokens: readonly TokenPlan[];
  readonly literals: readonly LiteralPlan[];
  readonly terminals: readonly TerminalPlan[];
  readonly nonterminals: readonly NonterminalPlan[];
}

export interface TokenPlan {
  readonly id: number;
  readonly name: string;
  readonly kind: "token" | "skip";
  readonly channel: "main" | "trivia";
  readonly patternSource: string;
  readonly nullable: boolean;
  readonly priority: number;
  readonly declarationOrder: number;
  readonly reachable: boolean;
  readonly span: SourceSpan;
}

export interface LiteralPlan {
  readonly id: number;
  readonly value: string;
  readonly sourceOrder: number;
  readonly reachable: boolean;
  readonly span: SourceSpan;
}

export interface TerminalPlan {
  readonly id: number;
  readonly kind: "eof" | "named" | "literal";
  readonly key: string;
  readonly display: string;
  readonly tokenId?: number;
  readonly literalId?: number;
}

export interface NonterminalPlan {
  readonly id: number;
  readonly name: string;
  readonly ruleId?: number;
  readonly expressionId?: number;
}

export interface LexerPlan {
  readonly startState: number;
  readonly specifications: readonly LexerSpecificationPlan[];
  readonly states: readonly LexerStatePlan[];
}

export type LexerSpecificationPlan =
  | {
    readonly id: number;
    readonly type: "named";
    readonly tokenId: number;
    readonly priority: number;
    readonly order: number;
  }
  | {
    readonly id: number;
    readonly type: "literal";
    readonly literalId: number;
    readonly priority: number;
    readonly order: number;
  };

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

export interface LrParserPlan {
  readonly startState: number;
  readonly eofTerminal: number;
  readonly actions: readonly ActionRowPlan[];
  readonly gotos: readonly GotoRowPlan[];
  readonly productions: readonly ProductionPlan[];
}

export interface ActionRowPlan {
  readonly state: number;
  readonly entries: readonly ActionEntryPlan[];
}

export interface ActionEntryPlan {
  readonly terminal: number;
  readonly actions: readonly LrActionPlan[];
}

export type LrActionPlan =
  | { readonly kind: "shift"; readonly state: number }
  | { readonly kind: "reduce"; readonly production: number }
  | { readonly kind: "accept" };

export interface GotoRowPlan {
  readonly state: number;
  readonly entries: readonly GotoEntryPlan[];
}

export interface GotoEntryPlan {
  readonly nonterminal: number;
  readonly target: number;
}

export interface ProductionPlan {
  readonly id: number;
  readonly lhs: number;
  readonly rhs: readonly BnfSymbol[];
  readonly reducer: ReducerSpec;
  readonly span?: SourceSpan;
  readonly origin?: BnfProduction["origin"];
}

export interface CstPlan {
  readonly rootNodeType: string;
  readonly rules: readonly CstRulePlan[];
}

export interface CstRulePlan {
  readonly ruleId: number;
  readonly ruleName: string;
  readonly nodeType: string;
  readonly fields: readonly CstFieldPlan[];
}

export interface CstFieldPlan {
  readonly name: string;
  readonly type: string;
  readonly array: boolean;
  readonly nullable: boolean;
}

export function createPortableParserPlanV1(
  analyzed: AnalyzedGrammar,
  bnf: BnfGrammar,
  lr: LrTable,
  dfa: Dfa,
): PortableParserPlanV1 {
  const rootRule = analyzed.rules[analyzed.rootRule];
  const cstRules = collectRuleFieldSchemas(analyzed);
  const rootCstRule = cstRules.find((rule) =>
    rule.ruleId === analyzed.rootRule
  );
  return {
    format: "baba-parser-plan",
    version: 1,
    semantics: "baba-portable-v1",
    symbols: {
      grammarName: analyzed.name,
      rootRule: analyzed.rootRule,
      rootRuleName: rootRule?.name ?? "module",
      tokens: analyzed.tokens.map((token) => ({
        id: token.id,
        name: token.name,
        kind: token.kind,
        channel: token.kind === "skip" ? "trivia" : "main",
        patternSource: token.patternSource,
        nullable: token.nullable,
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
      terminals: bnf.terminals.map((terminal) => ({ ...terminal })),
      nonterminals: bnf.nonterminals.map((nonterminal) => ({
        ...nonterminal,
      })),
    },
    lexer: {
      startState: dfa.start,
      specifications: lexerSpecifications(analyzed),
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
    },
    parser: {
      startState: 0,
      eofTerminal: bnf.eofTerminal,
      actions: actionRows(lr.actions),
      gotos: gotoRows(lr.gotos),
      productions: bnf.productions.map(productionPlan),
    },
    cst: {
      rootNodeType: rootCstRule?.nodeType ?? "RuleNode",
      rules: cstRules.map((rule) => ({
        ruleId: rule.ruleId,
        ruleName: rule.ruleName,
        nodeType: rule.nodeType,
        fields: rule.fields.map((field) => ({ ...field })),
      })),
    },
  };
}

export function portableParserPlanMetadata(
  plan: PortableParserPlanV1,
): PortableParserPlanMetadata {
  return {
    format: plan.format,
    version: plan.version,
    semantics: plan.semantics,
    hash: hashPortableParserPlan(plan),
  };
}

function lexerSpecifications(
  analyzed: AnalyzedGrammar,
): LexerSpecificationPlan[] {
  const specs: LexerSpecificationPlan[] = [];
  for (const token of analyzed.tokens) {
    if (
      token.kind !== "skip" &&
      !(token.kind === "token" && analyzed.reachableTokens.has(token.id))
    ) {
      continue;
    }
    specs.push({
      id: specs.length,
      type: "named",
      tokenId: token.id,
      priority: token.priority,
      order: token.declarationOrder,
    });
  }
  for (const literal of analyzed.literals) {
    if (!analyzed.reachableLiterals.has(literal.id)) continue;
    specs.push({
      id: specs.length,
      type: "literal",
      literalId: literal.id,
      priority: 0,
      order: literal.sourceOrder,
    });
  }
  return specs;
}

function actionRows(
  table: LrTable["actions"],
): ActionRowPlan[] {
  return [...table.entries()]
    .sort(([left], [right]) => left - right)
    .map(([state, row]) => ({
      state,
      entries: [...row.entries()]
        .sort(([left], [right]) => left - right)
        .map(([terminal, actions]) => ({
          terminal,
          actions: actions.map(actionPlan).sort(compareActions),
        })),
    }));
}

function gotoRows(table: LrTable["gotos"]): GotoRowPlan[] {
  return [...table.entries()]
    .sort(([left], [right]) => left - right)
    .map(([state, row]) => ({
      state,
      entries: [...row.entries()]
        .sort(([left], [right]) => left - right)
        .map(([nonterminal, target]) => ({ nonterminal, target })),
    }));
}

function actionPlan(action: LrAction): LrActionPlan {
  if (action.kind === "shift") return { kind: "shift", state: action.state };
  if (action.kind === "reduce") {
    return { kind: "reduce", production: action.production };
  }
  return { kind: "accept" };
}

function productionPlan(production: BnfProduction): ProductionPlan {
  return {
    id: production.id,
    lhs: production.lhs,
    rhs: production.rhs.map((symbol) => ({ ...symbol })),
    reducer: { ...production.reducer },
    ...(production.span ? { span: production.span } : {}),
    ...(production.origin ? { origin: production.origin } : {}),
  };
}

function compareActions(left: LrActionPlan, right: LrActionPlan): number {
  const kindOrder = { shift: 0, reduce: 1, accept: 2 } as const;
  return kindOrder[left.kind] - kindOrder[right.kind] ||
    actionValue(left) - actionValue(right);
}

function actionValue(action: LrActionPlan): number {
  if (action.kind === "shift") return action.state;
  if (action.kind === "reduce") return action.production;
  return 0;
}

function hashPortableParserPlan(plan: PortableParserPlanV1): string {
  const bytes = new TextEncoder().encode(JSON.stringify(plan));
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}
