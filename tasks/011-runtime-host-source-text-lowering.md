# Task 011: Runtime Host Source Text Lowering

## Goal

Move remaining host source-text boundary decisions toward runtime-language
helpers. This addresses the unresolved FEEDBACK note that host source-text
handles are not fully lowered into runtime-language text handles.

## Files To Inspect

- `src/targets/runtime/public_source_text.ts`
- `src/targets/runtime/typescript_lexer_runtime.ts`
- `src/targets/runtime/typescript_parser_runtime.ts`
- `src/targets/runtime/language_sources.ts`
- `docs/runtime-language.md`
- `tests/runtime_language_test.ts`
- `tests/runtime_plan_test.ts`

## Search Commands

```sh
rg -n "SourceTextBoundary|sourceText|source\\.length|slice|codePoint|charCodeAt|utf16CodePoint|publicSource" src/targets/runtime src/targets/typescript tests
```

## Work

1. Identify one host source-text decision still made directly in generated
   TypeScript.
2. Add a runtime-language helper only for numeric/string-unit logic. Keep actual
   JavaScript string access at the host boundary unless the runtime language
   already supports that exact representation.
3. Add conformance coverage for non-BMP, NUL, U+2028/U+2029, CRLF, and combining
   marks if the helper touches offsets or code-unit width.
4. Update docs to state exactly which part remains host-owned.

## Acceptance

- New helper has TypeScript/Wasm conformance coverage.
- UTF-16 span semantics remain unchanged.
- Existing Unicode tests still pass.
- Focused checks:

```sh
deno test -A tests/runtime_language_test.ts tests/lexer_test.ts tests/wasm_test.ts
deno test -A tests/ts_wasm_parity_test.ts
```

## Do Not Touch

- Do not switch to UTF-8 in this task.
- Do not alter public span units.
- Do not change parser-kit JSON schema.
