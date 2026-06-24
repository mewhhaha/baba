import type {
  BrlEnumDeclaration,
  BrlFunctionDeclaration,
  BrlIdentifier,
  BrlModule,
  BrlRecordDeclaration,
  BrlTypeNode,
} from "./ast.ts";
import type { BrlDiagnostic } from "./diagnostics.ts";
import { brlDiagnostic } from "./diagnostics.ts";

export type BrlSymbolKind =
  | "module"
  | "function"
  | "record"
  | "variant"
  | "field"
  | "local"
  | "parameter"
  | "intrinsic";

export interface BrlResolvedProgram {
  readonly diagnostics: readonly BrlDiagnostic[];
  readonly records: readonly BrlResolvedRecord[];
  readonly enums: readonly BrlResolvedEnum[];
  readonly functions: readonly BrlResolvedFunction[];
  readonly intrinsics: readonly BrlResolvedIntrinsic[];
}

export interface BrlResolvedRecord {
  readonly id: number;
  readonly declaration: BrlRecordDeclaration;
  readonly fields: readonly BrlResolvedField[];
}

export interface BrlResolvedField {
  readonly id: number;
  readonly declaration: BrlRecordDeclaration["fields"][number];
}

export interface BrlResolvedEnum {
  readonly id: number;
  readonly declaration: BrlEnumDeclaration;
  readonly variants: readonly BrlResolvedVariant[];
}

export interface BrlResolvedVariant {
  readonly id: number;
  readonly declaration: BrlEnumDeclaration["variants"][number];
}

export interface BrlResolvedFunction {
  readonly id: number;
  readonly declaration: BrlFunctionDeclaration;
}

export interface BrlResolvedIntrinsic {
  readonly id: number;
  readonly name: string;
  readonly params: readonly string[];
  readonly result: string | null;
}

const intrinsicNames = [
  "trap",
  "vec_len",
  "vec_push",
  "span_len",
] as const;

export function resolveBrlModule(module: BrlModule): BrlResolvedProgram {
  const diagnostics: BrlDiagnostic[] = [...module.diagnostics];
  const declarations = new Map<string, BrlIdentifier>();
  const records: BrlResolvedRecord[] = [];
  const enums: BrlResolvedEnum[] = [];
  const functions: BrlResolvedFunction[] = [];
  let nextId = 1;

  for (const item of module.items) {
    if (item.kind === "import") {
      const path = item.path.map((segment) => segment.text).join(".");
      if (path !== "runtime.intrinsics" && path !== "runtime.lexer") {
        diagnostics.push(
          brlDiagnostic(
            "BRL_RESOLVE_INVALID_IMPORT",
            `Unknown BRL import '${path}'.`,
            item.span,
          ),
        );
      }
      continue;
    }
    const name = item.name;
    const previous = declarations.get(name.text);
    if (previous) {
      diagnostics.push(
        brlDiagnostic(
          "BRL_RESOLVE_DUPLICATE_DECLARATION",
          `Duplicate declaration '${name.text}'.`,
          name.span,
        ),
      );
    } else {
      declarations.set(name.text, name);
    }
  }

  for (const item of module.items) {
    switch (item.kind) {
      case "record":
        records.push(resolveRecord(item, nextId++, diagnostics));
        break;
      case "enum":
        enums.push(resolveEnum(item, nextId++));
        break;
      case "function":
        functions.push({ id: nextId++, declaration: item });
        collectFunctionScopeDiagnostics(item, diagnostics);
        break;
      case "import":
        break;
    }
  }

  const recordNames = new Set(
    records.map((record) => record.declaration.name.text),
  );
  for (const record of records) {
    for (const field of record.declaration.fields) {
      for (const referenced of referencedNamedTypes(field.type)) {
        if (!recordNames.has(referenced.text)) {
          diagnostics.push(
            brlDiagnostic(
              "BRL_RESOLVE_UNKNOWN_NAME",
              `Unknown type '${referenced.text}'.`,
              referenced.span,
            ),
          );
        }
      }
    }
    if (recordContainsDirectCycle(record.declaration)) {
      diagnostics.push(
        brlDiagnostic(
          "BRL_RESOLVE_RECURSIVE_TYPE",
          `Record '${record.declaration.name.text}' contains itself by value.`,
          record.declaration.name.span,
        ),
      );
    }
  }

  return {
    diagnostics,
    records,
    enums,
    functions,
    intrinsics: intrinsicNames.map((name, index) => ({
      id: 10_000 + index,
      name,
      params: [],
      result: null,
    })),
  };
}

function resolveRecord(
  declaration: BrlRecordDeclaration,
  firstFieldId: number,
  diagnostics: BrlDiagnostic[],
): BrlResolvedRecord {
  const fields: BrlResolvedField[] = [];
  const names = new Map<string, BrlIdentifier>();
  let nextId = firstFieldId * 1_000;
  for (const field of declaration.fields) {
    const previous = names.get(field.name.text);
    if (previous) {
      diagnostics.push(
        brlDiagnostic(
          "BRL_RESOLVE_DUPLICATE_FIELD",
          `Duplicate field '${field.name.text}'.`,
          field.name.span,
        ),
      );
    } else {
      names.set(field.name.text, field.name);
    }
    fields.push({ id: nextId++, declaration: field });
  }
  return { id: firstFieldId, declaration, fields };
}

function resolveEnum(
  declaration: BrlEnumDeclaration,
  id: number,
): BrlResolvedEnum {
  return {
    id,
    declaration,
    variants: declaration.variants.map((variant, index) => ({
      id: id * 1_000 + index,
      declaration: variant,
    })),
  };
}

function collectFunctionScopeDiagnostics(
  declaration: BrlFunctionDeclaration,
  diagnostics: BrlDiagnostic[],
): void {
  const names = new Map<string, BrlIdentifier>();
  for (const parameter of declaration.parameters) {
    const previous = names.get(parameter.name.text);
    if (previous) {
      diagnostics.push(
        brlDiagnostic(
          "BRL_RESOLVE_DUPLICATE_LOCAL",
          `Duplicate parameter '${parameter.name.text}'.`,
          parameter.name.span,
        ),
      );
    } else {
      names.set(parameter.name.text, parameter.name);
    }
  }
  collectLocalNames(declaration.body, names, diagnostics);
}

function collectLocalNames(
  statement: BrlFunctionDeclaration["body"],
  names: Map<string, BrlIdentifier>,
  diagnostics: BrlDiagnostic[],
): void {
  for (const child of statement.statements) {
    if (child.kind === "let") {
      const previous = names.get(child.name.text);
      if (previous) {
        diagnostics.push(
          brlDiagnostic(
            "BRL_RESOLVE_SHADOWING",
            `Local '${child.name.text}' shadows an existing binding.`,
            child.name.span,
          ),
        );
      } else {
        names.set(child.name.text, child.name);
      }
    } else if (child.kind === "block") {
      collectLocalNames(child, new Map(names), diagnostics);
    } else if (child.kind === "if") {
      collectLocalNames(child.consequent, new Map(names), diagnostics);
      if (child.alternate) {
        collectLocalNames(child.alternate, new Map(names), diagnostics);
      }
    } else if (child.kind === "while") {
      collectLocalNames(child.body, new Map(names), diagnostics);
    } else if (child.kind === "for") {
      const loopNames = new Map(names);
      const previous = loopNames.get(child.name.text);
      if (previous) {
        diagnostics.push(
          brlDiagnostic(
            "BRL_RESOLVE_SHADOWING",
            `Local '${child.name.text}' shadows an existing binding.`,
            child.name.span,
          ),
        );
      } else {
        loopNames.set(child.name.text, child.name);
      }
      collectLocalNames(child.body, loopNames, diagnostics);
    }
  }
}

function* referencedNamedTypes(type: BrlTypeNode): Iterable<BrlIdentifier> {
  switch (type.kind) {
    case "named":
      yield type.name;
      break;
    case "array":
    case "span":
    case "vec":
      yield* referencedNamedTypes(type.element);
      break;
    case "missing":
    case "scalar":
      break;
  }
}

function recordContainsDirectCycle(record: BrlRecordDeclaration): boolean {
  return record.fields.some((field) =>
    field.type.kind === "named" && field.type.name.text === record.name.text
  );
}
