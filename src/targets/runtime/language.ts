export const RUNTIME_LANGUAGE_VERSION = 1 as const;
export const RUNTIME_LANGUAGE_SEMANTICS = "baba-runtime-language-v1" as const;

export interface RuntimeLanguageProgram {
  readonly name: string;
  readonly entry: string;
  readonly scratchMemoryWords?: number;
  readonly tables?: readonly RuntimeLanguageTable[];
  readonly functions: readonly RuntimeLanguageFunction[];
}

export interface RuntimeLanguageTable {
  readonly name: string;
  readonly type: RuntimeScalarType;
  readonly values: readonly number[];
}

export interface RuntimeLanguageFunction {
  readonly name: string;
  readonly parameters?: readonly RuntimeLanguageVariable[];
  readonly locals?: readonly RuntimeLanguageVariable[];
  readonly result: RuntimeScalarType;
  readonly body: readonly RuntimeStatement[];
}

export interface RuntimeLanguageVariable {
  readonly name: string;
  readonly type: RuntimeScalarType;
}

export interface RuntimeLanguageIrProgram {
  readonly source: RuntimeLanguageProgram;
  readonly name: string;
  readonly entry: string;
  readonly entryFunction: RuntimeIrFunction;
  readonly functions: readonly RuntimeIrFunction[];
  readonly functionMap: ReadonlyMap<string, RuntimeIrFunction>;
  readonly tables: readonly RuntimeLanguageTable[];
  readonly tableMap: ReadonlyMap<string, RuntimeLanguageTable>;
  readonly hasScratchMemory: boolean;
  readonly scratchMemoryWords: number;
}

export interface RuntimeIrFunction {
  readonly source: RuntimeLanguageFunction;
  readonly name: string;
  readonly parameters: readonly RuntimeLanguageVariable[];
  readonly locals: readonly RuntimeLanguageVariable[];
  readonly localMap: ReadonlyMap<string, RuntimeLanguageVariable>;
  readonly localIndexMap: ReadonlyMap<string, number>;
  readonly result: RuntimeScalarType;
  readonly body: readonly RuntimeIrStatement[];
}

export type RuntimeScalarType = "u32";

export type RuntimeBinaryOperator =
  | "addU32"
  | "subU32"
  | "mulU32"
  | "divU32"
  | "andU32"
  | "eqU32"
  | "ltS32"
  | "shlU32"
  | "shrU32";

export type RuntimeStatement =
  | {
    readonly kind: "return";
    readonly expression: RuntimeExpression;
  }
  | {
    readonly kind: "trap";
  }
  | {
    readonly kind: "setLocal";
    readonly name: string;
    readonly expression: RuntimeExpression;
  }
  | {
    readonly kind: "storeScratchU32";
    readonly index: RuntimeExpression;
    readonly value: RuntimeExpression;
  }
  | {
    readonly kind: "if";
    readonly condition: RuntimeExpression;
    readonly consequent: readonly RuntimeStatement[];
    readonly alternate?: readonly RuntimeStatement[];
  }
  | {
    readonly kind: "while";
    readonly condition: RuntimeExpression;
    readonly body: readonly RuntimeStatement[];
  };

export type RuntimeExpression =
  | {
    readonly kind: "u32";
    readonly value: number;
  }
  | {
    readonly kind: "local";
    readonly name: string;
  }
  | {
    readonly kind: "call";
    readonly function: string;
    readonly args: readonly RuntimeExpression[];
  }
  | {
    readonly kind: "loadTableU32";
    readonly table: string;
    readonly index: RuntimeExpression;
  }
  | {
    readonly kind: "loadScratchU32";
    readonly index: RuntimeExpression;
  }
  | {
    readonly kind: "ensureScratchWords";
    readonly words: RuntimeExpression;
  }
  | {
    readonly kind: RuntimeBinaryOperator;
    readonly left: RuntimeExpression;
    readonly right: RuntimeExpression;
  };

export type RuntimeIrStatement =
  | {
    readonly kind: "return";
    readonly expression: RuntimeIrExpression;
  }
  | {
    readonly kind: "trap";
  }
  | {
    readonly kind: "setLocal";
    readonly variable: RuntimeLanguageVariable;
    readonly localIndex: number;
    readonly expression: RuntimeIrExpression;
  }
  | {
    readonly kind: "storeScratchU32";
    readonly index: RuntimeIrExpression;
    readonly value: RuntimeIrExpression;
  }
  | {
    readonly kind: "if";
    readonly condition: RuntimeIrExpression;
    readonly consequent: readonly RuntimeIrStatement[];
    readonly alternate: readonly RuntimeIrStatement[];
  }
  | {
    readonly kind: "while";
    readonly condition: RuntimeIrExpression;
    readonly body: readonly RuntimeIrStatement[];
  };

export type RuntimeIrExpression =
  | {
    readonly kind: "u32";
    readonly value: number;
  }
  | {
    readonly kind: "local";
    readonly variable: RuntimeLanguageVariable;
    readonly localIndex: number;
  }
  | {
    readonly kind: "call";
    readonly functionName: string;
    readonly functionIndex: number;
    readonly target: RuntimeLanguageFunction;
    readonly args: readonly RuntimeIrExpression[];
  }
  | {
    readonly kind: "loadTableU32";
    readonly tableName: string;
    readonly tableIndex: number;
    readonly table: RuntimeLanguageTable;
    readonly index: RuntimeIrExpression;
  }
  | {
    readonly kind: "loadScratchU32";
    readonly index: RuntimeIrExpression;
  }
  | {
    readonly kind: "ensureScratchWords";
    readonly words: RuntimeIrExpression;
  }
  | {
    readonly kind: RuntimeBinaryOperator;
    readonly left: RuntimeIrExpression;
    readonly right: RuntimeIrExpression;
  };

export class RuntimeLanguageTrap extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeLanguageTrap";
  }
}

const WASM_PAGE_SIZE = 65_536;
const MAX_WASM_PAGES = 65_535;

export interface RuntimeLanguageTypeScriptFunctionOptions {
  readonly exported?: boolean;
}

export interface RuntimeLanguageWasmCompileOptions {
  readonly exports?: readonly string[];
}

export function emitRuntimeLanguageTypeScript(
  program: RuntimeLanguageProgram,
): string {
  const ir = compileRuntimeLanguageIr(program);
  return `// Generated by @mewhhaha/baba runtime-language stage 0.
export const runtimeLanguageVersion = ${RUNTIME_LANGUAGE_VERSION};
export const runtimeLanguageSemantics = ${
    JSON.stringify(RUNTIME_LANGUAGE_SEMANTICS)
  } as const;

${emitTypeScriptRuntime(ir, { exportEntry: true })}
`;
}

export function emitRuntimeLanguageTypeScriptFunction(
  program: RuntimeLanguageProgram,
  options: RuntimeLanguageTypeScriptFunctionOptions = {},
): string {
  const ir = compileRuntimeLanguageIr(program);
  return emitTypeScriptRuntime(ir, { exportEntry: options.exported });
}

export function compileRuntimeLanguageIr(
  program: RuntimeLanguageProgram,
): RuntimeLanguageIrProgram {
  validateRuntimeLanguageProgram(program);
  const sourceFunctions = runtimeLanguageFunctions(program);
  const tables = runtimeLanguageTables(program);
  const sourceFunctionMap = new Map(
    sourceFunctions.map((fn) => [fn.name, fn]),
  );
  const sourceFunctionIndexes = new Map(
    sourceFunctions.map((fn, index) => [fn.name, index]),
  );
  const tableMap = new Map(tables.map((table) => [table.name, table]));
  const tableIndexes = new Map(
    tables.map((table, index) => [table.name, index]),
  );
  const functions = sourceFunctions.map((fn) =>
    lowerRuntimeLanguageFunction(
      fn,
      sourceFunctionMap,
      sourceFunctionIndexes,
      tableMap,
      tableIndexes,
    )
  );
  const functionMap = new Map(functions.map((fn) => [fn.name, fn]));
  const entryFunction = functionMap.get(program.entry);
  if (!entryFunction) {
    throw new Error(
      `Runtime-language program '${program.name}' has no function '${program.entry}'.`,
    );
  }
  const hasScratchMemory = runtimeLanguageHasScratchMemory(program);
  const scratchMemoryWords = runtimeLanguageScratchMemoryWords(program);
  return {
    source: program,
    name: program.name,
    entry: program.entry,
    entryFunction,
    functions,
    functionMap,
    tables,
    tableMap,
    hasScratchMemory,
    scratchMemoryWords,
  };
}

function lowerRuntimeLanguageFunction(
  fn: RuntimeLanguageFunction,
  functions: ReadonlyMap<string, RuntimeLanguageFunction>,
  functionIndexes: ReadonlyMap<string, number>,
  tables: ReadonlyMap<string, RuntimeLanguageTable>,
  tableIndexes: ReadonlyMap<string, number>,
): RuntimeIrFunction {
  const parameters = functionParameters(fn);
  const locals = functionLocals(fn);
  const localMap = new Map(
    [...parameters, ...locals].map((variable) => [variable.name, variable]),
  );
  const indexes = localIndexMap(parameters, locals);
  return {
    source: fn,
    name: fn.name,
    parameters,
    locals,
    localMap,
    localIndexMap: indexes,
    result: fn.result,
    body: fn.body.map((statement) =>
      lowerRuntimeStatement(
        statement,
        localMap,
        indexes,
        functions,
        functionIndexes,
        tables,
        tableIndexes,
      )
    ),
  };
}

function lowerRuntimeStatement(
  statement: RuntimeStatement,
  locals: ReadonlyMap<string, RuntimeLanguageVariable>,
  localIndexes: ReadonlyMap<string, number>,
  functions: ReadonlyMap<string, RuntimeLanguageFunction>,
  functionIndexes: ReadonlyMap<string, number>,
  tables: ReadonlyMap<string, RuntimeLanguageTable>,
  tableIndexes: ReadonlyMap<string, number>,
): RuntimeIrStatement {
  switch (statement.kind) {
    case "trap":
      return statement;
    case "return":
      return {
        kind: "return",
        expression: lowerRuntimeExpression(
          statement.expression,
          locals,
          localIndexes,
          functions,
          functionIndexes,
          tables,
          tableIndexes,
        ),
      };
    case "setLocal":
      return {
        kind: "setLocal",
        variable: requiredRuntimeLocal(locals, statement.name),
        localIndex: localIndex(statement.name, localIndexes),
        expression: lowerRuntimeExpression(
          statement.expression,
          locals,
          localIndexes,
          functions,
          functionIndexes,
          tables,
          tableIndexes,
        ),
      };
    case "storeScratchU32":
      return {
        kind: "storeScratchU32",
        index: lowerRuntimeExpression(
          statement.index,
          locals,
          localIndexes,
          functions,
          functionIndexes,
          tables,
          tableIndexes,
        ),
        value: lowerRuntimeExpression(
          statement.value,
          locals,
          localIndexes,
          functions,
          functionIndexes,
          tables,
          tableIndexes,
        ),
      };
    case "if":
      return {
        kind: "if",
        condition: lowerRuntimeExpression(
          statement.condition,
          locals,
          localIndexes,
          functions,
          functionIndexes,
          tables,
          tableIndexes,
        ),
        consequent: statement.consequent.map((item) =>
          lowerRuntimeStatement(
            item,
            locals,
            localIndexes,
            functions,
            functionIndexes,
            tables,
            tableIndexes,
          )
        ),
        alternate: (statement.alternate ?? []).map((item) =>
          lowerRuntimeStatement(
            item,
            locals,
            localIndexes,
            functions,
            functionIndexes,
            tables,
            tableIndexes,
          )
        ),
      };
    case "while":
      return {
        kind: "while",
        condition: lowerRuntimeExpression(
          statement.condition,
          locals,
          localIndexes,
          functions,
          functionIndexes,
          tables,
          tableIndexes,
        ),
        body: statement.body.map((item) =>
          lowerRuntimeStatement(
            item,
            locals,
            localIndexes,
            functions,
            functionIndexes,
            tables,
            tableIndexes,
          )
        ),
      };
  }
}

function lowerRuntimeExpression(
  expression: RuntimeExpression,
  locals: ReadonlyMap<string, RuntimeLanguageVariable>,
  localIndexes: ReadonlyMap<string, number>,
  functions: ReadonlyMap<string, RuntimeLanguageFunction>,
  functionIndexes: ReadonlyMap<string, number>,
  tables: ReadonlyMap<string, RuntimeLanguageTable>,
  tableIndexes: ReadonlyMap<string, number>,
): RuntimeIrExpression {
  switch (expression.kind) {
    case "u32":
      return { kind: "u32", value: expression.value >>> 0 };
    case "local":
      return {
        kind: "local",
        variable: requiredRuntimeLocal(locals, expression.name),
        localIndex: localIndex(expression.name, localIndexes),
      };
    case "call":
      return {
        kind: "call",
        functionName: expression.function,
        functionIndex: functionIndex(expression.function, functionIndexes),
        target: requiredRuntimeFunction(functions, expression.function),
        args: expression.args.map((argument) =>
          lowerRuntimeExpression(
            argument,
            locals,
            localIndexes,
            functions,
            functionIndexes,
            tables,
            tableIndexes,
          )
        ),
      };
    case "loadTableU32":
      return {
        kind: "loadTableU32",
        tableName: expression.table,
        tableIndex: tableIndex(expression.table, tableIndexes),
        table: requiredRuntimeTable(tables, expression.table),
        index: lowerRuntimeExpression(
          expression.index,
          locals,
          localIndexes,
          functions,
          functionIndexes,
          tables,
          tableIndexes,
        ),
      };
    case "loadScratchU32":
      return {
        kind: "loadScratchU32",
        index: lowerRuntimeExpression(
          expression.index,
          locals,
          localIndexes,
          functions,
          functionIndexes,
          tables,
          tableIndexes,
        ),
      };
    case "ensureScratchWords":
      return {
        kind: "ensureScratchWords",
        words: lowerRuntimeExpression(
          expression.words,
          locals,
          localIndexes,
          functions,
          functionIndexes,
          tables,
          tableIndexes,
        ),
      };
    default:
      return {
        kind: expression.kind,
        left: lowerRuntimeExpression(
          expression.left,
          locals,
          localIndexes,
          functions,
          functionIndexes,
          tables,
          tableIndexes,
        ),
        right: lowerRuntimeExpression(
          expression.right,
          locals,
          localIndexes,
          functions,
          functionIndexes,
          tables,
          tableIndexes,
        ),
      };
  }
}

function emitTypeScriptRuntime(
  ir: RuntimeLanguageIrProgram,
  options: { readonly exportEntry?: boolean },
): string {
  return `class RuntimeLanguageTrap extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeLanguageTrap";
  }
}

function divU32(left: number, right: number): number {
  const divisor = right >>> 0;
  if (divisor === 0) throw new RuntimeLanguageTrap("division by zero");
  return Math.trunc((left >>> 0) / divisor) >>> 0;
}

${ir.tables.map(emitTypeScriptTable).join("\n")}
${ir.tables.map((table) => emitTypeScriptTableLoader(table)).join("\n")}${
    ir.tables.length > 0 ? "\n" : ""
  }
${
    ir.hasScratchMemory
      ? emitTypeScriptScratchMemory(ir.scratchMemoryWords)
      : ""
  }${ir.hasScratchMemory ? "\n" : ""}
${
    ir.functions.map((fn) =>
      emitTypeScriptFunction(fn, {
        exported: options.exportEntry === true && fn.name === ir.entry,
      })
    ).join("\n")
  }`;
}

function emitTypeScriptTable(table: RuntimeLanguageTable): string {
  return `const ${runtimeTableIdentifier(table)}: readonly number[] = ${
    JSON.stringify(table.values.map((value) => value >>> 0))
  };`;
}

function emitTypeScriptTableLoader(table: RuntimeLanguageTable): string {
  const tableName = runtimeTableIdentifier(table);
  return `function ${
    runtimeTableLoaderIdentifier(table)
  }(index: number): number {
  const normalized = index >>> 0;
  if (normalized >= ${tableName}.length) {
    throw new RuntimeLanguageTrap("table index out of bounds");
  }
  return ${tableName}[normalized] >>> 0;
}
`;
}

function emitTypeScriptScratchMemory(words: number): string {
  const maxWords = Math.floor(MAX_WASM_PAGES * WASM_PAGE_SIZE / 4);
  return `let __baba_scratch = new Uint32Array(${words});

function __baba_ensure_scratch(words: number): number {
  const normalized = words >>> 0;
  if (normalized > ${maxWords}) {
    throw new RuntimeLanguageTrap("scratch memory size out of bounds");
  }
  if (normalized <= __baba_scratch.length) return __baba_scratch.length >>> 0;
  const next = new Uint32Array(normalized);
  next.set(__baba_scratch);
  __baba_scratch = next;
  return __baba_scratch.length >>> 0;
}

function __baba_load_scratch(index: number): number {
  const normalized = index >>> 0;
  if (normalized >= __baba_scratch.length) {
    throw new RuntimeLanguageTrap("scratch memory index out of bounds");
  }
  return __baba_scratch[normalized] >>> 0;
}

function __baba_store_scratch(index: number, value: number): void {
  const normalized = index >>> 0;
  if (normalized >= __baba_scratch.length) {
    throw new RuntimeLanguageTrap("scratch memory index out of bounds");
  }
  __baba_scratch[normalized] = value >>> 0;
}
`;
}

function emitTypeScriptFunction(
  fn: RuntimeIrFunction,
  options: { readonly exported?: boolean },
): string {
  const prefix = options.exported ? "export " : "";
  return `${prefix}function ${identifier(fn.name)}(${
    fn.parameters.map((parameter) => `${identifier(parameter.name)}: number`)
      .join(", ")
  }): number {
${fn.locals.map((local) => `  let ${identifier(local.name)} = 0;`).join("\n")}${
    fn.locals.length > 0 ? "\n" : ""
  }${
    fn.body.map((statement) => emitTypeScriptStatement(statement, "  ")).join(
      "\n",
    )
  }
  throw new RuntimeLanguageTrap("function completed without a return");
}
`;
}

export function compileRuntimeLanguageWasm(
  program: RuntimeLanguageProgram,
  options: RuntimeLanguageWasmCompileOptions = {},
): Uint8Array {
  const ir = compileRuntimeLanguageIr(program);
  const tableLayout = buildRuntimeTableLayout(ir.tables);
  const scratchMemory = ir.hasScratchMemory
    ? buildRuntimeScratchMemory(
      tableLayout.bytes.length,
      ir.scratchMemoryWords,
    )
    : null;
  const staticData = buildRuntimeStaticData(tableLayout.bytes, scratchMemory);
  const tableLoaders = ir.tables.map((table) => ({
    table,
    name: runtimeTableLoaderIdentifier(table),
    offset: tableLayout.offsets.get(table.name) ?? 0,
  }));
  const allFunctions = [
    ...ir.functions.map((fn) => ({ kind: "program" as const, fn })),
    ...tableLoaders.map((loader) => ({ kind: "tableLoader" as const, loader })),
    ...(scratchMemory
      ? [
        { kind: "scratchLoad" as const, scratch: scratchMemory },
        { kind: "scratchStore" as const, scratch: scratchMemory },
        { kind: "scratchEnsure" as const, scratch: scratchMemory },
      ]
      : []),
  ];
  const functionIndexes = new Map(
    ir.functions.map((fn, index) => [fn.name, index]),
  );
  const scratchIndexes = scratchMemory
    ? {
      load: ir.functions.length + tableLoaders.length,
      store: ir.functions.length + tableLoaders.length + 1,
      ensure: ir.functions.length + tableLoaders.length + 2,
    }
    : null;
  const exportNames = options.exports ?? [ir.entry];
  const exportEntries = runtimeLanguageWasmExports(
    exportNames,
    functionIndexes,
  );
  const bodies = allFunctions.map((item) => {
    const body = item.kind === "program"
      ? wasmProgramFunctionBody(
        item.fn,
        ir.functions.length,
        scratchIndexes,
      )
      : item.kind === "tableLoader"
      ? wasmTableLoaderBody(item.loader)
      : item.kind === "scratchLoad"
      ? wasmScratchLoaderBody(item.scratch)
      : item.kind === "scratchStore"
      ? wasmScratchStoreBody(item.scratch)
      : wasmScratchEnsureBody(item.scratch);
    return [...u32(body.length), ...body];
  });
  const memoryBytes = Math.max(
    staticData.length,
    scratchMemory ? scratchMemory.valuesOffset + scratchMemory.words * 4 : 0,
  );
  const sections = [
    section(1, [
      ...u32(allFunctions.length),
      ...allFunctions.flatMap((item) =>
        item.kind === "program"
          ? wasmFunctionType(item.fn)
          : item.kind === "tableLoader"
          ? wasmTableLoaderType()
          : item.kind === "scratchLoad"
          ? wasmScratchLoaderType()
          : item.kind === "scratchStore"
          ? wasmScratchStoreType()
          : wasmScratchEnsureType()
      ),
    ]),
    section(3, [
      ...u32(allFunctions.length),
      ...allFunctions.map((_, index) => u32(index)).flat(),
    ]),
    ...(memoryBytes > 0 ? [section(5, memorySection(memoryBytes))] : []),
    section(7, exportSection(exportEntries)),
    section(10, [
      ...u32(allFunctions.length),
      ...bodies.flat(),
    ]),
    ...(staticData.length > 0 ? [section(11, dataSection(staticData))] : []),
  ];
  return new Uint8Array([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    ...sections.flat(),
  ]);
}

export function runtimeLanguageEntryFunction(
  program: RuntimeLanguageProgram,
): RuntimeLanguageFunction {
  const entry = runtimeLanguageFunction(program, program.entry);
  if (entry.result !== "u32") {
    throw new Error(
      `Runtime-language function '${entry.name}' has unsupported result type '${entry.result}'.`,
    );
  }
  return entry;
}

function runtimeLanguageFunctions(
  program: RuntimeLanguageProgram,
): readonly RuntimeLanguageFunction[] {
  if (program.functions.length === 0) {
    throw new Error(
      `Runtime-language program '${program.name}' has no functions.`,
    );
  }
  return program.functions;
}

function runtimeLanguageFunction(
  program: RuntimeLanguageProgram,
  name: string,
): RuntimeLanguageFunction {
  const fn = program.functions.find((candidate) => candidate.name === name);
  if (!fn) {
    throw new Error(
      `Runtime-language program '${program.name}' has no function '${name}'.`,
    );
  }
  return fn;
}

function validateRuntimeLanguageProgram(program: RuntimeLanguageProgram): void {
  identifier(program.name);
  identifier(program.entry);
  runtimeLanguageEntryFunction(program);
  const functions = runtimeLanguageFunctions(program);
  const tables = runtimeLanguageTables(program);
  const hasScratchMemory = runtimeLanguageHasScratchMemory(program);
  const tableNames = new Set<string>();
  for (const table of tables) {
    validateRuntimeLanguageTable(table);
    if (tableNames.has(table.name)) {
      throw new Error(
        `Runtime-language program '${program.name}' has duplicate table '${table.name}'.`,
      );
    }
    tableNames.add(table.name);
  }
  const names = new Set<string>();
  for (const fn of functions) {
    identifier(fn.name);
    assertNotReservedRuntimeName(fn.name);
    if (names.has(fn.name)) {
      throw new Error(
        `Runtime-language program '${program.name}' has duplicate function '${fn.name}'.`,
      );
    }
    names.add(fn.name);
    if (fn.result !== "u32") {
      throw new Error(
        `Runtime-language function '${fn.name}' has unsupported result type '${fn.result}'.`,
      );
    }
    validateVariableSet(fn, functionParameters(fn), functionLocals(fn));
  }
  const functionMap = new Map(functions.map((fn) => [fn.name, fn]));
  for (const fn of functions) {
    const locals = new Set([
      ...functionParameters(fn).map((parameter) => parameter.name),
      ...functionLocals(fn).map((local) => local.name),
    ]);
    for (const statement of fn.body) {
      validateStatement(
        statement,
        locals,
        functionMap,
        tableNames,
        hasScratchMemory,
      );
    }
  }
}

function validateRuntimeLanguageTable(table: RuntimeLanguageTable): void {
  identifier(table.name);
  assertNotReservedRuntimeName(table.name);
  if (table.type !== "u32") {
    throw new Error(
      `Runtime-language table '${table.name}' has unsupported type '${table.type}'.`,
    );
  }
  for (const value of table.values) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
      throw new Error(
        `Runtime-language table '${table.name}' contains non-u32 value '${value}'.`,
      );
    }
  }
}

function validateStatement(
  statement: RuntimeStatement,
  locals: ReadonlySet<string>,
  functions: ReadonlyMap<string, RuntimeLanguageFunction>,
  tables: ReadonlySet<string>,
  hasScratchMemory: boolean,
): void {
  switch (statement.kind) {
    case "trap":
      return;
    case "return":
      validateExpression(
        statement.expression,
        locals,
        functions,
        tables,
        hasScratchMemory,
      );
      return;
    case "setLocal":
      assertKnownLocal(statement.name, locals);
      validateExpression(
        statement.expression,
        locals,
        functions,
        tables,
        hasScratchMemory,
      );
      return;
    case "storeScratchU32":
      if (!hasScratchMemory) {
        throw new Error(
          "Runtime-language scratch memory store requires scratchMemoryWords.",
        );
      }
      validateExpression(
        statement.index,
        locals,
        functions,
        tables,
        hasScratchMemory,
      );
      validateExpression(
        statement.value,
        locals,
        functions,
        tables,
        hasScratchMemory,
      );
      return;
    case "if":
      validateExpression(
        statement.condition,
        locals,
        functions,
        tables,
        hasScratchMemory,
      );
      for (const item of statement.consequent) {
        validateStatement(item, locals, functions, tables, hasScratchMemory);
      }
      for (const item of statement.alternate ?? []) {
        validateStatement(item, locals, functions, tables, hasScratchMemory);
      }
      return;
    case "while":
      validateExpression(
        statement.condition,
        locals,
        functions,
        tables,
        hasScratchMemory,
      );
      for (const item of statement.body) {
        validateStatement(item, locals, functions, tables, hasScratchMemory);
      }
      return;
  }
}

function validateExpression(
  expression: RuntimeExpression,
  locals: ReadonlySet<string>,
  functions: ReadonlyMap<string, RuntimeLanguageFunction>,
  tables: ReadonlySet<string>,
  hasScratchMemory: boolean,
): void {
  switch (expression.kind) {
    case "u32":
      return;
    case "local":
      assertKnownLocal(expression.name, locals);
      return;
    case "call": {
      const target = functions.get(expression.function);
      if (!target) {
        throw new Error(
          `Runtime-language function '${expression.function}' is not declared.`,
        );
      }
      validateCallExpression(expression, target);
      for (const argument of expression.args) {
        validateExpression(
          argument,
          locals,
          functions,
          tables,
          hasScratchMemory,
        );
      }
      return;
    }
    case "loadTableU32":
      if (!tables.has(expression.table)) {
        throw new Error(
          `Runtime-language table '${expression.table}' is not declared.`,
        );
      }
      validateSimpleTableIndex(expression.index, locals);
      return;
    case "loadScratchU32":
      if (!hasScratchMemory) {
        throw new Error(
          "Runtime-language scratch memory load requires scratchMemoryWords.",
        );
      }
      validateExpression(
        expression.index,
        locals,
        functions,
        tables,
        hasScratchMemory,
      );
      return;
    case "ensureScratchWords":
      if (!hasScratchMemory) {
        throw new Error(
          "Runtime-language scratch memory growth requires scratchMemoryWords.",
        );
      }
      validateExpression(
        expression.words,
        locals,
        functions,
        tables,
        hasScratchMemory,
      );
      return;
    default:
      validateExpression(
        expression.left,
        locals,
        functions,
        tables,
        hasScratchMemory,
      );
      validateExpression(
        expression.right,
        locals,
        functions,
        tables,
        hasScratchMemory,
      );
      return;
  }
}

function emitTypeScriptStatement(
  statement: RuntimeIrStatement,
  indent: string,
): string {
  switch (statement.kind) {
    case "trap":
      return `${indent}throw new RuntimeLanguageTrap("explicit trap");`;
    case "return":
      return `${indent}return (${
        emitTypeScriptExpression(statement.expression)
      }) >>> 0;`;
    case "setLocal":
      return `${indent}${identifier(statement.variable.name)} = (${
        emitTypeScriptExpression(statement.expression)
      }) >>> 0;`;
    case "storeScratchU32":
      return `${indent}__baba_store_scratch(${
        emitTypeScriptExpression(statement.index)
      }, ${emitTypeScriptExpression(statement.value)});`;
    case "if":
      return emitTypeScriptIf(statement, indent);
    case "while":
      return emitTypeScriptWhile(statement, indent);
  }
}

function emitTypeScriptIf(
  statement: Extract<RuntimeIrStatement, { readonly kind: "if" }>,
  indent: string,
): string {
  const consequent = emitTypeScriptBlock(
    statement.consequent,
    `${indent}  `,
  );
  const alternate = emitTypeScriptBlock(
    statement.alternate,
    `${indent}  `,
  );
  if (alternate.length === 0) {
    return `${indent}if ((${
      emitTypeScriptExpression(statement.condition)
    }) !== 0) {\n${consequent}${consequent ? "\n" : ""}${indent}}`;
  }
  return `${indent}if ((${
    emitTypeScriptExpression(statement.condition)
  }) !== 0) {\n${consequent}${
    consequent ? "\n" : ""
  }${indent}} else {\n${alternate}${alternate ? "\n" : ""}${indent}}`;
}

function emitTypeScriptWhile(
  statement: Extract<RuntimeIrStatement, { readonly kind: "while" }>,
  indent: string,
): string {
  const body = emitTypeScriptBlock(
    statement.body,
    `${indent}  `,
  );
  return `${indent}while ((${
    emitTypeScriptExpression(statement.condition)
  }) !== 0) {\n${body}${body ? "\n" : ""}${indent}}`;
}

function emitTypeScriptBlock(
  statements: readonly RuntimeIrStatement[],
  indent: string,
): string {
  return statements.map((statement) =>
    emitTypeScriptStatement(statement, indent)
  ).join("\n");
}

function emitTypeScriptExpression(
  expression: RuntimeIrExpression,
): string {
  switch (expression.kind) {
    case "u32":
      return String(expression.value >>> 0);
    case "local":
      return identifier(expression.variable.name);
    case "call":
      return `${identifier(expression.functionName)}(${
        expression.args.map((argument) => emitTypeScriptExpression(argument))
          .join(", ")
      }) >>> 0`;
    case "loadTableU32":
      return `${runtimeTableLoaderIdentifier(expression.table)}(${
        emitTypeScriptExpression(expression.index)
      }) >>> 0`;
    case "loadScratchU32":
      return `__baba_load_scratch(${
        emitTypeScriptExpression(expression.index)
      }) >>> 0`;
    case "ensureScratchWords":
      return `__baba_ensure_scratch(${
        emitTypeScriptExpression(expression.words)
      }) >>> 0`;
    case "addU32":
      return `((${emitTypeScriptExpression(expression.left)}) + (${
        emitTypeScriptExpression(expression.right)
      })) >>> 0`;
    case "subU32":
      return `((${emitTypeScriptExpression(expression.left)}) - (${
        emitTypeScriptExpression(expression.right)
      })) >>> 0`;
    case "mulU32":
      return `Math.imul((${
        emitTypeScriptExpression(expression.left)
      }) >>> 0, (${emitTypeScriptExpression(expression.right)}) >>> 0) >>> 0`;
    case "divU32":
      return `divU32(${emitTypeScriptExpression(expression.left)}, ${
        emitTypeScriptExpression(expression.right)
      })`;
    case "andU32":
      return `((${emitTypeScriptExpression(expression.left)}) & (${
        emitTypeScriptExpression(expression.right)
      })) >>> 0`;
    case "eqU32":
      return `(((${emitTypeScriptExpression(expression.left)}) >>> 0) === ((${
        emitTypeScriptExpression(expression.right)
      }) >>> 0) ? 1 : 0)`;
    case "ltS32":
      return `(((${emitTypeScriptExpression(expression.left)}) | 0) < ((${
        emitTypeScriptExpression(expression.right)
      }) | 0) ? 1 : 0)`;
    case "shlU32":
      return `((${emitTypeScriptExpression(expression.left)}) << ((${
        emitTypeScriptExpression(expression.right)
      }) & 31)) >>> 0`;
    case "shrU32":
      return `((${emitTypeScriptExpression(expression.left)}) >>> ((${
        emitTypeScriptExpression(expression.right)
      }) & 31)) >>> 0`;
  }
}

function emitWasmStatement(
  statement: RuntimeIrStatement,
  tableLoaderOffset: number,
  scratch: RuntimeScratchIndexes | null,
): number[] {
  switch (statement.kind) {
    case "trap":
      return [0x00];
    case "return":
      return [
        ...emitWasmExpression(
          statement.expression,
          tableLoaderOffset,
          scratch,
        ),
        0x0f,
      ];
    case "setLocal":
      return [
        ...emitWasmExpression(
          statement.expression,
          tableLoaderOffset,
          scratch,
        ),
        0x21,
        ...u32(statement.localIndex),
      ];
    case "storeScratchU32":
      return [
        ...emitWasmExpression(
          statement.index,
          tableLoaderOffset,
          scratch,
        ),
        ...emitWasmExpression(
          statement.value,
          tableLoaderOffset,
          scratch,
        ),
        0x10,
        ...u32(scratchStoreIndex(scratch)),
      ];
    case "if":
      return [
        ...emitWasmExpression(
          statement.condition,
          tableLoaderOffset,
          scratch,
        ),
        0x04,
        0x40,
        ...statement.consequent.flatMap((item) =>
          emitWasmStatement(item, tableLoaderOffset, scratch)
        ),
        ...(statement.alternate.length > 0
          ? [
            0x05,
            ...statement.alternate.flatMap((item) =>
              emitWasmStatement(item, tableLoaderOffset, scratch)
            ),
          ]
          : []),
        0x0b,
      ];
    case "while":
      return [
        0x02,
        0x40,
        0x03,
        0x40,
        ...emitWasmExpression(
          statement.condition,
          tableLoaderOffset,
          scratch,
        ),
        0x45,
        0x0d,
        ...u32(1),
        ...statement.body.flatMap((item) =>
          emitWasmStatement(item, tableLoaderOffset, scratch)
        ),
        0x0c,
        ...u32(0),
        0x0b,
        0x0b,
      ];
  }
}

function emitWasmExpression(
  expression: RuntimeIrExpression,
  tableLoaderOffset: number,
  scratch: RuntimeScratchIndexes | null,
): number[] {
  switch (expression.kind) {
    case "u32":
      return [0x41, ...i32(expression.value | 0)];
    case "local":
      return [0x20, ...u32(expression.localIndex)];
    case "call":
      return [
        ...expression.args.flatMap((argument) =>
          emitWasmExpression(argument, tableLoaderOffset, scratch)
        ),
        0x10,
        ...u32(expression.functionIndex),
      ];
    case "loadTableU32":
      return [
        ...emitWasmExpression(
          expression.index,
          tableLoaderOffset,
          scratch,
        ),
        0x10,
        ...u32(tableLoaderOffset + expression.tableIndex),
      ];
    case "loadScratchU32":
      return [
        ...emitWasmExpression(
          expression.index,
          tableLoaderOffset,
          scratch,
        ),
        0x10,
        ...u32(scratchLoadIndex(scratch)),
      ];
    case "ensureScratchWords":
      return [
        ...emitWasmExpression(
          expression.words,
          tableLoaderOffset,
          scratch,
        ),
        0x10,
        ...u32(scratchEnsureIndex(scratch)),
      ];
    case "addU32":
      return binaryExpression(
        expression,
        tableLoaderOffset,
        scratch,
        0x6a,
      );
    case "subU32":
      return binaryExpression(
        expression,
        tableLoaderOffset,
        scratch,
        0x6b,
      );
    case "mulU32":
      return binaryExpression(
        expression,
        tableLoaderOffset,
        scratch,
        0x6c,
      );
    case "divU32":
      return binaryExpression(
        expression,
        tableLoaderOffset,
        scratch,
        0x6e,
      );
    case "andU32":
      return binaryExpression(
        expression,
        tableLoaderOffset,
        scratch,
        0x71,
      );
    case "eqU32":
      return binaryExpression(
        expression,
        tableLoaderOffset,
        scratch,
        0x46,
      );
    case "ltS32":
      return binaryExpression(
        expression,
        tableLoaderOffset,
        scratch,
        0x48,
      );
    case "shlU32":
      return binaryExpression(
        expression,
        tableLoaderOffset,
        scratch,
        0x74,
      );
    case "shrU32":
      return binaryExpression(
        expression,
        tableLoaderOffset,
        scratch,
        0x76,
      );
  }
}

function binaryExpression(
  expression: Extract<
    RuntimeIrExpression,
    { readonly left: RuntimeIrExpression; readonly right: RuntimeIrExpression }
  >,
  tableLoaderOffset: number,
  scratch: RuntimeScratchIndexes | null,
  opcode: number,
): number[] {
  return [
    ...emitWasmExpression(expression.left, tableLoaderOffset, scratch),
    ...emitWasmExpression(expression.right, tableLoaderOffset, scratch),
    opcode,
  ];
}

function wasmProgramFunctionBody(
  fn: RuntimeIrFunction,
  tableLoaderOffset: number,
  scratch: RuntimeScratchIndexes | null,
): number[] {
  return [
    ...localDeclarations(fn.locals),
    ...fn.body.flatMap((statement) =>
      emitWasmStatement(statement, tableLoaderOffset, scratch)
    ),
    0x00,
    0x0b,
  ];
}

function wasmTableLoaderBody(
  loader: RuntimeTableLoader,
): number[] {
  return [
    0x00,
    0x20,
    ...u32(0),
    0x41,
    ...i32(loader.table.values.length),
    0x4f,
    0x04,
    0x40,
    0x00,
    0x0b,
    0x41,
    ...i32(loader.offset),
    0x20,
    ...u32(0),
    0x41,
    ...i32(2),
    0x74,
    0x6a,
    0x28,
    ...u32(2),
    ...u32(0),
    0x0f,
    0x00,
    0x0b,
  ];
}

function wasmScratchLoaderBody(
  scratch: RuntimeScratchMemory,
): number[] {
  return [
    0x01,
    ...u32(1),
    0x7f,
    0x41,
    ...i32(scratch.capacityOffset),
    0x28,
    ...u32(2),
    ...u32(0),
    0x21,
    ...u32(1),
    0x20,
    ...u32(0),
    0x20,
    ...u32(1),
    0x4f,
    0x04,
    0x40,
    0x00,
    0x0b,
    0x41,
    ...i32(scratch.valuesOffset),
    0x20,
    ...u32(0),
    0x41,
    ...i32(2),
    0x74,
    0x6a,
    0x28,
    ...u32(2),
    ...u32(0),
    0x0f,
    0x00,
    0x0b,
  ];
}

function wasmScratchStoreBody(
  scratch: RuntimeScratchMemory,
): number[] {
  return [
    0x01,
    ...u32(1),
    0x7f,
    0x41,
    ...i32(scratch.capacityOffset),
    0x28,
    ...u32(2),
    ...u32(0),
    0x21,
    ...u32(2),
    0x20,
    ...u32(0),
    0x20,
    ...u32(2),
    0x4f,
    0x04,
    0x40,
    0x00,
    0x0b,
    0x41,
    ...i32(scratch.valuesOffset),
    0x20,
    ...u32(0),
    0x41,
    ...i32(2),
    0x74,
    0x6a,
    0x20,
    ...u32(1),
    0x36,
    ...u32(2),
    ...u32(0),
    0x0b,
  ];
}

function wasmScratchEnsureBody(
  scratch: RuntimeScratchMemory,
): number[] {
  return [
    0x01,
    ...u32(3),
    0x7f,
    0x20,
    ...u32(0),
    0x41,
    ...i32(scratch.maxWords),
    0x4b,
    0x04,
    0x40,
    0x00,
    0x0b,
    0x41,
    ...i32(scratch.capacityOffset),
    0x28,
    ...u32(2),
    ...u32(0),
    0x21,
    ...u32(3),
    0x20,
    ...u32(0),
    0x20,
    ...u32(3),
    0x4d,
    0x04,
    0x40,
    0x20,
    ...u32(3),
    0x0f,
    0x0b,
    0x41,
    ...i32(scratch.valuesOffset),
    0x20,
    ...u32(0),
    0x41,
    ...i32(2),
    0x74,
    0x6a,
    0x21,
    ...u32(1),
    0x20,
    ...u32(1),
    0x3f,
    0x00,
    0x41,
    ...i32(WASM_PAGE_SIZE),
    0x6c,
    0x4b,
    0x04,
    0x40,
    0x20,
    ...u32(1),
    0x41,
    ...i32(WASM_PAGE_SIZE - 1),
    0x6a,
    0x41,
    ...i32(16),
    0x76,
    0x21,
    ...u32(2),
    0x20,
    ...u32(2),
    0x3f,
    0x00,
    0x6b,
    0x40,
    0x00,
    0x41,
    ...i32(-1),
    0x46,
    0x04,
    0x40,
    0x00,
    0x0b,
    0x0b,
    0x41,
    ...i32(scratch.capacityOffset),
    0x20,
    ...u32(0),
    0x36,
    ...u32(2),
    ...u32(0),
    0x20,
    ...u32(0),
    0x0f,
    0x00,
    0x0b,
  ];
}

interface RuntimeTableLoader {
  readonly table: RuntimeLanguageTable;
  readonly name: string;
  readonly offset: number;
}

interface RuntimeScratchMemory {
  readonly words: number;
  readonly maxWords: number;
  readonly capacityOffset: number;
  readonly valuesOffset: number;
}

interface RuntimeScratchIndexes {
  readonly load: number;
  readonly store: number;
  readonly ensure: number;
}

interface RuntimeTableLayout {
  readonly offsets: ReadonlyMap<string, number>;
  readonly bytes: Uint8Array;
}

function buildRuntimeTableLayout(
  tables: readonly RuntimeLanguageTable[],
): RuntimeTableLayout {
  const offsets = new Map<string, number>();
  const bytes: number[] = [];
  for (const table of tables) {
    while (bytes.length % 4 !== 0) bytes.push(0);
    offsets.set(table.name, bytes.length);
    for (const value of table.values) {
      const normalized = value >>> 0;
      bytes.push(normalized & 0xff);
      bytes.push((normalized >>> 8) & 0xff);
      bytes.push((normalized >>> 16) & 0xff);
      bytes.push((normalized >>> 24) & 0xff);
    }
  }
  return { offsets, bytes: Uint8Array.from(bytes) };
}

function buildRuntimeScratchMemory(
  tableBytes: number,
  words: number,
): RuntimeScratchMemory {
  const capacityOffset = align(tableBytes, 4);
  const valuesOffset = capacityOffset + 4;
  const maxWords = Math.floor(
    (MAX_WASM_PAGES * WASM_PAGE_SIZE - valuesOffset) / 4,
  );
  const byteLength = valuesOffset + words * 4;
  if (byteLength > MAX_WASM_PAGES * WASM_PAGE_SIZE) {
    throw new Error(
      `Runtime-language scratch memory needs ${byteLength} bytes, exceeding the maximum Wasm memory size.`,
    );
  }
  return { words, maxWords, capacityOffset, valuesOffset };
}

function buildRuntimeStaticData(
  tableBytes: Uint8Array,
  scratch: RuntimeScratchMemory | null,
): Uint8Array {
  if (!scratch) return tableBytes;
  const bytes = [...tableBytes];
  while (bytes.length < scratch.capacityOffset) bytes.push(0);
  bytes.push(scratch.words & 0xff);
  bytes.push((scratch.words >>> 8) & 0xff);
  bytes.push((scratch.words >>> 16) & 0xff);
  bytes.push((scratch.words >>> 24) & 0xff);
  return Uint8Array.from(bytes);
}

function memorySection(byteLength: number): number[] {
  return [
    ...u32(1),
    0x01,
    ...u32(Math.max(1, Math.ceil(byteLength / WASM_PAGE_SIZE))),
    ...u32(MAX_WASM_PAGES),
  ];
}

function dataSection(data: Uint8Array): number[] {
  return [
    ...u32(1),
    0x00,
    0x41,
    ...i32(0),
    0x0b,
    ...u32(data.length),
    ...data,
  ];
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function functionParameters(
  fn: RuntimeLanguageFunction,
): readonly RuntimeLanguageVariable[] {
  return fn.parameters ?? [];
}

function functionLocals(
  fn: RuntimeLanguageFunction,
): readonly RuntimeLanguageVariable[] {
  return fn.locals ?? [];
}

function runtimeLanguageTables(
  program: RuntimeLanguageProgram,
): readonly RuntimeLanguageTable[] {
  return program.tables ?? [];
}

function runtimeLanguageHasScratchMemory(
  program: RuntimeLanguageProgram,
): boolean {
  return program.scratchMemoryWords !== undefined;
}

function runtimeLanguageScratchMemoryWords(
  program: RuntimeLanguageProgram,
): number {
  const words = program.scratchMemoryWords ?? 0;
  if (!Number.isInteger(words) || words < 0) {
    throw new Error(
      `Runtime-language program '${program.name}' has invalid scratchMemoryWords '${words}'.`,
    );
  }
  if (words > Math.floor(MAX_WASM_PAGES * WASM_PAGE_SIZE / 4)) {
    throw new Error(
      `Runtime-language program '${program.name}' scratchMemoryWords exceeds the maximum Wasm memory size.`,
    );
  }
  return words;
}

function validateVariableSet(
  fn: RuntimeLanguageFunction,
  parameters: readonly RuntimeLanguageVariable[],
  locals: readonly RuntimeLanguageVariable[],
): void {
  const seen = new Set<string>();
  for (const variable of [...parameters, ...locals]) {
    if (variable.type !== "u32") {
      throw new Error(
        `Runtime-language variable '${variable.name}' has unsupported type '${variable.type}'.`,
      );
    }
    identifier(variable.name);
    if (seen.has(variable.name)) {
      throw new Error(
        `Runtime-language function '${fn.name}' has duplicate variable '${variable.name}'.`,
      );
    }
    seen.add(variable.name);
  }
  identifier(fn.name);
}

function localIndexMap(
  parameters: readonly RuntimeLanguageVariable[],
  locals: readonly RuntimeLanguageVariable[],
): ReadonlyMap<string, number> {
  const indexes = new Map<string, number>();
  for (const [index, parameter] of parameters.entries()) {
    indexes.set(parameter.name, index);
  }
  for (const [index, local] of locals.entries()) {
    indexes.set(local.name, parameters.length + index);
  }
  return indexes;
}

function localIndex(
  name: string,
  locals: ReadonlyMap<string, number>,
): number {
  const index = locals.get(name);
  if (index === undefined) {
    throw new Error(`Runtime-language variable '${name}' is not declared.`);
  }
  return index;
}

function requiredRuntimeLocal(
  locals: ReadonlyMap<string, RuntimeLanguageVariable>,
  name: string,
): RuntimeLanguageVariable {
  const variable = locals.get(name);
  if (!variable) {
    throw new Error(`Runtime-language variable '${name}' is not declared.`);
  }
  return variable;
}

function functionIndex(
  name: string,
  functions: ReadonlyMap<string, number>,
): number {
  const index = functions.get(name);
  if (index === undefined) {
    throw new Error(`Runtime-language function '${name}' is not declared.`);
  }
  return index;
}

function requiredRuntimeFunction(
  functions: ReadonlyMap<string, RuntimeLanguageFunction>,
  name: string,
): RuntimeLanguageFunction {
  const fn = functions.get(name);
  if (!fn) {
    throw new Error(`Runtime-language function '${name}' is not declared.`);
  }
  return fn;
}

function tableIndex(
  name: string,
  tables: ReadonlyMap<string, number>,
): number {
  const index = tables.get(name);
  if (index === undefined) {
    throw new Error(`Runtime-language table '${name}' is not declared.`);
  }
  return index;
}

function requiredRuntimeTable(
  tables: ReadonlyMap<string, RuntimeLanguageTable>,
  name: string,
): RuntimeLanguageTable {
  const table = tables.get(name);
  if (!table) {
    throw new Error(`Runtime-language table '${name}' is not declared.`);
  }
  return table;
}

function scratchLoadIndex(scratch: RuntimeScratchIndexes | null): number {
  if (!scratch) {
    throw new Error("Runtime-language scratch memory load is not available.");
  }
  return scratch.load;
}

function scratchStoreIndex(scratch: RuntimeScratchIndexes | null): number {
  if (!scratch) {
    throw new Error("Runtime-language scratch memory store is not available.");
  }
  return scratch.store;
}

function scratchEnsureIndex(scratch: RuntimeScratchIndexes | null): number {
  if (!scratch) {
    throw new Error("Runtime-language scratch memory growth is not available.");
  }
  return scratch.ensure;
}

function assertKnownLocal(
  name: string,
  locals: ReadonlySet<string>,
): void {
  if (!locals.has(name)) {
    throw new Error(`Runtime-language variable '${name}' is not declared.`);
  }
}

function localDeclarations(
  locals: readonly RuntimeLanguageVariable[],
): number[] {
  if (locals.length === 0) return [0x00];
  return [0x01, ...u32(locals.length), 0x7f];
}

function wasmType(variable: RuntimeLanguageVariable): number[] {
  if (variable.type !== "u32") {
    throw new Error(
      `Runtime-language variable '${variable.name}' has unsupported type '${variable.type}'.`,
    );
  }
  return [0x7f];
}

function wasmFunctionType(fn: RuntimeIrFunction): number[] {
  const parameters = fn.parameters;
  return [
    0x60,
    ...u32(parameters.length),
    ...parameters.flatMap(wasmType),
    0x01,
    0x7f,
  ];
}

function wasmTableLoaderType(): number[] {
  return [
    0x60,
    ...u32(1),
    0x7f,
    0x01,
    0x7f,
  ];
}

function wasmScratchLoaderType(): number[] {
  return [
    0x60,
    ...u32(1),
    0x7f,
    0x01,
    0x7f,
  ];
}

function wasmScratchStoreType(): number[] {
  return [
    0x60,
    ...u32(2),
    0x7f,
    0x7f,
    0x00,
  ];
}

function wasmScratchEnsureType(): number[] {
  return [
    0x60,
    ...u32(1),
    0x7f,
    0x01,
    0x7f,
  ];
}

function runtimeLanguageWasmExports(
  exports: readonly string[],
  functionIndexes: ReadonlyMap<string, number>,
): readonly (readonly [name: string, index: number])[] {
  const seen = new Set<string>();
  const entries: Array<readonly [string, number]> = [];
  for (const exportName of exports) {
    identifier(exportName);
    if (seen.has(exportName)) {
      throw new Error(
        `Runtime-language Wasm export '${exportName}' is duplicated.`,
      );
    }
    seen.add(exportName);
    const index = functionIndexes.get(exportName);
    if (index === undefined) {
      throw new Error(
        `Runtime-language Wasm export '${exportName}' is not a program function.`,
      );
    }
    entries.push([exportName, index]);
  }
  return entries;
}

function exportSection(
  entries: readonly (readonly [name: string, index: number])[],
): number[] {
  return [
    ...u32(entries.length),
    ...entries.flatMap(([exportName, index]) => [
      ...name(exportName),
      0x00,
      ...u32(index),
    ]),
  ];
}

function validateCallExpression(
  expression: Extract<RuntimeExpression, { readonly kind: "call" }>,
  target: RuntimeLanguageFunction,
): void {
  const expected = functionParameters(target).length;
  if (expression.args.length !== expected) {
    throw new Error(
      `Runtime-language call to '${expression.function}' has ${expression.args.length} arguments, expected ${expected}.`,
    );
  }
}

function validateSimpleTableIndex(
  expression: RuntimeExpression,
  locals: ReadonlySet<string>,
): void {
  if (expression.kind === "u32") return;
  if (expression.kind === "local") {
    assertKnownLocal(expression.name, locals);
    return;
  }
  throw new Error(
    "Runtime-language table indexes currently must be u32 constants or locals.",
  );
}

function runtimeTableIdentifier(table: RuntimeLanguageTable): string {
  return `__baba_table_${identifier(table.name)}`;
}

function runtimeTableLoaderIdentifier(table: RuntimeLanguageTable): string {
  return `__baba_load_${identifier(table.name)}`;
}

function assertNotReservedRuntimeName(name: string): void {
  if (name.startsWith("__baba_")) {
    throw new Error(
      `Runtime-language name '${name}' uses the reserved __baba_ prefix.`,
    );
  }
}

function identifier(name: string): string {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) || RESERVED.has(name)) {
    throw new Error(
      `Runtime-language identifier '${name}' is not a valid target identifier.`,
    );
  }
  return name;
}

const RESERVED = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

function section(id: number, payload: number[]): number[] {
  return [id, ...u32(payload.length), ...payload];
}

function name(value: string): number[] {
  const bytes = new TextEncoder().encode(value);
  return [...u32(bytes.length), ...bytes];
}

function u32(value: number): number[] {
  let remaining = value >>> 0;
  const bytes = [];
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== 0);
  return bytes;
}

function i32(value: number): number[] {
  let remaining = value | 0;
  const bytes = [];
  let more = true;
  while (more) {
    let byte = remaining & 0x7f;
    remaining >>= 7;
    const signBitSet = (byte & 0x40) !== 0;
    more = !(
      (remaining === 0 && !signBitSet) ||
      (remaining === -1 && signBitSet)
    );
    if (more) byte |= 0x80;
    bytes.push(byte);
  }
  return bytes;
}
