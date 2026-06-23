# Task 175: Runtime Public Materialization Boundary

## Goal

Make public materialization a thin, audited host boundary rather than a source
of parser semantics.

After replay lowering, shared materializers should only translate
runtime-language object handles into public JavaScript objects and render
allowed display strings. They should not make parser-semantic decisions.

## Depends On

- `170-runtime-source-of-truth-cutline.md`
- `174-runtime-replay-vm-lowering.md`

## Files To Inspect

- `src/targets/runtime/public_token_materializer.ts`
- `src/targets/runtime/public_rule_node_materializer.ts`
- `src/targets/runtime/public_field_materializer.ts`
- `src/targets/runtime/public_diagnostic_materializer.ts`
- `src/targets/runtime/public_parse_result_materializer.ts`
- `src/targets/runtime/typescript_parser_runtime.ts`
- `src/targets/wasm/lexer_emit.ts`
- `tests/runtime_plan_test.ts`
- `tests/parser_test.ts`
- `tests/wasm_test.ts`
- `docs/runtime-language.md`

## Search Commands

```sh
rg -n "materialize|throw new Error|switch \\(|if \\(|runtimeDetail|expected|found|children|fields|tokenRange" src/targets/runtime src/targets/wasm tests docs
```

## Work

1. Audit every shared public materializer for semantic decisions.
2. Move remaining parser-semantic classification into runtime-language helpers
   or the replay VM output.
3. Keep only public object allocation, source slicing for text fields, and
   documented human-readable display rendering in host materializers.
4. Add runtime-plan tests that assert materializers do not carry forbidden
   parser-semantic branches.
5. Update docs and `tasks/status.md`.

## Acceptance

- Shared materializers are documented and tested as host allocation/rendering
  boundaries.
- No parser-semantic branch remains in a materializer unless explicitly allowed
  by the cutline.
- Focused checks pass:

```sh
deno fmt --check
git diff --check
deno test -A tests/runtime_plan_test.ts tests/parser_test.ts tests/wasm_test.ts
```

## Do Not Touch

- Do not change public object shapes.
- Do not remove human-readable messages unless a separate API migration is
  approved.
- Do not move JavaScript allocation into Wasm.

## Completion Notes

Completed on 2026-06-23.

- Centralized public rule-node materialization behind runtime-language rule-node
  handles. The shared rule-node materializer now reads rule id, span, token
  range, child vectors, and field vectors from runtime accessors before wrapping
  public JavaScript objects.
- Moved field object/array/scalar wrapping into shared materializer helpers that
  take `SourceTextBoundary` and resolve runtime fragment handles through the
  shared runtime value materialization path.
- Tightened runtime-plan tests so field/replay classification lives in
  runtime-language sources while public materializers remain host allocation and
  rendering boundaries.
