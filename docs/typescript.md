# TypeScript Target

Status: current generated TypeScript runtime guide.

The TypeScript target emits a standalone DFA lexer, LR parser, syntax types, and
module entrypoint under the configured output directory, usually `typescript/`.

```text
typescript/
  syntax.ts
  lexer.ts
  parser.ts
  mod.ts
```

## Public API

Generated modules export:

- `lex(source, options?)`;
- `parse(source, options?)`;
- `parseTokens(source, tokens)`;
- `parseTokensUnchecked(source, tokens)`;
- `positionAt(source, offset)`;
- `createSourceMap(source)`;
- generated token, node, result, and diagnostic types;
- parser-plan and runtime implementation identity constants.

Import from `mod.ts` rather than private generated helper files. Helper names
and emitted source layout are implementation details.

## Spans And Source

Public spans use UTF-16 code-unit offsets. `positionAt()` and
`createSourceMap()` convert offsets to line and column positions for diagnostics
and editor tooling.

## Diagnostics

Public diagnostics use string `code` values. Generated modules also expose
numeric runtime diagnostic IDs and detail-kind IDs for hosts that need stable
low-level diagnostic schemas.

## Limits

Generated parse options include branch, queue, and trace limits for bounded
ambiguity. Compiler planning limits are configured when generating the target,
not at parser runtime.
