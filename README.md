# baba

`baba` compiles an explicit EBNF language specification into predictable syntax
infrastructure: a Tree-sitter grammar and queries, plus an optional standalone
TypeScript or WebAssembly-backed lexer, parser, and typed concrete syntax tree.

Version 1.1.1 is still intentionally narrow:

- parse explicit EBNF with `token` and `skip` declarations;
- validate grammar and Tree-sitter metadata;
- generate `grammar.js`;
- generate non-empty Tree-sitter query fragments under `queries/generated-*`;
- optionally generate a self-contained TypeScript lexer, LR(1) parser, and CST
  under `typescript/`;
- optionally generate a WebAssembly-backed lexer/parser adapter under `wasm/`;
- apply generated bundles with manifest-based ownership protection.

It does not generate semantic analysis, name resolution, type checking,
lowering, code generation, formatter policy, LSP behavior, editor extension
projects, package metadata, or language-specific scanner syntax. If a language
needs comments, strings, numbers, layout, fenced blocks, or embedded languages,
declare those tokens/rules explicitly. Scanner-produced symbols must be declared
with `externals` metadata and implemented outside baba; the TypeScript and Wasm
targets report reachable external tokens as unsupported.

## Quick Start

Create a grammar:

```ebnf
token ident = /[A-Za-z_][A-Za-z0-9_]*/ ;
token integer = /[0-9]+/ ;
skip whitespace = /[ \t\r\n]+/ ;

module = "fn" ident "(" ")" block ;
block = "{" integer "}" ;
```

Generate Tree-sitter artifacts:

```sh
deno run --allow-read --allow-write jsr:@mewhhaha/baba/cli grammar.ebnf \
  --out generated \
  --name tiny
```

Generate the standalone TypeScript lexer/parser target:

```sh
deno run --allow-read --allow-write src/cli.ts grammar.ebnf \
  --out generated \
  --target typescript
```

Generate the WebAssembly-backed lexer/parser target:

```sh
deno run --allow-read --allow-write src/cli.ts grammar.ebnf \
  --out generated \
  --target wasm
```

Generate every target:

```sh
deno run --allow-read --allow-write src/cli.ts grammar.ebnf \
  --out generated \
  --target all
```

From this repository:

```sh
deno run --allow-read --allow-write src/cli.ts grammar.ebnf \
  --out generated \
  --name tiny
```

That writes:

```text
generated/
  grammar.js
  queries/
    generated-highlights.scm
    generated-rainbows.scm
  .baba-manifest.json
```

With `--target all` or `--target typescript`, the bundle also includes:

```text
generated/
  typescript/
    syntax.ts
    lexer.ts
    parser.ts
    mod.ts
```

With `--target all` or `--target wasm`, the bundle also includes a generated
TypeScript adapter with embedded Wasm bytes:

```text
generated/
  wasm/
    syntax.ts
    lexer.ts
    parser.ts
    wasm.ts
    mod.ts
```

Both generated parser runtimes export the same main TypeScript API:

- `lex(source)` for DFA tokenization;
- `parse(source)` returning a discriminated `ParseResult`;
- strict `parseTokens(source, tokens)` validation for external token streams;
- low-level `parseTokensUnchecked(source, tokens)` when validation is not
  wanted;
- `positionAt(source, offset)` and `createSourceMap(source)` for UTF-16
  offset-to-line/column diagnostics;
- separate `MainNamedToken` and `TriviaToken` types for significant and trivia
  channels.

The Wasm target emits a TypeScript adapter around embedded Wasm bytes and also
exports `wasmBytes` from `wasm/mod.ts`.

Only query files with content are written. Regenerating through `applyBundle()`
removes previously owned generated query fragments that become empty. Ordinary
`queries/*.scm` files are user-owned and are never written by baba.

List outputs without writing:

```sh
deno run --allow-read src/cli.ts grammar.ebnf --list-files
```

Pass Tree-sitter metadata:

```sh
deno run --allow-read --allow-write src/cli.ts grammar.ebnf \
  --out generated \
  --name tiny \
  --root module \
  --metadata baba.json
```

`--meta` is an alias for `--metadata`. `--ts-meta` remains as a deprecated
alias.

Useful parser-runtime options:

```sh
deno run --allow-read --allow-write src/cli.ts grammar.ebnf \
  --target all \
  --typescript-dir ts \
  --wasm-dir wasm \
  --discard-trivia \
  --lexer-state-limit 50000 \
  --parser-state-limit 20000 \
  --parser-item-limit 200000 \
  --parser-table-entry-limit 200000
```

`--ts-out` is an alias for `--typescript-dir`. `--wasm-dir` controls the Wasm
target output directory. `--preserve-trivia` and `--discard-trivia` control
whether skip matches are emitted as trivia tokens. `--lexer-state-limit`,
`--parser-state-limit`, `--parser-item-limit`, and `--parser-table-entry-limit`
apply to both the TypeScript and Wasm parser runtimes.
`--portability strict|warn|off` controls diagnostics for known cross-target
acceptance differences. When multiple targets are selected, portability defaults
to `strict`; otherwise it defaults to `warn`.

Useful TypeScript-output diagnostics:

```sh
deno run --allow-read --allow-write src/cli.ts grammar.ebnf \
  --target typescript \
  --generated-byte-limit 1000000 \
  --parser-stats
```

`--generated-byte-limit` and `--parser-stats` only inspect the generated
TypeScript target output.

## Library API

```ts
import {
  applyBundle,
  generate,
  parseGrammar,
  parseMetadata,
  validateGrammar,
} from "jsr:@mewhhaha/baba";

const grammar = parseGrammar(await Deno.readTextFile("grammar.ebnf"));
const metadata = parseMetadata(await Deno.readTextFile("baba.json"));
const diagnostics = validateGrammar(grammar, { rootRule: "module", metadata });

if (diagnostics.length === 0) {
  const bundle = generate(grammar, {
    name: "tiny",
    rootRule: "module",
    metadata,
  });
  for (const diagnostic of bundle.diagnostics ?? []) {
    console.warn(diagnostic.code, diagnostic.message);
  }
  await applyBundle(bundle, { root: "generated" });
}
```

`applyBundle()` writes nested files, records generated ownership in
`.baba-manifest.json`, and refuses to overwrite or remove modified or unowned
files.

## EBNF

Rules use `name = expression ;`.

```ebnf
module = item+ ;
item = function | declaration ;
```

Terminal declarations are explicit:

```ebnf
token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
token TYPE_IDENT priority 10 = /[A-Z][A-Za-z0-9_]*/ ;
token STRING = /"([^"\\]|\\.)*"/ ;
skip WHITESPACE = /[ \t\r\n]+/ ;
skip LINE_COMMENT = /\/\/[^\n]*/ ;

module = "let" IDENT "=" STRING ;
```

Expressions support:

- sequence: `a b c`
- choice: `a | b`
- optional: `item?` or `[ item ]`
- repeat: `item*` or `{ item }`
- one-or-more: `item+`
- separated list: `item % ","`
- named field: `name:item`
- grouping: `( item | other )`

There are no implicit token builtins. Names such as `ident`, `string`, `number`,
`newline`, `indent`, `dedent`, `fenced_text`, and `line_comment` are ordinary
names and must be declared before use.

Token and skip regexes use Baba's portable regex subset. Shorthand classes,
Unicode property escapes, anchors, lookaround, lazy quantifiers, backreferences,
inline flags, and target-specific escape forms are rejected. Overlapping token
languages must either be disjoint or use explicit priority. On equal-length
matches, higher priority wins; literals win ties at the same priority; then
declaration order breaks remaining ties.

Rules unreachable from the selected root are omitted from generated outputs and
reported as `UNREACHABLE_RULE` warnings.

## Metadata

Metadata is Tree-sitter-specific JSON:

```ebnf
token ident = /[A-Za-z_][A-Za-z0-9_]*/ ;
token embedded_source = /[^}]+/ ;
skip whitespace = /[ \t\r\n]+/ ;

module = "fn" name:ident body:block ;
block = "{" embedded_source "}" ;
```

```json
{
  "version": 1,
  "word": "ident",
  "extras": [{ "kind": "rule", "name": "whitespace" }],
  "rules": {
    "module": {
      "paths": {
        "name": { "alias_ref": "function_name" }
      }
    }
  },
  "queries": {
    "highlights": {
      "entries": [{ "node": "ident", "capture": "function" }],
      "defaults": { "suppress": [{ "node": "ident" }] }
    },
    "locals": [{ "node": "ident", "capture": "local.definition" }],
    "injections": [{ "node": "embedded_source", "language": "<language>" }]
  }
}
```

EBNF fields generate Tree-sitter fields directly. Versioned metadata may use
those field names as selectors for additional shaping, such as aliases or
precedence wrappers. Numeric expression paths are accepted only for unversioned
legacy metadata.

Supported top-level keys:

- `version`
- `externals`
- `extras`
- `word`
- `supertypes`
- `conflicts`
- `inline`
- `rules`
- `queries`

Metadata does not contain formatter, LSP, editor, package, license, author, or
binding configuration.

External scanner symbols are declared in metadata:

```json
{
  "version": 1,
  "externals": ["INDENT", "DEDENT", "NEWLINE"]
}
```

The generated `grammar.js` declares those symbols in `externals`; the scanner
implementation remains user-owned.

## Stability

The versioned metadata schema is `version: 1`. It uses explicit EBNF fields
rather than positional expression paths, so grammar edits do not silently
retarget field metadata.

## Development

```sh
deno fmt --check
deno lint
deno task check
deno task test
deno task bench:wasm -- --samples 5
deno task publish:dry-run
```
