# GPU Duck Example

GPU Duck is a deliberately constrained Duck-like grammar whose concrete syntax
is suitable for parallel structural parsing:

- every declaration and binding has an explicit `;` terminator;
- `declare operators` places fixities in one bounded header section;
- expressions are flat operand/operator chains rather than recursive precedence
  trees;
- an optional `sig identity = a -> a;` is designed to constrain the separately
  inferred `let identity = value => value;`, while definitions such as
  `let inferred = identity 42;` need no signature;
- `name = value;` is intended to update an existing local without changing its
  type, while `name := value;` is intended to create a shadow binding whose
  inferred type may change;
- `interface Name Roles = { ... };` gives Binned's structural `duck` contracts
  an explicit declaration form; the iterator examples include associated types
  and multiple method requirements adapted from Binned's prelude;
- `struct {...}`, `extend (Type, {...})`, interfaces, and value shapes share
  semicolon-terminated member blocks; their contexts determine whether a type
  member is abstract, defined, or unavailable;
- `struct` and `extend` show const-bound source definitions adapted from
  Binned's prelude: `struct` iterates over its ordered shape while `extend`
  delegates one complete additions shape to the atomic `@type.extend` primitive;
- type declarations deliberately accept ordinary expressions because types are
  intended to be compile-time values rather than a closed type-only sublanguage;
- integer, string, and constructor literals denote singleton types, and `|`
  forms their union; matching a literal pattern is intended to narrow the
  corresponding union branch;
- union syntax in signatures and source-defined `|` expressions in type
  declarations must normalize to the same semantic union representation before
  inference or matching;
- ranges are intended to include both endpoints and require values from one
  ordered domain; `@type.unbounded` is valid as an open upper endpoint;
- the sample defines `I32` as the inclusive signed 32-bit integer range and
  `String` as all finite Unicode scalar-value sequences ordered
  lexicographically by scalar numeric value from `""` to `@type.unbounded`; a
  proper prefix sorts before its extension;
- `=>` reclassifies one preceding value-shaped form as a parameter pattern;
  semantic analysis is intended to reject heads that are not valid identifier,
  tuple, array, unit, constructor, wildcard, or nested patterns;
- `case ... of ... end`, `do ... end`, and `if ... else if ... else ... end`
  give every variable-sized region explicit boundaries;
- `let`, `const`, `interface`, `effect`, `comptime`, unions, and source-defined
  struct construction cover the representative Duck declaration and evaluation
  forms;
- unary calls use juxtaposition; because trivia is skipped, `x(a, b)` and
  `x (a, b)` both apply `x` to one tuple rather than forming an argument list;
- repeated juxtaposition is left-associative, so `f x y` means `(f x) y`, two
  unary applications represented as one flat argument sequence;
- `[Type; N]` and `(Type; N)` are intended to repeat a type when `N` evaluates
  at compile time to a non-negative integer;
- each spread in `[Head, ...Tail]` or `(Head, ...Tail)` must evaluate to a type
  sequence; multiple and interleaved spreads are intended to expand
  left-to-right at their written positions;
- bracket values are therefore application arguments rather than postfix
  indexing; indexing is expressed as an ordinary unary call such as
  `get (values, index)`;
- templates and whitespace-sensitive distinctions are omitted until the WebGPU
  lexer supports modes and a parallel parser can classify those islands.

The grammar opts into the version-3 GPU frontend profile. Generation proves
state-free terminal identity, compiles its declared islands into deterministic
transducers, and stores boundary, semantic-recipe, primitive, operator, and
capacity tables in `parser.plan`. The shared CPU transducer interpreter is the
byte-parity oracle. The WebGPU session executes lexing, delimiter matching,
island transducers, and flat token/node/edge allocation on the device. Semantic
recipes currently validate the read-back flat IR on the host.

## Run It

From this directory, generate the parser:

```sh
deno task generate
```

Run with a hardware WebGPU adapter:

```sh
WGPU_BACKENDS=vulkan WGPU_POWER_PREF=high deno task run
```

This executes lexing, delimiter matching, island parsing, and compact IR
allocation through `WebGpuFrontend`.

Software adapters are rejected unless explicitly requested:

```sh
deno task run:fallback
```

Run the same source through the ordinary Wasm lexer and parser:

```sh
deno task cpu
```

The example program keeps fixities source-defined for a fixed operator set while
placing them before all executable declarations. The GPU frontend loads that
small table once, segments statements at `;`, parses each flat expression chain
independently, and merges the explicitly delimited structures.
