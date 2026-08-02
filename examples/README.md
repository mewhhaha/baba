# Examples

Examples are complete, reproducible projects built with Baba.

These projects use the public grammar CLI and generated Wasm parser artifacts.
They are the runnable examples for the current package.

- `funcfuck/`: generates parser artifacts for a small functional stream language
  and exercises the shared GPU frontend plan through its CPU oracle.
- `gpu-duck/`: a constrained Duck-like grammar with explicit structural islands,
  flat operator chains, and a runnable WebGPU-lexer-to-Wasm-parser handoff.
