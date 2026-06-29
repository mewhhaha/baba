# T13 - Portable plan, runtime, and targets

Priority: P0

Depends on: T04, T06, T08, T09

## Goal

Package the new lexer/parser/tree data into a versioned portable plan consumed
by shared runtimes and generated target adapters.

## Scope

Define portable plan v2 sections for:

- grammar identity and version;
- symbols and stable IDs;
- lexer modes and DFA tables;
- token channels and contextual candidates;
- layout configuration;
- parser tables;
- Pratt expression plans;
- recovery plans;
- CST schema;
- AST schema;
- diagnostics schema;
- debug metadata profile;
- statistics and plan hashes.

Implement target support for:

- TypeScript shared runtime adapter;
- parser-kit artifact;
- optional Wasm-backed generic executor;
- Tree-sitter generation where the v2 grammar subset can map safely;
- binary compact plan encoding if T00 budgets require it.

## Example plan shape

The concrete schema will be versioned, but the production JSON profile should
look conceptually like this:

```json
{
  "format": "baba-portable-plan",
  "version": 2,
  "grammar": { "name": "tiny", "hash": "sha256:..." },
  "symbols": {
    "tokens": ["Ident", "Int", "Let", "Eq", "Semi", "EOF"],
    "rules": ["module", "item", "expr"]
  },
  "lexer": {
    "modes": [{ "name": "default", "dfa": 0 }],
    "dfas": [{ "start": 0, "transitions": "...", "accept": "..." }]
  },
  "parser": {
    "startRule": "module",
    "actions": "...",
    "gotos": "...",
    "productions": "..."
  },
  "expressions": {
    "expr": { "atomRule": "atom", "operators": "..." }
  },
  "cst": { "nodeKinds": ["Module", "LetDecl", "InvalidExpr"] },
  "ast": { "constructors": ["Module", "Let"] }
}
```

Debug profiles may add LR items, witness traces, and source excerpts. Production
profiles should keep only what the runtime needs.

## Runtime APIs

Expose stable APIs for:

- `lex(source, options?)`;
- `parse(source, options?)`;
- `parseTokens(source, tokens, options?)`;
- `parseTokensUnchecked(source, tokens, options?)`;
- validation-only parse;
- CST parse;
- AST materialization;
- diagnostics;
- source mapping;
- optional incremental parser construction.

## Design constraints

- Generated output should be small by default.
- The runtime executor should be shared and cacheable.
- Plan validation must reject malformed or unsupported plan data.
- Debug-only metadata should be optional.
- TypeScript and Wasm paths must share observable behavior.

## Deliverables

- portable plan v2 schema;
- plan validator;
- JSON and optional binary encoders;
- shared TypeScript runtime integration;
- Wasm executor integration or explicit deferred status;
- target emitters;
- parity tests across target runtimes;
- generated-size benchmarks.

## Acceptance criteria

- A v2 grammar can generate a TypeScript adapter and parse source.
- The adapter can lex, validate-parse, CST-parse, and AST-materialize.
- Plan validation catches bad references, non-dense IDs, unsupported versions,
  and out-of-range table entries.
- TypeScript and Wasm, if enabled, produce equivalent normalized results.
- Default generated payload stays within T00 size budgets.

## Verification harness

Run:

```sh
deno test --allow-read --allow-write --allow-run tests/portable_plan_v2_test.ts tests/runtime_v2_test.ts tests/ts_wasm_parity_v2_test.ts
deno run --allow-read --allow-write scripts/parser_pipeline_bench.ts --json tmp/portable-plan-v2.json
deno task check
```

## Out of scope

- Old grammar compatibility.
- Publishing release workflow.
- IDE-specific APIs beyond plan hooks needed by T11.
