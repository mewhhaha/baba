# Grammar

Status: current public grammar guide.

Baba grammars use the current source syntax. The generated Wasm target accepts
the deterministic grammar subset that lowers to tokens, skips, literals, rules,
groups, alternatives, optionals, repetitions, fields, and separated lists.
Semantic analysis, type checking, formatting, editor projects, and
language-specific scanner behavior stay outside the generated parser plan.

The grammar syntax also includes contextual tokens, lexer modes, layout rules,
module imports/extensions, sync recovery annotations, AST constructors, and
Pratt expression islands. Contextual tokens are supported by the Wasm target;
the remaining features report structured diagnostics when they cannot be encoded
by the shared runtime plan. AST constructors are accepted with a warning because
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

## Contextual Tokens

Declare syntax-sensitive tokens with `contextual`. A contextual token remains an
LR terminal, but standalone `lex()` prefers an overlapping ordinary token or
skip. During `parse()`, the runtime promotes the contextual candidate only when
the current parser state accepts it.

Contextual regexes may end with one positive lookahead and one negative
lookahead. These assertions inspect the source after the token without consuming
it:

```baba
skip whitespace = /[ \t\r\n]+/ ;
contextual application_space = /[ \t]+(?=[A-Za-z_])(?!(if|in)\b)/ ;
contextual type_application_space = /[ \t]+(?=[A-Za-z_#&]|\(|\[)/ ;
contextual break_value_space = /[ \t]+(?=[^\r\n;}])/ ;
contextual break_terminator_space = /[ \t]+(?=$|[\r\n;}])/ ;
contextual extension_terminator = /[\r\n]/ ;
```

Positive lookahead uses Baba's portable regex subset and may include `$` as a
top-level end-of-input alternative. Negative lookahead accepts the same subset;
the `(word|words)\b` form is encoded as an ASCII identifier-boundary exclusion.
Lookahead is supported only at the end of a contextual regex. It does not enable
callbacks, mutable scanner state, or arbitrary JavaScript regular-expression
features.

The Wasm target encodes these guards in its portable parser plan. The
Tree-sitter target emits unguarded contextual tokens as named lexical rules, but
reports `TREE_SITTER_UNSUPPORTED_CONTEXTUAL_GUARD` when a contextual token uses
trailing lookahead because `grammar.js` cannot preserve that constraint.

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

External scanner callbacks are not part of the grammar or metadata contract. Use
contextual tokens with portable trailing guards for syntax-sensitive lexing.

The default target is the generated Wasm bundle. `--target tree-sitter` emits
`grammar.js`, while `--target all` emits both targets. Target-specific metadata
or token behavior that cannot be represented by the selected target produces a
structured diagnostic instead of changing semantics silently.

## Diagnostics

Expected user failures are reported as structured diagnostics. Grammar syntax
errors, unreachable rules, unsupported portable constructs, resource limits, and
target-specific packaging errors should not appear as generic internal
exceptions.
