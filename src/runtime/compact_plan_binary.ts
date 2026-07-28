import {
  COMPACT_PLAN_VERSION,
  PARSER_PLAN_RUNTIME_METADATA_VERSION,
} from "../targets/runtime/parser_plan_contract.ts";

const MAGIC = new Uint8Array([66, 65, 66, 65, 95, 80, 76, 65, 78, 0]);

type CompactValue =
  | null
  | undefined
  | boolean
  | number
  | string
  | readonly CompactValue[]
  | { readonly [key: string]: CompactValue };

interface EncodeState {
  readonly strings: string[];
  readonly stringIds: Map<string, number>;
  readonly bytes: number[];
}

export interface CompactPlanBinaryInfo {
  readonly format: "baba-compact-plan";
  readonly version: typeof COMPACT_PLAN_VERSION;
  readonly stringCount: number;
  readonly bytes: number;
  readonly jsonBytes: number;
  readonly rootKind: string;
  readonly metadata?: {
    readonly runtimeMetadataVersion?: number;
    readonly parserPlanVersion?: number;
    readonly parserPlanHash?: string;
    readonly runtimeImplementationHash?: string;
  };
}

export function encodeCompactPlanBinary(value: unknown): Uint8Array {
  const compact = value as CompactValue;
  const strings: string[] = [];
  const stringIds = new Map<string, number>();
  collectStrings(compact, stringIds, strings);
  const payload: number[] = [];
  writeValue(payload, compact, stringIds);
  const bytes: number[] = [...MAGIC];
  writeU16(bytes, COMPACT_PLAN_VERSION);
  writeVarUint(bytes, strings.length);
  for (const string of strings) {
    const encoded = new TextEncoder().encode(string);
    writeVarUint(bytes, encoded.length);
    pushBytes(bytes, encoded);
  }
  writeVarUint(bytes, payload.length);
  pushBytes(bytes, payload);
  return new Uint8Array(bytes);
}

export function decodeCompactPlanBinary(bytes: Uint8Array): unknown {
  const reader = new Reader(bytes);
  for (const byte of MAGIC) {
    if (reader.u8() !== byte) throw new Error("Invalid compact plan magic.");
  }
  const version = reader.u16();
  if (version !== COMPACT_PLAN_VERSION) {
    throw new Error(`Unsupported compact plan version ${version}.`);
  }
  const stringCount = reader.varUint();
  const strings: string[] = [];
  const decoder = new TextDecoder();
  for (let index = 0; index < stringCount; index++) {
    const length = reader.varUint();
    strings.push(decoder.decode(reader.bytes(length)));
  }
  const payloadLength = reader.varUint();
  const payloadEnd = reader.offset + payloadLength;
  const value = readValue(reader, strings);
  if (reader.offset !== payloadEnd) {
    throw new Error("Compact plan payload has trailing bytes.");
  }
  if (reader.offset !== bytes.length) {
    throw new Error("Compact plan file has trailing bytes.");
  }
  return value;
}

export function inspectCompactPlanBinary(
  bytes: Uint8Array,
): CompactPlanBinaryInfo {
  const value = decodeCompactPlanBinary(bytes);
  const strings = new Set<string>();
  collectStrings(value as CompactValue, new Map(), []);
  collectStringSet(value, strings);
  const metadata = compactMetadata(value);
  return {
    format: "baba-compact-plan",
    version: COMPACT_PLAN_VERSION,
    stringCount: strings.size,
    bytes: bytes.length,
    jsonBytes: new TextEncoder().encode(JSON.stringify(value)).length,
    rootKind: Array.isArray(value) ? "array" : typeof value,
    ...(metadata ? { metadata } : {}),
  };
}

function compactMetadata(value: unknown): CompactPlanBinaryInfo["metadata"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const meta = (value as { m?: unknown }).m;
  if (Array.isArray(meta)) {
    if (meta[0] === PARSER_PLAN_RUNTIME_METADATA_VERSION) {
      const metadata: {
        runtimeMetadataVersion: number;
        parserPlanVersion?: number;
        parserPlanHash?: string;
        runtimeImplementationHash?: string;
      } = {
        runtimeMetadataVersion: PARSER_PLAN_RUNTIME_METADATA_VERSION,
      };
      if (typeof meta[2] === "number") {
        metadata.parserPlanVersion = meta[2];
      }
      if (typeof meta[4] === "string") {
        metadata.parserPlanHash = meta[4];
      }
      if (typeof meta[8] === "string") {
        metadata.runtimeImplementationHash = meta[8];
      }
      return metadata;
    }
  }
}

function collectStrings(
  value: CompactValue,
  stringIds: Map<string, number>,
  strings: string[],
): void {
  if (typeof value === "string") {
    internString(value, stringIds, strings);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, stringIds, strings);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    internString(key, stringIds, strings);
    collectStrings(child as CompactValue, stringIds, strings);
  }
}

function collectStringSet(value: unknown, strings: Set<string>): void {
  if (typeof value === "string") {
    strings.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringSet(item, strings);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    strings.add(key);
    collectStringSet(child, strings);
  }
}

function internString(
  value: string,
  stringIds: Map<string, number>,
  strings: string[],
): number {
  const existing = stringIds.get(value);
  if (existing !== undefined) return existing;
  const id = strings.length;
  stringIds.set(value, id);
  strings.push(value);
  return id;
}

function writeValue(
  bytes: number[],
  value: CompactValue,
  stringIds: ReadonlyMap<string, number>,
): void {
  if (value == null) {
    bytes.push(0);
  } else if (value === false) {
    bytes.push(1);
  } else if (value === true) {
    bytes.push(2);
  } else if (typeof value === "number") {
    bytes.push(3);
    writeZigZag(bytes, value);
  } else if (typeof value === "string") {
    bytes.push(4);
    writeVarUint(bytes, requiredStringId(stringIds, value));
  } else if (Array.isArray(value)) {
    bytes.push(5);
    writeVarUint(bytes, value.length);
    for (const item of value) writeValue(bytes, item, stringIds);
  } else {
    const entries = Object.entries(value);
    bytes.push(6);
    writeVarUint(bytes, entries.length);
    for (const [key, child] of entries) {
      writeVarUint(bytes, requiredStringId(stringIds, key));
      writeValue(bytes, child as CompactValue, stringIds);
    }
  }
}

function readValue(reader: Reader, strings: readonly string[]): CompactValue {
  const tag = reader.u8();
  if (tag === 0) return null;
  if (tag === 1) return false;
  if (tag === 2) return true;
  if (tag === 3) return readZigZag(reader);
  if (tag === 4) return requiredString(strings, reader.varUint());
  if (tag === 5) {
    const length = reader.varUint();
    const values: CompactValue[] = [];
    for (let index = 0; index < length; index++) {
      values.push(readValue(reader, strings));
    }
    return values;
  }
  if (tag === 6) {
    const length = reader.varUint();
    const value: Record<string, CompactValue> = {};
    for (let index = 0; index < length; index++) {
      value[requiredString(strings, reader.varUint())] = readValue(
        reader,
        strings,
      );
    }
    return value;
  }
  throw new Error(`Unknown compact plan value tag ${tag}.`);
}

function requiredStringId(
  stringIds: ReadonlyMap<string, number>,
  value: string,
): number {
  const id = stringIds.get(value);
  if (id === undefined) throw new Error(`Missing string table entry ${value}.`);
  return id;
}

function requiredString(strings: readonly string[], id: number): string {
  const value = strings[id];
  if (value === undefined) throw new Error(`Invalid string id ${id}.`);
  return value;
}

function writeU16(bytes: number[], value: number): void {
  bytes.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeVarUint(bytes: number[], value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Expected non-negative safe integer.");
  }
  let current = value;
  while (current >= 0x80) {
    bytes.push((current & 0x7f) | 0x80);
    current = Math.floor(current / 0x80);
  }
  bytes.push(current);
}

function writeZigZag(bytes: number[], value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError("Expected safe integer.");
  }
  writeVarUint(bytes, value >= 0 ? value * 2 : -value * 2 - 1);
}

function readZigZag(reader: Reader): number {
  const value = reader.varUint();
  return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
}

function pushBytes(bytes: number[], values: Uint8Array | number[]): void {
  for (const value of values) bytes.push(value);
}

class Reader {
  offset = 0;

  constructor(private readonly source: Uint8Array) {}

  u8(): number {
    if (this.offset >= this.source.length) {
      throw new Error("Unexpected end of compact plan.");
    }
    return this.source[this.offset++]!;
  }

  u16(): number {
    const low = this.u8();
    const high = this.u8();
    return low | (high << 8);
  }

  bytes(length: number): Uint8Array {
    if (this.offset + length > this.source.length) {
      throw new Error("Unexpected end of compact plan.");
    }
    const value = this.source.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  varUint(): number {
    let value = 0;
    let factor = 1;
    while (true) {
      const byte = this.u8();
      value += (byte & 0x7f) * factor;
      if ((byte & 0x80) === 0) return value;
      factor *= 0x80;
      if (factor > Number.MAX_SAFE_INTEGER) {
        throw new RangeError("Compact plan integer is too large.");
      }
    }
  }
}
