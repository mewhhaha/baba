# baba

Baba is a syntax-runtime generator for small languages and DSLs. You describe a
language's concrete syntax once in explicit EBNF, add optional Tree-sitter
metadata, and Baba emits the parser artifacts that a tooling project can check
in.

The same grammar can produce:

- a Tree-sitter `grammar.js` and generated query fragments;
- a standalone TypeScript DFA lexer, LR(1) parser, and typed concrete syntax
  tree;
- a WebAssembly-backed lexer/parser adapter with the same TypeScript API.

This is useful when a grammar needs to support editor highlighting, tests,
command-line tools, or browser tooling without maintaining separate parser
implementations by hand.

Baba deliberately stops at syntax. It does not generate semantic analysis, name
resolution, type checking, lowering, code generation, formatter policy, LSP
behavior, editor extension projects, package metadata, or language-specific
scanner syntax. If a language needs comments, strings, numbers, layout, fenced
blocks, or embedded languages, declare those tokens and rules explicitly.
Scanner-produced symbols must be declared with `externals` metadata and
implemented outside Baba; the TypeScript and Wasm targets report reachable
external tokens as unsupported.

## Quick Start

Create a grammar:

```ebnf
token ident = /[A-Za-z_][A-Za-z0-9_]*/ ;
token integer = /[0-9]+/ ;
skip whitespace = /[ \t\r\n]+/ ;

module = "fn" ident "(" ")" block ;
block = "{" integer "}" ;
```

Run the published CLI:

```sh
deno x --allow-read --allow-write jsr:@mewhhaha/baba/cli grammar.ebnf \
  --out generated \
  --name tiny \
  --target all
```

From a local checkout, use the repository entrypoint instead:

```sh
deno run --allow-read --allow-write src/cli.ts grammar.ebnf \
  --out generated \
  --name tiny \
  --target all
```

`--allow-read` lets the CLI load the grammar and optional metadata.
`--allow-write` lets it write the generated bundle.

## Generated Output

The default target writes Tree-sitter artifacts:

```text
generated/
  grammar.js
  queries/
    generated-highlights.scm
    generated-rainbows.scm
  .baba-manifest.json
```

Use `--target all`, `--target typescript`, or `--target wasm` to include parser
runtimes:

```sh
deno x --allow-read --allow-write jsr:@mewhhaha/baba/cli grammar.ebnf \
  --out generated \
  --target all
```

The TypeScript runtime is written under `typescript/`:

```text
generated/
  typescript/
    syntax.ts
    lexer.ts
    parser.ts
    mod.ts
```

The Wasm runtime is written under `wasm/` as a TypeScript adapter around
embedded Wasm bytes:

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

The Wasm target also exports `wasmBytes` from `wasm/mod.ts`.

Only query files with content are written. Regenerating through `applyBundle()`
removes previously owned generated query fragments that become empty. Ordinary
`queries/*.scm` files are user-owned and are never written by Baba.

## CLI

List outputs without writing:

```sh
deno x --allow-read jsr:@mewhhaha/baba/cli grammar.ebnf --list-files
```

Pass Tree-sitter metadata:

```sh
deno x --allow-read --allow-write jsr:@mewhhaha/baba/cli grammar.ebnf \
  --out generated \
  --name tiny \
  --root module \
  --metadata baba.json
```

`--meta` is an alias for `--metadata`. `--ts-meta` remains as a deprecated
alias.

Select and configure parser-runtime targets:

```sh
deno x --allow-read --allow-write jsr:@mewhhaha/baba/cli grammar.ebnf \
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

Inspect generated TypeScript target size and parser table statistics:

```sh
deno x --allow-read --allow-write jsr:@mewhhaha/baba/cli grammar.ebnf \
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

Metadata is JSON for Tree-sitter output shaping, query generation, and
standalone parser conflict policy:

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
- `parser`
- `queries`

Metadata does not contain formatter, LSP, editor, package, license, author, or
binding configuration.

### Parser Runtime Conflict Policy

The `parser` metadata block applies to Baba's standalone parser runtimes. It is
separate from Tree-sitter shaping metadata:

```json
{
  "version": 1,
  "parser": {
    "resolutions": [
      {
        "rules": ["generic_expression", "qualified_identifier"],
        "on": "[",
        "prefer": "shift"
      }
    ],
    "conflicts": [
      ["tuple_type", "type_atom"],
      ["unit_type", "type_atom"]
    ]
  }
}
```

`resolutions` keep the generated LR table deterministic by selecting either a
`shift` or `reduce` action when the listed rules and optional terminal are
involved. For reduce/reduce conflicts, add `reduce` with the rule or expression
text that should win.

`conflicts` declares local grammar ambiguities that the generated TypeScript and
Wasm parsers may explore with bounded branch search. This is useful for grammars
that need Tree-sitter-like conflict handling but still want standalone parser
runtimes. The Wasm target traces declared conflict branches inside its generated
Wasm parser engine and replays the successful action trace in TypeScript to
build the CST.

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
