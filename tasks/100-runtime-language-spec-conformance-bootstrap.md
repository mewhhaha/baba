# Task 100: Runtime-Language Spec, Conformance, And Bootstrap

## Goal

Finish FEEDBACK P1.13, P1.14, and P1.15. The private runtime language needs a
formal enough spec, conformance tests across TypeScript/Wasm backends, and
deterministic bootstrap checks.

## Files To Inspect

- `docs/runtime-language.md`
- `src/targets/runtime/language.ts`
- `src/targets/runtime/language_sources.ts`
- `src/targets/runtime/language_manifest.ts`
- `src/targets/runtime/language_artifacts.ts`
- `scripts/bootstrap_check.ts`
- `tests/runtime_language_test.ts`

## Search Commands

```sh
rg -n "overflow|division|shift|bounds|evaluation|left-to-right|trap|RuntimeLanguageIr|bootstrap|artifact manifest|conformance" docs src/targets/runtime tests scripts
```

## Work

1. Document semantics for integer widths, signedness, overflow, division by
   zero, shifts, bounds checks, evaluation order, booleans, records, arrays,
   vectors, text, allocation lifetime, and traps.
2. Add conformance programs for each documented rule.
3. Ensure each program compiles to TypeScript and Wasm and compares return
   values or traps.
4. Ensure `deno task bootstrap:check` verifies compiler source hashes,
   runtime-language artifacts, generated examples, and embedded versions.

## Acceptance

```sh
deno test -A tests/runtime_language_test.ts
deno task bootstrap:check
```

`docs/runtime-language.md` must not describe semantics that lack tests, unless
the doc explicitly marks them future/unsupported.

## Do Not Touch

- Do not make self-hosting a goal.
- Do not add a second runtime-language IR path.
