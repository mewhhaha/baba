# Task 110: Public API Ergonomics

## Goal

Finish FEEDBACK P2.18, P2.19, and P2.20:

- discriminated parse results;
- separate main/trivia token types;
- token ranges on CST nodes.

## Files To Inspect

- `src/targets/typescript/syntax_emit.ts`
- `src/targets/runtime/public_parse_result_materializer.ts`
- `src/targets/runtime/public_token_materializer.ts`
- `src/targets/runtime/public_rule_node_materializer.ts`
- `src/targets/kit/schema.ts`
- `tests/parser_test.ts`
- `tests/parser_kit_test.ts`
- `tests/api_test.ts`
- `README.md`

## Search Commands

```sh
rg -n "ParseResult|ok: true|ok: false|MainToken|TriviaToken|tokenRange|RuleNodeBase|channel" src tests README.md
```

## Work

1. Verify whether each P2 item is already implemented.
2. If missing, implement the public type/runtime shape with backward-compatible
   migration if possible.
3. Add TypeScript narrowing tests for parse results.
4. Add token type tests proving trivia/main impossible states are not generated.
5. Add CST token-range tests including comments/trivia around nodes.

## Acceptance

```sh
deno test -A tests/parser_test.ts tests/parser_kit_test.ts tests/api_test.ts
deno task check
```

## Do Not Touch

- Do not change parser semantics.
- Do not change parser-kit schema unless kit helpers must expose the same public
  ergonomic shape.
