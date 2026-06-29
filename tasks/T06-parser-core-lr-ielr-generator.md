# T06 - Parser core LR/IELR generator

Priority: P0

Depends on: T02, T05

## Goal

Generate the deterministic parser core for declarations, statements, blocks,
and other structural grammar: LR(1) or IELR tables with compact runtime
execution.

## Scope

Implement:

- EBNF-to-BNF lowering for non-expression rules;
- canonical LR(1) table construction;
- IELR or LALR-style table compression if it preserves required behavior;
- ACTION and GOTO table compaction;
- stable state, production, and conflict identifiers;
- shift/reduce and reduce/reduce diagnostics;
- deterministic conflict resolution metadata;
- opt-in bounded branch parsing for declared conflicts;
- parser state/resource limits;
- parser execution for validation-only mode;
- parser execution hooks for CST construction;
- parser execution hooks for Pratt expression islands.

## Example structural grammar

The core parser should handle left recursion and normal statement structure
without requiring users to rewrite the grammar into a recursive-descent shape:

```ebnf
module = items:item* EOF -> Module(items) ;

item =
    "let" name:Ident "=" value:expr ";" -> Let(name, value)
  | "fn" name:Ident "(" params:param_list? ")" body:block -> Fn(name, params, body)
;

param_list = first:Ident rest:("," Ident)* ;

block =
    "{" statements:stmt* "}"
  | ":" NEWLINE INDENT statements:stmt* DEDENT
;

stmt =
    item
  | expr ";"
;
```

Minimum valid source for the parser-core tests:

```text
fn main(a, b) {
  let x = a;
}
```

Expression internals can be delegated to T07, but this task owns the parser
state transitions before entering and after leaving the `expr` island.

## Runtime hot path

The deterministic path should look like:

```text
state + lookahead token -> action -> stack update
```

Avoid allocating per action in validation-only mode. Branch machinery for
declared ambiguities must not be loaded into the hot path for deterministic
grammars.

## Conflict policy

Unresolved conflicts are analysis errors. Intentional conflicts can be handled
by:

- deterministic resolution by stable conflict ID;
- declared bounded branch search;
- grammar refactoring;
- Pratt expression declaration for expression-specific ambiguity.

## Example structural grammar

The parser core should accept left-recursive structural rules without forcing
authors into recursive-descent-friendly rewrites:

```ebnf
path =
    path "." Ident -> MemberPath(path, Ident)
  | Ident -> RootPath(Ident)
;

stmt =
    "let" Ident "=" expr ";"
  | "return" expr? ";"
  | block
;

block = "{" stmt* "}" ;
```

A validation parse of `let x = a.b;` should run through LR table actions for
`stmt` and call the T07 expression island only for `expr`. A conflict fixture
should include dangling `else` and report either an unresolved conflict or a
declared stable resolution, for example `prefer shift "else"`.

## Deliverables

- parser table generator;
- table compaction strategy;
- runtime parser executor;
- conflict diagnostics with stable IDs and related spans;
- parser statistics;
- validation-only parse API;
- tests for LR behavior, conflicts, limits, and contextual token integration.

## Acceptance criteria

- Left-recursive structural grammars are supported.
- Deterministic grammars run without branch-search overhead.
- Conflict diagnostics are stable across unrelated grammar edits.
- Parser limits produce structured diagnostics.
- Parser table data is compact enough for the T00 budgets.
- The parser can call into T07 expression islands without forcing expressions
  into giant LR grammar expansions.

## Verification harness

Run:

```sh
deno test --allow-read tests/lr_v2_test.ts tests/parser_core_v2_test.ts tests/parser_conflicts_v2_test.ts
deno run --allow-read --allow-write scripts/parser_pipeline_bench.ts --parser-only --json tmp/parser-core-v2.json
deno task check
```

## Out of scope

- Pratt parser implementation details.
- CST node storage format.
- Error recovery beyond a basic fail-fast unexpected-token diagnostic.
