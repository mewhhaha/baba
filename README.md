# baba

Baba compiles explicit grammar source plus optional metadata into Wasm and
Tree-sitter parser artifacts.

The public flow is intentionally small:

```text
grammar.baba + baba.json -> generated/wasm parser and lexer
                         -> generated/queries editor query fragments
                         -> generated/grammar.js with --target tree-sitter
```

The default target is Wasm. `--target tree-sitter` emits `grammar.js` and
non-empty editor query fragments, while `--target all` emits both targets. The
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

Only non-empty query files are written. The generated paths deliberately use
`generated-*.scm` names so user-owned `queries/*.scm` files can coexist with
Baba output. Select `--target tree-sitter` to emit these files with
`grammar.js`, or `--target all` to emit them with both parser targets.

## Grammar Reference

The full Baba grammar specification is in [`docs/grammar.md`](docs/grammar.md),
which is the canonical source for the language syntax and accepted features. Use
this README for quick examples; use the grammar reference for complete
token/rule grammar rules, precedence, contextual lexing, modes, and
parser-target support constraints.

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

- `--metadata baba.json` reads parser and Tree-sitter metadata.
- `--target wasm|tree-sitter|all` selects generated targets.
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
- `createParserAsync()` with exactly one of `bytes`, `module`, or `url`, and
  exactly one of `plan` or `planUrl`
- parser-plan, runtime identity, and Wasm ABI constants

Each `createParser()` call owns its own `WebAssembly.Instance`, memory, parser
state, source buffers, and disposal lifecycle.

`createParser()` does not load defaults: both the plan and exactly one Wasm
module source are required. Parser plans use runtime metadata version 2;
regenerate plans produced by earlier Baba versions. Breaking changes for each
release are listed in [CHANGELOG.md](CHANGELOG.md).

Parser instances expose a Wasm-first runtime surface:

- `parse(source, options?)` returns a cursor parse result. Cursors expose rule
  and token data through lightweight accessors and avoid materializing an object
  tree. Generated `syntax.ts` includes `RootCursor` plus rule-specific cursor
  interfaces with typed `field("name")` overloads for consumer code.
- `lex(source, options?)` returns a lazy token tape. Use `tokenTape.token(i)`
  for indexed access to token records.
- `validate(source, options?)` runs the Wasm trace validator and returns
  diagnostics without building token objects or an object tree.

## Experimental WebGPU Lexer and Parser Handoff

For large, repeated inputs, the experimental WebGPU backend can lex an existing
generated `parser.plan` and hand its records directly to the Wasm parser. It is
asynchronous and does not replace the synchronous generated `parser.lex()`
method. The CPU path is usually better for small or one-off inputs.

```ts
import {
  WebGpuLexerContext,
  WebGpuRuntime,
} from "@mewhhaha/baba/runtime/webgpu-lexer";
import { createParser } from "./generated/wasm/mod.ts";

const wasm = await Deno.readFile("generated/wasm/parser.wasm");
const plan = await Deno.readFile("generated/wasm/parser.plan");
const parser = createParser({ bytes: wasm, plan });
const runtime = await WebGpuRuntime.create({
  powerPreference: "high-performance",
});
const lexer = await runtime.compile(plan);

const source = await Deno.readTextFile("input.txt");
const units = new Uint16Array(source.length);
for (let index = 0; index < source.length; index += 1) {
  units[index] = source.charCodeAt(index);
}

const lexed = await lexer.lex(units);
if (lexed.overflow) {
  throw new Error(`GPU lexer output overflowed at ${lexed.tokenCount} tokens`);
}
const parsed = parser.parseRecords(source, lexed.records);

lexer.dispose();
runtime.dispose();
parser.dispose();
```

`WebGpuRuntime` owns one device and should be reused across calls. It rejects
software fallback adapters by default; use
`WebGpuRuntime.create({ allowFallbackAdapter: true })` only for explicit
software testing. The backend currently supports guard-free grammars only. See
[`docs/webgpu-lexer.md`](docs/webgpu-lexer.md) for capacity limits, adapter
setup, benchmarking, and the standalone `WebGpuLexer` API.
