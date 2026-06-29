# T12 - Modular grammar and extension policy

Priority: P1

Depends on: T02, T06, T07

## Goal

Support composable grammars while keeping ambiguity and performance under
control.

## Scope

Add module features:

- `grammar Name`;
- imports;
- exports;
- `extends`;
- additive rule alternatives with `+=`;
- additive token or mode declarations where safe;
- explicit extension points;
- module version or compatibility metadata;
- diagnostics for cycles, duplicate exports, hidden conflicts, and ambiguous
  extensions.

Example:

```ebnf
grammar Core

export expr
export item

grammar Effects extends Core

item +=
  "effect" Ident block -> EffectDecl
;
```

Concrete deterministic merge:

```ebnf
grammar Core

export item
item =
  "let" Ident "=" expr ";" -> Let(Ident, expr)
;

grammar Tests extends Core

item +=
  "test" Ident block -> TestDecl(Ident, block)
;
```

Expected composed rule order should be stable:

```text
Core.item alternative 0: Let
Tests.item alternative 1: TestDecl
```

Concrete rejection:

```ebnf
grammar Effects extends Core

stmt +=
  "effect" Ident block -> EffectDecl
;
```

If `Core` exports `item` but not `stmt`, analysis should report:

```json
{
  "code": "GRAMMAR_EXTENSION_POINT_NOT_EXPORTED",
  "module": "Effects",
  "targetRule": "stmt",
  "baseGrammar": "Core"
}
```

Also include a rejected token-shadowing fixture where an extension adds a token
that changes the winner for an existing base-language source.

## Extension policy

Start strict:

- extensions must target exported extension points;
- new alternatives must be analyzed with the composed grammar;
- conflicts introduced by extensions are errors unless explicitly resolved or
  declared branchable;
- expression operator extensions must declare precedence relative to existing
  operators;
- token extensions must not silently shadow existing tokens.

Opt-in ambiguity can use the bounded branch machinery from T06, but it must be
visible in diagnostics and plan metadata.

## Deliverables

- module resolver;
- composed analyzed grammar representation;
- extension-point diagnostics;
- precedence-extension diagnostics;
- tests for valid and invalid extension grammars;
- docs for strict extension patterns.

## Acceptance criteria

- A small extension grammar can add a statement or declaration kind.
- Extension conflicts report the extension file and the base declaration.
- Token shadowing across modules is diagnosed.
- Composed grammar IDs remain deterministic.
- Strict deterministic extension points work without enabling branch parsing.

## Verification harness

Run:

```sh
deno test --allow-read tests/modular_grammar_v2_test.ts tests/grammar_extension_conflicts_v2_test.ts
deno task check
```

## Out of scope

- Package registry or remote module fetching.
- Unbounded GLR/GLL parsing.
- Semantic plugin systems.
