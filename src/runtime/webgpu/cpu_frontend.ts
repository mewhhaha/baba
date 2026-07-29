import type {
  GpuFrontendBoundaryPlan,
  GpuFrontendPlan,
  GpuIslandEmitPlan,
} from "../../compiler/gpu_frontend.ts";
import {
  assertFrontendAllocationLimits,
  type CompactFrontendProgram,
  decodeGpuFrontendPlan,
  executeCompactSemanticRecipes,
  type FrontendAllocationLimits,
  type GpuFrontendResult,
  type GpuFrontendTimings,
  materializeDiagnostic,
} from "./frontend.ts";
import {
  GPU_FRONTEND_DIAGNOSTIC_DELIMITER as DIAGNOSTIC_DELIMITER,
  GPU_FRONTEND_DIAGNOSTIC_EDGE_CAPACITY as DIAGNOSTIC_EDGE_CAPACITY,
  GPU_FRONTEND_DIAGNOSTIC_LEXICAL as DIAGNOSTIC_LEXICAL,
  GPU_FRONTEND_DIAGNOSTIC_NODE_CAPACITY as DIAGNOSTIC_NODE_CAPACITY,
  GPU_FRONTEND_DIAGNOSTIC_SYNTAX as DIAGNOSTIC_SYNTAX,
  GPU_FRONTEND_DIAGNOSTIC_TOKEN_CAPACITY as DIAGNOSTIC_TOKEN_CAPACITY,
  GPU_FRONTEND_EDGE_WORDS as EDGE_WORDS,
  GPU_FRONTEND_NODE_WORDS as NODE_WORDS,
  GPU_FRONTEND_TOKEN_WORDS as TOKEN_WORDS,
  type GpuFrontendDiagnosticRecord as RawDiagnostic,
} from "./frontend_contract.ts";
import {
  decodeLexerPlanTables,
  type LexerPlanTables,
  planTransition,
} from "./plan_tables.ts";

export interface CpuFrontendOptions extends FrontendAllocationLimits {
  readonly maxTokens?: number;
}

interface Token {
  readonly terminal: number;
  readonly start: number;
  readonly end: number;
  readonly lexicalIdentity: number;
  readonly outputIndex: number;
}

interface PendingEdge {
  readonly emit: GpuIslandEmitPlan;
  readonly token: Token | undefined;
  readonly child: PendingNode | undefined;
  readonly ordinal: number;
}

interface PendingNode {
  readonly island: number;
  readonly start: number;
  readonly end: number;
  readonly sourceOrder: number;
  readonly edges: PendingEdge[];
  id: number;
}

interface IslandMatch {
  readonly node: PendingNode;
  readonly nextToken: number;
}

interface IslandExecutionProgress {
  farthestToken: number;
  island: number;
  state: number;
}

export function ingestCpuFrontend(
  plan: GpuFrontendPlan,
  lexer: LexerPlanTables,
  source: string,
  options: CpuFrontendOptions,
): GpuFrontendResult {
  if (
    options.maxTokens !== undefined &&
    (!Number.isSafeInteger(options.maxTokens) || options.maxTokens < 0)
  ) {
    throw new TypeError(
      `maxTokens must be a non-negative safe integer; received ${options.maxTokens}.`,
    );
  }
  assertFrontendAllocationLimits(options);
  const started = performance.now();
  const units = new Uint16Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    units[index] = source.charCodeAt(index);
  }
  const afterUpload = performance.now();
  const rawDiagnostics: RawDiagnostic[] = [];
  const tokens = lex(
    units,
    lexer,
    plan,
    rawDiagnostics,
    options.maxTokens,
  );
  const afterLex = performance.now();
  const delimiterMatches = matchDelimiters(
    tokens,
    plan.boundaries,
    rawDiagnostics,
  );
  const afterDelimiters = performance.now();
  let root: PendingNode | undefined;
  if (rawDiagnostics.length === 0) {
    root = executeRootIsland(
      tokens,
      delimiterMatches,
      plan,
      rawDiagnostics,
    );
  }
  const afterIslands = performance.now();
  let program: CompactFrontendProgram | null = null;
  if (root !== undefined && rawDiagnostics.length === 0) {
    try {
      program = materializeProgram(
        tokens,
        root,
        plan,
        options,
      );
      const symbols = executeCompactSemanticRecipes(
        program,
        plan,
        source,
        rawDiagnostics,
      );
      program = { ...program, symbols };
    } catch (error) {
      if (!(error instanceof FrontendSourceCapacity)) {
        throw error;
      }
      rawDiagnostics.push(error.diagnostic);
    }
  }
  const afterSemantics = performance.now();
  rawDiagnostics.sort((left, right) =>
    left.start - right.start ||
    left.code - right.code ||
    left.subjectId - right.subjectId
  );
  const diagnostics = rawDiagnostics.map(materializeDiagnostic);
  const finished = performance.now();
  const timings: GpuFrontendTimings = {
    uploadMs: afterUpload - started,
    lexMs: afterLex - afterUpload,
    delimitersMs: afterDelimiters - afterLex,
    islandsMs: afterIslands - afterDelimiters,
    semanticsMs: afterSemantics - afterIslands,
    readbackMs: finished - afterSemantics,
    totalMs: finished - started,
    stagesMs: null,
  };
  if (diagnostics.length > 0 || program === null) {
    return { ok: false, program: null, diagnostics, timings };
  }
  return { ok: true, program, diagnostics: [], timings };
}

/**
 * Explicit CPU backend for parity-checking the GPU island frontend.
 */
export class CpuFrontend {
  readonly plan: GpuFrontendPlan;
  readonly lexer: LexerPlanTables;

  private constructor(plan: GpuFrontendPlan, lexer: LexerPlanTables) {
    this.plan = plan;
    this.lexer = lexer;
  }

  static create(planBytes: Uint8Array): CpuFrontend {
    return new CpuFrontend(
      decodeGpuFrontendPlan(planBytes),
      decodeLexerPlanTables(planBytes),
    );
  }

  ingest(source: string, options: CpuFrontendOptions = {}): GpuFrontendResult {
    return ingestCpuFrontend(this.plan, this.lexer, source, options);
  }
}

function lex(
  source: Uint16Array,
  lexer: LexerPlanTables,
  plan: GpuFrontendPlan,
  diagnostics: RawDiagnostic[],
  maxTokens: number | undefined,
): Token[] {
  const tokens: Token[] = [];
  let position = 0;
  while (position < source.length) {
    let state = lexer.startState;
    let cursor = position;
    let acceptedEnd = -1;
    let acceptedState = -1;
    let acceptedSpec = -1;
    while (cursor < source.length) {
      const codePoint = sourceCodePoint(source, cursor);
      const target = planTransition(lexer, state, codePoint.value);
      if (target < 0) {
        break;
      }
      cursor += codePoint.width;
      state = target;
      const spec = lexer.acceptSpecByState[state];
      if (spec >= 0) {
        acceptedEnd = cursor;
        acceptedState = state;
        acceptedSpec = spec;
      }
    }
    if (acceptedEnd < 0) {
      const width = sourceCodePoint(source, position).width;
      diagnostics.push({
        code: DIAGNOSTIC_LEXICAL,
        start: position,
        end: position + width,
        subjectId: position,
        parameter0: source[position],
        parameter1: 0,
      });
      position += width;
      continue;
    }
    const terminal = plan.terminalClassification[acceptedSpec];
    if (terminal === undefined) {
      throw new Error(
        `GPU frontend terminal classification has no lexer spec ${acceptedSpec}.`,
      );
    }
    const outputIndex = tokens.length;
    tokens.push({
      terminal,
      start: position,
      end: acceptedEnd,
      lexicalIdentity: acceptedSpec,
      outputIndex,
    });
    position = acceptedEnd;
    void acceptedState;
  }
  if (maxTokens !== undefined && tokens.length > maxTokens) {
    diagnostics.push({
      code: DIAGNOSTIC_TOKEN_CAPACITY,
      start: 0,
      end: source.length,
      subjectId: tokens.length,
      parameter0: tokens.length,
      parameter1: maxTokens,
    });
  }
  return tokens;
}

function sourceCodePoint(
  source: Uint16Array,
  position: number,
): { readonly value: number; readonly width: number } {
  const first = source[position];
  if (
    first >= 0xd800 &&
    first <= 0xdbff &&
    position + 1 < source.length
  ) {
    const second = source[position + 1];
    if (second >= 0xdc00 && second <= 0xdfff) {
      return {
        value: 0x10000 + ((first - 0xd800) << 10) + second - 0xdc00,
        width: 2,
      };
    }
  }
  return { value: first, width: 1 };
}

function matchDelimiters(
  tokens: readonly Token[],
  boundaries: readonly GpuFrontendBoundaryPlan[],
  diagnostics: RawDiagnostic[],
): ReadonlyMap<number, number> {
  const closeByOpen = new Map<number, number>();
  for (const boundary of boundaries) {
    if (boundary.kind === "paired" || boundary.kind === "separated") {
      const existing = closeByOpen.get(boundary.openTerminal);
      if (
        existing !== undefined &&
        existing !== boundary.closeTerminal
      ) {
        throw new Error(
          `GPU frontend opener terminal ${boundary.openTerminal} maps to both ${existing} and ${boundary.closeTerminal}.`,
        );
      }
      closeByOpen.set(boundary.openTerminal, boundary.closeTerminal);
    }
  }
  const openByClose = new Map<number, number>();
  for (const [open, close] of closeByOpen) {
    const existing = openByClose.get(close);
    if (existing !== undefined && existing !== open) {
      throw new Error(
        `GPU frontend closer terminal ${close} maps from both ${existing} and ${open}.`,
      );
    }
    openByClose.set(close, open);
  }
  const stack: { readonly terminal: number; readonly index: number }[] = [];
  const matches = new Map<number, number>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.terminal < 0) {
      continue;
    }
    const expectedClose = closeByOpen.get(token.terminal);
    if (expectedClose !== undefined) {
      stack.push({ terminal: expectedClose, index });
      continue;
    }
    if (!openByClose.has(token.terminal)) {
      continue;
    }
    const open = stack.pop();
    if (open === undefined || open.terminal !== token.terminal) {
      let expectedTerminal = -1;
      if (open !== undefined) {
        expectedTerminal = open.terminal;
      }
      diagnostics.push({
        code: DIAGNOSTIC_DELIMITER,
        start: token.start,
        end: token.end,
        subjectId: token.outputIndex,
        parameter0: expectedTerminal,
        parameter1: token.terminal,
      });
      continue;
    }
    matches.set(open.index, index);
  }
  for (const open of stack) {
    const token = tokens[open.index];
    diagnostics.push({
      code: DIAGNOSTIC_DELIMITER,
      start: token.start,
      end: token.end,
      subjectId: token.outputIndex,
      parameter0: open.terminal,
      parameter1: -1,
    });
  }
  return matches;
}

function executeRootIsland(
  tokens: readonly Token[],
  delimiterMatches: ReadonlyMap<number, number>,
  plan: GpuFrontendPlan,
  diagnostics: RawDiagnostic[],
): PendingNode | undefined {
  const syntaxTokens = tokens.filter((token) => token.terminal >= 0);
  const progress: IslandExecutionProgress = {
    farthestToken: 0,
    island: plan.rootIsland,
    state: 0,
  };
  const root = runIsland(
    plan.rootIsland,
    0,
    syntaxTokens.length,
    syntaxTokens,
    delimiterMatchesForSyntax(tokens, syntaxTokens, delimiterMatches),
    plan,
    new Set(),
    progress,
  );
  if (root !== undefined && root.nextToken === syntaxTokens.length) {
    return root.node;
  }
  let start = 0;
  let end = 0;
  if (root !== undefined && root.nextToken < syntaxTokens.length) {
    start = syntaxTokens[root.nextToken].start;
    end = syntaxTokens[root.nextToken].end;
  } else if (
    syntaxTokens.length > 0 &&
    progress.farthestToken < syntaxTokens.length
  ) {
    start = syntaxTokens[progress.farthestToken].start;
    end = syntaxTokens[progress.farthestToken].end;
  }
  let subjectId = progress.farthestToken;
  if (root !== undefined) {
    subjectId = root.nextToken;
  }
  diagnostics.push({
    code: DIAGNOSTIC_SYNTAX,
    start,
    end,
    subjectId,
    parameter0: progress.island,
    parameter1: progress.state,
  });
  return undefined;
}

function delimiterMatchesForSyntax(
  tokens: readonly Token[],
  syntaxTokens: readonly Token[],
  matches: ReadonlyMap<number, number>,
): ReadonlyMap<number, number> {
  const syntaxIndexByOutput = new Map(
    syntaxTokens.map((token, index) => [token.outputIndex, index]),
  );
  const syntaxMatches = new Map<number, number>();
  for (const [open, close] of matches) {
    const syntaxOpen = syntaxIndexByOutput.get(tokens[open].outputIndex);
    const syntaxClose = syntaxIndexByOutput.get(tokens[close].outputIndex);
    if (syntaxOpen !== undefined && syntaxClose !== undefined) {
      syntaxMatches.set(syntaxOpen, syntaxClose);
    }
  }
  return syntaxMatches;
}

function runIsland(
  islandId: number,
  start: number,
  limit: number,
  tokens: readonly Token[],
  delimiterMatches: ReadonlyMap<number, number>,
  plan: GpuFrontendPlan,
  active: ReadonlySet<string>,
  progress: IslandExecutionProgress,
): IslandMatch | undefined {
  const key = `${islandId}:${start}:${limit}`;
  if (active.has(key)) {
    return undefined;
  }
  const island = plan.islands[islandId];
  if (island === undefined) {
    throw new Error(`GPU frontend plan has no island ${islandId}.`);
  }
  const nextActive = new Set(active);
  nextActive.add(key);
  let state = island.startState;
  let cursor = start;
  const edges: PendingEdge[] = [];
  let ordinal = 0;
  while (cursor < limit) {
    if (cursor >= progress.farthestToken) {
      progress.farthestToken = cursor;
      progress.island = islandId;
      progress.state = state;
    }
    const statePlan = island.states[state];
    if (statePlan === undefined) {
      throw new Error(
        `GPU frontend island ${islandId} has no state ${state}.`,
      );
    }
    const token = tokens[cursor];
    const terminalTransition = statePlan.transitions.find((transition) =>
      transition.inputKind === "terminal" &&
      transition.input === token.terminal
    );
    let nestedMatch:
      | {
        readonly transition: typeof statePlan.transitions[number];
        readonly match: IslandMatch;
      }
      | undefined;
    for (
      const transition of statePlan.transitions.filter((candidate) =>
        candidate.inputKind === "island"
      )
    ) {
      const nestedLimit = islandLimit(
        transition.input,
        cursor,
        limit,
        tokens,
        delimiterMatches,
        plan.boundaries,
      );
      if (nestedLimit === undefined) {
        continue;
      }
      const match = runIsland(
        transition.input,
        cursor,
        nestedLimit,
        tokens,
        delimiterMatches,
        plan,
        nextActive,
        progress,
      );
      if (match === undefined) {
        continue;
      }
      const boundary = plan.boundaries[transition.input];
      const requiresExactLimit = boundary.kind === "paired" ||
        boundary.kind === "separated";
      if (requiresExactLimit && match.nextToken !== nestedLimit) {
        continue;
      }
      if (nestedMatch !== undefined) {
        if (nestedMatch.match.nextToken === match.nextToken) {
          return undefined;
        }
        if (nestedMatch.match.nextToken > match.nextToken) {
          continue;
        }
      }
      nestedMatch = { transition, match };
    }
    if (
      terminalTransition !== undefined &&
      (
        nestedMatch === undefined ||
        nestedMatch.match.nextToken <= cursor + 1
      )
    ) {
      if (
        nestedMatch !== undefined &&
        nestedMatch.match.nextToken === cursor + 1
      ) {
        return undefined;
      }
      edges.push({
        emit: terminalTransition.emit,
        token,
        child: undefined,
        ordinal,
      });
      ordinal += 1;
      state = terminalTransition.target;
      cursor += 1;
      continue;
    }
    if (nestedMatch === undefined) {
      break;
    }
    edges.push({
      emit: nestedMatch.transition.emit,
      token: undefined,
      child: nestedMatch.match.node,
      ordinal,
    });
    ordinal += 1;
    state = nestedMatch.transition.target;
    cursor = nestedMatch.match.nextToken;
  }
  const finalState = island.states[state];
  if (finalState === undefined || !finalState.accepting) {
    return undefined;
  }
  const firstToken = tokens[start];
  let end = 0;
  if (firstToken !== undefined) {
    end = firstToken.start;
  }
  let nodeStart = end;
  if (firstToken !== undefined) {
    nodeStart = firstToken.start;
  }
  if (cursor > start) {
    end = tokens[cursor - 1].end;
  }
  return {
    node: {
      island: islandId,
      start: nodeStart,
      end,
      sourceOrder: start,
      edges,
      id: -1,
    },
    nextToken: cursor,
  };
}

function islandLimit(
  island: number,
  start: number,
  outerLimit: number,
  tokens: readonly Token[],
  delimiterMatches: ReadonlyMap<number, number>,
  boundaries: readonly GpuFrontendBoundaryPlan[],
): number | undefined {
  const boundary = boundaries[island];
  if (boundary === undefined) {
    throw new Error(`GPU frontend plan has no boundary for island ${island}.`);
  }
  if (boundary.kind === "root") {
    return outerLimit;
  }
  if (boundary.kind === "paired" || boundary.kind === "separated") {
    if (tokens[start]?.terminal !== boundary.openTerminal) {
      return undefined;
    }
    const close = delimiterMatches.get(start);
    if (close === undefined || close >= outerLimit) {
      return undefined;
    }
    return close + 1;
  }
  return outerLimit;
}

function materializeProgram(
  tokens: readonly Token[],
  root: PendingNode,
  plan: GpuFrontendPlan,
  options: CpuFrontendOptions,
): CompactFrontendProgram {
  const pendingNodes: PendingNode[] = [];
  collectNodes(root, pendingNodes);
  if (
    options.maxNodes !== undefined && pendingNodes.length > options.maxNodes
  ) {
    throw new FrontendSourceCapacity({
      code: DIAGNOSTIC_NODE_CAPACITY,
      start: root.start,
      end: root.end,
      subjectId: pendingNodes.length,
      parameter0: pendingNodes.length,
      parameter1: options.maxNodes,
    });
  }
  for (let index = 0; index < pendingNodes.length; index += 1) {
    pendingNodes[index].id = index;
  }
  const edgeCount = pendingNodes.reduce(
    (total, node) => total + node.edges.length,
    0,
  );
  if (options.maxEdges !== undefined && edgeCount > options.maxEdges) {
    throw new FrontendSourceCapacity({
      code: DIAGNOSTIC_EDGE_CAPACITY,
      start: root.start,
      end: root.end,
      subjectId: edgeCount,
      parameter0: edgeCount,
      parameter1: options.maxEdges,
    });
  }
  const tokenRecords = new Int32Array(tokens.length * TOKEN_WORDS);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    tokenRecords.set(
      [token.terminal, token.start, token.end, token.lexicalIdentity],
      index * TOKEN_WORDS,
    );
  }
  const nodeRecords = new Int32Array(pendingNodes.length * NODE_WORDS);
  const edgeRecords = new Int32Array(edgeCount * EDGE_WORDS);
  let edgeOffset = 0;
  for (const node of pendingNodes) {
    const island = plan.islands[node.island];
    nodeRecords.set(
      [
        island.ruleId,
        0,
        node.start,
        node.end,
        edgeOffset,
        node.edges.length,
        -1,
        -1,
      ],
      node.id * NODE_WORDS,
    );
    for (const edge of node.edges) {
      let targetCategory = 0;
      let targetId = edge.token?.outputIndex;
      if (edge.child !== undefined) {
        targetCategory = 1;
        targetId = edge.child.id;
      }
      if (targetId === undefined) {
        throw new Error(
          `GPU frontend node ${node.id} edge ${edge.ordinal} has no target.`,
        );
      }
      edgeRecords.set(
        [edge.emit.field, edge.ordinal, targetCategory, targetId],
        edgeOffset * EDGE_WORDS,
      );
      edgeOffset += 1;
    }
  }
  return {
    tokens: tokenRecords,
    nodes: nodeRecords,
    edges: edgeRecords,
    symbols: new Int32Array(),
    types: new Int32Array([0]),
  };
}

function collectNodes(node: PendingNode, nodes: PendingNode[]): void {
  nodes.push(node);
  for (const edge of node.edges) {
    if (edge.child !== undefined) {
      collectNodes(edge.child, nodes);
    }
  }
}

class FrontendSourceCapacity extends Error {
  readonly diagnostic: RawDiagnostic;

  constructor(diagnostic: RawDiagnostic) {
    super("GPU frontend source capacity was exceeded.");
    this.name = "FrontendSourceCapacity";
    this.diagnostic = diagnostic;
  }
}
