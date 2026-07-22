# Metadata

Status: current metadata guide.

Baba metadata is optional JSON loaded next to a grammar or passed through the
CLI. It controls standalone parser conflict policy, Tree-sitter grammar shaping,
and editor query fragments without changing the grammar language itself.

## Versioning

Metadata files should declare:

```json
{
  "version": 2
}
```

Omitting `version` uses the current schema. Explicit schema version `1` is no
longer accepted. Schema version `2` is the current stable metadata schema.
Additive fields may be accepted in compatible releases; incompatible selector or
default changes need a new schema version or a documented breaking release.

## Portable Runtime Metadata

The Wasm target consumes the portable parser plan. Metadata that affects parser
semantics must lower into that plan deterministically. External scanner metadata
is rejected at the metadata boundary rather than silently changing runtime
semantics.

Tree-sitter grammar metadata affects only `grammar.js`; it does not change Wasm
runtime behavior. External scanner metadata remains unsupported. Use contextual
tokens for syntax-sensitive lexing and account for the target-specific trailing
guard limitation described in the grammar guide.

### Parser Conflict Policy

The optional `parser` block controls standalone parser conflict handling:

```json
{
  "version": 2,
  "parser": {
    "resolutions": [
      { "conflict": "c_91a8...", "prefer": "shift" }
    ],
    "conflicts": [
      { "conflict": "c_ef90..." }
    ]
  }
}
```

`resolutions` make a conflict deterministic. `conflicts` declares a conflict
that may be explored with bounded branch search. Stable conflict IDs reported by
diagnostics are required selectors for both fields.

## Tree-sitter Grammar Metadata

Select `--target tree-sitter` to emit `grammar.js` and non-empty
`queries/generated-*.scm` files. Select `--target all` to emit these alongside
the Wasm bundle.

Tree-sitter-only declarations live at the metadata root:

```json
{
  "version": 2,
  "extras": [{ "kind": "regex", "value": "[ \\t\\r\\n]+" }],
  "word": "identifier",
  "supertypes": ["expression"],
  "conflicts": [["expression", "application"]],
  "inline": ["hidden_name"],
  "rules": {
    "application": {
      "wrap": { "kind": "prec.left", "value": 4 },
      "paths": {
        "function": { "alias_ref": "function_name" }
      }
    },
    "hidden_name": {
      "paths": { "": { "hidden_path": true } }
    }
  }
}
```

`conflicts` is Tree-sitter's named rule-group declaration; it is distinct from
the stable conflict IDs under `parser.conflicts`. Baba token `priority` becomes
Tree-sitter lexical precedence. Rule `wrap` and path `wrap` accept `prec`,
`prec.left`, and `prec.right`. Path selectors use field names from the Baba
grammar and can add a field, alias a reference, create a named alias node,
inline a referenced rule, or hide it. An empty path selects the rule root;
root-level `hidden_path` emits that rule through Tree-sitter's `inline` list.

Grammar `skip` declarations are emitted as Tree-sitter extras automatically. The
root-level `extras` array adds regex or rule extras beyond those declarations.
`word`, `supertypes`, `conflicts`, `inline`, and `rules` are validated against
the analyzed grammar before `grammar.js` is emitted.

## Compatibility

Consumers should treat metadata as user-authored input. Invalid metadata should
produce structured diagnostics, and generated targets should not depend on
private metadata object shapes after analysis has built the portable plan.
