# Grammar

Status: legacy EBNF compatibility guide. New parser work should start with
[Grammar v2](grammar-v2.md).

Baba grammars are explicit EBNF files. They describe concrete syntax only:
tokens, skips, literals, rules, groups, alternatives, optionals, repetitions,
and lists. Semantic analysis, type checking, formatting, editor projects, and
language-specific scanner behavior stay outside the grammar.

## Tokens And Skips

Declare named tokens with `token` and trivia with `skip`:

```ebnf
token ident = /[A-Za-z_][A-Za-z0-9_]*/ ;
token integer = /[0-9]+/ ;
skip whitespace = /[ \t\r\n]+/ ;
```

Token regexes use Baba's portable regex syntax. The analyzed regex AST is the
source of truth for portable runtime targets and Tree-sitter emission.

Skips are trivia. Generated runtimes can preserve trivia when requested, but
parser rules should describe significant syntax.

## Rules

Rules are named EBNF expressions:

```ebnf
module = statement* ;
statement = "let" ident "=" expression ";" ;
expression = integer | ident ;
```

String literals become literal terminals. Rule references name other rules.
Groups, alternatives, optionals, repetitions, repeat-one, and separated lists
are lowered into the portable parser plan before target-specific packaging.

## Portability

Portable runtime targets do not support reachable external scanner tokens. Use
metadata `externals` only for Tree-sitter-specific scanners, and expect the
TypeScript, Wasm, and kit targets to report a structured diagnostic if those
symbols are reachable from the selected root.

When more than one semantic target is selected, portability defaults to strict.
Single semantic target generation defaults to warning mode unless the user sets
the portability option explicitly.

## Diagnostics

Expected user failures are reported as structured diagnostics. Grammar syntax
errors, unreachable rules, unsupported portable constructs, resource limits, and
target-specific packaging errors should not appear as generic internal
exceptions.
