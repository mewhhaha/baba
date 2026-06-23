export function emitPublicFieldMaterializer(): string {
  return `function createPublicFieldObject(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

function storePublicField(
  fields: Record<string, unknown>,
  name: string,
  value: unknown,
): void {
  fields[name] = value;
}

function materializeFieldArray(
  sourceText: SourceTextBoundary,
  name: string,
  vectorHandle: number,
): unknown[] {
  const status = parserFieldArrayValueStatus(vectorHandle);
  if (status === FIELD_ARRAY_VALUE_MISSING) {
    throw new Error(\`Array field '\${name}' was not initialized as a runtime vector.\`);
  }
  const length = runtimeVectorLength(vectorHandle);
  const values: unknown[] = [];
  for (let index = 0; index < length; index++) {
    values.push(hostFragmentValue(
      sourceText,
      runtimeVectorLoad(vectorHandle, index),
    ));
  }
  return values;
}

function materializeFieldScalar(
  sourceText: SourceTextBoundary,
  count: number,
  valueHandle: number,
): unknown {
  const status = parserFieldScalarValueStatus(count);
  return status === FIELD_SCALAR_VALUE_NULL
    ? null
    : hostFragmentValue(sourceText, valueHandle);
}`;
}
