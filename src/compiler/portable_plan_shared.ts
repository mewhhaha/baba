import type { LookaheadBitset } from "./runtime_plan/lr1.ts";

const MAX_SAFE_SERIALIZED_INTEGER = Number.MAX_SAFE_INTEGER;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSupportedInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 &&
    value <= MAX_SAFE_SERIALIZED_INTEGER;
}

export function isUnicodeScalar(value: number): boolean {
  return value >= 0 && value <= 0x10ffff &&
    !(value >= 0xd800 && value <= 0xdfff);
}

export function hasId(values: readonly unknown[], id: number): boolean {
  return values.some((value) => isRecord(value) && value.id === id);
}

export function integerProperty(
  value: Record<string, unknown>,
  key: string,
  path: string,
  fail: (path: string, message: string) => void,
): number | undefined {
  const child = value[key];
  if (!isSupportedInteger(child)) {
    fail(path, "must be a supported non-negative integer.");
    return undefined;
  }
  return child;
}

export function stringProperty(
  value: Record<string, unknown>,
  key: string,
  path: string,
  fail: (path: string, message: string) => void,
): string | undefined {
  const child = value[key];
  if (typeof child !== "string") {
    fail(path, "must be a string.");
    return undefined;
  }
  return child;
}

export function visitJson(
  value: unknown,
  path: string,
  visit: (path: string, value: unknown) => void,
): void {
  visit(path, value);
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      visitJson(child, `${path}[${index}]`, visit);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    visitJson(child, `${path}.${key}`, visit);
  }
}

export function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (!isRecord(value)) {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    result[key] = canonicalValue(value[key]);
  }
  return result;
}

export function fnv1a64String(source: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < source.length; index++) {
    hash ^= BigInt(source.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function lookaheadValues(lookaheads: LookaheadBitset): number[] {
  const values: number[] = [];
  for (let index = 0; index < lookaheads.size; index++) {
    let word = 0;
    const existing = lookaheads.words[index >> 5];
    if (existing !== undefined) {
      word = existing;
    }
    if ((word & (1 << (index & 31))) !== 0) {
      values.push(index);
    }
  }
  return values;
}
