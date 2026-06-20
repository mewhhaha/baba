# Examples

Examples are complete, reproducible projects built with Baba.

- `brainfuck/`: generates Tree-sitter and TypeScript parser artifacts for a
  counted, parallel Brainfuck dialect, then implements an interpreter using the
  generated TypeScript parser.
- `funcfuck/`: generates parser artifacts for a small functional stream language
  based on composition, fanout, and named function definitions.
- `thunkwasm/`: generates parser artifacts for a thunk-based functional
  language, then ahead-of-time compiles programs to Wasm binaries with explicit
  heap thunks and closures.
