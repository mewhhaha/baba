import type {
  Diagnostic,
  GpuFrontendBoundaryMetadata,
  GpuFrontendMetadata,
  SourceSpan,
} from "../ast.ts";
import type {
  AnalyzedExpression,
  AnalyzedGrammar,
  AnalyzedRule,
  RuleId,
} from "./ir.ts";
import {
  computeNullableRules,
  isExpressionNullable,
} from "./analyzed_grammar.ts";
import type {
  PortableParserPlan,
  TerminalPlan,
} from "../targets/runtime/portable_plan.ts";

export const GPU_FRONTEND_FORMAT = "baba-gpu-frontend" as const;
export const GPU_FRONTEND_PLAN_VERSION = 3 as const;
export const GPU_FRONTEND_SEMANTICS = "baba-gpu-frontend-v3" as const;

const DEFAULT_MAX_LEXER_STATES = 50_000;
const DEFAULT_MAX_ISLAND_STATES = 20_000;
const DEFAULT_MAX_ISLAND_TRANSITIONS = 100_000;
const DEFAULT_MAX_SEMANTIC_OPCODES = 4_096;
const DEFAULT_MAX_PLAN_BYTES = 16 * 1024 * 1024;
const MAX_CONTRACTION_ROUNDS = 33;
// Two 256-chunk summary tables, entry states, and scan storage fit the
// WebGPU-guaranteed 16 KiB workgroup-storage limit at seven states.
const MAX_PARALLEL_CHUNK_STATES = 7;

const SEMANTIC_OPCODE_CATALOG = new Set([
  "module",
  "scope",
  "signature",
  "binding",
  "assignment",
  "shadow",
  "define",
  "reference",
  "pattern",
  "lambda",
  "apply",
  "fold-fixity",
  "tuple",
  "array",
  "spread",
  "shape",
  "union",
  "range",
  "interface",
  "associated-type",
  "effect",
  "case",
  "comptime",
  "primitive",
  "integer-bounds",
  "repeat-limit",
  "cycle",
]);

export interface GpuFrontendPlan {
  readonly format: typeof GPU_FRONTEND_FORMAT;
  readonly version: typeof GPU_FRONTEND_PLAN_VERSION;
  readonly semantics: typeof GPU_FRONTEND_SEMANTICS;
  readonly throughput: "general" | "strict";
  readonly rootIsland: number;
  readonly terminalClassification: readonly number[];
  readonly boundaries: readonly GpuFrontendBoundaryPlan[];
  readonly execution: GpuFrontendExecutionPlan;
  readonly islands: readonly GpuIslandTransducerPlan[];
  readonly semanticRecipes: readonly GpuSemanticRecipePlan[];
  readonly primitives: readonly GpuSemanticMappingPlan[];
  readonly operators: readonly GpuSemanticMappingPlan[];
  readonly scopes: readonly number[];
  readonly namespaces: readonly string[];
  readonly binders: readonly number[];
  readonly references: readonly number[];
  readonly patterns: readonly number[];
  readonly typeEntries: readonly number[];
  readonly capacity: GpuFrontendCapacityPlan;
  readonly statistics: GpuFrontendStatistics;
}

export type GpuFrontendBoundaryPlan =
  | { readonly kind: "root" }
  | {
    readonly kind: "paired";
    readonly openTerminal: number;
    readonly closeTerminal: number;
  }
  | { readonly kind: "terminated"; readonly terminal: number }
  | {
    readonly kind: "separated";
    readonly openTerminal: number;
    readonly closeTerminal: number;
    readonly separatorTerminal: number;
  };

export interface GpuIslandTransducerPlan {
  readonly id: number;
  readonly ruleId: number;
  readonly ruleName: string;
  readonly startState: number;
  readonly states: readonly GpuIslandStatePlan[];
}

export interface GpuIslandStatePlan {
  readonly id: number;
  readonly accepting: boolean;
  readonly transitions: readonly GpuIslandTransitionPlan[];
}

export interface GpuIslandTransitionPlan {
  readonly inputKind: "terminal" | "island";
  readonly input: number;
  readonly target: number;
  readonly emit: GpuIslandEmitPlan;
}

export interface GpuIslandEmitPlan {
  readonly kind: "token" | "placeholder";
  readonly field: number;
}

export interface GpuFrontendExecutionPlan {
  readonly locators: readonly GpuFrontendLocatorPlan[];
  readonly rootAnchors: readonly GpuFrontendRootAnchorPlan[];
  readonly rootLoop: GpuFrontendRootLoopPlan | null;
  readonly longRegions: readonly GpuFrontendLongRegionPlan[];
  readonly denseTransitions: GpuFrontendDenseTransitionPlan;
  readonly contractions: readonly GpuFrontendContractionPlan[];
  readonly bounds: GpuFrontendExecutionBoundsPlan;
}

export interface GpuFrontendRootLoopPlan {
  readonly island: number;
  readonly state: number;
}

export interface GpuFrontendLongRegionPlan {
  readonly island: number;
  readonly stateCount: number;
}

export interface GpuFrontendLocatorPlan {
  readonly island: number;
  readonly startTerminals: readonly number[];
  readonly boundary: GpuFrontendBoundaryPlan;
}

export interface GpuFrontendRootAnchorPlan {
  readonly island: number;
  readonly startTerminals: readonly number[];
  readonly priority: number;
}

export interface GpuFrontendDenseTransitionPlan {
  readonly terminalSymbols: number;
  readonly symbols: number;
  readonly rows: number;
  readonly targets: readonly number[];
  readonly fields: readonly number[];
  readonly kinds: readonly number[];
}

export interface GpuFrontendContractionPlan {
  readonly island: number;
  readonly placeholderPriority: readonly number[];
}

export interface GpuFrontendExecutionBoundsPlan {
  readonly regionsPerToken: number;
  readonly candidatesPerToken: number;
  readonly summariesPerCandidate: number;
  readonly nodesPerToken: number;
  readonly edgesPerToken: number;
  readonly diagnosticsPerToken: number;
}

export interface GpuSemanticRecipePlan {
  readonly ruleId: number;
  readonly opcode: string;
  readonly fields: readonly GpuSemanticFieldPlan[];
}

export interface GpuSemanticFieldPlan extends GpuSemanticMappingPlan {
  readonly field: number;
}

export interface GpuSemanticMappingPlan {
  readonly source: string;
  readonly target: string;
}

export interface GpuFrontendCapacityPlan {
  readonly nodesPerToken: number;
  readonly edgesPerToken: number;
  readonly constraintsPerNode: number;
}

export interface GpuFrontendStatistics {
  readonly lexerStates: number;
  readonly islandStates: number;
  readonly islandTransitions: number;
  readonly semanticOpcodes: number;
  readonly maxNodesPerToken: number;
  readonly maxEdgesPerToken: number;
  readonly maxConstraintsPerNode: number;
  readonly locatorCount: number;
  readonly denseTransitionBytes: number;
  readonly maxCandidateMultiplicity: number;
  readonly contractionRounds: number;
  readonly regionScratchPerToken: number;
  readonly candidateScratchPerToken: number;
  readonly summaryScratchPerToken: number;
  readonly nodeScratchPerToken: number;
  readonly edgeScratchPerToken: number;
  readonly diagnosticScratchPerToken: number;
  readonly packedBytes: number;
}

interface NfaTransition {
  readonly from: number;
  readonly to: number;
  readonly inputKind: "terminal" | "island" | "epsilon";
  readonly input: number;
  readonly emit: GpuIslandEmitPlan | null;
}

interface NfaFragment {
  readonly start: number;
  readonly end: number;
}

interface IslandCompilationContext {
  readonly analyzed: AnalyzedGrammar;
  readonly portable: PortableParserPlan;
  readonly islandByRule: ReadonlyMap<RuleId, number>;
  readonly fieldIds: ReadonlyMap<string, number>;
  readonly nullableRules: ReadonlySet<RuleId>;
  readonly diagnostics: Diagnostic[];
  readonly transitions: NfaTransition[];
  readonly currentIsland: number;
  readonly selfPlaceholderAllowed: boolean;
  nextState: number;
}

export function compileGpuFrontendPlan(
  analyzed: AnalyzedGrammar,
  portable: PortableParserPlan,
  metadata: GpuFrontendMetadata,
): GpuFrontendPlan | { readonly diagnostics: readonly Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const ruleByName = new Map(analyzed.rules.map((rule) => [rule.name, rule]));
  const rootRule = ruleByName.get(metadata.root);
  if (rootRule === undefined) {
    diagnostics.push(metadataDiagnostic(
      "GPU_FRONTEND_UNKNOWN_ROOT",
      `GPU frontend root rule '${metadata.root}' does not exist.`,
      "metadata.gpuFrontend.root",
    ));
  } else if (rootRule.id !== analyzed.rootRule) {
    diagnostics.push(metadataDiagnostic(
      "GPU_FRONTEND_ROOT_MISMATCH",
      `GPU frontend root rule '${metadata.root}' does not match parser root rule '${
        analyzed.rules[analyzed.rootRule].name
      }'.`,
      "metadata.gpuFrontend.root",
    ));
  }
  if (metadata.islands.length === 0) {
    diagnostics.push(metadataDiagnostic(
      "GPU_FRONTEND_NO_ISLANDS",
      "GPU frontend metadata must declare at least one island.",
      "metadata.gpuFrontend.islands",
    ));
  }

  const islandRules: AnalyzedRule[] = [];
  const islandByRule = new Map<RuleId, number>();
  for (let index = 0; index < metadata.islands.length; index += 1) {
    const islandMetadata = metadata.islands[index];
    const rule = ruleByName.get(islandMetadata.rule);
    if (rule === undefined) {
      diagnostics.push(metadataDiagnostic(
        "GPU_FRONTEND_UNKNOWN_ISLAND",
        `GPU frontend island rule '${islandMetadata.rule}' does not exist.`,
        `metadata.gpuFrontend.islands[${index}].rule`,
      ));
      continue;
    }
    if (islandByRule.has(rule.id)) {
      diagnostics.push(metadataDiagnostic(
        "GPU_FRONTEND_DUPLICATE_ISLAND",
        `GPU frontend island rule '${islandMetadata.rule}' is declared more than once.`,
        `metadata.gpuFrontend.islands[${index}].rule`,
      ));
      continue;
    }
    islandByRule.set(rule.id, index);
    islandRules[index] = rule;
  }
  if (rootRule !== undefined && islandByRule.get(rootRule.id) !== 0) {
    diagnostics.push(metadataDiagnostic(
      "GPU_FRONTEND_ROOT_ISLAND_ORDER",
      `GPU frontend root rule '${metadata.root}' must be the first island.`,
      "metadata.gpuFrontend.islands",
    ));
  }

  for (const token of analyzed.tokens) {
    if (token.kind === "contextual" || token.trailingContext !== undefined) {
      diagnostics.push({
        code: "GPU_FRONTEND_CONTEXTUAL_TERMINAL",
        severity: "error",
        backend: "webgpu",
        message:
          `Token '${token.name}' has contextual lexer behavior, so its terminal identity is not parser-state independent.`,
        span: token.span,
      });
    }
  }
  for (const row of portable.parser.actions) {
    for (const entry of row.entries) {
      if (entry.actions.length > 1) {
        diagnostics.push({
          code: "GPU_FRONTEND_PARSER_CONFLICT",
          severity: "error",
          backend: "webgpu",
          message:
            `Parser state ${row.state} has ${entry.actions.length} actions for terminal ${entry.terminal}; GPU islands require resolved deterministic syntax.`,
        });
      }
    }
  }

  const terminalClassification = portable.lexer.specifications.map((spec) => {
    if (spec.terminalId === null) {
      return -1;
    }
    return spec.terminalId;
  });
  for (const state of portable.lexer.states) {
    if (state.accepts.length === 0) {
      continue;
    }
    if (
      state.selectedAccept === null ||
      terminalClassification[state.selectedAccept] === undefined
    ) {
      diagnostics.push({
        code: "GPU_FRONTEND_CONTEXTUAL_TERMINAL",
        severity: "error",
        backend: "webgpu",
        message:
          `Lexer state ${state.id} has no compiler-proven terminal identity.`,
      });
    }
  }

  const boundaries: GpuFrontendBoundaryPlan[] = [];
  for (let index = 0; index < metadata.islands.length; index += 1) {
    const boundary = compileBoundary(
      metadata.islands[index].boundary,
      portable.symbols.terminals,
      diagnostics,
      `metadata.gpuFrontend.islands[${index}].boundary`,
    );
    if (boundary !== undefined) {
      boundaries[index] = boundary;
    }
  }

  validateSemanticMetadata(metadata, analyzed, ruleByName, diagnostics);
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { diagnostics };
  }
  const limits = metadata.limits;
  let maxLexerStates = DEFAULT_MAX_LEXER_STATES;
  let maxIslandStates = DEFAULT_MAX_ISLAND_STATES;
  let maxIslandTransitions = DEFAULT_MAX_ISLAND_TRANSITIONS;
  let maxSemanticOpcodes = DEFAULT_MAX_SEMANTIC_OPCODES;
  let maxPlanBytes = DEFAULT_MAX_PLAN_BYTES;
  let contractionRounds = MAX_CONTRACTION_ROUNDS;
  if (limits?.maxLexerStates !== undefined) {
    maxLexerStates = limits.maxLexerStates;
  }
  if (limits?.maxIslandStates !== undefined) {
    maxIslandStates = limits.maxIslandStates;
  }
  if (limits?.maxIslandTransitions !== undefined) {
    maxIslandTransitions = limits.maxIslandTransitions;
  }
  if (limits?.maxSemanticOpcodes !== undefined) {
    maxSemanticOpcodes = limits.maxSemanticOpcodes;
  }
  if (limits?.maxPlanBytes !== undefined) {
    maxPlanBytes = limits.maxPlanBytes;
  }
  if (limits?.maxContractionRounds !== undefined) {
    contractionRounds = limits.maxContractionRounds;
  }
  if (contractionRounds > MAX_CONTRACTION_ROUNDS) {
    diagnostics.push(limitDiagnostic(
      "GPU_FRONTEND_CONTRACTION_ROUND_LIMIT",
      "contraction rounds",
      contractionRounds,
      MAX_CONTRACTION_ROUNDS,
    ));
  }
  if (portable.lexer.states.length > maxLexerStates) {
    diagnostics.push(limitDiagnostic(
      "GPU_FRONTEND_LEXER_STATE_LIMIT",
      "lexer states",
      portable.lexer.states.length,
      maxLexerStates,
    ));
  }

  const fieldIds = new Map(
    portable.symbols.fields.map((field) => [field.name, field.id]),
  );
  const islands: GpuIslandTransducerPlan[] = [];
  for (let index = 0; index < islandRules.length; index += 1) {
    const rule = islandRules[index];
    if (rule === undefined) {
      continue;
    }
    const transducer = compileIsland(
      index,
      rule,
      analyzed,
      portable,
      islandByRule,
      fieldIds,
      diagnostics,
      metadata.islands[index].boundary.kind !== "root",
    );
    if (transducer !== undefined) {
      islands[index] = transducer;
    }
  }

  const semanticRecipes: GpuSemanticRecipePlan[] = [];
  for (const [ruleName, recipe] of Object.entries(metadata.semantics.rules)) {
    const rule = ruleByName.get(ruleName);
    if (rule === undefined) {
      continue;
    }
    semanticRecipes.push({
      ruleId: rule.id,
      opcode: recipe.opcode,
      fields: sortedSemanticFields(recipe.fields, fieldIds),
    });
  }
  const semanticOpcodes = semanticRecipes.length;
  if (semanticOpcodes > maxSemanticOpcodes) {
    diagnostics.push(limitDiagnostic(
      "GPU_FRONTEND_SEMANTIC_OPCODE_LIMIT",
      "semantic opcodes",
      semanticOpcodes,
      maxSemanticOpcodes,
    ));
  }
  const islandStates = islands.reduce(
    (total, island) => total + island.states.length,
    0,
  );
  const islandTransitions = islands.reduce(
    (total, island) =>
      total +
      island.states.reduce(
        (stateTotal, state) => stateTotal + state.transitions.length,
        0,
      ),
    0,
  );
  if (islandStates > maxIslandStates) {
    diagnostics.push(limitDiagnostic(
      "GPU_FRONTEND_ISLAND_STATE_LIMIT",
      "island states",
      islandStates,
      maxIslandStates,
    ));
  }
  if (islandTransitions > maxIslandTransitions) {
    diagnostics.push(limitDiagnostic(
      "GPU_FRONTEND_ISLAND_TRANSITION_LIMIT",
      "island transitions",
      islandTransitions,
      maxIslandTransitions,
    ));
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { diagnostics };
  }

  const nodesPerToken = 1;
  const edgesPerToken = 2;
  const constraintsPerNode = semanticRecipes.reduce(
    (maximum, recipe) => Math.max(maximum, recipe.fields.length + 1),
    1,
  );
  for (
    const [subject, actual, limit] of [
      ["nodes per token", nodesPerToken, limits?.maxNodesPerToken],
      ["edges per token", edgesPerToken, limits?.maxEdgesPerToken],
      [
        "constraints per node",
        constraintsPerNode,
        limits?.maxConstraintsPerNode,
      ],
    ] as const
  ) {
    if (limit !== undefined && actual > limit) {
      diagnostics.push(limitDiagnostic(
        "GPU_FRONTEND_OUTPUT_BOUND_LIMIT",
        subject,
        actual,
        limit,
      ));
    }
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { diagnostics };
  }
  const capacity: GpuFrontendCapacityPlan = {
    nodesPerToken,
    edgesPerToken,
    constraintsPerNode,
  };
  let throughput: "general" | "strict" = "general";
  if (metadata.throughput === "strict") {
    throughput = "strict";
  }
  const execution = compileExecutionPlan(
    islands,
    boundaries,
    portable.symbols.terminals,
    capacity,
    throughput,
    diagnostics,
  );
  if (execution === undefined) {
    return { diagnostics };
  }
  let namespaces: readonly string[] = [];
  if (metadata.semantics.namespaces !== undefined) {
    namespaces = metadata.semantics.namespaces;
  }
  const planWithoutStatistics = {
    format: GPU_FRONTEND_FORMAT,
    version: GPU_FRONTEND_PLAN_VERSION,
    semantics: GPU_FRONTEND_SEMANTICS,
    throughput,
    rootIsland: 0,
    terminalClassification,
    boundaries,
    execution,
    islands,
    semanticRecipes,
    primitives: sortedMappings(metadata.semantics.primitives),
    operators: sortedMappings(metadata.semantics.operators),
    scopes: ruleIds(metadata.semantics.scopes, ruleByName),
    namespaces,
    binders: ruleIds(metadata.semantics.binders, ruleByName),
    references: ruleIds(metadata.semantics.references, ruleByName),
    patterns: ruleIds(metadata.semantics.patterns, ruleByName),
    typeEntries: ruleIds(metadata.semantics.typeEntries, ruleByName),
    capacity,
  };
  const packedBytes = new TextEncoder().encode(
    JSON.stringify(planWithoutStatistics),
  ).length;
  if (packedBytes > maxPlanBytes) {
    return {
      diagnostics: [limitDiagnostic(
        "GPU_FRONTEND_PLAN_BYTE_LIMIT",
        "plan bytes",
        packedBytes,
        maxPlanBytes,
      )],
    };
  }
  return {
    ...planWithoutStatistics,
    statistics: {
      lexerStates: portable.lexer.states.length,
      islandStates,
      islandTransitions,
      semanticOpcodes,
      maxNodesPerToken: nodesPerToken,
      maxEdgesPerToken: edgesPerToken,
      maxConstraintsPerNode: constraintsPerNode,
      locatorCount: execution.locators.length,
      denseTransitionBytes: execution.denseTransitions.targets.length *
        Uint32Array.BYTES_PER_ELEMENT *
        3,
      maxCandidateMultiplicity: execution.bounds.candidatesPerToken,
      contractionRounds,
      regionScratchPerToken: execution.bounds.regionsPerToken,
      candidateScratchPerToken: execution.bounds.candidatesPerToken,
      summaryScratchPerToken: execution.bounds.summariesPerCandidate,
      nodeScratchPerToken: execution.bounds.nodesPerToken,
      edgeScratchPerToken: execution.bounds.edgesPerToken,
      diagnosticScratchPerToken: execution.bounds.diagnosticsPerToken,
      packedBytes,
    },
  };
}

function compileExecutionPlan(
  islands: readonly GpuIslandTransducerPlan[],
  boundaries: readonly GpuFrontendBoundaryPlan[],
  terminals: readonly TerminalPlan[],
  capacity: GpuFrontendCapacityPlan,
  throughput: "general" | "strict",
  diagnostics: Diagnostic[],
): GpuFrontendExecutionPlan | undefined {
  const closerByOpener = new Map<number, number>();
  const closerTerminals = new Set<number>();
  for (const boundary of boundaries) {
    if (boundary.kind !== "paired" && boundary.kind !== "separated") {
      continue;
    }
    const knownCloser = closerByOpener.get(boundary.openTerminal);
    if (
      knownCloser !== undefined &&
      knownCloser !== boundary.closeTerminal
    ) {
      diagnostics.push({
        code: "GPU_FRONTEND_AMBIGUOUS_STRUCTURAL_TERMINAL",
        severity: "error",
        backend: "webgpu",
        message:
          `GPU frontend opener terminal ${boundary.openTerminal} requires both closer ${knownCloser} and closer ${boundary.closeTerminal}.`,
      });
    }
    closerByOpener.set(boundary.openTerminal, boundary.closeTerminal);
    closerTerminals.add(boundary.closeTerminal);
  }
  for (const opener of closerByOpener.keys()) {
    if (closerTerminals.has(opener)) {
      diagnostics.push({
        code: "GPU_FRONTEND_AMBIGUOUS_STRUCTURAL_TERMINAL",
        severity: "error",
        backend: "webgpu",
        message:
          `GPU frontend terminal ${opener} is both a structural opener and closer.`,
      });
    }
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return undefined;
  }

  const firstTerminals = new Map<number, readonly number[]>();
  const resolving = new Set<number>();

  const resolveFirstTerminals = (island: number): readonly number[] => {
    const cached = firstTerminals.get(island);
    if (cached !== undefined) {
      return cached;
    }
    if (resolving.has(island)) {
      return [];
    }
    resolving.add(island);
    const transducer = islands[island];
    if (transducer === undefined) {
      throw new Error(`GPU frontend plan has no island ${island}.`);
    }
    const start = transducer.states[transducer.startState];
    if (start === undefined) {
      throw new Error(
        `GPU frontend island ${island} has no start state ${transducer.startState}.`,
      );
    }
    const found = new Set<number>();
    for (const transition of start.transitions) {
      if (transition.inputKind === "terminal") {
        found.add(transition.input);
        continue;
      }
      for (const terminal of resolveFirstTerminals(transition.input)) {
        found.add(terminal);
      }
    }
    resolving.delete(island);
    const ordered = [...found].sort((left, right) => left - right);
    firstTerminals.set(island, ordered);
    return ordered;
  };

  const locators: GpuFrontendLocatorPlan[] = [];
  for (const island of islands) {
    const startTerminals = resolveFirstTerminals(island.id);
    if (startTerminals.length === 0) {
      diagnostics.push({
        code: "GPU_FRONTEND_NON_LOCATABLE_ISLAND",
        severity: "error",
        backend: "webgpu",
        message:
          `GPU frontend island '${island.ruleName}' has no compiler-proven lexical start terminal.`,
      });
      continue;
    }
    const boundary = boundaries[island.id];
    if (boundary === undefined) {
      throw new Error(
        `GPU frontend island '${island.ruleName}' has no boundary ${island.id}.`,
      );
    }
    locators.push({ island: island.id, startTerminals, boundary });
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return undefined;
  }

  const root = islands[0];
  if (root === undefined) {
    throw new Error("GPU frontend plan has no root island.");
  }
  const rootPlaceholders: number[] = [];
  const seenRootPlaceholders = new Set<number>();
  for (const state of root.states) {
    for (const transition of state.transitions) {
      if (
        transition.inputKind === "island" &&
        !seenRootPlaceholders.has(transition.input)
      ) {
        seenRootPlaceholders.add(transition.input);
        rootPlaceholders.push(transition.input);
      }
    }
  }
  const rootAnchors = rootPlaceholders.map((island, priority) => {
    const startTerminals = firstTerminals.get(island);
    if (startTerminals === undefined) {
      throw new Error(
        `GPU frontend root placeholder ${island} has no boundary locator.`,
      );
    }
    return { island, startTerminals, priority };
  });
  const rootLoops = root.states.flatMap((state) =>
    state.transitions.filter((transition) =>
      transition.inputKind === "island" && transition.target === state.id
    ).map((transition) => ({
      island: transition.input,
      state: state.id,
    }))
  );
  let rootLoop: GpuFrontendRootLoopPlan | null = null;
  if (rootLoops.length === 1) {
    rootLoop = rootLoops[0];
  }
  if (throughput === "strict" && rootLoop === null) {
    diagnostics.push({
      code: "GPU_FRONTEND_STRICT_ROOT_LOOP",
      severity: "error",
      backend: "webgpu",
      message:
        `GPU frontend strict throughput requires exactly one repeated root island; '${root.ruleName}' has ${rootLoops.length}.`,
    });
  }
  if (throughput === "strict" && rootLoop !== null) {
    const loopBoundary = boundaries[rootLoop.island];
    if (loopBoundary === undefined) {
      throw new Error(
        `GPU frontend root loop island ${rootLoop.island} has no boundary.`,
      );
    }
    if (loopBoundary.kind === "root") {
      diagnostics.push({
        code: "GPU_FRONTEND_STRICT_ROOT_BOUNDARY",
        severity: "error",
        backend: "webgpu",
        message: `GPU frontend strict root loop island '${
          islands[rootLoop.island].ruleName
        }' requires an explicit paired, separated, or terminated boundary.`,
      });
    }
    const loopIsland = islands[rootLoop.island];
    const selfNesting = loopIsland.states.some((state) =>
      state.transitions.some((transition) =>
        transition.inputKind === "island" &&
        transition.input === rootLoop.island
      )
    );
    if (selfNesting) {
      diagnostics.push({
        code: "GPU_FRONTEND_STRICT_SELF_NESTING",
        severity: "error",
        backend: "webgpu",
        message:
          `GPU frontend strict root loop island '${loopIsland.ruleName}' cannot contain itself as a nested placeholder.`,
      });
    }
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return undefined;
  }
  const longRegions = islands.filter((island) => {
    if (island.states.length > MAX_PARALLEL_CHUNK_STATES) {
      return false;
    }
    return !island.states.some((state) =>
      state.transitions.some((transition) => transition.inputKind === "island")
    );
  }).map((island) => ({
    island: island.id,
    stateCount: island.states.length,
  }));

  let terminalSymbols = 0;
  for (const terminal of terminals) {
    terminalSymbols = Math.max(terminalSymbols, terminal.id + 1);
  }
  const symbols = terminalSymbols + islands.length;
  const rows = islands.reduce(
    (total, island) => total + island.states.length,
    0,
  );
  const targets = new Array<number>(rows * symbols).fill(-1);
  const fields = new Array<number>(rows * symbols).fill(-1);
  const kinds = new Array<number>(rows * symbols).fill(0);
  const contractions: GpuFrontendContractionPlan[] = [];
  let rowOffset = 0;
  for (const island of islands) {
    const placeholderPriority: number[] = [];
    const seenPlaceholders = new Set<number>();
    for (const state of island.states) {
      for (const transition of state.transitions) {
        let symbol = transition.input;
        let kind = 1;
        if (transition.inputKind === "island") {
          symbol = terminalSymbols + transition.input;
          kind = 2;
          if (!seenPlaceholders.has(transition.input)) {
            seenPlaceholders.add(transition.input);
            placeholderPriority.push(transition.input);
          }
        }
        const index = (rowOffset + state.id) * symbols + symbol;
        if (targets[index] !== -1) {
          throw new Error(
            `GPU frontend dense row ${
              rowOffset + state.id
            } has duplicate symbol ${symbol}.`,
          );
        }
        targets[index] = transition.target;
        fields[index] = transition.emit.field;
        kinds[index] = kind;
      }
    }
    contractions.push({ island: island.id, placeholderPriority });
    rowOffset += island.states.length;
  }

  const multiplicityByTerminal = new Map<number, number>();
  for (const locator of locators) {
    for (const terminal of locator.startTerminals) {
      const current = multiplicityByTerminal.get(terminal);
      if (current === undefined) {
        multiplicityByTerminal.set(terminal, 1);
      } else {
        multiplicityByTerminal.set(terminal, current + 1);
      }
    }
  }
  let candidatesPerToken = 1;
  for (const multiplicity of multiplicityByTerminal.values()) {
    candidatesPerToken = Math.max(candidatesPerToken, multiplicity);
  }
  const summariesPerCandidate = islands.reduce(
    (maximum, island) => Math.max(maximum, island.states.length),
    1,
  );
  return {
    locators,
    rootAnchors,
    rootLoop,
    longRegions,
    denseTransitions: {
      terminalSymbols,
      symbols,
      rows,
      targets,
      fields,
      kinds,
    },
    contractions,
    bounds: {
      regionsPerToken: candidatesPerToken,
      candidatesPerToken,
      summariesPerCandidate,
      nodesPerToken: capacity.nodesPerToken,
      edgesPerToken: capacity.edgesPerToken,
      diagnosticsPerToken: 1,
    },
  };
}

function compileBoundary(
  boundary: GpuFrontendBoundaryMetadata,
  terminals: readonly TerminalPlan[],
  diagnostics: Diagnostic[],
  path: string,
): GpuFrontendBoundaryPlan | undefined {
  if (boundary.kind === "root") {
    return { kind: "root" };
  }
  if (boundary.kind === "terminated") {
    const terminal = resolveBoundaryTerminal(
      boundary.terminal,
      terminals,
      diagnostics,
      `${path}.terminal`,
    );
    if (terminal === undefined) {
      return undefined;
    }
    return { kind: "terminated", terminal };
  }
  const openTerminal = resolveBoundaryTerminal(
    boundary.open,
    terminals,
    diagnostics,
    `${path}.open`,
  );
  const closeTerminal = resolveBoundaryTerminal(
    boundary.close,
    terminals,
    diagnostics,
    `${path}.close`,
  );
  if (openTerminal === undefined || closeTerminal === undefined) {
    return undefined;
  }
  if (openTerminal === closeTerminal) {
    diagnostics.push(metadataDiagnostic(
      "GPU_FRONTEND_MALFORMED_BOUNDARY",
      `GPU frontend ${boundary.kind} boundary uses terminal '${boundary.open}' as both opener and closer.`,
      path,
    ));
  }
  if (boundary.kind === "paired") {
    return { kind: "paired", openTerminal, closeTerminal };
  }
  const separatorTerminal = resolveBoundaryTerminal(
    boundary.separator,
    terminals,
    diagnostics,
    `${path}.separator`,
  );
  if (separatorTerminal === undefined) {
    return undefined;
  }
  if (
    separatorTerminal === openTerminal ||
    separatorTerminal === closeTerminal
  ) {
    diagnostics.push(metadataDiagnostic(
      "GPU_FRONTEND_MALFORMED_BOUNDARY",
      `GPU frontend separator '${boundary.separator}' must differ from its opening and closing terminals.`,
      path,
    ));
  }
  return {
    kind: "separated",
    openTerminal,
    closeTerminal,
    separatorTerminal,
  };
}

function resolveBoundaryTerminal(
  name: string,
  terminals: readonly TerminalPlan[],
  diagnostics: Diagnostic[],
  path: string,
): number | undefined {
  const matches = terminals.filter((terminal) => {
    if (terminal.kind === "eof") {
      return name === "$EOF";
    }
    return terminal.display === name ||
      terminal.display === JSON.stringify(name) ||
      terminal.key === name;
  });
  if (matches.length !== 1) {
    diagnostics.push(metadataDiagnostic(
      "GPU_FRONTEND_BOUNDARY_TERMINAL",
      `GPU frontend boundary '${name}' resolves to ${matches.length} terminals; exactly one lexically unique terminal is required.`,
      path,
    ));
    return undefined;
  }
  return matches[0].id;
}

function validateSemanticMetadata(
  metadata: GpuFrontendMetadata,
  analyzed: AnalyzedGrammar,
  ruleByName: ReadonlyMap<string, AnalyzedRule>,
  diagnostics: Diagnostic[],
): void {
  for (const [ruleName, recipe] of Object.entries(metadata.semantics.rules)) {
    const rule = ruleByName.get(ruleName);
    if (rule === undefined) {
      diagnostics.push(metadataDiagnostic(
        "GPU_FRONTEND_INVALID_SEMANTIC_RULE",
        `GPU frontend semantic recipe refers to unknown rule '${ruleName}'.`,
        `metadata.gpuFrontend.semantics.rules.${ruleName}`,
      ));
      continue;
    }
    if (!SEMANTIC_OPCODE_CATALOG.has(recipe.opcode)) {
      diagnostics.push(metadataDiagnostic(
        "GPU_FRONTEND_INVALID_SEMANTIC_OPCODE",
        `GPU frontend semantic opcode '${recipe.opcode}' is not in the shared opcode catalog.`,
        `metadata.gpuFrontend.semantics.rules.${ruleName}.opcode`,
      ));
    }
    const fields = new Set<string>();
    collectFields(rule.expression, fields);
    let recipeFields: Readonly<Record<string, string>> = {};
    if (recipe.fields !== undefined) {
      recipeFields = recipe.fields;
    }
    for (const fieldName of Object.keys(recipeFields)) {
      if (!fields.has(fieldName)) {
        diagnostics.push(metadataDiagnostic(
          "GPU_FRONTEND_INVALID_SEMANTIC_FIELD",
          `GPU frontend semantic recipe for rule '${ruleName}' refers to unknown field '${fieldName}'.`,
          `metadata.gpuFrontend.semantics.rules.${ruleName}.fields.${fieldName}`,
        ));
      }
    }
  }
  for (
    const [key, ruleNames] of [
      ["scopes", metadata.semantics.scopes],
      ["binders", metadata.semantics.binders],
      ["references", metadata.semantics.references],
      ["patterns", metadata.semantics.patterns],
      ["typeEntries", metadata.semantics.typeEntries],
    ] as const
  ) {
    if (ruleNames === undefined) {
      continue;
    }
    for (const ruleName of ruleNames) {
      if (!ruleByName.has(ruleName)) {
        diagnostics.push(metadataDiagnostic(
          "GPU_FRONTEND_INVALID_SEMANTIC_RULE",
          `GPU frontend semantic ${key} entry refers to unknown rule '${ruleName}'.`,
          `metadata.gpuFrontend.semantics.${key}`,
        ));
      }
    }
  }
  void analyzed;
}

function compileIsland(
  id: number,
  rule: AnalyzedRule,
  analyzed: AnalyzedGrammar,
  portable: PortableParserPlan,
  islandByRule: ReadonlyMap<RuleId, number>,
  fieldIds: ReadonlyMap<string, number>,
  diagnostics: Diagnostic[],
  selfPlaceholderAllowed: boolean,
): GpuIslandTransducerPlan | undefined {
  const context: IslandCompilationContext = {
    analyzed,
    portable,
    islandByRule,
    fieldIds,
    nullableRules: computeNullableRules(analyzed),
    diagnostics,
    transitions: [],
    currentIsland: id,
    selfPlaceholderAllowed,
    nextState: 0,
  };
  const fragment = compileExpression(
    rule.expression,
    context,
    new Set([rule.id]),
    -1,
  );
  if (fragment === undefined) {
    return undefined;
  }
  return determinizeIsland(id, rule, fragment, context);
}

function compileExpression(
  expression: AnalyzedExpression,
  context: IslandCompilationContext,
  activeRules: ReadonlySet<RuleId>,
  inheritedField: number,
): NfaFragment | undefined {
  if (expression.kind === "field") {
    const field = context.fieldIds.get(expression.name);
    if (field === undefined) {
      context.diagnostics.push({
        code: "GPU_FRONTEND_INVALID_FIELD",
        severity: "error",
        backend: "webgpu",
        message: `GPU frontend cannot resolve field '${expression.name}'.`,
        span: expression.span,
      });
      return undefined;
    }
    return compileExpression(
      expression.expression,
      context,
      activeRules,
      field,
    );
  }
  if (expression.kind === "literal") {
    const terminal = context.portable.symbols.terminals.find((candidate) =>
      candidate.kind === "literal" &&
      candidate.literalId === expression.literalId
    );
    return terminalFragment(
      terminal,
      context,
      inheritedField,
      expression.span,
    );
  }
  if (expression.kind === "ref") {
    if (
      expression.reference.kind === "token" ||
      expression.reference.kind === "skip"
    ) {
      const tokenId = expression.reference.tokenId;
      const terminal = context.portable.symbols.terminals.find((candidate) =>
        candidate.kind === "named" &&
        candidate.tokenId === tokenId
      );
      return terminalFragment(
        terminal,
        context,
        inheritedField,
        expression.span,
      );
    }
    if (expression.reference.kind !== "rule") {
      context.diagnostics.push({
        code: "GPU_FRONTEND_UNKNOWN_REFERENCE",
        severity: "error",
        backend: "webgpu",
        message:
          `GPU frontend island contains unresolved reference '${expression.name}'.`,
        span: expression.span,
      });
      return undefined;
    }
    const nestedIsland = context.islandByRule.get(expression.reference.ruleId);
    if (
      nestedIsland === context.currentIsland &&
      context.selfPlaceholderAllowed
    ) {
      const start = context.nextState++;
      const end = context.nextState++;
      context.transitions.push({
        from: start,
        to: end,
        inputKind: "island",
        input: nestedIsland,
        emit: { kind: "placeholder", field: inheritedField },
      });
      return { start, end };
    }
    if (activeRules.has(expression.reference.ruleId)) {
      const referenced = context.analyzed.rules[expression.reference.ruleId];
      context.diagnostics.push({
        code: "GPU_FRONTEND_RESIDUAL_RECURSION",
        severity: "error",
        backend: "webgpu",
        message:
          `GPU frontend island retains recursive reference to rule '${referenced.name}' after nested islands are replaced with placeholders.`,
        span: expression.span,
      });
      return undefined;
    }
    if (nestedIsland !== undefined) {
      const start = context.nextState++;
      const end = context.nextState++;
      context.transitions.push({
        from: start,
        to: end,
        inputKind: "island",
        input: nestedIsland,
        emit: { kind: "placeholder", field: inheritedField },
      });
      return { start, end };
    }
    const nextActiveRules = new Set(activeRules);
    nextActiveRules.add(expression.reference.ruleId);
    return compileExpression(
      context.analyzed.rules[expression.reference.ruleId].expression,
      context,
      nextActiveRules,
      inheritedField,
    );
  }
  if (expression.kind === "sequence") {
    const start = context.nextState++;
    let previous = start;
    for (const child of expression.items) {
      const fragment = compileExpression(
        child,
        context,
        activeRules,
        inheritedField,
      );
      if (fragment === undefined) {
        return undefined;
      }
      epsilon(context, previous, fragment.start);
      previous = fragment.end;
    }
    const end = context.nextState++;
    epsilon(context, previous, end);
    return { start, end };
  }
  if (expression.kind === "choice") {
    const start = context.nextState++;
    const end = context.nextState++;
    for (const option of expression.options) {
      const fragment = compileExpression(
        option,
        context,
        activeRules,
        inheritedField,
      );
      if (fragment === undefined) {
        return undefined;
      }
      epsilon(context, start, fragment.start);
      epsilon(context, fragment.end, end);
    }
    return { start, end };
  }
  if (expression.kind === "optional") {
    const start = context.nextState++;
    const end = context.nextState++;
    const fragment = compileExpression(
      expression.expression,
      context,
      activeRules,
      inheritedField,
    );
    if (fragment === undefined) {
      return undefined;
    }
    epsilon(context, start, end);
    epsilon(context, start, fragment.start);
    epsilon(context, fragment.end, end);
    return { start, end };
  }
  if (expression.kind === "repeat" || expression.kind === "repeat1") {
    if (isExpressionNullable(expression.expression, context.nullableRules)) {
      context.diagnostics.push({
        code: "GPU_FRONTEND_ZERO_WIDTH_OUTPUT_CYCLE",
        severity: "error",
        backend: "webgpu",
        message:
          `GPU frontend island repetition in rule expression ${expression.id} can cycle without consuming a terminal.`,
        span: expression.span,
      });
      return undefined;
    }
    const start = context.nextState++;
    const end = context.nextState++;
    const fragment = compileExpression(
      expression.expression,
      context,
      activeRules,
      inheritedField,
    );
    if (fragment === undefined) {
      return undefined;
    }
    if (expression.kind === "repeat") {
      epsilon(context, start, end);
    }
    epsilon(context, start, fragment.start);
    epsilon(context, fragment.end, fragment.start);
    epsilon(context, fragment.end, end);
    return { start, end };
  }
  const start = context.nextState++;
  const end = context.nextState++;
  const item = compileExpression(
    expression.item,
    context,
    activeRules,
    inheritedField,
  );
  const separator = compileExpression(
    expression.separator,
    context,
    activeRules,
    inheritedField,
  );
  if (item === undefined || separator === undefined) {
    return undefined;
  }
  epsilon(context, start, item.start);
  epsilon(context, item.end, end);
  epsilon(context, item.end, separator.start);
  epsilon(context, separator.end, item.start);
  return { start, end };
}

function terminalFragment(
  terminal: TerminalPlan | undefined,
  context: IslandCompilationContext,
  field: number,
  span: SourceSpan,
): NfaFragment | undefined {
  if (terminal === undefined) {
    context.diagnostics.push({
      code: "GPU_FRONTEND_TERMINAL_IDENTITY",
      severity: "error",
      backend: "webgpu",
      message: "GPU frontend grammar symbol has no runtime terminal identity.",
      span,
    });
    return undefined;
  }
  const start = context.nextState++;
  const end = context.nextState++;
  context.transitions.push({
    from: start,
    to: end,
    inputKind: "terminal",
    input: terminal.id,
    emit: { kind: "token", field },
  });
  return { start, end };
}

function epsilon(
  context: IslandCompilationContext,
  from: number,
  to: number,
): void {
  context.transitions.push({
    from,
    to,
    inputKind: "epsilon",
    input: -1,
    emit: null,
  });
}

function determinizeIsland(
  id: number,
  rule: AnalyzedRule,
  fragment: NfaFragment,
  context: IslandCompilationContext,
): GpuIslandTransducerPlan | undefined {
  const closure = (seed: ReadonlySet<number>): Set<number> => {
    const states = new Set(seed);
    const work = [...states];
    while (work.length > 0) {
      const state = work.pop();
      if (state === undefined) {
        break;
      }
      for (const transition of context.transitions) {
        if (
          transition.from === state &&
          transition.inputKind === "epsilon" &&
          !states.has(transition.to)
        ) {
          states.add(transition.to);
          work.push(transition.to);
        }
      }
    }
    return states;
  };
  const stateKey = (states: ReadonlySet<number>): string =>
    [...states].sort((left, right) => left - right).join(",");
  const initial = closure(new Set([fragment.start]));
  const sets: Set<number>[] = [initial];
  const ids = new Map([[stateKey(initial), 0]]);
  const states: GpuIslandStatePlan[] = [];
  for (let stateId = 0; stateId < sets.length; stateId += 1) {
    const nfaStates = sets[stateId];
    const outgoing = new Map<string, NfaTransition[]>();
    for (const transition of context.transitions) {
      if (
        transition.inputKind === "epsilon" ||
        !nfaStates.has(transition.from)
      ) {
        continue;
      }
      const key = `${transition.inputKind}:${transition.input}`;
      const candidates = outgoing.get(key);
      if (candidates === undefined) {
        outgoing.set(key, [transition]);
      } else {
        candidates.push(transition);
      }
    }
    const transitions: GpuIslandTransitionPlan[] = [];
    for (const [key, candidates] of [...outgoing].sort()) {
      const first = candidates[0];
      const firstEmit = JSON.stringify(first.emit);
      if (
        candidates.some((candidate) =>
          JSON.stringify(candidate.emit) !== firstEmit
        )
      ) {
        context.diagnostics.push({
          code: "GPU_FRONTEND_NONDETERMINISTIC_ISLAND",
          severity: "error",
          backend: "webgpu",
          message:
            `GPU frontend island rule '${rule.name}' has ambiguous output for input ${key}.`,
          span: rule.span,
        });
        return undefined;
      }
      const targets = closure(
        new Set(candidates.map((candidate) => candidate.to)),
      );
      const targetKey = stateKey(targets);
      let target = ids.get(targetKey);
      if (target === undefined) {
        target = sets.length;
        ids.set(targetKey, target);
        sets.push(targets);
      }
      if (first.emit === null || first.inputKind === "epsilon") {
        throw new Error(
          `GPU frontend determinization retained epsilon transition ${key}.`,
        );
      }
      transitions.push({
        inputKind: first.inputKind,
        input: first.input,
        target,
        emit: first.emit,
      });
    }
    states.push({
      id: stateId,
      accepting: nfaStates.has(fragment.end),
      transitions,
    });
  }
  return {
    id,
    ruleId: rule.id,
    ruleName: rule.name,
    startState: 0,
    states,
  };
}

function collectFields(
  expression: AnalyzedExpression,
  fields: Set<string>,
): void {
  if (expression.kind === "field") {
    fields.add(expression.name);
    collectFields(expression.expression, fields);
    return;
  }
  if (
    expression.kind === "optional" ||
    expression.kind === "repeat" ||
    expression.kind === "repeat1"
  ) {
    collectFields(expression.expression, fields);
    return;
  }
  if (expression.kind === "sequence") {
    for (const child of expression.items) {
      collectFields(child, fields);
    }
    return;
  }
  if (expression.kind === "choice") {
    for (const option of expression.options) {
      collectFields(option, fields);
    }
    return;
  }
  if (expression.kind === "separated") {
    collectFields(expression.item, fields);
    collectFields(expression.separator, fields);
  }
}

function sortedMappings(
  mappings: Readonly<Record<string, string>> | undefined,
): GpuSemanticMappingPlan[] {
  if (mappings === undefined) {
    return [];
  }
  return Object.entries(mappings).sort(([left], [right]) =>
    left.localeCompare(right)
  ).map(([source, target]) => ({ source, target }));
}

function sortedSemanticFields(
  mappings: Readonly<Record<string, string>> | undefined,
  fieldIds: ReadonlyMap<string, number>,
): GpuSemanticFieldPlan[] {
  const fields: GpuSemanticFieldPlan[] = [];
  for (const mapping of sortedMappings(mappings)) {
    const field = fieldIds.get(mapping.source);
    if (field === undefined) {
      throw new Error(
        `GPU frontend semantic field '${mapping.source}' has no field id.`,
      );
    }
    fields.push({ ...mapping, field });
  }
  return fields;
}

function ruleIds(
  names: readonly string[] | undefined,
  ruleByName: ReadonlyMap<string, AnalyzedRule>,
): number[] {
  const ids: number[] = [];
  if (names === undefined) {
    return ids;
  }
  for (const name of names) {
    const rule = ruleByName.get(name);
    if (rule !== undefined) {
      ids.push(rule.id);
    }
  }
  return ids;
}

function metadataDiagnostic(
  code: string,
  message: string,
  path: string,
): Diagnostic {
  return {
    code,
    severity: "error",
    backend: "webgpu",
    message,
    path,
  };
}

function limitDiagnostic(
  code: string,
  subject: string,
  actual: number,
  limit: number,
): Diagnostic {
  return {
    code,
    severity: "error",
    backend: "webgpu",
    message:
      `GPU frontend generated ${actual} ${subject}, exceeding the configured limit (${limit}).`,
  };
}
