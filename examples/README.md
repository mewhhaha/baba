# Examples

Examples are complete, reproducible projects built with Baba.

- `brainfuck/`: generates Tree-sitter, TypeScript, and Wasm parser artifacts for
  a counted, parallel Brainfuck dialect, implements an interpreter using the
  generated Wasm-backed parser, and includes a parser-kit consumer smoke test.
- `feature-tour/`: compactly exercises Baba's current feature surface:
  contextual token selection, parser conflict declarations, generated queries,
  TypeScript/Wasm parser APIs, parser-kit, parser-plan and runtime identity,
  token-stream validation, resource limits, and external Wasm packaging.
- `funcfuck/`: generates parser artifacts for a small functional stream language
  based on composition, fanout, and named function definitions.
- `thunkwasm/`: generates parser artifacts for a thunk-based functional
  language, then ahead-of-time compiles programs to Wasm binaries with explicit
  heap thunks and closures.
