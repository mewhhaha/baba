import {
  RUNTIME_LANGUAGE_SEMANTICS,
  RUNTIME_LANGUAGE_VERSION,
} from "./language.ts";

export interface RuntimeLanguageCompilerSourceMetadata {
  readonly path: string;
  readonly role: string;
  readonly hash: string;
}

export interface RuntimeLanguageCompilerMetadata {
  readonly format: "baba-runtime-language-compiler";
  readonly version: 1;
  readonly languageVersion: typeof RUNTIME_LANGUAGE_VERSION;
  readonly languageSemantics: typeof RUNTIME_LANGUAGE_SEMANTICS;
  readonly hash: string;
  readonly sources: readonly RuntimeLanguageCompilerSourceMetadata[];
}

export const RUNTIME_LANGUAGE_COMPILER_FORMAT =
  "baba-runtime-language-compiler" as const;
export const RUNTIME_LANGUAGE_COMPILER_VERSION = 1 as const;

export const RUNTIME_LANGUAGE_COMPILER_SOURCES:
  readonly RuntimeLanguageCompilerSourceMetadata[] = [
    {
      path: "src/targets/runtime/language.ts",
      role: "stage0-runtime-language-compiler",
      hash: "fnv1a64:c17b70b9cda1864c",
    },
  ] as const;

export const RUNTIME_LANGUAGE_COMPILER_HASH =
  "fnv1a64:af6a73a89f3da92d" as const;

export const RUNTIME_LANGUAGE_COMPILER_METADATA:
  RuntimeLanguageCompilerMetadata = {
    format: RUNTIME_LANGUAGE_COMPILER_FORMAT,
    version: RUNTIME_LANGUAGE_COMPILER_VERSION,
    languageVersion: RUNTIME_LANGUAGE_VERSION,
    languageSemantics: RUNTIME_LANGUAGE_SEMANTICS,
    hash: RUNTIME_LANGUAGE_COMPILER_HASH,
    sources: RUNTIME_LANGUAGE_COMPILER_SOURCES,
  };

export function hashRuntimeLanguageCompilerSource(source: string): string {
  return fnv1a64(new TextEncoder().encode(source));
}

export function hashRuntimeLanguageCompilerManifest(
  sources: readonly RuntimeLanguageCompilerSourceMetadata[],
): string {
  return fnv1a64(
    new TextEncoder().encode(
      JSON.stringify({
        format: RUNTIME_LANGUAGE_COMPILER_FORMAT,
        version: RUNTIME_LANGUAGE_COMPILER_VERSION,
        languageVersion: RUNTIME_LANGUAGE_VERSION,
        languageSemantics: RUNTIME_LANGUAGE_SEMANTICS,
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
