# baba

EBNF tooling for language projects.

This package currently parses a compact EBNF dialect and can generate:

- `lexical.json`: sorted keyword and symbol tables
- `tokenizer.ts`: a standalone TypeScript tokenizer
- `grammar.js`: an ESM tree-sitter grammar from EBNF plus optional parser
  metadata
- `rainbows.scm`: optional tree-sitter rainbow-bracket query from metadata plus
  grammar terminals

```sh
deno run --allow-read --allow-write src/cli.ts \
  path/to/grammar.ebnf \
  --out generated \
  --name language_name \
  --ts-meta path/to/tree-sitter-meta.json \
  --ts-out path/to/tree-sitter/grammar.js
```

The EBNF remains the language source of truth. Tree-sitter-specific concerns
such as conflicts, precedence, supertypes, extras, field names, and generated
query shaping live in a sidecar JSON metadata file so the grammar stays readable
without giving up a production parser.

## EBNF dialect

Rules use `name = expression ;`. Expressions support sequences, `|` choices,
groups, literals, refs, `[ optional ]`, `{ repeated }`, and postfix operators:

```ebnf
module = item+ ;
maybe = item? ;
many = item* ;
list = item % "," ;
optional_list = (item % ",")? ;
```

Terminals can be declared before rules. `token` declarations emit tokens; `skip`
declarations are consumed by the tokenizer and become tree-sitter extras.

```ebnf
token ident = /[A-Za-z_][A-Za-z0-9_]*/ ;
token int = /[0-9]+/ ;
skip whitespace = /[ \t\r\n]+/ ;

module = ident int ;
```

Undeclared builtins such as `ident`, `int`, `string`, `char`, `newline`,
`indent`, and `dedent` still work for compact grammars. Parse errors include
line/column diagnostics with a source marker.
