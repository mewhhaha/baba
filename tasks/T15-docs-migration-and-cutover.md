# T15 - Docs, migration, and cutover

Priority: P1

Depends on: T13, T14

## Goal

Make grammar v2 the documented, tested, and shipped lexer/parser path. Remove or
clearly isolate obsolete v1 behavior.

## Scope

Update:

- README;
- grammar guide;
- diagnostics guide;
- performance guide;
- TypeScript target docs;
- Wasm target docs;
- parser-kit docs;
- Tree-sitter target docs;
- examples;
- release checklist;
- changelog;
- ADR index if one exists.

Cut over:

- CLI defaults;
- generated output layout;
- public runtime exports;
- examples and fixtures;
- benchmark scripts;
- CI tasks;
- docs links.

Remove or isolate:

- old grammar syntax docs;
- old portable plan contract;
- old generated parser paths;
- obsolete compatibility reexports if the greenfield cutover no longer needs
  them;
- stale tests that assert v1 behavior.

## Migration stance

This is a greenfield rebuild, so migration can be direct:

- document what changed;
- provide before/after grammar examples;
- do not preserve behavior that conflicts with the v2 architecture;
- keep legacy code only when it is needed to bootstrap the cutover, and mark it
  explicitly for deletion.

## Example docs update

The grammar guide should show v1-to-v2 changes directly:

```ebnf
// old: concrete syntax only
statement = "let" ident "=" expression ";" ;
```

```ebnf
// new: syntax plus tree shape, recovery, and expression island
stmt sync = ";" | "}" | EOF ;

stmt =
  "let" name:Ident "=" value:expr ";"
    -> Let(name, value)
;

expr = atom {
  infix left 10 "+"
  infix left 20 "*"
}
```

The README quick start should include a generated API example:

```ts
const result = parse(source, { mode: "cst" });
if (!result.ok) console.error(result.diagnostics);
const ast = result.ast();
```

## Deliverables

- updated docs;
- updated examples;
- updated CLI help;
- release checklist updates;
- stale file deletion PR or commit;
- final generated-size and latency report;
- changelog entry.

## Acceptance criteria

- A new user following the README writes a v2 grammar.
- The docs cover tokens, modes, contextual keywords, layout, expressions, AST
  constructors, recovery, CST, AST, modular grammars, and target generation.
- No primary docs describe v1 as the current path.
- CI passes with v2 fixtures and examples.
- The final benchmark report shows the tracked performance budget status.

## Verification harness

Run:

```sh
deno task check
deno task test
deno task publish:dry-run
deno run --allow-read --allow-write scripts/parser_pipeline_bench.ts --budget size-budgets.json --json tmp/parser-v2-cutover.json
```

If publish dry-run is intentionally skipped, document the reason in the final
cutover PR.

## Out of scope

- Supporting both grammar versions indefinitely.
- Designing new language semantics beyond syntax generation.
- Editor extension implementation.
