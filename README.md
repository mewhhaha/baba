# baba

Baba compiles explicit grammar source plus optional metadata into a usable Wasm
lexer/parser bundle.

The public flow is intentionally small:

```text
grammar.baba + baba.json -> generated/wasm parser and lexer
                         -> generated/queries editor query fragments
```

Only the Wasm parser/lexer bundle is part of the public generation path. The
generated `parser.wasm` is a generic Rust-authored engine embedded in the Baba
package; grammar generation only writes grammar-specific plan/types around that
prebuilt engine.

## Quick Start

Create a grammar:

```baba
grammar Tiny

token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
token INT = /[0-9]+/ ;
skip WS = /[ \t\r\n]+/ ;

module = statement* ;
statement = "let" name:IDENT "=" value:INT ";" ;
```

Generate the parser:

```sh
deno run --allow-read --allow-write jsr:@mewhhaha/baba/cli grammar.baba \
  --out generated
```

The default output is:

```text
generated/
  queries/
    generated-highlights.scm
    generated-rainbows.scm
  wasm/
    abi.json
    manifest.json
    mod.ts
    parser.plan
    parser.wasm
    syntax.ts
  .baba-manifest.json
```

Query files are emitted only when they have content. Metadata-driven query
blocks such as locals, folds, tags, textobjects, and injections use the same
`queries/generated-*.scm` naming convention.

Use it from TypeScript:

```ts
import { createParser } from "./generated/wasm/mod.ts";

const bytes = await Deno.readFile("generated/wasm/parser.wasm");
const plan = await Deno.readFile("generated/wasm/parser.plan");
const parser = createParser({ bytes, plan });

const lexed = parser.lex("let answer = 42;");
const parsed = parser.parse("let answer = 42;");

if (parsed.ok) {
  console.log(parsed.cursor.name);
}

const firstToken = lexed.tokenTape.token(0);
console.log(firstToken?.text);

parser.dispose();
```

## API

```ts
import {
  applyBundle,
  compile,
  generate,
  parseGrammar,
  parseMetadata,
} from "jsr:@mewhhaha/baba";

const grammar = parseGrammar(await Deno.readTextFile("grammar.baba"));
const metadata = parseMetadata(await Deno.readTextFile("baba.json"));
const bundle = generate(grammar, { name: "tiny", metadata });
await applyBundle(bundle, { root: "generated" });
```

`parseGrammar()` returns a grammar document. `compile()` accepts source text or
that parsed document and returns diagnostics instead of throwing. `generate()`
throws a `BabaError` when diagnostics contain an error.

## Editor Queries

Baba emits Tree-sitter query fragments next to the Wasm parser bundle so editor
integrations can get consistent highlighting and navigation metadata:

```text
queries/
  generated-highlights.scm
  generated-locals.scm
  generated-folds.scm
  generated-indents.scm
  generated-tags.scm
  generated-textobjects.scm
  generated-rainbows.scm
  generated-injections.scm
```

Only non-empty files are written. The generated paths deliberately use
`generated-*.scm` names so user-owned `queries/*.scm` files can coexist with
Baba output. The current public target does not generate `grammar.js`; it emits
query fragments and the Wasm parser artifacts.

## Metadata

Metadata is optional. The primary parser metadata today is conflict policy:

```json
{
  "parser": {
    "resolutions": [
      {
        "conflict": "c_0123456789abcdef",
        "prefer": "shift"
      }
    ],
    "conflicts": [
      {
        "conflict": "c_fedcba9876543210"
      }
    ]
  }
}
```

Unresolved conflicts produce diagnostics with stable conflict IDs and suggested
metadata entries.

## CLI

```text
baba <grammar.baba> --out generated
baba check <grammar.baba>
baba generate <grammar.baba> --out generated
```

Useful options:

- `--metadata baba.json` reads parser metadata.
- `--root module` selects the root rule.
- `--name tiny` sets generated identity metadata.
- `--wasm-dir parser` changes the output directory.
- `--preserve-trivia` and `--discard-trivia` control skip token emission.
- `--parser-stats` emits parser planning statistics.
- Limit flags such as `--lexer-state-limit`, `--parser-state-limit`, and
  `--parser-table-entry-limit` cap generated runtime planning work.

## Runtime Shape

Generated `mod.ts` exports:

- `createParser({ bytes, plan } | { module, plan })`
- `createParserAsync({ bytes, plan } | { module, plan } | { url, planUrl })`
- parser-plan, runtime identity, and Wasm ABI constants

Each `createParser()` call owns its own `WebAssembly.Instance`, memory, parser
state, source buffers, and disposal lifecycle.

Parser instances expose a Wasm-first runtime surface:

- `parse(source, options?)` returns a cursor parse result. Cursors expose rule
  and token data through lightweight accessors and avoid materializing an object
  tree. Generated `syntax.ts` includes `RootCursor` plus rule-specific cursor
  interfaces with typed `field("name")` overloads for consumer code.
- `lex(source, options?)` returns a lazy token tape. Use `tokenTape.token(i)`
  for indexed access to token records.
- `validate(source, options?)` runs the Wasm trace validator and returns
  diagnostics without building token objects or an object tree.
