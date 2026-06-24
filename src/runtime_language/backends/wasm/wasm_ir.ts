export type WasmValueType = "i32" | "i64" | "f32" | "f64";

export interface WasmModuleIr {
  readonly memory?: WasmMemoryIr;
  readonly dataSegments?: readonly WasmDataSegmentIr[];
  readonly functions: readonly WasmFunctionIr[];
}

export interface WasmMemoryIr {
  readonly minPages: number;
  readonly maxPages?: number;
  readonly exportName?: string;
}

export interface WasmDataSegmentIr {
  readonly offset: number;
  readonly bytes: readonly number[];
}

export interface WasmFunctionIr {
  readonly name: string;
  readonly params?: readonly WasmLocalIr[];
  readonly results?: readonly WasmValueType[];
  readonly locals?: readonly WasmLocalIr[];
  readonly body: readonly WasmInstructionIr[];
  readonly exportName?: string;
}

export interface WasmLocalIr {
  readonly name: string;
  readonly type: WasmValueType;
}

export type WasmInstructionIr =
  | { readonly kind: "unreachable" }
  | { readonly kind: "return" }
  | { readonly kind: "drop" }
  | { readonly kind: "i32.const"; readonly value: number }
  | { readonly kind: "i32.eqz" }
  | { readonly kind: "local.get"; readonly index: number }
  | { readonly kind: "local.set"; readonly index: number }
  | { readonly kind: "local.tee"; readonly index: number }
  | { readonly kind: "call"; readonly functionIndex: number }
  | { readonly kind: "br"; readonly depth: number }
  | { readonly kind: "br_if"; readonly depth: number }
  | WasmMemoryInstructionIr
  | { readonly kind: WasmI32BinaryInstruction }
  | { readonly kind: WasmI32ComparisonInstruction }
  | WasmBlockInstructionIr
  | WasmIfInstructionIr;

export type WasmMemoryInstructionIr =
  | {
    readonly kind: WasmMemoryLoadInstruction;
    readonly align?: number;
    readonly offset?: number;
  }
  | {
    readonly kind: WasmMemoryStoreInstruction;
    readonly align?: number;
    readonly offset?: number;
  };

export type WasmMemoryLoadInstruction =
  | "i32.load"
  | "i32.load8_u"
  | "i32.load16_u";

export type WasmMemoryStoreInstruction =
  | "i32.store"
  | "i32.store8"
  | "i32.store16";

export type WasmI32BinaryInstruction =
  | "i32.add"
  | "i32.sub"
  | "i32.mul"
  | "i32.div_s"
  | "i32.div_u"
  | "i32.rem_s"
  | "i32.rem_u"
  | "i32.and"
  | "i32.or"
  | "i32.xor"
  | "i32.shl"
  | "i32.shr_u"
  | "i32.shr_s";

export type WasmI32ComparisonInstruction =
  | "i32.eq"
  | "i32.ne"
  | "i32.lt_u"
  | "i32.lt_s"
  | "i32.le_u"
  | "i32.le_s"
  | "i32.gt_u"
  | "i32.gt_s"
  | "i32.ge_u"
  | "i32.ge_s";

export interface WasmBlockInstructionIr {
  readonly kind: "block" | "loop";
  readonly result?: WasmValueType;
  readonly body: readonly WasmInstructionIr[];
}

export interface WasmIfInstructionIr {
  readonly kind: "if";
  readonly result?: WasmValueType;
  readonly consequent: readonly WasmInstructionIr[];
  readonly alternate?: readonly WasmInstructionIr[];
}
