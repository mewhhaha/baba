import { compile, parseMetadata } from "../src/mod.ts";
import { createParser } from "../src/runtime/generated_wasm.ts";
import type {
  IncrementalLexDocument,
  IncrementalParseDocument,
  IncrementalValidateDocument,
  ParserInstance,
} from "../src/runtime/generated_wasm.ts";

const warmups = 8;
const samples = 40;
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
}

function operations(parser: ParserInstance): Operation[] {
  const parsed = parser.createDocument(source, { goal: "parse" });
  const validated = parser.createDocument(source, { goal: "validate" });
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
  ): void {
    document.applyEdits([{ start: editAt, oldEnd: editAt, newText: " " }]);
    document.applyEdits([{ start: editAt, oldEnd: editAt + 1, newText: "" }]);
    if (document.snapshot.text() !== source) {
      throw new Error("Incremental benchmark changed the source.");
    }
    if (document.goal !== "lex" && !document.validate().ok) {
      throw new Error("Incremental benchmark returned invalid source.");
    }
  }
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
      name: "incremental validate insert+remove",
      codeUnits: source.length,
      run: () => update(validated),
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
  ];
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
if (Deno.args.length !== 0) {
  if (Deno.args.length !== 2 || Deno.args[0] !== "--before-root") {
    throw new Error("Usage: document_bench.ts [--before-root PROJECT]");
  }
  const cwd = new URL("file:///");
  cwd.pathname = `${Deno.cwd()}/`;
  const previousRoot = new URL(`${Deno.args[1]}/`, cwd);
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
      times[target].sort((left, right) => left - right);
      console.log(JSON.stringify({
        target: targets[target].name,
        operation: workloads[target][operation].name,
        codeUnits: workloads[target][operation].codeUnits,
        p25Ms: times[target][Math.floor(samples / 4)],
        medianMs: times[target][Math.floor(samples / 2)],
      }));
    }
  }
} finally {
  for (const target of targets) target.parser.dispose();
}
