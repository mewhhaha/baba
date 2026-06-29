# AGENTS.md

## Goal

Baba is a syntax-runtime generator. Keep the implementation data-first,
inspectable, and measured:

```text
grammar source -> analyzed grammar -> compact lexer/parser/tree plan -> shared runtime
```

Prefer small explicit compiler stages over clever abstractions. The lexer and
parser rebuild should stay fast by construction: DFA tokenization, deterministic
parser hot paths, compact plans, and optional work only when a caller asks for
it.

## Code Style

For new code and substantial rewrites:

- Do not use ternary expressions.
- Do not use the nullish coalescing operator.
- Do not silently default when compiler, grammar, lexer, parser, lowering, or
  runtime-plan information is missing.
- If a binding, type, symbol, token, rule, state, production, field, or lowering
  fact cannot be found, throw an error or return a structured diagnostic at the
  subsystem boundary.
- Prefer explicit `if` blocks over compact expressions when the branch matters.
- Use assertion helpers directly at invariant sites.
- Define any new `expect(value, message)` helper as an assertion helper for its
  first argument so TypeScript narrows after it succeeds.
- Do not hide `expect` behind tiny wrapper helpers such as `expectToken`,
  `expectRule`, or `expectState` when the wrapper only performs one trivial
  lookup or assertion.
- If a helper function only calls another function or performs one trivial
  lookup, inline it at the call site.
- Keep semantic grammar analysis separate from concrete runtime table encoding.
- Keep parser semantics separate from CST and AST materialization policy.
- Keep TypeScript runtime behavior and Wasm runtime behavior aligned through
  shared plan data and parity tests.

## Tests

Use Deno tests. Follow the existing repository convention and put cross-module
tests under `tests/`.

When changing lexer or parser behavior, add focused tests for the exact public
shape whenever possible:

- token kind, text, channel, candidates, and spans for lexer changes;
- stable diagnostic codes and payloads for grammar-analysis failures;
- parser result, expected-token data, and recovery action for parse failures;
- CST shape and spans for tree changes;
- AST shape and spans for reducer/materializer changes;
- TypeScript/Wasm parity for shared runtime behavior.

Prefer existing local helpers in `tests/helpers.ts` over adding external test
dependencies.
