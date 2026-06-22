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
- `lex(source)` for DFA tokenization;
- `parse(source)` returning a discriminated `ParseResult`;
- strict `parseTokens(source, tokens)` validation for external token streams:
  Baba lexes the complete source once, compares supplied tokens against that
  canonical tokenization, and permits omitted trivia only;
- low-level `parseTokensUnchecked(source, tokens)` when validation is not
  wanted;
- parser diagnostic numeric ID constants such as
  `parserDiagnosticCodeParseLexicalError` and
  `parserDiagnosticCodeInternalError`, matching the runtime diagnostic record
  taxonomy while public diagnostics continue to use string `code` values;
- `positionAt(source, offset)` and `createSourceMap(source)` for UTF-16
  offset-to-line/column diagnostics;
- separate `MainNamedToken` and `TriviaToken` types for significant and trivia
  channels.

The Wasm target also exports `wasmTargetKind`, `wasmBytes`, `wasmAbiVersion`,
core ABI metadata constants, `memory`, and `reset()` from `wasm/mod.ts`.
`wasmTargetKind` is currently `"javascript-hosted-core-wasm"`; Baba does not yet
emit a WASI library, Wasm Component/WIT package, browser-only package, or
host-neutral parser ABI. The embedded core module exports
`abi_version() -> i32`, `plan_version() -> i32`, `reset() -> void`,
`input_base() -> i32`, `max_pages() -> i32`, `source_encoding() -> i32`,
`span_unit() -> i32`, `lex_result_i32_count() -> i32`, and
`token_record_i32_count() -> i32`, `host_ownership_model() -> i32`, and
`result_lifetime_model() -> i32`; the JavaScript adapter exposes their current
values as constants and validates that they match its generated table layout
before use. Source encoding and span unit value `1` means UTF-16 code units.
Host ownership model value `1` means the host owns UTF-16 input and result
buffers in linear memory; result lifetime model value `1` means low-level core
results are valid in caller-provided buffers until the host overwrites those
buffers or grows memory. The generated JavaScript adapter copies source text
into Wasm memory as UTF-16 code units, so all public spans are UTF-16 offsets
matching the TypeScript target. The adapter also exports trace status constants,
and `parseTrace()` failure results include both `statusKind` and `failureKind`
while retaining the older `internal`/`limit` booleans. Parse and lex results
remain ordinary JavaScript objects. Low-level typed-array views returned by
`wasm.ts` helpers are tied to the current `WebAssembly.Memory` buffer.
`WasmSourceBuffer` values returned by `writeSource()` and `ParseTraceInput`
values returned by `createParseTraceInput()` are adapter-owned capabilities:
they are not forgeable or serializable. The adapter handle capability model
value `1` means those JavaScript capabilities are epoch-checked.
`WasmSourceBuffer` values become stale after `reset()` or after `writeSource()`
installs a different source; `ParseTraceInput` values become stale after
`reset()`. Call `writeSource()` or `createParseTraceInput()` again to obtain a
current handle before using `lexOne()`, `lexAll()`, or `parseTrace()`. Repeated
parses reuse memory up to the previous high-water mark, and adapter-side offset
arithmetic is checked against the 32-bit Wasm address space. The core module
declares a maximum of 65,535 Wasm pages; the adapter checks the same page limit
before calling `memory.grow()`.

Internally, standalone parser targets lower the analyzed grammar once into a
versioned portable parser plan:

```ts
{
  format: "baba-parser-plan",
  version: 1,
  semantics: "baba-portable-v1"
}
```

That plan contains the deterministic lexer DFA, BNF productions and reducers, LR
ACTION/GOTO tables, token/literal metadata, and CST field schema consumed by the
TypeScript, Wasm, and parser-kit planning paths. It is separate from Baba's
package version, metadata schema version, parser-kit schema version, and Wasm
adapter ABI version. Generated TypeScript, generated Wasm adapters, and
parser-kit JSON all expose the same `parserPlanHash` or `portablePlan.hash` when
they were built from the same portable parser plan.

Generated TypeScript, generated Wasm adapters, and parser-kit JSON also expose a
runtime implementation identity with format `"baba-runtime-implementation"`,
version `1`, semantics `"baba-runtime-portable-v1"`, and an aggregate source
hash. This verifies that outputs were packaged against the same checked-in
runtime source family and checked runtime-language artifact manifest.
Deterministic TypeScript parser control flow now uses a runtime-language
`parserTrace` helper, and generated TypeScript lexer candidate selection uses
runtime-language `lexerScan*` helpers, but this identity is not yet a claim that
the full TypeScript and Wasm parser runtimes were compiled from one
runtime-language source; that remains the next runtime compiler boundary.

The initial private runtime-language semantics are documented in
`docs/runtime-language.md`. Its Stage-0 executable subset currently covers
32-bit scalar control, table helpers, growable scratch memory, and deterministic
lexer-scan/parser-trace, parser expected-range, and parser production-metadata
and action-decode conformance. The Stage-0 compiler lowers validated
runtime-language programs to one resolved control-flow/value IR before the
TypeScript and Wasm backends emit target artifacts; target-specific source/byte
emission is still separate.

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

`--meta` is an alias for `--metadata`. `--ts-meta` remains as a deprecated
alias.

Select and configure parser-runtime targets:

```sh
deno x --allow-read --allow-write jsr:@mewhhaha/baba/cli grammar.ebnf \
  --target all \
  --typescript-dir ts \
  --wasm-dir wasm \
  --discard-trivia \
  --lexer-state-limit 50000 \
  --regex-ast-node-limit 100000 \
  --regex-bounded-repeat-limit 10000 \
  --regex-nfa-state-limit 100000 \
  --regex-dfa-state-limit 50000 \
  --regex-overlap-state-limit 250000 \
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
`--regex-ast-node-limit`, `--regex-bounded-repeat-limit`,
`--regex-nfa-state-limit`, `--regex-dfa-state-limit`,
`--regex-overlap-state-limit`, `--parser-state-limit`, `--parser-item-limit`,
and `--parser-table-entry-limit` apply to the TypeScript, Wasm, and kit
parser-runtime planning path. Regex limit diagnostics identify the compiler
phase, for example `TS_REGEX_NFA_STATE_LIMIT`, `TS_REGEX_DFA_STATE_LIMIT`,
`TS_REGEX_OVERLAP_WORK_LIMIT`, `TS_REGEX_AST_NODE_LIMIT`, or
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
  --generated-byte-limit 1000000 \
  --parser-stats
```

`--generated-byte-limit` and `--parser-stats` only inspect the generated
TypeScript target output.

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
  "version": 1,
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
  "version": 1,
  "parser": {
    "resolutions": [
      {
        "rules": ["generic_expression", "qualified_identifier"],
        "on": "[",
        "prefer": "shift"
      }
    ],
    "conflicts": [
      ["tuple_type", "type_atom"],
      ["unit_type", "type_atom"]
    ]
  }
}
```

`resolutions` keep the generated LR table deterministic by selecting either a
`shift` or `reduce` action when the listed rules and optional terminal are
involved. For reduce/reduce conflicts, add `reduce` with the rule or expression
text that should win. When generation reports an LR conflict, the diagnostic
includes candidate `resolutions` metadata shaped for the conflicting rules and
lookahead token. It also includes a conflict witness prefix: a short token
sequence that reaches the conflicted parser state, followed by the conflicting
lookahead as the final symbol.

`conflicts` declares local grammar ambiguities that the generated TypeScript and
Wasm parsers may explore with bounded branch search. This is useful for grammars
that need Tree-sitter-like conflict handling but still want standalone parser
runtimes. The Wasm target traces declared conflict branches inside its generated
Wasm parser engine and replays the successful action trace in TypeScript to
build the CST. Shift/reduce diagnostics with multiple rule origins also suggest
a matching `conflicts` entry when branch search is the intended policy.

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
  "version": 1,
  "externals": ["INDENT", "DEDENT", "NEWLINE"]
}
```

The generated `grammar.js` declares those symbols in `externals`; the scanner
implementation remains user-owned.

## Stability

The versioned metadata schema is `version: 1`. It uses explicit EBNF fields
rather than positional expression paths, so grammar edits do not silently
retarget field metadata.

## Development

```sh
deno fmt --check
deno lint
deno task check
deno task test
deno test --allow-read --allow-write tests/runtime_language_test.ts
deno task bench:wasm -- --samples 5
deno task publish:dry-run
```

Use the bootstrap tasks to keep checked-in generated examples reproducible:

```sh
deno task bootstrap:check
deno task bootstrap
```

`bootstrap:check` regenerates the Baba-owned files for the checked-in examples
into a temporary directory and byte-compares them with `examples/*/generated`.
`bootstrap` rewrites those generated files through Baba's manifest-aware
`applyBundle()` path. These tasks cover the current Stage-0 generated runtime
artifacts and verify the checked-in runtime implementation source manifest. They
also verify the Stage-0 runtime-language compiler source manifest and checked
runtime-language helper artifact hashes so compiler drift is tracked
independently from generated parser runtime identity.
