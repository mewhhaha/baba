# T02: Binary artifacts and real Wasm packaging

- **Priority:** P0
- **Estimated size:** Large
- **Merge wave:** 1
- **Depends on:** [T00](./T00-correctness-and-planning-cleanup.md)
- **Suggested PR title:** `Support binary generated artifacts and emit parser.wasm`

[Back to task index](./README.md)

## Objective

Make binary output a first-class generated artifact and let the Wasm target emit a real `.wasm` file rather than requiring every consumer to import a giant TypeScript byte array.

## Problem

`GeneratedFile` is currently text-only. The Wasm target therefore embeds module bytes in `wasm.ts`. That is convenient for JavaScript but creates several problems:

- generated source becomes very large;
- the Wasm target is not host-neutral;
- package and example size grow dramatically;
- hashing and ownership do not model binary files;
- non-JavaScript consumers cannot use the artifact directly;
- the generated adapter and the actual runtime module are conflated.

## Required work

### 1. Generalize generated artifacts

Replace the text-only model with a discriminated union:

```ts
export type GeneratedFile =
  | {
      readonly path: string;
      readonly kind: "source" | "query" | "config" | "test" | "docs";
      readonly encoding: "utf-8";
      readonly content: string;
    }
  | {
      readonly path: string;
      readonly kind: "binary";
      readonly encoding: "binary";
      readonly content: Uint8Array;
    };
```

A compatibility helper may accept the old text shape during migration.

### 2. Make bundle/output handling binary-safe

Update:

- deterministic sorting;
- generated bundle construction;
- path validation;
- content hashing;
- manifests;
- staged writes;
- overwrite protection;
- stale-file deletion;
- temporary files;
- tests and snapshots.

Use byte hashes for both text and binary files. Text hashing should hash encoded UTF-8 bytes.

Write binary files with `Deno.writeFile`, not text conversion.

### 3. Emit a real Wasm artifact

The Wasm target should be able to emit:

```text
wasm/parser.wasm
wasm/syntax.ts
wasm/lexer.ts
wasm/parser.ts
wasm/mod.ts
wasm/manifest.json
```

`manifest.json` should include at least:

```json
{
  "format": "baba-wasm-runtime",
  "version": 1,
  "abiVersion": 1,
  "parserPlanVersion": 1,
  "module": "parser.wasm"
}
```

T08 may expand the ABI details.

### 4. Add packaging modes

Add:

```ts
export type WasmPackaging =
  | "external-binary"
  | "embedded-typescript";
```

Options:

```ts
export interface WasmTargetOptions {
  directory?: string;
  packaging?: WasmPackaging;
  // shared runtime limits...
}
```

Recommended direction:

- `external-binary` is the host-neutral preferred mode;
- `embedded-typescript` remains as a compatibility and single-file option.

If changing the default is too disruptive, preserve the current default for one release and emit a deprecation/information diagnostic pointing to external packaging.

### 5. Generate adapters deliberately

For external packaging, emit an adapter that can load bytes through an explicit factory. Do not hard-code a Deno-only loader into the core API.

Possible generated entrypoints:

```ts
createParserFromBytes(bytes: Uint8Array): ParserInstance
createParserFromModule(module: WebAssembly.Module): ParserInstance
createParserFromUrl(url: URL): Promise<ParserInstance>
```

T08 owns the final instance API; this task may implement the minimum loader seam.

### 6. Add generated size checks for Wasm

Support:

```ts
wasm.generatedByteLimit
wasm.reportParserStats
```

Report binary bytes separately from adapter source bytes.

### 7. Update CLI

Add flags such as:

```text
--wasm-packaging external-binary|embedded-typescript
--wasm-generated-byte-limit <n>
--wasm-stats
```

Do not overload the TypeScript-only `--generated-byte-limit` ambiguously.

## Likely files

- `src/ast.ts`
- `src/bundle.ts`
- `src/output.ts`
- `src/targets/wasm/plan.ts`
- `src/targets/wasm/runtime_emit.ts`
- `src/cli.ts`
- `tests/output_test.ts`
- `tests/wasm_test.ts`
- `tests/runtime_smoke.ts`

## Tests

1. binary file creation;
2. binary overwrite when manifest hash matches;
3. refusal to overwrite modified binary files;
4. stale binary cleanup;
5. mixed text/binary path collision;
6. deterministic `.wasm` bytes;
7. `WebAssembly.validate()` succeeds;
8. external binary adapter under Deno;
9. Node and Bun smoke where supported;
10. embedded packaging remains functional;
11. generated-size limit for binary and source portions;
12. no accidental UTF-8 decoding of binary data;
13. manifest round-trip and old-manifest compatibility.

## Acceptance criteria

- `--target wasm` can emit `parser.wasm` as a binary artifact.
- Ownership manifests hash and protect binary files correctly.
- Generated binary bytes are deterministic.
- A consumer can instantiate the emitted module without importing Baba.
- Embedded TypeScript packaging remains available during migration.
- ABI and parser-plan versions are discoverable in generated metadata.
- Output path safety remains intact.

## Out of scope

- final Wasm memory lifecycle and reentrant instance API;
- BRL/runtime-language backend;
- Wasm Component Model/WIT packaging;
- parser algorithm changes;
- binary parser-plan serialization beyond the seam needed by T01/T05.

## Copy-ready agent prompt

> Implement T02 from `tasks/T02-binary-artifacts-and-wasm-packaging.md`. Generalize generated artifacts to support bytes, make the manifest writer binary-safe, and emit a real `.wasm` file with explicit external and embedded packaging modes. Preserve ownership safety and add end-to-end Deno/Node/Bun tests where practical.

## PR checklist

- [ ] `GeneratedFile` supports text and bytes.
- [ ] Output writer is binary-safe.
- [ ] Manifest hashes binary content.
- [ ] Wasm target emits `parser.wasm`.
- [ ] Packaging mode is explicit.
- [ ] Generated ABI/plan metadata emitted.
- [ ] Binary safety tests added.
- [ ] Full repository checks pass.
