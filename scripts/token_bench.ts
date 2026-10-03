import { compile, parseMetadata } from "../src/mod.ts";
import { createParser } from "../src/runtime/generated_wasm.ts";
import type {
  LexTapeResult,
  ParserInstance,
  RuleCursor,
} from "../src/runtime/generated_wasm.ts";

let beforeRoot: string | undefined;
let warmups = 12;
let samples = 50;
for (let index = 0; index < Deno.args.length; index += 2) {
  const flag = Deno.args[index];
  const value = Deno.args[index + 1];
  if (value === undefined) throw new Error(`Missing value for ${flag}.`);
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
      "Usage: token_bench.ts [--before-root PROJECT] [--warmups COUNT] [--samples COUNT]",
    );
  }
}

const fixture = new URL(
  "../fixtures/perf/wasm/island-statements/",
  import.meta.url,
);
const grammar = await Deno.readTextFile(new URL("grammar.baba", fixture));
const metadata = await Deno.readTextFile(new URL("baba.json", fixture));

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
    wasm === undefined || wasm.encoding !== "binary" ||
    plan === undefined || plan.encoding !== "binary"
  ) {
    throw new Error("Token benchmark has no Wasm runtime or plan.");
  }
  return factory({ bytes: wasm.content, plan: plan.content });
}

function readCursor(root: RuleCursor, text: boolean): number {
  let checksum = 0;
  for (let index = 0; index < root.childCount; index++) {
    const rule = root.child(index);
    if (rule === undefined || rule.type !== "rule") {
      throw new Error("Cursor benchmark has no statement.");
    }
    for (let child = 0; child < rule.childCount; child++) {
      const token = rule.child(child);
      if (token === undefined || token.type !== "token") {
        throw new Error("Cursor benchmark has no token.");
      }
      checksum += token.span.end - token.span.start;
      if (text) checksum += token.text.length;
    }
    if (text) {
      for (const name of ["name", "value"]) {
        const value = rule.field(name);
        if (
          value === undefined || value === null || !("type" in value) ||
          value.type !== "token"
        ) {
          throw new Error(`Cursor benchmark has no '${name}' field.`);
        }
        checksum += value.text.length;
      }
    }
  }
  return checksum;
}

interface Operation {
  readonly name: string;
  readonly run: () => void;
}

function operations(parser: ParserInstance, source: string): Operation[] {
  const count = source.length / "let value = other;\n".length;
  const operations: Operation[] = [];
  for (
    const mode of [
      "parse only",
      "first spans",
      "first text and fields",
      "cached text and fields",
    ]
  ) {
    let cached: RuleCursor | undefined;
    operations.push({
      name: `cursor: ${mode}`,
      run: () => {
        let root: RuleCursor;
        if (mode === "cached text and fields" && cached !== undefined) {
          root = cached;
        } else {
          const parsed = parser.parse(source, { preserveTrivia: false });
          if (!parsed.ok || parsed.cursor.span.end !== source.length) {
            throw new Error("Cursor benchmark returned invalid source.");
          }
          root = parsed.cursor;
          if (mode === "cached text and fields") cached = root;
        }
        if (mode === "parse only") return;
        let text = true;
        let expected = count * 40;
        if (mode === "first spans") {
          text = false;
          expected = count * 15;
        }
        if (readCursor(root, text) !== expected) {
          throw new Error("Cursor benchmark returned invalid spans or text.");
        }
      },
    });
  }
  for (const mode of ["lex only", "first spans", "first text", "cached text"]) {
    let cached: LexTapeResult | undefined;
    operations.push({
      name: `lexer: ${mode}`,
      run: () => {
        let result: LexTapeResult;
        if (mode === "cached text" && cached !== undefined) result = cached;
        else {
          result = parser.lex(source, { preserveTrivia: true });
          if (mode === "cached text") cached = result;
        }
        if (result.diagnostics.length !== 0) {
          throw new Error("Lexer benchmark returned invalid source.");
        }
        if (mode === "lex only") return;
        let checksum = 0;
        for (let index = 0; index < result.tokenTape.length; index++) {
          const token = result.tokenTape.token(index);
          if (token === undefined) {
            throw new Error(`Lexer benchmark has no token ${index}.`);
          }
          if (mode === "first spans") {
            checksum += token.span.end - token.span.start;
          } else checksum += token.text.length;
        }
        if (checksum !== source.length) {
          throw new Error("Lexer benchmark returned invalid spans or text.");
        }
      },
    });
  }
  return operations;
}

const targets = [{
  name: "current",
  parser: parserFrom(compile, parseMetadata, createParser),
}];
if (beforeRoot !== undefined) {
  const cwd = new URL("file:///");
  cwd.pathname = `${Deno.cwd()}/`;
  const root = new URL(`${beforeRoot}/`, cwd);
  const previousCompiler = await import(
    new URL("src/mod.ts", root).href
  ) as typeof import("../src/mod.ts");
  const previousRuntime = await import(
    new URL("src/runtime/generated_wasm.ts", root).href
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
  console.log(
    JSON.stringify({
      deno: Deno.version.deno,
      v8: Deno.version.v8,
      warmups,
      samples,
    }),
  );
  const statement = "let value = other;\n";
  for (const count of [4096, Math.ceil(512 * 1024 / statement.length)]) {
    const source = statement.repeat(count);
    const workloads = targets.map((target) =>
      operations(target.parser, source)
    );
    for (let operation = 0; operation < workloads[0].length; operation++) {
      const times = targets.map(() => [] as number[]);
      for (let round = 0; round < warmups + samples; round++) {
        let order = targets.map((_, index) => index);
        if (round % 2 !== 0) order = order.reverse();
        for (const target of order) {
          const start = performance.now();
          workloads[target][operation].run();
          const elapsed = performance.now() - start;
          if (round >= warmups) times[target].push(elapsed);
        }
      }
      for (let target = 0; target < targets.length; target++) {
        const ordered = times[target].sort((left, right) => left - right);
        const middle = Math.floor(samples / 2);
        let medianMs = ordered[middle];
        if (samples % 2 === 0) {
          medianMs = (ordered[middle - 1] + ordered[middle]) / 2;
        }
        console.log(JSON.stringify({
          target: targets[target].name,
          operation: workloads[target][operation].name,
          codeUnits: source.length,
          p25Ms: ordered[Math.floor(samples / 4)],
          medianMs,
          p95Ms: ordered[Math.floor(samples * 0.95)],
        }));
      }
    }
  }
} finally {
  for (const target of targets) target.parser.dispose();
}
