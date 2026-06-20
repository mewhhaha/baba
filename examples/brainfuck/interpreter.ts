import {
  type AnyRuleNode,
  type InstructionNode,
  parse,
} from "./generated/wasm/mod.ts";

type Op =
  | { kind: "inc"; amount: number }
  | { kind: "move"; offset: number }
  | { kind: "output" }
  | { kind: "input" }
  | { kind: "jumpIfZero"; target: number }
  | { kind: "jumpIfNonZero"; target: number }
  | { kind: "fork"; ops: readonly Op[] }
  | { kind: "join" };

interface Task {
  ops: readonly Op[];
  ip: number;
  pointer: number;
}

interface RunOptions {
  input?: string;
  tapeSize?: number;
  maxSteps?: number;
}

const DEFAULT_TAPE_SIZE = 30_000;
const DEFAULT_MAX_STEPS = 10_000_000;
const MAX_REPEAT_COUNT = 1_000_000;

export function compileBrainfuck(source: string): Op[] {
  const parsed = parse(source, { preserveTrivia: false });
  if (!parsed.ok || !parsed.root) {
    const diagnostics = parsed.diagnostics.map((diagnostic) =>
      `${diagnostic.code} at ${diagnostic.span.start}: ${diagnostic.message}`
    ).join("\n");
    throw new Error(`Parse failed:\n${diagnostics}`);
  }
  return compileInstructions(parsed.root.children.filter(isInstruction));
}

export function runBrainfuck(source: string, options: RunOptions = {}): string {
  return execute(compileBrainfuck(source), options);
}

function compileInstructions(
  instructions: readonly InstructionNode[],
  ops: Op[] = [],
): Op[] {
  for (const instruction of instructions) {
    const operation = instruction.children.find(isRuleNode);
    if (!operation) continue;
    const count = instructionRepeatCount(instruction);
    if (count === 0) continue;

    switch (operation.name) {
      case "increment":
        pushInc(ops, count);
        break;
      case "decrement":
        pushInc(ops, -count);
        break;
      case "move_left":
        pushMove(ops, -count);
        break;
      case "move_right":
        pushMove(ops, count);
        break;
      case "output":
        pushRepeated(ops, { kind: "output" }, count);
        break;
      case "input":
        pushRepeated(ops, { kind: "input" }, count);
        break;
      case "loop":
        for (let index = 0; index < count; index++) {
          const open = ops.length;
          ops.push({ kind: "jumpIfZero", target: -1 });
          compileInstructions(operation.fields.body, ops);
          const close = ops.length;
          ops.push({ kind: "jumpIfNonZero", target: open });
          ops[open] = { kind: "jumpIfZero", target: close + 1 };
        }
        break;
      case "fork": {
        const forkOps = compileInstructions(operation.fields.body);
        pushRepeated(ops, { kind: "fork", ops: forkOps }, count);
        break;
      }
      case "join":
        pushRepeated(ops, { kind: "join" }, count);
        break;
    }
  }
  return ops;
}

function instructionRepeatCount(instruction: InstructionNode): number {
  const text = instruction.fields.count?.text ?? "1";
  const count = Number(text);
  if (!Number.isSafeInteger(count)) {
    throw new Error(`Repeat count ${JSON.stringify(text)} is too large.`);
  }
  if (count > MAX_REPEAT_COUNT) {
    throw new Error(`Repeat count ${count} exceeds ${MAX_REPEAT_COUNT}.`);
  }
  return count;
}

function pushInc(ops: Op[], amount: number): void {
  const last = ops.at(-1);
  if (last?.kind === "inc") {
    const next = last.amount + amount;
    if (next === 0) ops.pop();
    else last.amount = next;
    return;
  }
  ops.push({ kind: "inc", amount });
}

function pushMove(ops: Op[], offset: number): void {
  const last = ops.at(-1);
  if (last?.kind === "move") {
    const next = last.offset + offset;
    if (next === 0) ops.pop();
    else last.offset = next;
    return;
  }
  ops.push({ kind: "move", offset });
}

function pushRepeated(ops: Op[], op: Op, count: number): void {
  for (let index = 0; index < count; index++) ops.push(op);
}

function execute(ops: readonly Op[], options: RunOptions): string {
  const tape = new Uint8Array(options.tapeSize ?? DEFAULT_TAPE_SIZE);
  const input = [...(options.input ?? "")].map((char) =>
    char.codePointAt(0) ?? 0
  );
  const output: string[] = [];
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const children: Task[] = [];
  const main: Task = { ops, ip: 0, pointer: 0 };
  let inputIndex = 0;
  let steps = 0;

  while (main.ip < main.ops.length) {
    assertStepBudget();
    stepTask(main);
  }
  runChildren();

  return output.join("");

  function runChildren(): void {
    while (children.length > 0) {
      for (let index = 0; index < children.length;) {
        assertStepBudget();
        const child = children[index];
        stepTask(child);
        if (child.ip >= child.ops.length) children.splice(index, 1);
        else index++;
      }
    }
  }

  function assertStepBudget(): void {
    steps++;
    if (steps > maxSteps) {
      throw new Error(`Execution exceeded ${maxSteps} steps.`);
    }
  }

  function stepTask(task: Task): void {
    const op = task.ops[task.ip];
    switch (op.kind) {
      case "inc":
        tape[task.pointer] = (tape[task.pointer] + op.amount) & 0xff;
        task.ip++;
        break;
      case "move":
        task.pointer += op.offset;
        if (task.pointer < 0 || task.pointer >= tape.length) {
          throw new Error(`Tape pointer moved out of bounds: ${task.pointer}.`);
        }
        task.ip++;
        break;
      case "output":
        output.push(String.fromCharCode(tape[task.pointer]));
        task.ip++;
        break;
      case "input":
        tape[task.pointer] = input[inputIndex++] ?? 0;
        task.ip++;
        break;
      case "jumpIfZero":
        task.ip = tape[task.pointer] === 0 ? op.target : task.ip + 1;
        break;
      case "jumpIfNonZero":
        task.ip = tape[task.pointer] !== 0 ? op.target : task.ip + 1;
        break;
      case "fork":
        children.push({ ops: op.ops, ip: 0, pointer: task.pointer });
        task.ip++;
        break;
      case "join":
        task.ip++;
        runChildren();
        break;
    }
  }
}

function isInstruction(node: unknown): node is InstructionNode {
  return isRuleNode(node) && node.name === "instruction";
}

function isRuleNode(node: unknown): node is AnyRuleNode {
  return !!node && typeof node === "object" &&
    (node as { type?: unknown }).type === "rule";
}

if (import.meta.main) {
  const path = Deno.args[0] ?? "programs/hello.bf";
  const source = await Deno.readTextFile(path);
  await Deno.stdout.write(new TextEncoder().encode(runBrainfuck(source)));
}
