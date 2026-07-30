# Release Note Template

## Breaking Changes

-

## New Defaults

-

## Migration Examples

```ts
import { createParser } from "./generated/wasm/mod.ts";

const parser = createParser({ bytes, plan });
const result = parser.parse(source);
```

## Performance Numbers

- `deno task bench:compiler --json compiler-bench.json`
- `deno task bench:runtime --json runtime-bench.json`

## Known Limitations

-
