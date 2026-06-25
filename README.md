# baba

Baba is a syntax-runtime generator for small languages and DSLs. You describe a
language's concrete syntax once in explicit EBNF, add optional Tree-sitter
metadata, and Baba emits the parser artifacts that a tooling project can check
in.

The same grammar can produce:

- a Tree-sitter `grammar.js` and generated query fragments;
- a standalone TypeScript DFA lexer, LR(1) parser, and typed concrete syntax
  tree;
- a JavaScript-hosted core WebAssembly lexer/parser adapter with the same
  TypeScript API;
- a generic parser-kit JSON artifact for compiler and tooling consumers.

This is useful when a grammar needs to support editor highlighting, tests,
command-line tools, or browser tooling without maintaining separate parser
implementations by hand.

Baba deliberately stops at syntax. It does not generate semantic analysis, name
resolution, type checking, lowering, code generation, formatter policy, LSP
behavior, editor extension projects, package metadata, or language-specific
scanner syntax. If a language needs comments, strings, numbers, layout, fenced
blocks, or embedded languages, declare those tokens and rules explicitly.
Scanner-produced symbols must be declared with `externals` metadata and
implemented outside Baba; the TypeScript and Wasm targets report reachable
external tokens as unsupported.

## Quick Start

Create a grammar:

```ebnf
token ident = /[A-Za-z_][A-Za-z0-9_]*/ ;
token integer = /[0-9]+/ ;
skip whitespace = /[ \t\r\n]+/ ;

module = "fn" ident "(" ")" block ;
block = "{" integer "}" ;
```

Run the published CLI:

```sh
deno x --allow-read --allow-write jsr:@mewhhaha/baba/cli grammar.ebnf \
  --out generated \
  --name tiny \
  --target all
```

From a local checkout, use the repository entrypoint instead:

```sh
deno run --allow-read --allow-write src/cli.ts grammar.ebnf \
  --out generated \
  --name tiny \
  --target all
```

`--allow-read` lets the CLI load the grammar and optional metadata.
`--allow-write` lets it write the generated bundle.

## Generated Output

The default target writes Tree-sitter artifacts:

```text
generated/
  grammar.js
  queries/
    generated-highlights.scm
    generated-rainbows.scm
  .baba-manifest.json
```

Use `--target all`, `--target typescript`, or `--target wasm` to include parser
runtimes:

```sh
deno x --allow-read --allow-write jsr:@mewhhaha/baba/cli grammar.ebnf \
  --out generated \
  --target all
```

The TypeScript runtime is written under `typescript/`:

```text
generated/
  typescript/
    syntax.ts
    lexer.ts
    parser.ts
    mod.ts
```

The Wasm runtime is written under `wasm/` as a JavaScript-hosted TypeScript
adapter around embedded core WebAssembly bytes:

```text
generated/
  wasm/
    syntax.ts
    lexer.ts
    parser.ts
    wasm.ts
    mod.ts
```

Both generated parser runtimes export the same main TypeScript API:

- `parserPlanFormat`, `parserPlanVersion`, `parserPlanSemantics`, and
  `parserPlanHash`, identifying the portable parser-plan contract and exact plan
  data used by the generated tables;
- `runtimeImplementationFormat`, `runtimeImplementationVersion`,
  `runtimeImplementationSemantics`, and `runtimeImplementationHash`, identifying
  the packaged standalone runtime source family used to emit the generated
  runtime;
- `lex(source)` for deterministic standalone DFA tokenization. It emits the
  global longest-match winner using priority, literal/regex tie policy, and
  declaration order;
- `parse(source)` returning a discriminated `ParseResult`. When overlapping
  main-channel tokens share the same longest source extent, parsing may choose
  among the retained DFA accept candidates using the current LR parser context;
- strict `parseTokens(source, tokens)` validation for external token streams:
  Baba lexes the complete source once, compares supplied tokens against that
  canonical tokenization, and permits omitted trivia only;
- low-level `parseTokensUnchecked(source, tokens)` when validation is not
  wanted;
- parser diagnostic numeric ID constants such as
  `parserDiagnosticCodeParseLexicalError` and
  `parserDiagnosticCodeInternalError` and detail-kind constants such as
  `parserDiagnosticDetailKindParserState`, matching the runtime diagnostic
  record taxonomy while public diagnostics continue to use string `code` values.
  `ParseDiagnostic` objects also expose `runtimeCode`, `runtimeDetail`,
  `runtimeDetailKind`, and `runtimeDetailKindId`; `runtimeCode` and
  `runtimeDetailKindId` match the exported numeric IDs, and `runtimeDetail`
  carries the runtime payload such as parser state for unexpected/trailing
  tokens. The Wasm target's `abi.json` includes `parserDiagnostics.schemas`
  describing the `runtimeDetail` kind, numeric detail-kind id, and public
  payload fields for each numeric code;
- `positionAt(source, offset)` and `createSourceMap(source)` for UTF-16
  offset-to-line/column diagnostics;
- separate `MainNamedToken` and `TriviaToken` types for significant and trivia
  channels.

For grammars with parser-contextual token overlaps, `parse(source)` is not
guaranteed to be equivalent to `parseTokens(source, lex(source).tokens)`.
`lex(source)` deliberately collapses each token site to one global winner, and
`parseTokens()`/`parseTokensUnchecked()` cannot recover candidates that an
external token stream no longer carries. Use `parse(source)` when the grammar
depends on LR context to distinguish overlapping tokens; use token-stream APIs
only when the caller owns the exact token sequence to parse. For benchmarks and
debugging, `parse(source, { contextualLexingStats(stats) {
... } })` reports
contextual token-selection counters without adding fields to normal parse
results: ambiguous lexical sites, candidate checks, attempted token selections,
and reductions in the successful trace.

Generated parsers also accept bounded ambiguity limits through `ParseOptions`.
`maxExploredBranches`, `maxQueuedBranches`, and `maxTraceActions` default to
100,000, 100,000, and 1,000,000 respectively. All three must be positive
integers when provided. Exceeding the explored or queued branch budget produces
`PARSER_BRANCH_LIMIT`; exceeding the action trace budget produces
`PARSER_TRACE_LIMIT`. `ambiguityMode` defaults to `"first-success"`. Set it to
`"reject-ambiguous-success"` to continue exploring pending conflict branches
after the first successful parse and report `PARSER_AMBIGUOUS_PARSE` if another
branch also succeeds.

The Wasm target also writes `wasm/abi.json`, a host-readable descriptor for the
core Wasm ABI, parser-plan identity, runtime implementation identity, memory
layout, UTF-16 source/span conventions, trace statuses, adapter handle model,
numeric parser diagnostic IDs, and diagnostic payload schemas. Non-JS hosts
should read that JSON rather than scraping the generated TypeScript adapter. The
normative ABI contract is documented in [docs/wasm-abi.md](docs/wasm-abi.md).

The Wasm target also exports `wasmTargetKind`, `wasmBytes`, `wasmAbiVersion`,
core ABI metadata constants, `memory`, and `reset()` from `wasm/mod.ts`.
`wasmTargetKind` is currently `"javascript-hosted-core-wasm"`; Baba does not yet
emit a WASI library, Wasm Component/WIT package, browser-only package, or
host-neutral parser ABI. The embedded core module exports
`abi_version() -> i32`, `plan_version() -> i32`, `semantics_version() -> i32`,
`reset() -> void`, `input_base() -> i32`, `max_pages() -> i32`,
`source_encoding() -> i32`, `span_unit() -> i32`,
`lex_result_i32_count() -> i32`, and `token_record_i32_count() -> i32`,
`host_ownership_model() -> i32`, and `result_lifetime_model() -> i32`; the
JavaScript adapter exposes their current values as constants and validates that
they match its generated table layout before use. Importing an embedded adapter
does not synchronously compile Wasm; the core module and trace runtime compile
lazily when a parser instance or module-level parse/lex helper first needs them.
Source encoding and span unit value `1` means UTF-16 code units. Host ownership
model value `1` means the host owns UTF-16 input and result buffers in linear
memory; result lifetime model value `1` means low-level core results are valid
in caller-provided buffers until the host overwrites those buffers or grows
memory. The generated JavaScript adapter copies source text into Wasm memory as
UTF-16 code units, so all public spans are UTF-16 offsets matching the
TypeScript target. The adapter also exports trace status constants, and
`parseTrace()` failure results include both `statusKind` and `failureKind` while
retaining the older `internal`/`limit` booleans. Parse and lex results remain
ordinary JavaScript objects. Low-level typed-array views returned by `wasm.ts`
helpers are tied to the current `WebAssembly.Memory` buffer. `WasmSourceBuffer`
values returned by `writeSource()` and `ParseTraceInput` values returned by
`createParseTraceInput()` are adapter-owned capabilities: they are not forgeable
or serializable. The adapter handle capability model value `1` means those
JavaScript capabilities are epoch-checked. `WasmSourceBuffer` values become
stale after `reset()` or after `writeSource()` installs a different source;
`ParseTraceInput` values become stale after `reset()`. Call `writeSource()` or
`createParseTraceInput()` again to obtain a current handle before using
`lexOne()`, `lexAll()`, or `parseTrace()`. Repeated parses reuse memory up to
the previous high-water mark, and adapter-side offset arithmetic is checked
against the 32-bit Wasm address space. The core module declares a maximum of
65,535 Wasm pages; the adapter checks the same page limit before calling
`memory.grow()`.

Generated Wasm bundles also expose `createParser()` and `createParserAsync()`.
Each returned parser instance owns its own `WebAssembly.Instance`, memory,
source buffers, trace runtime, reset epoch, and disposed state. Module-level
`lex`, `parse`, and token-stream helpers remain convenience wrappers over an
active/default Wasm instance; use parser instances when lifecycle isolation or
interleaved parsers matter.

CI installs `wasm-tools` and `wasmtime` so the Wasm target is validated both by
the JavaScript-hosted adapter tests and by an independent core-Wasm toolchain.
Local `deno task test` runs the Deno/JavaScript adapter path by default and
skips the independent-engine checks with an install hint when those binaries are
not available.

## Further Documentation

- [Grammar](docs/grammar.md)
- [Metadata](docs/metadata.md)
- [Portable runtime](docs/portable-runtime.md)
- [TypeScript target](docs/typescript.md)
- [Wasm target](docs/wasm.md)
- [Diagnostics](docs/diagnostics.md)
- [Limits](docs/limits.md)
- [Examples](docs/examples.md)
- [Stability policy](docs/stability.md)
- [Contributing](docs/contributing.md)

Internally, standalone parser targets lower the analyzed grammar once into a
versioned portable parser plan:

```ts
{
  format: "baba-parser-plan",
  version: 2,
  semantics: "baba-portable-v1"
}
```

That plan contains the deterministic lexer DFA, BNF productions and reducers, LR
ACTION/GOTO tables, token/literal metadata, and CST field schema consumed by the
TypeScript, Wasm, and parser-kit planning paths. It is separate from Baba's
package version, metadata schema version, runtime-language runtime artifact
manifest version, parser-kit schema version, and Wasm adapter ABI version.
Generated TypeScript, generated Wasm adapters, and parser-kit JSON all expose
the same `parserPlanHash` or `portablePlan.hash` when they were built from the
same portable parser plan.

Generated TypeScript, generated Wasm adapters, and parser-kit JSON also expose a
runtime implementation identity with format `"baba-runtime-implementation"`,
version `1`, semantics `"baba-runtime-portable-v1"`, and an aggregate source
hash. This verifies that outputs were packaged against the same checked-in
runtime source family and checked runtime-language artifact manifest. Generated
TypeScript and JavaScript-hosted Wasm parser runtimes now satisfy the runtime
source-of-truth cutline documented in
[docs/runtime-language.md](docs/runtime-language.md): parser semantics are
runtime-language-owned, while generated host code owns source/string
capabilities, public object allocation, diagnostic text rendering, adapter
capabilities, and packaging. Parser-kit helpers remain tooling/convenience
interpreters for `parser-kit.json`, not part of that TypeScript/Wasm proof.

The initial private runtime-language semantics are documented in
`docs/runtime-language.md`. Its Stage-0 executable subset currently covers
32-bit scalar control, table helpers, growable scratch memory, lexer/parser
runtime semantics, reducer dispatch, CST arena helpers, diagnostic payloads, and
Wasm ABI metadata. The Stage-0 compiler lowers validated runtime-language
programs to one resolved control-flow/value IR before the TypeScript and Wasm
backends emit target artifacts; target-specific source/byte emission is still
separate.

Architecture decisions are recorded under [docs/adr](docs/adr), including the
scope boundary, portable parser plan, runtime language, Wasm ABI, contextual
lexing, conflict policy, and generated-file ownership. Compatibility and support
levels for public APIs, EBNF, metadata, parser plans, generated TypeScript, Wasm
ABI, BRL, and Tree-sitter output are documented in
[docs/stability.md](docs/stability.md).

Use `--target kit` when another tool wants Baba's parser data without generated
TypeScript source:

```sh
deno x --allow-read --allow-write jsr:@mewhhaha/baba/cli grammar.ebnf \
  --out generated \
  --target kit
```

The parser kit is written under `kit/` by default:

```text
generated/
  kit/
    parser-kit.json
```

`parser-kit.json` uses schema version 1 and includes a `portablePlan` metadata
block with `format`, `version`, `semantics`, and `hash`. The default `full`
profile includes grammar/root metadata, token and literal metadata, the lexer
DFA, BNF terminals/nonterminals and productions, reducer descriptors, LR
ACTION/GOTO tables including declared multi-action conflicts, LR item/lookahead
detail, field schemas, display names, source spans, and production origins. It
is a consumer-neutral data artifact; Baba does not generate compiler-specific
export names, host ABI tables, or language-specific memory layouts.

Use the `runtime` profile when a consumer only needs `lexWithKit()` and
`parseWithKit()`:

```sh
deno x --allow-read --allow-write jsr:@mewhhaha/baba/cli grammar.ebnf \
  --out generated \
  --target kit \
  --kit-profile runtime
```

The runtime profile emits minified JSON and omits LR item/lookahead detail,
production source spans, and production origins while keeping the tables needed
by the reference helpers.

Parser-kit parse helpers expose the same numeric diagnostic `runtimeCode`,
`runtimeDetail`, `runtimeDetailKind`, and `runtimeDetailKindId` fields as the
generated TypeScript and Wasm parser APIs.

Parser-kit schema version 1 follows normal semver compatibility. Semver-minor
releases may add optional fields, helper APIs, target options, diagnostics, or
artifact profiles that preserve existing v1 field meanings. Schema-breaking
changes require a new `schemaVersion`; examples include removing or renaming
existing fields, changing existing field types or ID semantics, changing token
or terminal mapping meaning, or making runtime helper inputs incompatible.
Consumers should reject unsupported `schemaVersion` values and ignore unknown
object fields they do not need.

Generated parser code is specialized to the grammar. Deterministic TypeScript
parsers omit branch-search helpers, while grammars with declared parser
conflicts include the bounded branch runtime. Wasm parser adapters use the same
public API and replay the Wasm parser engine's successful action trace to build
the TypeScript CST.

Only query files with content are written. Regenerating through `applyBundle()`
removes previously owned generated query fragments that become empty. Ordinary
`queries/*.scm` files are user-owned and are never written by Baba.

## CLI

List outputs without writing:

```sh
deno x --allow-read jsr:@mewhhaha/baba/cli grammar.ebnf --list-files
```

Explain target support without writing files:

```sh
deno x --allow-read jsr:@mewhhaha/baba/cli check grammar.ebnf \
  --explain-targets
```

The report lists Tree-sitter, TypeScript, Wasm, and kit support independently
and includes target capability diagnostics such as external scanner usage,
portable token overlap, or target-specific metadata limits.

Pass Tree-sitter metadata:

```sh
deno x --allow-read --allow-write jsr:@mewhhaha/baba/cli grammar.ebnf \
  --out generated \
  --name tiny \
  --root module \
  --metadata baba.json
```

`--meta` is an alias for `--metadata`.

Select and configure parser-runtime targets:

```sh
deno x --allow-read --allow-write jsr:@mewhhaha/baba/cli grammar.ebnf \
  --target all \
  --typescript-dir ts \
  --wasm-dir wasm \
  --discard-trivia \
  --lexer-state-limit 50000 \
  --regex-nesting-limit 256 \
  --regex-ast-node-limit 100000 \
  --regex-bounded-repeat-limit 10000 \
  --regex-nfa-state-limit 100000 \
  --regex-dfa-state-limit 50000 \
  --regex-overlap-state-limit 250000 \
  --grammar-expression-depth-limit 1024 \
  --parser-state-limit 20000 \
  --parser-item-limit 200000 \
  --parser-table-entry-limit 200000
```

`--ts-out` is an alias for `--typescript-dir`. `--wasm-dir` controls the Wasm
target output directory. `--kit-dir` controls the parser-kit output directory
when `--target kit` is selected. `--kit-profile full|runtime` controls the
parser-kit detail level and defaults to `full`. `--preserve-trivia` and
`--discard-trivia` control whether skip matches are emitted as trivia tokens by
generated runtimes and kit helper lexing. `--lexer-state-limit`,
`--regex-nesting-limit`, `--regex-ast-node-limit`,
`--regex-bounded-repeat-limit`, `--regex-nfa-state-limit`,
`--regex-dfa-state-limit`, `--regex-overlap-state-limit`,
`--grammar-expression-depth-limit`, `--parser-state-limit`,
`--parser-item-limit`, and `--parser-table-entry-limit` apply to the TypeScript,
Wasm, and kit parser-runtime planning path. Regex nesting defaults to 256
groups, and grammar expression depth defaults to 1,024. Regex limit diagnostics
identify the compiler phase, for example `TS_REGEX_NFA_STATE_LIMIT`,
`TS_REGEX_DFA_STATE_LIMIT`, `TS_REGEX_OVERLAP_WORK_LIMIT`,
`TS_REGEX_NESTING_LIMIT`, `TS_REGEX_AST_NODE_LIMIT`, or
`TS_REGEX_REPEAT_EXPANSION_LIMIT`. `--portability strict|warn|off` controls
diagnostics for known cross-target acceptance differences. When Tree-sitter is
selected with another target, portability defaults to `strict`; otherwise it
defaults to `warn`.

`--target all` intentionally does not include `kit`; request it explicitly with
`--target kit` to avoid unplanned JSON artifact churn in existing generated
directories.

Inspect generated TypeScript target size and parser table statistics:

```sh
deno x --allow-read --allow-write jsr:@mewhhaha/baba/cli grammar.ebnf \
  --target typescript \
  --typescript-generated-byte-limit 1000000 \
  --parser-stats
```

`--typescript-generated-byte-limit` only inspects generated TypeScript output.
`--parser-stats` also includes internal hardening counters such as regex
AST/NFA/DFA sizes, overlap pairs compared, grammar SCC/iteration counts, LR
closure work, and diagnostics emitted or suppressed.

## Library API

```ts
import {
  applyBundle,
  generate,
  parseGrammar,
  parseMetadata,
  validateGrammar,
} from "jsr:@mewhhaha/baba";

const grammar = parseGrammar(await Deno.readTextFile("grammar.ebnf"));
const metadata = parseMetadata(await Deno.readTextFile("baba.json"));
const diagnostics = validateGrammar(grammar, { rootRule: "module", metadata });

if (diagnostics.length === 0) {
  const bundle = generate(grammar, {
    name: "tiny",
    rootRule: "module",
    metadata,
  });
  for (const diagnostic of bundle.diagnostics ?? []) {
    console.warn(diagnostic.code, diagnostic.message);
  }
  await applyBundle(bundle, { root: "generated" });
}
```

Parser-kit consumers should generate JSON, load it, validate it, then call the
reference helpers:

```ts
import {
  lexWithKit,
  type ParserKit,
  parseWithKit,
  validateParserKit,
} from "jsr:@mewhhaha/baba/kit";

const rawKit = JSON.parse(
  await Deno.readTextFile("generated/kit/parser-kit.json"),
);
const issues = validateParserKit(rawKit);
if (issues.length > 0) {
  throw new Error(`${issues[0].path}: ${issues[0].message}`);
}

const kit = rawKit as ParserKit;
const source = "fn main() {}";
const lexed = lexWithKit(kit, source);
const parsed = parseWithKit(kit, lexed.source);
console.log(parsed.ok);
```

Build tools can also compile the artifact in memory:

```ts
import { compileParserKit } from "jsr:@mewhhaha/baba/kit";

const result = compileParserKit(grammar, {
  name: "tiny",
  kit: { profile: "runtime" },
});
if (!result.kit) {
  throw new Error(result.diagnostics[0]?.message ?? "Kit compilation failed");
}
```

`applyBundle()` writes nested files, records generated ownership in
`.baba-manifest.json`, and refuses to overwrite or remove modified or unowned
files.

## EBNF

Rules use `name = expression ;`.

```ebnf
module = item+ ;
item = function | declaration ;
```

Terminal declarations are explicit:

```ebnf
token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
token TYPE_IDENT priority 10 = /[A-Z][A-Za-z0-9_]*/ ;
token STRING = /"([^"\\]|\\.)*"/ ;
skip WHITESPACE = /[ \t\r\n]+/ ;
skip LINE_COMMENT = /\/\/[^\n]*/ ;

module = "let" IDENT "=" STRING ;
```

Expressions support:

- sequence: `a b c`
- choice: `a | b`
- optional: `item?` or `[ item ]`
- repeat: `item*` or `{ item }`
- one-or-more: `item+`
- separated list: `item % ","`
- named field: `name:item`
- grouping: `( item | other )`

There are no implicit token builtins. Names such as `ident`, `string`, `number`,
`newline`, `indent`, `dedent`, `fenced_text`, and `line_comment` are ordinary
names and must be declared before use.

Token and skip regexes use Baba's portable regex subset. Shorthand classes,
Unicode property escapes, anchors, lookaround, lazy quantifiers, backreferences,
inline flags, and target-specific escape forms are rejected by compiler
analysis, not by JavaScript's `RegExp` parser.

For standalone TypeScript, Wasm, and kit parsers, reachable named token
languages must be disjoint. Priority-resolved token/token overlaps are rejected
because a global portable lexer could hide a token that another parser state
expects. A higher-priority main token may overlap trivia; trivia that would win
over a reachable main token is rejected. Reachable literals cannot be hidden by
priority token or trivia matches. Tree-sitter-only output may still use explicit
priority for Tree-sitter lexical precedence. Regexes that need a literal slash
may escape it, such as `skip line_comment = /\/\/[^\n\r]*/ ;`.

Rules unreachable from the selected root are omitted from generated outputs and
reported as `UNREACHABLE_RULE` warnings.

## Metadata

Metadata is JSON for Tree-sitter output shaping, query generation, and
standalone parser conflict policy:

```ebnf
token ident = /[A-Za-z_][A-Za-z0-9_]*/ ;
token embedded_source = /[^}]+/ ;
skip whitespace = /[ \t\r\n]+/ ;

module = "fn" name:ident body:block ;
block = "{" embedded_source "}" ;
```

```json
{
  "version": 2,
  "word": "ident",
  "extras": [{ "kind": "rule", "name": "whitespace" }],
  "rules": {
    "module": {
      "paths": {
        "name": { "alias_ref": "function_name" }
      }
    }
  },
  "queries": {
    "highlights": {
      "entries": [
        {
          "parent": "module",
          "field": "name",
          "node": "ident",
          "capture": "function"
        }
      ],
      "defaults": {
        "mode": "rich",
        "suppress": [{ "parent": "module", "field": "name", "node": "ident" }]
      }
    },
    "locals": [{ "node": "ident", "capture": "local.definition" }],
    "injections": [{ "node": "embedded_source", "language": "<language>" }]
  }
}
```

EBNF fields generate Tree-sitter fields directly. Versioned metadata may use
those field names as selectors for additional shaping, such as aliases or
precedence wrappers. Numeric expression paths are accepted only for unversioned
legacy metadata.

Supported top-level keys:

- `version`
- `externals`
- `extras`
- `word`
- `supertypes`
- `conflicts`
- `inline`
- `rules`
- `parser`
- `queries`

Metadata does not contain formatter, LSP, editor, package, license, author, or
binding configuration.

Highlight queries accept raw `patterns` plus structured `entries`. A structured
entry may target a node or literal globally, or add `parent` and optional
`field` context:

```json
{
  "queries": {
    "highlights": {
      "entries": [
        {
          "parent": "fn_sig",
          "field": "name",
          "node": "IDENT",
          "capture": "function"
        },
        { "literal": "fn", "capture": "keyword" }
      ],
      "patterns": ["(call_expression function: (_) @function.call)"]
    }
  }
}
```

Generated highlight defaults use `"rich"` mode unless configured otherwise. Rich
mode keeps literal keyword, punctuation, bracket, delimiter, and operator
captures, then infers common IDE captures for comments, strings, numbers,
constants, builtins, type-like nodes, members, labels, and contextual identifier
fields such as function names or call callees. It does not add a global
`(ident) @variable` capture. Use `"defaults": { "mode": "minimal" }` to keep the
older literal-only defaults. Default suppressions accept the same
`parent`/`field` context, so one inferred capture can be disabled without
removing the same node everywhere.

### Parser Runtime Conflict Policy

The `parser` metadata block applies to Baba's standalone parser runtimes. It is
separate from Tree-sitter shaping metadata:

```json
{
  "version": 2,
  "parser": {
    "resolutions": [
      {
        "rules": ["generic_expression", "qualified_identifier"],
        "on": "[",
        "prefer": "shift"
      }
    ],
    "conflicts": [
      { "conflict": "c_91a8..." },
      { "conflict": "c_ef90..." }
    ]
  }
}
```

`resolutions` keep the generated LR table deterministic by selecting either a
`shift` or `reduce` action for a stable conflict ID. For reduce/reduce
conflicts, add `reduce` with the rule or expression text that should win. When
generation reports an LR conflict, the diagnostic includes candidate
`resolutions` metadata with the current conflict ID. It also includes a conflict
witness prefix: a short token sequence that reaches the conflicted parser state,
followed by the conflicting lookahead as the final symbol.

`conflicts` declares local grammar ambiguities that the generated TypeScript and
Wasm parsers may explore with bounded branch search. Prefer stable conflict-ID
entries such as `{ "conflict": "c_91a8..." }`. This is useful for grammars that
need Tree-sitter-like conflict handling but still want standalone parser
runtimes. The Wasm target traces declared conflict branches inside its generated
Wasm parser engine and replays the successful action trace in TypeScript to
build the CST. Shift/reduce diagnostics with multiple rule origins also suggest
matching `conflicts` metadata when branch search is the intended policy.

Branch search is deterministic and shared by TypeScript and Wasm runtimes. At a
conflicted state, the runtime explores action alternatives in table order, saves
later alternatives on a LIFO stack, and returns the first successful parse in
`"first-success"` mode. In `"reject-ambiguous-success"` mode, the runtime saves
the first successful action trace and continues exploring pending branches; if a
second branch succeeds, parsing fails with `PARSER_AMBIGUOUS_PARSE`; otherwise
the saved first success is replayed. When all branches fail, the diagnostic uses
the branch that reached the furthest token offset, preserving the earliest
reached parser state for equal offsets. The search is bounded by the generated
`ParseOptions` ambiguity limits: `maxExploredBranches`, `maxQueuedBranches`, and
`maxTraceActions`.

### Diagnostics

Generation failures caused by grammar or metadata input are reported as
structured diagnostics rather than generic internal errors. Diagnostics include
a stable `code`, a clear `message`, and may include `backend`, metadata `path`,
and source `span` fields. Examples include unknown metadata references, invalid
aliases, invalid external token declarations, legacy path misuse, query selector
errors, and Tree-sitter validation failures.

External scanner symbols are declared in metadata:

```json
{
  "version": 2,
  "externals": ["INDENT", "DEDENT", "NEWLINE"]
}
```

The generated `grammar.js` declares those symbols in `externals`; the scanner
implementation remains user-owned.

## Stability

The versioned metadata schema is `version: 2`. It uses explicit EBNF fields
rather than positional expression paths, so grammar edits do not silently
retarget field metadata.

## Development

```sh
deno fmt --check
deno lint
deno task check
deno task test
deno test --allow-read --allow-write tests/runtime_language_test.ts
deno task bench -- --samples 5 --json bench-results.json
deno task size:check
deno task publish:dry-run
```

Use the bootstrap tasks to validate and regenerate example outputs:

```sh
deno task bootstrap:check
deno task bootstrap
```

`bootstrap:check` regenerates the Baba-owned files for the examples into a
temporary directory and validates their manifests and generated TypeScript/Wasm
entrypoints. `bootstrap` rewrites local ignored generated files through Baba's
manifest-aware `applyBundle()` path. These tasks cover the current Stage-0
generated runtime artifacts and verify the checked-in runtime implementation
source manifest. They also verify the Stage-0 runtime-language compiler source
manifest and checked runtime-language helper artifact hashes so compiler drift
is tracked independently from generated parser runtime identity.

Generated example outputs are ignored local artifacts and are not part of the
publish payload. The example source/publish policy and `deno task size:report`
are documented in [docs/examples.md](docs/examples.md).
