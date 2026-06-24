import type { BrlDiagnostic } from "./diagnostics.ts";
import { brlDiagnostic } from "./diagnostics.ts";
import {
  BRL_BOOL,
  type BrlIrExpression,
  type BrlIrFunction,
  type BrlIrProgram,
  type BrlIrRecord,
  type BrlIrType,
  formatBrlIrType,
  isIntegerBrlIrType,
  sameBrlIrType,
} from "./ir.ts";

export function verifyRuntimeIr(
  program: BrlIrProgram,
): readonly BrlDiagnostic[] {
  const diagnostics: BrlDiagnostic[] = [];
  if (program.functions.length === 0) {
    diagnostics.push(
      brlDiagnostic(
        "BRL_IR_MISSING_ENTRYPOINT",
        "IR program has no functions.",
      ),
    );
  }
  const recordIds = new Set(program.records.map((record) => record.id));
  for (const record of program.records) {
    for (const field of record.fields) {
      verifyType(field.type, recordIds, diagnostics);
    }
  }
  for (const fn of program.functions) {
    verifyFunction(fn, program.records, recordIds, diagnostics);
  }
  return diagnostics;
}

function verifyFunction(
  fn: BrlIrFunction,
  records: readonly BrlIrRecord[],
  recordIds: ReadonlySet<number>,
  diagnostics: BrlDiagnostic[],
): void {
  const locals = new Map(fn.locals.map((local) => [local.id, local]));
  const blocks = new Map(fn.blocks.map((block) => [block.id, block]));
  for (const local of fn.locals) verifyType(local.type, recordIds, diagnostics);
  const initializedByBlock = initializedBlockInputs(fn);
  for (const block of fn.blocks) {
    const initialized = new Set(
      initializedByBlock.get(block.id) ?? fn.params.map((param) => param.id),
    );
    for (const instruction of block.instructions) {
      switch (instruction.kind) {
        case "assign":
          if (!locals.has(instruction.local)) {
            diagnostics.push(
              brlDiagnostic(
                "BRL_IR_INVALID_LOCAL",
                `Unknown local ${instruction.local}.`,
                instruction.span,
              ),
            );
          }
          verifyExpression(
            instruction.value,
            locals,
            records,
            recordIds,
            initialized,
            diagnostics,
          );
          initialized.add(instruction.local);
          break;
        case "evaluate":
          verifyExpression(
            instruction.value,
            locals,
            records,
            recordIds,
            initialized,
            diagnostics,
          );
          break;
        case "trap":
          break;
      }
    }
    if (!block.terminator) {
      diagnostics.push(
        brlDiagnostic(
          "BRL_IR_MISSING_TERMINATOR",
          `Block ${block.id} has no terminator.`,
          block.span,
        ),
      );
      continue;
    }
    switch (block.terminator.kind) {
      case "return": {
        const value = block.terminator.value;
        if (value) {
          verifyExpression(
            value,
            locals,
            records,
            recordIds,
            initialized,
            diagnostics,
          );
        }
        if (!sameBrlIrType(fn.result, value?.type ?? null)) {
          diagnostics.push(
            brlDiagnostic(
              "BRL_IR_RETURN_TYPE",
              `Function '${fn.name}' returns ${
                formatBrlIrType(value?.type ?? null)
              } but declares ${formatBrlIrType(fn.result)}.`,
              block.terminator.span,
            ),
          );
        }
        break;
      }
      case "jump":
        if (!blocks.has(block.terminator.target)) {
          diagnostics.push(
            brlDiagnostic(
              "BRL_IR_INVALID_BRANCH",
              `Unknown branch target ${block.terminator.target}.`,
              block.terminator.span,
            ),
          );
        }
        break;
      case "branch":
        verifyExpression(
          block.terminator.condition,
          locals,
          records,
          recordIds,
          initialized,
          diagnostics,
        );
        if (!sameBrlIrType(block.terminator.condition.type, BRL_BOOL)) {
          diagnostics.push(
            brlDiagnostic(
              "BRL_IR_INVALID_OPERAND",
              "Branch condition must be bool.",
              block.terminator.span,
            ),
          );
        }
        if (
          !blocks.has(block.terminator.consequent) ||
          !blocks.has(block.terminator.alternate)
        ) {
          diagnostics.push(
            brlDiagnostic(
              "BRL_IR_INVALID_BRANCH",
              "Branch target is unknown.",
              block.terminator.span,
            ),
          );
        }
        break;
    }
  }
}

function initializedBlockInputs(
  fn: BrlIrFunction,
): ReadonlyMap<number, ReadonlySet<number>> {
  const blocks = new Map(fn.blocks.map((block) => [block.id, block]));
  const inputs = new Map<number, Set<number>>();
  const entry = fn.blocks[0];
  if (!entry) return inputs;
  inputs.set(entry.id, new Set(fn.params.map((param) => param.id)));

  let changed = true;
  while (changed) {
    changed = false;
    for (const block of fn.blocks) {
      const input = inputs.get(block.id);
      if (!input) continue;
      const output = new Set(input);
      for (const instruction of block.instructions) {
        if (instruction.kind === "assign") output.add(instruction.local);
      }
      const targets = block.terminator
        ? terminatorTargets(block.terminator)
        : [];
      for (const target of targets) {
        if (!blocks.has(target)) continue;
        const existing = inputs.get(target);
        if (!existing) {
          inputs.set(target, new Set(output));
          changed = true;
          continue;
        }
        for (const local of output) {
          if (!existing.has(local)) {
            existing.add(local);
            changed = true;
          }
        }
      }
    }
  }
  return inputs;
}

function terminatorTargets(
  terminator: NonNullable<BrlIrFunction["blocks"][number]["terminator"]>,
): readonly number[] {
  switch (terminator.kind) {
    case "return":
      return [];
    case "jump":
      return [terminator.target];
    case "branch":
      return [terminator.consequent, terminator.alternate];
  }
}

function verifyExpression(
  expression: BrlIrExpression,
  locals: ReadonlyMap<number, { readonly type: BrlIrType }>,
  records: readonly BrlIrRecord[],
  recordIds: ReadonlySet<number>,
  initialized: ReadonlySet<number>,
  diagnostics: BrlDiagnostic[],
): void {
  verifyType(expression.type, recordIds, diagnostics);
  switch (expression.kind) {
    case "literal":
      break;
    case "local": {
      const local = locals.get(expression.local);
      if (!local) {
        diagnostics.push(
          brlDiagnostic(
            "BRL_IR_INVALID_LOCAL",
            `Unknown local ${expression.local}.`,
            expression.span,
          ),
        );
      } else if (!sameBrlIrType(local.type, expression.type)) {
        diagnostics.push(
          brlDiagnostic(
            "BRL_IR_INVALID_OPERAND",
            "Local expression type does not match local declaration.",
            expression.span,
          ),
        );
      } else if (!initialized.has(expression.local)) {
        diagnostics.push(
          brlDiagnostic(
            "BRL_IR_USE_BEFORE_DEFINITION",
            `Local ${expression.local} is used before definition.`,
            expression.span,
          ),
        );
      }
      break;
    }
    case "binary":
      verifyExpression(
        expression.left,
        locals,
        records,
        recordIds,
        initialized,
        diagnostics,
      );
      verifyExpression(
        expression.right,
        locals,
        records,
        recordIds,
        initialized,
        diagnostics,
      );
      if (!sameBrlIrType(expression.left.type, expression.right.type)) {
        diagnostics.push(
          brlDiagnostic(
            "BRL_IR_INVALID_OPERAND",
            "Binary operand types do not match.",
            expression.span,
          ),
        );
      }
      if (
        !isIntegerBrlIrType(expression.left.type) &&
        !sameBrlIrType(expression.type, BRL_BOOL)
      ) {
        diagnostics.push(
          brlDiagnostic(
            "BRL_IR_INVALID_OPERAND",
            "Binary arithmetic requires integer operands.",
            expression.span,
          ),
        );
      }
      break;
    case "record": {
      if (expression.type.kind !== "record") {
        diagnostics.push(
          brlDiagnostic(
            "BRL_IR_INVALID_OPERAND",
            "Record expression must have record type.",
            expression.span,
          ),
        );
        break;
      }
      const type = expression.type;
      const record = records.find((entry) => entry.id === type.id);
      if (!record) {
        diagnostics.push(
          brlDiagnostic(
            "BRL_IR_INVALID_FIELD",
            `Unknown record type ${expression.type.id}.`,
            expression.span,
          ),
        );
        break;
      }
      const fieldIds = new Set<number>();
      for (const field of expression.fields) {
        const declaration = record.fields.find((entry) =>
          entry.id === field.fieldId
        );
        if (!declaration) {
          diagnostics.push(
            brlDiagnostic(
              "BRL_IR_INVALID_FIELD",
              `Record ${record.name} has no field ${field.fieldId}.`,
              field.span,
            ),
          );
        }
        verifyExpression(
          field.value,
          locals,
          records,
          recordIds,
          initialized,
          diagnostics,
        );
        if (fieldIds.has(field.fieldId)) {
          diagnostics.push(
            brlDiagnostic(
              "BRL_IR_INVALID_FIELD",
              `Duplicate record field ${field.fieldId}.`,
              field.span,
            ),
          );
        }
        fieldIds.add(field.fieldId);
        if (declaration && !sameBrlIrType(declaration.type, field.value.type)) {
          diagnostics.push(
            brlDiagnostic(
              "BRL_IR_INVALID_FIELD",
              `Record field ${field.fieldId} has type ${
                formatBrlIrType(field.value.type)
              }, expected ${formatBrlIrType(declaration.type)}.`,
              field.span,
            ),
          );
        }
      }
      for (const declaration of record.fields) {
        if (!fieldIds.has(declaration.id)) {
          diagnostics.push(
            brlDiagnostic(
              "BRL_IR_INVALID_FIELD",
              `Record expression is missing field ${declaration.id}.`,
              expression.span,
            ),
          );
        }
      }
      break;
    }
    case "unary":
      verifyExpression(
        expression.operand,
        locals,
        records,
        recordIds,
        initialized,
        diagnostics,
      );
      if (expression.operator !== "!") {
        diagnostics.push(
          brlDiagnostic(
            "BRL_IR_INVALID_OPERAND",
            `Unsupported unary operator '${expression.operator}'.`,
            expression.span,
          ),
        );
      }
      if (
        !sameBrlIrType(expression.operand.type, BRL_BOOL) ||
        !sameBrlIrType(expression.type, BRL_BOOL)
      ) {
        diagnostics.push(
          brlDiagnostic(
            "BRL_IR_INVALID_OPERAND",
            "Unary not requires bool operand and result.",
            expression.span,
          ),
        );
      }
      break;
    case "call":
      for (const arg of expression.args) {
        verifyExpression(
          arg,
          locals,
          records,
          recordIds,
          initialized,
          diagnostics,
        );
      }
      break;
    case "field":
      verifyExpression(
        expression.receiver,
        locals,
        records,
        recordIds,
        initialized,
        diagnostics,
      );
      if (expression.fieldId < -1) {
        diagnostics.push(
          brlDiagnostic(
            "BRL_IR_INVALID_FIELD",
            `Invalid field id ${expression.fieldId}.`,
            expression.span,
          ),
        );
      }
      break;
    case "index":
      verifyExpression(
        expression.receiver,
        locals,
        records,
        recordIds,
        initialized,
        diagnostics,
      );
      verifyExpression(
        expression.index,
        locals,
        records,
        recordIds,
        initialized,
        diagnostics,
      );
      if (!isIntegerBrlIrType(expression.index.type)) {
        diagnostics.push(
          brlDiagnostic(
            "BRL_IR_INVALID_OPERAND",
            "Index operand must be an integer.",
            expression.span,
          ),
        );
      }
      break;
    case "cast":
      verifyExpression(
        expression.expression,
        locals,
        records,
        recordIds,
        initialized,
        diagnostics,
      );
      if (!canCast(expression.expression.type, expression.type)) {
        diagnostics.push(
          brlDiagnostic(
            "BRL_IR_INVALID_CAST",
            "IR cast is not legal.",
            expression.span,
          ),
        );
      }
      break;
  }
}

function verifyType(
  type: BrlIrType,
  recordIds: ReadonlySet<number>,
  diagnostics: BrlDiagnostic[],
): void {
  switch (type.kind) {
    case "record":
      if (!recordIds.has(type.id)) {
        diagnostics.push(
          brlDiagnostic(
            "BRL_IR_INVALID_FIELD",
            `Unknown record type ${type.id}.`,
          ),
        );
      }
      break;
    case "array":
    case "span":
    case "vec":
      verifyType(type.element, recordIds, diagnostics);
      break;
    case "scalar":
      break;
  }
}

function canCast(from: BrlIrType, to: BrlIrType): boolean {
  return sameBrlIrType(from, to) ||
    (from.kind === "scalar" && to.kind === "scalar" &&
      ((from.name === "bool" && isIntegerBrlIrType(to)) ||
        (to.name === "bool" && isIntegerBrlIrType(from)) ||
        (isIntegerBrlIrType(from) && isIntegerBrlIrType(to))));
}
