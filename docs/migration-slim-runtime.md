# Slim Runtime Migration

The legacy generated parser shape is:

```text
generated/
  typescript/
    syntax.ts
    lexer.ts
    parser.ts
    mod.ts
  wasm/
    syntax.ts
    lexer.ts
    parser.ts
    wasm.ts
    mod.ts
```

The slim-runtime shape is:

```text
generated/
  typescript/
    plan.ts
    types.ts
    mod.ts
    syntax.ts
    lexer.ts
    parser.ts
```

The `syntax.ts`, `lexer.ts`, and `parser.ts` files in the new TypeScript output
are compatibility reexports, not generated parser implementations.

Existing imports should continue to prefer the adapter:

```ts
import { lex, parse } from "./generated/mod.ts";
```

Do not import generated `lexer.ts`, `parser.ts`, or `wasm.ts` directly in new
code. For the old generated TypeScript implementation, use
`--typescript-runtime-packaging legacy-generated` temporarily.

When type emission modes are available, use minimal types by default and request
full field-specific CST interfaces only when consumers need them. For validation
or diagnostics-only workflows, prefer validation mode once available so callers
do not pay for full CST materialization.

Vendored runtime packaging should copy the shared runtime once, not duplicate a
new generated parser implementation for every grammar.
