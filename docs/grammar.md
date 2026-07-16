# Grammar

Status: current public grammar guide.

Baba grammars use the current source syntax. The generated Wasm target accepts
the deterministic grammar subset that lowers to tokens, skips, literals, rules,
groups, alternatives, optionals, repetitions, fields, and separated lists.
Semantic analysis, type checking, formatting, editor projects, and
language-specific scanner behavior stay outside the generated parser plan.

The grammar syntax also includes contextual tokens, lexer modes, layout rules,
module imports/extensions, sync recovery annotations, AST constructors, and
Pratt expression islands. The parser accepts that syntax, but Wasm generation
reports structured diagnostics for features that are not yet encoded by the
shared runtime plan. AST constructors are accepted with a warning because
generated Wasm bundles still expose cursor-shaped parse results.

## Tokens And Skips

Declare named tokens with `token` and trivia with `skip`:

```baba
grammar Tiny

token ident = /[A-Za-z_][A-Za-z0-9_]*/ ;
token integer = /[0-9]+/ ;
skip whitespace = /[ \t\r\n]+/ ;
```

Token regexes use Baba's portable regex syntax. The analyzed regex AST is the
source of truth for generated Wasm tokenization.

Use `priority` when overlapping named tokens need a deterministic standalone
lexer winner:

```baba
token keyword priority 10 = /let/ ;
token ident priority 0 = /[A-Za-z_][A-Za-z0-9_]*/ ;
```

Skips are trivia. Generated runtimes can preserve trivia when requested, but
parser rules should describe significant syntax.

Literal strings in rules are terminals too. If a literal and a named token can
both match the same source text, Baba uses parser context during `parse()` when
the grammar and metadata make the choice deterministic.

## Rules

Rules are named grammar expressions:

```baba
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

```baba
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

The Tree-sitter target accepts those symbols and emits them in the `externals`
array in `grammar.js`. Scanner implementation remains user-owned at
`src/scanner.c` or `src/scanner.cc`, following Tree-sitter's external scanner
ABI. Target-specific metadata does not change Wasm runtime behavior silently.

## Diagnostics

Expected user failures are reported as structured diagnostics. Grammar syntax
errors, unreachable rules, unsupported portable constructs, resource limits, and
target-specific packaging errors should not appear as generic internal
exceptions.
