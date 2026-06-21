# Local Review

## 2026-06-21 Parser Kit Follow-Up

- [x] `src/targets/kit/schema.ts`: `validateParserKit()` validates the major
      schema sections but does not validate `displayNames`. A malformed
      `displayNames.terminals` or `displayNames.rules` array can pass
      validation, weakening the public schema helper for downstream consumers.
- [x] Resolved by validating `displayNames.terminals` and `displayNames.rules`,
      plus a regression assertion for malformed terminal display names.
- [x] `src/api.ts`: `normalizePortability()` now defaults to `strict` for any
      multi-target build. That can make runtime-only combinations such as
      TypeScript plus Wasm plus kit fail on Tree-sitter portability warnings
      even though no Tree-sitter output is being requested.
- [x] Resolved by making the default `strict` only when Tree-sitter is paired
      with another target, plus a regression assertion that TypeScript/Wasm/kit
      remains warning-based.

## 2026-06-21 Parser Kit Follow-Up 2

- [x] `src/targets/kit/schema.ts`: DFA validation only checks integer shapes.
      Out-of-range accept indices, transition targets, or inverted transition
      ranges can pass `validateParserKit()` and then make `lexWithKit()`
      silently skip or misroute matched text.
- [x] Resolved by checking DFA start/target bounds, accept-table length, accept
      indices against `lexer.specs`, and transition range ordering, plus
      regression assertions for invalid accepts and transitions.

## 2026-06-21 Parser Kit Follow-Up 3

- [x] `src/targets/kit/schema.ts`: `validateParserKit()` validates token,
      lexer-spec, and terminal shapes independently, but not their consistency.
      A malformed kit can put a `skip` token on the main channel or point lexer
      specs and BNF terminals at missing token/literal IDs while still passing
      validation.
- [x] Resolved by enforcing token kind/channel consistency and checking lexer
      specs plus named/literal terminals against known token/literal IDs, with
      regression assertions for each malformed case.

## 2026-06-21 Parser Kit Follow-Up 4

- [x] `src/targets/kit/schema.ts`: BNF and LR table IDs are still validated
      mostly as integers. Non-canonical production IDs, out-of-range grammar
      symbols, invalid LR action targets, or display/field references can pass
      `validateParserKit()` even though the helper parser indexes directly by
      those IDs.
- [x] Resolved by validating canonical rule/terminal/nonterminal/production/LR
      state IDs, BNF symbol references, LR item/action/goto targets, field rule
      references, and display-name references, with regression assertions for
      representative malformed tables.

## 2026-06-21 Parser Kit Follow-Up 5

- [x] `src/targets/kit/schema.ts`: lexer specs and BNF terminals can still
      reference declared but unreachable main tokens or literals. Those IDs
      exist, so they pass validation, but the parser has no terminal mapping for
      the emitted token/literal.
- [x] Resolved by requiring lexer specs and BNF terminals to reference reachable
      parser-facing tokens/literals, with regressions for unreachable named and
      literal lexer specs.

## 2026-06-21 Parser Kit Follow-Up 6

- [x] `src/targets/kit/schema.ts`: source-span validation only checks integer
      fields. Negative offsets, negative line/column values, or `end < start`
      can pass validation even though kit consumers use spans for diagnostics
      and source mapping.
- [x] Resolved by enforcing non-negative offsets, `end >= start`, one-based
      lines, and non-negative columns, with a regression for an inverted rule
      span.

## 2026-06-21 Parser Kit Follow-Up 7

- [x] `src/targets/kit/schema.ts`: `lr.stats` is only checked for integer
      fields. A kit can report state, item, ACTION, GOTO, or production counts
      that contradict the actual LR/BNF tables while still passing validation.
- [x] Resolved by checking `lr.stats` against the actual BNF production count,
      LR state count, core/lookahead item counts, ACTION entries, GOTO entries,
      and combined table entries, with a regression for a mismatched state
      count.

## 2026-06-21 Parser Kit Follow-Up 8

- [x] `README.md`: the CLI options section still said portability defaults to
      `strict` whenever multiple targets are selected. That became stale after
      runtime-only multi-target builds were restored to warning mode by default.
- [x] Resolved by documenting that the strict default applies only when
      Tree-sitter is selected with another target; the existing portability
      regression covers the runtime-only TypeScript/Wasm/kit case.

## 2026-06-21 Parser Kit Follow-Up 9

- [x] `src/ast.ts`: the public `GenerateOptions` and `ValidateOptions` comments
      had the same stale portability-default wording as the README, which would
      mislead API consumers.
- [x] Resolved by updating both comments to state that `strict` is the default
      only for Tree-sitter plus another target, while other cases default to
      `warn`.

## 2026-06-21 Parser Kit Follow-Up 10

- [x] `examples/`: the parser-kit feature was documented in the root README and
      tested, but none of the example projects showed a consumer using the
      public kit API. That left the "docs and examples" surface incomplete.
- [x] Resolved by adding a Brainfuck parser-kit consumer smoke test, documenting
      it in the examples, and wiring it into the Brainfuck example tasks without
      committing generated kit artifacts.

## 2026-06-21 Parser Kit Follow-Up 11

- [x] `examples/brainfuck/README.md` and `examples/funcfuck/README.md`: both
      examples still said `deno task generate` generated "both targets" even
      though the task produces Tree-sitter, TypeScript, and Wasm artifacts.
- [x] Resolved by updating the wording to "parser artifacts" so the example docs
      match the actual generated outputs.

## 2026-06-21 Parser Kit Follow-Up 12

- [x] `CHANGELOG.md`: the 1.4.0 notes did not mention the user-visible
      portability default change for runtime-only multi-target builds.
- [x] Resolved by documenting that strict portability remains the default only
      when Tree-sitter is selected with another target, while runtime-only
      target combinations default to warnings.
