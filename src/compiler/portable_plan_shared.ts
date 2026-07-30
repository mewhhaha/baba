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
  let high = 0xcbf29ce4;
  let low = 0x84222325;
  for (let index = 0; index < source.length; index++) {
    low = (low ^ source.charCodeAt(index)) >>> 0;
    const lowProduct = low * 0x1b3;
    const carry = Math.floor(lowProduct / 0x1_0000_0000);
    // FNV's 64-bit prime is 2^40 + 0x1b3.
    high = (
      Math.imul(high, 0x1b3) +
      Math.imul(low, 0x100) +
      carry
    ) >>> 0;
    low = lowProduct >>> 0;
  }
  return `${high.toString(16).padStart(8, "0")}${
    low.toString(16).padStart(8, "0")
  }`;
}

export function fnv1a64Bytes(bytes: Uint8Array): string {
  let high = 0xcbf29ce4;
  let low = 0x84222325;
  for (const byte of bytes) {
    low = (low ^ byte) >>> 0;
    const lowProduct = low * 0x1b3;
    const carry = Math.floor(lowProduct / 0x1_0000_0000);
    // FNV's 64-bit prime is 2^40 + 0x1b3.
    high = (
      Math.imul(high, 0x1b3) +
      Math.imul(low, 0x100) +
      carry
    ) >>> 0;
    low = lowProduct >>> 0;
  }
  return `${high.toString(16).padStart(8, "0")}${
    low.toString(16).padStart(8, "0")
  }`;
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
