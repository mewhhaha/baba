# T09 - Typed AST generation and reducers

Priority: P0

Depends on: T01, T08

## Goal

Generate compiler-friendly typed ASTs from grammar annotations while keeping the
CST as the lossless syntax layer.

## Scope

Implement:

- AST constructor declarations with `-> Node(...)`;
- field binding analysis;
- field cardinality inference from `?`, `*`, `+`, and alternatives;
- generated TypeScript AST types;
- AST builder/reducer metadata in the portable plan;
- CST-to-AST materialization;
- diagnostics for missing, duplicate, or type-incompatible constructor fields;
- invalid AST placeholders for syntax errors;
- source span propagation from CST to AST;
- optional AST-only parse mode if it is measurably useful.

## AST requirements

The AST should be clean:

```text
Let {
  name: "x",
  value: Add(Var("a"), Int(1))
}
```

It should not expose delimiters, comments, or whitespace unless the grammar
author explicitly asks for them.

## Example generated types

For grammar annotations:

```ebnf
module = items:item* EOF -> Module(items) ;

item =
    "let" name:Ident "=" value:expr ";" -> Let(name, value)
  | "fn" name:Ident "(" params:param_list? ")" body:block -> Fn(name, params, body)
;
```

the TypeScript output should be shaped like:

```ts
export type AstNode = Module | Let | Fn;

export interface Module {
  readonly kind: "Module";
  readonly items: readonly Item[];
  readonly span: SourceSpan;
}

export interface Let {
  readonly kind: "Let";
  readonly name: TokenText<"Ident">;
  readonly value: Expr;
  readonly span: SourceSpan;
}
```

The exact names can change with the final type policy, but the task should lock
down cardinality, spans, node discriminants, and invalid-node representation.

## Example negative fixtures

Add fixtures that prove constructor validation is not just best-effort.

Missing bound field:

```ebnf
item =
  "let" name:Ident "=" expr ";"
    -> Let(name, value)
;
```

Expected diagnostic shape:

```json
{
  "code": "AST_UNKNOWN_CONSTRUCTOR_FIELD",
  "constructor": "Let",
  "field": "value"
}
```

Cardinality mismatch:

```ebnf
params = values:Ident* -> RequiredParam(values) ;
```

If `RequiredParam.value` is declared or inferred as a single required token,
analysis should report a stable cardinality diagnostic rather than generating an
unsound type.

Also include one fixture each for:

- `?` field used as required constructor input;
- `*` field used where a single value is required;
- `+` field incorrectly treated as optional;
- alternative branches that do not all bind the constructor field.

## Design constraints

- AST generation must not throw away CST data.
- AST constructors should be explicit enough to avoid surprising generated
  shapes.
- Diagnostics should point to the grammar annotation that caused a bad AST
  shape.
- AST type generation should be stable and readable.

## Deliverables

- AST schema IR;
- AST type emitter;
- runtime AST materializer;
- constructor validation diagnostics;
- tests for field cardinality and alternatives;
- tests for AST construction from valid and invalid CSTs;
- docs for AST annotations.

## Acceptance criteria

- The example grammar in T01 generates `Module`, `Let`, `Fn`, and expression AST
  node types.
- Optional fields produce optional or nullable types by documented policy.
- Repeated fields produce arrays.
- Invalid syntax can produce partial AST plus diagnostics where configured.
- AST materialization cost is tracked separately from parsing.

## Verification harness

Run:

```sh
deno test --allow-read tests/ast_generation_v2_test.ts tests/ast_materializer_v2_test.ts
deno run --allow-read --allow-write scripts/parser_pipeline_bench.ts --ast --json tmp/ast-v2.json
deno task check
```

## Out of scope

- Name resolution.
- Type checking.
- Formatter or refactor behavior.
