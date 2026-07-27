import {
  assert,
  assertEquals,
  assertIncludes,
  assertNotIncludes,
  compile,
} from "./helpers.ts";
import {
  babaWasmFrontendRequirements,
  wasmFrontendCandidates,
  wasmFrontendRecommendation,
} from "../src/wasm_frontend/research.ts";

interface GeneratedAbiDescriptor {
  readonly format: string;
  readonly version: number;
  readonly targetKind: string;
  readonly core: {
    readonly abiVersion: number;
    readonly memory: {
      readonly export: string;
      readonly pageBytes: number;
      readonly maxPages: number;
    };
    readonly sourceEncoding: {
      readonly value: number;
    };
    readonly spanUnit: {
      readonly value: number;
    };
    readonly ownership: {
      readonly value: number;
    };
    readonly resultLifetime: {
      readonly value: number;
    };
    readonly layouts: {
      readonly lexResult: {
        readonly i32Count: number;
      };
      readonly tokenRecord: {
        readonly i32Count: number;
      };
      readonly parseTraceResult: {
        readonly i32Count: number;
      };
      readonly parseCursorResult: {
        readonly i32Count: number;
      };
      readonly cursorRuleRecord: {
        readonly i32Count: number;
      };
      readonly cursorFieldRecord: {
        readonly i32Count: number;
      };
      readonly cursorValueRecord: {
        readonly i32Count: number;
      };
      readonly cursorChildRecord: {
        readonly i32Count: number;
      };
      readonly cursorValueItemRecord: {
        readonly i32Count: number;
      };
    };
    readonly exports: readonly {
      readonly name: string;
    }[];
  };
}

Deno.test("Wasm frontend scaffold records the core Baba ABI gate", () => {
  assertEquals(babaWasmFrontendRequirements.abiName, "baba-wasm-abi");
  assertEquals(babaWasmFrontendRequirements.abiVersion, 9);
  assertEquals(
    babaWasmFrontendRequirements.targetKind,
    "javascript-hosted-core-wasm",
  );
  assertEquals(babaWasmFrontendRequirements.targetProfile, "core-3-nonweb");
  assertEquals(babaWasmFrontendRequirements.pointerWidth, "wasm32");
  assertEquals(babaWasmFrontendRequirements.memoryExport, "memory");
  assertEquals(babaWasmFrontendRequirements.memoryPageBytes, 65_536);
  assertEquals(babaWasmFrontendRequirements.sourceEncoding, 1);
  assertEquals(babaWasmFrontendRequirements.spanUnit, 1);
  assertEquals(babaWasmFrontendRequirements.hostOwnershipModel, 1);
  assertEquals(babaWasmFrontendRequirements.resultLifetimeModel, 1);
  assertEquals(babaWasmFrontendRequirements.lexResultI32Count, 2);
  assertEquals(babaWasmFrontendRequirements.tokenRecordI32Count, 4);
  assertEquals(babaWasmFrontendRequirements.parseTraceResultI32Count, 6);
  assertEquals(babaWasmFrontendRequirements.parseCursorResultI32Count, 10);
  assertEquals(babaWasmFrontendRequirements.cursorRuleRecordI32Count, 9);
  assertEquals(babaWasmFrontendRequirements.cursorFieldRecordI32Count, 2);
  assertEquals(babaWasmFrontendRequirements.cursorValueRecordI32Count, 4);
  assertEquals(babaWasmFrontendRequirements.cursorChildRecordI32Count, 2);
  assertEquals(babaWasmFrontendRequirements.cursorValueItemRecordI32Count, 2);
  assertEquals(babaWasmFrontendRequirements.cursorFragmentRecordI32Count, 10);
  assertEquals(
    babaWasmFrontendRequirements.requiredExports.join(","),
    "memory,lex_one,parser_action,parser_actions,parser_select_action,parse_trace,parse_cursor,parser_goto,lex_all,lex_memo_i32_per_position,load_plan,abi_version,plan_version,semantics_version,reset,plan_buffer_base,input_base,max_pages,source_encoding,span_unit,lex_result_i32_count,token_record_i32_count,host_ownership_model,result_lifetime_model",
  );
  assertIncludes(
    babaWasmFrontendRequirements.forbiddenDefaultDependencies.join(","),
    "mandatory WASI host",
  );
});

Deno.test("Wasm frontend candidates are decision-ready but optional", () => {
  const ids = new Set<string>();
  let baselineCount = 0;
  let candidateCount = 0;
  let watchCount = 0;

  for (const candidate of wasmFrontendCandidates) {
    assert(candidate.id.length > 0, "Expected candidate id.");
    assert(!ids.has(candidate.id), `Duplicate candidate id ${candidate.id}.`);
    ids.add(candidate.id);
    assert(candidate.name.length > 0, `Expected name for ${candidate.id}.`);
    assert(candidate.priority >= 0, `Expected priority for ${candidate.id}.`);
    assert(
      candidate.sourceUrls.length > 0,
      `Expected source URLs for ${candidate.id}.`,
    );
    assert(
      candidate.notes.length > 0,
      `Expected notes for ${candidate.id}.`,
    );
    assert(
      candidate.requiredSpikeChecks.length > 0,
      `Expected spike checks for ${candidate.id}.`,
    );

    if (candidate.status === "baseline") {
      baselineCount += 1;
      assertEquals(candidate.command, null);
    } else if (candidate.distribution === "external-toolchain") {
      assert(
        candidate.command !== null,
        `Expected command for ${candidate.id}.`,
      );
    }

    if (candidate.packageFit === "recommended") {
      assertEquals(candidate.distribution, "in-package");
    }

    if (candidate.status === "candidate") {
      candidateCount += 1;
    }

    if (candidate.status === "watch") {
      watchCount += 1;
    }

    for (const sourceUrl of candidate.sourceUrls) {
      const isLocalDoc = sourceUrl.startsWith("docs/");
      const isLocalSource = sourceUrl.startsWith("src/");
      const isHttps = sourceUrl.startsWith("https://");
      assert(
        isLocalDoc || isLocalSource || isHttps,
        `Unexpected source URL for ${candidate.id}: ${sourceUrl}`,
      );
    }
  }

  assertEquals(baselineCount, 1);
  assert(candidateCount >= 2, "Expected at least two concrete candidates.");
  assert(watchCount >= 1, "Expected at least one watch-only candidate.");
  assert(ids.has(wasmFrontendRecommendation.keepAsOracle));
  assert(ids.has(wasmFrontendRecommendation.packagedCompiler));
  assert(ids.has(wasmFrontendRecommendation.firstErgonomicSpike));
  assert(wasmFrontendRecommendation.optionalDependencySpikes.length > 0);
  assert(wasmFrontendRecommendation.externalComparisonSpikes.length > 0);

  const packagedCompiler = wasmFrontendCandidates.find((candidate) =>
    candidate.id === wasmFrontendRecommendation.packagedCompiler
  );
  assert(packagedCompiler, "Expected packaged compiler candidate.");
  assertEquals(packagedCompiler.distribution, "in-package");
  assertEquals(packagedCompiler.packageFit, "recommended");

  const firstSpike = wasmFrontendCandidates.find((candidate) =>
    candidate.id === wasmFrontendRecommendation.firstErgonomicSpike
  );
  assert(firstSpike, "Expected first ergonomic spike candidate.");
  assertEquals(firstSpike.status, "candidate");
  assertEquals(firstSpike.id, "baba-wasm-builder");

  const assemblyScript = wasmFrontendCandidates.find((candidate) =>
    candidate.id === "assemblyscript"
  );
  assert(assemblyScript, "Expected AssemblyScript candidate.");
  assertEquals(assemblyScript.status, "watch");
  assertEquals(assemblyScript.packageFit, "too-heavy");

  const grain = wasmFrontendCandidates.find((candidate) =>
    candidate.id === "grain"
  );
  assert(grain, "Expected Grain candidate.");
  assertEquals(grain.status, "watch");
  assertEquals(grain.distribution, "external-toolchain");
  assertIncludes(grain.requiredSpikeChecks.join(","), "raw functions");
});

Deno.test("Wasm frontend scaffold stays aligned with generated artifacts", () => {
  const result = compile(`module = "ok" ;`);
  assertEquals(result.diagnostics.length, 0);
  assert(result.bundle);

  const filePaths = result.bundle.files.map((file) => file.path).join(",");
  assertIncludes(filePaths, "wasm/abi.json");
  assertIncludes(filePaths, "wasm/parser.wasm");
  assertIncludes(filePaths, "wasm/parser.plan");
  assertNotIncludes(filePaths, "wasm/plan.ts");

  const abiFile = result.bundle.files.find((file) =>
    file.path === "wasm/abi.json"
  );
  assert(abiFile, "Expected generated abi.json.");
  assert(abiFile.encoding === "utf-8", "Expected text abi.json.");
  const abi = JSON.parse(abiFile.content) as GeneratedAbiDescriptor;

  assertEquals(abi.format, babaWasmFrontendRequirements.abiName);
  assertEquals(abi.version, 1);
  assertEquals(abi.targetKind, babaWasmFrontendRequirements.targetKind);
  assertEquals(
    abi.core.abiVersion,
    babaWasmFrontendRequirements.abiVersion,
  );
  assertEquals(
    abi.core.memory.export,
    babaWasmFrontendRequirements.memoryExport,
  );
  assertEquals(
    abi.core.memory.pageBytes,
    babaWasmFrontendRequirements.memoryPageBytes,
  );
  assertEquals(abi.core.memory.maxPages, babaWasmFrontendRequirements.maxPages);
  assertEquals(
    abi.core.sourceEncoding.value,
    babaWasmFrontendRequirements.sourceEncoding,
  );
  assertEquals(
    abi.core.spanUnit.value,
    babaWasmFrontendRequirements.spanUnit,
  );
  assertEquals(
    abi.core.ownership.value,
    babaWasmFrontendRequirements.hostOwnershipModel,
  );
  assertEquals(
    abi.core.resultLifetime.value,
    babaWasmFrontendRequirements.resultLifetimeModel,
  );
  assertEquals(
    abi.core.layouts.lexResult.i32Count,
    babaWasmFrontendRequirements.lexResultI32Count,
  );
  assertEquals(
    abi.core.layouts.tokenRecord.i32Count,
    babaWasmFrontendRequirements.tokenRecordI32Count,
  );
  assertEquals(
    abi.core.layouts.parseTraceResult.i32Count,
    babaWasmFrontendRequirements.parseTraceResultI32Count,
  );
  assertEquals(
    abi.core.layouts.parseCursorResult.i32Count,
    babaWasmFrontendRequirements.parseCursorResultI32Count,
  );
  assertEquals(
    abi.core.layouts.cursorRuleRecord.i32Count,
    babaWasmFrontendRequirements.cursorRuleRecordI32Count,
  );
  assertEquals(
    abi.core.layouts.cursorFieldRecord.i32Count,
    babaWasmFrontendRequirements.cursorFieldRecordI32Count,
  );
  assertEquals(
    abi.core.layouts.cursorValueRecord.i32Count,
    babaWasmFrontendRequirements.cursorValueRecordI32Count,
  );
  assertEquals(
    abi.core.layouts.cursorChildRecord.i32Count,
    babaWasmFrontendRequirements.cursorChildRecordI32Count,
  );
  assertEquals(
    abi.core.layouts.cursorValueItemRecord.i32Count,
    babaWasmFrontendRequirements.cursorValueItemRecordI32Count,
  );
  assertEquals(
    abi.core.exports.map((entry) => entry.name).join(","),
    babaWasmFrontendRequirements.requiredExports.join(","),
  );

  const wasmFile = result.bundle.files.find((file) =>
    file.path === "wasm/parser.wasm"
  );
  assert(wasmFile, "Expected generated parser.wasm.");
  assert(wasmFile.encoding === "binary", "Expected binary parser.wasm.");
  assert(WebAssembly.validate(arrayBuffer(wasmFile.content)));
});

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}
