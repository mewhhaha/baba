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
      hash: "fnv1a64:d9ccaba15a195d48",
    },
    {
      path: "src/runtime/lexer.brl",
      role: "shared-brl-lexer",
      hash: "fnv1a64:a8a4abcc02bc5026",
    },
    {
      path: "src/runtime/parser.brl",
      role: "shared-brl-parser",
      hash: "fnv1a64:c443a73b566f917a",
    },
    {
      path: "src/runtime/branch_search.brl",
      role: "shared-brl-branch-search",
      hash: "fnv1a64:3657073b777ec67c",
    },
    {
      path: "src/runtime/reductions.brl",
      role: "shared-brl-reductions",
      hash: "fnv1a64:e5bc50f4eda21f54",
    },
    {
      path: "src/runtime/cst.brl",
      role: "shared-brl-cst",
      hash: "fnv1a64:a484570b0e81f682",
    },
    {
      path: "src/runtime/token_stream.brl",
      role: "shared-brl-token-stream",
      hash: "fnv1a64:d3be8fffab8ffe0a",
    },
    {
      path: "src/runtime/diagnostics.brl",
      role: "shared-brl-diagnostics",
      hash: "fnv1a64:ce4d444938367a40",
    },
    {
      path: "src/targets/runtime/typescript_lexer_runtime.ts",
      role: "typescript-lexer-runtime",
      hash: "fnv1a64:bf60820c7a89d453",
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
      hash: "fnv1a64:664b1265c2dac0ad",
    },
    {
      path: "src/targets/runtime/public_parse_result_materializer.ts",
      role: "public-parse-result-materializer",
      hash: "fnv1a64:af4871ee34eddbb2",
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
      hash: "fnv1a64:9652595e9f642839",
    },
    {
      path: "src/targets/runtime/language.ts",
      role: "runtime-language-compiler",
      hash: "fnv1a64:6f5893ae4b55f8aa",
    },
    {
      path: "src/targets/runtime/language_artifacts.ts",
      role: "runtime-language-artifact-manifest",
      hash: "fnv1a64:931b97a304d2c1c3",
    },
    {
      path: "src/targets/runtime/typescript_parser_runtime.ts",
      role: "typescript-parser-runtime",
      hash: "fnv1a64:b4b13456c79a879b",
    },
    {
      path: "src/targets/runtime/wasm_abi.ts",
      role: "wasm-abi-constants",
      hash: "fnv1a64:e38a60d5bef05b49",
    },
    {
      path: "src/targets/runtime/wasm_core_runtime.ts",
      role: "wasm-core-runtime",
      hash: "fnv1a64:a057c8f7654a12e7",
    },
  ] as const;

export const RUNTIME_IMPLEMENTATION_HASH = "fnv1a64:7b0382cfc5222422" as const;

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
