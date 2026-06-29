# T02 - Grammar IR, analysis, and diagnostics

Priority: P0

Depends on: T01

## Goal

Lower grammar v2 syntax into a target-neutral analyzed grammar model and report
actionable author diagnostics before code generation.

## Scope

Build the v2 `AnalyzedGrammar` contract. It should contain:

- stable IDs for tokens, trivia, modes, contextual tokens, literals, rules,
  expression islands, AST constructors, fields, modules, and exports;
- resolved references;
- reachable symbols from selected roots;
- nullability and productivity facts;
- FIRST/FOLLOW sets where useful;
- rule-to-production lowering metadata;
- expression island metadata;
- recovery annotations;
- CST schema inputs;
- AST schema inputs;
- extension-point metadata;
- source spans and related locations.

Diagnostics must cover:

- duplicate declarations;
- unknown references;
- unreachable rules;
- unused tokens;
- nonproductive rules;
- empty-only rules;
- nullable loops;
- direct and indirect left recursion where the selected parser strategy cannot
  handle it;
- FIRST/FOLLOW conflicts for LL-like generated paths;
- LR shift/reduce and reduce/reduce conflicts;
- token shadowing;
- token overlap and contextual token requirements;
- precedence holes or duplicate precedence declarations;
- invalid AST constructor fields;
- invalid sync declarations;
- invalid grammar module exports or extensions.

## Parser-strategy diagnostics

Left recursion diagnostics must be deterministic for the configured strategy.

| Strategy | Direct left recursion | Indirect left recursion | Diagnostic policy |
|---|---|---|---|
| LR(1) or IELR structure rules | allowed | allowed | no left-recursion diagnostic unless the cycle is nullable/nonproductive |
| Pratt expression island | disallowed in atom/base rule | disallowed through atom/base rule | report `EXPR_LEFT_RECURSION` with the cycle |
| generated recursive descent helper, if any | disallowed | disallowed | report `RD_LEFT_RECURSION` with the cycle |
| bounded branch ambiguity mode | allowed only after LR table construction succeeds | allowed only after LR table construction succeeds | report normal LR conflicts or branch-limit risks, not generic left recursion |

Example invalid Pratt base:

```ebnf
expr = atom {
  infix left 10 "+"
}

atom =
    expr "." Ident -> Member(expr, Ident)
  | Ident
;
```

Expected diagnostic payload:

```json
{
  "code": "EXPR_LEFT_RECURSION",
  "rule": "atom",
  "cycle": ["atom", "expr", "atom"]
}
```

## Conflict explanations

Where practical, diagnostics should include a minimal witness string or a
grammar-shaped explanation.

Example:

```text
Conflict in rule stmt:

  "if" expr stmt "else" stmt
  "if" expr stmt

Input causing ambiguity:
  if a if b x else y

Hint:
  prefer shift "else"
```

Witness generation can start best-effort. Stable diagnostic codes and spans are
more important than perfect examples in the first version.

## Example analyzed output

For this grammar:

```ebnf
token Ident = /[_\p{L}][_\p{L}\p{N}]*/ ;
token Let = "let" ;

module = items:item* EOF -> Module(items) ;
item = "let" name:Ident "=" value:expr ";" -> Let(name, value) ;
```

analysis should lower it into stable, target-neutral facts:

```json
{
  "tokens": [
    { "id": 0, "name": "Ident", "kind": "regex" },
    { "id": 1, "name": "Let", "kind": "literal", "text": "let" }
  ],
  "rules": [
    { "id": 0, "name": "module", "nullable": false, "productive": true },
    { "id": 1, "name": "item", "nullable": false, "productive": true }
  ],
  "constructors": [
    { "id": 0, "name": "Module", "fields": ["items"] },
    { "id": 1, "name": "Let", "fields": ["name", "value"] }
  ]
}
```

For token overlap, diagnostics should distinguish intentional priority from
unreachable rules:

```text
LEX001 token shadowing
  token Let = "let"
  token Ident = /[a-z]+/
  "let" is matched by both rules; Let wins by priority.
```

## Deliverables

- v2 analyzed grammar types.
- lowering from grammar v2 AST to analyzed grammar.
- analysis passes for the diagnostics listed above.
- stable diagnostic code list and payload shapes.
- test fixtures for each diagnostic family.

## Acceptance criteria

- Analysis is deterministic: the same grammar produces stable IDs and stable
  diagnostic ordering.
- Fatal errors do not prevent independent diagnostics from being reported.
- Diagnostics include source spans and related spans for multi-site issues.
- Token overlap diagnostics distinguish safe priority, unsafe shadowing, and
  parser-contextual cases.
- Analysis can run without choosing a target backend.

## Verification harness

Run:

```sh
deno test --allow-read tests/grammar_v2_analysis_test.ts
deno test --allow-read tests/grammar_v2_diagnostics_test.ts
deno task check
```

Add fixture-driven tests where each invalid grammar asserts stable diagnostic
codes and relevant payloads, not English message text.

## Out of scope

- Executing the lexer or parser.
- Emitting target-specific files.
- Incremental parsing.
