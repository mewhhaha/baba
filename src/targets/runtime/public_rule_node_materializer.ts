export function emitPublicRuleNodeMaterializer(): string {
  return `let RUNTIME_NODE_HANDLES: WeakMap<object, number> = new WeakMap();
const RUNTIME_SYNTAX_VALUES = new Map<number, SyntaxElement>();

function resetPublicSyntaxMaterialization(): void {
  RUNTIME_NODE_HANDLES = new WeakMap<object, number>();
  RUNTIME_SYNTAX_VALUES.clear();
}

function hostRuleNodeRuntimeHandle(node: AnyRuleNode): number | undefined {
  return RUNTIME_NODE_HANDLES.get(node as object);
}

function materializeRuleNode(
  sourceText: SourceTextBoundary,
  runtimeHandle: number,
): AnyRuleNode {
  const ruleId = parserRuleNodeRuleId(runtimeHandle);
  const node = {
    type: "rule",
    name: RULE_NAMES[ruleId],
    span: ruleNodeSpan(runtimeHandle),
    tokenRange: ruleNodeTokenRange(runtimeHandle),
    children: buildChildren(sourceText, runtimeHandle),
    fields: buildFields(sourceText, ruleId, runtimeHandle),
  };
  rememberRuleNodeRuntimeHandle(node as unknown as AnyRuleNode, runtimeHandle);
  rememberSyntaxValue(runtimeHandle, node as unknown as SyntaxElement);
  return node as unknown as AnyRuleNode;
}

function rememberRuleNodeRuntimeHandle(
  node: AnyRuleNode,
  runtimeHandle: number,
): void {
  RUNTIME_NODE_HANDLES.set(node as object, runtimeHandle);
}

function rememberSyntaxValue(handle: number, value: SyntaxElement): void {
  RUNTIME_SYNTAX_VALUES.set(handle, value);
}

function hostSyntaxValue(handle: number): SyntaxElement {
  const value = RUNTIME_SYNTAX_VALUES.get(handle);
  if (value === undefined) {
    throw new Error("Runtime syntax object is missing its host value.");
  }
  return value;
}

function buildChildren(
  sourceText: SourceTextBoundary,
  ruleNodeHandle: number,
): SyntaxElement[] {
  const count = parserRuleNodeChildCount(ruleNodeHandle);
  const status = parserRuleNodeChildListStatus(count);
  if (status === RULE_NODE_CHILD_LIST_EMPTY) return [];
  const children = parserRuleNodeChildren(ruleNodeHandle);
  const values: SyntaxElement[] = [];
  for (let index = 0; index < count; index++) {
    const child = runtimeVectorLoad(children, index);
    const existing = RUNTIME_SYNTAX_VALUES.get(child);
    values.push(
      existing ?? materializeRuntimeValue(sourceText, child) as SyntaxElement,
    );
  }
  return values;
}

function buildFields(
  sourceText: SourceTextBoundary,
  ruleId: number,
  ruleNodeHandle: number,
): Record<string, unknown> {
  const start = parserFieldStart(ruleId);
  const end = parserFieldEnd(ruleId);
  const captureCount = parserRuleNodeFieldCount(ruleNodeHandle);
  const schemaStatus = parserFieldSchemaStatus(start, end, captureCount);
  const buildStatus = parserFieldBuildStatus(start, end, schemaStatus);
  if (buildStatus === FIELD_BUILD_CAPTURE_WITHOUT_SCHEMA) {
    throw new Error("Rule has field captures but no field schema.");
  }
  if (buildStatus === FIELD_BUILD_EMPTY) {
    return createPublicFieldObject();
  }
  const counts = runtimeArrayNew(end - start);
  const fieldValues = runtimeRecordNew(ruleId, end - start);
  for (let entry = start; entry < end; entry++) {
    if (parserFieldStorageStatus(entry) === FIELD_STORAGE_ARRAY) {
      runtimeRecordStore(fieldValues, entry - start, runtimeVectorNew(0));
    }
  }
  const captures = parserRuleNodeFields(ruleNodeHandle);
  for (let index = 0; index < captureCount; index++) {
    const capture = runtimeVectorLoad(captures, index);
    const fieldId = parserFieldCaptureFieldId(capture);
    const value = parserFieldCaptureValue(capture);
    const entry = parserFieldIndex(ruleId, fieldId);
    if (parserFieldEntryStatus(entry) === FIELD_ENTRY_MISSING) {
      throw new Error(\`Unknown field capture '\${fieldName(fieldId)}'.\`);
    }
    const name = fieldName(fieldId);
    const countIndex = entry - start;
    const count = runtimeArrayLoad(counts, countIndex) + 1;
    runtimeArrayStore(counts, countIndex, count);
    const status = parserFieldCaptureStatus(
      entry,
      count,
    );
    if (status === FIELD_CAPTURE_ARRAY) {
      const values = runtimeRecordLoad(fieldValues, countIndex);
      if (parserFieldArrayValueStatus(values) === FIELD_ARRAY_VALUE_MISSING) {
        throw new Error(\`Array field '\${name}' was not initialized as a runtime vector.\`);
      }
      runtimeVectorAppend(values, value);
    } else if (status === FIELD_CAPTURE_SCALAR) {
      runtimeRecordStore(fieldValues, countIndex, value);
    } else if (status === FIELD_CAPTURE_TOO_MANY) {
      throw new Error(\`Scalar field '\${name}' was captured more than once.\`);
    } else {
      throw new Error(\`Unknown field capture '\${fieldName(fieldId)}'.\`);
    }
  }
  const fields = createPublicFieldObject();
  for (let entry = start; entry < end; entry++) {
    const fieldId = parserFieldId(entry);
    const name = fieldName(fieldId);
    const valueIndex = entry - start;
    const count = runtimeArrayLoad(counts, valueIndex);
    const finalBuildStatus = parserFieldFinalBuildStatus(entry, count);
    if (finalBuildStatus === FIELD_FINAL_BUILD_ARRAY) {
      storePublicField(fields, name, materializeFieldArray(
        sourceText,
        name,
        runtimeRecordLoad(fieldValues, valueIndex),
      ));
      continue;
    }
    if (finalBuildStatus === FIELD_FINAL_BUILD_REQUIRED_MISSING) {
      throw new Error(\`Required field '\${name}' was captured \${count} times.\`);
    }
    if (finalBuildStatus === FIELD_FINAL_BUILD_TOO_MANY) {
      throw new Error(\`Nullable field '\${name}' was captured more than once.\`);
    }
    storePublicField(
      fields,
      name,
      materializeFieldScalar(
        sourceText,
        count,
        runtimeRecordLoad(fieldValues, valueIndex),
      ),
    );
  }
  return fields;
}

function fieldName(fieldId: number): string {
  return FIELD_NAMES[fieldId] ?? \`#\${fieldId}\`;
}

function ruleNodeSpan(handle: number): Span {
  return {
    start: parserRuleNodeSpanStart(handle),
    end: parserRuleNodeSpanEnd(handle),
  };
}

function ruleNodeTokenRange(handle: number): TokenRange {
  return {
    start: parserRuleNodeTokenStart(handle),
    end: parserRuleNodeTokenEnd(handle),
  };
}`;
}
