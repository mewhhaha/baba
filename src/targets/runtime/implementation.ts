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
      hash: "fnv1a64:737bd6a616708231",
    },
    {
      path: "src/targets/runtime/language_sources.ts",
      role: "runtime-language-source",
      hash: "fnv1a64:c69b745862a0b2a4",
    },
    {
      path: "src/targets/runtime/language.ts",
      role: "runtime-language-compiler",
      hash: "fnv1a64:00fe03526a743086",
    },
    {
      path: "src/targets/runtime/language_artifacts.ts",
      role: "runtime-language-artifact-manifest",
      hash: "fnv1a64:ff79793f86883a23",
    },
    {
      path: "src/targets/runtime/typescript_parser_runtime.ts",
      role: "typescript-parser-runtime",
      hash: "fnv1a64:eb521d28555a1d82",
    },
    {
      path: "src/targets/runtime/wasm_core_runtime.ts",
      role: "wasm-core-runtime",
      hash: "fnv1a64:bf06b986eefa946a",
    },
  ] as const;

export const RUNTIME_IMPLEMENTATION_HASH = "fnv1a64:be6cb12b353b8140" as const;

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
