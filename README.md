# baba

`baba` compiles explicit EBNF grammars into deterministic Tree-sitter artifacts.

Version 1.0 is intentionally narrow:

- parse explicit EBNF with `token` and `skip` declarations;
- validate grammar and Tree-sitter metadata;
- generate `grammar.js`;
- generate Tree-sitter query files under `queries/`;
- apply generated bundles with manifest-based ownership protection.

It does not generate a TypeScript parser, tokenizer runtime, formatter, LSP,
editor extension project, package metadata, or language-specific scanner syntax.
If a language needs comments, strings, numbers, layout, fenced blocks, or
embedded WGSL, declare those tokens/rules explicitly or provide a Tree-sitter
scanner outside baba.

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
    highlights.scm
    locals.scm
    folds.scm
    indents.scm
    tags.scm
    textobjects.scm
    rainbows.scm
    injections.scm
  .baba-manifest.json
```

List outputs without writing:

```sh
deno run --allow-read src/cli.ts grammar.ebnf --list-files
```

Pass Tree-sitter metadata:

```sh
deno run --allow-read --allow-write src/cli.ts grammar.ebnf \
  --out generated \
  --name tiny \
  --metadata baba.json
```

`--meta` is an alias for `--metadata`. `--ts-meta` remains as a deprecated
alias.

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
const diagnostics = validateGrammar(grammar);

if (diagnostics.length === 0) {
  const bundle = generate(grammar, { name: "tiny", metadata });
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
- grouping: `( item | other )`

There are no implicit token builtins. Names such as `ident`, `string`, `number`,
`newline`, `indent`, `dedent`, `fenced_text`, and `line_comment` are ordinary
names and must be declared before use.

Rules unreachable from the selected root are omitted from generated outputs and
reported as `UNREACHABLE_RULE` warnings.

## Metadata

Metadata is Tree-sitter-specific JSON:

```json
{
  "word": "ident",
  "extras": [{ "kind": "rule", "name": "whitespace" }],
  "rules": {
    "module": {
      "paths": {
        "1": { "field": "name" }
      }
    }
  },
  "queries": {
    "highlights": {
      "entries": [{ "node": "ident", "capture": "function" }],
      "defaults": { "suppress": [{ "node": "ident" }] }
    },
    "locals": [{ "node": "ident", "capture": "local.definition" }],
    "injections": [{ "node": "shader_body", "language": "wgsl" }]
  }
}
```

Supported top-level keys:

- `extras`
- `word`
- `supertypes`
- `conflicts`
- `inline`
- `rules`
- `queries`

Metadata does not contain formatter, LSP, editor, package, license, author, or
binding configuration.

## Removed In 1.0

The following pre-1.0 surfaces were removed:

- `workbench` preset;
- TypeScript tokenizer/parser generation;
- implicit token builtins;
- `fenced_text` and `fenced_template`;
- implicit `//` comment handling;
- layout tokens as builtins;
- formatter, LSP, AST facade, and editor scaffold generators;
- generated `tree-sitter.json`, `package.json`, and fabricated project metadata;
- CLI `init`, `--backend`, `--preset`, and `--ts-out`.

## Development

```sh
deno fmt --check
deno lint
deno task check
deno task test
deno publish --dry-run --allow-dirty
```
