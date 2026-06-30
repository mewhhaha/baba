# Grammar

Status: current public EBNF grammar guide.

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
source of truth for generated Wasm tokenization.

Skips are trivia. Generated runtimes can preserve trivia when requested, but
parser rules should describe significant syntax.

Literal strings in rules are terminals too. If a literal and a named token can
both match the same source text, Baba uses parser context during `parse()` when
the grammar and metadata make the choice deterministic.

## Rules

Rules are named EBNF expressions:

```ebnf
module = statement* ;
statement = "let" name:ident "=" value:expression ";" ;
expression = integer | ident ;
```

String literals become literal terminals. Rule references name other rules.
Groups, alternatives, optionals, repetitions, repeat-one, and separated lists
are lowered into the portable parser plan before target-specific packaging.

Field bindings use `name:expression`. Generated cursor types include typed
accessors for these fields so TypeScript consumers can read parsed structure
without materializing an object tree.

Common expression forms:

```ebnf
item = ident | integer ;
block = "{" statement* "}" ;
maybe_type = (":" ident)? ;
arguments = "(" (expression % ",")? ")" ;
nonempty_list = expression % "," ;
```

Use parentheses when precedence would otherwise be unclear. Keep grammar rules
focused on syntax; downstream interpreters or compilers should own semantic
validation.

## Portability

The Wasm runtime target does not support reachable external scanner tokens.
Metadata that declares external scanner symbols produces a structured diagnostic
when those symbols are reachable from the selected root.

The public target is the generated Wasm bundle. Target-specific metadata that
cannot lower into the generated parser plan should produce a structured
diagnostic instead of changing runtime behavior silently.

## Diagnostics

Expected user failures are reported as structured diagnostics. Grammar syntax
errors, unreachable rules, unsupported portable constructs, resource limits, and
target-specific packaging errors should not appear as generic internal
exceptions.
