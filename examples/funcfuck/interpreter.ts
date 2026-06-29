import {
  type AnyRuleNode,
  type BuiltinNode,
  type CompositionNode,
  createParser,
  type DefinitionNode,
  type EmitNode,
  type FanoutNode,
  type GroupNode,
  type IntegerValuesNode,
  type RepeatNode,
  type StreamNode,
  type TermNode,
} from "./generated/wasm/mod.ts";

const parser = createParser({
  bytes: Deno.readFileSync(
    new URL("generated/wasm/parser.wasm", import.meta.url),
  ),
  plan: Deno.readFileSync(
    new URL("generated/wasm/parser.plan", import.meta.url),
  ),
});

type Func = (input: readonly number[]) => readonly number[];

interface Program {
  definitions: Map<string, DefinitionNode>;
  emits: EmitNode[];
}

const MAX_REPEAT_COUNT = 10_000;

export function runFuncfuck(source: string): string {
  const program = parseProgram(source);
  const compiled = new Map<string, Func>();
  const resolving = new Set<string>();
  const output: string[] = [];

  for (const emit of program.emits) {
    const input = evaluateStream(emit.fields.input);
    const body = compileComposition(emit.fields.body);
    output.push(formatStream(body(input)));
  }

  return `${output.join("\n")}${output.length === 0 ? "" : "\n"}`;

  function compileReference(name: string): Func {
    const existing = compiled.get(name);
    if (existing) return existing;
    const definition = program.definitions.get(name);
    if (!definition) {
      throw new Error(`Unknown function ${JSON.stringify(name)}.`);
    }
    if (resolving.has(name)) {
      throw new Error(
        `Recursive function definition for ${JSON.stringify(name)}.`,
      );
    }
    resolving.add(name);
    const fn = compileComposition(definition.fields.body);
    resolving.delete(name);
    compiled.set(name, fn);
    return fn;
  }

  function compileComposition(node: CompositionNode): Func {
    const steps = [
      compileTerm(node.fields.first),
      ...node.fields.rest.map((tail) => compileTerm(tail.fields.next)),
    ];
    return (input) => steps.reduce((value, step) => step(value), input);
  }

  function compileTerm(node: TermNode): Func {
    const term = childRule(node);
    switch (term.name) {
      case "builtin":
        return compileBuiltin(term as BuiltinNode);
      case "reference":
        return compileReference(term.fields.name.text);
      case "repeat":
        return compileRepeat(term as RepeatNode);
      case "fanout":
        return compileFanout(term as FanoutNode);
      case "group":
        return compileComposition((term as GroupNode).fields.body);
      default:
        throw new Error(`Unsupported term ${term.name}.`);
    }
  }

  function compileBuiltin(node: BuiltinNode): Func {
    const builtin = childRule(node);
    switch (builtin.name) {
      case "id":
        return (input) => [...input];
      case "inc":
        return map((value) => value + 1);
      case "dec":
        return map((value) => value - 1);
      case "double":
        return map((value) => value * 2);
      case "square":
        return map((value) => value * value);
      case "neg":
        return map((value) => -value);
      case "sum":
        return (input) => [input.reduce((sum, value) => sum + value, 0)];
      case "product":
        return (
          input,
        ) => [input.reduce((product, value) => product * value, 1)];
      case "first":
        return (input) => input.length === 0 ? [] : [input[0]];
      case "last":
        return (input) => input.length === 0 ? [] : [input[input.length - 1]];
      case "add": {
        const amount = integer(builtin.fields.amount.text);
        return map((value) => value + amount);
      }
      case "mul": {
        const factor = integer(builtin.fields.factor.text);
        return map((value) => value * factor);
      }
      case "take": {
        const count = nonnegative(integer(builtin.fields.count.text), "take");
        return (input) => input.slice(0, count);
      }
      case "drop": {
        const count = nonnegative(integer(builtin.fields.count.text), "drop");
        return (input) => input.slice(count);
      }
      default:
        throw new Error(`Unsupported builtin ${builtin.name}.`);
    }
  }

  function compileRepeat(node: RepeatNode): Func {
    const count = nonnegative(integer(node.fields.count.text), "repeat");
    if (count > MAX_REPEAT_COUNT) {
      throw new Error(`repeat count ${count} exceeds ${MAX_REPEAT_COUNT}.`);
    }
    const body = compileComposition(node.fields.body);
    return (input) => {
      let value = input;
      for (let index = 0; index < count; index++) value = body(value);
      return value;
    };
  }

  function compileFanout(node: FanoutNode): Func {
    const branches = [
      compileComposition(node.fields.head),
      ...node.fields.tail.map((tail) => compileComposition(tail.fields.value)),
    ];
    return (input) => branches.flatMap((branch) => branch(input));
  }
}

function parseProgram(source: string): Program {
  const parsed = parser.parse(source, { preserveTrivia: false });
  if (!parsed.ok || !parsed.root) {
    const diagnostics = parsed.diagnostics.map((diagnostic) =>
      `${diagnostic.code} at ${diagnostic.span.start}: ${diagnostic.message}`
    ).join("\n");
    throw new Error(`Parse failed:\n${diagnostics}`);
  }

  const definitions = new Map<string, DefinitionNode>();
  const emits: EmitNode[] = [];
  for (const item of parsed.root.children.filter(isRuleNode)) {
    const child = childRule(item);
    if (child.name === "definition") {
      const definition = child as DefinitionNode;
      const name = definition.fields.name.text;
      if (definitions.has(name)) {
        throw new Error(
          `Duplicate function definition ${JSON.stringify(name)}.`,
        );
      }
      definitions.set(name, definition);
    } else if (child.name === "emit") {
      emits.push(child as EmitNode);
    }
  }
  return { definitions, emits };
}

function evaluateStream(node: StreamNode): readonly number[] {
  const values = node.fields.values;
  if (!values) return [];
  return integerValues(values);
}

function integerValues(node: IntegerValuesNode): readonly number[] {
  return [
    integer(node.fields.head.text),
    ...node.fields.tail.map((tail) => integer(tail.fields.value.text)),
  ];
}

function map(fn: (value: number) => number): Func {
  return (input) => input.map(fn);
}

function integer(text: string): number {
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Invalid integer ${JSON.stringify(text)}.`);
  }
  return value;
}

function nonnegative(value: number, label: string): number {
  if (value < 0) throw new Error(`${label} count must be nonnegative.`);
  return value;
}

function formatStream(values: readonly number[]): string {
  return `[${values.join(", ")}]`;
}

function childRule(node: AnyRuleNode): AnyRuleNode {
  const child = node.children.find(isRuleNode);
  if (!child) throw new Error(`Expected child rule for ${node.name}.`);
  return child;
}

function isRuleNode(node: unknown): node is AnyRuleNode {
  return !!node && typeof node === "object" &&
    (node as { type?: unknown }).type === "rule";
}

if (import.meta.main) {
  const path = Deno.args[0] ?? "programs/pipeline.ff";
  const source = await Deno.readTextFile(path);
  await Deno.stdout.write(new TextEncoder().encode(runFuncfuck(source)));
}
