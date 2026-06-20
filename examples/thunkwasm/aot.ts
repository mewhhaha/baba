import {
  type AnyRuleNode,
  parse,
  type SyntaxElement,
} from "./generated/ts/mod.ts";

interface Program {
  definitions: readonly Definition[];
}

interface Definition {
  name: string;
  params: readonly string[];
  body: Expr;
}

type Expr =
  | { kind: "int"; value: number }
  | { kind: "name"; name: string }
  | { kind: "let"; name: string; value: Expr; body: Expr }
  | {
    kind: "if";
    hint?: "likely" | "unlikely";
    condition: Expr;
    consequent: Expr;
    alternate: Expr;
  }
  | { kind: "fun"; param: string; body: Expr }
  | { kind: "lazy"; body: Expr }
  | { kind: "force"; body: Expr }
  | { kind: "unary"; op: "neg"; body: Expr }
  | { kind: "binary"; op: BinaryOp; left: Expr; right: Expr }
  | { kind: "call"; callee: Expr; argLists: readonly (readonly Expr[])[] }
  | { kind: "tick"; value: Expr };

type BinaryOp =
  | "eq"
  | "ne"
  | "lt"
  | "le"
  | "gt"
  | "ge"
  | "add"
  | "sub"
  | "mul"
  | "div";

interface CompileResult {
  wasm: Uint8Array;
  mainArity: number;
}

interface RunResult {
  result: number | string;
  ticks: number;
  allocations: number;
  releases: number;
  wasm: Uint8Array;
}

enum Section {
  Type = 1,
  Function = 3,
  Table = 4,
  Memory = 5,
  Global = 6,
  Export = 7,
  Element = 9,
  Code = 10,
}

enum TypeForm {
  Function = 0x60,
}

enum ValType {
  FuncRef = 0x70,
  I32 = 0x7f,
}

enum ExternalKind {
  Function = 0x00,
  Memory = 0x02,
}

enum LimitsFlag {
  MinOnly = 0x00,
}

enum Mutability {
  Const = 0x00,
  Var = 0x01,
}

enum BlockType {
  Empty = 0x40,
}

enum WasmInstruction {
  Unreachable = 0x00,
  Block = 0x02,
  Loop = 0x03,
  If = 0x04,
  Else = 0x05,
  End = 0x0b,
  Br = 0x0c,
  BrIf = 0x0d,
  Return = 0x0f,
  Call = 0x10,
  CallIndirect = 0x11,
  LocalGet = 0x20,
  LocalSet = 0x21,
  GlobalGet = 0x23,
  GlobalSet = 0x24,
  I32Load = 0x28,
  I32Store = 0x36,
  I32Const = 0x41,
  I32Eqz = 0x45,
  I32Eq = 0x46,
  I32Ne = 0x47,
  I32LtS = 0x48,
  I32LtU = 0x49,
  I32GtS = 0x4a,
  I32LeS = 0x4c,
  I32GeS = 0x4e,
  I32GeU = 0x4f,
  I32Add = 0x6a,
  I32Sub = 0x6b,
  I32Mul = 0x6c,
  I32DivS = 0x6d,
  I32And = 0x71,
  I32Or = 0x72,
  I32Shl = 0x74,
  I32ShrS = 0x75,
}

const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d] as const;
const WASM_VERSION = [0x01, 0x00, 0x00, 0x00] as const;
const LEB_VALUE_MASK = 0x7f;
const LEB_CONTINUATION_BIT = 0x80;
const LEB_SIGN_BIT = 0x40;

const WORD_ALIGN = 2;
const COUNTER_TICKS = 0;
const COUNTER_ALLOCATIONS = 4;
const COUNTER_RELEASES = 8;
const HEAP_START = 1024;

const TAG_FREE = 0;
const TAG_CLOSURE = 1;
const TAG_THUNK = 2;

const THUNK_UNEVALUATED = 0;
const THUNK_EVALUATING = 1;
const THUNK_EVALUATED = 2;

const HEADER_TAG = 0;
const HEADER_SIZE = 4;
const HEADER_REFCOUNT = 8;
const OBJECT_FUNCTION_ID = 12;
const OBJECT_ENV_COUNT = 16;
const CLOSURE_ARITY = 20;
const CLOSURE_ENV_BASE = 24;
const THUNK_STATE = 20;
const THUNK_RESULT = 24;
const THUNK_ENV_BASE = 28;

export function compileThunkWasm(source: string): CompileResult {
  const program = parseProgram(source);
  return new Compiler(program).compile();
}

export async function runThunkWasm(
  source: string,
  args: readonly number[] = [],
): Promise<RunResult> {
  const compiled = compileThunkWasm(source);
  if (args.length !== compiled.mainArity) {
    throw new Error(
      `main expects ${compiled.mainArity} argument(s), got ${args.length}.`,
    );
  }

  const instantiated = await WebAssembly.instantiate(compiled.wasm, {});
  const instance = isInstantiatedSource(instantiated)
    ? instantiated.instance
    : instantiated;
  const main = instance.exports.main;
  const memory = instance.exports.memory;
  if (typeof main !== "function") {
    throw new Error("Generated Wasm module did not export main().");
  }
  if (!(memory instanceof WebAssembly.Memory)) {
    throw new Error("Generated Wasm module did not export memory.");
  }

  const rawResult = main(...args.map(tagInt));
  if (typeof rawResult !== "number") {
    throw new Error("main() did not return an i32 value.");
  }
  const view = new DataView(memory.buffer);
  return {
    result: formatValue(rawResult),
    ticks: view.getInt32(COUNTER_TICKS, true),
    allocations: view.getInt32(COUNTER_ALLOCATIONS, true),
    releases: view.getInt32(COUNTER_RELEASES, true),
    wasm: compiled.wasm,
  };
}

function isInstantiatedSource(
  value: WebAssembly.Instance | WebAssembly.WebAssemblyInstantiatedSource,
): value is WebAssembly.WebAssemblyInstantiatedSource {
  return "instance" in value;
}

class Compiler {
  private readonly builder = new WasmBuilder();
  private readonly functionNames = new Set<string>();
  private readonly definitions = new Map<string, Definition>();
  private readonly directFunctions = new Map<string, number>();

  private readonly valueToValueType = this.builder.type(
    [ValType.I32],
    [ValType.I32],
  );
  private readonly valueValueToValueType = this.builder.type(
    [ValType.I32, ValType.I32],
    [ValType.I32],
  );
  private readonly allocType = this.builder.type([ValType.I32], [ValType.I32]);
  private readonly valueVoidType = this.builder.type([ValType.I32], []);
  private readonly releaseEnvType = this.builder.type(
    [ValType.I32, ValType.I32, ValType.I32],
    [],
  );

  private readonly allocIndex = this.builder.declareFunction(this.allocType);
  private readonly retainValueIndex = this.builder.declareFunction(
    this.valueVoidType,
  );
  private readonly releaseEnvIndex = this.builder.declareFunction(
    this.releaseEnvType,
  );
  private readonly releaseValueIndex = this.builder.declareFunction(
    this.valueVoidType,
  );
  private readonly forceIndex = this.builder.declareFunction(
    this.valueToValueType,
  );

  constructor(private readonly program: Program) {
    for (const definition of program.definitions) {
      if (this.definitions.has(definition.name)) {
        throw new Error(
          `Duplicate function ${JSON.stringify(definition.name)}.`,
        );
      }
      this.definitions.set(definition.name, definition);
      this.functionNames.add(definition.name);
    }
    if (!this.definitions.has("main")) {
      throw new Error('Expected a top-level function named "main".');
    }
  }

  compile(): CompileResult {
    this.declareDirectFunctions();
    this.emitRuntime();
    for (const definition of this.program.definitions) {
      this.emitDirectFunction(definition);
    }

    const main = this.definitions.get("main");
    if (!main) throw new Error('Expected a top-level function named "main".');
    const mainIndex = this.directFunctions.get("main");
    if (mainIndex === undefined) {
      throw new Error('Expected a compiled function named "main".');
    }
    this.builder.exportFunction("main", mainIndex);
    this.builder.exportMemory("memory");
    return {
      wasm: new Uint8Array(this.builder.module()),
      mainArity: main.params.length,
    };
  }

  private declareDirectFunctions(): void {
    for (const definition of this.program.definitions) {
      const typeIndex = this.builder.type(
        definition.params.map(() => ValType.I32),
        [ValType.I32],
      );
      const index = this.builder.declareFunction(typeIndex);
      this.directFunctions.set(definition.name, index);
    }
  }

  private emitRuntime(): void {
    this.builder.setFunctionBody(this.allocIndex, this.allocBody());
    this.builder.setFunctionBody(this.retainValueIndex, this.retainValueBody());
    this.builder.setFunctionBody(this.releaseEnvIndex, this.releaseEnvBody());
    this.builder.setFunctionBody(
      this.releaseValueIndex,
      this.releaseValueBody(),
    );
    this.builder.setFunctionBody(this.forceIndex, this.forceBody());
  }

  private emitDirectFunction(definition: Definition): void {
    const functionIndex = this.directFunctions.get(definition.name);
    if (functionIndex === undefined) {
      throw new Error(`Internal error: missing function ${definition.name}.`);
    }
    const body = new FunctionBody(definition.params.length);
    const context = new CodegenContext(this, body);
    for (const [index, param] of definition.params.entries()) {
      context.bind(param, { emitLoad: (out) => emitLocalGet(out, index) });
    }
    this.emitExpr(definition.body, context, body.code);
    this.builder.setFunctionBody(functionIndex, body.finish());
  }

  emitExpr(expr: Expr, context: CodegenContext, out: number[]): void {
    switch (expr.kind) {
      case "int":
        emitI32Const(out, tagInt(expr.value));
        break;
      case "name": {
        const binding = context.lookup(expr.name);
        if (!binding) {
          throw new Error(`Unknown value ${JSON.stringify(expr.name)}.`);
        }
        binding.emitLoad(out);
        break;
      }
      case "let":
        this.emitLet(expr, context, out);
        break;
      case "if":
        this.emitIf(expr, context, out);
        break;
      case "fun":
        this.emitClosure(expr, context, out);
        break;
      case "lazy":
        this.emitThunk(expr, context, out);
        break;
      case "force":
        this.emitExpr(expr.body, context, out);
        out.push(WasmInstruction.Call, ...u32(this.forceIndex));
        break;
      case "unary":
        this.emitExpr(expr.body, context, out);
        emitUntag(out);
        emitI32Const(out, -1);
        out.push(WasmInstruction.I32Mul);
        emitTag(out);
        break;
      case "binary":
        this.emitBinary(expr, context, out);
        break;
      case "call":
        this.emitCall(expr, context, out);
        break;
      case "tick":
        this.emitExpr(expr.value, context, out);
        this.emitCounterIncrement(out, COUNTER_TICKS);
        break;
    }
  }

  private emitLet(
    expr: Extract<Expr, { kind: "let" }>,
    context: CodegenContext,
    out: number[],
  ): void {
    const valueLocal = context.addLocal();
    this.emitExpr(expr.value, context, out);
    emitLocalSet(out, valueLocal);

    const previous = context.bind(expr.name, {
      emitLoad: (target) => emitLocalGet(target, valueLocal),
    });
    this.emitExpr(expr.body, context, out);
    const resultLocal = context.addLocal();
    emitLocalSet(out, resultLocal);
    emitLocalGet(out, resultLocal);
    out.push(WasmInstruction.Call, ...u32(this.retainValueIndex));
    emitLocalGet(out, valueLocal);
    out.push(WasmInstruction.Call, ...u32(this.releaseValueIndex));
    context.restore(expr.name, previous);
    emitLocalGet(out, resultLocal);
  }

  private emitIf(
    expr: Extract<Expr, { kind: "if" }>,
    context: CodegenContext,
    out: number[],
  ): void {
    void expr.hint;
    this.emitExpr(expr.condition, context, out);
    emitUntag(out);
    out.push(WasmInstruction.If, ValType.I32);
    this.emitExpr(expr.consequent, context, out);
    out.push(WasmInstruction.Else);
    this.emitExpr(expr.alternate, context, out);
    out.push(WasmInstruction.End);
  }

  private emitBinary(
    expr: Extract<Expr, { kind: "binary" }>,
    context: CodegenContext,
    out: number[],
  ): void {
    this.emitExpr(expr.left, context, out);
    emitUntag(out);
    this.emitExpr(expr.right, context, out);
    emitUntag(out);
    switch (expr.op) {
      case "add":
        out.push(WasmInstruction.I32Add);
        emitTag(out);
        break;
      case "sub":
        out.push(WasmInstruction.I32Sub);
        emitTag(out);
        break;
      case "mul":
        out.push(WasmInstruction.I32Mul);
        emitTag(out);
        break;
      case "div":
        out.push(WasmInstruction.I32DivS);
        emitTag(out);
        break;
      case "eq":
        out.push(WasmInstruction.I32Eq);
        emitTag(out);
        break;
      case "ne":
        out.push(WasmInstruction.I32Ne);
        emitTag(out);
        break;
      case "lt":
        out.push(WasmInstruction.I32LtS);
        emitTag(out);
        break;
      case "le":
        out.push(WasmInstruction.I32LeS);
        emitTag(out);
        break;
      case "gt":
        out.push(WasmInstruction.I32GtS);
        emitTag(out);
        break;
      case "ge":
        out.push(WasmInstruction.I32GeS);
        emitTag(out);
        break;
    }
  }

  private emitCall(
    expr: Extract<Expr, { kind: "call" }>,
    context: CodegenContext,
    out: number[],
  ): void {
    const directName = expr.callee.kind === "name" &&
        !context.lookup(expr.callee.name) &&
        this.directFunctions.has(expr.callee.name)
      ? expr.callee.name
      : undefined;

    let remaining = [...expr.argLists];
    if (directName && remaining.length > 0) {
      const args = remaining.shift() ?? [];
      const definition = this.definitions.get(directName);
      if (!definition) throw new Error(`Unknown function ${directName}.`);
      if (args.length !== definition.params.length) {
        throw new Error(
          `${directName} expects ${definition.params.length} argument(s), got ${args.length}.`,
        );
      }
      for (const arg of args) this.emitExpr(arg, context, out);
      out.push(
        WasmInstruction.Call,
        ...u32(this.directFunctions.get(directName)!),
      );
    } else {
      this.emitExpr(expr.callee, context, out);
    }

    for (const args of remaining) {
      if (args.length !== 1) {
        throw new Error("Closure calls in this example are unary.");
      }
      this.emitClosureApply(args[0], context, out);
    }
  }

  private emitClosureApply(
    arg: Expr,
    context: CodegenContext,
    out: number[],
  ): void {
    const closureLocal = context.addLocal();
    emitLocalSet(out, closureLocal);
    const argLocal = context.addLocal();
    this.emitExpr(arg, context, out);
    emitLocalSet(out, argLocal);

    emitLocalGet(out, closureLocal);
    emitLocalGet(out, argLocal);
    emitLocalGet(out, closureLocal);
    out.push(
      WasmInstruction.I32Load,
      WORD_ALIGN,
      ...u32(OBJECT_FUNCTION_ID),
      WasmInstruction.CallIndirect,
      ...u32(this.valueValueToValueType),
      0x00,
    );
  }

  private emitClosure(
    expr: Extract<Expr, { kind: "fun" }>,
    context: CodegenContext,
    out: number[],
  ): void {
    const captures = this.capturesFor(
      expr.body,
      context,
      new Set([expr.param]),
    );
    const bodyIndex = this.emitClosureBody(expr, captures);
    const tableIndex = this.builder.addTableFunction(bodyIndex);
    const size = CLOSURE_ENV_BASE + captures.length * 4;
    const ptrLocal = context.addLocal();

    emitI32Const(out, size);
    out.push(WasmInstruction.Call, ...u32(this.allocIndex));
    emitLocalSet(out, ptrLocal);
    emitStoreLocalConst(out, ptrLocal, HEADER_TAG, TAG_CLOSURE);
    emitStoreLocalConst(out, ptrLocal, HEADER_SIZE, size);
    emitStoreLocalConst(out, ptrLocal, HEADER_REFCOUNT, 1);
    emitStoreLocalConst(out, ptrLocal, OBJECT_FUNCTION_ID, tableIndex);
    emitStoreLocalConst(out, ptrLocal, OBJECT_ENV_COUNT, captures.length);
    emitStoreLocalConst(out, ptrLocal, CLOSURE_ARITY, 1);
    this.emitCaptureStores(captures, context, out, ptrLocal, CLOSURE_ENV_BASE);
    emitLocalGet(out, ptrLocal);
  }

  private emitThunk(
    expr: Extract<Expr, { kind: "lazy" }>,
    context: CodegenContext,
    out: number[],
  ): void {
    const captures = this.capturesFor(expr.body, context);
    const bodyIndex = this.emitThunkBody(expr.body, captures);
    const tableIndex = this.builder.addTableFunction(bodyIndex);
    const size = THUNK_ENV_BASE + captures.length * 4;
    const ptrLocal = context.addLocal();

    emitI32Const(out, size);
    out.push(WasmInstruction.Call, ...u32(this.allocIndex));
    emitLocalSet(out, ptrLocal);
    emitStoreLocalConst(out, ptrLocal, HEADER_TAG, TAG_THUNK);
    emitStoreLocalConst(out, ptrLocal, HEADER_SIZE, size);
    emitStoreLocalConst(out, ptrLocal, HEADER_REFCOUNT, 1);
    emitStoreLocalConst(out, ptrLocal, OBJECT_FUNCTION_ID, tableIndex);
    emitStoreLocalConst(out, ptrLocal, OBJECT_ENV_COUNT, captures.length);
    emitStoreLocalConst(out, ptrLocal, THUNK_STATE, THUNK_UNEVALUATED);
    emitStoreLocalConst(out, ptrLocal, THUNK_RESULT, 0);
    this.emitCaptureStores(captures, context, out, ptrLocal, THUNK_ENV_BASE);
    emitLocalGet(out, ptrLocal);
  }

  private emitCaptureStores(
    captures: readonly string[],
    context: CodegenContext,
    out: number[],
    ptrLocal: number,
    envBase: number,
  ): void {
    for (const [index, name] of captures.entries()) {
      const binding = context.lookup(name);
      if (!binding) {
        throw new Error(
          `Cannot capture unknown value ${JSON.stringify(name)}.`,
        );
      }
      emitLocalGet(out, ptrLocal);
      binding.emitLoad(out);
      out.push(
        WasmInstruction.I32Store,
        WORD_ALIGN,
        ...u32(envBase + index * 4),
      );
      binding.emitLoad(out);
      out.push(WasmInstruction.Call, ...u32(this.retainValueIndex));
    }
  }

  private emitClosureBody(
    expr: Extract<Expr, { kind: "fun" }>,
    captures: readonly string[],
  ): number {
    const functionIndex = this.builder.declareFunction(
      this.valueValueToValueType,
    );
    const body = new FunctionBody(2);
    const context = new CodegenContext(this, body);
    for (const [index, name] of captures.entries()) {
      context.bind(name, {
        emitLoad: (out) => {
          emitLocalGet(out, 0);
          out.push(
            WasmInstruction.I32Load,
            WORD_ALIGN,
            ...u32(CLOSURE_ENV_BASE + index * 4),
          );
        },
      });
    }
    context.bind(expr.param, { emitLoad: (out) => emitLocalGet(out, 1) });
    this.emitExpr(expr.body, context, body.code);
    this.builder.setFunctionBody(functionIndex, body.finish());
    return functionIndex;
  }

  private emitThunkBody(expr: Expr, captures: readonly string[]): number {
    const functionIndex = this.builder.declareFunction(this.valueToValueType);
    const body = new FunctionBody(1);
    const context = new CodegenContext(this, body);
    for (const [index, name] of captures.entries()) {
      context.bind(name, {
        emitLoad: (out) => {
          emitLocalGet(out, 0);
          out.push(
            WasmInstruction.I32Load,
            WORD_ALIGN,
            ...u32(THUNK_ENV_BASE + index * 4),
          );
        },
      });
    }
    this.emitExpr(expr, context, body.code);
    this.builder.setFunctionBody(functionIndex, body.finish());
    return functionIndex;
  }

  private capturesFor(
    expr: Expr,
    context: CodegenContext,
    additionallyBound: ReadonlySet<string> = new Set(),
  ): string[] {
    const names = [...freeVars(expr, additionallyBound, this.functionNames)];
    for (const name of names) {
      if (!context.lookup(name)) {
        throw new Error(`Unknown captured value ${JSON.stringify(name)}.`);
      }
    }
    return names.sort();
  }

  private allocBody(): EncodedFunctionBody {
    const body = new FunctionBody(1);
    const ptrLocal = body.addLocal();
    body.code.push(
      WasmInstruction.GlobalGet,
      ...u32(0),
      WasmInstruction.LocalSet,
      ...u32(ptrLocal),
    );
    body.code.push(
      WasmInstruction.GlobalGet,
      ...u32(0),
      WasmInstruction.LocalGet,
      ...u32(0),
      WasmInstruction.I32Add,
      WasmInstruction.GlobalSet,
      ...u32(0),
    );
    this.emitCounterIncrement(body.code, COUNTER_ALLOCATIONS);
    body.code.push(WasmInstruction.LocalGet, ...u32(ptrLocal));
    return body.finish();
  }

  private retainValueBody(): EncodedFunctionBody {
    const body = new FunctionBody(1);
    this.emitReturnIfImmediateOrNull(body.code, 0);
    body.code.push(
      WasmInstruction.LocalGet,
      ...u32(0),
      WasmInstruction.LocalGet,
      ...u32(0),
      WasmInstruction.I32Load,
      WORD_ALIGN,
      ...u32(HEADER_REFCOUNT),
      WasmInstruction.I32Const,
      ...i32(1),
      WasmInstruction.I32Add,
      WasmInstruction.I32Store,
      WORD_ALIGN,
      ...u32(HEADER_REFCOUNT),
    );
    return body.finish();
  }

  private releaseEnvBody(): EncodedFunctionBody {
    const body = new FunctionBody(3);
    const indexLocal = body.addLocal();
    body.code.push(
      WasmInstruction.I32Const,
      ...i32(0),
      WasmInstruction.LocalSet,
      ...u32(indexLocal),
    );
    body.code.push(
      WasmInstruction.Block,
      BlockType.Empty,
      WasmInstruction.Loop,
      BlockType.Empty,
    );
    body.code.push(
      WasmInstruction.LocalGet,
      ...u32(indexLocal),
      WasmInstruction.LocalGet,
      ...u32(2),
      WasmInstruction.I32GeU,
      WasmInstruction.BrIf,
      ...u32(1),
    );
    body.code.push(
      WasmInstruction.LocalGet,
      ...u32(0),
      WasmInstruction.LocalGet,
      ...u32(1),
      WasmInstruction.I32Add,
      WasmInstruction.LocalGet,
      ...u32(indexLocal),
      WasmInstruction.I32Const,
      ...i32(4),
      WasmInstruction.I32Mul,
      WasmInstruction.I32Add,
      WasmInstruction.I32Load,
      WORD_ALIGN,
      ...u32(0),
      WasmInstruction.Call,
      ...u32(this.releaseValueIndex),
    );
    body.code.push(
      WasmInstruction.LocalGet,
      ...u32(indexLocal),
      WasmInstruction.I32Const,
      ...i32(1),
      WasmInstruction.I32Add,
      WasmInstruction.LocalSet,
      ...u32(indexLocal),
      WasmInstruction.Br,
      ...u32(0),
      WasmInstruction.End,
      WasmInstruction.End,
    );
    return body.finish();
  }

  private releaseValueBody(): EncodedFunctionBody {
    const body = new FunctionBody(1);
    const nextRefcount = body.addLocal();
    const tagLocal = body.addLocal();
    this.emitReturnIfImmediateOrNull(body.code, 0);

    body.code.push(
      WasmInstruction.LocalGet,
      ...u32(0),
      WasmInstruction.I32Load,
      WORD_ALIGN,
      ...u32(HEADER_REFCOUNT),
      WasmInstruction.I32Const,
      ...i32(1),
      WasmInstruction.I32Sub,
      WasmInstruction.LocalSet,
      ...u32(nextRefcount),
    );
    body.code.push(
      WasmInstruction.LocalGet,
      ...u32(0),
      WasmInstruction.LocalGet,
      ...u32(nextRefcount),
      WasmInstruction.I32Store,
      WORD_ALIGN,
      ...u32(HEADER_REFCOUNT),
      WasmInstruction.LocalGet,
      ...u32(nextRefcount),
      WasmInstruction.I32Const,
      ...i32(0),
      WasmInstruction.I32Ne,
      WasmInstruction.If,
      BlockType.Empty,
      WasmInstruction.Return,
      WasmInstruction.End,
    );

    this.emitCounterIncrement(body.code, COUNTER_RELEASES);
    body.code.push(
      WasmInstruction.LocalGet,
      ...u32(0),
      WasmInstruction.I32Load,
      WORD_ALIGN,
      ...u32(HEADER_TAG),
      WasmInstruction.LocalSet,
      ...u32(tagLocal),
    );

    body.code.push(
      WasmInstruction.LocalGet,
      ...u32(tagLocal),
      WasmInstruction.I32Const,
      ...i32(TAG_CLOSURE),
      WasmInstruction.I32Eq,
      WasmInstruction.If,
      BlockType.Empty,
      WasmInstruction.LocalGet,
      ...u32(0),
      WasmInstruction.I32Const,
      ...i32(CLOSURE_ENV_BASE),
      WasmInstruction.LocalGet,
      ...u32(0),
      WasmInstruction.I32Load,
      WORD_ALIGN,
      ...u32(OBJECT_ENV_COUNT),
      WasmInstruction.Call,
      ...u32(this.releaseEnvIndex),
      WasmInstruction.Else,
      WasmInstruction.LocalGet,
      ...u32(tagLocal),
      WasmInstruction.I32Const,
      ...i32(TAG_THUNK),
      WasmInstruction.I32Eq,
      WasmInstruction.If,
      BlockType.Empty,
      WasmInstruction.LocalGet,
      ...u32(0),
      WasmInstruction.I32Load,
      WORD_ALIGN,
      ...u32(THUNK_STATE),
      WasmInstruction.I32Const,
      ...i32(THUNK_EVALUATED),
      WasmInstruction.I32Eq,
      WasmInstruction.If,
      BlockType.Empty,
      WasmInstruction.LocalGet,
      ...u32(0),
      WasmInstruction.I32Load,
      WORD_ALIGN,
      ...u32(THUNK_RESULT),
      WasmInstruction.Call,
      ...u32(this.releaseValueIndex),
      WasmInstruction.End,
      WasmInstruction.LocalGet,
      ...u32(0),
      WasmInstruction.I32Const,
      ...i32(THUNK_ENV_BASE),
      WasmInstruction.LocalGet,
      ...u32(0),
      WasmInstruction.I32Load,
      WORD_ALIGN,
      ...u32(OBJECT_ENV_COUNT),
      WasmInstruction.Call,
      ...u32(this.releaseEnvIndex),
      WasmInstruction.End,
      WasmInstruction.End,
    );
    emitStoreLocalConst(body.code, 0, HEADER_TAG, TAG_FREE);
    return body.finish();
  }

  private forceBody(): EncodedFunctionBody {
    const body = new FunctionBody(1);
    const resultLocal = body.addLocal();

    body.code.push(
      WasmInstruction.LocalGet,
      ...u32(0),
      WasmInstruction.I32Load,
      WORD_ALIGN,
      ...u32(THUNK_STATE),
      WasmInstruction.I32Const,
      ...i32(THUNK_EVALUATED),
      WasmInstruction.I32Eq,
      WasmInstruction.If,
      BlockType.Empty,
      WasmInstruction.LocalGet,
      ...u32(0),
      WasmInstruction.I32Load,
      WORD_ALIGN,
      ...u32(THUNK_RESULT),
      WasmInstruction.LocalSet,
      ...u32(resultLocal),
      WasmInstruction.LocalGet,
      ...u32(resultLocal),
      WasmInstruction.Call,
      ...u32(this.retainValueIndex),
      WasmInstruction.LocalGet,
      ...u32(resultLocal),
      WasmInstruction.Return,
      WasmInstruction.End,
    );

    body.code.push(
      WasmInstruction.LocalGet,
      ...u32(0),
      WasmInstruction.I32Load,
      WORD_ALIGN,
      ...u32(THUNK_STATE),
      WasmInstruction.I32Const,
      ...i32(THUNK_EVALUATING),
      WasmInstruction.I32Eq,
      WasmInstruction.If,
      BlockType.Empty,
      WasmInstruction.Unreachable,
      WasmInstruction.End,
    );

    emitStoreLocalConst(body.code, 0, THUNK_STATE, THUNK_EVALUATING);
    body.code.push(
      WasmInstruction.LocalGet,
      ...u32(0),
      WasmInstruction.LocalGet,
      ...u32(0),
      WasmInstruction.I32Load,
      WORD_ALIGN,
      ...u32(OBJECT_FUNCTION_ID),
      WasmInstruction.CallIndirect,
      ...u32(this.valueToValueType),
      0x00,
      WasmInstruction.LocalSet,
      ...u32(resultLocal),
    );
    body.code.push(
      WasmInstruction.LocalGet,
      ...u32(resultLocal),
      WasmInstruction.Call,
      ...u32(this.retainValueIndex),
      WasmInstruction.LocalGet,
      ...u32(0),
      WasmInstruction.LocalGet,
      ...u32(resultLocal),
      WasmInstruction.I32Store,
      WORD_ALIGN,
      ...u32(THUNK_RESULT),
    );
    emitStoreLocalConst(body.code, 0, THUNK_STATE, THUNK_EVALUATED);
    body.code.push(
      WasmInstruction.LocalGet,
      ...u32(0),
      WasmInstruction.I32Const,
      ...i32(THUNK_ENV_BASE),
      WasmInstruction.LocalGet,
      ...u32(0),
      WasmInstruction.I32Load,
      WORD_ALIGN,
      ...u32(OBJECT_ENV_COUNT),
      WasmInstruction.Call,
      ...u32(this.releaseEnvIndex),
    );
    emitStoreLocalConst(body.code, 0, OBJECT_ENV_COUNT, 0);
    body.code.push(
      WasmInstruction.LocalGet,
      ...u32(resultLocal),
      WasmInstruction.Call,
      ...u32(this.retainValueIndex),
      WasmInstruction.LocalGet,
      ...u32(resultLocal),
    );
    return body.finish();
  }

  private emitReturnIfImmediateOrNull(out: number[], local: number): void {
    out.push(
      WasmInstruction.LocalGet,
      ...u32(local),
      WasmInstruction.I32Const,
      ...i32(1),
      WasmInstruction.I32And,
      WasmInstruction.If,
      BlockType.Empty,
      WasmInstruction.Return,
      WasmInstruction.End,
      WasmInstruction.LocalGet,
      ...u32(local),
      WasmInstruction.I32Eqz,
      WasmInstruction.If,
      BlockType.Empty,
      WasmInstruction.Return,
      WasmInstruction.End,
    );
  }

  private emitCounterIncrement(out: number[], offset: number): void {
    emitI32Const(out, 0);
    emitI32Const(out, 0);
    out.push(
      WasmInstruction.I32Load,
      WORD_ALIGN,
      ...u32(offset),
      WasmInstruction.I32Const,
      ...i32(1),
      WasmInstruction.I32Add,
      WasmInstruction.I32Store,
      WORD_ALIGN,
      ...u32(offset),
    );
  }
}

interface Binding {
  emitLoad(out: number[]): void;
}

class CodegenContext {
  private readonly bindings = new Map<string, Binding>();

  constructor(
    readonly compiler: Compiler,
    private readonly body: FunctionBody,
  ) {}

  addLocal(): number {
    return this.body.addLocal();
  }

  bind(name: string, binding: Binding): Binding | undefined {
    const previous = this.bindings.get(name);
    this.bindings.set(name, binding);
    return previous;
  }

  restore(name: string, previous: Binding | undefined): void {
    if (previous) this.bindings.set(name, previous);
    else this.bindings.delete(name);
  }

  lookup(name: string): Binding | undefined {
    return this.bindings.get(name);
  }
}

interface EncodedFunctionBody {
  localCount: number;
  code: readonly number[];
}

class FunctionBody {
  readonly code: number[] = [];
  private localCount = 0;

  constructor(readonly paramCount: number) {}

  addLocal(): number {
    const local = this.paramCount + this.localCount;
    this.localCount += 1;
    return local;
  }

  finish(): EncodedFunctionBody {
    return { localCount: this.localCount, code: this.code };
  }
}

class WasmBuilder {
  private readonly types: {
    params: readonly number[];
    results: readonly number[];
  }[] = [];
  private readonly functions: {
    typeIndex: number;
    body?: EncodedFunctionBody;
  }[] = [];
  private readonly tableFunctions: number[] = [];
  private readonly exports: {
    name: string;
    kind: ExternalKind;
    index: number;
  }[] = [];

  type(params: readonly number[], results: readonly number[]): number {
    const existing = this.types.findIndex((type) =>
      sameList(type.params, params) && sameList(type.results, results)
    );
    if (existing >= 0) return existing;
    this.types.push({ params: [...params], results: [...results] });
    return this.types.length - 1;
  }

  declareFunction(typeIndex: number): number {
    const index = this.functions.length;
    this.functions.push({ typeIndex });
    return index;
  }

  setFunctionBody(index: number, body: EncodedFunctionBody): void {
    const func = this.functions[index];
    if (!func) {
      throw new Error(`Internal error: unknown function index ${index}.`);
    }
    func.body = body;
  }

  addTableFunction(functionIndex: number): number {
    const tableIndex = this.tableFunctions.length;
    this.tableFunctions.push(functionIndex);
    return tableIndex;
  }

  exportFunction(name: string, index: number): void {
    this.exports.push({ name, kind: ExternalKind.Function, index });
  }

  exportMemory(name: string): void {
    this.exports.push({ name, kind: ExternalKind.Memory, index: 0 });
  }

  module(): number[] {
    for (const [index, func] of this.functions.entries()) {
      if (!func.body) {
        throw new Error(`Internal error: function ${index} has no body.`);
      }
    }
    return [
      ...WASM_MAGIC,
      ...WASM_VERSION,
      ...section(Section.Type, this.typeSection()),
      ...section(Section.Function, this.functionSection()),
      ...section(Section.Table, this.tableSection()),
      ...section(Section.Memory, this.memorySection()),
      ...section(Section.Global, this.globalSection()),
      ...section(Section.Export, this.exportSection()),
      ...(this.tableFunctions.length > 0
        ? section(Section.Element, this.elementSection())
        : []),
      ...section(Section.Code, this.codeSection()),
    ];
  }

  private typeSection(): number[] {
    return vec(this.types.map((type) => funcType(type.params, type.results)));
  }

  private functionSection(): number[] {
    return vec(this.functions.map((func) => u32(func.typeIndex)));
  }

  private tableSection(): number[] {
    const min = Math.max(1, this.tableFunctions.length);
    return vec([[ValType.FuncRef, LimitsFlag.MinOnly, ...u32(min)]]);
  }

  private memorySection(): number[] {
    return vec([[LimitsFlag.MinOnly, ...u32(1)]]);
  }

  private globalSection(): number[] {
    return vec([[
      ValType.I32,
      Mutability.Var,
      WasmInstruction.I32Const,
      ...i32(HEAP_START),
      WasmInstruction.End,
    ]]);
  }

  private exportSection(): number[] {
    return vec(
      this.exports.map((item) => [
        ...name(item.name),
        item.kind,
        ...u32(item.index),
      ]),
    );
  }

  private elementSection(): number[] {
    return vec([[
      0x00,
      WasmInstruction.I32Const,
      ...i32(0),
      WasmInstruction.End,
      ...vec(this.tableFunctions.map((index) => u32(index))),
    ]]);
  }

  private codeSection(): number[] {
    return vec(this.functions.map((func) => encodeBody(func.body!)));
  }
}

function parseProgram(source: string): Program {
  const parsed = parse(source, { preserveTrivia: false });
  if (!parsed.ok || !parsed.root) {
    const diagnostics = parsed.diagnostics.map((diagnostic) =>
      `${diagnostic.code} at ${diagnostic.span.start}: ${diagnostic.message}`
    ).join("\n");
    throw new Error(`Parse failed:\n${diagnostics}`);
  }

  const definitions = parsed.root.children.filter(isRuleNode).map(
    parseDefinition,
  );
  return { definitions };
}

function parseDefinition(node: AnyRuleNode): Definition {
  if (node.name !== "definition") {
    throw new Error(`Expected definition, got ${node.name}.`);
  }
  const fields = node.fields as {
    name: { text: string };
    params: readonly { text: string }[];
    body: AnyRuleNode;
  };
  return {
    name: fields.name.text,
    params: fields.params.map((param) => param.text),
    body: parseExpr(fields.body),
  };
}

function parseExpr(node: AnyRuleNode): Expr {
  switch (node.name) {
    case "expr":
    case "primary":
    case "unary":
      return parseExpr(childRule(node));
    case "let_expr": {
      const fields = node.fields as {
        name: { text: string };
        value: AnyRuleNode;
        body: AnyRuleNode;
      };
      return {
        kind: "let",
        name: fields.name.text,
        value: parseExpr(fields.value),
        body: parseExpr(fields.body),
      };
    }
    case "if_expr": {
      const fields = node.fields as {
        hint?: AnyRuleNode;
        condition: AnyRuleNode;
        consequent: AnyRuleNode;
        alternate: AnyRuleNode;
      };
      const hint = fields.hint ? childRule(fields.hint).name : undefined;
      return {
        kind: "if",
        hint: hint === "likely" || hint === "unlikely" ? hint : undefined,
        condition: parseExpr(fields.condition),
        consequent: parseExpr(fields.consequent),
        alternate: parseExpr(fields.alternate),
      };
    }
    case "fun_expr": {
      const fields = node.fields as {
        param: { text: string };
        body: AnyRuleNode;
      };
      return {
        kind: "fun",
        param: fields.param.text,
        body: parseExpr(fields.body),
      };
    }
    case "lazy_expr":
      return {
        kind: "lazy",
        body: parseExpr((node.fields as { body: AnyRuleNode }).body),
      };
    case "force_expr":
      return {
        kind: "force",
        body: parseExpr((node.fields as { body: AnyRuleNode }).body),
      };
    case "equality":
      return foldBinary(
        node,
        "left",
        "rest",
        (name) => name === "eq" ? "eq" : "ne",
      );
    case "comparison":
      return foldBinary(node, "left", "rest", comparisonOperator);
    case "additive":
      return foldBinary(
        node,
        "left",
        "rest",
        (name) => name === "plus" ? "add" : "sub",
      );
    case "multiplicative":
      return foldBinary(
        node,
        "left",
        "rest",
        (name) => name === "star" ? "mul" : "div",
      );
    case "negate":
      return {
        kind: "unary",
        op: "neg",
        body: parseExpr((node.fields as { body: AnyRuleNode }).body),
      };
    case "call": {
      const fields = node.fields as {
        callee: AnyRuleNode;
        args: readonly AnyRuleNode[];
      };
      return {
        kind: "call",
        callee: parseExpr(fields.callee),
        argLists: fields.args.map(parseCallArguments),
      };
    }
    case "integer":
      return {
        kind: "int",
        value: integer((node.fields as { value: { text: string } }).value.text),
      };
    case "variable":
      return {
        kind: "name",
        name: (node.fields as { name: { text: string } }).name.text,
      };
    case "tick":
      return {
        kind: "tick",
        value: parseExpr((node.fields as { value: AnyRuleNode }).value),
      };
    case "group":
      return parseExpr((node.fields as { body: AnyRuleNode }).body);
    default:
      throw new Error(`Unsupported syntax node ${node.name}.`);
  }
}

function foldBinary(
  node: AnyRuleNode,
  leftField: string,
  restField: string,
  opFromName: (name: string) => BinaryOp,
): Expr {
  const fields = node.fields as Record<string, unknown>;
  let expr = parseExpr(fields[leftField] as AnyRuleNode);
  for (const tail of fields[restField] as readonly AnyRuleNode[]) {
    const tailFields = tail.fields as { op: AnyRuleNode; right: AnyRuleNode };
    expr = {
      kind: "binary",
      op: opFromName(childRule(tailFields.op).name),
      left: expr,
      right: parseExpr(tailFields.right),
    };
  }
  return expr;
}

function comparisonOperator(name: string): BinaryOp {
  switch (name) {
    case "lt":
      return "lt";
    case "le":
      return "le";
    case "gt":
      return "gt";
    case "ge":
      return "ge";
    default:
      throw new Error(`Unknown comparison operator ${name}.`);
  }
}

function parseCallArguments(node: AnyRuleNode): readonly Expr[] {
  const values = (node.fields as { values?: AnyRuleNode }).values;
  if (!values) return [];
  const fields = values.fields as {
    head: AnyRuleNode;
    tail: readonly AnyRuleNode[];
  };
  return [
    parseExpr(fields.head),
    ...fields.tail.map((tail) =>
      parseExpr((tail.fields as { value: AnyRuleNode }).value)
    ),
  ];
}

function freeVars(
  expr: Expr,
  bound: ReadonlySet<string>,
  functionNames: ReadonlySet<string>,
): Set<string> {
  const result = new Set<string>();
  const addAll = (values: Set<string>) => {
    for (const value of values) result.add(value);
  };
  switch (expr.kind) {
    case "int":
      break;
    case "name":
      if (!bound.has(expr.name) && !functionNames.has(expr.name)) {
        result.add(expr.name);
      }
      break;
    case "let": {
      addAll(freeVars(expr.value, bound, functionNames));
      const next = new Set(bound);
      next.add(expr.name);
      addAll(freeVars(expr.body, next, functionNames));
      break;
    }
    case "if":
      addAll(freeVars(expr.condition, bound, functionNames));
      addAll(freeVars(expr.consequent, bound, functionNames));
      addAll(freeVars(expr.alternate, bound, functionNames));
      break;
    case "fun": {
      const next = new Set(bound);
      next.add(expr.param);
      addAll(freeVars(expr.body, next, functionNames));
      break;
    }
    case "lazy":
    case "force":
    case "unary":
      addAll(freeVars(expr.body, bound, functionNames));
      break;
    case "tick":
      addAll(freeVars(expr.value, bound, functionNames));
      break;
    case "binary":
      addAll(freeVars(expr.left, bound, functionNames));
      addAll(freeVars(expr.right, bound, functionNames));
      break;
    case "call": {
      const directCall = expr.callee.kind === "name" &&
        functionNames.has(expr.callee.name) &&
        !bound.has(expr.callee.name);
      if (!directCall) addAll(freeVars(expr.callee, bound, functionNames));
      for (const args of expr.argLists) {
        for (const arg of args) addAll(freeVars(arg, bound, functionNames));
      }
      break;
    }
  }
  return result;
}

function sameList(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function encodeBody(body: EncodedFunctionBody): number[] {
  const locals = body.localCount === 0
    ? vec([])
    : vec([[...u32(body.localCount), ValType.I32]]);
  return sized([...locals, ...body.code, WasmInstruction.End]);
}

function section(id: Section, payload: readonly number[]): number[] {
  return [id, ...u32(payload.length), ...payload];
}

function funcType(
  params: readonly number[],
  results: readonly number[],
): number[] {
  return [
    TypeForm.Function,
    ...vec(params.map((param) => [param])),
    ...vec(results.map((result) => [result])),
  ];
}

function vec(items: readonly (readonly number[])[]): number[] {
  return [...u32(items.length), ...items.flat()];
}

function sized(bytes: readonly number[]): number[] {
  return [...u32(bytes.length), ...bytes];
}

function name(value: string): number[] {
  const bytes = new TextEncoder().encode(value);
  return [...u32(bytes.length), ...bytes];
}

function emitLocalGet(out: number[], local: number): void {
  out.push(WasmInstruction.LocalGet, ...u32(local));
}

function emitLocalSet(out: number[], local: number): void {
  out.push(WasmInstruction.LocalSet, ...u32(local));
}

function emitStoreLocalConst(
  out: number[],
  local: number,
  offset: number,
  value: number,
): void {
  emitLocalGet(out, local);
  emitI32Const(out, value);
  out.push(WasmInstruction.I32Store, WORD_ALIGN, ...u32(offset));
}

function emitI32Const(out: number[], value: number): void {
  out.push(WasmInstruction.I32Const, ...i32(value));
}

function emitTag(out: number[]): void {
  emitI32Const(out, 1);
  out.push(WasmInstruction.I32Shl);
  emitI32Const(out, 1);
  out.push(WasmInstruction.I32Or);
}

function emitUntag(out: number[]): void {
  emitI32Const(out, 1);
  out.push(WasmInstruction.I32ShrS);
}

function tagInt(value: number): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Invalid integer ${value}.`);
  }
  return value * 2 + 1;
}

function formatValue(value: number): number | string {
  return (value & 1) === 1 ? (value >> 1) : `<ptr ${value}>`;
}

function integer(text: string): number {
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Invalid integer ${JSON.stringify(text)}.`);
  }
  return value;
}

function u32(value: number): number[] {
  const bytes: number[] = [];
  do {
    let byte = value & LEB_VALUE_MASK;
    value >>>= 7;
    if (value !== 0) byte |= LEB_CONTINUATION_BIT;
    bytes.push(byte);
  } while (value !== 0);
  return bytes;
}

function i32(value: number): number[] {
  const bytes: number[] = [];
  let more = true;
  while (more) {
    let byte = value & LEB_VALUE_MASK;
    value >>= 7;
    const sign = (byte & LEB_SIGN_BIT) !== 0;
    more = !((value === 0 && !sign) || (value === -1 && sign));
    if (more) byte |= LEB_CONTINUATION_BIT;
    bytes.push(byte);
  }
  return bytes;
}

function childRule(node: AnyRuleNode): AnyRuleNode {
  const child = node.children.find(isRuleNode);
  if (!child) throw new Error(`Expected child rule for ${node.name}.`);
  return child;
}

function isRuleNode(node: SyntaxElement): node is AnyRuleNode {
  return node.type === "rule";
}

async function main(): Promise<void> {
  const args = [...Deno.args];
  const emitIndex = args.indexOf("--emit");
  const emitPath = emitIndex >= 0 ? args[emitIndex + 1] : undefined;
  if (emitIndex >= 0) {
    if (!emitPath) throw new Error("Expected path after --emit.");
    args.splice(emitIndex, 2);
  }

  const path = args.shift() ?? "programs/cached.tw";
  const source = await Deno.readTextFile(path);
  const numericArgs = args.map((arg) => integer(arg));
  const result = await runThunkWasm(source, numericArgs);
  if (emitPath) await Deno.writeFile(emitPath, result.wasm);
  const lines = [
    `result: ${result.result}`,
    `ticks: ${result.ticks}`,
    `allocations: ${result.allocations}`,
    `releases: ${result.releases}`,
  ];
  if (emitPath) lines.push(`wasm: ${emitPath}`);
  await Deno.stdout.write(new TextEncoder().encode(`${lines.join("\n")}\n`));
}

if (import.meta.main) {
  await main();
}
