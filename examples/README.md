# Examples

Examples are complete, reproducible projects built with Baba.

These projects use the public grammar CLI and generated Wasm parser artifacts.
They are the runnable examples for the current package.

- `brainfuck/`: generates Wasm parser artifacts for a counted, parallel
  Brainfuck dialect and implements an interpreter using the generated
  Wasm-backed parser.
- `feature-tour/`: compactly exercises Baba's current feature surface:
  contextual token selection, parser conflict declarations, generated queries,
  Wasm parser API, parser-plan and runtime identity, validation, and external
  Wasm artifact loading.
- `funcfuck/`: generates parser artifacts for a small functional stream language
  based on composition, fanout, and named function definitions.
- `thunkwasm/`: generates parser artifacts for a thunk-based functional
  language, then ahead-of-time compiles programs to Wasm binaries with explicit
  heap thunks and closures.
