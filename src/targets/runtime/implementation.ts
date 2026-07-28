export interface RuntimeImplementationSourceMetadata {
  readonly path: string;
  readonly role: string;
  readonly hash: string;
}

export interface RuntimeImplementationMetadata {
  readonly format: "baba-runtime-implementation";
  readonly version: 2;
  readonly semantics: "baba-runtime-portable-v2";
  readonly hash: string;
  readonly sources: readonly RuntimeImplementationSourceMetadata[];
}

export const RUNTIME_IMPLEMENTATION_FORMAT =
  "baba-runtime-implementation" as const;
export const RUNTIME_IMPLEMENTATION_VERSION = 2 as const;
export const RUNTIME_IMPLEMENTATION_SEMANTICS =
  "baba-runtime-portable-v2" as const;

export const RUNTIME_IMPLEMENTATION_SOURCES:
  readonly RuntimeImplementationSourceMetadata[] = [
    {
      path: "src/runtime/compact_plan_binary.ts",
      role: "compact-runtime-metadata-codec",
      hash: "fnv1a64:0af0371c04f3672a",
    },
    {
      path: "src/targets/runtime/parser_plan_contract.ts",
      role: "parser-plan-contract",
      hash: "fnv1a64:1e439c267dfb05bc",
    },
    {
      path: "src/runtime/wasm_plan.ts",
      role: "combined-wasm-parser-plan-format",
      hash: "fnv1a64:6c3df46657c38b51",
    },
    {
      path: "src/runtime/generated_wasm.ts",
      role: "generated-wasm-parser-loader",
      hash: "fnv1a64:e211c3450b0e49de",
    },
    {
      path: "src/targets/runtime/diagnostic_codes.ts",
      role: "parser-diagnostic-codes",
      hash: "fnv1a64:a32c46ae663bb135",
    },
    {
      path: "src/targets/runtime/wasm_abi.ts",
      role: "wasm-abi-constants",
      hash: "fnv1a64:9f9a4b01a39d7ee9",
    },
    {
      path: "src/targets/runtime/wasm_core_runtime.ts",
      role: "wasm-core-runtime",
      hash: "fnv1a64:5d23330897c74f83",
    },
    {
      path: "scripts/build_wasm_engine.ts",
      role: "wasm-core-runtime-build-script",
      hash: "fnv1a64:b62d924a8f339796",
    },
    {
      path: "src/targets/runtime/wasm_engine_rs/Cargo.toml",
      role: "wasm-core-runtime-rust-manifest",
      hash: "fnv1a64:8072742c77eb16c0",
    },
    {
      path: "src/targets/runtime/wasm_engine_rs/Cargo.lock",
      role: "wasm-core-runtime-rust-lockfile",
      hash: "fnv1a64:0a819286a77f8fe7",
    },
    {
      path: "src/targets/runtime/wasm_engine_rs/.cargo/config.toml",
      role: "wasm-core-runtime-rust-build-config",
      hash: "fnv1a64:a58a986ab00c2373",
    },
    {
      path: "src/targets/runtime/wasm_engine_rs/src/lib.rs",
      role: "wasm-core-runtime-rust-source",
      hash: "fnv1a64:e640a10e6a51b2fe",
    },
    {
      path: "src/targets/runtime/wasm_core_runtime_bytes.ts",
      role: "wasm-core-runtime-embedded-bytes",
      hash: "fnv1a64:0ec1a50de6c9a299",
    },
    {
      path: "src/targets/runtime/provenance.ts",
      role: "generated-source-provenance",
      hash: "fnv1a64:5c376f22eb5e986c",
    },
  ] as const;

export const RUNTIME_IMPLEMENTATION_HASH = "fnv1a64:a549e00e46842f5a" as const;

export const RUNTIME_IMPLEMENTATION_METADATA: RuntimeImplementationMetadata = {
  format: RUNTIME_IMPLEMENTATION_FORMAT,
  version: RUNTIME_IMPLEMENTATION_VERSION,
  semantics: RUNTIME_IMPLEMENTATION_SEMANTICS,
  hash: RUNTIME_IMPLEMENTATION_HASH,
  sources: RUNTIME_IMPLEMENTATION_SOURCES,
};

export function hashRuntimeImplementationSource(source: string): string {
  return fnv1a64(new TextEncoder().encode(source));
}

export function hashRuntimeImplementationManifest(
  sources: readonly RuntimeImplementationSourceMetadata[],
): string {
  return fnv1a64(
    new TextEncoder().encode(
      JSON.stringify({
        format: RUNTIME_IMPLEMENTATION_FORMAT,
        version: RUNTIME_IMPLEMENTATION_VERSION,
        semantics: RUNTIME_IMPLEMENTATION_SEMANTICS,
        sources,
      }),
    ),
  );
}

function fnv1a64(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}
