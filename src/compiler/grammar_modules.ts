import type {
  Diagnostic,
  GrammarDeclaration,
  GrammarDocument,
  GrammarExpression,
  GrammarRule,
  SourceSpan,
} from "../ast.ts";
import type { AnalyzedGrammar } from "./grammar_ir.ts";
import { analyzeGrammar } from "./grammar_analysis.ts";

export interface GrammarModuleCompositionResult {
  readonly document: GrammarDocument;
  readonly analyzed: AnalyzedGrammar;
  readonly diagnostics: readonly GrammarModuleDiagnostic[];
  readonly moduleOrder: readonly string[];
}

export interface GrammarModuleDiagnostic extends Diagnostic {
  readonly module?: string;
  readonly targetRule?: string;
  readonly baseGrammar?: string;
}

interface ModuleEntry {
  readonly name: string;
  readonly document: GrammarDocument;
  readonly exports: ReadonlySet<string>;
  readonly imports: readonly string[];
}

export function composeGrammarModules(
  documents: readonly GrammarDocument[],
): GrammarModuleCompositionResult {
  const diagnostics: GrammarModuleDiagnostic[] = [];
  if (documents.length === 0) {
    const emptySpan = { start: 0, end: 0, line: 1, column: 1 };
    const document = { declarations: [], span: emptySpan };
    const analyzed = analyzeGrammar(document);
    return { document, analyzed, diagnostics, moduleOrder: [] };
  }
  const modules = documents.map((document) => moduleEntry(document));
  const modulesByName = new Map<string, ModuleEntry>();
  for (const module of modules) {
    const existing = modulesByName.get(module.name);
    if (existing !== undefined) {
      diagnostics.push({
        code: "GRAMMAR_MODULE_DUPLICATE",
        severity: "error",
        message: `Duplicate grammar module '${module.name}'.`,
        span: module.document.span,
        module: module.name,
      });
    } else {
      modulesByName.set(module.name, module);
    }
  }

  const ordered = topologicalModules(modules, modulesByName, diagnostics);
  const composedDeclarations: GrammarDeclaration[] = [];
  const composedRules = new Map<string, GrammarRule>();
  let span = documents[0].span;
  for (const module of ordered) {
    span = combineSpans(span, module.document.span);
    for (const declaration of module.document.declarations) {
      if (declaration.kind === "import" || declaration.kind === "module") {
        continue;
      }
      if (declaration.kind === "extend") {
        const baseName = module.imports[0];
        const base = baseName === undefined
          ? undefined
          : modulesByName.get(baseName);
        if (base === undefined) {
          diagnostics.push({
            code: "GRAMMAR_EXTENSION_BASE_MISSING",
            severity: "error",
            message:
              `Extension '${module.name}' does not import a known base grammar.`,
            span: declaration.span,
            module: module.name,
            targetRule: declaration.target,
          });
          continue;
        }
        if (!isExported(base, declaration.target)) {
          diagnostics.push({
            code: "GRAMMAR_EXTENSION_POINT_NOT_EXPORTED",
            severity: "error",
            message:
              `Grammar '${module.name}' cannot extend non-exported rule '${declaration.target}' from '${base.name}'.`,
            span: declaration.span,
            module: module.name,
            targetRule: declaration.target,
            baseGrammar: base.name,
          });
          continue;
        }
        const target = composedRules.get(declaration.target);
        if (target === undefined) {
          diagnostics.push({
            code: "GRAMMAR_EXTENSION_TARGET_MISSING",
            severity: "error",
            message:
              `Extension target '${declaration.target}' is not present in the composed grammar.`,
            span: declaration.span,
            module: module.name,
            targetRule: declaration.target,
            baseGrammar: base.name,
          });
          continue;
        }
        target.expression = appendAlternative(
          target.expression,
          declaration.expression,
        );
        target.span = combineSpans(target.span, declaration.span);
        continue;
      }
      const cloned = cloneDeclaration(declaration);
      composedDeclarations.push(cloned);
      if (cloned.kind === "rule") {
        composedRules.set(cloned.name, cloned);
      }
    }
  }
  const document: GrammarDocument = {
    name: ordered[ordered.length - 1].name,
    declarations: composedDeclarations,
    span,
  };
  const analyzed = analyzeGrammar(document);
  return {
    document,
    analyzed,
    diagnostics: [...diagnostics, ...analyzed.diagnostics],
    moduleOrder: ordered.map((module) => module.name),
  };
}

function moduleEntry(document: GrammarDocument): ModuleEntry {
  let name = "anonymous";
  if (document.name !== undefined) {
    name = document.name;
  }
  const exports = new Set<string>();
  const imports: string[] = [];
  for (const declaration of document.declarations) {
    if (declaration.kind === "export") {
      exports.add(declaration.name);
    } else if (declaration.kind === "import") {
      imports.push(declaration.source);
    }
  }
  return { name, document, exports, imports };
}

function topologicalModules(
  modules: readonly ModuleEntry[],
  modulesByName: ReadonlyMap<string, ModuleEntry>,
  diagnostics: GrammarModuleDiagnostic[],
): readonly ModuleEntry[] {
  const ordered: ModuleEntry[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  for (const module of modules) {
    visitModule(module, modulesByName, visiting, visited, ordered, diagnostics);
  }
  return ordered;
}

function visitModule(
  module: ModuleEntry,
  modulesByName: ReadonlyMap<string, ModuleEntry>,
  visiting: Set<string>,
  visited: Set<string>,
  ordered: ModuleEntry[],
  diagnostics: GrammarModuleDiagnostic[],
): void {
  if (visited.has(module.name)) {
    return;
  }
  if (visiting.has(module.name)) {
    diagnostics.push({
      code: "GRAMMAR_MODULE_IMPORT_CYCLE",
      severity: "error",
      message: `Grammar module import cycle includes '${module.name}'.`,
      span: module.document.span,
      module: module.name,
    });
    return;
  }
  visiting.add(module.name);
  for (const imported of module.imports) {
    const dependency = modulesByName.get(imported);
    if (dependency !== undefined) {
      visitModule(
        dependency,
        modulesByName,
        visiting,
        visited,
        ordered,
        diagnostics,
      );
    }
  }
  visiting.delete(module.name);
  visited.add(module.name);
  ordered.push(module);
}

function isExported(module: ModuleEntry, target: string): boolean {
  if (module.exports.has(target)) {
    return true;
  }
  return module.exports.has(`${module.name}.${target}`);
}

function appendAlternative(
  existing: GrammarExpression,
  extension: GrammarExpression,
): GrammarExpression {
  const options: GrammarExpression[] = [];
  if (existing.kind === "choice") {
    options.push(...existing.options);
  } else {
    options.push(existing);
  }
  if (extension.kind === "choice") {
    options.push(...extension.options);
  } else {
    options.push(extension);
  }
  return {
    kind: "choice",
    options,
    span: combineSpans(existing.span, extension.span),
  };
}

function cloneDeclaration(
  declaration: GrammarDeclaration,
): GrammarDeclaration {
  if (declaration.kind === "rule") {
    return {
      kind: "rule",
      name: declaration.name,
      annotations: [...declaration.annotations],
      expression: declaration.expression,
      span: declaration.span,
    };
  }
  return declaration;
}

function combineSpans(left: SourceSpan, right: SourceSpan): SourceSpan {
  return {
    start: left.start,
    end: right.end,
    line: left.line,
    column: left.column,
  };
}
