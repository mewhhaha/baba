# Examples And Generated Output

Status: current repository policy.

Baba examples are source examples first. The user-owned files are the grammar,
metadata, interpreter or runner, sample programs, and example documentation.
Generated parser artifacts are reproducible build outputs.

## Repository Policy

The repository currently keeps checked-in generated example outputs so bootstrap
drift can be reviewed and regenerated deliberately. They are treated as
generated snapshots, not source. Use:

```sh
deno task bootstrap:check
deno task bootstrap
```

`bootstrap:check` regenerates example outputs into a temporary directory and
byte-compares them with `examples/*/generated`. `bootstrap` rewrites those
outputs through Baba's manifest-aware generated-file ownership path.

## Publish Policy

Generated example snapshots are not published. The package includes example
inputs and user-owned runners:

- `examples/README.md`;
- each example `README.md`, `deno.json`, `grammar.ebnf`, and `baba.json`;
- sample programs under `examples/*/programs`;
- example runners such as `interpreter.ts`, `parser_kit_consumer.ts`, `aot.ts`,
  and `bench.ts`.

Consumers that want generated artifacts should regenerate them from the example
source files.

## Reproducing Examples

Each example has a local `deno.json` with a `generate` task:

```sh
cd examples/brainfuck
deno task generate
deno task check
deno task run
deno task test
```

The `generate` task runs the repository CLI against the example grammar and
metadata. The `check` task type-checks user-owned example code. The `run` task
executes the primary sample program, and `test` runs the example's local
type-check plus representative sample programs.

## Size Reports

Use:

```sh
deno task size:report
deno task size:report --json size-report.json
deno task size:check
```

The report measures repository bytes, publish-include bytes, generated example
bytes by example and extension, duplicate generated snapshot bytes, largest
publish files, and Wasm binary versus embedded TypeScript representation where
both exist. `size:check` evaluates `size-budgets.json`; update that file only
when a size increase is intentional.
