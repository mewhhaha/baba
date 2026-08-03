export interface RuntimeImplementationSourceMetadata {
  readonly path: string;
  readonly role: string;
  readonly hash: string;
}

export interface RuntimeImplementationMetadata {
  readonly format: "baba-runtime-implementation";
  readonly version: 6;
  readonly semantics: "baba-runtime-island-v6";
  readonly hash: string;
  readonly sources: readonly RuntimeImplementationSourceMetadata[];
}

export const RUNTIME_IMPLEMENTATION_FORMAT =
  "baba-runtime-implementation" as const;
export const RUNTIME_IMPLEMENTATION_VERSION = 6 as const;
export const RUNTIME_IMPLEMENTATION_SEMANTICS =
  "baba-runtime-island-v6" as const;

export const RUNTIME_IMPLEMENTATION_SOURCES:
  readonly RuntimeImplementationSourceMetadata[] = [
    {
      path: "src/runtime/compact_plan_binary.ts",
      role: "compact-runtime-metadata-codec",
      hash: "fnv1a64:73106fa1e6dec290",
    },
    {
      path: "src/targets/runtime/parser_plan_contract.ts",
      role: "parser-plan-contract",
      hash: "fnv1a64:37f1e8a277accfc4",
    },
    {
      path: "src/runtime/wasm_plan.ts",
      role: "combined-wasm-parser-plan-format",
      hash: "fnv1a64:e3bbbf5abccdbcf9",
    },
    {
      path: "src/runtime/generated_wasm.ts",
      role: "generated-wasm-parser-loader",
      hash: "fnv1a64:3bdc684bf684d8e3",
    },
    {
      path: "src/runtime/island_parser.ts",
      role: "island-parser-loader",
      hash: "fnv1a64:4d715d0107d83255",
    },
    {
      path: "src/runtime/island_parser_wasm_bytes.ts",
      role: "island-parser-embedded-bytes",
      hash: "fnv1a64:1108930ae1512602",
    },
    {
      path: "src/targets/runtime/diagnostic_codes.ts",
      role: "parser-diagnostic-codes",
      hash: "fnv1a64:a32c46ae663bb135",
    },
    {
      path: "src/targets/runtime/wasm_abi.ts",
      role: "wasm-abi-constants",
      hash: "fnv1a64:acda14a8a81f3075",
    },
    {
      path: "src/targets/runtime/wasm_core_runtime.ts",
      role: "wasm-core-runtime",
      hash: "fnv1a64:1f59f6434e143011",
    },
    {
      path: "scripts/build_wasm_engine.ts",
      role: "wasm-core-runtime-build-script",
      hash: "fnv1a64:0e3f0c814ca30bd8",
    },
    {
      path: "scripts/build_island_parser.ts",
      role: "island-parser-build-script",
      hash: "fnv1a64:b0cd2fc4023c7894",
    },
    {
      path: "src/targets/runtime/wasm_engine_rs/Cargo.toml",
      role: "wasm-core-runtime-rust-manifest",
      hash: "fnv1a64:9d747b0a9befa263",
    },
    {
      path: "src/targets/runtime/wasm_engine_rs/Cargo.lock",
      role: "wasm-core-runtime-rust-lockfile",
      hash: "fnv1a64:5ed2c17013d131d2",
    },
    {
      path: "src/targets/runtime/wasm_engine_rs/.cargo/config.toml",
      role: "wasm-core-runtime-rust-build-config",
      hash: "fnv1a64:a58a986ab00c2373",
    },
    {
      path: "src/targets/runtime/wasm_engine_rs/src/lib.rs",
      role: "wasm-core-runtime-rust-source",
      hash: "fnv1a64:722a0a5dfc04ec99",
    },
    {
      path: "src/targets/runtime/wasm_core_runtime_bytes.ts",
      role: "wasm-core-runtime-embedded-bytes",
      hash: "fnv1a64:ad9912b89d6180ef",
    },
    {
      path: "src/targets/runtime/island_parser_rs/Cargo.toml",
      role: "island-parser-rust-manifest",
      hash: "fnv1a64:0456d7fe8bba5611",
    },
    {
      path: "src/targets/runtime/island_parser_rs/Cargo.lock",
      role: "island-parser-rust-lockfile",
      hash: "fnv1a64:a4524c6c4311d2f5",
    },
    {
      path: "src/targets/runtime/island_parser_rs/.cargo/config.toml",
      role: "island-parser-rust-build-config",
      hash: "fnv1a64:c6144287f9966f55",
    },
    {
      path: "src/targets/runtime/island_parser_rs/src/lib.rs",
      role: "island-parser-rust-source",
      hash: "fnv1a64:67237226793bd205",
    },
    {
      path: "src/targets/runtime/provenance.ts",
      role: "generated-source-provenance",
      hash: "fnv1a64:5c376f22eb5e986c",
    },
  ] as const;

export const RUNTIME_IMPLEMENTATION_HASH = "fnv1a64:cd6f2b27c0c81459" as const;

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
