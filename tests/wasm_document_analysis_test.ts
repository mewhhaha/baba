import { assert, assertEquals, compile } from "./helpers.ts";
import { createParser } from "../src/runtime/generated_wasm.ts";
import type {
  IncrementalLexResult,
  IncrementalParseDocument,
  IncrementalValidateDocument,
  ParserInstance,
  RuleCursor,
  SourceSnapshot,
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

Deno.test("Wasm document token tapes stay current across trivia changes, errors, and retained snapshots", () => {
  function shape(
    result: Pick<IncrementalLexResult, "tokenTape" | "diagnostics">,
  ): string {
    const tokens = [];
    for (let index = 0; index < result.tokenTape.length; index++) {
      const token = result.tokenTape.token(index);
      assert(token !== undefined);
      tokens.push(token);
    }
    return JSON.stringify({ tokens, diagnostics: result.diagnostics });
  }
  const parser = documentParser();
  try {
    for (const trivia of ["preserve", "discard"] as const) {
      const original = "let x=1;let y=2;";
      const document = parser.createDocument(original, { goal: "lex", trivia });
      const retained: {
        result: IncrementalLexResult;
        source: string;
        expected: string;
      }[] = [];
      const sources = [
        original,
        "let longname=1;let y=2;",
        "let longname=z;let y=2;",
        "let longname= ;let y=2;",
        "let longname=z;let y=2;",
        "let longname=z;let   y=2;",
        " let longname=z;let   y=2;",
        "let longname=z;let   y=2;",
        "let longname=@;let   y=2;",
        "let longname=$;let   y=2;",
        "let longername=$;let   y=2;",
        "let longername=z;let   y=2;",
        "let longername=z;let   y=20000;",
        "let longername=z;let   y=\ud800;",
        "let longername=z;let   y=😀;",
        "",
        " \t",
        "a",
        " \t",
        "@",
        "",
        "let x=1;".repeat(128),
        "let y=2;".repeat(128),
      ];
      for (const source of sources) {
        const previous = document.snapshot.text();
        let start = 0;
        while (start < previous.length && previous[start] === source[start]) {
          start++;
        }
        let oldEnd = previous.length;
        let newEnd = source.length;
        while (
          oldEnd > start && newEnd > start &&
          previous[oldEnd - 1] === source[newEnd - 1]
        ) {
          oldEnd--;
          newEnd--;
        }
        document.applyEdits([{
          start,
          oldEnd,
          newText: source.slice(start, newEnd),
        }]);
        const fresh = parser.lex(source, {
          preserveTrivia: trivia === "preserve",
        });
        const result = document.lex();
        assertEquals(result.version, document.version);
        assertEquals(result.snapshot, document.snapshot);
        assertEquals(result.tokenTape.length, fresh.tokenTape.length);
        assertEquals(
          JSON.stringify(result.diagnostics),
          JSON.stringify(fresh.diagnostics),
        );
        if (source === "let longname=@;let   y=2;") {
          assertEquals(
            JSON.stringify(result.diagnostics),
            JSON.stringify([{
              code: "LEX_UNEXPECTED_CHARACTER",
              message: 'Unexpected character "@".',
              span: { start: 13, end: 14 },
            }]),
          );
        }
        // Keep every tape lazy until later edits and arena growth have finished.
        retained.push({ result, source, expected: shape(fresh) });
      }
      parser.lex("let temporary=3;".repeat(8192));
      document.dispose();
      for (const saved of retained) {
        assertEquals(saved.result.snapshot.text(), saved.source);
        assertEquals(shape(saved.result), saved.expected);
      }
    }
  } finally {
    parser.dispose();
  }
});

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

Deno.test("Wasm documents retain lazy cursor fields and spans across topology reuse and trivia movement", () => {
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
    const fields: Record<string, unknown> = {};
    for (const name of ["statements", "name", "value"]) {
      fields[name] = cursor.fieldArray(name).map((value) => {
        assert(value !== null && "type" in value);
        return shape(value);
      });
    }
    return {
      type: cursor.type,
      name: cursor.name,
      span: cursor.span,
      tokenRange: cursor.tokenRange,
      children: cursor.children().map(shape),
      fields,
    };
  }
  const parser = documentParser();
  try {
    for (const trivia of ["preserve", "discard"] as const) {
      const document = parser.createDocument(" \tlet x=1 ;\nlet y=2;\n", {
        goal: "parse",
        trivia,
      });
      const retained: {
        cursor: RuleCursor;
        snapshot: SourceSnapshot;
        source: string;
        expected: string;
      }[] = [];
      const sources = [
        " \tlet x=1 ;\nlet y=2;\n",
        " \tlet x=10000 ;\nlet y=2;\n",
        " \tlet x=10000 ;\nlet longer=2;\n",
        " \n\t let x=10000 ;\nlet longer=2;\n",
        // The terminal sequence and raw count match, but token indices move.
        " \n\t let x =10000;\nlet longer=2;\n",
        " \n\t let x=10000 ;\nlet longer=2;\n",
        " \n\t let x=10000 ;\nlet longer=200;\n\t ",
        "let x=10000;let longer=200;let z=3;",
        "let x=10000;let longer=200;let z=@;",
        "let x=10000;let longer=200;let z=3;",
        "let x=10000;let alias=200;let z=3;",
        "",
        " \t",
        " \n\t ",
        "let x=1;",
        "let renamed=1;",
        "let x=1;".repeat(256),
        "let renamed=1;" + "let x=1;".repeat(255),
        "let renamed=1;" + "let x=1;".repeat(254) + "let end=200000;",
      ];
      for (const source of sources) {
        const previous = document.snapshot.text();
        let start = 0;
        while (start < previous.length && previous[start] === source[start]) {
          start++;
        }
        let oldEnd = previous.length;
        let newEnd = source.length;
        while (
          oldEnd > start && newEnd > start &&
          previous[oldEnd - 1] === source[newEnd - 1]
        ) {
          oldEnd--;
          newEnd--;
        }
        document.applyEdits([{
          start,
          oldEnd,
          newText: source.slice(start, newEnd),
        }]);
        const maintained = document.parse();
        const fresh = parser.parse(source, {
          preserveTrivia: trivia === "preserve",
        });
        assertEquals(maintained.ok, fresh.ok);
        assertEquals(
          JSON.stringify(maintained.diagnostics),
          JSON.stringify(fresh.diagnostics),
        );
        if (maintained.ok && fresh.ok) {
          // Leave wrappers and field references lazy across further versions.
          retained.push({
            cursor: maintained.cursor,
            snapshot: maintained.snapshot,
            source,
            expected: JSON.stringify(shape(fresh.cursor)),
          });
        }
        parser.lex("let temporary=3;".repeat(8192));
      }
      document.dispose();
      for (const saved of retained) {
        assertEquals(saved.snapshot.text(), saved.source);
        assertEquals(JSON.stringify(shape(saved.cursor)), saved.expected);
      }
    }
  } finally {
    parser.dispose();
  }
});

Deno.test("Wasm documents reuse analysis while refreshing text, trivia, spans, and snapshots", () => {
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
  const parser = documentParser();
  try {
    for (const trivia of ["preserve", "discard"] as const) {
      const original = "let x=1;let y=2;";
      const parsed = parser.createDocument(original, {
        goal: "parse",
        trivia,
        maxParserActions: 10,
      });
      const validated = parser.createDocument(original, {
        goal: "validate",
        trivia,
        maxParserActions: 10,
      });
      const retained = parsed.parse();
      assert(retained.ok);
      const retainedShape = JSON.stringify(shape(retained.cursor));
      const retainedValidation = validated.validate();
      const sources = [
        " \tlet x=1;let y=2;",
        " \tlet longer=1;let y=2;",
        " \tlet longer=10000;let y=2;",
        " \tlet\n\tlonger=10000;let y=2;",
        "let\n\tlonger=10000; \nlet y=2; \t",
        "let longer=10000; let y=2;",
      ];
      for (const source of sources) {
        const previous = parsed.snapshot.text();
        let start = 0;
        while (start < previous.length && previous[start] === source[start]) {
          start++;
        }
        let oldEnd = previous.length;
        let newEnd = source.length;
        while (
          oldEnd > start && newEnd > start &&
          previous[oldEnd - 1] === source[newEnd - 1]
        ) {
          oldEnd--;
          newEnd--;
        }
        const edits = [{ start, oldEnd, newText: source.slice(start, newEnd) }];
        const parsedUpdate = parsed.applyEdits(edits);
        const validatedUpdate = validated.applyEdits(edits);
        assertEquals(parsedUpdate.parser.parserActions, 0);
        assertEquals(parsedUpdate.parser.reparsedRanges.length, 0);
        assertEquals(parsedUpdate.parser.reuseChecks, 1);
        assertEquals(
          JSON.stringify(parsedUpdate.parser),
          JSON.stringify(validatedUpdate.parser),
        );
        assertEquals(parsed.snapshot.text(), source);
        const validation = validated.validate();
        assert(validation.ok);
        assertEquals(validation.version, validated.version);
        assertEquals(validation.snapshot, validated.snapshot);
        // Overwrite the shared Wasm arena between document calls.
        parser.lex("let temporary=3;".repeat(8192));
        const updated = parsed.parse();
        const fresh = parser.parse(source, {
          preserveTrivia: trivia === "preserve",
          maxParserActions: 10,
        });
        assert(updated.ok && fresh.ok);
        assertEquals(
          JSON.stringify(shape(updated.cursor)),
          JSON.stringify(shape(fresh.cursor)),
        );
        const statement = updated.cursor.child(0);
        assert(statement !== undefined && statement.type === "rule");
        const name = statement.field("name");
        assert(name !== undefined && name !== null && !Array.isArray(name));
        assert("type" in name && name.type === "token");
        assertEquals(name.text, source.slice(name.span.start, name.span.end));
        assertEquals(JSON.stringify(shape(retained.cursor)), retainedShape);
        assertEquals(retainedValidation.snapshot.text(), original);
        assertEquals(retainedValidation.version, 0);
      }
      const source = parsed.snapshot.text();
      const valueAt = source.lastIndexOf("2");
      const edits = [
        { start: 4, oldEnd: 10, newText: "alias" },
        { start: valueAt, oldEnd: valueAt + 1, newText: "300" },
      ];
      for (const document of [parsed, validated]) {
        const update = document.applyEdits(edits);
        assertEquals(update.parser.parserActions, 0);
        assertEquals(update.parser.reuseChecks, 1);
      }
      const updated = parsed.parse();
      const fresh = parser.parse(parsed.snapshot.text(), {
        preserveTrivia: trivia === "preserve",
        maxParserActions: 10,
      });
      assert(updated.ok && fresh.ok);
      assertEquals(
        JSON.stringify(shape(updated.cursor)),
        JSON.stringify(shape(fresh.cursor)),
      );
      parsed.dispose();
      validated.dispose();
    }
  } finally {
    parser.dispose();
  }
});

Deno.test("Wasm document analysis reuse falls back for changed terminals, failures, and large windows", () => {
  const parser = documentParser();
  try {
    for (const goal of ["validate", "parse"] as const) {
      let document: IncrementalParseDocument | IncrementalValidateDocument;
      if (goal === "parse") {
        document = parser.createDocument("let x=1;let y=2;", {
          goal: "parse",
          maxParserActions: 10,
        });
      } else {
        document = parser.createDocument("let x=1;let y=2;", {
          goal: "validate",
          maxParserActions: 10,
        });
      }
      for (
        const source of [
          "let x=;let y=2;",
          "let x=;  let y=2;",
          "let x=@;let y=2;",
          "let x=1;let y=2;",
          "let x=1;let y=2;let z=3;",
          "let x=1;let y=2;let z=@;",
          "let x=1;let y=2;",
        ]
      ) {
        const update = document.applyEdits([{
          start: 0,
          oldEnd: document.snapshot.length,
          newText: source,
        }]);
        const result = document.validate();
        const fresh = parser.validate(source, { maxParserActions: 10 });
        assertEquals(result.ok, fresh.ok);
        assertEquals(
          JSON.stringify(result.diagnostics),
          JSON.stringify(fresh.diagnostics),
        );
        assert(update.parser.parserActions > 0);
        assertEquals(update.parser.reparsedRanges.length, 1);
        if (document.goal === "parse") {
          const parsed = document.parse();
          assertEquals(parsed.ok, fresh.ok);
          assertEquals(
            JSON.stringify(parsed.diagnostics),
            JSON.stringify(fresh.diagnostics),
          );
        }
      }
      document.dispose();

      const source = "let x=1;".repeat(20);
      let large: IncrementalParseDocument | IncrementalValidateDocument;
      if (goal === "parse") {
        large = parser.createDocument(source, { goal: "parse" });
      } else {
        large = parser.createDocument(source, { goal: "validate" });
      }
      const update = large.applyEdits([{
        start: 0,
        oldEnd: source.length,
        newText: source.replaceAll("x", "renamed"),
      }]);
      assertEquals(large.validate().ok, true);
      assert(update.parser.parserActions > 0);
      assertEquals(update.parser.reuseChecks, 0);
      large.dispose();
    }
  } finally {
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

Deno.test("Wasm documents retain token and cursor spans after edits throughout large token tapes", () => {
  function lexShape(
    result: Pick<IncrementalLexResult, "tokenTape" | "diagnostics">,
  ): string {
    const tokens = new Array(result.tokenTape.length);
    // Changing lookup direction exercises both cached and searched chunks.
    for (let index = tokens.length - 1; index >= 0; index--) {
      const token = result.tokenTape.token(index);
      assert(token !== undefined);
      tokens[index] = token;
    }
    return JSON.stringify({ tokens, diagnostics: result.diagnostics });
  }
  function cursorShape(cursor: SyntaxCursor): unknown {
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
    const fields: unknown[] = [];
    if (cursor.name === "statement") {
      for (const name of ["name", "value"]) {
        const field = cursor.field(name);
        assert(field !== undefined && field !== null && "type" in field);
        fields.push(cursorShape(field));
      }
    }
    return {
      type: cursor.type,
      name: cursor.name,
      span: cursor.span,
      tokenRange: cursor.tokenRange,
      children: cursor.children().map(cursorShape),
      fields,
    };
  }
  const parser = documentParser();
  try {
    for (const trivia of ["preserve", "discard"] as const) {
      let source = "let name = 1;\n".repeat(512);
      const document = parser.createDocument(source, {
        goal: "parse",
        trivia,
      });
      const retained: {
        lexed: IncrementalLexResult;
        cursor: RuleCursor;
        lexShape: string;
        cursorShape: string;
        source: string;
      }[] = [];
      function check(retain: boolean): void {
        const options = { preserveTrivia: trivia === "preserve" };
        const lexed = document.lex();
        const parsed = document.parse();
        const freshLex = parser.lex(source, options);
        const freshParse = parser.parse(source, options);
        assert(parsed.ok && freshParse.ok);
        const expectedLex = lexShape(freshLex);
        const expectedCursor = JSON.stringify(cursorShape(freshParse.cursor));
        if (retain) {
          // Leave document wrappers lazy until after compaction and disposal.
          retained.push({
            lexed,
            cursor: parsed.cursor,
            lexShape: expectedLex,
            cursorShape: expectedCursor,
            source,
          });
        } else {
          assertEquals(lexShape(lexed), expectedLex);
          assertEquals(
            JSON.stringify(cursorShape(parsed.cursor)),
            expectedCursor,
          );
        }
      }
      check(true);
      for (let index = 0; index < 160; index++) {
        const line = (index * 173) % 512;
        let start = 0;
        for (let before = 0; before < line; before++) {
          start = source.indexOf("\n", start) + 1;
        }
        start += 4;
        const oldEnd = source.indexOf(" ", start);
        assert(oldEnd > start);
        let name = "expandedname";
        if (index % 2 === 0) name = "n";
        document.applyEdits([{ start, oldEnd, newText: name }]);
        source = source.slice(0, start) + name + source.slice(oldEnd);
        if (index % 24 === 0) check(true);
        else if (index % 12 === 0) check(false);
        if (index % 31 === 0) parser.lex("let other = 22;\n".repeat(8192));
      }
      check(false);
      // Force full parser uploads and visible-token mapping changes as well.
      document.applyEdits([
        { start: 0, oldEnd: 0, newText: " \t" },
        {
          start: source.length,
          oldEnd: source.length,
          newText: "let last = 2000;\n",
        },
      ]);
      source = " \t" + source + "let last = 2000;\n";
      check(true);
      document.applyEdits([{
        start: 0,
        oldEnd: document.snapshot.length - 17,
        newText: "",
      }]);
      source = source.slice(source.length - 17);
      check(false);
      document.dispose();
      parser.lex("let overwrite = 3;\n".repeat(16384));
      for (const old of retained) {
        assertEquals(lexShape(old.lexed), old.lexShape);
        assertEquals(JSON.stringify(cursorShape(old.cursor)), old.cursorShape);
        assertEquals(old.lexed.snapshot.text(), old.source);
      }
    }
  } finally {
    parser.dispose();
  }
});

Deno.test("Wasm lexer named tokens retain enumerable text, channels, and owned spans across arena reuse", () => {
  const parser = documentParser();
  try {
    const result = parser.lex("let alpha = 12;\n", { preserveTrivia: true });
    assertEquals(result.diagnostics.length, 0);
    const named = result.tokenTape.token(2);
    const trivia = result.tokenTape.token(1);
    const unread = result.tokenTape.token(6);
    assert(named !== undefined && named.type === "named");
    assert(trivia !== undefined && trivia.type === "named");
    assert(unread !== undefined && unread.type === "named");
    assert(result.tokenTape.token(2) === named);
    assertEquals(Object.getPrototypeOf(named), Object.prototype);
    assertEquals(Object.getPrototypeOf(trivia), Object.prototype);
    assertEquals(Object.getPrototypeOf(unread), Object.prototype);
    const expected = {
      type: "named",
      kind: "IDENT",
      text: "alpha",
      span: { start: 4, end: 9 },
      channel: "main",
    };
    assertEquals(JSON.stringify(named), JSON.stringify(expected));
    assertEquals(JSON.stringify({ ...named }), JSON.stringify(expected));
    assertEquals(
      JSON.stringify(Object.keys(named)),
      JSON.stringify(["type", "kind", "text", "span", "channel"]),
    );
    assertEquals(trivia.kind, "WS");
    assertEquals(trivia.channel, "trivia");
    assertEquals(unread.kind, "INT");
    assertEquals(unread.channel, "main");
    // Read these texts for the first time after escaped spans and Wasm memory
    // have changed. Their slices belong to the original source coordinates.
    (trivia.span as { start: number; end: number }).start = 999;
    (unread.span as { start: number; end: number }).end = 999;
    parser.reset();
    parser.lex("let overwrite = 34;\n".repeat(16384));
    parser.dispose();
    assertEquals(named.text, "alpha");
    assertEquals(trivia.text, " ");
    assertEquals(unread.text, "12");
    assertEquals(trivia.span.start, 999);
    assertEquals(unread.span.end, 999);
    assertEquals(trivia.text, " ");
    assertEquals(unread.text, "12");
  } finally {
    parser.dispose();
  }
});

Deno.test("Wasm token cursors serialize public fields and retain owned text after span mutation and disposal", () => {
  const parser = documentParser();
  try {
    for (const trivia of ["preserve", "discard"] as const) {
      const document = parser.createDocument("let alpha = 12;\n", {
        goal: "parse",
        trivia,
      });
      const initial = document.parse();
      assert(initial.ok);
      const statement = initial.cursor.child(0);
      assert(statement !== undefined && statement.type === "rule");
      const literal = statement.child(0);
      const named = statement.child(1);
      assert(literal !== undefined && literal.type === "token");
      assert(named !== undefined && named.type === "token");
      assert(statement.field("name") === named);
      let tokenIndex = 1;
      if (trivia === "preserve") tokenIndex = 2;
      const expected = [
        {
          type: "token",
          tokenType: "literal",
          kind: "let",
          text: "let",
          span: { start: 0, end: 3 },
          tokenIndex: 0,
        },
        {
          type: "token",
          tokenType: "named",
          kind: "IDENT",
          text: "alpha",
          span: { start: 4, end: 9 },
          tokenIndex,
        },
      ];
      for (const [index, token] of [literal, named].entries()) {
        assertEquals(Object.getPrototypeOf(token), Object.prototype);
        assertEquals(
          JSON.stringify(Object.keys(token)),
          JSON.stringify([
            "type",
            "tokenType",
            "kind",
            "text",
            "span",
            "tokenIndex",
          ]),
        );
        assertEquals(JSON.stringify(token), JSON.stringify(expected[index]));
        assertEquals(
          JSON.stringify({ ...token }),
          JSON.stringify(expected[index]),
        );
      }
      (named.span as { start: number; end: number }).start = 999;
      (literal.span as { start: number; end: number }).end = 999;
      document.applyEdits([{ start: 4, oldEnd: 9, newText: "delta" }]);
      const updated = document.parse();
      assert(updated.ok);
      const renamedStatement = updated.cursor.child(0);
      assert(
        renamedStatement !== undefined && renamedStatement.type === "rule",
      );
      const renamed = renamedStatement.field("name");
      assert(renamed !== undefined && renamed !== null && "type" in renamed);
      assert(renamed.type === "token");
      assert(renamed !== named);
      assertEquals(renamed.span.start, 4);
      assertEquals(renamed.span.end, 9);
      document.dispose();
      parser.reset();
      parser.lex("let overwrite = 34;\n".repeat(16384));
      assertEquals(named.text, "alpha");
      assertEquals(literal.text, "let");
      assertEquals(renamed.text, "delta");
      assertEquals(named.span.start, 999);
      assertEquals(literal.span.end, 999);
    }
  } finally {
    parser.dispose();
  }
});

Deno.test("Wasm cursor coordinates retain fresh text and isolated spans across unchanged and pending layouts", () => {
  function shape(cursor: SyntaxCursor): unknown {
    if (cursor.type === "token") {
      return {
        type: cursor.type,
        kind: cursor.kind,
        tokenType: cursor.tokenType,
        text: cursor.text,
        span: cursor.span,
        tokenIndex: cursor.tokenIndex,
      };
    }
    const fields: unknown[] = [];
    let names = ["name", "value"];
    if (cursor.name === "module") names = ["statements"];
    for (const name of names) {
      fields.push(
        cursor.fieldArray(name).map((value) => {
          assert(value !== null && "type" in value);
          return shape(value);
        }),
      );
    }
    return {
      type: cursor.type,
      name: cursor.name,
      span: cursor.span,
      tokenRange: cursor.tokenRange,
      children: cursor.children().map(shape),
      fields,
    };
  }
  const parser = documentParser();
  try {
    for (const trivia of ["preserve", "discard"] as const) {
      let source = " let alpha = 1;\nlet bravo = 2;\nlet gamma = 3;\n";
      const document = parser.createDocument(source, { goal: "parse", trivia });
      const initial = document.parse();
      assert(initial.ok);
      const oldRule = initial.cursor.child(0);
      assert(oldRule !== undefined && oldRule.type === "rule");
      const oldName = oldRule.field("name");
      assert(oldName !== undefined && oldName !== null && "type" in oldName);
      assert(oldName.type === "token");
      // Mutating an escaped span must not alter the shared record arrays or
      // the wrappers for a later source version.
      (oldName.span as { start: number; end: number }).start = 999;
      document.applyEdits([{ start: 5, oldEnd: 10, newText: "delta" }]);
      source = source.slice(0, 5) + "delta" + source.slice(10);
      const updated = document.parse();
      assert(updated.ok);
      const newRule = updated.cursor.child(0);
      assert(newRule !== undefined && newRule.type === "rule");
      const newName = newRule.field("name");
      assert(newName !== undefined && newName !== null && "type" in newName);
      assert(newName.type === "token");
      assert(newRule !== oldRule && newName !== oldName);
      assertEquals(newName.text, "delta");
      assertEquals(newName.span.start, 5);
      assertEquals(newName.span.end, 10);
      assertEquals(oldName.text, "alpha");
      assertEquals(oldName.span.start, 999);
      const retained: { cursor: RuleCursor; source: string }[] = [{
        cursor: updated.cursor,
        source,
      }];

      // Leave shifted coordinates pending, then create many versions with
      // matching coordinates before reading any of their children or fields.
      document.applyEdits([{ start: 0, oldEnd: 1, newText: "   " }]);
      source = "   " + source.slice(1);
      for (let index = 0; index < 24; index++) {
        const selected = index % 3;
        let line = 0;
        for (let before = 0; before < selected; before++) {
          line = source.indexOf("\n", line) + 1;
        }
        const start = source.indexOf("let", line) + 4;
        let name = "omega";
        if (index % 2 === 0) name = "sigma";
        document.applyEdits([{ start, oldEnd: start + 5, newText: name }]);
        source = source.slice(0, start) + name + source.slice(start + 5);
        const parsed = document.parse();
        assert(parsed.ok);
        if (index % 4 === 0) retained.push({ cursor: parsed.cursor, source });
      }
      parser.lex("let temporary = 1;\n".repeat(8192));
      const options = { preserveTrivia: trivia === "preserve" };
      const current = document.parse();
      const fresh = parser.parse(source, options);
      assert(current.ok && fresh.ok);
      assertEquals(
        JSON.stringify(shape(current.cursor)),
        JSON.stringify(shape(fresh.cursor)),
      );

      // Total length and terminal positions are unchanged, but internal
      // token boundaries move. This must refresh both token and rule spans.
      const first = source.indexOf("let") + 4;
      const second = source.indexOf("let", first) + 4;
      document.applyEdits([
        { start: first, oldEnd: first + 5, newText: "epsilon" },
        { start: second, oldEnd: second + 5, newText: "eta" },
      ]);
      source = source.slice(0, first) + "epsilon" +
        source.slice(first + 5, second) + "eta" + source.slice(second + 5);
      const moved = document.parse();
      const movedFresh = parser.parse(source, options);
      assert(moved.ok && movedFresh.ok);
      assertEquals(
        JSON.stringify(shape(moved.cursor)),
        JSON.stringify(shape(movedFresh.cursor)),
      );
      retained.push({ cursor: moved.cursor, source });
      document.dispose();
      parser.reset();
      parser.lex("let overwrite = 2;\n".repeat(16384));
      for (const saved of retained.reverse()) {
        const expected = parser.parse(saved.source, options);
        assert(expected.ok);
        assertEquals(
          JSON.stringify(shape(saved.cursor)),
          JSON.stringify(shape(expected.cursor)),
        );
      }
    }
  } finally {
    parser.dispose();
  }
});

Deno.test("Wasm documents preserve shifted lookahead dependencies across distant token chunks", () => {
  const built = compile(
    String.raw`
    token LETTER = /[xzq]/ ;
    contextual APPLICATION_SPACE = /[ ]+(?=[xzq]*z)/ ;
    module = statement* ;
    statement = "app" APPLICATION_SPACE LETTER* ";" ;
  `,
    { targets: ["wasm"] },
  );
  assert(built.bundle, JSON.stringify(built.diagnostics));
  const wasm = built.bundle.files.find((file) =>
    file.path === "wasm/parser.wasm"
  );
  const plan = built.bundle.files.find((file) =>
    file.path === "wasm/parser.plan"
  );
  assert(wasm !== undefined && wasm.encoding === "binary");
  assert(plan !== undefined && plan.encoding === "binary");
  const parser = createParser({ bytes: wasm.content, plan: plan.content });
  function check(
    document: {
      lex(): IncrementalLexResult;
      readonly snapshot: SourceSnapshot;
    },
  ): void {
    const fresh = parser.lex(document.snapshot.text(), {
      preserveTrivia: true,
    });
    const current = document.lex();
    assertEquals(
      JSON.stringify(current.diagnostics),
      JSON.stringify(fresh.diagnostics),
    );
    assertEquals(current.tokenTape.length, fresh.tokenTape.length);
    for (let index = 0; index < fresh.tokenTape.length; index++) {
      assertEquals(
        JSON.stringify(current.tokenTape.token(index)),
        JSON.stringify(fresh.tokenTape.token(index)),
      );
    }
  }
  try {
    const document = parser.createDocument("app " + "x".repeat(4096) + "z;", {
      goal: "lex",
      trivia: "preserve",
    });
    document.applyEdits([{ start: 0, oldEnd: 3, newText: "appx" }]);
    check(document);
    const source = document.snapshot.text();
    const changed = document.applyEdits([{
      start: source.length - 2,
      oldEnd: source.length - 1,
      newText: "q",
    }]);
    assertEquals(changed.lexer.relexedRange.start, 4);
    check(document);
    const restored = document.applyEdits([{
      start: source.length - 2,
      oldEnd: source.length - 1,
      newText: "z",
    }]);
    assertEquals(restored.lexer.relexedRange.start, 4);
    check(document);
    document.dispose();
  } finally {
    parser.dispose();
  }
});
