# T01 - Grammar v2 syntax and bootstrap parser

Priority: P0

Depends on: T00

## Goal

Design and implement the grammar language that authors use to define lexing,
parsing, CST shape, AST shape, recovery, and extension points.

## Scope

Add grammar v2 syntax for:

- token declarations;
- skip/trivia declarations;
- lexer modes;
- mode transitions;
- contextual keywords;
- optional layout rules;
- EBNF operators: sequence, choice, option, repeat, repeat-one, separated list;
- field binding with `name:expr`;
- AST constructors with `-> Node(...)`;
- rule annotations such as `sync`;
- expression islands with precedence declarations;
- grammar modules, exports, imports, and extension declarations.

Example target syntax:

```ebnf
grammar Core

token Ident = /[_\p{L}][_\p{L}\p{N}]*/ ;
token Int = /[0-9]+/ ;
skip Space channel trivia = /[ \t\r\n]+/ ;
contextual Async = "async" ;

export module
export expr

module =
  items:item* EOF
  -> Module(items)
;

item sync = ";" | "}" | EOF ;
item =
    "let" name:Ident "=" value:expr ";"
      -> Let(name, value)
  | Async? "fn" name:Ident "(" params:param_list? ")" body:block
      -> Fn(name, params, body)
;

expr = atom {
  infix left 10 "+"
  infix left 20 "*"
  prefix 30 "-"
  postfix 40 "?"
}

atom =
    Int -> IntLiteral(text)
  | Ident -> Name(text)
  | "(" expr ")"
;
```

## Implementation notes

- The bootstrap parser can be hand-written if that gets v2 moving faster.
- Keep grammar v2 AST nodes source-spanned. Later diagnostics depend on spans.
- Keep syntax parsing separate from semantic analysis. Do not resolve rule or
  token references in the grammar parser.
- Preserve comments/trivia in the grammar source CST if practical, but do not
  block the task on formatting support for grammar files.

## Deliverables

- v2 grammar AST types.
- grammar v2 parser and diagnostics.
- parser tests for every syntax feature listed above.
- a doc page describing grammar v2 with examples.
- a small set of valid and invalid grammar fixtures.

## Acceptance criteria

- The parser accepts the example syntax above.
- Invalid grammar syntax produces structured diagnostics with source spans.
- The parser can recover enough to report multiple grammar-file syntax errors.
- Grammar v2 parsing does not run target generation or semantic analysis.
- The old grammar parser can be deleted, isolated behind a legacy flag, or left
  untouched only until cutover.

## Verification harness

Run:

```sh
deno test --allow-read tests/grammar_v2_parser_test.ts
deno task check
```

Add golden tests for parsed grammar AST snapshots. Snapshot output should avoid
unstable object identity and include spans only where useful.

## Out of scope

- DFA construction.
- LR table generation.
- AST type generation from constructors.
- Module resolution semantics.
