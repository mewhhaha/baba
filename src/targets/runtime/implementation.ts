export interface RuntimeImplementationSourceMetadata {
  readonly path: string;
  readonly role: string;
  readonly hash: string;
}

export interface RuntimeImplementationMetadata {
  readonly format: "baba-runtime-implementation";
  readonly version: 1;
  readonly semantics: "baba-runtime-portable-v1";
  readonly hash: string;
  readonly sources: readonly RuntimeImplementationSourceMetadata[];
}

export const RUNTIME_IMPLEMENTATION_FORMAT =
  "baba-runtime-implementation" as const;
export const RUNTIME_IMPLEMENTATION_VERSION = 1 as const;
export const RUNTIME_IMPLEMENTATION_SEMANTICS =
  "baba-runtime-portable-v1" as const;

export const RUNTIME_IMPLEMENTATION_SOURCES:
  readonly RuntimeImplementationSourceMetadata[] = [
    {
      path: "src/runtime/source_map.brl",
      role: "shared-brl-source-map",
      hash: "fnv1a64:224c05ae079edd0a",
    },
    {
      path: "src/runtime/lexer.brl",
      role: "shared-brl-lexer",
      hash: "fnv1a64:f7c666153fd2abb7",
    },
    {
      path: "src/runtime/parser.brl",
      role: "shared-brl-parser",
      hash: "fnv1a64:a7969cc9921f67d4",
    },
    {
      path: "src/runtime/branch_search.brl",
      role: "shared-brl-branch-search",
      hash: "fnv1a64:1911bf79e43284a6",
    },
    {
      path: "src/runtime/reductions.brl",
      role: "shared-brl-reductions",
      hash: "fnv1a64:42b9767fe38c09d1",
    },
    {
      path: "src/runtime/cst.brl",
      role: "shared-brl-cst",
      hash: "fnv1a64:301481c1d6bd2e3e",
    },
    {
      path: "src/runtime/token_stream.brl",
      role: "shared-brl-token-stream",
      hash: "fnv1a64:69213d70c0219621",
    },
    {
      path: "src/runtime/diagnostics.brl",
      role: "shared-brl-diagnostics",
      hash: "fnv1a64:ce4d444938367a40",
    },
    {
      path: "src/targets/runtime/public_source_text.ts",
      role: "public-source-text-boundary",
      hash: "fnv1a64:85aedc2a4c7538d6",
    },
    {
      path: "src/targets/runtime/public_lex_diagnostic_materializer.ts",
      role: "public-lex-diagnostic-materializer",
      hash: "fnv1a64:00da88a24f229bfe",
    },
    {
      path: "src/targets/runtime/public_lex_result_materializer.ts",
      role: "public-lex-result-materializer",
      hash: "fnv1a64:0032dfe5d1d49041",
    },
    {
      path: "src/targets/runtime/public_token_materializer.ts",
      role: "public-token-materializer",
      hash: "fnv1a64:d330acf141d38ce7",
    },
    {
      path: "src/targets/runtime/public_diagnostic_materializer.ts",
      role: "public-diagnostic-materializer",
      hash: "fnv1a64:e2b2be5c37cdeffb",
    },
    {
      path: "src/targets/runtime/public_parse_result_materializer.ts",
      role: "public-parse-result-materializer",
      hash: "fnv1a64:f17bda91bb4f9cfb",
    },
    {
      path: "src/targets/runtime/public_field_materializer.ts",
      role: "public-field-materializer",
      hash: "fnv1a64:a9bcd76e98c51ee5",
    },
    {
      path: "src/targets/runtime/public_rule_node_materializer.ts",
      role: "public-rule-node-materializer",
      hash: "fnv1a64:574e52fa708fe9e5",
    },
    {
      path: "src/targets/runtime/diagnostic_codes.ts",
      role: "parser-diagnostic-codes",
      hash: "fnv1a64:68ecf2feab9f4e9d",
    },
    {
      path: "src/targets/runtime/language_sources.ts",
      role: "runtime-language-source",
      hash: "fnv1a64:c37c4378ae453e01",
    },
    {
      path: "src/targets/runtime/language.ts",
      role: "runtime-language-compiler",
      hash: "fnv1a64:6f5893ae4b55f8aa",
    },
    {
      path: "src/targets/runtime/language_artifacts.ts",
      role: "runtime-language-artifact-manifest",
      hash: "fnv1a64:495f395c96083fb6",
    },
    {
      path: "src/targets/runtime/wasm_abi.ts",
      role: "wasm-abi-constants",
      hash: "fnv1a64:e38a60d5bef05b49",
    },
    {
      path: "src/targets/runtime/wasm_core_runtime.ts",
      role: "wasm-core-runtime",
      hash: "fnv1a64:4fcd54de0794e1c8",
    },
    {
      path: "src/runtime/mod.ts",
      role: "shared-parser-plan-adapter-api",
      hash: "fnv1a64:e74982f773efc9ee",
    },
    {
      path: "src/runtime/wasm.ts",
      role: "shared-wasm-runtime-api",
      hash: "fnv1a64:9d43ecb8a1d39432",
    },
    {
      path: "src/runtime/wasm_executor.ts",
      role: "shared-generic-wasm-executor",
      hash: "fnv1a64:0ef417aba3bc8330",
    },
    {
      path: "src/runtime/parser_plan.ts",
      role: "shared-runtime-parser-plan",
      hash: "fnv1a64:b597ee740a82bf7a",
    },
    {
      path: "src/targets/runtime/provenance.ts",
      role: "generated-source-provenance",
      hash: "fnv1a64:b810e814a119b80f",
    },
  ] as const;

export const RUNTIME_IMPLEMENTATION_HASH = "fnv1a64:8a3eca7f1237364e" as const;

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
