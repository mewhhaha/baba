# baba

EBNF tooling for language projects.

The name comes from:

```text
Grammar -> Gramma -> Grandma -> Baba
```

baba keeps a grammar as the source of truth, then generates practical parser
scaffolding from it:

- `lexical.json`: sorted keyword, symbol, token, and skip manifest
- `tokenizer.ts`: standalone TypeScript tokenizer
- `grammar.js`: ESM tree-sitter grammar
- `rainbows.scm`: optional tree-sitter rainbow-bracket query
- `injections.scm`: optional tree-sitter injection query
- workbench scaffold: query bundle, editor config, typed AST helpers, starter
  tests, LSP skeleton, and formatter skeleton

Tree-sitter-specific concerns such as conflicts, precedence, supertypes, extras,
field names, aliases, and query shaping live in optional JSON metadata, so the
grammar stays readable.

## Quick Start

Create a grammar file:

```ebnf
token ident = /[A-Za-z_][A-Za-z0-9_]*/ ;
token int = /[0-9]+/ ;
skip whitespace = /[ \t\r\n]+/ ;

module = function+ ;
function = "fn" ident "(" params? ")" block ;
params = param % "," ;
param = ident ":" ident ;
block = "{" statement* "}" ;
statement = "let" ident "=" int ";" ;
```

After publishing, run the CLI directly from JSR:

```sh
deno run --allow-read --allow-write jsr:@mewhhaha/baba/cli grammar.ebnf \
  --out generated \
  --name tiny
```

For local development from this repository, run the same CLI source file:

```sh
deno run --allow-read --allow-write src/cli.ts grammar.ebnf \
  --out generated \
  --name tiny
```

That writes:

```text
generated/
  lexical.json
  tokenizer.ts
  grammar.js
```

Generate the opt-in workbench scaffold:

```sh
deno run --allow-read --allow-write src/cli.ts grammar.ebnf \
  --out generated \
  --name tiny \
  --ts-meta tree-sitter-meta.json \
  --preset workbench
```

You can also use explicit subcommands:

```sh
deno run --allow-read --allow-write src/cli.ts generate grammar.ebnf \
  --out generated

deno run --allow-read --allow-write src/cli.ts init tiny
```

That keeps the core files and adds:

```text
generated/
  tree-sitter.json
  package.json
  queries/
  editor/
  ast/
  tests/
  lsp/
  formatter/
```

Use the generated tokenizer:

```ts
import { lex } from "./generated/tokenizer.ts";

const tokens = lex(`fn add(a: i32) { let n = 1; }`);
console.log(tokens.map((token) => [token.kind, token.text]));
```

Generate only the lexical manifest to stdout:

```sh
deno run --allow-read src/cli.ts grammar.ebnf
```

Generate a tree-sitter grammar at a specific path while still printing the
lexical manifest:

```sh
deno run --allow-read --allow-write src/cli.ts grammar.ebnf \
  --name tiny \
  --ts-out tree-sitter-tiny/grammar.js
```

Generate both the local bundle and a tree-sitter output copy:

```sh
deno run --allow-read --allow-write src/cli.ts grammar.ebnf \
  --out generated \
  --name tiny \
  --ts-out tree-sitter-tiny/grammar.js
```

Pass tree-sitter metadata when needed:

```sh
deno run --allow-read --allow-write src/cli.ts grammar.ebnf \
  --out generated \
  --name tiny \
  --ts-meta tree-sitter-meta.json
```

## Library API

After publishing, import the public API from JSR:

```ts
import {
  BabaError,
  formatDiagnostic,
  generate,
  generateInitBundle,
  parseGrammar,
  parseMetadata,
  validateGrammar,
} from "jsr:@mewhhaha/baba";

const source = await Deno.readTextFile("grammar.ebnf");

try {
  const grammar = parseGrammar(source);
  const metadata = parseMetadata(
    await Deno.readTextFile("tree-sitter-meta.json"),
  );
  const diagnostics = validateGrammar(grammar, { rootRule: "module" });
  if (diagnostics.length > 0) {
    throw new BabaError(diagnostics[0]);
  }

  const bundle = generate(grammar, {
    name: "tiny",
    rootRule: "module",
    metadata,
    preset: "workbench",
  });

  for (const file of bundle.files) {
    await Deno.writeTextFile(`generated/${file.path}`, file.content);
  }
  for (const stalePath of bundle.cleanupPaths ?? []) {
    await Deno.remove(`generated/${stalePath}`).catch(() => {});
  }
} catch (error) {
  if (error instanceof BabaError) {
    console.error(formatDiagnostic(error));
  } else {
    throw error;
  }
}
```

Use `generateInitBundle()` when you want to create the same starter project that
`baba init` writes, but through your own file-system adapter.

Inside this repository, use `./src/mod.ts` instead of the JSR specifier.

Granular APIs live under `/advanced`:

```ts
import {
  generateTokenizerSource,
  generateTreeSitterGrammar,
  parseTreeSitterMetadata,
} from "jsr:@mewhhaha/baba/advanced";

const metadata = parseTreeSitterMetadata("{}");
const tokenizer = generateTokenizerSource(source);
const grammar = generateTreeSitterGrammar(source, { name: "tiny", metadata });
```

## EBNF Dialect

Rules use `name = expression ;`.

```ebnf
module = item+ ;
item = function | declaration ;
```

Expressions support sequences, choices, groups, literals, refs, optional values,
repetition, one-or-more repetition, and separated lists.

```ebnf
maybe = item? ;
many = item* ;
many_old_style = { item } ;
one_or_more = item+ ;
optional_old_style = [ item ] ;
grouped = (item | other) ;
list = item % "," ;
optional_list = (item % ",")? ;
```

Terminals can be declared before rules. `token` declarations emit tokens. `skip`
declarations are consumed by the tokenizer and become tree-sitter extras.

```ebnf
token ident = /[A-Za-z_][A-Za-z0-9_]*/ ;
token int = /[0-9]+/ ;
skip whitespace = /[ \t\r\n]+/ ;

module = ident int ;
```

Regex literals use `/.../` with escaped `/` when needed. Flags are not
supported.

Undeclared builtins still work for compact grammars:

```ebnf
module = ident int string ;
```

Current builtin refs include:

- `ident`
- `int`
- `number`
- `string`
- `char`
- `fenced_text`
- `fenced_template`
- `newline`
- `indent`
- `dedent`

Layout tokens are enabled when a grammar references `newline`, `indent`, or
`dedent`. Fenced blocks are scanned atomically, so indentation inside fenced
content is ignored.

## Validation And Diagnostics

baba validates grammar semantics before generation:

- duplicate rule or token names fail
- rule and token names share one namespace
- rule names cannot collide with generated tree-sitter builtins
- unknown rule refs fail
- unknown root rules fail
- token regexes must compile and must not match the empty string
- metadata JSON is parsed and validated strictly

Parse errors include source locations:

```text
Unterminated string literal at 1:10
module = "unterminated
         ^
```

## Tree-Sitter Metadata

Metadata is optional JSON passed through `--ts-meta` or `parseMetadata`. Use it
for tree-sitter, editor, AST, formatter, and LSP concerns that do not belong in
the EBNF:

```json
{
  "language": {
    "scope": "source.tiny",
    "fileTypes": ["tiny"],
    "comment": "//"
  },
  "extras": [
    { "kind": "regex", "value": "[ \\t\\r\\n]" },
    { "kind": "rule", "name": "line_comment" }
  ],
  "word": "ident",
  "supertypes": ["expr"],
  "conflicts": [["expr", "pattern"]],
  "rules": {
    "call": {
      "fields": {
        "0": "function",
        "2": "arguments"
      },
      "wrap": { "kind": "prec", "value": 1 }
    }
  },
  "queries": {
    "highlights": [
      { "literal": "fn", "capture": "keyword.function" },
      { "node": "function", "capture": "function" }
    ],
    "locals": [
      { "node": "ident", "capture": "local.definition" }
    ],
    "folds": [
      { "node": "block", "capture": "fold" }
    ],
    "indents": [
      { "literal": "{", "capture": "indent.begin" }
    ],
    "tags": [
      { "node": "function", "capture": "tag.definition" }
    ],
    "rainbows": {
      "scopes": ["function", "block"],
      "brackets": ["(", "{", "["]
    },
    "injections": [
      { "node": "wgsl_content", "language": "wgsl" }
    ]
  },
  "ast": {
    "nodes": {
      "function": {
        "kind": "function",
        "fields": { "name": "name" }
      }
    }
  },
  "formatter": {
    "blocks": ["block"],
    "lists": ["module"],
    "spacing": { "(": "tight" }
  },
  "lsp": {
    "documentSymbols": ["function"],
    "diagnostics": ["module"]
  }
}
```

## Development

Run tests:

```sh
deno task test
```

Check public entrypoints:

```sh
deno check src/mod.ts src/cli.ts tests/grammar_test.ts
```

Lint:

```sh
deno lint
```

Check the package before publishing:

```sh
deno task publish:dry-run
```

Publish when the dry run is clean and the version in `deno.json` has been
bumped:

```sh
deno publish
```

In JSR package settings, set the overview/readme source to `README.md` if you
want the package page to show this guide instead of the shorter module docs.
