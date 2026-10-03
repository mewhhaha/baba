import { compile, parseMetadata } from "../src/mod.ts";
import { createParser } from "../src/runtime/generated_wasm.ts";
import type {
  IncrementalLexDocument,
  IncrementalParseDocument,
  IncrementalValidateDocument,
  ParserInstance,
  RuleCursor,
} from "../src/runtime/generated_wasm.ts";

let warmups = 8;
let samples = 40;
let beforeRoot: string | undefined;
for (let index = 0; index < Deno.args.length; index += 2) {
  const flag = Deno.args[index];
  const value = Deno.args[index + 1];
  if (value === undefined) {
    throw new Error(`Missing value for ${flag}.`);
  }
  if (flag === "--before-root") {
    beforeRoot = value;
  } else if (flag === "--warmups" || flag === "--samples") {
    const count = Number(value);
    if (!Number.isSafeInteger(count) || count < 4) {
      throw new Error(`${flag} must be an integer of at least 4.`);
    }
    if (flag === "--warmups") warmups = count;
    else samples = count;
  } else {
    throw new Error(
      "Usage: document_bench.ts [--before-root PROJECT] [--warmups COUNT] [--samples COUNT]",
    );
  }
}
const fixture = new URL(
  "../fixtures/perf/wasm/island-statements/",
  import.meta.url,
);
const grammar = await Deno.readTextFile(new URL("grammar.baba", fixture));
const metadata = await Deno.readTextFile(new URL("baba.json", fixture));
const statement = "let value = other;\n";
const source = statement.repeat(Math.ceil(512 * 1024 / statement.length));
const tokenSource = statement.repeat(4096);
const editAt = source.indexOf("\n", Math.floor(source.length / 2));

interface Operation {
  readonly name: string;
  readonly codeUnits: number;
  readonly run: () => void;
  readonly verify?: () => void;
}

function operations(parser: ParserInstance): Operation[] {
  const parsed = parser.createDocument(source, { goal: "parse" });
  const parsedPreserved = parser.createDocument(source, {
    goal: "parse",
    trivia: "preserve",
  });
  const validated = parser.createDocument(source, { goal: "validate" });
  const varied = parser.createDocument(source, { goal: "validate" });
  const preserved = parser.createDocument(source, {
    goal: "lex",
    trivia: "preserve",
  });
  const discarded = parser.createDocument(source, {
    goal: "lex",
    trivia: "discard",
  });
  const lexed = parser.createDocument(tokenSource, {
    goal: "lex",
    trivia: "preserve",
  });
  const traversed = parser.createDocument(tokenSource, { goal: "parse" });
  const traversedStable = parser.createDocument(tokenSource, { goal: "parse" });
  const edits = [];
  for (let index = 0; index < 4096; index += 32) {
    const start = index * statement.length;
    edits.push({ start, oldEnd: start, newText: " " });
  }
  lexed.applyEdits(edits);
  function update(
    document:
      | IncrementalLexDocument
      | IncrementalParseDocument
      | IncrementalValidateDocument,
    offset = editAt,
  ): void {
    document.applyEdits([{ start: offset, oldEnd: offset, newText: " " }]);
    document.applyEdits([{ start: offset, oldEnd: offset + 1, newText: "" }]);
    if (document.snapshot.text() !== source) {
      throw new Error("Incremental benchmark changed the source.");
    }
    if (document.goal !== "lex" && !document.validate().ok) {
      throw new Error("Incremental benchmark returned invalid source.");
    }
  }
  function readCursor(root: RuleCursor): number {
    let textLength = 0;
    for (let index = 0; index < root.childCount; index++) {
      const statement = root.child(index);
      if (statement === undefined || statement.type !== "rule") {
        throw new Error("Cursor traversal benchmark has no statement.");
      }
      for (
        let tokenIndex = 0;
        tokenIndex < statement.childCount;
        tokenIndex++
      ) {
        const token = statement.child(tokenIndex);
        if (token === undefined || token.type !== "token") {
          throw new Error("Cursor traversal benchmark has no token.");
        }
        textLength += token.text.length + token.span.end - token.span.start;
      }
      for (const name of ["name", "value"]) {
        const value = statement.field(name);
        if (
          value === undefined || value === null || !("type" in value) ||
          value.type !== "token"
        ) {
          throw new Error(`Cursor traversal benchmark has no '${name}' field.`);
        }
        textLength += value.text.length;
      }
    }
    return textLength;
  }
  const initial = traversed.parse();
  if (!initial.ok) {
    throw new Error("Cursor traversal benchmark has no initial parse.");
  }
  const expectedTraversal = readCursor(initial.cursor);
  let traversalName = "value";
  let stableTraversalName = "value";
  let variedIndex = 0;
  return [
    {
      name: "incremental parse insert+remove",
      codeUnits: source.length,
      run: () => {
        update(parsed);
        const result = parsed.parse();
        if (!result.ok || result.cursor.span.end !== source.length) {
          throw new Error(
            "Incremental parse benchmark returned an invalid cursor.",
          );
        }
      },
    },
    {
      name: "incremental parse insert+remove, preserved trivia",
      codeUnits: source.length,
      run: () => {
        update(parsedPreserved);
        const result = parsedPreserved.parse();
        if (!result.ok || result.cursor.span.end !== source.length) {
          throw new Error(
            "Preserved-trivia benchmark returned an invalid cursor.",
          );
        }
      },
    },
    {
      name: "incremental validate insert+remove",
      codeUnits: source.length,
      run: () => update(validated),
    },
    {
      name: "incremental validate insert+remove at varied offsets",
      codeUnits: source.length,
      run: () => {
        const statementCount = source.length / statement.length;
        const selected = (variedIndex * 7919) % statementCount;
        variedIndex++;
        update(varied, selected * statement.length + statement.length - 1);
      },
    },
    {
      name: "incremental lex insert+remove, preserved trivia",
      codeUnits: source.length,
      run: () => update(preserved),
    },
    {
      name: "incremental lex insert+remove, discarded trivia",
      codeUnits: source.length,
      run: () => update(discarded),
    },
    {
      name: "edit then first cursor traversal and field reads",
      codeUnits: tokenSource.length,
      run: () => {
        let nextName = "renamed";
        if (traversalName === "renamed") {
          nextName = "value";
        }
        traversed.applyEdits([{
          start: 4,
          oldEnd: 4 + traversalName.length,
          newText: nextName,
        }]);
        traversalName = nextName;
        // The name contributes text and span length as a child, then field text.
        const expected = expectedTraversal + (nextName.length - 5) * 3;
        const result = traversed.parse();
        if (!result.ok || readCursor(result.cursor) !== expected) {
          throw new Error(
            "Cursor traversal benchmark returned invalid text or fields.",
          );
        }
      },
    },
    {
      name: "equal-length edit then first cursor traversal and field reads",
      codeUnits: tokenSource.length,
      run: () => {
        let nextName = "alias";
        if (stableTraversalName === "alias") {
          nextName = "value";
        }
        traversedStable.applyEdits([{
          start: 4,
          oldEnd: 9,
          newText: nextName,
        }]);
        stableTraversalName = nextName;
        const result = traversedStable.parse();
        if (!result.ok || readCursor(result.cursor) !== expectedTraversal) {
          throw new Error(
            "Stable cursor traversal returned invalid text or fields.",
          );
        }
      },
      verify: () => {
        const expected = tokenSource.slice(0, 4) + stableTraversalName +
          tokenSource.slice(9);
        if (traversedStable.snapshot.text() !== expected) {
          throw new Error("Stable cursor traversal changed other source text.");
        }
        traversedStable.dispose();
      },
    },
    {
      name: "first token-text pass after fragmented edits",
      codeUnits: tokenSource.length + edits.length,
      run: () => {
        // A new version drops the prior tape's lazy token cache for every sample.
        lexed.applyEdits([{ start: 0, oldEnd: 1, newText: " " }]);
        const tape = lexed.lex().tokenTape;
        let textLength = 0;
        for (let index = 0; index < tape.length; index++) {
          const token = tape.token(index);
          if (token === undefined) throw new Error(`Missing token ${index}.`);
          textLength += token.text.length;
        }
        if (textLength !== tokenSource.length + edits.length) {
          throw new Error("Token-text benchmark did not reproduce the source.");
        }
      },
    },
    ...sourcePieceOperations(parser, 512 * 1024, "insert"),
    ...sourcePieceOperations(parser, 4 * 1024 * 1024, "insert"),
    ...sourcePieceOperations(parser, 512 * 1024, "replace"),
    ...sourcePieceOperations(parser, 4 * 1024 * 1024, "replace"),
    ...localCursorOperations(parser, 512 * 1024),
    ...localCursorOperations(parser, 4 * 1024 * 1024),
  ];
}

function localCursorOperations(
  parser: ParserInstance,
  size: number,
): Operation[] {
  const source = statement.repeat(Math.ceil(size / statement.length));
  const operations: Operation[] = [];
  for (const trivia of ["discard", "preserve"] as const) {
    for (const equalLength of [true, false]) {
      for (const position of ["first", "middle", "last"] as const) {
        let document: IncrementalParseDocument | undefined;
        let currentName = "value";
        const statementCount = source.length / statement.length;
        let childIndex = 0;
        if (position === "middle") childIndex = Math.floor(statementCount / 2);
        else if (position === "last") childIndex = statementCount - 1;
        let name =
          `rename then ${position} child and name field, ${trivia} trivia`;
        if (equalLength) name += ", equal length";
        else name += ", changed length";
        operations.push({
          name,
          codeUnits: source.length,
          run: () => {
            if (document === undefined) {
              document = parser.createDocument(source, {
                goal: "parse",
                trivia,
                maxParserActions: 4_000_000,
              });
            }
            let nextName = "value";
            if (currentName === "value") {
              nextName = "renamed";
              if (equalLength) nextName = "alias";
            }
            document.applyEdits([{
              start: 4,
              oldEnd: 4 + currentName.length,
              newText: nextName,
            }]);
            currentName = nextName;
            const parsed = document.parse();
            if (!parsed.ok) {
              throw new Error(
                "Local cursor benchmark returned invalid source.",
              );
            }
            const rule = parsed.cursor.child(childIndex);
            if (rule === undefined || rule.type !== "rule") {
              throw new Error(
                "Local cursor benchmark returned no selected child.",
              );
            }
            const value = rule.field("name");
            let expectedName = "value";
            let expectedStart = childIndex * statement.length + 4;
            if (childIndex === 0) expectedName = nextName;
            else expectedStart += nextName.length - 5;
            if (
              value === undefined || value === null || !("type" in value) ||
              value.type !== "token" || value.text !== expectedName ||
              value.span.start !== expectedStart ||
              value.span.end !== expectedStart + expectedName.length
            ) {
              throw new Error(
                "Local cursor benchmark returned an invalid field.",
              );
            }
          },
          verify: () => {
            if (document === undefined) {
              throw new Error(
                "Local cursor benchmark did not create a document.",
              );
            }
            const expected = source.slice(0, 4) + currentName + source.slice(9);
            if (document.snapshot.text() !== expected) {
              throw new Error(
                "Local cursor benchmark changed other source text.",
              );
            }
            document.dispose();
            document = undefined;
          },
        });
      }
    }
  }
  return operations;
}

function sourcePieceOperations(
  parser: ParserInstance,
  size: number,
  editKind: "insert" | "replace",
): Operation[] {
  const statementCount = Math.ceil(size / statement.length);
  const source = statement.repeat(statementCount);
  const operations: Operation[] = [];
  for (const goal of ["lex", "validate", "parse"] as const) {
    for (const varied of [false, true]) {
      if (goal === "lex" && varied) continue;
      let document:
        | IncrementalLexDocument
        | IncrementalValidateDocument
        | IncrementalParseDocument
        | undefined;
      let editIndex = 0;
      let name = `incremental ${goal} insert+remove without full text`;
      if (editKind === "replace") {
        name = `incremental ${goal} name replacement+restore without full text`;
      }
      if (varied) name += ", varied offsets";
      operations.push({
        name,
        codeUnits: source.length,
        run: () => {
          // Create during the first warmup; release after this operation so
          // large documents do not all occupy the heap during measurements.
          if (document === undefined) {
            if (goal === "lex") {
              document = parser.createDocument(source, { goal });
            } else if (goal === "validate") {
              document = parser.createDocument(source, {
                goal,
                maxParserActions: 4_000_000,
              });
            } else {
              document = parser.createDocument(source, {
                goal,
                maxParserActions: 4_000_000,
              });
            }
          }
          let line = Math.floor(statementCount / 2);
          if (varied) line = (editIndex * 7919) % statementCount;
          editIndex++;
          if (editKind === "replace") {
            const start = line * statement.length + 4;
            document.applyEdits([{
              start,
              oldEnd: start + 5,
              newText: "alias",
            }]);
            document.applyEdits([{
              start,
              oldEnd: start + 5,
              newText: "value",
            }]);
          } else {
            const start = line * statement.length + statement.length - 1;
            document.applyEdits([{ start, oldEnd: start, newText: " " }]);
            document.applyEdits([{ start, oldEnd: start + 1, newText: "" }]);
          }
          if (document.snapshot.length !== source.length) {
            throw new Error("Source-piece benchmark changed source length.");
          }
          if (document.goal !== "lex" && !document.validate().ok) {
            throw new Error("Source-piece benchmark returned invalid source.");
          }
          if (document.goal === "parse") {
            const result = document.parse();
            if (!result.ok || result.cursor.span.end !== source.length) {
              throw new Error(
                "Source-piece benchmark returned an invalid cursor.",
              );
            }
          }
        },
        verify: () => {
          if (document === undefined) {
            throw new Error(
              "Source-piece benchmark did not create a document.",
            );
          }
          // Full text is verified outside the measured update path.
          if (document.snapshot.text() !== source) {
            throw new Error("Source-piece benchmark changed source text.");
          }
          document.dispose();
          document = undefined;
        },
      });
    }
  }
  return operations;
}

function parserFrom(
  compiler: typeof compile,
  metadataParser: typeof parseMetadata,
  factory: typeof createParser,
): ParserInstance {
  const built = compiler(grammar, {
    targets: ["wasm"],
    metadata: metadataParser(metadata),
  });
  if (built.bundle === undefined) {
    throw new Error(JSON.stringify(built.diagnostics));
  }
  const wasm = built.bundle.files.find((file) =>
    file.path === "wasm/parser.wasm"
  );
  const plan = built.bundle.files.find((file) =>
    file.path === "wasm/parser.plan"
  );
  if (
    wasm === undefined || wasm.encoding !== "binary" || plan === undefined ||
    plan.encoding !== "binary"
  ) {
    throw new Error("Document benchmark fixture has no Wasm runtime or plan.");
  }
  return factory({ bytes: wasm.content, plan: plan.content });
}

const targets = [{
  name: "current",
  parser: parserFrom(compile, parseMetadata, createParser),
}];
if (beforeRoot !== undefined) {
  const cwd = new URL("file:///");
  cwd.pathname = `${Deno.cwd()}/`;
  const previousRoot = new URL(`${beforeRoot}/`, cwd);
  const previousCompiler = await import(
    new URL("src/mod.ts", previousRoot).href
  ) as typeof import("../src/mod.ts");
  const previousRuntime = await import(
    new URL("src/runtime/generated_wasm.ts", previousRoot).href
  ) as typeof import("../src/runtime/generated_wasm.ts");
  targets.unshift({
    name: "before",
    parser: parserFrom(
      previousCompiler.compile,
      previousCompiler.parseMetadata,
      previousRuntime.createParser,
    ),
  });
}

try {
  const workloads = targets.map((target) => operations(target.parser));
  console.log(
    JSON.stringify({
      deno: Deno.version.deno,
      v8: Deno.version.v8,
      warmups,
      samples,
      fragmentedInsertions: 128,
    }),
  );
  for (let operation = 0; operation < workloads[0].length; operation++) {
    const times = targets.map(() => [] as number[]);
    for (let warmup = 0; warmup < warmups; warmup++) {
      for (const workload of workloads) workload[operation].run();
    }
    for (let sample = 0; sample < samples; sample++) {
      let order = targets.map((_, index) => index);
      if (sample % 2 !== 0) order = order.reverse();
      for (const target of order) {
        const started = performance.now();
        workloads[target][operation].run();
        times[target].push(performance.now() - started);
      }
    }
    for (let target = 0; target < targets.length; target++) {
      const verify = workloads[target][operation].verify;
      if (verify !== undefined) verify();
      times[target].sort((left, right) => left - right);
      console.log(JSON.stringify({
        target: targets[target].name,
        operation: workloads[target][operation].name,
        codeUnits: workloads[target][operation].codeUnits,
        p25Ms: times[target][Math.floor(samples / 4)],
        medianMs: times[target][Math.floor(samples / 2)],
        p95Ms: times[target][Math.floor(samples * 0.95)],
      }));
    }
  }
} finally {
  for (const target of targets) target.parser.dispose();
}
