# Migrating to Baba 5

Baba 5 is a breaking release for generated Wasm parser consumers. It removes the
compatibility runtime, requires explicit runtime artifacts, and introduces
runtime metadata version 2 for `parser.plan` files.

## Upgrade And Regenerate

Upgrade the Baba dependency and rerun the existing generation command with
Baba 5. For example:

```sh
deno run --allow-read --allow-write \
  jsr:@mewhhaha/baba@5.0.0/cli grammar.baba --out generated
```

Regenerate the complete output rather than copying only `parser.plan`. The
generated `parser.plan`, `parser.wasm`, `mod.ts`, `syntax.ts`, `abi.json`, and
`manifest.json` describe one runtime and must stay together.

Baba 5 does not load metadata-version-1 plans. An old plan fails before parser
creation with an error that includes the encountered metadata version and asks
the caller to regenerate it with Baba 5.

## Update Runtime Imports

Applications should normally import the generated entrypoint:

```ts
import { createParser } from "./generated/wasm/mod.ts";
```

Regenerated entrypoints use the only public runtime loader. If code imports the
loader directly, update the package subpath:

```ts
// Baba 4
import { createParser } from "@mewhhaha/baba/runtime/wasm";

// Baba 5
import { createParser } from "@mewhhaha/baba/runtime/generated-wasm";
```

The `@mewhhaha/baba/runtime/wasm` export and its generic executor no longer
exist.

## Provide Explicit Parser Sources

Synchronous parser creation requires plan bytes and exactly one Wasm source:

```ts
const bytes = await Deno.readFile("generated/wasm/parser.wasm");
const plan = await Deno.readFile("generated/wasm/parser.plan");

const parser = createParser({ bytes, plan });
```

A precompiled module is also accepted:

```ts
const module = await WebAssembly.compile(bytes);
const parser = createParser({ module, plan });
```

Calls with no options, a missing plan, neither Wasm source, or both `bytes` and
`module` are rejected. The unused parser-creation `validate` option was removed.

Asynchronous creation requires exactly one of `bytes`, `module`, or `url`, and
exactly one of `plan` or `planUrl`:

```ts
const parser = await createParserAsync({
  url: new URL("./parser.wasm", import.meta.url),
  planUrl: new URL("./parser.plan", import.meta.url),
});
```

Local and remote sources can be combined, such as `{ module, planUrl }` or
`{ url, plan }`, as long as each source group contains exactly one value.

## Update Parse Options

Generated parse options now contain only `preserveTrivia` and `maxTraceActions`.

| Baba 4 option           | Baba 5 migration                                      |
| ----------------------- | ----------------------------------------------------- |
| `preserveTrivia`        | Keep using it.                                        |
| `maxTraceActions`       | Keep using it.                                        |
| `contextualLexingStats` | Remove it; generated parsers no longer expose stats.  |
| `maxExploredBranches`   | Remove it; generated cursor parsing is deterministic. |
| `ambiguityMode`         | Remove it; resolve grammar conflicts during planning. |

Grammars that still require branching are rejected by the generated cursor path
with `PARSER_AMBIGUOUS_PARSE`. Add explicit conflict resolutions to metadata so
the generated LR actions are deterministic.

## Remove Obsolete Diagnostic Handling

Generated Baba 5 parsers no longer expose or produce:

- `PARSE_INVALID_TOKEN_STREAM`;
- `PARSER_BRANCH_LIMIT`;
- their numeric diagnostic helper exports.

These failures belonged to token-stream and branch-search paths that are not
part of the source-only generated cursor API. Remove exhaustive-switch cases or
imports for them. Generated parsers still expose lexical, unexpected-token,
trailing-input, trace-limit, ambiguous-parse, and internal-error diagnostics.

## Compatibility That Did Not Change

- `PortableParserPlan` remains version 1.
- The core Wasm ABI remains version 7.
- Parser spans remain UTF-16 code-unit offsets.
- Parser instances still expose `lex`, `parse`, `validate`, `reset`, and
  `dispose`.
- Successful `parse()` calls still return typed cursors from generated
  `syntax.ts`.

## Migration Checklist

- Upgrade the compiler and runtime dependency to Baba 5.
- Regenerate every generated parser artifact together.
- Replace direct `runtime/wasm` imports.
- Pass an explicit plan and exactly one Wasm source during parser creation.
- Remove deleted parse options and diagnostic cases.
- Run the application type check and parser tests against the regenerated
  output.
