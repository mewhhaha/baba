import {
  type AnyRuleCursor,
  type BuiltinCursor,
  type CompositionCursor,
  createParser,
  type DefinitionCursor,
  type EmitCursor,
  type FanoutCursor,
  type GroupCursor,
  type IntegerValuesCursor,
  type RepeatCursor,
  type StreamCursor,
  type TermCursor,
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
  definitions: Map<string, DefinitionCursor>;
  emits: EmitCursor[];
}

const MAX_REPEAT_COUNT = 10_000;

export function runFuncfuck(source: string): string {
  const program = parseProgram(source);
  const compiled = new Map<string, Func>();
  const resolving = new Set<string>();
  const output: string[] = [];

  for (const emit of program.emits) {
    const input = evaluateStream(emit.field("input"));
    const body = compileComposition(emit.field("body"));
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
    const fn = compileComposition(definition.field("body"));
    resolving.delete(name);
    compiled.set(name, fn);
    return fn;
  }

  function compileComposition(node: CompositionCursor): Func {
    const steps = [
      compileTerm(node.field("first")),
      ...node.field("rest").map((tail) => compileTerm(tail.field("next"))),
    ];
    return (input) => steps.reduce((value, step) => step(value), input);
  }

  function compileTerm(node: TermCursor): Func {
    const term = childRule(node);
    switch (term.name) {
      case "builtin":
        return compileBuiltin(term as BuiltinCursor);
      case "reference":
        return compileReference(term.field("name").text);
      case "repeat":
        return compileRepeat(term as RepeatCursor);
      case "fanout":
        return compileFanout(term as FanoutCursor);
      case "group":
        return compileComposition((term as GroupCursor).field("body"));
      default:
        throw new Error(`Unsupported term ${term.name}.`);
    }
  }

  function compileBuiltin(node: BuiltinCursor): Func {
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
        const amount = integer(builtin.field("amount").text);
        return map((value) => value + amount);
      }
      case "mul": {
        const factor = integer(builtin.field("factor").text);
        return map((value) => value * factor);
      }
      case "take": {
        const count = nonnegative(integer(builtin.field("count").text), "take");
        return (input) => input.slice(0, count);
      }
      case "drop": {
        const count = nonnegative(integer(builtin.field("count").text), "drop");
        return (input) => input.slice(count);
      }
      default:
        throw new Error(`Unsupported builtin ${builtin.name}.`);
    }
  }

  function compileRepeat(node: RepeatCursor): Func {
    const count = nonnegative(integer(node.field("count").text), "repeat");
    if (count > MAX_REPEAT_COUNT) {
      throw new Error(`repeat count ${count} exceeds ${MAX_REPEAT_COUNT}.`);
    }
    const body = compileComposition(node.field("body"));
    return (input) => {
      let value = input;
      for (let index = 0; index < count; index++) value = body(value);
      return value;
    };
  }

  function compileFanout(node: FanoutCursor): Func {
    const branches = [
      compileComposition(node.field("head")),
      ...node.field("tail").map((tail) =>
        compileComposition(
          tail.field("value"),
        )
      ),
    ];
    return (input) => branches.flatMap((branch) => branch(input));
  }
}

function parseProgram(source: string): Program {
  const parsed = parser.parse(source, { preserveTrivia: false });
  if (!parsed.ok) {
    const diagnostics = parsed.diagnostics.map((diagnostic) =>
      `${diagnostic.code} at ${diagnostic.span.start}: ${diagnostic.message}`
    ).join("\n");
    throw new Error(`Parse failed:\n${diagnostics}`);
  }

  const definitions = new Map<string, DefinitionCursor>();
  const emits: EmitCursor[] = [];
  for (const item of parsed.cursor.children().filter(isRuleNode)) {
    const child = childRule(item);
    if (child.name === "definition") {
      const definition = child as DefinitionCursor;
      const name = definition.field("name").text;
      if (definitions.has(name)) {
        throw new Error(
          `Duplicate function definition ${JSON.stringify(name)}.`,
        );
      }
      definitions.set(name, definition);
    } else if (child.name === "emit") {
      emits.push(child as EmitCursor);
    }
  }
  return { definitions, emits };
}

function evaluateStream(node: StreamCursor): readonly number[] {
  const values = node.field("values");
  if (!values) return [];
  return integerValues(values);
}

function integerValues(node: IntegerValuesCursor): readonly number[] {
  return [
    integer(node.field("head").text),
    ...node.field("tail").map((tail) => integer(tail.field("value").text)),
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

function childRule(node: AnyRuleCursor): AnyRuleCursor {
  const child = node.children().find(isRuleNode);
  if (!child) throw new Error(`Expected child rule for ${node.name}.`);
  return child;
}

function isRuleNode(node: unknown): node is AnyRuleCursor {
  return !!node && typeof node === "object" &&
    (node as { type?: unknown }).type === "rule";
}

if (import.meta.main) {
  const path = Deno.args[0] ?? "programs/pipeline.ff";
  const source = await Deno.readTextFile(path);
  await Deno.stdout.write(new TextEncoder().encode(runFuncfuck(source)));
}
