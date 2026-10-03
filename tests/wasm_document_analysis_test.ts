import { assert, assertEquals, compile } from "./helpers.ts";
import { createParser } from "../src/runtime/generated_wasm.ts";
import type {
  ParserInstance,
  SyntaxCursor,
} from "../src/runtime/generated_wasm.ts";

const GRAMMAR = String.raw`
  token IDENT = /[a-z]+/ ;
  token INT = /[0-9]+/ ;
  skip WS = /[ \t\r\n]+/ ;
  module = statements:statement* ;
  statement = "let" name:IDENT "=" value:INT ";" ;
`;

function documentParser(): ParserInstance {
  const built = compile(GRAMMAR, {
    targets: ["wasm"],
    metadata: {
      gpuFrontend: {
        version: 3,
        throughput: "strict",
        root: "module",
        islands: [
          { rule: "module", boundary: { kind: "root" } },
          {
            rule: "statement",
            boundary: { kind: "terminated", terminal: ";" },
          },
        ],
        semantics: { rules: {} },
      },
    },
  });
  assert(built.bundle);
  const wasm = built.bundle.files.find((file) =>
    file.path === "wasm/parser.wasm"
  );
  const plan = built.bundle.files.find((file) =>
    file.path === "wasm/parser.plan"
  );
  assert(wasm !== undefined && wasm.encoding === "binary");
  assert(plan !== undefined && plan.encoding === "binary");
  return createParser({ bytes: wasm.content, plan: plan.content });
}

Deno.test("Wasm parse documents retain validation diagnostics and work across edits", () => {
  const parser = documentParser();
  try {
    for (const maxParserActions of [4, 100]) {
      const document = parser.createDocument("let x=1;", {
        goal: "parse",
        trivia: "preserve",
        maxParserActions,
      });
      const validation = parser.createDocument("let x=1;", {
        goal: "validate",
        trivia: "preserve",
        maxParserActions,
      });
      for (
        const source of ["let x=2;", "let x=;", "let x=@;", "", "let y=3;"]
      ) {
        const edits = [{
          start: 0,
          oldEnd: document.snapshot.length,
          newText: source,
        }];
        const parsedUpdate = document.applyEdits(edits);
        const validatedUpdate = validation.applyEdits(edits);
        assertEquals(
          JSON.stringify(parsedUpdate.parser),
          JSON.stringify(validatedUpdate.parser),
        );
        const fresh = parser.validate(source, { maxParserActions });
        const maintained = document.validate();
        assertEquals(maintained.ok, fresh.ok);
        assertEquals(maintained.version, document.version);
        assertEquals(maintained.snapshot, document.snapshot);
        assertEquals(
          JSON.stringify(maintained.diagnostics),
          JSON.stringify(fresh.diagnostics),
        );
        const parsed = document.parse();
        assertEquals(parsed.ok, fresh.ok);
        assertEquals(
          JSON.stringify(parsed.diagnostics),
          JSON.stringify(fresh.diagnostics),
        );
        if (parsed.ok) {
          assertEquals(parsed.cursor.name, "module");
          assertEquals(parsed.cursor.span.end, source.length);
        }
      }
    }
  } finally {
    parser.dispose();
  }
});

Deno.test("Wasm parse documents keep successful validation when cursor allocation fails", () => {
  const parser = documentParser();
  const source = "let x=1;".repeat(8192);
  // Allocate lexer and analysis buffers first; only cursor tapes need more memory.
  parser.createDocument(source, { goal: "validate" });
  const grow = WebAssembly.Memory.prototype.grow;
  let growthAttempts = 0;
  WebAssembly.Memory.prototype.grow = function (): number {
    growthAttempts++;
    throw new RangeError("Injected cursor allocation failure");
  };
  try {
    const document = parser.createDocument(source, { goal: "parse" });
    assert(growthAttempts > 0);
    const validated = document.validate();
    assertEquals(validated.ok, true);
    assertEquals(validated.diagnostics.length, 0);
    const parsed = document.parse();
    assertEquals(parsed.ok, false);
    assertEquals(parsed.diagnostics[0].code, "PARSER_INTERNAL_ERROR");
  } finally {
    WebAssembly.Memory.prototype.grow = grow;
    parser.dispose();
  }
});

Deno.test("Wasm incremental parser uploads retain lazy tokens and cursor snapshots", () => {
  const parser = documentParser();
  function shape(cursor: SyntaxCursor): unknown {
    if (cursor.type === "token") {
      return {
        type: cursor.type,
        tokenType: cursor.tokenType,
        kind: cursor.kind,
        text: cursor.text,
        span: cursor.span,
        tokenIndex: cursor.tokenIndex,
      };
    }
    return {
      type: cursor.type,
      name: cursor.name,
      span: cursor.span,
      tokenRange: cursor.tokenRange,
      children: cursor.children().map(shape),
    };
  }
  try {
    for (const trivia of ["preserve", "discard"] as const) {
      const source = "let x = 1;\nlet y = 2;";
      const document = parser.createDocument(source, { goal: "parse", trivia });
      const oldLexed = document.lex();
      const oldParsed = document.parse();
      assert(oldParsed.ok);
      // Leave token and child wrappers lazy until after edits and memory growth.
      const freshOld = parser.parse(source, {
        preserveTrivia: trivia === "preserve",
      });
      assert(freshOld.ok);
      const oldShape = JSON.stringify(shape(freshOld.cursor));
      document.applyEdits([{ start: 4, oldEnd: 5, newText: "longname" }]);
      parser.lex("let temporary=3;".repeat(8192));
      document.applyEdits([{ start: 0, oldEnd: 0, newText: " \t" }]);
      const updatedSource = document.snapshot.text();
      const fresh = parser.parse(updatedSource, {
        preserveTrivia: trivia === "preserve",
      });
      const updated = document.parse();
      assert(fresh.ok && updated.ok);
      assertEquals(
        JSON.stringify(shape(updated.cursor)),
        JSON.stringify(shape(fresh.cursor)),
      );
      const first = updated.cursor.child(0);
      assert(first !== undefined && first.type === "rule");
      const name = first.field("name");
      assert(name !== undefined && name !== null && !Array.isArray(name));
      assert("type" in name && name.type === "token");
      assertEquals(name.kind, "IDENT");
      assertEquals(name.text, "longname");
      const oldTexts: string[] = [];
      for (let index = 0; index < oldLexed.tokenTape.length; index++) {
        const token = oldLexed.tokenTape.token(index);
        assert(token !== undefined);
        oldTexts.push(token.text);
      }
      const oldFreshLexed = parser.lex(source, {
        preserveTrivia: trivia === "preserve",
      });
      const freshTexts: string[] = [];
      for (let index = 0; index < oldFreshLexed.tokenTape.length; index++) {
        const token = oldFreshLexed.tokenTape.token(index);
        assert(token !== undefined);
        freshTexts.push(token.text);
      }
      assertEquals(JSON.stringify(oldTexts), JSON.stringify(freshTexts));
      assertEquals(oldLexed.snapshot.text(), source);
      assertEquals(JSON.stringify(shape(oldParsed.cursor)), oldShape);
      document.dispose();
    }
  } finally {
    parser.dispose();
  }
});

Deno.test("Wasm parseRecords retains caller records across aliased source writes and memory growth", () => {
  interface CapturedWasm {
    readonly memory: WebAssembly.Memory;
    input_base(): number;
  }
  const Instance = WebAssembly.Instance;
  let captured: WebAssembly.Instance | undefined;
  WebAssembly.Instance = new Proxy(Instance, {
    construct(target, argumentsList) {
      const instance = Reflect.construct(
        target,
        argumentsList,
      ) as WebAssembly.Instance;
      if (typeof instance.exports.input_base === "function") {
        captured = instance;
      }
      return instance;
    },
  });
  try {
    for (const statementCount of [1, 4096]) {
      const source = "let x=1;".repeat(statementCount);
      const lexer = documentParser();
      assert(captured !== undefined);
      const lexerWasm = captured.exports as unknown as CapturedWasm;
      const lexed = lexer.lex(source, { preserveTrivia: true });
      assertEquals(lexed.diagnostics.length, 0);
      const tokenPtr =
        Math.ceil((lexerWasm.input_base() + source.length * 2) / 4) * 4;
      const records = new Int32Array(
        lexerWasm.memory.buffer,
        tokenPtr,
        (lexed.tokenTape.length - 1) * 4,
      ).slice();
      lexer.dispose();

      const parser = documentParser();
      assert(captured !== undefined);
      const wasm = captured.exports as unknown as CapturedWasm;
      const inputBase = wasm.input_base();
      const requiredBytes = inputBase + records.byteLength;
      if (requiredBytes > wasm.memory.buffer.byteLength) {
        wasm.memory.grow(
          Math.ceil((requiredBytes - wasm.memory.buffer.byteLength) / 65_536),
        );
      }
      // The source write overlaps these valid records. For the large source,
      // preparing the destination also has to grow and detach this buffer.
      const aliased = new Int32Array(
        wasm.memory.buffer,
        inputBase,
        records.length,
      );
      aliased.set(records);
      const oldBuffer = aliased.buffer;
      const parsed = parser.parseRecords(source, aliased, {
        preserveTrivia: true,
      });
      assert(parsed.ok);
      assertEquals(parsed.cursor.childCount, statementCount);
      assertEquals(parsed.cursor.span.end, source.length);
      if (statementCount > 1) {
        assert(oldBuffer !== wasm.memory.buffer);
        assertEquals(aliased.length, 0);
      }
      const first = parsed.cursor.child(0);
      assert(first !== undefined && first.type === "rule");
      const name = first.field("name");
      assert(name !== undefined && name !== null && !Array.isArray(name));
      assert("type" in name && name.type === "token");
      assertEquals(name.text, "x");

      const independent = parser.parseRecords(source, records, {
        preserveTrivia: false,
      });
      assert(independent.ok);
      records.fill(-1);
      parser.parse("let other=2;");
      const retained = independent.cursor.child(0);
      assert(retained !== undefined && retained.type === "rule");
      const retainedName = retained.field("name");
      assert(
        retainedName !== undefined && retainedName !== null &&
          !Array.isArray(retainedName),
      );
      assert("type" in retainedName && retainedName.type === "token");
      assertEquals(retainedName.text, "x");
      assertEquals(retainedName.span.start, 4);
      assertEquals(retainedName.span.end, 5);
      parser.dispose();
    }
  } finally {
    WebAssembly.Instance = Instance;
  }
});
