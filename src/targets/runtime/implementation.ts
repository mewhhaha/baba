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
      path: "src/targets/runtime/typescript_lexer_runtime.ts",
      role: "typescript-lexer-runtime",
      hash: "fnv1a64:48d380f97852b264",
    },
    {
      path: "src/targets/runtime/public_source_text.ts",
      role: "public-source-text-boundary",
      hash: "fnv1a64:c83bb21894ce29cd",
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
      hash: "fnv1a64:8305ad0a3e834e89",
    },
    {
      path: "src/targets/runtime/public_parse_result_materializer.ts",
      role: "public-parse-result-materializer",
      hash: "fnv1a64:af4871ee34eddbb2",
    },
    {
      path: "src/targets/runtime/public_field_materializer.ts",
      role: "public-field-materializer",
      hash: "fnv1a64:22689d1b92d676e8",
    },
    {
      path: "src/targets/runtime/public_rule_node_materializer.ts",
      role: "public-rule-node-materializer",
      hash: "fnv1a64:7d824b268f905e54",
    },
    {
      path: "src/targets/runtime/diagnostic_codes.ts",
      role: "parser-diagnostic-codes",
      hash: "fnv1a64:30b75c8ec7dd9a74",
    },
    {
      path: "src/targets/runtime/language_sources.ts",
      role: "runtime-language-source",
      hash: "fnv1a64:7069bdc95b3545e4",
    },
    {
      path: "src/targets/runtime/language.ts",
      role: "runtime-language-compiler",
      hash: "fnv1a64:c17b70b9cda1864c",
    },
    {
      path: "src/targets/runtime/language_artifacts.ts",
      role: "runtime-language-artifact-manifest",
      hash: "fnv1a64:de0369a70d2ea30f",
    },
    {
      path: "src/targets/runtime/typescript_parser_runtime.ts",
      role: "typescript-parser-runtime",
      hash: "fnv1a64:0a26fdbcceaf189e",
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

export const RUNTIME_IMPLEMENTATION_HASH = "fnv1a64:f0da8c52558c7cdc" as const;

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
