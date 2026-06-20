# Examples

Examples are complete, reproducible projects built with Baba.

- `brainfuck/`: generates Tree-sitter, TypeScript, and Wasm parser artifacts for
  a counted, parallel Brainfuck dialect, then implements an interpreter using
  the generated Wasm-backed parser.
- `funcfuck/`: generates parser artifacts for a small functional stream language
  based on composition, fanout, and named function definitions.
- `thunkwasm/`: generates parser artifacts for a thunk-based functional
  language, then ahead-of-time compiles programs to Wasm binaries with explicit
  heap thunks and closures.
