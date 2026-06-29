# Grammar v2

Status: current documented grammar path.

Grammar v2 is Baba's data-first authoring syntax for the lexer/parser runtime
rebuild. It parses into a spanned grammar tree, analyzes references and
reachability, builds DFA lexer modes, LR parser tables, Pratt expression plans,
recovery metadata, CST schemas, AST schemas, and a versioned portable plan for
shared runtime adapters.

```ebnf
grammar Core

token Ident = /[_\p{L}][_\p{L}\p{N}]*/ ;
token Int = /[0-9]+/ ;
skip Space channel trivia = /[ \t\r\n]+/ ;
contextual Async = "async" ;
mode String {
  token StringText pop = /[^"]+/ ;
}
token Quote push String = /"/ ;
layout indent = INDENT | DEDENT | NEWLINE ;

export module
export expr
module Core.Syntax
import Core.Base ;

module = items:item+ -> Module(items) ;

item sync = ";" | "}" | EOF ;
item =
    "let" name:Ident "=" value:expr ";"
      -> Let(name, value)
  | Async? "fn" name:Ident "(" params:param_list? ")" body:block
      -> Fn(name, params, body)
;

expr = expression atom: atom operators {
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

The syntax parser recognizes:

- `grammar Name` headers;
- `token`, `skip`, and `contextual` terminal declarations;
- skip channels such as `channel trivia`;
- lexer modes with mode-local terminal declarations;
- mode transitions with `push Mode`, `mode Mode`, and `pop`;
- optional layout declarations such as `layout indent = ... ;`;
- `export` and `import` declarations;
- module declarations and extension declarations;
- sequence, choice, option, repeat, repeat-one, and separated-list expressions;
- field bindings with `name:expr`;
- constructor annotations with `-> Node(field)`;
- rule synchronization declarations with `sync`;
- expression islands with `infix`, `prefix`, and `postfix` operator entries.

Use `parseGrammarV2(source)` to parse this syntax. Then call
`analyzeGrammarV2()`, `buildGrammarV2PortablePlan()`, and
`createGrammarV2Runtime()` for the shared TypeScript runtime adapter.

```ts
const parsed = parseGrammarV2(source);
const analyzed = analyzeGrammarV2(parsed.grammar);
const built = buildGrammarV2PortablePlan(analyzed);
const runtime = createGrammarV2Runtime(built.plan);

runtime.lex(input);
runtime.parse(input);
runtime.parse(input, { mode: "cst" });
runtime.materializeAst(input);
```

## Tokens, Modes, And Contextual Keywords

`token` declarations produce main-channel tokens. `skip` declarations consume
trivia and usually use `channel trivia`. `contextual` declarations are retained
as candidates but do not win standalone lexing over normal tokens. Parser code
uses candidate sites to select contextual tokens when the LR state expects them.

Modes group mode-local token declarations. Transitions are declared at the token
site with `push Mode`, `mode Mode`, or `pop`. The runtime stores one DFA per
mode and lexer checkpoints preserve the mode stack for incremental parsing.

## Layout

`layout indent = INDENT | DEDENT | NEWLINE ;` declares virtual layout token
names. Runtime layout filtering consumes the deterministic token stream, inserts
`NEWLINE`, `INDENT`, and `DEDENT`, and suppresses layout inside configured
delimiter tokens.

## Expressions

Use normal rules for deterministic LR syntax. Use expression islands for
operator syntax:

```ebnf
expr = expression atom: atom operators {
  prefix 30 "-"
  infix left 10 "+"
  infix left 20 "*"
  postfix 40 "?"
}
```

Operators declare fixity, associativity, precedence, and token pattern. The
Pratt plan is stored in the portable v2 plan next to the LR tables.

## CST And AST

The CST is lossless: tokens, trivia, invalid tokens, missing nodes, UTF-16
spans, and UTF-8 byte spans stay inspectable. Constructor annotations define AST
materialization:

```ebnf
item = "let" name:Ident "=" value:expr ";" -> Let(name, value) ;
```

AST schema generation infers field cardinality and emits stable constructor
metadata. Runtime AST materialization returns invalid placeholder nodes for
broken input instead of hiding parse failures.

## Recovery

Rules can declare synchronization points:

```ebnf
item sync = ";" | "}" | EOF ;
```

The parser runtime exposes deterministic single-token insertion/deletion
recovery diagnostics with expected token names, actual token, and recovery
action payloads.

## Modular Grammars

Use `export`, `import Name ;`, and `extend rule = ... ;` to compose grammar
modules. Composition is deterministic, rejects import cycles, and only allows
extensions for exported rules from imported modules.

## Portable Plan And Runtime

`buildGrammarV2PortablePlan()` emits `format: "baba-portable-plan"`,
`version: 2`, and `semantics: "baba-portable-v2"`. The plan includes grammar
identity, symbols, lexer modes, DFA tables, contextual candidates, parser
tables, Pratt plans, recovery, CST, AST, diagnostics, debug profile, statistics,
hashes, and target capability metadata.

`createGrammarV2Runtime(plan)` exposes `lex`, `parse`, `parseTokens`,
`parseTokensUnchecked`, validation parse, CST parse, AST materialization,
diagnostics, source mapping, and incremental parser construction. The v2 Wasm
executor status is explicit in plan target metadata until the generic Wasm
executor consumes v2 sections directly.
