# T14 - Conformance, fuzzing, and performance gates

Priority: P0

Depends on: all implementation tasks

## Goal

Make correctness and speed regressions visible. The lexer/parser rebuild should
ship with conformance fixtures, fuzzing, differential checks, and CI gates.

## Scope

Add:

- grammar v2 conformance fixtures;
- lexer conformance fixtures;
- parser conformance fixtures;
- CST golden tests;
- AST golden tests;
- recovery golden tests;
- contextual keyword tests;
- layout tests;
- modular grammar tests;
- incremental parser differential tests;
- TypeScript/Wasm parity tests;
- malformed portable plan tests;
- fuzzing for grammar parser, regex parser, lexer, parser, and recovery;
- benchmark gates for lexer, parser construction, validation parse, CST parse,
  AST materialization, incremental parse, and generated size.

## Example fixture layout

Use a layout that keeps inputs, normalized outputs, and options close together:

```text
fixtures/parser-v2/
  contextual-keyword/
    grammar.ebnf
    source.baba
    expected.tokens.json
    expected.cst.txt
    expected.ast.json
    expected.diagnostics.json
  recovery-missing-paren/
    grammar.ebnf
    source.baba
    expected.cst.txt
    expected.diagnostics.json
  layout-blocks/
    grammar.ebnf
    source.baba
    options.json
    expected.tokens.json
```

Normalized output should be stable enough for review. For example, token output
should include kind, text, channel, and span, but not object identity or timing
data.

## Example gate configuration

Add concrete budget keys so failures are actionable:

```json
{
  "parserV2": {
    "smallPlanBytes": 50000,
    "smallParserCreateMs": 5,
    "smallValidateParseMs": 2,
    "smallCstParseMs": 10,
    "lexerThroughputMbPerSec": 50,
    "incrementalSingleEditMs": 5
  }
}
```

Fast CI should require at least:

- 5 grammar parser fixtures;
- 10 lexer fixtures;
- 10 parser/CST fixtures;
- 5 recovery fixtures;
- 3 AST fixtures;
- 3 contextual keyword fixtures;
- 2 layout fixtures;
- 2 modular grammar fixtures;
- 1 incremental differential fixture.

Scheduled or local fuzzing should record seed, iteration count, elapsed time,
and minimized failing input path. Example command:

```sh
deno task test:fuzz -- --seed 12345 --max-time-ms 30000 --artifacts tmp/fuzz-artifacts
```

## Fuzzing strategy

Use layers:

- generated regexes compared with a reference matcher for supported semantics;
- generated token sets checked for deterministic progress;
- generated small grammars checked for analyzer stability;
- generated source checked for parser termination;
- mutation fuzzing for broken source and recovery paths;
- plan mutation fuzzing for validator robustness.

## Performance strategy

Track separate numbers:

- grammar analysis time;
- DFA construction time;
- LR/IELR table construction time;
- plan encoding size;
- parser construction time;
- lex throughput;
- validation parse time;
- CST parse time;
- AST materialization time;
- recovery parse time;
- incremental edit time.

## Deliverables

- conformance fixture layout;
- test helpers for normalized token, CST, AST, and diagnostic output;
- fuzz tests or scripts;
- benchmark scripts;
- CI jobs or existing CI integration;
- budget files with documented update workflow.

## Acceptance criteria

- CI runs fast conformance and budget checks by default.
- Slower fuzz and benchmark jobs can run locally and in scheduled CI.
- Golden outputs are stable and intentionally reviewable.
- Performance failures point to the metric that regressed.
- Fuzz-found failures can be minimized into fixtures.

## Verification harness

Run:

```sh
deno task test
deno task check
deno task test:fuzz
deno run --allow-read --allow-write scripts/parser_pipeline_bench.ts --budget size-budgets.json --json tmp/parser-v2-final.json
```

Update or add Deno tasks as part of this work so contributors do not need to
remember long commands.

## Out of scope

- Manual release notes.
- API migration docs.
- Non-parser runtime benchmarks.
