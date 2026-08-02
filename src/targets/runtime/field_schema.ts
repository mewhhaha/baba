import type { AnalyzedExpression, AnalyzedGrammar } from "../../compiler/ir.ts";

export interface RuleFieldInfo {
  name: string;
  type: string;
  array: boolean;
  nullable: boolean;
}

export interface RuleFieldSchema {
  ruleId: number;
  ruleName: string;
  nodeType: string;
  fields: readonly RuleFieldInfo[];
}

export interface RuntimeFieldSymbol {
  readonly id: number;
  readonly name: string;
}

interface Occurrence {
  min: number;
  max: number | null;
  types: Set<string>;
}

type OccurrenceMap = Map<string, Occurrence>;

export function collectRuleFieldSchemas(
  analyzed: AnalyzedGrammar,
): RuleFieldSchema[] {
  const nodeTypesByRuleId = collectNodeTypeNames(analyzed);
  return analyzed.rules
    .filter((rule) => analyzed.reachableRules.has(rule.id))
    .map((rule) => {
      const occurrences = collectFieldOccurrences(
        analyzed,
        rule.expression,
        nodeTypesByRuleId,
      );
      const fields = [...occurrences.entries()].map(([name, occurrence]) => {
        const type = unionType([...occurrence.types]);
        const array = occurrence.max === null || occurrence.max > 1;
        const nullable = !array && occurrence.min === 0;
        return {
          name,
          type: array
            ? readonlyArrayType(type)
            : nullable
            ? `${type} | null`
            : type,
          array,
          nullable,
        };
      }).sort((left, right) => left.name.localeCompare(right.name));
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        nodeType: nodeTypesByRuleId.get(rule.id) ?? nodeTypeName(rule.name),
        fields,
      };
    });
}

export function collectRuntimeFieldSymbols(
  analyzed: AnalyzedGrammar,
): RuntimeFieldSymbol[] {
  const fieldNames = new Set<string>();
  for (const rule of collectRuleFieldSchemas(analyzed)) {
    for (const field of rule.fields) {
      fieldNames.add(field.name);
    }
  }
  return [...fieldNames].sort().map((name, id) => ({ id, name }));
}

export function nodeTypeName(ruleName: string): string {
  const words = ruleName.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const base = (words.length ? words : [ruleName]).map((word) =>
    `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`
  ).join("");
  const safe = base.replace(/[^A-Za-z0-9_]/g, "") || "Rule";
  return `${/^[0-9]/.test(safe) ? "_" : ""}${safe}Node`;
}

function collectFieldOccurrences(
  analyzed: AnalyzedGrammar,
  expression: AnalyzedExpression,
  nodeTypesByRuleId: ReadonlyMap<number, string>,
): OccurrenceMap {
  switch (expression.kind) {
    case "field": {
      const inner = collectFieldOccurrences(
        analyzed,
        expression.expression,
        nodeTypesByRuleId,
      );
      addOccurrence(inner, expression.name, {
        min: 1,
        max: 1,
        types: new Set([
          expressionType(analyzed, expression.expression, nodeTypesByRuleId),
        ]),
      });
      return inner;
    }
    case "sequence":
      return combineSequence(
        expression.items.map((item) =>
          collectFieldOccurrences(analyzed, item, nodeTypesByRuleId)
        ),
      );
    case "choice":
      return combineChoice(
        expression.options.map((option) =>
          collectFieldOccurrences(analyzed, option, nodeTypesByRuleId)
        ),
      );
    case "optional":
      return scaleOptional(
        collectFieldOccurrences(
          analyzed,
          expression.expression,
          nodeTypesByRuleId,
        ),
      );
    case "repeat":
      return scaleRepeat(
        collectFieldOccurrences(
          analyzed,
          expression.expression,
          nodeTypesByRuleId,
        ),
        false,
      );
    case "repeat1":
      return scaleRepeat(
        collectFieldOccurrences(
          analyzed,
          expression.expression,
          nodeTypesByRuleId,
        ),
        true,
      );
    case "separated":
      return combineSequence([
        scaleRepeat(
          collectFieldOccurrences(analyzed, expression.item, nodeTypesByRuleId),
          true,
        ),
        scaleRepeat(
          collectFieldOccurrences(
            analyzed,
            expression.separator,
            nodeTypesByRuleId,
          ),
          false,
        ),
      ]);
    case "ref":
    case "literal":
      return new Map();
  }
}

function expressionType(
  analyzed: AnalyzedGrammar,
  expression: AnalyzedExpression,
  nodeTypesByRuleId: ReadonlyMap<number, string>,
): string {
  switch (expression.kind) {
    case "field":
      return expressionType(analyzed, expression.expression, nodeTypesByRuleId);
    case "ref":
      if (expression.reference.kind === "rule") {
        return nodeTypesByRuleId.get(expression.reference.ruleId) ??
          nodeTypeName(analyzed.rules[expression.reference.ruleId].name);
      }
      if (expression.reference.kind === "token") {
        return `NamedToken<${
          quote(analyzed.tokens[expression.reference.tokenId].name)
        }>`;
      }
      return "never";
    case "literal":
      return `LiteralToken<${quote(expression.value)}>`;
    case "sequence":
      return `readonly [${
        expression.items.map((item) =>
          expressionType(analyzed, item, nodeTypesByRuleId)
        ).join(", ")
      }]`;
    case "choice":
      return unionType(
        expression.options.map((option) =>
          expressionType(analyzed, option, nodeTypesByRuleId)
        ),
      );
    case "optional":
      return `${
        expressionType(analyzed, expression.expression, nodeTypesByRuleId)
      } | null`;
    case "repeat":
    case "repeat1":
      return readonlyArrayType(
        expressionType(analyzed, expression.expression, nodeTypesByRuleId),
      );
    case "separated":
      return readonlyArrayType(
        expressionType(analyzed, expression.item, nodeTypesByRuleId),
      );
  }
}

function collectNodeTypeNames(
  analyzed: AnalyzedGrammar,
): ReadonlyMap<number, string> {
  const used = new Map<string, number>();
  for (const reserved of reservedGeneratedTypeNames) {
    used.set(reserved, 1);
  }
  const result = new Map<number, string>();
  for (const rule of analyzed.rules) {
    if (!analyzed.reachableRules.has(rule.id)) continue;
    const base = nodeTypeName(rule.name);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    result.set(rule.id, count === 0 ? base : `${base}${count + 1}`);
  }
  return result;
}

const reservedGeneratedTypeNames = new Set([
  "Span",
  "Position",
  "SourceMap",
  "LexDiagnostic",
  "ParseDiagnostic",
  "MainTokenKind",
  "TriviaTokenKind",
  "NamedTokenKind",
  "AnyMainTokenKind",
  "AnyTriviaTokenKind",
  "LiteralKind",
  "MainNamedToken",
  "TriviaToken",
  "NamedToken",
  "LiteralToken",
  "ErrorToken",
  "EofToken",
  "Token",
  "RuleName",
  "RuleNodeBase",
  "AnyRuleNode",
  "RootNode",
  "SyntaxElement",
  "CursorFieldValue",
  "SyntaxCursor",
  "AnyRuleCursor",
  "RuleCursor",
  "RuleCursorBase",
  "TokenCursor",
  "RootCursor",
  "LexOptions",
  "TokenTape",
  "LexTapeResult",
  "LexResult",
  "ParseOptions",
  "ParseResult",
  "CursorParseResult",
  "ValidateParseResult",
]);

function combineSequence(maps: readonly OccurrenceMap[]): OccurrenceMap {
  const result: OccurrenceMap = new Map();
  for (const map of maps) {
    for (const [name, occurrence] of map) {
      const existing = result.get(name);
      if (!existing) {
        result.set(name, cloneOccurrence(occurrence));
        continue;
      }
      existing.min += occurrence.min;
      existing.max = existing.max === null || occurrence.max === null
        ? null
        : existing.max + occurrence.max;
      for (const type of occurrence.types) existing.types.add(type);
    }
  }
  return result;
}

function combineChoice(maps: readonly OccurrenceMap[]): OccurrenceMap {
  const result: OccurrenceMap = new Map();
  const names = new Set<string>();
  for (const map of maps) for (const name of map.keys()) names.add(name);
  for (const name of names) {
    let min = Number.POSITIVE_INFINITY;
    let max: number | null = 0;
    const types = new Set<string>();
    for (const map of maps) {
      const occurrence = map.get(name);
      min = Math.min(min, occurrence?.min ?? 0);
      if (occurrence?.max === null) {
        max = null;
      } else if (max !== null) {
        max = Math.max(max, occurrence?.max ?? 0);
      }
      for (const type of occurrence?.types ?? []) types.add(type);
    }
    result.set(name, { min, max, types });
  }
  return result;
}

function scaleOptional(map: OccurrenceMap): OccurrenceMap {
  const result: OccurrenceMap = new Map();
  for (const [name, occurrence] of map) {
    result.set(name, { ...cloneOccurrence(occurrence), min: 0 });
  }
  return result;
}

function scaleRepeat(map: OccurrenceMap, oneOrMore: boolean): OccurrenceMap {
  const result: OccurrenceMap = new Map();
  for (const [name, occurrence] of map) {
    result.set(name, {
      min: oneOrMore ? occurrence.min : 0,
      max: occurrence.max === 0 ? 0 : null,
      types: new Set(occurrence.types),
    });
  }
  return result;
}

function addOccurrence(
  map: OccurrenceMap,
  name: string,
  occurrence: Occurrence,
): void {
  const existing = map.get(name);
  if (!existing) {
    map.set(name, cloneOccurrence(occurrence));
    return;
  }
  existing.min += occurrence.min;
  existing.max = existing.max === null || occurrence.max === null
    ? null
    : existing.max + occurrence.max;
  for (const type of occurrence.types) existing.types.add(type);
}

function cloneOccurrence(occurrence: Occurrence): Occurrence {
  return {
    min: occurrence.min,
    max: occurrence.max,
    types: new Set(occurrence.types),
  };
}

function unionType(types: readonly string[]): string {
  const unique = [...new Set(types)].sort();
  if (unique.length === 0) return "never";
  return unique.join(" | ");
}

function readonlyArrayType(type: string): string {
  return `ReadonlyArray<${type}>`;
}

function quote(value: string): string {
  return JSON.stringify(value);
}
