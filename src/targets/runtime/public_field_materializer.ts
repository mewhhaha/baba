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

function materializeFieldArray(name: string, vectorHandle: number): unknown[] {
  if (vectorHandle === 0) {
    throw new Error(\`Array field '\${name}' was not initialized as a runtime vector.\`);
  }
  const length = runtimeVectorLength(vectorHandle);
  const values: unknown[] = [];
  for (let index = 0; index < length; index++) {
    values.push(hostFragmentValue(runtimeVectorLoad(vectorHandle, index)));
  }
  return values;
}

function materializeFieldScalar(count: number, valueHandle: number): unknown {
  return count === 0 ? null : hostFragmentValue(valueHandle);
}`;
}
