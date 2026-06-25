# Contributing

Status: current contributor workflow.

## Local Checks

Before sending changes, run the focused check for the area you changed and then
the repository gates that fit the risk:

```sh
deno fmt --check
deno lint
deno task check
deno task test
deno task bootstrap:check
deno task size:check
deno task publish:dry-run
```

Runtime changes should also run the named release gates:

```sh
deno task test:parity
deno task test:brl-conformance
deno task test:portable
deno task test:tree-sitter
deno task test:fuzz
```

## Generated Output

Generated example outputs are checked-in snapshots and are not published. Use
`deno task bootstrap` to regenerate them through Baba's manifest-aware output
path and `deno task bootstrap:check` to verify drift.

Do not edit generated files by hand unless a test is intentionally exercising
ownership protection.

## Design Boundaries

Keep target-specific code out of generic compiler analysis. Expected user
failures should be diagnostics, not generic thrown errors. Public compatibility
is documented through generated APIs, parser-plan versions, metadata versions,
diagnostic codes, and the Wasm ABI.

## Documentation

When changing a compatibility surface, update the relevant document in `docs/`
and add or adjust a regression test that keeps the contract discoverable.
