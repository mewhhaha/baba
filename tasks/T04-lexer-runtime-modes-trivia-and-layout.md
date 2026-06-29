# T04 - Lexer runtime modes, trivia, and layout

Priority: P0

Depends on: T03

## Goal

Build the runtime lexer behavior around DFA tables: modes, channels, trivia,
mode transitions, interpolation-friendly state, and optional layout tokens.

## Scope

Implement lexer plan and runtime support for:

- default mode and named modes;
- mode stack operations: push, pop, replace;
- token, trivia, hidden, and error channels;
- optional trivia preservation;
- source spans for every token and trivia item;
- line/column tracking;
- EOF token emission;
- lexical diagnostics with spans;
- checkpointed lexer states for incremental relexing;
- optional layout mode with `NEWLINE`, `INDENT`, and `DEDENT` virtual tokens;
- layout suppression inside delimiters;
- configurable tab policy;
- mode-aware literals and contextual keyword candidates.

## Example target behavior

For layout-sensitive syntax:

```text
if x:
  foo()
  bar()
baz()
```

the lexer can emit:

```text
If Ident Colon Newline Indent Ident LParen RParen Newline Ident LParen RParen
Dedent Ident LParen RParen EOF
```

For explicit block syntax, the same parser can consume `{ stmt* }` without
layout tokens.

For mode transitions, a string interpolation grammar can be represented without
backtracking:

```ebnf
mode default {
  token RBrace = "}" -> pop ;
  token Quote = "\"" -> push(string) ;
}

mode string {
  token StringText = /[^"$]+/ ;
  token InterpStart = "${" -> push(default) ;
  token Quote = "\"" -> pop ;
}
```

Source:

```text
"hello ${name}"
```

Expected token stream:

```text
Quote StringText InterpStart Ident RBrace Quote EOF
```

The exact close-interpolation token policy can be refined during T01/T04, but
the mode stack behavior and spans must be explicit in tests.

## Implementation notes

- Layout should be implemented as a post-DFA token filter over a deterministic
  token stream, not as parser magic.
- Trivia should not enter normal parser tables unless explicitly referenced.
- Lexer states must be serializable enough for IDE checkpointing.
- Keep runtime options clear: preserving trivia must not change main token
  positions or parser decisions.
- Lexical errors should still advance by at least one code unit or scalar to
  avoid infinite loops.

## Deliverables

- v2 lexer plan schema for modes, channels, and layout;
- TypeScript runtime lexer executor;
- checkpoint encode/decode or clone API;
- tests for strings/comments/interpolation-style mode transitions;
- tests for trivia preservation and omission;
- tests for layout insertion and delimiter suppression;
- benchmarks for mode-heavy and layout-heavy lexing.

## Acceptance criteria

- Lexing is single pass for compiler mode.
- Mode transitions are deterministic and source-spanned.
- Trivia can be preserved for CST and omitted for validation mode.
- Layout tokens are stable and produce useful diagnostics for inconsistent
  indentation.
- Checkpointed relexing can resume with the same result as lexing from file
  start.

## Verification harness

Run:

```sh
deno test --allow-read tests/lexer_modes_v2_test.ts tests/layout_lexer_v2_test.ts
deno run --allow-read --allow-write scripts/parser_pipeline_bench.ts --lexer-only --json tmp/lexer-modes-v2.json
deno task check
```

## Out of scope

- Parser recovery.
- CST green tree reuse.
- Module grammar composition.
