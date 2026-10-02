import { assert, assertEquals, compile } from "./helpers.ts";
import { createParser } from "../src/runtime/generated_wasm.ts";
import type { ParserInstance } from "../src/runtime/generated_wasm.ts";

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
