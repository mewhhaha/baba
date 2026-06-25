# Baba Runtime Language v1

BRL is Baba's private implementation language for portable lexer and parser
runtime logic. It is not user-facing and has no host access.

## Source

Source text is UTF-8 decoded to Unicode scalar values. Source spans use UTF-16
code-unit offsets when reported through generated runtime APIs, and compiler
diagnostics use zero-based offsets plus one-based line and column.

Whitespace separates tokens and is otherwise insignificant. Line comments start
with `//` and continue to the next line. Block comments are not part of v1.

Identifiers match `[A-Za-z_][A-Za-z0-9_]*`. Keywords are:

```text
as bool break continue else enum false fn for if import in let record return
span true u8 u16 u32 i32 variant vec while
```

Integer literals are decimal or hexadecimal (`0x...`) and have no sign. A unary
minus is an operator, not part of the literal.

## Types

Scalar types are `bool`, `u8`, `u16`, `u32`, and `i32`.

Aggregate types are:

- records with fixed named fields;
- closed variants/enums with fixed constructors;
- fixed arrays `[T; N]`;
- immutable spans `span<T>`;
- growable vectors `vec<T>`.

Records and variants have abstract layout. Backends may choose different
physical representations, but observable field order, constructor IDs, and
diagnostics must be deterministic.

Spans never own storage. Vectors own storage until the program reset point.
Vector growth may fail with a structured capacity error; it must not silently
wrap or corrupt memory.

## Modules

A module is a sequence of imports and declarations. Import paths are string-free
identifier paths resolved by the compiler. Multiple source files, when used,
are ordered by normalized module path and then declaration order.

Name lookup is lexical for locals and module-scoped for declarations. Parameters
and locals may not shadow another parameter/local in the same function. Local
names may shadow module declarations only where the syntax requires an
expression name; type names remain resolved in type namespace. Duplicate module
declarations are errors.

## Expressions

Function arguments evaluate left-to-right. Operators evaluate left operand then
right operand. Unary `!` evaluates its operand and returns boolean negation.
Field access evaluates its receiver first. Indexing evaluates the receiver then
the index. Record literals use `record Name { field: value }`, evaluate fields
in declaration order, and require exactly one value for every declared field.
`&&` and `||` are eager boolean operators; they do not short-circuit.

Boolean values are abstract `false` and `true`; backends may lower them to `0`
and `1`.

Unsigned arithmetic wraps modulo `2^N` for the destination width. `i32`
arithmetic wraps modulo `2^32` and is interpreted as two's-complement for signed
comparisons. Division or remainder by zero traps. Shift counts greater than or
equal to the bit width trap. Out-of-bounds indexing traps.

Casts are explicit. Widening integer casts are legal. Narrowing integer casts
truncate modulo the destination width. `bool` may cast to integer (`false = 0`,
`true = 1`). Integer to `bool` is legal and yields false only for zero. Aggregate
casts are illegal.

## Statements

Variables must be initialized before use. Assignment requires an existing
mutable local and an exactly matching checked type. `if` and `while` conditions
must be `bool`. `break` and `continue` are valid only inside loops. Every
non-void function must return along all reachable paths. Unreachable code is a
diagnostic; backends may omit it after verification.

BRL has no exceptions, async execution, closures, dynamic dispatch, reflection,
macros, arbitrary FFI, threads, filesystem, network, environment, clock, random
access, garbage collection, or implicit host allocation.

## Runtime Behavior

Runtime programs may trap for programmer errors: division by zero, excessive
shift count, bounds violations, invalid variant field access, and verifier
impossible states. Recoverable parser outcomes are structured results, not
traps.

Allocation uses explicit arenas or vectors. Reset lifetime is explicit and
owned by the generated adapter/runtime boundary.

## Determinism

Compilation is deterministic. IDs for modules, declarations, fields, locals,
blocks, and IR values are assigned by normalized module order and source order.
Diagnostics are sorted by source span then diagnostic code. No backend-specific
operation name may appear in generic BRL semantics or IR.

## Stage-0 Bootstrap

The v1 source parser is handwritten and checked in under `src/runtime_language`.
`grammar.ebnf` is the normative grammar for later generated bootstrap work; the
handwritten parser is the Stage-0 implementation. Drift is checked by
`deno task bootstrap:check`, which verifies the runtime-language compiler
source manifest and the checked TypeScript/Wasm helper artifact manifest before
it compares regenerated example outputs.
