# TypeScript Target

Status: current shared TypeScript runtime guide.

The TypeScript target emits parser-plan data, minimal syntax types, and a small
module adapter under the configured output directory, usually `typescript/`. The
parser algorithms live in `@mewhhaha/baba/runtime`.

```text
typescript/
  plan.ts
  types.ts
  mod.ts
  syntax.ts  # compatibility reexport
  lexer.ts   # compatibility reexport
  parser.ts  # compatibility reexport
```

## Public API

Generated modules export:

- `lex(source, options?)`;
- `parse(source, options?)`;
- `parseTokens(source, tokens)`;
- `parseTokensUnchecked(source, tokens)`;
- `positionAt(source, offset)`;
- `createSourceMap(source)`;
- generated token/rule name unions and generic runtime result/diagnostic types;
- parser-plan and runtime implementation identity constants.

Import from `mod.ts` rather than compatibility helper files. The default
`lexer.ts`, `parser.ts`, and `syntax.ts` files are wrappers only; use
`--typescript-runtime-packaging legacy-generated` only when inspecting the old
emitted implementation.

`parse()` accepts explicit runtime modes:

- `tokens`: tokenize and return `{ source, tokens, diagnostics }` without
  entering the parser;
- `validate`: return only success/failure and diagnostics;
- `events`: return compact parse events without constructing a CST;
- `cst-lazy`: defer public CST child and field materialization until accessed;
- `cst-full`: construct the full public CST eagerly.

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
