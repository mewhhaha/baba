import {
  type CharRange,
  invertRanges,
  normalizeRanges,
  type RegexAst,
} from "./ast.ts";

export interface NfaTransition {
  ranges: readonly CharRange[];
  target: number;
}

export interface NfaState {
  epsilon: number[];
  transitions: NfaTransition[];
  accepts: number[];
}

export interface Nfa {
  start: number;
  states: NfaState[];
}

interface Fragment {
  start: number;
  end: number;
}

export function buildRegexNfa(ast: RegexAst, accept = 0): Nfa {
  const builder = new NfaBuilder();
  const fragment = builder.build(ast);
  builder.states[fragment.end].accepts.push(accept);
  return { start: fragment.start, states: builder.states };
}

export function buildCombinedNfa(
  specs: readonly { ast: RegexAst; accept: number }[],
): Nfa {
  const builder = new NfaBuilder();
  const start = builder.state();
  for (const spec of specs) {
    const fragment = builder.build(spec.ast);
    builder.states[start].epsilon.push(fragment.start);
    builder.states[fragment.end].accepts.push(spec.accept);
  }
  return { start, states: builder.states };
}

class NfaBuilder {
  readonly states: NfaState[] = [];

  state(): number {
    const id = this.states.length;
    this.states.push({ epsilon: [], transitions: [], accepts: [] });
    return id;
  }

  build(ast: RegexAst): Fragment {
    switch (ast.kind) {
      case "empty":
        return this.empty();
      case "literal":
        return this.transition([{ start: ast.codePoint, end: ast.codePoint }]);
      case "dot":
        return this.transition(dotRanges);
      case "class":
        return this.transition(
          ast.negated ? invertRanges(ast.ranges) : ast.ranges,
        );
      case "sequence":
        return this.sequence(ast.items.map((item) => this.build(item)));
      case "choice":
        return this.choice(ast.options.map((option) => this.build(option)));
      case "repeat":
        return this.repeat(ast.expression, ast.min, ast.max);
    }
  }

  private empty(): Fragment {
    const start = this.state();
    const end = this.state();
    this.states[start].epsilon.push(end);
    return { start, end };
  }

  private transition(ranges: readonly CharRange[]): Fragment {
    const start = this.state();
    const end = this.state();
    this.states[start].transitions.push({
      ranges: normalizeRanges(ranges),
      target: end,
    });
    return { start, end };
  }

  private sequence(fragments: readonly Fragment[]): Fragment {
    if (fragments.length === 0) return this.empty();
    for (let index = 0; index < fragments.length - 1; index++) {
      this.states[fragments[index].end].epsilon.push(
        fragments[index + 1].start,
      );
    }
    return {
      start: fragments[0].start,
      end: fragments[fragments.length - 1].end,
    };
  }

  private choice(fragments: readonly Fragment[]): Fragment {
    const start = this.state();
    const end = this.state();
    for (const fragment of fragments) {
      this.states[start].epsilon.push(fragment.start);
      this.states[fragment.end].epsilon.push(end);
    }
    return { start, end };
  }

  private repeat(
    expression: RegexAst,
    min: number,
    max: number | null,
  ): Fragment {
    const required: Fragment[] = [];
    for (let index = 0; index < min; index++) {
      required.push(this.build(expression));
    }
    const requiredFragment = this.sequence(required);
    if (max === min) return requiredFragment;

    const start = this.state();
    const end = this.state();
    this.states[start].epsilon.push(requiredFragment.start);

    let tailStart = requiredFragment.end;
    if (max === null) {
      const loop = this.build(expression);
      this.states[tailStart].epsilon.push(end, loop.start);
      this.states[loop.end].epsilon.push(end, loop.start);
      return { start, end };
    }

    for (let index = min; index < max; index++) {
      const optional = this.build(expression);
      this.states[tailStart].epsilon.push(end, optional.start);
      tailStart = optional.end;
    }
    this.states[tailStart].epsilon.push(end);
    return { start, end };
  }
}

const dotRanges = normalizeRanges([
  { start: 0, end: 9 },
  { start: 11, end: 12 },
  { start: 14, end: 0x2027 },
  { start: 0x202a, end: 0x10ffff },
]);
