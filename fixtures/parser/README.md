# Parser conformance fixtures

This directory is the reviewable home for parser conformance cases. Each case
should keep its grammar, input, options, and normalized expected output
together:

```text
case-name/
  grammar.baba
  source.baba
  options.json
  expected.tokens.json
  expected.cst.txt
  expected.ast.json
  expected.diagnostics.json
```

The fast gate in `tests/conformance_test.ts` currently owns the normalized
fixture matrix so the implementation can evolve quickly while the file layout is
available for minimized fuzz failures and larger golden cases.
