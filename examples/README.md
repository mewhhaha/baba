# Examples

Examples are complete, reproducible projects built with Baba.

These projects use the EBNF CLI bundle generator and focus on the generated
Wasm parser artifacts. New grammar-v2 runtime examples are represented by
`fixtures/grammar-v2`, `fixtures/parser-v2`, and the v2 conformance tests until
the v2 file-emitting target cutover replaces the example grammars.

- `brainfuck/`: generates Wasm parser artifacts for a counted, parallel
  Brainfuck dialect and implements an interpreter using the generated
  Wasm-backed parser.
- `feature-tour/`: compactly exercises Baba's current feature surface:
  contextual token selection, parser conflict declarations, generated queries,
  Wasm parser API, parser-plan and runtime identity, token-stream validation,
  and external Wasm artifact loading.
- `funcfuck/`: generates parser artifacts for a small functional stream language
  based on composition, fanout, and named function definitions.
- `thunkwasm/`: generates parser artifacts for a thunk-based functional
  language, then ahead-of-time compiles programs to Wasm binaries with explicit
  heap thunks and closures.
